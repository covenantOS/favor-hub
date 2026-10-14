// Booking: pick the people, find a time from everyone's Google Calendar (free and busy only), set the details, book it.
// The booker's own Google connection reads free/busy and puts the meeting on their calendar with the others invited.
import { $, $$, esc, ic, av, api, toast, copy, roomLink, whoami } from './ui.js';

const root = $('#mt-book');
const params = new URLSearchParams(location.search);
const EDIT = params.get('edit') || '';
const FOLLOW = params.get('follow') || '';
const TZ = 'America/New_York';
const HOURS = []; for (let h = 9; h < 17; h++) { HOURS.push([h, 0]); HOURS.push([h, 30]); }

const S = { post: '', channels: [], step: 1, dir: [], teams: new Set(), chipAdded: new Map(), people: new Map(), guests: [], dur: 60, start: '', title: '', autoTitle: false, agenda: '', rec: 'video', rule: newRule(), access: 'invited', team: '', driveFolder: '', templateId: '', templates: [], tplOpen: false, tplName: '', tplShare: false, optional: new Set(), buffer: 0, travel: 0, as: { state: 'idle', slots: [], people: [] }, asKey: '', multi: false, picked: new Set(), holdGrp: '', holdMsg: '', conf: { key: '', list: [], state: 'idle' }, hrsOn: false, scope: '', scopeAsk: false, remind: true, week: 0, busy: {}, fb: 'idle', me: null, booked: null, can: { ok: false, connected: false }, guestsOn: false, busyKey: '' };

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
const BTZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ; } catch { return TZ; } })();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];

// ---- repeat rules (the same shape the server stores)
function newRule() { return { freq: 'none', interval: 1, byDay: [], monthBy: 'date', end: { kind: 'never', count: 10, until: '' } }; }
const ruleOn = (r) => r && r.freq && r.freq !== 'none';
// The picked start, as an Eastern calendar day, with the weekday and which weekday of the month it is.
function baseOf(iso) {
  const p = parts(iso ? Date.parse(iso) : Date.now()); const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const dim = new Date(Date.UTC(p.y, p.mo, 0)).getUTCDate();
  return { ...p, wd, nth: Math.ceil(p.d / 7), last: p.d + 7 > dim };
}
const joinList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
function ruleText(r, startIso) {
  if (!ruleOn(r)) return '';
  const b = baseOf(startIso); const n = r.interval || 1; let t;
  if (r.freq === 'daily') t = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (r.freq === 'weekdays') t = 'Every weekday';
  else if (r.freq === 'weekly') t = `${n === 1 ? 'Every week' : `Every ${n} weeks`} on ${joinList((r.byDay.length ? [...r.byDay].sort() : [b.wd]).map((d) => DAY_NAMES[d]))}`;
  else if (r.freq === 'monthly') t = `${n === 1 ? 'Every month' : `Every ${n} months`} on ${r.monthBy === 'date' ? 'day ' + b.d : `the ${r.monthBy === 'last' || b.nth === 5 ? 'last' : ORD[b.nth]} ${DAY_NAMES[b.wd]}`}`;
  else t = `${n === 1 ? 'Every year' : `Every ${n} years`} on ${MONTHS[b.mo - 1]} ${b.d}`;
  if (r.end.kind === 'count') t += `, ${r.end.count} time${Number(r.end.count) === 1 ? '' : 's'}`;
  if (r.end.kind === 'until' && r.end.until) { const [y, mo, d] = r.end.until.split('-').map(Number); t += `, until ${new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })}`; }
  return t;
}
// The rule as it goes to the server, or null for a meeting that does not repeat.
function ruleOut(r, startIso) {
  if (!ruleOn(r)) return null;
  const b = baseOf(startIso);
  const end = r.end.kind === 'count' ? { kind: 'count', count: Math.max(1, Math.min(400, Number(r.end.count) || 1)) } : r.end.kind === 'until' && r.end.until ? { kind: 'until', until: r.end.until } : { kind: 'never' };
  return { freq: r.freq, interval: r.freq === 'weekdays' ? 1 : Math.max(1, Math.min(52, Number(r.interval) || 1)), byDay: r.freq === 'weekly' ? (r.byDay.length ? [...r.byDay].sort() : [b.wd]) : [], monthBy: r.monthBy, end };
}
// A rule from the server fills the editor.
function ruleIn(raw) {
  const r = newRule(); if (!raw || !raw.freq) return r;
  r.freq = raw.freq; r.interval = raw.interval || 1; r.byDay = raw.byDay || []; r.monthBy = raw.monthBy || 'date';
  if (raw.end) { r.end.kind = raw.end.kind || 'never'; if (raw.end.count) r.end.count = raw.end.count; if (raw.end.until) r.end.until = raw.end.until; }
  return r;
}
const bookerLocal = (iso) => (BTZ === TZ ? '' : new Date(iso).toLocaleString('en-US', { timeZone: BTZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));

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
  api('meetings/channels').then((r) => { S.channels = r.channels || []; if (S.step === 3) draw(); }).catch(() => {});
  try { const saved = JSON.parse(sessionStorage.getItem('meet.book') || 'null'); if (saved && params.get('google') === 'meetings') { S.step = saved.step || 3; S.teams = new Set(saved.teams); S.chipAdded = new Map(saved.chipAdded || []); S.autoTitle = !!saved.autoTitle; S.people = new Map(saved.people); S.guests = saved.guests; S.dur = saved.dur; S.start = saved.start; S.title = saved.title; S.agenda = saved.agenda; S.rec = saved.rec; S.rule = ruleIn(saved.rule); S.access = saved.access || 'invited'; S.team = saved.team || ''; S.driveFolder = saved.driveFolder || ''; S.templateId = saved.templateId || ''; S.optional = new Set(saved.optional || []); S.buffer = saved.buffer || 0; S.travel = saved.travel || 0; S.holdGrp = saved.holdGrp || ''; S.remind = saved.remind; } } catch {}
  try { S.templates = (await api('meetings/templates')).templates || []; } catch { S.templates = []; }
  if (EDIT) {
    const m = (await api('meetings/' + EDIT)).meeting;
    S.title = m.title; S.agenda = m.agenda; S.dur = m.durationMin; S.rec = m.rec; S.editing = m;
    for (const i of m.invitees) addPerson({ email: i.email, name: i.name, team: i.team });
    if (m.seriesId) { try { const sr = (await api('meetings/series/' + m.seriesId)).series; S.rule = ruleIn(sr.rule); S.ruleWas = JSON.stringify(ruleOut(S.rule, m.startsAt)); } catch { /* the pattern stays unchanged */ } }
    S.step = 2;
  }
  const wantTpl = params.get('template');
  if (wantTpl && !EDIT) { const t = S.templates.find((x) => x.id === wantTpl); if (t) applyTemplate(t); }
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
  if (S.step === 2) { loadBusy(); loadAssist(); if (S.start) checkConflicts(); }
}

function save() { sessionStorage.setItem('meet.book', JSON.stringify({ step: S.step, teams: [...S.teams], chipAdded: [...S.chipAdded], people: [...S.people], guests: S.guests, dur: S.dur, start: S.start, title: S.title, autoTitle: S.autoTitle, agenda: S.agenda, rec: S.rec, rule: S.rule, access: S.access, team: S.team, driveFolder: S.driveFolder, templateId: S.templateId, optional: [...S.optional], buffer: S.buffer, travel: S.travel, holdGrp: S.holdGrp, remind: S.remind })); }

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

// ---- templates
function applyTemplate(t) {
  S.templateId = t.id;
  if (t.title) { S.title = t.title; S.autoTitle = false; }
  S.agenda = t.agenda || ''; S.dur = t.durationMin || 60;
  if (['notes', 'video', 'off'].includes(t.rec)) S.rec = t.rec;
  if (t.access) S.access = t.access;
  S.team = t.team || ''; S.driveFolder = t.driveFolder || '';
  for (const i of t.invitees || []) {
    const e = String(i.email || '').toLowerCase(); if (!e) continue;
    if (i.guest) { if (S.guestsOn && !S.guests.includes(e)) S.guests.push(e); continue; }
    const p = personByEmail(e); addPerson({ email: e, name: p.name !== e ? p.name : i.name || e, team: p.team || i.team || '' });
  }
  S.rule = ruleIn(t.rule); S.busyKey = ''; S.asKey = '';
}
async function saveTemplate_() {
  capture();
  const name = S.tplName.trim(); if (!name) { toast('Name the template.'); return; }
  try {
    const guests = S.guestsOn ? S.guests : [];
    const body = {
      name, title: S.title, agenda: S.agenda, durationMin: S.dur, rec: S.rec, access: S.access, team: S.team, driveFolder: S.driveFolder, shared: S.tplShare, rule: ruleOut(S.rule, S.start),
      invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
    };
    const r = await api('meetings/templates', { method: 'POST', body });
    S.templates = (await api('meetings/templates')).templates || []; S.templateId = r.id; S.tplOpen = false; S.tplName = ''; S.tplShare = false; save(); draw(); toast('Template saved');
  } catch (e) { toast(e.message); }
}
function templateHTML() {
  return `<div class="sc-tpl"><div class="mt-f"><label for="sc-tpl">Start from a template</label>
    <select id="sc-tpl"><option value="">No template</option>${S.templates.map((t) => `<option value="${esc(t.id)}"${S.templateId === t.id ? ' selected' : ''}>${esc(t.name)}${t.shared && !t.mine ? ' (shared)' : ''}</option>`).join('')}</select></div>
    ${S.tplOpen ? `<div class="sc-tpl-new"><div class="mt-f"><label for="sc-tname">Template name</label><input id="sc-tname" value="${esc(S.tplName)}" maxlength="80" /></div>
      <label class="sc-check"><input type="checkbox" id="sc-tshare"${S.tplShare ? ' checked' : ''}>Share with all staff</label>
      <div class="sc-row"><button class="h-btn h-btn--primary h-btn--sm" id="sc-tsave">Save template</button><button class="h-btn h-btn--ghost h-btn--sm" id="sc-tcancel">Cancel</button></div></div>`
    : `<div class="sc-row"><button class="h-btn h-btn--ghost h-btn--sm" id="sc-topen">Save as template</button></div>`}</div>`;
}

// ---- repeat editor
const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
function repeatHTML() {
  const r = S.rule; const b = baseOf(S.start); const on = ruleOn(r);
  const opts = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Weekly on chosen days'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
  const unit = UNIT[r.freq] || '';
  const mopts = [['date', `On day ${b.d}`]]; if (b.nth <= 4) mopts.push(['weekday', `On the ${ORD[b.nth]} ${DAY_NAMES[b.wd]}`]); if (b.last) mopts.push(['last', `On the last ${DAY_NAMES[b.wd]}`]);
  const mval = mopts.some((x) => x[0] === r.monthBy) ? r.monthBy : 'date';
  const sentence = on ? ruleText(r, S.start) : '';
  const minDate = `${b.y}-${String(b.mo).padStart(2, '0')}-${String(b.d).padStart(2, '0')}`;
  return `<div class="sc-rep"><div class="h-label" style="margin-bottom:8px">Repeats</div>
    <div class="mt-f"><select id="sc-freq" aria-label="Repeats">${opts.map(([k, l]) => `<option value="${k}"${r.freq === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    ${on && r.freq !== 'weekdays' ? `<div class="sc-every"><label for="sc-int">Every</label><input id="sc-int" type="number" min="1" max="52" inputmode="numeric" value="${esc(r.interval)}"><span>${unit}${Number(r.interval) === 1 ? '' : 's'}</span></div>` : ''}
    ${r.freq === 'weekly' ? `<div class="sc-days" role="group" aria-label="Days of the week">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => { const sel = (r.byDay.length ? r.byDay : [b.wd]).includes(i); return `<button type="button" class="sc-day${sel ? ' is-on' : ''}" data-sday="${i}" aria-pressed="${sel}" aria-label="${DAY_NAMES[i]}">${l}</button>`; }).join('')}</div>` : ''}
    ${r.freq === 'monthly' ? `<div class="mt-f"><select id="sc-mby" aria-label="Monthly pattern">${mopts.map(([k, l]) => `<option value="${k}"${mval === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
    ${on ? `<div class="sc-end"><div class="mt-f"><label for="sc-end">Ends</label><select id="sc-end"><option value="never"${r.end.kind === 'never' ? ' selected' : ''}>Never</option><option value="count"${r.end.kind === 'count' ? ' selected' : ''}>After a number of meetings</option><option value="until"${r.end.kind === 'until' ? ' selected' : ''}>On a date</option></select></div>
      ${r.end.kind === 'count' ? `<div class="sc-every"><label for="sc-cnt">After</label><input id="sc-cnt" type="number" min="1" max="400" inputmode="numeric" value="${esc(r.end.count)}"><span>meeting${Number(r.end.count) === 1 ? '' : 's'}</span></div>` : ''}
      ${r.end.kind === 'until' ? `<div class="mt-f"><label for="sc-unt">Last day</label><input id="sc-unt" type="date" value="${esc(r.end.until)}" min="${minDate}"></div>` : ''}</div>
      <p class="sc-sentence">${esc(sentence)}</p>` : ''}</div>`;
}
// A change in the repeat editor. Returns true when the target belonged to it.
function ruleChange(t) {
  const r = S.rule; const b = baseOf(S.start);
  if (t.id === 'sc-freq') { r.freq = t.value; if (r.freq === 'weekly' && !r.byDay.length) r.byDay = [b.wd]; if (r.freq === 'weekdays') r.interval = 1; }
  else if (t.id === 'sc-int') r.interval = Math.max(1, Math.min(52, Number(t.value) || 1));
  else if (t.id === 'sc-mby') r.monthBy = t.value;
  else if (t.id === 'sc-end') { r.end.kind = t.value; if (t.value === 'until' && !r.end.until) r.end.until = new Date(Date.UTC(b.y, b.mo + 2, b.d)).toISOString().slice(0, 10); }
  else if (t.id === 'sc-cnt') r.end.count = Math.max(1, Math.min(400, Number(t.value) || 1));
  else if (t.id === 'sc-unt') r.end.until = t.value;
  else return false;
  return true;
}

// ---- scheduling assistant
const optList = () => [...S.optional].filter((e) => S.people.has(e));
async function loadAssist() {
  if (!S.can.ok || !hasWho()) return;
  const days = weekDays(S.week); const first = days[0], last = days[days.length - 1];
  const from = new Date(Math.max(Date.now(), etInstant(first.y, first.mo, first.d, 0, 0))).toISOString(); const to = new Date(etInstant(last.y, last.mo, last.d, 23, 59)).toISOString();
  const key = [from, [...S.people.keys()].sort().join(','), optList().sort().join(','), S.dur, S.buffer, S.travel].join('|');
  if (S.asKey === key) return;
  S.asKey = key; S.as.state = 'loading'; draw();
  try {
    const body = { emails: [...S.people.keys()], optional: optList(), from, to, durationMin: S.dur, bufferMin: S.buffer, travelMin: S.travel };
    const r = await api('meetings/assist', { method: 'POST', body });
    if (S.asKey !== key) return;
    S.as = { state: 'ok', slots: r.slots || [], people: r.people || [] };
  } catch (e) { if (S.asKey !== key) return; S.as = { state: 'error', slots: [], people: [], msg: e.message }; }
  draw();
}
const clock = (m) => `${Math.floor(m / 60) % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${m < 720 || m >= 1440 ? 'AM' : 'PM'}`;
const zoneName = (tz) => { try { return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName').value; } catch { return tz; } };
const isAre = (e) => (nameOf(e) === 'You' ? 'are' : 'is');
function slotLines(sl) {
  const lines = [];
  const zones = S.as.people.filter((p) => p.tz && p.tz !== TZ && sl.local && sl.local[p.email]);
  if (zones.length) lines.push(`<span class="sc-local">${zones.map((p) => `${esc(nameOf(p.email))} ${esc(sl.local[p.email])}`).join(', ')}</span>`);
  const miss = [...(sl.busy || []).map((e) => `${nameOf(e)} ${isAre(e)} busy`), ...(sl.outside || []).map((e) => `${nameOf(e)} ${isAre(e)} outside working hours`)];
  if (miss.length) lines.push(`<span class="sc-miss">${esc(miss.join('. '))}</span>`);
  return lines.join('');
}
function assistHTML() {
  const A = S.as; const people = [...S.people.values()];
  const me = (S.me.email || '').toLowerCase();
  const none = A.people.filter((p) => p.source === 'none' && p.email !== me).map((p) => nameOf(p.email));
  const sel = (id, label, vals, cur) => `<div class="mt-f"><label for="${id}">${label}</label><select id="${id}">${vals.map((v) => `<option value="${v}"${cur === v ? ' selected' : ''}>${v ? v + ' min' : 'None'}</option>`).join('')}</select></div>`;
  const slots = A.slots.slice(0, 8);
  return `<section class="h-card mt-card sc-assist"><div class="sc-head"><h3 class="mt-h3" style="margin:0">Suggested times</h3><span class="mt-sub">Times in Eastern${BTZ !== TZ ? '. Your zone is ' + esc(zoneName(BTZ)) : ''}</span></div>
    <div class="sc-ctl">${sel('sc-buf', 'Buffer', [0, 5, 10, 15], S.buffer)}${sel('sc-trv', 'Travel time', [0, 15, 30, 60], S.travel)}</div>
    ${people.length ? `<div class="sc-who">${people.map((p) => { const o = S.optional.has(p.email); return `<span class="sc-pp${o ? ' is-opt' : ''}">${esc(p.name)}<button type="button" data-opt="${esc(p.email)}" aria-pressed="${o}" aria-label="${o ? 'Make ' + esc(p.name) + ' required' : 'Make ' + esc(p.name) + ' optional'}">${o ? 'Optional' : 'Required'}</button></span>`; }).join('')}</div>` : ''}
    ${A.state === 'ok' && none.length ? `<p class="mt-sub sc-none">No calendar for: ${esc(none.join(', '))}. Times show only their FavorOS meetings.</p>` : ''}
    ${A.state === 'loading' ? '<p class="mt-sub">Finding times.</p>' : ''}
    ${A.state === 'error' ? `<p class="mt-sub">${esc(A.msg || 'Suggestions did not load.')} Pick a time on the grid.</p>` : ''}
    ${A.state === 'ok' && !slots.length ? '<p class="mt-sub">No times fit in this week. Try the next week or a shorter meeting.</p>' : ''}
    ${slots.length ? `<div class="sc-list">${slots.map((sl) => { const on = !S.multi && S.start && Date.parse(S.start) === Date.parse(sl.start); const ck = S.picked.has(sl.start); const part = (sl.busy && sl.busy.length) || (sl.outside && sl.outside.length);
      return `<button type="button" class="sc-slot${on ? ' is-on' : ''}${ck ? ' is-ck' : ''}" data-sug="${esc(sl.start)}" ${S.multi ? `role="checkbox" aria-checked="${ck}"` : ''}>${S.multi ? `<i class="sc-box${ck ? ' is-on' : ''}"></i>` : ''}<b>${esc(etDay(sl.start))}, ${esc(etTime(sl.start))} to ${esc(etTime(sl.end))}</b>${part ? '' : '<span class="mt-pill mt-pill--ok sc-pill">Everyone is free</span>'}${slotLines(sl)}</button>`; }).join('')}</div>` : ''}
    <div class="sc-row">${slots.length > 1 ? `<button class="h-btn h-btn--ghost h-btn--sm" id="sc-multi">${S.multi ? 'Done selecting' : 'Select times to hold'}</button>` : ''}${S.multi ? `<button class="h-btn h-btn--primary h-btn--sm" id="sc-hold" ${S.picked.size >= 2 && S.picked.size <= 4 ? '' : 'disabled'}>Hold these times</button><span class="mt-sub">${S.picked.size} selected, pick 2 to 4</span>` : ''}${S.holdGrp ? '<button class="h-btn h-btn--ghost h-btn--sm" id="sc-release">Release holds</button>' : ''}</div>
    ${S.holdMsg ? `<p class="mt-sub">${esc(S.holdMsg)}</p>` : ''}
    ${A.people.length ? `<button type="button" class="sc-link" id="sc-hrs" aria-expanded="${S.hrsOn}">Working hours</button>${S.hrsOn ? `<ul class="sc-hours">${A.people.map((p) => `<li><span>${esc(nameOf(p.email))}</span><span>${clock(p.dayStart)} to ${clock(p.dayEnd)} ${esc(zoneName(p.tz))}</span><i class="sc-bar" style="--a:${(p.dayStart / 14.4).toFixed(1)}%;--w:${((p.dayEnd - p.dayStart) / 14.4).toFixed(1)}%"></i></li>`).join('')}</ul>` : ''}` : ''}
  </section>`;
}
async function holdTimes() {
  const picks = [...S.picked]; if (picks.length < 2 || picks.length > 4) return;
  const btn = $('#sc-hold'); if (btn) btn.disabled = true;
  try {
    const slots = picks.map((a) => ({ startsAt: a, endsAt: new Date(Date.parse(a) + S.dur * 60000).toISOString() }));
    const r = await api('meetings/holds', { method: 'POST', body: { title: S.title.trim() || defaultTitle() || 'Meeting', slots } });
    if (S.holdGrp && S.holdGrp !== r.grp) api('meetings/holds/release', { method: 'POST', body: { grp: S.holdGrp } }).catch(() => {});
    S.holdGrp = r.grp; S.holdMsg = `Holding ${picks.length} times on your calendar. Booking one releases the others.`; S.multi = false; S.picked = new Set(); save(); draw();
  } catch (e) { toast(e.message); draw(); }
}

// ---- conflicts: a warning only, booking is never blocked
const WHY = { meeting: ['has another meeting', 'have another meeting'], busy: ['is busy', 'are busy'], outside: ['is outside working hours', 'are outside working hours'] };
async function checkConflicts() {
  if (!S.start) return;
  const startsAt = S.start; const endsAt = new Date(Date.parse(startsAt) + S.dur * 60000).toISOString(); const key = startsAt + '|' + S.dur + '|' + emailsAll().join(',');
  if (S.conf.key === key && S.conf.state === 'ok') return;
  S.conf = { key, list: [], state: 'loading' };
  try {
    const r = await api('meetings/conflicts', { method: 'POST', body: { startsAt, endsAt, emails: emailsAll(), skipId: EDIT || undefined } });
    if (S.conf.key !== key) return;
    S.conf = { key, list: r.conflicts || [], state: 'ok' };
  } catch { if (S.conf.key !== key) return; S.conf = { key, list: [], state: 'error' }; }
  draw();
}
function conflictHTML() {
  if (S.conf.state !== 'ok' || !S.conf.list.length || !S.start) return '';
  const me = (S.me.email || '').toLowerCase();
  const lines = S.conf.list.map((c) => { const you = c.email === me; return `${esc(nameOf(c.email))} ${(WHY[c.why] || WHY.busy)[you ? 1 : 0]}${c.why === 'meeting' && c.title && you ? ' (' + esc(c.title) + ')' : ''}`; });
  return `<div class="mt-note mt-note--gold sc-warn" role="status"><b>Heads up.</b> ${lines.join('. ')}. You can still book this time.</div>`;
}
function pickedHTML() {
  if (!S.start) return '';
  const end = new Date(Date.parse(S.start) + S.dur * 60000).toISOString(); const loc = bookerLocal(S.start);
  return `<p class="mt-sub sc-picked">Picked: ${esc(etDay(S.start))}, ${esc(etTime(S.start))} to ${esc(etTime(end))} Eastern${loc ? `. Your time: ${esc(loc)}` : ''}</p>`;
}
// Editing one meeting of a series: which meetings the change reaches.
function drawScope() {
  const m = S.editing; const when = `${etDay(S.start)}, ${etTime(S.start)} Eastern`;
  const choices = [['this', 'This meeting', 'Only the meeting on ' + etDay(m.startsAt) + '.'], ['following', 'This and following meetings', 'This meeting and every later one in the series.'], ['all', 'All meetings', 'Every meeting in the series, past ones stay as they were.']];
  root.innerHTML = `<div class="mt-intro"><div><p>Change which meetings?</p></div></div>
    <section class="h-card mt-card" style="display:grid;gap:14px;max-width:720px;margin:0 auto">
      <p class="mt-sub" style="margin:0">New time: ${esc(when)}</p>
      <div class="mt-opt">${choices.map(([k, t, d]) => `<button class="${S.scope === k ? 'is-on' : ''}" data-scope="${k}"><i class="dot"></i><div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div>
      ${S.scope && S.scope !== 'this' ? repeatHTML() : ''}
    </section>
    <div class="mt-foot"><button class="h-btn h-btn--ghost" data-scopeback="1">${ic('back')}Back</button><button class="h-btn h-btn--primary" id="sc-savescope" ${S.scope ? '' : 'disabled'}>Save the change</button></div>`;
}
const pickTime = (iso) => { S.start = iso; draw(); checkConflicts(); };

// ---- drawing
const stepOpen = (n) => n <= S.step || (n === 2 && hasWho()) || (n === 3 && hasWho() && !!S.start && S.can.ok);
const stepsHTML = () => `<div class="mt-steps">${['Who', 'When', 'Details'].map((l, i) => `<button class="mt-step${S.step === i + 1 ? ' is-on' : S.step > i + 1 ? ' is-done' : ''}" data-step="${i + 1}" ${stepOpen(i + 1) ? '' : 'disabled'}><i>${S.step > i + 1 ? '✓' : i + 1}</i>${l}</button>`).join('')}</div>`;
const person = (p) => `<span class="mt-person">${av(p.name)}${esc(p.name)}<button data-rm="${esc(p.email)}" aria-label="Remove ${esc(p.name)}">${ic('x')}</button></span>`;

function draw() {
  if (S.booked) return drawBooked();
  if (S.scopeAsk) return drawScope();
  let body = '';
  if (S.step === 1) {
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:16px">
      <div><h3 class="mt-h3">Pick a team or a group</h3><div class="mt-chips">${teamsList().map(([t, n]) => `<button class="mt-chip${S.teams.has(t) ? ' is-on' : ''}" data-team="${esc(t)}">${esc(t)}<span>${n}</span></button>`).join('')}</div></div>
      <div><h3 class="mt-h3">Add people</h3><div class="mt-add"><input id="addp" aria-label="Add people" placeholder="Name or Favor email" list="plist" autocomplete="off" /><button class="h-btn h-btn--ghost h-btn--sm" id="addbtn">${ic('plus')}Add</button></div>
        <datalist id="plist">${S.dir.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><h3 class="mt-h3">${S.people.size + S.guests.length} invited</h3><div class="mt-people">${invited().map(person).join('')}${S.guests.map((g, i) => `<span class="mt-person mt-person--guest">${av(g)}${esc(g)}<button data-rg="${i}" aria-label="Remove">${ic('x')}</button></span>`).join('')}</div></div>
      ${S.guestsOn ? `<div><h3 class="mt-h3">Guests from outside Favor</h3><div class="mt-add"><input id="addg" aria-label="Guest email address" placeholder="Email address" /><button class="h-btn h-btn--ghost h-btn--sm" id="addgbtn">${ic('plus')}Add guest</button></div></div>` : ''}
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
    body = `${hasWho() ? assistHTML() : ''}<div class="mt-grid"><section class="h-card mt-card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><h3 class="mt-h3" style="margin:0">${S.week ? 'Week ' + (S.week + 1) : 'The next seven days'}, ${total} people, ${S.dur} minutes</h3><span style="display:flex;gap:6px;align-items:center"><span class="mt-sub">Times in Eastern</span><button class="icon-b" data-week="-1" ${S.week ? '' : 'disabled'} aria-label="Earlier">${ic('chevl')}</button><button class="icon-b" data-week="1" aria-label="Later">${ic('chev')}</button></span></div>
      ${S.fb === 'loading' ? '<p class="mt-sub">Reading calendars.</p>' : ''}
      ${S.fb === 'error' ? `<div class="mt-note mt-note--gold" style="margin-bottom:10px">${esc(S.fbMsg || 'Calendars did not load.')} You can still pick a time below.</div>` : ''}
      ${S.fb === 'ok' && unk.length ? `<p class="mt-sub" style="margin:0 0 8px">${esc(listNames(unk))}: calendar could not be read, so ${unk.length === 1 ? 'that time is' : 'those times are'} not checked.</p>` : ''}
      <div class="fb"><table role="grid" aria-label="Times in Eastern time. Use the arrow keys to move and Enter to pick."><thead><tr><th></th>${days.map((d) => `<th>${WD[d.wd]} ${d.d}</th>`).join('')}</tr></thead><tbody>
      ${HOURS.map((hm, r) => `<tr><td class="h">${r % 2 ? '' : hourLabel(hm[0])}</td>${days.map((d) => cell(d, hm)).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="fb-key"><span><i style="background:#cfdcc6"></i>Everyone free</span><span><i style="background:#e8e1cc"></i>A few busy</span><span><i style="background:#ecd7c6"></i>Several busy</span><span><i style="background:#e2bfae"></i>Many busy</span><span><i style="background:var(--h-brand)"></i>Your pick</span></div></section>
      <aside class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Best times</div><div class="slots">${slots.length ? slots.map((s) => `<button class="slot${S.start && Date.parse(S.start) === s.s ? ' is-on' : ''}" data-at="${new Date(s.s).toISOString()}"><b>${WD[s.d.wd]} ${s.d.mo}/${s.d.d}, ${etTime(new Date(s.s).toISOString())} to ${etTime(new Date(s.e).toISOString())}</b>${s.clash ? `<span class="mt-pill mt-pill--gold" style="height:22px;grid-column:auto">${s.total - s.clash} of ${s.total}</span>` : unk.length ? '' : '<span class="mt-pill mt-pill--ok" style="height:22px">All free</span>'}<span>${esc(slotNote(s, unk))}</span></button>`).join('') : '<p class="mt-sub">Pick a time on the grid.</p>'}</div></aside></div>
      ${pickedHTML()}${conflictHTML()}
      <div class="mt-foot">${EDIT ? '' : `<button class="h-btn h-btn--ghost" data-step="1">${ic('back')}Back</button>`}<button class="h-btn h-btn--primary" data-step="${EDIT ? 'save' : '3'}" ${S.start ? '' : 'disabled'}>${EDIT ? 'Move the meeting' : 'Use this time'}${EDIT ? '' : ic('chev')}</button></div>`;
  } else {
    const when = S.start ? `${etDay(S.start)}, ${etTime(S.start)} to ${etTime(new Date(Date.parse(S.start) + S.dur * 60000).toISOString())} Eastern` : '';
    const local = S.start ? bookerLocal(S.start) : '';
    body = `<div class="mt-grid"><section class="h-card mt-card" style="display:grid;gap:14px">
      ${templateHTML()}
      <div class="mt-f"><label for="ttl">Title</label><input id="ttl" value="${esc(S.title)}" placeholder="Meeting title" maxlength="140" /></div>
      <div class="mt-f"><label for="ag">Agenda</label><textarea id="ag" maxlength="2000">${esc(S.agenda)}</textarea></div>
      <div><div class="h-label" style="margin-bottom:8px">Record</div><div class="mt-opt">
        ${[['notes', 'Transcript and notes', 'Sound only. Notes, decisions and action items land in FavorOS after the meeting.'], ['video', 'Video recording too', 'The video goes to the Meetings folder in US Team Files, with the notes beside it.'], ['off', 'Nothing', 'No recording and no notes.']].map(([k, t, d]) => `<button class="${S.rec === k ? 'is-on' : ''}" data-rec="${k}"><i class="dot"></i><div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div></div>
      ${S.channels.length ? `<div class="mt-f"><label for="postch">Post the summary to</label><select id="postch"><option value="">Nowhere</option>${S.channels.map((c) => `<option value="${esc(c.id)}"${S.post === c.id ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</select>${S.rec === 'off' ? '<span class="mt-sub">Recording is off, so there is no summary to post.</span>' : '<span class="mt-sub">When the notes are ready, the summary, decisions and action items go there and each owner is mentioned.</span>'}</div>` : ''}
      <div class="sc-two"><div class="mt-f"><label for="sc-team">Team</label><select id="sc-team"><option value="">No team</option>${teamsList().slice(1).map(([t]) => `<option value="${esc(t)}"${S.team === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
        <div class="mt-f"><label for="sc-drive">Drive notes folder</label><input id="sc-drive" value="${esc(S.driveFolder)}" placeholder="Folder link or ID" maxlength="200" /></div></div>
      ${repeatHTML()}
    </section><aside class="mt-stack"><div class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Summary</div><dl class="kv"><dt>When</dt><dd>${esc(when)}${local ? `<br><span class="mt-sub">Your time: ${esc(local)}</span>` : ''}</dd>${ruleOn(S.rule) ? `<dt>Repeats</dt><dd>${esc(ruleText(S.rule, S.start))}</dd>` : ''}<dt>Who</dt><dd>${S.people.size + 1} staff${S.guests.length ? `, ${S.guests.length} guest${S.guests.length === 1 ? '' : 's'}` : ''}</dd><dt>Where</dt><dd>Favor meeting room in FavorOS</dd></dl></div>
      <div class="h-card mt-card"><div class="mt-toggle"><div><b>Email reminders</b><span>A day before and ${S.can.leadMin || 15} minutes before, with the join link</span></div><button class="mt-sw${S.remind ? ' is-on' : ''}" data-sw="remind" aria-label="Email reminders"></button></div>
        </div></aside></div>
      ${conflictHTML()}
      <div class="mt-foot"><button class="h-btn h-btn--ghost" data-step="2">${ic('back')}Back</button><button class="h-btn h-btn--primary" id="confirm" ${S.start ? '' : 'disabled'}>${ic('check')}Book it and send invites</button></div>`;
  }
  const keep = { id: document.activeElement && document.activeElement.id, v: document.activeElement && document.activeElement.value, p: document.activeElement && document.activeElement.selectionStart, at: document.activeElement && document.activeElement.matches && document.activeElement.matches('td.c') ? document.activeElement.dataset.at : '' };
  root.innerHTML = `${EDIT ? '<div class="mt-intro"><div><p>Pick a new time. Everyone gets an updated invitation.</p></div></div>' : stepsHTML()}${body}`;
  if (keep.id && $('#' + keep.id) && ['addp', 'addg', 'ttl', 'ag', 'sc-tname', 'sc-drive'].includes(keep.id)) { const el = $('#' + keep.id); el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.p, keep.p); } catch {} }
  if (keep.at) { const el = $(`td.c[data-at="${keep.at}"]`); if (el) { $$('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1')); el.setAttribute('tabindex', '0'); el.focus(); } }
}

function drawBooked() {
  const m = S.booked.meeting; const link = roomLink(m.id);
  document.title = 'Booked - FavorOS';
  const end = new Date(Date.parse(m.startsAt) + (m.durationMin || S.dur) * 60000).toISOString();
  const repeatLine = S.bookedRule || '';
  const everyone = [S.me, ...invited()].filter(Boolean).map((p) => ({ name: p.name || p.email, email: p.email }));
  root.innerHTML = `<div class="h-card mt-card" style="max-width:720px;margin:10px auto;display:grid;gap:16px;justify-items:start;grid-template-columns:minmax(0,1fr)">
    <span class="done-ic">${ic('check')}</span><div><h2 class="mt-h2">${esc(m.title)}</h2><p class="mt-sub" style="font-size:14px;margin:0">Booked for ${esc(etDay(m.startsAt))}, ${esc(etTime(m.startsAt))} to ${esc(etTime(end))} Eastern, ${m.durationMin || S.dur} min${repeatLine ? `. ${esc(repeatLine)}` : ''}.${S.booked.calendar ? ` Invites went to ${S.people.size + S.guests.length} ${S.people.size + S.guests.length === 1 ? 'person' : 'people'} and the meeting is on their Google Calendars.` : ''}</p></div>
    <div style="width:100%"><div class="h-label" style="margin-bottom:6px">Invited</div><div class="mt-people">${everyone.map((p) => `<span class="mt-person">${av(p.name)}${esc(p.name)}</span>`).join('')}${S.guests.map((g) => `<span class="mt-person mt-person--guest">${av(g)}${esc(g)}</span>`).join('')}</div></div>
    <div style="width:100%"><div class="h-label" style="margin-bottom:6px">Share link</div><div class="linkbox"><code>${esc(link.replace(/^https?:\/\//, ''))}</code><button class="h-btn h-btn--ghost h-btn--sm" id="cp">${ic('copy')}Copy</button></div></div>
    <ul class="nt-list"><li><span class="b">${ic('bell')}</span><span>${S.remind ? `Reminder emails go out a day before and ${S.can.leadMin || 15} minutes before the start, with the join link.` : 'No reminder emails. Google Calendar still shows its own reminder.'}</span></li>
    <li><span class="b">${ic('notes')}</span><span>${S.rec === 'off' ? 'No notes for this meeting.' : S.rec === 'video' ? 'Video, transcript and notes go to the Meetings folder in US Team Files and to Meeting notes in FavorOS.' : 'Transcript and notes go to Meeting notes in FavorOS.'}</span></li>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><a class="h-btn h-btn--primary" href="/meet/">Back to meetings</a>${S.booked.seriesId ? `<a class="h-btn h-btn--ghost" href="/meet/series/?id=${encodeURIComponent(S.booked.seriesId)}">Open the series</a>` : ''}<a class="h-btn h-btn--ghost" href="/meet/book/">Book another</a></div></div>`;
  $('#cp').addEventListener('click', () => copy(link));
}

// ---- events
root.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, td.c'); if (!t || t.disabled) return;
  if (t.dataset.team) { toggleTeam(t.dataset.team); save(); draw(); }
  else if (t.dataset.rm) { S.people.delete(t.dataset.rm); S.optional.delete(t.dataset.rm); S.asKey = ''; S.conf.key = ''; draw(); }
  else if (t.dataset.rg) { S.guests.splice(Number(t.dataset.rg), 1); draw(); }
  else if (t.id === 'addbtn') { const v = ($('#addp').value || '').trim().toLowerCase(); if (!v) return; const p = S.dir.find((x) => x.name.toLowerCase() === v) || S.dir.find((x) => x.name.toLowerCase().includes(v) || x.email.toLowerCase() === v); if (p) addPerson(p); else if (/^[^@\s]+@favorintl\.org$/.test(v)) addPerson(personByEmail(v)); else { toast('No one on staff by that name. Type a full Favor email address.'); return; } $('#addp').value = ''; draw(); }
  else if (t.id === 'startnow') { startNow_(t); }
  else if (t.id === 'addgbtn') { const v = ($('#addg').value || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Type a full email address'); return; } if (/@favorintl\.org$/.test(v)) { addPerson(personByEmail(v)); } else if (!S.guests.includes(v)) S.guests.push(v); $('#addg').value = ''; draw(); }
  else if (t.dataset.dur) { S.dur = Number(t.dataset.dur); S.busyKey = ''; draw(); }
  else if (t.dataset.sday) { const d = Number(t.dataset.sday); const b = baseOf(S.start); const cur = S.rule.byDay.length ? S.rule.byDay : [b.wd]; S.rule.byDay = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]; if (!S.rule.byDay.length) S.rule.byDay = [d]; capture(); save(); draw(); }
  else if (t.dataset.scope) { S.scope = t.dataset.scope; draw(); }
  else if (t.dataset.scopeback) { S.scopeAsk = false; draw(); }
  else if (t.id === 'sc-savescope') saveEdit();
  else if (t.dataset.opt) { const e = t.dataset.opt; if (S.optional.has(e)) S.optional.delete(e); else S.optional.add(e); S.asKey = ''; save(); loadAssist(); }
  else if (t.dataset.sug) { if (S.multi) { if (S.picked.has(t.dataset.sug)) S.picked.delete(t.dataset.sug); else if (S.picked.size < 4) S.picked.add(t.dataset.sug); else toast('Hold up to 4 times.'); draw(); } else pickTime(t.dataset.sug); }
  else if (t.id === 'sc-multi') { S.multi = !S.multi; S.picked = new Set(); S.holdMsg = ''; draw(); }
  else if (t.id === 'sc-hold') holdTimes();
  else if (t.id === 'sc-release') { const g = S.holdGrp; S.holdGrp = ''; S.holdMsg = 'Holds released.'; save(); draw(); api('meetings/holds/release', { method: 'POST', body: { grp: g } }).catch((er) => toast(er.message)); }
  else if (t.id === 'sc-hrs') { S.hrsOn = !S.hrsOn; draw(); }
  else if (t.id === 'sc-topen') { capture(); S.tplOpen = true; draw(); const n = $('#sc-tname'); if (n) n.focus(); }
  else if (t.id === 'sc-tcancel') { S.tplOpen = false; draw(); }
  else if (t.id === 'sc-tsave') saveTemplate_();
  else if (t.dataset.step) {
    if (S.step === 3) capture();
    if (t.dataset.step === 'save') return reschedule();
    const to = Number(t.dataset.step);
    if (!stepOpen(to)) return;
    S.step = to;
    if (S.step === 3 && (!S.title || S.autoTitle)) { S.title = defaultTitle(); S.autoTitle = true; }
    if (S.step === 2 && !S.can.ok) S.fb = 'consent';
    save(); draw(); window.scrollTo(0, 0); if (S.step === 2) { loadBusy(); loadAssist(); if (S.start) checkConflicts(); }
  }
  else if (t.dataset.week) { S.week = Math.max(0, S.week + Number(t.dataset.week)); S.busyKey = ''; draw(); loadBusy(); loadAssist(); }
  else if (t.dataset.at !== undefined) pickTime(t.dataset.at);
  else if (t.dataset.rec) { S.rec = t.dataset.rec; capture(); draw(); }
  else if (t.dataset.sw) { S[t.dataset.sw] = !S[t.dataset.sw]; capture(); draw(); }
  else if (t.id === 'confirm') confirm_();
  else if (t.id === 'allow') save();
});
// Keyboard on the time grid: arrows move between cells, Enter or Space picks the time.
root.addEventListener('keydown', (e) => {
  const c = e.target.closest && e.target.closest('td.c'); if (!c) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTime(c.dataset.at); return; }
  const dc = { ArrowLeft: -1, ArrowRight: 1 }[e.key] || 0; const dr = { ArrowUp: -1, ArrowDown: 1 }[e.key] || 0; if (!dc && !dr) return;
  e.preventDefault();
  const row = c.parentElement; const col = Array.from(row.children).indexOf(c);
  const rows = Array.from(row.parentElement.children); const nr = rows[rows.indexOf(row) + dr]; if (!nr) return;
  const next = nr.children[Math.min(nr.children.length - 1, Math.max(1, col + dc))]; if (!next || !next.matches('td.c')) return;
  $$('td.c[tabindex="0"]').forEach((x) => x.setAttribute('tabindex', '-1')); next.setAttribute('tabindex', '0'); next.focus();
});
// Selects and fields: the repeat editor, the template picker, buffer and travel, team and folder.
root.addEventListener('change', (e) => {
  const t = e.target; if (!t || !t.id) return;
  if (t.id === 'sc-tpl') { capture(); const tp = S.templates.find((x) => x.id === t.value); if (tp) applyTemplate(tp); else S.templateId = ''; save(); draw(); }
  else if (t.id === 'sc-buf') { S.buffer = Number(t.value); S.asKey = ''; save(); loadAssist(); }
  else if (t.id === 'sc-trv') { S.travel = Number(t.value); S.asKey = ''; save(); loadAssist(); }
  else if (t.id === 'sc-team') { S.team = t.value; save(); }
  else if (t.id === 'sc-drive') { S.driveFolder = t.value.trim(); save(); }
  else if (t.id === 'sc-tname') S.tplName = t.value;
  else if (t.id === 'sc-tshare') S.tplShare = t.checked;
  else if (ruleChange(t)) { capture(); save(); draw(); }
});
root.addEventListener('input', (e) => { if (e.target && e.target.id === 'sc-tname') S.tplName = e.target.value; });
function capture() {
  if ($('#ttl')) { if ($('#ttl').value !== S.title) S.autoTitle = false; S.title = $('#ttl').value; }
  if ($('#ag')) S.agenda = $('#ag').value;
  if ($('#postch')) S.post = $('#postch').value;
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
      title: S.title.trim() || defaultTitle() || 'Meeting', agenda: S.agenda, startsAt: S.start, durationMin: S.dur, rec: S.rec, access: S.access || 'invited', recur: ruleOut(S.rule, S.start) || undefined, tz: BTZ, templateId: S.templateId || undefined, team: S.team || undefined, driveFolder: S.driveFolder || undefined, holdGroup: S.holdGrp || undefined, remind: S.remind, postChannel: S.post,
      invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))],
    } });
    sessionStorage.removeItem('meet.book'); S.bookedRule = ruleText(S.rule, S.start); S.booked = r; S.holdGrp = ''; draw();
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
// A meeting in a series asks which meetings the change reaches. A single meeting moves as before.
function reschedule() {
  if (S.editing && S.editing.seriesId) { S.scopeAsk = true; S.scope = S.scope || 'this'; draw(); window.scrollTo(0, 0); return; }
  return saveEdit();
}
async function saveEdit() {
  try {
    const body = { startsAt: S.start };
    if (S.editing && S.editing.seriesId) {
      const guests = S.guestsOn ? S.guests : [];
      Object.assign(body, { scope: S.scope || 'this', durationMin: S.dur, title: S.title, agenda: S.agenda, rec: S.rec, invitees: [...invited().map((p) => ({ email: p.email, name: p.name, team: p.team })), ...guests.map((g) => ({ email: g, name: g, guest: true }))] });
      const out = ruleOut(S.rule, S.start);
      if (body.scope !== 'this' && out && JSON.stringify(out) !== S.ruleWas) body.recur = out; // the update route has no way to stop a series from repeating
    }
    await api('meetings/' + EDIT + '/update', { method: 'POST', body }); toast('Moved. Invitations updated.'); setTimeout(() => (location.href = '/meet/'), 900); } catch (e) { toast(e.message); }
}

load().catch((e) => { root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`; });
