// The partner beside the edit panel: the compact, read-only copy of the partner page (public/js/partner.js view with compact on).
// Reads GET /api/work/partners/:id and /comm. Shows the name, place, holders, flags, giving, communication, what is due and the last
// few things that happened, with a link to the full page.
import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TERMS } from '@shared/giving';
import '@hub/styles/partner.css';
import '@hub/styles/comm-picture.css';
import '@hub/styles/gifts.css';
import { hubGet } from '../../../../lib/hub';
import { wcApi } from './api';
import { ini, MON } from './model';
import { useAs, todayET } from './editKit';
import { Ic } from './ui';

interface Holder {
  fid?: string;
  name: string;
  type?: string;
  current?: boolean;
  to?: string;
}
interface Gift {
  id: string;
  date: string;
  amount: number;
  credited?: number | null;
  fund?: string;
  through?: string;
  by?: string;
  soft?: boolean;
  type?: string;
  gift?: number | null;
  comment?: string;
}
interface ActionRow {
  id: string;
  category?: string;
  type?: string;
  summary?: string;
  description?: string;
  due: string;
  done?: string;
  outcome?: string;
  fundraisers?: { name: string }[];
}
interface Partner {
  id: string;
  name: string;
  kind: string;
  lookup: string;
  place?: string;
  deceased?: boolean;
  inactive?: boolean;
  household?: { id: string; name: string; relation?: string }[];
  assignments?: Holder[];
  iwave?: { overall?: number | null; ratedOn?: string; capacityBand?: string; capacity?: number } | null;
  flags: { doNotCall?: boolean; doNotEmail?: boolean; doNotMail?: boolean };
  dataCare?: { noAddress?: { state: string }; pairs?: { id: string; otherName?: string }[] };
  canEdit?: boolean;
  giving: {
    firstDate?: string;
    total: number;
    count: number;
    ytd: number;
    last12: number;
    last?: Gift | null;
    largest?: Gift | null;
    recent?: Gift[];
    soft?: { recent?: Gift[] };
    source?: string;
    through?: { kind: string }[];
    household?: { relation: string; name: string }[];
    status?: string;
    major?: boolean;
    passedOn?: { count: number; line: string };
  };
  actions: { open?: ActionRow[]; recent?: ActionRow[]; openCount: number };
  toThank?: { key: string; amount: number; date: string; fund?: string; ageDays?: number; soft?: boolean; clock?: { state: string; due: string } }[];
}
interface Comm {
  cid: string;
  today: string;
  tally: { count: number; target: number; year: string | number; last12: number; byKind: { kind: string; n: number }[] };
  touches: { date: string; kind: string; what: string; source: string; thanks?: boolean; left?: boolean }[];
  noText?: { reason: string } | null;
}

const partnerKey = (cid: string, as?: string) => ['work', 'glance', cid, as || ''] as const;
const commKey = (cid: string, as?: string) => ['work', 'glance-comm', cid, as || ''] as const;

const GIC: Record<string, string> = {
  gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12"/><path d="M3 13h18"/><path d="M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
  expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/>',
};
const CAT_IC: Record<string, string> = { 'Phone call': 'phone', Email: 'mail', Mailing: 'letter', Meeting: 'meet', 'Task/Other': 'task' };
const PLURAL: Record<string, [string, string]> = {
  call: ['call', 'calls'],
  text: ['text', 'texts'],
  email: ['email', 'emails'],
  card: ['card or mailing', 'cards or mailings'],
  meeting: ['meeting', 'meetings'],
  letter: ['HQ letter', 'HQ letters'],
  receipt: ['receipt', 'receipts'],
};
const KIND_WORD: Record<string, string> = { text: 'Text', call: 'Call', email: 'Email', card: 'Card or mailing', meeting: 'Meeting', letter: 'HQ letter' };

const plain = (t: string) => String(t || '').replace(/^RESERVED \((.*)\)$/, '$1');
const money = (a: number | null | undefined) => (a == null ? '' : (Number(a) < 0 ? '-' : '') + '$' + Math.abs(Number(a)).toLocaleString('en-US', { minimumFractionDigits: Math.round(a) === Number(a) ? 0 : 2, maximumFractionDigits: 2 }));
const whole = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const short = (v: number) => {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  const f = (x: number) => String(+x.toFixed(1));
  return a >= 999950000 ? s + '$' + f(a / 1e9) + 'B' : a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + (a < 1e5 ? f(a / 1000) : Math.round(a / 1000)) + 'K' : money(Math.round(n));
};
const lateText = (d: number) => (d === 1 ? '1 day late' : d <= 60 ? d + ' days late' : Math.round(d / 30.4) + ' mo late');
const href = (id: string) => '/work/partner/' + encodeURIComponent(id);

function Term({ k, label }: { k: string; label?: string }) {
  const t = TERMS[k];
  const text = label || (t ? t.label : k);
  return t ? (
    <span className="h-term" tabIndex={0} title={t.tip}>
      {text}
    </span>
  ) : (
    <>{text}</>
  );
}

function giftHow(g: Gift): string {
  const parts: string[] = [];
  if (g.through) parts.push('Through ' + g.through + ' (soft credit)');
  else if (g.soft) parts.push('Soft credit');
  if (g.by) parts.push('Given by ' + g.by);
  parts.push(g.type === 'RecurringGiftPayment' ? 'Monthly gift' : g.type === 'Donation' ? '' : g.type || '');
  if (g.gift != null && Math.abs(g.gift - g.amount) > 0.005) parts.push('Part of a ' + money(g.gift) + ' gift');
  if (g.comment) parts.push(String(g.comment).replace(/\bDonor note\b/gi, 'Partner note'));
  return parts.filter(Boolean).join(' · ');
}

interface Ev {
  t: 'gift' | 'act';
  d: string;
  gid?: string;
  a?: number;
  what: string;
  how?: string;
  icon?: string;
  text?: string;
  by?: string;
}
function eventsOf(p: Partner): Ev[] {
  const ev: Ev[] = [];
  for (const g of p.giving.recent || []) ev.push({ t: 'gift', gid: g.id, d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: giftHow(g) });
  for (const g of (p.giving.soft && p.giving.soft.recent) || []) {
    if (!(p.giving.recent || []).some((x) => x.id === g.id)) ev.push({ t: 'gift', gid: g.id, d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: giftHow(g) });
  }
  for (const a of p.actions.recent || []) {
    ev.push({ t: 'act', d: a.done || a.due, icon: CAT_IC[a.category || ''] || 'task', what: a.summary || plain(a.type || ''), text: a.description, by: (a.fundraisers || []).map((f) => f.name).join(', ') + (a.outcome ? ' · ' + a.outcome : '') });
  }
  return ev.filter((e) => e.d).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}

function Fig({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
  return (
    <div className="pp-fig">
      <b>{value}</b>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function CommPicture({ cid, canFlag }: { cid: string; canFlag: boolean }) {
  const { as, ready } = useAs();
  const [all, setAll] = useState(false);
  const [flag, setFlag] = useState<{ reason: string } | null | undefined>(undefined);
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagErr, setFlagErr] = useState('');
  const q = useQuery({ queryKey: commKey(cid, as), queryFn: async () => ((await hubGet('/api/work/partners/' + encodeURIComponent(cid) + '/comm')) as { comm: Comm }).comm, enabled: ready, staleTime: 60_000, refetchOnWindowFocus: false });
  if (q.isPending) {
    return (
      <div className="cm cm--load" aria-busy="true">
        <div className="cm-sk" />
        <div className="cm-sk" />
        <div className="cm-sk" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="cm">
        <div className="cm-empty">{(q.error as Error)?.message || 'That did not load.'}</div>
      </div>
    );
  }
  const c = q.data;
  const noText = flag === undefined ? c.noText : flag;
  const t = c.tally;
  const kinds = t.byKind.map((k) => `${k.n} ${PLURAL[k.kind]?.[k.n === 1 ? 0 : 1] ?? k.kind}`).join(' · ');
  const shown = all ? c.touches : c.touches.slice(0, 8);
  const day = (iso: string) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return MON[m - 1] + ' ' + d + (String(y) !== String(c.today).slice(0, 4) ? ', ' + y : '');
  };
  const setNoText = async (on: boolean) => {
    setFlagBusy(true);
    setFlagErr('');
    try {
      await wcApi('/api/work/cadence/notext', { method: 'POST', body: JSON.stringify({ cid, on, reason: 'Replied STOP' }) });
      setFlag(on ? { reason: 'Replied STOP' } : null);
    } catch (e) {
      setFlagErr((e as Error).message);
    }
    setFlagBusy(false);
  };
  return (
    <div className="cm" data-cm={c.cid}>
      <div className="cm-head">
        <div className="cm-count">
          {t.count > t.target ? (
            <>
              <b>{t.count}</b>
              <span>
                thank-yous in {t.year}, past the target of {t.target}
              </span>
            </>
          ) : (
            <>
              <b>
                {t.count} of {t.target}
              </b>
              <span>thank-yous in {t.year}</span>
            </>
          )}
        </div>
        {noText ? (
          <button type="button" className="cm-flag is-on" title="Clear the flag" disabled={flagBusy} onClick={() => void setNoText(false)}>
            {flagErr || `No texts: ${noText.reason} · Clear`}
          </button>
        ) : canFlag ? (
          <button type="button" className="cm-flag" disabled={flagBusy} onClick={() => void setNoText(true)}>
            {flagErr || 'Mark no texts'}
          </button>
        ) : null}
      </div>
      <div className="cm-tally" role="img" aria-label={`${t.count} thank-yous, target ${t.target}`}>
        {Array.from({ length: t.target }, (_, i) => (
          <span key={i} className={i < t.count ? 'on' : ''} />
        ))}
      </div>
      <div className="cm-sub">{[kinds, t.last12 + ' in the last 12 months'].filter(Boolean).join(' · ')}</div>
      <ul className="cm-list">
        {shown.length ? (
          shown.map((x, i) => (
            <li key={i} className={'cm-row' + (x.left ? ' is-left' : '')}>
              <span className="cm-d">{day(x.date)}</span>
              <span className="cm-k">
                {KIND_WORD[x.kind] || 'Receipt'}
                {x.left ? ' · left a message' : ''}
              </span>
              <span className="cm-w">{x.what}</span>
              <span className="cm-s">
                {x.thanks ? <em>Thank-you</em> : null}
                {x.thanks ? ' · ' : ''}
                {x.source}
              </span>
            </li>
          ))
        ) : (
          <li className="cm-empty">No contact in the last 12 months.</li>
        )}
      </ul>
      {c.touches.length > 8 && !all ? (
        <button type="button" className="cm-more" onClick={() => setAll(true)}>
          Show {c.touches.length - 8} older
        </button>
      ) : null}
      <div className="cm-foot">Not listed: monthly appeal mailings and GoHighLevel emails</div>
    </div>
  );
}

export function PartnerGlance({ cid }: { cid: string }) {
  const { as, ready } = useAs();
  const q = useQuery({
    queryKey: partnerKey(cid, as),
    queryFn: async () => ((await hubGet('/api/work/partners/' + encodeURIComponent(cid) + (as ? '?as=' + encodeURIComponent(as) : ''))) as { partner: Partner }).partner,
    enabled: ready,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  if (q.isPending) {
    return (
      <div className="pp-skel">
        <i style={{ height: 16, width: '34%' }} />
        <i style={{ height: 40, width: '68%' }} />
        <i style={{ height: 14, width: '44%' }} />
        <i style={{ height: 38 }} />
        <i style={{ height: 76 }} />
        <i style={{ height: 160 }} />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="pp-err">
        <p>{(q.error as Error)?.message || 'The partner did not load.'}</p>
      </div>
    );
  }
  return <Body p={q.data} />;
}

function Body({ p }: { p: Partner }) {
  const today = todayET();
  const dayn = (iso: string) => Math.round((Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
  const fd = (iso: string | null | undefined, yr?: boolean) => {
    if (!iso || String(iso).startsWith('1900')) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return MON[m - 1] + ' ' + d + (yr || y !== Number(today.slice(0, 4)) ? ', ' + y : '');
  };
  const g = p.giving;
  const holders = (p.assignments || []).filter((a) => a.current);
  const iw = p.iwave;
  const flags = [p.deceased ? 'Deceased' : '', p.inactive ? 'Inactive' : '', p.flags.doNotCall ? 'Do not call' : '', p.flags.doNotEmail ? 'Do not email' : '', p.flags.doNotMail ? 'Do not mail' : ''].filter(Boolean);
  const dc = p.dataCare || {};
  const care = [
    dc.noAddress && dc.noAddress.state === 'open' ? { text: 'No mailing address', href: '/data-care/' } : null,
    ...(dc.pairs || []).slice(0, 1).map((x) => ({ text: 'Possible duplicate: ' + (x.otherName || 'another record'), href: '/data-care/?pair=' + encodeURIComponent(x.id) })),
  ].filter((x): x is { text: string; href: string } => !!x);
  const tasks = (p.actions.open || [])
    .map((a) => ({ id: a.id, what: a.summary || plain(a.type || ''), kind: a.category, by: (a.fundraisers || []).map((f) => f.name).join(', '), due: a.due }))
    .sort((a, b) => (a.due < b.due ? -1 : 1));
  const evs = eventsOf(p).slice(0, 5);
  const bits: ReactNode[] = [];
  if (g.source) bits.push(<span key="src"><Term k={(g.through || []).some((t) => t.kind === 'daf') ? 'daf' : 'soft'} label={g.source} /></span>);
  const spouse = (g.household || []).find((m) => m.relation === 'Spouse');
  if (spouse) bits.push(<span key="hh"><Term k="household" label={'Counts ' + spouse.name + '’s gifts too'} /></span>);
  if (g.status) {
    bits.push(
      <span key="st">
        <Term k={g.status === 'LYBUNT' ? 'lybunt' : String(g.status).toLowerCase()} label={g.status} />
        {g.major ? <> · <Term k="major" /></> : null}
      </span>
    );
  }
  if (g.passedOn && g.passedOn.count) bits.push(<span key="po"><Term k="passedOn" label="Passed on for others" />: {g.passedOn.line}</span>);
  const toThank = p.toThank || [];
  let month = '';
  return (
    <div className="pp pp--compact">
      <div className="pp-head">
        <div>
          <span className="pp-kicker">
            {p.kind} · ID {p.lookup}
            {g.firstDate ? ' · Giving since ' + String(g.firstDate).slice(0, 4) : ''}
          </span>
          <h1>
            <a href={href(p.id)} className="pp-h1link">
              {String(p.name || '').trim() || 'No name on file'}
            </a>
          </h1>
          <p className="pp-house">
            {p.place || 'No city on file'}
            {p.household && p.household.length
              ? p.household.map((h, i) => (
                  <span key={h.id}>
                    {i === 0 ? ' · ' : ', '}
                    {h.relation || 'Household'}{' '}
                    <a href={href(h.id)} className="pp-link">
                      {h.name}
                    </a>
                  </span>
                ))
              : null}
          </p>
        </div>
        <div className="pp-meta">
          {holders.length ? (
            holders.slice(0, 2).map((h, i) => (
              <div key={i} className="pp-holder">
                <i>{ini(h.name)}</i>
                <span>
                  <b>{h.name}</b>
                  {h.type ? ' · ' + h.type : ''}
                </span>
              </div>
            ))
          ) : (
            <div className="pp-holder">
              <span>No current holder</span>
            </div>
          )}
          {iw ? (
            <div className="pp-iw" title={'iWave' + (iw.ratedOn ? ', rated ' + fd(iw.ratedOn, true) : '')}>
              iWave{' '}
              <span className="pp-iw__dots">
                {Array.from({ length: 10 }, (_, i) => (
                  <s key={i} className={iw.overall != null && i < iw.overall ? 'on' : ''} />
                ))}
              </span>{' '}
              {iw.overall != null ? iw.overall : 'Not rated'}
              {iw.capacityBand ? ' · ' + iw.capacityBand : iw.capacity ? ' · ' + short(iw.capacity) : ''}
            </div>
          ) : null}
          {flags.length || care.length ? (
            <div className="pp-flags">
              {flags.map((f) => (
                <span key={f} className="pp-flag">
                  {f}
                </span>
              ))}
              {care.map((c) => (
                <a key={c.text} className="pp-flag pp-flag--care" href={c.href}>
                  {c.text}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {toThank.slice(0, 3).map((t) => (
        <div key={t.key} className="wg-owe">
          <div>
            <b>{money(t.amount)} to thank</b>
            <span>
              {[
                fd(t.date),
                t.fund || '',
                t.ageDays && t.ageDays > 1 ? Number(t.ageDays).toLocaleString('en-US') + ' days' : t.ageDays === 1 ? 'Yesterday' : 'Today',
                t.soft ? TERMS.soft.label : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>
      ))}
      {toThank.length > 3 ? (
        <p className="pp-empty" style={{ margin: '6px 28px 0' }}>
          {(toThank.length - 3).toLocaleString('en-US')} more {toThank.length - 3 === 1 ? 'gift' : 'gifts'} to thank
        </p>
      ) : null}
      <div className="pp-giving">
        <Fig label={<Term k="lifetime" label="Lifetime" />} value={whole(g.total)} sub={g.count ? g.count.toLocaleString('en-US') + (g.count === 1 ? ' gift' : ' gifts') : g.passedOn && g.passedOn.count ? 'None of its own' : 'No gifts yet'} />
        <Fig label="This year" value={whole(g.ytd)} sub={'Last 12 months ' + whole(g.last12)} />
        <Fig
          label="Last gift"
          value={g.last ? money(g.last.credited != null ? g.last.credited : g.last.amount) : 'None'}
          sub={g.last ? fd(g.last.date) + (g.last.fund ? ' · ' + g.last.fund : '') + (g.last.through ? ' · through ' + g.last.through : '') : ''}
        />
        <Fig label="Largest" value={g.largest ? money(g.largest.credited != null ? g.largest.credited : g.largest.amount) : 'None'} sub={g.largest ? fd(g.largest.date, true) : ''} />
      </div>
      {bits.length ? <p className="pp-givenote">{bits}</p> : null}
      <section className="pp-sec" data-pp-comm>
        <h3>Communication</h3>
        <div>
          <CommPicture cid={p.id} canFlag={p.canEdit !== false} />
        </div>
      </section>
      <section className="pp-sec">
        <h3>Due and open</h3>
        <div className="pp-due">
          {tasks.length ? (
            tasks.map((t) => (
              <div key={t.id} className="pp-task pp-task--ro">
                <span />
                <div className="pp-task__what">
                  <b>{t.what}</b>
                  <span>
                    {t.kind || ''}
                    {t.by ? ' · ' + t.by : ''}
                  </span>
                </div>
                <span className={'pp-datechip' + (dayn(t.due) < 0 ? ' is-late' : '')}>{dayn(t.due) < 0 ? lateText(-dayn(t.due)) : 'Due ' + fd(t.due)}</span>
              </div>
            ))
          ) : (
            <p className="pp-empty">Nothing due.</p>
          )}
        </div>
      </section>
      <section className="pp-sec">
        <h3>
          Timeline <span className="pp-filter" hidden />
        </h3>
        <ul className="pp-tl">
          {evs.length ? (
            evs.map((e, i) => {
              const m = String(e.d).slice(0, 7);
              const head = m !== month ? <li className="pp-month">{MON[Number(m.slice(5)) - 1]} {m.slice(0, 4)}</li> : null;
              month = m;
              return (
                <Fragment key={i}>
                  {head}
                  {e.t === 'gift' ? (
                    <li className="pp-ev pp-ev--gift">
                      <span className="pp-ev__dot">
                        <GIcon n="gift" />
                      </span>
                      <div>
                        <span className="pp-amt">{money(e.a)}</span> <b>to {e.what}</b>
                        {e.how ? <p className="by">{e.how}</p> : null}
                      </div>
                      <span className="when">{fd(e.d)}</span>
                    </li>
                  ) : (
                    <li className="pp-ev">
                      <span className="pp-ev__dot">
                        <Ic n={e.icon || 'task'} />
                      </span>
                      <div>
                        <b>{e.what}</b>
                        {e.text ? <p>{String(e.text).slice(0, 400)}</p> : null}
                        {e.by ? <p className="by">{e.by}</p> : null}
                      </div>
                      <span className="when">{fd(e.d)}</span>
                    </li>
                  )}
                </Fragment>
              );
            })
          ) : (
            <li className="pp-empty" style={{ paddingLeft: 34 }}>
              Nothing here yet.
            </li>
          )}
        </ul>
      </section>
      <p className="pp-compactfoot">
        <a className="h-btn h-btn--ghost h-btn--sm" href={href(p.id)}>
          <GIcon n="expand" />
          Full partner page
        </a>
      </p>
    </div>
  );
}

function GIcon({ n }: { n: string }) {
  return <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GIC[n] || '' }} />;
}
