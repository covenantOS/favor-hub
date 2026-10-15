// The dialogs of the edit tools: Complete and schedule the next, Duplicate and Move, Delete, Edit selected, New action and the keyboard
// list. Ports of dlgNext, dlgCopy, dlgDelete, dlgBulk, dlgNew and keysDialog in public/js/work-edit.js. Each one sends its change as a
// batch through sendChange and lays the change over the board at once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { wcApi } from './api';
import { af, CATS, Chip, DateChips, DUE_OUT, Field, PeopleChips, plain, staffList, todayET, useCodes, useW, type ActInfo } from './editKit';
import { sendChange } from './engine';
import { addDays, plural } from './model';
import { PartnerPicker } from './PartnerPicker';
import { recurDraft, recurOut, RecurEditor } from './RecurEditor';
import { clearSel, closeDialog, openDialog, setGone } from './store';
import { Dialog, DialogHead, Ic } from './ui';

export type ActHint = Partial<ActInfo>;

export function openNext(id: string, hint?: ActHint): void {
  openDialog(<NextDialog id={id} hint={hint} />);
}
export function openCopy(id: string, mode: 'dup' | 'move', hint?: ActHint): void {
  openDialog(<CopyDialog id={id} mode={mode} hint={hint} />);
}
export function openDelete(ids: string[]): void {
  if (!ids.length) return;
  openDialog(<DeleteDialog ids={ids} />);
}
export function openBulk(ids: string[]): void {
  if (!ids.length) return;
  openDialog(<BulkDialog ids={ids} />);
}
export function openNew(pre?: { cid?: string; name?: string }): void {
  openDialog(<NewDialog pre={pre || {}} />);
}
export function openKeys(): void {
  openDialog(<KeysDialog />);
}

/** The partner, summary and category of the action a dialog is about: from the board, from the caller's hint, or read from the action. */
function useActInfo(id: string, hint?: ActHint): ActInfo {
  const w = useW();
  const row = w?.byId[id];
  const [got, setGot] = useState<ActInfo | null>(null);
  const need = !row && !(hint && hint.p);
  useEffect(() => {
    if (!need) return;
    let off = false;
    wcApi<{ action: { cid: string; summary: string; category: string }; partner: { name: string } }>('/api/work/actions/' + encodeURIComponent(id))
      .then((d) => {
        if (!off) setGot({ p: d.partner.name, cid: d.action.cid, sum: d.action.summary, cat: d.action.category });
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [id, need]);
  if (row) return { p: row.p, cid: row.cid, sum: row.sum, cat: row.cat };
  if (hint && hint.p) return { p: hint.p, cid: hint.cid || '', sum: hint.sum || '', cat: hint.cat || '' };
  return got || { p: 'Partner', cid: '', sum: '', cat: '' };
}

const Foot = ({ children }: { children: ReactNode }) => <div className="wc-dlg__foot">{children}</div>;
const CancelBtn = ({ children = 'Cancel', autoFocus }: { children?: ReactNode; autoFocus?: boolean }) => (
  <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog} ref={autoFocus ? af : undefined}>
    {children}
  </button>
);

// ------------------------------------------------------------------ Complete and schedule the next

function NextDialog({ id, hint }: { id: string; hint?: ActHint }) {
  const w = useW();
  const info = useActInfo(id, hint);
  const today = w?.today || todayET();
  const [out, setOut] = useState('');
  const [line, setLine] = useState('');
  const [date, setDate] = useState(() => addDays(todayET(), 14));
  const [dateTouched, setDateTouched] = useState(false);
  const [sumE, setSumE] = useState<string | null>(null);
  const [catE, setCatE] = useState<string | null>(null);
  const [recur, setRecur] = useState(recurDraft(null));
  const d = dateTouched ? date : addDays(today, 14);
  const sum = sumE ?? info.sum;
  const cat = catE ?? (info.cat || 'Phone call');
  const go = () => {
    const next = d || addDays(today, 14);
    const params = { op: 'complete_next', ids: [id], complete: out ? { outcome: out } : {}, line, next: { date: next, summary: sum, category: cat }, recur: recurOut(recur) };
    closeDialog();
    setGone([id], true);
    void sendChange(params, { label: `Completed. The next is due ${w ? w.fd(next) : next}`, revert: () => setGone([id], false) });
  };
  return (
    <Dialog cls="ep-dlg" label="Complete and schedule the next">
      <DialogHead title="Complete and schedule the next" sub={info.p} />
      <div className="wc-dlg__body">
        <Field label="How did it go?">
          <div className="wc-choices">
            {[
              ['', 'Leave blank'],
              ['Successful', 'Good'],
              ['Unsuccessful', 'Not good'],
            ].map(([v, l]) => (
              <Chip key={v} on={out === v} onClick={() => setOut(v)}>
                {l}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="wc-field">
          <label className="lab" htmlFor="nx-line">
            Add one line to this one <span className="wc-opt">(optional)</span>
          </label>
          <input type="text" id="nx-line" maxLength={200} placeholder="For example: Left a message, will try again" value={line} onChange={(e) => setLine(e.target.value)} />
        </div>
        <div className="ep-split">
          <b className="lab">The next one</b>
          <Field label="Due">
            <div className="wc-choices">
              <DateChips
                cur={d}
                today={today}
                onPick={(v) => {
                  setDate(v);
                  setDateTouched(true);
                }}
              />
              <input
                type="date"
                value={d}
                min={today}
                aria-label="Due"
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateTouched(true);
                }}
              />
            </div>
          </Field>
          <Field label="Category">
            <div className="wc-choices">
              {CATS.map(([v, l, i]) => (
                <Chip key={v} icon={i} on={cat === v} onClick={() => setCatE(v)}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>
          <div className="wc-field">
            <label className="lab" htmlFor="nx-sum">
              Summary
            </label>
            <input type="text" id="nx-sum" maxLength={255} value={sum} ref={af} onChange={(e) => setSumE(e.target.value)} />
          </div>
          <RecurEditor value={recur} onChange={setRecur} />
        </div>
      </div>
      <Foot>
        <CancelBtn />
        <button type="button" className="h-btn h-btn--primary" onClick={go}>
          <Ic n="check" />
          Complete and schedule
        </button>
      </Foot>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Duplicate, Move

function Picked({ list, empty, onRemove }: { list: { cid: string; name: string }[]; empty: string; onRemove: (cid: string) => void }) {
  return (
    <div className="ep-people">
      {list.length ? (
        list.map((c) => (
          <span key={c.cid} className="ep-person">
            {c.name}
            <button type="button" aria-label="Remove" onClick={() => onRemove(c.cid)}>
              ×
            </button>
          </span>
        ))
      ) : (
        <span className="wc-note">{empty}</span>
      )}
    </div>
  );
}

function CopyDialog({ id, mode, hint }: { id: string; mode: 'dup' | 'move'; hint?: ActHint }) {
  const info = useActInfo(id, hint);
  const move = mode === 'move';
  const [cids, setCids] = useState<{ cid: string; name: string }[] | null>(null);
  const [date, setDate] = useState('');
  // Duplicate starts with the action's own partner; it arrives with the action when the board does not hold it.
  const shown = cids ?? (!move && info.cid ? [{ cid: info.cid, name: info.p }] : []);
  const go = () => {
    const params = move ? { op: 'move', ids: [id], to: shown[0].cid } : { op: 'duplicate', ids: [id], cids: shown.map((c) => c.cid), set: date ? { date } : undefined };
    closeDialog();
    if (move) setGone([id], true);
    void sendChange(params, { label: move ? `Moved to ${shown[0].name}` : `Copied to ${plural(shown.length, 'partner')}`, revert: () => setGone([id], false) });
  };
  const title = move ? 'Move to another partner' : 'Duplicate this action';
  return (
    <Dialog cls="ep-dlg" label={title}>
      <DialogHead title={title} sub={info.p} />
      <div className="wc-dlg__body">
        <div className="wc-field">
          <span className="lab">{move ? 'Move it to' : 'Copy it to'}</span>
          <Picked list={shown} empty={move ? 'Pick the partner it belongs to.' : 'Pick one or more partners.'} onRemove={(c) => setCids(shown.filter((x) => x.cid !== c))} />
          <div>
            <PartnerPicker
              autoFocus
              onPick={(h) => {
                if (move) setCids([{ cid: h.cid, name: h.name }]);
                else if (!shown.some((c) => c.cid === h.cid)) setCids(shown.concat([{ cid: h.cid, name: h.name }]));
              }}
            />
          </div>
        </div>
        {move ? null : (
          <Field
            label={
              <>
                Date on the copies <span className="wc-opt">(optional)</span>
              </>
            }
          >
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <div className="wc-plan">
          <span className="wc-note">{move ? 'Notes and attachments stay with the original.' : 'Copies keep the summary, type, category, fundraisers and description.'}</span>
        </div>
      </div>
      <Foot>
        <CancelBtn />
        <button type="button" className="h-btn h-btn--primary" disabled={!shown.length} onClick={go}>
          {move ? 'Move it' : 'Make the copies'}
        </button>
      </Foot>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Delete

function DeleteDialog({ ids }: { ids: string[] }) {
  const w = useW();
  const go = () => {
    closeDialog();
    clearSel();
    setGone(ids, true);
    void sendChange({ op: 'delete', ids }, { label: `Deleted ${plural(ids.length, 'action')}`, revert: () => setGone(ids, false) });
  };
  return (
    <Dialog cls="ep-dlg" label={`Delete ${plural(ids.length, 'action')}?`}>
      <DialogHead title={`Delete ${plural(ids.length, 'action')}?`} />
      <div className="wc-dlg__body">
        <div className="wc-warn">
          <Ic n="alert" />
          <span>They come out of Blackbaud. Undo from the toast or Recent for 24 hours brings back a copy with the same fields; notes and attachments on them do not come back.</span>
        </div>
        <ul className="ep-dellist">
          {ids.slice(0, 8).map((id) => {
            const a = w?.byId[id];
            return (
              <li key={id}>
                <b>{a ? a.p : 'Action ' + id}</b> {a ? a.sum || a.type : ''}
              </li>
            );
          })}
          {ids.length > 8 ? <li>and {ids.length - 8} more</li> : null}
        </ul>
      </div>
      <Foot>
        <CancelBtn autoFocus>Keep them</CancelBtn>
        <button type="button" className="h-btn h-btn--danger" onClick={go}>
          Delete {ids.length}
        </button>
      </Foot>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Edit selected

const BULK: [string, string][] = [
  ['category', 'Category'],
  ['type', 'Type'],
  ['status', 'Status'],
  ['date', 'Due date'],
  ['priority', 'Priority'],
  ['direction', 'Direction'],
  ['location', 'Location'],
  ['outcome', 'Outcome'],
  ['fundraisers', 'Fundraisers (replace)'],
  ['line', 'Add a line to the description'],
  ['tag', 'Add a tag'],
];

function BulkDialog({ ids }: { ids: string[] }) {
  const w = useW();
  const { codes: C } = useCodes();
  const today = w?.today || todayET();
  const types = C.types || [];
  const statuses = C.statuses || ['Open', 'Completed', 'Canceled'];
  const locations = C.locations || [];
  const tagCats = (C.tagCategories || []).filter((c) => c.type === 'CodeTableEntry' && !/^NXT /.test(c.name));
  const [on, setOn] = useState<Record<string, boolean>>({});
  // Values the person has chosen; the rest show the defaults the classic dialog started with.
  const [chosen, setChosen] = useState<Record<string, string | string[]>>({});
  const v: Record<string, string | string[]> = {
    category: 'Phone call',
    type: types[0] || '',
    status: 'Open',
    date: addDays(today, 7),
    priority: 'High',
    direction: 'Outbound',
    location: locations[0] || '',
    outcome: 'Successful',
    fundraisers: [],
    line: '',
    tag: 'Thanked',
    ...chosen,
  };
  const str = (k: string) => String(v[k]);
  const set = (k: string, val: string | string[]) => {
    setChosen((c) => ({ ...c, [k]: val }));
    setOn((o) => ({ ...o, [k]: k === 'line' ? !!val : true }));
  };
  const n = Object.values(on).filter(Boolean).length;
  const sel = (k: string, opts: [string, string][]) => (
    <select value={str(k)} onChange={(e) => set(k, e.target.value)}>
      {opts.map(([val, l]) => (
        <option key={val} value={val}>
          {l}
        </option>
      ))}
    </select>
  );
  const input = (k: string) => {
    if (k === 'category') return sel(k, CATS.map(([c, l]) => [c, l]));
    if (k === 'type') return sel(k, types.map((t) => [t, t]));
    if (k === 'status') return sel(k, statuses.map((t) => [t, t]));
    if (k === 'date') return <input type="date" value={str(k)} onChange={(e) => set(k, e.target.value)} />;
    if (k === 'priority') return sel(k, ['Low', 'Normal', 'High'].map((t) => [t, t]));
    if (k === 'direction') return sel(k, [['', 'None'], ['Outbound', 'Outbound'], ['Inbound', 'Inbound']]);
    if (k === 'location') return sel(k, [['', 'None'], ...locations.map((t): [string, string] => [t, t])]);
    if (k === 'outcome') return sel(k, [['', 'None'], ['Successful', 'Successful'], ['Unsuccessful', 'Unsuccessful']]);
    if (k === 'fundraisers') {
      return (
        <select multiple size={4} value={v[k] as string[]} onChange={(e) => set(k, Array.from(e.target.selectedOptions).map((o) => o.value))}>
          {staffList(w).map((f) => (
            <option key={f} value={f}>
              {w ? w.P(f).n : f}
            </option>
          ))}
        </select>
      );
    }
    if (k === 'line') return <input type="text" maxLength={200} value={str(k)} placeholder="For example: Moved to Partner Care" onChange={(e) => set(k, e.target.value)} />;
    return sel(k, tagCats.map((c) => [c.name, c.name]));
  };
  const go = () => {
    const setv: Record<string, unknown> = {};
    for (const [k] of BULK) if (on[k] && k !== 'line' && k !== 'tag') setv[k] = v[k];
    const params = { op: 'bulk_edit', ids, set: setv, line: on.line ? v.line : '', tags: on.tag ? { add: [{ category: v.tag }] } : undefined };
    closeDialog();
    clearSel();
    if (setv.status === 'Completed' || setv.status === 'Canceled') setGone(ids, true);
    void sendChange(params, { label: `Changed ${plural(ids.length, 'action')}`, revert: () => setGone(ids, false) });
  };
  return (
    <Dialog cls="ep-dlg" label={`Edit ${plural(ids.length, 'action')}`}>
      <DialogHead title={`Edit ${plural(ids.length, 'action')}`} />
      <div className="wc-dlg__body">
        <div className="ep-bulk">
          {BULK.map(([k, l]) => (
            <label key={k} className="ep-bulkrow">
              <input type="checkbox" checked={!!on[k]} onChange={(e) => setOn((o) => ({ ...o, [k]: e.target.checked }))} />
              <span>{l}</span>
              <span className="ep-bulkin">{input(k)}</span>
            </label>
          ))}
        </div>
      </div>
      <Foot>
        <span className="wc-cost" />
        <CancelBtn />
        <button type="button" className="h-btn h-btn--primary" disabled={!n} onClick={go}>
          Change {ids.length}
        </button>
      </Foot>
    </Dialog>
  );
}

// ------------------------------------------------------------------ New action

const NEW_TAGS = ['Thanked', 'Texted', 'Stewardship', 'Scheduling', 'Favor Presentation'];

function NewDialog({ pre }: { pre: { cid?: string; name?: string } }) {
  const w = useW();
  const { codes: C, me: cme, types: fidTypes } = useCodes();
  const today = w?.today || todayET();
  const [cids, setCids] = useState<{ cid: string; name: string }[]>(pre.cid ? [{ cid: pre.cid, name: pre.name || 'Partner' }] : []);
  const [cat, setCat] = useState('Phone call');
  const [done, setDone] = useState(true);
  const [dateE, setDateE] = useState<string | null>(null);
  const [frE, setFrE] = useState<string[] | null>(null);
  const [typeE, setTypeE] = useState<string | null>(null);
  const [holders, setHolders] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sum, setSum] = useState('');
  const [desc, setDesc] = useState('');
  const [next, setNext] = useState(false);
  const [nextDate, setNextDate] = useState(() => addDays(todayET(), 14));
  const [nextSum, setNextSum] = useState('');
  const [recur, setRecur] = useState(recurDraft(null));
  const sumRef = useRef<HTMLInputElement>(null);
  const typeFor = (fid: string) => fidTypes[fid] || cme.type || 'RDD Action';
  // Smart defaults, used until the person chooses: the date from the kind, the partner's holder (or the person) and their action type.
  const date = dateE ?? (done ? today : addDays(today, DUE_OUT[cat] || 7));
  const fr = frE ?? (holders[0] ? [holders[0]] : cme.fid ? [cme.fid] : []);
  const type = typeE ?? (fr[0] ? typeFor(fr[0]) : cme.type || 'RDD Action');
  const types = C.types || [];
  const hasTag = (t: string) => (C.tagCategories || []).some((c) => c.name === t);
  const learn = async (cid: string) => {
    try {
      const d = await wcApi<{ partner: { assignments?: { current?: boolean; fid: string }[] } }>('/api/work/partners/' + cid);
      setHolders((d.partner.assignments || []).filter((x) => x.current).map((x) => x.fid).filter((f) => (w ? w.live(f) : true)));
    } catch {
      setHolders([]);
    }
  };
  const learned = useRef(false);
  useEffect(() => {
    if (pre.cid && !learned.current && w) {
      learned.current = true;
      void learn(pre.cid);
    }
    // learn once when the board is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w]);
  const go = () => {
    const set: Record<string, unknown> = { category: cat, type, date: date || today, summary: sum, description: desc, fundraisers: fr, completed: done, status: done ? 'Completed' : 'Open' };
    if (['Phone call', 'Email', 'Mailing'].includes(cat)) set.direction = 'Outbound';
    const params: Record<string, unknown> = { op: 'new', cids: cids.map((c) => c.cid), set, tags: tags.length ? { add: tags.map((c) => ({ category: c })) } : undefined };
    if (next) params.next = { category: 'Task/Other', date: nextDate, summary: nextSum || 'Follow up', fundraisers: fr, type: set.type };
    const r = recurOut(recur);
    if (r && next) params.recur = r;
    else if (r && !done) params.recur = r;
    closeDialog();
    void sendChange(params, { label: cids.length > 1 ? `Added to ${cids.length} partners` : `Added for ${cids[0].name}` });
  };
  return (
    <Dialog cls="ep-dlg" label="New action">
      <DialogHead title="New action" />
      <div className="wc-dlg__body">
        <div className="wc-field">
          <span className="lab">Partner</span>
          <Picked
            list={cids}
            empty="Pick the partner first."
            onRemove={(c) => setCids(cids.filter((x) => x.cid !== c))}
          />
          <div>
            <PartnerPicker
              autoFocus={!pre.cid}
              onPick={(h) => {
                if (!cids.some((c) => c.cid === h.cid)) {
                  setCids(cids.concat([{ cid: h.cid, name: h.name }]));
                  if (!cids.length) void learn(h.cid);
                }
                setTimeout(() => sumRef.current?.focus(), 0);
              }}
            />
          </div>
        </div>
        <Field label="What kind">
          <div className="wc-choices">
            {CATS.map(([v, l, i]) => (
              <Chip
                key={v}
                icon={i}
                on={cat === v}
                onClick={() => {
                  setCat(v);
                  if (v === 'Task/Other' && dateE === null) setDone(false);
                }}
              >
                {l}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="">
          <div className="wc-choices">
            <Chip on={done} onClick={() => setDone(true)}>
              Done already
            </Chip>
            <Chip on={!done} onClick={() => setDone(false)}>
              To do
            </Chip>
          </div>
        </Field>
        <div className="wc-row2">
          <div className="wc-field">
            <span className="lab">{done ? 'Date it happened' : 'Due'}</span>
            <input type="date" value={date} onChange={(e) => setDateE(e.target.value)} />
          </div>
          <Field label="Type">
            <select value={type} onChange={(e) => setTypeE(e.target.value)}>
              {types.map((t) => (
                <option key={t} value={t}>
                  {plain(t)}
                </option>
              ))}
              {type && !types.includes(type) ? <option value={type}>{type}</option> : null}
            </select>
          </Field>
        </div>
        <div className="wc-field">
          <label className="lab" htmlFor="nw-sum">
            Summary
          </label>
          <input ref={sumRef} type="text" id="nw-sum" maxLength={255} placeholder="For example: Called to thank for the September gift" value={sum} onChange={(e) => setSum(e.target.value)} />
        </div>
        <div className="wc-field">
          <label className="lab" htmlFor="nw-desc">
            Description <span className="wc-opt">(optional)</span>
          </label>
          <textarea id="nw-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <Field label="Fundraiser">
          <PeopleChips
            list={fr}
            w={w}
            onRemove={(f) => setFrE(fr.filter((x) => x !== f))}
            onAdd={(f) => setFrE(fr.concat([f]))}
          />
        </Field>
        <Field label="Tags">
          <div className="wc-choices">
            {NEW_TAGS.filter(hasTag).map((t) => (
              <Chip key={t} on={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : tags.concat([t]))}>
                {t}
              </Chip>
            ))}
          </div>
        </Field>
        <label className="wc-toggle">
          <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} />
          Add a follow-up
        </label>
        <div className="ep-split" hidden={!next}>
          <Field label="Follow-up due">
            <div className="wc-choices">
              <DateChips cur={nextDate} today={today} onPick={setNextDate} />
              <input type="date" value={nextDate} min={today} aria-label="Follow-up due" onChange={(e) => setNextDate(e.target.value)} />
            </div>
          </Field>
          <div className="wc-field">
            <label className="lab" htmlFor="nw-nsum">
              Follow-up summary
            </label>
            <input type="text" id="nw-nsum" maxLength={255} placeholder="For example: Send the trip report" value={nextSum} onChange={(e) => setNextSum(e.target.value)} />
          </div>
          <RecurEditor value={recur} onChange={setRecur} />
        </div>
      </div>
      <Foot>
        <CancelBtn />
        <button type="button" className="h-btn h-btn--primary" disabled={!cids.length} onClick={go}>
          {cids.length > 1 ? `Add to ${cids.length} partners` : 'Add action'}
        </button>
      </Foot>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Keyboard shortcuts

function KeysDialog() {
  const k = (keys: string[], what: string) => (
    <li key={what + keys.join()}>
      <span>
        {keys.map((x, i) => (
          <span key={i}>
            {i ? ' ' : ''}
            <kbd>{x}</kbd>
          </span>
        ))}
      </span>
      {what}
    </li>
  );
  return (
    <Dialog cls="ep-dlg" label="Keyboard shortcuts">
      <DialogHead title="Keyboard shortcuts" />
      <div className="wc-dlg__body">
        <ul className="ep-keys">
          {k(['j'], 'Next row')}
          {k(['k'], 'Previous row')}
          {k(['e'], 'Edit the row (or Enter)')}
          {k(['c'], 'Complete the row, or the selected ones')}
          {k(['n'], 'New action')}
          {k(['/'], 'Search the list')}
          {k(['x'], 'Select the row (or Space)')}
          {k(['Shift', 'click'], 'Select a range')}
          {k(['Ctrl', 'A'], 'Select everything that matches')}
          {k(['u'], 'Undo your last change')}
          {k(['z'], 'Undo your last change')}
          {k(['Ctrl', 'Enter'], 'Save the edit panel')}
          {k(['Esc'], 'Close, or clear the selection')}
          {k(['?'], 'This list')}
        </ul>
      </div>
      <Foot>
        <button type="button" className="h-btn h-btn--primary" onClick={closeDialog} ref={af}>
          Got it
        </button>
      </Foot>
    </Dialog>
  );
}
