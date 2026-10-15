// Churches: the church partners Church Engagement works with, from the Blackbaud mirror. Giving, who holds the relationship, when anyone
// last spoke to the church and when the next call is due (thank at once, then call every three months). Read only; opening a record
// goes to the partner page, where visits and thank-yous are logged. Partner Care does not work with churches and the server refuses it.
import { Suspense, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { hubGet } from '../../lib/hub';
import './churches.css';

type Region = 'Southeast' | 'South' | 'Midwest' | 'West' | 'Northeast' | 'Other';
interface Row {
  cid: string;
  lookup: string;
  name: string;
  city: string;
  state: string;
  region: Region;
  pastor: string | null;
  holder: string | null;
  ytd: number;
  lastYear: number;
  gifts: number;
  lastGift: string | null;
  lastContact: string | null;
  toThank: number;
  call: { by: string; overdue: boolean; soon: boolean } | null;
}
interface Stats {
  givingYtd: number;
  goal: number;
  churchesOnFile: number;
  churchesGave: number;
  giftsYtd: number;
  dueSoon: number;
  quiet90: number;
  quiet90Of: number;
  newsletter: number;
}
interface List {
  today: string;
  stats: Stats;
  rows: Row[];
}
interface Detail {
  cid: string;
  years: { year: number; total: number }[];
  people: { name: string; role: string }[];
  recent: { date: string; kind: string; summary: string; done: boolean }[];
  openTasks: number;
}

const listQuery = queryOptions({
  queryKey: ['churches', 'list'],
  queryFn: async () => (await hubGet('/api/work/churches')) as List,
  staleTime: 60_000,
});
const detailQuery = (cid: string) =>
  queryOptions({
    queryKey: ['churches', 'detail', cid],
    queryFn: async () => ((await hubGet('/api/work/churches?church=' + encodeURIComponent(cid))) as { detail: Detail }).detail,
    staleTime: 60_000,
  });

export const Route = createFileRoute('/churches/')({
  staticData: { nav: 'partners-churches', title: 'Churches', layout: 'page' },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(listQuery);
  },
  component: Churches,
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ymd: string | null | undefined) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}` : '');
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const REGIONS: Region[] = ['Southeast', 'South', 'Midwest', 'West', 'Northeast'];
const SIZES = [15, 30, 60];

function Churches() {
  return (
    <ErrorBoundary label="Churches did not open." className="ch-card ch-notice">
      <Suspense fallback={<ChurchesSkeleton />}>
        <ChurchesBody />
      </Suspense>
    </ErrorBoundary>
  );
}

function ChurchesSkeleton() {
  return (
    <div className="ch-page" aria-busy="true">
      <section className="ch-band" aria-label="Church giving this year">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="ch-stat" key={i}>
            <span>&nbsp;</span>
            <b>
              <i className="ch-sk" />
            </b>
          </div>
        ))}
      </section>
      <div className="ch-grid">
        <section className="ch-card ch-list">
          <header className="ch-head">
            <h2>Giving churches</h2>
          </header>
          <div className="ch-scroll">
            <table className="ch-table">
              <tbody>
                {Array.from({ length: 8 }, (_, i) => (
                  <tr key={i}>
                    <td>
                      <i className="ch-sk wide" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <aside className="ch-card ch-panel" />
      </div>
    </div>
  );
}

function ChurchesBody() {
  const q = useSuspenseQuery(listQuery);
  const [region, setRegion] = useState<Region | 'All' | 'Due'>('All');
  const [find, setFind] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(15);
  const [sel, setSel] = useState('');

  const data = q.data;
  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    let due = 0;
    for (const r of data?.rows ?? []) {
      by[r.region] = (by[r.region] || 0) + 1;
      if (r.call && (r.call.overdue || r.call.soon)) due++;
    }
    return { by, due };
  }, [data]);
  const shown = useMemo(() => {
    const term = find.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) => {
      if (region === 'Due' && !(r.call && (r.call.overdue || r.call.soon))) return false;
      if (region !== 'All' && region !== 'Due' && r.region !== region) return false;
      if (term && !`${r.name} ${r.pastor || ''} ${r.city} ${r.state}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data, region, find]);
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const at = Math.min(page, pages);
  const slice = shown.slice((at - 1) * size, at * size);
  const open = shown.find((r) => r.cid === sel) ?? slice[0] ?? null;

  const s = data?.stats;
  const pct = s && s.goal > 0 ? Math.min(100, Math.round((s.givingYtd / s.goal) * 100)) : 0;
  const setFilter = (v: Region | 'All' | 'Due') => {
    setRegion(v);
    setPage(1);
  };

  return (
    <div className="ch-page">
      <section className="ch-band" aria-label="Church giving this year">
        <div className="ch-stat">
          <span>Church giving, {data ? data.today.slice(0, 4) : ''}</span>
          <b>{s ? money(s.givingYtd) : <i className="ch-sk" />}</b>
          {s && s.goal > 0 ? <small>of {money(s.goal)} goal</small> : null}
          <div className="ch-meter" role="img" aria-label={`${pct} percent of the goal`}>
            <i style={{ width: pct + '%' }} />
          </div>
        </div>
        <Stat label="Churches that gave this year" value={s && s.churchesGave} note={s ? `of ${s.churchesOnFile.toLocaleString('en-US')} on file, ${s.giftsYtd} gifts` : ''} />
        <Stat label="Thank or call in 3 weeks" value={s && s.dueSoon} note="Thank at once, call quarterly" />
        <Stat label="No contact in 90 days" value={s && s.quiet90} note={s ? `Of the ${s.quiet90Of} churches giving since last year` : ''} warn />
        <Stat label="Church newsletter list" value={s && s.newsletter} note="Churches with an email" />
      </section>

      <div className="ch-grid">
        <section className="ch-card ch-list" aria-label="Giving churches">
          <header className="ch-head">
            <h2>Giving churches</h2>
            <span>Gave since January last year, largest this year first</span>
          </header>
          <div className="ch-tools">
            <div className="ch-chips" role="group" aria-label="Filter">
              <button type="button" className={region === 'All' ? 'is-on' : ''} onClick={() => setFilter('All')}>
                All <em>{data ? data.rows.length : ''}</em>
              </button>
              {REGIONS.map((r) => (
                <button type="button" key={r} className={region === r ? 'is-on' : ''} onClick={() => setFilter(r)}>
                  {r} <em>{counts.by[r] || 0}</em>
                </button>
              ))}
              <button type="button" className={region === 'Due' ? 'is-on' : ''} onClick={() => setFilter('Due')}>
                Due soon <em>{counts.due}</em>
              </button>
            </div>
            <input
              className="ch-find"
              type="search"
              placeholder="Find a church or pastor"
              aria-label="Find a church or pastor"
              value={find}
              onChange={(e) => {
                setFind(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="ch-scroll">
            <table className="ch-table">
              <thead>
                <tr>
                  <th>Church</th>
                  <th>City</th>
                  <th>Pastor</th>
                  <th className="n">{data ? data.today.slice(0, 4) : ''}</th>
                  <th className="n">{data ? Number(data.today.slice(0, 4)) - 1 : ''}</th>
                  <th>Last gift</th>
                  <th>Contact</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {!data
                  ? Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        <td colSpan={8}>
                          <i className="ch-sk wide" />
                        </td>
                      </tr>
                    ))
                  : slice.map((r) => (
                      <tr key={r.cid} className={open && open.cid === r.cid ? 'is-open' : ''} onClick={() => setSel(r.cid)}>
                        <td className="name">
                          <button type="button" onClick={() => setSel(r.cid)} aria-pressed={!!open && open.cid === r.cid}>
                            {r.name}
                          </button>
                        </td>
                        <td>{[r.city, r.state].filter(Boolean).join(', ')}</td>
                        <td>{r.pastor || <span className="dim">None on file</span>}</td>
                        <td className="n">{r.ytd ? money(r.ytd) : <span className="dim">None</span>}</td>
                        <td className="n">{r.lastYear ? money(r.lastYear) : <span className="dim">None</span>}</td>
                        <td>{day(r.lastGift)}</td>
                        <td>{r.lastContact ? day(r.lastContact) : <span className="dim">None</span>}</td>
                        <td>{r.call ? <span className={'ch-pill' + (r.call.overdue ? ' is-late' : r.call.soon ? ' is-soon' : '')}>{r.call.overdue ? 'Call was due ' : 'Call by '}{day(r.call.by)}</span> : null}</td>
                      </tr>
                    ))}
                {data && !slice.length ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      <b>No churches match.</b> Clear the search or pick All.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <footer className="ch-foot">
            <span>
              {shown.length ? `${(at - 1) * size + 1} to ${Math.min(at * size, shown.length)} of ${shown.length}` : '0 churches'}
            </span>
            <nav aria-label="Pages">
              <button type="button" disabled={at <= 1} onClick={() => setPage(at - 1)} aria-label="Previous page">
                &lsaquo;
              </button>
              {pageNumbers(at, pages).map((n, i) =>
                n === 0 ? (
                  <span key={'g' + i}>...</span>
                ) : (
                  <button type="button" key={n} className={n === at ? 'is-on' : ''} onClick={() => setPage(n)} aria-current={n === at ? 'page' : undefined}>
                    {n}
                  </button>
                )
              )}
              <button type="button" disabled={at >= pages} onClick={() => setPage(at + 1)} aria-label="Next page">
                &rsaquo;
              </button>
            </nav>
            <label className="ch-rows">
              Rows
              <select
                value={size}
                onChange={(e) => {
                  setSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </footer>
        </section>
        <Panel row={open} today={data?.today || ''} />
      </div>
    </div>
  );
}

function pageNumbers(at: number, pages: number): number[] {
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = new Set([1, 2, 3, pages, at]);
  if (at > 1) out.add(at - 1);
  if (at < pages) out.add(at + 1);
  const list = [...out].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const withGaps: number[] = [];
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) withGaps.push(0);
    withGaps.push(n);
  });
  return withGaps;
}

function Stat({ label, value, note, warn }: { label: string; value: number | undefined | null | ''; note: string; warn?: boolean }) {
  return (
    <div className={'ch-stat' + (warn ? ' is-warn' : '')}>
      <span>{label}</span>
      <b>{value === undefined || value === null || value === '' ? <i className="ch-sk" /> : Number(value).toLocaleString('en-US')}</b>
      <small>{note}</small>
    </div>
  );
}

function Panel({ row, today }: { row: Row | null; today: string }) {
  if (!row) return <aside className="ch-card ch-panel" />;
  return (
    <aside className="ch-card ch-panel" aria-label={row.name}>
      <ErrorBoundary label="This church's details did not load." className="ch-notice">
        <Suspense fallback={<PanelBody row={row} today={today} d={null} />}>
          <PanelLoaded row={row} today={today} />
        </Suspense>
      </ErrorBoundary>
    </aside>
  );
}

function PanelLoaded({ row, today }: { row: Row; today: string }) {
  const d = useSuspenseQuery(detailQuery(row.cid)).data;
  return <PanelBody row={row} today={today} d={d} />;
}

function PanelBody({ row, today, d }: { row: Row; today: string; d: Detail | null }) {
  const years = d?.years ?? [];
  const max = Math.max(1, ...years.map((y) => y.total));
  const status = row.call && row.call.overdue ? 'Call overdue' : row.toThank ? `${row.toThank} to thank` : 'Up to date';
  return (
    <>
      <header>
        <h3>{row.name}</h3>
        <span className={'ch-pill' + (row.call && row.call.overdue ? ' is-late' : row.toThank ? ' is-soon' : ' is-ok')}>{status}</span>
      </header>
      <dl>
        <div>
          <dt>City</dt>
          <dd>{[row.city, row.state].filter(Boolean).join(', ') || 'Not on file'}</dd>
        </div>
        <div>
          <dt>Held by</dt>
          <dd>{row.holder || 'No one'}</dd>
        </div>
        <div>
          <dt>Gifts since last January</dt>
          <dd>{row.gifts}</dd>
        </div>
        <div>
          <dt>Last gift</dt>
          <dd>{day(row.lastGift) || 'None'}</dd>
        </div>
        <div>
          <dt>Open tasks</dt>
          <dd>{d ? d.openTasks : ''}</dd>
        </div>
      </dl>
      <h4>Giving by year</h4>
      <div className="ch-bars" role="img" aria-label={years.map((y) => `${y.year} ${money(y.total)}`).join(', ')}>
        {(years.length ? years : [0, 1, 2, 3].map((i) => ({ year: Number(today.slice(0, 4)) - 3 + i, total: 0 }))).map((y) => (
          <div key={y.year}>
            <i style={{ height: Math.max(3, Math.round((y.total / max) * 64)) + 'px' }} className={y.year === Number(today.slice(0, 4)) ? 'is-now' : ''} />
            <span>{y.year}</span>
            <b>{d ? money(y.total) : ''}</b>
          </div>
        ))}
      </div>
      <h4>People at the church</h4>
      <ul className="ch-people">
        {(d?.people ?? []).map((p) => (
          <li key={p.name + p.role}>
            <span>{p.name}</span>
            <em>{p.role}</em>
          </li>
        ))}
        {d && !d.people.length ? <li className="dim">No one linked to this church yet.</li> : null}
      </ul>
      <h4>Recent contacts</h4>
      <ul className="ch-recent">
        {(d?.recent ?? []).map((a, i) => (
          <li key={i}>
            <time>{day(a.date)}</time>
            <span>
              {a.kind ? a.kind + ': ' : ''}
              {a.summary || 'No summary'}
              {a.done ? '' : ' (open)'}
            </span>
          </li>
        ))}
        {d && !d.recent.length ? <li className="dim">Nothing logged.</li> : null}
      </ul>
      <footer>
        <a className="h-btn h-btn--primary" href={`/work/partner/${row.cid}`}>
          Open the record
        </a>
        <span className="dim">Log a visit and thank gifts there.</span>
      </footer>
    </>
  );
}
