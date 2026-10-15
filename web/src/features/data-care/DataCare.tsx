import '../../styles/data-care.css';
import { Suspense, startTransition, useEffect, useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { send } from '@/lib/api';
import { count, money0, dayShort } from '@/lib/format';
import { NavLink } from '@/shell/NavLink';
import { dcKeys, FLAG_PAGE, flagsQuery, pairQuery, pairsQuery, summaryQuery } from './queries';
import { WHY, type Compare, type Pair, type Side } from './types';

const PAGE = 9;
const scoreClass = (n: number) => (n >= 60 ? '' : n >= 50 ? ' is-mid' : ' is-low');
const when = (iso: string | null) => (iso ? dayShort(iso.slice(0, 10)) : '');

const Skel = ({ h, n = 1, cls = 'dc-pair' }: { h?: number; n?: number; cls?: string }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className={cls + ' r2t-skel'} style={h ? { height: h } : undefined} aria-hidden="true" />
    ))}
  </>
);

// Every part that draws from a read sits in Suspense, so the server sends finished HTML and the browser hydrates the same markup.
export function DataCare() {
  return (
    <div className="dc">
      <ErrorBoundary label="The Data care totals could not load." className="h-card">
        <Suspense fallback={<section className="h-card dc-stats" style={{ minHeight: 112 }} aria-hidden="true" />}>
          <Head />
        </Suspense>
      </ErrorBoundary>
      <div className="dc-grid">
        <ErrorBoundary label="The duplicates could not load." className="h-card">
          <Duplicates />
        </ErrorBoundary>
        <ErrorBoundary label="The comparison could not load." className="h-card">
          <Suspense
            fallback={
              <section className="h-card dc-compare">
                <Skel h={420} cls="dc-ch" />
              </section>
            }
          >
            <Compared />
          </Suspense>
        </ErrorBoundary>
      </div>
      <ErrorBoundary label="The list could not load." className="h-card">
        <Missing />
      </ErrorBoundary>
    </div>
  );
}

function Head() {
  const { data } = useSuspenseQuery(summaryQuery);
  const s = data.summary;
  return (
    <>
      <section className="h-card dc-stats" aria-label="Data care totals">
        <div className="dc-stat">
          <small>Possible duplicates</small>
          <b>{count(s.pairs.review)}</b>
          <span>{`${count(s.pairs.merged)} merged, ${count(s.pairs.notSame)} marked not the same`}</span>
        </div>
        <div className="dc-stat">
          <small>Gave this year, no mailing address</small>
          <b>{count(s.noAddress.open)}</b>
          <span>{`${money0(s.noAddress.gave)} in the last 12 months`}</span>
        </div>
        <div className="dc-stat">
          <small>Fixed since the list started</small>
          <b>{count(s.noAddress.fixed)}</b>
          <span>
            {s.sheet ? (
              <a href={s.sheet} target="_blank" rel="noreferrer">
                Open the Google Sheet
              </a>
            ) : s.scannedAt ? (
              `Checked ${when(s.scannedAt)}`
            ) : (
              ' '
            )}
          </span>
        </div>
      </section>
      {data.me.admin ? <AssignBar s={s} /> : null}
    </>
  );
}

function AssignBar({ s }: { s: import('./types').Summary }) {
  const qc = useQueryClient();
  const [sure, setSure] = useState(false);
  const m = useMutation({
    mutationFn: () => send('/api/datacare/assign', {}),
    onSuccess: () => {
      setSure(false);
      void qc.invalidateQueries({ queryKey: dcKeys.summary });
    },
  });
  if (s.assigned) {
    return (
      <section className="h-card dc-assign">
        <p>
          Assigned to {s.reviewer.name} on {when(s.assigned.at)} with an email and a task in FavorOS.
        </p>
      </section>
    );
  }
  return (
    <section className="h-card dc-assign">
      <p>{s.reviewer.name} reviews this list. Assigning sends one email with a link and puts a task and a tag in FavorOS.</p>
      {sure ? (
        <>
          <button type="button" className="h-btn h-btn--primary" disabled={m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Sending' : `Send to ${s.reviewer.name}`}
          </button>
          <button type="button" className="h-btn h-btn--ghost" onClick={() => setSure(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="h-btn h-btn--primary" onClick={() => setSure(true)}>
          Assign the review
        </button>
      )}
      {m.isError ? <p className="dc-bad">{(m.error as Error).message}</p> : null}
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- duplicates */

type Tab = 'review' | 'not_same' | 'done';

function Duplicates() {
  const [tab, setTab] = useState<Tab>('review');
  const [page, setPage] = useState(0);
  return (
    <section className="h-card dc-listcard" aria-label="Possible duplicates">
      <div className="dc-h">
        <h2>Possible duplicates</h2>
      </div>
      <Suspense fallback={<Skel n={6} />}>
        <PairBody
          tab={tab}
          page={page}
          setTab={(t) =>
            startTransition(() => {
              setTab(t);
              setPage(0);
            })
          }
          setPage={(n) => startTransition(() => setPage(n))}
        />
      </Suspense>
    </section>
  );
}

function PairBody({ tab, page, setTab, setPage }: { tab: Tab; page: number; setTab: (t: Tab) => void; setPage: (n: number) => void }) {
  const sum = useSuspenseQuery(summaryQuery).data.summary;
  const pairs = useSuspenseQuery(pairsQuery(tab)).data;
  const [params, setParams] = useSelected();
  const picked = params || pairs[0]?.id || '';
  const pages = Math.max(1, Math.ceil(pairs.length / PAGE));
  const slice = pairs.slice(page * PAGE, page * PAGE + PAGE);
  const tabs: [Tab, string, number][] = [
    ['review', 'To review', sum.pairs.review],
    ['not_same', 'Not the same', sum.pairs.notSame],
    ['done', 'Merged', sum.pairs.merged + sum.pairs.queued + sum.pairs.failed],
  ];
  return (
    <>
      <div className="dc-tabs" role="group" aria-label="Show">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" className="dc-tab" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label} {count(n)}
          </button>
        ))}
      </div>
      {slice.length === 0 ? (
        <p className="dc-empty">{tab === 'review' ? 'No pairs waiting. The list rebuilds every hour from the Blackbaud copy.' : 'Nothing here yet.'}</p>
      ) : (
        slice.map((p) => (
          <button key={p.id} type="button" className="dc-pair" aria-current={p.id === picked} onClick={() => setParams(p.id)}>
            <span className={'dc-score' + scoreClass(p.score)}>{p.score}</span>
            <span style={{ minWidth: 0 }}>
              <b>
                {p.a.name} · {p.b.name}
              </b>
              <small>{p.state === 'queued' ? 'Merge waiting to run' : p.state === 'merged' ? p.result || 'Merged' : p.state === 'failed' ? 'Did not merge' : p.why}</small>
            </span>
          </button>
        ))
      )}
      <div className="dc-pager">
        <span>{pairs.length ? `${page * PAGE + 1} to ${Math.min(pairs.length, page * PAGE + PAGE)} of ${count(pairs.length)}` : ''}</span>
        <div>
          <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <button type="button" aria-label="Next page" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      </div>
    </>
  );
}

// The pair on screen lives in the address (?pair=), so Back, a shared link and a reload keep it.
function useSelected(): [string, (id: string) => void] {
  const [id, setId] = useState('');
  useEffect(() => {
    const read = () => setId(new URLSearchParams(location.search).get('pair') || '');
    read();
    window.addEventListener('popstate', read);
    window.addEventListener('dc-pair', read);
    return () => {
      window.removeEventListener('popstate', read);
      window.removeEventListener('dc-pair', read);
    };
  }, []);
  return [
    id,
    (next: string) => {
      const u = new URL(location.href);
      u.searchParams.set('pair', next);
      history.replaceState(null, '', u.pathname + u.search);
      startTransition(() => {
        window.dispatchEvent(new Event('dc-pair'));
      });
    },
  ];
}

function Compared() {
  const [selected, setSelected] = useSelected();
  const reviewIds = useSuspenseQuery(pairsQuery('review')).data.map((p) => p.id);
  const id = selected || reviewIds[0] || '';
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/input|textarea|select/i.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'j' && reviewIds.length) {
        const i = reviewIds.indexOf(id);
        setSelected(reviewIds[(i + 1) % reviewIds.length]);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  if (!id) {
    return (
      <section className="h-card dc-compare">
        <p className="dc-empty">Pick a pair on the left to line the two records up.</p>
      </section>
    );
  }
  return <ComparedPair key={id} id={id} nextId={reviewIds.find((x) => x !== id) || ''} onNext={setSelected} />;
}

function ComparedPair({ id, nextId, onNext }: { id: string; nextId: string; onNext: (id: string) => void }) {
  const { pair, compare } = useSuspenseQuery(pairQuery(id)).data;
  return <Card pair={pair} compare={compare} nextId={nextId} onNext={onNext} />;
}

type Pick = 'keep' | 'other';

function Card({ pair, compare, nextId, onNext }: { pair: Pair; compare: Compare | null; nextId: string; onNext: (id: string) => void }) {
  const qc = useQueryClient();
  const [keep, setKeep] = useState<'a' | 'b'>(compare?.suggestKeep || 'a');
  const [name, setName] = useState<Pick>('keep');
  const [contact, setContact] = useState<Pick>('keep');
  const [sure, setSure] = useState(false);
  const decided = pair.state !== 'review';
  const decide = useMutation({
    mutationFn: (body: Record<string, unknown>) => send('/api/datacare/pair/decide', { id: pair.id, ...body }),
    onSuccess: () => {
      setSure(false);
      void qc.invalidateQueries({ queryKey: dcKeys.all });
    },
  });
  if (!compare) {
    return (
      <section className="h-card dc-compare">
        <div className="dc-ch">
          <h2>
            {pair.a.name} and {pair.b.name}
          </h2>
        </div>
        <p className="dc-bad">One of these records is no longer in the Blackbaud copy, so it cannot be lined up. Refresh in a few hours.</p>
      </section>
    );
  }
  const A = compare.a;
  const B = compare.b;
  const keepSide = keep === 'a' ? A : B;
  const otherSide = keep === 'a' ? B : A;
  const nameFrom = name === 'keep' ? keepSide : otherSide;
  const contactFrom = contact === 'keep' ? keepSide : otherSide;
  const cell = (s: Side, text: string | null, none: string, picked: boolean) => (
    <div className={(picked ? 'is-pick ' : '') + (text ? '' : 'is-none')}>{text || none}</div>
  );
  // A radio in a row picks which record that detail comes from. The record that stays is chosen at the top.
  const radio = (field: 'name' | 'contact', s: Side) => {
    const isKeep = s.id === keepSide.id;
    const val: Pick = isKeep ? 'keep' : 'other';
    const cur = field === 'name' ? name : contact;
    return <input type="radio" className="dc-radio" name={`${pair.id}-${field}`} checked={cur === val} onChange={() => (field === 'name' ? setName(val) : setContact(val))} aria-label={`Use the ${field} from record ${s.lookup}`} disabled={decided} />;
  };
  const row = (label: string, left: React.ReactNode, right: React.ReactNode) => (
    <>
      <div className="dc-k">{label}</div>
      {left}
      {right}
    </>
  );
  const gifts = (s: Side) => (s.gifts.n ? `${s.gifts.n} gifts, ${money0(s.gifts.total)}${s.gifts.last ? ', last ' + dayShort(s.gifts.last) : ''}` : 'No gifts');
  const acts = (s: Side) => (s.actions.n ? `${s.actions.n} ${s.actions.n === 1 ? 'action' : 'actions'}${s.actions.last ? ', last ' + dayShort(s.actions.last) : ''}` : 'No actions');
  const mergeLabel = `Merge into record ${keep === 'a' ? 'A' : 'B'}`;
  return (
    <section className="h-card dc-compare" aria-label="Pair side by side">
      <div className="dc-ch">
        <h2>
          {A.name} and {B.name}
        </h2>
        <span>{pair.why}</span>
        <span className={'dc-score' + scoreClass(pair.score)}>Score {pair.score}</span>
      </div>
      {pair.state === 'queued' ? <p className="dc-note">This merge is waiting to run. It finishes within a few minutes and this page updates.</p> : null}
      {pair.state === 'merged' ? <p className="dc-ok">{pair.result || 'Merged.'}</p> : null}
      {pair.state === 'failed' ? <p className="dc-bad">The merge did not go through: {pair.result || 'Blackbaud turned it down.'} Nothing changed in either record.</p> : null}
      {pair.state === 'not_same' ? <p className="dc-note">Marked not the same person{pair.decidedBy ? ' by ' + pair.decidedBy : ''}.</p> : null}
      <div className="dc-table" role="table">
        <div className="dc-k" />
        <div className="dc-col">Record A</div>
        <div className="dc-col">Record B</div>
        {row(
          'Keep',
          <label className={keep === 'a' ? 'is-pick' : ''} style={{ cursor: decided ? 'default' : 'pointer' }}>
            <input type="radio" className="dc-radio" name={pair.id + '-keep'} checked={keep === 'a'} onChange={() => setKeep('a')} disabled={decided} />#{A.lookup}
          </label>,
          <label className={keep === 'b' ? 'is-pick' : ''} style={{ cursor: decided ? 'default' : 'pointer' }}>
            <input type="radio" className="dc-radio" name={pair.id + '-keep'} checked={keep === 'b'} onChange={() => setKeep('b')} disabled={decided} />#{B.lookup}
          </label>
        )}
        {row(
          'Name',
          <div className={nameFrom.id === A.id ? 'is-pick' : ''}>{radio('name', A)}{A.name}</div>,
          <div className={nameFrom.id === B.id ? 'is-pick' : ''}>{radio('name', B)}{B.name}</div>
        )}
        {row(
          'Address',
          <div className={(contactFrom.id === A.id ? 'is-pick ' : '') + (A.address ? '' : 'is-none')}>{radio('contact', A)}{A.address ? A.address + (A.addressDoNotMail ? ' (Do not mail)' : '') : 'None'}</div>,
          <div className={(contactFrom.id === B.id ? 'is-pick ' : '') + (B.address ? '' : 'is-none')}>{radio('contact', B)}{B.address ? B.address + (B.addressDoNotMail ? ' (Do not mail)' : '') : 'None'}</div>
        )}
        {row('Phone', cell(A, A.phone, 'None', contactFrom.id === A.id), cell(B, B.phone, 'None', contactFrom.id === B.id))}
        {row('Email', cell(A, A.emails.join(', '), 'None', false), cell(B, B.emails.join(', '), 'None', false))}
        {row('Codes', cell(A, A.codes.join(', '), 'None', false), cell(B, B.codes.join(', '), 'None', false))}
        {row('Held by', cell(A, A.heldBy.join(', '), 'Nobody', false), cell(B, B.heldBy.join(', '), 'Nobody', false))}
        {row('Gifts', cell(A, A.gifts.n ? gifts(A) : null, 'No gifts', false), cell(B, B.gifts.n ? gifts(B) : null, 'No gifts', false))}
        {row('Actions', cell(A, A.actions.n ? acts(A) : null, 'No actions', false), cell(B, B.actions.n ? acts(B) : null, 'No actions', false))}
        {row('Added', cell(A, A.added ? dayShort(A.added) + ', ' + A.added.slice(0, 4) : null, '', false), cell(B, B.added ? dayShort(B.added) + ', ' + B.added.slice(0, 4) : null, '', false))}
      </div>
      {decide.isError ? <p className="dc-bad">{(decide.error as Error).message}</p> : null}
      {sure ? (
        <p className="dc-note">
          Record #{otherSide.lookup} ({otherSide.name}) merges into #{keepSide.lookup} ({keepSide.name}). Every gift, action, note and code moves to #{keepSide.lookup}. The name comes from #{nameFrom.lookup} and the contact details from #{contactFrom.lookup}. A merge cannot be undone.
        </p>
      ) : null}
      <div className="dc-acts">
        {!decided ? (
          sure ? (
            <>
              <button type="button" className="h-btn h-btn--primary" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'merge', keep, picks: { name, contact, personal: 'keep' } })}>
                {decide.isPending ? 'Queuing' : 'Yes, merge'}
              </button>
              <button type="button" className="h-btn h-btn--ghost" onClick={() => setSure(false)}>
                Not yet
              </button>
            </>
          ) : (
            <>
              <button type="button" className="h-btn h-btn--primary" onClick={() => setSure(true)}>
                {mergeLabel}
              </button>
              <button type="button" className="h-btn h-btn--ghost" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'not_same' })}>
                Not the same person
              </button>
            </>
          )
        ) : pair.state === 'not_same' ? (
          <button type="button" className="h-btn h-btn--ghost" disabled={decide.isPending} onClick={() => decide.mutate({ action: 'undo' })}>
            Put back in review
          </button>
        ) : null}
        <span className="dc-grow" />
        {nextId ? (
          <button type="button" className="dc-link" onClick={() => onNext(nextId)}>
            Next pair: J
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- missing addresses */

type FlagState = 'open' | 'fixed' | 'name';

function Missing() {
  const [state, setState] = useState<FlagState>('open');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(() => {
        setQ(term.trim());
        setOffset(0);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [term]);
  return (
    <section className="h-card dc-miss" aria-label="Gave this year, no mailing address">
      <Suspense
        fallback={
          <div className="dc-h">
            <h2>Gave this year, no mailing address</h2>
          </div>
        }
      >
        <MissingHead />
      </Suspense>
      <div className="dc-tabs">
        <Suspense fallback={<span style={{ minHeight: 34 }} aria-hidden="true" />}>
          <MissingTabs
            state={state}
            setState={(v) =>
              startTransition(() => {
                setState(v);
                setOffset(0);
              })
            }
          />
        </Suspense>
        <input className="dc-search" type="search" placeholder="Find a partner" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Find a partner in this list" />
      </div>
      <div className="dc-row dc-head" role="row">
        <span>Partner</span>
        <span style={{ textAlign: 'right' }}>Gave</span>
        <span>Last gift</span>
        <span>Email on file</span>
        <span>{state === 'fixed' ? 'Fixed' : state === 'name' ? 'Check' : 'Why'}</span>
        <span />
      </div>
      <Suspense fallback={<Skel n={6} cls="dc-row" />}>
        <MissingRows state={state} q={q} offset={offset} setOffset={(n) => startTransition(() => setOffset(n))} />
      </Suspense>
    </section>
  );
}

function MissingHead() {
  const sum = useSuspenseQuery(summaryQuery).data.summary;
  return (
    <div className="dc-h">
      <h2>Gave this year, no mailing address</h2>
      <span>{`${count(sum.noAddress.open)} partners, ${money0(sum.noAddress.gave)} in 12 months`}</span>
    </div>
  );
}

function MissingTabs({ state, setState }: { state: FlagState; setState: (v: FlagState) => void }) {
  const sum = useSuspenseQuery(summaryQuery).data.summary;
  return (
    <>
      <button type="button" className="dc-tab" aria-pressed={state === 'open'} onClick={() => setState('open')}>
        Waiting {count(sum.noAddress.open)}
      </button>
      <button type="button" className="dc-tab" aria-pressed={state === 'fixed'} onClick={() => setState('fixed')}>
        Fixed {count(sum.noAddress.fixed)}
      </button>
      {sum.nameCheck > 0 ? (
        <button type="button" className="dc-tab" aria-pressed={state === 'name'} onClick={() => setState('name')}>
          Name check {count(sum.nameCheck)}
        </button>
      ) : null}
    </>
  );
}

function MissingRows({ state, q, offset, setOffset }: { state: FlagState; q: string; offset: number; setOffset: (n: number) => void }) {
  const { rows, total } = useSuspenseQuery(flagsQuery(state, q, offset)).data;
  return (
    <>
      {rows.length === 0 ? (
        <p className="dc-empty">{q ? 'No partner on this list matches that.' : state === 'fixed' ? 'No partner has been fixed yet. A partner moves here when an address appears in Blackbaud.' : 'Every partner who gave this year has a mailing address.'}</p>
      ) : (
        rows.map((f) => (
          <div key={f.cid} className="dc-row">
            <b title={f.name}>
              <NavLink href={'/work/partner/' + f.cid}>{f.name || 'No name on file'}</NavLink>
              {f.note ? <small className="dc-note">{f.note}</small> : null}
            </b>
            <span className="dc-amt">{money0(f.gave)}</span>
            <span>{when(f.lastGift)}</span>
            <span>{f.email || 'None'}</span>
            {state === 'fixed' ? <span>{f.fixedAt ? when(f.fixedAt) : ''}</span> : <span className="dc-why">{WHY[f.why] || WHY.none}</span>}
            <span>
              <NavLink href={'/work/partner/' + f.cid} className="dc-link">
                {state === 'fixed' || state === 'name' ? 'Open' : 'Add address'}
              </NavLink>
            </span>
          </div>
        ))
      )}
      <div className="dc-pager">
        <span>{total ? `${offset + 1} to ${Math.min(total, offset + FLAG_PAGE)} of ${count(total)}` : ''}</span>
        <div>
          <button type="button" aria-label="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - FLAG_PAGE))}>
            ‹
          </button>
          <button type="button" aria-label="Next page" disabled={offset + FLAG_PAGE >= total} onClick={() => setOffset(offset + FLAG_PAGE)}>
            ›
          </button>
        </div>
      </div>
    </>
  );
}
