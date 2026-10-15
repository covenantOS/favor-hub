// Gifts > First-gift letters (/gifts/first-gifts/): the thank-you letters to partners whose first gift came from an acquisition mailing. Replaces the Database
// View "Donor Acknowledgement Letters" export and the monthly merge. The list is Blackbaud's own waiting list cut to acquisition first gifts; a print file is made,
// downloaded and printed, and only then are its gifts marked acknowledged in Blackbaud. Reads run through Suspense on the server and in the browser; nothing here
// reads window, document or localStorage while drawing.
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/foundations.css';
import '@hub/styles/receipts.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/crit-forms.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/break-ui.css';
import '../receipts/styles.css';
import './styles.css';
import { Boundary } from '../partners/record/Boundary';
import { hubGet } from '../../lib/hub';
import { ListError, MakeSkeleton, StatsSkeleton } from '../receipts/Panels';
import { day, money, num, plural, shortDay, stamp, today, etDay } from '../receipts/format';
import { SheetsButton } from '../receipts/SheetsButton';
import { PageToast, toast } from '../receipts/toast';
import { batchesQuery, DEFAULT_DAYS, fglApi, fglKeys, viewPath, viewQuery, wordingQuery, type Batch, type FglError, type Item, type SignerKey, type View, type Wording } from './api';

const TABS: [string, string][] = [
  ['letters', 'Letters'],
  ['held', 'Held back'],
  ['past', 'Print files'],
  ['wording', 'Letter wording'],
];
const DAY_CHOICES = [30, 60, 90, 180, 365];
const PAGE = 50;
const SIGNERS: [SignerKey, string][] = [
  ['carole', 'Carole Ward'],
  ['terry', 'Terry Goodman'],
  ['rachel', 'Rachel Cox'],
  ['michael', 'Michael Hinton'],
];
const HELD: Record<string, [string, string]> = {
  no_address: ['No mailing address', 'Add the address in Blackbaud and the gift comes back to the letters.'],
  no_mail: ['Do not mail', 'The record is marked Do Not Mail, Do Not Contact or Do Not Mail Thank You, or its address is marked not to send mail.'],
  deceased: ['Marked deceased', ''],
  inactive: ['Record marked inactive', ''],
  abroad: ['Outside the U.S.', 'First-gift letters go to U.S. addresses only.'],
  preference: ['Asked for less mail', 'The record is marked Do Not Mail Solicitation, Do Not Solicit, All Email or Event Invitations Only.'],
  organization: ['Foundation, business or fund', 'Churches and ministries get letters. Other organizations do not, and neither does a person whose gift came through a foundation, business or DAF.'],
  pass_through: ['Passed along for a partner', 'A fund or brokerage sent it for someone else.'],
  gift_type: ['Other gift types', ''],
  in_receipts: ['In a receipts print file', 'It is already on a printed receipt that has not been marked yet.'],
};

export function FirstGiftsPage() {
  const qc = useQueryClient();
  return (
    <>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <Boundary
            fallback={(e, retry) => (
              <Frame>
                <div id="rcp-app">
                  <section className="ticker fnd-band rcp-band" aria-label="Waiting">
                    <div className="ticker__label">Waiting for a first-gift letter</div>
                    <div className="fnd-band__row">
                      <ListError
                        message={e.message}
                        onRetry={() => {
                          reset();
                          qc.removeQueries({ queryKey: ['fgl'] });
                          retry();
                        }}
                      />
                    </div>
                  </section>
                </div>
              </Frame>
            )}
          >
            <Suspense
              fallback={
                <Frame>
                  <Loading />
                </Frame>
              }
            >
              <Desk />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
      <PageToast id="rcp-toast" />
    </>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="fnd-page rcp-page">
      <div className="container">
        <header className="board-intro">
          <div>
            <h1>First-gift letters</h1>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Loading({ slow }: { slow?: boolean }) {
  return (
    <div id="rcp-app">
      <section className="ticker fnd-band rcp-band" aria-label="Waiting">
        <div className="ticker__label">Waiting for a first-gift letter</div>
        <div className="fnd-band__row">
          <StatsSkeleton slow={slow} />
        </div>
      </section>
      <section className="make-sheet rcp-make" aria-live="polite">
        <MakeSkeleton />
      </section>
      <div className="fnd-tabs" role="tablist" />
    </div>
  );
}

const Stat = ({ n, cap }: { n: number | string; cap: ReactNode }) => (
  <div className="ticker__stat">
    <div className="ticker__num">{typeof n === 'number' ? num(n) : n}</div>
    <div className="ticker__caption">{cap}</div>
  </div>
);

/** A question under a button, in place of the browser's own box (phone and in-app browsers refuse it). */
function Ask({ question, yes, no, danger, onYes, onNo }: { question: string; yes: string; no: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} className={`rcp-ask${danger ? ' is-danger' : ''}`} role="group">
      <p>{question}</p>
      <div className="rcp-ask__row">
        <button type="button" className={`req-submit${danger ? ' rcp-danger' : ''}`} onClick={onYes} autoFocus>
          {yes}
        </button>
        <button type="button" className="fnd-textbtn is-quiet" onClick={onNo}>
          {no}
        </button>
      </div>
    </div>
  );
}

function Desk() {
  const qc = useQueryClient();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [{ data: view }, { data: batchData }] = useSuspenseQueries({ queries: [viewQuery(days), batchesQuery] });
  const batches = batchData.batches;

  const [tab, setTab] = useState('letters');
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [letterDate, setLetterDate] = useState('');
  const [signer, setSigner] = useState<SignerKey | ''>('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [heldOpen, setHeldOpen] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState<'' | 'make' | 'mark' | 'cancel'>('');
  const [downloadedHere, setDownloadedHere] = useState<Record<string, string>>({});
  const appRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(0);
  const busyRef = useRef(false);
  const markingRef = useRef(false);
  const resumedRef = useRef(false);
  const S = useRef({ view, days, letterDate, signer, left });
  S.current = { view, days, letterDate, signer, left };

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('fgl_days'));
      if (saved && saved !== DEFAULT_DAYS && DAY_CHOICES.includes(saved)) void reload(saved);
    } catch {
      /* no storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (!markingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [loading]);

  const setBusyBoth = (b: boolean) => {
    busyRef.current = b;
    setBusy(b);
  };

  async function reload(nextDays = S.current.days): Promise<void> {
    setHeld(appRef.current ? appRef.current.offsetHeight : 0);
    setLoading(true);
    setLoadError('');
    const [v, past] = await Promise.allSettled([
      qc.fetchQuery({ queryKey: fglKeys.view(nextDays), queryFn: () => hubGet(viewPath(nextDays, true)) as Promise<View>, staleTime: 0 }),
      qc.fetchQuery({ queryKey: fglKeys.batches, queryFn: () => (hubGet('/api/gifts/first-gifts/batches') as Promise<{ batches: Batch[] }>).catch(() => ({ batches: [] as Batch[] })), staleTime: 0 }),
    ]);
    if (past.status === 'rejected') qc.setQueryData(fglKeys.batches, { batches: [] });
    if (v.status === 'rejected') {
      setLoadError(((v.reason as FglError) && (v.reason as FglError).message) || 'Something went wrong. Try again.');
      setLoading(false);
      setHeld(0);
      return;
    }
    setDays(nextDays);
    setLeft((cur) => new Set([...cur].filter((id) => v.value.letters.some((l) => l.id === id))));
    setLoading(false);
    setHeld(0);
  }

  const open = batches.find((b) => b.status === 'printing' || b.status === 'marking');
  useEffect(() => {
    if (loading || loadError) return;
    if (open && open.status === 'marking' && !busyRef.current && !resumedRef.current) {
      const todo = (open.gifts || open.count) - (open.marked || 0) - (open.markFailed || 0);
      if (todo > 0) {
        resumedRef.current = true;
        toast(`Finishing the marking that stopped at ${open.marked} of ${plural(open.gifts || open.count, 'gift')}.`);
        void markBatch(open.id, true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, loadError]);

  const printable = view.letters.filter((l) => !l.batch && !left.has(l.id));
  const chosenSigner: SignerKey = (signer || view.wording.signer) as SignerKey;

  async function makeFile() {
    setAsking('');
    if (busyRef.current || !printable.length) return;
    setBusyBoth(true);
    try {
      const out = await fglApi<{ batch: Batch; skipped?: unknown[] }>('/api/gifts/first-gifts/batches', {
        body: { ids: printable.map((l) => l.id), letterDate: S.current.letterDate || today(), signer: chosenSigner, days: S.current.days },
      });
      setLeft(new Set());
      toast(`${plural(out.batch.count, 'letter')} ready to print.${out.skipped && out.skipped.length ? ` ${out.skipped.length} changed in Blackbaud and were left out.` : ''}`);
      setBusyBoth(false);
      await reload();
    } catch (err) {
      setBusyBoth(false);
      toast((err as Error).message);
    }
  }

  async function markOnce(id: string, retry: boolean) {
    const waits = [2000, 5000, 10000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fglApi<{ batch: Batch; marked: number; failed: number; waiting: number; stopped: string }>(`/api/gifts/first-gifts/batches/${encodeURIComponent(id)}/mark`, { body: { retry } });
      } catch (err) {
        const e = err as FglError;
        const passing = !e.status || e.status >= 500;
        if (!passing || attempt >= waits.length) throw err;
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  }

  async function markBatch(id: string, resume = false) {
    setAsking('');
    if (busyRef.current) return;
    void resume;
    setBusyBoth(true);
    markingRef.current = true;
    let retry = false;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const out = await markOnce(id, retry);
        retry = false;
        qc.setQueryData(fglKeys.batches, (old: { batches: Batch[] } | undefined) => ({ batches: (old ? old.batches : []).map((b) => (b.id === id ? out.batch : b)) }));
        if (out.stopped) {
          toast(`${out.stopped}. ${out.marked} marked so far. Press the button again tomorrow to finish.`);
          break;
        }
        if (out.waiting === 0) {
          if (out.failed > 0) {
            toast(`${out.marked} marked. Blackbaud turned down ${out.failed}; press the button to try those again.`);
            retry = true;
          } else {
            toast(`Done. ${plural(out.marked, 'gift')} marked acknowledged.`);
          }
          break;
        }
      }
    } catch (err) {
      toast((err as Error).message);
    }
    setBusyBoth(false);
    markingRef.current = false;
    await reload();
  }

  async function cancelBatch(b: Batch) {
    setAsking('');
    try {
      await fglApi(`/api/gifts/first-gifts/batches/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      toast('Print file thrown away.');
      await reload();
    } catch (err) {
      toast((err as Error).message);
    }
  }

  /* ------------------------------------------------------------ render */

  const idle = !loadError;
  const find2 = find.toLowerCase();
  const rows = view.letters.filter((l) => {
    if (filter === 'check' && !(l.issues && l.issues.length)) return false;
    if (!find2) return true;
    return `${l.addressee} ${l.place} ${l.constituentLookup} ${l.appeals.join(' ')} ${l.fund}`.toLowerCase().includes(find2);
  });
  const flagged = view.letters.filter((l) => !l.batch && l.issues && l.issues.length).length;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(Math.max(page, 1), pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const total = view.letters.reduce((t, l) => t + l.amount, 0);
  const dates = view.letters.map((l) => l.date).sort();
  const allChecked = rows.every((l) => l.batch || !left.has(l.id));
  const date = letterDate || today();
  const tabs: [string, string, number | null][] = [['letters', 'Letters', view.letters.length], ['held', 'Held back', view.held.length], ['past', 'Print files', batches.length], ['wording', 'Letter wording', null]];

  const sheetsRows = (fs: { screen: (t: string, tabs: unknown[], o?: unknown) => unknown }) =>
    fs.screen(
      'First-gift letters waiting',
      [
        {
          name: 'First-gift letters waiting',
          columns: [
            { key: 'partner', label: 'Partner', type: 'text' },
            { key: 'place', label: 'Place', type: 'text' },
            { key: 'lookup', label: 'Lookup ID', type: 'id' },
            { key: 'date', label: 'Gift date', type: 'date' },
            { key: 'amount', label: 'Amount', type: 'money' },
            { key: 'appeal', label: 'Appeal', type: 'text' },
            { key: 'fund', label: 'Fund', type: 'text' },
            { key: 'in_file', label: 'In a print file', type: 'flag' },
          ],
          rows: rows.map((l) => ({ partner: l.addressee, place: l.place, lookup: l.constituentLookup, date: l.date ? l.date.slice(0, 10) : null, amount: l.amount, appeal: l.appeals.join(', '), fund: l.fund, in_file: l.batch ? 'Yes' : '' })),
        },
      ],
      { filters: find ? `Search: ${find}` : '', classes: ['partner'] }
    );

  return (
    <Frame>
      <div id="rcp-app" ref={appRef} style={held ? { minHeight: held } : undefined} className={loading ? 'is-reading' : undefined} aria-busy={loading || undefined} inert={loading || undefined}>
        <p className="sr-only" role="status">
          {loading ? (slow ? 'Still reading Blackbaud' : 'Reading Blackbaud') : ''}
        </p>
        <section className="ticker fnd-band rcp-band" aria-label="Waiting">
          <div className="ticker__label">
            Waiting for a first-gift letter{idle ? ' ' : ''}
            {idle ? (
              <select
                className="rcp-days"
                aria-label="How far back"
                value={days}
                onChange={(e) => {
                  const d = Number(e.target.value) || DEFAULT_DAYS;
                  try {
                    localStorage.setItem('fgl_days', String(d));
                  } catch {
                    /* no storage */
                  }
                  void reload(d);
                }}
              >
                {DAY_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    gifts from the last {d} days
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="fnd-band__row">
            {loading && slow ? <StatsSkeleton slow /> : null}
            {loadError ? (
              <ListError message={loadError} onRetry={() => void reload()} />
            ) : (
              <>
                <Stat
                  n={view.letters.length}
                  cap={
                    <>
                      Letters to print
                      {dates.length ? (
                        <>
                          <br />
                          {shortDay(dates[0])} to {day(dates[dates.length - 1])}
                        </>
                      ) : null}
                    </>
                  }
                />
                <Stat n={money(total)} cap="First gifts waiting" />
                <Stat n={view.held.length} cap="Held back" />
                <Stat n={view.receiptsKeep} cap="Other waiting gifts, on Receipts" />
              </>
            )}
          </div>
        </section>

        <section className="make-sheet rcp-make" aria-live="polite">
          {loadError ? null : open ? (
            <PrintFile
              b={open}
              busy={busy}
              printedHere={downloadedHere[open.id] || ''}
              onDownloadClick={() => {
                if (open.downloadedAt || downloadedHere[open.id]) return;
                setTimeout(() => setDownloadedHere((m) => ({ ...m, [open.id]: new Date().toISOString() })), 900);
              }}
              asking={asking}
              setAsking={setAsking}
              onMark={() => void markBatch(open.id)}
              onCancel={() => void cancelBatch(open)}
            />
          ) : (
            <>
              <div className="rcp-make__row">
                <div>
                  <h2>Make the print file</h2>
                  <p className="fnd-note">
                    {printable.length
                      ? `${plural(printable.length, 'letter')} for ${plural(printable.length, 'first gift')}, ${money(printable.reduce((t, l) => t + l.amount, 0))} in all.`
                      : 'No first gift is waiting for a letter.'}
                  </p>
                </div>
                <div className="rcp-make__form">
                  <label className="req-field rcp-date">
                    <span>Date on the letters</span>
                    <input type="date" value={date} onChange={(e) => setLetterDate(e.target.value || today())} />
                  </label>
                  <label className="req-field">
                    <span>Signed by</span>
                    <select value={chosenSigner} onChange={(e) => setSigner(e.target.value as SignerKey)}>
                      {SIGNERS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="req-submit" disabled={!(printable.length && !busy)} onClick={() => setAsking('make')}>
                    {busy ? 'Making the file' : 'Make the print file'}
                  </button>
                  {asking === 'make' ? (
                    <Ask
                      question={
                        flagged
                          ? `${plural(flagged, 'letter')} still ${flagged === 1 ? 'has' : 'have'} a flag from the check. Make the print file for ${plural(printable.length, 'letter')} anyway?`
                          : `Make the print file for ${plural(printable.length, 'letter')}?`
                      }
                      yes="Make the file"
                      no={flagged ? 'Look at them first' : 'Cancel'}
                      onYes={() => void makeFile()}
                      onNo={() => {
                        setAsking('');
                        if (flagged) {
                          setTab('letters');
                          setFilter('check');
                          setPage(1);
                        }
                      }}
                    />
                  ) : null}
                </div>
              </div>
              {printable.length ? (
                view.check.partners ? (
                  <div className="rcp-check">
                    <p>
                      <b>{plural(flagged, 'letter')} to look at before printing.</b>{' '}
                      {[view.check.address && plural(view.check.address, 'address', 'addresses'), view.check.greeting && plural(view.check.greeting, 'greeting'), view.check.duplicate && plural(view.check.duplicate, 'possible duplicate')].filter(Boolean).join(', ')}.
                    </p>
                    <button
                      type="button"
                      className="fnd-textbtn"
                      onClick={() => {
                        setTab('letters');
                        setFilter('check');
                        setPage(1);
                      }}
                    >
                      Show them
                    </button>
                  </div>
                ) : (
                  <p className="rcp-check is-clear">Checked before printing: no address, greeting or duplicate problems.</p>
                )
              ) : null}
              <p className="rcp-fine">Nothing is marked acknowledged in Blackbaud until you press "Mark as acknowledged".</p>
            </>
          )}
        </section>

        <div className="fnd-tabs" role="tablist">
          {(idle ? tabs : []).map(([k, label, n]) => (
            <button key={k} type="button" role="tab" data-tab={k} className={tab === k ? 'is-on' : ''} aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
              {n == null ? null : <span>{n.toLocaleString('en-US')}</span>}
            </button>
          ))}
        </div>

        <section className="make-sheet fnd-sheet" hidden={!idle || tab !== 'letters'}>
          <div className="rcp-tools">
            <div className="fnd-filters">
              {(
                [
                  ['all', 'All', view.letters.length],
                  ...(flagged || filter === 'check' ? [['check', 'Needs a look', flagged]] : []),
                ] as [string, string, number][]
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  className={filter === k ? 'on' : ''}
                  onClick={() => {
                    setFilter(k);
                    setPage(1);
                  }}
                >
                  {label}
                  <small>{n.toLocaleString('en-US')}</small>
                </button>
              ))}
            </div>
            <input
              type="search"
              className="rcp-find"
              placeholder="Find a partner"
              autoComplete="off"
              aria-label="Find a partner"
              value={find}
              onChange={(e) => {
                setFind(e.target.value.trim());
                setPage(1);
              }}
            />
            <SheetsButton name="first-gift-letters" build={sheetsRows} />
          </div>
          <LettersTable
            rows={shown}
            all={view.letters.length}
            left={left}
            allChecked={allChecked}
            onTick={(id, on) =>
              setLeft((m) => {
                const n = new Set(m);
                if (on) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onTickAll={(on) =>
              setLeft((m) => {
                const n = new Set(m);
                for (const l of rows) {
                  if (l.batch) continue;
                  if (on) n.delete(l.id);
                  else n.add(l.id);
                }
                return n;
              })
            }
          />
          <div className="rcp-pager" hidden={pages < 2}>
            {pages < 2 ? null : (
              <>
                <button type="button" className="req-ghost" disabled={cur === 1} onClick={() => setPage(cur - 1)}>
                  Previous
                </button>
                <span>
                  Letters {((cur - 1) * PAGE + 1).toLocaleString('en-US')} to {Math.min(cur * PAGE, rows.length).toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')}
                </span>
                <button type="button" className="req-ghost" disabled={cur === pages} onClick={() => setPage(cur + 1)}>
                  Next
                </button>
              </>
            )}
          </div>
        </section>

        <section className="make-sheet fnd-sheet" hidden={!idle || tab !== 'held'}>
          <HeldView
            view={view}
            open={heldOpen}
            onMore={(k) =>
              setHeldOpen((m) => {
                const n = new Set(m);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })
            }
          />
        </section>

        <section className="make-sheet fnd-sheet" hidden={!idle || tab !== 'past'}>
          <PastView batches={batches} />
        </section>

        <section className="make-sheet fnd-sheet" hidden={!idle || tab !== 'wording'}>
          {tab === 'wording' ? <WordingView /> : null}
        </section>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------ the open print file */

function Step({ n, title, done, next, children }: { n: number; title: string; done: boolean; next: boolean; children: ReactNode }) {
  return (
    <li className={`rcp-step${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}>
      <span className="rcp-step__n">{done ? '✓' : n}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function PrintFile(p: {
  b: Batch;
  busy: boolean;
  printedHere: string;
  onDownloadClick: () => void;
  asking: string;
  setAsking: (a: '' | 'make' | 'mark' | 'cancel') => void;
  onMark: () => void;
  onCancel: () => void;
}) {
  const { b } = p;
  const base = `/api/gifts/first-gifts/batches/${encodeURIComponent(b.id)}/pdf`;
  const marking = b.status === 'marking';
  const total = b.gifts || b.count;
  const pct = total ? Math.round((b.marked / total) * 100) : 0;
  const downloadedAt = b.downloadedAt || p.printedHere || null;
  const printed = Boolean(downloadedAt);
  const madeDay = etDay(b.createdAt);
  const waited = Boolean(madeDay) && madeDay < today();
  return (
    <>
      <div className="rcp-make__row">
        <div>
          <p className="make-kicker">Print file ready</p>
          <h2>
            {plural(b.count, 'letter')} dated {day(b.letterDate)}
          </h2>
          <p className="fnd-note">
            {plural(total, 'gift')} from {day(b.firstGift)} to {day(b.lastGift)}, {money(b.amount)} in all. Signed by {b.signerName}. Made by {b.createdBy || 'someone'} on {stamp(b.createdAt)}.
            {b.appeals.length ? ` Appeals: ${b.appeals.join(', ')}.` : ''}
            {b.simulated ? ' Test file: nothing is sent to Blackbaud.' : ''}
          </p>
        </div>
      </div>
      {waited ? (
        <p className="rcp-nudge" role="status">
          <b>Not marked acknowledged yet.</b> This print file was made {day(madeDay)}. If the letters were printed, mark them now. If they were never printed, throw the file away.
        </p>
      ) : null}
      <ol className="rcp-steps">
        <Step n={1} title="Print and sign" done={printed} next={false}>
          <p>One page per letter on US Letter paper, with a blank line for the signature of {b.signerName}.</p>
          <a className="req-submit rcp-btn" href={`${base}?download=1`} onClick={p.onDownloadClick}>
            Download the print file
          </a>{' '}
          <a className="fnd-textbtn" href={base} target="_blank" rel="noopener" onClick={p.onDownloadClick}>
            or open it in a tab
          </a>
          {printed ? <p className="rcp-fine rcp-step__when">Downloaded {stamp(downloadedAt)}.</p> : null}
        </Step>
        <Step n={2} title="Mark as acknowledged in Blackbaud" done={false} next={printed || waited || marking}>
          <p>
            {printed || waited ? <b>Printed? Press this now.</b> : 'Press this once the letters are printed.'} Every gift in the file is marked acknowledged, dated {day(b.letterDate)}, so it leaves this list. No new print file can be made until this one is marked.
          </p>
          {marking || b.marked ? (
            <>
              <div className="rcp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="rcp-fine">
                {b.marked} of {plural(total, 'gift')} marked{b.markFailed ? `, ${b.markFailed} Blackbaud turned down` : ''}.
              </p>
            </>
          ) : null}
          <button type="button" className="req-submit exp-green rcp-btn" disabled={p.busy} onClick={() => p.setAsking('mark')}>
            {b.marked ? 'Finish marking' : `Mark ${plural(total, 'gift')} as acknowledged`}
          </button>{' '}
          {p.asking === 'mark' ? (
            <Ask
              question={
                b.marked
                  ? `Finish marking ${plural(total - b.marked, 'gift')} in Blackbaud?`
                  : printed
                    ? `Were all ${plural(b.count, 'letter')} printed? This marks ${plural(total, 'gift')} as acknowledged in Blackbaud.`
                    : `This print file has not been downloaded yet. Mark ${plural(total, 'gift')} as acknowledged only if the letters were printed some other way.`
              }
              yes={b.marked ? 'Finish marking' : 'Yes, mark them'}
              no="Cancel"
              onYes={p.onMark}
              onNo={() => p.setAsking('')}
            />
          ) : null}
          {b.marked ? null : (
            <button type="button" className="fnd-textbtn is-danger" onClick={() => p.setAsking('cancel')}>
              Throw this print file away
            </button>
          )}
          {p.asking === 'cancel' ? (
            <Ask
              question={`Throw away the print file of ${plural(b.count, 'letter')}? Do this only if the letters were not mailed. Nothing in Blackbaud changes, and the gifts go back on the list.`}
              yes="Throw it away"
              no="Keep it"
              danger
              onYes={p.onCancel}
              onNo={() => p.setAsking('')}
            />
          ) : null}
        </Step>
      </ol>
    </>
  );
}

/* ------------------------------------------------------------ lists */

function LettersTable(p: {
  rows: Item[];
  all: number;
  left: Set<string>;
  allChecked: boolean;
  onTick: (id: string, on: boolean) => void;
  onTickAll: (on: boolean) => void;
}) {
  return (
    <div className="fnd-table-wrap">
      <table className="exp-admin-table rcp-table sc-table">
        <thead>
          <tr>
            <th className="rcp-tick">
              <input type="checkbox" checked={p.allChecked} onChange={(e) => p.onTickAll(e.target.checked)} aria-label="Print every letter" title="Check or uncheck every letter, on every page" />
            </th>
            <th>Partner</th>
            <th>Gift date</th>
            <th className="r">Amount</th>
            <th>Appeal</th>
          </tr>
        </thead>
        <tbody>
          {!p.rows.length ? (
            <tr>
              <td colSpan={5} className="fnd-empty">
                {p.all ? 'No letters match.' : 'No first gift is waiting for a letter.'}
              </td>
            </tr>
          ) : (
            p.rows.map((l) => {
              const off = Boolean(l.batch);
              const on = !off && !p.left.has(l.id);
              const flags = off ? [] : l.issues || [];
              return (
                <tr key={l.id} className={`${on ? '' : 'is-off'}${flags.length ? ' has-flag' : ''}`}>
                  <td className="rcp-tick">
                    <input type="checkbox" checked={on} disabled={off} onChange={(e) => p.onTick(l.id, e.target.checked)} aria-label={`Print a letter for ${l.addressee}`} />
                  </td>
                  <td>
                    <span className="fnd-name">{String(l.addressee || '').trim() || 'No addressee on file'}</span>
                    <span className="fnd-sub">
                      {l.place}
                      {l.fund ? ` · ${l.fund}` : ''}
                    </span>
                    {flags.map((i) => (
                      <span key={i.code + '|' + (i.other?.lookup || '')} className="rcp-flag" data-code={i.code}>
                        <b>{i.group === 'address' ? 'Address.' : i.group === 'greeting' ? 'Greeting.' : 'Duplicate.'}</b> {i.text} <span className="rcp-flag__fix">{i.fix}</span>{' '}
                        {l.constituentLookup ? (
                          <a className="rcp-fixlink" href="/work/partner/" data-partner-lookup={l.constituentLookup}>
                            Open the record
                          </a>
                        ) : null}
                      </span>
                    ))}
                  </td>
                  <td className="mono">{day(l.date)}</td>
                  <td className="r">{money(l.amount)}</td>
                  <td>{off && l.batch ? <span className="exp-pill pending">In the {shortDay(l.batch.letterDate)} print file</span> : <span className="exp-pill rcp-pill-regular">{l.appeals.join(', ') || 'Acquisition'}</span>}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function HeldView({ view, open, onMore }: { view: View; open: Set<string>; onMore: (k: string) => void }) {
  if (!view.held.length) return <p className="fnd-empty">Nothing is held back.</p>;
  const groups: Record<string, Item[]> = {};
  for (const h of view.held) (groups[h.key] = groups[h.key] || []).push(h);
  const order = Object.keys(HELD).filter((k) => groups[k]);
  return (
    <>
      <p className="fnd-note">These first gifts stay unacknowledged in Blackbaud and get no letter. A gift that is fixed in Blackbaud (an address added, a code removed) comes back to the letters the next time this page loads.</p>
      {order.map((k) => {
        const [title, note] = HELD[k];
        const every = groups[k];
        const folds = every.length > 12;
        const list = folds && !open.has(k) ? every.slice(0, 10) : every;
        return (
          <div className="rcp-held" key={k}>
            <h3>
              {title} <span>{every.length}</span>
            </h3>
            {note ? <p className="rcp-fine">{note}</p> : null}
            <table className="exp-admin-table rcp-table sc-table">
              <tbody>
                {list.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <span className="fnd-name">{h.addressee}</span>
                      <span className="fnd-sub">{h.place || h.reason}</span>
                    </td>
                    <td className="mono">{day(h.date)}</td>
                    <td className="r">{money(h.amount)}</td>
                    <td>{h.appeals.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {folds ? (
              <button type="button" className="fnd-textbtn rcp-more" onClick={() => onMore(k)}>
                {open.has(k) ? 'Show fewer' : `Show all ${every.length}`}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function StatusPill({ b }: { b: Batch }) {
  if (b.status === 'done') return <span className="exp-pill approved">Marked acknowledged</span>;
  if (b.status === 'marking')
    return (
      <span className="exp-pill fnd-pill-work">
        {num(b.marked)} of {plural(b.gifts || b.count, 'gift')} marked
      </span>
    );
  return <span className="exp-pill fnd-pill-two">Not marked yet</span>;
}

function PastView({ batches }: { batches: Batch[] }) {
  if (!batches.length) return <p className="fnd-empty">No print files yet.</p>;
  return (
    <div className="fnd-table-wrap">
      <table className="exp-admin-table rcp-table sc-table">
        <thead>
          <tr>
            <th>Letters dated</th>
            <th className="r">Letters</th>
            <th>Gifts from</th>
            <th>Signed by</th>
            <th>Made by</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const base = `/api/gifts/first-gifts/batches/${encodeURIComponent(b.id)}/pdf`;
            return (
              <tr key={b.id}>
                <td>
                  <span className="fnd-name">{day(b.letterDate)}</span>
                  <span className="fnd-sub">{b.appeals.join(', ')}</span>
                </td>
                <td className="r">
                  {num(b.count)}
                  {b.gifts && b.gifts !== b.count ? <span className="fnd-sub">{plural(b.gifts, 'gift')}</span> : null}
                </td>
                <td className="mono">{[shortDay(b.firstGift), shortDay(b.lastGift)].filter(Boolean).join(' to ')}</td>
                <td>{b.signerName}</td>
                <td>
                  {b.createdBy}
                  <span className="fnd-sub">{stamp(b.createdAt)}</span>
                </td>
                <td>
                  <StatusPill b={b} />
                  {b.simulated ? <span className="fnd-sub">Test file</span> : null}
                </td>
                <td className="rcp-past__act">
                  <a className="fnd-textbtn" href={`${base}?download=1`}>
                    Print file
                  </a>{' '}
                  <a className="fnd-textbtn is-quiet" href={base} target="_blank" rel="noopener">
                    Open
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ wording */

function WordingView() {
  const qc = useQueryClient();
  const { data: w } = useSuspenseQuery(wordingQuery);
  const [text, setText] = useState(w.wording.text);
  const [closing, setClosing] = useState(w.wording.closing);
  const [greeting, setGreeting] = useState<Wording['greeting']>(w.wording.greeting);
  const [signer, setSigner] = useState<SignerKey>(w.wording.signer);
  const [preview, setPreview] = useState(w.preview);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mine = useCallback((): Wording => ({ text, closing, greeting, signer }), [text, closing, greeting, signer]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fglApi<{ preview: typeof preview }>('/api/gifts/first-gifts/wording', { body: { preview: mine() } })
        .then((out) => setPreview(out.preview))
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [mine]);

  async function save(reset = false) {
    setSaving(true);
    try {
      const out = await fglApi<{ wording: Wording }>('/api/gifts/first-gifts/wording', { body: reset ? { reset: true } : { wording: mine() } });
      setText(out.wording.text);
      setClosing(out.wording.closing);
      setGreeting(out.wording.greeting);
      setSigner(out.wording.signer);
      await qc.invalidateQueries({ queryKey: fglKeys.wording });
      await qc.invalidateQueries({ queryKey: ['fgl', 'view'] });
      toast(reset ? 'Back to the starting wording.' : 'Wording saved. New print files use it.');
    } catch (err) {
      toast((err as Error).message);
    }
    setSaving(false);
  }

  return (
    <div className="rcp-wording">
      <div className="rcp-wording__form">
        <label className="req-field">
          <span>Letter text</span>
          <textarea rows={14} value={text} maxLength={2500} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="rcp-fine">Separate paragraphs with a blank line. {'{amount}'}, {'{fund}'} and {'{date}'} are filled in from the gift.</p>
        <div className="rcp-again__row">
          <label className="req-field">
            <span>Closing</span>
            <input value={closing} maxLength={60} onChange={(e) => setClosing(e.target.value)} />
          </label>
          <label className="req-field">
            <span>Greeting</span>
            <select value={greeting} onChange={(e) => setGreeting(e.target.value as Wording['greeting'])}>
              <option value="full">Dear Linda Hertzman,</option>
              <option value="first">Dear Linda,</option>
            </select>
          </label>
          <label className="req-field">
            <span>Signer on a new print file</span>
            <select value={signer} onChange={(e) => setSigner(e.target.value as SignerKey)}>
              {w.signers.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rcp-ask__row">
          <button type="button" className="req-submit" disabled={saving} onClick={() => void save(false)}>
            {saving ? 'Saving' : 'Save the wording'}
          </button>
          <button type="button" className="fnd-textbtn is-quiet" disabled={saving} onClick={() => void save(true)}>
            Go back to the starting wording
          </button>
        </div>
        <p className="rcp-fine">{w.saved ? `Saved ${stamp(w.saved.updated_at)}.` : 'Showing the starting wording. Nothing has been saved yet.'}</p>
      </div>
      <div className="rcp-wording__preview" aria-label="Preview of one letter">
        <p className="make-kicker">Preview</p>
        <div className="rcp-letter">
          <p>{preview.dateLine}</p>
          <p>
            {preview.addressLines.map((l, i) => (
              <span key={i}>
                {l}
                <br />
              </span>
            ))}
          </p>
          <p>
            <b>{preview.greeting}</b>
          </p>
          {preview.paragraphs.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
          <p>{preview.closing}</p>
          <p>
            ______________________
            <br />
            {preview.signerName}
            <br />
            <span className="fnd-sub">{preview.signerTitle}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
