// Reporting > Lists (/lists/): build a list of partners or gifts from menus, watch the count change, save it, download it and open it in
// Google Sheets. The server checks every menu value and compiles the query; this page draws what it returns. A saved list opens at
// /lists/?l=<id>, and a standard report's row opens /lists/?spec=<the criteria in base64url>.
import '@hub/styles/reports.css';
import '@hub/styles/lists.css';
import './lists-web.css';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Criteria } from './Criteria';
import { SpecCtx } from './fields';
import { PopProvider, Popover, RollNumber, Toast, usePop, useSheets, useToast } from './kit';
import { call, exportTitle, listsCall, listsMetaQuery, type Col, type CountReply, type ListsMeta, type RowsReply, type Saved, type Tie } from './api';
import { day, money, num, when } from './fmt';
import { blank, decodeSpec, fromSaved, sectionCounts, setIn, unitWord, type ListSpec } from './spec';

export interface ListsSearch { l?: string; spec?: string }

const SCOPE_WORDS: Record<string, string> = { private: 'Only me', team: 'My team', all: 'Everyone' };

/** What the page holds while its menus are read: the same box the classic page draws before its script runs. */
export function ListsFallback() {
  return (
    <>
      <div id="ls-app" data-api="/api/lists">
        <p className="rp-note rp-loading">Loading</p>
      </div>
      <div className="rp-toast" id="ls-toast" role="status" />
    </>
  );
}

export function ListsError({ message }: { message: string }) {
  return (
    <div id="ls-app" data-api="/api/lists">
      <div className="h-card ls-pad">
        <p className="rp-note">{message || 'Lists did not load.'}</p>
      </div>
    </div>
  );
}

export function ListsPage({ search }: { search: ListsSearch }) {
  return (
    <Suspense fallback={<ListsFallback />}>
      <PopProvider>
        <Lists search={search} />
      </PopProvider>
    </Suspense>
  );
}

interface CountState { count: CountReply['count']; tie: Tie | null; left: number }

function Lists({ search }: { search: ListsSearch }) {
  const { data: meta } = useSuspenseQuery(listsMetaQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast, msg, on } = useToast();

  // The criteria. specRef is the same value read by the timers and requests, which must see a change the moment it is made.
  const [initial] = useState(() => {
    const s = search.l ? (meta.saved || []).find((x) => x.id === search.l) : undefined;
    if (s) return { spec: fromSaved(s.spec), id: s.id, name: s.name };
    const raw = search.spec ? decodeSpec(search.spec) : null;
    return { spec: raw ? fromSaved(raw) : blank(), id: '', name: '' };
  });
  const [spec, setSpec] = useState<ListSpec>(initial.spec);
  const specRef = useRef(spec);
  const [saved, setSaved] = useState({ id: initial.id, name: initial.name });
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const [epoch, setEpoch] = useState(0);

  // The answers.
  const [count, setCount] = useState<CountState | null>(null);
  const [countErr, setCountErr] = useState('');
  const [data, setData] = useState<RowsReply | null>(null);
  const [rowsErr, setRowsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pageRef = useRef(1);
  const seq = useRef(0);
  const inflight = useRef(0);
  const timers = useRef<{ c?: ReturnType<typeof setTimeout>; r?: ReturnType<typeof setTimeout> }>({});

  const commit = useCallback((next: (s: ListSpec) => ListSpec) => {
    const n = next(specRef.current);
    specRef.current = n;
    setSpec(n);
  }, []);

  const refreshCount = useCallback(() => {
    const my = ++seq.current;
    listsCall<CountReply>('/count', { spec: specRef.current }).then((d) => {
      if (my !== seq.current) return;
      if (d.ok === false) {
        setCountErr(d.message || '');
        return;
      }
      setCountErr('');
      setCount({ count: d.count, tie: d.tie, left: d.leftOut || 0 });
    });
  }, []);

  const refreshRows = useCallback(() => {
    const my = seq.current;
    inflight.current++;
    setBusy(true);
    listsCall<RowsReply>('/rows', { spec: specRef.current, page: pageRef.current }).then((d) => {
      inflight.current--;
      setBusy(inflight.current > 0);
      if (my !== seq.current) return;
      if (d.ok === false) {
        setRowsErr(d.message || 'The list did not load.');
        return;
      }
      setRowsErr('');
      setData(d);
    });
  }, []);

  /** A criterion changed: back to page one, the count after 180 ms and the rows after 380 ms, so typing does not ask for each key. */
  const changed = useCallback(() => {
    pageRef.current = 1;
    clearTimeout(timers.current.c);
    clearTimeout(timers.current.r);
    timers.current.c = setTimeout(refreshCount, 180);
    timers.current.r = setTimeout(refreshRows, 380);
  }, [refreshCount, refreshRows]);

  /** The whole list is drawn again from the criteria (a saved list opened, Clear, the other kind): inputs reset and both answers are asked for at once. */
  const redraw = useCallback(() => {
    clearTimeout(timers.current.c);
    clearTimeout(timers.current.r);
    pageRef.current = 1;
    setEpoch((e) => e + 1);
    refreshCount();
    refreshRows();
  }, [refreshCount, refreshRows]);

  const set = useCallback(
    (path: string, v: unknown) => {
      commit((s) => setIn(s, path, v));
      changed();
    },
    [commit, changed]
  );
  const quiet = useCallback((path: string, v: unknown) => commit((s) => setIn(s, path, v)), [commit]);

  const built = !!meta.snapshot;
  useEffect(() => {
    if (!built) return;
    refreshCount();
    refreshRows();
    return () => {
      clearTimeout(timers.current.c);
      clearTimeout(timers.current.r);
    };
  }, [built, refreshCount, refreshRows]);

  const setUrl = (id: string) => void navigate({ to: '/lists/', search: id ? { l: id } : {}, replace: true, resetScroll: false });
  const reloadSaved = () => void qc.invalidateQueries({ queryKey: listsMetaQuery.queryKey });

  const crit = useRef<HTMLDetailsElement>(null);
  const sum = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A phone opens with the criteria folded; the stylesheet already hides them there until this runs, so nothing jumps.
    const d = crit.current;
    if (!d) return;
    d.removeAttribute('data-auto');
    if (window.innerWidth <= 860) d.open = false;
  }, [built]);

  useSheets('lists', async () => {
    const r = await fetch('/api/lists/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ spec: specRef.current, format: 'sheet', title: exportTitle(specRef.current, savedRef.current.name) }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.message || 'The sheet did not build.');
    return d.spec;
  });

  const csv = () => {
    fetch('/api/lists/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ spec: specRef.current, format: 'csv', title: exportTitle(specRef.current, savedRef.current.name) }) })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.message || 'The file did not build.')));
        return r.blob().then((b) => [b, (r.headers.get('Content-Disposition') || '').replace(/.*filename="([^"]+)".*/, '$1')] as const);
      })
      .then(([b, name]) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = name || 'list.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 500);
      })
      .catch((e: Error) => toast(e.message));
  };

  const loadSaved = (s: Saved) => {
    commit(() => fromSaved(s.spec));
    setSaved({ id: s.id, name: s.name });
    redraw();
    setUrl(s.id);
  };
  const clear = () => {
    commit((s) => blank(s.kind));
    setSaved({ id: '', name: '' });
    setUrl('');
    redraw();
  };
  const switchKind = (kind: 'partners' | 'gifts') => {
    if (specRef.current.kind === kind) return;
    commit((s) => ({ ...s, kind, columns: [], sort: { key: '', dir: 'desc' } }));
    setData(null);
    redraw();
  };
  const sortBy = (k: string) => {
    const asc = specRef.current.sort.key === k && specRef.current.sort.dir === 'desc';
    commit((s) => ({ ...s, sort: { key: k, dir: asc ? 'asc' : 'desc' } }));
    pageRef.current = 1;
    refreshRows();
  };
  const turnPage = (by: number) => {
    pageRef.current += by;
    refreshRows();
  };

  if (!meta.snapshot) return <NoSnapshot meta={meta} onBuilt={reloadSaved} />;

  const counts = sectionCounts(spec);
  const gifts = spec.kind === 'gifts';
  const c = count?.count;
  const facts: string[] = [];
  if (c) {
    facts.push(gifts ? money(c.total) + ' credited' : money(c.total) + ' lifetime');
    if (gifts) facts.push(num(c.partners) + (c.partners === 1 ? ' partner' : ' partners'));
    if (spec.partner.mailReady && count?.left) facts.push(num(count.left) + ' left out (Do Not Mail or no valid address)');
  }
  const bigNum = c ? num(c.n) : '—';
  const bigWord = c ? unitWord(spec.kind, c.n) : '';

  return (
    <>
      <div id="ls-app" data-api="/api/lists">
        <div className="ls-top" id="ls-bar">
          <div className="rp-seg2" role="group" aria-label="List of">
            <button type="button" data-kind="partners" className={!gifts ? 'is-on' : ''} onClick={() => switchKind('partners')}>
              Partners
            </button>
            <button type="button" data-kind="gifts" className={gifts ? 'is-on' : ''} onClick={() => switchKind('gifts')}>
              Gifts
            </button>
          </div>
          <span className="ls-curwrap">{saved.name ? <span className="ls-cur">{saved.name}</span> : null}</span>
          <span className="ls-grow" />
          <span className="ls-stamp" suppressHydrationWarning>
            {'Data as of ' + when(new Date(meta.snapshot.builtAt))}
          </span>
          <SavedButton saved={meta.saved || []} onOpen={loadSaved} />
        </div>
        <div className="ls-grid">
          <details className="h-card ls-crit" id="ls-critc" ref={crit} data-auto="" open>
            <summary className="ls-crit__h">
              <span>
                Criteria <b id="ls-critn">{counts.total ? String(counts.total) : ''}</b>
              </span>
              <button
                type="button"
                className="ls-link"
                id="ls-clear"
                hidden={!counts.total}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }}
              >
                Clear
              </button>
            </summary>
            <div id="ls-critbody" key={epoch}>
              <SpecCtx.Provider value={{ spec, set }}>
                <Criteria menus={meta.menus || {}} spec={spec} counts={counts} set={set} quiet={quiet} />
              </SpecCtx.Provider>
            </div>
            <div className="ls-show">
              <button
                type="button"
                className="h-btn h-btn--primary h-btn--sm"
                id="ls-show"
                onClick={() => {
                  if (crit.current) crit.current.open = false;
                  sum.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                }}
              >
                Show results
              </button>
            </div>
          </details>
          <div className="ls-out">
            <div className="h-card ls-sumc">
              <div id="ls-sum" className="ls-sum" ref={sum}>
                <div className="ls-big">
                  <b data-flow="lists-count">
                    <RollNumber text={bigNum} />
                  </b>
                  <span>{bigWord}</span>
                </div>
                <div className="ls-facts">{countErr || facts.join(' · ')}</div>
                {count?.tie ? <TieBox tie={count.tie} /> : null}
              </div>
              <div className="ls-acts">
                <SaveButton spec={spec} saved={meta.saved || []} savedId={saved.id} onSaved={(s) => { setSaved({ id: s.id, name: s.name }); reloadSaved(); toast('Saved'); setUrl(s.id); }} onDeleted={() => { setSaved({ id: '', name: '' }); reloadSaved(); setUrl(''); toast('Deleted'); }} onError={toast} />
                <ColumnsButton
                  meta={meta}
                  spec={spec}
                  shown={data ? data.columns.map((x) => x.key) : []}
                  onColumns={(cols) => {
                    commit((s) => ({ ...s, columns: cols }));
                    refreshRows();
                  }}
                  onMailHouse={(cols) => {
                    commit((s) => ({ ...s, columns: cols, partner: { ...s.partner, mailReady: true } }));
                    redraw();
                  }}
                />
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" id="ls-csv" onClick={csv}>
                  CSV
                </button>
                <button type="button" className="h-btn h-btn--primary h-btn--sm" data-sheets="lists">
                  Open in Google Sheets
                </button>
              </div>
            </div>
            <div className="h-card ls-tcard">
              <div id="ls-table" className={'ls-tbl' + (busy && data ? ' is-busy' : '')}>
                {rowsErr ? (
                  <p className="rp-note ls-pad">{rowsErr}</p>
                ) : data ? (
                  <ResultsTable data={data} spec={spec} onSort={sortBy} onPage={turnPage} />
                ) : (
                  <p className="rp-note ls-pad rp-loading">Loading</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Toast id="ls-toast" msg={msg} on={on} />
    </>
  );
}

function NoSnapshot({ meta, onBuilt }: { meta: ListsMeta; onBuilt: () => void }) {
  const [state, setState] = useState<'idle' | 'building'>('idle');
  return (
    <div id="ls-app" data-api="/api/lists">
      <div className="h-card ls-pad">
        <p className="rp-note">
          The lists data has not been built yet.
          {meta.admin ? (
            <>
              {' '}
              <button
                type="button"
                className="ls-link"
                id="ls-build"
                disabled={state === 'building'}
                onClick={() => {
                  setState('building');
                  fetch('/api/lists/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(onBuilt);
                }}
              >
                {state === 'building' ? 'Building' : 'Build it now'}
              </button>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function TieBox({ tie }: { tie: Tie }) {
  const cls = tie.status === 'match' ? 'is-ok' : tie.status === 'differs' ? 'is-warn' : 'is-off';
  return (
    <div className={'ls-tie ' + cls}>
      <span className="ls-tie__i" aria-hidden="true">
        {tie.status === 'match' ? '✓' : '≠'}
      </span>
      <div>
        <b>{tie.status === 'match' ? 'Ties to the KPI dashboard' : tie.status === 'differs' ? 'Differs from the KPI dashboard' : 'KPI dashboard not answering'}</b>
        <span>
          {tie.label + ': ' + (tie.kpi == null ? '—' : num(tie.kpi)) + (tie.status === 'differs' ? ' · this list ' + num(tie.mine) + (tie.note ? ' · ' + tie.note : '') : '')}
        </span>
      </div>
    </div>
  );
}

function Cell({ col, value, row }: { col: Col; value: any; row: Record<string, any> }) {
  if (value == null || value === '') return null;
  if (col.type === 'money') return <>{money(value)}</>;
  if (col.type === 'int') return <>{num(value)}</>;
  if (col.type === 'date') return <>{day(value)}</>;
  if (col.type === 'chip') return <span className={'ls-st ls-st--' + String(value).toLowerCase()}>{String(value)}</span>;
  if (col.key === 'partner' && row._rid) return <a href={'/work/partner/' + encodeURIComponent(row._rid)}>{String(value)}</a>;
  return <>{String(value)}</>;
}

function ResultsTable({ data, spec, onSort, onPage }: { data: RowsReply; spec: ListSpec; onSort: (key: string) => void; onPage: (by: number) => void }) {
  const cols = data.columns;
  const sortKey = spec.sort.key || (spec.kind === 'gifts' ? 'gift_date' : 'last_gift');
  const right = (c: Col) => c.type === 'money' || c.type === 'int';
  const pages = Math.max(1, Math.ceil(data.count.n / data.pageSize));
  return (
    <>
      <div className="ls-scroll rp-scroll">
        <table className="rp-table ls-t">
          <thead>
            <tr>
              {cols.map((c) => {
                const on = c.key === sortKey;
                return (
                  <th key={c.key} className={(right(c) ? 'r ' : '') + (on ? 'is-sort' : '')} aria-sort={on ? (spec.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" data-sort={c.key} onClick={() => onSort(c.key)}>
                      {c.label}
                      <span className="ar">{on ? (spec.sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.length ? (
              data.rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className={right(c) ? 'r' : c.type === 'id' ? 'id' : ''}>
                      <Cell col={c} value={r[c.key]} row={r} />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="rp-empty" colSpan={cols.length}>
                  No rows
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="rp-pager">
          <span>
            {num((data.page - 1) * data.pageSize + 1)} to {num(Math.min(data.page * data.pageSize, data.count.n))} of {num(data.count.n)}
          </span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-pg="-1" disabled={data.page <= 1} onClick={() => onPage(-1)}>
            Previous
          </button>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-pg="1" disabled={data.page >= pages} onClick={() => onPage(1)}>
            Next
          </button>
        </div>
      ) : null}
    </>
  );
}

function SavedButton({ saved, onOpen }: { saved: Saved[]; onOpen: (s: Saved) => void }) {
  const pop = usePop('saved');
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="ls-quiet" id="ls-saved" onClick={pop.toggle}>
        Saved lists <span className="ls-caret" aria-hidden="true" />
      </button>
      {pop.open ? (
        <Popover anchor={btn} onClose={pop.close}>
          <p className="ls-pt">Saved lists</p>
          {saved.length ? null : <p className="ls-none">None yet</p>}
          <div className="ls-opts">
            {saved.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ls-opt"
                onClick={() => {
                  onOpen(s);
                  pop.close();
                }}
              >
                <b>{s.name}</b>
                <small>{(s.mine ? 'You' : s.ownerName) + ' · ' + SCOPE_WORDS[s.scope]}</small>
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function SaveButton({ spec, saved, savedId, onSaved, onDeleted, onError }: { spec: ListSpec; saved: Saved[]; savedId: string; onSaved: (s: Saved) => void; onDeleted: () => void; onError: (m: string) => void }) {
  const pop = usePop('save');
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="ls-quiet" id="ls-save" onClick={pop.toggle}>
        Save list
      </button>
      {pop.open ? (
        <Popover anchor={btn} onClose={pop.close}>
          <SaveForm spec={spec} cur={saved.find((s) => s.id === savedId)} onClose={pop.close} onSaved={onSaved} onDeleted={onDeleted} onError={onError} />
        </Popover>
      ) : null}
    </>
  );
}

function SaveForm({ spec, cur, onClose, onSaved, onDeleted, onError }: { spec: ListSpec; cur: Saved | undefined; onClose: () => void; onSaved: (s: Saved) => void; onDeleted: () => void; onError: (m: string) => void }) {
  const mine = !!cur && cur.mine;
  const [name, setName] = useState(mine ? cur.name : '');
  const [scope, setScope] = useState<string>(mine ? cur.scope : 'private');
  return (
    <>
      <p className="ls-pt">{mine ? 'Update this list' : 'Save this list'}</p>
      <input type="text" placeholder="List name" maxLength={80} aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="ls-f">
        <span className="ls-fl">Share with</span>
        <div className="ls-seg">
          {(['private', 'team', 'all'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={k === scope} onClick={() => setScope(k)}>
              {SCOPE_WORDS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="ls-prow">
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={() => {
            call<{ saved: Saved }>(mine ? '/api/lists/saved/' + cur.id : '/api/lists/saved', { name, scope, spec }, mine ? 'PUT' : undefined).then((d) => {
              if (!d.ok) {
                onError(d.message || 'The list did not save.');
                return;
              }
              onClose();
              onSaved(d.saved);
            });
          }}
        >
          {mine ? 'Update' : 'Save'}
        </button>
        {mine ? (
          <button
            type="button"
            className="ls-danger"
            onClick={() => {
              call('/api/lists/saved/' + cur.id, undefined, 'DELETE').then((d) => {
                if (!d.ok) {
                  onError(d.message || 'Not deleted.');
                  return;
                }
                onClose();
                onDeleted();
              });
            }}
          >
            Delete
          </button>
        ) : null}
      </div>
    </>
  );
}

function ColumnsButton({ meta, spec, shown, onColumns, onMailHouse }: { meta: ListsMeta; spec: ListSpec; shown: string[]; onColumns: (cols: string[]) => void; onMailHouse: (cols: string[]) => void }) {
  const pop = usePop('columns');
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="ls-quiet" id="ls-cols" onClick={pop.toggle}>
        Columns <span className="ls-caret" aria-hidden="true" />
      </button>
      {pop.open ? (
        <Popover anchor={btn} onClose={pop.close}>
          <ColumnsForm meta={meta} spec={spec} shown={shown} onClose={pop.close} onColumns={onColumns} onMailHouse={onMailHouse} />
        </Popover>
      ) : null}
    </>
  );
}

function ColumnsForm({ meta, spec, shown, onClose, onColumns, onMailHouse }: { meta: ListsMeta; spec: ListSpec; shown: string[]; onClose: () => void; onColumns: (cols: string[]) => void; onMailHouse: (cols: string[]) => void }) {
  const avail = (meta.columns || []).filter((c) => (!c.only || c.only === spec.kind) && (c.live !== 'contact' || meta.contacts));
  const [chosen, setChosen] = useState<string[]>(() => (spec.columns.length ? spec.columns.slice() : shown));
  return (
    <>
      <p className="ls-pt">Columns</p>
      <div className="ls-opts">
        {avail.map((c) => (
          <label className="ls-copt" key={c.key}>
            <input
              type="checkbox"
              checked={chosen.includes(c.key)}
              onChange={(e) => {
                const next = avail.map((x) => x.key).filter((k) => (k === c.key ? e.target.checked : chosen.includes(k)));
                setChosen(next);
                onColumns(next);
              }}
            />
            {c.label}
          </label>
        ))}
      </div>
      {spec.kind === 'partners' ? (
        <button
          type="button"
          className="ls-link"
          onClick={() => {
            onClose();
            onMailHouse(['addressee', 'salutation', 'address', 'city', 'state', 'zip', 'lookup'].filter((k) => avail.some((c) => c.key === k)));
          }}
        >
          Mail house columns
        </button>
      ) : null}
      <button
        type="button"
        className="ls-link"
        onClick={() => {
          onClose();
          onColumns([]);
        }}
      >
        Reset to the usual columns
      </button>
    </>
  );
}
