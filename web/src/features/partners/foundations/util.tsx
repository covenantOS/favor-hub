// Words and numbers for Foundations (the same as public/js/foundations.js).
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const plural = (n: number | string, w: string) => `${Number(n).toLocaleString('en-US')} ${w}${Number(n) === 1 ? '' : 's'}`;
export const money = (a: number | string | null | undefined) => {
  const n = Math.round(Number(a) || 0);
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US');
};
export const day = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MON[+m[2] - 1]} ${+m[3]}, ${m[1]}` : '';
};
export const stamp = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const firstNames = (csv: string | null | undefined) =>
  String(csv || '')
    .split(',')
    .filter(Boolean)
    .map((n) => n.trim().split(' ')[0])
    .join(', ');
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** [key, label, pill class] */
export function statusOf(f: any): [string, string, string] {
  if (f.status === 'dead') return ['dead', 'Dead end', 'fnd-pill-dead'];
  if (f.bb_lookup_id) return ['in', 'In Blackbaud', 'approved'];
  if (!Number(f.contacts)) return ['new', 'Not contacted', 'fnd-pill-new'];
  if (String(f.rdds || '').split(',').filter(Boolean).length > 1) return ['two', 'Two fundraisers', 'fnd-pill-two'];
  if (Number(f.contacts) > 1) return ['work', 'Working', 'fnd-pill-work'];
  return ['once', 'Contacted once', 'pending'];
}
export const pill = (f: any) => {
  const s = statusOf(f);
  return <span className={'exp-pill ' + s[2]}>{s[1]}</span>;
};
const BADGE: Record<string, string> = { dead: '', in: ' pt-badge--good', new: '', two: ' pt-badge--warn', work: ' pt-badge--gold', once: '' };
export const badge = (f: any) => {
  const st = statusOf(f);
  return <span className={'pt-badge' + (BADGE[st[0]] || '')}>{st[1]}</span>;
};
