// Pure helpers for the Clips pages (no DOM), so the node tests can run them.
import type { ClipRow } from './queries';

export const LEVELS: Record<string, string> = { private: 'Private', people: 'Specific people', staff: 'Anyone at Favor', public: 'Everybody' };

/** The label for a sharing level; an unknown level reads as Specific people, as the Share window does. */
export const levelLabel = (id: string): string => LEVELS[id] || LEVELS.people;

/** The level of a clip from either shape the API uses (library row or watch data). */
export const levelOfClip = (c: Partial<ClipRow> & { staffLink?: number }): string => (c && (c.level || c.access)) || (c && c.share ? 'public' : c && (c.staff_link || c.staffLink) ? 'staff' : 'people');

export function fmtBytes(n: number): string {
  const b = Number(n) || 0;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${Math.round(b / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

export const fmtViews = (n: number): string => (Number(n) === 1 ? '1 view' : `${Number(n).toLocaleString('en-US')} views`);

export function countLabel(n: number): string {
  if (!n) return '';
  return n === 1 ? '1 clip' : `${n.toLocaleString('en-US')} clips`;
}

/** The text a library with no rows shows. */
export function emptyText(scope: 'mine' | 'all', q: string): string {
  return q ? 'No clip matches that search.' : scope === 'all' ? 'No clips have been recorded yet.' : 'No clips yet.';
}

/** A long library draws 60 clips at a time. */
export const PAGE = 60;

/** Which share of a person's cap their storage uses, for the admin meters. */
export const capPct = (bytes: number, cap: number): number => Math.min(100, Math.round(((Number(bytes) || 0) / (cap || 1)) * 100));

/** A setting row's Save button wakes when the box holds something other than what the server has. */
export const settingChanged = (typed: string, saved: string): boolean => typed !== saved;

export interface UsageRow {
  email: string;
  name: string;
  clips: string;
  used: string;
  pct: number;
}

/** Admin > Clips, Storage by person: each person's clips, gigabytes used and share of the cap (a share can pass 100). */
export function usageRows(list: { email: string; name: string; clips: number; bytes: number }[], cap: number): UsageRow[] {
  return list.map((u) => ({
    email: u.email,
    name: u.name,
    clips: Number(u.clips || 0).toLocaleString('en-US'),
    used: (u.bytes / 1073741824).toFixed(2) + ' GB',
    pct: Math.round((u.bytes / cap) * 100),
  }));
}

export type Filter = 'all' | 'shared' | 'private';
export type Sort = 'new' | 'old' | 'views' | 'title' | 'size' | 'person';

const by = (s: unknown) => String(s ?? '');
export const SORTS: Record<Sort, (a: ClipRow, b: ClipRow) => number> = {
  new: (a, b) => by(b.created_at).localeCompare(by(a.created_at)),
  old: (a, b) => by(a.created_at).localeCompare(by(b.created_at)),
  views: (a, b) => Number(b.views) - Number(a.views) || by(b.created_at).localeCompare(by(a.created_at)),
  title: (a, b) => by(a.title || 'Untitled clip').localeCompare(by(b.title || 'Untitled clip'), 'en', { sensitivity: 'base' }),
  size: (a, b) => Number(b.size_bytes) - Number(a.size_bytes),
  person: (a, b) => by(a.owner_name).localeCompare(by(b.owner_name), 'en', { sensitivity: 'base' }) || by(b.created_at).localeCompare(by(a.created_at)),
};

/** The rows on screen: the search result, narrowed by the Shared / Private chip, in the chosen order. */
export function shownClips(rows: ClipRow[], filter: Filter, sort: Sort): ClipRow[] {
  return rows.filter((c) => (filter === 'shared' ? levelOfClip(c) !== 'private' : filter === 'private' ? levelOfClip(c) === 'private' : true)).sort(SORTS[sort] || SORTS.new);
}

/** The line in the selection bar. */
export const selectLabel = (n: number): string => (n ? (n === 1 ? '1 selected' : `${n} selected`) : 'Nothing selected');
