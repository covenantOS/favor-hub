// Learn > Practice: a pretend partner, an Add gift form laid out like Raiser's Edge NXT's, and the Work Center's Log a contact and Add a
// task. Everything saves to FavorOS's own practice table; nothing reaches Blackbaud. Same markup and classes as src/pages/learn/practice.astro.
import '@hub/styles/practice.css';
import '@hub/styles/lint-fix.css';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { sendJson } from './shared/api';
import { plusDays, practiceDay, practiceHistory, practiceMoney, practiceNotes, receiptAmount, todayET, us, type PracticeCheck, type PracticeState } from './logic';
import { learnKeys, practiceQuery, type Read } from './queries';
import { useRetryOnce } from './LearnCommon';

type Kind = 'gift' | 'call' | 'task';
type Draft = Record<string, unknown>;
type Last = { ok: boolean; checks: PracticeCheck[] } | null;

export function PracticePage() {
  return (
    <div className="pr" id="pr">
      <ErrorBoundary label="Practice did not load. Refresh the page to try again." className="pr-off">
        <Suspense
          fallback={
            <>
              <div className="pr-head">
                <div>
                  <h1>Practice</h1>
                </div>
              </div>
              <div className="pr-skel h-skel" />
            </>
          }
        >
          <PracticeBody />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function PracticeBody() {
  const { data, refetch } = useSuspenseQuery(practiceQuery);
  useRetryOnce(data.state === 'error', refetch);
  if (data.state === 'error') {
    return (
      <>
        <div className="pr-head">
          <div>
            <h1>Practice</h1>
          </div>
        </div>
        <div className="pr-off" role="alert">
          {data.message}
        </div>
      </>
    );
  }
  return <Practice D={data.data} />;
}

/** Today in Eastern time, known only in the browser (empty while the page is drawn on the server, so both copies agree). */
function useToday(): string {
  const [t, setT] = useState('');
  useEffect(() => setT(todayET()), []);
  return t;
}

const opts = (list: string[], ph: string) => (
  <>
    <option value="">{ph}</option>
    {list.map((x) => (
      <option key={x} value={x}>
        {x}
      </option>
    ))}
  </>
);

function Practice({ D }: { D: PracticeState }) {
  const qc = useQueryClient();
  const today = useToday();
  const [draft, setDraft] = useState<Record<Kind, Draft>>({ gift: {}, call: {}, task: {} });
  const [last, setLast] = useState<Record<Kind, Last>>({ gift: null, call: null, task: null });
  const [giftOpen, setGiftOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [scrollTo, setScrollTo] = useState<Kind | null>(null);
  const giftRef = useRef<HTMLFormElement>(null);

  const set = (kind: Kind, patch: Draft) => setDraft((d) => ({ ...d, [kind]: { ...d[kind], ...patch } }));
  const val = (kind: Kind, name: string, dflt: string): string => {
    const v = draft[kind][name];
    return v === undefined ? dflt : String(v);
  };
  const putState = (s: PracticeState) => qc.setQueryData<Read<PracticeState>>(learnKeys.practice, (old) => (old && old.state === 'ok' ? { ...old, data: { ...old.data, ...s } } : old));

  useEffect(() => {
    if (giftOpen) giftRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [giftOpen]);
  useEffect(() => {
    if (!scrollTo) return;
    document.querySelector(`.pr-ex[data-ex="${scrollTo === 'gift' ? 'gift' : 'call'}"] .pr-result`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setScrollTo(null);
  }, [scrollTo, last]);

  const submit = async (kind: Kind, e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(kind);
    try {
      const body: Draft = { ...draft[kind] };
      const t = todayET();
      if (kind === 'gift') {
        if (body.date === undefined) body.date = us(t);
        if (!body.type) body.type = 'One-time gift';
        if (!body.method) body.method = 'Cash';
      }
      if (kind === 'call') {
        if (body.date === undefined) body.date = t;
        if (!body.kind) body.kind = 'Phone call';
      }
      if (kind === 'task') {
        if (body.due === undefined) body.due = plusDays(t, 7);
        if (!body.kind) body.kind = 'Task/Other';
      }
      const d = (await sendJson('/api/growth/practice/' + kind, 'POST', body)) as unknown as { passed: boolean; checks: PracticeCheck[]; state: PracticeState };
      setLast((l) => ({ ...l, [kind]: { ok: d.passed, checks: d.checks } }));
      putState(d.state);
      if (d.passed) {
        setDraft((x) => ({ ...x, [kind]: {} }));
        if (kind === 'gift') setGiftOpen(false);
      }
      setScrollTo(kind);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!window.confirm('Clear everything you entered in the practice record?')) return;
    try {
      const d = (await sendJson('/api/growth/practice', 'DELETE')) as unknown as PracticeState;
      putState(d);
      setLast({ gift: null, call: null, task: null });
      setDraft({ gift: {}, call: {}, task: {} });
      setGiftOpen(false);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const result = (kind: Kind) => {
    const r = last[kind];
    if (!r) return null;
    return (
      <div className={'pr-result' + (r.ok ? ' is-ok' : '')} role="status" aria-live="polite">
        <b>{r.ok ? 'Every field is right.' : 'Not yet. Fix the fields marked below and save again.'}</b>
        <ul>
          {r.checks.map((c, i) => (
            <li key={i} className={c.ok ? 'is-ok' : 'is-bad'}>
              <span aria-hidden="true">{c.ok ? '✓' : '✕'}</span>
              <div>
                <b>{c.label}</b>
                {c.ok ? null : <small>{c.hint}</small>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const hist = practiceHistory(D);
  const total = hist.reduce((s, g) => s + g.amount, 0);
  const p = D.partner;
  const method = val('gift', 'method', 'Cash');
  const amount = val('gift', 'amount', '');

  const giftForm = (
    <>
      <form className="pr-gift" data-form="gift" noValidate aria-label={`Add gift for ${p.name}`} ref={giftRef} onSubmit={(e) => void submit('gift', e)}>
        <div className="pr-gift__bar">
          <b>Add gift for {p.name}</b>
          <button type="button" className="pr-x" aria-label="Close" onClick={() => setGiftOpen(false)}>
            &times;
          </button>
        </div>
        <div className="pr-gtabs" role="tablist">
          <span className="is-on" role="tab" aria-selected="true">
            Gift details
          </span>
          <span role="tab" aria-selected="false" aria-disabled="true">
            Fundraiser credits
          </span>
          <span role="tab" aria-selected="false" aria-disabled="true">
            Custom fields
          </span>
        </div>
        <label className="pr-req">
          Amount
          <input type="text" name="amount" inputMode="decimal" autoComplete="off" placeholder="$0.00" value={amount} onChange={(e) => set('gift', { amount: e.target.value })} />
        </label>
        <label className="pr-req">
          Gift date
          <input type="text" name="date" inputMode="numeric" autoComplete="off" placeholder="MM/DD/YYYY" value={val('gift', 'date', today ? us(today) : '')} onChange={(e) => set('gift', { date: e.target.value })} />
          <small>Use the format MM/DD/YYYY.</small>
        </label>
        <p className="pr-ro">
          Receipt amount: <b>{receiptAmount(amount)}</b>
        </p>
        <label className="pr-req">
          Gift type
          <select name="type" value={val('gift', 'type', 'One-time gift')} onChange={(e) => set('gift', { type: e.target.value })}>
            {D.giftTypes.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <div className="pr-field">
          <span>Payment method</span>
          <div className="pr-pay" role="group" aria-label="Payment method">
            {D.methods.map((m) => (
              <button key={m} type="button" className={m === method ? 'is-on' : ''} aria-pressed={m === method} onClick={() => set('gift', { method: m })}>
                {m}
              </button>
            ))}
          </div>
        </div>
        {method === 'Check' ? (
          <div className="pr-two">
            <label>
              Check number
              <input type="text" name="check" inputMode="numeric" autoComplete="off" value={val('gift', 'check', '')} onChange={(e) => set('gift', { check: e.target.value })} />
            </label>
            <label>
              Check date
              <input type="text" name="checkDate" inputMode="numeric" autoComplete="off" placeholder="MM/DD/YYYY" value={val('gift', 'checkDate', '')} onChange={(e) => set('gift', { checkDate: e.target.value })} />
            </label>
          </div>
        ) : null}
        <h4>Gift splits</h4>
        <label>
          Appeal
          <select name="appeal" value={val('gift', 'appeal', '')} onChange={(e) => set('gift', { appeal: e.target.value })}>
            <option value="">Search for an appeal</option>
            {D.appeals.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Package
          <select name="package" disabled>
            <option>Search for a package</option>
          </select>
        </label>
        <label>
          Campaign
          <select name="campaign" disabled>
            <option>Search for a campaign</option>
          </select>
        </label>
        <label className="pr-req">
          Fund
          <select name="fund" value={val('gift', 'fund', '')} onChange={(e) => set('gift', { fund: e.target.value })}>
            {opts(D.funds, 'Search for a fund')}
          </select>
        </label>
        <p className="pr-ro">Soft credits: none. Acknowledgement status: Needs acknowledgement. Receipt status: Needs receipt.</p>
        <div className="pr-gift__foot">
          <button type="submit" className="h-btn h-btn--primary" disabled={busy === 'gift'}>
            Save
          </button>
          <button type="button" className="h-btn h-btn--ghost" onClick={() => setGiftOpen(false)}>
            Cancel
          </button>
        </div>
      </form>
      {result('gift')}
    </>
  );

  const kindButtons = (kind: 'call' | 'task', dflt: string) => (
    <div className="pr-seg" role="group" aria-label="Kind">
      {D.kinds.map(([v, lab]) => {
        const on = v === val(kind, 'kind', dflt);
        return (
          <button key={v} type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={() => set(kind, { kind: v })}>
            {lab}
          </button>
        );
      })}
    </div>
  );

  const tags = (draft.call.tags as string[] | undefined) || [];
  const contactForm = (
    <>
      <form className="pr-compose" data-form="call" noValidate onSubmit={(e) => void submit('call', e)}>
        <div className="pr-compose__top">
          <b>Log a contact</b>
        </div>
        {kindButtons('call', 'Phone call')}
        <label>
          What happened
          <input type="text" name="what" maxLength={255} value={val('call', 'what', '')} onChange={(e) => set('call', { what: e.target.value })} />
        </label>
        <div className="pr-compose__row">
          <label>
            Date
            <input type="date" name="date" value={val('call', 'date', today)} onChange={(e) => set('call', { date: e.target.value })} />
          </label>
          <div className="pr-seg pr-seg--tags" role="group" aria-label="Tags">
            {D.tags.map((t) => (
              <button key={t} type="button" className={tags.includes(t) ? 'is-on' : ''} aria-pressed={tags.includes(t)} onClick={() => set('call', { tags: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] })}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="pr-compose__foot">
          <small>For you</small>
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy === 'call'}>
            Save
          </button>
        </div>
      </form>
      {result('call')}
    </>
  );
  const taskForm = (
    <>
      <form className="pr-compose" data-form="task" noValidate onSubmit={(e) => void submit('task', e)}>
        <div className="pr-compose__top">
          <b>Add a task</b>
        </div>
        {kindButtons('task', 'Task/Other')}
        <label>
          What to do
          <input type="text" name="what" maxLength={255} value={val('task', 'what', '')} onChange={(e) => set('task', { what: e.target.value })} />
        </label>
        <div className="pr-compose__row">
          <label>
            Due
            <input type="date" name="due" value={val('task', 'due', today ? plusDays(today, 7) : '')} onChange={(e) => set('task', { due: e.target.value })} />
          </label>
          <span />
        </div>
        <div className="pr-compose__foot">
          <small>For you</small>
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy === 'task'}>
            Save
          </button>
        </div>
      </form>
      {result('task')}
    </>
  );

  const card = (kind: 'gift' | 'call') => {
    const s = D.scenarios[kind];
    const done = kind === 'gift' ? D.done.gift : D.done.call && D.done.task;
    return (
      <section className="pr-card pr-ex" data-ex={kind}>
        <div className="pr-ex__h">
          <h2>{s.title}</h2>
          {done ? <span className="pr-done">Done</span> : null}
        </div>
        <p className="pr-for">{s.forWho}</p>
        <p className="pr-story">{s.story}</p>
        <ol className="pr-steps">
          {s.steps.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
        {kind === 'gift' ? (
          giftOpen ? (
            giftForm
          ) : (
            <>
              <div className="pr-ex__go">
                <button type="button" className="h-btn h-btn--primary" onClick={() => setGiftOpen(true)}>
                  + Add gift
                </button>
              </div>
              {result('gift')}
            </>
          )
        ) : (
          <>
            {contactForm}
            {taskForm}
          </>
        )}
      </section>
    );
  };

  return (
    <>
      <div className="pr-head">
        <div>
          <h1>Practice</h1>
          <p>A pretend partner and a pretend record. Nothing you enter here goes to Blackbaud or to a real partner.</p>
        </div>
        <div className="pr-head__acts">
          {D.done.all ? <span className="pr-done">Both exercises done</span> : null}
          <button type="button" className="h-btn h-btn--ghost" onClick={() => void reset()}>
            Start over
          </button>
        </div>
      </div>
      {D.ready ? null : (
        <div className="pr-off" role="alert">
          Practice mode is not switched on yet. An admin needs to finish setting it up.
        </div>
      )}
      <div className="pr-grid">
        <section className="pr-card pr-partner" aria-label="The practice partner">
          <div className="pr-partner__top">
            <span className="pr-tag">Practice record</span>
            <h2>{p.name}</h2>
            <p>{p.household}</p>
          </div>
          <dl className="pr-facts">
            <div>
              <dt>Address</dt>
              <dd>{p.address}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{p.phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{p.email}</dd>
            </div>
            <div>
              <dt>Partner since</dt>
              <dd>{practiceDay(p.since)}</dd>
            </div>
            <div>
              <dt>Given in total</dt>
              <dd>{practiceMoney(total)}</dd>
            </div>
          </dl>
          <div className="pr-sech">
            <h3>Giving history</h3>
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => setGiftOpen(true)}>
              + Add gift
            </button>
          </div>
          <div className="pr-table" role="table" aria-label="Giving history">
            <div className="pr-tr pr-tr--h" role="row">
              <span role="columnheader">Date</span>
              <span role="columnheader">Amount</span>
              <span role="columnheader">Type</span>
              <span role="columnheader">Fund</span>
            </div>
            {hist.map((g, i) => (
              <div key={i} className={'pr-tr' + (g.mine ? ' is-mine' : '')} role="row">
                <span role="cell">{practiceDay(g.date)}</span>
                <b role="cell">{practiceMoney(g.amount)}</b>
                <span role="cell">{g.type}</span>
                <span role="cell">
                  {g.fund}
                  {g.mine ? (
                    <>
                      {' '}
                      <i className="pr-you">You</i>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
          <h3>Notes and contacts</h3>
          <ul className="pr-notes">
            {practiceNotes(D).map((n, i) => (
              <li key={i} className={n.mine ? 'is-mine' : ''}>
                <span>
                  {practiceDay(n.date)}
                  {n.mine ? (
                    <>
                      {' '}
                      <i className="pr-you">You</i>
                    </>
                  ) : null}
                </span>
                <p>{n.text}</p>
              </li>
            ))}
          </ul>
        </section>
        <div className="pr-side">
          {card('gift')}
          {card('call')}
        </div>
      </div>
    </>
  );
}
