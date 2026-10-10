// Meetings: small shared helpers for the meeting pages (escape, icons, avatars, toast, fetch).
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const I = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>', videoOff: '<path d="M3 3l18 18"/><path d="M16 16H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1"/><path d="M10 6h4a2 2 0 0 1 2 2v3l5-3v10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>', micOff: '<path d="M3 3l18 18"/><path d="M9 9v2a3 3 0 0 0 5 2"/><path d="M15 10V6a3 3 0 0 0-6 0"/><path d="M5 11a7 7 0 0 0 11 5"/><path d="M19 11a7 7 0 0 1-.6 2.8"/><path d="M12 18v3"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/><path d="m9 10 3-3 3 3"/><path d="M12 7v6"/>', rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.8c1.8.8 3 2.6 3.5 5.2"/>',
  brain: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', leave: '<path d="M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-3a10 10 0 0 0-5 0v3l-3 1.5z"/>',
  pin: '<path d="M9 3h6l-1 6 4 3v2H6v-2l4-3z"/><path d="M12 14v7"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10"/><path d="M2 13h20"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>', chev: '<path d="m9 6 6 6-6 6"/>', chevl: '<path d="m15 6-6 6 6 6"/>', back: '<path d="M15 6l-6 6 6 6"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>', send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>', wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', notes: '<path d="M6 3h12v18H6z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h4"/>', play: '<path d="M8 5v14l11-7z"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7 6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.5L8 13"/>', remove: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5 2 0 3.6.8 4.8 2"/><path d="M16 15l5 5"/><path d="M21 15l-5 5"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3"/><path d="M17 10.5a2 2 0 1 0 0 3"/>', download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>', share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5"/><path d="m8.2 13.2 7.6 4.5"/>',
};
export const ic = (n, c = '') => `<svg class="h-i ${c}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

const COLORS = ['#5a7250', '#8a6b3a', '#4f6f86', '#8a4f5e', '#6b5a8a', '#3f7a6a', '#a0673f', '#5e6b3a', '#7a4f3a', '#3f5e8a', '#86714f', '#6a3f5e'];
export const hashColor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
export const initials = (n) => String(n || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
export const av = (name, cls = '') => `<span class="mt-av ${cls}" style="background:${hashColor(name)}">${esc(initials(name))}</span>`;

let tt;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('is-on');
  clearTimeout(tt); tt = setTimeout(() => el.classList.remove('is-on'), 3000);
}

export async function api(path, opts = {}) {
  const r = await fetch('/api/meet/' + path, { credentials: 'same-origin', ...opts, headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  let j = {};
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(j.message || 'Something went wrong. Try again.'); e.status = r.status; e.code = j.error; throw e; }
  return j;
}

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const roomLink = (id) => location.origin + '/meet/room/?m=' + id;
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast('Copy this link: ' + text); }
}

let _who;
/** The signed-in person, from the menu's saved copy or the nav route. */
export async function whoami() {
  if (_who) return _who;
  try { const s = JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null'); if (s && s.user && s.user.name) return (_who = s.user); } catch {}
  try { const r = await fetch('/api/hub/nav', { credentials: 'same-origin' }); const j = await r.json(); _who = j.user || {}; } catch { _who = {}; }
  return _who;
}

/** Drives the work a finished meeting needs (recording to Drive, transcript, notes). With an id: that meeting. Without: whichever is next. */
let pumping = false;
export async function pump(id, onStep) {
  if (pumping) return;
  pumping = true;
  try {
    for (let i = 0; i < 400; i++) {
      let r;
      try { r = await api(id ? 'meetings/' + id + '/pump' : 'meetings/pump', { method: 'POST', body: {} }); } catch { break; }
      if (onStep) onStep(r.state === 'uploading' ? 'Saving the recording to Google Drive, ' + r.progress + '.' : r.state === 'transcribing' ? 'Reading the recording.' : '');
      if (r.done) { if (!id && r.state !== 'idle') continue; break; }
      if (!r.ok) await new Promise((res) => setTimeout(res, 4000));
    }
  } finally { pumping = false; }
}
