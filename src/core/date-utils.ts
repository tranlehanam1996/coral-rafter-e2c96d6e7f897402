export function daysBetween(start: string, end: string): number {
  const d1 = new Date(`${start}T00:00:00Z`);
  const d2 = new Date(`${end}T00:00:00Z`);
  return Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseRelativeDate(input: string): string | null {
  const now = new Date();
  const normalized = input.toLowerCase().trim();

  if (normalized === 'today') return formatIsoDate(now);
  if (normalized === 'yesterday') {
    const yesterday = new Date(now);
    yesterday.setUTCDate(now.getUTCDate() - 1);
    return formatIsoDate(yesterday);
  }
  if (normalized === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    return formatIsoDate(tomorrow);
  }

  const inDaysMatch = normalized.match(/^in\s+(\d+)\s+days?$/);
  if (inDaysMatch) {
    const amount = Number(inDaysMatch[1]);
    if (!Number.isFinite(amount)) return null;
    const result = new Date(now);
    result.setUTCDate(now.getUTCDate() + amount);
    return formatIsoDate(result);
  }

  const inWeeksMatch = normalized.match(/^in\s+(\d+)\s+weeks?$/);
  if (inWeeksMatch) {
    const amount = Number(inWeeksMatch[1]);
    if (!Number.isFinite(amount)) return null;
    const result = new Date(now);
    result.setUTCDate(now.getUTCDate() + amount * 7);
    return formatIsoDate(result);
  }

  const nextDayMatch = normalized.match(/^next\s+(\w+)$/);
  if (nextDayMatch) {
    const dayName = nextDayMatch[1];
    const days = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
    };
    const targetDay = days[dayName as keyof typeof days];
    if (targetDay === undefined) return null;

    const result = new Date(now);
    const currentDay = now.getUTCDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7;
    result.setUTCDate(now.getUTCDate() + diff);
    return formatIsoDate(result);
  }

  return null;
}

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
