// Partners > /work/?view=grants (the grants team and the Support Team): the RESERVED (Grant ...) actions on foundations from the D1 copy of
// Blackbaud, by kind. The Log button records a request, LOI, report, task or cultivation step on a foundation and attaches the PDF to the
// action in the same batch (POST /api/work/grants/log, a form post); the batch is then sent with /api/work/batches/:id/run. A row's File
// button uses the action upload route. Ported from public/js/work-grants.js. Reads GET /api/work/grants (no Blackbaud calls).
import { useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { NavLink } from '@/shell/NavLink';
import { ColumnsMenu, DataTable, DensitySwitch, Pager, SearchBox, useHiddenColumns, useListKeys, usePageSize, pageOf, type Column, type Sort } from '../../../ui/table';
import '@hub/styles/pt-react-lists.css';
import type { WorkSearch } from './search';
import { Ic } from './lists/icons';
import { ListBoundary } from './lists/Boundary';
import { WcDialog } from './lists/Dlg';
import { WorkToast, driveBatch, failureOf, sentToast, showToast } from './lists/toast';
import { SheetsButton, sheetScreen, useSheetSource } from './lists/legacy';
import { PartnerFind } from './lists/PartnerFind';
import { partnerHref } from './lists/nav';
import { useFit } from './lists/fit';
import { dateWords, moneyExact, reqId, useHeld, workApi, workGet } from './lists/core';

// The WorkHeader (the page bar, the view chips) is built on branch pr-actions; render it here when ./WorkHeader exists.
// TODO: <WorkHeader view="grants" search={search} />

const KEY = 'grants';
interface GrantRow {
  id: string;
  cid: string;
  foundation: string;
  place: string;
  kind: string;
  kindLabel: string;
  category: string;
  date: string;
  open: boolean;
  summary: string;
  description: string;
  who: string[];
  file: string | null;
  award: { id: string; name: string; amount: number; date: string; status: string } | null;
  local?: boolean;
}
interface GrantsAnswer {
  today: string;
  rows: GrantRow[];
  stats: { open: number; requestsMonth: number; loisMonth: number; reportsMonth: number };
  kinds: { id: string; label: string }[];
  hows: { id: string; label: string }[];
}
const asOf = (s: WorkSearch) => (typeof s.as === 'string' ? s.as : '');
export const grantsQuery = (as?: string) => queryOptions({ queryKey: ['work', 'grants', as || ''], queryFn: () => workGet<GrantsAnswer>('/api/work/grants', as), staleTime: 30_000 });
export function prefetchGrants(qc: QueryClient, s: WorkSearch): void {
  void qc.prefetchQuery(grantsQuery(asOf(s)));
}

export function GrantsView({ search }: { search: WorkSearch }) {
  return (
    <>
      <ListBoundary what="Grants">
        <GrantsBody as={asOf(search)} />
      </ListBoundary>
      <WorkToast />
    </>
  );
}

const KINDS: [string, string][] = [['request', 'Requests'], ['loi', 'LOIs'], ['report', 'Reports'], ['conversation', 'Conversations'], ['other', 'Tasks and cultivation']];
const inKind = (r: GrantRow, k: string) => !k || (k === 'other' ? r.kind === 'task' || r.kind === 'cultivation' || !r.kind : r.kind === k);
const SORTS: Record<string, (r: GrantRow) => string> = {
  name: (r) => String(r.foundation || '').toLowerCase(),
  kind: (r) => String(r.kindLabel || '').toLowerCase(),
  date: (r) => r.date || '',
  by: (r) => (r.who || []).join(', ').toLowerCase(),
};

function GrantsBody({ as }: { as: string }) {
  const qc = useQueryClient();
  const { data: d } = useSuspenseQuery(grantsQuery(as));
  const [kind, setKind] = useHeld('grants.kind', '');
  const [q, setQ] = useHeld('grants.q', '');
  const [done, setDone] = useHeld('grants.done', false);
  const [sort, setSort] = useState<Sort | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(KEY, 50);
  const [hidden, setHidden] = useHiddenColumns(KEY, []);
  const [log, setLog] = useState<{ kind?: string } | null>(null);
  const [fopen, setFopen] = useState(false);
  const { ref, fit } = useFit(360);
  const today = d.today;
  useListKeys(KEY);

  const list = useMemo(() => {
    const out = d.rows.filter((r) => (done ? !r.open : r.open) && inKind(r, kind) && (!q || (r.foundation + ' ' + r.summary).toLowerCase().includes(q.toLowerCase())));
    const key = sort ? SORTS[sort.col] : null;
    if (!key || !sort) return out;
    const sgn = sort.dir === 'asc' ? 1 : -1;
    return out.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sgn;
    });
  }, [d, done, kind, q, sort]);
  useEffect(() => setPage(1), [done, kind, q, sort]);
  const curPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(list.length / size)));
  const pageList = pageOf(list, curPage, size);
  const reload = () => void qc.invalidateQueries({ queryKey: ['work', 'grants'] });
  useEffect(() => {
    document.addEventListener('favor:thanked-undone', reload);
    return () => document.removeEventListener('favor:thanked-undone', reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live = useRef({ list, done });
  live.current = { list, done };
  useSheetSource('grants', () => {
    const cols = [
      { key: 'foundation', label: 'Foundation', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'summary', label: 'Summary', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' }, { key: 'how', label: 'How', type: 'text' }, { key: 'state', label: 'State', type: 'text' }, { key: 'who', label: 'Fundraiser', type: 'text' },
    ];
    const rows = live.current.list.map((r) => ({ foundation: r.foundation, place: r.place, kind: r.kindLabel, summary: r.summary, date: r.date || null, how: r.category, state: r.open ? 'Open' : 'Done', who: r.who.join(', ') }));
    return sheetScreen('Grants', [{ name: 'Grants', columns: cols, rows }], { filters: live.current.done ? 'Done' : 'Open', classes: ['partner'] });
  });

  /* ---- sending what a form saved ---- */
  const afterBatch = async (out: any, what: string) => {
    if (!out.batch) {
      showToast('That entry was already saved.', { bad: true });
      return;
    }
    const bid: string = out.batch.id;
    let held = '';
    try {
      held = out.batch.run_when === 'tonight' ? 'tonight' : await driveBatch(bid);
    } catch (e) {
      showToast((e as Error).message + ' It is saved, and Recent can send it again.', { undo: { batches: [bid] }, bad: true });
      reload();
      return;
    }
    const bad = await failureOf([bid]);
    reload();
    if (bad) {
      showToast(`${bad} Nothing was lost. Recent has Try again.`, { undo: { batches: [bid] }, bad: true });
      return;
    }
    sentToast(what, held, [bid]);
  };
  const submit = async (fd: FormData, name: string, fileName: string) => {
    showToast(fileName ? 'Uploading ' + fileName + '…' : 'Saving…');
    let out: any;
    try {
      out = await workApi('/api/work/grants/log', { form: fd });
    } catch (e) {
      showToast((e as Error).message, { bad: true });
      return;
    }
    await afterBatch(out, `Logged for ${name}`);
  };
  const attach = (id: string) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
    inp.addEventListener('change', async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      showToast('Uploading ' + file.name + '…');
      const fd = new FormData();
      fd.append('file', file);
      fd.append('req', reqId());
      let out: any;
      try {
        out = await workApi(`/api/work/actions/${encodeURIComponent(id)}/upload`, { form: fd });
      } catch (e) {
        showToast((e as Error).message, { bad: true });
        return;
      }
      await afterBatch(out, 'Attached ' + file.name);
    });
    inp.click();
  };

  /* ---- the table ---- */
  const columns: Column<GrantRow>[] = [
    {
      key: 'who', label: 'Foundation', sort: 'name', fixed: true, className: 'c-who',
      cell: (r) => (
        <div className="ptl-who">
          <NavLink className="pt-name wg-name" href={partnerHref(r.cid)} title={r.foundation}>
            {r.foundation}
          </NavLink>
          <span className="pt-sub ptl-place" title={r.place}>
            {r.place}
          </span>
        </div>
      ),
    },
    {
      key: 'kind', label: 'Kind', sort: 'kind', phone: true, className: 'c-kind',
      cell: (r) => (
        <>
          <span className="pt-badge">{r.kindLabel}</span>
          {r.local ? <> <span className="pt-badge pt-badge--gold">Just logged</span></> : null}
        </>
      ),
    },
    { key: 'sum', label: 'Entry', phone: true, className: 'c-sum is-clip', title: (r) => [r.summary, r.description].filter(Boolean).join(' · '), cell: (r) => <span className="wgr-sum">{r.summary}</span> },
    {
      key: 'award', label: 'Award and file', phone: true, className: 'c-award is-clip',
      cell: (r) => (
        <>
          {r.file ? <><span className="pt-badge pt-badge--good" title={r.file}>{r.file}</span> </> : null}
          {r.award ? (
            <NavLink className="wgr-award" href={partnerHref(r.cid) + '?opp=' + encodeURIComponent(r.award.id)} title={`Award: ${r.award.name}${r.award.amount ? ' · ' + moneyExact(r.award.amount) : ''}`}>
              Award: {r.award.name}
              {r.award.amount ? ' · ' + moneyExact(r.award.amount) : ''}
            </NavLink>
          ) : r.kind === 'report' ? (
            <span className="pt-sub">No award on record</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'date', label: 'Date', sort: 'date', phone: true, className: 'c-date',
      cell: (r) => (
        <>
          <b>{r.date ? dateWords(r.date, today) : ''}</b> <span className="pt-sub">{r.open ? 'Due' : r.category}</span>
        </>
      ),
    },
    { key: 'by', label: 'Fundraiser', sort: 'by', phone: true, className: 'c-by', title: (r) => (r.who || []).join(', '), cell: (r) => <span className="pt-sub">{(r.who || []).join(', ')}</span> },
    {
      key: 'acts', label: '', fixed: true, className: 'c-acts',
      cell: (r) =>
        r.local && String(r.id).startsWith('local-') ? null : (
          <div className="pt-acts">
            <NavLink className="h-btn h-btn--ghost h-btn--sm" href={'/work/?view=open&action=' + encodeURIComponent(r.id)} data-pt-open="">
              <Ic n="expand" />
              Open
            </NavLink>
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => attach(r.id)}>
              <Ic n="plus" />
              File
            </button>
          </div>
        ),
    },
  ];

  return (
    <>
      <section className={'h-card wc-sheet ptl-sheet gr-sheet' + (fopen ? ' is-fopen' : '')} aria-label="Grants" ref={ref}>
        <div className="pt-bar">
          <div className="pt-seg" role="group" aria-label="Which list">
            <button type="button" className={!done ? 'is-on' : ''} onClick={() => setDone(false)}>
              Open<span>{Number(d.stats.open).toLocaleString('en-US')}</span>
            </button>
            <button type="button" className={done ? 'is-on' : ''} onClick={() => setDone(true)}>
              Done
            </button>
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="Find a foundation" label="Find a foundation" delay={160} />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-fbtn" aria-expanded={fopen} onClick={() => setFopen(!fopen)}>
            Filters
          </button>
          <select className={'pt-sel pl-f' + (kind ? ' is-set' : '')} aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <span className="ptl-done pl-f" title="Entries logged this month">
            This month <b>{d.stats.requestsMonth}</b> requests, <b>{d.stats.loisMonth}</b> LOIs, <b>{d.stats.reportsMonth}</b> reports
          </span>
          <span className="pt-spacer" />
          <span className="pl-f">
            <ColumnsMenu columns={columns} hidden={hidden} onChange={setHidden} />
          </span>
          <DensitySwitch />
          <SheetsButton name="grants" className="h-btn h-btn--ghost h-btn--sm pl-f" />
          <button type="button" className="h-btn h-btn--ghost h-btn--sm pl-f" onClick={() => setLog({ kind: 'conversation' })}>
            Conversation
          </button>
          <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => setLog({})}>
            <Ic n="plus" />
            Log
          </button>
        </div>
        <DataTable
          listKey={KEY}
          label="Grants"
          className="ptl-table ptl-grants"
          columns={columns}
          rows={pageList}
          rowKey={(r) => r.id}
          sort={sort}
          onSort={setSort}
          hidden={hidden}
          rowClassName={() => 'ptl-row'}
          fit={fit}
          empty={
            <div className="pt-empty">
              <b>{done ? 'Nothing logged yet' : 'No open grant tasks'}</b>
              {done ? 'Requests, LOIs and reports you log show here.' : 'A to-do you log with a due date shows here until it is done.'}
            </div>
          }
        />
        <Pager
          listKey={KEY}
          total={list.length}
          page={curPage}
          size={size}
          noun="entries"
          onPage={(p, s) => {
            if (s !== size) setSize(s);
            setPage(p);
            ref.current?.querySelector('.pt-wrap')?.scrollTo({ top: 0 });
          }}
        />
        <div className="wg-foot">
          <span>
            {list.length.toLocaleString('en-US')} {list.length === 1 ? 'entry' : 'entries'} from the last 24 months. Log adds one action on the foundation and attaches the file you pick.
          </span>
        </div>
      </section>
      {log ? (
        <LogDialog
          data={d}
          today={today}
          start={log.kind}
          onClose={() => setLog(null)}
          onSubmit={(fd, name, file) => {
            setLog(null);
            void submit(fd, name, file);
          }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ the log form */

function LogDialog({ data: d, today, start, onClose, onSubmit }: { data: GrantsAnswer; today: string; start?: string; onClose: () => void; onSubmit: (fd: FormData, name: string, fileName: string) => void }) {
  const [cid, setCid] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState(start || 'request');
  const [how0, setHow] = useState(start === 'conversation' ? 'call' : 'portal');
  const [state, setState] = useState('sent');
  const [date, setDate] = useState(today);
  const [who, setWho] = useState('');
  const [said, setSaid] = useState('');
  const [sum, setSum] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const talk = kind === 'conversation';
  // A conversation is a call or a meeting; everything else goes by the funder portal, email or mail.
  const how = talk ? (how0 === 'portal' ? 'call' : how0) : how0 === 'call' || how0 === 'meeting' ? 'portal' : how0;
  const ready = !!cid && (talk ? !!who.trim() && !!said.trim() : !!sum.trim());
  const go = () => {
    const fd = new FormData();
    fd.append('cid', cid);
    fd.append('kind', kind);
    fd.append('how', how);
    fd.append('state', state);
    fd.append('date', talk ? today : date || today);
    fd.append('summary', sum.trim());
    fd.append('notes', notes);
    fd.append('req', reqId());
    if (talk) {
      fd.append('who', who.trim());
      fd.append('said', said.trim());
    }
    if (file) fd.append('file', file);
    onSubmit(fd, name, file ? file.name : '');
  };
  return (
    <WcDialog onClose={onClose} label="Log a grant entry">
      <div className="wc-dlg__head">
        <div>
          <h2>Log a grant entry</h2>
          <p>One action on the foundation, with the file attached.</p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={onClose}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body">
        <div className="wc-field">
          <span className="lab">Foundation</span>
          <div className="ep-people">
            {cid ? (
              <span className="ep-person">
                {name}
                <button type="button" aria-label="Remove" onClick={() => { setCid(''); setName(''); }}>
                  ×
                </button>
              </span>
            ) : (
              <span className="wc-note">Pick the foundation first.</span>
            )}
          </div>
          <PartnerFind autoFocus placeholder="Find the foundation: name, email, phone or lookup id" onPick={(h) => { setCid(h.cid); setName(h.name); }} />
        </div>
        <div className="wc-field">
          <span className="lab">What</span>
          <div className="wc-choices">
            {d.kinds.map((k) => (
              <button key={k.id} type="button" className={'wc-choice' + (kind === k.id ? ' is-on' : '')} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
        {talk ? (
          <>
            <div className="wc-field">
              <label className="lab" htmlFor="wgr-who">
                Who
              </label>
              <input type="text" id="wgr-who" maxLength={120} autoComplete="off" placeholder="Program officer" value={who} onChange={(e) => setWho(e.target.value)} />
            </div>
            <div className="wc-field">
              <label className="lab" htmlFor="wgr-said">
                What was said
              </label>
              <textarea id="wgr-said" rows={3} value={said} onChange={(e) => setSaid(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="wc-field">
            <span className="lab">Done or to do</span>
            <div className="wc-choices">
              <button type="button" className={'wc-choice' + (state === 'sent' ? ' is-on' : '')} onClick={() => setState('sent')}>
                Sent
              </button>
              <button type="button" className={'wc-choice' + (state === 'todo' ? ' is-on' : '')} onClick={() => setState('todo')}>
                To do
              </button>
            </div>
          </div>
        )}
        <div className="wc-row2">
          {!talk ? (
            <div className="wc-field">
              <span className="lab">{state === 'sent' ? 'Date sent' : 'Due'}</span>
              <input type="date" value={date} max={state === 'sent' ? today : undefined} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : null}
          <div className="wc-field">
            <span className="lab">How</span>
            <div className="wc-choices">
              {d.hows
                .filter((h) => (talk ? h.id !== 'portal' : h.id !== 'call' && h.id !== 'meeting'))
                .map((h) => (
                  <button key={h.id} type="button" className={'wc-choice' + (how === h.id ? ' is-on' : '')} onClick={() => setHow(h.id)}>
                    {h.label}
                  </button>
                ))}
            </div>
          </div>
        </div>
        {!talk ? (
          <>
            <div className="wc-field">
              <label className="lab" htmlFor="wgr-sum">
                Summary
              </label>
              <input type="text" id="wgr-sum" maxLength={255} autoComplete="off" value={sum} onChange={(e) => setSum(e.target.value)} />
            </div>
            <div className="wc-field">
              <label className="lab" htmlFor="wgr-notes">
                Notes <span className="wc-opt">(optional)</span>
              </label>
              <textarea id="wgr-notes" rows={3} placeholder="Amount requested, program, deadline" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="wc-field">
              <label className="lab" htmlFor="wgr-file">
                File <span className="wc-opt">(optional, up to 10 MB)</span>
              </label>
              <input type="file" id="wgr-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
            </div>
          </>
        ) : null}
      </div>
      <div className="wc-dlg__foot">
        <button type="button" className="h-btn h-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!ready} onClick={go}>
          <Ic n="check" />
          Log it
        </button>
      </div>
    </WcDialog>
  );
}
