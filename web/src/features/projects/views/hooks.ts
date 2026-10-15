// Hooks the three views share. Everything that reads the window runs in an effect, so the first paint on the server and in the browser
// match; each starts from a server-safe value.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { api } from '../lib/api';
import { fetchAllTasks, useCtx, type TaskCtx } from '../lib/store';
import { toast } from '../kit/toast';
import type { Task } from '../types';
import { msgOf } from './common';

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** True on a phone-width window (720 px, the width the view styles switch at). False until the browser has measured. */
export function usePhone(max = 720): boolean {
  const [phone, setPhone] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: ' + max + 'px)');
    const run = () => setPhone(mq.matches);
    run();
    mq.addEventListener('change', run);
    window.addEventListener('resize', run);
    return () => {
      mq.removeEventListener('change', run);
      window.removeEventListener('resize', run);
    };
  }, [max]);
  return phone;
}

/** Make the view fill the window under its own top edge. Phones pin with measured pixels, never viewport units. */
export function useFitHeight(ref: RefObject<HTMLElement | null>, min: number): void {
  useIsoLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const run = () => {
      const top = root.getBoundingClientRect().top;
      const h = Math.max(min || 420, Math.floor(window.innerHeight - top - (window.matchMedia('(max-width: 720px)').matches ? 8 : 16)));
      root.style.height = h + 'px';
    };
    run();
    window.addEventListener('resize', run);
    window.addEventListener('orientationchange', run);
    const t = setTimeout(run, 400);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', run);
      window.removeEventListener('orientationchange', run);
    };
  }, [ref, min]);
}

/** The size of an element, kept current. Starts at the fallback so the server and the first browser paint agree. */
export function useSize(ref: RefObject<HTMLElement | null>, fallback: { w: number; h: number }, remeasure?: unknown): { w: number; h: number } {
  const [size, setSize] = useState(fallback);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const run = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    run();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, remeasure]);
  return size;
}

/* ---------------------------------------------------------------- remembered choices (localStorage, keys pjv.<name>) */

export function readPrefs(key: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem('pjv.' + key) || '{}') || {};
  } catch {
    return {};
  }
}
export function writePrefs(key: string, o: Record<string, unknown>): void {
  const v = { ...readPrefs(key), ...o };
  try {
    localStorage.setItem('pjv.' + key, JSON.stringify(v));
  } catch {
    // storage refused
  }
}

/** Runs once in the browser, before the first paint, with the remembered choices for a view. */
export function useLoadPrefs(key: string, apply: (p: Record<string, unknown>) => void): void {
  const ref = useRef(apply);
  ref.current = apply;
  useIsoLayoutEffect(() => {
    ref.current(readPrefs(key));
  }, [key]);
}

/** While `on`, the hub's Back button (hubOv) closes this overlay. */
export function useHubOverlay(on: boolean, close: () => void): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!on) return;
    const ov = (window as unknown as { hubOv?: { on: (f: () => void) => unknown; off: (t: unknown) => void } }).hubOv;
    const tok = ov && ov.on ? ov.on(() => ref.current()) : null;
    return () => {
      if (tok && ov && ov.off) ov.off(tok);
    };
  }, [on]);
}

/** Run fn on the next animation frame, once however many times it is called before then. */
export function useRafFn(fn: () => void): { (): void; cancel: () => void } {
  const ref = useRef(fn);
  ref.current = fn;
  const raf = useRef(0);
  const f = useMemo(() => {
    const g = () => {
      if (raf.current) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        ref.current();
      });
    };
    g.cancel = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    return g;
  }, []);
  useEffect(() => f.cancel, [f]);
  return f;
}

/* ---------------------------------------------------------------- the tasks a view draws */

export interface ViewTasks {
  /** Every top-level task of the project the store holds, plus completed ones read for this view when the store has not loaded them. */
  tasks: Task[];
  /** Reading from the server. */
  loading: boolean;
  error: string;
  /** Change fields on a task through the store (the list and the board stay in step). Returns true when it saved. */
  patch: (t: Task, body: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<boolean>;
  toggleDone: (t: Task) => Promise<boolean>;
}

/**
 * The views read the page's task store, so the list, board, calendar and timeline always show the same tasks. The store holds open
 * tasks until Show completed is on; a view that shows completed work (its own Completed button, on by default) reads them once more
 * with status=done and keeps them beside the store's tasks. A completed task is moved into the store the moment it is changed.
 */
export function useViewTasks(ctx: TaskCtx, wantDone: boolean): ViewTasks {
  const version = useCtx(ctx);
  const [extra, setExtra] = useState<Task[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const pid = ctx.project ? ctx.project.id : '';
  const need = wantDone && !ctx.doneLoaded && !!pid;

  useEffect(() => {
    if (!need) return;
    let dead = false;
    setFetching(true);
    fetchAllTasks((q) => api.tasks(q), { project: pid, status: 'done' })
      .then((r) => {
        if (dead) return;
        setExtra(r.tasks);
        setError('');
      })
      .catch((e) => {
        if (dead) return;
        setError(msgOf(e));
        toast(msgOf(e), { error: true });
      })
      .finally(() => {
        if (!dead) setFetching(false);
      });
    return () => {
      dead = true;
    };
  }, [need, pid]);

  const tasks = useMemo(() => {
    if (!extra.length) return ctx.tasks.slice();
    return ctx.tasks.concat(extra.filter((t) => !ctx.by.has(t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, version, extra]);

  const patch = useCallback(
    (t: Task, body: Record<string, unknown>, opts?: { quiet?: boolean }) => {
      if (!ctx.by.has(t.id)) {
        ctx.tasks.push(t);
        ctx.by.set(t.id, t);
      }
      return ctx.patch(t.id, body, opts);
    },
    [ctx]
  );
  const toggleDone = useCallback(
    (t: Task) => {
      const done = t.status === 'done' || t.status === 'dropped' || !!t.done_at;
      return patch(t, { done: !done });
    },
    [patch]
  );

  return { tasks, loading: ctx.loading || fetching, error: error || ctx.error, patch, toggleDone };
}

/** Whether a media query matches. False until the browser has measured. */
export function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useIsoLayoutEffect(() => {
    const mq = window.matchMedia(query);
    const run = () => setOn(mq.matches);
    run();
    mq.addEventListener('change', run);
    return () => mq.removeEventListener('change', run);
  }, [query]);
  return on;
}
