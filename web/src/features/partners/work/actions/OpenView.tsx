// Open actions (public/js/work.js viewOpen): the scope chips, the stat strip, the filters, the tools row and the list of every open action.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ColumnsMenu, DensitySwitch } from '../../../../ui/table';
import { loadScript } from '@/lib/legacy';
import { openNew, openKeys } from './EditDialogs';
import { ActionTable, useActionTable } from './ActionTable';
import { toast } from './engine';
import { ToolPop, type MenuState, type ViewSpec } from './ToolMenus';
import { startQuery, viewsQuery, type SavedWorkView } from './queries';
import { applyScope, saveStart, startTab, SCOPES } from './start';
import { clearSel, setFilters, useWc, wcSet } from './store';
import { Ic } from './ui';
import type { Work } from './model';
import type { WorkView } from '../search';
import type { Act, BoardData, WorkFilters } from './types';
import { EMPTY_FILTERS } from './types';
import { useMounted } from '../../record/lib';

const DUES: [string, string][] = [
  ['', 'Any due date'],
  ['past', 'Past due'],
  ['today', 'Due today'],
  ['now', 'Due today or overdue'],
  ['week', 'Due in the next 7 days'],
  ['l30', 'More than 30 days late'],
  ['l90', 'More than 90 days late'],
  ['l365', 'A year late or more'],
];

interface DrillWin {
  FavorDrill?: { open: (o: Record<string, unknown>) => void };
  FavorAddPartner?: { open: () => void };
}

export function OpenView({ board, w, as, focusId }: { board: BoardData; w: Work; as?: string; focusId?: string }) {
  const f = useWc((s) => s.f);
  const sort = useWc((s) => s.sort);
  const dir = useWc((s) => s.dir);
  const me = w.me;
  const nav = useNavigate();
  // Data that streams in after the server draws is used only after mount, so the server HTML matches the first browser frame (React 418).
  const mounted = useMounted();
  const viewsQ = useQuery(viewsQuery(as));
  const views = (mounted && viewsQ.data) || [];
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const at = useActionTable(w, 'wc-open', f.fr && f.theirs ? f.fr : '');

  const base = useMemo(() => w.acts.filter(w.isOpenNow), [w]);
  const list = useMemo(() => w.sorted(base.filter((a) => w.matches(a, f)), sort, dir), [w, base, f, sort, dir]);
  const scoped = useMemo(() => base.filter((a) => w.inScope(a, f)), [w, base, f]);

  // Each tile counts with its own test, and the number opens the rows that test picks, so the two never differ.
  const TILE_DEFS: [string, string, (a: (typeof base)[number]) => boolean, string][] = [
    ['', 'Open', () => true, 'Open actions'],
    ['past', 'Past due', (a) => w.dayn(w.cur(a).due) < 0, 'Past due actions'],
    ['ty', 'Thank‐you tasks', (a) => a.ty, 'Thank-you tasks'],
    ['done', 'Thanked already or likely', (a) => a.ty && !!a.later, 'Thank-you tasks thanked already or likely'],
    ['ctg', 'Recurring Gift tasks', (a) => a.ctg, 'Recurring Gift tasks'],
  ];
  const stats = TILE_DEFS.map(([k, l, fn]) => [k, l, scoped.filter(fn).length] as [string, string, number]);

  const facets = useMemo(() => {
    const fr: Record<string, number> = {};
    const type: Record<string, number> = {};
    const cat: Record<string, number> = {};
    for (const a of base) {
      const c = w.cur(a);
      if (w.matches(a, f, 'fr')) {
        if (!c.f.length) fr._none = (fr._none || 0) + 1;
        c.f.forEach((x) => (fr[x] = (fr[x] || 0) + 1));
      }
      if (w.matches(a, f, 'type')) type[c.type] = (type[c.type] || 0) + 1;
      if (w.matches(a, f, 'cat')) cat[c.cat] = (cat[c.cat] || 0) + 1;
    }
    const frs = Object.keys(fr)
      .filter((k) => k !== '_none')
      .sort((a, b) => Number(w.live(b)) - Number(w.live(a)) || w.P(a).n.localeCompare(w.P(b).n));
    return { fr, type, cat, frs };
  }, [w, base, f]);

  const chips: [string, string][] = [];
  if (f.cid) {
    const a = w.acts.find((x) => x.cid === f.cid);
    chips.push(['cid', 'Partner: ' + (a ? a.p : f.cid)]);
  }
  if (f.fr && !(f.fr === me.fid && !f.theirs)) chips.push(['fr', f.fr === '_none' ? 'No fundraiser' : 'Fundraiser: ' + w.P(f.fr).n + (f.theirs ? ', with their partners' : '')]);
  if (f.type) chips.push(['type', 'Type: ' + f.type]);
  if (f.cat) chips.push(['cat', 'Category: ' + f.cat]);
  if (f.due) chips.push(['due', DUES.find((d) => d[0] === f.due)![1]]);
  if (f.scope === 'partners') chips.push(['scope', 'On my partners']);
  if (f.quick) chips.push(['quick', stats.find((s) => s[0] === f.quick)?.[1] || f.quick]);
  if (f.q) chips.push(['q', 'Search: ' + f.q]);
  const unf = (k: string) => {
    if (k === 'all') setFilters({ ...EMPTY_FILTERS });
    else setFilters({ [k]: k === 'theirs' ? false : '', ...(k === 'fr' ? { theirs: false } : {}) } as Partial<WorkFilters>);
  };

  // The search box reports after a short pause.
  const [qv, setQv] = useState(f.q);
  useEffect(() => setQv(f.q), [f.q]);
  const qt = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typeQ = (v: string) => {
    setQv(v);
    clearTimeout(qt.current);
    qt.current = setTimeout(() => setFilters({ q: v }), 160);
  };

  const sheetOnChange = (patch: Partial<WorkFilters>) => setFilters(patch);

  const openTile = (key: string, shown: number) => {
    const t = TILE_DEFS.find((x) => x[0] === key);
    const drill = (window as unknown as DrillWin).FavorDrill;
    if (!t || !drill) return;
    const rows = base.filter(t[2]).map((a) => {
      const c = w.cur(a);
      return { due: c.due, partner: a.p, place: a.loc || '', type: a.type, category: a.cat, summary: a.sum || '', fundraisers: c.f.map((x) => w.P(x).n).join(', '), late: Math.max(0, -w.dayn(c.due)) };
    });
    drill.open({
      title: t[3],
      shown,
      shownType: 'int',
      shownLabel: 'On the Work Center',
      defs: ['Open and overdue actions'],
      columns: [
        { key: 'due', label: 'Due', type: 'text' },
        { key: 'partner', label: 'Partner', type: 'text' },
        { key: 'place', label: 'Place', type: 'text' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'summary', label: 'Summary', type: 'text' },
        { key: 'fundraisers', label: 'Fundraisers', type: 'text' },
        { key: 'late', label: 'Days late', type: 'int' },
      ],
      rows,
      total: rows.length,
      totalLabel: 'Actions behind it',
      rowsLabel: 'Actions in this count',
      sheetTitle: t[3] + ' rows',
    });
  };

  const colSpec = (): Record<string, number> => ({ type: at.hidden.has('type') ? 0 : 1, what: at.hidden.has('what') ? 0 : 1, who: at.hidden.has('who') ? 0 : 1, added: at.hidden.has('added') ? 0 : 1 });
  const spec = (): ViewSpec => ({ view: 'open', f: { ...f }, sort, dir, cols: colSpec() });
  const applyView = (v: SavedWorkView) => {
    const sp = v.spec || {};
    const view: WorkView = sp.view === 'stale' || sp.view === 'ty' || sp.view === 'opps' || sp.view === 'recent' ? sp.view : 'open';
    wcSet({ f: { ...EMPTY_FILTERS, ...((sp.f as Partial<WorkFilters>) || {}) }, sort: sp.sort || 'due', dir: (sp.dir === 1 ? 1 : -1) as 1 | -1 });
    if (sp.cols) at.setHidden(new Set(Object.entries(sp.cols).filter(([, on]) => !on).map(([k]) => k)));
    clearSel();
    if (view !== 'open') void nav({ to: '/work/', search: (s) => ({ ...s, view }), replace: true });
  };
  const openMenu = (kind: MenuState['kind'], el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu((m) => (m && m.kind === kind ? null : { kind, rect: { left: r.left, top: r.top, bottom: r.bottom } }));
  };
  const addPartner = async () => {
    try {
      await loadScript('/js/add-partner.js?v=2');
      (window as unknown as DrillWin).FavorAddPartner?.open();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const canAdd = me.role === 'admin' || me.role === 'support';

  const opt = (v: string, l: string) => (
    <option key={v} value={v}>
      {l}
    </option>
  );
  const frOpts = (
    <>
      {opt('', 'Every fundraiser')}
      <optgroup label="Working at Favor">{facets.frs.filter(w.live).map((k) => opt(k, `${w.P(k).n} (${facets.fr[k]})`))}</optgroup>
      <optgroup label="Left Favor or not set up">{facets.frs.filter((k) => !w.live(k)).map((k) => opt(k, `${w.P(k).n} (${facets.fr[k]})`))}</optgroup>
      {facets.fr._none ? opt('_none', `No fundraiser (${facets.fr._none})`) : null}
    </>
  );
  const sortObj = { col: sort, dir: (dir === 1 ? 'asc' : 'desc') as 'asc' | 'desc' };

  return (
    <>
      {me.fid ? <ScopeBar w={w} f={f} base={base} board={board} as={as} /> : null}
      <div className="h-card wc-band">
        {stats.map(([k, l, n]) => (
          <div key={k} className={'wc-stat wc-stat--split' + (f.quick === k && (k || !f.quick) ? ' is-on' : '')}>
            <button type="button" className="wc-stat__n" aria-label={`${n} ${l}, open the actions behind it`} onClick={() => openTile(k, n)}>
              <b>{n}</b>
            </button>
            <button type="button" className="wc-stat__l" onClick={() => setFilters({ quick: f.quick === k ? '' : k })}>
              <span>{l}</span>
            </button>
          </div>
        ))}
      </div>
      <div className="wc-line" role="group" aria-label="Counts">
        {stats.slice(0, 3).map(([k, l, n]) => (
          <button key={k} type="button" className={'wc-line__i' + (f.quick === k && (k || !f.quick) ? ' is-on' : '')} onClick={() => setFilters({ quick: f.quick === k ? '' : k })}>
            <b>{n}</b> {String(l).toLowerCase().replace(/^thank-you tasks$/, 'thank-you').replace(/^thank‐you tasks$/, 'thank-you')}
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" id="wc-board" aria-label="Open actions">
        <div className={'wc-filters' + (sheet ? ' is-sheet' : '')} id="filters">
          <div className="wc-sheettitle">
            <b>Filters</b>
            <button type="button" className="wc-dlg__x" aria-label="Close filters" onClick={() => setSheet(false)}>
              <Ic n="x" />
            </button>
          </div>
          <label className="wc-find">
            <Ic n="search" />
            <span className="sr-only">Find a partner or summary</span>
            <input id="q" data-pt-search="" type="search" placeholder="Find a partner, summary or id" value={qv} autoComplete="off" onChange={(e) => typeQ(e.target.value)} />
          </label>
          <select className={'wc-sel' + (f.fr ? ' is-set' : '')} aria-label="Fundraiser" value={f.fr} onChange={(e) => sheetOnChange({ fr: e.target.value, ...(e.target.value ? {} : { theirs: false }) })}>
            {frOpts}
          </select>
          {f.fr && f.fr !== '_none' ? (
            <label className="wc-toggle" title="Blackbaud's Work Center also lists other people's open actions on the partners this fundraiser holds">
              <input type="checkbox" checked={f.theirs} onChange={(e) => sheetOnChange({ theirs: e.target.checked })} />
              Include their partners
            </label>
          ) : null}
          <select className={'wc-sel' + (f.type ? ' is-set' : '')} aria-label="Type" value={f.type} onChange={(e) => sheetOnChange({ type: e.target.value })}>
            {opt('', 'Every type')}
            {Object.keys(facets.type)
              .sort((a, b) => facets.type[b] - facets.type[a])
              .map((k) => opt(k, `${k} (${facets.type[k]})`))}
          </select>
          <select className={'wc-sel' + (f.cat ? ' is-set' : '')} aria-label="Category" value={f.cat} onChange={(e) => sheetOnChange({ cat: e.target.value })}>
            {opt('', 'Every category')}
            {Object.keys(facets.cat)
              .sort()
              .map((k) => opt(k, `${k} (${facets.cat[k]})`))}
          </select>
          <select className={'wc-sel' + (f.due ? ' is-set' : '')} aria-label="Due" value={f.due} onChange={(e) => sheetOnChange({ due: e.target.value })}>
            {DUES.map(([v, l]) => opt(v, l))}
          </select>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm wc-phonly wc-phmore" data-menu="more" aria-haspopup="true" onClick={(e) => openMenu('more', e.currentTarget)}>
            More
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm wc-filterbtn" aria-label="Filters" onClick={() => setSheet(true)}>
            <Ic n="filter" />
            <span className="wc-flbl">Filters</span>
            {chips.filter((c) => c[0] !== 'q').length ? ' (' + chips.filter((c) => c[0] !== 'q').length + ')' : ''}
          </button>
          <button type="button" className="h-btn h-btn--primary h-btn--sm wc-phonly wc-phnew" onClick={() => openNew()}>
            <Ic n="plus" />
            New action
          </button>
        </div>
        <div className="wc-tools2" id="wc-tools2">
          <button type="button" className="h-btn h-btn--primary h-btn--sm" title="New action (n)" onClick={() => openNew()}>
            <Ic n="plus" />
            New action
          </button>
          <div className="ep-menu">
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-menu="views" onClick={(e) => openMenu('views', e.currentTarget)}>
              <Ic n="filter" />
              Views{views.length ? ' (' + views.length + ')' : ''}
            </button>
          </div>
          <div className="ep-menu">
            <ColumnsMenu columns={at.columns} hidden={at.hidden} onChange={at.setHidden} />
          </div>
          <div className="ep-menu">
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-menu="export" onClick={(e) => openMenu('export', e.currentTarget)}>
              <Ic n="ext" />
              Export
            </button>
          </div>
          <DensitySwitch />
          {canAdd ? (
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void addPartner()}>
              <Ic n="plus" />
              Add partner
            </button>
          ) : null}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm ep-keysbtn" title="Keyboard shortcuts (?)" onClick={() => openKeys()}>
            Shortcuts
          </button>
        </div>
        <div className="wc-active">
          {chips.map(([k, l]) => (
            <button key={k} type="button" className="wc-fchip" onClick={() => unf(k)}>
              {l}
              <i aria-label="Remove">×</i>
            </button>
          ))}
          {chips.length > 1 ? (
            <button type="button" className="wc-clear" onClick={() => unf('all')}>
              Clear all
            </button>
          ) : null}
        </div>
        <ActionTable
          w={w}
          list={list}
          total={base.length}
          listKey="wc-open"
          sig={'open|' + JSON.stringify(f) + '|' + sort + '|' + dir}
          columns={at.columns}
          hidden={at.hidden}
          sort={sortObj}
          onSort={(s) => wcSet({ sort: s.col, dir: s.dir === 'asc' ? 1 : -1 })}
          boardTotal={board.total}
          focusId={focusId}
        />
      </section>
      {at.popEl}
      {menu ? (
        <ToolPop
          menu={menu}
          onClose={() => setMenu(null)}
          w={w}
          list={list}
          views={views}
          spec={spec}
          onApply={applyView}
          onSelectPage={() => document.querySelector<HTMLInputElement>('#wc-board thead .pt-cb input')?.click()}
          canAddPartner={canAdd}
          onAddPartner={() => void addPartner()}
          onMenu={(k, rect) => setMenu({ kind: k, rect })}
        />
      ) : null}
    </>
  );
}

// Mine, On my partners and Everyone. The button on the chip you are on makes it the one that opens first.
function ScopeBar({ w, f, base, board, as }: { w: Work; f: WorkFilters; base: Act[]; board: BoardData; as?: string }) {
  const qc = useQueryClient();
  const me = w.me;
  const start = useSuspenseQuery(startQuery(as)).data;
  const fid = me.fid!;
  const startScopeNow = (start.pref && start.pref.scope) || 'mine';
  const n: Record<string, number> = {
    mine: board.counts.mine || 0,
    partners: base.filter((a) => a.hold.includes(fid) && !w.cur(a).f.includes(fid)).length,
    all: base.length,
  };
  const on = f.scope === 'partners' ? 'partners' : f.fr === fid ? 'mine' : !f.fr ? 'all' : '';
  const [busy, setBusy] = useState(false);
  const setStart = async (k: string) => {
    setBusy(true);
    try {
      await saveStart(qc, start.pref ? start.pref.tab : startTab(start, me), k);
      toast('Open actions starts on ' + (SCOPES.find((s) => s[0] === k)?.[1] || k) + '.');
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="wc-scope" role="group" aria-label="Open actions shows">
      {SCOPES.map(([k, l]) => (
        <span key={k} className={'wc-scope__chip' + (on === k ? ' is-on' : '')}>
          <button type="button" aria-pressed={on === k} onClick={() => (applyScope(k, me), clearSel())}>
            {l}
            <span>{n[k]}</span>
          </button>
          {startScopeNow !== k ? (
            <button type="button" className="wc-scope__start" disabled={busy} onClick={() => void setStart(k)}>
              Start here
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}
