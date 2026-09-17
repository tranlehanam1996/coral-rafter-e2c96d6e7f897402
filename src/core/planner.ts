import type { LifeRecord, PlanEntry, PlanSummary, ThemeConfig } from "../types";

const DAY_MS = 86_400_000;

export function localDay(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Number.POSITIVE_INFINITY;
  return Math.round((end - start) / DAY_MS);
}

export function validateRecord(input: Partial<LifeRecord>, theme: ThemeConfig): string[] {
  const errors: string[] = [];
  if (!input.title?.trim()) errors.push(`${theme.itemLabel} needs a title.`);
  if (!input.category || !theme.categories.includes(input.category)) errors.push("Choose a valid category.");
  if (!input.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) errors.push("Choose a valid date.");
  if (!Number.isFinite(input.effort) || Number(input.effort) < 1 || Number(input.effort) > 480) {
    errors.push(`${theme.effortLabel} must be between 1 and 480.`);
  }
  if (!Number.isInteger(input.impact) || Number(input.impact) < 1 || Number(input.impact) > 5) {
    errors.push(`${theme.impactLabel} must be an integer from 1 to 5.`);
  }
  return errors;
}

function getDependencyDepth(item: LifeRecord, allItems: readonly LifeRecord[], visited = new Set<string>()): number {
  if (!item.dependsOn) return 0;
  if (visited.has(item.id)) return 99; // Cycle detected: return high penalty depth
  
  visited.add(item.id);
  const parent = allItems.find(i => i.id === item.dependsOn);
  if (!parent || parent.status === "done") return 0;
  return 1 + getDependencyDepth(parent, allItems, visited);
}

export function hasCircularDependency(item: LifeRecord, allItems: readonly LifeRecord[]): boolean {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function check(id: string): boolean {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;

    visited.add(id);
    stack.add(id);

    const current = allItems.find(i => i.id === id);
    if (current?.dependsOn && check(current.dependsOn)) return true;

    stack.delete(id);
    return false;
  }

  return check(item.id);
}

export function priorityFor(item: LifeRecord, today = localDay(), allItems: readonly LifeRecord[] = []): PlanEntry {
  const daysUntilDue = daysBetween(today, item.dueDate);
  const reasons: string[] = [];
  let score = item.impact * 12;

  if (item.isCritical) {
    score += 100;
    reasons.push("critical priority");
  }

  if (daysUntilDue < 0) {
    score += 55 + Math.min(Math.abs(daysUntilDue), 14) * 3;
    reasons.push(`${Math.abs(daysUntilDue)} day(s) overdue`);
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 7) {
    score += 36 - daysUntilDue * 4;
    reasons.push(`due in ${daysUntilDue} day(s)`);
  }

  // Non-linear effort penalty: larger tasks are penalized more heavily unless critical
  // This helps surface "quick wins" (high impact, low effort)
  if (!item.isCritical) {
    const effortPenalty = Math.log2(item.effort + 1) * 5;
    score -= effortPenalty;
    if (item.effort < 30 && item.impact >= 4) {
      reasons.push("high-impact quick win");
    }
  }

  if (item.status === "active") {
    score += 8;
    reasons.push("already in progress");
  }

  if (item.dependsOn) {
    const depth = getDependencyDepth(item, allItems);
    if (depth > 0) {
      const penalty = Math.min(depth * 15, 150);
      score -= penalty;
      const dependency = allItems.find(i => i.id === item.dependsOn);
      if (depth >= 99) {
        reasons.push("blocked by circular dependency");
      } else {
        reasons.push(depth > 1 
          ? `blocked by chain of ${depth} tasks` 
          : `blocked by "${dependency?.title || "unknown"}"`
        );
      }
    }
  }

  if (item.status === "done") score = -1;
  if (reasons.length === 0) reasons.push("ranked by impact and effort");
  return { item, score: Math.round(score * 10) / 10, reasons, daysUntilDue };
}

export function buildPlan(items: readonly LifeRecord[], today = localDay()): PlanEntry[] {
  return items
    .map((item) => priorityFor(item, today, items))
    .filter((entry) => entry.item.status !== "done")
    .sort((a, b) => b.score - a.score || a.item.dueDate.localeCompare(b.item.dueDate));
}

export function summarize(items: readonly LifeRecord[], today = localDay()): PlanSummary {
  return items.reduce<PlanSummary>((summary, item) => {
    summary.total += 1;
    summary.effort += item.status === "done" ? 0 : item.effort;
    summary.completed += item.status === "done" ? 1 : 0;
    const days = daysBetween(today, item.dueDate);
    summary.overdue += item.status !== "done" && days < 0 ? 1 : 0;
    summary.dueSoon += item.status !== "done" && days >= 0 && days <= 7 ? 1 : 0;
    summary.byCategory[item.category] = (summary.byCategory[item.category] ?? 0) + 1;
    if (item.project) {
      summary.byProject[item.project] = (summary.byProject[item.project] ?? 0) + 1;
    }
    return summary;
  }, { total: 0, completed: 0, overdue: 0, dueSoon: 0, effort: 0, byCategory: {}, byProject: {} });
}

export function suggestDailyLoad(items: readonly LifeRecord[], minutesPerDay: number, today = localDay()) {
  const capacity = Math.max(1, minutesPerDay);
  const days = Array.from({ length: 7 }, (_, offset) => ({
    date: new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10),
    used: 0,
    entries: [] as PlanEntry[],
  }));
  for (const entry of buildPlan(items, today)) {
    const candidates = days.filter((day, index) => index <= Math.max(0, Math.min(6, entry.daysUntilDue)));
    const target = (candidates.length > 0 ? candidates : days).sort((a, b) => a.used - b.used)[0];
    if (!target) continue;
    target.entries.push(entry);
    target.used += entry.item.effort;
  }
  return days.map((day) => ({ ...day, overloaded: day.used > capacity }));
}

export function filterRecords(items: readonly LifeRecord[], query: string, category?: string): LifeRecord[] {
  const q = query.toLowerCase().trim();
  return items.filter((item) => {
    const matchesQuery = !q || 
      item.title.toLowerCase().includes(q) || 
      item.notes.toLowerCase().includes(q);
    const matchesCategory = !category || item.category === category;
    return matchesQuery && matchesCategory;
  });
}

export function categoryEffort(items: readonly LifeRecord[], category: string): number {
  return items
    .filter((item) => item.category === category && item.status !== "done")
    .reduce((sum, item) => sum + item.effort, 0);
}
