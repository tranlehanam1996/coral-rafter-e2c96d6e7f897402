import type { LifeRecord, ItemStatus, PriorityLevel } from "../types";

interface StoreEnvelope { version: 1; records: LifeRecord[]; savedAt: string }
type Listener = (records: readonly LifeRecord[]) => void;

function cloneRecord(item: LifeRecord): LifeRecord {
  return {
    ...item,
    tags: item.tags ? [...item.tags] : undefined,
    dependsOn: Array.isArray(item.dependsOn) ? [...item.dependsOn] : item.dependsOn,
  };
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
      return { ...cloneRecord(item), ...updates, updatedAt: new Date().toISOString() };
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
    try {
      const parsed = JSON.parse(localStorage.getItem(this.key) ?? "null") as StoreEnvelope | null;
      if (parsed?.version === 1 && Array.isArray(parsed.records)) return parsed.records.map(cloneRecord);
    } catch {
      try { localStorage.removeItem(this.key); } catch { /* ignore */ }
    }
    return fallback.map(cloneRecord);
  }

  private commit(): void {
    const envelope: StoreEnvelope = { version: 1, records: this.records.map(cloneRecord), savedAt: new Date().toISOString() };
    localStorage.setItem(this.key, JSON.stringify(envelope));
    for (const listener of this.listeners) listener(this.all());
  }
}
