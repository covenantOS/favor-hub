// Meetings: the owner's booking page setup (/meet/booking/). Types, working hours, upcoming bookings.
import { $, $$, esc, api, toast, copy, confirmCard, fmtDay, fmtTime } from './ui.js';

const root = $('#bk-root');
const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const ZNAME = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' };
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const LENGTHS = [15, 20, 30, 45, 60, 90];
const S = { handle: '', types: [], bookings: [], prefs: null, google: null, open: null };

const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const mins = (v) => { const [h, m] = String(v || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : NaN; };
const zoneOpts = (cur) => { const l = ZONES.includes(cur) || !cur ? ZONES : [cur, ...ZONES]; return l.map((z) => `<option value="${esc(z)}"${z === cur ? ' selected' : ''}>${esc(ZNAME[z] || z)}</option>`).join(''); };
const link = () => location.origin + '/meet/with/?u=' + encodeURIComponent(S.handle);
const blank = () => ({ id: '', title: '', about: '', durationMin: 30, audience: 'partners', location: 'video', place: '', questions: [], tz: S.prefs ? S.prefs.tz : 'America/New_York', avail: { days: {} }, bufferMin: 10, travelMin: 0, noticeMin: 240, horizonDays: 30, maxPerDay: 4, stepMin: 30, rec: 'off', active: true });

async function load() {
  const [b, p] = await Promise.all([api('meetings/booking'), api('meetings/prefs').catch(() => null)]);
  S.handle = b.handle; S.types = b.types || []; S.bookings = b.bookings || [];
  if (p) { S.prefs = p.prefs; S.google = p.google; }
  draw();
}

const qRow = (q, k) => `<div class="bk-q"><input class="bk-in" data-q="${k}" value="${esc(q.q)}" maxlength="200" aria-label="Question ${k + 1}"><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="delq" data-k="${k}" aria-label="Remove question ${k + 1}">Remove</button><label class="bk-check"><input type="checkbox" data-qr="${k}" ${q.required ? 'checked' : ''}> Required</label></div>`;

function typeEditor(t, i) {
  const days = (t.avail && (t.avail.days || t.avail)) || {};
  const hrs = DAYS.map(([d, n]) => { const w = (days[d] || [])[0]; return `<div class="bk-hr"><label class="bk-check"><input type="checkbox" data-day="${d}" ${w ? 'checked' : ''}> ${n}</label><input class="bk-in" type="time" data-from="${d}" value="${w ? hhmm(w[0]) : '09:00'}" aria-label="${n} from"><input class="bk-in" type="time" data-to="${d}" value="${w ? hhmm(w[1]) : '17:00'}" aria-label="${n} to"></div>`; }).join('');
  const qs = (t.questions || []).map((q, k) => qRow(q, k)).join('');
  const sel = (name, val, opts, id = '') => `<select class="bk-in" data-f="${name}"${id ? ` id="${id}"` : ''}>${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<form class="bk-card" data-i="${i}" novalidate>
    <div class="bk-field"><label for="f-title">Name</label><input class="bk-in" id="f-title" data-f="title" value="${esc(t.title)}" maxlength="80"></div>
    <div class="bk-field"><label for="f-about">About</label><textarea class="bk-in" id="f-about" data-f="about" maxlength="600">${esc(t.about)}</textarea></div>
    <div class="bk-grid2">
      <div class="bk-field"><label for="f-len">Length</label>${sel('durationMin', t.durationMin, LENGTHS.map((m) => [m, m + ' min']), 'f-len')}</div>
      <div class="bk-field"><label for="f-aud">Who can book</label>${sel('audience', t.audience, [['partners', 'Partners and anyone with the link'], ['staff', 'Staff only']], 'f-aud')}</div>
    </div>
    <div class="bk-field"><label for="f-loc">Where</label>${sel('location', t.location, [['video', 'Video call in FavorOS'], ['phone', 'Phone call'], ['in_person', 'In person']], 'f-loc')}</div>
    <div class="bk-field" data-place ${t.location === 'in_person' ? '' : 'hidden'}><label for="f-place">Place</label><input class="bk-in" id="f-place" data-f="place" value="${esc(t.place)}" maxlength="200"></div>
    <div class="bk-field"><span class="bk-lbl">Hours</span><span class="bk-muted">Leave every day off to use your working hours.</span></div>
    <div class="bk-hours">${hrs}</div>
    <div class="bk-field"><label for="f-tz">Time zone</label><select class="bk-in" id="f-tz" data-f="tz">${zoneOpts(t.tz)}</select></div>
    <div class="bk-grid2">
      <div class="bk-field"><label for="f-buf">Buffer between meetings (min)</label><input class="bk-in" id="f-buf" type="number" min="0" max="120" inputmode="numeric" data-f="bufferMin" value="${t.bufferMin}"></div>
      <div class="bk-field" data-travel ${t.location === 'in_person' ? '' : 'hidden'}><label for="f-trv">Travel time (min)</label><input class="bk-in" id="f-trv" type="number" min="0" max="240" inputmode="numeric" data-f="travelMin" value="${t.travelMin}"></div>
      <div class="bk-field"><label for="f-not">Minimum notice (hours)</label><input class="bk-in" id="f-not" type="number" min="0" max="336" inputmode="numeric" data-f="noticeH" value="${Math.round((t.noticeMin || 0) / 60)}"></div>
      <div class="bk-field"><label for="f-hor">How far ahead (days)</label><input class="bk-in" id="f-hor" type="number" min="1" max="120" inputmode="numeric" data-f="horizonDays" value="${t.horizonDays}"></div>
      <div class="bk-field"><label for="f-max">Most per day</label><input class="bk-in" id="f-max" type="number" min="1" max="20" inputmode="numeric" data-f="maxPerDay" value="${t.maxPerDay}"></div>
      <div class="bk-field"><label for="f-step">Start every</label>${sel('stepMin', t.stepMin, [15, 20, 30, 60].map((m) => [m, m + ' min']), 'f-step')}</div>
    </div>
    <div class="bk-field"><label for="f-rec">Recording</label>${sel('rec', t.rec, [['off', 'Off'], ['notes', 'Notes'], ['video', 'Video']], 'f-rec')}</div>
    <div class="bk-field"><span class="bk-lbl">Questions</span><div data-qs>${qs}</div><div><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="addq">Add a question</button></div></div>
    <p class="bk-err" data-err role="alert" hidden></p>
    <div class="bk-row"><button type="submit" class="bk-btn">Save</button><button type="button" class="bk-btn bk-btn--ghost" data-act="close">Close</button></div>
  </form>`;
}

function typeCard(t, i) {
  const where = t.location === 'in_person' ? 'In person' + (t.place ? ', ' + t.place : '') : t.location === 'phone' ? 'Phone call' : 'Video call in FavorOS';
  return `<div class="bk-card ${t.active ? '' : 'bk-off'}"><div class="bk-type-hd"><div><h3>${esc(t.title)}</h3><div class="bk-muted">${t.durationMin} min, ${esc(where)}, ${t.audience === 'staff' ? 'staff only' : 'partners and anyone with the link'}</div></div>
    <div class="bk-row"><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="toggle" data-i="${i}" aria-pressed="${t.active}" aria-label="${esc(t.title)} is ${t.active ? 'on' : 'off'}">${t.active ? 'On' : 'Off'}</button><button type="button" class="bk-btn bk-btn--ghost bk-btn--sm" data-act="edit" data-i="${i}">Edit</button></div></div></div>`;
}

function prefsCard() {
  const p = S.prefs; if (!p) return '';
  const wd = DAYS.map(([d, n]) => `<label class="bk-check"><input type="checkbox" data-pd="${d}" ${p.workDays.includes(d) ? 'checked' : ''}> ${n}</label>`).join('');
  return `<section class="bk-card"><h2 class="bk-h2">Your working hours</h2><p class="bk-muted">Used for suggested times and for meeting types with no hours of their own.</p>
    ${S.google && S.google.freebusy === false ? `<p class="bk-note">Connect your Google Calendar so your booking page skips times you are busy. <a href="/api/google/connect?add=meetings&next=${encodeURIComponent('/meet/booking/')}">Connect Google Calendar</a></p>` : ''}
    <form id="bk-prefs" novalidate><div class="bk-field"><label for="p-tz">Time zone</label><select class="bk-in" id="p-tz">${zoneOpts(p.tz)}</select></div>
    <div class="bk-field"><span class="bk-lbl">Days</span><div class="bk-row">${wd}</div></div>
    <div class="bk-grid2"><div class="bk-field"><label for="p-from">From</label><input class="bk-in" type="time" id="p-from" value="${hhmm(p.dayStart)}"></div><div class="bk-field"><label for="p-to">To</label><input class="bk-in" type="time" id="p-to" value="${hhmm(p.dayEnd)}"></div></div>
    <div class="bk-field"><label for="p-buf">Buffer between meetings (min)</label><input class="bk-in" type="number" min="0" max="60" inputmode="numeric" id="p-buf" value="${p.bufferMin}"></div>
    <button class="bk-btn" type="submit">Save working hours</button></form></section>`;
}

function bookingsCard() {
  const rows = S.bookings.map((b) => {
    const ans = (b.answers || []).filter(Boolean);
    return `<div class="bk-bk"><b>${esc(b.name)}</b> <span class="bk-muted">${esc(b.title || '')}</span><div>${esc(b.email)}${b.phone ? ', ' + esc(b.phone) : ''}</div><div class="bk-muted">${esc(fmtDay(b.starts_at))}, ${esc(fmtTime(b.starts_at))} to ${esc(fmtTime(b.ends_at))}</div>
      ${ans.length ? `<ul class="bk-ans">${ans.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <div class="bk-row" style="margin-top:8px">${b.meeting_id ? `<a class="bk-btn bk-btn--ghost bk-btn--sm" href="/meet/room/?m=${esc(b.meeting_id)}">Open</a>` : ''}<button type="button" class="bk-btn bk-btn--danger bk-btn--sm" data-act="cancel" data-id="${esc(b.id)}">Cancel</button></div></div>`;
  }).join('');
  return `<section class="bk-card"><h2 class="bk-h2">Upcoming bookings</h2>${rows || '<p class="bk-muted">No upcoming bookings.</p>'}</section>`;
}

function draw() {
  const ed = S.open;
  root.removeAttribute('aria-busy');
  root.innerHTML = `<section class="bk-card"><h2 class="bk-h2">Your booking link</h2><div class="bk-link"><code id="bk-url">${esc(link())}</code><button type="button" class="bk-btn bk-btn--sm" data-act="copy">Copy</button><a class="bk-btn bk-btn--ghost bk-btn--sm" href="${esc(link())}" target="_blank" rel="noopener">Open</a></div></section>
    <section><h2 class="bk-h2">Meeting types</h2>${S.types.map((t, i) => (ed && ed.i === i ? typeEditor(ed.t, i) : typeCard(t, i))).join('') || '<p class="bk-muted">No meeting types yet.</p>'}
    ${ed && ed.i === -1 ? typeEditor(ed.t, -1) : '<button type="button" class="bk-btn" data-act="new">New meeting type</button>'}</section>
    <div style="height:14px"></div>${prefsCard()}${bookingsCard()}`;
}

// Read the open editor into a type object.
function readForm(f) {
  const v = (n) => f.querySelector(`[data-f="${n}"]`).value;
  const days = {};
  $$('[data-day]', f).forEach((c) => { if (!c.checked) return; const d = c.dataset.day; const a = mins(f.querySelector(`[data-from="${d}"]`).value), b = mins(f.querySelector(`[data-to="${d}"]`).value); if (b - a >= 15) days[d] = [[a, b]]; });
  const questions = $$('[data-q]', f).map((el) => ({ q: el.value.trim(), required: f.querySelector(`[data-qr="${el.dataset.q}"]`).checked })).filter((q) => q.q);
  return { id: S.open.t.id || undefined, title: v('title').trim(), about: v('about').trim(), durationMin: +v('durationMin'), audience: v('audience'), location: v('location'), place: v('place').trim(), avail: { days }, tz: v('tz'), bufferMin: +v('bufferMin'), travelMin: v('location') === 'in_person' ? +v('travelMin') : 0, noticeMin: Math.round(+v('noticeH') * 60), horizonDays: +v('horizonDays'), maxPerDay: +v('maxPerDay'), stepMin: +v('stepMin'), rec: v('rec'), questions, active: S.open.t.active !== false };
}
// Keep what was typed when the editor redraws (adding or removing a question).
const syncOpen = () => { const f = $('form[data-i]'); if (f && S.open) S.open.t = { ...S.open.t, ...readForm(f) }; };

root.addEventListener('change', (e) => {
  const f = e.target.closest('form[data-i]');
  if (f && e.target.matches('[data-f="location"]')) { const ip = e.target.value === 'in_person'; $('[data-place]', f).hidden = !ip; $('[data-travel]', f).hidden = !ip; }
});

root.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'copy') return copy(link());
  if (a === 'new') { S.open = { i: -1, t: blank() }; draw(); $('#f-title').focus(); return; }
  if (a === 'edit') { const i = +b.dataset.i; S.open = { i, t: JSON.parse(JSON.stringify(S.types[i])) }; draw(); $('#f-title').focus(); return; }
  if (a === 'close') { S.open = null; draw(); return; }
  if (a === 'addq') { syncOpen(); if (S.open.t.questions.length >= 8) return toast('Eight questions is the most.'); S.open.t.questions.push({ q: '', required: false }); draw(); const qs = $$('[data-q]'); qs[qs.length - 1].focus(); return; }
  if (a === 'delq') { syncOpen(); S.open.t.questions.splice(+b.dataset.k, 1); draw(); return; }
  if (a === 'toggle') {
    const t = S.types[+b.dataset.i];
    try { await api('meetings/booking/types', { method: 'POST', body: { ...t, active: !t.active } }); await load(); } catch (er) { toast(er.message); }
    return;
  }
  if (a === 'cancel') {
    const ok = await confirmCard({ title: 'Cancel this booking?', body: 'The partner gets a cancellation with a calendar file.', ok: 'Cancel booking', cancel: 'Keep it', danger: true });
    if (!ok) return;
    const note = (prompt('Add a note for the partner (optional)') || '').trim();
    try { await api('meetings/booking/cancel/' + b.dataset.id, { method: 'POST', body: { note } }); toast('Booking cancelled'); await load(); } catch (er) { toast(er.message); }
  }
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'bk-prefs') {
    const body = { tz: $('#p-tz').value, workDays: $$('[data-pd]').filter((c) => c.checked).map((c) => +c.dataset.pd), dayStart: mins($('#p-from').value), dayEnd: mins($('#p-to').value), bufferMin: +$('#p-buf').value || 0 };
    if (!(body.dayEnd > body.dayStart)) return toast('The end time must be after the start time.');
    try { const r = await api('meetings/prefs', { method: 'POST', body }); if (r.prefs) S.prefs = r.prefs; toast('Working hours saved'); draw(); } catch (er) { toast(er.message); }
    return;
  }
  const f = e.target.closest('form[data-i]'); if (!f) return;
  const body = readForm(f), err = $('[data-err]', f);
  if (!body.title) { err.textContent = 'Name the meeting type.'; err.hidden = false; return; }
  try { await api('meetings/booking/types', { method: 'POST', body }); S.open = null; toast('Saved'); await load(); } catch (er) { err.textContent = er.message; err.hidden = false; }
});

load().catch((er) => { root.removeAttribute('aria-busy'); root.innerHTML = `<div class="bk-card"><p class="bk-err">${esc(er.message)}</p></div>`; });
