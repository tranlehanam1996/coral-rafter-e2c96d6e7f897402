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

/**
 * Dependency Heat: Sums the impact of all direct and indirect descendants.
 * used to boost root tasks that unlock high-value chains.
 */
function calculateDependencyHeat(item: LifeRecord, allItems: readonly LifeRecord[]): number {
  let heat = 0;
  const blocked = allItems.filter(i => i.status !== "done" && i.dependsOn === item.id);
  for (const b of blocked) {
    heat += b.impact + calculateDependencyHeat(b, allItems);
  }
  return heat;
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

    // Overdue Stagnation: Weight the penalty more heavily if it's not been touched
    const lastUpdate = new Date(item.updatedAt);
    const lastUpdateDay = lastUpdate.toISOString().slice(0, 10);
    const stagnationDays = daysBetween(lastUpdateDay, today);
    if (stagnationDays > 3) {
      const stagnationBonus = Math.min(stagnationDays * 4, 30);
      overdueWeight += stagnationBonus;
      if (stagnationBonus > 10) reasons.push(`overdue stagnation: ${stagnationDays}d since update`);
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
  } else {
    // Planning Horizon Penalty: Strongly discourage tasks due in > 21 days from appearing in current plan
    // unless they are critical or provide significant leverage (bottlenecks).
    const horizonImpactReduction = item.impact >= 4 ? 0.5 : 1;
    const horizonPenalty = Math.min((daysUntilDue - 21) * 2 * horizonImpactReduction, 50);
    score -= horizonPenalty;
    if (horizonPenalty > 10) reasons.push(`horizon penalty: due in ${daysUntilDue}d`);
  }

  // Strategic Buffer: For high-impact tasks due far in the future, a small boost 
  // encourages completing them early to clear the deck for the final rush.
  if (daysUntilDue > 14 && item.impact >= 4) {
    const strategicBonus = 10;
    score += strategicBonus;
    reasons.push("strategic early-completion buffer");
  }

  // Stagnation Risk: Even if not overdue, a task that hasn't been updated in 14+ days 
  // may be a forgotten risk. Boost its priority to encourage review.
  const lastUpdate = new Date(item.updatedAt);
  const lastUpdateDay = lastUpdate.toISOString().slice(0, 10);
  const stagnationDays = daysBetween(lastUpdateDay, today);
  if (stagnationDays > 14 && daysUntilDue >= 0) {
    const stagnationRiskBoost = Math.min((stagnationDays - 14) * 2, 20);
    score += stagnationRiskBoost;
    if (stagnationRiskBoost > 5) reasons.push(`stagnation risk: ${stagnationDays}d since update`);
  }

  // Fresh Start Bonus: Boost tasks updated today to keep momentum on current active thoughts
  if (stagnationDays === 0) {
    const momentumBonus = 12;
    score += momentumBonus;
    reasons.push("fresh start momentum");
  }

  if (!item.isCritical) {
    // Risk-Adjusted Effort Penalty: High effort tasks are more likely to be postponed
    // the penalty grows non-linearly with effort.
    const effortPenalty = Math.log2(item.effort + 1) * 4 + (item.effort > 120 ? (item.effort - 120) / 10 : 0);
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

    const lastUpdateActive = new Date(item.updatedAt);
    const lastUpdateActiveDay = lastUpdateActive.toISOString().slice(0, 10);
    const activeStagnationDays = daysBetween(lastUpdateActiveDay, today);
    if (activeStagnationDays > 7) {
      const penalty = Math.min(activeStagnationDays * 2, 40);
      score -= penalty;
      reasons.push(`stagnant: no update for ${activeStagnationDays} days`);
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

    // Project Momentum: Bonus if several tasks in the same project were completed recently
    const projectWins = allItems.filter(i => 
      i.project === item.project && 
      i.status === "done" && 
      daysBetween(i.updatedAt.slice(0, 10), today) <= 3
    ).length;
    if (projectWins > 0) {
      const momentumBonus = Math.min(projectWins * 6, 25);
      score += momentumBonus;
      if (momentumBonus >= 12) reasons.push(`project momentum: ${projectWins} recent wins`);
    }

    // Project Completion Bonus: Encourage finishing the last few tasks of a project
    const projectRemaining = allItems.filter(i => i.project === item.project && i.status !== "done").length;
    if (projectRemaining <= 2) {
      const completionBonus = (3 - projectRemaining) * 10;
      score += completionBonus;
      reasons.push(`project finale: ${projectRemaining} remaining`);
    }

    // Project Completion Rate Momentum: Boost projects that are significantly underway
    const projectTasks = allItems.filter(i => i.project === item.project);
    if (projectTasks.length > 5) {
      const projectDone = projectTasks.filter(i => i.status === "done").length;
      const completionRate = projectDone / projectTasks.length;
      if (completionRate >= 0.5 && completionRate < 1) {
        const momentumBoost = Math.min(completionRate * 20, 20);
        score += momentumBoost;
        if (momentumBoost >= 10) reasons.push(`project momentum: ${Math.round(completionRate * 100)}% complete`);
      }
    }

    // Stale Project Penalty: If no task in this project has been updated in 14 days,
    // it suggests a dormant project. Penalty increases up to 30 days.
    if (projectTasks.length > 0) {
      const latestUpdate = projectTasks.reduce((latest, task) => {
        return task.updatedAt > latest ? task.updatedAt : latest;
      }, "0000-00-00");
      const projectStagnation = daysBetween(latestUpdate.slice(0, 10), today);
      if (projectStagnation > 14) {
        const stalePenalty = Math.min((projectStagnation - 14) * 2, 40);
        score -= stalePenalty;
        if (stalePenalty > 10) reasons.push(`stale project: no activity in ${projectStagnation}d`);
      }
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

  // Burn-out Prevention: Penalty if too many tasks of the same category are due in the same week
  const categoryWeekCount = allItems.filter(i => 
    i.id !== item.id &&
    i.status !== "done" &&
    i.category === item.category && 
    Math.abs(daysBetween(item.dueDate, i.dueDate)) <= 7
  ).length;
  if (categoryWeekCount >= 4) {
    const burnoutPenalty = Math.min(categoryWeekCount * 4, 30);
    score -= burnoutPenalty;
    if (burnoutPenalty >= 15) reasons.push(`burn-out prevention: too many ${item.category} tasks this week`);
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

    // Effort-Impact Synergy: If this high-efficiency task is part of a project, 
    // increase the bonus to encourage focused high-impact bursts within a project.
    if (item.project) {
      const projectEfficiencyBonus = Math.min(efficiencyRatio * 20, 15);
      score += projectEfficiencyBonus;
      if (projectEfficiencyBonus > 5) reasons.push("project efficiency synergy");
    }

    // LEHI (Low-Effort High-Impact) Acceleration: 
    // Strong bonus for tasks that are both very low effort (< 15m) and high impact (>= 4).
    if (item.effort < 15 && item.impact >= 4) {
      const lehiBonus = 25;
      score += lehiBonus;
      reasons.push("LEHI acceleration bonus");
    }
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

    // Critical Path Leverage: If a task is both critical and a bottleneck, it is a high-stakes root.
    if (item.isCritical) {
      const leverageBoost = Math.min(blockedCount * 25, 100);
      score += leverageBoost;
      if (leverageBoost > 20) reasons.push("critical path leverage");
      
      // Critical Root: Specifically boost tasks that are critical AND block others
      // as they are the primary inhibitors of the critical path.
      const rootBonus = 30;
      score += rootBonus;
      reasons.push("critical root bottleneck");
    }

    // Critical Chain Bottleneck: Root tasks that block multiple critical items get a massive boost
    const criticalBlockedCount = allItems.filter(i => i.status !== "done" && i.dependsOn === item.id && i.isCritical).length;
    if (criticalBlockedCount >= 2) {
      const criticalChainBoost = criticalBlockedCount * 30;
      score += criticalChainBoost;
      reasons.push(`critical chain bottleneck: blocks ${criticalBlockedCount} critical tasks`);
    }
  }

  const ripple = calculateRippleEffect(item, allItems);
  if (ripple > 0) {
    const bonus = Math.min(ripple, 60);
    score += bonus;
    reasons.push(`high leverage: unblocks critical chain`);
  }

  // Deep Blocker Bonus: High priority if this item is the root of a long dependency chain
  // regardless of its own urgency, to avoid late-stage discovery of roadblocks.
  const downstreamDepth = (id: string, currentDepth = 0): number => {
    const children = allItems.filter(i => i.status !== "done" && i.dependsOn === id);
    if (children.length === 0) return currentDepth;
    return Math.max(...children.map(c => downstreamDepth(c.id, currentDepth + 1)));
  };
  const maxDepth = downstreamDepth(item.id);
  if (maxDepth >= 3) {
    const deepBlockerBonus = maxDepth * 12;
    score += deepBlockerBonus;
    reasons.push(`deep blocker: root of ${maxDepth}-level chain`);
  }

  // Dependency Friction: Penalize tasks that are part of an excessively long chain
  // to encourage breaking them into smaller, independent pieces.
  if (maxDepth >= 5) {
    const frictionPenalty = (maxDepth - 4) * 10;
    score -= frictionPenalty;
    reasons.push(`dependency friction: chain too long (${maxDepth})`);
  }

  // Dependency-Chain Risk: Boost priority if the item is the root of a chain where
  // downstream items have high aggregate impact, increasing the risk of a late-stage bottleneck.
  if (!item.dependsOn && maxDepth >= 2) {
    const chainImpact = allItems.filter(i => i.status !== "done" && i.dependsOn === item.id).reduce((sum, i) => sum + i.impact, 0);
    const riskBoost = Math.min(chainImpact * 8, 40);
    score += riskBoost;
    if (riskBoost > 15) reasons.push("dependency-chain risk boost");
  }

  // Dependency Heat: Root tasks with high cumulative descendant impact get a boost
  const heat = calculateDependencyHeat(item, allItems);
  if (heat > 10) {
    const heatBonus = Math.min(heat * 3, 45);
    score += heatBonus;
    if (heatBonus > 15) reasons.push(`dependency heat: unlocks ${heat} total impact`);
  }

  // Preparation Sprint: Boost priority if multiple tasks in the same project and category
  // are due in the same 7-day window, encouraging focused bursts of work.
  if (item.project) {
    const sprintTasks = allItems.filter(i => 
      i.id !== item.id && 
      i.status !== "done" && 
      i.project === item.project && 
      i.category === item.category && 
      Math.abs(daysBetween(item.dueDate, i.dueDate)) <= 7
    );
    if (sprintTasks.length >= 2) {
      const sprintBonus = Math.min(sprintTasks.length * 8, 30);
      score += sprintBonus;
      reasons.push(`preparation sprint: ${sprintTasks.length + 1} related tasks`);
    }
  }

  // Dead-End Penalty: Penalize tasks that are not urgent and don't unblock anything
  // Refined: High-impact tasks (>= 4) are less penalized to avoid burying important but non-urgent work.
  if (daysUntilDue > 7 && blockedCount === 0 && !item.isCritical) {
    const deadEndPenalty = item.impact >= 4 ? 5 : 15;
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

  // Context Switch Penalty: If we have many high-priority tasks across many categories,
  // penalize tasks that don't align with the most urgent category to encourage clustering.
  if (urgentCategories.size > 2) {
    const mostUrgentCat = allItems
      .filter(i => i.status !== "done" && daysBetween(today, i.dueDate) <= 3)
      .reduce((acc, curr) => {
        acc.counts[curr.category] = (acc.counts[curr.category] || 0) + 1;
        const top = Object.entries(acc.counts).sort((a,b) => b[1]-a[1])[0];
        return { counts: acc.counts, topCat: top ? top[0] : null };
      }, { counts: {} as Record<string, number>, topCat: null as string | null });

    if (mostUrgentCat.topCat && item.category !== mostUrgentCat.topCat) {
      const switchPenalty = 7;
      score -= switchPenalty;
      reasons.push("context switch penalty");
    }
  }

  // Burn-down Urgency Boost: Final countdown (0-2 days) gets a non-linear boost
  // to ensure the last few tasks are prioritized before the trip starts.
  if (daysUntilDue >= 0 && daysUntilDue <= 2) {
    const burnDownBoost = (2 - daysUntilDue) * 15 + 10;
    score += burnDownBoost;
    reasons.push("final burn-down boost");
  }

  // Multi-Category Focus: Boost tasks in categories that are currently under-represented
  // in the active plan, but only when the trip is imminent (<= 7 days).
  if (daysUntilDue <= 7 && daysUntilDue >= 0) {
    const activeCats = new Set(allItems.filter(i => i.status !== "done" && daysBetween(today, i.dueDate) <= 7).map(i => i.category));
    const catCounts = allItems.filter(i => i.status !== "done" && daysBetween(today, i.dueDate) <= 7).reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const minCatCount = Math.min(...Object.values(catCounts));
    if (catCounts[item.category] === minCatCount && activeCats.size > 1) {
      const focusBonus = 15;
      score += focusBonus;
      reasons.push("multi-category focus bonus");
    }
  }

  // Last-Mile Pressure: Massive boost for high-impact tasks due in the final 48 hours
  // to prevent 'last-minute panic' by forcing them to the top.
  if (daysUntilDue >= 0 && daysUntilDue <= 2 && item.impact >= 4) {
    const lastMileBoost = (2 - daysUntilDue) * 30 + 40;
    score += lastMileBoost;
    reasons.push("last-mile pressure boost");
  }

  // Blocked Chain Depth Penalty: Penalize tasks that are far down a dependency chain
  // to prevent them from surfacing before their predecessors are clearly priority.
  if (item.dependsOn) {
    const chainDepth = getDependencyDepth(item, allItems);
    if (chainDepth > 2) {
      const depthPenalty = (chainDepth - 2) * 15;
      score -= depthPenalty;
      reasons.push(`deeply blocked: chain depth ${chainDepth}`);
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
