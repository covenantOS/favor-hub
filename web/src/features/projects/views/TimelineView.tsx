// Timeline (Gantt) view of one project. Only the rows on screen are drawn, so 500 or 2,000 tasks scroll smoothly. Drag a bar to move
// it, drag its ends to resize, drag from a dot to link two tasks, drag across an empty row to give a task dates. Ported from
// public/js/projects/timeline.js with the same markup and classes (projects-views.css).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { isTmp } from '../lib/store';
import { toast } from '../kit/toast';
import type { Task } from '../types';
import {
  DOW3, MON3, MONTHS, clamp, colorOf, datePatch, edgePts, fmtRange, fmtShort, has, isDone, isOpen, isOverdue, mkDn, msgOf, parts, roundedPath, span, startOfWeek,
  todayDn, wouldCycle, ymd, type Pt, type Span,
} from './common';
import { useFitHeight, useIsoLayoutEffect, useLoadPrefs, useMedia, usePhone, useRafFn, useSize, useViewTasks, writePrefs } from './hooks';
import { ICheck, IChev, IPlus, IX, PjvAvatar } from './parts';
import { CFG_DESK, CFG_PHONE, ZOOMS, ZOOM_W, buildRows, computeRange, monthsBetween, rowWindow, type GroupBy, type Range, type Zoom } from './timeline-logic';
import type { ViewProps } from './types';

type DragKind = 'move' | 'resize-l' | 'resize-r' | 'create' | 'connect';
interface TDrag {
  kind: DragKind;
  t: Task;
  x0: number;
  y0: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  touch: boolean;
  sp0?: Span;
  day0?: number;
  cur?: { s: number; d: number };
  side?: 'l' | 'r';
  target?: string | null;
  t0?: number;
}
interface Ov {
  id: string;
  s: number;
  d: number;
  both: boolean;
}

const GROUP_LABEL: Record<GroupBy, string> = { none: 'Task', owner: 'Owner', section: 'Section' };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function TimelineView({ ctx, sections, openTask }: ViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);

  const phone = usePhone();
  const coarse = useMedia('(pointer: coarse)');
  const C = phone ? CFG_PHONE : CFG_DESK;

  const [zoom, setZoom] = useState<Zoom>('week');
  const [group, setGroup] = useState<GroupBy>('section');
  const [showDone, setShowDone] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<{ a: string; b: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [addAt, setAddAt] = useState<{ key: string } | null>(null);
  const [addTitle, setAddTitle] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [ov, setOv] = useState<Ov | null>(null);
  const [tip, setTip] = useState<{ text: string; x: number; top: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; left: number; width: number } | null>(null);
  const [rubber, setRubber] = useState('');
  const [target, setTarget] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [scr, setScr] = useState({ st: 0, tb: 0, sc: false });
  const [depsState, setDepsState] = useState<Map<string, Set<string>>>(() => new Map());

  useLoadPrefs('timeline', (p) => {
    if (ZOOMS.includes(p.zoom as Zoom)) setZoom(p.zoom as Zoom);
    if (p.group === 'owner' || p.group === 'none' || p.group === 'section') setGroup(p.group);
    if (p.showDone === false) setShowDone(false);
  });
  useFitHeight(rootRef, 420);
  const size = useSize(scrollRef, { w: 1200, h: 800 });

  const vt = useViewTasks(ctx, showDone);
  const byId = useMemo(() => new Map(vt.tasks.map((t) => [t.id, t])), [vt.tasks]);
  const items = useMemo(() => vt.tasks.filter((t) => showDone || isOpen(t)), [vt.tasks, showDone]);
  const { rows, rowIdx } = useMemo(() => buildRows(items, group, sections, collapsed, addAt), [items, group, sections, collapsed, addAt]);

  /* ---- the day range: set when the tasks first load or are read again, so dragging never shifts the chart */
  const [range, setRange] = useState<Range>(() => computeRange(ctx.tasks));
  const wasLoading = useRef(vt.loading);
  useEffect(() => {
    if (wasLoading.current && !vt.loading) setRange(computeRange(vt.tasks));
    wasLoading.current = vt.loading;
  }, [vt.loading, vt.tasks]);
  const { min, max } = range;
  const dayW = ZOOM_W[zoom];
  const X = (day: number) => (day - min) * dayW;
  const W = (max - min + 1) * dayW;
  const bodyH = Math.max(rows.length, 1) * C.rowH + 8;
  const td = todayDn();

  const effSpan = (t: Task): Span => (ov && ov.id === t.id ? { s: ov.s, d: ov.d, both: ov.both } : span(t));
  const geom = (t: Task) => {
    const sp = effSpan(t);
    if (!has(sp.s)) return null;
    if (sp.both) return { x: X(sp.s), w: Math.max(sp.d - sp.s + 1, 1) * dayW, dia: false, sp };
    const sz = Math.round(C.barH * 0.8);
    return { x: X(sp.d) + dayW / 2 - sz / 2, w: sz, dia: true, sp };
  };

  /* ---- dependencies */
  const deps = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const t of vt.tasks) if (Array.isArray(t.blocked_by) && (t.blocked_by as string[]).length) m.set(t.id, new Set(t.blocked_by as string[]));
    for (const [k, v] of depsState) m.set(k, v);
    return m;
  }, [vt.tasks, depsState]);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const asked = useRef(new Set<string>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The task list may not carry blocked_by; ask the detail route for tasks that report blocked.
  useEffect(() => {
    const need = vt.tasks.filter((t) => !Array.isArray(t.blocked_by) && t.blocked && !isTmp(t.id) && !asked.current.has(t.id)).slice(0, 300);
    if (!need.length) return;
    for (const t of need) asked.current.add(t.id);
    const found = new Map<string, Set<string>>();
    let i = 0;
    const worker = async () => {
      while (i < need.length && alive.current) {
        const t = need[i++];
        try {
          const r = await api.task(t.code || t.id);
          const ids = ((r && r.deps && r.deps.blockedBy) || []).map((x: { id?: string }) => x.id).filter(Boolean) as string[];
          if (ids.length) found.set(t.id, new Set(ids));
        } catch {
          // the line is skipped
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      if (!alive.current || !found.size) return;
      setDepsState((prev) => {
        const m = new Map(prev);
        for (const [k, v] of found) if (!m.has(k)) m.set(k, v);
        return m;
      });
    });
  }, [vt.tasks]);

  const putDeps = (succ: string, set: Set<string>) =>
    setDepsState((prev) => {
      const m = new Map(prev);
      m.set(succ, set);
      return m;
    });
  const addDep = async (pred: string, succ: string) => {
    if (pred === succ) return;
    const cur = depsRef.current.get(succ);
    if (cur && cur.has(pred)) {
      toast('Already linked');
      return;
    }
    if (wouldCycle(depsRef.current, pred, succ)) {
      toast('That link would loop back on itself', { error: true });
      return;
    }
    putDeps(succ, new Set([...(cur || []), pred]));
    try {
      await api.deps(succ, { add: [pred] });
    } catch (e) {
      putDeps(succ, new Set([...(depsRef.current.get(succ) || [])].filter((x) => x !== pred)));
      toast(msgOf(e), { error: true });
    }
  };
  const removeDep = async (pred: string, succ: string) => {
    const cur = depsRef.current.get(succ);
    if (!cur) return;
    putDeps(succ, new Set([...cur].filter((x) => x !== pred)));
    setSelEdge(null);
    try {
      await api.deps(succ, { remove: [pred] });
    } catch (e) {
      putDeps(succ, new Set([...(depsRef.current.get(succ) || []), pred]));
      toast(msgOf(e), { error: true });
    }
  };

  /* ---- saving */
  const open = (t: Task) => {
    if (t.pending || isTmp(t.id)) return;
    openTask(t.code || t.id);
  };
  const commit = (t: Task, patch: Record<string, unknown>) => {
    setOv(null);
    return vt.patch(t, patch);
  };

  /* ---- scrolling */
  const onScroll = useRafFn(() => {
    const el = scrollRef.current;
    if (!el) return;
    const st = Math.floor(el.scrollTop / C.rowH);
    const tb = Math.floor(el.scrollLeft / 240);
    const sc = el.scrollLeft > 2;
    setScr((p) => (p.st === st && p.tb === tb && p.sc === sc ? p : { st, tb, sc }));
  });
  const goToday = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    const vw = el.clientWidth - C.leftW;
    el.scrollTo({ left: Math.max(0, X(todayDn()) - vw * 0.3), behavior: smooth ? 'smooth' : 'auto' });
  };
  // open on today, and again whenever the tasks are read again
  useIsoLayoutEffect(() => {
    goToday(false);
    onScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const pendingCenter = useRef<number | null>(null);
  const setZoomTo = (z: Zoom) => {
    if (z === zoom) return;
    const el = scrollRef.current;
    const vw = (el ? el.clientWidth : 0) - C.leftW;
    pendingCenter.current = min + ((el ? el.scrollLeft : 0) + vw / 2) / dayW;
    setZoom(z);
    writePrefs('timeline', { zoom: z });
  };
  useIsoLayoutEffect(() => {
    const c = pendingCenter.current;
    const el = scrollRef.current;
    if (c == null || !el) return;
    pendingCenter.current = null;
    const vw = el.clientWidth - C.leftW;
    el.scrollLeft = Math.max(0, (c - min) * ZOOM_W[zoom] - vw / 2);
    onScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  const ctl = useRef({ setZoomTo, zoom });
  ctl.current = { setZoomTo, zoom };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const i = ZOOMS.indexOf(ctl.current.zoom);
      ctl.current.setZoomTo(ZOOMS[clamp(i + (e.deltaY > 0 ? 1 : -1), 0, 2)]);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  /* ---- pointer work: move, resize, connect, create */
  const dragRef = useRef<TDrag | null>(null);
  const edgeScroll = useRef(0);
  const rafScroll = useRef(0);
  const rafApply = useRef(0);
  const dayAt = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return min;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left + el.scrollLeft - C.leftW;
    return clamp(min + Math.floor(x / dayW), min, max);
  };
  const finishLink = (succId: string) => {
    const pred = link;
    setLink(null);
    if (pred && succId && pred !== succId) void addDep(pred, succId);
  };

  const applyDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    const cur = dayAt(d.lastX);
    if (d.kind === 'move' || d.kind === 'resize-l' || d.kind === 'resize-r') {
      const o = d.sp0 as Span;
      const delta = cur - (d.day0 as number);
      let s = o.s;
      let e2 = o.d;
      if (d.kind === 'move') {
        const dd = clamp(delta, min - o.s, max - o.d);
        s = o.s + dd;
        e2 = o.d + dd;
      } else if (d.kind === 'resize-l') s = clamp(o.s + delta, min, o.d);
      else e2 = clamp(o.d + delta, o.s, max);
      d.cur = { s, d: e2 };
      setOv({ id: d.t.id, s, d: e2, both: o.both });
      const ri = rowIdx.get(d.t.id) ?? 0;
      const gx = o.both ? X(s) : X(e2) + dayW / 2 - Math.round(C.barH * 0.8) / 2;
      setTip({ text: o.both ? fmtRange(s, e2) : fmtShort(e2), x: gx, top: ri * C.rowH - 30 });
    } else if (d.kind === 'create') {
      let a = d.day0 as number;
      let b = cur;
      if (a > b) [a, b] = [b, a];
      d.cur = { s: a, d: b };
      setGhost({ id: d.t.id, left: X(a), width: (b - a + 1) * dayW });
      setTip({ text: a === b ? fmtShort(a) : fmtRange(a, b), x: X(a), top: (rowIdx.get(d.t.id) ?? 0) * C.rowH - 30 });
    } else if (d.kind === 'connect') {
      const ch = chartRef.current;
      if (!ch) return;
      const r = ch.getBoundingClientRect();
      const g = geom(d.t);
      const ri = rowIdx.get(d.t.id);
      if (!g || ri == null) return;
      const sx = d.side === 'r' ? g.x + g.w : g.x;
      const sy = ri * C.rowH + C.rowH / 2;
      const ex = d.lastX - r.left;
      const ey = d.lastY - r.top;
      const k = d.side === 'r' ? 40 : -40;
      setRubber('M' + sx + ',' + sy + ' C' + (sx + k) + ',' + sy + ' ' + (ex - k) + ',' + ey + ' ' + ex + ',' + ey);
      const el = document.elementFromPoint(d.lastX, d.lastY);
      const tb = el && el.closest ? (el.closest('.tl-bar') as HTMLElement | null) : null;
      d.target = null;
      if (tb && tb.dataset.id !== d.t.id) d.target = tb.dataset.id as string;
      setTarget(d.target || null);
    }
  };

  const stopDrag = () => {
    window.removeEventListener('pointermove', win.move);
    window.removeEventListener('pointerup', win.up);
    window.removeEventListener('pointercancel', win.cancel);
    document.body.classList.remove('tl-dragging');
    edgeScroll.current = 0;
    if (rafScroll.current) cancelAnimationFrame(rafScroll.current);
    rafScroll.current = 0;
    if (rafApply.current) cancelAnimationFrame(rafApply.current);
    rafApply.current = 0;
    setTip(null);
    setGhost(null);
    setRubber('');
    setTarget(null);
    setDragId(null);
  };
  const startDrag = (e: { clientX: number; clientY: number }) => {
    window.addEventListener('pointermove', win.move);
    window.addEventListener('pointerup', win.up);
    window.addEventListener('pointercancel', win.cancel);
    const d = dragRef.current as TDrag;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };
  const autoScroll = () => {
    rafScroll.current = 0;
    const el = scrollRef.current;
    if (!dragRef.current || !edgeScroll.current || !el) return;
    el.scrollLeft += edgeScroll.current;
    applyDrag();
    rafScroll.current = requestAnimationFrame(win.auto);
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < (d.touch ? 8 : 4)) return;
      if (d.kind === 'create' && d.touch) {
        stopDrag();
        dragRef.current = null;
        return;
      }
      d.moved = true;
      document.body.classList.add('tl-dragging');
      if (d.kind !== 'create' && d.kind !== 'connect') setDragId(d.t.id);
    }
    if (e.cancelable) e.preventDefault();
    if (!rafApply.current)
      rafApply.current = requestAnimationFrame(() => {
        rafApply.current = 0;
        applyDrag();
      });
    // scroll the chart when the pointer reaches an edge
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const edge = 56;
    edgeScroll.current = 0;
    if (e.clientX > r.right - edge) edgeScroll.current = Math.ceil((e.clientX - (r.right - edge)) / 3);
    else if (e.clientX < r.left + C.leftW + edge && el.scrollLeft > 0) edgeScroll.current = -Math.ceil((r.left + C.leftW + edge - e.clientX) / 3);
    if (edgeScroll.current && !rafScroll.current) rafScroll.current = requestAnimationFrame(win.auto);
  };
  const onCancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setOv(null);
    stopDrag();
  };
  const onUp = async () => {
    const d = dragRef.current;
    if (!d) return;
    if (d.moved) applyDrag();
    dragRef.current = null;
    stopDrag();
    if (d.kind === 'connect') {
      if (d.moved && d.target) {
        if (d.side === 'r') void addDep(d.t.id, d.target);
        else void addDep(d.target, d.t.id);
      }
      return;
    }
    if (d.kind === 'create') {
      if (!d.moved) {
        if (d.touch && Date.now() - (d.t0 as number) > 500) return;
        const day = d.day0 as number;
        const was = { start_date: d.t.start_date, due_date: d.t.due_date };
        await commit(d.t, { due_date: ymd(day) });
        toast('Due ' + fmtShort(day), { action: { label: 'Undo', fn: () => void commit(d.t, was) } });
      } else {
        const { s, d: dd } = d.cur as { s: number; d: number };
        await commit(d.t, s === dd ? { due_date: ymd(dd) } : { start_date: ymd(s), due_date: ymd(dd) });
      }
      return;
    }
    // bar drags
    if (!d.moved) {
      setOv(null);
      if (d.touch) {
        open(d.t);
        return;
      }
      setSel(d.t.id);
      open(d.t);
      return;
    }
    const c = d.cur;
    const o = d.sp0 as Span;
    if (!c || (c.s === o.s && c.d === o.d)) {
      setOv(null);
      return;
    }
    await commit(d.t, datePatch(d.t, c.s, c.d, o.both));
  };
  // The window listeners must keep one identity from add to remove, and must run the latest closures.
  const latest = useRef({ move: onMove, up: onUp, cancel: onCancel, auto: autoScroll });
  latest.current = { move: onMove, up: onUp, cancel: onCancel, auto: autoScroll };
  const win = useMemo(
    () => ({
      move: (e: PointerEvent) => latest.current.move(e),
      up: () => void latest.current.up(),
      cancel: () => latest.current.cancel(),
      auto: () => latest.current.auto(),
    }),
    []
  );
  useEffect(
    () => () => {
      window.removeEventListener('pointermove', win.move);
      window.removeEventListener('pointerup', win.up);
      window.removeEventListener('pointercancel', win.cancel);
      document.body.classList.remove('tl-dragging');
      if (rafScroll.current) cancelAnimationFrame(rafScroll.current);
      if (rafApply.current) cancelAnimationFrame(rafApply.current);
    },
    [win]
  );

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button != null && e.button > 0) return;
    const tg = e.target as HTMLElement;
    // the Remove link button sits in the chart; pressing it must not clear the link it removes
    if (tg.closest('.tl-edgebtn')) return;
    if (selEdge) setSelEdge(null);
    const barEl = tg.closest('.tl-bar') as HTMLElement | null;
    if (barEl) {
      const t = byId.get(barEl.dataset.id || '');
      if (!t) return;
      const part = tg.dataset && tg.dataset.part ? tg.dataset.part : 'body';
      const touch = e.pointerType === 'touch';
      if (link) {
        e.preventDefault();
        finishLink(t.id);
        return;
      }
      if (touch && sel !== t.id) {
        // first tap selects; the selected bar can then be dragged
        setSel(t.id);
        return;
      }
      if (part === 'dl' || part === 'dr') {
        e.preventDefault();
        dragRef.current = { kind: 'connect', t, side: part === 'dr' ? 'r' : 'l', x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, touch };
        startDrag(e);
        return;
      }
      dragRef.current = {
        kind: part === 'l' ? 'resize-l' : part === 'r' ? 'resize-r' : 'move',
        t,
        sp0: span(t),
        day0: dayAt(e.clientX),
        x0: e.clientX,
        y0: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
        touch,
      };
      if (!touch || sel === t.id) {
        if (e.cancelable) e.preventDefault();
      }
      startDrag(e);
      return;
    }
    const rowEl = tg.closest('.tl-row') as HTMLElement | null;
    if (rowEl && rowEl.dataset.id && rowEl.classList.contains('is-undated')) {
      const t = byId.get(rowEl.dataset.id);
      if (!t) return;
      if (link) return;
      dragRef.current = { kind: 'create', t, day0: dayAt(e.clientX), x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, touch: e.pointerType === 'touch', t0: Date.now() };
      startDrag(e);
      return;
    }
    if (sel && !tg.closest('.tl-actions')) setSel(null);
  };

  /* ---- clicks, the add row, the keyboard */
  const onChartClick = (e: React.MouseEvent) => {
    const hit = (e.target as Element).closest<SVGElement>('.tl-edge-hit');
    if (hit) setSelEdge({ a: hit.getAttribute('data-a') || '', b: hit.getAttribute('data-b') || '' });
  };
  const toggleGroup = (k: string) => {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };
  const startAdd = (k: string) => {
    setAddAt({ key: k });
    setAddTitle('');
    setCollapsed((prev) => {
      if (!prev.has(k)) return prev;
      const n = new Set(prev);
      n.delete(k);
      return n;
    });
  };
  useEffect(() => {
    if (addAt) leftRef.current?.querySelector<HTMLInputElement>('.tl-lrow--add input')?.focus();
  }, [addAt]);
  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = addTitle.trim();
    if (!text) {
      setAddAt(null);
      return;
    }
    if (addBusy) return;
    const fields: Record<string, unknown> = { title: text };
    if (addAt && addAt.key && group === 'section') fields.section_id = addAt.key;
    setAddBusy(true);
    const t = await ctx.create(fields);
    setAddBusy(false);
    // stay open for the next one
    if (t) setAddTitle('');
    requestAnimationFrame(() => leftRef.current?.querySelector<HTMLInputElement>('.tl-lrow--add input')?.focus());
  };

  const onKey = (e: RKeyboardEvent) => {
    const tg = e.target as Element;
    if (e.key === 'Escape') {
      if (link) setLink(null);
      else if (addAt) setAddAt(null);
      else if (selEdge) setSelEdge(null);
      else if (sel) setSel(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selEdge && !tg.closest('input')) {
      void removeDep(selEdge.a, selEdge.b);
      return;
    }
    const barEl = tg.closest ? (tg.closest('.tl-bar') as HTMLElement | null) : null;
    if (!barEl) return;
    const t = byId.get(barEl.dataset.id || '');
    if (!t) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      open(t);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      setSel(t.id);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1);
      const sp = span(t);
      if (!has(sp.s)) return;
      let s = sp.s;
      let d = sp.d;
      if (e.altKey && sp.both) d = Math.max(s, d + step);
      else {
        s += step;
        d += step;
      }
      void commit(t, datePatch(t, s, d, sp.both)).then(() => {
        const n = rowsRef.current?.querySelector<HTMLElement>('.tl-bar[data-id="' + CSS.escape(t.id) + '"]');
        if (n) n.focus({ preventScroll: true });
      });
    }
  };

  /* ---- drawing */
  const win0 = rowWindow(scr.st * C.rowH, size.h, C.headH, C.rowH, rows.length);
  const { first, last } = win0;

  const ticks = useMemo(() => {
    const vw = size.w;
    const sl = scr.tb * 240;
    const x0 = Math.max(0, sl - 500);
    const x1 = Math.min(W, sl + vw + 500);
    const d0 = clamp(min + Math.floor(x0 / dayW), min, max);
    const d1 = clamp(min + Math.ceil(x1 / dayW), min, max);
    const top: ReactNode[] = [];
    const bot: ReactNode[] = [];
    const lines: ReactNode[] = [];
    const cellH = C.headH / 2;
    const Xd = (day: number) => (day - min) * dayW;
    if (zoom === 'month') {
      // top: years, bottom: months
      for (let y = parts(d0).y; ; y++) {
        const ys = Math.max(mkDn(y, 0, 1), min);
        const ye = Math.min(mkDn(y + 1, 0, 1) - 1, max);
        if (ys > d1) break;
        if (ye < d0) continue;
        top.push(
          <div key={'y' + y} className="tl-tk tl-tk--top" style={{ left: Xd(ys), width: (ye - ys + 1) * dayW, height: cellH }}>
            <span>{y}</span>
          </div>
        );
      }
      for (const { y, m, ms, me } of monthsBetween(d0, d1)) {
        const s = Math.max(ms, min);
        const e = Math.min(me, max);
        const cur = td >= ms && td <= me;
        bot.push(
          <div key={'m' + y + '-' + m} className={'tl-tk' + (cur ? ' is-today' : '')} style={{ left: Xd(s), width: (e - s + 1) * dayW, top: cellH, height: cellH }}>
            <span>{MON3[m]}</span>
          </div>
        );
        lines.push(<i key={'l' + y + '-' + m} className="tl-ln" style={{ left: Xd(s) }} />);
      }
    } else {
      for (const { y, m, ms, me } of monthsBetween(d0, d1)) {
        const s = Math.max(ms, min);
        const e = Math.min(me, max);
        top.push(
          <div key={'t' + y + '-' + m} className="tl-tk tl-tk--top" style={{ left: Xd(s), width: (e - s + 1) * dayW, height: cellH }}>
            <span>{MONTHS[m] + ' ' + y}</span>
          </div>
        );
      }
      if (zoom === 'day') {
        for (let d = d0; d <= d1; d++) {
          const wk = (((d + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday, so (d + 4) % 7 is the weekday with Sunday = 0
          const weekend = wk === 0 || wk === 6;
          const pd = parts(d);
          bot.push(
            <div key={'d' + d} className={'tl-tk' + (d === td ? ' is-today' : '') + (weekend ? ' is-wknd' : '')} style={{ left: Xd(d), width: dayW, top: cellH, height: cellH }}>
              <span>
                {pd.d}
                <small>{DOW3[wk][0]}</small>
              </span>
            </div>
          );
          lines.push(<i key={'l' + d} className={'tl-ln' + (wk === 0 ? ' is-major' : '')} style={{ left: Xd(d) }} />);
          if (weekend) lines.push(<i key={'w' + d} className="tl-wk" style={{ left: Xd(d), width: dayW }} />);
        }
      } else {
        for (let d = startOfWeek(d0); d <= d1; d += 7) {
          const s = Math.max(d, min);
          const e = Math.min(d + 6, max);
          const cur = td >= d && td <= d + 6;
          bot.push(
            <div key={'k' + d} className={'tl-tk' + (cur ? ' is-today' : '')} style={{ left: Xd(s), width: (e - s + 1) * dayW, top: cellH, height: cellH }}>
              <span>{fmtShort(d)}</span>
            </div>
          );
          lines.push(<i key={'l' + d} className="tl-ln" style={{ left: Xd(s) }} />);
        }
      }
    }
    if (td >= min && td <= max) lines.push(<i key="today" className="tl-today" style={{ left: Xd(td) + dayW / 2 }} />);
    return { top, bot, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scr.tb, size.w, zoom, min, max, td, C.headH]);

  const bar = (t: Task) => {
    const g = geom(t);
    if (!g) return null;
    const sp = g.sp;
    const done = isDone(t);
    const over = isOverdue(t);
    const c = colorOf(t.project ? t.project.color : 'slate');
    const total = t.subtasks && t.subtasks.total ? t.subtasks.total : 0;
    const prog = total ? Math.round((t.subtasks.done / total) * 100) : done ? 100 : 0;
    const inside = !g.dia && g.w >= 84;
    const rng = sp.both ? fmtRange(sp.s, sp.d) : fmtShort(sp.d);
    return (
      <div
        className={
          'tl-bar' + (g.dia ? ' is-dia' : '') + (done ? ' is-done' : '') + (over ? ' is-over' : '') + (t.blocked ? ' is-blocked' : '') + (sel === t.id ? ' is-sel' : '') + (inside ? ' is-in' : ' is-out') +
          (!g.dia && g.w < (C.phone ? 66 : 40) ? ' is-narrow' : '') + (dragId === t.id ? ' is-drag' : '') + (target === t.id ? ' is-target' : '')
        }
        data-id={t.id}
        data-pc={c}
        tabIndex={0}
        role="button"
        aria-label={t.title + ', ' + rng + (done ? ', completed' : '')}
        style={{ left: g.x, width: g.w }}
      >
        {g.dia ? <i className="tl-dia" /> : <i className="tl-prog" style={{ width: prog + '%' }} />}
        <span className="tl-bl">{t.title}</span>
        {g.dia ? null : (
          <>
            <i className="tl-h tl-h--l" data-part="l" />
            <i className="tl-h tl-h--r" data-part="r" />
          </>
        )}
        <i className="tl-dot tl-dot--l" data-part="dl" />
        <i className="tl-dot tl-dot--r" data-part="dr" />
      </div>
    );
  };

  const leftRows: ReactNode[] = [];
  const chartRows: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const r = rows[i];
    if (!r) continue;
    const y = i * C.rowH;
    if (r.k === 'g') {
      const g = r.g;
      const col = collapsed.has(g.key);
      leftRows.push(
        <div key={'g' + g.key} className="tl-lrow tl-lrow--g" style={{ top: y }} data-g={g.key}>
          <button type="button" className="tl-gtog" aria-expanded={!col} aria-label={(col ? 'Expand ' : 'Collapse ') + g.label} onClick={() => toggleGroup(g.key)}>
            <IChev />
          </button>
          <b className="tl-gname">{g.label}</b>
          <span className="tl-gn">{g.n}</span>
          {group === 'section' ? (
            <button type="button" className="tl-gadd" aria-label={'Add a task to ' + g.label} onClick={() => startAdd(g.key)}>
              <IPlus />
            </button>
          ) : null}
        </div>
      );
      chartRows.push(
        <div key={'g' + g.key} className="tl-row tl-row--g" style={{ top: y }}>
          {g.lo === g.lo && g.lo !== Infinity ? <i className="tl-sum" style={{ left: X(g.lo), width: Math.max((g.hi - g.lo + 1) * dayW, 6) }} /> : null}
        </div>
      );
    } else if (r.k === 'a') {
      leftRows.push(
        <form key={'a' + r.key} className="tl-lrow tl-lrow--add" style={{ top: y }} data-add="1" onSubmit={submitAdd}>
          <input type="text" maxLength={180} placeholder="Task name" aria-label="New task name" autoComplete="off" value={addTitle} disabled={addBusy} onChange={(e) => setAddTitle(e.target.value)} />
          <button type="submit" className="tl-addgo" aria-label="Add">
            <ICheck />
          </button>
        </form>
      );
      chartRows.push(<div key={'a' + r.key} className="tl-row" style={{ top: y }} />);
    } else {
      const t = r.t;
      const done = isDone(t);
      const over = isOverdue(t);
      const sp = span(t);
      const dateTxt = has(sp.s) ? (sp.both ? fmtRange(sp.s, sp.d) : fmtShort(sp.d)) : '';
      leftRows.push(
        <div key={'t' + t.id} className={'tl-lrow' + (sel === t.id ? ' is-sel' : '') + (done ? ' is-done' : '')} style={{ top: y }} data-id={t.id} {...(r.depth ? { 'data-sub': '1' } : {})}>
          <button type="button" className="tl-check" aria-pressed={done} aria-label={(done ? 'Mark not complete: ' : 'Mark complete: ') + t.title} onClick={() => void vt.toggleDone(t)}>
            <ICheck />
          </button>
          <button
            type="button"
            className="tl-title"
            title={t.title}
            onClick={() => {
              if (link) {
                finishLink(t.id);
                return;
              }
              setSel(t.id);
              open(t);
            }}
          >
            {t.title}
          </button>
          {group !== 'owner' && t.owner ? <PjvAvatar p={t.owner} size="sm" /> : null}
          {dateTxt ? <span className={'tl-dt' + (over ? ' is-late' : '')}>{dateTxt}</span> : null}
        </div>
      );
      const has1 = geom(t);
      chartRows.push(
        <div key={'t' + t.id} className={'tl-row' + (has1 ? '' : ' is-undated') + (sel === t.id ? ' is-sel' : '')} style={{ top: y }} data-id={t.id}>
          {bar(t)}
          {ghost && ghost.id === t.id ? <div className="tl-ghost" style={{ left: ghost.left, width: ghost.width }} /> : null}
        </div>
      );
    }
  }

  // dependency lines for the rows on screen (and one more each way)
  const edges: { a: string; b: string; d: string; bx: number; by: number; bad: boolean; hot: boolean; dim: boolean; pts: Pt[] }[] = [];
  {
    const f = first - 1;
    const l = last + 1;
    for (const [succ, preds] of deps) {
      const si = rowIdx.get(succ);
      if (si == null) continue;
      for (const pred of preds) {
        const pi = rowIdx.get(pred);
        if (pi == null) continue;
        if (Math.max(si, pi) < f || Math.min(si, pi) > l) continue;
        const ta = byId.get(pred);
        const tb = byId.get(succ);
        if (!ta || !tb) continue;
        const ga = geom(ta);
        const gb = geom(tb);
        if (!ga || !gb) continue;
        const ay = pi * C.rowH + C.rowH / 2;
        const by = si * C.rowH + C.rowH / 2;
        const ax = ga.x + ga.w;
        const bx = gb.x;
        const pts = edgePts(ax, ay, bx, by, C.rowH);
        edges.push({
          a: pred,
          b: succ,
          d: roundedPath(pts, 5),
          bx,
          by,
          bad: bx < ax + dayW * 0.5 && !isDone(ta),
          hot: !!selEdge && selEdge.a === pred && selEdge.b === succ,
          dim: isDone(ta) && isDone(tb),
          pts,
        });
      }
    }
  }
  const hotEdge = selEdge ? edges.find((x) => x.a === selEdge.a && x.b === selEdge.b) : null;
  let edgeBtn: ReactNode = null;
  if (hotEdge) {
    // midpoint of the middle segment
    const pts = hotEdge.pts;
    const k = Math.floor((pts.length - 1) / 2);
    const m = pts[k];
    const n = pts[k + 1];
    edgeBtn = (
      <button type="button" className="tl-edgebtn" style={{ left: (m[0] + n[0]) / 2, top: (m[1] + n[1]) / 2 }} aria-label="Remove link" onClick={() => void removeDep(hotEdge.a, hotEdge.b)}>
        <IX />
        <span>Remove link</span>
      </button>
    );
  }

  const selTask = sel ? byId.get(sel) : null;
  const showActions = !!selTask && (coarse || C.phone);

  const rootStyle = { '--tl-left': C.leftW + 'px', '--tl-row': C.rowH + 'px', '--tl-bar': C.barH + 'px', '--tl-day': dayW + 'px' } as CSSProperties;
  const empty = rows.length === 0 && !vt.loading;

  return (
    <div
      ref={rootRef}
      className={'pjv-root pjv-tl' + (C.phone ? ' is-phone' : '') + (link ? ' is-linking' : '') + (scr.sc ? ' is-scrolled' : '') + (vt.loading ? ' is-loading' : '')}
      data-pjv="timeline"
      style={rootStyle}
      onKeyDown={onKey}
    >
      <div className="pjv-bar" role="toolbar" aria-label="Timeline">
        <div className="pjv-seg" role="group" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} type="button" aria-pressed={z === zoom} onClick={() => setZoomTo(z)}>
              {cap(z)}
            </button>
          ))}
        </div>
        <button type="button" className="pjv-btn" onClick={() => goToday(true)}>
          Today
        </button>
        <label className="pjv-sel">
          <span>Group</span>
          <select
            aria-label="Group by"
            value={group}
            onChange={(e) => {
              const g = e.target.value as GroupBy;
              setGroup(g);
              writePrefs('timeline', { group: g });
              setAddAt(null);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
          >
            <option value="section">Section</option>
            <option value="owner">Owner</option>
            <option value="none">None</option>
          </select>
        </label>
        <button
          type="button"
          className="pjv-btn pjv-btn--tog"
          aria-pressed={showDone}
          onClick={() => {
            setShowDone(!showDone);
            writePrefs('timeline', { showDone: !showDone });
          }}
        >
          Completed
        </button>
        <span className="pjv-count" aria-live="polite">
          {items.length + (items.length === 1 ? ' task' : ' tasks')}
        </span>
      </div>
      <div className="tl-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="tl-canvas" style={{ width: C.leftW + W }}>
          <div className="tl-head" style={{ height: C.headH, width: C.leftW + W }}>
            <div className="tl-corner" style={{ width: C.leftW }}>
              <span>{GROUP_LABEL[group]}</span>
            </div>
            <div className="tl-ticks" style={{ left: C.leftW, width: W }}>
              {ticks.top}
              {ticks.bot}
            </div>
          </div>
          <div className="tl-body" style={{ height: bodyH, width: C.leftW + W }}>
            <div className="tl-left" ref={leftRef} style={{ width: C.leftW }}>
              {leftRows}
            </div>
            <div className="tl-chart" ref={chartRef} style={{ left: C.leftW, width: W }} onPointerDown={onDown} onClick={onChartClick}>
              <div className="tl-lines">{ticks.lines}</div>
              <div className="tl-rows" ref={rowsRef}>
                {chartRows}
              </div>
              <svg className="tl-svg" aria-hidden="true" width={W} height={bodyH}>
                {edges.map((x) => (
                  <g key={x.a + '>' + x.b} className={'tl-edge' + (x.bad ? ' is-bad' : '') + (x.hot ? ' is-hot' : '') + (x.dim ? ' is-dim' : '')}>
                    <path className="tl-edge-p" d={x.d} />
                    <path className="tl-edge-a" d={'M' + x.bx + ',' + x.by + ' l-6,-4 l0,8 z'} />
                    <path className="tl-edge-hit" d={x.d} data-a={x.a} data-b={x.b} />
                  </g>
                ))}
                <path className="tl-rubber" d={rubber} style={rubber ? undefined : { display: 'none' }} />
              </svg>
              <div className="tl-float">
                {tip ? (
                  <div className="tl-tip" style={{ left: tip.x, top: tip.top }}>
                    {tip.text}
                  </div>
                ) : null}
                {edgeBtn}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="tl-empty" hidden={!empty}>
        {empty ? vt.error || 'No tasks' : ''}
      </div>
      <div className="tl-actions" hidden={!showActions}>
        {showActions && selTask ? (
          link ? (
            <>
              <span className="tl-act-msg">Tap the task that comes after {selTask.title}</span>
              <button type="button" className="pjv-btn" onClick={() => setLink(null)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <span className="tl-act-t">{selTask.title}</span>
              <button type="button" className="pjv-btn" onClick={() => open(selTask)}>
                Open
              </button>
              <button type="button" className="pjv-btn" disabled={!has(span(selTask).s)} onClick={() => setLink(selTask.id)}>
                Link
              </button>
              <button type="button" className="pjv-btn" onClick={() => void vt.toggleDone(selTask)}>
                {isDone(selTask) ? 'Reopen' : 'Done'}
              </button>
              <button type="button" className="pjv-btn pjv-btn--ico" aria-label="Clear selection" onClick={() => setSel(null)}>
                <IX />
              </button>
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

