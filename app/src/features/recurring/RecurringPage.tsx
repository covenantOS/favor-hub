import './recurring.css';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send, ApiError } from '@/lib/api';
import { ago, count, money0 } from '@/lib/format';
import { hubOv } from '@/lib/hubOv';
import { EntityChip } from '@/features/entity/EntityChip';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { recurringEditResponse, recurringResponse, type RecurringResponse, type RecurringRow } from '@shared/schemas';
import { ROWS_CHOICES, amount, chipCounts, methodLine, monthsTitle, pageCount, pageList, parseAmount, shortDate, statusWord, visibleRows, type FilterId } from './logic';

export const RECURRING_KEY = ['recurring'] as const;

function useRecurring() {
  return useQuery({ queryKey: RECURRING_KEY, queryFn: () => api('/api/work/recurring', recurringResponse), staleTime: 20_000, refetchOnWindowFocus: true });
}

const Dots = ({ months, today }: { months: boolean[]; today: string }) => (
  <span className="rg-dots" title={monthsTitle(months, today)} role="img" aria-label={monthsTitle(months, today)}>
    {months.map((p, i) => (
      <i key={i} className={p ? 'is-paid' : ''} />
    ))}
  </span>
);

function Stat({ k, v, sub, link }: { k: string; v: string; sub?: string; link?: { href: string; text: string } }) {
  return (
    <div className="rg-stat">
      <span className="rg-stat__k">{k}</span>
      <b className="rg-stat__v">{v}</b>
      {link ? (
        <NavLink className="rg-stat__a" href={link.href}>
          {link.text}
        </NavLink>
      ) : (
        <span className="rg-stat__s">{sub}</span>
      )}
    </div>
  );
}

function Stats({ d }: { d: RecurringResponse }) {
  const s = d.stats;
  const since = new Date(Date.parse(d.today + 'T12:00:00Z') - 30 * 86400000).toISOString().slice(0, 10);
  return (
    <section className="h-card rg-stats" aria-label="Recurring gift numbers">
      <Stat k="Active schedules" v={count(s.active)} sub={`${count(s.card)} by card, ${count(s.bank)} by bank draft`} />
      <Stat k="Scheduled each cycle" v={money0(s.scheduledEach)} sub={`${count(s.payments12)} payments in the last 12 months`} />
      <Stat k="Paid in the last 30 days" v={count(s.paid30Schedules)} sub={`${money0(s.paid30Amount)} from schedules with a payment since ${shortDate(since, d.today)}`} />
      <Stat k="Declined since July" v={count(s.declined)} link={{ href: '/gifts/declines/', text: 'Work the declines' }} />
      <Stat k="Stopped in 90 days" v={count(s.stopped90)} sub="Win-back calls for Partner Care" />
    </section>
  );
}

function Attention({ d, onPick }: { d: RecurringResponse; onPick: (f: FilterId) => void }) {
  const { pastDue, pastEnd } = d.stats;
  if (!pastDue && !pastEnd) return null;
  return (
    <div className="rg-attn" role="status">
      {pastDue > 0 && (
        <button type="button" onClick={() => onPick('pastdue')}>
          {pastDue} active {pastDue === 1 ? 'schedule has' : 'schedules have'} a next charge date in the past
        </button>
      )}
      {pastEnd > 0 && (
        <button type="button" onClick={() => onPick('pastend')}>
          {pastEnd} {pastEnd === 1 ? 'schedule is' : 'schedules are'} still active past the end date
        </button>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="rg-skel" key={i} />
      ))}
    </div>
  );
}

function Panel({ row, d, onClose }: { row: RecurringRow; d: RecurringResponse; onClose: () => void }) {
  const qc = useQueryClient();
  const open = row.status === 'Active' || /held/i.test(row.status);
  const [amt, setAmt] = useState('');
  const [freq, setFreq] = useState(row.frequency.toUpperCase());
  const [asked, setAsked] = useState('Phone call');
  const [note, setNote] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const st = statusWord(row, d.today);
  const newAmount = parseAmount(amt);

  const change = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const out = await api('/api/work/recurring/edit', recurringEditResponse, { method: 'POST', body: { giftId: row.id, askedBy: asked, note, req: 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), ...body } });
      // The record note is saved as a batch; send it now so it shows on the partner right away.
      if (out.batch && out.batch.id) await send('/api/work/batches/' + encodeURIComponent(out.batch.id) + '/run').catch(() => undefined);
      return out;
    },
    onSuccess: async (out) => {
      setMsg({ tone: 'ok', text: (out.summary || 'Saved') + '. Blackbaud read it back.' });
      setAmt('');
      setNote('');
      setConfirmStop(false);
      await qc.invalidateQueries({ queryKey: RECURRING_KEY });
    },
    onError: (e) => setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Something went wrong. Try again.' }),
  });
  const undo = useMutation({
    mutationFn: (id: string) => api('/api/work/recurring/undo', recurringEditResponse, { method: 'POST', body: { id, req: 'ru' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) } }),
    onSuccess: async (out) => {
      setMsg({ tone: 'ok', text: (out.summary || 'Undone') + '.' });
      await qc.invalidateQueries({ queryKey: RECURRING_KEY });
    },
    onError: (e) => setMsg({ tone: 'bad', text: e instanceof ApiError ? e.message : 'Something went wrong. Try again.' }),
  });
  const busy = change.isPending || undo.isPending;
  const held = /held/i.test(row.status);

  useEffect(() => {
    const tok = hubOv.on(onClose);
    return () => hubOv.off(tok);
  }, [onClose]);

  return (
    <aside className="h-card rg-panel" aria-label={'Schedule for ' + row.name}>
      <div className="rg-panel__hd">
        <h2>
          <EntityChip kind="partner" id={row.cid} label={row.name} />
        </h2>
        <span className={'rg-pill is-' + st.tone}>{st.text}</span>
        <button type="button" className="rg-x" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <dl className="rg-facts">
        <dt>Amount</dt>
        <dd>{methodLine(row)}</dd>
        {row.fund && (
          <>
            <dt>Fund</dt>
            <dd>{row.fund}</dd>
          </>
        )}
        {row.start && (
          <>
            <dt>Started</dt>
            <dd>{shortDate(row.start, d.today)}</dd>
          </>
        )}
        {row.status === 'Active' && row.next && (
          <>
            <dt>Next charge</dt>
            <dd className={row.flags.pastDue ? 'is-bad' : ''}>{shortDate(row.next, d.today)}</dd>
          </>
        )}
        {row.end && (
          <>
            <dt>Ends</dt>
            <dd className={row.flags.pastEnd ? 'is-bad' : ''}>{shortDate(row.end, d.today)}</dd>
          </>
        )}
        <dt>Payments, 12 months</dt>
        <dd>{row.paid12}</dd>
        <dt>Paid in all</dt>
        <dd>{row.paid}</dd>
        <dt>Last paid</dt>
        <dd>{shortDate(row.lastPaid, d.today) || 'Never'}</dd>
        {row.holder && (
          <>
            <dt>Held by</dt>
            <dd>{row.holder}</dd>
          </>
        )}
        {row.flags.declined && (
          <>
            <dt>Declined</dt>
            <dd className={row.declineRecovered ? '' : 'is-bad'}>
              {shortDate(row.declinedOn, d.today)}
              {row.declines > 1 ? `, ${row.declines} times since July` : ''}
              {row.declineReason ? '. ' + row.declineReason : ''}
              {row.declineRecovered ? ' A later payment went through.' : ''}
            </dd>
          </>
        )}
      </dl>
      <Dots months={row.months} today={d.today} />

      {!d.canEdit && <p className="rg-note">This test account can read schedules. It cannot change them.</p>}
      {d.canEdit && open && (
        <form
          className="rg-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (newAmount == null) return setMsg({ tone: 'bad', text: 'Enter an amount between $1 and $250,000.' });
            setMsg(null);
            change.mutate({ op: 'amount', amount: newAmount });
          }}
        >
          <label className="rg-lab" htmlFor="rg-amt">
            Change the amount
          </label>
          <div className="rg-pair">
            <input className="rg-in" value={amount(row.amount)} readOnly aria-label="Current amount" tabIndex={-1} />
            <input id="rg-amt" className="rg-in" inputMode="decimal" placeholder="New amount" value={amt} onChange={(e) => setAmt(e.target.value)} disabled={busy} autoComplete="off" />
          </div>
          <div className="rg-pair">
            <div>
              <label className="rg-lab" htmlFor="rg-freq">
                How often
              </label>
              <select id="rg-freq" className="rg-in" value={freq} onChange={(e) => setFreq(e.target.value)} disabled={busy}>
                {d.frequencies.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label[0].toUpperCase() + f.label.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="rg-lab" htmlFor="rg-asked">
                Partner asked by
              </label>
              <select id="rg-asked" className="rg-in" value={asked} onChange={(e) => setAsked(e.target.value)} disabled={busy}>
                {d.askedBy.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="rg-lab" htmlFor="rg-note">
            Note for the record
          </label>
          <input id="rg-note" className="rg-in" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Optional" />
          <p className="rg-note">The change is saved in Blackbaud, read back and shown here. Undo is open for 24 hours. An action goes on the partner&apos;s record.</p>
          <div className="rg-btns">
            <button type="submit" className="h-btn h-btn--primary h-btn--sm" disabled={busy || newAmount == null || newAmount === row.amount}>
              {change.isPending ? 'Saving' : 'Save the new amount'}
            </button>
            <button
              type="button"
              className="h-btn h-btn--sm"
              disabled={busy || freq === row.frequency.toUpperCase()}
              onClick={() => {
                setMsg(null);
                change.mutate({ op: 'frequency', frequency: freq });
              }}
            >
              Save how often
            </button>
          </div>
          <div className="rg-btns">
            <button
              type="button"
              className="h-btn h-btn--sm"
              disabled={busy}
              onClick={() => {
                setMsg(null);
                change.mutate({ op: 'status', status: held ? 'Active' : 'Held' });
              }}
            >
              {held ? 'Resume the schedule' : 'Hold the schedule'}
            </button>
            {!confirmStop ? (
              <button type="button" className="h-btn h-btn--sm rg-danger" disabled={busy} onClick={() => setConfirmStop(true)}>
                Stop the schedule
              </button>
            ) : (
              <span className="rg-confirm" role="alertdialog" aria-label="Confirm stop">
                <span>Stopping is final. Blackbaud does not restart a stopped schedule.</span>
                <button
                  type="button"
                  className="h-btn h-btn--sm rg-danger"
                  disabled={busy}
                  onClick={() => {
                    setMsg(null);
                    change.mutate({ op: 'status', status: 'Terminated' });
                  }}
                >
                  Stop it
                </button>
                <button type="button" className="h-btn h-btn--sm" onClick={() => setConfirmStop(false)}>
                  Keep it
                </button>
              </span>
            )}
          </div>
        </form>
      )}
      {d.canEdit && !open && <p className="rg-note">A stopped schedule cannot be changed. Set up a new one in Blackbaud if the partner restarts.</p>}
      {msg && (
        <p className={'rg-msg is-' + msg.tone} role={msg.tone === 'bad' ? 'alert' : 'status'}>
          {msg.text}
        </p>
      )}
      {row.changes.length > 0 && (
        <div className="rg-log">
          <h3>Changes made in FavorOS</h3>
          <ul>
            {row.changes.slice(0, 6).map((c) => (
              <li key={c.id} className={c.state === 'done' ? '' : 'is-off'}>
                <span>{c.summary}</span>
                <small>
                  {c.by || 'Someone'}, {ago(c.at)}
                  {c.askedBy ? `, asked by ${c.askedBy.toLowerCase()}` : ''}
                  {c.state === 'undone' ? ', undone' : ''}
                </small>
                {c.undoable && d.canEdit && (
                  <button type="button" className="rg-undo" disabled={busy} onClick={() => undo.mutate(c.id)}>
                    Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function Schedules({ d }: { d: RecurringResponse }) {
  const [filter, setFilter] = useState<FilterId>('active');
  const [search, setSearch] = useState('');
  const [size, setSize] = useState(ROWS_CHOICES[0]);
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const chips = useMemo(() => chipCounts(d.rows), [d.rows]);
  const rows = useMemo(() => visibleRows(d.rows, filter, search), [d.rows, filter, search]);
  const pages = pageCount(rows.length, size);
  const at = Math.min(page, pages);
  const shown = rows.slice((at - 1) * size, at * size);
  const picked = sel ? d.rows.find((r) => r.id === sel) || null : null;
  const pick = (f: FilterId) => {
    setFilter(f);
    setPage(1);
    setSel(null);
  };

  return (
    <div className={'rg-main' + (picked ? ' has-panel' : '')}>
      <section className="h-card rg-list" aria-label="Schedules">
        <div className="rg-list__hd">
          <h2>Schedules</h2>
          <span>Declines first, then largest</span>
        </div>
        <div className="rg-chips" role="group" aria-label="Filter schedules">
          {chips.map((c) => (
            <button key={c.id} type="button" className={'rg-chip' + (filter === c.id ? ' is-on' : '')} aria-pressed={filter === c.id} onClick={() => pick(c.id)}>
              {c.label} <b>{count(chips.counts[c.id])}</b>
            </button>
          ))}
          <input
            className="rg-find"
            type="search"
            placeholder="Find a partner"
            aria-label="Find a partner"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Attention d={d} onPick={pick} />
        <div className="rg-table" role="table" aria-label="Recurring gift schedules">
          <div className="rg-tr rg-th" role="row">
            <span role="columnheader">Partner</span>
            <span role="columnheader" className="r">
              Amount
            </span>
            <span role="columnheader">Method</span>
            <span role="columnheader">Last 12 months</span>
            <span role="columnheader">Last paid</span>
            <span role="columnheader" className="r">
              Paid
            </span>
            <span role="columnheader">Held by</span>
            <span role="columnheader">Status</span>
          </div>
          {shown.map((r) => {
            const st = statusWord(r, d.today);
            return (
              <div
                key={r.id}
                role="row"
                tabIndex={0}
                className={'rg-tr' + (sel === r.id ? ' is-sel' : '')}
                onClick={() => setSel(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSel(r.id);
                  }
                }}
              >
                <span role="cell" className="rg-name" onClick={(e) => e.stopPropagation()}>
                  <EntityChip kind="partner" id={r.cid} label={r.name} />
                </span>
                <span role="cell" className="r rg-amt">
                  {amount(r.amount)}
                  {r.frequencyLabel && r.frequency !== 'MONTHLY' ? <small> {r.frequencyLabel}</small> : null}
                </span>
                <span role="cell">
                  <i className="rg-tag">{r.method || 'Payment'}</i>
                </span>
                <span role="cell">
                  <Dots months={r.months} today={d.today} />
                </span>
                <span role="cell">{shortDate(r.lastPaid, d.today) || 'None'}</span>
                <span role="cell" className="r">
                  {r.paid}
                </span>
                <span role="cell" className="rg-holder">
                  {r.holder}
                </span>
                <span role="cell">
                  <i className={'rg-pill is-' + st.tone}>{st.text}</i>
                </span>
              </div>
            );
          })}
          {!shown.length && <p className="rg-empty">No schedules match.</p>}
        </div>
        <div className="rg-foot">
          <span>{rows.length ? `${count((at - 1) * size + 1)} to ${count(Math.min(at * size, rows.length))} of ${count(rows.length)}` : '0 schedules'}</span>
          <nav className="rg-pager" aria-label="Pages">
            <button type="button" disabled={at <= 1} onClick={() => setPage(at - 1)} aria-label="Previous page">
              &lt;
            </button>
            {pageList(at, pages).map((n, i) =>
              n === 0 ? (
                <span key={'g' + i}>...</span>
              ) : (
                <button key={n} type="button" className={n === at ? 'is-on' : ''} aria-current={n === at ? 'page' : undefined} onClick={() => setPage(n)}>
                  {n}
                </button>
              )
            )}
            <button type="button" disabled={at >= pages} onClick={() => setPage(at + 1)} aria-label="Next page">
              &gt;
            </button>
          </nav>
          <label className="rg-size">
            Rows
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {ROWS_CHOICES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {picked && (
        <ErrorBoundary label="Schedule" className="h-card">
          <Panel key={picked.id + ':' + picked.changes.length} row={picked} d={d} onClose={() => setSel(null)} />
        </ErrorBoundary>
      )}
    </div>
  );
}

/** Gifts > Recurring: every recurring gift schedule with the numbers over it, and the changes staff make to a schedule. */
export function RecurringPage() {
  const q = useRecurring();
  const d = q.data;
  return (
    <div className="rg">
      <ErrorBoundary label="Recurring numbers" className="h-card">
        {d ? (
          <>
            <Stats d={d} />
            {d.synced && <p className="rg-sync">Blackbaud copy read {ago(d.synced)}. Changes made here show at once.</p>}
          </>
        ) : q.isError ? null : (
          <div className="h-card rg-stats rg-stats--wait" aria-busy="true" />
        )}
      </ErrorBoundary>
      <ErrorBoundary label="Schedules" className="h-card">
        {d ? (
          <Schedules d={d} />
        ) : q.isError ? (
          <section className="h-card rg-list" role="alert">
            <p className="rg-empty">{q.error instanceof ApiError ? q.error.message : 'Recurring gifts did not load.'}</p>
            <button type="button" className="h-btn h-btn--sm" onClick={() => void q.refetch()}>
              Try again
            </button>
          </section>
        ) : (
          <section className="h-card rg-list">
            <SkeletonList />
          </section>
        )}
      </ErrorBoundary>
    </div>
  );
}
