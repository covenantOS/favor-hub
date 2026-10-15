// Partners > /work/?view=week: My week for a regional director (this week's connections, meetings, event and one-on-ones against the weekly
// goals, the giving line, what counted and a report draft to copy), and Weekly reports with a director picker for Support and admins.
// Ported from public/js/work-week.js and work-week-report.js. Reads GET /api/work/week (the D1 copy of Blackbaud, no Blackbaud calls) and
// writes nothing. WeekStrip is the goals strip the classic page drew above the tabs; the page header renders it on every tab but this one.
import { useDeferredValue, useMemo, useState } from 'react';
import { queryOptions, useQuery, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, useHiddenColumns, useListKeys, usePageSize, pageOf, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { WorkToast, showToast } from './lists/toast';
import { partnerHref } from './lists/nav';
import { contextQuery, useHeld, workGet, type WorkMe } from './lists/core';
import { fd as fdShort, money as moneyR, reportSubject, reportText, short as shortR, whatsappText, type ReportOpts, type WeekData, type WeekRow } from './lists/weekReport';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="week" search={search} />, and <WeekStrip /> on every other tab for a regional director.

const KEY = 'week';
interface WeekAnswer {
  directors: { fid: string; name: string }[];
  owner: string;
  ownerName: string;
  week: WeekData | null;
}
const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export const weekQuery = (owner: string, back: number, as?: string) =>
  queryOptions({
    queryKey: ['work', 'week', owner, back, as || ''],
    queryFn: () => {
      const q: string[] = [];
      if (owner) q.push('owner=' + encodeURIComponent(owner));
      if (back) q.push('week=last');
      return workGet<WeekAnswer>('/api/work/week' + (q.length ? '?' + q.join('&') : ''), as);
    },
    staleTime: 60_000,
  });
export function prefetchMyWeek(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(weekQuery('', 0, asOf(s)));
  void qc.prefetchQuery(contextQuery(asOf(s)));
}

// A director with weekly goals: the server answers week: null for anyone else, and the tab and strip stay away.
export const mayStrip = (me: WorkMe | null | undefined) => !!me && me.role === 'director' && !!me.fid && me.team === 'RDD';

export function MyWeekView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="The week">
        <WeekBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

/* ------------------------------------------------------------------ the strip above the tabs */

const meter = (label: string, short: string, n: number, goal: number) => (
  <div className={'wwk-meter' + (n >= goal ? ' is-met' : '')}>
    <span className="wwk-meter__l">
      <span className="f">{label}</span>
      <span className="s">{short}</span>
    </span>
    <b>
      {n}
      <small>/{goal}</small>
    </b>
    <i>
      <u style={{ width: Math.min(100, (n / goal) * 100) + '%' }} />
    </i>
  </div>
);

/** The goals strip a regional director sees above every tab but My week. Renders nothing for anyone else. */
export function WeekStrip({ as = '' }: { as?: string }) {
  const me = useQuery(contextQuery(as)).data?.me;
  const eligible = mayStrip(me);
  const ans = useQuery({ ...weekQuery('', 0, as), enabled: eligible }).data;
  if (!eligible || !me) return null;
  if (!ans) return <div className="h-card wwk-strip wwk-strip--wait" aria-hidden="true" />;
  const d = ans.week;
  if (!d || ans.owner !== me.fid) return null;
  const c = d.counts, g = d.goals, v = d.giving;
  return (
    <NavLink className="h-card wwk-strip" href="/work/?view=week" aria-label="Open My week">
      <div className="wwk-strip__week">
        <span className="wwk-k">
          This week,
          <br />
          {d.week.range}
        </span>
        {meter('Connections', 'Connect', c.conn, g.conn)}
        {meter('Meetings', 'Meetings', c.mtg, g.mtg)}
        {meter('Event scheduled', 'Event', c.ev, g.ev)}
        {meter('One-on-ones', '1-on-1s', c.oo, g.oo)}
      </div>
      <div className="wwk-strip__give">
        <span className="wwk-k">Giving to goal</span>
        <b>
          {shortR(v.ytd)}
          <small> of {shortR(v.goal)}</small>
        </b>
        <i className="wwk-pace">
          <u style={{ width: v.pct + '%' }} />
          <s style={{ left: v.ppct + '%' }} title={'Pace ' + shortR(v.pace)} />
        </i>
        <span className="wwk-sub">{v.behind > 0 ? shortR(v.behind) + ' behind pace' : 'On pace'}</span>
      </div>
      <span className="wwk-strip__go">
        <Ic n="go" />
      </span>
    </NavLink>
  );
}

/* ------------------------------------------------------------------ the tab */

const HOWIC: Record<string, string> = { Call: 'phone', Email: 'mail', Visit: 'meet', Letter: 'letter', Task: 'task' };
const GOALCARDS: [keyof WeekData['goals'], string, string][] = [
  ['conn', 'Connections', 'A two-way phone call or an in-person visit or meeting with a partner or prospect, counted once per partner; letters, voicemails, emails and texts do not count.'],
  ['mtg', 'Meetings attended or hosted', 'Actions tagged Attended Event or Hosted Event.'],
  ['ev', 'Event scheduled', 'An event on the calendar this week.'],
  ['oo', 'One-on-ones', 'Meetings with one partner.'],
];
const SORTS: Record<string, (r: WeekRow) => string> = {
  date: (r) => r.date || '',
  how: (r) => String(r.how || '').toLowerCase(),
  name: (r) => String(r.name || '').toLowerCase(),
};

function copyText(t: string, msg: string) {
  const done = () => showToast(msg, { look: 'wc' });
  const fallback = () => {
    const x = document.createElement('textarea');
    x.value = t;
    x.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(x);
    x.select();
    try {
      document.execCommand('copy');
    } catch {
      // nothing to do
    }
    x.remove();
    done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
  else fallback();
}

function WeekBody({ as }: { as: string }) {
  const ctx = useSuspenseQuery(contextQuery(as)).data;
  const me = ctx.me;
  const [ownerPick, setOwnerPick] = useHeld('week.owner', '');
  const [back, setBack] = useHeld('week.back', 0);
  const dKey = useDeferredValue(ownerPick + '|' + back);
  const [dOwner, dBack] = dKey.split('|');
  const { data: ans } = useSuspenseQuery(weekQuery(dOwner, Number(dBack), as));
  const busy = dKey !== ownerPick + '|' + back;
  const [kindPick, setKind] = useHeld('week.kind', '');
  const [opts, setOpts] = useHeld<ReportOpts>('week.opts', { give: true, asks: true, refs: true, next: true });
  const [edited, setEdited] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 25);
  const [hidden, setHidden] = useHiddenColumns(KEY, []);
  const [sort, setSort] = useState<Sort | undefined>(undefined);
  useListKeys(KEY);

  const d = ans.week;
  const name = ans.ownerName || (d && d.name) || '';
  const rows = useMemo(() => {
    if (!d) return [];
    const key = sort ? SORTS[sort.col] : null;
    if (!key || !sort) return d.rows;
    const sgn = sort.dir === 'asc' ? 1 : -1;
    return d.rows.slice().sort((a, b) => {
      const p = key(a), q = key(b);
      return (p < q ? -1 : p > q ? 1 : 0) * sgn;
    });
  }, [d, sort]);

  if (!d) {
    return (
      <section className="h-card wc-sheet wwk-empty">
        <b>No director to show</b>
        <span>My week covers the regional directors.</span>
      </section>
    );
  }
  const todayDow = new Date(d.today + 'T12:00:00Z').getUTCDay();
  const kind = kindPick || (Number(dBack) === 0 && todayDow >= 1 && todayDow <= 3 ? 'goals' : 'update');
  const draft = edited != null ? edited : reportText(d, name, kind, opts);
  const picker = ans.directors.length > 1 || !mayStrip(me);
  const c = d.counts, g = d.goals, v = d.giving;
  const total = d.rows.length + d.moreRows;
  const curPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(rows.length / size)));
  const pageRows = pageOf(rows, curPage, size);

  const columns: Column<WeekRow>[] = [
    { key: 'date', label: 'Date', sort: 'date', phone: true, className: 'c-date', cell: (r) => <b>{fdShort(r.date)}</b> },
    {
      key: 'how', label: 'How', sort: 'how', phone: true, className: 'c-how',
      cell: (r) => (
        <span className="wwk-how">
          {HOWIC[r.how] ? <Ic n={HOWIC[r.how]} /> : null}
          {r.how}
        </span>
      ),
    },
    {
      key: 'who', label: 'Partner', sort: 'name', fixed: true, className: 'c-who',
      cell: (r) => (
        <NavLink className="pt-name wwk-name" href={partnerHref(r.cid)} data-pt-open="" title={r.name}>
          {r.name}
        </NavLink>
      ),
    },
    { key: 'said', label: 'What was said', phone: true, className: 'c-said is-clip', title: (r) => r.said || '', cell: (r) => <span className="pt-sub">{r.said || ''}</span> },
    {
      key: 'tags', label: 'Tags', phone: true, className: 'c-tags',
      title: (r) => tagsOf(r).join(', '),
      cell: (r) => (
        <>
          {tagsOf(r).map((t, i) => (
            <span key={t + i}>
              {i ? ' ' : ''}
              <span className="pt-badge">{t}</span>
            </span>
          ))}
        </>
      ),
    },
  ];
  function tagsOf(r: WeekRow) {
    return r.tags.concat(r.ask > 0 ? ['Ask ' + moneyR(r.ask)] : [], r.refs > 0 ? [r.refs + (r.refs === 1 ? ' referral' : ' referrals')] : []);
  }
  const pick = (fn: () => void) => () => {
    fn();
    setKind('');
    setEdited(null);
    setPage(1);
  };
  const subject = reportSubject(d, name, kind);

  return (
    <div className="wwk-grid">
      <section className="h-card wc-sheet wwk-card">
        <div className="wwk-tools">
          {picker ? (
            <select className="wc-sel" aria-label="Director" value={ans.owner} onChange={(e) => pick(() => setOwnerPick(e.target.value))()}>
              {ans.directors.map((x) => (
                <option key={x.fid} value={x.fid}>
                  {x.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="wwk-seg" role="group" aria-label="Week">
            {([[0, 'This week'], [1, 'Last week']] as [number, string][]).map(([b, l]) => (
              <button key={b} type="button" className={back === b ? 'is-on' : ''} aria-pressed={back === b} onClick={() => { if (b !== back) pick(() => setBack(b))(); }}>
                {l}
              </button>
            ))}
          </div>
          <span className="wwk-spacer" />
          <span className="wwk-sub">{d.week.range}</span>
        </div>
        <div className="wwk-goalgrid" style={busy ? { opacity: 0.6 } : undefined}>
          {GOALCARDS.map(([k, l, h]) => (
            <div key={k} className={'wwk-goal' + (c[k] >= g[k] ? ' is-met' : '')} title={h}>
              <b>
                {c[k]}
                <small> of {g[k]}</small>
              </b>
              <span>{l}</span>
              <i>
                <u style={{ width: Math.min(100, (c[k] / g[k]) * 100) + '%' }} />
              </i>
            </div>
          ))}
        </div>
        <div className="wwk-give">
          <b>
            {shortR(v.ytd)}
            <small> of {shortR(v.goal)} credited this year</small>
          </b>
          <span className="wwk-sub">
            {v.behind > 0 ? `${shortR(v.behind)} behind pace. ${moneyR(v.perWeek)} a week for ${v.weeks} ${v.weeks === 1 ? 'week' : 'weeks'} reaches the goal.` : v.ytd >= v.goal && v.goal ? 'The goal is met.' : 'On pace for the goal.'}
          </span>
          <i className="wwk-pace wwk-pace--big">
            <u style={{ width: v.pct + '%' }} />
            <s style={{ left: v.ppct + '%' }} title={'Pace ' + shortR(v.pace)} />
          </i>
        </div>
        <div className="pt-bar">
          <b className="ptl-title">
            What counted · {total} {total === 1 ? 'action' : 'actions'}
          </b>
          <span className="pt-spacer" />
          <ColumnsMenu columns={columns} hidden={hidden} onChange={setHidden} />
          <DensitySwitch />
        </div>
        <DataTable
          listKey={KEY}
          label="What counted"
          className="ptl-table ptl-week"
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.cid + '|' + r.date + '|' + r.how + '|' + (r.said || '').slice(0, 24)}
          sort={sort}
          onSort={(s) => {
            setSort(s);
            setPage(1);
          }}
          hidden={hidden}
          noFit
          rowClassName={() => 'ptl-row'}
          busy={busy}
          empty={<div className="wwk-none">Nothing counted yet this week.</div>}
        />
        <Pager
          listKey={KEY}
          total={rows.length}
          page={curPage}
          size={size}
          noun={d.moreRows ? 'actions (' + d.moreRows + ' more not listed)' : 'actions'}
          onPage={(p, s) => {
            if (s !== size) setSize(s);
            setPage(p);
          }}
        />
      </section>
      <section className="h-card wwk-report" aria-label="Report draft">
        <h3>Report draft</h3>
        <div className="wwk-seg" role="group" aria-label="Draft">
          {([['goals', 'Goals for the week'], ['update', 'Update for the week']] as [string, string][]).map(([k, l]) => (
            <button key={k} type="button" className={kind === k ? 'is-on' : ''} aria-pressed={kind === k} onClick={() => { setKind(k); setEdited(null); }}>
              {l}
            </button>
          ))}
        </div>
        <div className="wwk-opts">
          {([['give', 'Giving'], ['asks', 'Asks'], ['refs', 'Number of Referrals'], ['next', 'Next']] as [keyof ReportOpts, string][]).map(([k, l]) => (
            <label key={k} className="wwk-check">
              <input type="checkbox" checked={!!opts[k]} onChange={(e) => { setOpts({ ...opts, [k]: e.target.checked }); setEdited(null); }} />
              {l}
            </label>
          ))}
        </div>
        <textarea id="wwk-draft" spellCheck={false} aria-label="Report draft" value={draft} onChange={(e) => setEdited(e.target.value)} />
        <div className="wwk-acts">
          <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => copyText(whatsappText(draft), 'Copied for WhatsApp')}>
            <Ic n="copy" />
            Copy for WhatsApp
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => copyText(subject + '\n\n' + draft, 'Copied for email')}>
            <Ic n="mail" />
            Copy for email
          </button>
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            onClick={() => {
              const href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(draft);
              if (href.length <= 1800) {
                location.href = href;
                showToast('Your email app opened with the draft', { look: 'wc' });
                return;
              }
              copyText(subject + '\n\n' + draft, 'Draft copied');
              location.href = 'mailto:?subject=' + encodeURIComponent(subject);
            }}
          >
            <Ic n="send" />
            Open in my email
          </button>
          {edited != null ? (
            <button type="button" className="wwk-reset" onClick={() => setEdited(null)}>
              Reset the draft
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
