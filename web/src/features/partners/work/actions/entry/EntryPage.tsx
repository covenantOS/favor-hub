// Partners > Entry: Support's intake of the week's contacts. A person strip (whose contacts), the deadline card, the lanes, the Paste panel,
// and a table of rows to match, fill in and send to Blackbaud. Port of the Entry code in public/js/work.js (viewIntake, introBar,
// postRows, the entry click, change and input handlers) with the shared table. Reads GET /api/work/entry; every change goes through
// edits.ts; entering rows goes through runJob (engine.ts), which saves the batch first and then sends it 15 at a time.
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Column, DataTable, DensitySwitch, Pager, pageOf, clampPage, usePageSize } from '../../../../../ui/table';
import { wcPost } from '../api';
import { budgetLine, estCreate, reloadEntry, runJob, toast } from '../engine';
import { ini, plural } from '../model';
import { boardQuery } from '../queries';
import { clearSel, setSel, useWc, wcGet, openDialog, closeDialog } from '../store';
import { useWork } from '../useWork';
import { ActionBar, Dialog, DialogHead, Ic } from '../ui';
import { AddPartnerDialog } from './AddPartnerDialog';
import { DateCell, HowCell, PartnerCell, StateCell, SumCell, TagsCell, type RowActions } from './Cells';
import { editRow, flushEdits, mergeRow, partnerOf, readSheet, useEntryOv } from './edits';
import { byDate, isLocked, laneFor, laneRows, rowState, weekCounts } from './logic';
import { ManyDialog } from './ManyDialog';
import { entryQuery, type EntryRow, type Lane } from './types';

// What the person had open survives a trip to another tab and back.
const memo = { owner: '', lane: 'wait' as Lane, key: '' };

const dayHM = (ms: number) => {
  const m = Math.max(0, ms);
  return { d: Math.floor(m / 86400000), h: Math.floor((m % 86400000) / 3600000), m: Math.floor((m % 3600000) / 60000) };
};

/** The time left to the deadline, counted down in the browser. */
function Clock({ iso }: { iso: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  const t = dayHM(Date.parse(iso) - Date.now());
  return (
    <div className="wc-clock__time" id="clock" suppressHydrationWarning>
      {t.d}
      <small>d</small> {t.h}
      <small>h</small> {t.m}
      <small>m</small>
    </div>
  );
}

function SetDateDialog({ rows, today }: { rows: EntryRow[]; today: string }) {
  const [v, setV] = useState(today);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const go = () => {
    if (!ok) return;
    rows.forEach((r) => editRow(r.id, { local: { date: v }, server: { contact_date: v } }));
    closeDialog();
  };
  return (
    <Dialog label="Set the date">
      <DialogHead title="Set the date" sub={`Date for the ${plural(rows.length, 'selected row')} (the day of the contact).`} />
      <div className="wc-dlg__body">
        <div className="wc-field">
          <label htmlFor="sd-date">Date of the contact</label>
          <input type="date" id="sd-date" value={v} onChange={(e) => setV(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && go()} />
        </div>
      </div>
      <div className="wc-dlg__foot">
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!ok} onClick={go}>
          <Ic n="cal" />
          Set date
        </button>
      </div>
    </Dialog>
  );
}

export function EntryBody({ as, standin }: { as?: string; standin: boolean }) {
  const qc = useQueryClient();
  const asKey = as || '';
  const [owner, setOwner] = useState(memo.owner);
  const [lane, setLane] = useState<Lane>(memo.lane);
  const [pasteOn, setPasteOn] = useState(false);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'date', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize('wc-intake', 50);
  const [switching, setSwitching] = useState(false);
  const [reading, setReading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const pasteBox = useRef<HTMLTextAreaElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const data = useSuspenseQuery(entryQuery(owner, asKey)).data;
  const board = useSuspenseQuery(boardQuery(as)).data;
  const work = useWork(board);
  const ovMap = useEntryOv();
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const sel = useWc((s) => s.sel);
  const anchor = useWc((s) => s.anchor);

  const rdd = data.owner;
  const me = data.owners.find((x) => x.fid === rdd) || data.owners[0];
  const people = useMemo(() => {
    const m = { ...board.people };
    data.owners.forEach((o) => {
      if (!m[o.fid]) m[o.fid] = { n: o.name, team: 'RDD', active: 1, listed: 1 };
    });
    return m;
  }, [board.people, data.owners]);
  const nameOf = (fid: string) => (people[fid] || { n: 'Fundraiser ' + fid }).n;
  const sc = { saving, queued, fd: work.fd };
  const stateOf = (r: EntryRow) => rowState(r, sc);

  // The rows with what the person changed laid over them; the order follows the hub's copy so a row does not jump while it is edited.
  const base = useMemo(() => Object.fromEntries(data.rows.map((r) => [r.id, r])), [data.rows]);
  const merged = useMemo(() => data.rows.map((r) => mergeRow(r, ovMap)), [data.rows, ovMap]);
  const list = useMemo(() => {
    const rows = laneRows(merged, rdd, lane, { saving, queued, fd: work.fd });
    const pn = (r: EntryRow) => ((r.cid && partnerOf(data, r.cid)?.n) || r.name).toLowerCase();
    const sk = (r: EntryRow) => (sort.col === 'partner' ? pn(r) : sort.col === 'state' ? rowState(r, { saving, queued, fd: work.fd }).l : (base[r.id] || r).date);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => (sk(a) < sk(b) ? -1 : sk(a) > sk(b) ? 1 : byDate(a, b)) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merged, rdd, lane, saving, queued, sort, base, data]);

  // Back to the first page when the person, the lane or the order changes.
  const sig = rdd + '|' + lane + '|' + sort.col + sort.dir;
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      setPage(1);
    }
  }, [sig]);
  useEffect(() => {
    memo.owner = owner;
    memo.lane = lane;
  }, [owner, lane]);
  const cur = clampPage(page, list.length, size);
  const shown = pageOf(list, cur, size);

  // Opening Entry (and choosing a person) reads that person's tracking sheet quietly; the hub reads it at most every ten minutes.
  const quiet = useRef('');
  useEffect(() => {
    if (!me || quiet.current === rdd) return;
    quiet.current = rdd;
    void readSheet(me, false, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdd]);
  useEffect(() => () => clearSel(), []);

  // ---------------------------------------------------------------- selection
  const byId = useMemo(() => Object.fromEntries(list.map((r) => [r.id, r])), [list]);
  const selectable = (id: string) => {
    const r = byId[id];
    return !!r && !isLocked(stateOf(r).k);
  };
  const shownIds = shown.map((r) => r.id);
  const toggle = (id: string, on: boolean, shift: boolean) => {
    if (!selectable(id)) return;
    const s = wcGet();
    if (shift && s.anchor) {
      const ids = list.map((r) => r.id);
      const a = ids.indexOf(s.anchor);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const want = s.sel.has(s.anchor);
        const n = new Set(s.sel);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (selectable(ids[i]) && shownIds.includes(ids[i])) want ? n.add(ids[i]) : n.delete(ids[i]);
        setSel(n, s.anchor);
        return;
      }
    }
    const n = new Set(s.sel);
    on ? n.add(id) : n.delete(id);
    setSel(n, id);
  };
  const pageAll = (on: boolean) => {
    const n = new Set(wcGet().sel);
    shownIds.filter(selectable).forEach((id) => (on ? n.add(id) : n.delete(id)));
    setSel(n);
  };

  // Ctrl A picks every row that can be picked; Shift with the arrow keys (or j and k) extends the pick; Esc clears it.
  const latest = useRef({ list, selectable });
  latest.current = { list, selectable };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || e.defaultPrevented) return;
      const typing = /^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable;
      if (e.key === 'Escape') {
        if (!wcGet().dialog && wcGet().sel.size && !typing) clearSel();
        return;
      }
      if (!t.closest?.('[data-pt-list="wc-intake"], [data-grid]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault();
        setSel(latest.current.list.filter((r) => latest.current.selectable(r.id)).map((r) => r.id));
        return;
      }
      const row = t.closest?.('tr[data-pt-row]') as HTMLElement | null;
      if (!row || typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const down = e.key === 'ArrowDown' || e.key === 'j';
      const up = e.key === 'ArrowUp' || e.key === 'k';
      if (!down && !up) return;
      e.preventDefault();
      const rows = Array.from(row.parentElement?.querySelectorAll<HTMLElement>('tr[data-pt-row]') || []);
      const n = rows[rows.indexOf(row) + (down ? 1 : -1)];
      if (!n) return;
      n.focus();
      n.scrollIntoView({ block: 'nearest' });
      const id = n.dataset.id;
      if (e.shiftKey && id && latest.current.selectable(id)) {
        const s = new Set(wcGet().sel);
        s.add(id);
        setSel(s);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---------------------------------------------------------------- actions
  const act: RowActions = {
    edit: editRow,
    pick: (id, cid) => editRow(id, { local: { cid, how: 'picked', cands: [] }, server: { constituent_id: cid } }),
    unpick: (id) => {
      editRow(id, { local: { cid: null, how: 'none' }, server: { constituent_id: null } });
      setTimeout(() => document.querySelector<HTMLInputElement>(`[data-ta="${CSS.escape(id)}"]`)?.focus(), 30);
    },
    addPartner: (id) => {
      const r = merged.find((x) => x.id === id);
      if (r) openDialog(<AddPartnerDialog row={r} owners={data.owners} fd={work.fd} ownerName={nameOf(r.owner)} standin={standin} />);
    },
  };

  const postRows = async (rows: EntryRow[]) => {
    const ready = rows.filter((r) => stateOf(r).k === 'ready');
    if (!ready.length) return;
    await flushEdits();
    const calls = estCreate(ready);
    void runJob({ entry: true, params: {}, ids: ready.map((r) => r.id), label: `Entered ${plural(ready.length, 'contact')} for ${me ? me.name : nameOf(rdd)}`, calls, tonight: budgetLine(calls).tonight });
  };

  const chooseOwner = async (fid: string) => {
    if (fid === rdd || switching) return;
    clearSel();
    setSwitching(true);
    try {
      const d = await qc.fetchQuery({ ...entryQuery(fid, asKey), staleTime: 0 });
      setOwner(fid);
      setLane(laneFor(d.owners, fid));
    } catch (e) {
      toast((e as Error).message);
    }
    setSwitching(false);
  };
  const chooseLane = (k: Lane) => {
    setLane(k);
    clearSel();
  };

  const w = weekCounts(data.owners, rdd);
  const bb = data.bb || { this: 0, last: 0, lastByMon3: 0 };
  const readyAll = list.filter((r) => stateOf(r).k === 'ready');
  const picked = list.filter((r) => sel.has(r.id));
  const pickedReady = picked.filter((r) => stateOf(r).k === 'ready');
  const span = `${work.fd(data.deadline.from)} to ${Number(data.deadline.to.slice(8))}`;
  const lanes: [Lane, string, number][] = [
    ['wait', 'This week', w.wait],
    ['late', 'Late', w.late],
    ['in', 'In Blackbaud', w.in],
    ['all', 'All rows', w.all],
  ];

  const columns: Column<EntryRow>[] = [
    { key: 'partner', label: 'Partner', sort: 'partner', fixed: true, className: 'wc-pc', thClassName: 'wc-h-pc', cell: (r) => <PartnerCell r={r} st={stateOf(r)} d={r.cid ? partnerOf(data, r.cid) : null} locked={isLocked(stateOf(r).k)} ownerFirst={(nameOf(r.owner).split(' ')[0]) || ''} ownerFid={rdd} canAdd={!!board.me.canMove} partnerOf={(c) => partnerOf(data, c)} nameOf={nameOf} act={act} /> },
    { key: 'date', label: 'Date', sort: 'date', fixed: true, className: 'wc-dc', thClassName: 'wc-h-dc', cell: (r) => <DateCell r={r} locked={isLocked(stateOf(r).k)} act={act} /> },
    { key: 'how', label: 'How', fixed: true, className: 'wc-hc', thClassName: 'wc-h-hc', cell: (r) => <HowCell r={r} locked={isLocked(stateOf(r).k)} act={act} /> },
    { key: 'state', label: 'State', sort: 'state', fixed: true, className: 'wc-statewrap', thClassName: 'wc-h-st', cell: (r) => <StateCell st={stateOf(r)} /> },
    { key: 'sum', label: 'Summary', fixed: true, className: 'wc-sc', thClassName: 'wc-h-sc', cell: (r) => <SumCell r={r} locked={isLocked(stateOf(r).k)} act={act} /> },
    { key: 'tags', label: 'Tags and ask', fixed: true, className: 'wc-tagcell', thClassName: 'wc-h-tc', cell: (r) => <TagsCell r={r} locked={isLocked(stateOf(r).k)} act={act} /> },
  ];

  const readNow = async () => {
    setReading(true);
    await readSheet(me, true, true);
    setReading(false);
  };
  const readPaste = async () => {
    const text = pasteBox.current?.value || '';
    if (!text.trim()) {
      toast('Copy whole rows from the sheet first, then paste them here.');
      return;
    }
    setPasting(true);
    try {
      const res = await wcPost<{ added: string[]; skipped: number }>('/api/work/entry/paste', { owner: rdd, text });
      setPasteOn(false);
      setLane('all');
      clearSel();
      await reloadEntry();
      const n = res.added.length;
      toast(n ? `Read ${plural(n, 'row')}${res.skipped ? `. ${res.skipped} were already here and were skipped` : ''}.` : res.skipped ? `All ${res.skipped} rows are already here. Nothing was added twice.` : 'No rows found. Copy whole rows from the sheet.');
    } catch (err) {
      toast((err as Error).message);
    }
    setPasting(false);
  };
  const togglePaste = () => {
    const on = !pasteOn;
    setPasteOn(on);
    if (on) setTimeout(() => pasteBox.current?.focus(), 0);
  };

  if (!data.owners.length)
    return (
      <div className="h-card wc-empty">
        <b>No one is set up for Entry yet</b>An admin adds the people whose contacts Support enters in Settings.
      </div>
    );

  return (
    <>
      <div className="wc-owners" role="tablist" aria-label="Whose contacts">
        {data.owners.map((x) => {
          const n = x.wait + x.late;
          return (
            <button key={x.fid} type="button" className={'wc-owner' + (rdd === x.fid ? ' is-on' : '')} title={x.type} onClick={() => void chooseOwner(x.fid)}>
              <span className="wc-ini">{ini(x.name)}</span>
              {x.name}
              {n ? <em className="warn">{n}</em> : x.all ? <em>Done</em> : <em className="none">Nothing yet</em>}
            </button>
          );
        })}
      </div>
      <section className="h-card wc-clock" aria-label="This week's deadline">
        <div className="wc-clock__left">
          <span className="h-label">
            {me.name} · due {data.deadline.label}
          </span>
          <Clock iso={data.deadline.iso} />
          <div className="wc-clock__when">Contacts from {span}. The report is pulled Wednesday at noon.</div>
        </div>
        <div className="wc-prog">
          <div className="wc-prog__nums">
            <span>
              <b>{w.inBB}</b>of {w.sub} submitted this week are in Blackbaud
            </span>
            <span className="wc-prog__side">
              {Number(bb.this).toLocaleString('en-US')} {me.type}
              {Number(bb.this) === 1 ? '' : 's'} dated this week in Blackbaud
              <br />
              Last week: {bb.lastByMon3} of {bb.last} in by Monday 3:00 PM
            </span>
          </div>
          <div className="wc-prog__bar" role="img" aria-label={`${w.inBB} of ${w.sub} entered`}>
            <i style={{ width: (w.sub ? (w.inBB / w.sub) * 100 : 0) + '%' }} />
            <i style={{ width: (w.sub ? (w.wait / w.sub) * 100 : 0) + '%' }} />
          </div>
          <div className="wc-prog__legend">
            <span>
              <i />
              In Blackbaud {Number(w.inBB).toLocaleString('en-US')}
            </span>
            <span>
              <i className="w" />
              Waiting {Number(w.wait).toLocaleString('en-US')}
            </span>
            <span>
              <i className="b" />
              Late from earlier weeks {Number(w.late).toLocaleString('en-US')}
            </span>
          </div>
        </div>
      </section>
      <section className="h-card wc-sheet" id="wc-intake" aria-label="Contacts to enter">
        <div className="wc-filters">
          <div className="wc-lanes" role="tablist">
            {lanes.map(([k, l, n]) => (
              <button key={k} type="button" className={'wc-lane' + (lane === k ? ' is-on' : '')} onClick={() => chooseLane(k)}>
                {l}
                <span>{Number(n).toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
          <div className="wc-tools">
            <DensitySwitch />
            <button
              type="button"
              className="h-btn h-btn--ghost h-btn--sm wc-phonly"
              onClick={() => {
                const ids = shownIds.filter(selectable);
                pageAll(!ids.every((id) => sel.has(id)));
              }}
            >
              Select all
            </button>
            {me.tab ? (
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" disabled={reading} onClick={() => void readNow()}>
                <Ic n="paste" />
                Read the sheet
              </button>
            ) : null}
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={togglePaste}>
              <Ic n="paste" />
              Paste rows
            </button>
            <button
              type="button"
              className="h-btn h-btn--ghost h-btn--sm"
              onClick={() => openDialog(<ManyDialog owner={me} ownerFid={rdd} data={data} today={work.today} nameOf={nameOf} onDone={() => setLane('all')} />)}
            >
              <Ic n="many" />
              One contact, many partners
            </button>
          </div>
        </div>
        <div className={'wc-paste' + (pasteOn ? ' is-on' : '')} id="paste">
          <label htmlFor="pastebox" className="wc-pastelab">
            Paste rows from {me.name}'s tracking sheet: Name, New?, Date, Phone, Email, Address, Ask, Action, Notes
          </label>
          <textarea id="pastebox" ref={pasteBox} placeholder="Copy the rows in the sheet (Ctrl C) and paste them here (Ctrl V)." />
          <div className="wc-paste__acts">
            <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={pasting} onClick={() => void readPaste()}>
              Read the rows
            </button>
            <button type="button" className="wc-clear" onClick={togglePaste}>
              Close
            </button>
            <small>Each row is matched to a partner by email, then phone, then name. Rows already here or in Blackbaud are skipped.</small>
          </div>
        </div>
        <div ref={grid} data-grid="">
          {list.length ? (
            <DataTable<EntryRow>
              listKey="wc-intake"
              label="Contacts to enter"
              className="wc-ig wc-ig-t"
              columns={columns}
              rows={shown}
              rowKey={(r) => r.id}
              sort={sort}
              onSort={(s) => setSort(s)}
              busy={switching}
              fit={470}
              rowClassName={(r) => {
                const k = stateOf(r).k;
                return 'wc-row' + (k === 'dup' ? ' is-dup' : '') + (k === 'posted' ? ' is-posted' : '');
              }}
              onRowClick={(r, e) => {
                const id = r.id;
                if (!selectable(id)) return;
                toggle(id, !sel.has(id), e.shiftKey);
                window.getSelection()?.removeAllRanges();
                (e.currentTarget as HTMLElement).focus({ preventScroll: true });
              }}
              select={{ selected: sel, onToggle: toggle, onPage: pageAll, drag: true, disabled: (id: string) => !selectable(id), cellClassName: 'wc-cb' }}
            />
          ) : (
            <div className="wc-empty">
              <b>{lane === 'wait' && w.all ? 'Everything submitted this week is in Blackbaud' : w.all ? 'Nothing in this lane' : 'Nothing pasted for ' + me.name + ' yet'}</b>
              {w.all ? '' : 'Paste rows from the tracking sheet, or use One contact, many partners.'}
            </div>
          )}
        </div>
        <div className="wc-foot">
          <Pager
            listKey="wc-intake"
            total={list.length}
            page={cur}
            size={size}
            noun={`rows, ${readyAll.length} ready`}
            onPage={(p, s) => {
              if (s !== size) setSize(s);
              setPage(p);
            }}
          />
          {readyAll.length ? (
            <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => void postRows(list)}>
              <Ic n="check" />
              Enter {readyAll.length} ready rows
            </button>
          ) : (
            <span />
          )}
        </div>
      </section>
      <ActionBar label="Selected rows">
        {picked.length ? (
          <>
            <span className="wc-bar__n">{picked.length}</span>
            <span className="wc-bar__l">selected · {pickedReady.length} ready</span>
            <span className="wc-bar__acts">
              <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={!pickedReady.length} onClick={() => void postRows(picked)}>
                <Ic n="check" />
                Enter {pickedReady.length} in Blackbaud
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openDialog(<SetDateDialog rows={picked} today={work.today} />)}>
                <Ic n="cal" />
                Set date
              </button>
              <button
                type="button"
                className="h-btn h-btn--ghost h-btn--sm"
                onClick={() => {
                  picked.forEach((r) => editRow(r.id, { local: { state: 'skipped' }, server: { skip: true } }));
                  clearSel();
                  toast(`Skipped ${plural(picked.length, 'row')}. They stay on the sheet.`);
                }}
              >
                <Ic n="x" />
                Skip
              </button>
            </span>
            <button type="button" className="wc-bar__x" aria-label="Clear the selection" onClick={clearSel}>
              <Ic n="x" />
            </button>
          </>
        ) : null}
      </ActionBar>
    </>
  );
}

/** A read that failed shows a card with Try again, the way the classic page did. */
export class EntryBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-card wc-empty">
        <b>Entry did not load</b>
        {this.state.error.message || 'Try again in a minute.'}{' '}
        <button
          type="button"
          className="h-btn h-btn--ghost h-btn--sm"
          onClick={() => {
            this.props.onRetry();
            this.setState({ error: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}
