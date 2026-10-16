// The tab row under the header, the React twin of src/components/NavTabs.astro plus hubTabsLayout in src/layouts/App.astro:
// the pages of the open page's area, this person's job pages first, at most six in the row and the rest under More; pages that sit
// together (Reporting's Reports and Teams, Staff's Learning) go under one group menu, and a group with one page shows it as a tab.
// The open page under More lights More, so the row keeps its shape from page to page.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { NavArea, NavPage } from '@hub/data/areas';
import { TAB_CAP, jobMatch, jobWho } from '@hub/data/areas';
import { NavLink } from './NavLink';
import { pageVisible, type NavView } from './model';
import { BodyPortal } from './BodyPortal';

type Entry = { kind: 'page'; page: NavPage; ord: number } | { kind: 'group'; group: string; pages: NavPage[]; ord: number };

interface Props {
  area: NavArea;
  navId: string;
  view: NavView;
  access: Record<string, unknown>;
  kpiTeams: string[];
  jobs: readonly string[] | null;
  onRemember: (areaId: string, pageId: string) => void;
}

const isOnPage = (area: NavArea, p: NavPage, navId: string) => p.id === navId || (p.also || []).includes(navId) || area.pages.some((x) => x.id === navId && x.parent === p.id);

const Caret = () => (
  <svg className="h-tab__caret" viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export function TabRow({ area, navId, view, access, kpiTeams, jobs, onRemember }: Props) {
  const pages = useMemo(() => area.pages.filter((p) => !p.ext && p.menu !== false), [area]);
  const visible = useMemo(() => pages.filter((p) => pageVisible(p, access, kpiTeams)), [pages, access, kpiTeams]);
  const count = (p: NavPage) => (p.count ? view.areas.flatMap((a) => a.pages).find((x) => x.page.id === p.id)?.count || 0 : 0);

  // Registry order; a group is drawn once, where its first page sits.
  const entries = useMemo(() => {
    const out: Entry[] = [];
    visible.forEach((p, i) => {
      if (p.group) {
        const g = out.find((e) => e.kind === 'group' && e.group === p.group) as Extract<Entry, { kind: 'group' }> | undefined;
        if (g) g.pages.push(p);
        else out.push({ kind: 'group', group: p.group, pages: [p], ord: i });
      } else out.push({ kind: 'page', page: p, ord: i });
    });
    // A group with one page this person may open shows that page as a plain tab.
    return out.map((e) => (e.kind === 'group' && e.pages.length === 1 ? { kind: 'page' as const, page: e.pages[0], ord: e.ord } : e));
  }, [visible]);

  const jobsOf = (e: Entry) => (e.kind === 'page' ? e.page.jobs || null : null);
  const anyJob = entries.some((e) => jobsOf(e) && jobMatch(jobsOf(e)!, jobs));
  const first = anyJob ? entries.filter((e) => jobMatch(jobsOf(e) || undefined, jobs)) : entries.slice();
  const rest = anyJob ? entries.filter((e) => !jobMatch(jobsOf(e) || undefined, jobs)) : [];
  // No More menu: every page sits in the row (Danny and Will, 2026-10-15).
  const inRow = first.concat(rest).sort((x, y) => x.ord - y.ord);
  const entryOn = (e: Entry) => (e.kind === 'page' ? isOnPage(area, e.page, navId) : e.pages.some((p) => isOnPage(area, p, navId)));

  // One tab left is still shown when it is not the open page.
  const hide = visible.length === 0 || (visible.length === 1 && isOnPage(area, visible[0], navId)) || pages.length < 2;

  const [menu, setMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const open = (id: string, e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (menu?.id === id) return setMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ id, top: Math.round(r.bottom + 4), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 328))) });
  };
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      const t = e.target as Element | null;
      if (t && t.closest && (t.closest('.h-tabmenu') || t.closest('.h-tab--menu'))) return;
      setMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  // The open tab scrolls into view on a narrow row, and the row fades at the edge that hides tabs.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fade = () => {
      row.classList.toggle('is-over', row.scrollWidth > row.clientWidth + 2 && row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
      row.classList.toggle('is-over-l', row.scrollLeft > 2);
    };
    const on = row.querySelector<HTMLElement>('.h-tab.is-on');
    if (on && (on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth - 8 || on.offsetLeft < row.scrollLeft)) row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
    fade();
    row.addEventListener('scroll', fade, { passive: true });
    return () => row.removeEventListener('scroll', fade);
  }, [navId]);

  const tab = (p: NavPage, inMenu: boolean, group?: string) => {
    const on = isOnPage(area, p, navId);
    const n = count(p);
    const own = !!(p.jobs && jobMatch(p.jobs, jobs));
    return (
      <NavLink
        key={p.id}
        className={'h-tab' + (on ? ' is-on' : '') + ((inMenu ? own : true) && !group ? ' is-job' : '')}
        role={inMenu ? 'menuitem' : undefined}
        href={p.href}
        data-nav-id={p.id}
        data-group={group}
        data-kpi-page={p.kpiPage}
        data-jobs={(p.jobs || []).join(' ') || undefined}
        aria-current={on ? 'page' : undefined}
        onClick={() => {
          setMenu(null);
          onRemember(area.id, p.id);
        }}
      >
        <span className="h-tab__t">{p.label}</span>
        {p.jobs && <span className="h-tab__who">{jobWho(p.jobs)}</span>}
        {p.count && (
          <span className="h-nav__count" data-count={p.count} hidden={!n}>
            {n.toLocaleString('en-US')}
          </span>
        )}
      </NavLink>
    );
  };

  const menuEl = (id: string, label: string, items: NavPage[], group?: string) =>
    menu?.id === id &&
    BodyPortal(
      <div className="h-tabmenu" role="menu" data-menu={id} aria-label={label} style={{ top: menu.top, left: menu.left }}>
        {items.map((p) => tab(p, true, group))}
      </div>
    );

  return (
    <nav className="h-tabs" id="h-tabs" data-area={area.id} aria-label={`${area.label} sections`} hidden={hide}>
      <div className="h-tabs__row" ref={rowRef}>
        {inRow.map((e) =>
          e.kind === 'page' ? (
            tab(e.page, false)
          ) : (
            <span key={'g:' + e.group} className="h-tabgrp" data-grp={e.group}>
              <button type="button" className={'h-tab h-tab--menu is-job' + (entryOn(e) ? ' is-on' : '')} aria-haspopup="menu" aria-expanded={menu?.id === 'grp:' + e.group} data-menu-for={'grp:' + e.group} onClick={(ev) => open('grp:' + e.group, ev)}>
                <span className="h-tab__t">{e.group}</span>
                <span className="h-tab__sub" />
                <Caret />
              </button>
              {menuEl('grp:' + e.group, e.group, e.pages, e.group)}
            </span>
          )
        )}
      </div>
    </nav>
  );
}
