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
  if (normalized === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return formatIsoDate(tomorrow);
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
    const currentDay = now.getDay();
    let diff = targetDay - currentDay;
    if (diff <= 0) diff += 7;
    result.setDate(now.getDate() + diff);
    return formatIsoDate(result);
  }
  
  return null;
}