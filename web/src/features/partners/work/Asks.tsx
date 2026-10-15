// Partners > /work/?view=asks: every action tagged Amount of Ask in the last year, one row per ask in a table. Amount, partner, what the ask
// was about, when it was asked, the expected close, the director and the stage (No close date, Closing, Past the close date or Gave). Ported
// from public/js/work-asks.js. Reads GET /api/work/asks one page at a time (the D1 copy of Blackbaud, no Blackbaud calls); the status, stage,
// search, director and tagged range filters and the sort all run on the server over every ask. A row opens a side panel with the whole ask
// and the close date; the close-date chip on the row still opens the small dialog. The close date is saved with PUT /api/work/asks/:id/close,
// with Undo.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, SearchBox, SidePanel, useHiddenColumns, useListKeys, usePageSize, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { WcDialog } from './lists/Dlg';
import { WorkToast, showToast } from './lists/toast';
import { SheetsButton, openPrep, sheetScreen, useSheetSource } from './lists/legacy';
import { partnerHref } from './lists/nav';
import { useFit } from './lists/fit';
import { addDays, dateWords, moneyExact, moneyWhole, useHeld, workApi, workGet } from './lists/core';
import { N } from '../api';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="asks" search={search} />

const KEY = 'asks';
const STATUS: [string, string][] = [['open', 'Open'], ['gave', 'Gave'], ['review', 'Check amount'], ['former', 'From former staff'], ['all', 'All']];
const STAGES: [string, string][] = [['', 'All stages'], ['open', 'No close date'], ['closing', 'Closing'], ['past', 'Past the close date'], ['gave', 'Gave']];
const STAGE_NAME: Record<string, string> = { open: 'No close date', closing: 'Closing', past: 'Past the close date', gave: 'Gave' };
const SORT_CHOICES: [string, string][] = [['asked:desc', 'Newest asks first'], ['asked:asc', 'Oldest asks first'], ['amount:desc', 'Largest amount first'], ['amount:asc', 'Smallest amount first'], ['partner:asc', 'Partner A to Z'], ['close:asc', 'Close date, soonest'], ['stage:asc', 'Stage'], ['director:asc', 'Director']];

export interface AskRow {
  id: string;
  cid: string;
  name: string;
  place: string;
  amount: number;
  date: string;
  first?: string;
  line: string;
  text?: string;
  tags: number;
  review: boolean;
  state: 'open' | 'closing' | 'past' | 'gave';
  close: { date: string; by?: string } | null;
  gave: { amount: number; date: string } | null;
  ownerNames: string[];
  taggedNames: string[];
}
interface AsksAnswer {
  today: string;
  synced: string;
  days: number;
  range: string;
  owner: string;
  owners: { id: string; name: string; n: number }[];
  everyone: number;
  stats: Record<'open' | 'soon' | 'past' | 'gave', { n: number; total: number }>;
  former: { n: number };
  review: { n: number };
  counts: Record<string, { n: number }>;
  shown: number;
  matched: number;
  rows: AskRow[];
}
interface Params {
  owner: string;
  range: string;
  status: string;
  q: string;
  state: string;
  sort: string;
  dir: string;
  page: number;
  size: number;
}
const DEFAULTS: Params = { owner: '', range: '12m', status: 'open', q: '', state: '', sort: 'asked', dir: 'desc', page: 1, size: 50 };

function qs(p: Params, over: Record<string, string> = {}) {
  const u = new URLSearchParams();
  if (p.owner) u.set('owner', p.owner);
  if (p.range === 'all') u.set('range', 'all');
  u.set('status', p.status);
  if (p.q.trim()) u.set('q', p.q.trim());
  if (p.state) u.set('state', p.state);
  u.set('sort', p.sort);
  u.set('dir', p.dir);
  u.set('offset', String((p.page - 1) * p.size));
  u.set('limit', String(p.size));
  for (const [k, v] of Object.entries(over)) u.set(k, v);
  return u.toString();
}
export const asksQuery = (p: Params, as?: string) =>
  queryOptions({
    queryKey: ['work', 'asks', qs(p), as || ''],
    queryFn: () => workGet<AsksAnswer>('/api/work/asks?' + qs(p), as),
    staleTime: 30_000,
  });

const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export function prefetchAsks(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(asksQuery(DEFAULTS, asOf(s)));
}

export function AsksView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="The asks">
        <AsksBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

/* ------------------------------------------------------------------ dates */

// Easter Sunday for a year (the anonymous Gregorian algorithm).
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), dayN = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(dayN).padStart(2, '0')}`;
}
/** The quick dates the panel offers, from today. */
export function quickDates(t: string): [string, string][] {
  const y = Number(t.slice(0, 4));
  const yearEnd = `${y}-12-31` >= t ? `${y}-12-31` : `${y + 1}-12-31`;
  let after = addDays(easter(y), 1);
  if (after <= t) after = addDays(easter(y + 1), 1);
  return [['In 30 days', addDays(t, 30)], ['In 60 days', addDays(t, 60)], ['By year end', yearEnd], ['After Easter', after]];
}

/* ------------------------------------------------------------------ the tab */

function AsksBody({ as }: { as: string }) {
  const qc = useQueryClient();
  const [owner, setOwner] = useHeld('asks.owner', '');
  const [range, setRange] = useHeld('asks.range', '12m');
  const [status, setStatus] = useHeld('asks.status', 'open');
  const [q, setQ] = useHeld('asks.q', '');
  const [state, setState] = useHeld('asks.state', '');
  const [sort, setSort] = useHeld<Sort>('asks.sort', { col: 'asked', dir: 'desc' });
  const [ovHeld, setOv] = useHeld<{ at: number; close: Record<string, string | null> } | null>('asks.ov', null);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 50);
  const [hidden, setHidden] = useHiddenColumns(KEY, []);
  const [fopen, setFopen] = useState(false);
  const [sideId, setSideId] = useState<string | null>(null);
  const [sideRow, setSideRow] = useState<AskRow | null>(null);
  const [dlgId, setDlgId] = useState<string | null>(null);
  const { ref, fit } = useFit(440);

  const params: Params = { owner, range, status, q, state, sort: sort.col, dir: sort.dir, page, size };
  const key = JSON.stringify(params);
  const dKey = useDeferredValue(key);
  const busy = dKey !== key;
  const { data: d, dataUpdatedAt } = useSuspenseQuery(asksQuery(JSON.parse(dKey) as Params, as));
  const today = d.today;

  // The filter now matches fewer asks than the page number reaches (an ask moved out): go to the last page.
  useEffect(() => {
    const pages = Math.max(1, Math.ceil(d.matched / size));
    if (d.matched && page > pages) setPage(pages);
  }, [d.matched, page, size]);
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(1);
    fn(v);
  };

  const ov = ovHeld && ovHeld.at === dataUpdatedAt ? ovHeld.close : {};
  const withClose = (r: AskRow): AskRow => {
    if (!(r.id in ov) || r.state === 'gave') return r;
    const date = ov[r.id];
    return { ...r, close: date ? { date, by: '' } : null, state: !date ? 'open' : date < today ? 'past' : 'closing' };
  };
  const rows = useMemo(() => d.rows.map(withClose), [d, ov]); // eslint-disable-line react-hooks/exhaustive-deps
  const side = sideId ? rows.find((r) => r.id === sideId) || (sideRow && sideRow.id === sideId ? withClose(sideRow) : null) : null;
  useListKeys(KEY);

  const openSide = (r: AskRow) => {
    setSideId(r.id);
    setSideRow(r);
  };
  const stepSide = (n: number) => {
    const i = rows.findIndex((x) => x.id === sideId);
    if (i < 0 || !rows[i + n]) return;
    openSide(rows[i + n]);
  };
  const reload = () => qc.invalidateQueries({ queryKey: ['work', 'asks'] });

  /* ---- the close date ---- */
  const patch = (id: string, date: string | null) => setOv((p) => ({ at: dataUpdatedAt, close: { ...(p && p.at === dataUpdatedAt ? p.close : {}), [id]: date } }));
  const saveClose = async (id: string, date: string | null) => {
    let out: any;
    try {
      out = await workApi(`/api/work/asks/${encodeURIComponent(id)}/close`, { method: 'PUT', body: { date } });
    } catch (e) {
      showToast((e as Error).message, { look: 'wc' });
      return;
    }
    setDlgId(null);
    patch(id, out.close || null);
    showToast(out.close ? `Expected close ${dateWords(out.close, today, true)}` : 'Close date cleared', {
      look: 'wc',
      ms: 9000,
      undo: {
        run: async () => {
          // A previous date that has gone by cannot be set again; the ask goes back to no date then.
          const prev = out.previous && out.previous >= today ? out.previous : null;
          try {
            await workApi(`/api/work/asks/${encodeURIComponent(id)}/close`, { method: 'PUT', body: { date: prev } });
            showToast('Undone.', { look: 'wc' });
            patch(id, prev);
            void reload();
          } catch (e) {
            showToast((e as Error).message, { look: 'wc' });
          }
        },
      },
    });
    void reload();
  };

  /* ---- Open in Google Sheets: every ask the filters match, in the order on screen ---- */
  const paramsRef = useRef(params);
  paramsRef.current = params;
  useSheetSource('asks', async () => {
    const cols = [
      { key: 'status', label: 'Status', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Amount asked', type: 'money' },
      { key: 'asked', label: 'Asked on', type: 'date' }, { key: 'line', label: 'About', type: 'text' }, { key: 'close', label: 'Expected close', type: 'date' }, { key: 'gave', label: 'Gift amount', type: 'money' },
      { key: 'gavedate', label: 'Gift date', type: 'date' }, { key: 'owner', label: 'Director', type: 'text' },
    ];
    const all = await workApi<AsksAnswer>('/api/work/asks?' + qs({ ...paramsRef.current, page: 1, size: 5000 }, { offset: '0', limit: '5000' }));
    const data = all.rows.map((r) => ({ status: STAGE_NAME[r.state], partner: r.name, place: r.place, amount: r.amount, asked: r.date, line: r.line, close: r.close ? r.close.date : null, gave: r.gave ? r.gave.amount : null, gavedate: r.gave ? r.gave.date : null, owner: r.ownerNames.join(', ') }));
    return sheetScreen('Asks', [{ name: 'Asks', columns: cols, rows: data }], { filters: paramsRef.current.q ? 'Search: ' + paramsRef.current.q : '', classes: ['partner'] });
  });

  /* ---- words ---- */
  const daysFrom = (iso: string) => Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000));
  const ago = (iso: string) => {
    const n = daysFrom(iso);
    return n === 0 ? 'today' : n === 1 ? '1 day ago' : n.toLocaleString('en-US') + ' days ago';
  };
  const askedOn = (r: AskRow) => r.first || r.date;
  const directors = (r: AskRow) => (r.ownerNames && r.ownerNames.length ? r.ownerNames.join(', ') : 'No current director');
  const stageBadge = (r: AskRow, long?: boolean) =>
    r.state === 'gave' && r.gave ? (
      <span className="pt-badge pt-badge--good">
        Gave {moneyExact(r.gave.amount)} on {dateWords(r.gave.date, today, !!long)}
      </span>
    ) : r.state === 'past' ? (
      <span className="pt-badge pt-badge--warn">Past the close date</span>
    ) : r.state === 'closing' ? (
      <span className="pt-badge pt-badge--gold">Closing</span>
    ) : (
      <span className="pt-badge">No close date</span>
    );
  const chip = (r: AskRow) => {
    if (r.state === 'gave') return <span className="pt-mute">-</span>;
    const label = !r.close ? 'No close date' : r.state === 'past' ? 'Past ' + dateWords(r.close.date, today) : 'Close by ' + dateWords(r.close.date, today);
    return (
      <button type="button" className={'wa-chip' + (r.state === 'past' ? ' is-past' : !r.close ? ' is-none' : '')} aria-haspopup="dialog" aria-label={`Expected close for ${r.name}: ${label}`} onClick={() => setDlgId(r.id)}>
        <Ic n="clock" />
        {label}
      </button>
    );
  };

  const oneOwner = d.owners.length <= 1;
  const columns: Column<AsksRow>[] = [
    {
      key: 'amount', label: 'Amount', sort: 'amount', num: true, fixed: true, className: 'pa-c-amount', thClassName: 'pa-c-amount',
      cell: (r) => (
        <button type="button" className="pt-name pa-amt" data-pt-open="" aria-label={`Open the ${moneyExact(r.amount)} ask for ${r.name}`} onClick={() => openSide(r)}>
          {moneyExact(r.amount)}
        </button>
      ),
    },
    {
      key: 'partner', label: 'Partner', sort: 'partner', fixed: true, className: 'pa-c-partner', thClassName: 'pa-c-partner',
      cell: (r) => (
        <>
          <NavLink className="pt-name" href={partnerHref(r.cid)}>
            {r.name}
          </NavLink>
          {r.place ? <> <span className="pt-sub">{r.place}</span></> : null}
        </>
      ),
    },
    { key: 'about', label: 'About', phone: false, className: 'pa-c-about pa-about', thClassName: 'pa-c-about', title: (r) => r.line, cell: (r) => (r.line ? r.line : <span className="pt-mute">No note</span>) },
    {
      key: 'asked', label: 'Asked', sort: 'asked', firstDir: 'desc', phone: false, className: 'pa-c-asked', thClassName: 'pa-c-asked',
      cell: (r) => (
        <>
          {dateWords(askedOn(r), today)} <span className="pt-sub">· {ago(askedOn(r))}</span>
        </>
      ),
    },
    { key: 'close', label: 'Expected close', sort: 'close', phone: true, className: 'pa-c-close', thClassName: 'pa-c-close', cell: chip },
    { key: 'director', label: 'Director', sort: 'director', phone: false, hidden: oneOwner, className: 'pa-c-director', thClassName: 'pa-c-director', title: directors, cell: (r) => directors(r) },
    { key: 'stage', label: 'Stage', sort: 'stage', phone: true, className: 'pa-c-stage', thClassName: 'pa-c-stage', cell: (r) => stageBadge(r) },
    {
      key: 'act', label: '', srLabel: 'Prep', srClass: 'pa-vh', fixed: true, className: 'pa-c-act', thClassName: 'pa-c-act',
      cell: (r) => (
        <button type="button" className="pt-icon pa-prep" title="Call prep" aria-label={'Prep for ' + r.name} onClick={() => void openPrep(r.cid)}>
          <Ic n="brief" />
        </button>
      ),
    },
  ];
  type AsksRow = AskRow;
  // A single director's list has no Director column; the menu still offers it for lists with more than one.
  const hiddenNow = useMemo(() => (oneOwner ? new Set([...hidden, 'director']) : hidden), [hidden, oneOwner]);

  const ownerName = owner ? (d.owners.find((o) => o.id === owner) || { name: 'Director' }).name : '';
  const active: [string, string][] = [
    status !== 'open' ? ['status', (STATUS.find((x) => x[0] === status) || ['', status])[1]] : null,
    state ? ['state', STAGE_NAME[state]] : null,
    q.trim() ? ['q', 'Search: ' + q.trim()] : null,
    owner ? ['owner', ownerName] : null,
    range !== '12m' ? ['range', 'All time'] : null,
  ].filter((x): x is [string, string] => !!x);
  const unfilter = (k: string) => {
    setPage(1);
    if (k === 'status') setStatus('open');
    else if (k === 'range') setRange('12m');
    else if (k === 'state') setState('');
    else if (k === 'q') setQ('');
    else setOwner('');
  };
  const sortNow = sort.col + ':' + sort.dir;
  const sortChoices = SORT_CHOICES.some(([v]) => v === sortNow) ? SORT_CHOICES : SORT_CHOICES.concat([[sortNow, 'Sorted by ' + sort.col]]);
  const count = (k: string) => N((d.counts[k] || { n: 0 }).n);
  const tiles: [string, { n: number; total: number }, boolean][] = [['Open asks', d.stats.open, false], ['Closing in 90 days', d.stats.soon, false], ['Past the close date', d.stats.past, true], ['Gifts since the ask', d.stats.gave, false]];
  const nothing = d.matched === 0;

  return (
    <>
      <div className="h-card pa-strip" role="group" aria-label="Totals">
        {tiles.map(([l, t, warn]) => (
          <div key={l} className={'pa-stat' + (warn && t.n ? ' is-warn' : '')}>
            <b>{t.n.toLocaleString('en-US')}</b>
            <span>{l}</span>
            <em>{moneyWhole(t.total)}</em>
          </div>
        ))}
      </div>
      <section className={'h-card wc-sheet pa-sheet' + (fopen ? ' is-fopen' : '')} id="wa-sheet" aria-label="Asks" ref={ref}>
        <div className="pt-bar pa-bar" role="group" aria-label="Filter">
          <div className="pt-seg pa-f" role="group" aria-label="Status">
            {STATUS.map(([k, l]) => (
              <button key={k} type="button" className={status === k ? 'is-on' : ''} aria-pressed={status === k} onClick={() => { setPage(1); setStatus(k); }}>
                {l}
                {k === 'review' ? <> <span>{d.review.n}</span></> : k === 'former' ? <> <span>{d.former.n}</span></> : null}
              </button>
            ))}
          </div>
          <select className={'pt-sel pa-f' + (state ? ' is-set' : '')} aria-label="Stage" value={state} onChange={(e) => resetPage(setState)(e.target.value)}>
            {STAGES.map(([k, l]) => (
              <option key={k} value={k}>
                {l} ({k ? count(k) : d.shown.toLocaleString('en-US')})
              </option>
            ))}
          </select>
          <SearchBox value={q} onChange={resetPage(setQ)} placeholder="Find a partner" label="Find a partner" delay={280} />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm wa-fbtn" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
            Filters{active.length ? ' ' + active.length : ''}
          </button>
          {d.owners.length > 1 ? (
            <select className={'pt-sel pa-f' + (owner ? ' is-set' : '')} aria-label="Director" value={owner} onChange={(e) => resetPage(setOwner)(e.target.value)}>
              <option value="">Every director ({N(d.everyone)})</option>
              {d.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.n})
                </option>
              ))}
            </select>
          ) : null}
          <select className={'pt-sel pa-f' + (range === 'all' ? ' is-set' : '')} aria-label="Tagged range" value={range} onChange={(e) => resetPage(setRange)(e.target.value)}>
            <option value="12m">Last 12 months</option>
            <option value="all">All time</option>
          </select>
          <select
            className="pt-sel pa-f pa-sortsel"
            aria-label="Sort"
            value={sortNow}
            onChange={(e) => {
              const [c, dir] = e.target.value.split(':');
              setPage(1);
              setSort({ col: c, dir: dir as 'asc' | 'desc' });
            }}
          >
            {sortChoices.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className="pt-spacer" />
          <span className="pa-f pa-dens">
            <DensitySwitch />
          </span>
          <span className="pa-f pa-colsbox">
            <ColumnsMenu showFixed columns={columns} hidden={hiddenNow} onChange={setHidden} />
          </span>
          <SheetsButton grid name="asks" label="Google Sheets" title="Open in Google Sheets" className="h-btn h-btn--ghost h-btn--sm pa-f" />
        </div>
        <div className="pt-chips" aria-label="Filters set">
          {active.map(([k, l]) => (
            <button key={k} type="button" className="pt-chip" aria-label={'Clear filter: ' + l} onClick={() => unfilter(k)}>
              {l}
              <i aria-hidden="true">×</i>
            </button>
          ))}
        </div>
        {nothing ? (
          d.shown === 0 && !q.trim() && status === 'all' && !state ? (
            <div className="pt-empty">
              <b>No asks in the last year</b>An action with the Amount of Ask tag shows here.
            </div>
          ) : (
            <div className="pt-empty">
              <b>Nothing matches</b>Clear a filter above to see more asks.
            </div>
          )
        ) : (
          <DataTable
            listKey={KEY}
            label="Asks"
            className="pa-table"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            sort={sort}
            onSort={(s) => {
              setPage(1);
              setSort(s);
            }}
            hidden={hiddenNow}
            onOpen={openSide}
            openId={sideId}
            rowClassName={(r) => 'pa-row' + (r.state === 'past' ? ' is-past' : '')}
            busy={busy}
            fit={fit}
          />
        )}
        <Pager
          listKey={KEY}
          total={d.matched}
          page={page}
          size={size}
          onPage={(p, s) => {
            if (s !== size) setSize(s);
            setPage(p);
          }}
        />
        <div className="pa-foot">
          {d.shown.toLocaleString('en-US')} {d.shown === 1 ? 'ask' : 'asks'} in this view, {range === 'all' ? 'tagged at any time' : 'tagged in the last 12 months'}. An amount tagged again on the same partner within 90 days counts once. Asks are listed under the
          partner's current director. Asks on partners no current director holds sit under From former staff, and asks that look far above what the partner has given, counting gifts sent through a donor-advised fund or foundation that name them, sit under Check amount.
          Neither is in the totals. A gift of the asked amount or more after the ask moves it to Gave.
        </div>
      </section>

      {dlgId ? (
        <CloseDialog
          row={rows.find((r) => r.id === dlgId) || side}
          today={today}
          onClose={() => setDlgId(null)}
          onSave={(date) => void saveClose(dlgId, date)}
        />
      ) : null}

      <SidePanel
        open={!!side}
        label={side ? `Ask from ${side.name}` : 'Ask'}
        kicker="Ask"
        title={side ? moneyExact(side.amount) : ''}
        sub={side ? side.name + (side.place ? ' · ' + side.place : '') : ''}
        onClose={() => setSideId(null)}
        onPrev={rows.findIndex((x) => x.id === sideId) > 0 ? () => stepSide(-1) : undefined}
        onNext={rows.findIndex((x) => x.id === sideId) >= 0 && rows.findIndex((x) => x.id === sideId) < rows.length - 1 ? () => stepSide(1) : undefined}
        foot={
          side ? (
            <>
              <button type="button" className="h-btn h-btn--ghost" onClick={() => void openPrep(side.cid)}>
                <Ic n="brief" />
                Prep
              </button>
              <NavLink className="h-btn h-btn--primary" href={partnerHref(side.cid)}>
                Open partner
              </NavLink>
            </>
          ) : null
        }
      >
        {side ? (
          <>
            <dl>
              <dt>Partner</dt>
              <dd>
                <NavLink href={partnerHref(side.cid)}>{side.name}</NavLink>
              </dd>
              <dt>Place</dt>
              <dd>{side.place ? side.place : <span className="pt-mute">No city on file</span>}</dd>
              <dt>Asked on</dt>
              <dd>
                {dateWords(askedOn(side), today, true)}, {ago(askedOn(side))}
                {side.tags > 1 ? ` · tagged ${side.tags} times` : ''}
              </dd>
              <dt>Tagged by</dt>
              <dd>{side.taggedNames && side.taggedNames.length ? [...new Set(side.taggedNames)].join(', ') : <span className="pt-mute">Not recorded</span>}</dd>
              <dt>Director</dt>
              <dd>{directors(side)}</dd>
              <dt>Stage</dt>
              <dd>
                {stageBadge(side, true)}
                {side.review ? <> <span className="pt-badge pt-badge--gold">Check amount</span></> : null}
              </dd>
            </dl>
            <div className="pa-block">
              <h3>The ask</h3>
              <p className="pa-text">{side.text || side.line ? side.text || side.line : <span className="pt-mute">No note on this ask</span>}</p>
            </div>
            {side.state === 'gave' && side.gave ? (
              <div className="pa-block">
                <h3>Gift</h3>
                <p>
                  {moneyExact(side.gave.amount)} on {dateWords(side.gave.date, today, true)}, {ago(side.gave.date)}.
                </p>
              </div>
            ) : (
              <ClosePicker key={side.id + ':' + (side.close ? side.close.date : '')} row={side} today={today} onSave={(date) => void saveClose(side.id, date)} />
            )}
          </>
        ) : null}
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ the close date, in the panel and in the small dialog */

function ClosePicker({ row, today, onSave }: { row: AskRow; today: string; onSave: (date: string | null) => void }) {
  const cur = row.close ? row.close.date : '';
  const [v, setV] = useState(cur);
  return (
    <div className="pa-block">
      <h3>Expected close</h3>
      <p className="pa-now">{cur ? dateWords(cur, today, true) + (row.state === 'past' ? ' (past)' : '') : 'No date yet'}</p>
      <div className="wa-quick">
        {quickDates(today).map(([l, d]) => (
          <button key={d} type="button" className={'wa-q' + (cur === d ? ' is-on' : '')} onClick={() => onSave(d)}>
            <span>{l}</span>
            <em>{dateWords(d, today, true)}</em>
          </button>
        ))}
      </div>
      <label className="wa-date">
        <span>Pick a date</span>
        <input type="date" id="pa-date" min={today} value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <div className="wa-foot2">
        {cur ? (
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => onSave(null)}>
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className="h-btn h-btn--primary"
          onClick={() => {
            if (v) onSave(v);
            else showToast('Pick a date or one of the dates above.', { look: 'wc' });
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function CloseDialog({ row, today, onClose, onSave }: { row: AskRow | null; today: string; onClose: () => void; onSave: (date: string | null) => void }) {
  const [v, setV] = useState(row && row.close ? row.close.date : '');
  if (!row) return null;
  const cur = row.close ? row.close.date : '';
  return (
    <WcDialog onClose={onClose} label="Expected close">
      <div className="wc-dlg__head">
        <div>
          <span className="h-label">Asks</span>
          <h2>Expected close</h2>
          <p className="wa-dsub">
            {row.name} · {moneyExact(row.amount)}
          </p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body wa-panel">
        <div className="wa-quick">
          {quickDates(today).map(([l, d]) => (
            <button key={d} type="button" className={'wa-q' + (cur === d ? ' is-on' : '')} onClick={() => onSave(d)}>
              <span>{l}</span>
              <em>{dateWords(d, today, true)}</em>
            </button>
          ))}
        </div>
        <label className="wa-date">
          <span>Pick a date</span>
          <input type="date" id="wa-date" min={today} value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        <div className="wa-foot2">
          <span>{cur ? 'Now ' + dateWords(cur, today, true) : 'No date yet'}</span>
          {cur ? (
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => onSave(null)}>
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="h-btn h-btn--primary"
            onClick={() => {
              if (v) onSave(v);
              else showToast('Pick a date or one of the dates above.', { look: 'wc' });
            }}
          >
            Save
          </button>
        </div>
      </div>
    </WcDialog>
  );
}

