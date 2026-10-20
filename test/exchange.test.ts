import { describe, expect, it } from "vitest";
import { exportCsv, importCsv, parseCsv, importJson, exportJson } from "../src/core/exchange";
import { theme } from "../src/theme";
import type { LifeRecord } from "../types";

const item = (overrides: Partial<LifeRecord> = {}): LifeRecord => ({
  id: "one", title: "Example", category: theme.categories[0], dueDate: "2026-08-20", effort: 30,
  impact: 3, status: "planned", notes: "", createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z", ...overrides,
});

describe("CSV exchange", () => {
  it("round-trips a record through CSV export and import", () => {
    const record = item({ tags: ["a", "b"], project: "Trip" });
    const csv = exportCsv([record]);
    const imported = importCsv(csv, theme);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ id: record.id, title: record.title, tags: record.tags, project: record.project });
  });

  it("parses quoted fields with commas", () => {
    const csv = 'id,title,category,dueDate,effort,impact,status,notes,dependsOn,project,tags,priority,parentId,isBlocked,createdAt,updatedAt\n"r1","Hello, world",Documents,2026-08-20,10,4,planned,"note, with comma", ,Trip,, , , ,2026-08-01T00:00:00Z,2026-08-01T00:00:00Z';
    const rows = parseCsv(csv);
    expect(rows[1][1]).toBe("Hello, world");
    expect(rows[1][7]).toBe("note, with comma");
  });

  it("rejects CSV missing required columns", () => {
    expect(() => importCsv("title,category\nExample,Documents", theme)).toThrow(/Missing required column/);
  });

  it("rejects CSV with duplicate ids", () => {
    const record = item();
    const csv = exportCsv([record, record]);
    expect(() => importCsv(csv, theme)).toThrow(/duplicate id/);
  });

  it("strips a leading BOM when parsing CSV", () => {
    const csv = "\uFEFFid,title,category,dueDate,effort,impact,status\n" +
      "r1,Example," + theme.categories[0] + ",2026-08-20,10,4,planned";
    const rows = parseCsv(csv);
    expect(rows[0][0]).toBe("id");
  });

  it("rejects CSV records referencing unknown dependencies", () => {
    const csv = "id,title,category,dueDate,effort,impact,status,dependsOn\n" +
      "r1,Example," + theme.categories[0] + ",2026-08-20,10,4,planned,missing";
    expect(() => importCsv(csv, theme)).toThrow(/unknown dependency/);
  });
});

describe("JSON exchange boundary", () => {
  const valid = () => item({ category: theme.categories[0] });
  const backup = (record: unknown) => JSON.stringify({ schema: 1, records: [record] });

  it("accepts a fully valid record", () => {
    expect(importJson(backup(valid()), theme)).toHaveLength(1);
  });

  it("trims tags and drops empty dependencies", () => {
    const record = { ...valid(), tags: [" a ", "", "b"], dependsOn: "   " };
    const imported = importJson(backup(record), theme);
    expect(imported[0].tags).toEqual(["a", "b"]);
    expect(imported[0].dependsOn).toBeUndefined();
  });

  it("rejects unknown top-level JSON shapes", () => {
    expect(() => importJson("[]", theme)).toThrow(/Unsupported backup format/);
    expect(() => importJson("not json", theme)).toThrow(/Invalid JSON/);
  });

  it("rejects records referencing unknown parents", () => {
    const record = { ...valid(), parentId: "missing" };
    expect(() => importJson(backup(record), theme)).toThrow(/unknown parent/);
  });

  it.each([
    ["string effort", { effort: "30" }],
    ["out-of-range impact", { impact: 9 }],
    ["unknown status", { status: "paused" }],
    ["impossible calendar date", { dueDate: "2026-02-30" }],
    ["empty title", { title: "" }],
    ["unknown category", { category: "Not in this project" }],
    ["non-string notes", { notes: 42 }],
    ["invalid timestamp", { updatedAt: "yesterday" }],
    ["numeric-looking loose timestamp", { createdAt: "0" }],
    ["normalized impossible timestamp", { updatedAt: "2026-02-30T00:00:00Z" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => importJson(backup({ ...valid(), ...patch }), theme)).toThrow();
  });

  it("rejects duplicate ids instead of silently merging records", () => {
    const record = valid();
    expect(() => importJson(JSON.stringify({ schema: 1, records: [record, record] }), theme)).toThrow(/duplicate id/);
  });
});
