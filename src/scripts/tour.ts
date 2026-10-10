// The guided tour engine. Help and what's new starts it: a pointer moves across the screen, presses
// things, types examples, and goes from page to page while a card explains each part. The page dims
// around whatever is being shown. The tour keeps its place in this tab (sessionStorage) so it carries
// on after each page change, and remembers in this browser (localStorage) which new things the
// person has seen, so the green dot on Help only shows when something new is waiting.
import { stepsFor, roleName, latestAdded, STEPS, type Step, type Who } from './tours';
import { cue } from './feel';

const STATE = 'favor.hub.tour';
const SEEN = 'favor.hub.tour.seen';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = () => innerWidth <= 860;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Saved = { mode: 'full' | 'new'; ids: string[]; i: number; at: number; as?: string; x?: number; y?: number };

const store = {
  get(): Saved | null {
    try {
      const s = JSON.parse(sessionStorage.getItem(STATE) || 'null') as Saved | null;
      return s && Date.now() - s.at < 20 * 60 * 1000 ? s : null;
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

function seen(): string {
  try {
    return localStorage.getItem(SEEN) || '';
  } catch {
    return '';
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN, latestAdded());
  } catch {
    // nothing to do
  }
  paintDot();
}
function paintDot() {
  const fresh = latestAdded() > seen();
  document.querySelectorAll('#h-help').forEach((b) => b.classList.toggle('has-new', fresh));
}

// ---- Who is looking --------------------------------------------------------------------------
type Hub = { user?: { name?: string }; access?: Record<string, boolean>; kpiTeams?: string[] };
function hub(): Promise<Hub> {
  const w = window as unknown as { FAVOR_HUB?: Hub };
  if (w.FAVOR_HUB) return Promise.resolve(w.FAVOR_HUB);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({}), 4000);
    document.addEventListener('favor-hub', (e) => {
      clearTimeout(t);
      resolve((e as CustomEvent).detail || {});
    }, { once: true });
  });
}

const PRESETS: Record<string, Partial<Who>> = {
  staff: { admin: false, leader: false, teams: [], kpi: true, approver: false, expenseLog: false },
  rdd: { work: true, admin: false, leader: false, teams: ['rdd'], kpi: true, approver: false, expenseLog: false },
  pc: { work: true, admin: false, leader: false, teams: ['pc'], kpi: true, approver: false, expenseLog: false },
  ce: { work: true, admin: false, leader: false, teams: ['ce'], kpi: true, approver: false, expenseLog: false },
  grants: { work: true, admin: false, leader: false, teams: ['grants'], kpi: true, approver: false, expenseLog: false },
  marketing: { admin: false, leader: false, teams: ['marketing'], kpi: true, approver: false, expenseLog: false },
  leader: { work: true, admin: false, leader: true, teams: ['rdd', 'ce', 'pc', 'grants', 'marketing'], kpi: true, approver: true, expenseLog: true },
};

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
  };
  return as && PRESETS[as] && real.admin ? { ...real, ...PRESETS[as] } : real;
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

const POINTER =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 3.5 22.5 15l-7.6 1.4L19 24.6l-3.2 1.5-4.2-8.3L5.8 23z" fill="#fff" stroke="#1b3317" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function build() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'tr';
  root.innerHTML = `<div class="tr-block"></div><div class="tr-hole"></div><div class="tr-cursor">${POINTER}<i></i></div><div class="tr-pop" role="dialog" aria-modal="true" aria-labelledby="tr-title" tabindex="-1"></div>`;
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
  follow();
}

function teardown() {
  cancelAnimationFrame(raf);
  document.removeEventListener('keydown', onKey, true);
  restoreTyped();
  if (root) {
    const r = root;
    r.classList.remove('is-on');
    setTimeout(() => r.remove(), reduced() ? 0 : 260);
  }
  root = null;
  target = null;
  if (phone()) document.getElementById('h-app')?.classList.remove('is-nav');
}

let lastRect = '';
function follow() {
  raf = requestAnimationFrame(follow);
  if (!root) return;
  if (!target) {
    if (lastRect !== 'none') {
      hole.classList.add('is-none');
      hole.style.cssText = `transform:translate(${innerWidth / 2}px,${innerHeight / 2}px);width:0;height:0`;
      lastRect = 'none';
    }
    return;
  }
  hole.classList.remove('is-none');
  const r = target.getBoundingClientRect();
  const pad = 8;
  const x = Math.max(4, r.left - pad);
  const y = Math.max(4, r.top - pad);
  const w = Math.min(innerWidth - 8, r.right + pad) - x;
  const h = Math.min(innerHeight - 8, r.bottom + pad) - y;
  const key = `${x}|${y}|${w}|${h}`;
  if (key === lastRect) return;
  lastRect = key;
  hole.style.cssText = `transform:translate(${x}px,${y}px);width:${w}px;height:${h}px`;
  place(r);
}

function moveCursor(x: number, y: number, instant = false) {
  if (!cursor) return;
  cursor.style.transition = instant || reduced() ? 'none' : '';
  cursor.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  const s = store.get();
  if (s) store.set({ ...s, x, y });
}

async function pointAt(el: Element, press = false) {
  if (!cursor) return;
  const r = el.getBoundingClientRect();
  const x = r.left + Math.min(r.width * 0.5, 60);
  const y = r.top + Math.min(r.height * 0.5, 40);
  moveCursor(x, y);
  await sleep(700);
  if (press) {
    cursor.classList.remove('is-press');
    void cursor.offsetWidth;
    cursor.classList.add('is-press');
    cue('press');
    await sleep(220);
  }
}

// ---- Finding things ----------------------------------------------------------------------------
const visible = (el: Element | null) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');

async function find(sel: string, ms = 5000): Promise<Element | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const all = Array.from(document.querySelectorAll(sel));
    const el = all.find(visible);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
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
  app.classList.toggle('is-nav', need);
  document.getElementById('h-menu')?.setAttribute('aria-expanded', need ? 'true' : 'false');
}

async function typeInto(el: Element, text: string, my: number) {
  const box = (el.matches('input,textarea') ? el : el.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!box) return;
  typed = { el: box, was: box.value };
  box.focus({ preventScroll: true });
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

// ---- The card ----------------------------------------------------------------------------------
function place(r?: DOMRect) {
  if (!pop) return;
  const m = 14;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  if (phone()) {
    pop.style.left = '12px';
    pop.style.top = `${innerHeight - ph - 12}px`;
    return;
  }
  if (!r) {
    pop.style.left = `${(innerWidth - pw) / 2}px`;
    pop.style.top = `${Math.max(m, (innerHeight - ph) / 2)}px`;
    return;
  }
  const want = (pop.dataset.side || 'bottom') as 'right' | 'left' | 'top' | 'bottom';
  const order = [want, 'bottom', 'top', 'right', 'left'] as const;
  const fits = {
    bottom: r.bottom + m + ph < innerHeight - m,
    top: r.top - m - ph > m,
    right: r.right + m + pw < innerWidth - m,
    left: r.left - m - pw > m,
  };
  const side = order.find((s) => fits[s]);
  let x: number;
  let y: number;
  if (side === 'bottom' || side === 'top') {
    x = Math.min(Math.max(m, r.left + r.width / 2 - pw / 2), innerWidth - pw - m);
    y = side === 'bottom' ? r.bottom + m : r.top - m - ph;
  } else if (side === 'right' || side === 'left') {
    x = side === 'right' ? r.right + m : r.left - m - pw;
    y = Math.min(Math.max(m, r.top + r.height / 2 - ph / 2), innerHeight - ph - m);
  } else {
    // Bigger than the screen around it: sit at the bottom of the screen, over it.
    x = (innerWidth - pw) / 2;
    y = innerHeight - ph - 24;
  }
  pop.style.left = `${Math.round(x)}px`;
  pop.style.top = `${Math.round(y)}px`;
  pop.dataset.at = side || 'over';
}

function card(html: string, side?: string) {
  pop.dataset.side = side || 'bottom';
  pop.classList.remove('is-in', 'is-busy');
  pop.innerHTML = html;
  void pop.offsetWidth;
  pop.classList.add('is-in');
  lastRect = '';
  if (!target) place();
  const go = pop.querySelector<HTMLElement>('[data-tr-next],[data-tr-start],[data-tr-done]');
  (go || pop).focus({ preventScroll: true });
}

// ---- Running ---------------------------------------------------------------------------------
let steps: Step[] = [];
let mode: 'full' | 'new' = 'full';
let as: string | undefined;
let who: Who;
let index = 0;

function onKey(e: KeyboardEvent) {
  if (!root) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    end(false);
  } else if (e.key === 'ArrowRight' && !(e.target as HTMLElement).matches('input,textarea')) {
    e.preventDefault();
    go(index + 1);
  } else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement).matches('input,textarea')) {
    e.preventDefault();
    if (index > 0) go(index - 1);
  }
}

function samePage(page: string) {
  const norm = (p: string) => p.replace(/\/+$/, '') || '/';
  return norm(location.pathname) === norm(page);
}

async function go(i: number) {
  if (!root || leaving || i < 0) return;
  if (i >= steps.length) return finish();
  const my = ++gen;
  pop.classList.add('is-busy');
  const prev = steps[index];
  if (prev && i !== index) {
    restoreTyped();
    if (prev.undo) document.querySelector<HTMLElement>(prev.undo)?.click();
  }
  index = i;
  const step = steps[i];
  store.set({ mode, ids: steps.map((s) => s.id), i, at: Date.now(), as });

  if (step.page && !samePage(step.page)) {
    // Go there the way a person would: the pointer presses the tool in the menu.
    const link = step.via ? document.querySelector(`.h-side [data-nav-id="${step.via}"]`) : null;
    target = null;
    if (link && !link.closest('[hidden]')) {
      openMenuFor(`.h-side [data-nav-id="${step.via}"]`);
      await sleep(phone() ? 260 : 0);
      target = link;
      card(`<p class="tr-going">Opening ${esc(link.textContent?.trim() || 'the page')}</p>`, 'right');
      await pointAt(link, true);
      if (my !== gen) return;
    }
    leaving = true;
    location.href = step.page;
    return;
  }
  await show(step, my);
}

async function scrollTo(el: Element) {
  const r = el.getBoundingClientRect();
  if (el.closest('.h-side')) {
    // Inside the menu, which scrolls on its own when it is taller than the screen.
    if (r.top < 8 || r.bottom > innerHeight - 8) {
      el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      await sleep(320);
    }
    return;
  }
  if (el.closest('#cmdk')) return;
  const top = phone() ? 72 : 84;
  const roomBelow = phone() ? 260 : 40;
  if (r.top >= top && r.bottom <= innerHeight - roomBelow) return;
  // Big things start under the top bar; small ones sit in the middle of the screen.
  const tall = r.height > innerHeight - top - roomBelow;
  const delta = tall || phone() ? r.top - top : r.top - (innerHeight - r.height) / 2;
  window.scrollTo({ top: Math.max(0, scrollY + delta), behavior: reduced() ? 'auto' : 'smooth' });
  await sleep(480);
}

async function show(step: Step, my: number) {
  openMenuFor(step.at);
  const n = steps.length;
  const body = typeof step.body === 'function' ? step.body(who) : step.body;
  const isNew = step.added && step.added > seenAtStart;
  // The card changes at once; the highlight follows when the new thing is found.
  card(
    `<div class="tr-meta"><span>${mode === 'new' ? "What's new" : 'Tour'} · ${index + 1} of ${n}</span>${isNew ? '<em class="h-new">New</em>' : ''}<button type="button" class="tr-x" data-tr-close aria-label="End the tour">&#x2715;</button></div>
     <h3 id="tr-title">${esc(step.title)}</h3>
     <p>${esc(body)}</p>
     <div class="tr-bar" aria-hidden="true"><i style="width:${(((index + 1) / n) * 100).toFixed(1)}%"></i></div>
     <div class="tr-acts">
       ${index > 0 ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-back>Back</button>' : '<span></span>'}
       <button type="button" class="h-btn h-btn--primary h-btn--sm" data-tr-next>${index + 1 === n ? 'Finish' : 'Next'}</button>
     </div>`,
    step.side
  );
  pop.classList.add('is-busy');
  cue('tick');
  const stale = () => my !== gen || !root;
  if (phone() && step.at && inSide(step.at)) await sleep(260);
  if (step.press) {
    const p = await find(step.press, 2500);
    if (stale()) return;
    if (p) {
      await pointAt(p, true);
      if (stale()) return;
      (p as HTMLElement).click();
      await sleep(260);
    }
  }
  const el = step.at ? await find(step.at, 5000) : null;
  if (stale()) return;
  if (el) await scrollTo(el);
  if (stale()) return;
  target = el;
  lastRect = '';
  if (!el) place();
  if (el) {
    await pointAt(el, false);
    if (stale()) return;
    if (step.type) await typeInto(el, step.type, my);
  } else {
    moveCursor(innerWidth * 0.62, innerHeight * 0.78);
  }
  if (!stale()) pop.classList.remove('is-busy');
}

let seenAtStart = '';

function intro() {
  const fresh = stepsFor(who, 'new', seenAtStart);
  const newCount = fresh.filter((s) => s.added && s.added > seenAtStart).length;
  const hi = who.first ? `Hi ${esc(who.first)}.` : 'Hi.';
  const preview = who.admin
    ? `<label class="tr-as"><span>Show the tour as</span><select data-tr-as>
        <option value="">You (the hub admin)</option><option value="staff">Any staff member</option><option value="rdd">RDD team</option>
        <option value="pc">Partner Care</option><option value="ce">Church Engagement</option><option value="grants">Grants</option>
        <option value="marketing">Marketing</option><option value="leader">Leadership</option></select></label>`
    : '';
  target = null;
  card(
    `<div class="tr-meta"><span>Help and what's new</span><button type="button" class="tr-x" data-tr-close aria-label="Close">&#x2715;</button></div>
     <h3 id="tr-title">${hi} Let me show you around.</h3>
     <p>This tour is set up for ${esc(roleName(who))}: ${steps.length} stops, about two minutes. I'll move the pointer, open things and type examples for you. Nothing gets sent or changed.</p>
     ${newCount ? `<p class="tr-new"><em class="h-new">New</em> ${newCount} new ${newCount === 1 ? 'thing' : 'things'} since you last looked.</p>` : ''}
     ${preview}
     <div class="tr-acts tr-acts--intro">
       <button type="button" class="h-btn h-btn--primary" data-tr-start="full">Show me around</button>
       ${fresh.length ? `<button type="button" class="h-btn h-btn--ghost" data-tr-start="new">Only what's new</button>` : ''}
       <a class="tr-link" href="/help/">Open the help docs</a>
     </div>`
  );
  cue('chime');
}

function finish() {
  gen++;
  restoreTyped();
  const prev = steps[index];
  if (prev?.undo) document.querySelector<HTMLElement>(prev.undo)?.click();
  store.clear();
  markSeen();
  target = null;
  moveCursor(innerWidth * 0.62, innerHeight * 0.82);
  card(
    `<div class="tr-meta"><span>${mode === 'new' ? "What's new" : 'Tour'} · done</span><button type="button" class="tr-x" data-tr-close aria-label="Close">&#x2715;</button></div>
     <h3 id="tr-title">That's the tour.</h3>
     <p>The help docs cover each tool step by step, and the training videos are there too. Press Help and what's new any time to see this again.</p>
     <div class="tr-rate" data-tr-rate>
       <span>Was this tour useful?</span>
       <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-rating="helpful">Yes</button>
       <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-tr-rating="not-helpful">Not really</button>
     </div>
     <div class="tr-acts">
       <a class="tr-link" href="/help/">Open the help docs</a>
       <button type="button" class="h-btn h-btn--primary h-btn--sm" data-tr-done>Done</button>
     </div>`
  );
  cue('success');
}

function end(done: boolean) {
  gen++;
  if (!done) {
    restoreTyped();
    const prev = steps[index];
    if (prev?.undo) document.querySelector<HTMLElement>(prev.undo)?.click();
  }
  store.clear();
  if (mode === 'new' || done) markSeen();
  teardown();
}

async function rate(rating: string, box: HTMLElement) {
  box.innerHTML = rating === 'helpful'
    ? '<span>Thanks. Glad it helped.</span>'
    : `<form class="tr-why" data-tr-why><label for="tr-why">What would have helped?</label><textarea id="tr-why" rows="2" maxlength="600" placeholder="A step that was missing, or something that didn't make sense"></textarea><button type="submit" class="h-btn h-btn--primary h-btn--sm">Send</button></form>`;
  const send = (comment = '') =>
    fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'tour', rating, comment, page: `${location.pathname} (${mode} tour${as ? `, as ${as}` : ''})` }),
    }).catch(() => {});
  if (rating === 'helpful') {
    send();
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
    if (t.closest('[data-tr-close]')) return end(false);
    if (t.closest('[data-tr-done]')) return end(true);
    if (t.closest('[data-tr-next]')) return go(index + 1);
    if (t.closest('[data-tr-back]')) return go(index - 1);
    const st = t.closest<HTMLElement>('[data-tr-start]');
    if (st) {
      mode = st.dataset.trStart === 'new' ? 'new' : 'full';
      steps = stepsFor(who, mode, seenAtStart);
      index = 0;
      return go(0);
    }
    const r = t.closest<HTMLElement>('[data-tr-rating]');
    if (r) return rate(r.dataset.trRating!, r.closest<HTMLElement>('[data-tr-rate]')!);
  });
  pop.addEventListener('change', async (e) => {
    const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-tr-as]');
    if (!sel) return;
    as = sel.value || undefined;
    who = whoFrom(await hub(), as);
    steps = stepsFor(who, 'full', seenAtStart);
    const p = pop.querySelector('p');
    if (p) p.textContent = `This tour is set up for ${roleName(who)}: ${steps.length} stops, about two minutes. I'll move the pointer, open things and type examples for you. Nothing gets sent or changed.`;
  });
}

export async function startTour() {
  if (root) return;
  seenAtStart = seen();
  as = undefined;
  who = whoFrom(await hub());
  mode = 'full';
  steps = stepsFor(who, 'full', seenAtStart);
  index = 0;
  gen++;
  leaving = false;
  build();
  wire();
  intro();
}

async function resume() {
  const s = store.get();
  if (!s) return;
  seenAtStart = seen();
  as = s.as;
  who = whoFrom(await hub(), as);
  mode = s.mode;
  const byId = new Map(STEPS.map((x) => [x.id, x]));
  steps = s.ids.map((id) => byId.get(id)).filter(Boolean) as Step[];
  index = s.i;
  // Someone who left the tour's page on their own has left the tour.
  if (!steps[index] || (steps[index].page && !samePage(steps[index].page!))) return store.clear();
  build();
  wire();
  await show(steps[index], ++gen);
}

export function initTour() {
  paintDot();
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-tour-start]');
    if (!b) return;
    e.preventDefault();
    startTour();
  });
  if (new URLSearchParams(location.search).has('tour')) {
    history.replaceState(null, '', location.pathname + location.hash);
    startTour();
  } else {
    resume();
  }
}
