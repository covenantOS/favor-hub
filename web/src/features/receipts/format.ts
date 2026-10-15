// Words and dates the Receipts and Giving statements pages share. Dates are built by hand (never toLocaleString), so the server's text and the
// browser's text are the same character for character whatever ICU build each runs on.

export const plural = (n: number, w: string, ws?: string): string => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? w : ws || w + 's'}`;

export const money = (n: number): string =>
  (Number(n) < 0 ? '-' : '') + '$' + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n: number): string => Number(n).toLocaleString('en-US');

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Oct 5, 2026 from 2026-10-05 or an ISO stamp. */
export const day = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
};

/** Oct 5 from 2026-10-05. */
export const shortDay = (iso: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MON[+m[2] - 1]} ${+m[3]}` : '';
};

const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function easternParts(d: Date): { y: string; mo: number; d: number; h: number; mi: string } {
  const p: Record<string, string> = {};
  for (const x of ET.formatToParts(d)) p[x.type] = x.value;
  return { y: p.year, mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: p.minute };
}

/** Oct 5, 3:45 PM in Eastern time. */
export const stamp = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const e = easternParts(t);
  return `${MON[e.mo - 1]} ${e.d}, ${e.h % 12 || 12}:${e.mi} ${e.h < 12 ? 'AM' : 'PM'}`;
};

/** The Eastern calendar day of a timestamp, as YYYY-MM-DD. */
export const etDay = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const e = easternParts(t);
  return `${e.y}-${String(e.mo).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`;
};

/** Today in Eastern time, YYYY-MM-DD. */
export const today = (): string => etDay(new Date().toISOString());

/** The reply code for receipts dated this day: Y26A-TY for January 2026. */
export const codeFor = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number);
  return `Y${String(y).slice(2)}${'123456789ABC'[m - 1]}-TY`;
};
