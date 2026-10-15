// Receipts (/receipts/): the gifts Blackbaud has not receipted yet, the print file for the receipt paper, and marking the gifts thanked in
// Blackbaud. Port of src/pages/receipts/index.astro and public/js/receipts.js: the same markup, the same stylesheets, the same calls.
// Every read is drawn with useSuspenseQueries inside Suspense, so the server's page and the browser's first render agree. Nothing here touches
// window, localStorage or document while rendering; those are read in effects and event handlers.
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
import './styles.css';
import { Boundary } from '../partners/record/Boundary';
import { hubGet } from '../../lib/hub';
import { rcpApi, rcpKeys, meQuery, waitingPath, waitingQuery, batchesQuery, DEFAULT_DAYS, type Batch, type Me, type RcpError, type Waiting } from './api';
import { useAsk } from './Ask';
import { plural, today } from './format';
import { KINDS, PAGE, countsOf, filteredLetters, groupLetters, issuesOf, openBatchOf, printableOf, sharedAddresses } from './logic';
import { BatchSteps, HeldView, LettersTable, ListError, MakePanel, MakeSkeleton, PastView, Stats, StatsSkeleton, WordingView } from './Panels';
import { SheetsButton } from './SheetsButton';
import { PageToast, toast } from './toast';

const STAFF = ['Morgan', 'Megan', 'Emma Stewart', 'Jennifer Morris', 'Will Hamilton'];
const TABS: [string, string][] = [
  ['letters', 'Receipts'],
  ['held', 'Held back'],
  ['past', 'Past printings'],
  ['wording', 'Receipt wording'],
];
const DAY_CHOICES = [30, 60, 90, 180];

export function ReceiptsPage() {
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
                    <div className="ticker__label" id="rcp-band-label">Waiting for a receipt</div>
                    <div className="fnd-band__row" id="rcp-stats">
                      <ListError
                        message={e.message}
                        onRetry={() => {
                          reset();
                          qc.removeQueries({ queryKey: ['rcp'] });
                          retry();
                        }}
                      />
                    </div>
                  </section>
                  <section className="make-sheet rcp-make" id="rcp-make" aria-live="polite" />
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
              <Gate />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
      <PageToast id="rcp-toast" />
    </>
  );
}

/** The page frame: the heading and, when given, the name box and Lock button. */
function Frame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fnd-page rcp-page">
      <div className="container">
        <header className="board-intro">
          <div>
            <h1>Receipts</h1>
          </div>
          {actions}
        </header>
        {children}
      </div>
    </div>
  );
}

/** The skeleton the page shows while Blackbaud is read: four totals, then the print file card. */
function Loading({ slow }: { slow?: boolean }) {
  return (
    <div id="rcp-app">
      <section className="ticker fnd-band rcp-band" aria-label="Waiting">
        <div className="ticker__label" id="rcp-band-label">
          Waiting for a receipt
        </div>
        <div className="fnd-band__row" id="rcp-stats">
          <StatsSkeleton slow={slow} />
        </div>
      </section>
      <section className="make-sheet rcp-make" id="rcp-make" aria-live="polite">
        <MakeSkeleton />
      </section>
      <div className="fnd-tabs" id="rcp-tabs" role="tablist" />
    </div>
  );
}

/** Who may open the page: the desk and Partner Care, signed in or with the code. Reads /api/receipts/me. */
function Gate() {
  const { data: me } = useSuspenseQuery(meQuery);
  const [locked, setLocked] = useState(!me.unlocked);
  const [who, setWhoState] = useState('');
  const whoRef = useRef('');
  const setWho = useCallback((name: string) => {
    whoRef.current = name;
    setWhoState(name);
  }, []);
  const remember = useCallback((name: string) => {
    try {
      localStorage.setItem('rcp_actor', name);
    } catch {
      /* private mode: the name lives for this page only */
    }
  }, []);
  // Signed in with Google: the name comes from the account, so "Your name" and Lock go away.
  useEffect(() => {
    if (me.name) {
      setWho(me.name);
      remember(me.name);
      return;
    }
    try {
      setWho(localStorage.getItem('rcp_actor') || '');
    } catch {
      /* no storage */
    }
  }, [me.name, setWho, remember]);
  const [bad, setBad] = useState(false);
  const needWho = useCallback((): boolean => {
    if (whoRef.current.trim()) return false;
    setBad(true);
    (document.getElementById('rcp-who') as HTMLInputElement | null)?.focus();
    toast('Put your name in "Your name" first.');
    return true;
  }, []);
  const saveWho = useCallback(
    (name: string) => {
      setWho(name);
      remember(name);
      setBad(false);
    },
    [setWho, remember]
  );

  const signedIn = Boolean(me.name);
  const shown = !me.restricted && !locked;
  const actions = (
    <div className="board-intro__actions" id="rcp-actions" hidden={!shown}>
      <label className={`fnd-who${bad ? ' is-bad' : ''}`} hidden={signedIn}>
        <span>Your name</span>
        <input
          id="rcp-who"
          list="rcp-staff"
          autoComplete="off"
          maxLength={60}
          value={who}
          onChange={(e) => {
            whoRef.current = e.target.value;
            setWhoState(e.target.value);
          }}
          onBlur={(e) => {
            remember(e.target.value.trim());
            if (e.target.value.trim()) setBad(false);
          }}
        />
        <datalist id="rcp-staff">
          {STAFF.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <button
        type="button"
        className="req-ghost"
        id="rcp-lock"
        hidden={signedIn}
        title="Lock this page until the code is entered again"
        onClick={async () => {
          await fetch('/api/receipts/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).catch(() => {});
          setLocked(true);
        }}
      >
        Lock
      </button>
    </div>
  );

  return (
    <Frame actions={actions}>
      {me.restricted ? (
        <p className="h-empty">Receipts are open to the admin desk and Partner Care.</p>
      ) : locked ? (
        <LoginForm onUnlocked={() => setLocked(false)} />
      ) : (
        <Suspense fallback={<Loading />}>
          <Desk who={who} whoRef={whoRef} me={me} needWho={needWho} saveWho={saveWho} onLocked={() => setLocked(true)} />
        </Suspense>
      )}
    </Frame>
  );
}

function LoginForm({ onUnlocked }: { onUnlocked: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const el = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => el.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <form
      className="board-login"
      id="rcp-login"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg('');
        try {
          await rcpApi('/api/receipts/login', { body: { code } });
          setCode('');
          await qc.invalidateQueries({ queryKey: ['rcp'] });
          onUnlocked();
        } catch (err) {
          setMsg((err as RcpError).message);
        }
      }}
    >
      <p>Enter the code to open receipts.</p>
      <div className="board-login__row">
        <input ref={el} type="password" id="rcp-code" placeholder="Code" autoComplete="off" autoCapitalize="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="req-admin-btn">
          Unlock
        </button>
      </div>
      <p className="req-msg" id="rcp-login-msg" aria-live="polite">
        {msg}
      </p>
    </form>
  );
}

interface DeskProps {
  who: string;
  whoRef: { current: string };
  me: Me;
  needWho: () => boolean;
  saveWho: (name: string) => void;
  onLocked: () => void;
}

/** The working page: totals, the print file card, the tabs and their lists. */
function Desk({ who, whoRef, needWho, saveWho, onLocked }: DeskProps) {
  const qc = useQueryClient();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [{ data: view }, { data: batchData }] = useSuspenseQueries({ queries: [waitingQuery(days), batchesQuery] });
  const batches = batchData.batches;

  const [tab, setTab] = useState('letters');
  const [filter, setFilter] = useState('all');
  const [find, setFind] = useState('');
  const [page, setPage] = useState(1);
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [heldOpen, setHeldOpen] = useState<Set<string>>(() => new Set());
  const [letterDate, setLetterDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [loadError, setLoadError] = useState('');
  // The page keeps the height it had while Blackbaud is read again, so nothing below it jumps when the lists come back.
  const appRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(0);
  const [downloadedHere, setDownloadedHere] = useState<Record<string, string>>({});

  // The latest values, for handlers that run after an await.
  const S = useRef({ view, batches, days, letterDate, busy, left, added, downloadedHere });
  S.current = { view, batches, days, letterDate, busy, left, added, downloadedHere };
  const markingRef = useRef(false);
  const resumedRef = useRef(false);
  const busyRef = useRef(false);

  // The last-used window of days is a browser setting; it is read after the page is drawn so the server's text and the browser's agree.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('rcp_days'));
      if (saved && saved !== DEFAULT_DAYS && DAY_CHOICES.includes(saved)) void reload(saved);
    } catch {
      /* no storage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marking runs from this page. Leaving mid-run used to stop it partway (a file stopped at 80 of 188), so the browser asks first.
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

  // A fresh read keeps the page where it is, dimmed and out of reach, so nothing jumps; its numbers are replaced the moment the read answers.
  const { askFirst, box } = useAsk(() => whoRef.current, saveWho);
  const setBusyBoth = (b: boolean) => {
    busyRef.current = b;
    setBusy(b);
  };

  const call = useCallback(
    <T,>(path: string, opts: { method?: string; body?: unknown } = {}) => rcpApi<T>(path, { ...opts, who: whoRef.current, onLocked }),
    [whoRef, onLocked]
  );

  /** Read the waiting list and the print files again from Blackbaud, the way the classic page does after every change. */
  async function reload(nextDays = S.current.days): Promise<void> {
    setHeld(appRef.current ? appRef.current.offsetHeight : 0);
    setLoading(true);
    setLoadError('');
    const [v, past] = await Promise.allSettled([
      qc.fetchQuery({ queryKey: rcpKeys.waiting(nextDays), queryFn: () => hubGet(waitingPath(nextDays, true)) as Promise<Waiting>, staleTime: 0 }),
      qc.fetchQuery({ queryKey: rcpKeys.batches, queryFn: () => (hubGet('/api/receipts/batches') as Promise<{ batches: Batch[] }>).catch(() => ({ batches: [] as Batch[] })), staleTime: 0 }),
    ]);
    if (past.status === 'rejected') qc.setQueryData(rcpKeys.batches, { batches: [] });
    if (v.status === 'rejected') {
      const err = v.reason as RcpError;
      if (err && err.status === 401) onLocked();
      setLoadError((err && err.message) || 'Something went wrong. Try again.');
      setLoading(false);
      setHeld(0);
      return;
    }
    const nv = v.value;
    setDays(nextDays);
    setLeft((cur) => new Set([...cur].filter((id) => nv.letters.some((l) => l.id === id))));
    setAdded((cur) => new Set([...cur].filter((id) => nv.held.some((h) => h.id === id && h.canAdd))));
    setLoading(false);
    setHeld(0);
  }

  // A run that stopped partway (a closed tab, a lost connection) was already confirmed by the person who pressed Mark, so the page finishes
  // it. Once per page load.
  const open = openBatchOf(batches);
  useEffect(() => {
    if (loading || loadError) return;
    if (open && open.status === 'marking' && !busyRef.current && !resumedRef.current) {
      const todo = (open.gifts || open.count) - (open.marked || 0) - (open.markFailed || 0);
      if (todo > 0) {
        resumedRef.current = true;
        toast(`Finishing the marking that stopped at ${open.marked} of ${plural(open.gifts || open.count, 'gift')}.`);
        void markBatch(open.id, { resume: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, loadError]);

  const list = printableOf(view, left, added);
  const shared = sharedAddresses(view, added);

  /* ---------------------------------------------------------- actions */

  async function makeFile() {
    if (needWho() || busyRef.current) return;
    const cur = S.current;
    const going = printableOf(cur.view, cur.left, cur.added);
    if (!going.length) return;
    const flaggedNow = groupLetters(going).filter((g) => issuesOf(g).length).length;
    if (flaggedNow && !(await askFirst({ anchor: 'make', question: `${plural(flaggedNow, 'receipt')} still ${flaggedNow === 1 ? 'has' : 'have'} a flag from the check. Make the print file anyway?`, yes: 'Make the file', no: 'Look at them first' }))) return;
    setBusyBoth(true);
    const addedIds = going.filter((l) => S.current.added.has(l.id)).map((l) => l.id);
    const ids = going.filter((l) => !S.current.added.has(l.id)).map((l) => l.id);
    try {
      const out = await call<{ batch: Batch; skipped?: unknown[] }>('/api/receipts/batches', { body: { ids, added: addedIds, letterDate: S.current.letterDate || today(), days: S.current.days } });
      setAdded(new Set());
      setLeft(new Set());
      toast(`${plural(out.batch.count, 'receipt')} ready to print.${out.skipped && out.skipped.length ? ` ${out.skipped.length} changed in Blackbaud and were left out.` : ''}`);
      setBusyBoth(false);
      await reload();
    } catch (err) {
      setBusyBoth(false);
      toast((err as Error).message);
    }
  }

  /** One marking call, tried again after a pause when Blackbaud or the connection drops it. */
  async function markOnce(id: string, retry: boolean) {
    const waits = [2000, 5000, 10000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await call<{ batch: Batch; marked: number; failed: number; waiting: number; stopped: string }>(`/api/receipts/batches/${encodeURIComponent(id)}/mark`, { body: { retry } });
      } catch (err) {
        const e = err as RcpError;
        const passing = !e.status || e.status >= 500;
        if (!passing || attempt >= waits.length) throw err;
        await new Promise((r) => setTimeout(r, waits[attempt]));
      }
    }
  }

  async function markBatch(id: string, opts: { resume?: boolean } = {}) {
    if (busyRef.current) return;
    const file = S.current.batches.find((x) => x.id === id);
    if (!opts.resume) {
      let ask = '';
      if (file && !file.marked) {
        const gifts = plural(file.gifts || file.count, 'gift');
        ask = file.downloadedAt || S.current.downloadedHere[file.id] ? `Were all ${plural(file.count, 'receipt')} printed? This marks ${gifts} as thanked in Blackbaud.` : `This print file has not been downloaded yet. Mark ${gifts} as thanked only if the receipts were printed some other way.`;
      }
      const yes = file && file.marked ? 'Finish marking' : 'Yes, mark them thanked';
      if (!(await askFirst({ anchor: 'mark', question: ask, yes, no: 'Cancel' }))) return;
    }
    setBusyBoth(true);
    markingRef.current = true;
    let retry = false;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const out = await markOnce(id, retry);
        retry = false;
        qc.setQueryData(rcpKeys.batches, (old: { batches: Batch[] } | undefined) => ({ batches: (old ? old.batches : []).map((b) => (b.id === id ? out.batch : b)) }));
        if (out.stopped) {
          toast(`${out.stopped}. ${out.marked} marked so far. Press the button again tomorrow to finish.`);
          break;
        }
        if (out.waiting === 0) {
          if (out.failed > 0) {
            toast(`${out.marked} marked. Blackbaud turned down ${out.failed}; press the button to try those again.`);
            retry = true;
          } else {
            toast(`Done. ${plural(out.marked, 'gift')} marked thanked.`);
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
    const ask = `Throw away the print file of ${plural(b.count, 'receipt')}? Do this only if the receipts were not mailed. Nothing in Blackbaud changes, and the gifts go back on the list.`;
    if (!(await askFirst({ anchor: 'cancel', question: ask, yes: 'Throw it away', no: 'Keep it', danger: true }))) return;
    const button = document.getElementById('rcp-cancel') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    try {
      await call(`/api/receipts/batches/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      toast('Print file thrown away.');
      await reload();
    } catch (err) {
      if (button) button.disabled = false;
      toast((err as Error).message);
    }
  }

  async function reprint(date: string, letter: string) {
    if (needWho() || busyRef.current) return;
    if (!date) {
      toast('Pick the day the gifts were marked thanked.');
      return;
    }
    setBusyBoth(true);
    setReprinting(true);
    try {
      const out = await call<{ batch: Batch }>('/api/receipts/batches', { body: { reprintOf: date, letterDate: letter || today() } });
      toast(`${plural(out.batch.count, 'receipt')} ready. It is under Past printings.`);
      setTab('past');
      setBusyBoth(false);
      setReprinting(false);
      await reload();
    } catch (err) {
      setBusyBoth(false);
      setReprinting(false);
      toast((err as Error).message);
    }
  }

  const goTab = (k: string) => setTab(k);
  const scrollTabs = () => document.getElementById('rcp-tabs')?.scrollIntoView({ block: 'start' });

  /* ------------------------------------------------------------ render */

  const all = groupLetters(view.letters);
  const c = countsOf(view.letters);
  const flagged = all.filter((g) => !g.batch && issuesOf(g).length).length;
  const pills: [string, string, number][] = [['all', 'All', all.length], ['regular', 'Regular', c.regular], ['major', '$200 and up', c.major], ['recurring', 'Monthly', c.recurring]];
  if (flagged || filter === 'check') pills.push(['check', 'Needs a look', flagged]);
  const rows = filteredLetters(view, filter, find);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(Math.max(page, 1), pages);
  const allChecked = rows.every((g) => g.batch || !g.gifts.some((x) => left.has(x.id)));

  const tabs: [string, string, number | null][] = [['letters', 'Receipts', all.length], ['held', 'Held back', view.held.length], ['past', 'Past printings', batches.length], ['wording', 'Receipt wording', null]];

  // While Blackbaud is read, or when the read failed, the page keeps every list mounted and hidden (the Open in Google Sheets button must not be
  // unmounted), and shows the totals' skeleton or the error where the totals go.
  const idle = !loadError;

  const sheetsRows = (fs: { screen: (t: string, tabs: unknown[], o?: unknown) => unknown }) => {
    const cv = S.current.view;
    const groups = filteredLetters(cv, filter, find);
    const data = groups.flatMap((g) =>
      g.gifts.map((x) => ({ partner: g.first.addressee, place: g.first.place || '', lookup: g.first.constituentLookup || '', date: x.date ? String(x.date).slice(0, 10) : null, amount: x.amount, fund: x.fund || '', kind: KINDS[g.segment] || '', in_file: g.batch ? 'Yes' : '' }))
    );
    const pill = ({ all: '', regular: 'Regular receipts', major: '$200 and up', recurring: 'Monthly gifts' } as Record<string, string>)[filter] || '';
    const words = [pill && `Showing: ${pill}`, find && `Search: ${find}`].filter(Boolean).join('. ');
    return fs.screen(
      'Receipts waiting',
      [
        {
          name: 'Receipts waiting',
          columns: [
            { key: 'partner', label: 'Partner', type: 'text' },
            { key: 'place', label: 'Place', type: 'text' },
            { key: 'lookup', label: 'Lookup ID', type: 'id' },
            { key: 'date', label: 'Gift date', type: 'date' },
            { key: 'amount', label: 'Amount', type: 'money' },
            { key: 'fund', label: 'Fund', type: 'text' },
            { key: 'kind', label: 'Receipt', type: 'text' },
            { key: 'in_file', label: 'In a print file', type: 'flag' },
          ],
          rows: data,
        },
      ],
      { filters: words, classes: ['partner'] }
    );
  };

  return (
    <div id="rcp-app" ref={appRef} style={held ? { minHeight: held } : undefined} className={loading ? 'is-reading' : undefined} aria-busy={loading || undefined} inert={loading || undefined}>
      <p className="sr-only" role="status">
        {loading ? (slow ? 'Still reading Blackbaud' : 'Reading Blackbaud') : ''}
      </p>
      <section className="ticker fnd-band rcp-band" aria-label="Waiting">
        <div className="ticker__label" id="rcp-band-label">
          Waiting for a receipt{idle ? ' ' : ''}
          {idle ? <select
            id="rcp-days"
            className="rcp-days"
            aria-label="How far back"
            value={days}
            onChange={(e) => {
              const d = Number(e.target.value) || DEFAULT_DAYS;
              try {
                localStorage.setItem('rcp_days', String(d));
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
          </select> : null}
        </div>
        <div className="fnd-band__row" id="rcp-stats">
          {loadError ? <ListError message={loadError} onRetry={() => void reload()} /> : <Stats list={list} open={Boolean(open)} />}
        </div>
      </section>

      <section className="make-sheet rcp-make" id="rcp-make" aria-live="polite">
        {loadError ? null : open ? (
          <BatchSteps
            b={open}
            busy={busy}
            downloadedHere={downloadedHere[open.id] || ''}
            onDownloadClick={() => {
              if (open.downloadedAt || downloadedHere[open.id]) return;
              // The server notes the first download. Show it here at once, so the marking step lights up.
              setTimeout(() => setDownloadedHere((m) => ({ ...m, [open.id]: new Date().toISOString() })), 900);
            }}
            onMark={() => void markBatch(open.id)}
            onCancel={() => void cancelBatch(open)}
            askMark={box('mark')}
            askCancel={box('cancel')}
          />
        ) : (
          <MakePanel
            view={view}
            list={list}
            shared={shared.size}
            letterDate={letterDate}
            setLetterDate={setLetterDate}
            busy={busy}
            onMake={() => void makeFile()}
            onShowFlagged={() => {
              setTab('letters');
              setFilter('check');
              setPage(1);
              scrollTabs();
            }}
            ask={box('make')}
          />
        )}
      </section>

      <div className="fnd-tabs" id="rcp-tabs" role="tablist">
        {(idle ? tabs : []).map(([k, label, n]) => (
          <button key={k} type="button" role="tab" data-tab={k} className={tab === k ? 'is-on' : ''} aria-selected={tab === k} onClick={() => goTab(k)}>
            {label}
            {n == null ? null : <span>{n.toLocaleString('en-US')}</span>}
          </button>
        ))}
      </div>

      <section className="make-sheet fnd-sheet" id="rcp-view-letters" hidden={!idle || tab !== 'letters'}>
        <div className="rcp-tools">
          <div className="fnd-filters" id="rcp-filters">
            {pills.map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                data-f={k}
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
            id="rcp-find"
            className="rcp-find"
            placeholder="Find a partner"
            autoComplete="off"
            value={find}
            onChange={(e) => {
              setFind(e.target.value.trim());
              setPage(1);
            }}
          />
          <SheetsButton name="receipts" build={sheetsRows} />
        </div>
        <LettersTable
          rows={rows}
          all={all.length}
          page={cur}
          left={left}
          shared={shared}
          allChecked={allChecked}
          onTick={(ids, on) =>
            setLeft((m) => {
              const n = new Set(m);
              for (const id of ids) {
                if (on) n.delete(id);
                else n.add(id);
              }
              return n;
            })
          }
          onTickAll={(on) =>
            setLeft((m) => {
              const n = new Set(m);
              for (const g of rows) {
                if (g.batch) continue;
                for (const x of g.gifts) {
                  if (on) n.delete(x.id);
                  else n.add(x.id);
                }
              }
              return n;
            })
          }
        />
        <div className="rcp-pager" id="rcp-pager" hidden={pages < 2}>
          {pages < 2 ? null : (
            <>
              <button
                type="button"
                className="req-ghost"
                data-page={cur - 1}
                disabled={cur === 1}
                onClick={() => {
                  setPage(cur - 1);
                  scrollTabs();
                }}
              >
                Previous
              </button>
              <span>
                Receipts {((cur - 1) * PAGE + 1).toLocaleString('en-US')} to {Math.min(cur * PAGE, rows.length).toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')}
              </span>
              <button
                type="button"
                className="req-ghost"
                data-page={cur + 1}
                disabled={cur === pages}
                onClick={() => {
                  setPage(cur + 1);
                  scrollTabs();
                }}
              >
                Next
              </button>
            </>
          )}
        </div>
      </section>

      <section className="make-sheet fnd-sheet" id="rcp-view-held" hidden={!idle || tab !== 'held'}>
        <HeldView
          view={view}
          added={added}
          heldOpen={heldOpen}
          onMore={(k) =>
            setHeldOpen((m) => {
              const n = new Set(m);
              if (n.has(k)) n.delete(k);
              else n.add(k);
              return n;
            })
          }
          onAdd={(id) =>
            setAdded((m) => {
              const n = new Set(m);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
        />
      </section>

      <section className="make-sheet fnd-sheet" id="rcp-view-past" hidden={!idle || tab !== 'past'}>
        <PastView batches={batches} reprinting={reprinting} onReprint={(date, letter) => void reprint(date, letter)} />
      </section>

      <section className="make-sheet fnd-sheet" id="rcp-view-wording" hidden={!idle || tab !== 'wording'}>
        {tab === 'wording' ? <WordingView needWho={needWho} who={who} /> : null}
      </section>
    </div>
  );
}

