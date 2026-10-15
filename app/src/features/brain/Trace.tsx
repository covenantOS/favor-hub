// The steps behind a Favor Brain answer, after shadcn's Trace component (MIT): one line per step with an icon, a title and a
// quiet count or time; a step opens to say what it did in plain words. While an answer is made the four rows fill in as the
// Brain sends them (they hold their height from the first frame); once it lands they close to one line above the answer.
// Staff see steps and plain summaries only, never a query, a model or reasoning text. Styles: .btr in src/styles/brain.css.
import { useState, type ReactNode } from 'react';
import type { Step } from './types';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const svg = (d: ReactNode, cls?: string) => (
  <svg viewBox="0 0 16 16" className={cls} {...P}>
    {d}
  </svg>
);
const ICON: Record<string, ReactNode> = {
  read: svg(<><path d="M3.5 2.5h6l3 3v8h-9z" /><path d="M9.5 2.5v3h3M5.75 8.5h4.5M5.75 11h3" /></>),
  lookup: svg(<><circle cx="7" cy="7" r="4.25" /><path d="m10.25 10.25 3.25 3.25" /></>),
  check: svg(<><path d="M8 1.75 13 3.6v4.1c0 3-2.1 5.4-5 6.55-2.9-1.15-5-3.55-5-6.55V3.6z" /><path d="m5.75 8 1.6 1.6 2.9-3.1" /></>),
  answer: svg(<path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.25v-2.25h-.25a1.5 1.5 0 0 1-1-1.5z" />),
  done: svg(<><circle cx="8" cy="8" r="6.25" /><path d="m5.5 8.1 1.75 1.75L10.6 6.4" /></>),
  hand: svg(<path d="M3 8h8.5M8.5 4.5 12 8l-3.5 3.5" />),
  run: svg(<><circle cx="8" cy="8" r="6.25" opacity=".25" /><path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" /></>, 'btr-spin'),
  chev: svg(<path d="m6 4 4 4-4 4" />),
};
const ORDER = ['read', 'lookup', 'check', 'answer'];
const WAIT: Record<string, string> = { read: 'Reading your question', lookup: 'Looking up the records', check: 'Checking the numbers', answer: 'Answer' };
const secs = (ms?: number) => (ms == null ? '' : ms < 950 ? '<1 s' : (ms / 1000).toFixed(ms < 9950 ? 1 : 0) + ' s');

/** The four rows while an answer is made: the ones the Brain has sent, the rest waiting in grey. */
function liveSteps(steps: Step[] | null): Step[] {
  const got: Record<string, Step> = {};
  (steps || []).forEach((s) => (got[s.id] = s));
  let first = !(steps || []).some((x) => x.status === 'running');
  return ORDER.map((id) => {
    if (got[id]) return got[id];
    const s: Step = { id, label: WAIT[id], status: first ? 'running' : 'pending' };
    first = false;
    return s;
  });
}
/** A held answer is a hand-off to Claude, said calmly (Will, 2026-10-14), never in warning red. */
const calm = (s: Step): Step => (s.status === 'withheld' ? { id: s.id, label: 'Handed off to Claude', status: 'handoff', at: s.at, ms: s.ms, detail: 'This one reads better in Claude, so your question and what I found are ready there.' } : s);

function Line({ s, chev }: { s: Step; chev?: boolean }) {
  const st = s.status || 'done';
  const end = s.count ? s.count : s.id !== 'answer' && (st === 'done' || st === 'handoff') ? secs(s.ms) : '';
  return (
    <span className="btr-line" data-status={st}>
      <span className="btr-ic" aria-hidden="true">
        {st === 'running' ? ICON.run : ICON[s.id] || ICON.done}
      </span>
      <span className="btr-t">{s.label}</span>
      {end && <span className="btr-d">{end}</span>}
      {chev && (
        <span className="btr-ic btr-chev" aria-hidden="true">
          {ICON.chev}
        </span>
      )}
    </span>
  );
}
function Row({ s, live }: { s: Step; live: boolean }) {
  const [open, setOpen] = useState(false);
  const c = calm(s);
  if (live || !c.detail)
    return (
      <div className="btr-row">
        <Line s={c} />
      </div>
    );
  return (
    <div className="btr-row">
      <button type="button" className="btr-trig" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Line s={c} chev />
      </button>
      <div className="btr-body">
        <div className="btr-in">
          <p>{c.detail}</p>
        </div>
      </div>
    </div>
  );
}

/** One line for the finished list. */
export function summary(steps: Step[]) {
  const by: Record<string, Step> = {};
  steps.forEach((s) => (by[s.id] = s));
  const held = steps.some((s) => s.status === 'withheld');
  const total = steps.reduce((m, s) => Math.max(m, (s.at || 0) + (s.ms || 0)), 0);
  if (held) return { text: 'Handed off to Claude in ' + secs(total), held: true };
  const parts = ['Read your question'];
  if (by.lookup) parts.push(by.lookup.count ? by.lookup.label.replace(/^Looked up /, 'found ' + by.lookup.count + ' ') : by.lookup.label.replace(/^Looked/, 'looked'));
  if (by.check && by.check.status === 'done') parts.push((by.lookup ? 'checked' : by.check.label.replace(/^Checked/, 'checked')) + ' in ' + secs(total));
  else parts[parts.length - 1] += ' in ' + secs(total);
  return { text: parts.join(', '), held: false };
}

/** The live list in place of the old "thinking" skeleton. */
export function TraceLive({ steps }: { steps: Step[] | null }) {
  const rows = liveSteps(steps);
  const cur = rows.find((s) => s.status === 'running');
  return (
    <div className="btr btr--live" role="status" aria-live="polite" aria-label={cur ? cur.label : 'Reading your question'}>
      <div className="btr-list">
        {rows.map((s) => (
          <Row key={s.id} s={s} live />
        ))}
      </div>
    </div>
  );
}

/** The list above a finished answer: one line, open to see each step (and, inside, how the question was read). */
export function TraceDone({ steps, extra }: { steps: Step[]; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const list = (steps || []).filter((s) => s && s.id && s.label);
  if (!list.length) return null;
  const sm = summary(list);
  return (
    <div className="btr btr--done">
      <button type="button" className="btr-trig btr-sum" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="btr-line" data-status={sm.held ? 'handoff' : 'done'}>
          <span className="btr-ic" aria-hidden="true">
            {sm.held ? ICON.hand : ICON.done}
          </span>
          <span className="btr-t">{sm.text}</span>
          <span className="btr-ic btr-chev" aria-hidden="true">
            {ICON.chev}
          </span>
        </span>
      </button>
      <div className="btr-body">
        <div className="btr-in btr-list">
          {list.map((s) => (
            <Row key={s.id} s={s} live={false} />
          ))}
          {extra && <div className="btr-extra">{extra}</div>}
        </div>
      </div>
    </div>
  );
}
