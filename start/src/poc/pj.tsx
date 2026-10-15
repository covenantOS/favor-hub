// Small helpers from public/js/projects/ui-util.js (dates in Eastern time, initials, avatar colour, icons), as typed functions.
const P: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
};

export function PjIcon({ n }: { n: string }) {
  return <svg className="pj-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[n] || '' }} />;
}

const ET = 'America/New_York';
export const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: ET });
const parse = (s: string) => new Date(s + 'T12:00:00Z');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function dueLabel(d: string): string {
  const t = todayStr();
  const n = Math.round((parse(d).getTime() - parse(t).getTime()) / 86400000);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DAY[parse(d).getUTCDay()];
  const x = parse(d);
  return MON[x.getUTCMonth()] + ' ' + x.getUTCDate() + (d.slice(0, 4) !== t.slice(0, 4) ? ', ' + d.slice(0, 4) : '');
}

const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
export const initials = (name: string) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export function avatarProps(p: { email?: string; name?: string }) {
  const name = p.name || String(p.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { name, color: COLORS[hash(String(p.email || name)) % 7] };
}
