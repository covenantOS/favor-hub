// Public booking page (/meet/with/). Standalone: plain fetch to /api/book/, no hub scripts.
const root = document.getElementById('bk-root');
const q = new URLSearchParams(location.search);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MY_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch { return 'America/New_York'; } })();
const EAST = 'America/New_York';
const S = { u: q.get('u') || '', owner: '', types: [], type: null, tz: MY_TZ, y: 0, m: 0, slots: [], day: '', time: '', move: null, busy: false, msg: '' };

async function call(path, opts) {
  const r = await fetch('/api/book/' + path, opts ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts) } : undefined);
  let j = {};
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error(j.message || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
  return j;
}

const dayKey = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const fmtT = (iso, tz) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
const fmtFull = (iso, tz) => new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const zoneName = (tz, iso) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date(iso || Date.now())).find((p) => p.type === 'timeZoneName').value; } catch { return tz; } };
const whereText = (t) => (t.location === 'in_person' ? 'In person' + (t.place ? ', ' + t.place : '') : t.location === 'phone' ? 'Phone call' : 'Video call in FavorOS');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fail(msg) { root.innerHTML = `<div class="bk-card"><h1 class="bk-h1">Booking page</h1><p class="bk-err">${esc(msg)}</p></div>`; }

// ---------------------------------------------------------------- picker (shared by booking and moving)
async function loadSlots() {
  const first = Date.UTC(S.y, S.m, 1) - 12 * 3600e3;
  const from = new Date(Math.max(Date.now(), first)).toISOString();
  const r = await call(`slots?u=${encodeURIComponent(S.type.handle)}&t=${encodeURIComponent(S.type.slug)}&from=${encodeURIComponent(from)}&days=31`);
  S.slots = r.slots || [];
}

function pickerHtml() {
  const days = new Set(S.slots.map((s) => dayKey(s, S.tz)));
  const first = new Date(Date.UTC(S.y, S.m, 1)).getUTCDay();
  const n = new Date(Date.UTC(S.y, S.m + 1, 0)).getUTCDate();
  let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => `<div class="bk-dow" aria-hidden="true">${d}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div></div>';
  for (let d = 1; d <= n; d++) {
    const k = `${S.y}-${String(S.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const open = days.has(k);
    cells += `<button type="button" class="bk-day${open ? ' is-open' : ''}${S.day === k ? ' is-sel' : ''}" data-day="${k}" ${open ? '' : 'disabled'} aria-label="${MONTHS[S.m]} ${d}${open ? '' : ', no times'}">${d}</button>`;
  }
  const times = S.slots.filter((s) => dayKey(s, S.tz) === S.day);
  const now = new Date();
  const atNow = S.y === now.getFullYear() && S.m === now.getMonth();
  const other = S.tz === EAST ? MY_TZ : EAST;
  return `<div class="bk-mon"><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="prev" ${atNow ? 'disabled' : ''} aria-label="Previous month">Back</button><b aria-live="polite">${MONTHS[S.m]} ${S.y}</b><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="next" aria-label="Next month">Next</button></div>
    <div class="bk-cal" role="group" aria-label="Pick a day">${cells}</div>
    <p class="bk-muted">Times are in ${esc(zoneName(S.tz))}.${other !== S.tz && MY_TZ !== EAST ? ` <button type="button" class="bk-back" style="min-height:0;padding:0" data-act="tz">Show ${other === EAST ? 'Eastern' : 'my'} time</button>` : ''}</p>
    ${S.day ? `<div class="bk-times" role="group" aria-label="Pick a time">${times.map((s) => `<button type="button" class="bk-time${S.time === s ? ' is-sel' : ''}" data-time="${esc(s)}">${esc(fmtT(s, S.tz))}</button>`).join('') || '<p class="bk-muted">No open times that day.</p>'}</div>` : '<p class="bk-muted">Pick a day with open times.</p>'}`;
}

async function startPicker() {
  const t = new Date();
  S.y = t.getFullYear(); S.m = t.getMonth(); S.day = ''; S.time = '';
  try { await loadSlots(); } catch (e) { return fail(e.message); }
  if (!S.slots.length) {
    // Nothing this month: look at the next one before saying there is nothing.
    S.m += 1; if (S.m > 11) { S.m = 0; S.y += 1; }
    try { await loadSlots(); } catch { /* keep going */ }
  }
  S.view();
}

async function goMonth(d) {
  S.m += d; if (S.m > 11) { S.m = 0; S.y += 1; } if (S.m < 0) { S.m = 11; S.y -= 1; }
  S.day = ''; S.time = '';
  try { await loadSlots(); } catch (e) { S.msg = e.message; }
  S.view();
}

function onPickerClick(e) {
  const b = e.target.closest('button'); if (!b) return false;
  if (b.dataset.day) { S.day = b.dataset.day; S.time = ''; S.view(); return true; }
  if (b.dataset.time) { S.time = b.dataset.time; S.next(); return true; }
  if (b.dataset.act === 'prev') { goMonth(-1); return true; }
  if (b.dataset.act === 'next') { goMonth(1); return true; }
  if (b.dataset.act === 'tz') { S.tz = S.tz === EAST ? MY_TZ : EAST; S.day = ''; S.view(); return true; }
  return false;
}

// ---------------------------------------------------------------- booking flow
function chooseView() {
  S.view = chooseView; S.next = null;
  root.innerHTML = `<h1 class="bk-h1">Book a time with ${esc(S.owner)}</h1><p class="bk-sub">Pick what you would like to meet about.</p><ul class="bk-list">${S.types.map((t, i) => `<li><button type="button" class="bk-type" data-i="${i}"><b>${esc(t.title)}</b><span class="bk-meta">${t.durationMin} min, ${esc(whereText(t))}</span>${t.about ? `<span class="bk-meta">${esc(t.about)}</span>` : ''}</button></li>`).join('')}</ul>`;
}

function pickView() {
  S.view = pickView; S.next = formView;
  const t = S.type;
  root.innerHTML = `${S.types.length > 1 ? '<button type="button" class="bk-back" data-act="types">All meeting types</button>' : ''}<h1 class="bk-h1">${esc(t.title)}</h1><p class="bk-sub">${esc(S.owner)}, ${t.durationMin} min, ${esc(whereText(t))}</p>${t.about ? `<p>${esc(t.about)}</p>` : ''}${S.msg ? `<p class="bk-err" role="alert">${esc(S.msg)}</p>` : ''}<div class="bk-card">${pickerHtml()}</div>`;
  S.msg = '';
}

function formView() {
  const t = S.type;
  const phone = t.location === 'phone';
  root.innerHTML = `<button type="button" class="bk-back" data-act="times">Change time</button><h1 class="bk-h1">${esc(t.title)}</h1>
    <div class="bk-ok"><b>${esc(fmtFull(S.time, S.tz))}</b><br><span class="bk-muted">${esc(zoneName(S.tz, S.time))}, ${t.durationMin} min, ${esc(whereText(t))}</span></div>
    <form id="bk-form" class="bk-card" novalidate>
      <div class="bk-field"><label for="b-name">Your name</label><input class="bk-in" id="b-name" autocomplete="name" required></div>
      <div class="bk-field"><label for="b-email">Email</label><input class="bk-in" id="b-email" type="email" autocomplete="email" inputmode="email" required></div>
      <div class="bk-field"><label for="b-phone">Phone${phone ? '' : ' (optional)'}</label><input class="bk-in" id="b-phone" type="tel" autocomplete="tel" inputmode="tel" ${phone ? 'required' : ''}></div>
      ${(t.questions || []).map((x, i) => `<div class="bk-field"><label for="b-q${i}">${esc(x.q)}${x.required ? '' : ' (optional)'}</label><textarea class="bk-in" id="b-q${i}" data-q="${i}" ${x.required ? 'required' : ''}></textarea></div>`).join('')}
      <div class="bk-hp" aria-hidden="true"><label>Website<input name="website" id="b-web" tabindex="-1" autocomplete="off"></label></div>
      <p class="bk-err" id="b-err" role="alert" hidden></p>
      <button class="bk-btn bk-btn--block" type="submit" id="b-go">Book</button>
    </form>`;
  document.getElementById('b-name').focus();
}

async function submitBook(e) {
  e.preventDefault();
  if (S.busy) return;
  const t = S.type, err = document.getElementById('b-err');
  const v = (id) => document.getElementById(id).value.trim();
  const answers = (t.questions || []).map((_, i) => v('b-q' + i));
  const bad = !v('b-name') ? 'Enter your name.' : !/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(v('b-email')) ? 'Enter a valid email address.' : t.location === 'phone' && !v('b-phone') ? 'Enter a phone number so we can call you.' : (t.questions || []).findIndex((x, i) => x.required && !answers[i]) >= 0 ? 'Answer the required questions.' : '';
  if (bad) { err.textContent = bad; err.hidden = false; return; }
  S.busy = true; const go = document.getElementById('b-go'); go.disabled = true; go.textContent = 'Booking';
  try {
    const r = await call('book', { u: t.handle, t: t.slug, startsAt: S.time, name: v('b-name'), email: v('b-email'), phone: v('b-phone'), answers, tz: MY_TZ, website: document.getElementById('b-web').value });
    doneView(r, v('b-email'), 'booked');
  } catch (er) {
    S.busy = false;
    if (er.status === 409) { S.msg = er.message || 'That time was just taken. Pick another.'; S.time = ''; try { await loadSlots(); } catch { /* shown below */ } pickView(); return; }
    err.textContent = er.message; err.hidden = false; go.disabled = false; go.textContent = 'Book';
  }
  S.busy = false;
}

const gcal = (b, t) => {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(`${b.title || t.title} with ${b.owner || S.owner}`) + '&dates=' + f(b.startsAt) + '/' + f(b.endsAt) + '&details=' + encodeURIComponent(b.joinUrl ? 'Join: ' + b.joinUrl : '') + '&location=' + encodeURIComponent(b.joinUrl || b.place || '');
};

function doneView(r, email, kind) {
  S.view = () => {}; S.next = null;
  const b = r.booking, t = S.type;
  const where = b.location === 'video' ? (b.joinUrl ? `<p><b>Where to join</b><br><a href="${esc(b.joinUrl)}">${esc(b.joinUrl)}</a></p>` : '') : b.location === 'phone' ? '<p><b>Where</b><br>We will call you at the number you gave.</p>' : `<p><b>Where</b><br>${esc(b.place || 'In person')}</p>`;
  root.innerHTML = `<h1 class="bk-h1">${kind === 'moved' ? 'Your booking moved' : 'You are booked'}</h1>
    <div class="bk-ok"><b>${esc(b.title || t.title)} with ${esc(b.owner || S.owner)}</b><br>${esc(fmtFull(b.startsAt, S.tz))}<br><span class="bk-muted">${esc(zoneName(S.tz, b.startsAt))}</span></div>
    ${where}
    <p>A confirmation is on its way to ${esc(email)} with a calendar file.</p>
    <div class="bk-row"><a class="bk-btn" href="${esc(gcal(b, t))}" target="_blank" rel="noopener">Add to Google Calendar</a>${r.manageUrl ? `<a class="bk-btn bk-btn--ghost" href="${esc(r.manageUrl)}">Change or cancel</a>` : ''}</div>`;
  window.scrollTo(0, 0);
}

root.addEventListener('click', (e) => {
  if (S.manage) return manageClick(e);
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('bk-type')) { S.type = S.types[+b.dataset.i]; S.view = pickView; history.replaceState(null, '', '?u=' + encodeURIComponent(S.u) + '&t=' + encodeURIComponent(S.type.slug)); startPicker().then(() => {}); return; }
  if (b.dataset.act === 'types') { history.replaceState(null, '', '?u=' + encodeURIComponent(S.u)); chooseView(); return; }
  if (b.dataset.act === 'times') { S.time = ''; pickView(); return; }
  onPickerClick(e);
});
root.addEventListener('submit', (e) => { if (e.target.id === 'bk-form') submitBook(e); });

// ---------------------------------------------------------------- manage mode
function manageView() {
  S.view = manageView; S.next = null;
  const M = S.manage, bk = M.booking;
  if (M.moving) {
    root.innerHTML = `<button type="button" class="bk-back" data-act="mback">Back</button><h1 class="bk-h1">Pick another time</h1><p class="bk-sub">${esc(S.type.title)} with ${esc(S.owner)}, ${S.type.durationMin} min</p>${S.msg ? `<p class="bk-err" role="alert">${esc(S.msg)}</p>` : ''}<div class="bk-card">${pickerHtml()}</div>`;
    S.msg = '';
    return;
  }
  const head = `<h1 class="bk-h1">${esc(S.type.title)} with ${esc(S.owner)}</h1><div class="bk-ok"><b>${esc(fmtFull(bk.startsAt, MY_TZ))}</b><br><span class="bk-muted">${esc(zoneName(MY_TZ, bk.startsAt))}, ${S.type.durationMin} min, ${esc(whereText(S.type))}</span></div>`;
  if (bk.status !== 'booked') { root.innerHTML = head + '<p>This booking was cancelled.</p>'; return; }
  if (M.past) { root.innerHTML = head + '<p>This meeting has already started, so it cannot be changed here.</p>'; return; }
  root.innerHTML = head + `${S.msg ? `<p class="bk-err" role="alert">${esc(S.msg)}</p>` : ''}<div class="bk-card"><div class="bk-row"><button type="button" class="bk-btn" data-act="move">Pick another time</button><button type="button" class="bk-btn bk-btn--danger" data-act="cancelopen">Cancel booking</button></div>
    <div id="bk-cx" hidden style="margin-top:14px"><div class="bk-field"><label for="cx-why">Reason (optional)</label><textarea class="bk-in" id="cx-why" maxlength="300"></textarea></div><button type="button" class="bk-btn bk-btn--danger" data-act="cancelgo">Cancel this booking</button></div></div>`;
  S.msg = '';
}

async function manageClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const M = S.manage, a = b.dataset.act;
  if (a === 'move') { M.moving = true; await startPicker(); return; }
  if (a === 'mback') { M.moving = false; manageView(); return; }
  if (a === 'cancelopen') { const x = document.getElementById('bk-cx'); x.hidden = false; document.getElementById('cx-why').focus(); return; }
  if (a === 'cancelgo') {
    b.disabled = true;
    try { await call('manage', { b: M.id, k: M.key, action: 'cancel', reason: document.getElementById('cx-why').value.trim() }); M.booking.status = 'cancelled'; manageView(); } catch (er) { S.msg = er.message; manageView(); }
    return;
  }
  if (b.dataset.time) {
    S.time = b.dataset.time;
    if (S.busy) return; S.busy = true;
    try {
      const r = await call('manage', { b: M.id, k: M.key, action: 'move', startsAt: S.time });
      M.booking.startsAt = r.startsAt; M.booking.endsAt = r.endsAt; M.moving = false; S.busy = false;
      S.view = manageView; manageView();
      root.insertAdjacentHTML('afterbegin', '<div class="bk-ok" role="status">Your booking moved. A new confirmation with a calendar file is on its way.</div>');
    } catch (er) {
      S.busy = false; S.msg = er.message; S.time = '';
      try { await loadSlots(); } catch { /* shown */ }
      manageView();
    }
    return;
  }
  onPickerClick(e);
}

// ---------------------------------------------------------------- start
(async () => {
  try {
    if (q.get('b') && q.get('k')) {
      const r = await call(`manage?b=${encodeURIComponent(q.get('b'))}&k=${encodeURIComponent(q.get('k'))}`);
      S.type = r.type; S.owner = (r.owner && r.owner.name) || ''; S.u = r.type.handle;
      S.manage = { id: q.get('b'), key: q.get('k'), booking: r.booking, past: r.past, moving: false };
      document.title = 'Your booking - Favor International';
      manageView();
      return;
    }
    if (!S.u) return fail('This booking link is missing a name. Ask for the link again.');
    const r = await call('page?u=' + encodeURIComponent(S.u));
    S.owner = r.owner.name; S.types = r.types || [];
    document.title = 'Book a time with ' + S.owner + ' - Favor International';
    const want = q.get('t') ? S.types.find((t) => t.slug === q.get('t')) : S.types.length === 1 ? S.types[0] : null;
    if (want) { S.type = want; S.view = pickView; await startPicker(); } else chooseView();
  } catch (e) { fail(e.message); }
})();
