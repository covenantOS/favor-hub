// Foundation prospects (/foundations/): check a foundation before a call, the prospects, the clean-up list and what went to Blackbaud
// (port of public/js/foundations.js and src/pages/foundations/index.astro).
import { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import '@hub/styles/requests.css';
import '@hub/styles/expenses.css';
import '@hub/styles/foundations.css';
import '@hub/styles/qa-work.css';
import '@hub/styles/crit-forms.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/break-ui.css';
import '@hub/styles/ptable.css';
import '@hub/styles/pt-lists.css';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, Seg, useHiddenColumns, useListKeys, usePageSize, clampPage, pageOf, type Column, type Sort } from '../../../ui/table';
import { loadScript } from '@/lib/legacy';
import { Boundary } from '../record/Boundary';
import { PartnerLinks } from '../record/PartnerLinks';
import { checkQuery, fApi, fKeys, HubReadError, listQuery, meQuery, prefetchFoundationsReads, setActor, detailQuery, bbQuery } from './api';
import { FoundationDrawer } from './Drawer';
import { Activity, Cleanup } from './Panels';
import { FndToast, toast } from './toast';
import { badge, day, firstNames, money, plural, statusOf } from './util';

export function prefetchFoundations(qc: QueryClient): void {
  prefetchFoundationsReads(qc);
}

const FILTERS: [string, string][] = [
  ['all', 'All'],
  ['work', 'Working'],
  ['once', 'Contacted once'],
  ['two', 'Two fundraisers'],
  ['in', 'In Blackbaud'],
  ['dead', 'Dead ends'],
];
const SORT: Record<string, (f: any) => string | number> = {
  name: (f) => String(f.name || '').replace(/^the /i, '').toLowerCase(),
  contacts: (f) => Number(f.contacts) || 0,
  last: (f) => String(f.last_contact || ''),
  rdds: (f) => firstNames(f.rdds).toLowerCase(),
  status: (f) => statusOf(f)[1],
};
const STAFF = ['Rachel Cox', 'Caden', 'Grace Morris', 'Joe Krol', 'Crystal Hall', 'Gregory Phipps', 'Jordan Abbott', 'Stephanie Brady', 'Brian Carr', 'Rick Brown', 'Celeste Paul', 'Will Hamilton'];
const SHEET_ICON = (
  <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: 16, height: 16 }}>
    <path d="M6 2.5h8.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#0f9d58" stroke="none" />
    <path d="M14.5 2.5V7H19" fill="#87ceac" stroke="none" />
    <rect x="8" y="10.5" width="8" height="7" rx=".5" fill="#fff" stroke="none" />
    <path d="M8 13h8M8 15.3h8M11 10.5v7" stroke="#0f9d58" strokeWidth=".9" fill="none" />
  </svg>
);

const Skeleton = () => (
  <div className="fnd-page">
    <div className="container">
      <header className="board-intro">
        <div>
          <h1>
            Foundation <em>prospects</em>
          </h1>
        </div>
      </header>
      <div className="h-skel" style={{ height: 480, borderRadius: 18 }} />
    </div>
  </div>
);

export function FoundationsPage() {
  const qc = useQueryClient();
  return (
    <>
      <Boundary
        fallback={(e, retry) => (
          <div className="fnd-page">
            <div className="container">
              <p className="req-msg">
                {e.message}{' '}
                <button
                  type="button"
                  className="fnd-textbtn"
                  onClick={() => {
                    qc.resetQueries({ predicate: (q) => q.state.status === 'error' });
                    retry();
                  }}
                >
                  Try again
                </button>
              </p>
            </div>
          </div>
        )}
      >
        <Suspense fallback={<Skeleton />}>
          <Gate />
        </Suspense>
      </Boundary>
      <FndToast />
      <PartnerLinks />
    </>
  );
}

/** Asks for the code until it is entered (people signed in with Google are let straight in). */
function Gate() {
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const on = () => setLocked(true);
    window.addEventListener('fnd:locked', on);
    return () => window.removeEventListener('fnd:locked', on);
  }, []);
  const open = !!me.unlocked && !locked;
  if (!open) {
    return (
      <Login
        onOpen={async () => {
          setLocked(false);
          await qc.invalidateQueries({ queryKey: fKeys.me });
          await qc.invalidateQueries({ queryKey: fKeys.list });
        }}
      />
    );
  }
  return (
    <Boundary
      fallback={(e) => (((e as HubReadError).status === 401 ? <Login onOpen={async () => { await qc.resetQueries({ queryKey: ['fnd'] }); }} /> : <p className="req-msg">{e.message}</p>))}
    >
      <Suspense fallback={<Skeleton />}>
        <App signedName={me.name || ''} onLock={() => setLocked(true)} />
      </Suspense>
    </Boundary>
  );
}

function Login({ onOpen }: { onOpen: () => Promise<void> }) {
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="fnd-page">
      <div className="container">
        <header className="board-intro">
          <div>
            <h1>
              Foundation <em>prospects</em>
            </h1>
          </div>
        </header>
        <form
          className="board-login"
          id="fnd-login"
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg('');
            try {
              await fApi('/api/foundations/login', { method: 'POST', body: { code } });
              setCode('');
              await onOpen();
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        >
          <p>Enter the code to open the foundation list.</p>
          <div className="board-login__row">
            <input ref={ref} type="password" id="fnd-code" placeholder="Code" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="submit" className="req-admin-btn">
              Unlock
            </button>
          </div>
          <p className="req-msg" id="fnd-login-msg" aria-live="polite">
            {msg}
          </p>
        </form>
      </div>
    </div>
  );
}

function App({ signedName, onLock }: { signedName: string; onLock: () => void }) {
  const qc = useQueryClient();
  const { data: meta } = useSuspenseQuery(listQuery);
  const list: any[] = meta.foundations;
  const [tab, setTab] = useState<'list' | 'cleanup' | 'activity'>('list');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [who, setWho] = useState('');
  const [whoBad, setWhoBad] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pview, setPview] = useState<ProspectView>(FIRST_VIEW);
  const [addName, setAddName] = useState('');
  const whoRef = useRef<HTMLInputElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const shownQ = useDeferredValue(dq);

  // The name in "Entered by": this browser's last one, or the signed-in account's.
  useEffect(() => {
    const w = signedName || localStorage.getItem('fnd_actor') || '';
    setWho(w);
    setActor(w);
    if (signedName) localStorage.setItem('fnd_actor', signedName);
  }, [signedName]);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  const needWho = useCallback(() => {
    if (whoRef.current && whoRef.current.value.trim()) return false;
    setWhoBad(true);
    whoRef.current?.focus();
    toast('Put your name in "Entered by" first.');
    return true;
  }, []);
  const changeWho = (v: string) => {
    setWho(v);
    setActor(v);
    setWhoBad(false);
  };

  // A foundation changed: the list, the clean-up list and the open foundation are read again.
  const changed = useCallback(
    async (id?: string) => {
      void qc.invalidateQueries({ queryKey: fKeys.cleanup });
      void qc.invalidateQueries({ queryKey: fKeys.activity });
      if (id) {
        void qc.invalidateQueries({ queryKey: bbQuery(id).queryKey });
        await qc.invalidateQueries({ queryKey: detailQuery(id).queryKey });
      }
      await qc.invalidateQueries({ queryKey: fKeys.list });
    },
    [qc]
  );

  // Escape closes the drawer, then clears the search.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openId) setOpenId(null);
      else if (q) setQ('');
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [openId, q]);
  // "/" focuses the search. The capture phase on window runs before the frame's palette, which also opens on "/".
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || openId || !qRef.current) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
      e.preventDefault();
      e.stopPropagation();
      qRef.current.focus();
    };
    window.addEventListener('keydown', slash, true);
    return () => window.removeEventListener('keydown', slash, true);
  }, [openId]);

  const misplaced = list.reduce((s, f) => s + Number(f.misplaced || 0), 0);
  const tabs: [string, string, number | ''][] = [
    ['list', 'Prospects', list.length],
    ['cleanup', 'To clean up', misplaced],
    ['activity', 'Sent to Blackbaud', ''],
  ];
  const searching = shownQ.length >= 2;
  const body = (
    <div id="fnd-body">
      <section className="make-sheet fnd-sheet ptl-sheet" id="fnd-view-list" hidden={tab !== 'list'}>
        {tab === 'list' ? <Prospects list={list} onOpen={setOpenId} view={pview} setView={setPview} /> : null}
      </section>
      <section id="fnd-view-cleanup" hidden={tab !== 'cleanup'}>
        {tab === 'cleanup' ? <Cleanup onOpen={setOpenId} /> : null}
      </section>
      <section id="fnd-view-activity" hidden={tab !== 'activity'}>
        {tab === 'activity' ? <Activity /> : null}
      </section>
    </div>
  );
  return (
    <div className="fnd-page">
      <div className="container">
        <header className="board-intro">
          <div>
            <h1>
              Foundation <em>prospects</em>
            </h1>
          </div>
          <div className="board-intro__actions" id="fnd-actions">
            <label className={'fnd-who' + (whoBad ? ' is-bad' : '')} hidden={!!signedName}>
              <span>Entered by</span>
              <input ref={whoRef} id="fnd-who" list="fnd-staff" placeholder="Your name" autoComplete="off" maxLength={60} value={who} onChange={(e) => changeWho(e.target.value)} onBlur={(e) => localStorage.setItem('fnd_actor', e.target.value.trim())} />
              <datalist id="fnd-staff">
                {STAFF.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className="req-submit"
              id="fnd-add"
              onClick={() => {
                setAddName(q.trim());
                setOpenId('new');
              }}
            >
              Add a foundation
            </button>
            <button
              type="button"
              className="req-ghost"
              id="fnd-lock"
              hidden={!!signedName}
              title="Lock this page until the code is entered again"
              onClick={async () => {
                await fetch('/api/foundations/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).catch(() => {});
                setOpenId(null);
                onLock();
              }}
            >
              Lock
            </button>
          </div>
        </header>
        <div id="fnd-app">
          <div className="fnd-top">
            <div className="fnd-tabs" id="fnd-tabs" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t[0]}
                  type="button"
                  role="tab"
                  className={tab === t[0] ? 'is-on' : ''}
                  onClick={() => {
                    setTab(t[0] as typeof tab);
                    if (q) setQ('');
                  }}
                >
                  {t[1]}
                  {t[2] === '' ? null : <span>{Number(t[2]).toLocaleString('en-US')}</span>}
                </button>
              ))}
            </div>
            <section className="fnd-check" aria-label="Check a foundation">
              <label className="fnd-check__box" htmlFor="fnd-q">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input ref={qRef} id="fnd-q" data-pt-search="" type="search" placeholder="Check a foundation before you call" autoComplete="off" autoCapitalize="none" autoCorrect="off" enterKeyHint="search" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} />
                <button
                  type="button"
                  className="fnd-check__clear"
                  id="fnd-q-clear"
                  hidden={!q.trim()}
                  onClick={() => {
                    setQ('');
                    qRef.current?.focus();
                  }}
                >
                  Clear
                </button>
              </label>
            </section>
          </div>
          {searching ? (
            <Boundary fallback={() => body}>
              <Suspense fallback={body}>
                <Results q={shownQ} list={list} onOpen={setOpenId} onAdd={(n) => { setAddName(n); setOpenId('new'); }} />
              </Suspense>
            </Boundary>
          ) : (
            body
          )}
        </div>
      </div>
      <FoundationDrawer
        openId={openId}
        addName={addName}
        onClose={() => setOpenId(null)}
        onOpen={setOpenId}
        needWho={needWho}
        onChanged={async (id) => {
          await changed(id);
          if (id && openId === 'new') setQ('');
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ prospects */
/** The list's filter, sort and page. They live above the list so a search (which swaps the list for its results) and a tab change keep them, as the classic page does. */
interface ProspectView {
  filter: string;
  sort: Sort;
  page: number;
}
const FIRST_VIEW: ProspectView = { filter: 'all', sort: { col: 'contacts', dir: 'desc' }, page: 1 };

function Prospects({ list, onOpen, view, setView }: { list: any[]; onOpen: (id: string) => void; view: ProspectView; setView: (f: (v: ProspectView) => ProspectView) => void }) {
  const { filter, sort, page } = view;
  const setFilter = (f: string) => setView((v) => ({ ...v, filter: f }));
  const setSort = (s: Sort) => setView((v) => ({ ...v, sort: s }));
  const setPage = (p: number) => setView((v) => ({ ...v, page: p }));
  const [size, setSize] = usePageSize('fnd-prospects', 50);
  useListKeys('fnd-prospects');
  const cols: Column<any>[] = useMemo(
    () => [
      {
        key: 'who',
        label: 'Foundation',
        sort: 'name',
        firstDir: 'asc',
        fixed: true,
        className: 'c-who',
        cell: (f) => (
          <div className="ptl-who">
            <span className="pt-name fnd-name" data-pt-open="" title={f.name}>
              {f.name}
            </span>
            {f.location ? (
              <span className="pt-sub ptl-place" title={f.location}>
                {f.location}
              </span>
            ) : null}
          </div>
        ),
      },
      { key: 'contacts', label: 'Contacts', sort: 'contacts', num: true, firstDir: 'desc', className: 'c-contacts', cell: (f) => (Number(f.contacts) || 0).toLocaleString('en-US') },
      { key: 'last', label: 'Last contact', sort: 'last', firstDir: 'desc', className: 'c-last', cell: (f) => day(f.last_contact) || 'None yet' },
      { key: 'rdds', label: 'Fundraiser', sort: 'rdds', firstDir: 'asc', className: 'c-rdds', title: (f) => f.rdds || '', cell: (f) => firstNames(f.rdds) },
      {
        key: 'status',
        label: 'Status',
        sort: 'status',
        firstDir: 'asc',
        className: 'c-status',
        cell: (f) => (
          <>
            {badge(f)}
            {Number(f.waiting) ? <span className="fnd-flag">{Number(f.waiting).toLocaleString('en-US')} waiting</span> : null}
          </>
        ),
      },
    ],
    []
  );
  const [hidden, setHidden] = useHiddenColumns('fnd-prospects', []);
  const count = (k: string) => (k === 'all' ? list.length : list.filter((f) => statusOf(f)[0] === k).length);
  const rows = useMemo(() => {
    const r = list.filter((f) => filter === 'all' || statusOf(f)[0] === filter);
    const key = SORT[sort.col];
    if (!key) return r;
    const sgn = sort.dir === 'asc' ? 1 : -1;
    return r.slice().sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sgn;
    });
  }, [list, filter, sort]);
  const cur = clampPage(page, rows.length, size);
  const registered = useRef(rows);
  registered.current = rows;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  // Open in Google Sheets: the rows the list shows now, in the order shown.
  useEffect(() => {
    let live = true;
    loadScript('/js/sheets.js?v=2')
      .then(() => {
        const FS = (window as any).FavorSheets;
        if (!live || !FS) return;
        FS.register('foundations', () => {
          const f = FILTERS.find((x) => x[0] === filterRef.current);
          return FS.screen(
            'Foundation prospects',
            [
              {
                name: 'Foundations',
                columns: [
                  { key: 'name', label: 'Foundation', type: 'text' },
                  { key: 'location', label: 'Location', type: 'text' },
                  { key: 'contacts', label: 'Contacts', type: 'int' },
                  { key: 'last_contact', label: 'Last contact', type: 'date' },
                  { key: 'rdds', label: 'Fundraiser', type: 'text' },
                  { key: 'status', label: 'Status', type: 'text' },
                  { key: 'waiting', label: 'Waiting', type: 'int' },
                  { key: 'bb', label: 'Blackbaud lookup ID', type: 'id' },
                ],
                rows: registered.current.map((r) => ({ name: r.name, location: r.location || '', contacts: Number(r.contacts) || 0, last_contact: r.last_contact ? String(r.last_contact).slice(0, 10) : null, rdds: firstNames(r.rdds) || '', status: statusOf(r)[1], waiting: Number(r.waiting) || 0, bb: r.bb_lookup_id || '' })),
              },
            ],
            { filters: f && f[0] !== 'all' ? `Showing: ${f[1]}` : '' }
          );
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <div className="pt-bar">
        <Seg label="Show" value={filter} onChange={(k) => { setFilter(k); setPage(1); }} items={FILTERS.map(([k, l]) => ({ k, label: l, n: count(k) }))} />
        <span className="pt-spacer" />
        <ColumnsMenu columns={cols} hidden={hidden} onChange={setHidden} />
        <DensitySwitch />
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-sheets="foundations">
          {SHEET_ICON}Open in Google Sheets
        </button>
      </div>
      <DataTable<any>
        listKey="fnd-prospects"
        label="Foundation prospects"
        columns={cols}
        rows={pageOf(rows, cur, size)}
        rowKey={(f) => String(f.id)}
        sort={sort}
        onSort={(s) => {
          setSort(s);
          setPage(1);
        }}
        hidden={hidden}
        onOpen={(f) => onOpen(f.id)}
        rowClassName={() => 'ptl-row'}
        className="ptl-table ptl-fnd"
        wrapClassName="ptl-wrap"
        fit={400}
        empty={<div className="pt-empty">Nothing here yet.</div>}
      />
      <Pager listKey="fnd-prospects" total={rows.length} page={cur} size={size} onPage={(p, s) => (s !== size ? (setSize(s), setPage(1)) : setPage(p))} />
    </>
  );
}

/* ------------------------------------------------------------------ search results */
function advice(o: any): [string, string] {
  const who = o.held.length ? (o.held.includes('Joe Krol') ? "Joe Krol's team" : o.held.join(', ')) : '';
  if (o.gifts) return ['', `Has given ${plural(o.gifts, 'gift')}, ${money(o.gift_total)} in all, last ${day(o.last_gift)}. ${who ? `Talk to ${who} before you call.` : 'No one is assigned.'}`];
  if (o.grant_actions) return ['', `The grants team has ${plural(o.grant_actions, 'grant action')} here${o.last_grant ? `, last ${day(o.last_grant)}` : ''}. ${who ? `Talk to ${who} before you call.` : ''}`];
  if (who) return ['', `Held by ${who}. ${o.contacts ? `${plural(o.contacts, 'contact')} logged, last ${day(o.last_contact)}.` : 'No contact logged.'}`];
  return ['is-clear', `In Blackbaud with no one assigned${o.contacts ? `, ${plural(o.contacts, 'contact')} logged, last ${day(o.last_contact)}.` : ' and no contact logged.'}`];
}

function Results({ q, onOpen, onAdd }: { q: string; list: any[]; onOpen: (id: string) => void; onAdd: (name: string) => void }) {
  const { data } = useSuspenseQuery(checkQuery(q));
  const P: any[] = data.prospects;
  const B: any[] = data.blackbaud;
  if (!P.length && !B.length) {
    return (
      <div className="fnd-results" id="fnd-results">
        <div className="fnd-none">
          <strong>Nothing under &quot;{q}&quot;</strong>
          {data.offline ? 'Blackbaud could not be reached, so this covers the prospect list only.' : 'It is on neither the prospect list nor in Blackbaud. No one at Favor has logged a contact with it.'}
          <div>
            <button type="button" className="req-submit" onClick={() => onAdd(q)}>
              Add it to the list
            </button>
          </div>
        </div>
      </div>
    );
  }
  const linked = new Set(P.filter((p) => p.bb_lookup_id).map((p) => p.bb_lookup_id));
  return (
    <div className="fnd-results" id="fnd-results">
      <section className="req-col">
        <div className="req-col__head">
          <h2>On the prospect list</h2>
          <span>{P.length}</span>
        </div>
        <div className="req-col__stack">
          {P.length ? (
            P.map((p, i) => (
              <button key={p.id} type="button" className="req-card" data-id={p.id} style={{ ['--i' as string]: i }} onClick={() => onOpen(p.id)}>
                <div className="req-card__kicker">
                  <span>{p.location || firstNames(p.rdds) || 'New'}</span>
                  <span>{statusOf(p)[1]}</span>
                </div>
                <h3>{p.name}</h3>
                <p>{Number(p.contacts) ? `${plural(p.contacts, 'contact')}, last ${day(p.last_contact)} by ${p.last_rdd || 'staff'}` : 'No contact logged yet'}</p>
                {p.status === 'dead' ? <p className="fnd-advice">Dead end{p.dead_reason ? `: ${p.dead_reason}` : '.'}</p> : p.bb_lookup_id ? <p className="fnd-advice">Already in Blackbaud as #{p.bb_lookup_id}.</p> : null}
              </button>
            ))
          ) : (
            <>
              <p className="req-empty">Not on the list.</p>
              <p className="req-empty" style={{ paddingTop: 0 }}>
                <button type="button" className="fnd-textbtn" onClick={() => onAdd(q)}>
                  Add it to the list
                </button>
              </p>
            </>
          )}
        </div>
      </section>
      <section className="req-col">
        <div className="req-col__head">
          <h2>In Blackbaud</h2>
          <span>{data.offline ? 'offline' : B.length}</span>
        </div>
        <div className="req-col__stack">
          {data.offline ? (
            <p className="req-empty">Blackbaud could not be reached. Try again in a minute.</p>
          ) : B.length ? (
            B.map((o, i) => {
              const a = advice(o);
              return (
                <div key={o.lookup_id} className="req-card fnd-hit--static" style={{ ['--i' as string]: i }}>
                  <div className="req-card__kicker">
                    <span>
                      #{o.lookup_id}
                      {o.where ? ` · ${o.where}` : ''}
                    </span>
                    <span>{o.codes.join(' · ') || 'No code'}</span>
                  </div>
                  <h3>{o.name}</h3>
                  <p>
                    Record made {day(o.made)}
                    {linked.has(o.lookup_id) ? ' · also on the prospect list' : ''}
                  </p>
                  <p className={'fnd-advice ' + a[0]}>{a[1]}</p>
                </div>
              );
            })
          ) : (
            <p className="req-empty">No organization in Blackbaud has this name.</p>
          )}
        </div>
      </section>
    </div>
  );
}
