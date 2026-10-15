// The approver's page: read the request from the emailed link (token) or, for an approver signed in with Google, from the expense log (id),
// then sign and approve or decline with a note. Same markup and words as src/pages/expenses/review.astro and public/js/expenses-review.js.
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Signature, type SigHandle } from './Signature';
import { sendJson, toSignin } from './api';
import { longDate, money, reviewTarget, type ExpenseRequest } from './logic';
import { expKeys, reviewQuery } from './queries';

type Panel = { kind: 'ok' | 'no'; title: string; body: string };

function StatusPanel({ p }: { p: Panel }) {
  return (
    <div className="make-sheet">
      <div className={'exp-status ' + p.kind}>
        <span className="dot">{p.kind === 'ok' ? '✓' : '×'}</span>
        <span>
          <b>{p.title}</b> {p.body}
        </span>
      </div>
    </div>
  );
}

export function ReviewPage() {
  return (
    <div className="exp-page">
      <div className="container">
        <div className="exp-head">
          <div>
            <h1>
              Review &amp; <em>sign</em>
            </h1>
          </div>
          <img src="/images/favor-primary.png" alt="Favor International" />
        </div>
        <p className="exp-lede">Approve sends the signed record to the requester and the finance list. Decline sends your note back to the requester.</p>
        <div id="exp-review-stage">
          <ErrorBoundary label="The request could not load." className="make-sheet">
            <Suspense
              fallback={
                <div className="make-sheet">
                  <p className="exp-empty" style={{ minHeight: 300 }}>
                    Loading the request…
                  </p>
                </div>
              }
            >
              <Stage />
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

function Stage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { token, id } = reviewTarget(search);
  const { data } = useSuspenseQuery(reviewQuery(token, id));
  useEffect(() => {
    if (data.state === 'signin') toSignin();
  }, [data.state]);
  if (data.state === 'none') return <StatusPanel p={{ kind: 'no', title: 'No review link.', body: 'Open this page from the email you were sent, or from the expense log.' }} />;
  if (data.state === 'signin') return <StatusPanel p={{ kind: 'no', title: 'Sign in.', body: 'Taking you to sign-in.' }} />;
  if (data.state === 'error') {
    return (
      <StatusPanel
        p={{
          kind: 'no',
          title: id ? 'This request cannot be opened.' : 'This link is not valid.',
          body: data.message === 'This link is not valid.' ? 'It may have been mistyped. Ask the requester to resubmit.' : data.message,
        }}
      />
    );
  }
  const r = data.request;
  if (r.status !== 'pending') {
    return (
      <>
        <StatusPanel p={{ kind: r.status === 'approved' ? 'ok' : 'no', title: 'Already ' + r.status + '.', body: 'This request was decided on ' + longDate(r.decided_at) + '. Nothing else to do.' }} />
        <Detail r={r} />
      </>
    );
  }
  return <Pending r={r} signer={data.signer} token={token} id={id} />;
}

function Detail({ r }: { r: ExpenseRequest }) {
  return (
    <div className="make-sheet exp-review-card">
      <span className="exp-legend">Request {r.doc_number}</span>
      <div className="exp-rows">
        <b>Requested by</b>
        <span>
          {r.requester_name} &lt;{r.requester_email}&gt;
        </span>
        <b>Dates</b>
        <span>{r.travel_dates || '—'}</span>
        <b>City / state</b>
        <span>{r.travel_city || '—'}</span>
        <b>Submitted</b>
        <span>{longDate(r.submitted_at)}</span>
      </div>
      <table className="exp-table sc-table">
        <tbody>
          <tr>
            <th>Description</th>
            <th>Item</th>
            <th className="r">Est. amount</th>
          </tr>
          {r.items.map((it, i) => (
            <tr key={i}>
              <td>{it.description}</td>
              <td>{it.item}</td>
              <td className="r">{money(it.amount_cents)}</td>
            </tr>
          ))}
          <tr className="tot">
            <td colSpan={2}>Total estimated</td>
            <td className="r">{money(r.total_cents)}</td>
          </tr>
        </tbody>
      </table>
      <div className="exp-rows" style={{ marginTop: 14 }}>
        <b>Reason</b>
        <span>{r.reason}</span>
      </div>
      <div className="exp-sigstamp">
        {r.requester_signature ? <img src={r.requester_signature} alt="Requester signature" /> : null}
        <div className="meta">
          Signed by {r.requester_name}
          <br />
          {longDate(r.submitted_at)} · affirmation checked
        </div>
      </div>
    </div>
  );
}

function Pending({ r, signer, token, id }: { r: ExpenseRequest; signer: string; token: string; id: string }) {
  const qc = useQueryClient();
  const names = r.approvers || [];
  // From the emailed link, when several people may approve, the page asks which of them is signing, so the record and the emails name that one person.
  const [who, setWho] = useState(signer || (names.length === 1 ? names[0] : ''));
  const [declineOpen, setDeclineOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Panel | null>(null);
  const sig = useRef<SigHandle | null>(null);

  useEffect(() => {
    if (result) window.scrollTo({ top: 0 });
  }, [result]);

  if (result) return <StatusPanel p={result} />;

  function decide(action: 'approve' | 'decline') {
    setMsg('');
    if (!who && names.length > 1) {
      setMsg('Choose who is signing first.');
      return;
    }
    if (action === 'approve' && !sig.current?.has()) {
      setMsg('Sign first, then approve.');
      return;
    }
    setBusy(true);
    sendJson('/api/expenses/review', 'POST', {
      token: token || undefined,
      id: id || undefined,
      action,
      signer: who || undefined,
      signature: action === 'approve' ? sig.current?.value() : undefined,
      note: action === 'decline' ? note.trim() : undefined,
    })
      .then((d) => {
        // The next visit reads the new status.
        qc.removeQueries({ queryKey: expKeys.review(token, id) });
        if (d.status === 'approved') {
          setResult({
            kind: 'ok',
            title: 'Approved and signed.',
            body: d.emailed ? 'The signed copy went to ' + r.requester_name + ', you, and the distribution list.' : 'Saved, but the email did not send. Tell Will so he can resend it.',
          });
        } else {
          setResult({ kind: 'no', title: 'Declined.', body: r.requester_name + ' got your note and can fix and resubmit.' });
        }
      })
      .catch((err: Error) => {
        setMsg(err.message || 'Something went wrong. Try again.');
        setBusy(false);
      });
  }

  return (
    <>
      <Detail r={r} />
      <div className="make-sheet">
        {!signer && names.length > 1 ? (
          <fieldset className="make-pills exp-who">
            <legend>Who is signing? One signature is enough.</legend>
            {names.map((n) => (
              <label key={n}>
                <input type="radio" name="exp-who" value={n} checked={who === n} onChange={() => setWho(n)} />
                {n}
              </label>
            ))}
          </fieldset>
        ) : null}
        <span className="exp-legend" id="exp-sig-legend">
          Approver signature{who ? ' · ' + who : ''}
        </span>
        <div id="exp-sig">
          <Signature key={who} prefill={who} handle={sig} />
        </div>
        <div className="exp-foot">
          <button type="button" className="req-submit exp-green" id="exp-approve" disabled={busy} onClick={() => decide('approve')}>
            Approve &amp; sign
          </button>
          <button type="button" className="req-submit exp-danger" id="exp-decline" disabled={busy} onClick={() => setDeclineOpen((o) => !o)}>
            Decline…
          </button>
        </div>
        <div className={'exp-decline-note' + (declineOpen ? ' on' : '')} id="exp-decline-note">
          <label className="req-field">
            <span>Note to the requester</span>
            <textarea id="exp-note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className="req-submit exp-danger" id="exp-decline-confirm" disabled={busy} onClick={() => decide('decline')}>
            Confirm decline
          </button>
        </div>
        <p className="req-msg" id="exp-rv-msg" aria-live="polite">
          {msg}
        </p>
      </div>
    </>
  );
}
