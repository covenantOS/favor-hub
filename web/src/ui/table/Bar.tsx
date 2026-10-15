// Filter bar parts (src/styles/ptable.css): the search box and a segmented control with counts.
import { useEffect, useRef, useState } from 'react';

/** A search box that reports after the person pauses typing (and at once on Enter). */
export function SearchBox(p: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; delay?: number; id?: string }) {
  const [v, setV] = useState(p.value);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setV(p.value), [p.value]);
  const push = (x: string) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => p.onChange(x.trim()), p.delay ?? 220);
  };
  return (
    <label className="pt-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span className="sr-only">{p.label || p.placeholder}</span>
      <input
        id={p.id}
        data-pt-search=""
        type="search"
        autoComplete="off"
        placeholder={p.placeholder}
        value={v}
        onChange={(e) => { setV(e.target.value); push(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(t.current); p.onChange(v.trim()); } }}
      />
    </label>
  );
}

export interface SegItem { k: string; label: string; n?: number | null; title?: string }
/** Buttons in one strip; the one pressed is dark. */
export function Seg(p: { items: SegItem[]; value: string; onChange: (k: string) => void; label: string; className?: string }) {
  return (
    <div className={'pt-seg' + (p.className ? ' ' + p.className : '')} role="group" aria-label={p.label}>
      {p.items.map((it) => (
        <button key={it.k} type="button" aria-pressed={p.value === it.k} title={it.title} onClick={() => p.onChange(it.k)}>
          {it.label}
          {it.n != null ? <span>{it.n.toLocaleString('en-US')}</span> : null}
        </button>
      ))}
    </div>
  );
}
