// Calendar view of one project: month and week, drag a task to another day, a No date tray, click a day to add, and a plain agenda
// list on phones. Ported from public/js/projects/calendar.js with the same markup and classes (projects-views.css).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { isTmp } from '../lib/store';
import { toast } from '../kit/toast';
import type { Task } from '../types';
import {
  DOW3, MON3, MONTHS, clamp, colorOf, dn, fmtLong, fmtRange, fmtShort, has, isDone, isOpen, isOverdue, mkDn, movePatch, parts, span, startOfWeek, todayDn, ymd,
  type Span,
} from './common';
import { useFitHeight, useHubOverlay, useIsoLayoutEffect, useLoadPrefs, usePhone, useSize, useViewTasks, writePrefs } from './hooks';
import { ICal, ICheck, IChev, IChevL, IPlus, IX, PjvAvatar } from './parts';
import type { ViewProps } from './types';

type Mode = 'month' | 'week';

export interface Period {
  start: number;
  weeks: number;
  first: number;
  last: number;
}

/** The days a calendar page covers: the weeks of a month (Sunday first), or one week. */
export function periodOf(mode: Mode, anchor: number): Period {
  const p = parts(anchor);
  if (mode === 'week') {
    const s = startOfWeek(anchor);
    return { start: s, weeks: 1, first: s, last: s + 6 };
  }
  const first = mkDn(p.y, p.m, 1);
  const last = mkDn(p.y, p.m + 1, 1) - 1;
  const start = startOfWeek(first);
  const weeks = Math.ceil((last - start + 1) / 7);
  return { start, weeks, first, last };
}

export function titleText(mode: Mode, anchor: number, per: Period): string {
  if (mode === 'month') {
    const p = parts(anchor);
    return MONTHS[p.m] + ' ' + p.y;
  }
  const a = parts(per.first);
  const b = parts(per.last);
  return a.m === b.m ? MON3[a.m] + ' ' + a.d + ' to ' + b.d + ', ' + b.y : MON3[a.m] + ' ' + a.d + ' to ' + MON3[b.m] + ' ' + b.d + ', ' + b.y;
}

interface Seg {
  t: Task;
  c0: number;
  c1: number;
  openL: boolean;
  openR: boolean;
  lane: number;
}
interface WeekModel {
  ws: number;
  segs: Seg[];
  hidden: number[];
}

/** Lay the tasks of a page out in lanes per week. A multi-day task is one chip that spans columns; a long week folds into "+n more". */
export function layoutWeeks(visible: Task[], per: Period, mode: Mode, gridH: number): { weeks: WeekModel[]; rowH: number; capacity: number } {
  const lo = per.start;
  const hi = per.start + per.weeks * 7 - 1;
  const inRange: { t: Task; sp: Span }[] = [];
  for (const t of visible) {
    const sp = span(t);
    if (has(sp.s) && sp.d >= lo && sp.s <= hi) inRange.push({ t, sp });
  }
  inRange.sort((a, b) => {
    const la = a.sp.d - a.sp.s;
    const lb = b.sp.d - b.sp.s;
    if (la > 0 !== lb > 0) return la > 0 ? -1 : 1;
    if (a.sp.s !== b.sp.s) return a.sp.s - b.sp.s;
    return a.t.title.localeCompare(b.t.title);
  });
  const rowH = mode === 'week' ? Math.max(gridH, 360) : Math.max(116, Math.floor(gridH / per.weeks));
  const capacity = mode === 'week' ? 60 : Math.max(1, Math.floor((rowH - 36 - 22) / 27));
  const weeks: WeekModel[] = [];
  for (let w = 0; w < per.weeks; w++) {
    const ws = per.start + w * 7;
    const we = ws + 6;
    const raw: Omit<Seg, 'lane'>[] = [];
    for (const it of inRange) {
      if (it.sp.d < ws || it.sp.s > we) continue;
      raw.push({ t: it.t, c0: Math.max(it.sp.s, ws) - ws, c1: Math.min(it.sp.d, we) - ws, openL: it.sp.s < ws, openR: it.sp.d > we });
    }
    const laneEnd: number[] = [];
    const hidden = [0, 0, 0, 0, 0, 0, 0];
    const segs: Seg[] = [];
    for (const sg of raw) {
      let l = 0;
      while (laneEnd[l] != null && laneEnd[l] >= sg.c0) l++;
      laneEnd[l] = sg.c1;
      if (l < capacity) segs.push({ ...sg, lane: l });
      else for (let c = sg.c0; c <= sg.c1; c++) hidden[c]++;
    }
    weeks.push({ ws, segs, hidden });
  }
  return { weeks, rowH, capacity };
}

/** The tasks that cover a day. */
export const dayTasks = (visible: Task[], day: number): Task[] =>
  visible.filter((t) => {
    const sp = span(t);
    return has(sp.s) && day >= sp.s && day <= sp.d;
  });

const chipColor = (t: Task) => colorOf(t.project ? t.project.color : 'slate');

/* ---------------------------------------------------------------- drag to another day */

interface Drag {
  t: Task;
  el: HTMLElement;
  tray: boolean;
  x0: number;
  y0: number;
  x: number;
  y: number;
  moved: boolean;
  grab: number | null;
  offX: number;
  offY: number;
  day: number | null;
  overTray: boolean;
}
interface Latest {
  byId: Map<string, Task>;
  tray: boolean;
  patch: (t: Task, body: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<boolean>;
  open: (t: Task) => void;
  closePop: () => void;
}
interface DragDeps {
  grid: React.RefObject<HTMLDivElement | null>;
  scroll: React.RefObject<HTMLDivElement | null>;
  tray: React.RefObject<HTMLElement | null>;
  latest: React.RefObject<Latest>;
  setDropDay: (d: number | null) => void;
  setTrayDrop: (b: boolean) => void;
  setDragId: (id: string | null) => void;
}

function makeDrag(deps: DragDeps) {
  let drag: Drag | null = null;
  let raf = 0;
  let ghost: HTMLElement | null = null;

  function dayFromPoint(x: number, y: number): number | null {
    const g = deps.grid.current;
    if (!g) return null;
    for (const w of Array.from(g.querySelectorAll<HTMLElement>('.cal-week'))) {
      const r = w.getBoundingClientRect();
      if (y >= r.top && y < r.bottom && x >= r.left && x < r.right) {
        const col = clamp(Math.floor(((x - r.left) / r.width) * 7), 0, 6);
        return Number(w.dataset.ws) + col;
      }
    }
    return null;
  }
  function setGhost() {
    const d = drag as Drag;
    const r = d.el.getBoundingClientRect();
    ghost = d.el.cloneNode(true) as HTMLElement;
    ghost.classList.add('cal-ghost');
    ghost.removeAttribute('style');
    ghost.style.width = Math.min(Math.max(r.width, 140), 260) + 'px';
    document.body.appendChild(ghost);
    deps.setDragId(d.t.id);
    document.body.classList.add('cal-dragging');
    d.offX = clamp(d.x0 - r.left, 12, Math.min(r.width, 260) - 12);
    d.offY = r.height / 2;
  }
  function paint() {
    raf = 0;
    const d = drag;
    if (!d || !d.moved || !ghost) return;
    ghost.style.transform = 'translate(' + (d.x - d.offX) + 'px,' + (d.y - d.offY) + 'px)';
    const day = dayFromPoint(d.x, d.y);
    const trayEl = deps.tray.current;
    const trayR = trayEl ? trayEl.getBoundingClientRect() : null;
    const overTray = !!(trayR && deps.latest.current.tray && d.x >= trayR.left && d.x <= trayR.right && d.y >= trayR.top && d.y <= trayR.bottom);
    d.day = overTray ? null : day;
    d.overTray = overTray;
    deps.setDropDay(d.day);
    deps.setTrayDrop(overTray && !d.tray);
    // scroll the grid when the pointer is near its top or bottom edge
    const sc = deps.scroll.current;
    if (sc) {
      const sr = sc.getBoundingClientRect();
      let dy = 0;
      if (d.y < sr.top + 40) dy = -Math.ceil((sr.top + 40 - d.y) / 3);
      else if (d.y > sr.bottom - 40) dy = Math.ceil((d.y - (sr.bottom - 40)) / 3);
      if (dy && d.x < sr.right) {
        sc.scrollTop += dy;
        raf = requestAnimationFrame(paint);
      }
    }
  }
  function onMove(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) < 5) return;
      d.moved = true;
      deps.latest.current.closePop();
      setGhost();
    }
    if (e.cancelable) e.preventDefault();
    if (!raf) raf = requestAnimationFrame(paint);
  }
  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    document.body.classList.remove('cal-dragging');
    deps.setDropDay(null);
    deps.setTrayDrop(false);
    deps.setDragId(null);
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  function onCancel() {
    endDrag();
    drag = null;
  }
  function onUp(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    if (d.moved) {
      d.x = e.clientX;
      d.y = e.clientY;
      paint();
    }
    endDrag();
    drag = null;
    const L = deps.latest.current;
    if (!d.moved) {
      L.open(d.t);
      return;
    }
    if (d.overTray) {
      if (d.tray) return;
      const was = { start_date: d.t.start_date, due_date: d.t.due_date };
      void L.patch(d.t, { start_date: null, due_date: null });
      toast('Date cleared', { action: { label: 'Undo', fn: () => void L.patch(d.t, was) } });
      return;
    }
    if (d.day == null) return;
    const patch = movePatch(d.t, d.tray ? null : d.grab, d.day);
    const was: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) was[k] = d.t[k];
    if (Object.keys(patch).every((k) => patch[k] === was[k])) return;
    void L.patch(d.t, patch);
  }
  function onDown(e: RPointerEvent) {
    if (e.button != null && e.button > 0) return;
    const el = (e.target as Element).closest('.cal-chip, .cal-tt') as HTMLElement | null;
    if (!el) return;
    const t = deps.latest.current.byId.get(el.dataset.id || '');
    if (!t) return;
    drag = { t, el, tray: el.classList.contains('cal-tt'), x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, grab: dayFromPoint(e.clientX, e.clientY), offX: 0, offY: 0, day: null, overTray: false };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  return { onDown, endDrag };
}

/* ---------------------------------------------------------------- the view */

export function CalendarView({ ctx, openTask }: ViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLElement | null>(null);
  const agendaRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const popAnchor = useRef<HTMLElement | null>(null);
  const scrolled = useRef(false);

  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState<number>(() => todayDn());
  const [showDone, setShowDone] = useState(true);
  const [tray, setTray] = useState(true);
  const [pop, setPop] = useState<{ day: number | null } | null>(null);
  const [popTitle, setPopTitle] = useState('');
  const [popDate, setPopDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const [trayDrop, setTrayDrop] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useLoadPrefs('calendar', (p) => {
    if (p.mode === 'week') setMode('week');
    if (p.showDone === false) setShowDone(false);
    if (p.tray === false) setTray(false);
  });
  const phone = usePhone();
  useFitHeight(rootRef, 480);
  const size = useSize(scrollRef, { w: 0, h: 600 }, phone);
  const gridH = size.h || 600;

  const vt = useViewTasks(ctx, showDone);
  const visible = useMemo(() => vt.tasks.filter((t) => showDone || isOpen(t)), [vt.tasks, showDone]);
  const byId = useMemo(() => new Map(vt.tasks.map((t) => [t.id, t])), [vt.tasks]);

  const open = useCallback(
    (t: Task) => {
      if (t.pending || isTmp(t.id)) return;
      openTask(t.code || t.id);
    },
    [openTask]
  );
  const closePop = useCallback(() => {
    setPop(null);
    popAnchor.current = null;
  }, []);

  const latest = useRef<Latest>({ byId, tray, patch: vt.patch, open, closePop });
  latest.current = { byId, tray, patch: vt.patch, open, closePop };
  const dragApi = useMemo(() => makeDrag({ grid: gridRef, scroll: scrollRef, tray: trayRef, latest, setDropDay, setTrayDrop, setDragId }), []);
  useEffect(() => () => dragApi.endDrag(), [dragApi]);

  const per = useMemo(() => periodOf(mode, anchor), [mode, anchor]);
  const title = titleText(mode, anchor, per);
  const td = todayDn();
  const model = useMemo(() => layoutWeeks(visible, per, mode, gridH), [visible, per, mode, gridH]);
  const noDate = useMemo(() => {
    const items = visible.filter((t) => !has(span(t).s));
    items.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.title.localeCompare(b.title));
    return items;
  }, [visible]);

  /* ---- popover: a day's tasks and a quick add */
  const openPop = (day: number | null, from: HTMLElement | null) => {
    popAnchor.current = from;
    setPop({ day });
    setPopTitle('');
    setPopDate(ymd(todayDn()));
  };
  const popList = pop && pop.day != null ? dayTasks(visible, pop.day) : [];
  useIsoLayoutEffect(() => {
    const el = popRef.current;
    const root = rootRef.current;
    if (!pop || !el || !root) return;
    const a = popAnchor.current;
    if (!phone && a && a.isConnected) {
      const mr = root.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const pw = 320;
      const left = clamp(ar.left - mr.left, 8, Math.max(8, mr.width - pw - 8));
      let top = ar.bottom - mr.top + 4;
      const ph = el.offsetHeight;
      if (top + ph > mr.height - 8) top = Math.max(8, ar.top - mr.top - ph - 4);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    } else {
      el.style.left = '';
      el.style.top = '';
    }
  }, [pop, phone, popList.length]);
  useEffect(() => {
    if (!pop) return;
    const t = setTimeout(() => titleRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [pop]);
  useEffect(() => {
    if (!pop || phone) return;
    const away = (e: PointerEvent) => {
      const el = popRef.current;
      const tg = e.target as Element;
      if (el && !el.contains(tg) && !tg.closest('.cal-cell, .cal-more, .cal-addbtn')) closePop();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [pop, phone, closePop]);
  useHubOverlay(!!pop && phone, closePop);
  // switching between the grid and the phone list closes an open pop-up
  const wasPhone = useRef(phone);
  useEffect(() => {
    if (wasPhone.current !== phone) {
      wasPhone.current = phone;
      closePop();
      scrolled.current = false;
    }
  }, [phone, closePop]);

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = popTitle.trim();
    if (!text || !pop || adding) return;
    const day = pop.day != null ? pop.day : dn(popDate);
    const fields: Record<string, unknown> = { title: text };
    if (has(day)) fields.due_date = ymd(day);
    setAdding(true);
    const t = await ctx.create(fields);
    setAdding(false);
    if (!t) return;
    toast(('Added ' + (fields.due_date ? 'for ' + fmtShort(dn(fields.due_date as string)) : '')).trim());
    if (pop.day != null) {
      setPopTitle('');
      titleRef.current?.focus();
    } else closePop();
  };

  /* ---- toolbar */
  const go = (dir: number) => {
    const p = parts(anchor);
    setAnchor(mode === 'month' ? mkDn(p.y, p.m + dir, 1) : anchor + dir * 7);
    scrolled.current = false;
    closePop();
  };
  const setModeTo = (m: Mode) => {
    setMode(m);
    writePrefs('calendar', { mode: m });
    scrolled.current = false;
    closePop();
  };

  const onRootKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') closePop();
    else if ((e.key === 't' || e.key === 'T') && !(e.target as Element).closest('input, textarea, select')) setAnchor(todayDn());
  };

  const onGridClick = (e: RMouseEvent) => {
    const tg = e.target as Element;
    if (tg.closest('.cal-chip')) return;
    const more = tg.closest<HTMLElement>('.cal-more');
    if (more) {
      openPop(Number(more.dataset.day), more);
      return;
    }
    const cell = tg.closest<HTMLElement>('.cal-cell');
    if (cell) openPop(Number(cell.dataset.day), cell);
  };

  /* ---- phone agenda */
  const agenda = useMemo(() => {
    if (!phone) return null;
    const byDay = new Map<number, Task[]>();
    for (const t of visible) {
      const sp = span(t);
      if (!has(sp.s)) continue;
      if (sp.d < per.first || sp.d > per.last) continue;
      const l = byDay.get(sp.d);
      if (l) l.push(t);
      else byDay.set(sp.d, [t]);
    }
    const days: number[] = [];
    for (let d = per.first; d <= per.last; d++) if (mode === 'week' || byDay.has(d) || d === td) days.push(d);
    return { byDay, days, nodate: visible.filter((t) => !has(span(t).s)) };
  }, [phone, visible, per, mode, td]);
  useEffect(() => {
    if (!phone || scrolled.current || mode !== 'month') return;
    scrolled.current = true;
    const el = agendaRef.current?.querySelector('.ag-day.is-today');
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [phone, mode, anchor, agenda]);

  const dayCells = (ws: number) => {
    const cells = [];
    for (let c = 0; c < 7; c++) {
      const d = ws + c;
      const p = parts(d);
      const off = mode === 'month' && (d < per.first || d > per.last);
      const showMon = mode === 'month' ? p.d === 1 : c === 0 || p.d === 1;
      cells.push(
        <div
          key={d}
          className={'cal-cell' + (d === td ? ' is-today' : '') + (off ? ' is-off' : '') + (c === 0 || c === 6 ? ' is-wknd' : '') + (dropDay === d ? ' is-drop' : '')}
          data-day={d}
          role="gridcell"
          aria-label={fmtLong(d)}
        >
          <span className="cal-num">{(showMon ? MON3[p.m] + ' ' : '') + p.d}</span>
          <span className="cal-plus" aria-hidden="true">
            <IPlus />
          </span>
        </div>
      );
    }
    return cells;
  };

  const chip = (sg: Seg) => {
    const t = sg.t;
    const done = isDone(t);
    const over = isOverdue(t);
    const sp = span(t);
    const multi = sp.both && sp.s !== sp.d;
    return (
      <button
        key={t.id}
        type="button"
        className={'cal-chip' + (done ? ' is-done' : '') + (over ? ' is-over' : '') + (multi ? ' is-multi' : '') + (sg.openL ? ' is-open-l' : '') + (sg.openR ? ' is-open-r' : '') + (dragId === t.id ? ' is-drag' : '')}
        data-id={t.id}
        data-pc={chipColor(t)}
        style={{ gridColumn: sg.c0 + 1 + ' / span ' + (sg.c1 - sg.c0 + 1), gridRow: sg.lane + 1 }}
        aria-label={t.title + ', ' + (multi ? fmtRange(sp.s, sp.d) : fmtShort(sp.d)) + (done ? ', completed' : '')}
        onClick={(e) => {
          // a click with no pointer is the keyboard; a pointer click was already handled when the pointer lifted
          if (e.detail === 0) open(t);
        }}
      >
        {done ? (
          <span className="cal-chip__ck">
            <ICheck />
          </span>
        ) : null}
        <span className="cal-chip__t">{t.title}</span>
        {t.owner && !sg.openL ? (
          <span className="cal-chip__av">
            <PjvAvatar p={t.owner} size="xs" />
          </span>
        ) : null}
      </button>
    );
  };

  const agendaRow = (t: Task) => {
    const done = isDone(t);
    const over = isOverdue(t);
    const sp = span(t);
    const sub: string[] = [];
    if (sp.both && sp.s !== sp.d) sub.push(fmtRange(sp.s, sp.d));
    if (t.owner) sub.push(t.owner.name || t.owner.email);
    return (
      <div key={t.id} className={'ag-row' + (done ? ' is-done' : '')} data-id={t.id} data-pc={chipColor(t)}>
        <button type="button" className="ag-ck" aria-pressed={done} aria-label={(done ? 'Mark not complete: ' : 'Mark complete: ') + t.title} onClick={() => void vt.toggleDone(t)}>
          <ICheck />
        </button>
        <button type="button" className="ag-t" onClick={() => open(t)}>
          <span className="ag-t__n">{t.title}</span>
          {sub.length ? <small>{sub.join(' · ')}</small> : null}
        </button>
        <label className={'ag-date' + (over ? ' is-late' : '')}>
          <span>{has(sp.s) ? fmtShort(sp.d) : 'Set date'}</span>
          <ICal />
          <input
            type="date"
            value={has(sp.s) ? ymd(sp.d) : ''}
            aria-label={'Due date for ' + t.title}
            onChange={(e) => {
              const day = dn(e.target.value);
              if (has(day)) void vt.patch(t, movePatch(t, null, day));
            }}
          />
        </label>
      </div>
    );
  };

  return (
    <div ref={rootRef} className={'pjv-root pjv-cal' + (phone ? ' is-phone' : '') + (vt.loading ? ' is-loading' : '')} data-pjv="calendar" onKeyDown={onRootKey}>
      <div className="pjv-bar" role="toolbar" aria-label="Calendar">
        <div className="cal-nav">
          <button type="button" className="pjv-btn pjv-btn--ico" aria-label="Previous" onClick={() => go(-1)}>
            <IChevL />
          </button>
          <button type="button" className="pjv-btn pjv-btn--ico" aria-label="Next" onClick={() => go(1)}>
            <IChev />
          </button>
        </div>
        <button
          type="button"
          className="pjv-btn"
          onClick={() => {
            setAnchor(todayDn());
            scrolled.current = false;
          }}
        >
          Today
        </button>
        <h2 className="pjv-title" aria-live="polite">
          {title}
        </h2>
        <div className="pjv-seg cal-modes" role="group" aria-label="View">
          <button type="button" aria-pressed={mode === 'month'} onClick={() => setModeTo('month')}>
            Month
          </button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => setModeTo('week')}>
            Week
          </button>
        </div>
        <button
          type="button"
          className="pjv-btn pjv-btn--tog"
          aria-pressed={showDone}
          onClick={() => {
            setShowDone(!showDone);
            writePrefs('calendar', { showDone: !showDone });
          }}
        >
          Completed
        </button>
        <button
          type="button"
          className="pjv-btn pjv-btn--tog cal-traybtn"
          aria-pressed={tray}
          onClick={() => {
            setTray(!tray);
            writePrefs('calendar', { tray: !tray });
          }}
        >
          No date <span>{noDate.length}</span>
        </button>
        <button type="button" className="pjv-btn pjv-btn--primary cal-addbtn" onClick={(e) => openPop(null, e.currentTarget)}>
          <IPlus />
          Task
        </button>
      </div>

      {!phone ? (
        <div className="cal-wrap pjv-body">
          <div className="cal-main">
            <div className="cal-dow">
              {DOW3.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="cal-scroll" ref={scrollRef}>
              <div className="cal-grid" ref={gridRef} style={{ '--cal-lane': '26px' } as CSSProperties} onPointerDown={dragApi.onDown} onClick={onGridClick}>
                {model.weeks.map((w) => (
                  <div key={w.ws} className="cal-week" data-ws={w.ws} style={mode === 'week' ? { minHeight: model.rowH } : { height: model.rowH }}>
                    <div className="cal-days">{dayCells(w.ws)}</div>
                    <div className="cal-items">
                      {w.segs.map(chip)}
                      {w.hidden.map((n, c) =>
                        n ? (
                          <button key={'m' + c} type="button" className="cal-more" data-day={w.ws + c} style={{ gridColumn: c + 1, gridRow: model.capacity + 1 }}>
                            +{n} more
                          </button>
                        ) : null
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside ref={trayRef} className={'cal-tray' + (tray ? '' : ' is-off') + (trayDrop ? ' is-drop' : '')} aria-label="Tasks without a date" onPointerDown={dragApi.onDown}>
            <div className="cal-tray__h">
              <b>No date</b>
              <span>{noDate.length}</span>
            </div>
            <div className="cal-tray__list">
              {noDate.length ? (
                noDate.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={'cal-tt' + (isDone(t) ? ' is-done' : '') + (dragId === t.id ? ' is-drag' : '')}
                    data-id={t.id}
                    data-pc={chipColor(t)}
                    onClick={(e) => {
                      if (e.detail === 0) open(t);
                    }}
                  >
                    <span className="cal-tt__t">{t.title}</span>
                    <span className="cal-tt__m">{t.owner ? <PjvAvatar p={t.owner} size="xs" /> : null}</span>
                  </button>
                ))
              ) : (
                <p className="cal-tray__none">None</p>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="cal-agenda pjv-body" ref={agendaRef}>
          {agenda && (agenda.days.length || agenda.nodate.length) ? (
            <>
              {agenda.days.map((d) => {
                const list = (agenda.byDay.get(d) || []).slice().sort((a, b) => a.title.localeCompare(b.title));
                return (
                  <section key={d} className={'ag-day' + (d === td ? ' is-today' : '')} data-day={d}>
                    <header>
                      <b>{fmtLong(d)}</b>
                      {d === td ? <em>Today</em> : null}
                      <button type="button" className="ag-add" data-day={d} aria-label={'Add a task on ' + fmtLong(d)} onClick={(e) => openPop(d, e.currentTarget)}>
                        <IPlus />
                      </button>
                    </header>
                    {list.length ? list.map(agendaRow) : <p className="ag-none">Nothing due</p>}
                  </section>
                );
              })}
              {agenda.nodate.length ? (
                <section className="ag-day ag-day--nodate">
                  <header>
                    <b>No date</b>
                    <span className="ag-n">{agenda.nodate.length}</span>
                  </header>
                  {agenda.nodate.map(agendaRow)}
                </section>
              ) : null}
            </>
          ) : (
            <p className="ag-none">No tasks</p>
          )}
        </div>
      )}

      {pop ? (
        <>
          <div ref={popRef} className={'cal-pop' + (phone ? ' is-sheet' : '')} role="dialog" aria-label="Add a task">
            <div className="cal-pop__h">
              <b>{pop.day == null ? 'New task' : fmtLong(pop.day)}</b>
              <button type="button" className="cal-pop__x" aria-label="Close" onClick={closePop}>
                <IX />
              </button>
            </div>
            {popList.length ? (
              <ul className="cal-pop__list">
                {popList.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      data-pc={chipColor(t)}
                      onClick={() => {
                        closePop();
                        open(t);
                      }}
                    >
                      <i />
                      <span>{t.title}</span>
                      {isDone(t) ? <em>Done</em> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <form className="cal-pop__f" onSubmit={submitAdd}>
              {pop.day == null ? <input type="date" name="date" aria-label="Due date" value={popDate} onChange={(e) => setPopDate(e.target.value)} /> : null}
              <input
                ref={titleRef}
                type="text"
                name="title"
                maxLength={180}
                placeholder="Task name"
                aria-label="Task name"
                autoComplete="off"
                value={popTitle}
                onChange={(e) => setPopTitle(e.target.value)}
              />
              <button type="submit" className="pjv-btn pjv-btn--primary" disabled={adding}>
                Add
              </button>
            </form>
          </div>
          {phone ? <div className="cal-scrim" onClick={closePop} /> : null}
        </>
      ) : null}
    </div>
  );
}
