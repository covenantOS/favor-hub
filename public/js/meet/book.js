// Booking: pick the people, find a time from everyone's Google Calendar (free and busy only), set the details, book it.
// The booker's own Google connection reads free/busy and puts the meeting on their calendar with the others invited.
import { $, $$, esc, ic, av, api, toast, copy, roomLink, whoami, fmtDay, fmtTime } from './ui.js';

const root = $('#mt-book');
const params = new URLSearchParams(location.search);
const EDIT = params.get('edit') || '';
const TZ = 'America/New_York';
const HOURS = []; for (let h = 9; h < 17; h++) { HOURS.push([h, 0]); HOURS.push([h, 30]); }

const S = { step: 1, dir: [], teams: new Set(), people: new Map(), guests: [], dur: 60, start: '', title: '', agenda: '', rec: 'notes', repeat: 'none', remind: true, backup: true, week: 0, busy: {}, fb: 'idle', me: null, booked: null, can: { ok: false, connected: false }, busyKey: '' };

// ---- Eastern time helpers
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = (t) => { const f = fmt.formatToParts(new Date(t)); const g = (k) => Number(f.find((x) => x.type === k).value); return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') }; };
function etInstant(y, mo, d, h, mi) { let t = Date.UTC(y, mo - 1, d, h, mi); for (let k = 0; k < 3; k++) { const p = parts(t); t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); } return t; }
function weekDays(offset) {
  // Five weekdays: the next five from today (offset 0), then five more per page.
  const out = []; const p = parts(Date.now()); const c = new Date(Date.UTC(p.y, p.mo - 1, p.d, 12));
  const nowMin = p.h * 60 + p.mi; if (nowMin > 15 * 60) c.setUTCDate(c.getUTCDate() + 1);
  while (out.length < 5 + offset * 5) { const wd = c.getUTCDay(); if (wd !== 0 && wd !== 6) out.push({ y: c.getUTCFullYear(), mo: c.getUTCMonth() + 1, d: c.getUTCDate(), wd }); c.setUTCDate(c.getUTCDate() + 1); }
  return out.slice(offset * 5);
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- people
const invited = () => [...S.people.values()];
const emailsAll = () => [...new Set([S.me.email.toLowerCase(), ...S.people.keys()])];
function addPerson(p) { if (p.email.toLowerCase() === (S.me.email || '').toLowerCase()) return; S.people.set(p.email.toLowerCase(), { email: p.email.toLowerCase(), name: p.name || p.email, team: p.team || '' }); }
const teamsList = () => { const m = new Map(); for (const p of S.dir) m.set(p.team, (m.get(p.team) || 0) + 1); return [['All staff', S.dir.length], ...[...m.entries()].sort((a, b) => b[1] - a[1])]; };

async function load() {
  const [who, dir, can] = await Promise.all([whoami(), api('meetings/directory'), api('meetings/bookstatus')]);
  S.me = who; S.dir = dir.people; S.can = can;
  try { const saved = JSON.parse(sessionStorage.getItem('meet.book') || 'null'); if (saved && params.get('google') === 'meetings') { S.step = saved.step || 3; S.teams = new Set(saved.teams); S.people = new Map(saved.people); S.guests = saved.guests; S.dur = saved.dur; S.start = saved.start; S.title = saved.title; S.agenda = saved.agenda; S.rec = saved.rec; S.repeat = saved.repeat; S.remind = saved.remind; S.backup = saved.backup; } } catch {}
  if (EDIT) {
    const m = (await api('meetings/' + EDIT)).meeting;
    S.title = m.title; S.agenda = m.agenda; S.dur = m.durationMin; S.rec = m.rec; S.editing = m;
    for (const i of m.invitees) addPerson({ email: i.email, name: i.name, team: i.team });
    S.step = 2;
  }
  draw(); root.removeAttribute('aria-busy');
  if (S.step === 2) loadBusy();
}

function save() { sessionStorage.setItem('meet.book', JSON.stringify({ step: S.step, teams: [...S.teams], people: [...S.people], guests: S.guests, dur: S.dur, start: S.start, title: S.title, agenda: S.agenda, rec: S.rec, repeat: S.repeat, remind: S.remind, backup: S.backup })); }

// ---- availability
async function loadBusy() {
  const days = weekDays(S.week); const first = days[0], last = days[days.length - 1];
  const from = new Date(etInstant(first.y, first.mo, first.d, 8, 0)).toISOString(); const to = new Date(etInstant(last.y, last.mo, last.d, 18, 0)).toISOString();
  const key = from + emailsAll().join(',');
  if (S.busyKey === key) return;
  S.fb = 'loading'; draw();
  try {
    const r = await api('meetings/freebusy', { method: 'POST', body: { emails: emailsAll(), from, to } });
    S.busy = r.calendars; S.busyKey = key; S.fb = 'ok';
  } catch (e) { S.fb = e.code === 'consent' ? 'consent' : 'error'; S.fbMsg = e.message; }
  draw();
}
function busyAt(email, startMs, endMs) { const c = S.busy[email]; if (!c || c.error) return false; return c.busy.some((b) => Date.parse(b.start) < endMs && Date.parse(b.end) > startMs); }
function unknownCount() { return Object.values(S.busy).filter((c) => c.error).length; }
function busyCount(startMs, endMs) { return emailsAll().filter((e) => busyAt(e, startMs, endMs)).length; }
function slotsFor(days) {
  const out = []; const step = 30 * 60000; const dur = S.dur * 60000; const now = Date.now() + 30 * 60000;
  for (const d of days) for (const [h, mi] of HOURS) {
    const s = etInstant(d.y, d.mo, d.d, h, mi); const e = s + dur; if (s < now) continue;
    if (parts(e - 1).h >= 17 && parts(e).h !== 17) continue; // keep inside the working day
    if (h * 60 + mi + S.dur > 17 * 60 + 30) continue;
    let worst = 0; for (let t = s; t < e; t += step) worst = Math.max(worst, busyCount(t, t + step));
    const total = emailsAll().length; const clash = emailsAll().filter((em) => { for (let t = s; t < e; t += step) if (busyAt(em, t, t + step)) return true; return false; }).length;
    const lunch = h * 60 + mi < 13 * 60 && h * 60 + mi + S.dur > 12 * 60;
    const buffer = busyCount(s - 15 * 60000, s) > 0 ? 1 : 0;
    out.push({ s, e, d, h, mi, clash, total, score: clash * 100 + (lunch ? 30 : 0) + buffer * 5 + (mi ? 1 : 0) + (s - now) / 3.6e8 });
  }
  return out.sort((a, b) => a.score - b.score);
}

// ---- drawing
const stepsHTML = () => `<div class="mt-steps">${['Who', 'When', 'Details'].map((l, i) => `<button class="mt-step${S.step === i + 1 ? ' is-on' : S.step > i + 1 ? ' is-done' : ''}" data-step="${i + 1}"><i>${S.step > i + 1 ? '✓' : i + 1}</i>${l}</button>`).join('')}</div>`;
const person = (p) => `<span class="mt-person">${av(p.name)}${esc(p.name)}<button data-rm="${esc(p.email)}" aria-label="Remove ${esc(p.name)}">${ic('x')}</button></span>`;

function draw() {
  if (S.booked) return drawBooked();
  let body = '';
  if (S.step === 1) {
    const filter = ($('#addp') || {}).value || '';
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:16px">
      <div><h3 class="mt-h3">Pick a team or a group</h3><div class="mt-chips">${teamsList().map(([t, n]) => `<button class="mt-chip${S.teams.has(t) ? ' is-on' : ''}" data-team="${esc(t)}">${esc(t)}<span>${n}</span></button>`).join('')}</div></div>
      <div><h3 class="mt-h3">Add people</h3><div class="mt-add"><input id="addp" placeholder="Type a name or a Favor email address" list="plist" autocomplete="off" /><button class="h-btn h-btn--ghost h-btn--sm" id="addbtn">${ic('plus')}Add</button></div>
        <datalist id="plist">${S.dir.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><h3 class="mt-h3">${S.people.size + S.guests.length} invited</h3><div class="mt-people">${invited().map(person).join('')}${S.guests.map((g, i) => `<span class="mt-person mt-person--guest">${av(g)}${esc(g)}<button data-rg="${i}" aria-label="Remove">${ic('x')}</button></span>`).join('')}</div></div>
      <div><h3 class="mt-h3">Guests from outside Favor</h3><div class="mt-add"><input id="addg" placeholder="Email address" /><button class="h-btn h-btn--ghost h-btn--sm" id="addgbtn">${ic('plus')}Add guest</button></div>
        <p class="mt-sub" style="margin:6px 0 0">Guests get the invitation from Google Calendar with the link. Guest access to the room is switched on in a later update, so for now invite staff.</p></div>
    </section><aside class="mt-stack"><div class="mt-note"><b>Calendars read live.</b> The hub checks everyone's Google Calendar for busy times. It sees free and busy only, never what the meeting is.</div>
      <div class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">How long</div><div class="mt-seg">${[30, 45, 60, 90].map((d) => `<button class="${S.dur === d ? 'is-on' : ''}" data-dur="${d}">${d} min</button>`).join('')}</div></div></aside></div>
      <div class="mt-foot"><button class="h-btn h-btn--primary" data-step="2" ${S.people.size + S.guests.length ? '' : 'disabled'}>Find times${ic('chev')}</button></div>`;
  } else if (S.step === 2) {
    const days = weekDays(S.week);
    const slots = S.fb === 'ok' || S.fb === 'consent' || S.fb === 'error' ? slotsFor(days).slice(0, 4) : [];
    const total = emailsAll().length;
    const cell = (d, [h, mi]) => { const s = etInstant(d.y, d.mo, d.d, h, mi); const n = S.fb === 'ok' ? busyCount(s, s + 1800000) : 0; const b = n === 0 ? 0 : n / total < 0.25 ? 1 : n / total < 0.5 ? 2 : 3; const sel = S.start && s >= Date.parse(S.start) && s < Date.parse(S.start) + S.dur * 60000; const pick = slots.some((x) => x.s === s); return `<td class="c${sel ? ' is-sel' : ''}${pick && !sel ? ' is-pick' : ''}" data-b="${b}" data-at="${new Date(s).toISOString()}" title="${WD[d.wd]} ${d.mo}/${d.d} ${h}:${String(mi).padStart(2, '0')}"></td>`; };
    body = `<div class="mt-grid"><section class="h-card mt-card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><h3 class="mt-h3" style="margin:0">${S.week ? 'Week ' + (S.week + 1) : 'The next five working days'}, ${total} people, ${S.dur} minutes</h3><span style="display:flex;gap:6px;align-items:center"><span class="mt-sub">Eastern time</span><button class="icon-b" data-week="-1" ${S.week ? '' : 'disabled'} aria-label="Earlier">${ic('chevl')}</button><button class="icon-b" data-week="1" aria-label="Later">${ic('chev')}</button></span></div>
      ${S.fb === 'loading' ? '<p class="mt-sub">Reading calendars.</p>' : ''}
      ${S.fb === 'consent' ? `<div class="mt-note mt-note--gold" style="margin-bottom:10px"><b>Allow calendar access once.</b> ${esc(S.fbMsg || 'Favor needs to read free and busy times and add the meeting to your calendar.')} <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect?add=meetings&next=${encodeURIComponent('/meet/book/')}" id="allow">Allow in Google</a></div>` : ''}
      ${S.fb === 'error' ? `<div class="mt-note mt-note--gold" style="margin-bottom:10px">${esc(S.fbMsg || 'Calendars did not load.')} You can still pick a time below.</div>` : ''}
      ${S.fb === 'ok' && unknownCount() ? `<p class="mt-sub" style="margin:0 0 8px">${unknownCount()} calendar${unknownCount() === 1 ? '' : 's'} could not be read, so those people show as free.</p>` : ''}
      <div class="fb"><table><thead><tr><th></th>${days.map((d) => `<th>${WD[d.wd]} ${d.d}</th>`).join('')}</tr></thead><tbody>
      ${HOURS.map((hm, r) => `<tr><td class="h">${r % 2 ? '' : (hm[0] > 12 ? hm[0] - 12 : hm[0]) + ':00'}</td>${days.map((d) => cell(d, hm)).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="fb-key"><span><i style="background:#cfdcc6"></i>Everyone free</span><span><i style="background:#e8e1cc"></i>A few busy</span><span><i style="background:#ecd7c6"></i>Several busy</span><span><i style="background:#e2bfae"></i>Many busy</span><span><i style="background:var(--h-brand)"></i>Your pick</span></div></section>
      <aside class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Best times</div><div class="slots">${slots.length ? slots.map((s) => `<button class="slot${S.start && Date.parse(S.start) === s.s ? ' is-on' : ''}" data-at="${new Date(s.s).toISOString()}"><b>${WD[s.d.wd]} ${s.d.mo}/${s.d.d}, ${fmtTime(new Date(s.s).toISOString())} to ${fmtTime(new Date(s.e).toISOString())}</b>${s.clash ? `<span class="mt-pill mt-pill--gold" style="height:22px;grid-column:auto">${s.total - s.clash} of ${s.total}</span>` : '<span class="mt-pill mt-pill--ok" style="height:22px">All free</span>'}<span>${s.clash ? s.clash + ' busy' : 'Everyone is free'}</span></button>`).join('') : '<p class="mt-sub">Pick a time on the grid.</p>'}</div>
        <p class="mt-sub" style="margin:10px 0 0">Times avoid lunch and keep 15 minutes between meetings where they can.</p></aside></div>
      <div class="mt-foot">${EDIT ? '' : `<button class="h-btn h-btn--ghost" data-step="1">${ic('back')}Back</button>`}<button class="h-btn h-btn--primary" data-step="${EDIT ? 'save' : '3'}" ${S.start ? '' : 'disabled'}>${EDIT ? 'Move the meeting' : 'Use this time'}${EDIT ? '' : ic('chev')}</button></div>`;
  } else {
    const when = S.start ? `${fmtDay(S.start)}, ${fmtTime(S.start)} to ${fmtTime(new Date(Date.parse(S.start) + S.dur * 60000).toISOString())}` : '';
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:14px">
      <div class="mt-f"><label for="ttl">Title</label><input id="ttl" value="${esc(S.title)}" maxlength="140" /></div>
      <div class="mt-f"><label for="ag">Agenda</label><textarea id="ag" maxlength="2000">${esc(S.agenda)}</textarea></div>
      <div><div class="h-label" style="margin-bottom:8px">Record</div><div class="mt-opt">
        ${[['notes', 'Transcript and notes', 'Sound only. Notes, decisions and action items land in the hub after the meeting.'], ['video', 'Video recording too', 'The video goes to the Meetings drive in Google Drive, with the notes beside it.'], ['off', 'Nothing', 'No recording and no notes.']].map(([k, t, d]) => `<button class="${S.rec === k ? 'is-on' : ''}" data-rec="${k}"><i class="dot"></i><div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div></div>
      <div><div class="h-label" style="margin-bottom:8px">Repeats</div><div class="mt-seg">${[['none', 'Once'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(([k, l]) => `<button class="${S.repeat === k ? 'is-on' : ''}" data-repeat="${k}">${l}</button>`).join('')}</div></div>
    </section><aside class="mt-stack"><div class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Summary</div><dl class="kv"><dt>When</dt><dd>${esc(when)}</dd><dt>Who</dt><dd>${S.people.size + 1} staff${S.guests.length ? `, ${S.guests.length} guest${S.guests.length === 1 ? '' : 's'}` : ''}</dd><dt>Where</dt><dd>Favor meeting room in the hub</dd></dl></div>
      <div class="h-card mt-card"><div class="mt-toggle"><div><b>Email reminders</b><span>A day before and 15 minutes before, with the join link</span></div><button class="mt-sw${S.remind ? ' is-on' : ''}" data-sw="remind" aria-label="Email reminders"></button></div>
        <div class="mt-toggle"><div><b>Backup Google Meet link</b><span>In the invite in case the room ever fails to load</span></div><button class="mt-sw${S.backup ? ' is-on' : ''}" data-sw="backup" aria-label="Backup link"></button></div></div></aside></div>
      <div class="mt-foot"><button class="h-btn h-btn--ghost" data-step="2">${ic('back')}Back</button><button class="h-btn h-btn--primary" id="confirm">${ic('check')}Book it and send invites</button></div>`;
  }
  const keep = { id: document.activeElement && document.activeElement.id, v: document.activeElement && document.activeElement.value, p: document.activeElement && document.activeElement.selectionStart };
  root.innerHTML = `<div class="mt-intro"><div><p>${EDIT ? 'Pick a new time. Everyone gets an updated invitation.' : "Pick who, and the hub finds times that work from everyone's calendar."}</p></div></div>${EDIT ? '' : stepsHTML()}${body}`;
  if (keep.id && $('#' + keep.id) && ['addp', 'addg', 'ttl', 'ag'].includes(keep.id)) { const el = $('#' + keep.id); el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.p, keep.p); } catch {} }
}

function drawBooked() {
  const m = S.booked.meeting; const link = roomLink(m.id);
  root.innerHTML = `<div class="h-card mt-card" style="max-width:720px;margin:10px auto;display:grid;gap:16px;justify-items:start;grid-template-columns:minmax(0,1fr)">
    <span class="done-ic">${ic('check')}</span><div><h2 class="mt-h2">${esc(m.title)} is booked</h2><p class="mt-sub" style="font-size:14px;margin:0">${esc(fmtDay(m.startsAt))}, ${esc(fmtTime(m.startsAt))}. ${m.repeat && m.repeat !== 'none' ? '' : ''}${S.booked.calendar ? `Invites went to ${S.people.size + S.guests.length} people and the meeting is on their Google Calendars.` : ''}</p></div>
    <div style="width:100%"><div class="h-label" style="margin-bottom:6px">Share link</div><div class="linkbox"><code>${esc(link)}</code><button class="h-btn h-btn--ghost h-btn--sm" id="cp">${ic('copy')}Copy</button></div></div>
    <ul class="nt-list"><li><span class="b">${ic('bell')}</span><span>${S.remind ? 'Reminder emails go out a day before and 15 minutes before the start, with the join link.' : 'No reminder emails. Google Calendar still shows its own reminder.'}</span></li>
    <li><span class="b">${ic('notes')}</span><span>${S.rec === 'off' ? 'No notes for this meeting.' : S.rec === 'video' ? 'Video, transcript and notes go to the Meetings drive in Google Drive and to Meeting notes in the hub.' : 'Transcript and notes go to Meeting notes in the hub.'}</span></li>
    ${m.backupLink ? `<li><span class="b">${ic('link')}</span><span>The invite carries a backup Google Meet link.</span></li>` : ''}</ul>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a><a class="h-btn h-btn--ghost" href="/meet/book/">Book another</a></div></div>`;
  $('#cp').addEventListener('click', () => copy(link));
}

// ---- events
root.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, td.c'); if (!t) return;
  if (t.dataset.team) { const team = t.dataset.team; const on = S.teams.has(team); const members = team === 'All staff' ? S.dir : S.dir.filter((p) => p.team === team); if (on) { S.teams.delete(team); members.forEach((p) => S.people.delete(p.email)); } else { S.teams.add(team); members.forEach(addPerson); } save(); draw(); }
  else if (t.dataset.rm) { S.people.delete(t.dataset.rm); draw(); }
  else if (t.dataset.rg) { S.guests.splice(Number(t.dataset.rg), 1); draw(); }
  else if (t.id === 'addbtn') { const v = ($('#addp').value || '').trim().toLowerCase(); if (!v) return; const p = S.dir.find((x) => x.name.toLowerCase() === v) || S.dir.find((x) => x.name.toLowerCase().includes(v) || x.email === v); if (p) addPerson(p); else if (/^[^@\s]+@favorintl\.org$/.test(v)) addPerson({ email: v, name: v.split('@')[0] }); else { toast('No one on staff by that name. Type a full Favor email address.'); return; } $('#addp').value = ''; draw(); }
  else if (t.id === 'addgbtn') { const v = ($('#addg').value || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Type a full email address'); return; } if (/@favorintl\.org$/.test(v)) { addPerson({ email: v, name: v.split('@')[0] }); } else S.guests.push(v); $('#addg').value = ''; draw(); }
  else if (t.dataset.dur) { S.dur = Number(t.dataset.dur); S.busyKey = ''; draw(); }
  else if (t.dataset.step) {
    if (S.step === 3) { S.title = ($('#ttl') || {}).value ?? S.title; S.agenda = ($('#ag') || {}).value ?? S.agenda; }
    if (t.dataset.step === 'save') return reschedule();
    S.step = Number(t.dataset.step); save(); draw(); window.scrollTo(0, 0); if (S.step === 2) loadBusy();
  }
  else if (t.dataset.week) { S.week = Math.max(0, S.week + Number(t.dataset.week)); S.busyKey = ''; draw(); loadBusy(); }
  else if (t.dataset.at !== undefined) { S.start = t.dataset.at; draw(); }
  else if (t.dataset.rec) { S.rec = t.dataset.rec; capture(); draw(); }
  else if (t.dataset.repeat) { S.repeat = t.dataset.repeat; capture(); draw(); }
  else if (t.dataset.sw) { S[t.dataset.sw] = !S[t.dataset.sw]; capture(); draw(); }
  else if (t.id === 'confirm') confirm_();
  else if (t.id === 'allow') save();
});
function capture() { if ($('#ttl')) S.title = $('#ttl').value; if ($('#ag')) S.agenda = $('#ag').value; }

async function confirm_() {
  capture();
  const btn = $('#confirm'); btn.disabled = true; btn.textContent = 'Booking';
  try {
    const r = await api('meetings', { method: 'POST', body: {
      title: S.title || (S.people.size === 1 ? 'Meeting' : 'Team meeting'), agenda: S.agenda, startsAt: S.start, durationMin: S.dur, rec: S.rec, access: 'invited', repeat: S.repeat, remind: S.remind, backup: S.backup,
      invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...S.guests.map((g) => ({ email: g, name: g, guest: true }))],
    } });
    sessionStorage.removeItem('meet.book'); S.booked = r; draw();
  } catch (e) {
    btn.disabled = false; btn.innerHTML = `${ic('check')}Book it and send invites`;
    if (e.code === 'consent') { S.fb = 'consent'; S.fbMsg = e.message; S.step = 2; save(); draw(); } else toast(e.message);
  }
}
async function reschedule() {
  try { await api('meetings/' + EDIT + '/update', { method: 'POST', body: { startsAt: S.start } }); toast('Moved. Invitations updated.'); setTimeout(() => (location.href = '/meet/'), 900); } catch (e) { toast(e.message); }
}

load().catch((e) => { root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`; });
