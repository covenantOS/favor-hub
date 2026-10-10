/* Reminders and the morning email, on every hub page for people who use the Work Center.
   The bell in the header lists reminders with Open, Done and Later. Remind me sits on each open task in the partner drawer.
   The Morning email dialog (a chip on the Work Center, a link in the bell) holds each person's settings; admins set the rollout
   in the Work Center's settings. Reads and writes /api/work/reminders and /api/work/mail*. Nothing here goes to Blackbaud. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AS = new URLSearchParams(location.search).get('as') || '';
const ET = 'America/New_York';
const I = {
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', down: '<path d="m6 9 6 6 6-6"/>', send: '<path d="M21 3 3 11l7 3 3 7z"/><path d="m10 14 4-4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const ic = (n, cls) => `<svg class="h-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const send = (method, path, body) => api(path, { method, body: JSON.stringify(body || {}) });

/* ------------------------------------------------------------------ times (Eastern) */
const todayEt = () => new Date().toLocaleDateString('en-CA', { timeZone: ET });
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const nextWorkday = (ymd) => { let d = addDays(ymd, 1); while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1); return d; };
const nextMonday = (ymd) => { let d = addDays(ymd, 1); while (dow(d) !== 1) d = addDays(d, 1); return d; };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: ET });
const label = (iso) => { const d = dayOf(iso), t = todayEt(); return d === t ? clock(iso) : WD[dow(d)] + ' ' + clock(iso); };
function laterChoices() {
  const t = todayEt(), now = Date.now();
  const aft = new Date(); // 2:00 PM today, or two hours from now once it has passed
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hourCycle: 'h23' }).formatToParts(aft);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  return [
    ['hour', 'In 1 hour', clock(new Date(now + 3600000).toISOString())],
    ['afternoon', 'This afternoon', h >= 13 ? clock(new Date(now + 7200000).toISOString()) : '2:00 PM'],
    ['tomorrow', 'Tomorrow morning', WD[dow(nextWorkday(t))] + ' 9:00 AM'],
    ['nextweek', 'Next week', 'Mon 9:00 AM'],
  ];
}
void nextMonday;

/* ------------------------------------------------------------------ small pieces: toast, popover, dialog */
let toastEl = null, toastT = 0;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'wm-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-on'), 3200);
}
let popEl = null, popFor = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; } if (popFor) { popFor.setAttribute('aria-expanded', 'false'); popFor = null; } }
function openPop(anchor, html, opts = {}) {
  closePop();
  popEl = document.createElement('div');
  popEl.className = 'wm-pop';
  popEl.setAttribute('role', 'dialog');
  popEl.setAttribute('aria-label', opts.label || 'Reminders');
  popEl.innerHTML = html;
  document.body.appendChild(popEl);
  const r = anchor.getBoundingClientRect();
  const w = popEl.offsetWidth;
  popEl.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, opts.alignLeft ? r.left : r.right - w)) + 'px';
  popEl.style.top = Math.min(r.bottom + 10, window.innerHeight - 120) + 'px';
  if (anchor.setAttribute) { anchor.setAttribute('aria-expanded', 'true'); popFor = anchor; }
  return popEl;
}
document.addEventListener('mousedown', (e) => { if (popEl && !popEl.contains(e.target) && !(popFor && popFor.contains(e.target))) closePop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popEl) { const f = popFor; closePop(); if (f && f.focus) f.focus(); } });

let dlgEl = null, dlgBack = null;
function closeDlg() { if (!dlgEl) return; dlgEl.remove(); dlgBack.remove(); dlgEl = dlgBack = null; document.documentElement.classList.remove('wm-locked'); if (closeDlg.ret && closeDlg.ret.focus) { try { closeDlg.ret.focus(); } catch (_) {} } }
function openDlg(html, cls) {
  closeDlg(); closePop();
  closeDlg.ret = document.activeElement;
  dlgBack = document.createElement('div'); dlgBack.className = 'wm-scrim'; dlgBack.addEventListener('click', closeDlg);
  dlgEl = document.createElement('div'); dlgEl.className = 'wm-dlg' + (cls ? ' ' + cls : ''); dlgEl.setAttribute('role', 'dialog'); dlgEl.setAttribute('aria-modal', 'true');
  dlgEl.innerHTML = html;
  document.body.append(dlgBack, dlgEl);
  const f = $('[autofocus], button', dlgEl); if (f) f.focus();
  return dlgEl;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dlgEl && !popEl) { e.stopPropagation(); closeDlg(); }
  if (e.key === 'Tab' && dlgEl) {
    const f = $$('button, input, a[href], select, textarea', dlgEl).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

/* ------------------------------------------------------------------ reminders: the bell */
const R = { rows: [], count: 0, now: 0, loaded: false, by: new Map() };
const bellBtn = () => document.getElementById('wm-bell');
function paintBadge() {
  const b = bellBtn(); if (!b) return;
  const em = $('em', b); em.textContent = R.count ? String(R.count) : '';
  b.setAttribute('aria-label', R.count ? 'Reminders, ' + R.count + ' due' : 'Reminders');
}
function take(d) {
  R.rows = d.rows || []; R.count = d.count || 0; R.now = d.now || 0; R.loaded = true;
  R.by = new Map(R.rows.filter((r) => r.ref_id && r.kind === 'task').map((r) => [String(r.ref_id), r]));
  paintBadge(); decorate();
  if (popEl && popFor === bellBtn()) paintBell();
}
async function refresh() { try { take(await api('/api/work/reminders')); } catch (_) { /* the bell keeps what it had */ } }

function bellHTML() {
  const rows = R.rows;
  const has = window.WCPrep && window.WCPrep.open;
  const list = rows.length ? rows.map((r) => `<div class="wm-rem" data-rid="${esc(r.id)}"><time class="${r.bucket === 'now' ? 'is-now' : ''}">${r.bucket === 'now' ? 'Now' : r.bucket === 'tomorrow' ? 'Tomorrow' : esc(label(r.at))}</time>
      <div><b>${esc(r.title)}</b>${r.note ? `<span>${esc(r.note)}</span>` : ''}
        <div class="wm-remacts">${r.cid ? `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-wm-open="${esc(r.cid)}">${has ? 'Prep' : 'Open'}</button>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-done="${esc(r.id)}">Done</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-later="${esc(r.id)}" aria-haspopup="menu">Later${ic('down')}</button></div></div></div>`).join('')
    : `<div class="wm-empty"><b>Nothing to remember</b>Press the bell on a task in a partner's page to be reminded.</div>`;
  return `<h4><span>Reminders${R.count ? `<small>${R.count} due today</small>` : ''}</span><button type="button" class="wm-x" data-wm-closepop aria-label="Close">${ic('x')}</button></h4>
    <div>${list}</div><div class="wm-foot"><span>Also in the morning email</span><button type="button" data-wm-mail>Morning email</button></div>`;
}
function paintBell() { if (popEl) popEl.innerHTML = bellHTML(); }

async function laterMenu(anchor, id) {
  $$('.wm-menu--float', popEl || document).forEach((m) => m.remove());
  const m = document.createElement('div'); m.className = 'wm-menu wm-menu--float'; m.setAttribute('role', 'menu');
  m.innerHTML = laterChoices().map(([k, l, t]) => `<button type="button" role="menuitem" data-wm-laterset="${k}" data-id="${esc(id)}">${esc(l)}<small>${esc(t)}</small></button>`).join('');
  anchor.parentElement.appendChild(m);
}

/* ------------------------------------------------------------------ Remind me on a drawer task */
function partnerIdHere() {
  const a = $('.pp-drawer a[data-pp-full]') || $('a[data-pp-full]');
  const m = a && (a.getAttribute('href') || '').match(/\/work\/partner\/(\d+)/);
  if (m) return m[1];
  const p = location.pathname.match(/^\/work\/partner\/(\d+)/);
  return p ? p[1] : '';
}
function decorate() {
  $$('.pp-task:not(.pp-task--ro)').forEach((row) => {
    const check = $('[data-pp-done]', row); if (!check) return;
    const id = check.dataset.ppDone;
    if (!/^\d+$/.test(id)) return;
    let b = $('.pp-remind', row);
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.className = 'pp-remind'; b.dataset.wmRemind = id;
      b.innerHTML = ic('bell');
      row.classList.add('wm-task');
      const chip = $('.pp-datechip', row);
      row.insertBefore(b, chip ? chip.nextSibling : null);
    }
    const set = R.by.get(id);
    b.classList.toggle('is-set', !!set);
    b.setAttribute('aria-label', set ? 'Reminder set for ' + label(set.at) + '. Change it' : 'Remind me about this task');
    b.title = set ? 'Reminder set for ' + label(set.at) : 'Remind me';
  });
}
let decoT = 0;
new MutationObserver(() => { cancelAnimationFrame(decoT); decoT = requestAnimationFrame(decorate); }).observe(document.body, { childList: true, subtree: true });

function remindPop(anchor, id) {
  const row = anchor.closest('.pp-task');
  const what = row ? ($('.pp-taskopen', row) || $('.pp-task__what b', row) || {}).textContent || 'Task' : 'Task';
  const chip = row && $('.pp-datechip', row) ? $('.pp-datechip', row).textContent.trim() : '';
  const set = R.by.get(id);
  const p = openPop(anchor, `<h4><span>Remind me<small>${esc(what.slice(0, 70))}</small></span><button type="button" class="wm-x" data-wm-closepop aria-label="Close">${ic('x')}</button></h4>
    <div class="wm-menu">${laterChoices().map(([k, l, t]) => `<button type="button" data-wm-set="${k}" data-id="${esc(id)}">${esc(l)}<small>${esc(t)}</small></button>`).join('')}</div>
    <div class="wm-dt"><input type="date" data-wm-date min="${todayEt()}" aria-label="Pick a day" /><input type="time" data-wm-time value="09:00" aria-label="Time" /><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-setdate data-id="${esc(id)}">Set</button></div>
    <div class="wm-foot"><span>A bell in the hub and a line in the morning email</span>${set ? `<button type="button" data-wm-clear="${esc(set.id)}">Remove</button>` : ''}</div>`, { label: 'Remind me', alignLeft: false });
  p.dataset.what = what; p.dataset.note = chip; p.dataset.cid = partnerIdHere();
}

async function setReminder(id, when) {
  const p = popEl; if (!p) return;
  const what = p.dataset.what || 'Task', note = p.dataset.note || '', cid = p.dataset.cid || '';
  closePop();
  try {
    const old = R.by.get(id);
    const out = await send('POST', '/api/work/reminders', { kind: 'task', ref_id: id, cid, title: what, note: note ? 'Task, ' + note.replace(/^Due /, 'due ') : 'Task', when });
    if (old) await send('PATCH', '/api/work/reminders/' + encodeURIComponent(old.id), { action: 'done' }).catch(() => {});
    await refresh();
    const mine = R.by.get(id);
    toast(mine ? 'Reminder set for ' + label(mine.at) : 'Reminder set');
    void out;
  } catch (e) { toast(e.message); }
}

/* ------------------------------------------------------------------ the morning email dialog */
const M = { v: null, saving: 0, previewT: 0 };
const SEND = [['7:30', '7:30 AM'], ['8:00', '8:00 AM'], ['off', 'Off']];
const fromLine = () => '&lt;noreply@mail.favorintl.org&gt;';
async function openMail() {
  let v;
  try { v = await api('/api/work/mail'); } catch (e) { toast(e.message); return; }
  M.v = v;
  const d = openDlg(`<div class="wm-dlg__head"><div><h2>Morning email</h2><p id="wm-when"></p></div><button type="button" class="wm-x" data-wm-closedlg aria-label="Close">${ic('x')}</button></div>
    <div class="wm-dlg__body"><div class="wm-mail">
      <div class="wm-client"><div class="wm-client__head"><div class="subj" id="wm-subj">Building your email…</div><div><b>Favor International</b> ${fromLine()}</div><div>To: ${esc(v.name)} &middot; ${esc(v.email)}</div></div>
        <iframe class="wm-frame" id="wm-frame" title="Preview of your morning email" sandbox="allow-popups allow-popups-to-escape-sandbox"></iframe></div>
      <div class="wm-setts"><h3>What it sends</h3><div id="wm-secs" class="wm-secs"></div><h3>When</h3><div class="wm-seg" id="wm-time" role="group" aria-label="When"></div>
        <label class="wm-check">Skip days with nothing due<input type="checkbox" class="wm-switch" id="wm-skip" /></label>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-test>${ic('send')}Send me a test</button><div class="wm-note" id="wm-live" hidden></div></div>
    </div></div>`, 'wm-dlg--wide');
  paintMail(d);
  loadPreview();
}
function paintMail(d) {
  const v = M.v, p = v.prefs;
  $('#wm-when', d).textContent = p.send_time === 'off' ? 'Off. You will not get it until you turn it on.' : 'Weekdays at ' + (p.send_time === '8:00' ? '8:00' : '7:30') + ' AM to ' + v.email;
  $('#wm-secs', d).innerHTML = v.sections.map((s) => `<label class="wm-check">${esc(s.label)}<input type="checkbox" class="wm-switch" data-wm-sec="${s.key}" ${p.sections[s.key] ? 'checked' : ''} /></label>`).join('');
  $('#wm-time', d).innerHTML = SEND.map(([k, l]) => `<button type="button" data-wm-sendtime="${k}" class="${p.send_time === k ? 'is-on' : ''}" aria-pressed="${p.send_time === k}">${l}</button>`).join('');
  $('#wm-skip', d).checked = !!p.skip_empty;
  const n = $('#wm-live', d);
  if (v.group && !v.live) { n.hidden = false; n.className = 'wm-note'; n.textContent = v.from ? v.groupLabel + ' start getting this email on ' + new Date(v.from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }) + '. Until then nothing is sent to you. Send me a test shows how it will look.' : v.groupLabel + ' are not on the morning email yet. Send me a test shows how it will look.'; }
  else if (v.group && v.live) { n.hidden = false; n.className = 'wm-note wm-note--ok'; n.textContent = 'You are on the morning email. It skips weekends.'; }
  else n.hidden = true;
}
async function savePrefs(patch) {
  const d = dlgEl; if (!d) return;
  const p = M.v.prefs;
  if (patch.sections) Object.assign(p.sections, patch.sections);
  if (patch.send_time) p.send_time = patch.send_time;
  if (patch.skip_empty !== undefined) p.skip_empty = patch.skip_empty;
  paintMail(d);
  try { M.v = await send('PUT', '/api/work/mail', { sections: p.sections, send_time: p.send_time, skip_empty: p.skip_empty }); if (dlgEl) paintMail(dlgEl); } catch (e) { toast(e.message); }
  clearTimeout(M.previewT); M.previewT = setTimeout(loadPreview, 250);
  const chip = $('[data-wm-mailchip] b'); if (chip) chip.textContent = chipText();
}
async function loadPreview() {
  const d = dlgEl; if (!d) return;
  try {
    const pv = await api('/api/work/mail/preview');
    if (!dlgEl) return;
    $('#wm-subj', dlgEl).textContent = pv.subject;
    const html = pv.html.replace('<html>', '<html><head><base target="_blank"></head>');
    $('#wm-frame', dlgEl).srcdoc = html;
  } catch (e) { if (dlgEl) $('#wm-subj', dlgEl).textContent = 'The preview did not load. ' + e.message; }
}
async function sendTest(btn) {
  btn.disabled = true; const was = btn.innerHTML; btn.textContent = 'Sending…';
  try { const out = await send('POST', '/api/work/mail/test', {}); toast('Sent to ' + out.to + '. It can take a minute.'); } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = was;
}
const chipText = () => (M.v ? (M.v.prefs.send_time === 'off' ? 'Off' : M.v.prefs.send_time === '8:00' ? '8:00 AM' : '7:30 AM') : '');

/* The Morning email chip in the Work Center's intro row. The page redraws its intro, so the chip is added again each time. */
function placeChip() {
  const row = $('#wc-root .wc-intro .wc-chips'); if (!row || $('[data-wm-mailchip]', row)) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'wc-pill wc-pill--btn'; b.dataset.wmMailchip = '';
  b.innerHTML = `${ic('mail')}Morning email <b>${esc(chipText())}</b>`;
  const gear = $('[data-settings]', row);
  row.insertBefore(b, gear || null);
}
let chipP = null;
async function loadChip() { if (M.v || chipP) return; chipP = 1; try { M.v = await api('/api/work/mail'); placeChip(); const c = $('[data-wm-mailchip] b'); if (c) c.textContent = chipText(); } catch (_) { /* no chip */ } }

/* ------------------------------------------------------------------ rollout, in Work Center settings (admins) */
async function placeRollout() {
  const dlg = $('#layer .wc-dlg'); if (!dlg || $('[data-wm-rollout]', dlg)) return;
  const h = $('h2', dlg); if (!h || !/Work Center settings/.test(h.textContent)) return;
  const body = $('.wc-dlg__body', dlg); if (!body) return;
  let v;
  try { v = await api('/api/work/mail/rollout'); } catch (_) { return; }
  if ($('[data-wm-rollout]', dlg)) return;
  const f = document.createElement('div'); f.className = 'wc-field'; f.dataset.wmRollout = '';
  const draw = () => {
    f.innerHTML = `<span class="lab">Morning email rollout</span><div class="wm-roll">${v.groups.map((g) => `<div class="wm-roll__row"><div><b>${esc(g.label)}</b><span>${g.people.length ? esc(g.people.join(', ')) : 'No one listed'}</span></div>
      <div class="wm-roll__ctl"><span>${g.from ? (g.from <= todayEt() ? 'Sending since ' : 'Starts ') + esc(new Date(g.from + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })) : 'Off'}</span>
        <input type="date" value="${esc(g.from || '')}" data-wm-roll="${esc(g.key)}" aria-label="First day for ${esc(g.label)}" /><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-rolloff="${esc(g.key)}">Turn off</button></div></div>`).join('')}</div>
      <small>Each group gets the email from the day set here, on weekdays, after the dry run to Will. People can still turn their own off.</small>`;
  };
  draw();
  body.appendChild(f);
  f.addEventListener('change', async (e) => { const i = e.target.closest('[data-wm-roll]'); if (!i || !i.value) return; try { v = await send('PUT', '/api/work/mail/rollout', { [i.dataset.wmRoll]: i.value }); draw(); } catch (err) { toast(err.message); } });
  f.addEventListener('click', async (e) => { const b = e.target.closest('[data-wm-rolloff]'); if (!b) return; try { v = await send('PUT', '/api/work/mail/rollout', { [b.dataset.wmRolloff]: null }); draw(); } catch (err) { toast(err.message); } });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const t = e.target.closest ? e.target.closest('button, a') : null;
  if (!t) return;
  if (t.id === 'wm-bell') {
    if (popEl && popFor === t) { closePop(); return; }
    openPop(t, bellHTML()); if (!R.loaded) refresh(); else refresh();
    return;
  }
  const d = t.dataset;
  if (t.hasAttribute('data-wm-closepop')) { const f = popFor; closePop(); if (f && f.focus) f.focus(); return; }
  if (t.hasAttribute('data-wm-closedlg')) { closeDlg(); return; }
  if (t.hasAttribute('data-wm-mail') || t.hasAttribute('data-wm-mailchip')) { openMail(); return; }
  if (d.wmOpen) {
    const id = d.wmOpen; closePop();
    if (window.WCPrep && window.WCPrep.open) window.WCPrep.open(id); else if (window.FavorPartner) window.FavorPartner.open(id); else location.href = '/work/partner/' + id;
    return;
  }
  if (d.wmDone) { try { take(await send('PATCH', '/api/work/reminders/' + encodeURIComponent(d.wmDone), { action: 'done' })); } catch (err) { toast(err.message); } return; }
  if (d.wmLater) { const open = $('.wm-menu--float', popEl); if (open) { open.remove(); return; } laterMenu(t, d.wmLater); return; }
  if (d.wmLaterset) { try { take(await send('PATCH', '/api/work/reminders/' + encodeURIComponent(d.id), { action: 'later', when: { code: d.wmLaterset } })); toast('Moved to later'); } catch (err) { toast(err.message); } return; }
  if (d.wmRemind) { if (popEl && popFor === t) { closePop(); return; } remindPop(t, d.wmRemind); return; }
  if (d.wmSet) { setReminder(d.id, { code: d.wmSet }); return; }
  if (t.hasAttribute('data-wm-setdate')) { const dt = $('[data-wm-date]', popEl).value, tm = $('[data-wm-time]', popEl).value || '09:00'; if (!dt) { toast('Pick a day first.'); return; } setReminder(d.id, { date: dt, time: tm }); return; }
  if (d.wmClear) { try { take(await send('PATCH', '/api/work/reminders/' + encodeURIComponent(d.wmClear), { action: 'done' })); closePop(); toast('Reminder removed'); } catch (err) { toast(err.message); } return; }
  if (d.wmSec !== undefined) return;
  if (d.wmSendtime) { savePrefs({ send_time: d.wmSendtime }); return; }
  if (t.hasAttribute('data-wm-test')) { sendTest(t); return; }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.wmSec) savePrefs({ sections: { [t.dataset.wmSec]: t.checked } });
  if (t.id === 'wm-skip') savePrefs({ skip_empty: t.checked });
});

/* ------------------------------------------------------------------ start */
function start() {
  const b = bellBtn(); if (!b) return;
  if (!b.hidden) { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 90000); }
}
const b0 = bellBtn();
if (b0) {
  if (b0.hidden) {
    const mo = new MutationObserver(() => { if (!b0.hidden) { mo.disconnect(); start(); } });
    mo.observe(b0, { attributes: true, attributeFilter: ['hidden'] });
  } else start();
}
// The Work Center page: the chip beside the other intro pills, the rollout in settings, and a link that opens the dialog.
if (document.getElementById('wc-root')) {
  new MutationObserver(() => { if ($('#wc-root .wc-intro .wc-chips') && !$('[data-wm-mailchip]')) { if (M.v) placeChip(); else loadChip(); } if ($('#layer .wc-dlg')) placeRollout(); })
    .observe(document.body, { childList: true, subtree: true });
  if (new URLSearchParams(location.search).get('morning') === '1') setTimeout(openMail, 900);
}
window.WCBell = { openMail, refresh };
})();
