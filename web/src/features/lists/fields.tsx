// The criteria controls of the Lists builder: segmented choices, chips, boxes for amounts, dates and comma lists, and the menu with a search
// box. Each reads its value from the spec by path and writes it back by path; the page decides what a change triggers.
import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { getIn, parseAmount, parseList } from './spec';
import { Popover, usePop } from './kit';

type Opt = [id: string, label: string, hint?: string];

interface Ctx {
  spec: unknown;
  set: (path: string, value: unknown) => void;
}
export const SpecCtx = createContext<Ctx>({ spec: {}, set: () => {} });
const useSpec = () => useContext(SpecCtx);

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="ls-f">
      <span className="ls-fl">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export function Seg({ path, opts }: { path: string; opts: [string, string][] }) {
  const { spec, set } = useSpec();
  const cur = getIn(spec, path);
  return (
    <div className="ls-seg" role="group">
      {opts.map((o) => (
        <button key={o[0]} type="button" aria-pressed={cur === o[0]} onClick={() => set(path, o[0])}>
          {o[1]}
        </button>
      ))}
    </div>
  );
}

export function Chips({ path, opts }: { path: string; opts: [string, string][] }) {
  const { spec, set } = useSpec();
  const cur: string[] = getIn(spec, path) || [];
  return (
    <div className="ls-chips" role="group">
      {opts.map((o) => {
        const on = cur.includes(o[0]);
        return (
          <button key={o[0]} type="button" className="ls-chip" aria-pressed={on} onClick={() => set(path, on ? cur.filter((x) => x !== o[0]) : [...cur, o[0]])}>
            {o[1]}
          </button>
        );
      })}
    </div>
  );
}

export function Check({ path, label }: { path: string; label: string }) {
  const { spec, set } = useSpec();
  const id = useId();
  return (
    <label className="ls-check" htmlFor={id}>
      <input type="checkbox" id={id} checked={getIn(spec, path) === true} onChange={(e) => set(path, e.target.checked)} />
      {label}
    </label>
  );
}

/** A box that commits when it loses focus or Enter is pressed, and only when its text changed (the browser's "change" event). */
function useCommit(initial: string, commit: (text: string) => void) {
  const [text, setText] = useState(initial);
  const done = useRef(initial);
  const go = () => {
    if (text === done.current) return;
    done.current = text;
    commit(text);
  };
  return { value: text, onChange: (e: { target: { value: string } }) => setText(e.target.value), onBlur: go, onKeyDown: (e: { key: string }) => e.key === 'Enter' && go() };
}

function NumIn({ path, ph }: { path: string; ph: string }) {
  const { spec, set } = useSpec();
  const v = getIn(spec, path);
  const bind = useCommit(v !== null && v !== undefined && v !== '' ? String(v) : '', (t) => set(path, parseAmount(t)));
  return <input type="text" inputMode="decimal" placeholder={ph} aria-label={ph} {...bind} />;
}

export function Range({ path, unit }: { path: string; unit?: string }) {
  return (
    <div className="ls-pair">
      <NumIn path={path + '.min'} ph={unit ? 'Min ' + unit : 'Min'} />
      <i>to</i>
      <NumIn path={path + '.max'} ph={unit ? 'Max ' + unit : 'Max'} />
    </div>
  );
}

export function DateIn({ path, ph }: { path: string; ph: string }) {
  const { spec, set } = useSpec();
  return <input type="date" aria-label={ph} value={getIn(spec, path) || ''} onChange={(e) => set(path, e.target.value)} />;
}

export function Span({ path }: { path: string }) {
  return (
    <div className="ls-pair">
      <DateIn path={path + '.from'} ph="From" />
      <i>to</i>
      <DateIn path={path + '.to'} ph="To" />
    </div>
  );
}

export function TextList({ path, ph }: { path: string; ph: string }) {
  const { spec, set } = useSpec();
  const bind = useCommit(((getIn(spec, path) as string[]) || []).join(', '), (t) => set(path, parseList(t)));
  return <input type="text" placeholder={ph} aria-label={ph} {...bind} />;
}

/** A menu with a search box: the chosen values show as tags with a remove mark, and the add button opens the list (the first 120 matches). */
export function Multi({ path, label, opts }: { path: string; label: string; opts: () => Opt[] }) {
  const { spec, set } = useSpec();
  const pop = usePop(path);
  const add = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState('');
  const cur: string[] = getIn(spec, path) || [];
  const all = opts();
  const name = (v: string) => all.find((x) => x[0] === v)?.[1] ?? v;
  const toggle = (v: string) => set(path, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
  const t = q.trim().toLowerCase();
  const shown = pop.open ? all.filter((o) => !t || (o[1] + ' ' + (o[2] || '')).toLowerCase().includes(t)).slice(0, 120) : [];
  return (
    <div className="ls-multi">
      {cur.map((v) => (
        <button key={v} type="button" className="ls-tag" title={'Remove ' + name(v)} onClick={() => set(path, cur.filter((x) => x !== v))}>
          {name(v)}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <button
        ref={add}
        type="button"
        className="ls-add"
        aria-haspopup="dialog"
        onClick={() => {
          setQ('');
          pop.toggle();
        }}
      >
        {cur.length ? 'Add' : label}
      </button>
      {pop.open ? (
        <Popover anchor={add} onClose={pop.close}>
          <input type="search" placeholder="Search" aria-label={'Search ' + label.toLowerCase()} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="ls-opts" role="listbox" aria-multiselectable="true">
            {shown.length ? (
              shown.map((o) => (
                <button key={o[0]} type="button" role="option" aria-selected={cur.includes(o[0])} className="ls-opt" onClick={() => toggle(o[0])}>
                  <b>{o[1]}</b>
                  {o[2] ? <small>{o[2]}</small> : null}
                </button>
              ))
            ) : (
              <p className="ls-none">Nothing matches</p>
            )}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
