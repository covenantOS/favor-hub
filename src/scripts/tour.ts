// The guided tour and New in FavorOS.
//
// Three things run through this file (the steps themselves live in tours.ts, the rules in tour-state.ts):
//   1. The core tour opens by itself on a new person's first page.
//   2. "New in FavorOS" opens by itself when a person has walkthroughs they have not seen, lists them, and runs them one
//      feature at a time on the real screen.
//   3. Closing asks first. Skip for now puts it off until the next working day, three times, and after that it waits as a
//      number on Help and a card on Today. Escape and Back always work, and nobody in the middle of something is
//      interrupted: it waits for the next quiet page.
//
// A step dims the page around the thing it shows. On a computer a pointer moves to it; on a phone there is no pointer,
// only a ring where the tour presses something. The card never sits on what it describes: the page scrolls so the thing is
// between the header and the card, and the frame stops where the card begins.
// The tour keeps its place in this tab (sessionStorage) across page changes. Progress is kept in this browser and, once
// the hub_tours table exists, on the server too (so a phone and a computer agree, and admins see who has finished).
import { PRESETS, RELEASES, coreFor, coreItem, featureSteps, findStep, offersFor, pageSteps, releaseItem, resolveStep, roleName, say, type Device, type Offer, type Step, type Who } from './tours';
import { RETURNS, cleanProgress, comesBack, dayWord, etToday, finish as markDone, isDone, mayOpen, merge, offer as markOffered, skip as markSkipped, type Progress } from './tour-state';
import { ICONS } from '../data/icons';
import { cue } from './feel';

const STATE = 'favor.hub.tour2';
const PENDING = 'favor.hub.tours.pending';
const AUTO_TEST = 'favor.hub.tours.auto';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => innerWidth <= 860;
const touch = () => phone() || matchMedia('(hover: none), (pointer: coarse)').matches;
const device = (): Device => (touch() ? 'phone' : 'desk');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const svg = (name: string) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** One walkthrough in a row of them: the core tour, one feature, or the steps for a page. */
type Run = { item: string; label: string; ids: string[] };
type Saved = { runs: Run[]; r: number; i: number; at: number; as?: string; auto: boolean; x?: number; y?: number };

const store = {
  get(): Saved | null {
    try {
      const s = JSON.parse(sessionStorage.getItem(STATE) || 'null') as Saved | null;
      return s && Array.isArray(s.runs) && Date.now() - s.at < 20 * 60 * 1000 ? s : null;
    } catch {
      return null;
    }
  },
  set(s: Saved) {
    try {
      sessionStorage.setItem(STATE, JSON.stringify({ ...s, at: Date.now() }));
    } catch {
      // A tab that refuses storage still runs the tour on this page.
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(STATE);
    } catch {
      // nothing to clear
    }
  },
};

// ---- Who is looking --------------------------------------------------------------------------
type Hub = { user?: { name?: string; email?: string }; access?: Record<string, boolean>; kpiTeams?: string[] };
function hub(): Promise<Hub> {
  const w = window as unknown as { FAVOR_HUB?: Hub };
  if (w.FAVOR_HUB) return Promise.resolve(w.FAVOR_HUB);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({}), 6000);
    document.addEventListener('favor-hub', (e) => {
      clearTimeout(t);
      resolve((e as CustomEvent).detail || {});
    }, { once: true });
  });
}

function whoFrom(d: Hub, as?: string): Who {
  const a = d.access || {};
  const teams = d.kpiTeams || [];
  const real: Who = {
    admin: !!a.admin,
    approver: !!a.approver,
    expenseLog: !!a.expenseLog,
    work: !!a.workCenter,
    kpi: !!a.kpi,
    teams,
    leader: teams.length >= 5,
    first: String(d.user?.name || '').split(' ')[0],
    chat: !!a.chat,
    projects: !!a.projects,
    meetings: !!a.meetings,
    clips: !!a.clips && a.clipsRecord !== false,
    hr: !!a.hr,
  };
  return as && PRESETS[as] && real.admin ? { ...real, ...PRESETS[as] } : real;
}

// ---- Progress ----------------------------------------------------------------------------------
let progress: Progress = {};
let email = '';
let loaded: Promise<void> | null = null;
let who: Who;
let as: string | undefined;

const key = () => `favor.hub.tours.v2:${email || '_'}`;
function readLocal(): Progress {
  try {
    return cleanProgress(JSON.parse(localStorage.getItem(key()) || '{}'));
  } catch {
    return {};
  }
}
function saveLocal() {
  try {
    localStorage.setItem(key(), JSON.stringify(progress));
  } catch {
    // Storage refused: progress lasts for this page.
  }
}
const same = (a: Progress, b: Progress) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

async function push(): Promise<void> {
  try {
    const r = await fetch('/api/hub/tours', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: progress }) });
    const d = r.ok ? ((await r.json()) as { ready?: boolean; items?: unknown }) : null;
    if (d && d.ready) {
      progress = merge(progress, cleanProgress(d.items));
      saveLocal();
    }
  } catch {
    // Offline: this browser keeps the progress and sends it on a later page.
  }
}

function load(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    const d = await hub();
    email = String(d.user?.email || '').toLowerCase();
    who = whoFrom(d, as);
    progress = readLocal();
    try {
      const r = await fetch('/api/hub/tours', { credentials: 'same-origin' });
      const s = r.ok ? ((await r.json()) as { ready?: boolean; items?: unknown }) : null;
      if (s && s.ready) {
        const theirs = cleanProgress(s.items);
        progress = merge(progress, theirs);
        saveLocal();
        if (!same(progress, theirs)) void push();
      }
    } catch {
      // The browser's own copy stands.
    }
    paint();
  })();
  return loaded;
}

function commit(next: Progress) {
  progress = next;
  saveLocal();
  paint();
  void push();
}

const offers = (): Offer[] => offersFor(who);
const pendingOffers = (): Offer[] => offers().filter((o) => !isDone(progress, o.item));
const corePending = () => !isDone(progress, coreItem);
const pendingCount = () => (corePending() ? 1 : 0) + pendingOffers().length;

/** The number on Help, the card on Today. */
function paint() {
  if (!who) return;
  const n = as ? 0 : pendingCount();
  try {
    localStorage.setItem(PENDING, String(n));
  } catch {
    // nothing to do
  }
  document.querySelectorAll<HTMLElement>('[data-count="tours"]').forEach((el) => {
    el.hidden = !n;
    el.textContent = String(n);
  });
  const layout = (window as unknown as { hubNavLayout?: () => void }).hubNavLayout;
  if (layout) layout();
  document.documentElement.classList.toggle('show-welcome', n > 0);
  const card = document.getElementById('t-welcome');
  if (card) {
    card.hidden = !n;
    const fresh = pendingOffers().length;
    const b = card.querySelector('b');
    if (b) b.textContent = corePending() ? 'Tour of FavorOS, 2 minutes' : `New in FavorOS: ${fresh} ${fresh === 1 ? 'walkthrough' : 'walkthroughs'}`;
  }
}

// ---- Is this a good moment? --------------------------------------------------------------------
// FavorOS never opens a tour on top of someone who is typing, in a meeting or a call, filling a form, or recording.
let typedHere = false;
const shown = (el: Element | null) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');
export function busy(): string {
  const p = location.pathname;
  if (/^\/(meet\/(room|g)|meet-guest|clips\/(rec|edit)|c\/|login|requests\/new|expenses\/(new|sign)|learn\/c|onboarding\/run)/.test(p)) return 'page';
  if (document.visibilityState !== 'visible') return 'hidden';
  if (typedHere) return 'typing';
  if (document.querySelector('.cr-bar')) return 'recording';
  if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')).some((d) => !d.closest('.tr, .trn, .tra') && shown(d))) return 'dialog';
  const ov = (window as unknown as { hubOv?: { depth: () => number } }).hubOv;
  if (ov && ov.depth() > 0) return 'overlay';
  if (Array.from(document.querySelectorAll('video, audio')).some((m) => !(m as HTMLMediaElement).paused && !(m as HTMLMediaElement).muted)) return 'playing';
  const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('#h-content textarea, #h-content input[type="text"], #h-content input:not([type]), #h-content [contenteditable="true"]'));
  if (fields.some((f) => shown(f) && !f.closest('[role="search"]') && f.getAttribute('type') !== 'search' && (('value' in f ? f.value : (f as HTMLElement).textContent) || '').trim().length > 0 && ('defaultValue' in f ? f.value !== f.defaultValue : true))) return 'form';
  return '';
}

// ---- The layer -------------------------------------------------------------------------------
let root: HTMLDivElement | null = null;
let hole: HTMLDivElement;
let pop: HTMLDivElement;
let cursor: HTMLDivElement;
let target: Element | null = null;
let raf = 0;
let typed: { el: HTMLInputElement | HTMLTextAreaElement; was: string } | null = null;
// Each move to a step gets a number; an older move that is still animating stops when a newer one starts.
let gen = 0;
let leaving = false;
// The part of the screen the frame may cover: it stops at the header and at the card.
let clip = { top: 4, bottom: 0 };
let spacer: HTMLDivElement | null = null;
let ovTok: unknown = null;

type Ov = { on: (close: () => void) => unknown; off: (t: unknown) => void; whenIdle: (f: () => void) => void; depth: () => number };
const hubOv = () => (window as unknown as { hubOv?: Ov }).hubOv;

const POINTER =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 3.5 22.5 15l-7.6 1.4L19 24.6l-3.2 1.5-4.2-8.3L5.8 23z" fill="#fff" stroke="#1b3317" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function build() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'tr' + (touch() ? ' tr--touch' : '');
  root.innerHTML = `<div class="tr-block"></div><div class="tr-hole is-none"></div><div class="tr-cursor">${POINTER}<i></i></div><div class="tr-pop" role="dialog" aria-modal="true" aria-labelledby="tr-title" tabindex="-1"></div>`;
  document.body.appendChild(root);
  hole = root.querySelector('.tr-hole')!;
  pop = root.querySelector('.tr-pop')!;
  cursor = root.querySelector('.tr-cursor')!;
  // Presses inside the tour stay inside it (the phone menu closes on any press outside it).
  root.addEventListener('click', (e) => e.stopPropagation());
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  const s = store.get();
  moveCursor(s?.x ?? innerWidth * 0.62, s?.y ?? innerHeight * 0.78, true);
  requestAnimationFrame(() => root?.classList.add('is-on'));
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize);
  document.documentElement.classList.add('tr-on');
  // Back closes the tour the way the X does (it asks first), instead of leaving the page under it.
  const ov = hubOv();
  if (ov) ovTok = ov.on(() => { ovTok = null; askClose(); });
  wire();
  follow();
}

function dropOv() {
  const ov = hubOv();
  if (ov && ovTok) { const t = ovTok; ovTok = null; ov.off(t); }
}

function teardown() {
  cancelAnimationFrame(raf);
  document.removeEventListener('keydown', onKey, true);
  removeEventListener('resize', onResize);
  restoreTyped();
  dropOv();
  if (root) {
    const r = root;
    r.classList.remove('is-on');
    setTimeout(() => r.remove(), reduced() ? 0 : 260);
  }
  spacer?.remove();
  spacer = null;
  placed = false;
  root = null;
  target = null;
  document.documentElement.classList.remove('tr-on');
  if (phone()) document.getElementById('h-app')?.classList.remove('is-nav');
}

let lastRect = '';
function follow() {
  raf = requestAnimationFrame(follow);
  if (!root) return;
  if (!target || !target.isConnected) {
    if (lastRect !== 'none') {
      hole.classList.add('is-none');
      lastRect = 'none';
    }
    return;
  }
  const r = target.getBoundingClientRect();
  const pad = 6;
  const x = Math.max(4, r.left - pad);
  const y = Math.max(clip.top, r.top - pad);
  const w = Math.min(innerWidth - 4, r.right + pad) - x;
  const h = Math.min(clip.bottom || innerHeight - 4, r.bottom + pad) - y;
  const k = `${Math.round(x)}|${Math.round(y)}|${Math.round(w)}|${Math.round(h)}`;
  if (k === lastRect) return;
  lastRect = k;
  if (w < 8 || h < 8) {
    hole.classList.add('is-none');
    return;
  }
  hole.classList.remove('is-none');
  hole.style.cssText = `transform:translate(${Math.round(x)}px,${Math.round(y)}px);width:${Math.round(w)}px;height:${Math.round(h)}px`;
}

function moveCursor(x: number, y: number, instant = false) {
  if (!cursor) return;
  cursor.style.transition = instant || reduced() || touch() ? 'none' : '';
  cursor.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  const s = store.get();
  if (s) store.set({ ...s, x, y });
}

/** On a computer the pointer travels to the thing. On a phone nothing moves; a press shows as a ring where a thumb would land. */
async function pointAt(el: Element, press = false) {
  if (!cursor) return;
  const r = el.getBoundingClientRect();
  const x = touch() ? r.left + r.width / 2 : r.left + Math.min(r.width * 0.5, 60);
  const y = touch() ? r.top + r.height / 2 : r.top + Math.min(r.height * 0.5, 40);
  moveCursor(Math.min(innerWidth - 8, Math.max(8, x)), Math.min(innerHeight - 8, Math.max(8, y)));
  if (!touch()) await sleep(650);
  if (press) {
    cursor.classList.remove('is-press');
    void cursor.offsetWidth;
    cursor.classList.add('is-press');
    cue('press');
    await sleep(touch() ? 380 : 220);
  }
}

// ---- Finding things ----------------------------------------------------------------------------
const visible = (el: Element | null) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
const onScreenX = (el: Element) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; };

async function find(sel: string, ms = 5000): Promise<Element | null> {
  const t0 = Date.now();
  for (;;) {
    const all = Array.from(document.querySelectorAll(sel)).filter((e) => !e.closest('.tr, .trn, .tra'));
    // A phone lays some pages out as two panes side by side, one off the screen: prefer what is on it.
    const el = all.find((e) => visible(e) && onScreenX(e)) || all.find(visible);
    if (el) return el;
    if (Date.now() - t0 >= ms) return null;
    await new Promise((r) => setTimeout(r, 120));
  }
}

const inSide = (sel: string) => {
  const el = document.querySelector(sel);
  return !!el && !!el.closest('.h-side');
};
function openMenuFor(sel: string | undefined) {
  if (!phone()) return;
  const app = document.getElementById('h-app');
  if (!app) return;
  const need = !!sel && inSide(sel);
  if (app.classList.contains('is-nav') === need) return;
  app.classList.toggle('is-nav', need);
  document.getElementById('h-menu')?.setAttribute('aria-expanded', need ? 'true' : 'false');
}

async function typeInto(el: Element, text: string, my: number) {
  const box = (el.matches('input,textarea') ? el : el.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!box) return;
  typed = { el: box, was: box.value };
  // A phone would raise its keyboard over the card: the example is written without putting the cursor in the box.
  if (!touch()) box.focus({ preventScroll: true });
  box.value = '';
  for (const ch of text) {
    if (!root || my !== gen) return;
    box.value += ch;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(reduced() ? 0 : 38);
  }
  // A search box gets a short pause to show its results.
  await sleep(250);
}
function restoreTyped() {
  if (!typed) return;
  typed.el.value = typed.was;
  typed.el.dispatchEvent(new Event('input', { bubbles: true }));
  typed = null;
}

// ---- Where things go -----------------------------------------------------------------------------
/** The bottom edge of the header (and any tab row stuck under it): a scrolled target starts below this. */
function headerBottom(): number {
  let top = 0;
  document.querySelectorAll('.h-top, #h-tabs, .h-top__tabs').forEach((el) => {
    if (!visible(el)) return;
    const pos = getComputedStyle(el).position;
    const r = el.getBoundingClientRect();
    if ((pos === 'sticky' || pos === 'fixed' || el.closest('.h-top')) && r.top < 12 && r.bottom > top && r.bottom < innerHeight / 2) top = r.bottom;
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
  if (doc.scrollHeight <= innerHeight + 2) return true;
  // Inside a pane that scrolls by itself (a chat, a list in a full-height page).
  for (let n: Element | null = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2 && n.clientHeight < innerHeight) return n.id !== 'h-content' || s.position !== 'static';
  }
  return false;
}

function safeTop(): number {
  return root ? parseFloat(getComputedStyle(root).paddingTop) || 0 : 0;
}

function setPop(x: number, y: number, at: string) {
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
  pop.dataset.at = at;
}

/** No target: the card sits in the middle on a computer, at the bottom on a phone. */
function placeAlone() {
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  clip = { top: 4, bottom: 0 };
  if (phone()) setPop(12, innerHeight - ph - 12, 'bottom');
  else setPop((innerWidth - pw) / 2, Math.max(14, (innerHeight - ph) / 2), 'center');
}

/** Scroll the thing into the free part of the screen, then put the card beside it. The frame stops where the card starts. */
async function settle(el: Element, side: string | undefined, my: number) {
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const m = 14;
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
    if (r0.top < 0 || r0.bottom > innerHeight) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth });
      await sleep(360);
    }
  }
  // A chip in a row that scrolls sideways comes into view first.
  const rx = el.getBoundingClientRect();
  if (rx.left < 0 || rx.right > innerWidth) {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
    await sleep(120);
  }
  if (my !== gen || !root) return;

  if (phone()) {
    const bottomY = innerHeight - ph - 12;
    const topY = safeTop() + 12;
    let at: 'bottom' | 'top' = 'bottom';
    if (fixed) {
      const r = el.getBoundingClientRect();
      const below = innerHeight - r.bottom;
      const above = r.top;
      if (below >= ph + 24) at = 'bottom';
      else if (above >= ph + 24) at = 'top';
      else at = r.top + r.height / 2 < innerHeight / 2 ? 'bottom' : 'top';
    } else {
      // The page gets room at its end, so anything can scroll up clear of the card.
      if (!spacer) {
        spacer = document.createElement('div');
        spacer.className = 'tr-spacer';
        (document.getElementById('h-content') || document.body).appendChild(spacer);
      }
      spacer.style.height = `${ph + 48}px`;
      const top = head + 12;
      const room = bottomY - m - top;
      const r = el.getBoundingClientRect();
      const inside = r.top >= top && r.bottom <= bottomY - m;
      if (!inside) await scrollBy(r.top - (r.height <= room ? top + Math.min(28, (room - r.height) / 2) : top));
    }
    if (my !== gen || !root) return;
    if (at === 'bottom') {
      setPop(12, bottomY, 'bottom');
      clip = { top: fixed ? 4 : head + 2, bottom: bottomY - 10 };
    } else {
      setPop(12, topY, 'top');
      clip = { top: topY + ph + 10, bottom: innerHeight - 4 };
    }
    return;
  }

  // A computer: the thing in view under the header, the card on the side with room.
  const top = head + 12;
  const room = innerHeight - 12 - top;
  if (!fixed) {
    const r = el.getBoundingClientRect();
    if (r.height > room) await scrollBy(r.top - top);
    else if (r.top < top || r.bottom > innerHeight - 12) await scrollBy(r.top - (top + (room - r.height) / 2));
  }
  if (my !== gen || !root) return;
  const r = el.getBoundingClientRect();
  const v = { left: Math.max(0, r.left), right: Math.min(innerWidth, r.right), top: Math.max(fixed ? 0 : head, r.top), bottom: Math.min(innerHeight, r.bottom) };
  const want = (side || 'bottom') as 'right' | 'left' | 'top' | 'bottom';
  const order = [want, 'bottom', 'top', 'right', 'left'] as const;
  const fits = {
    bottom: v.bottom + m + ph <= innerHeight - m,
    top: v.top - m - ph >= Math.max(m, fixed ? m : head + 4),
    right: v.right + m + pw <= innerWidth - m,
    left: v.left - m - pw >= m,
  };
  const pick = order.find((s) => fits[s]);
  const cx = Math.min(Math.max(m, (v.left + v.right) / 2 - pw / 2), innerWidth - pw - m);
  const cy = Math.min(Math.max(m, (v.top + v.bottom) / 2 - ph / 2), innerHeight - ph - m);
  clip = { top: fixed ? 4 : head + 2, bottom: innerHeight - 4 };
  if (pick === 'bottom') setPop(cx, v.bottom + m, 'bottom');
  else if (pick === 'top') setPop(cx, v.top - m - ph, 'top');
  else if (pick === 'right') setPop(v.right + m, cy, 'right');
  else if (pick === 'left') setPop(v.left - m - pw, cy, 'left');
  else {
    // Bigger than the room around it: the card docks at the bottom and the frame stops above it.
    const y = innerHeight - ph - 20;
    setPop(Math.min(Math.max(m, (v.left + v.right) / 2 - pw / 2), innerWidth - pw - m), y, 'dock');
    clip.bottom = y - 12;
  }
}

function onResize() {
  if (!root) return;
  lastRect = '';
  if (target) void settle(target, pop.dataset.side, gen);
  else placeAlone();
}

let placed = false;
function card(html: string, side?: string, keep = false) {
  pop.dataset.side = side || 'bottom';
  pop.classList.remove('is-in', 'is-busy');
  pop.innerHTML = html;
  void pop.offsetWidth;
  pop.classList.add('is-in');
  lastRect = '';
  // Between steps the card stays where it is until the next thing is in view, then moves once.
  if (!target && !(keep && placed)) placeAlone();
  else if (phone() && pop.dataset.at === 'bottom') pop.style.top = `${innerHeight - pop.offsetHeight - 12}px`;
  placed = true;
  const go = pop.querySelector<HTMLElement>('[data-tr-next],[data-tr-done],[data-tr-more]');
  (go || pop).focus({ preventScroll: true });
}

// ---- Running ---------------------------------------------------------------------------------
let runs: Run[] = [];
let ri = 0;
let index = 0;
let steps: Step[] = [];
let auto = false;

const stepsOf = (run: Run): Step[] =>
  run.ids.map((id) => findStep(id)).map((s) => (s ? resolveStep(s, device()) : null)).filter(Boolean) as Step[];
const runPending = () => !!runs[ri] && runs[ri].item !== 'page' && !isDone(progress, runs[ri].item);
const save = () => store.set({ runs, r: ri, i: index, at: Date.now(), as, auto });

function onKey(e: KeyboardEvent) {
  if (!root || confirmOpen()) return;
  const inField = (e.target as HTMLElement).matches?.('input,textarea,select');
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    askClose();
  } else if (e.key === 'ArrowRight' && !inField) {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft' && !inField) {
    e.preventDefault();
    if (index > 0) void go(index - 1);
  }
}

function samePage(page: string) {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  return norm(location.pathname) === norm(page);
}

/** The thing a person would press to get to a page: its tab, its place on the phone bar, or its line in the menu. */
function navLink(via: string | undefined): Element | null {
  if (!via) return null;
  const tab = document.querySelector(`.h-tabs [data-nav-id="${via}"]`);
  if (tab && visible(tab)) return tab;
  const side = document.querySelector(`.h-side [data-nav-id="${via}"]`);
  if (!side || side.closest('[hidden]')) return null;
  const area = side.closest<HTMLElement>('.h-area');
  if (phone()) {
    const bar = area ? document.querySelector(`#h-bar [data-bar="${area.dataset.area}"]:not([hidden])`) : null;
    if (bar && visible(bar)) return bar;
    return document.getElementById('h-bar-more');
  }
  if (visible(side)) return side;
  return area?.querySelector('.h-area__link') || null;
}

function leave(dest: string) {
  leaving = true;
  dropOv();
  // Closing the search or menu a moment ago may still be stepping the history back; a page change started now would be cancelled by it.
  setTimeout(() => {
    const ov = hubOv();
    if (ov) ov.whenIdle(() => { location.href = dest; });
    else location.href = dest;
  }, 40);
}

async function undoStep() {
  restoreTyped();
  const prev = steps[index];
  if (prev?.undo) {
    const u = Array.from(document.querySelectorAll<HTMLElement>(prev.undo)).find(visible);
    if (u) u.click();
  }
}

async function go(i: number) {
  if (!root || leaving || i < 0) return;
  if (i >= steps.length) return next();
  const my = ++gen;
  pop.classList.add('is-busy');
  if (steps[index] && i !== index) await undoStep();
  index = i;
  const step = steps[i];
  save();

  if (step.page && !samePage(step.page)) {
    // Go there the way a person would: press its tab, its place on the bar, or its line in the menu.
    const link = navLink(step.via);
    target = null;
    openMenuFor(undefined);
    if (link) {
      target = link;
      const name = (link.getAttribute('data-label') || link.textContent || '').replace(/\d+\+?/g, '').trim();
      card(`<p class="tr-going">Opening ${esc(name && link.id !== 'h-bar-more' ? name : 'the page')}</p>`, 'right');
      await settle(link, 'right', my);
      if (my !== gen) return;
      await pointAt(link, true);
      if (my !== gen) return;
    }
    leave(step.page);
    return;
  }
  await show(step, my);
}

/** Next on the last step of a walkthrough finishes it and starts the one after. */
function next() {
  if (!root || leaving) return;
  if (index + 1 < steps.length) return void go(index + 1);
  const run = runs[ri];
  if (run && run.item !== 'page') commit(markDone(progress, run.item));
  if (ri + 1 < runs.length) {
    void undoStep().then(() => {
      ri++;
      steps = stepsOf(runs[ri]);
      index = -1;
      void go(0);
    });
    return;
  }
  void done();
}

function label(): string {
  const run = runs[ri];
  return `${run.label} · ${index + 1} of ${steps.length}`;
}

async function show(step: Step, my: number) {
  openMenuFor(step.at);
  const n = steps.length;
  const body = say(typeof step.body === 'function' ? step.body(who) : step.body, device());
  const last = index + 1 === n;
  const after = runs[ri + 1];
  const total = runs.reduce((t, r) => t + r.ids.length, 0);
  const before = runs.slice(0, ri).reduce((t, r) => t + r.ids.length, 0);
  target = null;
  // The card changes at once; the frame follows when the thing is found and in view.
  card(
    `<div class="tr-meta"><span>${esc(label())}</span><button type="button" class="tr-x" data-tr-close aria-label="Close">${X}</button></div>
     <h3 id="tr-title">${esc(say(step.title, device()))}</h3>
     <p>${esc(body)}</p>
     <div class="tr-bar" aria-hidden="true"><i style="width:${(((before + index + 1) / Math.max(1, total)) * 100).toFixed(1)}%"></i></div>
     <div class="tr-acts">
       ${index > 0 ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-back>Back</button>' : '<span></span>'}
       <button type="button" class="h-btn h-btn--primary h-btn--sm" data-tr-next>${last ? (after ? `Next: ${esc(after.label)}` : 'Finish') : 'Next'}</button>
     </div>`,
    step.side,
    true
  );
  pop.classList.add('is-busy');
  pop.dataset.step = step.id;
  pop.dataset.found = '';
  cue('tick');
  const stale = () => my !== gen || !root;
  if (phone() && step.at && inSide(step.at)) await sleep(260);
  if (step.press) {
    // A Work Center tab sits in a group row; when its group is not the one showing, switch to the tab itself.
    const tabId = /data-view="([a-z0-9_-]+)"/.exec(step.press);
    const wc = (window as unknown as { WC?: { goTab?: (k: string) => Promise<void> } }).WC;
    if (tabId && wc && wc.goTab && !document.querySelector(step.press)) { await wc.goTab(tabId[1]); await sleep(120); }
    // What the press opens may already be open (Back to this step, or the step before opened it).
    const open = step.at ? Array.from(document.querySelectorAll(step.at)).find((e) => visible(e) && onScreenX(e)) : null;
    const p = open ? null : await find(step.press, 2500);
    if (stale()) return;
    if (p) {
      target = p;
      await settle(p, step.side, my);
      if (stale()) return;
      await pointAt(p, true);
      if (stale()) return;
      (p as HTMLElement).click();
      target = null;
      await sleep(320);
    }
  }
  let el = step.at ? await find(step.at, step.alt || step.skipIfMissing ? 2200 : 5000) : null;
  if (!el && step.alt) el = await find(step.alt, 1500);
  if (stale()) return;
  if (!el && step.skipIfMissing) {
    // Nothing to show here for this person (no rows, not connected): the step is left out.
    steps = steps.filter((s) => s !== step);
    runs[ri] = { ...runs[ri], ids: steps.map((s) => s.id) };
    if (index >= steps.length) { index = steps.length - 1; return next(); }
    save();
    return show(steps[index], ++gen);
  }
  pop.dataset.found = el ? '1' : step.at ? '0' : 'none';
  if (el) {
    await settle(el, step.side, my);
    if (stale()) return;
    target = el;
    lastRect = '';
    await pointAt(el, false);
    if (stale()) return;
    if (step.type) await typeInto(el, step.type, my);
  } else {
    placeAlone();
    moveCursor(innerWidth * 0.62, innerHeight * 0.78);
  }
  if (!stale()) pop.classList.remove('is-busy');
}

/** The last card: what just finished, and what is still waiting. */
async function done() {
  gen++;
  await undoStep();
  const was = runs[ri];
  store.clear();
  target = null;
  moveCursor(innerWidth * 0.62, innerHeight * 0.82);
  if (!was || was.item === 'page') return end();
  const left = as ? [] : pendingOffers();
  const core = was.item === coreItem;
  const more = left.length
    ? `<p>${left.length} new ${left.length === 1 ? 'walkthrough is' : 'walkthroughs are'} waiting, each about a minute.</p>`
    : `<p>What's new, under Help, lists every change. The help docs cover each tool step by step.</p>`;
  card(
    `<div class="tr-meta"><span>${core ? 'Tour' : 'New in FavorOS'} · done</span><button type="button" class="tr-x" data-tr-end aria-label="Close">${X}</button></div>
     <h3 id="tr-title">${core ? "That's the tour." : left.length ? 'Done.' : "You're caught up."}</h3>
     ${more}
     ${core ? `<div class="tr-rate" data-tr-rate>
       <span>Was this tour useful?</span>
       <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-rating="helpful">Yes</button>
       <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-rating="not-helpful">Not really</button>
     </div>` : ''}
     <div class="tr-acts">
       ${left.length ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-later>Later</button>' : '<a class="tr-link" href="/help/whats-new/">What\'s new</a>'}
       ${left.length ? `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-tr-more>${core ? "See what's new" : `Next: ${esc(short(left[0]))}`}</button>` : '<button type="button" class="h-btn h-btn--primary h-btn--sm" data-tr-done>Done</button>'}
     </div>`
  );
  pop.dataset.step = 'done';
  cue('success');
}

function end() {
  gen++;
  store.clear();
  teardown();
}

// ---- Closing asks first --------------------------------------------------------------------------
let ask: HTMLDialogElement | null = null;
let askTok: unknown = null;
const confirmOpen = () => !!ask && ask.open;

/** The group a skip is counted on: the core tour, or the release of the walkthrough in hand. */
function groupsToSkip(): string[] {
  if (corePending() && (!runs[ri] || runs[ri].item === coreItem)) return [coreItem];
  const rel = new Set(pendingOffers().map((o) => releaseItem(o.release.id)));
  return rel.size ? [...rel] : [];
}

function skipNow() {
  const today = etToday();
  let p = progress;
  for (const g of groupsToSkip()) p = markSkipped(p, g, today);
  commit(p);
}

/**
 * X, Escape and Back land here. A walkthrough that is done, or one a person started to see again, closes at once.
 * One that is still waiting asks first, with Show me as the main button. Escape or Back on the question skips.
 */
function askClose(resume?: () => void) {
  if (confirmOpen()) return;
  const waiting = sheetOpen() ? pendingCount() > 0 : runPending() || (!root && pendingCount() > 0) || (!!root && pop.dataset.step === 'done' && pendingOffers().length > 0);
  if (!waiting || as) {
    closeSheet();
    if (root) { void undoStep(); end(); }
    return;
  }
  const core = groupsToSkip()[0] === coreItem;
  const g = groupsToSkip();
  const back = g.some((x) => comesBack(progress, x));
  const today = etToday();
  const when = dayWord(markSkipped(progress, g[0] || coreItem, today)[g[0] || coreItem].until!, today);
  ask = document.createElement('dialog');
  ask.className = 'tra';
  ask.setAttribute('aria-labelledby', 'tra-t');
  ask.innerHTML = `<h3 id="tra-t">${core ? 'Skip the tour?' : 'Skip the walkthrough?'}</h3>
    <p>${core ? 'It takes about two minutes and shows you where everything is.' : 'It takes about a minute and shows you how this works.'}</p>
    <p class="tra-when">${back ? `FavorOS shows it again ${when}.` : 'It stays under Help and on Today.'}</p>
    <div class="tra-acts"><button type="button" class="h-btn h-btn--primary" data-tra="show">Show me</button><button type="button" class="tra-skip" data-tra="skip">Skip for now</button></div>`;
  document.body.appendChild(ask);
  const dlg = ask;
  const close = (how: 'show' | 'skip') => {
    if (!dlg.isConnected) return;
    const ov = hubOv();
    if (ov && askTok) { const t = askTok; askTok = null; ov.off(t); }
    dlg.close();
    dlg.remove();
    ask = null;
    if (how === 'show') {
      if (resume) return resume();
      if (sheetOpen()) {
        const o = hubOv();
        if (o && !sheetTok) sheetTok = o.on(() => { sheetTok = null; askClose(); });
        return sheet?.querySelector<HTMLElement>('[data-trn-go]')?.focus();
      }
      if (root) {
        // Back closed the question's own history entry and the tour's: the tour takes its entry again.
        const o = hubOv();
        if (o && !ovTok) ovTok = o.on(() => { ovTok = null; askClose(); });
        return pop.querySelector<HTMLElement>('[data-tr-next],[data-tr-more],[data-tr-done]')?.focus();
      }
      return openSheet(false);
    }
    skipNow();
    closeSheet();
    if (root) { void undoStep(); end(); } else store.clear();
  };
  dlg.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tra]');
    if (b) close(b.dataset.tra as 'show' | 'skip');
  });
  // Escape on the question is the second press: it skips.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close('skip'); });
  dlg.showModal();
  const ov = hubOv();
  if (ov) askTok = ov.on(() => { askTok = null; close('skip'); });
  dlg.querySelector<HTMLElement>('[data-tra="show"]')?.focus();
  cue('tick');
}

// ---- New in FavorOS: the list ------------------------------------------------------------------------
let sheet: HTMLDialogElement | null = null;
let sheetTok: unknown = null;
const sheetOpen = () => !!sheet && sheet.open;
const short = (o: Offer) => o.feature.title;

function closeSheet() {
  if (!sheet) return;
  const ov = hubOv();
  if (ov && sheetTok) { const t = sheetTok; sheetTok = null; ov.off(t); }
  const s = sheet;
  sheet = null;
  if (s.open) s.close();
  s.remove();
}

const mins = (n: number) => { const m = Math.max(1, Math.round((n * 14) / 60)); return m === 1 ? 'about a minute' : `about ${m} minutes`; };

function sheetHtml(): string {
  const all = offers();
  const waiting = all.filter((o) => !isDone(progress, o.item));
  const core = corePending();
  const coreSteps = coreFor(who, device());
  const here = pageSteps(who, location.pathname, device());
  const anyWaiting = core || waiting.length > 0;
  const row = (o: Offer) => {
    const d = isDone(progress, o.item);
    const links = [
      `<a href="/help/${esc(o.feature.article)}/">Help article</a>`,
      o.feature.clip ? `<a href="/help/videos/${esc(o.feature.clip)}/">Training video</a>` : '',
    ].filter(Boolean).join('');
    return `<li class="trn-row${d ? ' is-done' : ''}">
      <button type="button" class="trn-go" data-trn-run="${esc(o.item)}">
        <span class="trn-ico">${svg(o.feature.icon)}</span>
        <span class="trn-t"><b>${esc(o.feature.title)}</b><span>${esc(o.feature.blurb)}</span></span>
        ${d ? '<em class="trn-done">Done</em>' : '<span class="trn-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></span>'}
      </button>
      <div class="trn-links">${links}</div>
    </li>`;
  };
  const groups = RELEASES.map((r) => {
    const mine = all.filter((o) => o.release.id === r.id);
    if (!mine.length) return '';
    return `<h3 class="trn-h">${esc(r.title)}</h3><ul class="trn-list">${mine.map(row).join('')}</ul>`;
  }).join('');
  const title = core ? 'A two-minute tour of FavorOS' : waiting.length ? 'New in FavorOS' : 'Tours and what is new';
  const sub = core
    ? `${coreSteps.length} stops, set up for ${roleName(who)}.`
    : waiting.length
      ? `${waiting.length} ${waiting.length === 1 ? 'walkthrough' : 'walkthroughs'} for you, ${mins(waiting.reduce((t, o) => t + featureSteps(o.feature, who, device()).length, 0))} in all.`
      : 'You have seen everything here. Any of them plays again.';
  const preview = who.admin || as
    ? `<label class="trn-as"><span>Show as</span><select data-trn-as>
        <option value="">Me</option><option value="staff">Any staff member</option><option value="rdd">RDD team</option>
        <option value="pc">Partner Care</option><option value="ce">Church Engagement</option><option value="grants">Grants</option>
        <option value="marketing">Marketing</option><option value="leader">Leadership</option></select></label>`
    : '';
  return `<div class="trn-in">
    <header class="trn-head">
      <div><p class="trn-eye">${core ? 'Welcome' : 'New in FavorOS'}</p><h2 id="trn-title">${esc(title)}</h2><p class="trn-sub">${esc(sub)}</p></div>
      <button type="button" class="trn-x" data-trn-close aria-label="Close">${X}</button>
    </header>
    <div class="trn-body">
      <ul class="trn-list">
        <li class="trn-row${core ? '' : ' is-done'}">
          <button type="button" class="trn-go" data-trn-run="core">
            <span class="trn-ico">${svg('home')}</span>
            <span class="trn-t"><b>Tour of FavorOS</b><span>Today, the menu, search, requests and your own tools.</span></span>
            ${core ? '<span class="trn-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></span>' : '<em class="trn-done">Done</em>'}
          </button>
          <div class="trn-links"><a href="/help/getting-started/">Help article</a><a href="/help/videos/meet-the-hub/">Training video</a></div>
        </li>
      </ul>
      ${groups}
      ${here.length && !anyWaiting ? `<h3 class="trn-h">This page</h3><ul class="trn-list"><li class="trn-row"><button type="button" class="trn-go" data-trn-run="page"><span class="trn-ico">${svg('help')}</span><span class="trn-t"><b>Show me this page</b><span>${here.length} ${here.length === 1 ? 'step' : 'steps'} on what is here.</span></span><span class="trn-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></span></button></li></ul>` : ''}
      <p class="trn-more"><a href="/help/whats-new/">Every change, by date</a><a href="/help/">Help docs</a></p>
      ${preview}
    </div>
    <footer class="trn-foot">
      ${anyWaiting ? '<button type="button" class="trn-skip" data-trn-skip>Skip for now</button>' : '<span></span>'}
      <button type="button" class="h-btn h-btn--primary" data-trn-go>${anyWaiting ? 'Show me' : 'Done'}</button>
    </footer>
  </div>`;
}

function runFor(item: string): Run | null {
  if (item === coreItem) return { item, label: 'Tour', ids: coreFor(who, device()).map((s) => s.id) };
  if (item === 'page') return { item, label: 'This page', ids: pageSteps(who, location.pathname, device()).map((s) => s.id) };
  const o = offers().find((x) => x.item === item);
  return o ? { item, label: o.feature.title, ids: featureSteps(o.feature, who, device()).map((s) => s.id) } : null;
}

function start(list: Run[], isAuto: boolean) {
  const todo = list.filter((r) => r.ids.length);
  if (!todo.length) return;
  closeSheet();
  runs = todo;
  ri = 0;
  index = -1;
  steps = stepsOf(runs[0]);
  auto = isAuto;
  gen++;
  leaving = false;
  build();
  void go(0);
}

function openSheet(isAuto: boolean) {
  if (sheetOpen() || root) return;
  const seen = [coreItem, ...offers().map((o) => o.item)];
  if (!as && seen.some((i) => !progress[i])) commit(markOffered(progress, seen));
  sheet = document.createElement('dialog');
  sheet.className = 'trn';
  sheet.setAttribute('aria-labelledby', 'trn-title');
  sheet.innerHTML = sheetHtml();
  document.body.appendChild(sheet);
  const dlg = sheet;
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); askClose(); });
  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === dlg) return askClose();
    if (t.closest('[data-trn-close]') || t.closest('[data-trn-skip]')) return askClose();
    const one = t.closest<HTMLElement>('[data-trn-run]');
    if (one) {
      const r = runFor(one.dataset.trnRun!);
      if (r) start([r], isAuto);
      return;
    }
    if (t.closest('[data-trn-go]')) {
      if (corePending()) return start([runFor(coreItem)!], isAuto);
      const todo = pendingOffers().map((o) => runFor(o.item)).filter(Boolean) as Run[];
      if (todo.length) return start(todo, isAuto);
      return closeSheet();
    }
    // A help article or a video opens in its own tab, so the list is still here after it.
    const a = t.closest<HTMLAnchorElement>('.trn-links a, .trn-more a');
    if (a) {
      try { sessionStorage.setItem(READING, String(Date.now())); } catch { /* nothing to do */ }
      // On a computer it opens in its own tab, so the list is still here after it. A phone app has no tabs: it opens in place.
      if (!touch()) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
    }
  });
  dlg.addEventListener('change', async (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-trn-as]');
    if (!sel) return;
    as = sel.value || undefined;
    who = whoFrom(await hub(), as);
    dlg.innerHTML = sheetHtml();
    const again = dlg.querySelector<HTMLSelectElement>('[data-trn-as]');
    if (again) again.value = as || '';
  });
  dlg.showModal();
  const ov = hubOv();
  if (ov) sheetTok = ov.on(() => { sheetTok = null; askClose(); });
  dlg.querySelector<HTMLElement>('[data-trn-go]')?.focus();
  if (isAuto) cue('chime');
}

// ---- Rating the core tour ----------------------------------------------------------------------------
async function rate(rating: string, box: HTMLElement) {
  box.innerHTML = rating === 'helpful'
    ? '<span>Thanks. Glad it helped.</span>'
    : `<form class="tr-why" data-tr-why><label for="tr-why">What would have helped?</label><textarea id="tr-why" rows="2" maxlength="600" placeholder="A step that was missing, or something that didn't make sense"></textarea><button type="submit" class="h-btn h-btn--primary h-btn--sm">Send</button></form>`;
  const send = (comment = '') =>
    fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'tour', rating, comment, page: `${location.pathname} (tour${as ? `, as ${as}` : ''})` }),
    }).catch(() => {});
  if (rating === 'helpful') {
    void send();
    return;
  }
  const f = box.querySelector<HTMLFormElement>('[data-tr-why]')!;
  f.querySelector('textarea')!.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const comment = f.querySelector('textarea')!.value.trim();
    await send(comment);
    box.innerHTML = '<span>Thanks. Will reads every note.</span>';
    cue('success');
  });
}

function wire() {
  if (!root) return;
  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-tr-close]')) return askClose();
    if (t.closest('[data-tr-end]')) return askClose();
    if (t.closest('[data-tr-done]')) return end();
    if (t.closest('[data-tr-later]')) { skipNow(); return end(); }
    if (t.closest('[data-tr-more]')) {
      const core = runs[ri]?.item === coreItem;
      end();
      if (core) return openSheet(false);
      const todo = pendingOffers().map((o) => runFor(o.item)).filter(Boolean) as Run[];
      return start(todo, false);
    }
    if (t.closest('[data-tr-next]')) return next();
    if (t.closest('[data-tr-back]')) return void go(index - 1);
    const r = t.closest<HTMLElement>('[data-tr-rating]');
    if (r) return void rate(r.dataset.trRating!, r.closest<HTMLElement>('[data-tr-rate]')!);
  });
}

// ---- Starting ------------------------------------------------------------------------------------
/** Help and what's new: the list, with everything waiting first. */
export async function startTour() {
  if (root || sheetOpen()) return;
  await load();
  openSheet(false);
}

async function resume(): Promise<boolean> {
  const s = store.get();
  if (!s) return false;
  as = s.as;
  await load();
  who = whoFrom(await hub(), as);
  runs = s.runs;
  ri = s.r;
  auto = s.auto;
  steps = runs[ri] ? stepsOf(runs[ri]) : [];
  index = s.i;
  const step = steps[index];
  if (!step) { store.clear(); return false; }
  if (step.page && !samePage(step.page)) {
    // The person left the tour's page on their own (Back, a link). A walkthrough still waiting asks before it goes.
    store.clear();
    if (!runPending() || as) return false;
    askClose(() => { leaving = false; build(); void go(index); });
    return true;
  }
  leaving = false;
  build();
  await show(step, ++gen);
  return true;
}

// Someone who opened a help article or a video from the list is reading it: the list waits ten minutes in this tab.
const READING = 'favor.hub.tours.reading';
const reading = () => { try { return Date.now() - Number(sessionStorage.getItem(READING) || 0) < 10 * 60 * 1000; } catch { return false; } };

let autoTimer = 0;
/** A quiet page with something waiting: open it. Anything else: wait for the next page. */
function maybeAuto() {
  clearTimeout(autoTimer);
  autoTimer = window.setTimeout(async () => {
    if (root || sheetOpen() || confirmOpen() || store.get()) return;
    // A browser driven by a script (the UI sweep, a test) is not a person: it gets the tour only when it asks for it.
    if (navigator.webdriver && localStorage.getItem(AUTO_TEST) !== '1') return;
    await load();
    if (as || root || sheetOpen() || busy() || reading()) return;
    const today = etToday();
    if (corePending()) {
      if (mayOpen(progress, coreItem, today)) return openSheet(true);
      // Skipped past its last return: the new things still get their turn.
      if ((progress[coreItem]?.n || 0) <= RETURNS) return;
    }
    if (pendingOffers().some((o) => mayOpen(progress, releaseItem(o.release.id), today))) openSheet(true);
  }, 1400);
}

export function initTour() {
  // The saved count paints the number before the first answer from the server.
  document.addEventListener('favor-hub', () => { if (loaded) { void hub().then((d) => { who = whoFrom(d, as); paint(); }); } });
  document.addEventListener('keydown', (e) => { if (e.isTrusted && (e.target as HTMLElement).matches?.('input,textarea,[contenteditable="true"]') && e.key.length === 1) typedHere = true; }, true);
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-tour-start]');
    if (!b) return;
    e.preventDefault();
    void startTour();
  });
  document.addEventListener('hub-swapped', () => { typedHere = false; paint(); if (!root) maybeAuto(); });
  void load();
  const q = new URLSearchParams(location.search);
  if (q.has('tour')) {
    history.replaceState(null, '', location.pathname + location.hash);
    void startTour();
    return;
  }
  void resume().then((on) => { if (!on) maybeAuto(); });
}
