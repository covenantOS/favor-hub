// The edit panel: every field of one action in a drawer (Details, Notes, Tags, Attachments) with the partner beside it. Port of
// the panel in public/js/work-edit.js. Each change goes through sendChange (a batch: saved, sent to Blackbaud, checked, undoable),
// and the board shows it at once through the overlay until the board is read again.
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { WcError, wcApi, wcForm, reqId } from './api';
import { CATS, Chip, Field, PeopleChips, StatusLine, plain, todayET, useCodes, useW } from './editKit';
import { openCopy, openDelete, openNext } from './EditDialogs';
import { driveBatch, loadRecent, sendChange, toast, workNow } from './engine';
import { money } from './model';
import { openOpp } from './OppDialog';
import { PartnerGlance } from './PartnerGlance';
import { recurDraft, recurOut, RecurEditor, type RecurDraft, type RecurRule } from './RecurEditor';
import { closeDialog, openDialog, setGone, dropOverlay, setOverlay } from './store';
import { Drawer, Ic } from './ui';

type Rec = Record<string, unknown>;
interface ActionDetail extends Rec {
  id: string;
  cid: string;
  type: string;
  category: string;
  status: string;
  completed?: boolean;
  summary: string;
  description: string;
  date: string;
  start_time: string;
  end_time: string;
  completed_date: string;
  outcome: string;
  priority: string;
  direction: string;
  location: string;
  opportunity_id: string;
  fundraisers: string[];
  tags: { category: string; value: string }[];
  recur?: RecurRule | null;
  added: string;
  author?: string;
  modified?: string;
  pending?: unknown;
}
interface PartnerBrief {
  name: string;
  opps?: { id: string; name: string; status?: string }[];
  holders?: { fid: string; type?: string }[];
}
interface Conflict {
  fields: string[];
  current: Rec;
}
interface NoteRow {
  id: string;
  type: string;
  summary: string;
  text: string;
  author?: string;
  date?: { y?: number; m?: number; d?: number };
}
interface TagRow {
  id: string;
  category: string;
  value: unknown;
}
interface FileRow {
  id: string;
  type: string;
  name?: string;
  file?: string;
  url?: string;
  date?: string;
}
type Extra<T> = T[] | { error: string } | undefined;

const TABS: [string, string][] = [
  ['details', 'Details'],
  ['notes', 'Notes'],
  ['tags', 'Tags'],
  ['files', 'Attachments'],
];
const WHAT: Record<string, string> = { notes: 'notes', tags: 'tags', files: 'attachments' };
const LAB: Record<string, string> = { summary: 'Summary', description: 'Description', date: 'Date', fundraisers: 'Fundraisers', category: 'Category', type: 'Type', status: 'Status', priority: 'Priority', location: 'Location', outcome: 'Outcome', direction: 'Direction' };
// The seven tags one click away, and the two that carry a number.
const QUICK_TAGS = ['Thanked', 'Texted', 'Stewardship', 'Scheduling', 'Favor Presentation', 'Attended Event', 'Hosted Event'];
const QUICK_NUMS: [string, string, string][] = [
  ['Amount of Ask', 'Amount of Ask', 'Dollars'],
  ['Number of Referrals', 'Number of Referrals', 'Count'],
];
const QUICK_ALL = QUICK_TAGS.concat(QUICK_NUMS.map((x) => x[0]));
const BB = 'https://host.nxt.blackbaud.com/constituent/records/';
const ENV = '?envid=p-5_k5FlbubEyEQnUJw7C9Rw';

const s = (v: unknown) => (v == null ? '' : String(v));
const copy = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** The short labels the Open actions list shows for the tags on an action. */
function tagLabels(list: TagRow[]): string[] {
  const by: Record<string, unknown> = {};
  for (const t of list) by[t.category] = t.value;
  const out = QUICK_TAGS.filter((c) => c in by);
  if (Number(by['Amount of Ask']) > 0) out.push('Ask ' + money(by['Amount of Ask']));
  if (Number(by['Number of Referrals']) > 0) out.push(Number(by['Number of Referrals']) + (Number(by['Number of Referrals']) === 1 ? ' referral' : ' referrals'));
  return out;
}

export function openEditPanel(id: string): void {
  openDialog(<EditPanel id={id} />);
}

function EditPanel({ id }: { id: string }) {
  const w = useW();
  const { codes: C } = useCodes();
  const a0 = w?.byId[id];
  const today = w?.today || todayET();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState('');
  const [partner, setPartner] = useState<PartnerBrief | null>(null);
  const [act, setAct] = useState<ActionDetail | null>(null);
  const [orig, setOrig] = useState<ActionDetail | null>(null);
  const [dirty, setDirty] = useState<Rec>({});
  const [recur, setRecur] = useState<RecurDraft>(recurDraft(null));
  const [recurDirty, setRecurDirty] = useState(false);
  const [tab, setTab] = useState('details');
  const [foot, setFoot] = useState<[string, string] | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [ex, setEx] = useState<Record<string, Extra<NoteRow | TagRow | FileRow>>>({});
  const live = useRef({ act, orig, dirty, recur, recurDirty, foot });
  live.current = { act, orig, dirty, recur, recurDirty, foot };
  const mounted = useRef(true);
  const loads = useRef<Record<string, Promise<Extra<NoteRow | TagRow | FileRow>> | undefined>>({});
  const sum = useRef<HTMLInputElement>(null);
  const [side, setSide] = useState(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (window.matchMedia('(max-width: 860px)').matches) setSide(false);
  }, []);
  useEffect(() => {
    let off = false;
    wcApi<{ action: ActionDetail; partner: PartnerBrief }>('/api/work/actions/' + encodeURIComponent(id))
      .then((d) => {
        if (off) return;
        const a = { ...d.action, tags: d.action.tags || [], fundraisers: d.action.fundraisers || [] };
        setAct(a);
        setOrig(copy(a));
        setPartner(d.partner);
        setRecur(recurDraft(a.recur));
        setPhase('ready');
      })
      .catch((e: Error) => {
        if (off) return;
        setErr(e.message);
        setPhase('error');
      });
    return () => {
      off = true;
    };
  }, [id]);

  // The summary takes the cursor when the details open, except on a touch screen where it would raise the keyboard.
  useEffect(() => {
    if (phase === 'ready' && tab === 'details' && !window.matchMedia('(pointer: coarse)').matches) sum.current?.focus();
  }, [phase, tab]);

  const mark = (k: string, v: unknown) => {
    setAct((a) => (a ? { ...a, [k]: v } : a));
    setDirty((d) => {
      const n = { ...d };
      if (JSON.stringify(live.current.orig?.[k] ?? '') === JSON.stringify(v ?? '')) delete n[k];
      else n[k] = v;
      return n;
    });
    setFoot(null);
  };

  const showConflict = (c: Conflict) => setConflict(c);

  const savePanel = async (extra: Rec = {}, over?: ActionDetail) => {
    const L = live.current;
    if (!L.act) return;
    const set: Rec = { ...L.dirty, ...extra };
    const base = over || L.orig || L.act;
    const seen: Rec = {};
    Object.keys(set).forEach((k) => {
      seen[k] = base[k];
    });
    const params: Rec = { op: 'edit', ids: [id], set, seen };
    if (L.recurDirty) params.recur = recurOut(L.recur) || null;
    const row = workNow()?.byId[id];
    // Optimistic: the board shows the change at once; a refusal puts it back.
    if (row) {
      const o: Record<string, unknown> = {};
      if (set.date) o.due = set.date;
      if (set.fundraisers) o.f = set.fundraisers;
      if (set.summary !== undefined) o.sum = set.summary;
      if (set.category) o.cat = set.category;
      if (set.type) o.type = set.type;
      if (Object.keys(o).length) setOverlay(id, o);
      if (set.status === 'Completed' || set.status === 'Canceled' || set.completed === true) setGone([id], true);
    }
    const label = set.status === 'Completed' || set.completed ? 'Marked complete' : 'Saved the action';
    const r = await sendChange(params, {
      label,
      say: (st, t, cf) => {
        if (!mounted.current) return;
        setFoot([st, t]);
        if (cf) showConflict(cf as Conflict);
      },
      revert: () => {
        if (row) {
          dropOverlay(id);
          setGone([id], false);
        }
      },
    });
    if (r.ok && mounted.current) {
      let a2 = live.current.act as ActionDetail;
      if (set.status === 'Completed' || set.completed) a2 = { ...a2, completed: true, status: 'Completed' };
      setAct(a2);
      setOrig(copy(a2));
      setDirty({});
      setRecurDirty(false);
      const f = live.current.foot;
      setFoot(f ? f : ['saved', 'Saved']);
    }
    return r;
  };

  const keepMine = () => {
    if (!conflict || !live.current.orig) return;
    const o = { ...live.current.orig };
    conflict.fields.forEach((f) => {
      o[f] = conflict.current[f];
    });
    setOrig(o);
    setConflict(null);
    void savePanel({}, o);
  };
  const takeTheirs = () => {
    if (!conflict) return;
    const patch: Rec = {};
    conflict.fields.forEach((f) => {
      patch[f] = f === 'date' ? s(conflict.current[f]).slice(0, 10) : conflict.current[f];
    });
    setAct((a) => (a ? { ...a, ...patch } : a));
    setOrig((o) => (o ? { ...o, ...patch } : o));
    setDirty((d) => {
      const n = { ...d };
      conflict.fields.forEach((f) => delete n[f]);
      return n;
    });
    setConflict(null);
    setFoot(null);
  };

  // Ctrl+Enter (or Cmd+Enter) saves.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const L = live.current;
        if (L.act && (Object.keys(L.dirty).length || L.recurDirty)) {
          e.preventDefault();
          void savePanel();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
    // savePanel reads everything it needs from live.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notes, tags and attachments: read when the tab opens (one Blackbaud call each, kept ten minutes by the server).
  const loadExtra = useCallback(
    (what: string, fresh: boolean) => {
      const going = loads.current[what];
      if (going) return going;
      const pr = (async () => {
        let rows: Extra<NoteRow | TagRow | FileRow>;
        try {
          const r = await wcApi<{ rows?: (NoteRow | TagRow | FileRow)[] }>(`/api/work/actions/${encodeURIComponent(id)}/extra?what=${WHAT[what]}${fresh ? '&fresh=1' : ''}`);
          rows = r.rows || [];
        } catch (e) {
          rows = { error: (e as Error).message };
        }
        delete loads.current[what];
        if (mounted.current) setEx((x) => ({ ...x, [what]: rows }));
        return rows;
      })();
      loads.current[what] = pr;
      return pr;
    },
    [id]
  );
  useEffect(() => {
    if (phase === 'ready' && tab !== 'details' && ex[tab] === undefined) void loadExtra(tab, false);
  }, [phase, tab, ex, loadExtra]);

  const syncTagLabels = (rows: TagRow[]) => {
    setOverlay(id, { tg: tagLabels(rows) });
    setAct((a) => (a ? { ...a, tags: rows.map((t) => ({ category: t.category, value: s(t.value) })) } : a));
  };
  const extraChange = async (params: Rec, what: string, label: string) => {
    const r = await sendChange({ ids: [id], ...params }, {
      label,
      say: (st, t) => {
        if (mounted.current) setFoot([st, t]);
      },
    });
    if (!mounted.current) return r;
    const pr = loadExtra(what, true);
    setEx((x) => ({ ...x, [what]: undefined }));
    const rows = await pr;
    if (what === 'tags' && r && r.ok && Array.isArray(rows)) syncTagLabels(rows as TagRow[]);
    return r;
  };

  const done = !!act && (act.status === 'Completed' || !!act.completed);
  const dirtyAny = Object.keys(dirty).length > 0 || recurDirty;

  return (
    <Drawer label="Edit action" cls="ep">
      <div className="wc-dlg__head ep-head">
        <div>
          <span className="h-label">{act ? (act.type || 'Action') + ' · ' + (act.category || '') : a0 ? a0.type + ' · ' + a0.cat : 'Action'}</span>
          <h2>{partner ? partner.name : a0 ? a0.p : 'Loading…'}</h2>
          <p className="ep-sub">
            {act ? (
              <>
                {a0 ? (a0.loc || 'No city on file') + ' · ' : ''}Action {act.id} · <a href={'/work/partner/' + act.cid}>Partner page</a> ·{' '}
                <a href={BB + act.cid + ENV} target="_blank" rel="noopener">
                  Open in Blackbaud
                </a>
              </>
            ) : a0 ? (
              <>
                {a0.loc || 'No city on file'} · <a href={'/work/partner/' + a0.cid}>Partner page</a>
              </>
            ) : null}
          </p>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close (Esc)" onClick={closeDialog}>
          <Ic n="x" />
        </button>
      </div>
      <div className="ep-body">
        <div className="ep-main">
          {phase === 'loading' ? <div className="h-skel" style={{ height: 420, borderRadius: 16 }} /> : null}
          {phase === 'error' ? (
            <div className="wc-warn">
              <Ic n="alert" />
              <span>{err}</span>
            </div>
          ) : null}
          {phase === 'ready' && act && partner ? (
            <>
              {conflict ? (
                <div className="wc-warn ep-conflict">
                  <Ic n="alert" />
                  <span>
                    <b>Changed in Blackbaud after you opened it.</b>{' '}
                    {conflict.fields
                      .map((f) => {
                        const v = conflict.current[f];
                        return `${LAB[f] || f} is now “${Array.isArray(v) ? v.map((x) => (w ? w.P(String(x)).n : String(x))).join(', ') : String(v ?? 'empty').slice(0, 80)}”`;
                      })
                      .join('; ')}
                    .{' '}
                    <button type="button" className="wc-linkbtn" onClick={keepMine}>
                      Keep mine and save
                    </button>{' '}
                    <button type="button" className="wc-linkbtn" onClick={takeTheirs}>
                      Use theirs
                    </button>
                  </span>
                </div>
              ) : null}
              <div className="ep-tabs" role="tablist">
                {TABS.map(([k, l]) => (
                  <button key={k} type="button" role="tab" className={'ep-tab' + (tab === k ? ' is-on' : '')} aria-selected={tab === k} onClick={() => setTab(k)}>
                    {l}
                    {k === 'tags' && act.tags.length ? <> <i>{act.tags.length}</i></> : null}
                  </button>
                ))}
              </div>
              <div className="ep-pane" id="ep-pane">
                {tab === 'details' ? (
                  <Details
                    act={act}
                    partner={partner}
                    done={done}
                    today={today}
                    w={w}
                    types={C.types || []}
                    statuses={C.statuses || ['Open', 'Completed', 'Canceled']}
                    locations={C.locations || []}
                    sum={sum}
                    recur={recur}
                    onRecur={(v) => {
                      setRecur(v);
                      setRecurDirty(true);
                      setFoot(null);
                    }}
                    mark={mark}
                    onStatus={(v) => {
                      mark('status', v);
                      setAct((a) => (a ? { ...a, completed: v === 'Completed' } : a));
                      if (v === 'Completed' && !live.current.act?.completed_date) mark('completed_date', today);
                    }}
                    onNewOpp={() =>
                      openOpp(null, {
                        cid: act.cid,
                        name: partner.name,
                        link: id,
                        after: () => {
                          closeDialog();
                          setTimeout(() => openEditPanel(id), 260);
                        },
                      })
                    }
                  />
                ) : tab === 'notes' ? (
                  <NotesPane rows={ex.notes as Extra<NoteRow>} noteTypes={(C.noteTypes as string[] | undefined) || ['RDD Note']} fd={w ? w.fd : (x) => s(x)} onChange={(p, l) => extraChange(p, 'notes', l)} />
                ) : tab === 'tags' ? (
                  <TagsPane rows={ex.tags as Extra<TagRow>} cats={C.tagCategories || []} onChange={(p, l) => extraChange(p, 'tags', l)} />
                ) : (
                  <FilesPane
                    rows={ex.files as Extra<FileRow>}
                    fd={w ? w.fd : (x) => s(x)}
                    onChange={(p, l) => extraChange(p, 'files', l)}
                    onUpload={async (file) => {
                      setFoot(['saving', 'Uploading ' + file.name + '…']);
                      const fdata = new FormData();
                      fdata.append('file', file);
                      fdata.append('req', reqId());
                      try {
                        const out = await wcForm<{ batch?: { id?: string } }>(`/api/work/actions/${encodeURIComponent(id)}/upload`, fdata);
                        if (out.batch && out.batch.id) {
                          await driveBatch(out.batch.id, [id], { keep: true });
                          await loadRecent();
                        }
                        if (mounted.current) setFoot(['saved', 'Attached ' + file.name]);
                        toast('Attached ' + file.name + '.', out.batch && out.batch.id);
                        const pr = loadExtra('files', true);
                        if (mounted.current) setEx((x) => ({ ...x, files: undefined }));
                        await pr;
                      } catch (er) {
                        const msg = er instanceof WcError ? (er.data.message as string) || 'The file did not upload.' : (er as Error).message;
                        if (mounted.current) setFoot(['failed', msg]);
                      }
                    }}
                  />
                )}
              </div>
            </>
          ) : null}
        </div>
        <div className="ep-side" id="ep-side">
          {act ? (
            <details className="ep-ctx" open={side} onToggle={(e) => setSide((e.currentTarget as HTMLDetailsElement).open)}>
              <summary>About this partner</summary>
              <div id="ep-pv">{side ? <PartnerGlance cid={act.cid} /> : null}</div>
            </details>
          ) : null}
        </div>
      </div>
      <div className="ep-foot">
        {phase === 'ready' && act && partner ? (
          <>
            <div className="ep-foot__more">
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" title="Copy this action to this partner or others" onClick={() => openCopy(id, 'dup', hintOf(act, partner))}>
                Duplicate
              </button>
              {w?.me.canMove ? (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm" title="Move it to another partner" onClick={() => openCopy(id, 'move', hintOf(act, partner))}>
                  Move
                </button>
              ) : null}
              {w?.me.canDelete ? (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm ep-del" onClick={() => openDelete([id])}>
                  Delete
                </button>
              ) : null}
            </div>
            <div className="ep-foot__main">
              {foot ? <StatusLine state={foot[0]} text={foot[1]} /> : dirtyAny ? <StatusLine state="dirty" text="Not saved yet" /> : <span className="ep-state" />}
              {done ? null : (
                <>
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" title="Complete this one and schedule the next" onClick={() => openNext(id, hintOf(act, partner))}>
                    <Ic n="cal" />
                    Complete and next
                  </button>
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" title="Mark complete (c)" onClick={() => void savePanel({ status: 'Completed', completed: true })}>
                    <Ic n="check" />
                    Complete
                  </button>
                </>
              )}
              <button type="button" className="h-btn h-btn--primary h-btn--sm" disabled={!dirtyAny} title="Save (Ctrl+Enter)" onClick={() => void savePanel()}>
                Save
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}

const hintOf = (a: ActionDetail, p: PartnerBrief) => ({ p: p.name, cid: a.cid, sum: a.summary, cat: a.category });

// ------------------------------------------------------------------ Details

function Details(p: {
  act: ActionDetail;
  partner: PartnerBrief;
  done: boolean;
  today: string;
  w: ReturnType<typeof useW>;
  types: string[];
  statuses: string[];
  locations: string[];
  sum: RefObject<HTMLInputElement | null>;
  recur: RecurDraft;
  onRecur: (v: RecurDraft) => void;
  mark: (k: string, v: unknown) => void;
  onStatus: (v: string) => void;
  onNewOpp: () => void;
}) {
  const { act: a, partner, done, today, w, mark } = p;
  const opps = partner.opps || [];
  const fr = a.fundraisers;
  return (
    <>
      <div className="wc-field">
        <label htmlFor="ep-sum" className="lab">
          Summary
        </label>
        <input ref={p.sum} type="text" id="ep-sum" maxLength={255} value={s(a.summary)} placeholder="What happened, or what to do" onChange={(e) => mark('summary', e.target.value)} />
      </div>
      <Field label="Category">
        <div className="wc-choices">
          {CATS.map(([v, l, i]) => (
            <Chip key={v} icon={i} on={a.category === v} onClick={() => mark('category', v)}>
              {l}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="wc-row2">
        <Field label="Type">
          <select value={s(a.type)} onChange={(e) => mark('type', e.target.value)}>
            <option value="">No type</option>
            {p.types.map((t) => (
              <option key={t} value={t}>
                {plain(t)}
              </option>
            ))}
            {a.type && !p.types.includes(a.type) ? <option value={a.type}>{a.type}</option> : null}
          </select>
        </Field>
        <Field label="Status">
          <div className="wc-choices">
            {p.statuses.map((st) => (
              <Chip key={st} on={a.status === st || (st === 'Open' && /past due/i.test(a.status))} onClick={() => p.onStatus(st)}>
                {st}
              </Chip>
            ))}
          </div>
        </Field>
      </div>
      <div className="wc-row3">
        <Field label={done ? 'Date' : 'Due'}>
          <input type="date" value={s(a.date)} onChange={(e) => mark('date', e.target.value)} />
        </Field>
        <Field label="Start">
          <input type="time" value={s(a.start_time)} onChange={(e) => mark('start_time', e.target.value)} />
        </Field>
        <Field label="End">
          <input type="time" value={s(a.end_time)} onChange={(e) => mark('end_time', e.target.value)} />
        </Field>
      </div>
      {done ? (
        <div className="wc-row2">
          <Field label="Completed on">
            <input type="date" value={s(a.completed_date)} max={today} onChange={(e) => mark('completed_date', e.target.value)} />
          </Field>
          <Field label="Outcome">
            <div className="wc-choices">
              {[
                ['', 'None'],
                ['Successful', 'Good'],
                ['Unsuccessful', 'Not good'],
              ].map(([v, l]) => (
                <Chip key={v} on={a.outcome === v} onClick={() => mark('outcome', v)}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>
        </div>
      ) : null}
      <div className="wc-row2">
        <Field label="Priority">
          <div className="wc-choices">
            {['Low', 'Normal', 'High'].map((pr) => (
              <Chip key={pr} on={a.priority === pr} onClick={() => mark('priority', pr)}>
                {pr}
              </Chip>
            ))}
          </div>
        </Field>
        {['Phone call', 'Email', 'Mailing'].includes(a.category) ? (
          <Field label="Direction">
            <div className="wc-choices">
              {[
                ['', 'None'],
                ['Outbound', 'Out'],
                ['Inbound', 'In'],
              ].map(([v, l]) => (
                <Chip key={v} on={a.direction === v} onClick={() => mark('direction', v)}>
                  {l}
                </Chip>
              ))}
            </div>
          </Field>
        ) : (
          <div />
        )}
      </div>
      <div className="wc-row2">
        {a.category === 'Meeting' ? (
          <Field label="Location">
            <select value={s(a.location)} onChange={(e) => mark('location', e.target.value)}>
              <option value="">None</option>
              {p.locations.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div />
        )}
        <Field label="Opportunity">
          <select value={s(a.opportunity_id)} onChange={(e) => mark('opportunity_id', e.target.value)}>
            <option value="">None</option>
            {opps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name + (o.status ? ' · ' + o.status : '')}
              </option>
            ))}
          </select>
          <button type="button" className="wc-linkbtn" onClick={p.onNewOpp}>
            New opportunity for this partner
          </button>
        </Field>
      </div>
      <Field label="Fundraisers">
        <PeopleChips list={fr} w={w} onRemove={(f) => mark('fundraisers', fr.filter((x) => x !== f))} onAdd={(f) => mark('fundraisers', fr.concat([f]))} />
        {partner.holders && partner.holders.length ? <small>Held by {partner.holders.map((h) => (w ? w.P(h.fid).n : h.fid) + (h.type ? ' (' + h.type + ')' : '')).join(', ')}</small> : null}
      </Field>
      <div className="wc-field">
        <label htmlFor="ep-desc" className="lab">
          Description
        </label>
        <textarea id="ep-desc" rows={5} value={s(a.description)} onChange={(e) => mark('description', e.target.value)} />
      </div>
      {done ? null : <RecurEditor value={p.recur} onChange={p.onRecur} />}
      <p className="ep-meta">
        Added {s(a.added).slice(0, 10)}
        {a.author ? ' by ' + a.author : ''}
        {a.modified ? ' · Changed ' + s(a.modified).slice(0, 10) : ''}
        {a.pending ? ' · A change from here is still on its way to Blackbaud' : ''}
      </p>
    </>
  );
}

// ------------------------------------------------------------------ Notes

function Skel120() {
  return <div className="h-skel" style={{ height: 120, borderRadius: 14 }} />;
}
function Warn({ text }: { text: string }) {
  return (
    <div className="wc-warn">
      <Ic n="alert" />
      <span>{text}</span>
    </div>
  );
}

function NotesPane({ rows, noteTypes, fd, onChange }: { rows: Extra<NoteRow>; noteTypes: string[]; fd: (iso: string, yr?: boolean) => string; onChange: (p: Rec, label: string) => Promise<unknown> }) {
  const [form, setForm] = useState<{ id: string; type: string; summary: string; text: string }>({ id: '', type: '', summary: '', text: '' });
  if (rows === undefined) return <Skel120 />;
  const list = Array.isArray(rows) ? rows : [];
  const type = form.type || noteTypes[0] || 'RDD Note';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.summary && !form.text) return;
    const note: Rec = { type, summary: form.summary, text: form.text };
    if (form.id) note.id = form.id;
    setForm({ id: '', type: '', summary: '', text: '' });
    await onChange({ op: 'note', note }, form.id ? 'Saved the note' : 'Added the note');
  };
  return (
    <>
      {!Array.isArray(rows) ? <Warn text={rows.error} /> : null}
      <div className="ep-list">
        {list.length ? (
          list.map((n) => (
            <div key={n.id} className="ep-note">
              <div>
                <b>{n.summary || n.type}</b>
                <span className="wc-sub">
                  {n.type}
                  {n.date && n.date.y ? ' · ' + fd(`${n.date.y}-${String(n.date.m || 1).padStart(2, '0')}-${String(n.date.d || 1).padStart(2, '0')}`, true) : ''}
                  {n.author ? ' · ' + n.author : ''}
                </span>
                <p>{n.text}</p>
              </div>
              <div className="ep-note__acts">
                <button type="button" className="wc-linkbtn" onClick={() => setForm({ id: n.id, type: n.type, summary: n.summary, text: n.text })}>
                  Edit
                </button>
                <button type="button" className="wc-linkbtn ep-del" onClick={() => void onChange({ op: 'note', note: { id: n.id, remove: true } }, 'Removed the note')}>
                  Remove
                </button>
              </div>
            </div>
          ))
        ) : (
          <p className="wc-note">No notes on this action yet.</p>
        )}
      </div>
      <form className="ep-add" onSubmit={submit}>
        <b className="lab">Add a note</b>
        <div className="wc-row2">
          <select name="type" aria-label="Note type" value={type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {noteTypes.map((t) => (
              <option key={t} value={t}>
                {t.replace(/^Reserved Note \((.*)\)$/, '$1')}
              </option>
            ))}
            {type && !noteTypes.includes(type) ? <option value={type}>{type}</option> : null}
          </select>
          <input type="text" name="summary" maxLength={255} placeholder="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
        </div>
        <textarea name="text" rows={3} placeholder="The note" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <div className="ep-add__acts">
          <button type="submit" className="h-btn h-btn--primary h-btn--sm">
            {form.id ? 'Save the note' : 'Add note'}
          </button>
          {form.id ? (
            <button type="button" className="wc-linkbtn" onClick={() => setForm({ id: '', type: '', summary: '', text: '' })}>
              Cancel the edit
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ Tags

type TagCat = { name: string; type: string; values?: string[] };

/** The value box a tag category needs: a number, a pick from its list, yes or no, or free text. */
function TagValue({ cats, cat, val }: { cats: TagCat[]; cat: string; val?: unknown }) {
  const c = cats.find((x) => x.name === cat);
  if (!c) return <input type="text" name="value" placeholder="Value" />;
  if (c.type === 'Number') return <input type="number" name="value" step="any" defaultValue={s(val)} placeholder="Number" />;
  if (c.type === 'CodeTableEntry' && c.values && c.values.length) {
    return (
      <select name="value" defaultValue={c.values.includes(String(val)) ? String(val) : c.values[0]}>
        {c.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (c.type === 'Boolean') {
    return (
      <select name="value" defaultValue={val === false ? 'false' : 'true'}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  return <input type="text" name="value" defaultValue={s(val ?? (c.type === 'CodeTableEntry' ? c.name : ''))} placeholder="Value" />;
}

function TagsPane({ rows, cats, onChange }: { rows: Extra<TagRow>; cats: TagCat[]; onChange: (p: Rec, label: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState<Record<string, 1>>({});
  const [addCat, setAddCat] = useState('');
  // A new read of the tags lifts the hold on the quick buttons.
  useEffect(() => {
    setBusy({});
  }, [rows]);
  if (rows === undefined) return <Skel120 />;
  const list = Array.isArray(rows) ? rows : [];
  const has = (name: string) => cats.some((c) => c.name === name);
  const reserved = (n: string) => /^RESERVED|^NXT /.test(n);
  const shown = cats.filter((c) => !reserved(c.name) || list.some((t) => t.category === c.name));
  const more = cats.filter((c) => reserved(c.name));
  const other = list.filter((t) => !QUICK_ALL.includes(t.category));
  const addOptions = shown.concat(more);
  const catNow = addCat && addOptions.some((c) => c.name === addCat) ? addCat : shown[0] ? shown[0].name : '';
  const val = (f: HTMLFormElement) => (f.elements.namedItem('value') as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
  return (
    <>
      {!Array.isArray(rows) ? <Warn text={rows.error} /> : null}
      <div className="ep-quicktags">
        <span className="lab">Tags</span>
        <div className="wc-choices" role="group" aria-label="Tags">
          {QUICK_TAGS.filter(has).map((c) => {
            const on = list.find((t) => t.category === c);
            return (
              <Chip
                key={c}
                on={!!on}
                pressed={!!on}
                icon={on ? 'check' : 'plus'}
                disabled={!!busy[c]}
                onClick={() => {
                  if (busy[c]) return;
                  setBusy((b) => ({ ...b, [c]: 1 }));
                  if (on) void onChange({ op: 'edit', set: {}, tags: { remove: [{ id: on.id, category: c }] } }, 'Removed the ' + c + ' tag');
                  else void onChange({ op: 'edit', set: {}, tags: { add: [{ category: c }] } }, 'Tagged ' + c);
                }}
              >
                {c}
              </Chip>
            );
          })}
        </div>
        <div className="ep-qnums">
          {QUICK_NUMS.filter(([c]) => has(c)).map(([c, l, ph]) => {
            const on = list.find((t) => t.category === c);
            return (
              <form
                key={c + (on ? on.id + s(on.value) : '')}
                className="ep-qnum"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const raw = String(val(e.currentTarget)).replace(/[$,\s]/g, '');
                  const n = Number(raw);
                  if (!raw || !Number.isFinite(n) || n < 0) return;
                  if (on) await onChange({ op: 'edit', set: {}, tags: { change: [{ id: on.id, value: n }] } }, 'Changed ' + c);
                  else await onChange({ op: 'edit', set: {}, tags: { add: [{ category: c, value: n }] } }, 'Added ' + c);
                }}
              >
                <label>
                  <span>{l}</span>
                  <input type="number" name="value" min={0} step="any" inputMode="decimal" placeholder={ph} defaultValue={on ? s(on.value) : ''} required />
                </label>
                <button type="submit" className="h-btn h-btn--ghost h-btn--sm">
                  {on ? 'Change' : 'Add'}
                </button>
                {on ? (
                  <button type="button" className="wc-linkbtn ep-del" onClick={() => void onChange({ op: 'edit', set: {}, tags: { remove: [{ id: on.id, category: c }] } }, 'Removed the ' + c + ' tag')}>
                    Remove
                  </button>
                ) : null}
              </form>
            );
          })}
        </div>
      </div>
      {other.length ? (
        <div className="ep-list">
          {other.map((t) => (
            <form
              key={t.id + s(t.value)}
              className="ep-tag"
              onSubmit={async (e) => {
                e.preventDefault();
                const el = e.currentTarget.elements.namedItem('value') as HTMLInputElement | HTMLSelectElement;
                await onChange({ op: 'edit', set: {}, tags: { change: [{ id: t.id, value: el.type === 'number' ? Number(el.value) : el.value }] } }, 'Changed the tag');
              }}
            >
              <b>{t.category}</b>
              <TagValue cats={cats} cat={t.category} val={t.value} />
              <button type="submit" className="wc-linkbtn">
                Change
              </button>
              <button type="button" className="wc-linkbtn ep-del" onClick={() => void onChange({ op: 'edit', set: {}, tags: { remove: [{ id: t.id, category: t.category }] } }, 'Removed the ' + t.category + ' tag')}>
                Remove
              </button>
            </form>
          ))}
        </div>
      ) : null}
      <form
        className="ep-add"
        onSubmit={async (e) => {
          e.preventDefault();
          await onChange({ op: 'edit', set: {}, tags: { add: [{ category: catNow, value: val(e.currentTarget) }] } }, 'Added the tag');
        }}
      >
        <b className="lab">Add a tag with a value</b>
        <div className="wc-row2">
          <select name="category" aria-label="Tag" value={catNow} onChange={(e) => setAddCat(e.target.value)}>
            {addOptions.map((c, i) => (
              <option key={c.name + i} value={c.name}>
                {c.name.replace(/^RESERVED \((.*)\)$/, '$1')}
              </option>
            ))}
          </select>
          <span key={catNow}>
            <TagValue cats={cats} cat={catNow} />
          </span>
        </div>
        <div className="ep-add__acts">
          <button type="submit" className="h-btn h-btn--primary h-btn--sm">
            Add tag
          </button>
        </div>
      </form>
    </>
  );
}

// ------------------------------------------------------------------ Attachments

function FilesPane({ rows, fd, onChange, onUpload }: { rows: Extra<FileRow>; fd: (iso: string, yr?: boolean) => string; onChange: (p: Rec, label: string) => Promise<unknown>; onUpload: (f: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const fileBox = useRef<HTMLInputElement>(null);
  if (rows === undefined) return <Skel120 />;
  const list = Array.isArray(rows) ? rows : [];
  return (
    <>
      {!Array.isArray(rows) ? <Warn text={rows.error} /> : null}
      <div className="ep-list">
        {list.length ? (
          list.map((f) => (
            <div key={f.id} className="ep-file">
              <span>
                <Ic n={f.type === 'Link' ? 'ext' : 'clip'} />
              </span>
              <div>
                <b>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener">
                      {f.name || f.url}
                    </a>
                  ) : (
                    f.name || f.file
                  )}
                </b>
                <span className="wc-sub">
                  {f.type}
                  {f.file ? ' · ' + f.file : ''}
                  {f.date ? ' · ' + fd(f.date, true) : ''}
                </span>
              </div>
              <button type="button" className="wc-linkbtn ep-del" onClick={() => void onChange({ op: 'attach', attach: { id: f.id, remove: true } }, 'Removed the attachment')}>
                Remove
              </button>
            </div>
          ))
        ) : (
          <p className="wc-note">No attachments on this action yet.</p>
        )}
      </div>
      <form
        className="ep-add"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = e.currentTarget;
          const url = (f.elements.namedItem('url') as HTMLInputElement).value;
          const name = (f.elements.namedItem('name') as HTMLInputElement).value;
          f.reset();
          await onChange({ op: 'attach', attach: { url, name } }, 'Attached the link');
        }}
      >
        <b className="lab">Attach a link</b>
        <div className="wc-row2">
          <input type="url" name="url" placeholder="https://" required />
          <input type="text" name="name" maxLength={150} placeholder="Name (optional)" />
        </div>
        <div className="ep-add__acts">
          <button type="submit" className="h-btn h-btn--primary h-btn--sm">
            Attach link
          </button>
        </div>
      </form>
      <form
        className="ep-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          const f = file;
          setFile(null);
          if (fileBox.current) fileBox.current.value = '';
          await onUpload(f);
        }}
      >
        <b className="lab">Attach a file</b>
        <input ref={fileBox} type="file" name="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <small>Up to 10 MB.</small>
        <div className="ep-add__acts">
          <button type="submit" className="h-btn h-btn--ghost h-btn--sm">
            Upload
          </button>
        </div>
      </form>
    </>
  );
}
