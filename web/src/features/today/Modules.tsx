// The cards for a person's job: Your week (directors), Entry queue (admin and support), Cadence (Partner Care), Gift day (the gift desk) and
// Team (admins). All of them read /api/hub/home and /api/gifts/overview, which answer 403 for people without the role; those cards hide quietly.
import { useState, type ReactNode } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { navQuery } from '../../lib/queries';
import { money, n0, type J } from './rank';
import { homeQ, overviewQ } from './queries';
import { helpers } from './ui';

/* ---------------------------------------------------------------- a number that opens its definition and the rows behind it */
const WHD: Record<string, { title: string; defs: string[]; rows?: boolean }> = {
  open: { title: 'Open actions', defs: ['Open and overdue actions'], rows: true },
  overdue: { title: 'Overdue actions', defs: ['Open and overdue actions'], rows: true },
  today: { title: 'Actions due today', defs: ['Open and overdue actions'], rows: true },
  gifts: { title: 'Gifts to thank', defs: ['Gifts to thank'], rows: true },
  over24: { title: 'Gifts past the 24-hour clock', defs: ['Gifts to thank'], rows: true },
  first: { title: 'First gifts to thank', defs: ['Gifts to thank'], rows: true },
  teamopen: { title: 'Open actions', defs: ['Open and overdue actions'] },
  teamlate: { title: 'Overdue actions', defs: ['Open and overdue actions'] },
  teamty: { title: 'Thank-you tasks', defs: ['Open and overdue actions'] },
};
const COLS: Record<string, { key: string; label: string; type: string }[]> = {
  actions: [{ key: 'due', label: 'Due', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'summary', label: 'Summary', type: 'text' }, { key: 'late', label: 'Days late', type: 'int' }],
  gifts: [{ key: 'date', label: 'Gift date', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Gift', type: 'money' }, { key: 'fund', label: 'Fund', type: 'text' }, { key: 'waiting', label: 'Days waiting', type: 'int' }, { key: 'badges', label: 'Notes', type: 'text' }],
};

function openCount(key: string, shown: number) {
  const def = WHD[key];
  const FD = helpers().FavorDrill;
  if (!def || !FD) return;
  const spec = { title: def.title, shown, shownType: 'int', shownLabel: 'On the Work Overview', defs: def.defs, totalLabel: 'Rows behind it', rowsLabel: def.title };
  if (!def.rows) { FD.open(spec); return; }
  void FD.openAsync(spec, async () => {
    try {
      const res = await fetch('/api/hub/home-drill?key=' + encodeURIComponent(key), { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.message || 'Something went wrong. Try again.');
      return { rows: out.rows, total: out.total, columns: COLS[out.kind] };
    } catch (e) {
      return { message: (e as Error).message };
    }
  });
}

function Dn({ k, n, children }: { k: string; n: number; children?: ReactNode }) {
  const open = (e: { preventDefault: () => void; stopPropagation: () => void }) => { e.preventDefault(); e.stopPropagation(); openCount(k, Number(n) || 0); };
  return (
    <span className="dr-num" tabIndex={0} role="button" data-whd={k} data-whd-n={Number(n) || 0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}>
      {children ?? n0(n)}
    </span>
  );
}

/* ---------------------------------------------------------------- Your week, Entry queue, Cadence */
const Goal = ({ label, n, of, href }: { label: string; n: number; of: number; href: string }) => (
  <NavLink className={'wh-goal' + (n >= of ? ' is-met' : '')} href={href}>
    <b>{label}</b>
    <span>{n0(n)} of {n0(of)}</span>
    <div className="r2t-bar" role="presentation"><i style={{ width: Math.min(100, Math.round((n / of) * 100)) + '%' }} /></div>
  </NavLink>
);

function WeekCard({ w }: { w: J }) {
  const k = w && w.week;
  if (!k || k.kind === 'plain' || k.kind === 'director_plain') return null;
  let title = 'Your week';
  let sub: ReactNode = '';
  let body: ReactNode = null;
  if (k.kind === 'director') {
    const c = k.counts;
    const gl = k.goals;
    const gv = k.giving;
    sub = k.range;
    body = (
      <>
        <Goal label="Connections" n={c.conn} of={gl.conn} href="/work/?view=week" />
        <Goal label="Meetings" n={c.mtg} of={gl.mtg} href="/work/?view=week" />
        <Goal label="One-on-ones" n={c.oo} of={gl.oo} href="/work/?view=week" />
        <Goal label="Event scheduled" n={c.ev} of={gl.ev} href="/work/?view=week" />
        {gv && gv.goal ? (
          <NavLink className={'wh-goal' + (gv.ytd >= gv.goal ? ' is-met' : '')} href="/work/?view=week">
            <b>Giving this year</b>
            <span>{money(gv.ytd)} of {money(gv.goal)}</span>
            <div className="r2t-bar" role="presentation"><i style={{ width: Math.min(100, Math.round(gv.pct || (gv.ytd / gv.goal) * 100)) + '%' }} /></div>
          </NavLink>
        ) : null}
      </>
    );
  } else if (k.kind === 'support' || k.kind === 'admin') {
    title = k.kind === 'admin' ? 'Entry queue' : 'Your week';
    if (k.kind === 'admin') sub = <><span className="wh-qnote">Queue for the support team</span> <NavLink className="h-link" href="/work/?view=intake">Open entry</NavLink></>;
    const e = k.entry;
    const owners: J[] = e && e.owners ? e.owners.filter((o: J) => o.wait) : [];
    const top = Math.max(1, ...owners.map((o) => o.wait));
    body = (
      <>
        <div data-tool="leaf">
          <NavLink className="wh-big" href="/work/?view=intake">
            <b>{n0(e ? e.wait : 0)}</b>
            <span>{(e && e.wait === 1 ? 'action' : 'actions') + ' waiting to be entered' + (e && e.late ? (e.late === e.wait ? ', all dated before this week' : `, ${n0(e.late)} dated before this week`) : '')}</span>
          </NavLink>
        </div>
        {owners.length ? (
          <div className="wh-owners">
            {owners.slice(0, 7).map((o) => (
              <NavLink key={o.name} href="/work/?view=intake">
                <span title={o.name}>{o.name}</span>
                <span className="wh-mini" role="presentation"><i style={{ width: Math.max(4, Math.round((o.wait / top) * 100)) + '%' }} /></span>
                <span className="wh-lc">{o.late ? <span className="r2t-chip r2t-chip--late" title={`${n0(o.late)} dated before this week`}>{n0(o.late)} older</span> : null}</span>
                <b>{n0(o.wait)}</b>
              </NavLink>
            ))}
          </div>
        ) : null}
        {k.sending > 0 ? (
          <div className="wh-send"><span>{n0(k.sending)} {k.sending === 1 ? 'change' : 'changes'} waiting to send</span><NavLink className="h-btn h-btn--sm" href="/work/?view=recent">View</NavLink></div>
        ) : null}
      </>
    );
  } else if (k.kind === 'pc') {
    title = 'Cadence';
    const s = k.stats;
    body = (
      <>
        <div data-tool="leaf"><NavLink className="wh-big" href="/work/?view=cadence"><b>{n0(s.due)}</b><span>{s.due === 1 ? 'partner is' : 'partners are'} due for contact</span></NavLink></div>
        <div className="wh-kv">
          <NavLink href="/work/?view=cadence"><b>{n0(s.first)}</b><span>First contact</span></NavLink>
          <NavLink href="/work/?view=cadence"><b>{n0(s.repeat)}</b><span>Monthly or longer</span></NavLink>
          <NavLink href="/work/?view=cadence"><b>{n0(s.quarterly)}</b><span>Quarterly</span></NavLink>
        </div>
        <div className="wh-kv">
          <NavLink href="/work/?view=cadence"><b>{n0(s.week)}</b><span>Done this week</span></NavLink>
          <NavLink href="/work/?view=cadence"><b>{n0(k.lists.friday + k.lists.saturday + k.lists.sunday)}</b><span>On the weekend lists</span></NavLink>
          <NavLink href="/work/?view=cadence"><b>{n0(k.everyone)}</b><span>Partners held</span></NavLink>
        </div>
      </>
    );
  }
  return (
    <section className="h-card td-card td-mod wh-card" id="wh-week" aria-labelledby="wh-week-h">
      <header className="td-ch"><h2 id="wh-week-h">{title}</h2><span className="td-ch__r" id="wh-week-sub">{sub}</span></header>
      <div className="wh-body td-mod__b" id="wh-week-body">{body}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- Gift day */
const cents = (c: number) => '$' + Math.round((c || 0) / 100).toLocaleString('en-US');
function GiftDayCard({ d }: { d: J }) {
  const on = d.online || {};
  const bb = d.blackbaud || {};
  const rc = d.receipts || {};
  const lt = d.letters || {};
  const rv = d.review || {};
  const ml = d.mail || {};
  const cell = (n: unknown, l: string, href: string) => (
    <NavLink className="tw-gd__c" href={href}><b>{String(n)}</b><span>{l}</span></NavLink>
  );
  return (
    <section className="h-card td-card td-mod wh-card" id="tw-giftday" aria-labelledby="tw-giftday-h">
      <header className="td-ch">
        <h2 id="tw-giftday-h">Gift day</h2>
        <span className="td-ch__meta" id="tw-giftday-sub">{d.pickupDay ? 'a pickup day' : ''}</span>
        <NavLink className="h-link td-ch__r" href="/gifts/">Gifts overview</NavLink>
      </header>
      <div className="tw-gd td-gd" id="tw-giftday-body">
        {cell(ml.startedToday || 0, 'deposits started today', '/gift-entry/?start=1')}
        {cell(on.toApprove || 0, 'online gifts to approve', '/online-gifts/')}
        {cell(rv.waiting || 0, 'gifts for a second look', '/gift-entry/')}
        {cell(bb.deposits || 0, 'deposits this month, ' + cents(bb.cents), '/gift-entry/')}
        {cell(rc.lastFile ? rc.lastFile.marked : rc.left || 0, rc.lastFile ? 'receipts marked thanked' : 'receipts waiting', '/receipts/')}
        {cell(lt.month || 0, 'gifts for thank-you letters', '/gifts/letters/')}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Team */
const TEAM: Record<string, string> = { rdd: 'RDD', church: 'Church Engagement', partner_care: 'Partner Care', support: 'Support', grants: 'Grants', exec: 'Leadership', admin: 'Operations' };
type SortKey = 'name' | 'team' | 'open' | 'overdue' | 'ty';

function TeamCard({ w }: { w: J }) {
  const t = w && w.team;
  const [sort, setSort] = useState<{ key: SortKey; dir: number }>({ key: 'overdue', dir: -1 });
  const [all, setAll] = useState(false);
  if (!t || !t.people.length) return null;
  const over = t.all ? t.all.overdue : t.people.reduce((n: number, p: J) => n + p.overdue, 0);
  const val = (p: J) => (sort.key === 'name' ? String(p.name || '').toLowerCase() : sort.key === 'team' ? String(TEAM[p.team] || p.team || '').toLowerCase() : Number(p[sort.key]) || 0);
  const people: J[] = t.people.slice().sort((x: J, y: J) => (val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0) * sort.dir);
  const press = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' || key === 'team' ? 1 : -1 }));
  const th = (key: SortKey, label: string, n?: boolean) => (
    <th className={n ? 'n' : undefined} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="wh-sort" onClick={() => press(key)}>{label}{sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  );
  const count = people.length;
  return (
    <section className={'h-card td-card td-mod td-team wh-card' + (count > 5 && !all ? ' is-short' : '')} id="wh-team" aria-labelledby="wh-team-h">
      <header className="td-ch">
        <h2 id="wh-team-h">Team</h2>
        <span className="wh-chips td-ch__meta" id="wh-team-chips">{over ? <NavLink className="r2t-chip r2t-chip--late" href="/work/?view=open&quick=past">{n0(over)} overdue</NavLink> : null}</span>
        <NavLink className="h-link td-ch__r" href="/work/?view=open">Open all</NavLink>
      </header>
      <div className="wh-tw td-tw">
        <table className="wh-table sc-table" id="wh-team-table">
          <thead><tr>{th('name', 'Person')}{th('team', 'Team')}{th('open', 'Open', true)}{th('overdue', 'Overdue', true)}{th('ty', 'Thank-yous', true)}</tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.fid}>
                <td><NavLink href={'/work/?view=open&fr=' + p.fid}>{p.name}</NavLink></td>
                <td>{TEAM[p.team] || p.team || ''}</td>
                <td className="n"><NavLink href={'/work/?view=open&fr=' + p.fid}><Dn k="teamopen" n={p.open} /></NavLink></td>
                <td className="n"><NavLink href={'/work/?view=open&fr=' + p.fid + '&quick=past'} className={p.overdue ? 'wh-late' : ''}><Dn k="teamlate" n={p.overdue} /></NavLink></td>
                <td className="n"><NavLink href="/work/?view=ty"><Dn k="teamty" n={p.ty} /></NavLink></td>
              </tr>
            ))}
          </tbody>
          {t.all ? (
            <tfoot>
              <tr>
                <td>All people</td>
                <td />
                <td className="n"><NavLink href="/work/?view=open"><Dn k="teamopen" n={t.all.open} /></NavLink></td>
                <td className="n"><NavLink href="/work/?view=open&quick=past"><Dn k="teamlate" n={t.all.overdue} /></NavLink></td>
                <td className="n"><NavLink href="/work/?view=ty"><Dn k="teamty" n={t.all.ty} /></NavLink></td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      <button type="button" className="td-more" id="td-team-all" hidden={count <= 5} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${n0(count)} people`}</button>
    </section>
  );
}

/* ---------------------------------------------------------------- the section */
function Body() {
  const home = useSuspenseQuery(homeQ).data;
  const nav = useQuery(navQuery).data;
  const giftOff = !!nav && (nav.access as J)?.giftEntry === false;
  const ov = useSuspenseQuery({ ...overviewQ, queryFn: giftOff ? async () => null : overviewQ.queryFn }).data;
  const w = home && home.work;
  const week = w && w.week && w.week.kind !== 'plain' && w.week.kind !== 'director_plain';
  const team = w && w.team && w.team.people.length;
  const gift = !!ov && ov.ok !== false;
  const any = !!(week || team || gift);
  return (
    <section className={'td-mods wh tw' + (any ? ' is-in' : '')} id="wh" aria-label="Your work" hidden={!any}>
      <WeekCard w={w} />
      {gift ? <GiftDayCard d={ov} /> : null}
      <TeamCard w={w} />
    </section>
  );
}

export function Modules() {
  return (
    <ErrorBoundary label="Your work cards could not load.">
      <Body />
    </ErrorBoundary>
  );
}
