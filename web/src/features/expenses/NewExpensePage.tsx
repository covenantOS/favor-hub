// Staff > Expenses > New expense request. Same fields, steps, mileage calculator, signature and submit as src/pages/expenses/new.astro and
// public/js/expenses-new.js. On a phone the four parts show one at a time (the layout's CSS reads the is-on classes); on a wide screen
// all four show in two columns.
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/crit-forms.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { navQuery } from '../../lib/queries';
import { NavLink } from '@/shell/NavLink';
import { Signature, type SigHandle } from './Signature';
import { sendJson } from './api';
import { DEFAULT_MILEAGE, STEP_TITLES, dollars, lineTotal, mileageLine, mileageNote, missingFields, requestBody, type FormLine } from './logic';
import { mileageQuery } from './queries';

type Line = FormLine & { key: number };
let nextKey = 3;
const blank = (): Line => ({ key: nextKey++ });
const phone = () => window.matchMedia('(max-width: 860px)').matches;

export function NewExpensePage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const asked = typeof search.reason === 'string' ? search.reason : '';
  const nav = useQuery(navQuery);
  const mileage = useQuery(mileageQuery).data || DEFAULT_MILEAGE;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [dates, setDates] = useState('');
  const [city, setCity] = useState('');
  const [reason, setReason] = useState(asked);
  const [affirm, setAffirm] = useState(false);
  const [hp, setHp] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 1 }, { key: 2 }]);
  const [miOpen, setMiOpen] = useState(false);
  const [miles, setMiles] = useState('');
  const [miNote, setMiNote] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ doc: string; approver: string } | null>(null);
  const sig = useRef<SigHandle | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const steps = STEP_TITLES.length;

  // Signed in with Google: name and email come from the account, unless the person has already typed their own.
  const u = nav.data?.user;
  useEffect(() => {
    if (!u || !u.name || (u.via as string) === 'agent' || (u.via as string) === 'guest') return;
    setName((n) => n || u.name || '');
    setEmail((e) => e || u.email || '');
  }, [u]);

  // The first draw of a step does not scroll; moving to another step on a phone brings the form to the top.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (phone()) form.current?.scrollIntoView({ block: 'start' });
  }, [at]);

  const setLine = (key: number, k: keyof FormLine, v: string) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));

  function stepOk(): boolean {
    if (at === 0) {
      if (!name.trim() || !email.trim()) {
        document.getElementById(name.trim() ? 'exp-email' : 'exp-name')?.focus();
        return false;
      }
    }
    if (at === 2 && !reason.trim()) {
      document.getElementById('exp-reason')?.focus();
      return false;
    }
    return true;
  }
  const go = (i: number) => setAt(Math.max(0, Math.min(steps - 1, i)));

  // The keyboard's Next key moves down the form; the last field of a step closes the keyboard and goes on.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || !phone()) return;
    const t = e.target as HTMLInputElement;
    if (!t || t.tagName !== 'INPUT' || ['checkbox', 'radio', 'button', 'submit'].includes(t.type)) return;
    e.preventDefault();
    const stepEl = form.current?.querySelectorAll('.exp-step')[at];
    const fields = [...(stepEl?.querySelectorAll<HTMLInputElement>('input, textarea') || [])].filter((el) => el.offsetParent && !['checkbox', 'radio', 'hidden'].includes(el.type));
    const i = fields.indexOf(t);
    if (i >= 0 && i < fields.length - 1) {
      fields[i + 1].focus();
      return;
    }
    t.blur();
    if (at < steps - 1 && stepOk()) go(at + 1);
  }

  function addMileage() {
    const l = mileageLine(miles, mileage);
    if (!l) {
      setMiNote('Enter the miles driven first.');
      return;
    }
    setLines((ls) => [...ls, { key: nextKey++, ...l }]);
    setMiles('');
    setMiNote(null);
    setMiOpen(false);
  }

  function submit(ev: FormEvent) {
    ev.preventDefault();
    setMsg('');
    const v = { name, email, dates, city, reason, affirm, lines, hasSignature: Boolean(sig.current?.has()) };
    const missing = missingFields(v);
    if (missing.length) {
      setMsg('Still needed: ' + missing.join(', ') + '.');
      return;
    }
    setSending(true);
    sendJson('/api/expenses', 'POST', requestBody(v, sig.current?.value() ?? null, hp))
      .then((d) => {
        setDone({ doc: String(d.doc_number || ''), approver: String(d.approver_name || '') });
        window.scrollTo({ top: 0 });
      })
      .catch((err: Error) => setMsg(err.message || 'Something went wrong. Try again.'))
      .then(() => setSending(false));
  }

  return (
    <div className="exp-page">
      <div className="container">
        <div className="exp-head">
          <div>
            <h1>
              Expense <em>Request</em>
            </h1>
          </div>
          <img src="/images/favor-primary-sm.webp" alt="Favor International" width={40} height={40} />
        </div>
        <p className="exp-lede">Paycom card expenses still go through Paycom.</p>

        <form ref={form} className={'make-sheet is-stepped' + (at === steps - 1 ? ' is-last' : '')} id="exp-form" noValidate hidden={!!done} onSubmit={submit} onKeyDown={onKeyDown}>
          <div className="exp-progress" id="exp-progress" aria-hidden="true">
            {STEP_TITLES.map((t, k) => (
              <span key={t} className={k <= at ? 'is-on' : undefined}></span>
            ))}
          </div>
          <p className="exp-stepname" id="exp-stepname">
            Step {at + 1} of {steps} · {STEP_TITLES[at]}
          </p>

          <div className={'exp-step' + (at === 0 ? ' is-on' : '')} data-step="1" data-title={STEP_TITLES[0]}>
            <span className="exp-legend">Who you are</span>
            <div className="exp-grid2">
              <label className="req-field">
                <span>Name</span>
                <input id="exp-name" required maxLength={80} autoComplete="name" autoCapitalize="words" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="req-field">
                <span>Favor email</span>
                <input id="exp-email" type="email" required maxLength={120} placeholder="you@favorintl.org" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
            </div>

            <span className="exp-legend">Travel details (if any)</span>
            <div className="exp-grid2">
              <label className="req-field">
                <span>Dates</span>
                <input id="exp-dates" maxLength={120} placeholder="Oct 6 – Oct 9" autoComplete="off" enterKeyHint="next" value={dates} onChange={(e) => setDates(e.target.value)} />
              </label>
              <label className="req-field">
                <span>City and state</span>
                <input id="exp-city" maxLength={120} placeholder="Dallas, TX" autoComplete="off" autoCapitalize="words" enterKeyHint="done" value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
            </div>
          </div>

          <div className={'exp-step' + (at === 1 ? ' is-on' : '')} data-step="2" data-title={STEP_TITLES[1]}>
            <span className="exp-legend">Expenses</span>
            <div className="exp-items-head">
              <span>Description</span>
              <span>Item</span>
              <span>Est. amount</span>
              <span></span>
            </div>
            <div id="exp-rows">
              {lines.map((l) => (
                <div className="exp-item-row" key={l.key}>
                  <input placeholder="Description of expense" maxLength={200} autoComplete="off" autoCapitalize="sentences" enterKeyHint="next" aria-label="Description of expense" value={l.description || ''} onChange={(e) => setLine(l.key, 'description', e.target.value)} />
                  <input placeholder="Item" maxLength={80} autoComplete="off" autoCapitalize="sentences" enterKeyHint="next" aria-label="Item" value={l.item || ''} onChange={(e) => setLine(l.key, 'item', e.target.value)} />
                  <input className="exp-amt" placeholder="0.00" inputMode="decimal" autoComplete="off" enterKeyHint="done" aria-label="Estimated amount" value={l.amount || ''} onChange={(e) => setLine(l.key, 'amount', e.target.value)} />
                  <button type="button" className="exp-rm" title="Remove line" aria-label="Remove line" onClick={() => lines.length > 1 && setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="exp-add-row">
              <button
                className="exp-add"
                id="exp-add"
                type="button"
                onClick={() => {
                  setLines((ls) => [...ls, blank()]);
                  // The new line takes the cursor once it is drawn.
                  requestAnimationFrame(() => (document.getElementById('exp-rows')?.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus());
                }}
              >
                + Add another expense
              </button>
              <button className="exp-add" id="exp-mi-toggle" type="button" onClick={() => setMiOpen((o) => !o)}>
                + Calculate mileage
              </button>
            </div>
            <div className="exp-mi-calc" id="exp-mi-calc" hidden={!miOpen}>
              <span className="exp-legend">Mileage calculator</span>
              <label className="req-field">
                <span>Miles driven (total for the trip)</span>
                <input id="exp-mi-miles" inputMode="decimal" placeholder="0" autoComplete="off" enterKeyHint="done" value={miles} onChange={(e) => (setMiles(e.target.value), setMiNote(null))} />
              </label>
              <p className="exp-mi-note" id="exp-mi-note">
                {miNote ?? mileageNote(miles, mileage)}
              </p>
              <div className="exp-mi-foot">
                <button type="button" className="req-admin-btn" id="exp-mi-add" onClick={addMileage}>
                  Add to expenses
                </button>
                <button type="button" className="req-ghost" id="exp-mi-cancel" onClick={() => setMiOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
            <div className="exp-total">
              <span className="lbl">Total estimated</span>
              <span className="val" id="exp-total-val">
                {dollars(lineTotal(lines))}
              </span>
            </div>
          </div>

          <div className={'exp-step' + (at === 2 ? ' is-on' : '')} data-step="3" data-title={STEP_TITLES[2]}>
            <span className="exp-legend">Reason</span>
            <label className="req-field">
              <span>Why is this needed?</span>
              <textarea id="exp-reason" required maxLength={4000} autoCapitalize="sentences" placeholder="The trip's purpose, or what the purchase supports" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>

          <div className={'exp-step' + (at === 3 ? ' is-on' : '')} data-step="4" data-title={STEP_TITLES[3]}>
            <span className="exp-legend">Affirmation</span>
            <label className="exp-affirm">
              <input type="checkbox" id="exp-affirm" checked={affirm} onChange={(e) => setAffirm(e.target.checked)} /> I affirm that all of the above items are accurate to the best of my knowledge.
            </label>

            <span className="exp-legend">Your signature</span>
            <div id="exp-sig">
              <Signature handle={sig} />
            </div>
          </div>

          <input className="req-hp" id="exp-hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          <div className="exp-foot">
            <button className="req-submit exp-green" type="submit" id="exp-submit" disabled={sending}>
              {sending ? 'Sending…' : 'Submit for approval'}
            </button>
            <p className="exp-note">Goes to your approver to sign. You get the decision by email.</p>
          </div>
          <p className="req-msg" id="exp-msg" aria-live="polite">
            {msg}
          </p>
          <div className="exp-nav" id="exp-nav">
            <button type="button" className="h-btn h-btn--ghost" id="exp-back" hidden={at === 0} onClick={() => go(at - 1)}>
              Back
            </button>
            <button type="button" className="h-btn h-btn--primary" id="exp-next" hidden={at === steps - 1} onClick={() => stepOk() && go(at + 1)}>
              Next
            </button>
          </div>
        </form>

        <div className="make-done" id="exp-done" hidden={!done}>
          <p className="make-kicker">Sent for approval</p>
          <h2>
            <span id="exp-done-doc">{done?.doc}</span> is on its way.
          </h2>
          <p>
            <span id="exp-done-approver">{done?.approver}</span> got an email with your request and will review and sign it. You get an email the moment it is decided.
          </p>
          <div className="make-done__actions">
            <NavLink className="req-submit" href="/">
              Back to the dash
            </NavLink>
            <button type="button" className="req-ghost" id="exp-again" onClick={() => window.location.reload()}>
              Submit another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
