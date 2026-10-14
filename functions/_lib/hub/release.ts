// Release badges for /api/hub/nav: the map in src/data/release.ts with the admin's saved changes (hub_settings release.badges).
import { AREAS } from '../../../src/data/areas';
import { badgeFor, helpBadge, pageBadge, parseOverrides, type Badge } from '../../../src/data/release';
import { hubGet } from '../admin/settings';
import type { Env } from '../http';

export async function releaseMap(env: Env): Promise<Record<string, Badge>> {
  const row = await hubGet(env, 'release.badges').catch(() => null);
  const ov = parseOverrides(row?.value || '');
  const out: Record<string, Badge> = {};
  const put = (k: string, b: Badge | null) => { if (b) out[k] = b; };
  const slugs = new Set<string>();
  for (const a of AREAS) {
    put(a.id, badgeFor(a.id, ov));
    for (const p of a.pages) {
      put('page:' + p.id, pageBadge(p.id, a.id, ov));
      if (p.learn) slugs.add(p.learn);
    }
  }
  put('lite', badgeFor('lite', ov));
  slugs.add('phone-app');
  for (const k of Object.keys(ov)) if (k.startsWith('help:')) slugs.add(k.slice(5));
  for (const s of slugs) put('help:' + s, helpBadge(s, AREAS, ov));
  return out;
}
