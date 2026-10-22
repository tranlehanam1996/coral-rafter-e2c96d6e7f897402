import type { ItemStatus, LifeRecord, PriorityLevel } from "../types";
import { isCalendarDay } from "./date-utils";
import { isTimestamp } from "./exchange";

interface StoreEnvelope { version: 1; records: LifeRecord[]; savedAt: string }
type Listener = (records: readonly LifeRecord[]) => void;

const STATUSES: readonly ItemStatus[] = ["planned", "active", "done", "archived"];
const PRIORITIES: readonly PriorityLevel[] = ["low", "medium", "high"];
const STATUS_SET = new Set<string>(STATUSES);
const PRIORITY_SET = new Set<string>(PRIORITIES);

function cloneRecord(item: LifeRecord): LifeRecord {
  return {
    ...item,
    tags: item.tags ? [...item.tags] : undefined,
    dependsOn: Array.isArray(item.dependsOn) ? [...item.dependsOn] : (item.dependsOn ?? undefined),
    project: item.project ?? undefined,
    priority: item.priority ?? undefined,
    parentId: item.parentId ?? undefined,
    isBlocked: item.isBlocked ?? undefined,
    isCritical: item.isCritical ?? undefined,
  };
}

function recordsEqual(a: LifeRecord, b: LifeRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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

function hasValidReferences(records: readonly LifeRecord[]): boolean {
  const ids = new Set(records.map((record) => record.id));
  if (ids.size !== records.length) return false;

  for (const record of records) {
    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn
      : record.dependsOn
        ? [record.dependsOn]
        : [];
    for (const dep of deps) {
      if (!ids.has(dep)) return false;
    }
    if (record.parentId && !ids.has(record.parentId)) return false;
  }

  const dependencyEdges = new Map<string, string[]>();
  const parentEdges = new Map<string, string[]>();
  for (const record of records) {
    const deps = Array.isArray(record.dependsOn)
      ? record.dependsOn
      : record.dependsOn
        ? [record.dependsOn]
        : [];
    dependencyEdges.set(record.id, deps);
    parentEdges.set(record.id, record.parentId ? [record.parentId] : []);
  }
  if (hasDirectedCycle(dependencyEdges)) return false;
  if (hasDirectedCycle(parentEdges)) return false;
  return true;
}

function isStoredRecord(value: unknown): value is LifeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== "string" || raw.id.length < 1 || raw.id.length > 120) return false;
  if (typeof raw.title !== "string" || raw.title.trim().length < 1 || raw.title.length > 100) return false;
  if (typeof raw.category !== "string" || raw.category.trim().length < 1) return false;
  if (!isCalendarDay(raw.dueDate)) return false;
  if (typeof raw.effort !== "number" || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) return false;
  if (typeof raw.impact !== "number" || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) return false;
  if (typeof raw.status !== "string" || !STATUS_SET.has(raw.status)) return false;
  if (typeof raw.notes !== "string" || raw.notes.length > 600) return false;
  if (typeof raw.createdAt !== "string" || !isTimestamp(raw.createdAt)) return false;
  if (typeof raw.updatedAt !== "string" || !isTimestamp(raw.updatedAt)) return false;

  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (typeof raw.dependsOn === "string") {
      if (raw.dependsOn.trim().length < 1) return false;
    } else if (Array.isArray(raw.dependsOn)) {
      if (!raw.dependsOn.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return false;
    } else {
      return false;
    }
  }

  if (raw.project !== undefined && raw.project !== null) {
    if (typeof raw.project !== "string" || raw.project.trim().length < 1) return false;
  }
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((entry) => typeof entry === "string" && entry.trim().length > 0)) return false;
  }
  if (raw.priority !== undefined && raw.priority !== null) {
    if (typeof raw.priority !== "string" || !PRIORITY_SET.has(raw.priority)) return false;
  }
  if (raw.parentId !== undefined && raw.parentId !== null) {
    if (typeof raw.parentId !== "string" || raw.parentId.trim().length < 1) return false;
  }
  if (raw.isBlocked !== undefined && raw.isBlocked !== null && typeof raw.isBlocked !== "boolean") return false;
  if (raw.isCritical !== undefined && raw.isCritical !== null && typeof raw.isCritical !== "boolean") return false;

  return true;
}

export class RecordStore {
  private readonly listeners = new Set<Listener>();
  private records: LifeRecord[];

  constructor(private readonly key: string, initial: LifeRecord[]) {
    this.records = this.read(initial);
  }

  all(): readonly LifeRecord[] { return this.records.map(cloneRecord); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.all());
    return () => this.listeners.delete(listener);
  }

  upsert(record: LifeRecord): void {
    const at = this.records.findIndex((item) => item.id === record.id);
    if (at >= 0) {
      if (recordsEqual(this.records[at], record)) return;
      this.records[at] = cloneRecord(record);
    } else {
      this.records.push(cloneRecord(record));
    }
    this.commit();
  }

  remove(id: string): void {
    if (!this.records.some((item) => item.id === id)) return;
    this.records = this.records.filter((item) => item.id !== id);
    this.commit();
  }

  removeMany(ids: string[]): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const next = this.records.filter((item) => !idSet.has(item.id));
    if (next.length === this.records.length) return;
    this.records = next;
    this.commit();
  }

  replace(records: LifeRecord[]): void {
    const next = records.map(cloneRecord);
    if (next.length === this.records.length && next.every((item, index) => recordsEqual(item, this.records[index]))) {
      return;
    }
    this.records = next;
    this.commit();
  }

  updateMany(ids: string[], updates: Partial<Pick<LifeRecord, "status" | "priority">>): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    const hasStatus = updates.status !== undefined;
    const hasPriority = updates.priority !== undefined;
    const validStatus = hasStatus && STATUS_SET.has(updates.status as string) ? updates.status : undefined;
    const validPriority = hasPriority && PRIORITY_SET.has(updates.priority as string) ? updates.priority : undefined;

    let changed = false;
    this.records = this.records.map((item) => {
      if (!idSet.has(item.id)) return item;
      const patch: Partial<Pick<LifeRecord, "status" | "priority">> = {};
      let recordChanged = false;
      if (hasStatus && validStatus !== undefined && item.status !== validStatus) {
        patch.status = validStatus;
        recordChanged = true;
      }
      if (hasPriority && validPriority !== undefined && item.priority !== validPriority) {
        patch.priority = validPriority;
        recordChanged = true;
      }
      if (!recordChanged) return item;
      changed = true;
      return { ...cloneRecord(item), ...patch, updatedAt: new Date().toISOString() };
    });
    if (!changed) return;
    this.commit();
  }

  clear(): void {
    if (!this.records.length) return;
    this.records = [];
    this.commit();
  }

  private read(fallback: LifeRecord[]): LifeRecord[] {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      raw = null;
    }
    if (raw === null) return fallback.map(cloneRecord);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }
    const envelope = parsed as { version?: unknown; records?: unknown };
    if (envelope.version !== 1 || !Array.isArray(envelope.records)) {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }

    const stored = envelope.records;
    if (!stored.every(isStoredRecord) || !hasValidReferences(stored as LifeRecord[])) {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }

    try {
      return (stored as LifeRecord[]).map((record) => cloneRecord(record));
    } catch {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }
  }

  private commit(): void {
    const envelope: StoreEnvelope = { version: 1, records: this.records.map(cloneRecord), savedAt: new Date().toISOString() };
    try {
      localStorage.setItem(this.key, JSON.stringify(envelope));
    } catch {
      // Keep the in-memory state usable when persistence is unavailable.
    }
    for (const listener of this.listeners) listener(this.all());
  }
}
