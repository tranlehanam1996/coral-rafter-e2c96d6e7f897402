import { describe, expect, it } from "vitest";
import { exportCsv, importCsv, parseCsv } from "../src/core/exchange";
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
});
