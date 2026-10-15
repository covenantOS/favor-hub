// What the Work Center's lists derive from the board: the short row form, due words, filters, sorting, the stale lanes and the
// thank-you groups. A port of the helpers in public/js/work.js. Everything here is a pure function of the board and the person's own
// pending changes (the overlays in store.ts), so a list draws the same on the server and in the browser.
import type { Act, BoardData, BoardRowRaw, Me, People, Overlay, WorkFilters } from './types';

export function adapt(r: BoardRowRaw): Act {
  return {
    id: r.id,
    due: r.due,
    add: r.added,
    type: r.type,
    cat: r.category,
    sum: r.summary,
    desc: r.description,
    cid: r.cid,
    p: r.partner,
    loc: r.place,
    lk: r.lookup,
    f: r.fundraisers || [],
    dec: !!r.deceased,
    ty: !!r.ty,
    ctg: !!r.ctg,
    pri: r.priority || '',
    tg: r.tags || [],
    gift: r.gift ? { id: r.gift.id, a: r.gift.amount, d: r.gift.date, fund: r.gift.fund } : null,
    later: r.later ? { id: r.later.id, d: r.later.date, by: r.later.by || [], s: r.later.summary, cat: r.later.category, k: r.later.strength === 'thanked' ? 's' : 'l' } : null,
    hold: r.holders || [],
    grp: r.group || null,
    pending: r.pending || null,
    reopened: !!r.reopened,
  };
}

export interface Index {
  data: BoardData;
  acts: Act[];
  byId: Record<string, Act>;
  today: string;
  people: People;
  me: Me;
}
const cache = new WeakMap<BoardData, Index>();
export function indexOf(data: BoardData): Index {
  let i = cache.get(data);
  if (!i) {
    const acts = data.rows.map(adapt);
    i = { data, acts, byId: Object.fromEntries(acts.map((a) => [a.id, a])), today: data.today, people: data.people, me: data.me };
    cache.set(data, i);
  }
  return i;
}

export const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export const plural = (n: number, one: string, many?: string) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');
export const money = (a: unknown) => {
  const n = Number(a) || 0;
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
};
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const ini = (n: string) => {
  const w = String(n || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
};
export const et = (iso: string | number | Date, o?: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Pend {
  ov: Record<string, Overlay>;
  gone: Record<string, 1>;
  saving: Record<string, string>;
  queued: Record<string, string>;
  back: Record<string, 1>;
}

export interface Lane {
  k: string;
  n: string;
  hint: string;
  test: (a: Act) => boolean;
}

/** The helpers for one board and one set of pending changes. Build it with useMemo, or at call time in the engine. */
export function makeWork(idx: Index, pend: Pend) {
  const { today, people } = idx;
  const me = idx.me;
  const dayn = (iso: string) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
  /** "Sep 5" this year, "Sep 5, 2024" otherwise (or always with the year when yr is true). */
  const fd = (iso: string | null | undefined, yr?: boolean) => {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return MON[m - 1] + ' ' + d + (yr || y !== Number(today.slice(0, 4)) ? ', ' + y : '');
  };
  const P = (fid: string) => people[fid] || { n: 'Fundraiser ' + fid, team: '', active: 0, listed: 0, left: 0 };
  const first = (fid: string) => String(P(fid).n || '').trim().split(/\s+/)[0] || '';
  const live = (fid: string) => {
    const p = people[fid];
    return !!(p && p.active && p.listed);
  };
  /** " (left)" or " (inactive)" after a name when that person can no longer own work. */
  const goneTag = (fid: string) => {
    if (live(fid)) return '';
    const p = people[fid];
    return p && (p.listed || p.left) ? ' (left)' : ' (inactive)';
  };
  const mayAssign = (fid: string) => !!me.anyTeam || fid === me.fid || (me.fids || []).includes(fid) || (!!me.team && P(fid).team === me.team);
  const cur = (a: Act) => {
    const o = pend.ov[a.id] || {};
    return { due: o.due || a.due, f: o.f || a.f };
  };
  const isOpenNow = (a: Act) => !pend.gone[a.id];
  const pendingOf = (a: Act) => (a.pending && a.pending.state === 'saving' ? 'saving' : '');
  const queuedOf = (a: Act) => (a.pending && a.pending.state === 'queued' ? a.pending.label || '' : '');
  const hasDeparted = (a: Act) => cur(a).f.some((x) => !live(x));
  const lateClass = (due: string): [string, string] => {
    const n = dayn(due);
    if (n > 0) return ['ok', 'Due in ' + plural(n, 'day')];
    if (n === 0) return ['soon', 'Due today'];
    if (n >= -7) return ['soon', -n + (n === -1 ? ' day late' : ' days late')];
    if (n >= -60) return ['', -n + ' days late'];
    const d = -n;
    const txt = d < 120 ? Math.round(d / 7) + ' wk late' : Math.round(d / 30.4) + ' mo late';
    return [n <= -365 ? 'old' : '', txt];
  };
  const LANES: Lane[] = [
    { k: 'left', n: 'Owner left or inactive', hint: "Someone on it left Favor or is not set up as a fundraiser. Give it to the partner's current holder.", test: (a) => hasDeparted(a) },
    { k: 'none', n: 'No owner', hint: 'Blackbaud shows these to nobody.', test: (a) => cur(a).f.length === 0 },
    { k: 'year', n: 'A year late or more', hint: 'More than a year past due.', test: (a) => dayn(cur(a).due) <= -365 },
    { k: '90', n: '90 days to a year', hint: 'Close as no longer needed, or reschedule.', test: (a) => dayn(cur(a).due) < -90 && dayn(cur(a).due) > -365 },
    { k: '30', n: '30 to 90 days late', hint: 'Still counted. Check before closing.', test: (a) => dayn(cur(a).due) < -30 && dayn(cur(a).due) >= -90 },
    { k: 'ctg', n: 'Recurring Gift tasks', hint: 'Made by a Blackbaud workflow for every new recurring gift.', test: (a) => a.ctg },
  ];
  const hay = new Map<string, string>();
  const base = (a: Act) => {
    let h = hay.get(a.id);
    if (h === undefined) {
      h = norm(a.p + ' ' + a.sum + ' ' + a.desc + ' ' + a.id + ' ' + (a.lk || ''));
      hay.set(a.id, h);
    }
    return h;
  };
  const matches = (a: Act, f: WorkFilters, skip?: string) => {
    if (!isOpenNow(a)) return false;
    const c = cur(a);
    if (f.fr && skip !== 'fr') {
      if (f.fr === '_none') {
        if (c.f.length) return false;
      } else if (!c.f.includes(f.fr) && !(f.theirs && a.hold.includes(f.fr))) return false;
    }
    if (f.scope === 'partners' && !(me.fid && a.hold.includes(me.fid) && !c.f.includes(me.fid))) return false;
    if (f.type && skip !== 'type' && a.type !== f.type) return false;
    if (f.cat && skip !== 'cat' && a.cat !== f.cat) return false;
    if (f.cid && a.cid !== f.cid) return false;
    if (f.due && skip !== 'due') {
      const n = dayn(c.due);
      if (f.due === 'past' && !(n < 0)) return false;
      if (f.due === 'today' && n !== 0) return false;
      if (f.due === 'now' && !(n <= 0)) return false;
      if (f.due === 'week' && !(n >= 0 && n <= 7)) return false;
      if (f.due === 'l30' && !(n < -30)) return false;
      if (f.due === 'l90' && !(n < -90)) return false;
      if (f.due === 'l365' && !(n <= -365)) return false;
    }
    if (f.quick === 'ty' && !a.ty) return false;
    if (f.quick === 'done' && !(a.ty && a.later)) return false;
    if (f.quick === 'ctg' && !a.ctg) return false;
    if (f.quick === 'past' && !(dayn(c.due) < 0)) return false;
    if (f.q) {
      const q = norm(f.q);
      const h = base(a) + ' ' + norm(c.f.map((x) => P(x).n).join(' '));
      if (!q.split(' ').every((w) => h.includes(w))) return false;
    }
    return true;
  };
  const sorted = (list: Act[], sort: string, dir: number) => {
    const k = (a: Act) => (sort === 'partner' ? a.p.toLowerCase() : sort === 'added' ? a.add : sort === 'fr' ? cur(a).f.map((x) => P(x).n).join() || '~' : cur(a).due);
    return list.slice().sort((x, y) => (k(x) < k(y) ? -1 : k(x) > k(y) ? 1 : Number(x.id) - Number(y.id)) * dir);
  };
  /** The rows the chosen scope (Mine, On my partners, Everyone) and fundraiser pick leave in play. The Open count and the tiles follow it. */
  const inScope = (a: Act, f: WorkFilters) => matches(a, { ...f, quick: '', due: '', q: '', type: '', cat: '', cid: '' });

  interface TyGroup {
    key: string;
    ids: string[];
    a: Act;
    later: Act['later'];
  }
  const tyGroups = (owner: string): TyGroup[] => {
    const seen = new Set<string>();
    const out: TyGroup[] = [];
    idx.acts
      .filter((a) => a.ty && isOpenNow(a) && (!owner || cur(a).f.includes(owner)))
      .forEach((a) => {
        if (seen.has(a.id)) return;
        const ids = (a.grp || [a.id]).filter((id) => idx.byId[id] && isOpenNow(idx.byId[id]));
        ids.forEach((id) => seen.add(id));
        const lead = idx.byId[ids[0]] || a;
        const later = ids.map((id) => idx.byId[id].later).find((l) => l && l.k === 's') || ids.map((id) => idx.byId[id].later).find(Boolean) || null;
        out.push({ key: lead.id, ids, a: lead, later });
      });
    return out;
  };
  const staleCount = () => idx.acts.filter((a) => isOpenNow(a) && LANES.some((l) => l.test(a))).length;
  return { idx, today, me, dayn, fd, P, first, live, goneTag, mayAssign, cur, isOpenNow, pendingOf, queuedOf, hasDeparted, lateClass, LANES, matches, sorted, inScope, tyGroups, staleCount, byId: idx.byId, acts: idx.acts };
}
export type Work = ReturnType<typeof makeWork>;
export type TyGroup = ReturnType<Work['tyGroups']>[number];
