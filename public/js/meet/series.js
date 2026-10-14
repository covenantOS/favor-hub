// Meetings: one repeating series. The rule, the people, the upcoming meetings (move or cancel with a scope) and the past ones.
import { $, esc, api, toast, confirmCard } from './ui.js';

const root = $('#sr-root');
const sid = new URLSearchParams(location.search).get('id') || '';
const TZ = 'America/New_York';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCOPES = [['this', 'This meeting'], ['following', 'This and following meetings'], ['all', 'All meetings']];
let data = null;

const etFmt = (iso, o) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...o });
const dayET = (iso) => etFmt(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeET = (iso) => etFmt(iso, { hour: 'numeric', minute: '2-digit' });
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zoneName = (z) => new Date().toLocaleString('en-US', { timeZone: z, timeZoneName: 'short' }).split(' ').pop();
const zoneDiffers = () => { try { return zoneName(localZone) !== zoneName(TZ); } catch { return false; } };
const localLine = (iso) => (zoneDiffers() ? `${new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} for you` : '');
const etParts = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
// Eastern wall time to an instant, correct across daylight saving changes.
const etToIso = (date, time) => {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi); let g = wall;
  for (let i = 0; i < 3; i++) {
    const q = etParts(new Date(g).toISOString()); const [qy, qm, qd] = q.date.split('-').map(Number); const [qh, qmi] = q.time.split(':').map(Number);
    g += wall - Date.UTC(qy, qm - 1, qd, qh, qmi);
  }
  return new Date(g).toISOString();
};

// A sheet over the page. body is HTML; read(el) returns the values or throws a message to show. Resolves null when dismissed.
function sheet({ title, lead = '', body = '', ok, danger = false, read }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const wrap = document.createElement('div'); wrap.className = 'sr-scrim';
    wrap.innerHTML = `<div class="sr-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${lead ? `<p>${esc(lead)}</p>` : ''}<div>${body}</div><p class="sr-err" role="alert" hidden></p><div class="sr-foot"><button type="button" class="h-btn h-btn--ghost" data-no>Cancel</button><button type="button" class="h-btn ${danger ? 'h-btn--danger' : 'h-btn--primary'}" data-ok>${esc(ok)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', key, true); wrap.remove(); try { if (prev) prev.focus(); } catch { /* gone */ } resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-no]')) done(null); });
    wrap.querySelector('[data-ok]').addEventListener('click', () => {
      try { done(read ? read(wrap) : {}); } catch (err) { const m = wrap.querySelector('.sr-err'); m.textContent = err.message; m.hidden = false; }
    });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(wrap);
    const f = wrap.querySelector('input,select,textarea,[data-ok]'); if (f) f.focus();
  });
}
const scopeOpts = (def, only) => SCOPES.filter((s) => !only || only.includes(s[0])).map((s) => `<label class="sr-opt"><input type="radio" name="scope" value="${s[0]}"${s[0] === def ? ' checked' : ''}>${s[1]}</label>`).join('');
const scopeOf = (el) => el.querySelector('input[name=scope]:checked').value;

async function send(id, body, done) {
  try {
    const r = await api('meetings/' + id + '/update', { method: 'POST', body });
    toast(done);
    if (r.seriesId && r.seriesId !== sid) { location.replace('/meet/series/?id=' + r.seriesId); return; }
    load();
  } catch (e) { toast(e.message); }
}

async function moveOne(m) {
  const p = etParts(m.startsAt);
  const v = await sheet({
    title: 'Move a meeting', lead: `${m.title}, ${dayET(m.startsAt)} at ${timeET(m.startsAt)} ET.`, ok: 'Move',
    body: `${scopeOpts('this')}<div class="sr-2"><label class="sr-f">Date<input type="date" data-d value="${p.date}"></label><label class="sr-f">Start (ET)<input type="time" step="300" data-t value="${p.time}"></label></div><a class="sr-mk" href="/meet/book/?edit=${esc(m.id)}">More options</a>`,
    read: (el) => { const d = el.querySelector('[data-d]').value, t = el.querySelector('[data-t]').value; if (!d || !t) throw new Error('Pick a date and a time.'); return { scope: scopeOf(el), startsAt: etToIso(d, t) }; },
  });
  if (v) send(m.id, { scope: v.scope, startsAt: v.startsAt }, 'Moved');
}

async function cancelOne(m) {
  const v = await sheet({ title: 'Cancel a meeting', lead: `${m.title}, ${dayET(m.startsAt)} at ${timeET(m.startsAt)} ET.`, ok: 'Continue', body: scopeOpts('this'), read: (el) => ({ scope: scopeOf(el) }) });
  if (!v) return;
  const word = v.scope === 'this' ? 'this meeting' : v.scope === 'all' ? 'every meeting in the series' : 'this meeting and the ones after it';
  const yes = await confirmCard({ title: 'Cancel ' + word + '?', body: 'Invitees get a cancellation.', ok: 'Cancel', cancel: 'Keep', danger: true });
  if (yes === true) send(m.id, { scope: v.scope, status: 'cancelled' }, 'Cancelled');
}

const RULE_FREQ = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
async function editSeries(s, next) {
  const r = s.rule || { freq: 'weekly', interval: 1, end: { kind: 'never' } };
  const end = r.end || { kind: 'never' };
  const body = `${scopeOpts('all', ['following', 'all'])}
    <label class="sr-f">Title<input data-title maxlength="140" value="${esc(s.title)}"></label>
    <label class="sr-f">Agenda<textarea data-agenda maxlength="2000">${esc(s.agenda || '')}</textarea></label>
    <label class="sr-f">Length in minutes<input data-len type="number" min="10" max="480" step="5" value="${s.durationMin}"></label>
    <div class="sr-2"><label class="sr-f">Repeats<select data-freq>${RULE_FREQ.map((f) => `<option value="${f}"${r.freq === f ? ' selected' : ''}>${f[0].toUpperCase() + f.slice(1)}</option>`).join('')}</select></label>
    <label class="sr-f">Every<input data-int type="number" min="1" max="52" value="${r.interval || 1}"></label></div>
    <div class="sr-days" data-days>${DAYS.map((d, i) => `<label><input type="checkbox" value="${i}"${(r.byDay || []).includes(i) ? ' checked' : ''}>${d}</label>`).join('')}</div>
    <div class="sr-2"><label class="sr-f">Ends<select data-end><option value="never"${end.kind === 'never' ? ' selected' : ''}>Never</option><option value="count"${end.kind === 'count' ? ' selected' : ''}>After a number of meetings</option><option value="until"${end.kind === 'until' ? ' selected' : ''}>On a date</option></select></label>
    <label class="sr-f">Number or date<input data-endv type="text" value="${esc(end.kind === 'until' ? end.until || '' : end.count || '')}" placeholder="10 or 2026-12-31"></label></div>`;
  const v = await sheet({
    title: 'Edit the series', lead: 'The change applies from the next meeting on.', ok: 'Save', body,
    read: (el) => {
      const freq = el.querySelector('[data-freq]').value, kind = el.querySelector('[data-end]').value, ev = el.querySelector('[data-endv]').value.trim();
      const title = el.querySelector('[data-title]').value.trim(); if (!title) throw new Error('Give the series a title.');
      const rule = { freq, interval: Math.max(1, Math.min(52, +el.querySelector('[data-int]').value || 1)), end: { kind: 'never' } };
      if (freq === 'weekly') { rule.byDay = [...el.querySelectorAll('[data-days] input:checked')].map((x) => +x.value); if (!rule.byDay.length) throw new Error('Pick at least one day.'); }
      if (freq === 'monthly') rule.monthBy = r.monthBy || 'date';
      if (kind === 'count') { if (!(+ev > 0)) throw new Error('Enter how many meetings.'); rule.end = { kind: 'count', count: Math.round(+ev) }; }
      if (kind === 'until') { if (!/^\d{4}-\d{2}-\d{2}$/.test(ev)) throw new Error('Enter the last date as YYYY-MM-DD.'); rule.end = { kind: 'until', until: ev }; }
      return { scope: scopeOf(el), title, agenda: el.querySelector('[data-agenda]').value.trim(), durationMin: Math.max(10, +el.querySelector('[data-len]').value || s.durationMin), recur: rule };
    },
  });
  if (v) send(next.id, v, 'Series saved');
}

const people = (list) => { const n = (list || []).map((p) => p.name || p.email); return n.length ? n.join(', ') : 'Just the host'; };
const clipText = (t, n) => (t.length > n ? t.slice(0, n) + '...' : t);

function draw() {
  const { series: s, upcoming, past, cancelled } = data;
  const live = upcoming.filter((m) => m.status !== 'cancelled');
  const rows = [...live.map((m) => ({ ...m, kind: 'up' })), ...(cancelled || []).map((c) => ({ ...c, kind: 'x' }))].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const host = s.mine;
  const upRow = (m) => {
    if (m.kind === 'x') return `<div class="sr-row is-cancelled"><div><b>${dayET(m.startsAt)}</b><span>Cancelled</span></div></div>`;
    const loc = localLine(m.startsAt);
    return `<div class="sr-row"><div><b>${dayET(m.startsAt)} at ${timeET(m.startsAt)} ET${m.detached ? '<i class="sr-tag">Moved</i>' : ''}</b>${loc ? `<span>${esc(loc)}</span>` : ''}${m.agenda ? `<p>${esc(clipText(m.agenda, 140))}</p>` : ''}</div>
      <div class="sr-acts"><a class="h-btn h-btn--ghost h-btn--sm" href="/meet/room/?m=${esc(m.id)}">Open</a>${host ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-move="${esc(m.id)}">Move</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-cancel="${esc(m.id)}">Cancel</button>` : ''}</div></div>`;
  };
  const pastRow = (m) => `<div class="sr-row"><div><b>${dayET(m.startsAt)}</b><span>${m.notesStatus && m.notesStatus !== 'none' ? 'Notes ' + esc(m.notesStatus) : 'No notes'}${m.actions && m.actions.n ? `, ${m.actions.n} action ${m.actions.n === 1 ? 'item' : 'items'} (${m.actions.open} open)` : ''}</span>${m.canRead && m.summary ? `<p>${esc(clipText(m.summary, 180))}</p>` : ''}</div>
    <div class="sr-acts">${m.canRead ? `<a class="h-btn h-btn--ghost h-btn--sm" href="/meet/notes/?m=${esc(m.id)}">Notes</a>` : ''}</div></div>`;
  root.innerHTML = `<section class="h-card sr-head"><h2>${esc(s.title)}</h2><p class="sr-rule">${esc(s.describe)}</p>
    <dl class="sr-kv"><div><dt>Host</dt><dd>${esc(s.hostName)}</dd></div><div><dt>Length</dt><dd>${s.durationMin} minutes</dd></div><div><dt>Time zone</dt><dd>${esc(s.tz || TZ)}</dd></div><div><dt>People</dt><dd>${esc(people(s.invitees))}</dd></div></dl>
    ${host && live.length ? '<div class="sr-edit"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-edit>Edit the series</button></div>' : ''}</section>
    <section class="h-card sr-sec"><div class="h-label">Upcoming meetings</div>${rows.length ? rows.map(upRow).join('') : '<p class="sr-none">No upcoming meetings. This series has ended or every date is cancelled.</p>'}</section>
    <section class="h-card sr-sec"><div class="h-label">Past meetings</div>${past.length ? past.map(pastRow).join('') : '<p class="sr-none">No past meetings yet.</p>'}</section>`;
  const byId = new Map(live.map((m) => [m.id, m]));
  root.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveOne(byId.get(b.dataset.move))));
  root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => cancelOne(byId.get(b.dataset.cancel))));
  const ed = root.querySelector('[data-edit]'); if (ed) ed.addEventListener('click', () => editSeries(s, live[0]));
}

async function load() {
  if (!sid) { root.innerHTML = '<div class="h-card mt-card"><p>No series chosen. Open one from the meeting list.</p></div>'; root.removeAttribute('aria-busy'); return; }
  try { data = await api('meetings/series/' + encodeURIComponent(sid)); draw(); } catch (e) { root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`; }
  root.removeAttribute('aria-busy');
}
load();
