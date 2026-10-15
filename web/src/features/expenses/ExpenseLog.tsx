// The expense log and the approver settings under My requests. Opens for the approvers and the people they add (Google sign-in), or for the
// log's code while sign-in is off. The log carries every signature, so it is read in the browser after the page loads, not drawn on the server.
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { navQuery } from '../../lib/queries';
import { SheetsButton, sheetScreen, useSheetSource } from '../partners/work/lists/legacy';
import { sendJson, toSignin } from './api';
import { FILTERS, LOG_EVENTS, emailEventMeta, filterCount, filterRows, money, parsePayload, shortDate, splitList, statusWord, type ExpenseRequest, type LogFilter } from './logic';
import { expKeys, logQuery, type LogState, type Override } from './queries';

export function ExpenseLog() {
  const { data: nav } = useSuspenseQuery(navQuery);
  // The menu answer says who may open the log (admins, approvers, substitutes and the people they add). A person signed in with Google who
  // is not on that list sees My requests only.
  const may = Boolean(nav.access.expenseLog) || nav.user.via !== 'google';
  if (!may) return null;
  return <LogBody />;
}

function LogBody() {
  const q = useQuery(logQuery);
  const data = q.data;
  useEffect(() => {
    if (data?.state === 'signin') toSignin();
  }, [data?.state]);
  if (data?.state === 'none') return null;
  return (
    <>
      {data?.state !== 'locked' ? (
        <h2 className="exp-mine__h exp-logh" id="exp-logh">
          The expense log
        </h2>
      ) : null}
      {!data || data.state === 'signin' ? <div className="h-card h-skel" id="exp-skel" aria-hidden="true" style={{ minHeight: 420 }} /> : null}
      {data?.state === 'locked' ? <CodeForm /> : null}
      {data?.state === 'ok' ? <Admin data={data} /> : null}
    </>
  );
}

function CodeForm() {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  function submit(ev: FormEvent) {
    ev.preventDefault();
    setMsg('');
    sendJson('/api/admin/expense-login', 'POST', { password })
      .then(() => qc.invalidateQueries({ queryKey: expKeys.log }))
      .catch((err: Error) => setMsg(err.message));
  }
  return (
    <div id="exp-locked">
      <form className="board-login" id="exp-login" onSubmit={submit}>
        <p>Enter the admin code to open the expense log.</p>
        <div className="board-login__row">
          <input type="password" id="exp-password" placeholder="Code" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="req-admin-btn">
            Unlock
          </button>
        </div>
        <p className="req-msg" id="exp-login-msg" aria-live="polite">
          {msg}
        </p>
      </form>
    </div>
  );
}

type Ok = Extract<LogState, { state: 'ok' }>;

function Admin({ data }: { data: Ok }) {
  const rows = data.requests;
  const [filter, setFilter] = useState<LogFilter>({ status: 'all', q: '' });
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);

  // Open in Google Sheets: the requests the log shows now, and their lines on a second tab. Staff reimbursement data, so the sheet's About
  // tab says so. The signed PDFs and signatures stay out.
  useSheetSource('expenses', () => {
    const words = [filter.status !== 'all' ? 'Showing: ' + (statusWord(filter.status) || filter.status) : '', filter.q ? 'Search: ' + filter.q : ''].filter(Boolean).join('. ');
    return sheetScreen(
      'Expense log',
      [
        {
          name: 'Requests',
          columns: [
            { key: 'doc', label: 'Doc', type: 'text' },
            { key: 'submitted', label: 'Submitted', type: 'datetime' },
            { key: 'requester', label: 'Requester', type: 'text' },
            { key: 'email', label: 'Requester email', type: 'text' },
            { key: 'approver', label: 'Approver', type: 'text' },
            { key: 'status', label: 'Status', type: 'text' },
            { key: 'total', label: 'Total', type: 'money' },
            { key: 'note', label: 'Decline note', type: 'text' },
          ],
          rows: shown.map((r) => ({ doc: r.doc_number, submitted: r.submitted_at, requester: r.requester_name, email: r.requester_email, approver: r.approver_name, status: statusWord(r.status), total: (r.total_cents || 0) / 100, note: r.decline_note || '' })),
        },
        {
          name: 'Lines',
          columns: [
            { key: 'doc', label: 'Doc', type: 'text' },
            { key: 'description', label: 'Description', type: 'text' },
            { key: 'item', label: 'Item', type: 'text' },
            { key: 'amount', label: 'Amount', type: 'money' },
          ],
          rows: shown.flatMap((r) => (r.items || []).map((it) => ({ doc: r.doc_number, description: it.description, item: it.item || '', amount: (it.amount_cents || 0) / 100 }))),
        },
      ],
      { filters: words, classes: ['staff'] },
    );
  });

  return (
    <div id="exp-admin" className="exp-admin-grid">
      <div className="make-sheet">
        <div className="exp-filter" id="exp-filter" hidden={!rows.length}>
          <div className="exp-filter__chips" role="group" aria-label="Show">
            {FILTERS.map(([st, label]) => (
              <button key={st} type="button" data-st={st} className={filter.status === st ? 'is-on' : ''} aria-pressed={filter.status === st} onClick={() => setFilter((f) => ({ ...f, status: st }))}>
                {label} <span>{filterCount(rows, st)}</span>
              </button>
            ))}
          </div>
          <input type="search" placeholder="Find a name or EXP number" aria-label="Find a request" onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value.trim() }))} />
          <SheetsButton name="expenses" />
        </div>
        <div id="exp-log">
          <LogTable key={filter.status + '|' + filter.q} rows={shown} none={rows.length ? 'No requests match.' : 'No expense requests yet.'} />
        </div>
      </div>
      <Settings data={data} />
    </div>
  );
}

function LogTable({ rows, none }: { rows: ExpenseRequest[]; none: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!rows.length) return <p className="exp-empty">{none}</p>;
  return (
    <table className="exp-admin-table sc-table">
      <tbody>
        <tr>
          <th>Doc</th>
          <th>Submitted</th>
          <th>Requester</th>
          <th>Approver</th>
          <th>Status</th>
          <th className="r">Total</th>
          <th></th>
        </tr>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <tr className="exp-admin-row" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
              <td>{r.doc_number}</td>
              <td>{shortDate(r.submitted_at)}</td>
              <td>
                {r.requester_name}
                <br />
                <span style={{ opacity: 0.6 }}>{r.requester_email}</span>
              </td>
              <td>{r.approver_name}</td>
              <td>
                <span className={'exp-pill ' + r.status}>{statusWord(r.status)}</span>
                {r.decline_note ? (
                  <>
                    <br />
                    <span style={{ opacity: 0.6 }}>{r.decline_note}</span>
                  </>
                ) : null}
              </td>
              <td className="r">{money(r.total_cents)}</td>
              <td>
                {r.pdf ? (
                  <a className="exp-pdf-link" href={r.pdf} download onClick={(e) => e.stopPropagation()}>
                    Download PDF
                  </a>
                ) : null}
                {r.can_review ? (
                  <a className="exp-review-link" href={'/expenses/review/?id=' + encodeURIComponent(r.id)} onClick={(e) => e.stopPropagation()}>
                    Review and sign
                  </a>
                ) : null}
              </td>
            </tr>
            <tr className="exp-admin-detail" hidden={!open[r.id]}>
              <td colSpan={7}>{open[r.id] ? <Detail r={r} /> : null}</td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Detail({ r }: { r: ExpenseRequest }) {
  const [shownEmail, setShownEmail] = useState<Record<number, boolean>>({});
  const events = r.events || [];
  return (
    <div className="exp-detail">
      {r.pdf ? (
        <a className="exp-pdf-link exp-pdf-btn" href={r.pdf} download>
          Download PDF
        </a>
      ) : null}
      <div className="exp-rows">
        <b>Dates</b>
        <span>{r.travel_dates || '—'}</span>
        <b>City / state</b>
        <span>{r.travel_city || '—'}</span>
        <b>Reason</b>
        <span>{r.reason}</span>
      </div>
      <table className="exp-table sc-table">
        <tbody>
          <tr>
            <th>Item</th>
            <th className="r">Amount</th>
          </tr>
          {r.items.map((it, k) => (
            <tr key={k}>
              <td>
                {it.description}
                {it.item ? (
                  <>
                    {' '}
                    <span style={{ opacity: 0.6 }}>· {it.item}</span>
                  </>
                ) : null}
              </td>
              <td className="r">{money(it.amount_cents)}</td>
            </tr>
          ))}
          <tr className="tot">
            <td>Total</td>
            <td className="r">{money(r.total_cents)}</td>
          </tr>
        </tbody>
      </table>
      {r.requester_signature || r.approver_signature ? (
        <div className="exp-detail-sigs">
          {r.requester_signature ? (
            <div>
              <img src={r.requester_signature} alt="Requester signature" />
              <span>{r.requester_name} · requester</span>
            </div>
          ) : null}
          {r.approver_signature ? (
            <div>
              <img src={r.approver_signature} alt="Approver signature" />
              <span>{r.approver_name} · approver</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="exp-legend">Timeline</span>
      <ul className="exp-timeline">
        {events.length ? (
          events.map((ev, i) => {
            const payload = parsePayload(ev.payload);
            const hasEmail = Boolean(payload && typeof payload.html === 'string' && payload.html.length > 0);
            const meta = emailEventMeta(payload);
            return (
              <li key={i}>
                <div className="exp-tl-row">
                  <b>{LOG_EVENTS[ev.kind] || ev.kind}</b>
                  <span>
                    {ev.actor} · {shortDate(ev.created_at)}
                  </span>
                </div>
                {meta ? <div className="exp-tl-meta">{meta}</div> : null}
                {hasEmail && payload ? (
                  <>
                    <button type="button" className="exp-tl-view" data-ev={i} onClick={() => setShownEmail((s) => ({ ...s, [i]: !s[i] }))}>
                      View email
                    </button>
                    <div className="exp-tl-frame" id={'exp-tl-frame-' + r.id + '-' + i} hidden={!shownEmail[i]}>
                      {shownEmail[i] ? (
                        <>
                          <div className="exp-tl-subject">Subject: {payload.subject}</div>
                          <iframe sandbox="" className="exp-tl-iframe" srcDoc={payload.html} title="Email as sent" />
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </li>
            );
          })
        ) : (
          <li>No events logged.</li>
        )}
      </ul>
    </div>
  );
}

function Settings({ data }: { data: Ok }) {
  const qc = useQueryClient();
  const s = data.settings;
  const [name, setName] = useState(s.approver_name);
  const [email, setEmail] = useState(s.approver_email);
  const [dist, setDist] = useState((s.distribution || []).join(', '));
  const [rate, setRate] = useState(String(data.mileage.rate_cents));
  const [ded, setDed] = useState(String(data.mileage.deduction_miles));
  const [viewers, setViewers] = useState((s.viewers || []).join(', '));
  const [overrides, setOverrides] = useState<Override[]>(data.overrides);
  const [ovr, setOvr] = useState({ start: '', end: '', name: '', email: '' });
  const [code, setCode] = useState({ code: '', confirm: '' });
  const [msg, setMsg] = useState<Record<string, string>>({});
  const say = (k: string, v: string) => setMsg((m) => ({ ...m, [k]: v }));

  function save(k: string) {
    say(k, '');
    sendJson('/api/expenses/settings', 'PUT', {
      approver_name: name.trim(),
      approver_email: email.trim(),
      distribution: splitList(dist),
      mileage_rate_cents: parseInt(rate, 10),
      mileage_deduction_miles: parseInt(ded, 10),
      viewers: splitList(viewers),
    })
      .then(() => {
        say(k, 'Saved.');
        void qc.invalidateQueries({ queryKey: expKeys.mileage });
      })
      .catch((err: Error) => say(k, err.message));
  }

  function addOverride() {
    say('set', '');
    sendJson('/api/expenses/settings', 'POST', { start_date: ovr.start, end_date: ovr.end, name: ovr.name.trim(), email: ovr.email.trim() })
      .then((d) => {
        setOverrides((d.overrides as Override[]) || []);
        setOvr({ start: '', end: '', name: '', email: '' });
      })
      .catch((err: Error) => say('set', err.message));
  }

  function removeOverride(id: string) {
    sendJson('/api/expenses/settings?id=' + encodeURIComponent(id), 'DELETE')
      .then((d) => setOverrides((d.overrides as Override[]) || []))
      .catch((err: Error) => say('set', err.message));
  }

  function saveCode() {
    say('code', '');
    sendJson('/api/admin/expense-code', 'POST', { code: code.code, confirm: code.confirm })
      .then(() => {
        say('code', 'Code updated. Use it on the next sign-in.');
        setCode({ code: '', confirm: '' });
      })
      .catch((err: Error) => say('code', err.message));
  }

  return (
    <details className="make-sheet exp-settings">
      <summary>
        Log settings <small>Approvers, the approval email list, mileage, substitutes and who can open this log</small>
      </summary>
      <span className="exp-legend">Approver &amp; distribution</span>
      <div className="exp-settings-row">
        <label className="req-field">
          <span>Default approvers (any one of them can sign; separate names with &quot;or&quot;)</span>
          <input id="exp-set-name" maxLength={80} placeholder="Michael Hinton or Rachel Cox" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="req-field">
          <span>Their emails, in the same order (comma separated)</span>
          <input id="exp-set-email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="button" className="req-admin-btn" id="exp-set-save" onClick={() => save('set')}>
          Save
        </button>
      </div>
      <label className="req-field" style={{ marginTop: 12 }}>
        <span>On approval, also email (comma separated)</span>
        <input id="exp-set-dist" maxLength={600} value={dist} onChange={(e) => setDist(e.target.value)} />
        <small>The requester and the approver always get the approval email. This list rides along.</small>
      </label>

      <span className="exp-legend">Mileage policy</span>
      <div className="exp-settings-row">
        <label className="req-field">
          <span>Rate (cents per mile)</span>
          <input id="exp-set-mi-rate" type="number" min={1} max={500} value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="req-field">
          <span>Deduction (miles per trip)</span>
          <input id="exp-set-mi-ded" type="number" min={0} max={500} value={ded} onChange={(e) => setDed(e.target.value)} />
        </label>
        <button type="button" className="req-admin-btn" id="exp-set-mi-save" onClick={() => save('mi')}>
          Save
        </button>
      </div>
      <small>Used by the mileage calculator on the request form. Update this when the IRS rate changes or the policy figure is confirmed.</small>
      <p className="req-msg" id="exp-set-mi-msg" aria-live="polite">
        {msg.mi}
      </p>

      <span className="exp-legend">Out-of-office substitutes</span>
      <div className="exp-ovr-row">
        <label className="req-field">
          <span>From</span>
          <input id="exp-ovr-start" type="date" value={ovr.start} onChange={(e) => setOvr({ ...ovr, start: e.target.value })} />
        </label>
        <label className="req-field">
          <span>Through</span>
          <input id="exp-ovr-end" type="date" value={ovr.end} onChange={(e) => setOvr({ ...ovr, end: e.target.value })} />
        </label>
        <label className="req-field">
          <span>Name</span>
          <input id="exp-ovr-name" maxLength={80} value={ovr.name} onChange={(e) => setOvr({ ...ovr, name: e.target.value })} />
        </label>
        <label className="req-field">
          <span>Email</span>
          <input id="exp-ovr-email" maxLength={120} value={ovr.email} onChange={(e) => setOvr({ ...ovr, email: e.target.value })} />
        </label>
        <button type="button" className="req-admin-btn" id="exp-ovr-add" onClick={addOverride}>
          Add
        </button>
      </div>
      <ul className="exp-ovr-list" id="exp-ovr-list">
        {overrides.length ? (
          overrides.map((o) => (
            <li key={o.id}>
              <span>
                <b>{o.name}</b> &lt;{o.email}&gt; · {o.start_date} to {o.end_date}
              </span>
              <button type="button" data-id={o.id} onClick={() => removeOverride(o.id)}>
                Remove
              </button>
            </li>
          ))
        ) : (
          <li className="exp-empty" style={{ border: 'none' }}>
            No substitutions scheduled. The default approver gets everything.
          </li>
        )}
      </ul>
      <p className="req-msg" id="exp-set-msg" aria-live="polite">
        {msg.set}
      </p>

      <span className="exp-legend">Who else can open this log</span>
      <div className="exp-settings-row exp-settings-row--one">
        <label className="req-field">
          <span>Favor emails, comma separated</span>
          <input id="exp-set-viewers" maxLength={1000} placeholder="name@favorintl.org" value={viewers} onChange={(e) => setViewers(e.target.value)} />
        </label>
        <button type="button" className="req-admin-btn" id="exp-viewers-save" onClick={() => save('viewers')}>
          Save
        </button>
      </div>
      <small>People sign in with their Favor Google account. The approvers above and any substitute covering today can always open it.</small>
      <p className="req-msg" id="exp-viewers-msg" aria-live="polite">
        {msg.viewers}
      </p>

      <div id="exp-code-section" hidden={data.viaGoogle || data.signinOn}>
        <span className="exp-legend">Login code</span>
        <div className="exp-settings-row">
          <label className="req-field">
            <span>New code</span>
            <input id="exp-code-new" type="password" maxLength={64} autoComplete="new-password" value={code.code} onChange={(e) => setCode({ ...code, code: e.target.value })} />
          </label>
          <label className="req-field">
            <span>Repeat new code</span>
            <input id="exp-code-confirm" type="password" maxLength={64} autoComplete="new-password" value={code.confirm} onChange={(e) => setCode({ ...code, confirm: e.target.value })} />
          </label>
          <button type="button" className="req-admin-btn" id="exp-code-save" onClick={saveCode}>
            Update code
          </button>
        </div>
        <small>The code unlocks this log until Google sign-in is switched on. Change it here any time, and use the new code on the next sign-in.</small>
        <p className="req-msg" id="exp-code-msg" aria-live="polite">
          {msg.code}
        </p>
      </div>
    </details>
  );
}

