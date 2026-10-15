// Meetings: the small pieces every Meetings page shares (React twin of public/js/meet/ui.js): icons, avatars, the toast, the confirm card,
// the /api/meet fetch, date formats and the pump that finishes a meeting's recording work. Nothing here reads the browser while drawing.
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { navQuery } from '../../lib/queries';
import { ICONS } from './icons';
import { meetApi } from './queryBase';

export { MeetError, meetApi, meetQuery } from './queryBase';

/** One of the Meetings icons (same paths as the classic pages). */
export function Icon({ n, className = '' }: { n: string; className?: string }) {
  return <svg className={('h-i ' + className).trim()} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[n] || '' }} />;
}

const COLORS = ['#5a7250', '#8a6b3a', '#4f6f86', '#8a4f5e', '#6b5a8a', '#3f7a6a', '#a0673f', '#5e6b3a', '#7a4f3a', '#3f5e8a', '#86714f', '#6a3f5e'];
export const hashColor = (s: string): string => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
export const initials = (n: string | null | undefined): string => {
  const w = String(n || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
};
export function Avatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={('mt-av ' + className).trim()} style={{ background: hashColor(name) }}>
      {initials(name)}
    </span>
  );
}

/* ---------------------------------------------------------------- dates */
// The browser's own time zone, as the classic pages draw (they call toLocaleTimeString with no zone). A date drawn on the server and in the
// browser can differ, so draw read dates inside Suspense (the browser and the server then agree on the same read) or after mount.
export const fmtTime = (iso: string | number): string => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso: string | number): string => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const roomPath = (id: string): string => '/meet/room/?m=' + id;
/** The full link to a room. Call it in an event handler or an effect (it reads location). */
export const roomLink = (id: string): string => location.origin + roomPath(id);

/* ---------------------------------------------------------------- toast */
let toastState = { msg: '', on: false };
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastSubs = new Set<() => void>();
const toastServer = { msg: '', on: false };
const toastEmit = () => toastSubs.forEach((f) => f());
export function toast(msg: string) {
  toastState = { msg, on: true };
  toastEmit();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastState = { ...toastState, on: false };
    toastEmit();
  }, 3000);
}
/** The one toast box (#toast.toast) the Meetings pages share. Put it once on a page. */
export function MeetToast() {
  const s = useSyncExternalStore(
    (f) => {
      toastSubs.add(f);
      return () => toastSubs.delete(f);
    },
    () => toastState,
    () => toastServer
  );
  return BodyPortal(
    <div id="toast" className={'toast' + (s.on ? ' is-on' : '')} role="status" aria-live="polite">
      {s.msg}
    </div>
  );
}
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied');
  } catch {
    toast('Copy this link: ' + text);
  }
}

/* ---------------------------------------------------------------- confirm card */
export interface ConfirmOpts {
  title: string;
  body?: string;
  ok?: string;
  cancel?: string;
  danger?: boolean;
  extra?: string | null;
}
type Pending = ConfirmOpts & { resolve: (v: boolean | 'extra') => void };
let pending: Pending | null = null;
const cfSubs = new Set<() => void>();
const cfEmit = () => cfSubs.forEach((f) => f());
/** An in-page confirm card in the hub style. Resolves true, false, or 'extra' when a second action is given. Needs <ConfirmHost /> on the page. */
export function confirmCard(o: ConfirmOpts): Promise<boolean | 'extra'> {
  return new Promise((resolve) => {
    if (pending) pending.resolve(false);
    pending = { ...o, resolve };
    cfEmit();
  });
}
export function ConfirmHost() {
  const cur = useSyncExternalStore(
    (f) => {
      cfSubs.add(f);
      return () => cfSubs.delete(f);
    },
    () => pending,
    () => null
  );
  return BodyPortal(cur ? <ConfirmCard key={cur.title + (cur.body || '')} o={cur} /> : null);
}
function ConfirmCard({ o }: { o: Pending }) {
  const wrap = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  const done = useCallback(
    (v: boolean | 'extra') => {
      if (pending !== o) return;
      pending = null;
      cfEmit();
      try {
        (prev.current as HTMLElement | null)?.focus?.();
      } catch {
        // the old focus target is gone
      }
      o.resolve(v);
    },
    [o]
  );
  useEffect(() => {
    prev.current = document.activeElement;
    const el = wrap.current;
    const first = el?.querySelector<HTMLElement>(o.danger ? '[data-r="no"]' : '[data-r="yes"]');
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === 'Tab' && el) {
        const bs = Array.from(el.querySelectorAll<HTMLElement>('button'));
        const i = bs.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [o, done]);
  return (
    <div className="cf" ref={wrap} onClick={(e) => e.target === wrap.current && done(false)}>
      <div className="cf__card" role="alertdialog" aria-modal="true" aria-labelledby="cf-t">
        <h3 id="cf-t">{o.title}</h3>
        {o.body ? <p>{o.body}</p> : null}
        <div className="cf__acts">
          <button type="button" className="h-btn h-btn--ghost" data-r="no" onClick={() => done(false)}>
            {o.cancel || 'Cancel'}
          </button>
          {o.extra ? (
            <button type="button" className="h-btn h-btn--ghost cf-warn" data-r="extra" onClick={() => done('extra')}>
              {o.extra}
            </button>
          ) : null}
          <button type="button" className={'h-btn ' + (o.danger ? 'h-btn--danger' : 'h-btn--primary')} data-r="yes" onClick={() => done(true)}>
            {o.ok || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The signed-in person from the menu answer (null until it arrives). */
export function useMe(): { email: string; name: string; picture: string; role: string } | null {
  const q = useQuery(navQuery);
  return (q.data?.user as { email: string; name: string; picture: string; role: string } | undefined) ?? null;
}

/* ---------------------------------------------------------------- pump */
let pumping = false;
/** Drives the work a finished meeting needs (recording to Drive, transcript, notes). With an id: that meeting. Without: whichever is next. */
export async function pump(id?: string, onStep?: (msg: string) => void): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let i = 0; i < (id ? 400 : 25); i++) {
      let r: any;
      try {
        r = await meetApi(id ? 'meetings/' + id + '/pump' : 'meetings/pump', { method: 'POST', body: {} });
      } catch {
        break;
      }
      onStep?.(
        r.state === 'uploading'
          ? 'Saving the recording to Google Drive, ' + r.progress + '.'
          : r.state === 'trimming'
            ? 'Cutting the recording in Drive, ' + r.progress + '. It plays as it was until the new file is ready.'
            : r.state === 'transcribing'
              ? 'Reading the recording.'
              : ''
      );
      if (r.done) {
        if (!id && r.state !== 'idle') continue;
        break;
      }
      if (!r.ok) await new Promise((res) => setTimeout(res, 4000));
    }
  } finally {
    pumping = false;
  }
}

/** The grey waiting box the classic pages hold while a read loads (final size, so nothing jumps). */
export function Wait({ h = 260, children }: { h?: number; children?: ReactNode }) {
  return (
    <div className="h-card h-skel" style={{ minHeight: h }}>
      {children}
    </div>
  );
}

/** The Send the link sheet (public/js/meet/send.js, a self-contained dialog that sets window.FavorSend). Loaded the first time it is needed. */
export function loadSend(): Promise<{ open: (o: Record<string, unknown>) => void } | null> {
  const w = window as unknown as { FavorSend?: { open: (o: Record<string, unknown>) => void } };
  if (w.FavorSend) return Promise.resolve(w.FavorSend);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/js/meet/send.js?v=1';
    s.onload = () => resolve(w.FavorSend || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

/* ---------------------------------------------------------------- browser-zone dates */
const noSub = () => () => undefined;
/** False while the server draws and while the browser hydrates, true after: the way to draw anything that depends on the browser's time zone. */
export const useHydrated = (): boolean => useSyncExternalStore(noSub, () => true, () => false);
/** A date in the browser's zone, as the classic pages draw it. Empty on the server and during hydration, filled the moment the page is live. */
export function Day({ iso }: { iso: string | number | null | undefined }) {
  const on = useHydrated();
  return <>{on && iso ? fmtDay(iso) : ''}</>;
}
export function Time({ iso }: { iso: string | number | null | undefined }) {
  const on = useHydrated();
  return <>{on && iso ? fmtTime(iso) : ''}</>;
}

/** Puts text after the top bar's crumb (" / title"); clears it when the page goes. The top bar draws after the page, so it asks until the element exists. */
export function useCrumb(prefix: string, text: string) {
  useEffect(() => {
    let el: HTMLElement | null = null;
    const put = () => {
      el = document.getElementById('h-crumb2');
      if (el && text) el.textContent = text;
      return !!el;
    };
    let t: ReturnType<typeof setInterval> | undefined;
    if (!put()) {
      let n = 0;
      t = setInterval(() => {
        if (put() || ++n > 100) clearInterval(t);
      }, 100);
    }
    return () => {
      clearInterval(t);
      if (el) el.textContent = '';
    };
  }, [prefix, text]);
}
