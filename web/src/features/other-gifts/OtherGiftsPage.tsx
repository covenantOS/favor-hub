// Gifts > Other gifts. The left side lists gifts outside the mail deposit (the last 30 days, from Blackbaud and from the batches waiting here);
// the right side adds a gift into the person's batch or works a batch. Nothing writes to Blackbaud until a second person approves a batch.
import { useMemo, useState } from 'react';
import type { OgGift, OgListRow } from '@shared/schemas';
import { EntityChip } from '@/features/entity/EntityChip';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { money0, money2 } from '@/lib/format';
import { useOgIndex, useOgList } from './data';
import { AddGift } from './AddGift';
import { BatchesPanel } from './Batches';
import './styles.css';

const mon = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dollars = (cents: number) => money0(cents / 100);

const CHECK_LABEL: Record<string, string> = { draft: 'Entering', waiting: 'Waiting', posting: 'Posting', approved: 'Approved', needs_person: 'Needs a person' };
const LETTER_LABEL: Record<string, string> = { attached: 'Attached', pending: 'On approval', failed: 'Failed', needed: 'Needed', none: 'None', unknown: '' };

function Strip() {
  const q = useOgIndex();
  const s = q.data?.summary;
  const pct = s && s.year.lastYearCents ? Math.round((s.year.cents / s.year.lastYearCents) * 100) : null;
  return (
    <section className="h-card og-strip" aria-busy={q.isPending}>
      <div className="og-stat">
        <small>{s ? `${s.month.label} so far` : 'This month'}</small>
        <b>{s ? dollars(s.month.cents) : ' '}</b>
        <span>{s ? `${s.month.gifts} gifts. ${s.lastMonth.label}: ${dollars(s.lastMonth.cents)}, ${s.lastMonth.gifts} gifts` : ' '}</span>
      </div>
      <div className="og-stat">
        <small>Year to date</small>
        <b>{s ? dollars(s.year.cents) : ' '}</b>
        <span>{s ? `${s.year.gifts} gifts${pct !== null ? `. ${pct}% of last year to this date` : ''}` : ' '}</span>
      </div>
      <div className="og-stat">
        <small>Waiting for a second look</small>
        <b>{s ? s.waiting.gifts : ' '}</b>
        <span>{s ? (s.waiting.gifts ? `${dollars(s.waiting.cents)} in batches sent for approval` : 'No batch is waiting') : ' '}</span>
      </div>
      <div className="og-stat">
        <small>Letters to attach</small>
        <b>{s ? s.lettersToAttach : ' '}</b>
        <span>DAF, foundation and stock gifts entered here</span>
      </div>
      <div className="og-stat">
        <small>Soft credit given</small>
        <b>{s ? s.month.softGifts : ' '}</b>
        <span>{s ? `of ${s.month.gifts} ${s.month.label} gifts carry a soft credit` : ' '}</span>
      </div>
    </section>
  );
}

function Row({ r, onOpenBatch }: { r: OgListRow; onOpenBatch: (id: string) => void }) {
  const inHub = r.source === 'hub';
  return (
    <tr className={inHub && r.check !== 'approved' ? 'is-hub' : ''}>
      <td>{mon(r.date)}</td>
      <td className="og-from">
        {r.fromId ? <EntityChip kind="partner" id={r.fromId} label={r.fromName} /> : <i>{r.fromName}</i>}
      </td>
      <td>{r.recommendedId ? <EntityChip kind="partner" id={r.recommendedId} label={r.recommendedName} /> : <span className="og-dim">None</span>}</td>
      <td>
        <span className="og-pill">{r.kindLabel}</span>
      </td>
      <td className="og-fund" title={r.fund}>
        {r.fund || <span className="og-dim">Not set</span>}
      </td>
      <td className="og-num">{money2(r.amountCents / 100)}</td>
      <td>{r.letter === 'unknown' ? <span className="og-dim">None</span> : <span className={'og-tag og-tag--' + r.letter}>{LETTER_LABEL[r.letter]}</span>}</td>
      <td>
        {inHub && r.batchId ? (
          <button type="button" className={'og-tag og-tag--' + r.check + ' og-tagbtn'} onClick={() => onOpenBatch(r.batchId)} title={r.batchName}>
            {CHECK_LABEL[r.check]}
          </button>
        ) : (
          <span className="og-tag og-tag--approved">Approved</span>
        )}
      </td>
    </tr>
  );
}

function ListCard({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const [tab, setTab] = useState('all');
  const [term, setTerm] = useState('');
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(15);
  const q = useOgList(tab, term, page, size);
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  const from = d && d.total ? (page - 1) * size + 1 : 0;
  const to = d ? Math.min(page * size, d.total) : 0;
  const nums = useMemo(() => {
    const out: (number | '...')[] = [];
    for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p);
    return out.reduce<(number | '...')[]>((a, p, i) => (i && typeof p === 'number' && typeof out[i - 1] === 'number' && p - (out[i - 1] as number) > 1 ? [...a, '...', p] : [...a, p]), []);
  }, [pages, page]);

  return (
    <section className="h-card og-listcard">
      <div className="og-head">
        <h2>Gifts outside the mail deposit</h2>
        <span className="og-sub">DAF grants, foundation transfers, wires, stock and phone gifts, last 30 days</span>
      </div>
      <div className="og-tabs" role="tablist">
        {(d?.tabs || [{ id: 'all', label: 'All', count: 0 }]).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={'og-tab' + (tab === t.id ? ' is-on' : '')} onClick={() => { setTab(t.id); setPage(1); }}>
            {t.label} <span>{d ? t.count : ''}</span>
          </button>
        ))}
      </div>
      <form
        className="og-search"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(typed);
          setPage(1);
        }}
      >
        <input className="og-input" type="search" placeholder="Find a gift, partner or fund" aria-label="Find a gift, partner or fund" value={typed} onChange={(e) => { setTyped(e.target.value); if (!e.target.value) { setTerm(''); setPage(1); } }} />
      </form>
      <div className="og-scroll">
        <table className="og-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>Recommended by</th>
              <th>Type</th>
              <th>Fund</th>
              <th className="og-num">Amount</th>
              <th>Letter</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {d?.rows.map((r) => <Row key={r.source + r.id} r={r} onOpenBatch={onOpenBatch} />)}
            {q.isPending ? Array.from({ length: 8 }, (_, i) => <tr key={i} className="og-skelrow"><td colSpan={8}><i /></td></tr>) : null}
            {d && !d.rows.length ? <tr><td colSpan={8} className="og-none">No gifts match.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {q.isError ? <p className="og-err">{(q.error as Error).message}</p> : null}
      <div className="og-pager">
        <span>{d ? `${from} to ${to} of ${d.total}` : ''}</span>
        <nav aria-label="Pages">
          <button type="button" className="og-pg" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            &lsaquo;
          </button>
          {nums.map((p, i) => (p === '...' ? <span key={'e' + i}>...</span> : <button key={p} type="button" className={'og-pg' + (p === page ? ' is-on' : '')} onClick={() => setPage(p)}>{p}</button>))}
          <button type="button" className="og-pg" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
            &rsaquo;
          </button>
        </nav>
        <label className="og-rows">
          Rows
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}>
            {[15, 30, 50].map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

export function OtherGiftsPage() {
  const idx = useOgIndex();
  const [side, setSide] = useState<'add' | 'batches'>('add');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<OgGift | null>(null);

  if (idx.isError) return <section className="h-card" style={{ padding: 24 }}><p className="og-err">{(idx.error as Error).message}</p></section>;
  const index = idx.data;
  const mine = index?.batches.find((b) => b.mine && b.status === 'open');
  const waitingForMe = index ? index.batches.filter((b) => b.status === 'waiting' && !b.mine).length : 0;
  const openBatch = (id: string) => {
    setSelected(id);
    setSide('batches');
  };

  return (
    <div className="og" id="og-root">
      <ErrorBoundary label="The numbers could not load." className="h-card">
        <Strip />
      </ErrorBoundary>
      <div className="og-grid">
        <ErrorBoundary label="The gift list could not load." className="h-card">
          <ListCard onOpenBatch={openBatch} />
        </ErrorBoundary>
        <aside className="h-card og-side" aria-label="Add a gift or work a batch">
          <div className="og-sidetabs" role="tablist">
            <button type="button" role="tab" aria-selected={side === 'add'} className={side === 'add' ? 'is-on' : ''} onClick={() => setSide('add')}>
              {editing ? 'Change a gift' : 'Add a gift'}
            </button>
            <button type="button" role="tab" aria-selected={side === 'batches'} className={side === 'batches' ? 'is-on' : ''} onClick={() => setSide('batches')}>
              Batches{waitingForMe ? <span className="og-count">{waitingForMe}</span> : null}
            </button>
          </div>
          {!index ? (
            <div className="og-skel" aria-busy="true" />
          ) : side === 'add' ? (
            <ErrorBoundary label="The entry form could not load." className="h-card">
              <AddGift
                index={index}
                editing={editing}
                batchName={mine?.name || ''}
                onCancelEdit={() => setEditing(null)}
                onDone={(batchId, show) => {
                  if (show) {
                    setSelected(batchId);
                    setSide('batches');
                  }
                }}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="The batches could not load." className="h-card">
              <BatchesPanel
                rows={index.batches}
                me={index.me}
                selected={selected}
                onSelect={setSelected}
                onEdit={(g) => {
                  setEditing(g);
                  setSide('add');
                }}
              />
            </ErrorBoundary>
          )}
        </aside>
      </div>
    </div>
  );
}
