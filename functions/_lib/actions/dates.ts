export function ymd(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : '';
}

function toUtc(s: string): number {
  const [y, m, d] = ymd(s).split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

/** Whole days from a to b (b minus a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

export function addDays(s: string, n: number): string {
  return new Date(toUtc(s) + n * 86400000).toISOString().slice(0, 10);
}
