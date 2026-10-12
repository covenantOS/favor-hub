/* Shared helpers for the Calendar, Timeline and Workload views (lane VIEWS).
   Dates are plain YYYY-MM-DD strings. Day math runs on whole-day numbers in UTC so a time zone or a clock change never shifts a day. */

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAY_MS = 86400000;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON3 = MONTHS.map((m) => m.slice(0, 3));
export const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Whole-day number (days since 1970-01-01) for a YYYY-MM-DD string, or NaN. */
export function dn(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
  if (!m) return NaN;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}
export const ymd = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const parts = (n) => { const d = new Date(n * DAY_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() }; };
export const dayOfWeek = (n) => new Date(n * DAY_MS).getUTCDay();
export const mkDn = (y, m, d) => Math.round(Date.UTC(y, m, d) / DAY_MS);
export const startOfWeek = (n) => n - dayOfWeek(n);

let todayCache = null;
/** Today in Eastern time as a day number (the team works on Eastern dates). */
export function todayDn() {
  const now = Date.now();
  if (todayCache && now - todayCache.at < 30000) return todayCache.n;
  let s;
  try { s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { s = new Date().toISOString().slice(0, 10); }
  todayCache = { at: now, n: dn(s) };
  return todayCache.n;
}

export function fmtShort(n) { const p = parts(n); return MON3[p.m] + ' ' + p.d; }
export function fmtLong(n) { const p = parts(n); return DOW3[p.dow] + ', ' + MON3[p.m] + ' ' + p.d; }
export function fmtRange(a, b) {
  if (!(a === a) && !(b === b)) return '';
  if (a !== a) return fmtShort(b);
  if (b !== b || a === b) return fmtShort(a);
  const pa = parts(a), pb = parts(b);
  return pa.m === pb.m ? MON3[pa.m] + ' ' + pa.d + ' to ' + pb.d : fmtShort(a) + ' to ' + fmtShort(b);
}

/* ---------------------------------------------------------------- tasks */

/** The start and due day numbers of a task, ordered. A task with one date has start === due. NaN when it has none. */
export function span(t) {
  const s = dn(t.start_date), d = dn(t.due_date);
  if (s === s && d === d) return s <= d ? { s, d, both: true } : { s: d, d: s, both: true };
  if (d === d) return { s: d, d, both: false };
  if (s === s) return { s, d: s, both: false };
  return { s: NaN, d: NaN, both: false };
}
export const isDone = (t) => t.status === 'done' || t.status === 'dropped' || !!t.done_at;
export const isOpen = (t) => !isDone(t);
export function isOverdue(t) {
  if (!isOpen(t)) return false;
  const d = dn(t.due_date);
  return d === d && d < todayDn();
}

const COLORS = {
  leaf: ['#3d7a32', '#e1efdc'], sun: ['#a8690a', '#f7ecd2'], teal: ['#1f7a78', '#dcefee'], dusk: ['#6a5bb5', '#e9e5f4'],
  sky: ['#2f78b0', '#e1edf5'], slate: ['#55606b', '#e6e9ec'], terra: ['#b8532f', '#f8e5dc'],
};
export function colorOf(token) { return COLORS[token] ? token : 'slate'; }
const PEOPLE_COLORS = ['teal', 'leaf', 'dusk', 'sky', 'sun', 'terra', 'slate'];
export function hashColor(s) { let h = 0; s = String(s || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PEOPLE_COLORS[h % PEOPLE_COLORS.length]; }

export function initials(name, email) {
  const n = String(name || '').trim();
  if (n) return n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return String(email || '?')[0].toUpperCase();
}
/** A small round-cornered avatar for a Person ({email,name,picture}). */
export function avatar(p, size) {
  if (!p) return '<span class="pjv-av pjv-av--none' + (size ? ' pjv-av--' + size : '') + '" aria-hidden="true"></span>';
  const c = hashColor(p.email || p.name);
  return '<span class="pjv-av' + (size ? ' pjv-av--' + size : '') + '" data-pc="' + c + '" title="' + esc(p.name || p.email) + '">' +
    (p.picture ? '<img src="' + esc(p.picture) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') +
    '<b>' + esc(initials(p.name, p.email)) + '</b></span>';
}

/** A short message at the bottom. `action` is {label, fn}, used for Undo. */
export function toast(msg, kind, action) {
  let host = document.getElementById('pjv-toasts');
  if (!host) { host = document.createElement('div'); host.id = 'pjv-toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = 'pjv-toast' + (kind === 'error' ? ' is-error' : '');
  const sp = document.createElement('span');
  sp.textContent = msg;
  el.appendChild(sp);
  const kill = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 250); };
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { kill(); action.fn(); });
    el.appendChild(b);
  }
  host.appendChild(el);
  setTimeout(kill, kind === 'error' ? 4200 : action ? 6000 : 2200);
}

/** Make the view fill the window under its own top edge. Phones pin with measured pixels, never viewport units. */
export function fitHeight(root, min) {
  const run = () => {
    const top = root.getBoundingClientRect().top;
    const h = Math.max(min || 420, Math.floor(window.innerHeight - top - (window.matchMedia('(max-width: 720px)').matches ? 8 : 16)));
    root.style.height = h + 'px';
  };
  run();
  window.addEventListener('resize', run);
  window.addEventListener('orientationchange', run);
  const t = setTimeout(run, 400);
  return () => { clearTimeout(t); window.removeEventListener('resize', run); window.removeEventListener('orientationchange', run); };
}

export function prefs(key) {
  let v = {};
  try { v = JSON.parse(localStorage.getItem('pjv.' + key) || '{}') || {}; } catch (e) { v = {}; }
  return { get: v, set(o) { Object.assign(v, o); try { localStorage.setItem('pjv.' + key, JSON.stringify(v)); } catch (e) { /* storage refused */ } } };
}

/** Open a task in the drawer the UI lane exports; before it exists, go to ?t=CODE. */
export function openTask(t) {
  const code = typeof t === 'string' ? t : (t.code || t.id);
  const fp = window.FavorProjects;
  if (fp && typeof fp.openTask === 'function') { fp.openTask(code); return; }
  const u = new URL(location.href);
  u.searchParams.set('t', code);
  location.href = u.toString();
}

export async function getApi(ctx) {
  if (ctx && ctx.api) return ctx.api;
  const mod = await import('./api.js');
  return mod.api || mod.default;
}

/** Every task the view needs. Pages through the list so 2,000 tasks load; 'mine' limits to the signed-in person's own tasks. */
export async function loadTasks(api, q) {
  const out = [];
  const limit = 500;
  let offset = 0;
  for (let guard = 0; guard < 12; guard++) {
    const r = await api.tasks(Object.assign({ status: 'all', limit, offset }, q || {}));
    const rows = (r && r.tasks) || [];
    out.push(...rows);
    offset += rows.length;
    if (!rows.length || offset >= ((r && r.total) || 0) || rows.length < Math.min(limit, 50)) break;
  }
  return out;
}

/** PATCH with the contract's route. Falls back to raw fetch when the wrapper lacks the function. */
export async function patchTask(api, id, body) {
  if (api && typeof api.patchTask === 'function') return api.patchTask(id, body);
  const r = await fetch('/api/tasks/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.message || 'Could not save');
  return j;
}
export async function createTask(api, body) {
  if (api && typeof api.createTask === 'function') return api.createTask(body);
  const r = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.message || 'Could not add the task');
  return j;
}
/** PUT /api/tasks/:id/deps {add,remove}. The wrapper's name for it is not fixed by the contract, so try the likely ones. */
export async function putDeps(api, id, body) {
  const fn = api && (api.putDeps || api.deps || api.taskDeps || api.setDeps || api.updateDeps);
  if (typeof fn === 'function') return fn.call(api, id, body);
  const r = await fetch('/api/tasks/' + encodeURIComponent(id) + '/deps', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.message || 'Could not save the link');
  return j;
}

export function msgOf(e) { return (e && (e.message || e.error)) || 'Could not save. Try again.'; }

/** Group label helpers for the owner / section / project groupings. */
export function ownerKey(t) { return t.owner ? (t.owner.email || '') : ''; }
export function ownerName(t) { return t.owner ? (t.owner.name || t.owner.email) : 'Unassigned'; }

export function debounceRaf(fn) {
  let r = 0;
  const f = () => { if (r) return; r = requestAnimationFrame(() => { r = 0; fn(); }); };
  f.cancel = () => { if (r) cancelAnimationFrame(r); r = 0; };
  return f;
}

export const isPhone = () => window.matchMedia('(max-width: 720px)').matches;

/** An overlay opened by a view: registers with hubOv so Back closes it. Returns {close}. */
export function trackOverlay(close) {
  const ov = window.hubOv;
  const tok = ov && ov.on ? ov.on(close) : null;
  return { done() { if (tok && ov.off) ov.off(tok); } };
}

export const ICON = {
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
