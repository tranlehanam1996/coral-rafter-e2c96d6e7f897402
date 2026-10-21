import { describe, expect, it, beforeEach } from "vitest";
import { RecordStore } from "../src/core/store";
import type { LifeRecord } from "../types";

const rec = (overrides: Partial<LifeRecord> = {}): LifeRecord => ({
  id: "one", title: "Example", category: "Documents", dueDate: "2026-08-20", effort: 30,
  impact: 3, status: "planned", notes: "", createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z", ...overrides,
});

describe("record store", () => {
  beforeEach(() => {
    const backing: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => (Object.prototype.hasOwnProperty.call(backing, key) ? backing[key] : null),
      setItem: (key: string, value: string) => { backing[key] = value; },
      removeItem: (key: string) => { delete backing[key]; },
    };
  });

  it("starts from fallback when storage is empty", () => {
    const store = new RecordStore("k", [rec()]);
    expect(store.all()).toHaveLength(1);
  });

  it("upserts and removes records", () => {
    const store = new RecordStore("k", []);
    store.upsert(rec());
    expect(store.all()).toHaveLength(1);
    store.remove("one");
    expect(store.all()).toHaveLength(0);
  });

  it("recovers from corrupt JSON", () => {
    localStorage.setItem("k", "{not json");
    const store = new RecordStore("k", [rec({ id: "fallback" })]);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].id).toBe("fallback");
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("recovers from records with circular dependencies", () => {
    const a = rec({ id: "a", dependsOn: "b" });
    const b = rec({ id: "b", dependsOn: "a" });
    const envelope = JSON.stringify({ version: 1, records: [a, b], savedAt: "2026-08-01T00:00:00Z" });
    localStorage.setItem("k", envelope);
    const store = new RecordStore("k", [rec({ id: "fallback" })]);
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].id).toBe("fallback");
  });

  it("notifies subscribers", () => {
    const store = new RecordStore("k", []);
    let seen = 0;
    const unsubscribe = store.subscribe((records) => { seen = records.length; });
    store.upsert(rec());
    expect(seen).toBe(1);
    unsubscribe();
  });
});
