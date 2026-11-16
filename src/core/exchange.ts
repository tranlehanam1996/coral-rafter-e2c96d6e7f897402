import type { ItemStatus, LifeRecord, PriorityLevel, ThemeConfig } from "../types";
import { isCalendarDay } from "./date-utils";

const STATUSES: readonly ItemStatus[] = ["planned", "active", "done", "archived"];
const PRIORITIES: readonly PriorityLevel[] = ["low", "medium", "high"];
const STATUS_SET = new Set<string>(STATUSES);
const PRIORITY_SET = new Set<string>(PRIORITIES);

function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function hasDirectedCycle(edges: Map<string, string[]>): boolean {
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (node: string): boolean => {
    const state = color.get(node) ?? 0;
    if (state === 1) return true;
    if (state === 2) return false;
    color.set(node, 1);
    for (const next of edges.get(node) ?? []) {
      if (visit(next)) return true;
    }
    color.set(node, 2);
    return false;
  };
  for (const node of edges.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)) return false;
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return false;
  const iso = parsed.toISOString();
  const comparable = v.includes(".") ? iso : iso.replace(/\.\d{3}Z$/, "Z");
  return comparable === v;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, """)}"`;
  return value;
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => !entry.every((cell) => cell.trim() === ""));
}

export function exportCsv(records: readonly LifeRecord[]): string {
  const header = [
    "id", "title", "category", "dueDate", "effort", "impact", "status", "notes",
    "dependsOn", "project", "tags", "priority", "parentId", "isBlocked",
    "createdAt", "updatedAt",
  ];
  const lines = [header.join(",")];
  for (const record of records) {
    const dependsOn = Array.isArray(record.dependsOn)
      ? record.dependsOn.join(";")
      : (record.dependsOn ?? "");
    const tags = record.tags ? record.tags.join(";") : "";
    const fields = [
      record.id, record.title, record.category, record.dueDate,
      String(record.effort), String(record.impact), record.status, record.notes ?? "",
      dependsOn, record.project ?? "", tags, record.priority ?? "",
      record.parentId ?? "", record.isBlocked ? "true" : "",
      record.createdAt, record.updatedAt,
    ];
    lines.push(fields.map(csvField).join(","));
  }
  return lines.join("\n");
}

export function importCsv(csv: string, theme: ThemeConfig): LifeRecord[] {
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error("Missing required column: id");
  const header = rows[0].map((cell) => cell.trim());
  const required = ["id", "title", "category", "dueDate", "effort", "impact", "status"];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`Missing required column: ${column}`);
  }
  const indexOf = (name: string) => header.indexOf(name);
  const records: LifeRecord[] = [];
  const ids = new Set<string>();

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.every((cell) => cell.trim() === "")) continue;
    const get = (name: string) => {
      const at = indexOf(name);
      return at >= 0 ? (row[at] ?? "").trim() : "";
    };

    const id = get("id");
    const title = get("title");
    const category = get("category");
    const dueDate = get("dueDate");
    const effort = Number(get("effort"));
    const impact = Number(get("impact"));
    const statusRaw = get("status").toLowerCase();
    const notes = get("notes");

    if (!id || id.length > 120) throw new Error("invalid id");
    if (!title || title.length > 100) throw new Error("invalid title");
    if (!theme.categories.includes(category)) throw new Error("unknown category");
    if (!isCalendarDay(dueDate)) throw new Error("invalid due date");
    if (!Number.isFinite(effort) || effort < 1 || effort > 480) throw new Error("invalid effort");
    if (!Number.isInteger(impact) || impact < 1 || impact > 5) throw new Error("invalid impact");
    if (!STATUS_SET.has(statusRaw)) throw new Error("invalid status");
    if (notes.length > 600) throw new Error("invalid notes");

    const createdAtRaw = get("createdAt");
    const updatedAtRaw = get("updatedAt");
    const createdAt = createdAtRaw || new Date().toISOString();
    const updatedAt = updatedAtRaw || new Date().toISOString();
    if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) throw new Error("invalid timestamp");

    const tagsRaw = get("tags");
    const tags = tagsRaw
      ? uniqueTrimmedStrings(tagsRaw.split(/[;,]/).map((part) => part.trim()).filter(Boolean))
      : undefined;

    const depsRaw = get("dependsOn");
    let dependsOn: string | string[] | undefined;
    if (depsRaw) {
      const parts = depsRaw.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
      dependsOn = parts.length === 1 ? parts[0] : (parts.length > 1 ? parts : undefined);
    }

    const project = optionalTrimmedString(get("project"));
    const priorityRaw = get("priority");
    let priority: PriorityLevel | undefined;
    if (priorityRaw) {
      const normalized = priorityRaw.toLowerCase();
      if (!PRIORITY_SET.has(normalized)) throw new Error("invalid priority");
      priority = normalized as PriorityLevel;
    }
    const parentId = optionalTrimmedString(get("parentId"));
    const blockedRaw = get("isBlocked").toLowerCase();
    const isBlocked = blockedRaw === "true"
      ? true
      : blockedRaw === "false"
        ? false
        : undefined;

    if (ids.has(id)) throw new Error("duplicate id");
    ids.add(id);

    records.push({
      id, title, category, dueDate, effort, impact,
      status: statusRaw as ItemStatus, notes, createdAt, updatedAt,
      tags: tags && tags.length ? tags : undefined,
      dependsOn, project, priority, parentId, isBlocked,
    });
  }

  const idSet = new Set(records.map((record) => record.id));
  for (const record of records) {
    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn
      : record.dependsOn
        ? [record.dependsOn]
        : [];
    for (const dep of deps) {
      if (!idSet.has(dep)) throw new Error("unknown dependency");
    }
    if (record.parentId && !idSet.has(record.parentId)) throw new Error("unknown parent");
  }

  const dependencyEdges = new Map(records.map((record) => [
    record.id,
    Array.isArray(record.dependsOn) ? record.dependsOn : record.dependsOn ? [record.dependsOn] : [],
  ]));
  const parentEdges = new Map(records.map((record) => [record.id, record.parentId ? [record.parentId] : []]));
  if (hasDirectedCycle(dependencyEdges) || hasDirectedCycle(parentEdges)) {
    throw new Error("circular dependency");
  }

  return records;
}

function normalizeImportedRecord(value: unknown, theme: ThemeConfig): LifeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid record");
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== "string" || raw.id.trim().length < 1 || raw.id.trim().length > 120) throw new Error("invalid id");
  if (typeof raw.title !== "string" || raw.title.trim().length < 1 || raw.title.trim().length > 100) throw new Error("invalid title");
  const category = typeof raw.category === "string" ? raw.category.trim() : raw.category;
  if (typeof category !== "string" || category.length < 1 || !theme.categories.includes(category)) throw new Error("unknown category");
  const dueDate = typeof raw.dueDate === "string" ? raw.dueDate.trim() : raw.dueDate;
  if (!isCalendarDay(dueDate)) throw new Error("invalid due date");
  if (typeof raw.effort !== "number" || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) throw new Error("invalid effort");
  if (typeof raw.impact !== "number" || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) throw new Error("invalid impact");
  if (typeof raw.status !== "string") throw new Error("invalid status");
  const normalizedStatus = raw.status.trim().toLowerCase();
  if (!STATUS_SET.has(normalizedStatus)) throw new Error("invalid status");
  if (typeof raw.notes !== "string" || raw.notes.trim().length > 600) throw new Error("invalid notes");
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt.trim() : raw.createdAt;
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt.trim() : raw.updatedAt;
  if (typeof createdAt !== "string" || !isTimestamp(createdAt)) throw new Error("invalid timestamp");
  if (typeof updatedAt !== "string" || !isTimestamp(updatedAt)) throw new Error("invalid timestamp");

  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (typeof raw.dependsOn === "string") {
      // Empty or whitespace-only values are dropped during normalization.
    } else if (Array.isArray(raw.dependsOn)) {
      if (!raw.dependsOn.every((entry) => typeof entry === "string")) throw new Error("invalid dependency");
    } else {
      throw new Error("invalid dependency");
    }
  }
  if (raw.project !== undefined && raw.project !== null) {
    if (typeof raw.project !== "string" || raw.project.trim().length < 1) throw new Error("invalid project");
  }
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((entry) => typeof entry === "string")) throw new Error("invalid tags");
  }
  if (raw.priority !== undefined && raw.priority !== null) {
    if (typeof raw.priority !== "string") throw new Error("invalid priority");
    const normalizedPriority = raw.priority.trim().toLowerCase();
    if (!PRIORITY_SET.has(normalizedPriority)) throw new Error("invalid priority");
  }
  if (raw.parentId !== undefined && raw.parentId !== null) {
    if (typeof raw.parentId !== "string" || raw.parentId.trim().length < 1) throw new Error("invalid parent");
  }
  if (raw.isBlocked !== undefined && raw.isBlocked !== null && typeof raw.isBlocked !== "boolean") throw new Error("invalid blocked flag");
  if (raw.isCritical !== undefined && raw.isCritical !== null && typeof raw.isCritical !== "boolean") throw new Error("invalid critical flag");

  let dependsOn: string | string[] | undefined;
  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (typeof raw.dependsOn === "string") {
      dependsOn = raw.dependsOn.trim();
    } else {
      const parts = uniqueTrimmedStrings(raw.dependsOn as string[]);
      dependsOn = parts.length ? parts : undefined;
    }
    if (typeof dependsOn === "string" && !dependsOn) dependsOn = undefined;
    if (Array.isArray(dependsOn) && !dependsOn.length) dependsOn = undefined;
  }

  const tags = raw.tags !== undefined && raw.tags !== null
    ? uniqueTrimmedStrings(raw.tags as string[])
    : undefined;

  const priority = raw.priority !== undefined && raw.priority !== null
    ? (raw.priority as string).trim().toLowerCase() as PriorityLevel
    : undefined;

  const record: LifeRecord = {
    id: raw.id.trim(),
    title: raw.title.trim(),
    category,
    dueDate,
    effort: raw.effort,
    impact: raw.impact,
    status: normalizedStatus as ItemStatus,
    notes: raw.notes.trim(),
    createdAt,
    updatedAt,
    dependsOn,
    isCritical: typeof raw.isCritical === "boolean" ? raw.isCritical : undefined,
    isBlocked: typeof raw.isBlocked === "boolean" ? raw.isBlocked : undefined,
    project: optionalTrimmedString(raw.project),
    tags: tags && tags.length ? tags : undefined,
    priority,
    parentId: optionalTrimmedString(raw.parentId),
  };
  return record;
}

export function importJson(raw: string, theme: ThemeConfig): LifeRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unsupported backup format");
  }
  const envelope = parsed as { schema?: unknown; records?: unknown };
  if (envelope.schema !== 1 || !Array.isArray(envelope.records)) {
    throw new Error("Unsupported backup format");
  }

  const normalized = envelope.records.map((record) => normalizeImportedRecord(record, theme));

  const ids = new Set<string>();
  for (const record of normalized) {
    if (ids.has(record.id)) throw new Error("duplicate id");
    ids.add(record.id);
  }

  for (const record of normalized) {
    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn
      : record.dependsOn
        ? [record.dependsOn]
        : [];
    for (const dep of deps) {
      if (!ids.has(dep)) throw new Error("unknown dependency");
    }
    if (record.parentId && !ids.has(record.parentId)) throw new Error("unknown parent");
  }

  const dependencyEdges = new Map(normalized.map((record) => [
    record.id,
    Array.isArray(record.dependsOn) ? record.dependsOn : record.dependsOn ? [record.dependsOn] : [],
  ]));
  const parentEdges = new Map(normalized.map((record) => [record.id, record.parentId ? [record.parentId] : []]));
  if (hasDirectedCycle(dependencyEdges) || hasDirectedCycle(parentEdges)) {
    throw new Error("circular dependency");
  }

  return normalized;
}

export function exportJson(records: readonly LifeRecord[]): string {
  return JSON.stringify({ schema: 1, records }, null, 2);
}

export function download(content: string, filename: string, type = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
