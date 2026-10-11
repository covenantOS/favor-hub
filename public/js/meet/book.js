// Booking: pick the people, find a time from everyone's Google Calendar (free and busy only), set the details, book it.
// The booker's own Google connection reads free/busy and puts the meeting on their calendar with the others invited.
import { $, $$, esc, ic, av, api, toast, copy, roomLink, whoami } from './ui.js';

const root = $('#mt-book');
const params = new URLSearchParams(location.search);
const EDIT = params.get('edit') || '';
const FOLLOW = params.get('follow') || '';
const TZ = 'America/New_York';
const HOURS = []; for (let h = 9; h < 17; h++) { HOURS.push([h, 0]); HOURS.push([h, 30]); }

const S = { step: 1, dir: [], teams: new Set(), chipAdded: new Map(), people: new Map(), guests: [], dur: 60, start: '', title: '', autoTitle: false, agenda: '', rec: 'notes', repeat: 'none', remind: true, backup: true, week: 0, busy: {}, fb: 'idle', me: null, booked: null, can: { ok: false, connected: false }, guestsOn: false, busyKey: '' };

// ---- Eastern time helpers
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = (t) => { const f = fmt.formatToParts(new Date(t)); const g = (k) => Number(f.find((x) => x.type === k).value); return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') }; };
function etInstant(y, mo, d, h, mi) { let t = Date.UTC(y, mo - 1, d, h, mi); for (let k = 0; k < 3; k++) { const p = parts(t); t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); } return t; }
function weekDays(offset) {
  // Seven days starting today (offset 0), then seven more per page. Weekends show; past times cannot be picked.
  const out = []; const p = parts(Date.now()); const c = new Date(Date.UTC(p.y, p.mo - 1, p.d, 12));
  if (p.h * 60 + p.mi >= 19 * 60) c.setUTCDate(c.getUTCDate() + 1);
  c.setUTCDate(c.getUTCDate() + offset * 7);
  while (out.length < 7) { out.push({ y: c.getUTCFullYear(), mo: c.getUTCMonth() + 1, d: c.getUTCDate(), wd: c.getUTCDay() }); c.setUTCDate(c.getUTCDate() + 1); }
  return out;
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
const etDay = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const etTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const REPEAT = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month' };

// ---- people
const invited = () => [...S.people.values()];
const emailsAll = () => [...new Set([S.me.email.toLowerCase(), ...S.people.keys()])];
const hasWho = () => S.people.size + S.guests.length > 0;
function addPerson(p) { if (p.email.toLowerCase() === (S.me.email || '').toLowerCase()) return; S.people.set(p.email.toLowerCase(), { email: p.email.toLowerCase(), name: p.name || p.email, team: p.team || '' }); }
// A person typed by address gets the directory name when there is one, and the full address otherwise.
function personByEmail(email) { const d = S.dir.find((x) => x.email.toLowerCase() === email); return { email, name: d ? d.name : email, team: d ? d.team : '' }; }
const nameOf = (email) => (email === (S.me.email || '').toLowerCase() ? 'You' : (S.people.get(email) || {}).name || email);
const listNames = (emails) => { const n = emails.map(nameOf); return n.length <= 2 ? n.join(' and ') : `${n[0]}, ${n[1]} and ${n.length - 2} more`; };
const teamsList = () => { const m = new Map(); for (const p of S.dir) m.set(p.team, (m.get(p.team) || 0) + 1); return [['All staff', S.dir.length], ...[...m.entries()].sort((a, b) => b[1] - a[1])]; };
function defaultTitle() {
  const n = invited().map((p) => p.name.split(/[\s@]/)[0]).filter(Boolean);
  if (!n.length) return '';
  if (n.length === 1) return `Meeting with ${n[0]}`;
  if (n.length <= 3) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return 'Team meeting';
}
// A team chip adds its members who are not already on the list, and taking it off removes only those.
function toggleTeam(team) {
  if (S.teams.has(team)) {
    S.teams.delete(team);
    const keep = new Set(); for (const [t, list] of S.chipAdded) if (t !== team) list.forEach((e) => keep.add(e));
    for (const e of S.chipAdded.get(team) || []) if (!keep.has(e)) S.people.delete(e);
    S.chipAdded.delete(team);
  } else {
    S.teams.add(team);
    const members = team === 'All staff' ? S.dir : S.dir.filter((p) => p.team === team);
    const added = [];
    for (const p of members) { const e = p.email.toLowerCase(); if (e !== (S.me.email || '').toLowerCase() && !S.people.has(e)) added.push(e); addPerson(p); }
    S.chipAdded.set(team, added);
  }
}

async function load() {
  const [who, dir, can] = await Promise.all([whoami(), api('meetings/directory'), api('meetings/bookstatus')]);
  S.me = who; S.dir = dir.people; S.can = can; S.guestsOn = !!can.guestsEnabled;
  try { const saved = JSON.parse(sessionStorage.getItem('meet.book') || 'null'); if (saved && params.get('google') === 'meetings') { S.step = saved.step || 3; S.teams = new Set(saved.teams); S.chipAdded = new Map(saved.chipAdded || []); S.autoTitle = !!saved.autoTitle; S.people = new Map(saved.people); S.guests = saved.guests; S.dur = saved.dur; S.start = saved.start; S.title = saved.title; S.agenda = saved.agenda; S.rec = saved.rec; S.repeat = saved.repeat; S.remind = saved.remind; S.backup = saved.backup; } } catch {}
  if (EDIT) {
    const m = (await api('meetings/' + EDIT)).meeting;
    S.title = m.title; S.agenda = m.agenda; S.dur = m.durationMin; S.rec = m.rec; S.editing = m;
    for (const i of m.invitees) addPerson({ email: i.email, name: i.name, team: i.team });
    S.step = 2;
  }
  // Book the follow-up (from a meeting's notes): the same people, with a Follow-up title, starting on Who.
  if (FOLLOW && !EDIT) {
    try {
      const m = (await api('meetings/' + FOLLOW)).meeting;
      S.title = 'Follow-up: ' + String(m.title || 'Meeting').replace(/^Follow-up:\s*/i, '');
      // A directory name wins; someone not in the directory keeps the name the meeting was booked with.
      const who = (email, name) => { const p = personByEmail(email); const known = S.dir.some((x) => x.email.toLowerCase() === email); addPerson({ email, name: known ? p.name : name || email, team: p.team }); };
      if (m.hostEmail) who(String(m.hostEmail).toLowerCase(), m.hostName);
      for (const i of m.invitees || []) who(String(i.email).toLowerCase(), i.name);
    } catch (e) { toast(e.message); }
  }
  if (S.step === 2 && !S.can.ok) S.fb = 'consent';
  draw(); root.removeAttribute('aria-busy');
  if (S.step === 2) loadBusy();
}

function save() { sessionStorage.setItem('meet.book', JSON.stringify({ step: S.step, teams: [...S.teams], chipAdded: [...S.chipAdded], people: [...S.people], guests: S.guests, dur: S.dur, start: S.start, title: S.title, autoTitle: S.autoTitle, agenda: S.agenda, rec: S.rec, repeat: S.repeat, remind: S.remind, backup: S.backup })); }

// ---- availability
async function loadBusy() {
  // Without calendar consent there is nothing to read, so no request goes out and the consent card shows alone.
  if (!S.can.ok) { S.fb = 'consent'; S.fbMsg = ''; draw(); return; }
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
// People whose calendar was not read count as unknown, never as free.
const unknownList = () => (S.fb === 'ok' ? emailsAll().filter((e) => !S.busy[e] || S.busy[e].error) : emailsAll());
function busyCount(startMs, endMs) { return emailsAll().filter((e) => busyAt(e, startMs, endMs)).length; }
function slotsFor(days) {
  const out = []; const step = 30 * 60000; const dur = S.dur * 60000; const now = Date.now() + 30 * 60000;
  for (const d of days) for (const [h, mi] of HOURS) {
    if (d.wd === 0 || d.wd === 6) continue;
    const s = etInstant(d.y, d.mo, d.d, h, mi); const e = s + dur; if (s < now) continue;
    if (parts(e - 1).h >= 17 && parts(e).h !== 17) continue; // keep inside the working day
    if (h * 60 + mi + S.dur > 17 * 60 + 30) continue;
    const total = emailsAll().length; const clashList = emailsAll().filter((em) => { for (let t = s; t < e; t += step) if (busyAt(em, t, t + step)) return true; return false; }); const clash = clashList.length;
    const beforeList = emailsAll().filter((em) => busyAt(em, s - 15 * 60000, s));
    const lunch = h * 60 + mi < 13 * 60 && h * 60 + mi + S.dur > 12 * 60;
    out.push({ s, e, d, h, mi, clash, clashList, beforeList, total, score: clash * 100 + (lunch ? 30 : 0) + (beforeList.length ? 5 : 0) + (mi ? 1 : 0) + (s - now) / 3.6e8 });
  }
  return out.sort((a, b) => a.score - b.score);
}
function slotNote(s, unk) {
  const bits = [];
  if (s.clash) bits.push(`${listNames(s.clashList)} busy`);
  else if (!unk.length) bits.push('Everyone is free');
  if (!s.clash && s.beforeList.length) bits.push(`${listNames(s.beforeList)} in a meeting just before`);
  if (unk.length && S.fb === 'ok') bits.push(`${listNames(unk)}: calendar not read`);
  if (S.fb === 'error') bits.push('Calendars not read');
  return bits.join('. ');
}

// ---- drawing
const stepOpen = (n) => n <= S.step || (n === 2 && hasWho()) || (n === 3 && hasWho() && !!S.start && S.can.ok);
const stepsHTML = () => `<div class="mt-steps">${['Who', 'When', 'Details'].map((l, i) => `<button class="mt-step${S.step === i + 1 ? ' is-on' : S.step > i + 1 ? ' is-done' : ''}" data-step="${i + 1}" ${stepOpen(i + 1) ? '' : 'disabled'}><i>${S.step > i + 1 ? '✓' : i + 1}</i>${l}</button>`).join('')}</div>`;
const person = (p) => `<span class="mt-person">${av(p.name)}${esc(p.name)}<button data-rm="${esc(p.email)}" aria-label="Remove ${esc(p.name)}">${ic('x')}</button></span>`;

function draw() {
  if (S.booked) return drawBooked();
  let body = '';
  if (S.step === 1) {
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:16px">
      <div><h3 class="mt-h3">Pick a team or a group</h3><div class="mt-chips">${teamsList().map(([t, n]) => `<button class="mt-chip${S.teams.has(t) ? ' is-on' : ''}" data-team="${esc(t)}">${esc(t)}<span>${n}</span></button>`).join('')}</div></div>
      <div><h3 class="mt-h3">Add people</h3><div class="mt-add"><input id="addp" placeholder="Name or Favor email" list="plist" autocomplete="off" /><button class="h-btn h-btn--ghost h-btn--sm" id="addbtn">${ic('plus')}Add</button></div>
        <datalist id="plist">${S.dir.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><h3 class="mt-h3">${S.people.size + S.guests.length} invited</h3><div class="mt-people">${invited().map(person).join('')}${S.guests.map((g, i) => `<span class="mt-person mt-person--guest">${av(g)}${esc(g)}<button data-rg="${i}" aria-label="Remove">${ic('x')}</button></span>`).join('')}</div></div>
      ${S.guestsOn ? `<div><h3 class="mt-h3">Guests from outside Favor</h3><div class="mt-add"><input id="addg" placeholder="Email address" /><button class="h-btn h-btn--ghost h-btn--sm" id="addgbtn">${ic('plus')}Add guest</button></div></div>` : ''}
    </section><aside class="mt-stack"><div class="mt-note">Reads free and busy times only.</div>
      <div class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">How long</div><div class="mt-seg">${[30, 45, 60, 90].map((d) => `<button class="${S.dur === d ? 'is-on' : ''}" data-dur="${d}">${d} min</button>`).join('')}</div></div></aside></div>
      <div class="mt-foot"><button class="h-btn h-btn--ghost" id="startnow">${ic('video')}Start now</button><button class="h-btn h-btn--primary" data-step="2" ${hasWho() ? '' : 'disabled'}>Find times${ic('chev')}</button></div>`;
  } else if (S.step === 2 && S.fb === 'consent') {
    body = `<div class="mt-note mt-note--gold" style="margin-bottom:10px"><b>Allow calendar access once.</b> ${esc(S.fbMsg || 'Favor needs to read free and busy times and add the meeting to your calendar.')} <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect?add=meetings&next=${encodeURIComponent(EDIT ? '/meet/book/?edit=' + EDIT : '/meet/book/')}" id="allow">Allow in Google</a></div>
      <div class="mt-foot">${EDIT ? '<a class="h-btn h-btn--ghost" href="/meet/">Cancel</a>' : `<button class="h-btn h-btn--ghost" data-step="1">${ic('back')}Back</button>`}</div>`;
  } else if (S.step === 2) {
    const days = weekDays(S.week);
    const unk = unknownList();
    const slots = S.fb === 'ok' || S.fb === 'error' ? slotsFor(days).slice(0, 4) : [];
    const total = emailsAll().length;
    const pickCell = S.start ? null : slots[0];
    const cell = (d, [h, mi]) => { const s = etInstant(d.y, d.mo, d.d, h, mi); if (s + 1800000 <= Date.now()) return `<td class="c is-past" role="gridcell" aria-disabled="true" tabindex="-1"></td>`; const n = S.fb === 'ok' ? busyCount(s, s + 1800000) : 0; const b = n === 0 ? 0 : n / total < 0.25 ? 1 : n / total < 0.5 ? 2 : 3; const sel = S.start && s >= Date.parse(S.start) && s < Date.parse(S.start) + S.dur * 60000; const pick = slots.some((x) => x.s === s); const first = S.start ? s === Date.parse(S.start) : pickCell ? s === pickCell.s : h === HOURS[0][0] && mi === 0 && d === days[0]; const label = `${WD[d.wd]} ${d.mo}/${d.d}, ${hourLabel(h)}${mi ? ':30' : ''}${n ? `, ${n} of ${total} busy` : ''}`; return `<td class="c${sel ? ' is-sel' : ''}${pick && !sel ? ' is-pick' : ''}" role="gridcell" tabindex="${first ? 0 : -1}" aria-selected="${sel ? 'true' : 'false'}" aria-label="${esc(label)}" data-b="${b}" data-at="${new Date(s).toISOString()}" title="${esc(label)}"></td>`; };
    body = `<div class="mt-grid"><section class="h-card mt-card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><h3 class="mt-h3" style="margin:0">${S.week ? 'Week ' + (S.week + 1) : 'The next seven days'}, ${total} people, ${S.dur} minutes</h3><span style="display:flex;gap:6px;align-items:center"><span class="mt-sub">Eastern time</span><button class="icon-b" data-week="-1" ${S.week ? '' : 'disabled'} aria-label="Earlier">${ic('chevl')}</button><button class="icon-b" data-week="1" aria-label="Later">${ic('chev')}</button></span></div>
      ${S.fb === 'loading' ? '<p class="mt-sub">Reading calendars.</p>' : ''}
      ${S.fb === 'error' ? `<div class="mt-note mt-note--gold" style="margin-bottom:10px">${esc(S.fbMsg || 'Calendars did not load.')} You can still pick a time below.</div>` : ''}
      ${S.fb === 'ok' && unk.length ? `<p class="mt-sub" style="margin:0 0 8px">${esc(listNames(unk))}: calendar could not be read, so ${unk.length === 1 ? 'that time is' : 'those times are'} not checked.</p>` : ''}
      <div class="fb"><table role="grid" aria-label="Times in Eastern time. Use the arrow keys to move and Enter to pick."><thead><tr><th></th>${days.map((d) => `<th>${WD[d.wd]} ${d.d}</th>`).join('')}</tr></thead><tbody>
      ${HOURS.map((hm, r) => `<tr><td class="h">${r % 2 ? '' : hourLabel(hm[0])}</td>${days.map((d) => cell(d, hm)).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="fb-key"><span><i style="background:#cfdcc6"></i>Everyone free</span><span><i style="background:#e8e1cc"></i>A few busy</span><span><i style="background:#ecd7c6"></i>Several busy</span><span><i style="background:#e2bfae"></i>Many busy</span><span><i style="background:var(--h-brand)"></i>Your pick</span></div></section>
      <aside class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Best times</div><div class="slots">${slots.length ? slots.map((s) => `<button class="slot${S.start && Date.parse(S.start) === s.s ? ' is-on' : ''}" data-at="${new Date(s.s).toISOString()}"><b>${WD[s.d.wd]} ${s.d.mo}/${s.d.d}, ${etTime(new Date(s.s).toISOString())} to ${etTime(new Date(s.e).toISOString())}</b>${s.clash ? `<span class="mt-pill mt-pill--gold" style="height:22px;grid-column:auto">${s.total - s.clash} of ${s.total}</span>` : unk.length ? '' : '<span class="mt-pill mt-pill--ok" style="height:22px">All free</span>'}<span>${esc(slotNote(s, unk))}</span></button>`).join('') : '<p class="mt-sub">Pick a time on the grid.</p>'}</div></aside></div>
      <div class="mt-foot">${EDIT ? '' : `<button class="h-btn h-btn--ghost" data-step="1">${ic('back')}Back</button>`}<button class="h-btn h-btn--primary" data-step="${EDIT ? 'save' : '3'}" ${S.start ? '' : 'disabled'}>${EDIT ? 'Move the meeting' : 'Use this time'}${EDIT ? '' : ic('chev')}</button></div>`;
  } else {
    const when = S.start ? `${etDay(S.start)}, ${etTime(S.start)} to ${etTime(new Date(Date.parse(S.start) + S.dur * 60000).toISOString())} Eastern` : '';
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:14px">
      <div class="mt-f"><label for="ttl">Title</label><input id="ttl" value="${esc(S.title)}" placeholder="Meeting title" maxlength="140" /></div>
      <div class="mt-f"><label for="ag">Agenda</label><textarea id="ag" maxlength="2000">${esc(S.agenda)}</textarea></div>
      <div><div class="h-label" style="margin-bottom:8px">Record</div><div class="mt-opt">
        ${[['notes', 'Transcript and notes', 'Sound only. Notes, decisions and action items land in the hub after the meeting.'], ['video', 'Video recording too', 'The video goes to the Meetings folder in US Team Files, with the notes beside it.'], ['off', 'Nothing', 'No recording and no notes.']].map(([k, t, d]) => `<button class="${S.rec === k ? 'is-on' : ''}" data-rec="${k}"><i class="dot"></i><div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div></div>
      <div><div class="h-label" style="margin-bottom:8px">Repeats</div><div class="mt-seg">${[['none', 'Once'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(([k, l]) => `<button class="${S.repeat === k ? 'is-on' : ''}" data-repeat="${k}">${l}</button>`).join('')}</div></div>
    </section><aside class="mt-stack"><div class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Summary</div><dl class="kv"><dt>When</dt><dd>${esc(when)}</dd>${S.repeat !== 'none' ? `<dt>Repeats</dt><dd>${esc(REPEAT[S.repeat])}</dd>` : ''}<dt>Who</dt><dd>${S.people.size + 1} staff${S.guests.length ? `, ${S.guests.length} guest${S.guests.length === 1 ? '' : 's'}` : ''}</dd><dt>Where</dt><dd>Favor meeting room in the hub</dd></dl></div>
      <div class="h-card mt-card"><div class="mt-toggle"><div><b>Email reminders</b><span>A day before and 15 minutes before, with the join link</span></div><button class="mt-sw${S.remind ? ' is-on' : ''}" data-sw="remind" aria-label="Email reminders"></button></div>
        <div class="mt-toggle"><div><b>Backup Google Meet link</b><span>In the invite in case the room ever fails to load</span></div><button class="mt-sw${S.backup ? ' is-on' : ''}" data-sw="backup" aria-label="Backup link"></button></div></div></aside></div>
      <div class="mt-foot"><button class="h-btn h-btn--ghost" data-step="2">${ic('back')}Back</button><button class="h-btn h-btn--primary" id="confirm" ${S.start ? '' : 'disabled'}>${ic('check')}Book it and send invites</button></div>`;
  }
  const keep = { id: document.activeElement && document.activeElement.id, v: document.activeElement && document.activeElement.value, p: document.activeElement && document.activeElement.selectionStart, at: document.activeElement && document.activeElement.matches && document.activeElement.matches('td.c') ? document.activeElement.dataset.at : '' };
  root.innerHTML = `${EDIT ? '<div class="mt-intro"><div><p>Pick a new time. Everyone gets an updated invitation.</p></div></div>' : stepsHTML()}${body}`;
  if (keep.id && $('#' + keep.id) && ['addp', 'addg', 'ttl', 'ag'].includes(keep.id)) { const el = $('#' + keep.id); el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.p, keep.p); } catch {} }
  if (keep.at) { const el = $(`td.c[data-at="${keep.at}"]`); if (el) { $$('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1')); el.setAttribute('tabindex', '0'); el.focus(); } }
}

function drawBooked() {
  const m = S.booked.meeting; const link = roomLink(m.id);
  const head = document.querySelector('.h-top__title'); if (head) head.textContent = 'Booked'; document.title = 'Booked';
  const end = new Date(Date.parse(m.startsAt) + (m.durationMin || S.dur) * 60000).toISOString();
  const repeatLine = m.repeat && m.repeat !== 'none' ? REPEAT[m.repeat] || '' : '';
  const everyone = [S.me, ...invited()].filter(Boolean).map((p) => ({ name: p.name || p.email, email: p.email }));
  root.innerHTML = `<div class="h-card mt-card" style="max-width:720px;margin:10px auto;display:grid;gap:16px;justify-items:start;grid-template-columns:minmax(0,1fr)">
    <span class="done-ic">${ic('check')}</span><div><h2 class="mt-h2">${esc(m.title)}</h2><p class="mt-sub" style="font-size:14px;margin:0">Booked for ${esc(etDay(m.startsAt))}, ${esc(etTime(m.startsAt))} to ${esc(etTime(end))} Eastern, ${m.durationMin || S.dur} min${repeatLine ? `. ${esc(repeatLine)}` : ''}.${S.booked.calendar ? ` Invites went to ${S.people.size + S.guests.length} ${S.people.size + S.guests.length === 1 ? 'person' : 'people'} and the meeting is on their Google Calendars.` : ''}</p></div>
    <div style="width:100%"><div class="h-label" style="margin-bottom:6px">Invited</div><div class="mt-people">${everyone.map((p) => `<span class="mt-person">${av(p.name)}${esc(p.name)}</span>`).join('')}${S.guests.map((g) => `<span class="mt-person mt-person--guest">${av(g)}${esc(g)}</span>`).join('')}</div></div>
    <div style="width:100%"><div class="h-label" style="margin-bottom:6px">Share link</div><div class="linkbox"><code>${esc(link.replace(/^https?:\/\//, ''))}</code><button class="h-btn h-btn--ghost h-btn--sm" id="cp">${ic('copy')}Copy</button></div></div>
    <ul class="nt-list"><li><span class="b">${ic('bell')}</span><span>${S.remind ? 'Reminder emails go out a day before and 15 minutes before the start, with the join link.' : 'No reminder emails. Google Calendar still shows its own reminder.'}</span></li>
    <li><span class="b">${ic('notes')}</span><span>${S.rec === 'off' ? 'No notes for this meeting.' : S.rec === 'video' ? 'Video, transcript and notes go to the Meetings folder in US Team Files and to Meeting notes in the hub.' : 'Transcript and notes go to Meeting notes in the hub.'}</span></li>
    ${m.backupLink ? `<li><span class="b">${ic('link')}</span><span>The invite carries a backup Google Meet link.</span></li>` : ''}</ul>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a><a class="h-btn h-btn--ghost" href="/meet/book/">Book another</a></div></div>`;
  $('#cp').addEventListener('click', () => copy(link));
}

// ---- events
root.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, td.c'); if (!t || t.disabled) return;
  if (t.dataset.team) { toggleTeam(t.dataset.team); save(); draw(); }
  else if (t.dataset.rm) { S.people.delete(t.dataset.rm); draw(); }
  else if (t.dataset.rg) { S.guests.splice(Number(t.dataset.rg), 1); draw(); }
  else if (t.id === 'addbtn') { const v = ($('#addp').value || '').trim().toLowerCase(); if (!v) return; const p = S.dir.find((x) => x.name.toLowerCase() === v) || S.dir.find((x) => x.name.toLowerCase().includes(v) || x.email.toLowerCase() === v); if (p) addPerson(p); else if (/^[^@\s]+@favorintl\.org$/.test(v)) addPerson(personByEmail(v)); else { toast('No one on staff by that name. Type a full Favor email address.'); return; } $('#addp').value = ''; draw(); }
  else if (t.id === 'startnow') { startNow_(t); }
  else if (t.id === 'addgbtn') { const v = ($('#addg').value || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Type a full email address'); return; } if (/@favorintl\.org$/.test(v)) { addPerson(personByEmail(v)); } else if (!S.guests.includes(v)) S.guests.push(v); $('#addg').value = ''; draw(); }
  else if (t.dataset.dur) { S.dur = Number(t.dataset.dur); S.busyKey = ''; draw(); }
  else if (t.dataset.step) {
    if (S.step === 3) capture();
    if (t.dataset.step === 'save') return reschedule();
    const to = Number(t.dataset.step);
    if (!stepOpen(to)) return;
    S.step = to;
    if (S.step === 3 && (!S.title || S.autoTitle)) { S.title = defaultTitle(); S.autoTitle = true; }
    if (S.step === 2 && !S.can.ok) S.fb = 'consent';
    save(); draw(); window.scrollTo(0, 0); if (S.step === 2) loadBusy();
  }
  else if (t.dataset.week) { S.week = Math.max(0, S.week + Number(t.dataset.week)); S.busyKey = ''; draw(); loadBusy(); }
  else if (t.dataset.at !== undefined) { S.start = t.dataset.at; draw(); }
  else if (t.dataset.rec) { S.rec = t.dataset.rec; capture(); draw(); }
  else if (t.dataset.repeat) { S.repeat = t.dataset.repeat; capture(); draw(); }
  else if (t.dataset.sw) { S[t.dataset.sw] = !S[t.dataset.sw]; capture(); draw(); }
  else if (t.id === 'confirm') confirm_();
  else if (t.id === 'allow') save();
});
// Keyboard on the time grid: arrows move between cells, Enter or Space picks the time.
root.addEventListener('keydown', (e) => {
  const c = e.target.closest && e.target.closest('td.c'); if (!c) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.start = c.dataset.at; draw(); return; }
  const dc = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0; const dr = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0; if (!dc && !dr) return;
  e.preventDefault();
  const row = c.parentElement; const col = Array.from(row.children).indexOf(c);
  const rows = Array.from(row.parentElement.children); const nr = rows[rows.indexOf(row) + dr]; if (!nr) return;
  const next = nr.children[Math.min(nr.children.length - 1, Math.max(1, col + dc))]; if (!next || !next.matches('td.c')) return;
  $$('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1')); next.setAttribute('tabindex', '0'); next.focus();
});
function capture() {
  if ($('#ttl')) { if ($('#ttl').value !== S.title) S.autoTitle = false; S.title = $('#ttl').value; }
  if ($('#ag')) S.agenda = $('#ag').value;
}

async function startNow_(btn) {
  capture();
  btn.disabled = true;
  try {
    const guests = S.guestsOn ? S.guests : [];
    const r = await api('meetings', { method: 'POST', body: {
      title: S.title.trim() || defaultTitle() || 'Meeting', rec: S.rec, access: 'invited',
      invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
    } });
    sessionStorage.removeItem('meet.book');
    location.href = '/meet/room/?m=' + r.meeting.id;
  } catch (e) { btn.disabled = false; toast(e.message); }
}

async function confirm_() {
  capture();
  if (!S.start) { toast('Pick a time first.'); return; }
  const btn = $('#confirm'); btn.disabled = true; btn.textContent = 'Booking';
  try {
    const guests = S.guestsOn ? S.guests : [];
    const r = await api('meetings', { method: 'POST', body: {
      title: S.title.trim() || defaultTitle() || 'Meeting', agenda: S.agenda, startsAt: S.start, durationMin: S.dur, rec: S.rec, access: 'invited', repeat: S.repeat, remind: S.remind, backup: S.backup,
      invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
    } });
    sessionStorage.removeItem('meet.book'); S.booked = r; draw();
    if (guests.length) api('meetings/' + r.meeting.id + '/guestlink', { method: 'POST', body: {} }).then((g) => {
      const box = document.createElement('div'); box.className = 'mt-guestlink';
      box.innerHTML = `<span class="h-label">Guest link</span><input readonly value="${esc(g.url)}" aria-label="Guest link"><button class="h-btn h-btn--ghost h-btn--sm" type="button">${ic('link')}Copy</button>`;
      box.querySelector('button').addEventListener('click', () => { navigator.clipboard.writeText(g.url).then(() => toast('Guest link copied')); });
      const done = document.querySelector('.done-ic'); (done ? done.parentElement : root).appendChild(box);
    }).catch(() => {});
  } catch (e) {
    btn.disabled = false; btn.innerHTML = `${ic('check')}Book it and send invites`;
    if (e.code === 'consent') { S.fb = 'consent'; S.fbMsg = e.message; S.step = 2; save(); draw(); } else toast(e.message);
  }
}
async function reschedule() {
  try { await api('meetings/' + EDIT + '/update', { method: 'POST', body: { startsAt: S.start } }); toast('Moved. Invitations updated.'); setTimeout(() => (location.href = '/meet/'), 900); } catch (e) { toast(e.message); }
}

load().catch((e) => { root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`; });
