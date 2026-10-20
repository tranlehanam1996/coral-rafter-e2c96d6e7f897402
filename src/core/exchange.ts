import type { ItemStatus, LifeRecord, ThemeConfig, PriorityLevel } from "../types";
import { isCalendarDay } from "./date-utils";

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), records }, null, 2);
}

const STATUSES: readonly ItemStatus[] = ["planned", "active", "done", "archived"];
const PRIORITIES: readonly PriorityLevel[] = ["low", "medium", "high"];

const CSV_FIELDS: readonly (keyof LifeRecord)[] = [
  "id", "title", "category", "dueDate", "effort", "impact", "status", "notes",
  "dependsOn", "project", "tags", "priority", "parentId", "isBlocked",
];

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const canonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return parsed.toISOString() === canonical;
}

function decodeRecord(value: unknown, index: number, theme: ThemeConfig): LifeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Record ${index + 1} is not an object.`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 120) {
    throw new Error(`Record ${index + 1} has an invalid id.`);
  }
  if (typeof raw.title !== "string" || raw.title.trim().length < 1 || raw.title.length > 100) {
    throw new Error(`Record ${index + 1} has an invalid title.`);
  }
  if (typeof raw.category !== "string" || !theme.categories.includes(raw.category)) {
    throw new Error(`Record ${index + 1} has an unknown category.`);
  }
  if (!isCalendarDay(raw.dueDate)) throw new Error(`Record ${index + 1} has an invalid due date.`);
  if (typeof raw.effort !== "number" || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) {
    throw new Error(`Record ${index + 1} has invalid effort.`);
  }
  if (typeof raw.impact !== "number" || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) {
    throw new Error(`Record ${index + 1} has invalid impact.`);
  }
  if (typeof raw.status !== "string" || !STATUSES.includes(raw.status as ItemStatus)) {
    throw new Error(`Record ${index + 1} has an invalid status.`);
  }
  if (typeof raw.notes !== "string" || raw.notes.length > 600) {
    throw new Error(`Record ${index + 1} has invalid notes.`);
  }
  if (!isTimestamp(raw.createdAt) || !isTimestamp(raw.updatedAt)) {
    throw new Error(`Record ${index + 1} has invalid timestamps.`);
  }

  let dependsOn: string | string[] | undefined = undefined;
  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (typeof raw.dependsOn === "string") {
      dependsOn = raw.dependsOn;
    } else if (Array.isArray(raw.dependsOn) && raw.dependsOn.every((id) => typeof id === "string")) {
      dependsOn = raw.dependsOn as string[];
    } else {
      throw new Error(`Record ${index + 1} has invalid dependency data.`);
    }
  }

  let project: string | undefined = undefined;
  if (raw.project !== undefined && raw.project !== null) {
    if (typeof raw.project !== "string") {
      throw new Error(`Record ${index + 1} has invalid project.`);
    }
    const trimmed = raw.project.trim();
    project = trimmed || undefined;
  }

  let tags: string[] = [];
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((t) => typeof t === "string")) {
      throw new Error(`Record ${index + 1} has invalid tags.`);
    }
    tags = raw.tags as string[];
  }

  let priority: PriorityLevel | undefined = undefined;
  if (raw.priority !== undefined && raw.priority !== null) {
    if (typeof raw.priority !== "string" || !PRIORITIES.includes(raw.priority as PriorityLevel)) {
      throw new Error(`Record ${index + 1} has invalid priority.`);
    }
    priority = raw.priority as PriorityLevel;
  }

  let parentId: string | undefined = undefined;
  if (raw.parentId !== undefined && raw.parentId !== null) {
    if (typeof raw.parentId !== "string") {
      throw new Error(`Record ${index + 1} has invalid parentId.`);
    }
    parentId = raw.parentId;
  }

  let isBlocked: boolean | undefined = undefined;
  if (raw.isBlocked !== undefined && raw.isBlocked !== null) {
    if (typeof raw.isBlocked !== "boolean") {
      throw new Error(`Record ${index + 1} has invalid isBlocked.`);
    }
    isBlocked = raw.isBlocked;
  }

  return {
    id: raw.id,
    title: raw.title.trim(),
    category: raw.category,
    dueDate: raw.dueDate,
    effort: raw.effort,
    impact: raw.impact,
    status: raw.status as ItemStatus,
    notes: raw.notes,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    dependsOn,
    project,
    tags,
    priority,
    parentId,
    isBlocked,
  };
}

export function importJson(source: string, theme: ThemeConfig): LifeRecord[] {
  const parsed = JSON.parse(source) as { schema?: unknown; records?: unknown };
  if (parsed.schema !== 1 || !Array.isArray(parsed.records)) throw new Error("Unsupported backup format.");
  const ids = new Set<string>();
  return parsed.records.map((value, index) => {
    const item = decodeRecord(value, index, theme);
    if (ids.has(item.id)) throw new Error(`Record ${index + 1} has a duplicate id.`);
    ids.add(item.id);
    return item;
  });
}

export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { current.push(field); field = ""; i++; continue; }
    if (ch === '\n') { current.push(field); field = ""; rows.push(current); current = []; i++; continue; }
    field += ch; i++;
  }
  if (field !== "" || current.length > 0) { current.push(field); rows.push(current); }
  return rows.filter((row) => !(row.length === 1 && row[0].trim() === ""));
}

function csvCell(value: unknown): string { return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`; }

export function exportCsv(records: readonly LifeRecord[]): string {
  return [CSV_FIELDS.join(","), ...records.map((item) => CSV_FIELDS.map((field) => csvCell(item[field])).join(","))].join("\n");
}

function rowToObject(header: readonly string[], row: readonly string[]): Record<string, unknown> {
  const idx = (name: string): number => header.indexOf(name);
  const cell = (name: string): string => {
    const i = idx(name);
    return i >= 0 && i < row.length ? row[i] : "";
  };
  const tagsCell = cell("tags").trim();
  const tags = tagsCell === "" ? [] : tagsCell.split(",").map((s) => s.trim()).filter(Boolean);
  const dependsCell = cell("dependsOn").trim();
  const dependsOn = dependsCell === ""
    ? undefined
    : (dependsCell.includes(",") ? dependsCell.split(",").map((s) => s.trim()).filter(Boolean) : dependsCell);
  const priorityCell = cell("priority").trim();
  const projectCell = cell("project").trim();
  const parentCell = cell("parentId").trim();
  const blockedCell = cell("isBlocked").trim();
  const now = new Date().toISOString();
  return {
    id: cell("id"),
    title: cell("title"),
    category: cell("category"),
    dueDate: cell("dueDate"),
    effort: Number(cell("effort")),
    impact: Number(cell("impact")),
    status: cell("status"),
    notes: cell("notes"),
    dependsOn,
    project: projectCell === "" ? undefined : projectCell,
    tags,
    priority: priorityCell === "" ? undefined : priorityCell,
    parentId: parentCell === "" ? undefined : parentCell,
    isBlocked: blockedCell === "" ? undefined : blockedCell === "true",
    createdAt: cell("createdAt").trim() || now,
    updatedAt: cell("updatedAt").trim() || now,
  };
}

export function importCsv(source: string, theme: ThemeConfig): LifeRecord[] {
  const rows = parseCsv(source);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one record.");
  const header = rows[0].map((h) => h.trim());
  const required = ["id", "title", "category", "dueDate", "effort", "impact", "status"];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`Missing required column: ${column}.`);
  }
  const ids = new Set<string>();
  const records: LifeRecord[] = [];
  rows.slice(1).forEach((row, index) => {
    if (row.every((cell) => cell.trim() === "")) return;
    const raw = rowToObject(header, row);
    const item = decodeRecord(raw, index, theme);
    if (ids.has(item.id)) throw new Error(`Record ${index + 1} has a duplicate id.`);
    ids.add(item.id);
    records.push(item);
  });
  return records;
}

export function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = Object.assign(document.createElement("a"), { href: url, download: name });
  anchor.click();
  URL.revokeObjectURL(url);
}
