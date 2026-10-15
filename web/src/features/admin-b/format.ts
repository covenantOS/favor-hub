// Times and numbers the Admin pages show, Eastern time, the same words as public/js/admin.js (A.when, A.full, A.ago).
const ET = { timeZone: 'America/New_York' } as const;
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', ET).format(d);

export const num = (n: unknown) => Number(n || 0).toLocaleString('en-US');

export function when(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return 'No run on record';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No run on record';
  const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...ET }).format(d) + ' ET';
  const today = dayKey(new Date(now));
  const that = dayKey(d);
  const yest = dayKey(new Date(now - 864e5));
  if (that === today) return 'Today ' + t;
  if (that === yest) return 'Yesterday ' + t;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...ET }).format(d) + ', ' + t;
}

export function full(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...ET }).format(d) + ' ET';
}

export function ago(iso?: string | null, now: number = Date.now()): string {
  const d = new Date(iso || '');
  if (!iso || isNaN(d.getTime())) return '';
  const m = Math.max(0, Math.round((now - d.getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + ' h ago';
  return Math.round(h / 24) + ' days ago';
}

/** "Oct 15" for a saved-on line. */
export const shortDay = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...ET }).format(new Date(iso));

/** Today's date in Eastern time as YYYY-MM-DD. */
export const todayET = () => dayKey(new Date());

export const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
