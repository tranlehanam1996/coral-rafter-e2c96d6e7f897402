import type { ItemStatus, LifeRecord, ThemeConfig, PriorityLevel } from "../types";
import { isCalendarDay } from "./date-utils";

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), records }, null, 2);
}

const STATUSES: readonly ItemStatus[] = ["planned", "active", "done", "archived"];
const PRIORITIES: readonly PriorityLevel[] = ["low", "medium", "high"];

const CSV_FIELDS: readonly (keyof LifeRecord)[] = [
  "id", "title", "category", "dueDate", "effort", "impact", "status", "notes",
  "dependsOn", "project", "tags", "priority", "parentId", "isBlocked", "isCritical",
  "createdAt", "updatedAt",
];

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const canonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return parsed.toISOString() === canonical;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const trimmed = entry.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
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
      const trimmed = raw.dependsOn.trim();
      dependsOn = trimmed || undefined;
    } else if (Array.isArray(raw.dependsOn) && raw.dependsOn.every((id) => typeof id === "string")) {
      const normalized = normalizeStringList(raw.dependsOn);
      dependsOn = normalized && normalized.length ? normalized : undefined;
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
    tags = normalizeStringList(raw.tags) ?? [];
  }

  let priority: PriorityLevel | undefined = undefined;
  if (raw.priority !== undefined && raw.priority !== null) {
    if (typeof raw.priority !== "string" || !PRIORITIES.includes(raw.priority as PriorityLevel)) {
      throw new Error(`Record ${index + 1} has an invalid priority.`);
    }
    priority = raw.priority as PriorityLevel;
  }

  let parentId: string | undefined = undefined;
  if (raw.parentId !== undefined && raw.parentId !== null) {
    if (typeof raw.parentId !== "string") {
      throw new Error(`Record ${index + 1} has invalid parentId.`);
    }
    const trimmed = raw.parentId.trim();
    parentId = trimmed || undefined;
  }

  let isBlocked: boolean | undefined = undefined;
  if (raw.isBlocked !== undefined && raw.isBlocked !== null) {
    if (typeof raw.isBlocked !== "boolean") {
      throw new Error(`Record ${index + 1} has an invalid isBlocked.`);
    }
    isBlocked = raw.isBlocked;
  }

  let isCritical: boolean | undefined = undefined;
  if (raw.isCritical !== undefined && raw.isCritical !== null) {
    if (typeof raw.isCritical !== "boolean") {
      throw new Error(`Record ${index + 1} has an invalid isCritical.`);
    }
    isCritical = raw.isCritical;
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
    isCritical,
  };
}

function validateReferences(records: readonly LifeRecord[]): void {
  const ids = new Set(records.map((record) => record.id));
  records.forEach((record, index) => {
    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn
      : record.dependsOn
        ? [record.dependsOn]
        : [];
    for (const dep of deps) {
      if (!ids.has(dep)) {
        throw new Error(`Record ${index + 1} references an unknown dependency: ${dep}.`);
      }
    }
    if (record.parentId && !ids.has(record.parentId)) {
      throw new Error(`Record ${index + 1} references an unknown parent: ${record.parentId}.`);
    }
  });
}

export function importJson(source: string, theme: ThemeConfig): LifeRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unsupported backup format.");
  }
  const envelope = parsed as { schema?: unknown; records?: unknown };
  if (envelope.schema !== 1 || !Array.isArray(envelope.records)) throw new Error("Unsupported backup format.");
  const ids = new Set<string>();
  const records = envelope.records.map((value, index) => {
    const item = decodeRecord(value, index, theme);
    if (ids.has(item.id)) throw new Error(`Record ${index + 1} has a duplicate id.`);
    ids.add(item.id);
    return item;
  });
  validateReferences(records);
  return records;
}

export function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
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
    field += ch; i++; continue;
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
  const priorityCell = cell("priority").trim().toLowerCase();
  const projectCell = cell("project").trim();
  const parentCell = cell("parentId").trim();
  const blockedCell = cell("isBlocked").trim();
  const criticalCell = cell("isCritical").trim();
  const statusCell = cell("status").trim().toLowerCase();
  const now = new Date().toISOString();

  let isBlocked: boolean | string | undefined = undefined;
  if (blockedCell !== "") {
    const lowered = blockedCell.toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") isBlocked = true;
    else if (lowered === "false" || lowered === "0" || lowered === "no") isBlocked = false;
    else isBlocked = blockedCell;
  }

  let isCritical: boolean | string | undefined = undefined;
  if (criticalCell !== "") {
    const lowered = criticalCell.toLowerCase();
    if (lowered === "true" || lowered === "1" || lowered === "yes") isCritical = true;
    else if (lowered === "false" || lowered === "0" || lowered === "no") isCritical = false;
    else isCritical = criticalCell;
  }

  return {
    id: cell("id"),
    title: cell("title"),
    category: cell("category"),
    dueDate: cell("dueDate"),
    effort: Number(cell("effort")),
    impact: Number(cell("impact")),
    status: statusCell,
    notes: cell("notes"),
    dependsOn,
    project: projectCell === "" ? undefined : projectCell,
    tags,
    priority: priorityCell === "" ? undefined : priorityCell,
    parentId: parentCell === "" ? undefined : parentCell,
    isBlocked,
    isCritical,
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
  validateReferences(records);
  return records;
}

export function download(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = Object.assign(document.createElement("a"), { href: url, download: name });
  anchor.click();
  URL.revokeObjectURL(url);
}
