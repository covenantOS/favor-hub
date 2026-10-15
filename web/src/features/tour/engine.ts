// The tour's hands: finding the thing a stop points at, scrolling it into the free part of the screen, choosing where the
// card goes so it never sits on what it describes, and pressing a menu item the way a finger would. DOM only; the steps and
// the words are in data.ts and the screens are in TourRoot.tsx.
//
// The card never covers its target. On a computer it takes the side of the target with room (right, left, below or above),
// and a target as big as the screen gets the card docked at the bottom with the frame stopped above it. On a phone the card
// is a sheet at the bottom or the top, the page gets room at its end so anything can scroll up clear of it, and the frame
// stops where the sheet begins.
import type { Device } from './data';

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The part of the screen a person can see. A page wider than the screen can make a phone's layout viewport bigger than what is shown, so the card is placed in the visible part. */
export const vw = () => Math.min(innerWidth, window.visualViewport?.width || innerWidth);
export const vh = () => Math.min(innerHeight, window.visualViewport?.height || innerHeight);
export const isPhone = () => Math.min(innerWidth, screen.width || innerWidth) <= 860;
export const isTouch = () => isPhone() || matchMedia('(hover: none), (pointer: coarse)').matches;
export const deviceNow = (): Device => (isTouch() ? 'phone' : 'desk');
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));

export const OWN = '.tour, .tour-ask, .tour-inv, .tour-pick';

export const visible = (el: Element | null): el is Element =>
  !!el && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
const onScreenX = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.right > 0 && r.left < innerWidth;
};

/** Find the first selector that is on the screen. A phone lays some pages out as two panes, one off the screen: prefer what is on it. */
export async function findFirst(selectors: string[], ms = 4500): Promise<{ el: Element; sel: string } | null> {
  const t0 = Date.now();
  for (;;) {
    for (const sel of selectors) {
      const all = Array.from(document.querySelectorAll(sel)).filter((e) => !e.closest(OWN));
      const el = all.find((e) => visible(e) && onScreenX(e)) || all.find(visible);
      if (el) {
        const r = el.getBoundingClientRect();
        // Found but drawn with no size (a list that failed to load) counts as not there.
        if (r.width >= 8 && r.height >= 8) return { el, sel };
      }
    }
    if (Date.now() - t0 >= ms) return null;
    await new Promise((r) => setTimeout(r, 120));
  }
}

/** Wait until the thing stops moving and growing (a list that is still drawing its rows), for at most `ms`. */
export async function stable(el: Element, ms = 2200): Promise<void> {
  const t0 = Date.now();
  let last = '';
  let same = 0;
  while (Date.now() - t0 < ms) {
    const r = el.getBoundingClientRect();
    const k = `${Math.round(r.left)}|${Math.round(r.top + scrollY)}|${Math.round(r.width)}|${Math.round(r.height)}`;
    same = k === last ? same + 1 : 0;
    last = k;
    if (same >= 3 && r.height >= 8) return;
    await new Promise((res) => setTimeout(res, 110));
  }
}

const norm = (p: string) => p.replace(/\/+$/, '') || '/';

/** Pages whose address says which view shows: with no view in the address the page opens on its first view. */
const BY_VIEW = new Set(['/work', '/dashboard']);

/** True when the screen already shows this page. A view or tab in the step's address must match; a page may add its own (/projects/ opens on ?tab=mine). */
export function samePage(page: string | undefined): boolean {
  if (!page) return true;
  const [path, query = ''] = page.split('?');
  if (norm(location.pathname) !== norm(path)) return false;
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(location.search);
  for (const k of ['view', 'tab', 'page']) {
    if (want.has(k) ? want.get(k) !== have.get(k) : BY_VIEW.has(norm(path)) && !!have.get(k)) return false;
  }
  return true;
}

const inSide = (sel: string) => {
  const el = document.querySelector(sel);
  return !!el && !!el.closest('.h-side');
};

/** On a phone the menu is a sheet; a stop that points into it opens it, and every other stop closes it. */
export function openMenuFor(sel: string | undefined) {
  if (!isPhone()) return;
  const app = document.getElementById('h-app');
  if (!app) return;
  const need = !!sel && inSide(sel);
  if (app.classList.contains('is-nav') === need) return;
  app.classList.toggle('is-nav', need);
  document.getElementById('h-menu')?.setAttribute('aria-expanded', need ? 'true' : 'false');
}

/** The thing a person would press to get to a page: its tab, its place on the phone bar, or its line in the menu. */
export function navLink(via: string | undefined): Element | null {
  if (!via) return null;
  const tab = document.querySelector(`.h-tabs [data-nav-id="${via}"]`);
  if (tab && visible(tab)) return tab;
  const side = document.querySelector(`.h-side [data-nav-id="${via}"]`);
  if (!side || side.closest('[hidden]')) return null;
  const area = side.closest<HTMLElement>('.h-area');
  if (isPhone()) {
    const bar = area ? document.querySelector(`#h-bar [data-bar="${area.dataset.area}"]:not([hidden])`) : null;
    if (bar && visible(bar)) return bar;
    return document.getElementById('h-bar-more');
  }
  if (visible(side)) return side;
  return area?.querySelector('.h-area__link') || null;
}

/** Press something the way a finger or a mouse does: some lists open a row on pointer up, the rest on click. */
export function pressEl(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, isPrimary: true, pointerType: isTouch() ? 'touch' : 'mouse' };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    el.dispatchEvent(new PointerEvent('pointerup', at));
  } catch {
    // No pointer events here: the click below does it.
  }
  el.click();
}

/** A link on the screen that goes to this page, once the menu has drawn the page's area. */
export function linkTo(page: string): HTMLAnchorElement | null {
  const want = page.replace(/\/+$/, '').replace(/\/\?/, '?');
  return (
    Array.from(document.querySelectorAll<HTMLAnchorElement>('.h-tabs a[href], .h-side a[href]')).find((a) => {
      if (!visible(a)) return false;
      const u = new URL(a.getAttribute('href') || '', location.origin);
      return (u.pathname + u.search).replace(/\/+$/, '').replace(/\/\?/, '?') === want;
    }) || null
  );
}

// FavorOS never opens a tour on top of someone who is typing, in a meeting or a call, filling a form, or recording.
let typedHere = false;
export function watchTyping(): () => void {
  const on = (e: KeyboardEvent) => {
    if (e.isTrusted && (e.target as HTMLElement).matches?.('input,textarea,[contenteditable="true"]') && e.key.length === 1) typedHere = true;
  };
  document.addEventListener('keydown', on, true);
  return () => document.removeEventListener('keydown', on, true);
}
export const clearTyping = () => { typedHere = false; };

const shown = (el: Element | null) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');

/** Why this is not a good moment to open the tour by itself, or '' when it is. */
export function busy(): string {
  const p = location.pathname;
  if (/^\/(meet\/(room|g)|meet-guest|clips\/(rec|edit)|c\/|login|requests\/new|expenses\/(new|sign)|learn\/c|onboarding\/run)/.test(p)) return 'page';
  if (document.visibilityState !== 'visible') return 'hidden';
  if (typedHere) return 'typing';
  if (document.querySelector('.cr-bar')) return 'recording';
  if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')).some((d) => !d.closest(OWN) && shown(d))) return 'dialog';
  const ov = (window as unknown as { hubOv?: { depth: () => number } }).hubOv;
  if (ov && ov.depth() > 0) return 'overlay';
  if (Array.from(document.querySelectorAll('video, audio')).some((m) => !(m as HTMLMediaElement).paused && !(m as HTMLMediaElement).muted)) return 'playing';
  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('#h-content textarea, #h-content input[type="text"], #h-content input:not([type]), #h-content [contenteditable="true"]'));
  if (fields.some((f) => shown(f) && !f.closest('[role="search"]') && f.getAttribute('type') !== 'search' && (('value' in f ? f.value : (f as HTMLElement).textContent) || '').trim().length > 0 && ('defaultValue' in f ? f.value !== f.defaultValue : true))) return 'form';
  return '';
}

/* ------------------------------------------------------------------------------------------------ placing the card */

export type Placement = {
  x: number;
  y: number;
  /** Where the card sits relative to its target. */
  at: 'bottom' | 'top' | 'right' | 'left' | 'dock' | 'center';
  /** The part of the screen the frame may cover: it stops at the header and at the card. */
  clip: { top: number; bottom: number };
};

/** The bottom edge of the header (and any tab row stuck under it): a scrolled target starts below this. */
function headerBottom(): number {
  let top = 0;
  document.querySelectorAll('.h-top, #h-tabs, .h-top__tabs').forEach((el) => {
    if (!visible(el)) return;
    const pos = getComputedStyle(el).position;
    const r = el.getBoundingClientRect();
    if ((pos === 'sticky' || pos === 'fixed' || el.closest('.h-top')) && r.top < 12 && r.bottom > top && r.bottom < vh() / 2) top = r.bottom;
  });
  return top;
}

/** True when scrolling the window cannot move the thing: it sits in the header, the bar, the menu, a sheet, or a page that fills the screen. */
function pinned(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  const doc = document.documentElement;
  if (doc.scrollHeight <= vh() + 2) return true;
  // Inside a pane that scrolls by itself (a chat, a list in a full-height page).
  for (let n: Element | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2 && n.clientHeight < vh()) return n.id !== 'h-content' || s.position !== 'static';
  }
  return false;
}

let spacer: HTMLDivElement | null = null;
export function clearSpacer() {
  spacer?.remove();
  spacer = null;
}

export type Size = { w: number; h: number; safeTop: number };

/** No target: the card sits in the middle on a computer, at the bottom on a phone. */
export function placeAlone(s: Size): Placement {
  const clip = { top: 4, bottom: 0 };
  if (isPhone()) return { x: 12, y: vh() - s.h - 12, at: 'bottom', clip };
  return { x: (vw() - s.w) / 2, y: Math.max(14, (vh() - s.h) / 2), at: 'center', clip };
}

/** Scroll the thing into the free part of the screen, then put the card beside it. `stale` says a newer stop has begun. */
export async function settle(el: Element, side: string | undefined, s: Size, stale: () => boolean): Promise<Placement | null> {
  const { w: pw, h: ph } = s;
  const m = 20;
  const fixed = pinned(el);
  const head = fixed ? 0 : headerBottom();
  const smooth: ScrollBehavior = reduced() ? 'auto' : 'smooth';
  const scrollBy = async (dy: number) => {
    if (Math.abs(dy) < 2) return;
    window.scrollTo({ top: Math.max(0, scrollY + dy), behavior: smooth });
    await sleep(460);
  };
  if (fixed && !el.closest('.h-top, #h-bar, #cmdk')) {
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > vh()) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth });
      await sleep(360);
    }
  }
  // A chip in a row that scrolls sideways comes into view first.
  const rx = el.getBoundingClientRect();
  if (rx.left < 0 || rx.right > vw()) {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    await sleep(120);
  }
  if (stale()) return null;

  if (isPhone()) {
    const bottomY = vh() - ph - 12;
    const topY = s.safeTop + 12;
    let at: 'bottom' | 'top' = 'bottom';
    if (fixed) {
      const r = el.getBoundingClientRect();
      const below = vh() - r.bottom;
      const above = r.top;
      if (below >= ph + 24) at = 'bottom';
      else if (above >= ph + 24) at = 'top';
      // Something that fills the screen (search, a sheet) starts at its top: the card takes the bottom.
      else at = r.height > vh() * 0.6 || r.top + r.height / 2 < vh() / 2 ? 'bottom' : 'top';
    } else {
      // The page gets room at its end, so anything can scroll up clear of the card.
      if (!spacer) {
        spacer = document.createElement('div');
        spacer.className = 'tour-spacer';
        (document.getElementById('h-content') || document.body).appendChild(spacer);
      }
      spacer.style.height = `${ph + 48}px`;
      const top = head + 12;
      const room = bottomY - m - top;
      const r = el.getBoundingClientRect();
      const inside = r.top >= top && r.bottom <= bottomY - m;
      if (!inside) await scrollBy(r.top - (r.height <= room ? top + Math.min(28, (room - r.height) / 2) : top));
    }
    if (stale()) return null;
    if (at === 'bottom') return { x: 12, y: bottomY, at: 'bottom', clip: { top: fixed ? 4 : head + 2, bottom: bottomY - 10 } };
    return { x: 12, y: topY, at: 'top', clip: { top: topY + ph + 10, bottom: vh() - 4 } };
  }

  // A computer: the thing in view under the header, the card on the side with room.
  const top = head + 12;
  const room = vh() - 12 - top;
  if (!fixed) {
    const r = el.getBoundingClientRect();
    if (r.height > room) await scrollBy(r.top - top);
    else if (r.top < top || r.bottom > vh() - 12) await scrollBy(r.top - (top + (room - r.height) / 2));
  }
  if (stale()) return null;
  const r = el.getBoundingClientRect();
  const v = { left: Math.max(0, r.left), right: Math.min(vw(), r.right), top: Math.max(fixed ? 0 : head, r.top), bottom: Math.min(vh(), r.bottom) };
  const want = (side || 'bottom') as 'right' | 'left' | 'top' | 'bottom';
  const order = [want, 'bottom', 'top', 'right', 'left'] as const;
  const fits = {
    bottom: v.bottom + m + ph <= vh() - m,
    top: v.top - m - ph >= Math.max(m, fixed ? m : head + 4),
    right: v.right + m + pw <= vw() - m,
    left: v.left - m - pw >= m,
  };
  const pick = order.find((k) => fits[k]);
  const cx = Math.min(Math.max(m, (v.left + v.right) / 2 - pw / 2), vw() - pw - m);
  const cy = Math.min(Math.max(m, (v.top + v.bottom) / 2 - ph / 2), vh() - ph - m);
  const clip = { top: fixed ? 4 : head + 2, bottom: vh() - 4 };
  if (pick === 'bottom') return { x: cx, y: v.bottom + m, at: 'bottom', clip };
  if (pick === 'top') return { x: cx, y: v.top - m - ph, at: 'top', clip };
  if (pick === 'right') return { x: v.right + m, y: cy, at: 'right', clip };
  if (pick === 'left') return { x: v.left - m - pw, y: cy, at: 'left', clip };
  // Bigger than the room around it: the card docks at the bottom and the frame stops above it.
  const y = vh() - ph - 20;
  return { x: Math.min(Math.max(m, (v.left + v.right) / 2 - pw / 2), vw() - pw - m), y, at: 'dock', clip: { ...clip, bottom: y - 12 } };
}

/** The hole's rectangle for a target, kept inside the clip so the frame never runs under the card or the header. */
export function holeRect(el: Element, clip: { top: number; bottom: number }): { x: number; y: number; w: number; h: number } | null {
  const r = el.getBoundingClientRect();
  const pad = 6;
  const x = Math.max(4, r.left - pad);
  const y = Math.max(clip.top, r.top - pad);
  const w = Math.min(vw() - 4, r.right + pad) - x;
  const h = Math.min(clip.bottom || vh() - 4, r.bottom + pad) - y;
  if (w < 8 || h < 8) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
