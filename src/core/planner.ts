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
 * Calculates the 'ripple effect': a combined score of the effort and impact
 * of all tasks that are currently blocked by this item (directly or indirectly).
 */
function calculateRippleEffect(item: LifeRecord, allItems: readonly LifeRecord[]): number {
  let rippleValue = 0;
  const blocked = allItems.filter(i => i.status !== "done" && i.dependsOn === item.id);
  
  for (const b of blocked) {
    // Contribution: effort (normalized) + weighted impact
    rippleValue += (b.effort / 10) + (b.impact * 5);
    rippleValue += calculateRippleEffect(b, allItems);
  }
  return rippleValue;
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
  
  // Time-weighted impact: impact is more potent as the deadline approaches
  const impactMultiplier = daysUntilDue <= 0 ? 15 : 12;
  let score = item.impact * impactMultiplier;

  if (item.isCritical) {
    const criticalBonus = 80 + (item.impact * 10);
    score += criticalBonus;
    reasons.push("critical priority");
  }

  if (daysUntilDue < 0) {
    const overdueDays = Math.abs(daysUntilDue);
    let overdueWeight = 55 + Math.min(overdueDays, 14) * 3 + Math.max(0, overdueDays - 14) * 8;
    
    if (overdueDays > 30) {
      const decay = Math.min(overdueDays - 30, 60) * 2;
      overdueWeight -= decay;
      if (decay > 10) reasons.push("overdue urgency decayed");
    }

    if (item.isCritical) {
      overdueWeight *= 1.5;
    }
    
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
  } else if (daysUntilDue <= 21) {
    const prepBonus = Math.max(0, (21 - daysUntilDue) * (item.impact / 2));
    score += prepBonus;
    if (prepBonus > 5) reasons.push("proactive preparation window");

    if (item.impact >= 4 && daysUntilDue <= 14) {
      const bufferBonus = (14 - daysUntilDue) * 2;
      score += bufferBonus;
      if (bufferBonus > 5) reasons.push("high-impact urgency buffer");
    }
  }

  if (!item.isCritical) {
    const effortPenalty = Math.log2(item.effort + 1) * 4;
    score -= effortPenalty;
    if (item.effort < 20 && item.impact >= 4) {
      const quickWinMultiplier = 1.2;
      score *= quickWinMultiplier;
      reasons.push("high-impact quick win multiplier");
    }
  }

  if (item.status === "active") {
    score += 8;
    reasons.push("already in progress");

    const lastUpdate = new Date(item.updatedAt);
    const lastUpdateDay = lastUpdate.toISOString().slice(0, 10);
    const stagnationDays = daysBetween(lastUpdateDay, today);
    if (stagnationDays > 7) {
      const penalty = Math.min(stagnationDays * 2, 40);
      score -= penalty;
      reasons.push(`stagnant: no update for ${stagnationDays} days`);
    }
  }

  if (item.dependsOn) {
    const depth = getDependencyDepth(item, allItems);
    if (depth > 0) {
      // Nuanced Complexity Penalty: deeper chains are exponentially harder to clear
      const penalty = Math.min(depth * 20 + Math.pow(depth, 2) * 5, 200);
      score -= penalty;
      const dependency = allItems.find(i => i.id === item.dependsOn);
      if (depth >= 99) {
        reasons.push("blocked by circular dependency");
      } else {
        reasons.push(`blocked: needs "${dependency?.title || "unknown"}" ${depth > 1 ? `(chain of ${depth})` : ""}`);
      }
    } else {
      score += 2;
    }
  } else {
    score += 5;
    reasons.push("independent task");
  }

  if (item.project) {
    const activeProjects = new Set(allItems.filter(i => i.status !== "done" && i.project).map(i => i.project!));
    if (activeProjects.size > 3) {
      const diversityPenalty = (activeProjects.size - 3) * 3;
      score -= diversityPenalty;
      reasons.push(`project overhead: ${activeProjects.size} active projects`);
    }
  }

  const similarTasks = allItems.filter(i => 
    i.id !== item.id && 
    i.status !== "done" && 
    (i.category === item.category || (item.project && i.project === item.project))
  );
  if (similarTasks.length > 0) {
    let batchBonus = Math.min(similarTasks.length * 2, 15);
    const clusterTasks = similarTasks.filter(i => 
      i.category === item.category && item.project && i.project === item.project
    );
    if (clusterTasks.length > 0) {
      batchBonus += Math.min(clusterTasks.length * 3, 15);
      if (batchBonus >= 20) reasons.push("strong project cluster bonus");
    }

    score += batchBonus;
    if (batchBonus >= 10 && batchBonus < 20) reasons.push("batching efficiency bonus");
  }

  // Synergy Bonus: High cohesion when same project and category
  if (item.project) {
    const synergyTasks = allItems.filter(i => 
      i.id !== item.id && 
      i.status !== "done" && 
      i.project === item.project && 
      i.category === item.category
    );
    if (synergyTasks.length > 0) {
      const synergyBonus = Math.min(synergyTasks.length * 4, 20);
      score += synergyBonus;
      if (synergyBonus >= 12) reasons.push("project-category synergy");
    }
  }

  // Category Saturation Penalty: Avoid too many tasks of one type to prevent burnout
  const categoryCount = allItems.filter(i => i.category === item.category && i.status !== "done").length;
  if (categoryCount > 8) {
    const saturationPenalty = Math.min((categoryCount - 8) * 2, 15);
    score -= saturationPenalty;
    if (saturationPenalty >= 5) reasons.push("category saturation penalty");
  }

  const recentlyCompletedInCategory = allItems.filter(i => 
    i.category === item.category && 
    i.status === "done" && 
    daysBetween(i.updatedAt.slice(0, 10), today) <= 3
  ).length;
  if (recentlyCompletedInCategory > 0) {
    const momentumBonus = Math.min(recentlyCompletedInCategory * 5, 20);
    score += momentumBonus;
    reasons.push(`category momentum: ${recentlyCompletedInCategory} recent wins`);
  }

  const efficiencyRatio = item.impact / item.effort;
  if (efficiencyRatio > 0.2) {
    const efficiencyBonus = Math.min(efficiencyRatio * 50, 25);
    score += efficiencyBonus;
    reasons.push("high efficiency ratio");
  }

  const blockedCount = countBlockedTasks(item, allItems);
  if (blockedCount > 0) {
    const bottleneckBonus = blockedCount * 15;
    score += bottleneckBonus;
    reasons.push(`bottleneck: blocks ${blockedCount} task(s)`);

    if (item.status === "planned") {
      const riskBonus = Math.min(blockedCount * 10, 50);
      score += riskBonus;
      reasons.push(`high risk: stalled bottleneck`);
    }

    if (daysUntilDue < 0) {
      const overdueBlockerBonus = Math.min(blockedCount * 20, 80);
      score += overdueBlockerBonus;
      reasons.push("critical: overdue blocker");
    }

    const blocksCritical = allItems.some(i => i.status !== "done" && i.dependsOn === item.id && i.isCritical);
    if (blocksCritical) {
      score += 40;
      reasons.push("blocks critical path");
    }

    if (blockedCount >= 3) {
      const chainBonus = Math.min(blockedCount * 5, 30);
      score += chainBonus;
      reasons.push("dependency chain resolver");
    }
  }

  const ripple = calculateRippleEffect(item, allItems);
  if (ripple > 0) {
    const bonus = Math.min(ripple, 60);
    score += bonus;
    reasons.push(`high leverage: unblocks critical chain`);
  }

  // Dead-End Penalty: Penalize tasks that are not urgent and don't unblock anything
  if (daysUntilDue > 7 && blockedCount === 0 && !item.isCritical) {
    const deadEndPenalty = 15;
    score -= deadEndPenalty;
    reasons.push("low priority dead-end task");
  }

  // Focus Fragmentation Penalty: If this task belongs to a category that is vastly
  // different from the bulk of current urgent work, apply a small penalty to encourage
  // focusing on a few categories at once.
  const urgentCategories = new Set(allItems.filter(i => i.status !== "done" && daysBetween(today, i.dueDate) <= 3).map(i => i.category));
  if (urgentCategories.size > 0 && !urgentCategories.has(item.category)) {
    const fragmentationPenalty = 5;
    score -= fragmentationPenalty;
    reasons.push("focus fragmentation penalty");
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
    summary.completed += item.status === "done" ? 1 : 0;
    if (item.status !== "done") {
      summary.effort += item.effort;
      const days = daysBetween(today, item.dueDate);
      summary.overdue += days < 0 ? 1 : 0;
      summary.dueSoon += days >= 0 && days <= 7 ? 1 : 0;
      if (item.isCritical) summary.criticalRemaining += 1;
    }
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

  const sortedEntries = buildPlan(items, today);

  for (const entry of sortedEntries) {
    const maxDayOffset = Math.max(0, Math.min(6, entry.daysUntilDue));
    
    const candidates = days
      .slice(0, maxDayOffset + 1)
      .sort((a, b) => a.used - b.used);

    const target = candidates[0];
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
