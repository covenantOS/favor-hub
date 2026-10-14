import { BADGE_LABEL, BADGE_TITLE, badgeFor, helpBadge, pageBadge, type Badge } from '@hub/data/release';
import { useNav } from '@/data/hooks';
import { AREAS } from '@hub/data/areas';

/** The release map: the server's answer (with the admin's saved changes), else the built-in list. */
function useRelease(): Record<string, Badge> | null {
  const nav = useNav();
  const r = nav.data?.release;
  return r && Object.keys(r).length ? r : null;
}

function fallback(k: string): Badge | null {
  if (k.startsWith('help:')) return helpBadge(k.slice(5), AREAS);
  if (k.startsWith('page:')) return null;
  return badgeFor(k);
}

/** A release badge (Alpha, Beta, New) for an area id, `page:<id>`, `help:<slug>` or `lite`. `areaId` gives a page its area's default. */
export function RelBadge({ k, areaId, skipSameAsArea, className = '' }: { k: string; areaId?: string; skipSameAsArea?: boolean; className?: string }) {
  const rel = useRelease();
  let b: Badge | null;
  if (rel) b = rel[k] || null;
  else if (k.startsWith('page:') && areaId) b = pageBadge(k.slice(5), areaId);
  else b = fallback(k);
  if (b && skipSameAsArea && areaId) {
    const ab = rel ? rel[areaId] || null : badgeFor(areaId);
    if (ab === b) b = null;
  }
  if (!b) return null;
  return (
    <em className={`h-rel h-rel--${b}${className ? ' ' + className : ''}`} data-rel={k} title={BADGE_TITLE[b]}>
      {BADGE_LABEL[b]}
    </em>
  );
}
