// Partners > All partners: every Blackbaud record (individuals, households, organizations, churches, foundations, givers or not) in one
// table. Search, filters, sort and pages run on the server (GET /api/partners over the hub's copy, rebuilt each hour after Blackbaud's
// sync); the filters live in the address, so a view can be shared as a link. Stars, tags, saved views and merge requests are
// FavorOS's own; nothing here writes to Blackbaud. Ported from public/js/partners-dir.js.
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/ptable.css';
import '@hub/styles/partners-dir.css';
import { BodyPortal } from '@/shell/BodyPortal';
import { loadScript } from '@/lib/legacy';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, SearchBox, Seg, useHiddenColumns, useListKeys, usePageSize, type Column } from '../../../ui/table';
import {
  dirParams, dirQuery, KIND, menusQuery, money, N, pdKeys, pdPost, pipes, short, STATUS, STATUS_TIP, todayEt, viewsQuery, whole, fd, ago,
  type DirAnswer, type DirRow, type DirSearch, type Menus, type SavedView,
} from '../api';
import { QueuePane, RecentPane, useMergeCount } from './Panes';
import { SheetMark } from '../work/lists/icons';
import { useMounted } from '../record/lib';

// The toolbar icons partners-dir.js draws (its I.views, I.filter and I.down), same paths.
const BAR_ICON: Record<'views' | 'filter' | 'down', string> = {
  views: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>',
  down: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
};
function BarIc({ n }: { n: keyof typeof BAR_ICON }) {
  return <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: BAR_ICON[n] }} />;
}
/** The filters behind More that are set (partners-dir.js moreCount). */
function moreCount(s: DirSearch): number {
  return [s.codesNot, s.solicit, s.solicitNot, s.firstFrom || s.firstTo, s.lastFrom || s.lastTo, s.noContactDays, s.major, s.recurring, s.openActions, s.deceased, s.inactive].filter(Boolean).length;
}

const KINDS = ['individual', 'household', 'organization', 'church', 'foundation'];
const ARR = ['kinds', 'status', 'states', 'codes', 'codesNot', 'solicit', 'solicitNot', 'tags'] as const;
type ArrKey = (typeof ARR)[number];
const list = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
const HIDE_DEFAULT = ['codes', 'l12', 'last_year', 'largest', 'gifts', 'first_gift', 'solicit', 'email', 'phone', 'zip', 'lookup', 'added'];

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={on ? 'is-on' : undefined}>
      <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
    </svg>
  );
}

function useToast(): [ReactNode, (m: string) => void] {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setOn(false), 4200);
    return () => clearTimeout(t);
  }, [on, msg]);
  const show = useCallback((m: string) => {
    setMsg(m);
    setOn(true);
  }, []);
  return [BodyPortal(<div className={'pd-toast' + (on ? ' is-on' : '')} role="status">{msg}</div>), show];
}

export function Directory({ search }: { search: DirSearch }) {
  const pane = search.pane || 'all';
  const navigate = useNavigate();
  const go = useCallback((next: DirSearch) => navigate({ to: '/partners/', search: next as never, replace: true }), [navigate]);
  const merges = useMergeCount();
  const tabs: [string, string][] = [['all', 'Partners'], ['recent', 'Recently opened'], ['dups', 'Duplicates and merges']];
  return (
    <div className="pd-root">
      <div className="pd-panes" role="tablist" aria-label="Lists">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={pane === k} title={k === 'dups' ? 'Records that look like one partner, to compare and merge in Data care.' : undefined} onClick={() => go({ ...search, pane: k === 'all' ? undefined : (k as DirSearch['pane']), page: undefined })}>
            {l}
            {k === 'dups' && merges ? <span>{merges}</span> : null}
          </button>
        ))}
      </div>
      {pane === 'recent' ? (
        <Suspense fallback={<PaneSkeleton />}><RecentPane /></Suspense>
      ) : pane === 'dups' || pane === 'merges' ? (
        <Suspense fallback={<PaneSkeleton />}><QueuePane /></Suspense>
      ) : (
        <AllPartners search={search} go={go} />
      )}
    </div>
  );
}

function PaneSkeleton() {
  return (
    <section className="h-card pd-sheet" aria-busy="true">
      <div className="h-skel" style={{ height: 520, borderRadius: 18 }} />
    </section>
  );
}

const COLUMNS = (today: string, contacts: boolean): Column<DirRow>[] => [
  {
    key: 'name', label: 'Name', sort: 'name', fixed: true, className: 'pd-name',
    cell: (r) => (
      <>
        <a className="pt-name" href={`/work/partner/${r.id}`} data-partner-id={r.id} data-pt-open="">{r.name}</a>
        {r.lookup ? <span className="pt-sub"> {r.lookup}</span> : null}
        {r.deceased ? <span className="pt-badge pt-badge--warn">Deceased</span> : null}
        {r.inactive ? <span className="pt-badge">Inactive</span> : null}
        {r.recurring ? <span className="pt-badge pt-badge--good" title="An active recurring gift">Recurring</span> : null}
      </>
    ),
  },
  { key: 'kind', label: 'Kind', phone: true, cell: (r) => (r.kind === 'individual' && r.spouse_id ? <span title={`Household with ${r.spouse_name || 'a spouse'}`}>Household</span> : KIND[r.kind] || r.kind) },
  { key: 'place', label: 'City and state', sort: 'place', cell: (r) => [r.city, r.state].filter(Boolean).join(', ') || <span className="pt-mute">No address</span> },
  { key: 'holder', label: 'Holder', sort: 'holder', cell: (r) => r.holder_names || <span className="pt-mute">No one</span> },
  {
    key: 'status', label: 'Status', sort: 'status', firstDir: 'desc', phone: true,
    cell: (r) => (
      <span className={'pt-badge' + (r.status === 'active' ? ' pt-badge--good' : r.status === 'lybunt' ? ' pt-badge--gold' : r.status === 'lapsed' ? ' pt-badge--warn' : '')} title={STATUS_TIP[r.status]}>
        {STATUS[r.status] || r.status}
      </span>
    ),
  },
  {
    key: 'lifetime', label: 'Lifetime', sort: 'lifetime', num: true, phone: true,
    cell: (r) =>
      !(r.lifetime > 0) && r.passed_on > 0 ? (
        <span className="pt-mute" title={`None of its own. It passed on ${whole(r.passed_on)} in ${N(r.passed_n)} gifts for other partners.`}>Passes on {short(r.passed_on)}</span>
      ) : r.lifetime > 0 ? (
        <span title={`${whole(r.lifetime)} credited to the household`}>{short(r.lifetime)}</span>
      ) : (
        <span className="pt-mute">None yet</span>
      ),
  },
  { key: 'last_gift', label: 'Last gift', sort: 'last_gift', num: true, cell: (r) => (r.last_gift ? <>{money(r.last_amt)} <span className="pt-sub">{fd(r.last_gift, today)}</span></> : '') },
  { key: 'ytd', label: 'This year', sort: 'ytd', num: true, cell: (r) => (r.ytd > 0 ? whole(r.ytd) : '') },
  { key: 'l12', label: 'Last 12 months', sort: 'l12', num: true, hidden: true, cell: (r) => (r.l12 > 0 ? whole(r.l12) : '') },
  { key: 'last_year', label: 'Last year', sort: 'last_year', num: true, hidden: true, cell: (r) => (r.last_year > 0 ? whole(r.last_year) : '') },
  { key: 'largest', label: 'Largest gift', sort: 'largest', num: true, hidden: true, cell: (r) => (r.largest > 0 ? money(r.largest) : '') },
  { key: 'gifts', label: 'Gifts', sort: 'gifts', num: true, hidden: true, cell: (r) => (r.gifts ? N(r.gifts) : '') },
  { key: 'first_gift', label: 'First gift', sort: 'first_gift', firstDir: 'desc', hidden: true, cell: (r) => fd(r.first_gift, today) },
  { key: 'last_contact', label: 'Last contact', sort: 'last_contact', firstDir: 'desc', cell: (r) => (r.last_contact ? <span title={fd(r.last_contact, today)}>{ago(r.last_contact, today)}</span> : <span className="pt-mute">None logged</span>) },
  { key: 'open', label: 'Open actions', sort: 'open', num: true, cell: (r) => (r.open_actions ? N(r.open_actions) : '') },
  { key: 'codes', label: 'Constituent codes', hidden: true, className: 'is-clip', cell: (r) => pipes(r.codes).join(', ') },
  { key: 'solicit', label: 'Solicit codes', hidden: true, cell: (r) => pipes(r.solicit).join(', ') },
  ...(contacts
    ? ([
        { key: 'email', label: 'Email', hidden: true, cell: (r) => (r.hidden ? <span className="pt-mute" title="Contact details need the contacts package">Hidden</span> : r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '') },
        { key: 'phone', label: 'Phone', hidden: true, cell: (r) => (r.hidden ? <span className="pt-mute">Hidden</span> : r.phone ? <a href={`tel:${String(r.phone).replace(/[^\d+]/g, '')}`}>{r.phone}</a> : '') },
      ] as Column<DirRow>[])
    : []),
  { key: 'zip', label: 'ZIP', hidden: true, cell: (r) => r.zip || '' },
  { key: 'lookup', label: 'Lookup ID', sort: 'lookup', hidden: true, cell: (r) => r.lookup || '' },
  { key: 'added', label: 'Added', sort: 'added', firstDir: 'desc', hidden: true, cell: (r) => fd(r.added, today) },
];

function AllPartners({ search, go }: { search: DirSearch; go: (s: DirSearch) => void }) {
  const [size, setSize] = usePageSize('pd', 50);
  const [fopen, setFopen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, say] = useToast();
  const qc = useQueryClient();
  const set = (patch: Partial<DirSearch>) => {
    setSel(new Set());
    go({ ...search, ...patch, page: patch.page ?? undefined, view: patch.view ?? (Object.keys(patch).some((k) => k !== 'page') ? undefined : search.view) });
  };
  useListKeys('pd');

  // Google Sheets uses the classic exporter (public/js/sheets.js), loaded after the page paints.
  useEffect(() => {
    let off = false;
    void loadScript('/js/sheets.js?v=2').then(() => {
      if (off) return;
      const fs = (window as unknown as { FavorSheets?: { register: (n: string, f: () => Promise<unknown>) => void; screen: (t: string, tabs: unknown[], o: unknown) => unknown } }).FavorSheets;
      fs?.register('partners', async () => {
        const res = await fetch('/api/partners/export?format=json&' + dirParams(search), { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
        const d = (await res.json()) as { columns: unknown[]; rows: unknown[] };
        return fs.screen('Partners', [{ name: 'Partners', columns: d.columns, rows: d.rows }], { filters: '', classes: ['partner'] });
      });
    });
    return () => {
      off = true;
    };
  }, [search]);

  // The menus and the fundraiser id stream in after the server draws, so the first browser frame draws without them, as the server
  // did; otherwise the options can differ between the two and React throws away the server copy (error 418).
  const mounted = useMounted();
  const menus = useQuery(menusQuery);
  const m: Partial<Menus> = (mounted && menus.data) || {};
  // My partners shows only for someone who holds partners (the directory answer carries their fundraiser id), as on the classic page.
  const fid = useQuery({ ...dirQuery(search, size), enabled: false }).data?.fid;
  const showMine = mounted && !!fid;
  const exportCsv = async (ids?: string[]) => {
    const qs = dirParams(search, ids && ids.length ? { ids: ids.join(',') } : {});
    const res = await fetch('/api/partners/export?' + qs, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
    if (!res.ok) return say('The export did not finish. Try again.');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'partners-' + todayEt() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(ids ? `Exported ${N(ids.length)} partners.` : 'Exported the partners that match.');
  };

  const selectAdd = (k: ArrKey, label: string, empty: string, items?: { v: string; n: number }[]) => (
    <select className={'pt-sel' + (list(search[k]).length ? ' is-set' : '')} aria-label={label} value="" onChange={(e) => e.target.value && !list(search[k]).includes(e.target.value) && set({ [k]: [...list(search[k]), e.target.value].join(',') })}>
      <option value="">{list(search[k]).length ? 'Add ' + label.toLowerCase() : empty}</option>
      {(items || []).map((o) => (
        <option key={o.v} value={o.v}>
          {o.v} ({N(o.n)})
        </option>
      ))}
    </select>
  );

  return (
    <section className={'h-card pd-sheet' + (fopen ? ' is-fopen' : '')} aria-label="All partners">
      <div className="pt-bar pd-bar1">
        <SearchBox value={search.q || ''} onChange={(q) => set({ q: q || undefined })} placeholder="Name, email, phone, lookup ID, street, city or ZIP" label="Search partners" />
        <Suspense fallback={<Seg label="Kind" value="" onChange={() => undefined} items={[{ k: '', label: 'All' }]} />}>
          <KindSeg search={search} size={size} onPick={(k) => set({ kinds: k || undefined })} />
        </Suspense>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm pd-phf" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
          <BarIc n="filter" />
          Filters
        </button>
        <span className="pt-spacer" />
        <ViewsMenu search={search} go={go} say={say} />
        <ColumnsPart />
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-export="" title="Downloads the partners that match as a CSV file." onClick={() => void exportCsv()}>
          <BarIc n="down" />
          Export
        </button>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-sheets="partners" title="Sends this list to a Google Sheet only you can open.">
          <SheetMark />
          Sheets
        </button>
      </div>
      <div className="pt-bar pd-bar2">
        <Suspense fallback={<Seg label="Status" value="" onChange={() => undefined} items={[{ k: '', label: 'Any status' }]} />}>
          <StatusSeg search={search} size={size} onPick={(k) => set({ status: k || undefined })} />
        </Suspense>
        <select className={'pt-sel' + (search.holder ? ' is-set' : '')} aria-label="Holder" value={search.holder || ''} onChange={(e) => set({ holder: e.target.value || undefined })}>
          <option value="">Any holder</option>
          {showMine ? <option value="_mine">My partners</option> : null}
          <option value="_none">No holder</option>
          {(m.holders || []).map((h) => (
            <option key={h.v} value={h.v}>
              {h.name} ({N(h.n)})
            </option>
          ))}
        </select>
        {selectAdd('states', 'State', 'Any state', m.states)}
        <select className={'pt-sel' + (search.band ? ' is-set' : '')} aria-label="Lifetime giving" value={search.band || ''} onChange={(e) => set({ band: e.target.value || undefined })}>
          <option value="">Any lifetime</option>
          {Object.entries(m.bands || {}).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        {selectAdd('codes', 'Code', 'Any code', m.codes)}
        {selectAdd('tags', 'Tag', 'Any tag', (m.tags || []).map((t) => ({ v: t.tag, n: t.n })))}
        <button type="button" className={'h-btn h-btn--ghost h-btn--sm' + (fopen ? ' is-on' : '')} aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
          <BarIc n="filter" />
          More{moreCount(search) ? ' ' + moreCount(search) : ''}
        </button>
        <span className="pt-spacer" />
        <DensitySwitch />
      </div>
      {fopen ? <MoreFilters search={search} set={set} menus={m} /> : null}
      <Chips search={search} set={set} go={go} menus={m} />
      <Suspense fallback={<TableSkeleton />}>
        <Rows search={search} size={size} sel={sel} setSel={setSel} onPage={(p, s) => { if (s !== size) setSize(s); set({ page: p > 1 ? p : undefined }); }} onSort={(sort, dir) => set({ sort, dir })} say={say} />
      </Suspense>
      <Bulk sel={sel} clear={() => setSel(new Set())} say={say} exportCsv={exportCsv} onDone={() => void qc.invalidateQueries({ queryKey: pdKeys.all })} />
      {toast}
    </section>
  );
}

function ColumnsPart() {
  const [hidden, setHidden] = useHiddenColumns('pd', HIDE_DEFAULT);
  const today = '2000-01-01';
  return <ColumnsMenu columns={COLUMNS(today, true)} hidden={hidden} onChange={setHidden} />;
}

function TableSkeleton() {
  return (
    <div className="pt-wrap pt-wrap--fit pd-wrap" aria-busy="true">
      <table className="pt-table pd-table">
        <tbody>
          {Array.from({ length: 16 }, (_, i) => (
            <tr key={i} className="pt-loading">
              {Array.from({ length: 10 }, (_, j) => (
                <td key={j}>
                  <i />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDir(search: DirSearch, size: number) {
  const deferred = useDeferredValue({ search, size });
  const q = useSuspenseQuery(dirQuery(deferred.search, deferred.size));
  const stale = deferred.search !== search || deferred.size !== size;
  return { data: q.data, stale };
}

function KindSeg({ search, size, onPick }: { search: DirSearch; size: number; onPick: (k: string) => void }) {
  const { data } = useDir(search, size);
  const k = list(search.kinds);
  const cur = k.length === 1 ? k[0] : k.length ? '_many' : '';
  return (
    <Seg
      label="Kind"
      value={cur}
      onChange={onPick}
      items={[{ k: '', label: 'All' }, ...KINDS.map((x) => ({ k: x, label: { individual: 'Individuals', household: 'Households', organization: 'Organizations', church: 'Churches', foundation: 'Foundations' }[x] as string, n: data.facets.kinds[x] ?? 0 }))]}
    />
  );
}
function StatusSeg({ search, size, onPick }: { search: DirSearch; size: number; onPick: (k: string) => void }) {
  const { data } = useDir(search, size);
  const s = list(search.status);
  const cur = s.length === 1 ? s[0] : s.length ? '_many' : '';
  return (
    <Seg
      label="Status"
      value={cur}
      onChange={onPick}
      items={[{ k: '', label: 'Any status' }, ...(['active', 'lybunt', 'lapsed', 'never'] as const).map((x) => ({ k: x, label: STATUS[x], n: data.facets.status[x] ?? 0, title: STATUS_TIP[x] }))]}
    />
  );
}

function Rows(p: { search: DirSearch; size: number; sel: Set<string>; setSel: (s: Set<string>) => void; onPage: (p: number, s: number) => void; onSort: (s: string, d: 'asc' | 'desc') => void; say: (m: string) => void }) {
  const { data, stale } = useDir(p.search, p.size);
  const qc = useQueryClient();
  const [hidden] = useHiddenColumns('pd', HIDE_DEFAULT);
  const today = todayEt();
  const [rows, setRows] = useState<DirRow[]>(data.rows);
  useEffect(() => setRows(data.rows), [data.rows]);
  const star = async (id: string, on: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, star: on } : r)));
    try {
      await pdPost('/api/partners/stars/' + encodeURIComponent(id), { on });
      void qc.invalidateQueries({ queryKey: pdKeys.recent });
    } catch (e) {
      p.say((e as Error).message);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, star: !on } : r)));
    }
  };
  // s on the focused row stars it, like the classic list.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 's' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tr = (e.target as HTMLElement).closest?.('tr[data-id]') as HTMLElement | null;
      if (!tr || !tr.closest('[data-pt-list="pd"]')) return;
      const r = rows.find((x) => x.id === tr.dataset.id);
      if (!r) return;
      e.preventDefault();
      void star(r.id, !r.star);
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  const cols: Column<DirRow>[] = useMemo(() => {
    const c = COLUMNS(today, (data as DirAnswer).contacts);
    const starCol: Column<DirRow> = {
      key: 'star', label: '', fixed: true, className: 'pd-star', thClassName: 'pd-starth',
      cell: (r) => (
        <button type="button" className={'pd-starb' + (r.star ? ' is-on' : '')} aria-pressed={r.star} aria-label={(r.star ? 'Unstar ' : 'Star ') + r.name} title={r.star ? 'Starred (s)' : 'Star (s)'} onClick={() => void star(r.id, !r.star)}>
          <Star on={r.star} />
        </button>
      ),
    };
    return [starCol, ...c];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, data, rows]);
  const sort = { col: p.search.sort || 'name', dir: p.search.dir || 'asc' } as const;
  return (
    <>
      <DataTable<DirRow>
        listKey="pd"
        label="Partners"
        className="pd-table"
        columns={cols}
        hidden={hidden}
        rows={rows}
        rowKey={(r) => r.id}
        busy={stale}
        fit={330}
        sort={sort}
        onSort={(s) => p.onSort(s.col, s.dir)}
        select={{
          selected: p.sel,
          onToggle: (id, on) => {
            const s = new Set(p.sel);
            if (on) s.add(id);
            else s.delete(id);
            p.setSel(s);
          },
          onPage: (on) => {
            const s = new Set(p.sel);
            rows.forEach((r) => (on ? s.add(r.id) : s.delete(r.id)));
            p.setSel(s);
          },
        }}
        empty={<div className="pt-empty"><b>No partners match</b>Change the search or a filter, or clear them all.</div>}
      />
      <Pager listKey="pd" total={data.total} page={p.search.page || 1} size={data.size} noun={data.total === 1 ? 'partner' : 'partners'} onPage={p.onPage} />
      <div className="pd-foot">
        <span title="Lifetime and status follow the partner rule the KPI dashboard, Lists and the Brain use: a soft credit counts for the partner named, and spouses are one household, so both spouses show the household's figures.">
          {N(data.records)} records in Blackbaud{data.builtAt ? ', copied ' + new Date(data.builtAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}.
        </span>
        <span className="pd-keys">
          <kbd>j</kbd>
          <kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>x</kbd> select <kbd>s</kbd> star <kbd>/</kbd> search <kbd>[</kbd>
          <kbd>]</kbd> page
        </span>
      </div>
    </>
  );
}

function MoreFilters({ search, set, menus }: { search: DirSearch; set: (p: Partial<DirSearch>) => void; menus: Partial<Menus> }) {
  const add = (k: ArrKey, v: string) => v && !list(search[k]).includes(v) && set({ [k]: [...list(search[k]), v].join(',') });
  const opts = (items?: { v: string; n: number }[]) => (items || []).map((o) => <option key={o.v} value={o.v}>{o.v} ({N(o.n)})</option>);
  const tri = (k: 'deceased' | 'inactive', l: string) => (
    <label>
      <span>{l}</span>
      <select className={'pt-sel' + (search[k] ? ' is-set' : '')} value={search[k] || 'exclude'} onChange={(e) => set({ [k]: e.target.value === 'exclude' ? undefined : e.target.value })}>
        <option value="exclude">Leave out</option>
        <option value="include">Include</option>
        <option value="only">Only these</option>
      </select>
    </label>
  );
  const date = (k: 'firstFrom' | 'firstTo' | 'lastFrom' | 'lastTo', l: string) => (
    <label>
      <span>{l}</span>
      <input type="date" className="pt-sel" value={search[k] || ''} onChange={(e) => set({ [k]: e.target.value || undefined })} />
    </label>
  );
  const chk = (k: 'major' | 'recurring' | 'openActions' | 'starred', l: string) => (
    <label className="pd-chk">
      <input type="checkbox" checked={!!search[k]} onChange={(e) => set({ [k]: e.target.checked || undefined })} />
      {l}
    </label>
  );
  return (
    <div className="pd-more" role="group" aria-label="More filters">
      <label><span>Without the code</span><select className="pt-sel" value="" onChange={(e) => add('codesNot', e.target.value)}><option value="">Pick a code</option>{opts(menus.codes)}</select></label>
      <label><span>Has the solicit code</span><select className="pt-sel" value="" onChange={(e) => add('solicit', e.target.value)}><option value="">Pick a solicit code</option>{opts(menus.solicit)}</select></label>
      <label><span>Without the solicit code</span><select className="pt-sel" value="" onChange={(e) => add('solicitNot', e.target.value)}><option value="">Pick a solicit code</option>{opts(menus.solicit)}</select></label>
      {date('firstFrom', 'First gift from')}
      {date('firstTo', 'First gift to')}
      {date('lastFrom', 'Last gift from')}
      {date('lastTo', 'Last gift to')}
      <label>
        <span>No contact logged in</span>
        <select className={'pt-sel' + (search.noContactDays ? ' is-set' : '')} value={search.noContactDays || 0} onChange={(e) => set({ noContactDays: Number(e.target.value) || undefined })}>
          <option value={0}>Any time</option>
          {[30, 90, 180, 365, 730].map((n) => <option key={n} value={n}>{n === 365 ? 'a year' : n === 730 ? 'two years' : n + ' days'}</option>)}
        </select>
      </label>
      {tri('deceased', 'Deceased')}
      {tri('inactive', 'Inactive records')}
      <div className="pd-chks">
        {chk('major', 'Major partners (a $1,000 gift)')}
        {chk('recurring', 'Active recurring gift')}
        {chk('openActions', 'Has open actions')}
        {chk('starred', 'Starred by me')}
      </div>
    </div>
  );
}

function Chips({ search, set, go, menus }: { search: DirSearch; set: (p: Partial<DirSearch>) => void; go: (s: DirSearch) => void; menus: Partial<Menus> }) {
  const out: { key: string; label: string; clear: () => void }[] = [];
  const rm = (k: ArrKey, v: string) => () => set({ [k]: list(search[k]).filter((x) => x !== v).join(',') || undefined });
  if (search.q) out.push({ key: 'q', label: 'Search: ' + search.q, clear: () => set({ q: undefined }) });
  for (const v of list(search.kinds)) out.push({ key: 'k' + v, label: KIND[v] || v, clear: rm('kinds', v) });
  for (const v of list(search.status)) out.push({ key: 's' + v, label: STATUS[v] || v, clear: rm('status', v) });
  if (search.holder) out.push({ key: 'h', label: search.holder === '_mine' ? 'My partners' : search.holder === '_none' ? 'No holder' : 'Holder: ' + ((menus.holders || []).find((h) => h.v === search.holder)?.name || search.holder), clear: () => set({ holder: undefined }) });
  for (const v of list(search.states)) out.push({ key: 'st' + v, label: 'State: ' + v, clear: rm('states', v) });
  if (search.band) out.push({ key: 'b', label: 'Lifetime: ' + ((menus.bands || {})[search.band] || search.band), clear: () => set({ band: undefined }) });
  for (const v of list(search.codes)) out.push({ key: 'c' + v, label: 'Code: ' + v, clear: rm('codes', v) });
  for (const v of list(search.codesNot)) out.push({ key: 'cn' + v, label: 'Not code: ' + v, clear: rm('codesNot', v) });
  for (const v of list(search.solicit)) out.push({ key: 'so' + v, label: 'Solicit: ' + v, clear: rm('solicit', v) });
  for (const v of list(search.solicitNot)) out.push({ key: 'sn' + v, label: 'Not solicit: ' + v, clear: rm('solicitNot', v) });
  for (const v of list(search.tags)) out.push({ key: 't' + v, label: 'Tag: ' + v, clear: rm('tags', v) });
  const today = todayEt();
  if (search.firstFrom || search.firstTo) out.push({ key: 'fg', label: 'First gift ' + [search.firstFrom && 'from ' + fd(search.firstFrom, today), search.firstTo && 'to ' + fd(search.firstTo, today)].filter(Boolean).join(' '), clear: () => set({ firstFrom: undefined, firstTo: undefined }) });
  if (search.lastFrom || search.lastTo) out.push({ key: 'lg', label: 'Last gift ' + [search.lastFrom && 'from ' + fd(search.lastFrom, today), search.lastTo && 'to ' + fd(search.lastTo, today)].filter(Boolean).join(' '), clear: () => set({ lastFrom: undefined, lastTo: undefined }) });
  if (search.noContactDays) out.push({ key: 'nc', label: `No contact in ${search.noContactDays} days`, clear: () => set({ noContactDays: undefined }) });
  if (search.major) out.push({ key: 'mj', label: 'Major partners', clear: () => set({ major: undefined }) });
  if (search.recurring) out.push({ key: 'rc', label: 'Recurring gift', clear: () => set({ recurring: undefined }) });
  if (search.openActions) out.push({ key: 'oa', label: 'Has open actions', clear: () => set({ openActions: undefined }) });
  if (search.starred) out.push({ key: 'sr', label: 'Starred', clear: () => set({ starred: undefined }) });
  if (search.deceased) out.push({ key: 'dc', label: search.deceased === 'only' ? 'Deceased only' : 'With deceased', clear: () => set({ deceased: undefined }) });
  if (search.inactive) out.push({ key: 'in', label: search.inactive === 'only' ? 'Inactive only' : 'With inactive', clear: () => set({ inactive: undefined }) });
  return (
    <div className="pt-chips">
      {out.map((c) => (
        <button key={c.key} type="button" className="pt-chip" onClick={c.clear}>
          {c.label}
          <i aria-label="Remove">×</i>
        </button>
      ))}
      {out.length > 1 ? (
        <button type="button" className="pd-clear" onClick={() => go({ sort: search.sort, dir: search.dir })}>
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function ViewsMenu({ search, go, say }: { search: DirSearch; go: (s: DirSearch) => void; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const views = useQuery({ ...viewsQuery, enabled: open || !!search.view });
  const [, setHidden] = useHiddenColumns('pd', HIDE_DEFAULT);
  const vs = views.data || [];
  const cur = vs.find((v) => v.id === search.view);
  const apply = (v: SavedView) => {
    const s: DirSearch = { view: v.id };
    for (const [k, val] of Object.entries(v.spec || {})) {
      if (val === '' || val == null || val === false || (Array.isArray(val) && !val.length) || val === 'exclude' || val === 0) continue;
      if (k === 'sort' && val === 'name') continue;
      if (k === 'dir' && val === 'asc') continue;
      (s as Record<string, unknown>)[k] = Array.isArray(val) ? val.join(',') : val;
    }
    if (v.cols && v.cols.length) setHidden(new Set(COLUMNS('2000-01-01', true).map((c) => c.key).filter((k) => !v.cols.includes(k) && k !== 'name')));
    setOpen(false);
    go(s);
  };
  const save = async (name: string, all: boolean) => {
    const spec: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(search)) if (!['page', 'pane', 'view'].includes(k)) spec[k] = (ARR as readonly string[]).includes(k) ? list(String(v)) : v;
    try {
      const hiddenNow = (() => {
        try {
          return new Set<string>(JSON.parse(localStorage.getItem('pt.cols.pd') || 'null') || HIDE_DEFAULT);
        } catch {
          return new Set<string>(HIDE_DEFAULT);
        }
      })();
      const r = await pdPost<{ id: string; views: SavedView[] }>('/api/partners/views', { id: cur && cur.mine && cur.name === name ? cur.id : '', name, spec, cols: COLUMNS('2000-01-01', true).map((c) => c.key).filter((k) => !hiddenNow.has(k)), scope: all ? 'all' : 'private' });
      qc.setQueryData(viewsQuery.queryKey, r.views);
      go({ ...search, view: r.id });
      say('View saved.');
    } catch (e) {
      say((e as Error).message);
    }
  };
  const drop = async (id: string) => {
    if (!confirm('Delete this saved view?')) return;
    try {
      const r = await pdPost<{ views: SavedView[] }>('/api/partners/views/' + encodeURIComponent(id) + '/delete');
      qc.setQueryData(viewsQuery.queryKey, r.views);
      if (search.view === id) go({ ...search, view: undefined });
    } catch (e) {
      say((e as Error).message);
    }
  };
  const item = (v: SavedView) => (
    <div className="pd-vrow" key={v.id}>
      <button type="button" className={search.view === v.id ? 'is-on' : undefined} onClick={() => apply(v)}>
        {v.name}
        {v.scope === 'all' && v.mine ? <em>shared</em> : null}
        {!v.mine ? <em>{v.ownerName}</em> : null}
      </button>
      {v.mine ? (
        <button type="button" className="pd-vdel" aria-label={'Delete ' + v.name} onClick={() => void drop(v.id)}>
          ×
        </button>
      ) : null}
    </div>
  );
  return (
    <details className="pd-menu" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="h-btn h-btn--ghost h-btn--sm">
        <BarIc n="views" />
        {cur ? cur.name : 'Views'}
      </summary>
      <div className="pd-menu__list">
        {views.isLoading ? <p className="pd-mute">Loading views</p> : null}
        {vs.some((v) => v.mine) ? <h5>My views</h5> : null}
        {vs.filter((v) => v.mine).map(item)}
        {vs.some((v) => !v.mine) ? <h5>Shared with everyone</h5> : null}
        {vs.filter((v) => !v.mine).map(item)}
        {views.data && !vs.length ? <p className="pd-mute">No saved views yet.</p> : null}
        <form
          className="pd-vsave"
          onSubmit={(e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const name = (f.elements.namedItem('name') as HTMLInputElement).value.trim();
            if (name) void save(name, (f.elements.namedItem('all') as HTMLInputElement).checked);
          }}
        >
          <input name="name" maxLength={60} placeholder="Name this view" aria-label="View name" required defaultValue={cur?.mine ? cur.name : ''} />
          <label className="pd-chk">
            <input type="checkbox" name="all" defaultChecked={cur?.scope === 'all'} />
            Share with everyone
          </label>
          <button type="submit" className="h-btn h-btn--primary h-btn--sm">
            Save the filters, sort and columns
          </button>
        </form>
      </div>
    </details>
  );
}

function Bulk({ sel, clear, say, exportCsv, onDone }: { sel: Set<string>; clear: () => void; say: (m: string) => void; exportCsv: (ids?: string[]) => Promise<void>; onDone: () => void }) {
  const ids = [...sel];
  const n = ids.length;
  const tag = async () => {
    const t = prompt(`Add a tag to ${n === 1 ? 'this partner' : N(n) + ' partners'}. Tags are FavorOS labels everyone can see and filter by; they do not go to Blackbaud.`, '');
    if (!t || !t.trim()) return;
    try {
      await pdPost('/api/partners/tags', { cids: ids, tag: t });
      say(`Tagged ${N(n)} with ${t.trim()}.`);
      onDone();
    } catch (e) {
      say((e as Error).message);
    }
  };
  const star = async () => {
    try {
      await Promise.all(ids.map((id) => pdPost('/api/partners/stars/' + encodeURIComponent(id), { on: true })));
      say(`Starred ${N(n)}.`);
      onDone();
    } catch (e) {
      say((e as Error).message);
    }
  };
  const merge = async () => {
    const note = prompt('Ask for these two records to be merged. Add a note (which one to keep, why they are the same):', '');
    if (note === null) return;
    try {
      await pdPost('/api/partners/merge', { keep: ids[0], other: ids[1], note });
      say('Added to Merge requests.');
      onDone();
    } catch (e) {
      say((e as Error).message);
    }
  };
  return BodyPortal(
    // Hidden while empty: drawn into <body>, its empty padded box would peek up from the bottom edge over the phone bar.
    <div className={'pd-bulk' + (n ? ' is-on' : '')} role="region" aria-label="Selected partners" style={n ? undefined : { visibility: 'hidden' }}>
      {n ? (
        <>
          <span className="pd-bulk__n">{N(n)}</span>
          <span>selected</span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void tag()}>Add a tag</button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void star()}>Star</button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void exportCsv(ids)}>Export</button>
          {n === 2 ? <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void merge()}>Ask to merge</button> : null}
          <button type="button" className="pd-bulk__x" aria-label="Clear the selection" onClick={clear}>×</button>
        </>
      ) : null}
    </div>
  );
}
