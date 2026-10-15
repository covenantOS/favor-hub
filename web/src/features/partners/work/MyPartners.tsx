// Partners > /work/?view=mine: every partner a director holds, quiet ones first, sorted by what they give; portfolio health, the trip
// planner, Plan calls and + Task. Ported from public/js/wc-mine.js. Reads /api/work/portfolio (the D1 copy of Blackbaud) and
// /api/brief/book (portfolio health); Plan calls and + Task write through the same batches as every other Work Center change.
// On a phone each row is one line (name, days since contact, Call) and the rest opens in the side panel.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, SearchBox, SidePanel, useHiddenColumns, useListKeys, usePageSize, pageOf, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { WcDialog } from './lists/Dlg';
import { WorkToast } from './lists/toast';
import { SheetsButton, openCallMode, sheetScreen, useSheetSource } from './lists/legacy';
import { Term } from './lists/Term';
import { sendBatch } from './lists/batch';
import { partnerHref, pressRowOpen } from './lists/nav';
import { useFit } from './lists/fit';
import { contextQuery, addDays, dateWords, dayLabel, dowOf, moneyExact, moneyWhole, plural, telHref, useHeld, workGet, workPost } from './lists/core';
import { useMounted } from '../record/lib';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="mine" search={search} />

const KEY = 'mine';

interface MineRow {
  cid: string;
  lookup: string;
  name: string;
  place: string;
  quiet: number | null;
  last: { date: string; how: string } | null;
  gift: { date: string; amount: number; soft?: boolean; through?: string } | null;
  l12: number;
  p12: number;
  life: number;
  gifts: number;
  ytd: number;
  lastYear: number;
  next: { id: string; due: string; summary: string; planned?: boolean } | null;
  phone: string | null;
  dnc: boolean;
}
interface Director {
  fid: string;
  name: string;
  email: string;
  team: string;
}
interface PortfolioAnswer {
  directors: Director[];
  owner?: string;
  portfolio: { fid: string; today: string; held: number; rows: MineRow[]; stats: { held: number; quiet90: number; gaveNoContact: number; lapsed: number; noPhone: number } } | null;
  at?: string;
}
interface BookAnswer {
  counts: Record<string, number>;
  rows: { cid: string; health: string; why: string; nba?: { kind: string; label: string; why: string } }[];
}

const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export const portfolioQuery = (owner: string, as?: string) =>
  queryOptions({
    queryKey: ['work', 'portfolio', owner, as || ''],
    queryFn: () => workGet<PortfolioAnswer>('/api/work/portfolio' + (owner ? '?owner=' + encodeURIComponent(owner) : ''), as),
    staleTime: 60_000,
  });
const bookQuery = (owner: string, as?: string) =>
  queryOptions({
    queryKey: ['brief', 'book', owner, as || ''],
    queryFn: () => workGet<BookAnswer>('/api/brief/book?owner=' + encodeURIComponent(owner), as),
    staleTime: 5 * 60_000,
  });
const codesQuery = queryOptions({ queryKey: ['work', 'codes'], queryFn: () => workGet<{ me?: { type?: string }; types?: Record<string, string> }>('/api/work/codes'), staleTime: 10 * 60_000 });

export function prefetchMyPartners(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(portfolioQuery('', asOf(s)));
  void qc.prefetchQuery(contextQuery(asOf(s)));
}

export function MyPartnersView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="My partners">
        <MineBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

/* ------------------------------------------------------------------ the rules (the server's, repeated so a filter needs no round trip) */

const quietAt = (r: MineRow, n: number) => r.quiet === null || r.quiet >= n;
const TEST: Record<string, (r: MineRow) => boolean> = {
  all: () => true,
  q90: (r) => quietAt(r, 90),
  q180: (r) => quietAt(r, 180),
  gave: (r) => r.ytd > 0 && quietAt(r, 30),
  lapsed: (r) => r.lastYear > 0 && r.ytd <= 0,
  nophone: (r) => !r.phone,
};
const HL: Record<string, string> = { growing: 'Growing', steady: 'Steady', slipping: 'Slipping', lapsing: 'Lapsing', atrisk: 'At risk', new: 'New' };
const reasonOf = (r: MineRow) => moneyWhole(r.l12) + ' in 12 months, ' + (r.quiet === null ? 'no contact on record' : 'quiet ' + r.quiet + ' days');
const weekdays = (today: string, span: number) => {
  const out: string[] = [];
  for (let i = 1; i <= span; i++) {
    const d = addDays(today, i);
    if (dowOf(d) !== 0 && dowOf(d) !== 6) out.push(d);
  }
  return out;
};
const spread = (ids: string[], days: string[]) => {
  const out: Record<string, string> = {};
  ids.forEach((c, i) => {
    out[c] = days[Math.min(days.length - 1, Math.floor((i * days.length) / ids.length))];
  });
  return out;
};
const callSet = (date: string, fid: string, name: string, type: string) => ({ category: 'Phone call', type, date, summary: 'Call to check in', description: name ? 'Quiet partner. Call ' + name + ' to check in.' : '', fundraisers: [fid], completed: false, direction: 'Outbound' });

type NextOv = Record<string, MineRow['next']>;
interface Ov {
  at: number;
  next: NextOv;
}

function MineBody({ as }: { as: string }) {
  const qc = useQueryClient();
  const ctx = useSuspenseQuery(contextQuery(as)).data;
  const me = ctx.me;
  const [ownerPick, setOwnerPick] = useHeld('mine.owner', '');
  const dOwner = useDeferredValue(ownerPick);
  const { data: ans, dataUpdatedAt } = useSuspenseQuery(portfolioQuery(dOwner, as));
  const busy = dOwner !== ownerPick;
  const owner = ans.owner || '';
  // Data that streams in after the server draws is used only after mount, so the server HTML matches the first browser frame (React 418).
  const mounted = useMounted();
  const bookQ = useQuery({ ...bookQuery(owner, as), enabled: !!owner });
  const codesQ = useQuery(codesQuery);
  const book = mounted ? bookQ.data : undefined;
  const codes = mounted ? codesQ.data : undefined;
  const [f, setF] = useHeld('mine.f', 'q90');
  const [q, setQ] = useHeld('mine.q', '');
  const [sort, setSort] = useHeld<Sort>('mine.sort', { col: 'l12', dir: 'desc' });
  const [selList, setSelList] = useHeld<string[]>('mine.sel', []);
  const [ovHeld, setOv] = useHeld<Ov | null>('mine.ov', null);
  const [touched, setTouched] = useHeld('mine.touched', false);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 50);
  const [hidden, setHidden] = useHiddenColumns(KEY, []);
  const [panelCid, setPanelCid] = useState<string | null>(null);
  const [plan, setPlan] = useState<MineRow[] | null>(null);
  const [trip, setTrip] = useState(false);
  const { ref, fit } = useFit(440);
  const today = ctx.today;

  // The director a person last looked at (an admin or Support picks one) comes back in this browser tab.
  useEffect(() => {
    if (me.role === 'director' && me.fid) return;
    try {
      const saved = sessionStorage.getItem('wm.owner');
      if (saved && !ownerPick) setOwnerPick(saved);
    } catch {
      // a private window
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!owner) return;
    try {
      sessionStorage.setItem('wm.owner', owner);
    } catch {
      // a private window
    }
  }, [owner]);

  const pf = ans.portfolio;
  const directors = ans.directors || [];
  const ov = ovHeld && ovHeld.at === dataUpdatedAt ? ovHeld : { at: dataUpdatedAt, next: {} as NextOv };
  const rows = useMemo(() => (pf ? pf.rows.map((r) => (r.cid in ov.next ? { ...r, next: ov.next[r.cid] } : r)) : []), [pf, ov]);
  const hmap = useMemo(() => (book ? Object.fromEntries(book.rows.map((x) => [x.cid, x])) : null), [book]);
  const hOf = (r: MineRow) => (hmap && hmap[r.cid] ? hmap[r.cid].health : '');

  // Quiet partners first on the first visit, unless nobody is quiet.
  useEffect(() => {
    if (pf && !touched) {
      setTouched(true);
      if (!pf.stats.quiet90 && f === 'q90') setF('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const test = TEST[f] || ((r: MineRow) => f.startsWith('h:') && hOf(r) === f.slice(2));
    const out = rows.filter((r) => test(r) && (!needle || (r.name + ' ' + r.place + ' ' + r.lookup).toLowerCase().includes(needle)));
    const key: Record<string, (r: MineRow) => number | string> = {
      quiet: (r) => (r.quiet === null ? 1e9 : r.quiet),
      gift: (r) => (r.gift && r.gift.date ? Date.parse(r.gift.date) || 0 : 0),
      l12: (r) => r.l12,
      life: (r) => r.life,
      name: (r) => String(r.name || '').toLowerCase(),
    };
    const k = key[sort.col] || key.l12;
    const m = sort.dir === 'asc' ? 1 : -1;
    return out.sort((a, b) => {
      const x = k(a), y = k(b);
      return (x < y ? -1 : x > y ? 1 : 0) * m || b.life - a.life;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, f, q, sort, hmap]);

  const sig = [f, q, owner, sort.col, sort.dir].join('|');
  useEffect(() => setPage(1), [sig]);
  const curPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(list.length / size)));
  const shown = pageOf(list, curPage, size);
  useListKeys(KEY);
  const sel = useMemo(() => new Set(selList), [selList]);
  const isMine = !!me.fid && me.fid === owner;
  const nameOf = (fid: string) => directors.find((d) => d.fid === fid)?.name || 'this director';
  const typeFor = (fid: string) => (codes && ((codes.types && codes.types[fid]) || (codes.me && codes.me.type))) || 'RDD Action';

  const patchNext = (cids: string[], make: (cid: string) => MineRow['next']) =>
    setOv((prev) => {
      const base = prev && prev.at === dataUpdatedAt ? prev : { at: dataUpdatedAt, next: {} as NextOv };
      return { at: dataUpdatedAt, next: { ...base.next, ...Object.fromEntries(cids.map((c) => [c, make(c)])) } };
    });

  const addOneTask = async (r: MineRow) => {
    if (!owner) return;
    let d = addDays(today, 1);
    while (dowOf(d) === 0 || dowOf(d) === 6) d = addDays(d, 1);
    const prev = r.next;
    patchNext([r.cid], () => ({ id: 'pending', due: d, summary: 'Call to check in', planned: true }));
    const out = await sendBatch({ op: 'new', cids: [r.cid], set: callSet(d, owner, r.name, typeFor(owner)) }, 'Call task added for ' + dateWords(d, today));
    if (!out || out.failed) {
      patchNext([r.cid], () => prev);
      return;
    }
    if (isMine) void workPost('/api/work/reminders', { kind: 'plan_call', ref_id: out.batch || null, cid: r.cid, title: 'Call ' + r.name, note: reasonOf(r), when: { date: d, time: '09:00' }, source: 'plan_calls' }).catch(() => undefined);
  };

  /* ---- Open in Google Sheets ---- */
  const sheetList = useRef<MineRow[]>([]);
  sheetList.current = list;
  const filterLabel = (() => {
    const b = [['q90', '90 days'], ['q180', '180 days'], ['gave', 'Gave, not contacted'], ['lapsed', 'Gave last year, not this year'], ['nophone', 'No phone'], ['all', 'All']].find((x) => x[0] === f);
    return b ? b[1] : f.startsWith('h:') ? HL[f.slice(2)] || 'Health' : 'No phone';
  })();
  useSheetSource('work-partners', () => {
    const cols: [string, string, string][] = [['name', 'Partner', 'text'], ['lookup', 'Lookup id', 'id'], ['place', 'City', 'text'], ['last_contact', 'Last contact', 'date'], ['quiet_days', 'Days since contact', 'int'], ['last_gift', 'Last gift', 'money'], ['last_gift_date', 'Last gift date', 'date'], ['twelve', 'Last 12 months', 'money'], ['prior12', 'The 12 months before', 'money'], ['life', 'Lifetime', 'money'], ['gifts', 'Gifts', 'int'], ['next', 'Next step', 'text'], ['phone', 'Phone', 'text']];
    const out = sheetList.current.map((r) => ({
      name: r.name, lookup: r.lookup, place: r.place, last_contact: r.last ? r.last.date : '', quiet_days: r.quiet === null ? '' : r.quiet, last_gift: r.gift ? r.gift.amount : '', last_gift_date: r.gift ? r.gift.date : '',
      twelve: r.l12, prior12: r.p12, life: r.life, gifts: r.gifts, next: r.next ? (r.next.summary || 'Open task') + (r.next.due ? ' ' + r.next.due : '') : '', phone: r.phone || '',
    }));
    return sheetScreen('My partners', [{ name: 'Partners', columns: cols.map(([key, label, type]) => ({ key, label, type })), rows: out }], { filters: 'Showing: ' + filterLabel + (q ? ', search ' + q : '') + ', ' + nameOf(owner), classes: ['partner'] });
  });

  if (!pf) {
    return (
      <div className="h-card wc-gate">
        <h2>No portfolio to show</h2>
        <p>No director is set up for you here yet. Ask the technology team through Feedback.</p>
      </div>
    );
  }
  const st = pf.stats;
  const filters: [string, string, number | null, string][] = [
    ['q90', '90 days', st.quiet90, 'Quiet 90 days or more'],
    ['q180', '180 days', null, 'Quiet 180 days or more'],
    ['gave', 'Gave, not contacted', st.gaveNoContact, 'Gave this year, no contact in 30 days'],
    ['lapsed', 'Gave last year, not this year', st.lapsed, 'Gave in the calendar year before this one and has not given yet this year. The Lapsed status on the Lists page means no gift in over 24 months.'],
    ['nophone', 'No phone', st.noPhone, 'No phone to call'],
    ['all', 'All', st.held, 'Partners held'],
  ];
  const who = isMine ? 'you' : nameOf(owner);

  /* ---- the table ---- */
  const columns: Column<MineRow>[] = [
    {
      key: 'who', label: 'Partner', sort: 'name', fixed: true, className: 'c-who mp-c-who',
      cell: (r) => {
        const name = String(r.name || '').trim() || 'No name on file';
        const place = (r.place || 'No city on file') + (r.lookup ? ' · ID ' + r.lookup : '');
        const h = hOf(r);
        const x = hmap && hmap[r.cid];
        return (
          <div className="ptl-who mp-who">
            <NavLink className="pt-name wm-name" href={partnerHref(r.cid)} title={name} onClick={(e) => { if (window.matchMedia('(max-width: 860px)').matches) { e.preventDefault(); setPanelCid(r.cid); } }}>
              {name}
            </NavLink>
            {h && h !== 'steady' && x ? (
              <span className={'wm-hchip wm-hchip--' + h} title={x.why}>
                {HL[h]}
              </span>
            ) : null}
            <span className="pt-sub ptl-place" title={place}>
              {place}
            </span>
            {x && x.nba && x.nba.kind !== 'none' ? (
              <span className="wm-nba" title={x.nba.why}>
                <b>{x.nba.label}</b>
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'figure', label: '', fixed: true, className: 'mp-c-fig pt-phoneonly', thClassName: 'pt-phoneonly',
      cell: (r) => <span className={'mp-fig ' + (r.quiet === null || r.quiet >= 180 ? 'is-180' : r.quiet >= 90 ? 'is-90' : '')}>{r.quiet === null ? 'Never' : r.quiet + ' d'}</span>,
    },
    {
      key: 'quiet', label: 'Last contact', sort: 'quiet', firstDir: 'desc', className: 'c-quiet',
      title: (r) => (r.last ? dateWords(r.last.date, today, true) + ' · ' + r.last.how : 'No contact on file'),
      cell: (r) => {
        const lastTxt = r.last ? dateWords(r.last.date, today, true) + ' · ' + r.last.how : 'No contact on file';
        const cls = r.quiet === null || r.quiet >= 180 ? 'is-180' : r.quiet >= 90 ? 'is-90' : '';
        return (
          <span className={'ptl-quiet ' + cls}>
            <b>{r.quiet === null ? 'Never' : plural(r.quiet, 'day')}</b> <span className="pt-sub">{lastTxt}</span>
          </span>
        );
      },
    },
    {
      key: 'gift', label: 'Last gift', sort: 'gift', firstDir: 'desc', className: 'c-gift',
      title: (r) => (r.gift ? moneyWhole(r.gift.amount) + ' on ' + dateWords(r.gift.date, today, true) + (r.gift.soft ? ', soft credit' : '') : 'No gift'),
      cell: (r) =>
        r.gift ? (
          <>
            <b>{moneyExact(r.gift.amount)}</b>{' '}
            <span className="pt-sub">
              {dateWords(r.gift.date, today, true)}
              {r.gift.soft ? <> · <Term k="soft" label="soft credit" />{r.gift.through ? ' through ' + r.gift.through : ''}</> : null}
            </span>
          </>
        ) : (
          <span className="pt-mute">None</span>
        ),
    },
    {
      key: 'l12', label: '12 months', sort: 'l12', num: true, className: 'c-12',
      title: (r) => deltaOf(r),
      cell: (r) => (
        <>
          <b>{moneyWhole(r.l12)}</b> <span className="pt-sub">{deltaOf(r)}</span>
        </>
      ),
    },
    {
      key: 'life', label: 'Lifetime', sort: 'life', num: true, className: 'c-life',
      title: (r) => moneyWhole(r.life) + ', ' + plural(r.gifts, 'gift'),
      cell: (r) => (
        <>
          <b>{moneyWhole(r.life)}</b> <span className="pt-sub">{plural(r.gifts, 'gift')}</span>
        </>
      ),
    },
    {
      key: 'next', label: 'Next step', className: 'c-next',
      cell: (r) =>
        r.next ? (
          r.next.planned ? (
            <span className="pt-badge pt-badge--good ptl-clip" title={r.next.summary + ' · due ' + dateWords(r.next.due, today, true)}>
              {r.next.summary || 'Task'} · {dateWords(r.next.due, today)}
            </span>
          ) : (
            <span className="pt-badge ptl-clip" title={r.next.summary + ' · due ' + dateWords(r.next.due, today, true)}>
              {r.next.summary || 'Open task'}
            </span>
          )
        ) : (
          <button type="button" className="wm-addtask" onClick={() => void addOneTask(r)}>
            + Task
          </button>
        ),
    },
    {
      key: 'acts', label: '', srLabel: 'Actions', fixed: true, className: 'c-acts mp-c-acts',
      cell: (r) => {
        const name = String(r.name || '').trim() || 'No name on file';
        const callOff = r.dnc ? 'Do not call' : 'No phone to call';
        return (
          <div className="pt-acts">
            {r.phone && !r.dnc ? (
              <>
                <button type="button" className="pt-icon mp-callmode" title="Call mode" aria-label={'Call mode for ' + name} onClick={() => void openCallMode(r.cid, () => void qc.invalidateQueries({ queryKey: ['work', 'portfolio'] }))}>
                  <Ic n="phone" />
                </button>
                <a className="pt-icon mp-call" href={telHref(r.phone)} title={'Call ' + r.phone} aria-label={'Call ' + name}>
                  <Ic n="phone" />
                </a>
              </>
            ) : (
              <span className="pt-icon is-off mp-call" title={callOff} aria-label={callOff}>
                <Ic n="phone" />
              </span>
            )}
            <NavLink className="h-btn h-btn--ghost h-btn--sm mp-open" href={partnerHref(r.cid)} data-pt-open="">
              <Ic n="brief" />
              Open
            </NavLink>
            <NavLink className="h-btn h-btn--ghost h-btn--sm mp-log" href={partnerHref(r.cid)}>
              Log
            </NavLink>
          </div>
        );
      },
    },
  ];
  function deltaOf(r: MineRow) {
    return r.p12 ? (r.l12 >= r.p12 ? 'Up from ' : 'Down from ') + moneyWhole(r.p12) : r.l12 ? (r.life > r.l12 ? 'None the year before' : 'New this year') : r.life ? 'None in 12 months' : 'No gifts yet';
  }

  const panel = panelCid ? rows.find((r) => r.cid === panelCid) || null : null;
  const step = (n: number) => {
    const i = shown.findIndex((r) => r.cid === panelCid);
    if (shown[i + n]) setPanelCid(shown[i + n].cid);
  };
  const healthOn = f.startsWith('h:') ? f.slice(2) : '';
  const planHealth = healthOn && ['slipping', 'lapsing', 'atrisk'].includes(healthOn) && list.length;

  return (
    <>
      {!book ? (
        <div className="h-card wm-health" aria-busy="true">
          <b>Portfolio health</b>
          <span className="wm-nba">Reading giving rhythm</span>
        </div>
      ) : (
        <div className="h-card wm-health" role="group" aria-label="Portfolio health">
          <div className="wm-health__h">
            <b>Portfolio health</b>
            <button type="button" className="dp-link" onClick={() => setTrip(true)}>
              Trip planner
            </button>
          </div>
          <div className="wm-hrow">
            {Object.keys(HL).map((k) => (
              <button key={k} type="button" className={'wm-hbtn wm-hbtn--' + k + (healthOn === k ? ' is-on' : '')} aria-pressed={healthOn === k} onClick={() => { setF('h:' + k); setSelList([]); }}>
                <i>{(book.counts[k] || 0).toLocaleString('en-US')}</i>
                {HL[k]}
              </button>
            ))}
          </div>
          {planHealth ? (
            <button type="button" className="h-btn h-btn--primary h-btn--sm wm-plango" onClick={() => setPlan(list.slice(0, 200))}>
              <Ic n="clock" />
              Plan calls for these {Math.min(list.length, 200)}
            </button>
          ) : null}
        </div>
      )}
      <section className="h-card wc-sheet wm-sheet ptl-sheet mp-sheet" aria-label="My partners" ref={ref}>
        <div className="pt-bar">
          {directors.length > 1 ? (
            <select
              className="pt-sel pl-f"
              aria-label="Whose partners"
              value={owner}
              onChange={(e) => {
                setSelList([]);
                setF('q90');
                setOwnerPick(e.target.value);
              }}
            >
              {directors.map((d) => (
                <option key={d.fid} value={d.fid}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
          <SearchBox value={q} onChange={setQ} placeholder="Find a partner" label="Find a partner" delay={160} />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-fbtn" aria-expanded={false} onClick={(e) => e.currentTarget.closest('.mp-sheet')?.classList.toggle('is-fopen')}>
            Filters
          </button>
          <div className="pt-seg pl-f" role="group" aria-label="Show">
            {filters.map(([k, l, n, tip]) => (
              <button
                key={k}
                type="button"
                className={f === k ? 'is-on' : ''}
                aria-pressed={f === k}
                title={tip}
                onClick={() => {
                  setF(k);
                  setSelList([]);
                }}
              >
                {l}
                {n == null ? null : <span>{Number(n).toLocaleString('en-US')}</span>}
              </button>
            ))}
          </div>
          <span className="pt-spacer" />
          <span className="pl-f">
            <ColumnsMenu showFixed columns={columns} hidden={hidden} onChange={setHidden} />
          </span>
          <DensitySwitch />
          <SheetsButton name="work-partners" className="h-btn h-btn--ghost h-btn--sm pl-f" />
        </div>
        <DataTable
          listKey={KEY}
          label="My partners"
          className="ptl-table ptl-mine mp-table"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.cid}
          sort={sort}
          onSort={setSort}
          hidden={hidden}
          select={{
            selected: sel,
            onToggle: (id, on) => setSelList((s) => (on ? (s.includes(id) ? s : [...s, id]) : s.filter((x) => x !== id))),
            onPage: (on) => setSelList((s) => (on ? [...new Set([...s, ...shown.map((r) => r.cid)])] : s.filter((x) => !shown.some((r) => r.cid === x)))),
          }}
          onRowClick={(r) => {
            if (window.matchMedia('(max-width: 860px)').matches) setPanelCid(r.cid);
          }}
          onOpen={() => pressRowOpen()}
          openId={panelCid}
          busy={busy}
          fit={fit}
          empty={
            <div className="pt-empty">
              <b>{f === 'all' && !q ? 'No partners held' : 'Nobody here'}</b>
              {f === 'q90' ? 'Every partner in this list has had a contact in the last 90 days.' : 'Change the filter or the search.'}
            </div>
          }
        />
        <Pager
          listKey={KEY}
          total={list.length}
          page={curPage}
          size={size}
          onPage={(p, s) => {
            if (s !== size) setSize(s);
            setPage(p);
            ref.current?.querySelector('.pt-wrap')?.scrollTo({ top: 0 });
          }}
        />
        {selList.length ? (
          <div className="wm-bulk is-on" role="region" aria-label="Selected partners">
            <b>{selList.length} selected</b>
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setPlan(rows.filter((r) => sel.has(r.cid)))}>
              <Ic n="clock" />
              Plan calls
            </button>
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setSelList([])}>
              Clear
            </button>
          </div>
        ) : null}
        <div className="wm-foot">
          <span>
            {list.length.toLocaleString('en-US')} of {plural(st.held, 'partner')} held by {who} as RDD, Prospect Steward or Church Engagement Director. A contact is a completed call, visit or email. A mailed letter is not one.
          </span>
          <span className="copy-stamp" data-copy-stamp="" data-iso={ctx.synced || ''} />
        </div>
      </section>

      {plan ? (
        <PlanDialog
          all={plan}
          who={who}
          today={today}
          mine={isMine}
          onClose={() => setPlan(null)}
          onGo={async (ps, map, remind) => {
            setPlan(null);
            const batchOf: Record<string, string | null> = {};
            for (let i = 0; i < ps.length; i += 200) {
              const part = ps.slice(i, i + 200);
              const dates = Object.fromEntries(part.map((r) => [r.cid, map[r.cid]]));
              const out = await sendBatch({ op: 'new', cids: part.map((r) => r.cid), dates, set: callSet(dates[part[0].cid], owner, '', typeFor(owner)) }, 'Planned ' + plural(part.length, 'call'));
              if (!out || out.failed) return;
              part.forEach((r) => {
                batchOf[r.cid] = out.batch || null;
              });
            }
            patchNext(ps.map((r) => r.cid), (c) => ({ id: 'pending', due: map[c], summary: 'Call to check in', planned: true }));
            if (remind) {
              try {
                await workPost('/api/work/reminders', { items: ps.map((r) => ({ kind: 'plan_call', ref_id: batchOf[r.cid], cid: r.cid, title: 'Call ' + r.name, note: reasonOf(r), when: { date: map[r.cid], time: '09:00' }, source: 'plan_calls' })) });
              } catch (err) {
                const { showToast } = await import('./lists/toast');
                showToast('The calls are planned. The reminders did not save: ' + (err as Error).message, { look: 'wc' });
              }
            }
            setSelList([]);
          }}
        />
      ) : null}
      {trip ? (
        <TripDialog
          owner={owner}
          today={today}
          onClose={() => setTrip(false)}
          onAdd={async (cids, date, city) => {
            setTrip(false);
            const out = await sendBatch({ op: 'new', cids, set: { category: 'Meeting', type: typeFor(owner), date, summary: 'Visit while in ' + city, description: 'Planned from the trip planner.', fundraisers: [owner], completed: false } }, 'Added ' + plural(cids.length, 'visit task') + ' for ' + dateWords(date, today));
            if (out && out.ok) patchNext(cids, () => ({ id: 'pending', due: date, summary: 'Visit while in ' + city, planned: true }));
          }}
        />
      ) : null}

      <SidePanel
        open={!!panel}
        label="Partner"
        kicker="My partners"
        title={panel ? String(panel.name || '').trim() || 'No name on file' : ''}
        sub={panel ? panel.place || 'No city on file' : ''}
        onClose={() => setPanelCid(null)}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        foot={
          panel ? (
            <>
              {panel.phone && !panel.dnc ? (
                <a className="h-btn h-btn--primary" href={telHref(panel.phone)}>
                  <Ic n="phone" />
                  Call
                </a>
              ) : null}
              <NavLink className="h-btn h-btn--ghost" href={partnerHref(panel.cid)}>
                <Ic n="brief" />
                Open partner
              </NavLink>
              {!panel.next ? (
                <button type="button" className="h-btn h-btn--ghost" onClick={() => void addOneTask(panel)}>
                  + Task
                </button>
              ) : null}
            </>
          ) : null
        }
      >
        {panel ? (
          <dl>
            <dt>Last contact</dt>
            <dd>{panel.last ? dateWords(panel.last.date, today, true) + ' · ' + panel.last.how + (panel.quiet !== null ? ' (' + plural(panel.quiet, 'day') + ' ago)' : '') : 'No contact on file'}</dd>
            <dt>Last gift</dt>
            <dd>{panel.gift ? moneyWhole(panel.gift.amount) + ' on ' + dateWords(panel.gift.date, today, true) + (panel.gift.soft ? ', soft credit' + (panel.gift.through ? ' through ' + panel.gift.through : '') : '') : 'None'}</dd>
            <dt>12 months</dt>
            <dd>
              {moneyWhole(panel.l12)} · {deltaOf(panel)}
            </dd>
            <dt>Lifetime</dt>
            <dd>
              {moneyWhole(panel.life)} · {plural(panel.gifts, 'gift')}
            </dd>
            <dt>Next step</dt>
            <dd>{panel.next ? (panel.next.summary || 'Open task') + ' · due ' + dateWords(panel.next.due, today, true) : 'No task yet'}</dd>
            {hmap && hmap[panel.cid] && hOf(panel) ? (
              <>
                <dt>Health</dt>
                <dd>
                  {HL[hOf(panel)] || hOf(panel)}. {hmap[panel.cid].why}
                </dd>
              </>
            ) : null}
            {hmap && hmap[panel.cid] && hmap[panel.cid].nba && hmap[panel.cid].nba!.kind !== 'none' ? (
              <>
                <dt>Next best step</dt>
                <dd>{hmap[panel.cid].nba!.label}</dd>
              </>
            ) : null}
            <dt>Phone</dt>
            <dd>{panel.phone ? panel.phone + (panel.dnc ? ' (do not call)' : '') : 'No phone on file'}</dd>
          </dl>
        ) : null}
      </SidePanel>
    </>
  );
}

/* ------------------------------------------------------------------ Plan calls */

function PlanDialog({ all: all0, who, today, mine, onClose, onGo }: { all: MineRow[]; who: string; today: string; mine: boolean; onClose: () => void; onGo: (ps: MineRow[], map: Record<string, string>, remind: boolean) => void | Promise<void> }) {
  const all = useMemo(() => all0.slice().sort((a, b) => b.l12 - a.l12 || b.life - a.life), [all0]);
  const withTask = all.filter((r) => r.next).length;
  const [span, setSpan] = useState(14);
  const [skip, setSkip] = useState(withTask > 0 && withTask < all.length);
  const [remind, setRemind] = useState(true);
  const ps = skip ? all.filter((r) => !r.next) : all;
  const days = weekdays(today, span);
  const map = ps.length ? spread(ps.map((r) => r.cid), days) : {};
  return (
    <WcDialog onClose={onClose} label="Plan calls">
      <div className="wc-dlg__head">
        <div>
          <h2>Plan {plural(ps.length, 'call')}</h2>
          <p>One phone call task each, for {who}</p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body">
        <div className="wc-field">
          <span className="lab">Spread over</span>
          <div className="wc-choices">
            {[[7, 'This week'], [14, 'Two weeks'], [30, 'A month']].map(([n, l]) => (
              <button key={n} type="button" className={'wc-choice' + (span === n ? ' is-on' : '')} onClick={() => setSpan(n as number)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="wm-plan">
          {ps.length ? (
            ps.map((r) => (
              <div className="wm-plan__row" key={r.cid}>
                <b>{dayLabel(map[r.cid], today)}</b>
                <span>
                  Call {r.name}
                  <small>{reasonOf(r)}</small>
                </span>
              </div>
            ))
          ) : (
            <p className="wc-note">Nothing to plan.</p>
          )}
        </div>
        {withTask && withTask < all.length ? (
          <label className="wm-check2">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Leave out the {withTask} that already have a task
          </label>
        ) : null}
        {mine ? (
          <label className="wm-check2">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> Remind me at 9 AM each day
          </label>
        ) : null}
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost" />
        <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!ps.length} onClick={() => void onGo(ps, map, remind && mine)}>
          Add {plural(ps.length, 'task')}
        </button>
      </div>
    </WcDialog>
  );
}

/* ------------------------------------------------------------------ Trip planner */

interface TripStop {
  cid: string;
  name: string;
  place: string;
  miles: number;
  pick: boolean;
  slot?: { start: string; driveMin: number } | null;
  l12: number;
  quiet: number | null;
}
interface TripPlan {
  dest: { name: string; state: string };
  ask: { date: string };
  note: string;
  route?: { order: unknown[]; miles: number; driveMin: number; mapsUrl: string } | null;
  stops: TripStop[];
}
const clock12 = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return String(t || '');
  const h = Number(m[1]);
  return (h % 12 || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM');
};
const driveLabel = (min: number) => {
  const n = Number(min) || 0;
  return n < 60 ? n + ' min' : Math.floor(n / 60) + ' h ' + (n % 60 ? (n % 60) + ' min' : '');
};

function TripDialog({ owner, today, onClose, onAdd }: { owner: string; today: string; onClose: () => void; onAdd: (cids: string[], date: string, city: string) => void | Promise<void> }) {
  const [text, setText] = useState('');
  const [radius, setRadius] = useState(40);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const stops = plan ? plan.stops.filter((s, i) => s.pick || i < 12) : [];
  const go = async () => {
    if (!text.trim()) {
      setError('Say where you will be, for example Dallas on Thursday.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const d = await workPost<TripPlan>('/api/brief/trip', { text, owner, radius });
      setPlan(d);
      setPick(new Set(d.stops.filter((s) => s.pick).map((s) => s.cid)));
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    }
    setBusy(false);
  };
  return (
    <WcDialog onClose={onClose} label="Trip planner">
      <div className="wc-dlg__head">
        <div>
          <h2>Trip planner</h2>
          <p>Partners near where you will be, a route and meeting slots</p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body">
        <div className="tp-ask">
          <input type="text" id="tp-text" autoFocus placeholder="I'm in Dallas Thursday" value={text} autoComplete="off" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void go(); } }} />
          <select id="tp-rad" aria-label="How far" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {[15, 25, 40, 60, 100].map((n) => (
              <option key={n} value={n}>
                Within {n} miles
              </option>
            ))}
          </select>
          <button type="button" className="h-btn h-btn--primary" disabled={busy} onClick={() => void go()}>
            {busy ? 'Finding partners' : 'Plan the day'}
          </button>
        </div>
        {error ? (
          <p className="tp-note" style={{ color: '#8a2f1b' }}>
            {error}
          </p>
        ) : null}
        {plan ? (
          <>
            <div className="tp-where">
              <b>{plan.dest.name + ', ' + plan.dest.state}</b>
              <span>{dayLabel(plan.ask.date, today)}</span>
            </div>
            <p className="tp-note">{plan.note}</p>
            {plan.route ? (
              <div className="tp-route">
                <span>
                  {plural(plan.route.order.length, 'visit')} · {plan.route.miles} mi · {driveLabel(plan.route.driveMin)} driving
                </span>
                <a className="dp-link" href={plan.route.mapsUrl} target="_blank" rel="noopener">
                  Google Maps
                </a>
              </div>
            ) : null}
            <ul className="tp-list">
              {stops.map((s) => (
                <li className="tp-row" key={s.cid}>
                  <input
                    type="checkbox"
                    checked={pick.has(s.cid)}
                    aria-label={'Visit ' + s.name}
                    onChange={(e) =>
                      setPick((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(s.cid);
                        else n.delete(s.cid);
                        return n;
                      })
                    }
                  />
                  <div>
                    <b>
                      <NavLink href={partnerHref(s.cid)}>{s.name}</NavLink>
                    </b>
                    <small>
                      {s.place} · {Math.round(s.miles)} mi{s.slot ? ' · ' + s.slot.driveMin + ' min drive' : ''}
                    </small>
                    <small>
                      {moneyWhole(s.l12)} in 12 mo · {s.quiet === null ? 'no contact yet' : 'contact ' + s.quiet + 'd ago'}
                    </small>
                  </div>
                  <div className="tp-slot">{s.slot ? clock12(s.slot.start) : <small>Not in the route</small>}</div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost" />
        <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
          Close
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!(plan && pick.size)} onClick={() => plan && void onAdd([...pick], plan.ask.date, plan.dest.name)}>
          Add {pick.size || ''} visit {pick.size === 1 ? 'task' : 'tasks'}
        </button>
      </div>
    </WcDialog>
  );
}

