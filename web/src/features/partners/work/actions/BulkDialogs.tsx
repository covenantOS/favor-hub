// Mark complete, Reassign and Reschedule for one or many actions (public/js/work.js dlgComplete, dlgReassign, dlgReschedule). Each builds
// the same batch the classic page sent (op complete / close_thanked, reassign, reschedule) and hands it to runJob.
import { useState } from 'react';
import { budgetLine, completeCost, costOf, meterNow, runJob, workNow } from './engine';
import { addDays, et, plural } from './model';
import type { Work } from './model';
import { closeDialog, openDialog, setGone, setOverlay } from './store';
import { Dialog, DialogHead, Ic } from './ui';
import type { Act } from './types';

const dateInput = { width: 170, height: 34, borderRadius: 999, border: '1px solid var(--h-line-2)', padding: '0 12px', background: '#fff' } as const;
const HOW_CAT: Record<string, string> = { letter: 'Mailing', card: 'Mailing', call: 'Phone call', text: 'Phone call', email: 'Email', visit: 'Meeting' };
const HOW_WORD: Record<string, string> = { letter: 'letters', card: 'cards', call: 'calls', text: 'texts', email: 'emails', visit: 'visits' };

function Budget({ calls }: { calls: number }) {
  const b = budgetLine(calls);
  if (!b.tonight) return null;
  return (
    <div className="wc-warn">
      <Ic n="clock" />
      <span>
        <b>These go to Blackbaud tonight.</b> They send after {meterNow().resets}, when the daily count starts again.
      </span>
    </div>
  );
}

function WhoCounts({ w, ids }: { w: Work; ids: string[] }) {
  const m: Record<string, number> = {};
  ids.forEach((id) => w.cur(w.byId[id]).f.forEach((x) => (m[x] = (m[x] || 0) + 1)));
  return (
    <div className="who">
      {Object.entries(m)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (
          <span key={k} className="wc-tag">
            {w.P(k).n} {n}
          </span>
        ))}
    </div>
  );
}

// ------------------------------------------------------------------ Mark complete
export function openComplete(ids: string[], mode?: 'close', init?: { line?: string }) {
  const w = workNow();
  if (!w || !ids.length) return;
  openDialog(<CompleteDialog ids={ids} mode={mode} w={w} line0={init?.line} />);
}
function CompleteDialog({ ids, mode, w, line0 }: { ids: string[]; mode?: 'close'; w: Work; line0?: string }) {
  const TODAY = w.today;
  const tys = ids.filter((id) => w.byId[id].ty);
  const closeAsThanked = mode === 'close';
  const [date, setDate] = useState(TODAY);
  const [own, setOwn] = useState(false);
  const [how, setHow] = useState(closeAsThanked ? 'logged' : '');
  const [line, setLine] = useState(line0 || '');
  const [out, setOut] = useState('');
  const calls = completeCost(ids, closeAsThanked ? 'logged' : how, w.byId);
  const go = () => {
    const tonight = budgetLine(calls).tonight;
    closeDialog();
    const label = closeAsThanked
      ? `Closed ${plural(ids.length, 'thank-you task')} as thanked`
      : `Marked ${plural(ids.length, 'action')} complete` + (how && how !== 'none' ? ' as thank-you ' + HOW_WORD[how] : '');
    const params = closeAsThanked ? { op: 'close_thanked' } : { op: 'complete', date: own ? null : date, own, line, outcome: out, how };
    void runJob({ params, ids, label, calls, tonight, gone: true, apply: (id) => setGone([id], true) });
  };
  return (
    <Dialog label="Mark complete">
      <DialogHead
        title={closeAsThanked ? 'Close ' + plural(ids.length, 'task') + ' as thanked' : 'Mark ' + plural(ids.length, 'action') + ' complete'}
        sub={closeAsThanked ? 'A thank-you is already in Blackbaud for each of these. Nothing new is written; each task closes on the day its thank-you was logged.' : 'Each action keeps its own summary.'}
      />
      <div className="wc-dlg__body">
        {closeAsThanked ? null : (
          <>
            <div className="wc-field">
              <span className="lab">Completed on</span>
              <div className="wc-choices">
                {(
                  [
                    ['today', 'Today', TODAY],
                    ['yday', 'Yesterday', addDays(TODAY, -1)],
                    ['own', "Each one's due date", ''],
                  ] as [string, string, string][]
                ).map(([k, l, v]) => (
                  <button
                    key={k}
                    type="button"
                    className={'wc-choice' + ((k === 'own' ? own : !own && date === v) ? ' is-on' : '')}
                    onClick={() => {
                      if (k === 'own') setOwn(true);
                      else {
                        setOwn(false);
                        setDate(v);
                      }
                    }}
                  >
                    {l}
                  </button>
                ))}
                <input type="date" value={own ? '' : date} max={TODAY} aria-label="Completed on" style={dateInput} onChange={(e) => e.target.value && (setOwn(false), setDate(e.target.value))} />
              </div>
            </div>
            {tys.length ? (
              <div className="wc-field">
                <span className="lab">{tys.length === ids.length ? 'How did the thank-you go out?' : `${tys.length} of these are thank-you tasks. How did the thank-you go out?`}</span>
                <div className="wc-choices">
                  {(
                    [
                      ['letter', 'Letter', 'letter'],
                      ['card', 'Card', 'letter'],
                      ['call', 'Call', 'phone'],
                      ['text', 'Text', 'phone'],
                      ['email', 'Email', 'mail'],
                      ['visit', 'Visit', 'meet'],
                      ['none', 'Close only', 'x'],
                    ] as [string, string, string][]
                  ).map(([k, l, i]) => (
                    <button key={k} type="button" className={'wc-choice' + (how === k ? ' is-on' : '')} onClick={() => setHow(how === k ? '' : k)}>
                      <Ic n={i} />
                      {l}
                    </button>
                  ))}
                </div>
                <small>{how && how !== 'none' ? `Each thank-you task becomes the fundraiser's ${HOW_CAT[how]} contact with Thanked, so it counts on the KPI dashboard once. No second action is added.` : "Pick how it went out and the task counts as the fundraiser's thank-you contact."}</small>
              </div>
            ) : null}
            <div className="wc-field">
              <label htmlFor="line">
                Add one line to every action <span style={{ fontWeight: 400, color: 'var(--h-ink-3)' }}>(optional)</span>
              </label>
              <input type="text" id="line" maxLength={200} placeholder="For example: Sent thank you letter" value={line} onChange={(e) => setLine(e.target.value)} />
              <small>It goes at the end of each action's description, with today's date and your name.</small>
            </div>
            <div className="wc-field">
              <span className="lab">
                How did it go? <span style={{ fontWeight: 400, color: 'var(--h-ink-3)' }}>(optional)</span>
              </span>
              <div className="wc-choices">
                {(
                  [
                    ['', 'Leave blank'],
                    ['Successful', 'Good'],
                    ['Unsuccessful', 'Not good'],
                  ] as [string, string][]
                ).map(([k, l]) => (
                  <button key={k} type="button" className={'wc-choice' + (out === k ? ' is-on' : '')} onClick={() => setOut(k)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="wc-plan">
          <b>What happens</b>
          <ul>
            <li>
              {plural(ids.length, 'action')} marked complete in Blackbaud{closeAsThanked ? ", each on its thank-you's date" : own ? ', each on its own due date' : ' on ' + w.fd(date, true)}.
            </li>
            <li>They leave this list and every Work Center list at once.</li>
            <li>Undo from Recent until {et(Date.now(), { hour: 'numeric', minute: '2-digit' })} tomorrow.</li>
          </ul>
          <WhoCounts w={w} ids={ids} />
        </div>
        <Budget calls={calls} />
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost" />
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" onClick={go}>
          <Ic n="check" />
          {closeAsThanked ? 'Close ' + ids.length : 'Mark ' + ids.length + ' complete'}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Reassign
export function openReassign(ids: string[]) {
  const w = workNow();
  if (!w || !ids.length) return;
  openDialog(<ReassignDialog ids={ids} w={w} />);
}
function ReassignDialog({ ids, w }: { ids: string[]; w: Work }) {
  const holderFor = (a: Act) => {
    const f = w.cur(a).f;
    return a.hold.find((h) => w.live(h) && !f.includes(h)) || null;
  };
  const curF: Record<string, number> = {};
  ids.forEach((id) => w.cur(w.byId[id]).f.forEach((x) => (curF[x] = (curF[x] || 0) + 1)));
  const depart = Object.keys(curF).filter((x) => !w.live(x));
  const withHolder = ids.filter((id) => holderFor(w.byId[id]));
  const noOne = !Object.keys(curF).length; // none of these has a fundraiser yet, so there is nobody to replace
  const [mode, setMode] = useState<'holder' | 'replace' | 'add'>(noOne ? 'add' : withHolder.length && depart.length ? 'holder' : 'replace');
  const [from, setFrom] = useState(depart[0] || Object.keys(curF)[0] || '');
  const [to, setTo] = useState('');
  const [add, setAdd] = useState('');
  const staff = Object.keys(w.idx.people).filter(w.live).filter(w.mayAssign).sort((a, b) => w.P(a).n.localeCompare(w.P(b).n));
  const next = (a: Act): string[] | null => {
    const c = w.cur(a).f;
    if (mode === 'holder') {
      const h = holderFor(a);
      return h ? c.filter(w.live).concat([h]) : null;
    }
    if (mode === 'replace' && to && c.includes(from)) return c.filter((x) => x !== from).concat(c.includes(to) ? [] : [to]);
    if (mode === 'add' && add && !c.includes(add)) return c.concat([add]);
    return null;
  };
  const changes: Record<string, string[]> = {};
  const m: Record<string, number> = {};
  let n = 0;
  ids.forEach((id) => {
    const a = w.byId[id];
    const nf = next(a);
    if (nf) {
      n++;
      changes[id] = nf;
      nf.forEach((x) => {
        if (!w.cur(a).f.includes(x)) m[x] = (m[x] || 0) + 1;
      });
    }
  });
  const opts = (list: string[]) => list.map((k) => (
    <option key={k} value={k}>
      {w.P(k).n}
      {curF[k] ? ' (' + curF[k] + ')' : ''}
    </option>
  ));
  const go = () => {
    const cids = Object.keys(changes);
    closeDialog();
    void runJob({
      params: { op: 'reassign', mode, from, to, add },
      ids: cids,
      label: `Reassigned ${plural(cids.length, 'action')}`,
      calls: costOf(cids.length),
      tonight: budgetLine(costOf(n)).tonight,
      apply: (id) => setOverlay(id, { f: changes[id] }),
      keep: true,
    });
  };
  return (
    <Dialog label="Reassign">
      <DialogHead title={'Reassign ' + plural(ids.length, 'action')} sub="The partner and the summary stay as they are. Only who the action belongs to changes." />
      <div className="wc-dlg__body">
        <div className="wc-radio">
          <label className={mode === 'holder' ? 'is-on' : ''}>
            <input type="radio" name="m" value="holder" checked={mode === 'holder'} onChange={() => setMode('holder')} />
            <div>
              <b>Give each to its partner's current holder</b>
              <span>
                {withHolder.length} of {ids.length} have a holder who is not on the action yet. Anyone who left Favor comes off. The rest stay as they are.
              </span>
            </div>
          </label>
          {noOne ? null : (
            <label className={mode === 'replace' ? 'is-on' : ''}>
              <input type="radio" name="m" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <div>
                <b>Replace one fundraiser with another</b>
                <div className="inline">
                  <select aria-label="Replace" value={from} onChange={(e) => (setFrom(e.target.value), setMode('replace'))}>
                    {opts(Object.keys(curF))}
                  </select>
                  <span>with</span>
                  <select aria-label="With" value={to} onChange={(e) => (setTo(e.target.value), setMode('replace'))}>
                    <option value="">Pick a person</option>
                    {opts(staff)}
                  </select>
                </div>
              </div>
            </label>
          )}
          <label className={mode === 'add' ? 'is-on' : ''}>
            <input type="radio" name="m" value="add" checked={mode === 'add'} onChange={() => setMode('add')} />
            <div>
              <b>Add a fundraiser to each</b>
              <span>Everyone already on it stays.</span>
              <div className="inline">
                <select aria-label="Add" value={add} onChange={(e) => (setAdd(e.target.value), setMode('add'))}>
                  <option value="">Pick a person</option>
                  {opts(staff)}
                </select>
              </div>
            </div>
          </label>
        </div>
        <div className="wc-plan">
          <b>{n ? plural(n, 'action') + ' change' : 'Nothing changes yet'}</b>
          {Object.keys(m).length ? (
            <div className="who">
              {Object.entries(m).map(([k, c]) => (
                <span key={k} className="wc-tag wc-tag--done">
                  {w.P(k).n} gets {c}
                </span>
              ))}
            </div>
          ) : null}
          <span className="wc-note" />
        </div>
        <Budget calls={costOf(n)} />
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost" />
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={!n} onClick={go}>
          <Ic n="user" />
          Reassign {n || ''}
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Reschedule
export function openReschedule(ids: string[]) {
  const w = workNow();
  if (!w || !ids.length) return;
  openDialog(<RescheduleDialog ids={ids} w={w} />);
}
function RescheduleDialog({ ids, w }: { ids: string[]; w: Work }) {
  const TODAY = w.today;
  const nextMon = (() => {
    let d = addDays(TODAY, 1);
    while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addDays(d, 1);
    return d;
  })();
  const [mode, setMode] = useState<'date' | 'by'>('date');
  const [date, setDate] = useState(addDays(TODAY, 7));
  const [by, setBy] = useState(7);
  const go = () => {
    const nd = mode === 'date' ? date : addDays(TODAY, by);
    closeDialog();
    void runJob({
      params: mode === 'date' ? { op: 'reschedule', due: nd } : { op: 'reschedule', by },
      ids,
      label: `Moved ${plural(ids.length, 'action')} to ${w.fd(nd)}`,
      calls: costOf(ids.length),
      tonight: budgetLine(costOf(ids.length)).tonight,
      apply: (id) => setOverlay(id, { due: nd }),
      keep: true,
    });
  };
  const chips: [string, string][] = [
    ['In a week', addDays(TODAY, 7)],
    ['In two weeks', addDays(TODAY, 14)],
    ['Next Monday', nextMon],
    ['Nov 1', TODAY.slice(0, 4) + '-11-01'],
  ];
  return (
    <Dialog label="Reschedule">
      <DialogHead title={'Reschedule ' + plural(ids.length, 'action')} sub="A new due date takes an action off the past-due count. It stays open." />
      <div className="wc-dlg__body">
        <div className="wc-field">
          <span className="lab">New due date for all of them</span>
          <div className="wc-choices">
            {chips.map(([l, v]) => (
              <button key={l} type="button" className={'wc-choice' + (mode === 'date' && date === v ? ' is-on' : '')} onClick={() => (setMode('date'), setDate(v))}>
                {l}
              </button>
            ))}
            <input type="date" value={mode === 'date' ? date : ''} min={TODAY} aria-label="New due date" style={dateInput} onChange={(e) => e.target.value && (setMode('date'), setDate(e.target.value))} />
          </div>
        </div>
        <div className="wc-field">
          <span className="lab">Or move each one from today</span>
          <div className="wc-choices">
            {[7, 14, 30].map((n) => (
              <button key={n} type="button" className={'wc-choice' + (mode === 'by' && by === n ? ' is-on' : '')} onClick={() => (setMode('by'), setBy(n))}>
                +{n} days
              </button>
            ))}
          </div>
        </div>
        <div className="wc-plan">
          <b>
            {plural(ids.length, 'action')} due {mode === 'date' ? w.fd(date, true) : 'on ' + w.fd(addDays(TODAY, by), true)}
          </b>
          <span className="wc-note">Blackbaud shows the new date at once.</span>
        </div>
        <Budget calls={costOf(ids.length)} />
      </div>
      <div className="wc-dlg__foot">
        <span className="wc-cost" />
        <button type="button" className="h-btn h-btn--ghost" onClick={closeDialog}>
          Cancel
        </button>
        <button type="button" className="h-btn h-btn--primary" onClick={go}>
          <Ic n="cal" />
          Reschedule {ids.length}
        </button>
      </div>
    </Dialog>
  );
}
