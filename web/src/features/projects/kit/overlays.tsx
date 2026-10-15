// Overlays that open from code and answer with a promise: sheets (a dialog on a desktop, a bottom sheet on a phone), the small
// choose pop-up, a one-line text question. They keep the classic markup and class names (pj-sheet, pj-pop, pj-opt), so projects.css
// styles them as before. <OverlayHost /> draws whatever is open; the Projects pages mount it once.
//
//   const v = await choose({ anchor, title, items: [{ value, label, hint?, dot?, icon?, on? }], search?, placeholder?, source? });
//   const s = openSheet({ title, cls, render: (sheet) => <Body />, onClose });   s.close(result)
//   const text = await askText({ title, label, value, action });
//
// Browser only: nothing here runs while a page is drawn on the server.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export const isPhone = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches;
export const isCoarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  const f = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  f.cancel = () => clearTimeout(t);
  return f;
};

/* ---------------------------------------------------------------- the open overlays */
interface Entry {
  id: number;
  node: ReactNode;
}
let entries: Entry[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => {
  entries = entries.slice();
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
const getEntries = () => entries;
const none: Entry[] = [];

function push(make: (id: number) => ReactNode): number {
  const id = nextId++;
  entries.push({ id, node: make(id) });
  emit();
  return id;
}
function drop(id: number) {
  entries = entries.filter((e) => e.id !== id);
  emit();
}

/** Draws the open overlays. Mount once per page. */
export function OverlayHost() {
  const list = useSyncExternalStore(subscribe, getEntries, () => none);
  const [on, setOn] = useState(false);
  useEffect(() => setOn(true), []);
  if (!on || !list.length) return null;
  return createPortal(
    <>
      {list.map((e) => (
        <Keyed key={e.id}>{e.node}</Keyed>
      ))}
    </>,
    document.body
  );
}
const Keyed = ({ children }: { children: ReactNode }) => <>{children}</>;

/** True while any sheet, pop-up or other overlay of this kit is open. */
export const overlayOpen = (): boolean => entries.length > 0;

/* ---------------------------------------------------------------- sheets */
const sheetStack: number[] = [];
export const sheetOpen = (): boolean => sheetStack.length > 0;

export interface SheetHandle {
  el: () => HTMLElement | null;
  close: (result?: unknown) => void;
}

export interface SheetOpts {
  title?: string;
  cls?: string;
  label?: string;
  hideHead?: boolean;
  render: (s: SheetHandle) => ReactNode;
  onClose?: (result?: unknown) => void;
}

interface HubOv {
  on: (f: () => void) => unknown;
  off: (t: unknown) => void;
}
const hubOv = (): HubOv | undefined => (typeof window !== 'undefined' ? (window as unknown as { hubOv?: HubOv }).hubOv : undefined);

function SheetView({ id, opts, handle }: { id: number; opts: SheetOpts; handle: SheetHandle & { setEl: (e: HTMLElement | null) => void } }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(handle.close);
  closeRef.current = handle.close;

  useEffect(() => {
    const el = ref.current;
    handle.setEl(el);
    sheetStack.push(id);
    const ret = document.activeElement as HTMLElement | null;
    el?.focus({ preventScroll: true });
    const ov = hubOv();
    const tok = ov ? ov.on(() => closeRef.current()) : null;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sheetStack[sheetStack.length - 1] === id && !document.querySelector('.pj-pop, .rt-sheet')) {
        e.stopPropagation();
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('keydown', esc, true);
      const i = sheetStack.indexOf(id);
      if (i >= 0) sheetStack.splice(i, 1);
      if (tok && ov) ov.off(tok);
      handle.setEl(null);
      if (ret && ret.focus && document.contains(ret)) {
        try {
          ret.focus({ preventScroll: true });
        } catch {
          // gone
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const el = ref.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex="0"]')].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <div className="pj-scrim" onClick={() => handle.close()} />
      <div
        ref={ref}
        className={'pj-sheet ' + (opts.cls || '')}
        role="dialog"
        aria-modal="true"
        aria-label={opts.label || opts.title || 'Dialog'}
        tabIndex={-1}
        onKeyDown={onKey}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[data-sheet-x]')) handle.close();
        }}
      >
        {opts.hideHead ? null : (
          <div className="pj-sheet__head">
            <h2>{opts.title || ''}</h2>
            <button type="button" className="pj-x" data-sheet-x aria-label="Close">
              <Icon name="x" />
            </button>
          </div>
        )}
        <div className="pj-sheet__body">{opts.render(handle)}</div>
      </div>
    </>
  );
}

export function openSheet(opts: SheetOpts): SheetHandle {
  let elRef: HTMLElement | null = null;
  let closed = false;
  let sid = 0;
  const handle: SheetHandle & { setEl: (e: HTMLElement | null) => void } = {
    el: () => elRef,
    setEl: (e) => {
      elRef = e;
    },
    close(result) {
      if (closed) return;
      closed = true;
      drop(sid);
      opts.onClose?.(result);
    },
  };
  sid = push((id) => {
    sid = id;
    return <SheetView id={id} opts={opts} handle={handle} />;
  });
  return handle;
}

/* ---------------------------------------------------------------- choose */
export interface ChooseItem<V = unknown> {
  value: V;
  label: string;
  hint?: string;
  dot?: string;
  icon?: string;
  on?: boolean;
}

export interface ChooseOpts<V = unknown> {
  anchor?: HTMLElement | null;
  title?: string;
  items: ChooseItem<V>[];
  search?: boolean;
  placeholder?: string;
  /** Loads the items for a typed query (codes, people). */
  source?: (q: string) => Promise<ChooseItem<V>[]>;
}

function Rows<V>({ list, hi, onPick }: { list: ChooseItem<V>[]; hi: number; onPick: (i: number) => void }) {
  if (!list.length) return <p className="pj-none">Nothing matches.</p>;
  return (
    <>
      {list.map((it, i) => (
        <button key={i} type="button" className={'pj-opt' + (it.on ? ' is-on' : '') + (i === hi ? ' is-hi' : '')} role="option" aria-selected={!!it.on} onClick={() => onPick(i)}>
          {it.dot ? <i className="pj-dot" data-c={it.dot} /> : null}
          {it.icon ? <Icon name={it.icon} /> : null}
          <span className="pj-opt__t">
            <b>{it.label}</b>
            {it.hint ? <small>{it.hint}</small> : null}
          </span>
          {it.on ? <Icon name="check" cls="pj-opt__ok" /> : null}
        </button>
      ))}
    </>
  );
}

function useChoice<V>(o: ChooseOpts<V>) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ChooseItem<V>[]>(o.items);
  const [loading, setLoading] = useState(!!o.source);
  const [hi, setHi] = useState(() => (isPhone() ? -1 : Math.max(0, o.items.findIndex((i) => i.on))));
  const sourceRef = useRef(o.source);
  const load = useMemo(
    () =>
      debounce(async (v: string) => {
        try {
          setItems(await sourceRef.current!(v));
        } catch {
          setItems([]);
        }
        setLoading(false);
        setHi(isPhone() ? -1 : 0);
      }, 160),
    []
  );
  useEffect(() => {
    if (sourceRef.current) load('');
    return () => load.cancel();
  }, [load]);
  const list = q && !o.source ? items.filter((i) => (i.label + ' ' + (i.hint || '')).toLowerCase().includes(q.toLowerCase())) : items;
  const type = (v: string) => {
    setQ(v);
    setHi(isPhone() ? -1 : 0);
    if (sourceRef.current) load(v);
  };
  return { q, type, list, loading, hi, setHi };
}

function ChoosePop<V>({ o, done }: { o: ChooseOpts<V>; done: (v: V | undefined) => void }) {
  const { q, type, list, loading, hi, setHi } = useChoice(o);
  const ref = useRef<HTMLDivElement | null>(null);
  const lst = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight?: number; height?: number }>({ left: 0, top: 0, width: 260 });
  const [placed, setPlaced] = useState(false);
  const anchor = o.anchor || null;

  useLayoutEffect(() => {
    const pop = ref.current;
    if (!pop || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.max(230, Math.min(320, pop.offsetWidth || 260));
    const left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
    let top = r.bottom + 6;
    // A list that loads grows after it opens, so room is kept for its full height; where neither side has it, the roomier side wins.
    const full = Math.min(380, Math.round(innerHeight * 0.6));
    const h = o.source ? full : pop.offsetHeight;
    const below = innerHeight - 8 - top;
    const above = r.top - 14;
    const next: typeof pos = { left, top, width: w };
    if (h > below) {
      if (above >= h || above > below) {
        const hh = Math.min(h, above);
        top = Math.max(8, r.top - hh - 6);
        next.top = top;
        next.maxHeight = hh;
        if (o.source) next.height = hh;
      } else next.maxHeight = below;
    }
    setPos(next);
    setPlaced(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(
    (v: V | undefined) => {
      done(v);
      if (anchor && anchor.focus && document.contains(anchor)) {
        try {
          anchor.focus({ preventScroll: true });
        } catch {
          // gone
        }
      }
    },
    [anchor, done]
  );
  const pickAt = (i: number) => {
    if (list[i]) close(list[i].value);
  };
  const stateRef = useRef({ list, hi });
  stateRef.current = { list, hi };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const { list: l, hi: h } = stateRef.current;
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close(undefined);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const n = l.length;
        if (!n) return;
        const nh = (h + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        setHi(nh);
        const c = lst.current?.children[nh] as HTMLElement | undefined;
        c?.scrollIntoView?.({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (l[h]) close(l[h].value);
      }
    };
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close(undefined);
    };
    const onResize = () => close(undefined);
    document.addEventListener('keydown', key, true);
    const t = setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', key, true);
      clearTimeout(t);
      document.removeEventListener('pointerdown', away, true);
      removeEventListener('resize', onResize);
    };
  }, [close, setHi]);

  useEffect(() => {
    const t = setTimeout(() => {
      const inp = ref.current?.querySelector<HTMLInputElement>('[data-q]');
      if (inp) inp.focus();
      else ref.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={ref}
      className="pj-pop"
      role="dialog"
      aria-label={o.title || 'Choose'}
      tabIndex={o.search ? undefined : -1}
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight, height: pos.height, visibility: placed ? undefined : 'hidden' }}
    >
      {o.search ? (
        <div className="pj-search">
          <Icon name="search" />
          <input type="search" data-q placeholder={o.placeholder || 'Search'} aria-label={o.placeholder || 'Search'} autoComplete="off" value={q} onChange={(e) => type(e.target.value)} />
        </div>
      ) : null}
      <div className="pj-opts" role="listbox" ref={lst}>
        {loading ? <p className="pj-none">Loading</p> : <Rows list={list} hi={hi} onPick={pickAt} />}
      </div>
    </div>
  );
}

function ChooseSheetBody<V>({ o, done, sheet }: { o: ChooseOpts<V>; done: (v: V | undefined) => void; sheet: SheetHandle }) {
  const { q, type, list, loading, hi } = useChoice(o);
  return (
    <>
      {o.search ? (
        <div className="pj-search">
          <Icon name="search" />
          <input type="search" data-q placeholder={o.placeholder || 'Search'} aria-label={o.placeholder || 'Search'} autoComplete="off" value={q} onChange={(e) => type(e.target.value)} />
        </div>
      ) : null}
      <div className="pj-opts" role="listbox">
        {loading ? (
          <p className="pj-none">Loading</p>
        ) : (
          <Rows
            list={list}
            hi={hi}
            onPick={(i) => {
              if (list[i]) {
                done(list[i].value);
                sheet.close();
              }
            }}
          />
        )}
      </div>
    </>
  );
}

/**
 * Choose one of a list. Returns the value, or undefined when dismissed. On a desktop a small pop-up under `anchor`; on a phone a
 * bottom sheet.
 */
export function choose<V = unknown>(o: ChooseOpts<V>): Promise<V | undefined> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v: V | undefined) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };
    if (!isPhone() && o.anchor) {
      let pid = 0;
      pid = push((id) => {
        pid = id;
        return (
          <ChoosePop
            o={o}
            done={(v) => {
              drop(pid);
              done(v);
            }}
          />
        );
      });
      return;
    }
    openSheet({
      title: o.title || 'Choose',
      cls: 'pj-sheet--choose',
      render: (s) => <ChooseSheetBody o={o} done={done} sheet={s} />,
      onClose: () => done(undefined),
    });
  });
}

/* ---------------------------------------------------------------- ask for a line of text */
function AskBody({ title, label, value, action, placeholder, multiline, onOk, sheet }: { title: string; label?: string; value: string; action: string; placeholder: string; multiline: boolean; onOk: (v: string) => void; sheet: SheetHandle }) {
  const [v, setV] = useState(value);
  const f = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      f.current?.focus();
      f.current?.select?.();
    }, 30);
    return () => clearTimeout(t);
  }, []);
  const ok = () => {
    const x = v.trim();
    if (x) {
      onOk(x);
      sheet.close();
    }
  };
  return (
    <>
      {label ? <label className="pj-label">{label}</label> : null}
      {multiline ? (
        <textarea ref={f} className="pj-field" rows={4} placeholder={placeholder} aria-label={label || title} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok(); } }} />
      ) : (
        <input ref={f} className="pj-field" type="text" maxLength={300} placeholder={placeholder} aria-label={label || title} enterKeyHint="done" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} />
      )}
      <div className="pj-sheet__foot">
        <button type="button" className="pj-btn" data-sheet-x>
          Cancel
        </button>
        <button type="button" className="pj-btn pj-btn--primary" onClick={ok}>
          {action}
        </button>
      </div>
    </>
  );
}

/** Ask for one line of text in a small dialog. Resolves to the text, or undefined when dismissed. */
export function askText(o: { title: string; value?: string; label?: string; action?: string; placeholder?: string; multiline?: boolean }): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out: string | undefined;
    openSheet({
      title: o.title,
      cls: 'pj-sheet--ask',
      render: (s) => <AskBody title={o.title} label={o.label} value={o.value || ''} action={o.action || 'Save'} placeholder={o.placeholder || ''} multiline={!!o.multiline} onOk={(v) => { out = v; }} sheet={s} />,
      onClose: () => resolve(out),
    });
  });
}

/** Draw any element as an overlay; the returned function removes it. For pieces with their own markup (the people picker). */
export function mountOverlay(make: (close: () => void) => ReactNode): () => void {
  let id = 0;
  const close = () => {
    if (id) drop(id);
    id = 0;
  };
  id = push(() => make(close));
  return close;
}
