// One table for every FavorOS list: sticky header row, sortable columns, a Columns menu, Compact or Comfortable rows, page numbers,
// row selection and the list keys (j and k move, Enter opens, x selects, / goes to the search box, [ and ] turn the page). It draws
// the hub's own classes (src/styles/ptable.css), so a list looks the same as the classic one it replaces. Data comes in as props: the
// caller pages on the server (pass the page's rows and the total) or in the browser (pass rows sliced with pageOf).
import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { SIZES, useDensity, useHiddenColumns, usePageSize, type Density } from './prefs';

export type SortDir = 'asc' | 'desc';
export interface Sort {
  col: string;
  dir: SortDir;
}

export interface Column<T> {
  /** Stable key, also the key the Columns menu saves. */
  key: string;
  label: string;
  /** Read by screen readers only, for a column whose visible header is empty (a star, a row action). */
  srLabel?: string;
  /** Sort key sent to onSort. A column without one cannot be sorted. */
  sort?: string;
  /** The first press sorts this way (numbers and dates usually 'desc'). */
  firstDir?: SortDir;
  num?: boolean;
  /** Always shown, not in the Columns menu. */
  fixed?: boolean;
  /** Hidden until the person turns it on. */
  hidden?: boolean;
  className?: string;
  /** Header cell class. */
  thClassName?: string;
  /** Header text read aloud only (a column with no visible title, such as the row buttons). */
  srLabel?: string;
  /** Class on that hidden text. Default sr-only. */
  srClass?: string;
  cell: (row: T, index: number) => ReactNode;
  title?: (row: T) => string | undefined;
  /** Shown on a phone (<= 860 px). Columns without it are hidden there. Defaults to true for fixed columns. */
  phone?: boolean;
}

export interface Selection {
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean, shift: boolean) => void;
  onPage: (on: boolean) => void;
  /** Press a checkbox and drag down the column to select (or clear) every row passed over, like a spreadsheet. */
  drag?: boolean;
  /** A row that cannot be selected right now (its change is still being sent): its checkbox is off and presses skip it. */
  disabled?: (id: string) => boolean;
  /** Extra class on the checkbox cells (th and td). */
  cellClassName?: string;
}

export interface DataTableProps<T> {
  /** The key the list's choices are saved under (page size, hidden columns). Same as the classic list's key. */
  listKey: string;
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  select?: Selection;
  /** Called for a row press (outside a link or button) and for Enter. */
  onOpen?: (row: T) => void;
  /** When set, a row press (outside a link or button) calls this instead of onOpen; Enter still calls onOpen. */
  onRowClick?: (row: T, e: React.MouseEvent) => void;
  rowClassName?: (row: T) => string;
  rowTitle?: (row: T) => string | undefined;
  /** Shown when rows is empty and not loading. */
  empty?: ReactNode;
  /** Draw this many grey rows (the first load). */
  loading?: number;
  /** Fades the rows while a new page is read. */
  busy?: boolean;
  /** Pixels above and below the list on screen: the list scrolls inside its card so the header row stays in view. */
  fit?: number;
  /** Set for lists that should grow with the page instead (short lists, phones). */
  noFit?: boolean;
  /** Extra class on the <table>. */
  className?: string;
  /** Extra class on the wrapper around the table (the Foundations panels use ptl-wrap). */
  wrapClassName?: string;
  /** Aria label for the table. */
  label: string;
  /** Hidden columns, when the caller keeps them (from useListControls). Otherwise the table keeps its own. */
  hidden?: ReadonlySet<string>;
  /** The open row (side panel), marked in the list. */
  openId?: string | null;
  /** A heading row drawn above a row (a group's name). Return null for no heading. prev is the row above on this page. */
  groupHead?: (row: T, prev: T | undefined) => ReactNode | null;
  /** Extra rows drawn right under a row (an opened detail). Return <tr> elements, or null. */
  rowAfter?: (row: T) => ReactNode | null;
}

/** One page of an array (page is 1-based). */
export function pageOf<T>(list: readonly T[], page: number, size: number): T[] {
  const p = Math.max(1, page);
  return list.slice((p - 1) * size, p * size);
}
export const pageCount = (total: number, size: number) => Math.max(1, Math.ceil((Number(total) || 0) / size));
export const clampPage = (page: number, total: number, size: number) => Math.min(Math.max(1, page || 1), pageCount(total, size));

const SortMark = ({ on, dir }: { on: boolean; dir?: SortDir }) => <i aria-hidden="true">{on ? (dir === 'asc' ? '↑' : '↓') : '↕'}</i>;

export function DataTable<T>(p: DataTableProps<T>) {
  const [density] = useDensity();
  const [ownHidden] = useHiddenColumns(p.listKey, p.columns.filter((c) => c.hidden).map((c) => c.key));
  const hidden = p.hidden ?? ownHidden;
  const cols = useMemo(() => p.columns.filter((c) => c.fixed || !hidden.has(c.key)), [p.columns, hidden]);
  const body = useRef<HTMLTableSectionElement>(null);
  const ids = p.rows.map(p.rowKey);
  const pickable = p.select?.disabled ? ids.filter((i) => !p.select!.disabled!(i)) : ids;
  const allOn = !!p.select && pickable.length > 0 && pickable.every((i) => p.select!.selected.has(i));
  const someOn = !!p.select && !allOn && pickable.some((i) => p.select!.selected.has(i));
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someOn;
  }, [someOn]);

  const press = (col: Column<T>) => {
    if (!col.sort || !p.onSort) return;
    const on = p.sort?.col === col.sort;
    p.onSort({ col: col.sort, dir: on ? (p.sort!.dir === 'asc' ? 'desc' : 'asc') : col.firstDir || (col.num ? 'desc' : 'asc') });
  };
  const rowClick = (e: React.MouseEvent, row: T) => {
    const t = e.target as HTMLElement;
    if (t.closest('a,button,input,select,textarea,label,summary')) return;
    if (p.onRowClick) p.onRowClick(row, e);
    else if (p.onOpen) p.onOpen(row);
  };
  // Drag down the checkbox column to paint the selection. The handlers read the latest props through a ref.
  const latest = useRef(p);
  latest.current = p;
  const wrap = useRef<HTMLDivElement>(null);
  const painting = useRef<{ on: boolean } | null>(null);
  const cbDown = (e: React.PointerEvent, id: string, picked: boolean) => {
    const sel = p.select;
    if (!sel || !sel.drag || e.button !== 0) return;
    e.preventDefault();
    if (sel.disabled?.(id)) return;
    if (e.shiftKey) {
      sel.onToggle(id, !picked, true);
      return;
    }
    sel.onToggle(id, !picked, false);
    painting.current = { on: !picked };
    document.body.classList.add('wc-dragging');
    const move = (ev: PointerEvent) => {
      const paint = painting.current;
      if (!paint) return;
      const box = wrap.current;
      if (box && box.scrollHeight > box.clientHeight) {
        const r = box.getBoundingClientRect();
        if (ev.clientY > r.bottom - 36) box.scrollTop += 18;
        else if (ev.clientY < r.top + 70) box.scrollTop -= 18;
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el && (el.closest('tr[data-pt-row]') as HTMLElement | null);
      const rid = row?.dataset.id;
      const cur = latest.current.select;
      if (rid && cur && !cur.disabled?.(rid) && cur.selected.has(rid) !== paint.on) cur.onToggle(rid, paint.on, false);
    };
    const up = () => {
      painting.current = null;
      document.body.classList.remove('wc-dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T, id: string) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && p.onOpen) {
      e.preventDefault();
      p.onOpen(row);
    } else if ((e.key === 'x' || e.key === ' ') && p.select) {
      e.preventDefault();
      if (p.select.disabled?.(id)) return;
      p.select.onToggle(id, !p.select.selected.has(id), e.shiftKey);
    }
  };
  const style = (p.fit ? { ['--pt-fit' as string]: p.fit + 'px' } : undefined) as CSSProperties | undefined;
  const span = cols.length + (p.select ? 1 : 0);

  return (
    <div ref={wrap} className={'pt-wrap' + (p.noFit ? '' : ' pt-wrap--fit') + (p.wrapClassName ? ' ' + p.wrapClassName : '')} style={style} data-density={density}>
      <table className={'pt-table' + (p.className ? ' ' + p.className : '') + (p.busy ? ' is-busy' : '')} aria-label={p.label}>
        <thead>
          <tr>
            {p.select ? (
              <th className={'pt-cb' + (p.select.cellClassName ? ' ' + p.select.cellClassName : '')}>
                <input ref={allRef} type="checkbox" checked={allOn} onChange={(e) => p.select!.onPage(e.target.checked)} aria-label="Select every row on this page" />
              </th>
            ) : null}
            {cols.map((c) => {
              const on = !!c.sort && p.sort?.col === c.sort;
              return (
                <th
                  key={c.key}
                  className={[c.num ? 'is-num' : '', c.thClassName || '', c.phone === false || (!c.phone && !c.fixed) ? 'pt-nophone' : ''].filter(Boolean).join(' ') || undefined}
                  aria-sort={on ? (p.sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}
                >
                  {c.sort && p.onSort ? (
                    <button type="button" className={'pt-th' + (on ? ' is-on' : '') + (c.num ? ' is-num' : '')} onClick={() => press(c)}>
                      {c.label}
                      <SortMark on={on} dir={p.sort?.dir} />
                    </button>
                  ) : c.srLabel ? (
                    <span className={c.srClass || 'sr-only'}>{c.srLabel}</span>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={body} data-pt-list={p.listKey}>
          {p.loading && !p.rows.length
            ? Array.from({ length: p.loading }, (_, i) => (
                <tr key={'sk' + i} className="pt-loading" aria-hidden="true">
                  {Array.from({ length: span }, (_, j) => (
                    <td key={j}>
                      <i />
                    </td>
                  ))}
                </tr>
              ))
            : p.rows.length
              ? p.rows.map((row, i) => {
                  const id = ids[i];
                  const picked = !!p.select && p.select.selected.has(id);
                  const cls = [picked ? 'is-picked' : '', p.openId === id ? 'is-open' : '', p.rowClassName ? p.rowClassName(row) : ''].filter(Boolean).join(' ');
                  const head = p.groupHead ? p.groupHead(row, i > 0 ? p.rows[i - 1] : undefined) : null;
                  const after = p.rowAfter ? p.rowAfter(row) : null;
                  return (
                    <Fragment key={id}>
                      {head ? (
                        <tr className="pt-group">
                          <td colSpan={span}>{head}</td>
                        </tr>
                      ) : null}
                      <tr data-pt-row="" data-id={id} tabIndex={-1} className={cls || undefined} title={p.rowTitle ? p.rowTitle(row) : undefined} onClick={(e) => rowClick(e, row)} onKeyDown={(e) => onKey(e, row, id)} onMouseDown={p.select?.drag ? (e) => { if (e.shiftKey) e.preventDefault(); } : undefined}>
                        {p.select ? (
                          <td className={'pt-cb' + (p.select.cellClassName ? ' ' + p.select.cellClassName : '')} style={p.select.drag ? { touchAction: 'none' } : undefined} onPointerDown={p.select.drag ? (e) => cbDown(e, id, picked) : undefined}>
                            <input
                              type="checkbox"
                              tabIndex={-1}
                              checked={picked}
                              disabled={p.select.disabled?.(id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                // With drag on, the press already toggled it; only a keyboard click (no pointer) toggles here.
                                if (p.select!.drag && e.detail !== 0) return;
                                p.select!.onToggle(id, !picked, e.shiftKey);
                              }}
                              onChange={() => undefined}
                              aria-label="Select this row"
                            />
                          </td>
                        ) : null}
                        {cols.map((c) => (
                          <td key={c.key} className={[c.num ? 'is-num' : '', c.className || '', c.phone === false || (!c.phone && !c.fixed) ? 'pt-nophone' : ''].filter(Boolean).join(' ') || undefined} title={c.title ? c.title(row) : undefined}>
                            {c.cell(row, i)}
                          </td>
                        ))}
                      </tr>
                      {after}
                    </Fragment>
                  );
                })
              : (
                <tr>
                  <td colSpan={span}>{p.empty ?? <div className="pt-empty"><b>Nothing matches</b>Change the search or a filter.</div>}</td>
                </tr>
              )}
        </tbody>
      </table>
    </div>
  );
}

export interface PagerProps {
  listKey: string;
  total: number;
  page: number;
  size: number;
  onPage: (page: number, size: number) => void;
  /** Word after the count: "of 1,170 asks". */
  noun?: string;
  sizes?: boolean;
}

function numbers(cur: number, last: number): number[] {
  const out: number[] = [];
  let lo = Math.max(2, cur - 2);
  let hi = Math.min(last - 1, cur + 2);
  if (cur <= 4) hi = Math.min(last - 1, 5);
  if (cur >= last - 3) lo = Math.max(2, last - 4);
  out.push(1);
  if (lo > 2) out.push(0);
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < last - 1) out.push(0);
  if (last > 1) out.push(last);
  return out;
}

/** Page numbers, the range shown and Rows 25/50/100. */
export function Pager({ listKey, total, page, size, onPage, noun, sizes = true }: PagerProps) {
  const last = pageCount(total, size);
  const cur = clampPage(page, total, size);
  const from = total ? (cur - 1) * size + 1 : 0;
  const to = Math.min(total, cur * size);
  const sel = useId();
  return (
    <nav className="pt-pager" data-pt-pager={listKey} aria-label="Pages">
      <span className="pt-range" aria-live="polite">
        {total ? `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : 'None'}
        {noun ? ' ' + noun : ''}
      </span>
      {last > 1 ? (
        <span className="pt-nums">
          <button type="button" disabled={cur <= 1} aria-label="Previous page" data-pt-prev onClick={() => onPage(cur - 1, size)}>
            ‹
          </button>
          {numbers(cur, last).map((n, i) =>
            n === 0 ? (
              <span key={'g' + i} className="pt-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button key={n} type="button" className={n === cur ? 'is-on' : undefined} aria-current={n === cur ? 'page' : undefined} aria-label={'Page ' + n} onClick={() => onPage(n, size)}>
                {n}
              </button>
            )
          )}
          <button type="button" disabled={cur >= last} aria-label="Next page" data-pt-next onClick={() => onPage(cur + 1, size)}>
            ›
          </button>
        </span>
      ) : null}
      {sizes ? (
        <label className="pt-size" htmlFor={sel}>
          <span>Rows</span>
          <select id={sel} value={size} aria-label="Rows per page" onChange={(e) => onPage(1, Number(e.target.value))}>
            {SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      ) : null}
    </nav>
  );
}

/** The Comfortable / Compact switch. */
export function DensitySwitch() {
  const [d, set] = useDensity();
  const b = (v: Density, label: string, path: string) => (
    <button type="button" aria-pressed={d === v} title={label + ' rows'} onClick={() => set(v)}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={path} />
      </svg>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="pt-dens" role="group" aria-label="Row size">
      {b('comfortable', 'Comfortable', 'M4 6h16M4 12h16M4 18h16')}
      {b('compact', 'Compact', 'M4 5h16M4 9.5h16M4 14h16M4 18.5h16')}
    </div>
  );
}

/** The Columns menu. */
/** showFixed: also list the always-on columns, ticked and greyed (what ptable.js colsHTML draws on the Work Center list tabs). */
export function ColumnsMenu<T>({ columns, hidden, onChange, showFixed }: { columns: Column<T>[]; hidden: ReadonlySet<string>; onChange: (s: Set<string> | null) => void; showFixed?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  return (
    <details className="pt-cols" ref={box} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="h-btn h-btn--ghost h-btn--sm">
        <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M10 5v14M15 5v14" />
        </svg>
        Columns
      </summary>
      <div className="pt-cols__menu" role="group" aria-label="Columns shown">
        {columns
          .filter((c) => !c.fixed || (showFixed && c.label))
          .map((c) => (
            <label key={c.key} className={c.fixed ? 'is-fixed' : undefined}>
              <input
                type="checkbox"
                checked={c.fixed || !hidden.has(c.key)}
                disabled={c.fixed}
                onChange={(e) => {
                  const s = new Set(hidden);
                  if (e.target.checked) s.delete(c.key);
                  else s.add(c.key);
                  onChange(s);
                }}
              />
              {c.label}
            </label>
          ))}
        <button type="button" className="pt-cols__reset" onClick={() => onChange(null)}>
          Show the usual columns
        </button>
      </div>
    </details>
  );
}

/**
 * The list keys for one list on the page: j and k move between rows, / goes to the search box, [ and ] turn the page. Enter and x
 * are handled on the focused row by DataTable. Keys are ignored while typing and while a dialog is open.
 */
export function useListKeys(listKey: string, opts: { search?: string } = {}) {
  useEffect(() => {
    const typing = (el: Element | null) => !!el && (/^(input|textarea|select)$/i.test(el.tagName) || (el as HTMLElement).isContentEditable);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target as Element)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      // An open dialog or side panel takes the keys (the search palette stays in the page while closed, so only a visible one counts).
      // A closed side panel stays in the page, parked off screen with aria-hidden, and must not count.
      const open = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], .pt-side.is-on')).some((d) => d.getAttribute('aria-hidden') !== 'true' && d.getClientRects().length > 0 && getComputedStyle(d).visibility !== 'hidden');
      if (open) return;
      const list = document.querySelector(`[data-pt-list="${CSS.escape(listKey)}"]`);
      if (!list || !(list as HTMLElement).offsetParent) return;
      const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-pt-row]'));
      const cur = (e.target as Element).closest?.('[data-pt-row]') as HTMLElement | null;
      const i = cur ? rows.indexOf(cur) : -1;
      const go = (r?: HTMLElement) => {
        if (!r) return;
        rows.forEach((x) => x.classList.remove('is-cursor'));
        r.classList.add('is-cursor');
        r.focus({ preventScroll: true });
        r.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'j' || (cur && e.key === 'ArrowDown')) {
        e.preventDefault();
        go(rows[Math.min(rows.length - 1, i + 1)]);
      } else if (e.key === 'k' || (cur && e.key === 'ArrowUp')) {
        e.preventDefault();
        go(rows[Math.max(0, i - 1)]);
      } else if (e.key === '/') {
        const s = document.querySelector<HTMLInputElement>(opts.search || '[data-pt-search]');
        if (s) {
          e.preventDefault();
          s.focus();
          s.select();
        }
      } else if (e.key === '[' || e.key === ']') {
        const b = document.querySelector<HTMLButtonElement>(`[data-pt-pager="${CSS.escape(listKey)}"] [data-pt-${e.key === '[' ? 'prev' : 'next'}]`);
        if (b && !b.disabled) {
          e.preventDefault();
          b.click();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listKey, opts.search]);
}

/** Page, page size and hidden columns for one list, together. */
export function useListControls<T>(listKey: string, columns: Column<T>[], defaultSize = 50) {
  const [size, setSize] = usePageSize(listKey, defaultSize);
  const [hidden, setHidden] = useHiddenColumns(listKey, columns.filter((c) => c.hidden).map((c) => c.key));
  const [page, setPage] = useState(1);
  return { size, setSize, hidden, setHidden, page, setPage };
}
