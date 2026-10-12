// What the frame needs to know about the page inside it when the page is not a native route: its menu entry, title, width and the buttons it
// puts in the top bar. A classic page brought in by LegacyPage fills this in from the page's own HTML; native routes use staticData instead.
export interface PageMeta {
  nav: string;
  title: string;
  layout: 'page' | 'wide' | 'full' | 'bare';
  /** Markup the page put in the top bar's actions slot. */
  actions: string;
}

type Fn = () => void;
const empty: PageMeta = { nav: '', title: '', layout: 'page', actions: '' };
let cur: PageMeta = empty;
const subs = new Set<Fn>();

export const pageMeta = {
  subscribe(f: Fn) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  get: () => cur,
  set(next: PageMeta) {
    cur = next;
    subs.forEach((f) => f());
  },
  clear() {
    if (cur === empty) return;
    cur = empty;
    subs.forEach((f) => f());
  },
};

export const layoutOf = (cls: string): PageMeta['layout'] => (/\bh-bare\b/.test(cls) ? 'bare' : /h-page--wide/.test(cls) ? 'wide' : /h-page--full/.test(cls) ? 'full' : 'page');
