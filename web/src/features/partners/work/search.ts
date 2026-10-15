// The /work/ page's address: ?view= picks the tab (Actions when absent); the other keys belong to the tab shown and pass through.
export type WorkView = 'open' | 'gifts' | 'mine' | 'asks' | 'cadence' | 'week' | 'intake' | 'grants' | 'ty' | 'opps' | 'stale' | 'recent' | 'giftimages';
export const WORK_VIEWS: readonly WorkView[] = ['open', 'gifts', 'mine', 'asks', 'cadence', 'week', 'intake', 'grants', 'ty', 'opps', 'stale', 'recent', 'giftimages'];
export interface WorkSearch {
  view?: WorkView;
  [k: string]: unknown;
}
export function validateWorkSearch(raw: Record<string, unknown>): WorkSearch {
  const out: WorkSearch = { ...raw };
  const v = String(raw.view || raw.tab || '');
  out.view = (WORK_VIEWS as readonly string[]).includes(v) ? (v as WorkView) : undefined;
  delete out.tab;
  return out;
}
/** The menu entry and title for each tab (src/data/areas.ts ids). */
export const VIEW_NAV: Record<string, { nav: string; title: string }> = {
  open: { nav: 'work', title: 'Actions' },
  ty: { nav: 'work', title: 'Actions' },
  opps: { nav: 'work', title: 'Actions' },
  stale: { nav: 'work', title: 'Actions' },
  recent: { nav: 'work', title: 'Actions' },
  giftimages: { nav: 'work', title: 'Actions' },
  gifts: { nav: 'partners-thank', title: 'Gifts to thank' },
  mine: { nav: 'partners-mine', title: 'My partners' },
  asks: { nav: 'partners-asks', title: 'Asks' },
  cadence: { nav: 'partners-cadence', title: 'Cadence' },
  week: { nav: 'partners-week', title: 'My week' },
  intake: { nav: 'partners-entry', title: 'Entry' },
  grants: { nav: 'partners-grants', title: 'Grants' },
};
