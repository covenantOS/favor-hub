// Number and time formatting, the same rules public/js/today.js used (Eastern time, whole dollars, K and M for big figures).
export const TZ = 'America/New_York';

const neg = (n: number) => (Number(n) < 0 ? '-' : '');

export const money0 = (n: number) => neg(Math.round(Number(n) || 0)) + '$' + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-US');

export const money2 = (n: number) =>
  neg(n) + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function compact(v: number): string {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  return a >= 1e9 ? s + '$' + (a / 1e9).toFixed(2) + 'B' : a >= 999500 ? s + '$' + (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? s + '$' + Math.round(a / 1e3) + 'K' : s + '$' + Math.round(a);
}

export const et = (iso: string | Date, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...opts });

export const clock = (iso: string) => et(iso, { hour: 'numeric', minute: '2-digit' });

export const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

export const todayEt = () => dayKey(new Date());

export function greeting(now = new Date()): string {
  const hour = Number(et(now, { hour: 'numeric', hour12: false })) % 24;
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

export const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  return h < 1 ? 'just now' : h < 24 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago';
};

export function initials(s: string): string {
  const w = String(s || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const pick = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return (
    pick
      .map((x) => Array.from(x)[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function hue(s: string): number {
  let n = 0;
  for (const c of String(s)) n = (n * 31 + c.charCodeAt(0)) % 8;
  return n;
}

export const phoneHref = (n: string) => 'tel:' + String(n).replace(/[^0-9+]/g, '');

/* ------------------------------------------------------------------ the one shared module for dates, money and names
   The classic pages define these again and again (the one-app audit counted 14 date formats). A route that moves to the app
   imports from here and drops its copy. */

/** "Oct 12" from a YYYY-MM-DD day. */
export const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

/** "Mon, Oct 12" from a YYYY-MM-DD day. */
export const dayLabel = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

/** "Oct 12, 2026" from an ISO time or day. */
export const dateLong = (iso: string) => {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: iso.length === 10 ? 'UTC' : TZ, month: 'short', day: 'numeric', year: 'numeric' });
};

/** A time as people say it: the clock today, "Tue 9:00 AM" on another day (Eastern). */
export const whenLabel = (iso: string) => {
  if (!iso) return '';
  const same = dayKey(iso) === todayEt();
  return same ? clock(iso) : et(iso, { weekday: 'short' }) + ' ' + clock(iso);
};

/** "ada.lovelace@favorintl.org" becomes "Ada Lovelace". */
export const nameFromEmail = (email: string) =>
  String(email || '')
    .split('@')[0]
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Turns <@email> mentions in stored text into @Name. */
export const plainMentions = (text: string) =>
  String(text || '').replace(/<@([^>]+)>/g, (_m, id: string) => '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' ? id : nameFromEmail(id)));

export const oneLine = (text: string, n = 110) => plainMentions(text).replace(/\s+/g, ' ').slice(0, n);

export const count = (n: number) => Number(n || 0).toLocaleString('en-US');
