// Pickers for the entry form: a partner search that asks the server as the person types, and a short list search for funds and appeal codes.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface Option {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A text box with a list under it. `load` returns the options for the typed text; choosing one calls onPick. */
export function Picker<T>({
  id,
  label,
  placeholder,
  chosen,
  onClear,
  load,
  toOption,
  onPick,
  minChars = 2,
  openOnFocus = false,
  extra,
}: {
  id: string;
  label: ReactNode;
  placeholder?: string;
  chosen: ReactNode | null;
  onClear: () => void;
  load: (term: string) => Promise<T[]>;
  toOption: (row: T) => Option;
  onPick: (row: T) => void;
  minChars?: number;
  openOnFocus?: boolean;
  extra?: ReactNode;
}) {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(term, 220);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    if (debounced.trim().length < minChars && !openOnFocus) {
      setRows([]);
      return;
    }
    let live = true;
    setBusy(true);
    load(debounced.trim())
      .then((r) => {
        if (live) {
          setRows(r);
          setActive(0);
        }
      })
      .catch(() => live && setRows([]))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, open]);

  useEffect(() => {
    const off = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, []);

  const pick = (r: T) => {
    onPick(r);
    setTerm('');
    setOpen(false);
  };
  const opts = rows.map(toOption);

  return (
    <div className="og-field" ref={box}>
      <label htmlFor={id}>{label}</label>
      {chosen ? (
        <div className="og-chosen">
          <span>{chosen}</span>
          <button type="button" className="og-link" onClick={onClear}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            className="og-input"
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            placeholder={placeholder}
            value={term}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, opts.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && open && rows[active]) {
                e.preventDefault();
                pick(rows[active]);
              } else if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && (opts.length > 0 || busy || term.trim().length >= minChars) && (
            <ul className="og-list" id={listId} role="listbox">
              {opts.map((o, i) => (
                <li key={o.key} role="option" aria-selected={i === active} className={i === active ? 'is-on' : ''}>
                  <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(rows[i])}>
                    <span>{o.label}</span>
                    {o.hint ? <small>{o.hint}</small> : null}
                  </button>
                </li>
              ))}
              {!opts.length && <li className="og-none">{busy ? 'Searching' : 'No match'}</li>}
            </ul>
          )}
        </>
      )}
      {extra}
    </div>
  );
}

/** Funds and appeal codes: a short list held in the page, filtered as the person types. */
export function ListPicker({
  id,
  label,
  items,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  items: { id: string; code: string; name: string }[];
  value: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
}) {
  const current = items.find((i) => i.id === value);
  const [editing, setEditing] = useState(!current);
  useEffect(() => {
    if (current) setEditing(false);
  }, [current]);
  if (current && !editing)
    return (
      <div className="og-field">
        <label htmlFor={id}>{label}</label>
        <div className="og-chosen">
          <span>{current.code && current.code !== current.name ? `${current.code} · ${current.name}` : current.name}</span>
          <button type="button" className="og-link" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      </div>
    );
  return (
    <Picker
      id={id}
      label={label}
      placeholder={placeholder}
      chosen={null}
      onClear={() => undefined}
      minChars={0}
      openOnFocus
      load={async (term) => {
        const t = term.toLowerCase();
        return items.filter((i) => !t || i.name.toLowerCase().includes(t) || i.code.toLowerCase().includes(t)).slice(0, 12);
      }}
      toOption={(i) => ({ key: i.id, value: i.id, label: i.name, hint: i.code && i.code !== i.name ? i.code : undefined })}
      onPick={(i) => onChange(i.id, i.name)}
    />
  );
}
