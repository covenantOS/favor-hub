// A round avatar: the picture when there is one, otherwise the initials (drawn from data-i by projects.css). Same markup as the
// classic avatar(), including the entity-card hooks (data-entity, data-label).
import type { Person } from '../types';
import { Icon } from './Icon';

const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
export const initials = (name: string | undefined) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
export const firstName = (p: { name?: string } | null | undefined) => String(p?.name || '').split(/\s+/)[0] || '';

export function Avatar({ p, size }: { p: Pick<Person, 'email' | 'name' | 'picture'> | null | undefined; size?: string }) {
  if (!p) {
    return (
      <span className={'pj-av pj-av--empty' + (size ? ' pj-av--' + size : '')} title="Unassigned">
        <Icon name="user" />
      </span>
    );
  }
  const name = p.name || String(p.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={'pj-av' + (size ? ' pj-av--' + size : '')}
      {...(p.email ? { 'data-entity': 'person:' + p.email, 'data-label': name } : {})}
      data-c={COLORS[hash(String(p.email || name)) % 7]}
      data-i={initials(name)}
    >
      {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" loading="lazy" /> : null}
    </span>
  );
}
