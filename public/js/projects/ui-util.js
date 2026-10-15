/* Shared helpers for the projects UI: escaping, icons, dates in Eastern time, avatars, toasts, sheets and pop-up choosers. */
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const phone = () => matchMedia('(max-width: 860px)').matches;
export const coarse = () => matchMedia('(pointer: coarse)').matches;

const P = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  comment: '<path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>',
  sub: '<path d="M6 4v8a3 3 0 0 0 3 3h8"/><path d="m14 12 3 3-3 3"/>',
  flag: '<path d="M6 21V4m0 0h11l-2 4 2 4H6"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1-4 4-6 8-6s7 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  board: '<rect x="4" y="4" width="6" height="16" rx="1.5"/><rect x="14" y="4" width="6" height="10" rx="1.5"/>',
  gantt: '<path d="M4 6h8M8 12h10M6 18h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  block: '<circle cx="12" cy="12" r="8"/><path d="m6.3 6.3 11.4 11.4"/>',
  hourglass: '<path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8"/>',
};
export const icon = (n, cls) => `<svg class="pj-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

/* ---------------------------------------------------------------- dates (Eastern) */
export const ET = 'America/New_York';
let tdC = ''; let tdAt = 0;
export const todayStr = () => { const n = Date.now(); if (n - tdAt > 20000) { tdC = new Date(n).toLocaleDateString('en-CA', { timeZone: ET }); tdAt = n; } return tdC; };
const parse = (s) => new Date(s + 'T12:00:00Z');
export const addDays = (s, n) => new Date(parse(s).getTime() + n * 86400000).toISOString().slice(0, 10);
export const dow = (s) => parse(s).getUTCDay();
export const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayDiff = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
export function dueLabel(d, time) {
  if (!d) return '';
  const t = todayStr();
  const n = dayDiff(d, t);
  let s;
  if (n === 0) s = 'Today';
  else if (n === 1) s = 'Tomorrow';
  else if (n === -1) s = 'Yesterday';
  else if (n > 1 && n < 7) s = DAY[dow(d)];
  else { const x = parse(d); s = MON[x.getUTCMonth()] + ' ' + x.getUTCDate() + (d.slice(0, 4) !== t.slice(0, 4) ? ', ' + d.slice(0, 4) : ''); }
  if (time) { const [h, m] = time.split(':').map(Number); s += ' ' + ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM'); }
  return s;
}
export const shortDate = (d) => { if (!d) return ''; const x = parse(d); return MON[x.getUTCMonth()] + ' ' + x.getUTCDate(); };
export const isOverdue = (t) => !!(t.due_date && t.status !== 'done' && t.status !== 'dropped' && t.due_date < todayStr());
export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  const d = new Date(iso);
  return MON[d.getMonth()] + ' ' + d.getDate();
};

/* ---------------------------------------------------------------- people */
const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
export function avatar(p, size) {
  if (!p) return `<span class="pj-av pj-av--empty${size ? ' pj-av--' + size : ''}" title="Unassigned">${icon('user')}</span>`;
  const name = p.name || String(p.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const inner = p.picture ? `<img src="${esc(p.picture)}" alt="" referrerpolicy="no-referrer" loading="lazy" />` : '';
  return `<span class="pj-av${size ? ' pj-av--' + size : ''}"${p.email ? ` data-entity="person:${esc(p.email)}" data-label="${esc(name)}"` : ''} data-c="${COLORS[hash(String(p.email || name)) % 7]}" data-i="${esc(initials(name))}">${inner}</span>`;
}
export const firstName = (p) => String((p && p.name) || '').split(/\s+/)[0] || '';

/* ---------------------------------------------------------------- toast */
let toastEl = null;
let toastT = 0;
export function toast(msg, opts = {}) {
  if (window.hubToast) { const fn = opts.action ? opts.action.fn : opts.undo; window.hubToast(msg, { tone: opts.error ? 'bad' : '', ms: opts.ms, action: fn ? { label: opts.action ? opts.action.label : 'Undo', fn: fn } : null }); return; }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'pj-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastT);
  toastEl.className = 'pj-toast' + (opts.error ? ' is-error' : '');
  toastEl.innerHTML = `<span>${esc(msg)}</span>${opts.undo || opts.action ? '<button type="button" class="pj-toast__b">' + esc(opts.action ? opts.action.label : 'Undo') + '</button>' : ''}`;
  const b = toastEl.querySelector('button');
  if (b) b.onclick = () => { toastEl.classList.remove('is-on'); (opts.action ? opts.action.fn : opts.undo)(); };
  requestAnimationFrame(() => toastEl.classList.add('is-on'));
  toastT = setTimeout(() => toastEl && toastEl.classList.remove('is-on'), opts.ms || (opts.undo || opts.action ? 6000 : 3200));
}

/* ---------------------------------------------------------------- sheets: a dialog on desktop, a sheet on a phone. Back closes. */
const sheets = [];
export function openSheet({ title, html, cls = '', label, onClose, hideHead }) {
  const scrim = document.createElement('div');
  scrim.className = 'pj-scrim';
  const el = document.createElement('div');
  el.className = 'pj-sheet ' + cls;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label || title || 'Dialog');
  el.innerHTML = (hideHead ? '' : `<div class="pj-sheet__head"><h2>${esc(title || '')}</h2><button type="button" class="pj-x" data-sheet-x aria-label="Close">${icon('x')}</button></div>`) + `<div class="pj-sheet__body">${html || ''}</div>`;
  document.body.append(scrim, el);
  const ret = document.activeElement;
  el.tabIndex = -1;
  el.focus({ preventScroll: true });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const nodes = [...el.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex="0"]')].filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  let tok = null;
  let closed = false;
  const s = {
    el, body: el.querySelector('.pj-sheet__body'),
    close(result) {
      if (closed) return;
      closed = true;
      const i = sheets.indexOf(s); if (i >= 0) sheets.splice(i, 1);
      if (tok && window.hubOv) { const t = tok; tok = null; window.hubOv.off(t); }
      el.remove(); scrim.remove();
      if (ret && ret.focus && document.contains(ret)) { try { ret.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
      if (onClose) onClose(result);
    },
  };
  sheets.push(s);
  scrim.addEventListener('click', () => s.close());
  el.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-x]')) s.close(); });
  if (window.hubOv) tok = window.hubOv.on(() => { tok = null; s.close(); });
  return s;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheets.length && !document.querySelector('.pj-pop, .rt-sheet')) { e.stopPropagation(); e.preventDefault(); sheets[sheets.length - 1].close(); }
}, true);
export const sheetOpen = () => sheets.length > 0;

/**
 * Choose one of a list. items: [{value, label, hint, dot, on, icon}]. Returns the value, or undefined when dismissed.
 * On desktop a small pop-up under `anchor`; on a phone a bottom sheet.
 */
export function choose({ anchor, title, items, search, placeholder, source, typed }) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = (v) => { if (resolved) return; resolved = true; resolve(v); };
    let q = '';
    let hi = phone() ? -1 : Math.max(0, items.findIndex((i) => i.on));
    // typed(q): an item made from what was typed (a date read from "fri" or "oct 20"), shown first.
    const list = () => {
      const base = q && !source ? items.filter((i) => (i.label + ' ' + (i.hint || '')).toLowerCase().includes(q.toLowerCase())) : items;
      const x = typed && q ? typed(q) : null;
      return x ? [x].concat(base.filter((i) => i.value !== x.value)) : base;
    };
    const rows = (arr) => arr.length ? arr.map((it, i) => `<button type="button" class="pj-opt${it.on ? ' is-on' : ''}${i === hi ? ' is-hi' : ''}" role="option" data-i="${i}">${it.dot ? `<i class="pj-dot" data-c="${esc(it.dot)}"></i>` : ''}${it.icon ? icon(it.icon) : ''}<span class="pj-opt__t"><b>${esc(it.label)}</b>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>${it.on ? icon('check', 'pj-opt__ok') : ''}</button>`).join('') : '<p class="pj-none">Nothing matches.</p>';
    const html = `${search ? `<div class="pj-search">${icon('search')}<input type="search" data-q placeholder="${esc(placeholder || 'Search')}" aria-label="${esc(placeholder || 'Search')}" autocomplete="off" /></div>` : ''}<div class="pj-opts" role="listbox" data-list>${rows(list())}</div>`;
    if (!phone() && anchor) {
      const pop = document.createElement('div');
      pop.className = 'pj-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', title || 'Choose');
      pop.innerHTML = html;
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const w = Math.max(230, Math.min(320, pop.offsetWidth || 260));
      pop.style.width = w + 'px';
      let left = Math.min(Math.max(8, r.left), innerWidth - w - 8);
      let top = r.bottom + 6;
      // A list that loads (codes, people) grows after it opens, so room is kept for its full height. Where neither side has
      // that room, it opens on the roomier side and scrolls inside.
      const full = Math.min(380, Math.round(innerHeight * 0.6));
      const h = source ? full : pop.offsetHeight;
      const below = innerHeight - 8 - top;
      const above = r.top - 14;
      if (h > below) {
        if (above >= h || above > below) { const hh = Math.min(h, above); top = Math.max(8, r.top - hh - 6); pop.style.maxHeight = hh + 'px'; if (source) pop.style.height = hh + 'px'; }
        else pop.style.maxHeight = below + 'px';
      }
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      const close = (v) => { off(); pop.remove(); done(v); if (anchor.focus && document.contains(anchor)) { try { anchor.focus({ preventScroll: true }); } catch (_) { /* gone */ } } };
      const lst = pop.querySelector('[data-list]');
      const redraw = () => { const a = list(); hi = Math.min(hi, Math.max(0, a.length - 1)); lst.innerHTML = rows(a); };
      const pickAt = (i) => { const a = list(); if (a[i]) close(a[i].value); };
      pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pickAt(+b.dataset.i); });
      const inp = pop.querySelector('[data-q]');
      const dl = debounce(async (v) => { try { items = await source(v); } catch (_) { items = []; } if (!resolved) { hi = 0; redraw(); } }, 160);
      if (source) { lst.innerHTML = '<p class="pj-none">Loading</p>'; dl(''); }
      if (inp) { inp.addEventListener('input', () => { q = inp.value; hi = 0; if (source) dl(q); else redraw(); }); setTimeout(() => inp.focus(), 0); } else { pop.tabIndex = -1; setTimeout(() => pop.focus(), 0); }
      const key = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(undefined); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopPropagation();
          const n = list().length; if (!n) return;
          hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
          lst.querySelectorAll('.pj-opt').forEach((b, i) => b.classList.toggle('is-hi', i === hi));
          const c = lst.children[hi]; if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); pickAt(hi); }
      };
      const away = (e) => { if (!pop.contains(e.target)) close(undefined); };
      const off = () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away, true); removeEventListener('resize', onResize); };
      const onResize = () => close(undefined);
      document.addEventListener('keydown', key, true);
      setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
      addEventListener('resize', onResize);
      return;
    }
    const s = openSheet({ title: title || 'Choose', html, cls: 'pj-sheet--choose', onClose: () => done(undefined) });
    const lst = s.body.querySelector('[data-list]');
    const inp = s.body.querySelector('[data-q]');
    const redraw = () => { lst.innerHTML = rows(list()); };
    s.body.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { const a = list()[+b.dataset.i]; if (a) { done(a.value); s.close(); } } });
    const dl = debounce(async (v) => { try { items = await source(v); } catch (_) { items = []; } if (!resolved) { hi = -1; redraw(); } }, 160);
    if (source) { lst.innerHTML = '<p class="pj-none">Loading</p>'; dl(''); }
    if (inp) inp.addEventListener('input', () => { q = inp.value; hi = -1; if (source) dl(q); else redraw(); });
  });
}

/* ---------------------------------------------------------------- small utilities */
export const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.cancel = () => clearTimeout(t); return f; };
export const uid = () => 'tmp-' + Math.random().toString(36).slice(2, 10);
export function autosize(ta) { ta.style.height = '0px'; ta.style.height = ta.scrollHeight + 'px'; }
export const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High' };
export const STATUS = { open: 'To do', doing: 'In progress', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' };
export const COLOR_NAMES = ['leaf', 'sky', 'sun', 'dusk', 'terra', 'teal', 'slate'];

/** Ask for one line of text in a small dialog. Resolves to the text, or undefined when dismissed. */
export function askText({ title, value = '', label, action = 'Save', placeholder = '', multiline = false }) {
  return new Promise((resolve) => {
    let out;
    const field = multiline
      ? `<textarea class="pj-field" data-v rows="4" placeholder="${esc(placeholder)}" aria-label="${esc(label || title)}">${esc(value)}</textarea>`
      : `<input class="pj-field" data-v type="text" maxlength="300" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label || title)}" enterkeyhint="done" />`;
    const s = openSheet({ title, cls: 'pj-sheet--ask', html: `${label ? `<label class="pj-label">${esc(label)}</label>` : ''}${field}<div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="button" class="pj-btn pj-btn--primary" data-ok>${esc(action)}</button></div>`, onClose: () => resolve(out) });
    const f = s.body.querySelector('[data-v]');
    setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30);
    const ok = () => { const v = f.value.trim(); if (v) { out = v; s.close(); } };
    s.body.querySelector('[data-ok]').addEventListener('click', ok);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); ok(); } });
  });
}

// The on-screen keyboard: sheets end at its top edge (--pj-kb), never under it.
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const fit = () => document.documentElement.style.setProperty('--pj-kb', Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height)) + 'px');
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
})();

/* One shared tooltip for buttons that have only an icon. Each such button carries data-ui-tooltip="pj-tip"; the element shows the
   button's label under it after a short hover, at once on keyboard focus. Coarse pointers (phones) never show it. */
export function installTips() {
  if (document.getElementById('pj-tip')) return;
  const tip = document.createElement('div');
  tip.id = 'pj-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = 'Label';
  document.body.appendChild(tip);
  let timer = 0;
  let cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('is-on'); cur = null; };
  const show = (b) => {
    const text = (b.getAttribute('aria-label') || '').trim();
    if (!text || !document.contains(b)) return;
    tip.textContent = text;
    const r = b.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))) + 'px';
    const below = r.bottom + 8 + 28 < innerHeight;
    tip.style.top = Math.round(below ? r.bottom + 8 : r.top - 36) + 'px';
    tip.classList.add('is-on');
    cur = b;
  };
  const target = (e) => (e.target.closest ? e.target.closest('[data-ui-tooltip]') : null);
  document.addEventListener('mouseover', (e) => { const b = target(e); if (!b || b === cur) return; hide(); timer = setTimeout(() => show(b), 450); });
  document.addEventListener('mouseout', (e) => { const b = target(e); if (b && !b.contains(e.relatedTarget)) hide(); });
  document.addEventListener('focusin', (e) => { const b = target(e); if (b && document.documentElement.classList.contains('kbd')) show(b); });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  const mark = (root) => {
    if (!root || root.nodeType !== 1) return;
    const list = root.matches && root.matches('button[aria-label]') ? [root] : [];
    if (root.querySelectorAll) list.push(...root.querySelectorAll('button[aria-label]:not([data-ui-tooltip])'));
    for (const b of list) if (!(b.textContent || '').trim() && !b.hasAttribute('data-ui-tooltip')) b.setAttribute('data-ui-tooltip', 'pj-tip');
  };
  new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) mark(n); }).observe(document.body, { childList: true, subtree: true });
  mark(document.body);
}
