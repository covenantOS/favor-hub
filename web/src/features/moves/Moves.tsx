// Moves: the major-partner pipeline. Columns are stages, cards are partners with their ask, next step, owner and last contact. Drag a card to
// another stage (or pick the stage in the side panel); the change is saved in FavorOS's own database. Totals tie to the Asks board.
import '../../styles/moves.css';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { send } from '@/lib/api';
import { money0, dayShort } from '@/lib/format';
import { RelationshipMap } from '../partners/record/RelationshipMap';
import { boardQuery, cardQuery, listQuery, mvKeys } from './queries';
import { hubGet } from '../../lib/hub';
import type { Board, MoveRow } from './types';

export interface MovesSearch { cid?: number; view?: 'board' | 'list'; owner?: number; q?: string; sort?: string }
const SORTS: [string, string][] = [['asked', 'Amount asked'], ['due', 'Next step due'], ['contact', 'Longest since contact'], ['largest', 'Largest gift'], ['name', 'Name']];
const LIST_PAGE = 25;
const day = (d: string | null) => (d ? dayShort(d) : '');

export function Moves({ search }: { search: MovesSearch }) {
  const navigate = useNavigate();
  const set = (patch: Partial<MovesSearch>, replace = true) =>
    void navigate({ to: '/moves/', search: ((prev: MovesSearch) => ({ ...prev, ...patch })) as never, replace, resetScroll: false } as never);
  return (
    <div className="mv">
      <ErrorBoundary label="Moves did not open." className="h-card">
        <Suspense fallback={<MovesSkeleton />}>
          <Body search={search} set={set} />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

function MovesSkeleton() {
  return (
    <div aria-busy="true">
      <section className="h-card mv-band" style={{ minHeight: 96 }} aria-hidden="true" />
      <div className="mv-cols" style={{ marginTop: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mv-col r2t-skel" style={{ minHeight: 420 }} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

function Body({ search, set }: { search: MovesSearch; set: (p: Partial<MovesSearch>, replace?: boolean) => void }) {
  const owner = search.owner ? String(search.owner) : '';
  const sort = search.sort || 'asked';
  const view = search.view === 'list' ? 'list' : 'board';
  const [find, setFind] = useState(search.q || '');
  const [q, setQ] = useState(search.q || '');
  const [per, setPer] = useState(12);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(find.trim()), 250);
    return () => window.clearTimeout(t);
  }, [find]);
  const { data } = useSuspenseQuery(boardQuery(owner, q, sort, per));
  const qc = useQueryClient();
  const openCid = search.cid ? String(search.cid) : '';
  const moveTo = useMove(qc, owner, q, sort, per);
  return (
    <>
      <Band data={data} />
      <section className="h-card mv-tools" aria-label="Filters">
        <div className="mv-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'board'} onClick={() => set({ view: undefined }, false)}>Board</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => set({ view: 'list' }, false)}>List</button>
        </div>
        <input className="mv-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a partner or next step" aria-label="Find a partner or next step" />
        {data.owners.length > 1 ? (
          <select value={data.owner} onChange={(e) => set({ owner: e.target.value ? Number(e.target.value) : undefined })} aria-label="Fundraiser">
            <option value="">Every fundraiser</option>
            {data.owners.map((o) => (
              <option key={o.id} value={o.id}>{`${o.name} (${o.n})`}</option>
            ))}
          </select>
        ) : null}
        <select value={data.sort} onChange={(e) => set({ sort: e.target.value === 'asked' ? undefined : e.target.value })} aria-label="Order">
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button type="button" className="mv-link" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? 'Close' : 'Add a partner'}
        </button>
        {data.admin ? (
          <button type="button" className="mv-link mv-link--tight" onClick={() => setEditing(true)}>
            Edit stages
          </button>
        ) : null}
      </section>
      {adding ? <AddPartner stages={data.stages.filter((s) => s.id !== 'pool')} onAdded={(cid) => { setAdding(false); set({ cid: Number(cid) }, false); }} /> : null}
      <div className={'mv-main' + (openCid ? ' has-panel' : '')}>
        {view === 'board' ? <BoardView data={data} per={per} setPer={setPer} open={openCid} onOpen={(cid) => set({ cid: Number(cid) }, false)} onMove={moveTo} /> : <ListView data={data} owner={owner} q={q} sort={sort} open={openCid} onOpen={(cid) => set({ cid: Number(cid) }, false)} />}
        {openCid ? (
          <ErrorBoundary label="The partner panel could not load." className="h-card">
            <Panel key={openCid} cid={openCid} onClose={() => set({ cid: undefined })} onMove={moveTo} />
          </ErrorBoundary>
        ) : null}
      </div>
      {editing ? <StageEditor data={data} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

function Band({ data }: { data: Board }) {
  const staged = data.stages.filter((s) => s.id !== 'pool');
  const inPlay = staged.reduce((t, s) => t + s.n, 0);
  const pool = data.stages.find((s) => s.id === 'pool');
  const due = data.stages.reduce((t, s) => t + s.rows.filter((r) => r.nextDue && r.nextDue <= data.today).length, 0);
  return (
    <section className="h-card mv-band" aria-label="Moves totals">
      <div className="mv-stat"><small>Partners in a stage</small><b>{inPlay.toLocaleString('en-US')}</b><span>{pool ? `${pool.n.toLocaleString('en-US')} major partners not staged` : ''}</span></div>
      <div className="mv-stat"><small>Open asks</small><b>{money0(data.askedTotal)}</b><span>Same total as Open on the Asks board</span></div>
      {staged.slice(0, 3).map((s) => (
        <div className="mv-stat mv-stat--stage" key={s.id}><small>{s.label}</small><b>{s.n.toLocaleString('en-US')}</b><span>{s.asked ? money0(s.asked) + ' asked' : 'No ask amount'}</span></div>
      ))}
      <span className="mv-sr" aria-live="polite">{due ? `${due} next steps due` : ''}</span>
    </section>
  );
}

/* ---------------------------------------------------------------- board */

function BoardView({ data, per, setPer, open, onOpen, onMove }: { data: Board; per: number; setPer: (n: number) => void; open: string; onOpen: (cid: string) => void; onMove: (r: { cid: string; from: string; to: string; name?: string }) => void }) {
  const [over, setOver] = useState('');
  const drag = useRef<{ cid: string; from: string; name: string } | null>(null);
  return (
    <div className="mv-cols" role="list" aria-label="Stages">
      {data.stages.map((s) => (
        <section
          key={s.id}
          role="listitem"
          className={'mv-col' + (over === s.id ? ' is-over' : '') + (s.id === 'pool' ? ' is-pool' : '')}
          aria-label={s.label}
          onDragOver={(e) => {
            if (s.id === 'pool' || !drag.current) return;
            e.preventDefault();
            setOver(s.id);
          }}
          onDragLeave={() => setOver((o) => (o === s.id ? '' : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver('');
            const d = drag.current;
            drag.current = null;
            if (d && s.id !== 'pool' && d.from !== s.id) onMove({ cid: d.cid, from: d.from, to: s.id, name: d.name });
          }}
        >
          <header className="mv-ch">
            <h3>{s.label}</h3>
            <span className="mv-n">{s.n.toLocaleString('en-US')}</span>
            <span className="mv-amt">{s.asked ? money0(s.asked) : ''}</span>
          </header>
          <div className="mv-cards">
            {s.rows.map((r) => (
              <Card
                key={r.key}
                r={r}
                today={data.today}
                active={open === r.cid}
                onOpen={() => onOpen(r.cid)}
                onDragStart={() => {
                  drag.current = { cid: r.cid, from: r.stage, name: r.name };
                }}
                onDragEnd={() => {
                  drag.current = null;
                  setOver('');
                }}
              />
            ))}
            {!s.rows.length ? <p className="mv-empty">{s.id === 'pool' ? 'Every major partner is in a stage.' : 'No partners here.'}</p> : null}
            {s.n > s.rows.length ? (
              per < 100 ? (
                <button type="button" className="mv-more" onClick={() => setPer(Math.min(100, per + 24))}>
                  {`Show more (${s.rows.length} of ${s.n.toLocaleString('en-US')})`}
                </button>
              ) : (
                <p className="mv-empty">{`Showing ${s.rows.length} of ${s.n.toLocaleString('en-US')}. Search, pick a fundraiser or use List to see the rest.`}</p>
              )
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Card({ r, today, active, onOpen, onDragStart, onDragEnd }: { r: MoveRow; today: string; active: boolean; onOpen: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  return (
    <article className={'mv-card' + (active ? ' is-open' : '')} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', r.cid); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }} onDragEnd={onDragEnd}>
      <button type="button" className="mv-card-b" onClick={onOpen} aria-pressed={active}>
        <b>{r.name}</b>
        <span className="mv-sub">{[r.place, r.ownerNames[0] ? r.ownerNames[0] + (r.ownerNames.length > 1 ? ` +${r.ownerNames.length - 1}` : '') : ''].filter(Boolean).join(' · ')}</span>
        <span className="mv-row">
          {r.asked ? <em className="mv-ask">{money0(r.asked)} asked</em> : <em className="mv-dim">{r.largest ? `Gave up to ${money0(r.largest)}` : 'No gift'}</em>}
          <span className="mv-dim">{r.lastContact ? 'Spoke ' + day(r.lastContact) : 'No contact on file'}</span>
        </span>
        {r.nextStep ? (
          <span className={'mv-next' + (r.nextDue && r.nextDue < today ? ' is-late' : '')}>
            {r.nextStep}
            {r.nextDue ? <i>{day(r.nextDue)}</i> : null}
          </span>
        ) : null}
      </button>
    </article>
  );
}

/** Move a partner: the board shows the new column at once, and a refused change puts it back. */
function useMove(qc: QueryClient, owner: string, q: string, sort: string, per: number) {
  const m = useMutation({
    mutationFn: async (v: { cid: string; from: string; to: string }) => await send('/api/moves/card', { cid: v.cid, stage: v.to }),
    onMutate: async (v: { cid: string; from: string; to: string }) => {
      const key = mvKeys.board(owner, q, sort, per);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Board>(key);
      if (prev) {
        const row = prev.stages.flatMap((s) => s.rows).find((r) => r.cid === v.cid);
        if (row) {
          qc.setQueryData<Board>(key, {
            ...prev,
            stages: prev.stages.map((s) => {
              if (s.id === v.from) return { ...s, n: s.n - 1, asked: s.asked - row.asked, rows: s.rows.filter((r) => r.cid !== v.cid) };
              if (s.id === v.to) return { ...s, n: s.n + 1, asked: s.asked + row.asked, rows: [{ ...row, stage: v.to, staged: true }, ...s.rows] };
              return s;
            }),
          });
        }
      }
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx && ctx.prev) qc.setQueryData(ctx.key, ctx.prev);
      window.alert('That move did not save. ' + ((_e as Error).message || ''));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: mvKeys.all }),
  });
  return (v: { cid: string; from: string; to: string; name?: string }) => m.mutate(v);
}

/* ---------------------------------------------------------------- list */

function ListView({ data, owner, q, sort, open, onOpen }: { data: Board; owner: string; q: string; sort: string; open: string; onOpen: (cid: string) => void }) {
  const [page, setPage] = useState(0);
  const [stage, setStage] = useState('');
  const res = useQuery({ ...listQuery(owner, q, sort, stage, page * LIST_PAGE, LIST_PAGE), placeholderData: (p) => p });
  const names = useMemo(() => Object.fromEntries(data.stages.map((s) => [s.id, s.label])), [data]);
  const n = res.data ? res.data.n : 0;
  const pages = Math.max(1, Math.ceil(n / LIST_PAGE));
  return (
    <section className="h-card mv-list" aria-label="Partners">
      <div className="mv-chips" role="group" aria-label="Stage">
        <button type="button" aria-pressed={stage === ''} onClick={() => { setStage(''); setPage(0); }}>All <em>{data.total.toLocaleString('en-US')}</em></button>
        {data.stages.map((s) => (
          <button type="button" key={s.id} aria-pressed={stage === s.id} onClick={() => { setStage(s.id); setPage(0); }}>{s.label} <em>{s.n.toLocaleString('en-US')}</em></button>
        ))}
      </div>
      <div className="mv-scroll">
        <table className="mv-table">
          <thead>
            <tr><th>Partner</th><th>Stage</th><th className="n">Asked</th><th>Next step</th><th>Due</th><th>Last contact</th><th>Owner</th></tr>
          </thead>
          <tbody>
            {(res.data ? res.data.rows : []).map((r) => (
              <tr key={r.key} className={open === r.cid ? 'is-open' : ''} onClick={() => onOpen(r.cid)}>
                <td className="name"><button type="button" onClick={() => onOpen(r.cid)}>{r.name}</button><span className="mv-sub">{r.place}</span></td>
                <td>{names[r.stage] || r.stage}</td>
                <td className="n">{r.asked ? money0(r.asked) : ''}</td>
                <td>{r.nextStep}</td>
                <td className={r.overdue ? 'late' : ''}>{day(r.nextDue)}</td>
                <td>{day(r.lastContact)}</td>
                <td>{r.ownerNames.join(', ')}</td>
              </tr>
            ))}
            {res.data && !res.data.rows.length ? <tr><td colSpan={7} className="empty"><b>No partners match.</b> Clear the search or pick All.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer className="mv-foot">
        <span>{n ? `${page * LIST_PAGE + 1} to ${Math.min((page + 1) * LIST_PAGE, n)} of ${n.toLocaleString('en-US')}` : '0 partners'}</span>
        <nav aria-label="Pages">
          <button type="button" disabled={page <= 0} onClick={() => setPage(page - 1)} aria-label="Previous page">&lsaquo;</button>
          <span>{`Page ${page + 1} of ${pages}`}</span>
          <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">&rsaquo;</button>
        </nav>
      </footer>
    </section>
  );
}

/* ---------------------------------------------------------------- side panel */

function Panel({ cid, onClose, onMove }: { cid: string; onClose: () => void; onMove: (r: { cid: string; from: string; to: string; name?: string }) => void }) {
  const qc = useQueryClient();
  const q = useQuery(cardQuery(cid));
  const [step, setStep] = useState('');
  const [due, setDue] = useState('');
  const [msg, setMsg] = useState('');
  const row = q.data ? q.data.row : null;
  useEffect(() => {
    if (row) {
      setStep(row.nextStep);
      setDue(row.nextDue || '');
    }
  }, [row ? row.key : '', row ? row.nextStep : '', row ? row.nextDue : '']);
  const save = useMutation({
    mutationFn: async () => await send('/api/moves/card', { cid, nextStep: step, nextDue: due || null }),
    onSuccess: () => {
      setMsg('Saved. A reminder is on the owner\'s list.');
      void qc.invalidateQueries({ queryKey: mvKeys.all });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  return (
    <aside className="h-card mv-panel" aria-label="Partner" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <header className="mv-ph">
        <div>
          <h2>{row ? row.name : 'Loading'}</h2>
          {row ? <span className="mv-sub">{[row.place, row.ownerNames.join(', ')].filter(Boolean).join(' · ')}</span> : null}
        </div>
        <button type="button" ref={closeRef} className="mv-x" onClick={onClose} aria-label="Close">&times;</button>
      </header>
      {q.isError ? <p className="mv-note">{(q.error as Error).message}</p> : null}
      {!row || !q.data ? <div className="r2t-skel" style={{ height: 240, margin: 16 }} aria-hidden="true" /> : (
        <div className="mv-pb">
          <dl className="mv-facts">
            <div><dt>Open asks</dt><dd>{row.asked ? `${money0(row.asked)} (${row.asks})` : 'None'}</dd></div>
            <div><dt>Given in all</dt><dd>{q.data.giving ? money0(q.data.giving.lifetime) : money0(row.lifetime)}</dd></div>
            <div><dt>Largest gift</dt><dd>{q.data.giving && q.data.giving.largest ? `${money0(q.data.giving.largest.amount)}, ${day(q.data.giving.largest.date)}` : 'None'}</dd></div>
            <div><dt>Last gift</dt><dd>{q.data.giving && q.data.giving.last ? `${money0(q.data.giving.last.amount)}, ${day(q.data.giving.last.date)}` : 'None'}</dd></div>
            <div><dt>Last contact</dt><dd>{row.lastContact ? day(row.lastContact) : 'None on file'}</dd></div>
            <div><dt>Closing</dt><dd>{row.closeDate ? day(row.closeDate) : 'No close date'}</dd></div>
          </dl>
          <h3 className="mv-h">Stage</h3>
          <div className="mv-stages" role="group" aria-label="Stage">
            {q.data.stages.map((s) => (
              <button key={s.id} type="button" aria-pressed={row.stage === s.id} disabled={row.stage === s.id} onClick={() => onMove({ cid, from: row.stage, to: s.id, name: row.name })}>
                {s.label}
              </button>
            ))}
          </div>
          {row.stage === 'pool' ? <p className="mv-note">Not staged yet. Pick a stage to put this partner on the board.</p> : null}
          <h3 className="mv-h">Next step</h3>
          <form
            className="mv-form"
            onSubmit={(e) => {
              e.preventDefault();
              setMsg('');
              if (row.stage === 'pool') return setMsg('Pick a stage first.');
              save.mutate();
            }}
          >
            <label>What happens next<input value={step} maxLength={200} onChange={(e) => setStep(e.target.value)} placeholder="Call about the matching gift" /></label>
            <label>Due<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <div className="mv-add-act">
              <button type="submit" className="h-btn h-btn--primary" disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save next step'}</button>
              {msg ? <span role="status">{msg}</span> : null}
            </div>
          </form>
          {q.data.asks.length ? (
            <>
              <h3 className="mv-h">Asks</h3>
              <ul className="mv-asks">
                {q.data.asks.map((a) => (
                  <li key={a.id}><b>{money0(a.amount)}</b> <span>{day(a.date)}{a.closeDate ? `, closes ${day(a.closeDate)}` : ''}</span><p>{a.line}</p></li>
                ))}
              </ul>
            </>
          ) : null}
          {q.data.audit.length ? (
            <>
              <h3 className="mv-h">History</h3>
              <ul className="mv-hist">
                {q.data.audit.map((a, i) => (
                  <li key={i}><span>{day(a.at.slice(0, 10))}</span> {a.actor}: {a.kind === 'move' ? `moved to ${q.data!.stages.find((s) => s.id === a.to_stage)?.label || a.to_stage}` : a.kind === 'next_step' ? `next step ${a.detail}` : a.detail}</li>
                ))}
              </ul>
            </>
          ) : null}
          <RelationshipMap id={row.cid} compact />
          <p className="mv-foot-link"><NavLink href={'/work/partner/' + row.cid}>Open the full record</NavLink></p>
        </div>
      )}
    </aside>
  );
}

/* ---------------------------------------------------------------- stage editor */

function StageEditor({ data, onClose }: { data: Board; onClose: () => void }) {
  const qc = useQueryClient();
  const [list, setList] = useState(() => data.stageDefs.filter((s) => s.active === 1).map((s) => ({ id: s.id as string | undefined, label: s.label, role: s.role })));
  const [msg, setMsg] = useState('');
  const save = useMutation({
    mutationFn: async () => await send('/api/moves/stages', { stages: list }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mvKeys.all });
      onClose();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const swap = (i: number, j: number) => setList((l) => { const c = l.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; });
  const askAt = Math.max(0, list.findIndex((s) => s.role === 'ask'));
  return (
    <div className="mv-modal" role="dialog" aria-modal="true" aria-label="Edit stages" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="h-card mv-dialog">
        <h2>Stages</h2>
        <ol className="mv-stage-list">
          {list.map((s, i) => (
            <li key={s.id || 'n' + i}>
              <input value={s.label} maxLength={30} aria-label={`Stage ${i + 1} name`} onChange={(e) => setList((l) => l.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
              <label className="mv-radio"><input type="radio" name="askstage" checked={askAt === i} onChange={() => setList((l) => l.map((x, k) => ({ ...x, role: k === i ? 'ask' : '' })))} /> Open asks land here</label>
              <button type="button" onClick={() => swap(i, i - 1)} disabled={i === 0} aria-label="Move up">&uarr;</button>
              <button type="button" onClick={() => swap(i, i + 1)} disabled={i === list.length - 1} aria-label="Move down">&darr;</button>
              <button type="button" onClick={() => setList((l) => l.filter((_, k) => k !== i))} disabled={list.length <= 2} aria-label={`Remove ${s.label}`}>Remove</button>
            </li>
          ))}
        </ol>
        <button type="button" className="mv-link" disabled={list.length >= 10} onClick={() => setList((l) => [...l, { id: undefined, label: '', role: '' }])}>Add a stage</button>
        <p className="mv-note">A stage with partners in it cannot be removed. Move them first.</p>
        <div className="mv-add-act">
          <button type="button" className="h-btn h-btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving' : 'Save stages'}</button>
          <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>Cancel</button>
          {msg ? <span role="alert">{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- add a partner who is not on the board */

function AddPartner({ stages, onAdded }: { stages: { id: string; label: string }[]; onAdded: (cid: string) => void }) {
  const qc = useQueryClient();
  const [find, setFind] = useState('');
  const [hits, setHits] = useState<{ cid: string; name: string; place: string }[]>([]);
  const [pick, setPick] = useState<{ cid: string; name: string } | null>(null);
  const [stage, setStage] = useState(stages[0] ? stages[0].id : '');
  const [msg, setMsg] = useState('');
  const look = async (v: string) => {
    setFind(v);
    setPick(null);
    if (v.trim().length < 2) return setHits([]);
    try {
      const r = (await hubGet('/api/work/partners?q=' + encodeURIComponent(v.trim()))) as { rows: { cid: string; name: string; place: string }[] };
      setHits(r.rows.slice(0, 6));
    } catch {
      setHits([]);
    }
  };
  const add = useMutation({
    mutationFn: async () => await send('/api/moves/card', { cid: pick!.cid, stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mvKeys.all });
      onAdded(pick!.cid);
    },
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <form className="h-card mv-addp" onSubmit={(e) => { e.preventDefault(); if (pick && stage) add.mutate(); }}>
      <label>
        Partner
        <input type="search" value={pick ? pick.name : find} onChange={(e) => void look(e.target.value)} placeholder="Name, email or phone" autoComplete="off" />
      </label>
      <label>
        Stage
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="h-btn h-btn--primary" disabled={!pick || add.isPending}>{add.isPending ? 'Adding' : 'Add to the board'}</button>
      {msg ? <span role="alert" className="mv-note">{msg}</span> : null}
      {!pick && hits.length ? (
        <ul className="mv-hits">
          {hits.map((h) => (
            <li key={h.cid}><button type="button" onClick={() => { setPick(h); setHits([]); }}><b>{h.name}</b> <span>{h.place}</span></button></li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
