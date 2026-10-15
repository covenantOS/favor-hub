// Brain admin (/brain/admin/): access requests, who sees what, every question asked, the names the Brain missed and iWave. Open to the Brain's admin
// only; the Brain checks the email on every call, so the page only hides itself. Port of src/pages/brain/admin/index.astro and
// public/js/brain-admin.js with the same markup, classes, calls and wording.
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../partners/record/Boundary';
import { SheetsButton, sheetScreen, useSheetSource } from '../partners/work/lists/legacy';
import { hubSend } from '../../lib/write';
import { brainIwaveQuery, brainNamesQuery, brainOverviewQuery, type BrainCall, type BrainOverview, type Iwave, type IwaveProposal } from './brain-admin.api';

/* ------------------------------------------------------------------ words */

const ET = { timeZone: 'America/New_York' } as const;
const et = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { ...ET, ...o });
const when = (iso?: string | null) => (iso ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
const short = (email: string) => String(email || '').split('@')[0];
const TOOL: Record<string, string> = {
  ask: '', find_partner: 'Found a partner', partner_profile: 'Opened a partner', partner_list: 'Partner list', count_partners: 'Counted partners',
  giving_summary: 'Giving totals', gift_list: 'Gift list', team_numbers: 'Team numbers', actions: 'Actions', grant_opportunities: 'Grant opportunities',
  lookup: 'Looked up', search_knowledge: 'Searched the manuals', read_document: 'Read a manual section', my_day: 'My day', search_my_drive: 'Searched Drive',
  definitions: 'Definitions', request_access: 'Asked for access', whoami: 'Checked access', give_feedback: 'Sent feedback',
};
const said = (r: BrainCall) => {
  let what = r.tool === 'ask' ? r.question || 'A question' : TOOL[r.tool] || r.tool.replace(/_/g, ' ');
  if (r.tool !== 'ask' && r.question) what += ': ' + String(r.question).replace(/_/g, ' ');
  return what;
};
const outcome = (o?: string): [string, string] => {
  const k = String(o || '').split(':')[0];
  if (k === 'ok' || k === 'requested' || k === 'approved') return ['Answered', 'done'];
  if (k === 'clarify') return ['Asked back', 'wait'];
  if (k === 'denied') return ['Not in their access', 'declined'];
  if (k === 'refused') return ['Pointed elsewhere', 'wait'];
  if (k === 'feedback') return ['Feedback sent', 'done'];
  return ['Did not finish', 'declined'];
};
const via = (r: BrainCall) => {
  try {
    return JSON.parse(r.args || '{}').via === 'hub' ? 'On FavorOS' : 'From their AI';
  } catch {
    return '';
  }
};
const cue = () => document.dispatchEvent(new CustomEvent('favor:cue', { detail: 'success' }));
const KIND: Record<string, string> = { fund: 'Fund', campaign: 'Campaign', appeal: 'Appeal' };
const num0 = (n: unknown) => (n == null ? 'Unknown' : Number(n).toLocaleString('en-US'));

const T = ({ iso }: { iso?: string | null }) => <span suppressHydrationWarning>{when(iso)}</span>;
const Empty = ({ children }: { children: string }) => <li className="b-empty">{children}</li>;

/* ------------------------------------------------------------------ Requests and Give or remove access */

function Requests({ d, reload }: { d: BrainOverview; reload: () => void }) {
  const [busy, setBusy] = useState(0);
  const label = (k: string) => d.packages[k] || k;
  const decide = (id: number, approve: boolean) => {
    setBusy(id);
    hubSend('/api/brain/admin/decide', 'POST', { id, approve }, (x) => x)
      .then(() => {
        cue();
        reload();
      })
      .catch((err: Error) => window.alert(err.message))
      .finally(() => setBusy(0));
  };
  return (
    <div className="ba-col">
      <section className="h-card">
        <div className="h-card__head">
          <span className="h-card__title">Waiting for you</span>
        </div>
        <div className="h-card__body">
          <ul className="b-list" id="a-pending">
            {d.pending.length ? (
              d.pending.map((r) => (
                <li className="b-req" key={r.id}>
                  <div>
                    <b>{r.name || r.email}</b>
                    <span>
                      {label(r.package)} for {r.days} days · <T iso={r.at} />
                    </span>
                    <q>{r.reason || ''}</q>
                  </div>
                  <div className="b-req__go">
                    <button type="button" className="h-btn h-btn--primary h-btn--sm" data-decide={r.id} data-ok="1" disabled={busy === r.id} onClick={() => decide(r.id, true)}>
                      Approve
                    </button>
                    <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-decide={r.id} data-ok="0" disabled={busy === r.id} onClick={() => decide(r.id, false)}>
                      Decline
                    </button>
                  </div>
                </li>
              ))
            ) : (
              <Empty>No requests waiting.</Empty>
            )}
          </ul>
        </div>
      </section>
      <section className="h-card">
        <div className="h-card__head">
          <span className="h-card__title">Decided lately</span>
        </div>
        <div className="h-card__body">
          <ul className="b-list" id="a-decided">
            {(d.decided || []).length ? (
              d.decided.slice(0, 8).map((r, i) => (
                <li key={i}>
                  <div>
                    <b>{short(r.email)}</b>
                    <span>
                      {label(r.package)} · <T iso={r.decided_at} />
                    </span>
                  </div>
                  <span className={'h-status h-status--' + (r.status === 'approved' ? 'done' : 'declined')}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span>
                </li>
              ))
            ) : (
              <Empty>Nothing decided yet.</Empty>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Grant({ d, reload }: { d: BrainOverview; reload: () => void }) {
  const pkgs = Object.entries(d.packages || {});
  const [email, setEmail] = useState('');
  const [pkg, setPkg] = useState(pkgs[0] ? pkgs[0][0] : '');
  const [effect, setEffect] = useState('allow');
  const [days, setDays] = useState('30');
  const [msg, setMsg] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg('Saving...');
    hubSend('/api/brain/admin/grant', 'POST', { email: email.trim(), package: pkg, effect, days: Number(days) }, (x) => x)
      .then(() => {
        setMsg('Saved. It applies to their next question.');
        reload();
      })
      .catch((err: Error) => setMsg(err.message));
  };
  return (
    <section className="h-card">
      <div className="h-card__head">
        <span className="h-card__title">Give or remove access</span>
      </div>
      <div className="h-card__body">
        <form className="b-ask b-ask--open" id="a-grant" onSubmit={submit}>
          <label className="h-label" htmlFor="a-email">
            Staff email
          </label>
          <input id="a-email" name="email" list="a-people" placeholder="name@favorintl.org" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <datalist id="a-people">
            {(d.people || []).map((p) => (
              <option key={p.email} value={p.email} />
            ))}
          </datalist>
          <div className="b-ask__two">
            <div>
              <label className="h-label" htmlFor="a-pkg">
                Package
              </label>
              <select id="a-pkg" name="package" value={pkg} onChange={(e) => setPkg(e.target.value)}>
                {pkgs.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="h-label" htmlFor="a-effect">
                Change
              </label>
              <select id="a-effect" name="effect" value={effect} onChange={(e) => setEffect(e.target.value)}>
                <option value="allow">Give it</option>
                <option value="deny">Take it away</option>
              </select>
            </div>
          </div>
          <label className="h-label" htmlFor="a-days">
            Until
          </label>
          <select id="a-days" name="days" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">A month from today</option>
            <option value="90">Three months</option>
            <option value="365">A year</option>
            <option value="0">No end date</option>
          </select>
          <div className="b-ask__go">
            <button type="submit" className="h-btn h-btn--primary">
              Save
            </button>
          </div>
          <p className="b-msg" id="a-grant-msg" role="status">
            {msg}
          </p>
        </form>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ People and Activity */

function People({ d, find }: { d: BrainOverview; find: string }) {
  const label = (k: string) => d.packages[k] || k;
  const q = find.trim().toLowerCase();
  return (
    <table className="b-table sc-table" id="a-people-t">
      <thead>
        <tr>
          <th>Person</th>
          <th>Role</th>
          <th>Access</th>
          <th>Calls, 30 days</th>
          <th>Last</th>
        </tr>
      </thead>
      <tbody>
        {d.people.map((p) => {
          const text = (short(p.email) + p.role + p.packages.filter((k) => k !== 'basics').map(label).join('') + (p.calls30 || '') + when(p.last)).toLowerCase();
          const rest = p.packages.filter((k) => k !== 'basics');
          return (
            <tr key={p.email} hidden={!!q && text.indexOf(q) < 0}>
              <td>
                <b>{short(p.email)}</b>
              </td>
              <td>{p.role}</td>
              <td>
                {rest.length ? (
                  rest.map((k, i) => (
                    <span key={k}>
                      {i ? ' ' : ''}
                      <span className={'h-chip' + (p.changed ? ' b-chip--changed' : '')}>{label(k)}</span>
                    </span>
                  ))
                ) : (
                  <span className="b-muted">Basics</span>
                )}
              </td>
              <td>{p.calls30 || ''}</td>
              <td>
                <T iso={p.last} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Activity({ rows }: { rows: BrainCall[] }) {
  const [shown, setShown] = useState(20);
  return (
    <>
      <table className="b-table sc-table" id="a-recent">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Question</th>
            <th>Result</th>
            <th>Rows</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((r, i) => {
            const [text, cls] = outcome(r.outcome);
            const where = r.tool === 'ask' ? via(r) : '';
            return (
              <tr key={i}>
                <td>
                  <T iso={r.at} />
                  {where ? <span>{where}</span> : null}
                </td>
                <td>{short(r.email)}</td>
                <td>
                  <b>{said(r)}</b>
                  {r.reading ? <span>{r.reading}</span> : null}
                </td>
                <td>
                  <span className={'h-status h-status--' + cls}>{text}</span>
                </td>
                <td>{r.rows || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="h-more" id="a-more" hidden={rows.length <= shown} onClick={() => setShown(shown + 20)}>
        Show {Math.min(20, rows.length - shown)} more
      </button>
    </>
  );
}

/* ------------------------------------------------------------------ Names */

function Names({ term, setTerm }: { term: string; setTerm: (t: string) => void }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(brainNamesQuery);
  const [picked, setPicked] = useState<{ kind: string; id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Array<{ kind: string; id: string; name: string; code?: string; inactive?: boolean }>>([]);
  const [msg, setMsg] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef(0);
  const reload = () => qc.invalidateQueries({ queryKey: brainNamesQuery.queryKey });
  const search = (t: string) => {
    setQ(t);
    window.clearTimeout(timer.current);
    if (t.trim().length < 2) {
      setHits([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      hubSend('/api/brain/admin/name-search', 'POST', { t: t.trim() }, (x) => x as { hits: typeof hits })
        .then((d) => setHits(d.hits))
        .catch(() => undefined);
    }, 220);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!('data' in data)) return <p className="b-muted">{'error' in data ? data.error : ''}</p>;
  const d = data.data;
  const unplaced = d.missed.filter((m) => /^unrouted/.test(String(m.outcome || '')));
  const missed = d.missed.filter((m) => !/^unrouted/.test(String(m.outcome || '')));
  const teach = (m: (typeof missed)[number]) => {
    setTerm(m.term || '');
    if (m.suggestion) setPicked({ kind: m.suggestion.kind, id: m.suggestion.id, name: m.suggestion.name });
    else search(m.term || '');
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setMsg('Saving...');
    hubSend('/api/brain/admin/alias', 'POST', { term: term.trim(), kind: picked.kind, id: picked.id, name: picked.name }, (x) => x)
      .then(() => {
        setMsg('Saved. It works in questions within two minutes, on FavorOS and from Claude or ChatGPT.');
        setTerm('');
        setQ('');
        setHits([]);
        setPicked(null);
        cue();
        void reload();
      })
      .catch((err: Error) => setMsg(err.message));
  };
  const remove = (id: number, el: HTMLButtonElement) => {
    el.disabled = true;
    hubSend('/api/brain/admin/alias-delete', 'POST', { id }, (x) => x)
      .then(() => reload())
      .catch((err: Error) => {
        window.alert(err.message);
        el.disabled = false;
      });
  };
  return (
    <>
      <section className="h-card">
        <div className="h-card__head">
          <span className="h-card__title">Could not place</span>
          <span className="h-card__meta">Questions the Brain did not know what to do with</span>
        </div>
        <div className="h-card__body">
          <ul className="b-list" id="a-unplaced">
            {unplaced.length ? (
              unplaced.map((m, i) => (
                <li key={i}>
                  <div>
                    <b>{m.question || m.tool}</b>
                    <span>
                      {m.who} · <T iso={m.at} />
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <Empty>Nothing the Brain could not place in the last three weeks.</Empty>
            )}
          </ul>
        </div>
      </section>
      <section className="h-card">
        <div className="h-card__head">
          <span className="h-card__title">Names that missed</span>
          <span className="h-card__meta">Last three weeks</span>
        </div>
        <div className="h-card__body">
          <ul className="b-list" id="a-missed">
            {missed.length ? (
              missed.map((m, i) => (
                <li className="ba-miss" key={i}>
                  <div>
                    <b>{m.question || m.tool}</b>
                    <span>
                      {m.who} · <T iso={m.at} />
                    </span>
                    <q>{m.reading || ''}</q>
                    {m.suggestion ? (
                      <span>
                        They found it next as <b>{m.suggestion.name}</b>
                      </span>
                    ) : null}
                  </div>
                  {m.term ? (
                    <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-teach={m.term} onClick={() => teach(m)}>
                      {m.suggestion ? 'Teach this' : 'Teach it'}
                    </button>
                  ) : null}
                </li>
              ))
            ) : (
              <Empty>Nothing missed in the last three weeks.</Empty>
            )}
          </ul>
        </div>
      </section>
      <div className="ba-col">
        <section className="h-card">
          <div className="h-card__head">
            <span className="h-card__title">Teach a name</span>
          </div>
          <div className="h-card__body">
            <form className="b-ask b-ask--open" id="a-alias" ref={form} onSubmit={save}>
              <label className="h-label" htmlFor="a-term">
                The words people use
              </label>
              <input id="a-term" maxLength={80} placeholder="For example: PBS Chad" required value={term} onChange={(e) => setTerm(e.target.value)} />
              <label className="h-label" htmlFor="a-pick-q">
                What they mean
              </label>
              <input id="a-pick-q" maxLength={80} placeholder="Search funds, campaigns and appeals" autoComplete="off" value={q} onChange={(e) => search(e.target.value)} />
              <ul className="ba-picks" id="a-picks">
                {hits.map((h) => (
                  <li key={h.kind + h.id}>
                    <button type="button" className={picked && picked.id === h.id && picked.kind === h.kind ? 'is-on' : ''} data-pick onClick={() => setPicked({ kind: h.kind, id: h.id, name: h.name })}>
                      {h.name}
                      <em>
                        {KIND[h.kind] || h.kind}
                        {h.code ? ' · ' + h.code : ''}
                        {h.inactive ? ' · inactive' : ''}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="b-msg" id="a-picked">
                {picked ? `Means: ${KIND[picked.kind] || picked.kind} ${picked.name}` : ''}
              </p>
              <div className="b-ask__go">
                <button type="submit" className="h-btn h-btn--primary" id="a-alias-save" disabled={!picked}>
                  Save
                </button>
              </div>
              <p className="b-msg" id="a-alias-msg" role="status">
                {msg}
              </p>
            </form>
          </div>
        </section>
        <section className="h-card">
          <div className="h-card__head">
            <span className="h-card__title">Names it knows</span>
          </div>
          <div className="h-card__body">
            <ul className="b-list" id="a-aliases">
              {d.aliases.length ? (
                d.aliases.map((a) => (
                  <li key={a.id}>
                    <div>
                      <b>{a.term}</b>
                      <span>
                        {KIND[a.kind] || a.kind}: {a.entity_name || a.entity_id} · <T iso={a.added_at} />
                      </span>
                    </div>
                    <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-unalias={a.id} onClick={(e) => remove(a.id, e.currentTarget)}>
                      Remove
                    </button>
                  </li>
                ))
              ) : (
                <Empty>None yet. Names usually resolve on their own; teach one when a name missed.</Empty>
              )}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ iWave */

function Proposal({ p, decide, busy }: { p: IwaveProposal; decide: (id: number, ok: boolean) => void; busy: boolean }) {
  let scope = '';
  try {
    const sj = JSON.parse(p.scope_json || '{}');
    scope = sj.segment ? String(sj.segment).replace(/-/g, ' ') : sj.portfolio ? 'One portfolio' : '';
  } catch {
    scope = '';
  }
  return (
    <li className="b-req">
      <div>
        <b>Screen {Number(p.credits_needed || p.households).toLocaleString('en-US')} households</b>
        <span>
          {scope}
          {scope ? ' · ' : ''}
          {short(p.email || '')} · <T iso={p.made_at} />
        </span>
        <q>
          {Number(p.eligible || 0).toLocaleString('en-US')} partners, {Number(p.held_partner_care || 0).toLocaleString('en-US')} held by Partner Care stay out. Balance then: {num0(p.balance_at)}.
        </q>
      </div>
      <div className="b-req__go">
        <button type="button" className="h-btn h-btn--primary h-btn--sm" data-iw={p.id} data-ok="1" disabled={busy} onClick={() => decide(p.id, true)}>
          Approve
        </button>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-iw={p.id} data-ok="0" disabled={busy} onClick={() => decide(p.id, false)}>
          Decline
        </button>
      </div>
    </li>
  );
}

function IwaveView({ onCount }: { onCount: (n: number) => void }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(brainIwaveQuery);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(0);
  const d: Iwave | null = 'data' in data ? data.data : null;
  const props = d && d.connected ? d.proposals || [] : [];
  useEffect(() => onCount(props.length), [props.length, onCount]);
  const decide = (id: number, approve: boolean) => {
    setBusy(id);
    hubSend('/api/brain/admin/iwave/decide', 'POST', { id, approve }, (x) => x)
      .then(() => {
        cue();
        return qc.invalidateQueries({ queryKey: brainIwaveQuery.queryKey });
      })
      .catch((err: Error) => setMsg(err.message))
      .finally(() => setBusy(0));
  };
  const st = (d && d.status) || {};
  const r = st.refreshes_today || {};
  const stats: Array<[string, string]> = [
    [num0(st.balance), 'Credits left'],
    [`${r.used ?? 0} of ${r.daily_cap ?? '?'}`, 'Refreshes today, all of Favor'],
    [num0(st.rated_partners), 'Partners rated'],
    [`${st.credit_floor ?? '?'}`, 'Credit floor'],
    [st.mode === 'off' ? 'Off' : st.mode === 'staff' ? 'Staff' : 'Admin only', 'Who can refresh'],
    [`${st.min_age_days ?? '?'} days`, 'Before a re-score'],
  ];
  const log = (d && d.connected && d.log) || [];
  const connected = !!d && d.connected;
  return (
    <>
      <div className="ba-col">
        <section className="h-card">
          <div className="h-card__head">
            <span className="h-card__title">iWave today</span>
            <span className="h-card__meta" id="a-iw-read">
              {connected && st.balance_read_at ? (
                <>
                  Balance read <T iso={st.balance_read_at} />
                </>
              ) : (
                ''
              )}
            </span>
          </div>
          <div className="h-card__body">
            <div className="ba-stats" id="a-iw-stats">
              {!d ? (
                <p className="b-muted">{'error' in data ? data.error : 'The Brain did not answer.'}</p>
              ) : connected ? (
                stats.map(([n, l]) => (
                  <div className="ba-stat" key={l}>
                    <b>{n}</b>
                    <span>{l}</span>
                  </div>
                ))
              ) : null}
            </div>
            <p className="b-msg" id="a-iw-msg" role="status">
              {msg || (d ? (connected ? st.balance_note || '' : d.message || 'The sync worker is not answering about iWave yet.') : '')}
            </p>
          </div>
        </section>
        <section className="h-card">
          <div className="h-card__head">
            <span className="h-card__title">Screening proposals</span>
          </div>
          <div className="h-card__body">
            <ul className="b-list" id="a-iw-props">
              {!d ? null : !connected ? (
                <Empty>Nothing to approve until iWave is switched on.</Empty>
              ) : props.length ? (
                props.map((p) => <Proposal key={p.id} p={p} decide={decide} busy={busy === p.id} />)
              ) : (
                <Empty>No screenings waiting.</Empty>
              )}
            </ul>
          </div>
        </section>
      </div>
      <section className="h-card">
        <div className="h-card__head">
          <span className="h-card__title">Refresh and screening log</span>
          <span className="h-card__meta">Newest first, credits before and after</span>
        </div>
        <div className="h-card__body b-scroll">
          <table className="b-table sc-table" id="a-iw-log">
            {connected ? (
              <>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Result</th>
                    <th>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {log.length ? (
                    log.map((l, i) => (
                      <tr key={i}>
                        <td>
                          <T iso={l.made_at} />
                        </td>
                        <td>{short(l.email || '')}</td>
                        <td>
                          <b>{l.kind === 'refresh' ? 'Refresh' : l.kind === 'screen' ? 'Screening' : l.kind || ''}</b>
                          {l.constituent_id ? <span>Record {l.constituent_id}</span> : null}
                        </td>
                        <td>
                          {l.status || ''}
                          {l.detail ? <span>{String(l.detail).slice(0, 120)}</span> : null}
                        </td>
                        <td>{l.credits_before != null ? num0(l.credits_before) + ' to ' + num0(l.credits_after) : ''}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="b-muted">
                        Nothing logged yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </>
            ) : null}
          </table>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ the page */

type Tab = 'requests' | 'people' | 'activity' | 'names' | 'iwave';
const TABS: Tab[] = ['requests', 'people', 'activity', 'names', 'iwave'];

function Denied() {
  return (
    <section className="h-card ba-denied" id="a-denied">
      <p>
        This page is for the Brain's admin. <NavLink href="/brain/">Back to Favor Brain</NavLink>
      </p>
    </section>
  );
}

function Body() {
  const qc = useQueryClient();
  const { data: ov } = useSuspenseQuery(brainOverviewQuery);
  const { data: nm } = useSuspenseQuery(brainNamesQuery);
  const [tab, setTab] = useState<Tab>('requests');
  const [find, setFind] = useState('');
  const [term, setTerm] = useState('');
  const [iwCount, setIwCount] = useState(0);
  const reload = () => void qc.invalidateQueries({ queryKey: brainOverviewQuery.queryKey });
  // The address can name a tab (#names); read it once the page is up, as the classic script did on load.
  useEffect(() => {
    const h = window.location.hash.replace('#', '') as Tab;
    if (TABS.includes(h)) setTab(h);
  }, []);
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', '#' + t);
  };

  const denied = 'denied' in ov;
  const d = 'data' in ov ? ov.data : null;
  const people = d ? d.people || [] : [];
  const activity = d ? (d.recent || []).filter((r) => !/^admin_/.test(r.tool)) : [];
  const miss = activity.filter((r) => /^(error|denied)/.test(String(r.outcome || ''))).length;
  const missedN = 'data' in nm ? nm.data.missed.length : 0;
  const statCell = (n: string, l: string) => (
    <div className="ba-stat" key={l}>
      <b>{n}</b>
      <span>{l}</span>
    </div>
  );
  return (
    <>
      <header className="ba-head">
        <div>
          <NavLink className="ba-back" href="/brain/">
            <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m11 6-6 6 6 6" />
            </svg>
            Favor Brain
          </NavLink>
          <h1>Brain admin</h1>
          <p className="h-lede">Decide access requests, change who can ask about what, and read every question asked.</p>
        </div>
        <div className="b-tabs b-atabs" role="tablist" aria-label="Brain admin" hidden={denied}>
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" className={'b-tab' + (tab === t ? ' is-on' : '')} aria-selected={tab === t} data-atab={t} onClick={() => pick(t)}>
              {t === 'requests' ? 'Requests' : t === 'people' ? 'People' : t === 'activity' ? 'Activity' : t === 'names' ? 'Names' : 'iWave'}{' '}
              <span id={t === 'requests' ? 'a-pending-n' : t === 'people' ? 'a-people-n' : t === 'names' ? 'a-missed-n' : t === 'iwave' ? 'a-iw-n' : undefined}>
                {t === 'requests' && d && d.pending.length ? String(d.pending.length) : t === 'people' && people.length ? String(people.length) : t === 'names' && missedN ? String(missedN) : t === 'iwave' && iwCount ? String(iwCount) : ''}
              </span>
            </button>
          ))}
        </div>
      </header>

      {denied ? (
        <Denied />
      ) : (
        <>
      <div className="ba-stats" id="a-stats">
        {d ? (
          <>
            {statCell(String(d.pending.length), 'Requests waiting')}
            {statCell(people.reduce((n, p) => n + (Number(p.calls30) || 0), 0).toLocaleString('en-US'), 'Calls in the last 30 days')}
            {statCell(String(people.filter((p) => (p.calls30 || 0) > 0).length), 'People asking, last 30 days')}
            {statCell(activity.length ? Math.round((miss / activity.length) * 100) + '%' : '0%', 'Of the last 60 calls, did not finish')}
          </>
        ) : null}
      </div>

      {d ? (
        <>
          <div className="b-apanel b-grid2" data-apanel="requests" hidden={tab !== 'requests'}>
            <Requests d={d} reload={reload} />
            <Grant d={d} reload={reload} />
          </div>
          <section className="h-card b-apanel" data-apanel="people" hidden={tab !== 'people'}>
            <PeopleCard d={d} find={find} setFind={setFind} />
          </section>
          <section className="h-card b-apanel" data-apanel="activity" hidden={tab !== 'activity'}>
            <ActivityCard rows={activity} />
          </section>
        </>
      ) : (
        <div className="b-apanel b-grid2" data-apanel="requests" hidden={tab !== 'requests'}>
          <div className="ba-col">
            <section className="h-card">
              <div className="h-card__head">
                <span className="h-card__title">Waiting for you</span>
              </div>
              <div className="h-card__body">
                <ul className="b-list" id="a-pending">
                  <Empty>{'error' in ov ? ov.error : ''}</Empty>
                </ul>
              </div>
            </section>
          </div>
        </div>
      )}

      <div className="b-apanel b-grid2" data-apanel="iwave" hidden={tab !== 'iwave'}>
        <Suspense fallback={null}>
          <IwaveView onCount={setIwCount} />
        </Suspense>
      </div>

      <div className="b-apanel b-grid2" data-apanel="names" hidden={tab !== 'names'}>
        <Names term={term} setTerm={setTerm} />
      </div>
        </>
      )}
    </>
  );
}

function PeopleCard({ d, find, setFind }: { d: BrainOverview; find: string; setFind: (s: string) => void }) {
  const label = (k: string) => d.packages[k] || k;
  useSheetSource('brain-people', () => {
    const q = find.trim().toLowerCase();
    const rows = d.people
      .filter((p) => !q || (p.email + ' ' + p.role).toLowerCase().includes(q))
      .map((p) => ({ email: p.email, role: p.role, access: (p.packages || []).filter((k) => k !== 'basics').map((k) => label(k)).join(', '), calls: p.calls30 || 0, last: p.last || null }));
    return sheetScreen(
      'Brain access',
      [
        {
          name: 'People',
          columns: [
            { key: 'email', label: 'Person', type: 'text' },
            { key: 'role', label: 'Role', type: 'text' },
            { key: 'access', label: 'Access beyond the basics', type: 'text' },
            { key: 'calls', label: 'Calls, 30 days', type: 'int' },
            { key: 'last', label: 'Last call', type: 'datetime' },
          ],
          rows,
        },
      ],
      { classes: ['staff'] }
    );
  });
  return (
    <>
      <div className="h-card__head">
        <span className="h-card__title">Who sees what</span>
        <input className="b-find" id="a-find" type="search" placeholder="Find a person" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
        <SheetsButton name="brain-people" />
      </div>
      <div className="h-card__body b-scroll">
        <People d={d} find={find} />
      </div>
    </>
  );
}

function ActivityCard({ rows }: { rows: BrainCall[] }) {
  useSheetSource('brain-activity', () =>
    sheetScreen(
      'Brain activity',
      [
        {
          name: 'Questions',
          columns: [
            { key: 'at', label: 'When', type: 'datetime' },
            { key: 'who', label: 'Who', type: 'text' },
            { key: 'via', label: 'Where', type: 'text' },
            { key: 'what', label: 'Question', type: 'text' },
            { key: 'result', label: 'Result', type: 'text' },
            { key: 'rows', label: 'Rows', type: 'int' },
          ],
          rows: rows.map((r) => ({ at: r.at, who: r.email, via: r.tool === 'ask' ? via(r) : '', what: said(r), result: outcome(r.outcome)[0], rows: r.rows || 0 })),
        },
      ],
      // A question can name a partner, so this sheet is partner information as well as staff information.
      { classes: ['staff', 'partner'] }
    )
  );
  return (
    <>
      <div className="h-card__head">
        <span className="h-card__title">Every question, newest first</span>
        <SheetsButton name="brain-activity" />
      </div>
      <div className="h-card__body b-scroll">
        <Activity rows={rows} />
      </div>
    </>
  );
}

const Wait = () => (
  <div className="ba-stats" id="a-stats" aria-busy="true">
    {['Requests waiting', 'Calls in the last 30 days', 'People asking, last 30 days', 'Of the last 60 calls, did not finish'].map((l) => (
      <div className="ba-stat" key={l}>
        <b>&nbsp;</b>
        <span>{l}</span>
      </div>
    ))}
  </div>
);

export function BrainAdminPage() {
  return (
    <QueryErrorResetBoundary>
      {() => (
        <Boundary
          fallback={(e) => (
            <div className="b-page">
              <p className="b-empty">{e.message || 'That did not load.'}</p>
            </div>
          )}
        >
          <div className="b-page">
            <Suspense fallback={<Wait />}>
              <Body />
            </Suspense>
          </div>
        </Boundary>
      )}
    </QueryErrorResetBoundary>
  );
}
