// Staff > Expenses: your own requests, a button for a new one, and for approvers the log and the settings. Same markup, class names and
// stylesheets as src/pages/expenses/index.astro, drawn by React.
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { toSignin, sendJson } from './api';
import { ExpenseLog } from './ExpenseLog';
import { MY_EVENTS, money, shortDate, statusWord, type ExpenseRequest } from './logic';
import { logQuery, mineQuery } from './queries';

export function ExpensesPage() {
  return (
    <div className="exp-page">
      <div className="container">
        <div className="exp-head">
          <div>
            <h1>
              Your <em>expenses</em>
            </h1>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <NavLink className="h-btn h-btn--primary" href="/expenses/new/">
              New expense request
            </NavLink>
            <LockButton />
          </div>
        </div>

        <section className="make-sheet exp-mine" id="exp-mine" aria-labelledby="exp-mine-h">
          <h2 className="exp-mine__h" id="exp-mine-h">
            My requests
          </h2>
          <div id="exp-mine-list" aria-live="polite">
            <ErrorBoundary label="Your requests did not load. Refresh the page to try again." className="exp-empty">
              <Suspense fallback={<p className="exp-empty" style={{ minHeight: 56 }}>Loading your requests.</p>}>
                <MineList />
              </Suspense>
            </ErrorBoundary>
          </div>
        </section>

        <ErrorBoundary label="The expense log could not load." className="h-card">
          <Suspense fallback={null}>
            <ExpenseLog />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}

/** Lock: for a person who opened the log with its code (no Google sign-in). It only reads the log's answer, never asks for it. */
function LockButton() {
  const { data } = useQuery({ ...logQuery, enabled: false });
  const show = data?.state === 'ok' && !data.viaGoogle;
  return (
    <button
      type="button"
      className="req-ghost"
      id="exp-lock"
      hidden={!show}
      onClick={() => {
        sendJson('/api/admin/expense-logout', 'POST')
          .catch(() => undefined)
          .then(() => window.location.reload());
      }}
    >
      Lock
    </button>
  );
}

function MineList() {
  const { data } = useSuspenseQuery(mineQuery);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (data.state === 'signin') toSignin();
  }, [data.state]);
  if (data.state === 'signin') return <p className="exp-empty">Loading your requests.</p>;
  if (data.state === 'error') return <p className="exp-empty">Your requests did not load. Refresh the page to try again.</p>;
  if (!data.requests.length) {
    return (
      <p className="exp-empty">
        You have not filed an expense request yet. <NavLink href="/expenses/new/">Start one</NavLink>.
      </p>
    );
  }
  return (
    <>
      {data.requests.map((r, i) => {
        const on = !!open[r.id];
        return (
          <article className="exp-mine-item" key={r.id}>
            <button type="button" className="exp-mine-row" aria-expanded={on} aria-controls={'exp-mine-d' + i} onClick={() => setOpen((o) => ({ ...o, [r.id]: !on }))}>
              <span className="exp-mine-doc">{r.doc_number}</span>
              <span className="exp-mine-date">{shortDate(r.submitted_at)}</span>
              <span className="exp-mine-tot">{money(r.total_cents)}</span>
              <span className="exp-mine-st">
                <span className={'exp-pill ' + r.status}>{statusWord(r.status)}</span>
              </span>
              <span className="exp-mine-appr">{r.approver_name}</span>
            </button>
            {r.pdf ? (
              <a className="exp-pdf-link exp-mine-pdf" href={r.pdf} download>
                Download PDF
              </a>
            ) : null}
            <div className="exp-mine-detail" id={'exp-mine-d' + i} hidden={!on}>
              {on ? <MineDetail r={r} /> : null}
            </div>
          </article>
        );
      })}
    </>
  );
}

function MineDetail({ r }: { r: ExpenseRequest }) {
  const events = r.events || [];
  return (
    <div className="exp-detail">
      <div className="exp-rows">
        <b>Dates</b>
        <span>{r.travel_dates || '—'}</span>
        <b>City / state</b>
        <span>{r.travel_city || '—'}</span>
        <b>Reason</b>
        <span>{r.reason}</span>
        <b>Approver</b>
        <span>{r.approver_name}</span>
        {r.decline_note ? (
          <>
            <b>Decline note</b>
            <span>{r.decline_note}</span>
          </>
        ) : null}
      </div>
      <table className="exp-table">
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
                    <span className="exp-mine__dim">· {it.item}</span>
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
              <img src={r.requester_signature} alt="Your signature" />
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
      {events.length ? (
        <>
          <span className="exp-legend">Timeline</span>
          <ul className="exp-timeline">
            {events.map((ev, k) => (
              <li key={k}>
                <div className="exp-tl-row">
                  <b>{MY_EVENTS[ev.kind] || ev.kind}</b>
                  <span>
                    {ev.actor} · {shortDate(ev.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
