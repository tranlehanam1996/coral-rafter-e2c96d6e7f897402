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

/**
 * Calculates the 'ripple effect': the total effort of all tasks 
 * that are currently blocked by this item (directly or indirectly).
 */
function calculateRippleEffect(item: LifeRecord, allItems: readonly LifeRecord[]): number {
  let rippleEffort = 0;
  const blocked = allItems.filter(i => i.status !== "done" && i.dependsOn === item.id);
  
  for (const b of blocked) {
    rippleEffort += b.effort + calculateRippleEffect(b, allItems);
  }
  return rippleEffort;
}

/**
 * Calculates how many unique tasks are blocked by this item.
 */
function countBlockedTasks(item: LifeRecord, allItems: readonly LifeRecord[]): number {
  const blockedIds = new Set<string>();
  function traverse(id: string) {
    allItems.filter(i => i.status !== "done" && i.dependsOn === id).forEach(b => {
      if (!blockedIds.has(b.id)) {
        blockedIds.add(b.id);
        traverse(b.id);
      }
    });
  }
  traverse(item.id);
  return blockedIds.size;
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
    const overdueDays = Math.abs(daysUntilDue);
    // Overdue weight: base + linear for first 14 days + accelerated for later
    const overdueWeight = 55 + Math.min(overdueDays, 14) * 3 + Math.max(0, overdueDays - 14) * 8;
    score += overdueWeight;
    reasons.push(`${overdueDays} day(s) overdue`);
  } else if (daysUntilDue === 0) {
    score += 45;
    reasons.push("due today");
  } else if (daysUntilDue <= 3) {
    score += 30 + (3 - daysUntilDue) * 5;
    reasons.push(`imminent: due in ${daysUntilDue} day(s)`);
  } else if (daysUntilDue <= 7) {
    score += 20 - daysUntilDue * 2;
    reasons.push(`due in ${daysUntilDue} day(s)`);
  }

  if (!item.isCritical) {
    const effortPenalty = Math.log2(item.effort + 1) * 4;
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
      const penalty = Math.min(depth * 20, 200);
      score -= penalty;
      const dependency = allItems.find(i => i.id === item.dependsOn);
      if (depth >= 99) {
        reasons.push("blocked by circular dependency");
      } else {
        reasons.push(`blocked: needs "${dependency?.title || "unknown"}" ${depth > 1 ? `(chain of ${depth})` : ""}`);
      }
    } else {
      // Item has a dependency but it's already done or missing
      score += 2;
    }
  } else {
    // Reward items with no dependencies at all to clear low-hanging fruit
    score += 5;
    reasons.push("independent task");
  }

  // Bottleneck Detection
  const blockedCount = countBlockedTasks(item, allItems);
  if (blockedCount > 0) {
    const bottleneckBonus = blockedCount * 15;
    score += bottleneckBonus;
    reasons.push(`bottleneck: blocks ${blockedCount} task(s)`);
  }

  // Ripple Effect Bonus: identify high-leverage tasks (based on effort)
  const ripple = calculateRippleEffect(item, allItems);
  if (ripple > 0) {
    const bonus = Math.min(ripple / 10, 40); // Cap bonus at 40 points
    score += bonus;
    reasons.push(`high leverage: unblocks ${ripple}m of work`);
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

export function summarize(items: readonly LifeRecord[], today = localDay(), dailyCapacityMinutes = 120): PlanSummary {
  const summary = items.reduce<PlanSummary>((summary, item) => {
    summary.total += 1;
    summary.effort += item.status === "done" ? 0 : item.effort;
    summary.completed += item.status === "done" ? 1 : 0;
    const days = daysBetween(today, item.dueDate);
    summary.overdue += item.status !== "done" && days < 0 ? 1 : 0;
    summary.dueSoon += item.status !== "done" && days >= 0 && days <= 7 ? 1 : 0;
    summary.criticalRemaining += (item.status !== "done" && item.isCritical) ? 1 : 0;
    summary.byCategory[item.category] = (summary.byCategory[item.category] ?? 0) + 1;
    if (item.project) {
      summary.byProject[item.project] = (summary.byProject[item.project] ?? 0) + 1;
    }
    return summary;
  }, { total: 0, completed: 0, overdue: 0, dueSoon: 0, criticalRemaining: 0, effort: 0, estimatedDays: 0, byCategory: {}, byProject: {} });

  summary.estimatedDays = Math.ceil(summary.effort / Math.max(1, dailyCapacityMinutes));
  return summary;
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
