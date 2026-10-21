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
    dependsOn: Array.isArray(item.dependsOn) ? [...item.dependsOn] : item.dependsOn,
  };
}

function isStoredRecord(value: unknown): value is LifeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;

  if (typeof raw.id !== "string" || raw.id.length < 1) return false;
  if (typeof raw.title !== "string" || raw.title.trim().length < 1) return false;
  if (typeof raw.category !== "string" || raw.category.trim().length < 1) return false;
  if (!isCalendarDay(raw.dueDate)) return false;
  if (typeof raw.effort !== "number" || !Number.isFinite(raw.effort) || raw.effort < 1 || raw.effort > 480) return false;
  if (typeof raw.impact !== "number" || !Number.isInteger(raw.impact) || raw.impact < 1 || raw.impact > 5) return false;
  if (typeof raw.status !== "string" || !STATUS_SET.has(raw.status)) return false;
  if (typeof raw.notes !== "string") return false;
  if (typeof raw.createdAt !== "string" || !isTimestamp(raw.createdAt)) return false;
  if (typeof raw.updatedAt !== "string" || !isTimestamp(raw.updatedAt)) return false;

  if (raw.dependsOn !== undefined && raw.dependsOn !== null) {
    if (typeof raw.dependsOn === "string") {
      if (raw.dependsOn.length < 1) return false;
    } else if (Array.isArray(raw.dependsOn)) {
      if (!raw.dependsOn.every((entry) => typeof entry === "string")) return false;
    } else {
      return false;
    }
  }

  if (raw.project !== undefined && raw.project !== null && typeof raw.project !== "string") return false;
  if (raw.tags !== undefined && raw.tags !== null) {
    if (!Array.isArray(raw.tags) || !raw.tags.every((entry) => typeof entry === "string")) return false;
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
    if (at >= 0) this.records[at] = cloneRecord(record);
    else this.records.push(cloneRecord(record));
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
    this.records = records.map(cloneRecord);
    this.commit();
  }

  updateMany(ids: string[], updates: Partial<Pick<LifeRecord, "status" | "priority">>): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    let changed = false;
    this.records = this.records.map((item) => {
      if (!idSet.has(item.id)) return item;
      changed = true;
      const patch: Partial<Pick<LifeRecord, "status" | "priority">> = {};
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.priority !== undefined) patch.priority = updates.priority;
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
      return fallback.map(cloneRecord);
    }
    const envelope = parsed as { version?: unknown; records?: unknown };
    if (envelope.version !== 1 || !Array.isArray(envelope.records)) {
      return fallback.map(cloneRecord);
    }

    if (!envelope.records.every(isStoredRecord)) {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
      return fallback.map(cloneRecord);
    }

    try {
      return envelope.records.map((record) => cloneRecord(record));
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
