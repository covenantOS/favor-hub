// The To clean up and Sent to Blackbaud tabs (port of the cleanup and activity views in public/js/foundations.js). The lists are DataTables
// with the classic paging keys: fnd-moves, fnd-thin, fnd-waiting and fnd-log.
import { Suspense, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { DataTable, Pager, usePageSize, pageOf, clampPage, type Column } from '../../../ui/table';
import { Boundary } from '../record/Boundary';
import { activityQuery, cleanupQuery, fApi, fKeys, healthQuery, listQuery } from './api';
import { toast } from './toast';
import { day, plural, stamp } from './util';

const Empty = ({ text }: { text: string }) => (
  <div className="make-sheet fnd-sheet">
    <p className="req-empty">{text}</p>
  </div>
);
function Failed({ e, retry }: { e: Error; retry: () => void }) {
  const qc = useQueryClient();
  return (
    <div className="make-sheet fnd-sheet">
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
  );
}

/** One DataTable with its own page and size. */
function Paged<T>({ listKey, rows, columns, rowKey, noun, size0, onOpen, rowClassName, className, label }: { listKey: string; rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; noun: string; size0: number; onOpen?: (r: T) => void; rowClassName?: (r: T) => string; className: string; label: string }) {
  const [size, setSize] = usePageSize(listKey, size0);
  const [page, setPage] = useState(1);
  const cur = clampPage(page, rows.length, size);
  return (
    <>
      <DataTable<T> listKey={listKey} label={label} columns={columns} rows={pageOf(rows, cur, size)} rowKey={rowKey} onOpen={onOpen} rowClassName={rowClassName} className={className} wrapClassName="ptl-wrap" noFit />
      <Pager listKey={listKey} total={rows.length} page={cur} size={size} onPage={(p, s) => (s !== size ? (setSize(s), setPage(1)) : setPage(p))} />
    </>
  );
}

/* ------------------------------------------------------------------ To clean up */
function CleanupBody({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useSuspenseQuery(cleanupQuery);
  const M: any[] = data.misplaced;
  const T: any[] = data.thin;
  const groups: any[] = [];
  M.forEach((r) => {
    let g = groups.find((x) => x.id === r.id);
    if (!g) groups.push((g = { id: r.id, name: r.name, lookup: r.bb_lookup_id, bbName: r.bb_name, why: r.bb_match_reason, rows: [] as any[] }));
    g.rows.push(r);
  });
  const moveCols: Column<any>[] = [
    { key: 'f', label: 'Foundation', fixed: true, className: 'c-who', cell: (g) => <span className="pt-name fnd-name" data-pt-open="" title={g.name}>{g.name}</span> },
    {
      key: 'rec',
      label: 'Its Blackbaud record',
      fixed: true,
      className: 'c-record',
      cell: (g) => (
        <>
          <b>#{g.lookup}</b> <span className="pt-sub">{g.why || ''}</span>
        </>
      ),
    },
    {
      key: 'moves',
      label: 'Contacts to move',
      fixed: true,
      className: 'c-moves is-clip',
      title: (g) => g.rows.map((r: any) => `${r.category} · ${r.rdd_name} ${day(r.contact_date)}`).join('\n'),
      cell: (g) => (
        <>
          <span className="pt-badge">{g.rows.length.toLocaleString('en-US')}</span> <span className="pt-sub">{g.rows.map((r: any) => `${r.category} · ${r.rdd_name} ${day(r.contact_date)}`).join('; ')}</span>
        </>
      ),
    },
  ];
  const thinCols: Column<any>[] = [
    {
      key: 'rec',
      label: 'Record',
      fixed: true,
      className: 'c-who',
      cell: (t) => (
        <div className="ptl-who">
          <span className="pt-name fnd-name" title={t.name}>{t.name}</span>
          <span className="pt-sub ptl-place">#{t.lookup_id}</span>
        </div>
      ),
    },
    { key: 'made', label: 'Made', fixed: true, className: 'c-last', cell: (t) => day(t.made) },
    { key: 'n', label: 'Contacts', fixed: true, num: true, cell: (t) => t.contacts },
    { key: 'last', label: 'Last contact', fixed: true, className: 'c-last', cell: (t) => day(t.last) },
  ];
  return (
    <>
      <div className="make-sheet fnd-sheet ptl-panel">
        <h2>Contacts on the wrong record</h2>
        <p className="fnd-note">
          {groups.length
            ? `${plural(groups.length, 'foundation')} on this list ${groups.length === 1 ? 'has its' : 'have their'} own Blackbaud record, and ${plural(M.length, 'contact')} that belong${M.length === 1 ? 's' : ''} there still ${M.length === 1 ? 'sits' : 'sit'} on Unsolicited Foundations. Moving them is not switched on yet. New contacts for these foundations already post to the right record.`
            : 'Every contact sits on the right record.'}
        </p>
        <div id="fnd-moves-host">
          {groups.length ? <Paged listKey="fnd-moves" rows={groups} columns={moveCols} rowKey={(g) => g.id} noun="foundations" size0={25} onOpen={(g) => onOpen(g.id)} rowClassName={() => 'ptl-row'} className="ptl-table ptl-moves" label="Contacts on the wrong record" /> : null}
        </div>
      </div>
      <div className="make-sheet fnd-sheet ptl-panel">
        <h2>Records made at a first call</h2>
        <p className="fnd-note">
          {data.offline
            ? 'Blackbaud could not be reached for this list. Try again in a minute.'
            : `${plural(T.length, 'foundation record')} created in Blackbaud since March hold${T.length === 1 ? 's' : ''} nothing but contacts from RDDs and grant writers: no gift, no grant request, no opportunity. ${T.filter((t) => t.contacts <= 2).length} of them have one or two contacts.`}
        </p>
        <div id="fnd-thin-host">
          {T.length ? <Paged listKey="fnd-thin" rows={T} columns={thinCols} rowKey={(t) => String(t.lookup_id)} noun="records" size0={25} rowClassName={() => 'ptl-row'} className="ptl-table ptl-thin" label="Records made at a first call" /> : null}
        </div>
      </div>
    </>
  );
}

export function Cleanup({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <Boundary fallback={(e, retry) => <Failed e={e} retry={retry} />}>
      <Suspense fallback={<Empty text="Loading" />}>
        <CleanupBody onOpen={onOpen} />
      </Suspense>
    </Boundary>
  );
}

/* ------------------------------------------------------------------ Sent to Blackbaud */
const KIND: Record<string, string | string[]> = {
  contact_logged: 'Contact logged',
  post_contact: ['Posted to Blackbaud', 'Did not post'],
  tag: ['Tag added in Blackbaud', 'Tag is waiting'],
  delete_contact: ['Removed from Blackbaud', 'Could not remove from Blackbaud'],
  contact_removed: 'Contact removed',
  dead_end: 'Marked a dead end',
  reopened: 'Reopened',
  linked: 'Tied to a Blackbaud record',
  unlinked: 'Untied from a Blackbaud record',
  added: 'Foundation added',
  setting: 'Setting changed',
  imported: 'Brought in from Blackbaud',
};

function ActivityBody() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(activityQuery);
  const list = useQuery(listQuery);
  const health = useQuery(healthQuery);
  const meta = list.data;
  const on = meta?.settings?.posting === 'on';
  const [form, setForm] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const W: any[] = data.waiting;
  const L: any[] = data.log;
  const next = on ? 'off' : 'on';
  const h = health.data;
  const healthText = h ? (h.blackbaud ? 'Blackbaud connection is up' : 'Blackbaud connection is down, contacts will wait') + (h.mirror ? '' : ' · Blackbaud search is down') + (h.tags === 'waiting' ? ' · Tags are saved here and wait for one change to the connection' : '') : 'Checking the Blackbaud connection';
  const waitCols: Column<any>[] = [
    { key: 'f', label: 'Foundation', fixed: true, className: 'c-who', cell: (w) => <span className="pt-name fnd-name" title={w.foundation}>{w.foundation}</span> },
    { key: 'how', label: 'How', fixed: true, cell: (w) => w.how },
    { key: 'rdd', label: 'Fundraiser', fixed: true, cell: (w) => w.rdd_name },
    { key: 'date', label: 'Date', fixed: true, className: 'c-last', cell: (w) => day(w.contact_date) },
    {
      key: 'state',
      label: 'State',
      fixed: true,
      className: 'is-clip',
      title: (w) => (w.bb_state === 'posted' ? 'Posted. Its tags are waiting.' : w.bb_error || 'Waiting'),
      cell: (w) => <span className="pt-sub">{w.bb_state === 'posted' ? 'Posted. Its tags are waiting.' : w.bb_error || 'Waiting'}</span>,
    },
  ];
  const label = (l: any) => {
    const k = KIND[l.kind];
    return Array.isArray(k) ? (l.ok ? k[0] : k[1]) : k || l.kind;
  };
  const more = (l: any) => [l.foundation, l.detail].filter(Boolean).join(' · ');
  const logCols: Column<any>[] = [
    { key: 'when', label: 'When', fixed: true, className: 'c-last', cell: (l) => stamp(l.created_at) },
    {
      key: 'what',
      label: 'What happened',
      fixed: true,
      className: 'c-what',
      cell: (l) => (
        <>
          {l.method ? (
            <>
              <span className={'fnd-verb ' + (l.ok ? 'ok' : 'no')}>{l.method}</span>{' '}
            </>
          ) : null}
          <b>{label(l)}</b>
        </>
      ),
    },
    { key: 'more', label: 'Foundation and detail', fixed: true, className: 'c-more is-clip', title: more, cell: (l) => <span className="pt-sub">{more(l)}</span> },
    { key: 'by', label: 'By', fixed: true, className: 'c-by', cell: (l) => l.actor || 'staff' },
  ];
  return (
    <div className="make-sheet fnd-sheet ptl-panel">
      <h2>Sent to Blackbaud</h2>
      <div className={'fnd-state ' + (on ? '' : 'is-off')}>
        <span className="dot" />
        <span>{on ? 'Posting is on. Each contact logged here goes to Blackbaud right away.' : 'Posting is off. Contacts are saved here and wait.'}</span>
        <button type="button" className="fnd-textbtn is-quiet" id="fnd-switch" onClick={() => setForm(true)}>
          {on ? 'Switch off' : 'Switch on'}
        </button>
      </div>
      <div id="fnd-switch-slot">
        {form ? (
          <form
            className="board-login"
            id="fnd-switch-form"
            style={{ boxShadow: 'none' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const pw = (e.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
              try {
                await fApi('/api/foundations/settings', { method: 'POST', body: { password: pw, posting: next } });
                await qc.invalidateQueries({ queryKey: fKeys.list });
                await qc.invalidateQueries({ queryKey: fKeys.activity });
                setForm(false);
                toast('Posting is ' + next + '.');
              } catch (err) {
                setMsg((err as Error).message);
              }
            }}
          >
            <p>The board password switches posting {next}.</p>
            <div className="board-login__row">
              <input type="password" name="password" placeholder="Board password" autoComplete="off" autoFocus />
              <button type="submit" className="req-admin-btn">
                Switch {next}
              </button>
            </div>
            <p className="req-msg" aria-live="polite">
              {msg}
            </p>
          </form>
        ) : null}
      </div>
      <p className="fnd-check__hint" id="fnd-health" style={{ margin: '-8px 0 14px 2px' }}>
        {healthText}
      </p>
      <div id="fnd-wait-host">
        {W.length ? (
          <>
            <span className="exp-legend">Waiting to post</span>
            <Paged listKey="fnd-waiting" rows={W} columns={waitCols} rowKey={(w) => String(w.id ?? w.foundation + w.contact_date + w.how + w.rdd_name)} noun="contacts" size0={25} rowClassName={() => 'ptl-row'} className="ptl-table ptl-wait" label="Waiting to post" />
            <p style={{ margin: '12px 0 14px' }}>
              <button
                type="button"
                className="req-admin-btn"
                id="fnd-retry"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await fApi('/api/foundations/activity', { method: 'POST' });
                    await qc.invalidateQueries({ queryKey: fKeys.list });
                    await qc.invalidateQueries({ queryKey: fKeys.activity });
                    toast('Tried again.');
                  } catch (err) {
                    toast((err as Error).message);
                  }
                  setBusy(false);
                }}
              >
                Try them again now
              </button>
            </p>
          </>
        ) : null}
      </div>
      <span className="exp-legend">Everything this page has done</span>
      <div id="fnd-log-host">
        {L.length ? (
          <Paged listKey="fnd-log" rows={L} columns={logCols} rowKey={(l) => String(l.id ?? l.created_at + l.kind + (l.detail || ''))} noun="entries" size0={50} rowClassName={() => 'ptl-row'} className="ptl-table ptl-log" label="Everything this page has done" />
        ) : (
          <div className="pt-empty">Nothing yet. The first contact logged here shows up in this list.</div>
        )}
      </div>
    </div>
  );
}

export function Activity() {
  return (
    <Boundary fallback={(e, retry) => <Failed e={e} retry={retry} />}>
      <Suspense fallback={<Empty text="Loading" />}>
        <ActivityBody />
      </Suspense>
    </Boundary>
  );
}
