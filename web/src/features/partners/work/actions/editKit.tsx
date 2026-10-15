// Small pieces the edit panel and the edit dialogs share: the category list, choice chips, labelled fields, the fundraiser chips,
// the state line, the date shortcuts, and the hooks that give a dialog the board and the code tables. Ports of the building blocks
// at the top of public/js/work-edit.js.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { asParam } from './api';
import { addDays, indexOf, makeWork, type Work } from './model';
import { boardQuery, codesQuery, type Codes, type CodesAnswer } from './queries';
import { useWc } from './store';
import { Ic } from './ui';

/** Value sent to Blackbaud, short label, icon. */
export const CATS: [string, string, string][] = [
  ['Phone call', 'Call', 'phone'],
  ['Email', 'Email', 'mail'],
  ['Meeting', 'Meeting', 'meet'],
  ['Mailing', 'Mailing', 'letter'],
  ['Task/Other', 'Task', 'task'],
];
/** Days out a new to-do is due, by kind. */
export const DUE_OUT: Record<string, number> = { 'Task/Other': 7, 'Phone call': 2, Email: 2, Mailing: 7, Meeting: 14 };

export const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
export const nextMonday = (today: string) => {
  let d = addDays(today, 1);
  while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addDays(d, 1);
  return d;
};
export const plain = (t: string) => t.replace(/^RESERVED \((.*)\)$/, '$1');

/** Set the autofocus attribute (React's autoFocus prop leaves it off the element, and the dialog frame looks for the attribute). */
export const af = (el: HTMLElement | null) => {
  el?.setAttribute('autofocus', '');
};

export interface CodeSet {
  codes: Codes;
  me: { fid: string | null; type: string | null; name: string | null };
  types: Record<string, string>;
}
const NO_CODES: CodeSet = { codes: {}, me: { fid: null, type: null, name: null }, types: {} };

/** The ?as= address, read after the first render so the server and the browser draw the same thing. */
export function useAs() {
  const [as, setAs] = useState<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setAs(asParam() || undefined);
    setReady(true);
  }, []);
  return { as, ready };
}

/** The board with this person's pending changes, or null until it is read. A dialog opens from an event, so it is nearly always in the cache. */
export function useW(): Work | null {
  const { as, ready } = useAs();
  const q = useQuery({ ...boardQuery(as), enabled: ready });
  const ov = useWc((s) => s.ov);
  const gone = useWc((s) => s.gone);
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const back = useWc((s) => s.back);
  return useMemo(() => (q.data ? makeWork(indexOf(q.data), { ov, gone, saving, queued, back }) : null), [q.data, ov, gone, saving, queued, back]);
}

/** The code tables (types, statuses, locations, note types, tag categories) and who the person is. Empty until they arrive. */
export function useCodes(): CodeSet {
  const { as, ready } = useAs();
  const q = useQuery({ ...codesQuery(as), enabled: ready });
  const d = q.data as CodesAnswer | undefined;
  return useMemo(() => (d ? { codes: d.codes || {}, me: d.me || NO_CODES.me, types: d.types || {} } : NO_CODES), [d]);
}

/** People who may be given work by this person, live ones only, by name. */
export const staffList = (w: Work | null): string[] => (w ? Object.keys(w.idx.people).filter(w.live).filter(w.mayAssign).sort((a, b) => w.P(a).n.localeCompare(w.P(b).n)) : []);

export function Chip({ on, onClick, icon, children, title, disabled, pressed }: { on?: boolean; onClick?: () => void; icon?: string; children?: ReactNode; title?: string; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className={'wc-choice' + (on ? ' is-on' : '')} onClick={onClick} title={title} disabled={disabled} aria-pressed={pressed}>
      {icon ? <Ic n={icon} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, children, cls }: { label?: ReactNode; children: ReactNode; cls?: string }) {
  return (
    <div className={'wc-field' + (cls ? ' ' + cls : '')}>
      <span className="lab">{label}</span>
      {children}
    </div>
  );
}

export function PeopleChips({ list, w, onRemove, onAdd }: { list: string[]; w: Work | null; onRemove: (fid: string) => void; onAdd: (fid: string) => void }) {
  return (
    <div className="ep-people">
      {list.map((f) => (
        <span key={f} className={'ep-person' + (w && !w.live(f) ? ' is-left' : '')}>
          {w ? w.P(f).n : 'Fundraiser ' + f}
          {w ? w.goneTag(f) : ''}
          <button type="button" onClick={() => onRemove(f)} aria-label={'Remove ' + (w ? w.P(f).n : f)}>
            ×
          </button>
        </span>
      ))}
      <select
        className="ep-addperson"
        aria-label="Add a fundraiser"
        value=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
        }}
      >
        <option value="">Add a person…</option>
        {staffList(w)
          .filter((f) => !list.includes(f))
          .map((f) => (
            <option key={f} value={f}>
              {w ? w.P(f).n : f}
            </option>
          ))}
      </select>
    </div>
  );
}

/** The one-line state under a change: saving, saved, queued, failed or a conflict. */
export function StatusLine({ state, text }: { state: string; text: string }) {
  return (
    <span className={'ep-state ep-state--' + state}>
      {state === 'saving' ? <span className="wc-spin" /> : state === 'saved' ? <Ic n="check" /> : state === 'queued' ? <Ic n="clock" /> : state === 'failed' || state === 'conflict' ? <Ic n="alert" /> : null}
      {text}
    </span>
  );
}

/** +3 days, +1 week, +2 weeks, +1 month and Next Monday, each lit when it is the chosen date. */
export function DateChips({ cur, today, onPick }: { cur: string; today: string; onPick: (iso: string) => void }) {
  const list: [string, string][] = [
    ['+3 days', addDays(today, 3)],
    ['+1 week', addDays(today, 7)],
    ['+2 weeks', addDays(today, 14)],
    ['+1 month', addDays(today, 30)],
    ['Next Monday', nextMonday(today)],
  ];
  return (
    <>
      {list.map(([l, v]) => (
        <Chip key={l} on={cur === v} onClick={() => onPick(v)}>
          {l}
        </Chip>
      ))}
    </>
  );
}

/** One line for the actions a dialog is about: the partner, the summary, the category. Comes from the board, a hint, or the action itself. */
export interface ActInfo {
  p: string;
  cid: string;
  sum: string;
  cat: string;
}
