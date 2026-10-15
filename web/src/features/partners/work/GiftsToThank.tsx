// Partners > /work/?view=gifts: every gift on the partners a director holds, soft credits included, until someone thanks it. The gifts on the
// 24-hour clock come first, least time left first; gifts whose clock ran out more than a day ago fold under Older. Row buttons: Call, Prep
// (the call-prep brief), Thank (a short form). Pick many and thank them by letter or email. Ported from public/js/work-gifts.js.
// Reads GET /api/work/gifts (the D1 copy of Blackbaud, no Blackbaud calls); thank-yous go through ./lists/thank.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { DataTable, DensitySwitch, Pager, SearchBox, SidePanel, useListKeys, usePageSize, pageOf, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { BulkThankDialog, ThankPop, THANKED_EVENT, type How, type ThankedDetail, type ThankGift } from './lists/thank';
import { WorkToast } from './lists/toast';
import { SheetsButton, openLetter, openPrep, sheetScreen, useSheetSource } from './lists/legacy';
import { Term } from './lists/Term';
import { clockWords } from './lists/clock';
import { useFit } from './lists/fit';
import { N } from '../api';
import { contextQuery, dateWords, moneyExact, moneyWhole, onPhone, telHref, useHeld, useMinute, workGet, initialsOf } from './lists/core';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="gifts" search={search} />

const KEY = 'wc-gifts';

interface Partner {
  name: string;
  kind: string;
  place: string | null;
  lifetime: number;
  count: number;
  lastContact: string | null;
  phone: string | null;
  doNotCall: boolean;
  deceased: boolean;
}
interface GiftRow {
  key: string;
  giftId: string;
  cid: string;
  amount: number;
  date: string;
  ageDays: number;
  hours: number;
  clock: { due: string; mins: number; state: string } | null;
  pay: string;
  fund: string;
  soft: { giver: string } | null;
  partner: Partner;
  badges: string[];
  owners: string[];
  team: string;
  taskIds: string[];
  left: { date: string; by?: string } | null;
  ownerNames: string[];
}
interface GiftsAnswer {
  today: string;
  synced: string;
  days: number;
  owner: string;
  everyone: number;
  owners: { id: string; name: string; n: number }[];
  rows: GiftRow[];
  stats: { week: number };
  shelf: { giftId: string; cid: string; name: string; how: string }[];
}

const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export const giftsQuery = (owner: string, as?: string) =>
  queryOptions({
    queryKey: ['work', 'gifts', owner, as || ''],
    queryFn: () => workGet<GiftsAnswer>('/api/work/gifts' + (owner ? '?owner=' + encodeURIComponent(owner) : ''), as),
    staleTime: 30_000,
  });

export function prefetchGiftsToThank(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(giftsQuery('', asOf(s)));
  void qc.prefetchQuery(contextQuery(asOf(s)));
}

export function GiftsToThankView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="Gifts to thank">
        <GiftsBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

/* ------------------------------------------------------------------ the rules */

const isFirst = (r: GiftRow) => r.badges.some((b) => /first/i.test(b));
const nameOf = (r: GiftRow) => r.partner.name;
const dueDay = (r: GiftRow) => (r.clock && r.clock.due ? new Date(Date.parse(r.clock.due)).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : r.date);
const agoWords = (r: GiftRow) => (r.ageDays === 0 ? 'Today' : r.ageDays === 1 ? 'Yesterday' : Number(r.ageDays).toLocaleString('en-US') + ' days');

interface Overlay {
  at: number;
  gone: string[];
  left: Record<string, { date: string; by: string; how?: string }>;
  shelf: { giftId: string; cid: string; name: string; how: string }[];
  week: number;
}
const freshOverlay = (at: number, d: GiftsAnswer): Overlay => ({ at, gone: [], left: {}, shelf: (d.shelf || []).map((s) => ({ giftId: s.giftId, cid: s.cid, name: s.name, how: s.how })), week: 0 });

function GiftsBody({ as }: { as: string }) {
  const qc = useQueryClient();
  const ctx = useSuspenseQuery(contextQuery(as)).data;
  const [owner, setOwner] = useHeld('gifts.owner', '');
  const dOwner = useDeferredValue(owner);
  const { data: d, dataUpdatedAt } = useSuspenseQuery(giftsQuery(dOwner, as));
  const busy = dOwner !== owner;
  const [quick, setQuick] = useHeld('gifts.quick', '');
  const [q, setQ] = useHeld('gifts.q', '');
  const [olderOpen, setOlderOpen] = useHeld('gifts.older', false);
  const [sort, setSort] = useHeld<Sort>('gifts.sort', { col: 'due', dir: 'asc' });
  const [selList, setSelList] = useHeld<string[]>('gifts.sel', []);
  const [ovHeld, setOv] = useHeld<Overlay | null>('gifts.ov', null);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 50);
  const [leaving, setLeaving] = useState<string[]>([]);
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [pop, setPop] = useState<{ anchor: HTMLElement; gift: ThankGift; owner?: string } | null>(null);
  const [bulk, setBulk] = useState<How | null>(null);
  const [fopen, setFopen] = useState(false);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const { ref, fit } = useFit(360);
  const nowMin = useMinute();

  const ov = ovHeld && ovHeld.at === dataUpdatedAt ? ovHeld : freshOverlay(dataUpdatedAt, d);
  const gone = useMemo(() => new Set(ov.gone), [ov]);
  const sel = useMemo(() => new Set(selList), [selList]);
  const me = ctx.me;
  const mayLetter = me.role === 'admin' || me.role === 'support';
  const today = d.today;

  // Server time, read off the clock the server sent, so the first draw in the browser matches the one the server made.
  const serverNow = useMemo(() => {
    const r = d.rows.find((x) => x.clock && x.clock.due && typeof x.clock.mins === 'number');
    return r ? Date.parse(r.clock!.due) - r.clock!.mins * 60000 : 0;
  }, [d]);
  const now = nowMin || serverNow;
  const minsLeft = (r: GiftRow) => (r.clock && r.clock.due ? Math.round((Date.parse(r.clock.due) - now) / 60000) : 24 * 60 - r.hours * 60);
  const isLate = (r: GiftRow) => minsLeft(r) <= 0;
  const isOlder = (r: GiftRow) => minsLeft(r) <= -24 * 60;
  // Soonest due day first, the largest gift first within a day; then the ones that ran out, then Older, newest first.
  const byClock = (a: GiftRow, b: GiftRow) => {
    const ma = minsLeft(a), mb = minsLeft(b);
    const ra = ma > 0 ? 0 : ma > -1440 ? 1 : 2, rb = mb > 0 ? 0 : mb > -1440 ? 1 : 2;
    if (ra !== rb) return ra - rb;
    const da = dueDay(a), db = dueDay(b);
    if (da !== db) return ra === 0 ? (da < db ? -1 : 1) : da < db ? 1 : -1;
    return b.amount - a.amount || ma - mb || (a.key < b.key ? -1 : 1);
  };

  const all = useMemo(() => d.rows.filter((r) => !gone.has(r.key)), [d, gone]);
  const quickOf = (r: GiftRow) => (quick === 'late' ? isLate(r) : quick === 'first' ? isFirst(r) : quick === 'big' ? r.amount >= 1000 : true);
  const list = all.filter((r) => quickOf(r) && (!q || (r.partner.name + ' ' + r.fund).toLowerCase().includes(q.toLowerCase()))).sort(byClock);
  const curL = list.filter((r) => !isOlder(r));
  const oldL = list.filter(isOlder);
  const showOlder = olderOpen || !curL.length;
  const grouped = sort.col === 'due' && sort.dir === 'asc';
  const pool = useMemo(() => {
    const src = (showOlder ? list : curL).slice();
    const m = sort.dir === 'asc' ? 1 : -1;
    const by: Record<string, (a: GiftRow, b: GiftRow) => number> = {
      due: byClock,
      amount: (a, b) => a.amount - b.amount || byClock(a, b),
      partner: (a, b) => nameOf(a).localeCompare(nameOf(b)) || byClock(a, b),
      fund: (a, b) => String(a.fund).localeCompare(String(b.fund)) || byClock(a, b),
    };
    return src.sort((a, b) => (by[sort.col] || byClock)(a, b) * m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, gone, quick, q, showOlder, sort, now]);

  // Back to page 1 when the filter, search, director, sort or Older switch changes.
  const sig = [quick, q, owner, showOlder, sort.col, sort.dir].join('|');
  useEffect(() => setPage(1), [sig]);
  const curPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(pool.length / size)));
  const pageRows = pageOf(pool, curPage, size);
  useListKeys(KEY);

  const late = all.filter(isLate).length;
  const first = all.filter(isFirst).length;
  const big = all.filter((r) => r.amount >= 1000).length;
  const stats: [string, string, number, boolean, boolean][] = [
    ['', 'To thank', all.length, false, false],
    ['late', 'Overdue', late, true, false],
    ['first', 'First gifts', first, false, false],
    ['big', '$1,000 and up', big, false, false],
    ['', 'Thanked this week', d.stats.week + ov.week, false, true],
  ];
  const who = d.owners.length > 1 || me.role === 'admin' ? "directors' partners" : 'your partners';

  /* ---- what a thank-you saved anywhere does to this list ---- */
  const live = useRef({ d, ov, dataUpdatedAt, today });
  live.current = { d, ov, dataUpdatedAt, today };
  useEffect(() => {
    const apply = (fn: (o: Overlay) => Overlay) =>
      setOv((prev) => {
        const cur = live.current;
        const base = prev && prev.at === cur.dataUpdatedAt ? prev : freshOverlay(cur.dataUpdatedAt, cur.d);
        return fn(base);
      });
    const onThanked = (e: Event) => {
      const dt = ((e as CustomEvent).detail || {}) as ThankedDetail;
      const cur = live.current;
      const keys = (dt.items || []).map((i) => `${i.giftId}:${i.cid}`);
      const goneNow: string[] = [];
      for (const g of dt.gone || []) for (const r of cur.d.rows) if (r.giftId === String(g)) goneNow.push(r.key);
      if (dt.left) {
        apply((o) => ({ ...o, gone: [...o.gone, ...goneNow], left: { ...o.left, ...Object.fromEntries(keys.map((k) => [k, { date: cur.today, by: 'you', how: dt.how }])) } }));
        return;
      }
      const settle = () => {
        apply((o) => {
          const next = { ...o, gone: [...o.gone, ...goneNow], shelf: o.shelf.slice() };
          for (const k of keys) {
            const r = cur.d.rows.find((x) => x.key === k);
            if (!r || next.gone.includes(k)) continue;
            next.gone.push(k);
            next.week += 1;
            next.shelf.push({ giftId: r.giftId, cid: r.cid, name: r.partner.name, how: dt.how || '' });
          }
          return next;
        });
        setSelList((s) => s.filter((k) => !keys.includes(k)));
        setLeaving([]);
      };
      if (keys.length) {
        setLeaving(keys);
        setTimeout(settle, 380);
      } else settle();
    };
    const reload = () => void qc.invalidateQueries({ queryKey: ['work', 'gifts'] });
    document.addEventListener(THANKED_EVENT, onThanked);
    document.addEventListener('favor:thanked-failed', reload);
    document.addEventListener('favor:thanked-undone', reload);
    return () => {
      document.removeEventListener(THANKED_EVENT, onThanked);
      document.removeEventListener('favor:thanked-failed', reload);
      document.removeEventListener('favor:thanked-undone', reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  /* ---- Open in Google Sheets ---- */
  const sheetRows = useRef<GiftRow[]>([]);
  sheetRows.current = list;
  useSheetSource('gifts-to-thank', () => {
    const cols = [
      { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'date', label: 'Gift date', type: 'date' }, { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'fund', label: 'Fund', type: 'text' }, { key: 'how', label: 'Paid by', type: 'text' }, { key: 'badges', label: 'Notes', type: 'text' }, { key: 'owner', label: 'Director', type: 'text' }, { key: 'last', label: 'Last contact', type: 'date' },
    ];
    const rows = sheetRows.current.map((r) => ({ partner: nameOf(r), place: r.partner.place, date: r.date, amount: r.amount, fund: r.fund, how: r.pay, badges: r.badges.join(', '), owner: r.ownerNames.join(', '), last: r.partner.lastContact || null }));
    return sheetScreen('Gifts to thank', [{ name: 'Gifts to thank', columns: cols, rows }], { filters: quick ? 'Filter: ' + quick : '', classes: ['partner'] });
  });

  /* ---- actions ---- */
  const asGift = (r: GiftRow): ThankGift => ({ team: r.team, giftId: r.giftId, cid: r.cid, name: nameOf(r), amount: r.amount, date: r.date, fund: r.fund, phone: r.partner.phone, left: ov.left[r.key] || r.left, tasks: r.taskIds && r.taskIds.length });
  const leftOf = (r: GiftRow) => ov.left[r.key] || r.left;
  const openThank = (el: HTMLElement, r: GiftRow) => setPop({ anchor: el, gift: asGift(r), owner: owner || (r.owners && r.owners[0]) });
  const prep = (r: GiftRow) => void openPrep(r.cid, { gift: r.key });
  const letter = (r: GiftRow) => void openLetter([asGift(r)], { from: owner || (r.owners && r.owners[0]) || '' });
  const toggleSel = (k: string, on: boolean) => setSelList((s) => (on ? (s.includes(k) ? s : [...s, k]) : s.filter((x) => x !== k)));
  const toggleMany = (keys: string[], on: boolean) => setSelList((s) => (on ? [...new Set([...s, ...keys])] : s.filter((x) => !keys.includes(x))));
  const selected = selList.map((k) => all.find((r) => r.key === k)).filter((r): r is GiftRow => !!r);
  const openDrill = (tile: string, n: number) => {
    const w = window as unknown as { FavorDrill?: { open: (o: unknown) => void } };
    if (!w.FavorDrill) return;
    const T: Record<string, [string, (r: GiftRow) => boolean]> = {
      '': ['Gifts to thank', () => true],
      late: ['Gifts past the 24-hour clock', isLate],
      first: ['First gifts to thank', isFirst],
      big: ['Gifts of $1,000 and up to thank', (r) => r.amount >= 1000],
    };
    const t = T[tile];
    if (!t) return;
    const rows = all.filter(t[1]).map((r) => ({ date: r.date, partner: r.partner.name, place: r.partner.place || '', amount: r.amount, fund: r.fund || '', waiting: r.ageDays, notes: r.badges.join(', ') }));
    w.FavorDrill.open({
      title: t[0], shown: n, shownType: 'int', shownLabel: 'On Gifts to thank', defs: ['Gifts to thank'],
      columns: [
        { key: 'date', label: 'Gift date', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Gift', type: 'money' },
        { key: 'fund', label: 'Fund', type: 'text' }, { key: 'waiting', label: 'Days waiting', type: 'int' }, { key: 'notes', label: 'Notes', type: 'text' },
      ],
      rows, total: rows.length, totalLabel: 'Gifts behind it', rowsLabel: 'Gifts in this count', sheetTitle: t[0] + ' rows',
    });
  };

  /* ---- the table ---- */
  const columns: Column<GiftRow>[] = [
    {
      key: 'amount', label: 'Gift', sort: 'amount', firstDir: 'desc', fixed: true, phone: true, className: 'gt-c-amt',
      cell: (r) => <b className={'gt-amt' + (moneyExact(r.amount).length > 10 ? ' is-long' : '')}>{moneyExact(r.amount)}</b>,
    },
    {
      key: 'due', label: 'Due', sort: 'due', fixed: true, phone: false, className: 'gt-c-due',
      cell: (r) => {
        const c = clockWords(r.clock && r.clock.due, now);
        if (!c.label || isOlder(r)) return <small className={'gt-clock' + (r.ageDays > 1 ? ' is-late' : '')}>{dateWords(r.date, today)} · {agoWords(r)}</small>;
        return <small className={'gt-clock' + (c.late ? ' is-late' : c.soon ? ' is-soon' : '')}>{c.label}</small>;
      },
    },
    {
      key: 'partner', label: 'Partner', sort: 'partner', fixed: true, phone: true, className: 'gt-c-who',
      cell: (r) => {
        const p = r.partner;
        const ctx2 = [p.count > 0 ? 'Lifetime ' + moneyWhole(p.lifetime) + ' · ' + p.count.toLocaleString('en-US') + (p.count === 1 ? ' gift' : ' gifts') : '', p.lastContact ? 'Last contact ' + dateWords(p.lastContact, today) : 'No contact yet'].filter(Boolean).join(' · ');
        return (
          <div className="gt-who">
            {d.owners.length > 1 && !d.owner ? (
              <span className="wg-who">
                {r.ownerNames.map((n, i) => (
                  <span key={n + i}>
                    <span className="wg-ini">{initialsOf(n)}</span>
                    {n}
                    {i < r.ownerNames.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </span>
            ) : null}
            <NavLink className="pt-name wg-name" href={'/work/partner/' + r.cid} title={nameOf(r)} onClick={(e) => { if (onPhone()) { e.preventDefault(); setPanelKey(r.key); } }}>
              {nameOf(r)}
            </NavLink>
            <span className="wg-sub gt-sub" title={ctx2}>
              {p.place ? p.place + ' · ' : ''}
              {ctx2}
              {r.soft ? ` · Given through ${r.soft.giver}` : ''}
            </span>
          </div>
        );
      },
    },
    {
      key: 'fund', label: 'Fund', sort: 'fund', fixed: true, phone: false, className: 'gt-c-fund',
      cell: (r) => {
        const left = leftOf(r);
        return (
          <div className="gt-fund">
            <b>{r.fund}</b>
            <span className="wg-sub">{r.pay === 'Other' ? <Term k="other" label="Other" /> : r.pay || ''}</span>
            <div className="wg-badges">
              {r.badges.map((b) => (
                <span key={b} className={'wc-tag ' + (/first/i.test(b) ? 'wc-tag--done' : /largest|\$1,000/i.test(b) ? 'wc-tag--gift' : /soft/i.test(b) ? 'wc-tag--maybe' : '')}>
                  {/^soft credit$/i.test(b) ? <Term k="soft" /> : b}
                </span>
              ))}
              {r.taskIds && r.taskIds.length ? <span className="wc-tag" title="An open thank-you task for this gift closes with the thank-you">Task open</span> : null}
              {left ? (
                <span className="wc-tag wc-tag--queued" title={left.by || ''}>
                  Left a message {dateWords(left.date, today)}
                </span>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      key: 'acts', label: '', fixed: true, phone: true, className: 'c-acts gt-c-acts',
      cell: (r) => {
        const p = r.partner;
        return (
          <div className="pt-acts">
            {p.phone && !p.doNotCall ? (
              <a className="pt-icon gt-call" href={telHref(p.phone)} title={'Call ' + p.phone} aria-label={'Call ' + nameOf(r)}>
                <Ic n="phone" />
              </a>
            ) : (
              <span className="pt-icon is-off gt-call" title={p.doNotCall ? 'Do not call' : 'No phone to call'}>
                <Ic n="phone" />
              </span>
            )}
            <button type="button" className="h-btn h-btn--ghost h-btn--sm gt-prep" onClick={() => prep(r)}>
              <Ic n="brief" />
              Prep
            </button>
            {mayLetter ? (
              <button type="button" className="h-btn h-btn--ghost h-btn--sm gt-letter" onClick={() => letter(r)}>
                <Ic n="letter" />
                Letter
              </button>
            ) : null}
            <button type="button" className="h-btn h-btn--primary h-btn--sm gt-thank" onClick={(e) => openThank(e.currentTarget, r)}>
              <Ic n="check" />
              Thank
              <Ic n="down" className="wg-caret" />
            </button>
          </div>
        );
      },
    },
  ];

  const groupHead = grouped
    ? (row: GiftRow, prev: GiftRow | undefined) => {
        const old = isOlder(row);
        if (prev && isOlder(prev) === old) return null;
        const ids = (old ? oldL : curL).map((r) => r.key);
        const every = ids.length > 0 && ids.every((k) => sel.has(k));
        return old ? (
          <div className="wg-group wg-group--older is-open">
            <span>Older · {oldL.length.toLocaleString('en-US')}</span>
            <button type="button" onClick={() => toggleMany(ids, !every)}>
              Select all
            </button>
          </div>
        ) : (
          <div className="wg-group">
            <span>On the 24-hour clock · {curL.length.toLocaleString('en-US')}</span>
            <button type="button" onClick={() => toggleMany(ids, !every)}>
              Select all
            </button>
          </div>
        );
      }
    : undefined;

  const panelRow = panelKey ? all.find((r) => r.key === panelKey) || null : null;
  const stepPanel = (n: number) => {
    const i = pageRows.findIndex((r) => r.key === panelKey);
    const next = pageRows[i + n];
    if (next) setPanelKey(next.key);
  };

  return (
    <>
      <div className="h-card wc-band wg-band" style={{ ['--n' as string]: 5 }}>
        {stats.map(([k, l, n, warn, plain]) =>
          plain ? (
            <button key={l} type="button" className={'wc-stat' + (warn && n ? ' is-warn' : '')}>
              <b>{N(n)}</b>
              <span>{l}</span>
            </button>
          ) : (
            <div key={l} className={'wc-stat wc-stat--split' + (k && quick === k ? ' is-on' : !k && !quick ? ' is-on' : '') + (warn && n ? ' is-warn' : '')}>
              <button type="button" className="wc-stat__n" aria-label={`${n} ${l}, open the gifts behind it`} onClick={() => openDrill(k, n)}>
                <b>{N(n)}</b>
              </button>
              <button type="button" className="wc-stat__l" onClick={() => setQuick(quick === k ? '' : k)}>
                <span>{l}</span>
              </button>
            </div>
          )
        )}
      </div>
      <section className={'h-card wc-sheet gt-sheet' + (fopen ? ' is-fopen' : '')} id="wg-sheet" aria-label="Gifts to thank" ref={ref}>
        <div className="pt-bar wg-tools">
          <SearchBox value={q} onChange={setQ} placeholder="Find a partner" label="Find a partner" delay={160} />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-fbtn" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
            Filters{owner || olderOpen ? ' ' + ((owner ? 1 : 0) + (olderOpen ? 1 : 0)) : ''}
          </button>
          {d.owners.length > 1 ? (
            <select
              className={'pt-sel wc-sel pl-f' + (owner ? ' is-set' : '')}
              aria-label="Director"
              value={owner}
              onChange={(e) => {
                setSelList([]);
                setOwner(e.target.value);
              }}
            >
              <option value="">Every director ({N(d.everyone)})</option>
              {d.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({N(o.n)})
                </option>
              ))}
            </select>
          ) : null}
          {oldL.length && curL.length ? (
            <button type="button" className={'h-btn h-btn--ghost h-btn--sm pl-f wg-oldbtn' + (showOlder ? ' is-on' : '')} aria-pressed={showOlder} onClick={() => setOlderOpen(!olderOpen)}>
              Older gifts <b>{oldL.length.toLocaleString('en-US')}</b>
            </button>
          ) : null}
          <span className="pt-spacer" />
          <DensitySwitch />
          <SheetsButton name="gifts-to-thank" className="h-btn h-btn--ghost h-btn--sm pl-f" />
        </div>
        <DataTable
          listKey={KEY}
          label="Gifts to thank"
          className="ptl-table gt-table"
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.key}
          sort={sort}
          onSort={setSort}
          select={{
            selected: sel,
            onToggle: (id, on, shift) => {
              if (shift && anchorKey) {
                const a = pageRows.findIndex((r) => r.key === anchorKey);
                const b = pageRows.findIndex((r) => r.key === id);
                if (a >= 0 && b >= 0) {
                  toggleMany(pageRows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.key), on);
                  return;
                }
              }
              setAnchorKey(id);
              toggleSel(id, on);
            },
            onPage: (on) => toggleMany(pageRows.map((r) => r.key), on),
          }}
          onOpen={(r) => (onPhone() ? setPanelKey(r.key) : prep(r))}
          rowClassName={(r) => 'gt-row' + (leaving.includes(r.key) ? ' is-leaving' : '')}
          groupHead={groupHead}
          openId={panelKey}
          busy={busy}
          fit={fit}
          empty={
            <div className="wg-empty">
              <b>{all.length ? 'Nothing matches' : 'All thanked'}</b>
              {all.length ? 'Clear the filter above to see the rest.' : 'New gifts show here after the Blackbaud copy refreshes at 5 AM and 5 PM.'}
            </div>
          }
        />
        {ov.shelf.length ? (
          <div className="wg-done">
            <span>Thanked today</span>
            {ov.shelf.map((t, i) => (
              <span key={t.giftId + ':' + i} className="wc-tag wc-tag--done">
                {t.name} · {t.how}
              </span>
            ))}
          </div>
        ) : null}
        <div className="wg-foot">
          <Pager
            listKey={KEY}
            total={pool.length}
            page={curPage}
            size={size}
            onPage={(p, s) => {
              if (s !== size) setSize(s);
              setPage(p);
              ref.current?.querySelector('.pt-wrap')?.scrollTo({ top: 0 });
            }}
            noun={`gifts on ${who}, soft credits included, from the last ${d.days} days${me.role === 'partner_care' ? '. First gifts and gifts under $1,000 on partners Partner Care holds' : ''}`}
          />
        </div>
      </section>

      {selList.length > 0 ? (
        <div className="wg-bulk is-on" id="wg-bulk" role="region" aria-label="Selected gifts">
          <b>{selList.length} selected</b>
          {mayLetter ? (
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => selected.length && void openLetter(selected.map(asGift), { from: owner || '' })}>
              <Ic n="letter" />
              Letters, one PDF
            </button>
          ) : null}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => selected.length && setBulk('letter')}>
            <Ic n="letter" />
            Thank by letter
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => selected.length && setBulk('email')}>
            <Ic n="mail" />
            Thank by email
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setSelList([])}>
            Clear
          </button>
        </div>
      ) : null}

      {pop ? <ThankPop anchor={pop.anchor} gift={pop.gift} owner={pop.owner} today={today} onClose={() => setPop(null)} /> : null}
      {bulk ? <BulkThankDialog gifts={selected.map(asGift)} how={bulk} owner={owner || undefined} today={today} onClose={() => setBulk(null)} onDone={() => setSelList([])} /> : null}

      <SidePanel
        open={!!panelRow}
        label="Gift to thank"
        kicker="Gift to thank"
        title={panelRow ? moneyExact(panelRow.amount) : ''}
        sub={panelRow ? nameOf(panelRow) + (panelRow.partner.place ? ' · ' + panelRow.partner.place : '') : ''}
        onClose={() => setPanelKey(null)}
        onPrev={() => stepPanel(-1)}
        onNext={() => stepPanel(1)}
        foot={
          panelRow ? (
            <>
              {panelRow.partner.phone && !panelRow.partner.doNotCall ? (
                <a className="h-btn h-btn--ghost" href={telHref(panelRow.partner.phone)}>
                  <Ic n="phone" />
                  Call
                </a>
              ) : null}
              <button type="button" className="h-btn h-btn--ghost" onClick={() => prep(panelRow)}>
                <Ic n="brief" />
                Prep
              </button>
              {mayLetter ? (
                <button type="button" className="h-btn h-btn--ghost" onClick={() => letter(panelRow)}>
                  <Ic n="letter" />
                  Letter
                </button>
              ) : null}
              <button type="button" className="h-btn h-btn--primary" onClick={(e) => openThank(e.currentTarget, panelRow)}>
                <Ic n="check" />
                Thank
              </button>
            </>
          ) : null
        }
      >
        {panelRow ? (
          <dl>
            <dt>Partner</dt>
            <dd>
              <NavLink href={'/work/partner/' + panelRow.cid}>{nameOf(panelRow)}</NavLink>
            </dd>
            <dt>Gift</dt>
            <dd>
              {moneyExact(panelRow.amount)} on {dateWords(panelRow.date, today, true)}
            </dd>
            <dt>Due</dt>
            <dd>{(() => { const c = clockWords(panelRow.clock && panelRow.clock.due, now); return c.label && !isOlder(panelRow) ? c.label : agoWords(panelRow) + ' since the gift'; })()}</dd>
            <dt>Fund</dt>
            <dd>
              {panelRow.fund}
              {panelRow.pay ? ' · ' + panelRow.pay : ''}
            </dd>
            {panelRow.soft ? (
              <>
                <dt>Given through</dt>
                <dd>{panelRow.soft.giver}</dd>
              </>
            ) : null}
            <dt>Lifetime</dt>
            <dd>
              {panelRow.partner.count > 0 ? moneyWhole(panelRow.partner.lifetime) + ' · ' + panelRow.partner.count.toLocaleString('en-US') + (panelRow.partner.count === 1 ? ' gift' : ' gifts') : 'No gifts yet'}
            </dd>
            <dt>Last contact</dt>
            <dd>{panelRow.partner.lastContact ? dateWords(panelRow.partner.lastContact, today, true) : 'No contact yet'}</dd>
            {panelRow.partner.place ? (
              <>
                <dt>Place</dt>
                <dd>{panelRow.partner.place}</dd>
              </>
            ) : null}
            <dt>Director</dt>
            <dd>{panelRow.ownerNames.join(', ') || 'No current director'}</dd>
            {panelRow.badges.length || panelRow.taskIds.length || leftOf(panelRow) ? (
              <>
                <dt>Notes</dt>
                <dd>
                  {[...panelRow.badges, ...(panelRow.taskIds.length ? ['Task open'] : []), ...(leftOf(panelRow) ? ['Left a message ' + dateWords(leftOf(panelRow)!.date, today)] : [])].join(', ')}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </SidePanel>
    </>
  );
}
