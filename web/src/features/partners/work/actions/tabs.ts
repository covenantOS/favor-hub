// Which Work Center tabs a person has and what they are called (public/js/work-tabs.js and each tab's registerTab call).
import type { Me } from './types';

export const ACTION_VIEWS = ['open', 'ty', 'opps', 'stale', 'recent', 'giftimages'] as const;
export type ActionView = (typeof ACTION_VIEWS)[number];
export const ACTION_LABEL: Record<ActionView, string> = {
  open: 'Open actions',
  ty: 'Thank-yous',
  opps: 'Opportunities',
  stale: 'Stale',
  recent: 'Recent changes',
  giftimages: 'Gift images',
};
export const isActionView = (v: string | undefined): v is ActionView => !!v && (ACTION_VIEWS as readonly string[]).includes(v);

const mayStrip = (me: Me) => me.role === 'director' && !!me.fid && me.team === 'RDD';
const has: Record<string, (me: Me) => boolean> = {
  open: () => true,
  gifts: (me) => !!me.canGifts,
  mine: (me) => me.role === 'admin' || me.role === 'support' || (me.role === 'director' && !!me.fid),
  asks: (me) => me.role === 'admin' || me.role === 'director' || me.role === 'support',
  cadence: (me) => me.role === 'admin' || me.role === 'partner_care',
  week: (me) => me.role === 'admin' || me.role === 'support' || mayStrip(me),
  intake: (me) => !!me.canEntry,
  ty: () => true,
  giftimages: (me) => me.role === 'admin' || me.role === 'support',
  grants: (me) => me.role === 'admin' || me.role === 'grants' || me.role === 'support',
  opps: () => true,
  stale: () => true,
  recent: () => true,
};
const ORDER = ['open', 'gifts', 'mine', 'asks', 'cadence', 'week', 'intake', 'ty', 'giftimages', 'grants', 'opps', 'stale', 'recent'];
const LABEL: Record<string, string> = { open: 'Open actions', gifts: 'Gifts to thank', mine: 'My partners', asks: 'Asks', cadence: 'Cadence', week: 'My week', intake: 'Entry', ty: 'Thank-yous', giftimages: 'Gift images', grants: 'Grants', opps: 'Opportunities', stale: 'Stale', recent: 'Recent' };

export const hasTab = (id: string, me: Me) => !!has[id] && has[id](me);
export function tabLabel(id: string, me?: Me): string {
  if (id === 'week' && me && !mayStrip(me)) return 'Weekly reports';
  return LABEL[id] || 'Open actions';
}
/** The tabs this person has, in the order the start panel lists them. */
export const tabsFor = (me: Me) => ORDER.filter((id) => hasTab(id, me)).map((id) => ({ id, label: tabLabel(id, me) }));

/** The tab remembered in this browser (public/js/work-tabs.js, key wc.lastg). */
export function lastTab(): string {
  try {
    const m = JSON.parse(localStorage.getItem('wc.lastg') || '{}') as Record<string, string>;
    return m._last || '';
  } catch {
    return '';
  }
}
export function rememberTab(id: string) {
  try {
    const m = JSON.parse(localStorage.getItem('wc.lastg') || '{}') as Record<string, string>;
    m._last = id;
    localStorage.setItem('wc.lastg', JSON.stringify(m));
  } catch {
    // private mode
  }
}
