// Eastern-time words for the Admin pages: the same text public/js/admin.js (A.when, A.day, A.full, A.ago) wrote.
const ET = { timeZone: 'America/New_York' } as const;
const key = (d: Date) => new Intl.DateTimeFormat('en-CA', ET).format(d);
const valid = (iso?: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

export const NO_RUN = 'No run on record';

/** "Today 6:20 AM ET", "Yesterday 6:20 AM ET" or "Oct 9, 6:20 AM ET". */
export function when(iso?: string | null): string {
  const d = valid(iso);
  if (!d) return NO_RUN;
  const t = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...ET }).format(d) + ' ET';
  const that = key(d);
  if (that === key(new Date())) return 'Today ' + t;
  if (that === key(new Date(Date.now() - 864e5))) return 'Yesterday ' + t;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...ET }).format(d) + ', ' + t;
}

/** "Today", "Yesterday" or "Oct 9". */
export function day(iso?: string | null): string {
  const d = valid(iso);
  if (!d) return NO_RUN;
  const that = key(d);
  if (that === key(new Date())) return 'Today';
  if (that === key(new Date(Date.now() - 864e5))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...ET }).format(d);
}

/** "Oct 9, 2026, 6:20 AM ET". */
export function full(iso?: string | null): string {
  if (!iso) return '';
  const d = valid(iso);
  if (!d) return String(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...ET }).format(d) + ' ET';
}

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
export function ago(iso?: string | null): string {
  const d = valid(iso);
  if (!d) return '';
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (m < 2) return 'just now';
  if (m < 90) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + ' h ago';
  return Math.round(h / 24) + ' days ago';
}

export const num = (n: unknown) => Number(n || 0).toLocaleString('en-US');

/** "Oct 9" for a day written as yyyy-mm-dd, read as a calendar date and not shifted by a time zone. */
export const calDay = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
