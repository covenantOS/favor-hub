// Meetings home: what is on now, today, later, the latest notes, and Google Calendar meetings.
import { $, esc, ic, av, api, fmtTime, fmtDay, toast, whoami, pump } from './ui.js';

const root = $('#mt-home');
const KEY = 'meet.home.v1';
const TTL = 20000;
const REPEAT = { weekly: 'Repeats every week', biweekly: 'Repeats every two weeks', monthly: 'Repeats every month' };
let people = new Map();
const clip = (t, n) => { t = (t || '').trim(); if (t.length <= n) return t; const c = t.slice(0, n); return c.slice(0, c.lastIndexOf(' ')) + '...'; };
const nameOf = (i) => { const e = String(i.email || '').toLowerCase(); return (e && people.get(e)?.name) || i.name || i.email || ''; };

// The lists are cached for 20 seconds so a return to the page paints at once. Any change calls load(true).
function readCache() {
  try { const c = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return c && Date.now() - c.at < TTL ? c : null; } catch { return null; }
}

async function load(fresh = false) {
  try {
    let c = fresh ? null : readCache();
    if (!c) {
      const [up, recent, me, cal, dir] = await Promise.all([api('meetings?scope=upcoming'), api('meetings?scope=notes'), whoami(), api('meetings/calendar').catch(() => null), api('meetings/directory').catch(() => ({ people: [] }))]);
      c = { at: Date.now(), up: up.meetings, recent: recent.meetings, who: me, cal, people: dir.people || [] };
      try { sessionStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full or off */ }
    }
    people = new Map(c.people.map((p) => [String(p.email).toLowerCase(), p]));
    draw(c.up, c.recent, c.who, c.cal);
    pump(null, null);
  } catch (e) {
    root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`;
  }
  root.removeAttribute('aria-busy');
}

const PROV = { favor: 'Favor Meetings', meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams', webex: 'Webex' };
const GLYPH = { teams: 'T', webex: 'W', favor: 'F' };
const prov = (p) => `<span class="mt-prov"><i class="mt-pv mt-pv--${p}" aria-hidden="true">${GLYPH[p] || ic('video')}</i>${PROV[p]}</span>`;
const peopleLine = (list) => { const n = list.map((p) => p.name || p.email); return n.length ? (n.length <= 3 ? n.join(', ') : n.slice(0, 2).join(', ') + ' and ' + (n.length - 2) + ' more') : 'Just you'; };
const calRow = (m, canWrite, later) => {
  const t = later ? `<b style="font-size:14px;font-family:var(--h-font);font-weight:600">${fmtDay(m.startsAt)}</b><span>${fmtTime(m.startsAt)}</span>` : `<b>${fmtTime(m.startsAt)}</b><span>to ${fmtTime(m.endsAt)}</span>`;
  const sw = m.canSwitch ? `<button class="h-btn h-btn--ghost h-btn--sm mt-move" data-switch="${esc(m.eventId)}">Move to Favor Meetings</button>` : m.needsConsent ? `<a class="h-btn h-btn--ghost h-btn--sm mt-move" href="/api/google/connect?add=meetings&next=${encodeURIComponent('/meet/')}">Move to Favor Meetings</a>` : '';
  return `<div class="mt-row"><div class="t">${t}</div><div class="w"><b>${esc(m.title)}</b><span>${prov(m.provider)}<em>${esc(peopleLine(m.people))}</em></span></div>
    <div class="mt-avs">${m.people.slice(0, 4).map((p) => av(p.name || p.email)).join('')}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end"><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(m.joinUrl)}" target="_blank" rel="noopener">${ic('video')}Join</a></div>${sw ? `<div class="mt-moverow">${sw}</div>` : ''}</div>`;
};
const connectLine = () => `<div class="mt-note mt-note--gold mt-conn"><span>Show your Google Calendar meetings here.</span> <a class="h-btn h-btn--primary h-btn--sm" href="/api/google/connect?next=${encodeURIComponent('/meet/')}">Connect my Google</a></div>`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const sub = (m) => {
  const bits = [];
  const n = (m.invitees || []).length;
  if (m.status === 'live') bits.push(m.inRoom ? `${m.inRoom} in the room` : 'Open now');
  else if (n) bits.push(`${n + 1} people`);
  bits.push(m.rec === 'video' ? 'notes on, video recording on' : m.rec === 'notes' ? 'notes on' : 'not recorded');
  return bits.join(', ');
};
const repeats = (m) => Boolean(m.repeat && m.repeat !== 'none');
const mine = (m) => (m.mine && m.startsAt && m.status === 'scheduled' ? `${repeats(m) ? '' : `<a class="h-btn h-btn--ghost h-btn--sm" href="/meet/book/?edit=${m.id}">Move</a>`}<button class="h-btn h-btn--ghost h-btn--sm" data-cancel="${m.id}" data-series="${repeats(m) ? 1 : 0}">Cancel</button>` : '');
const row = (m) => {
  const when = m.startsAt || m.createdAt;
  const live = m.status === 'live';
  const names = [m.hostName, ...(m.invitees || []).slice(0, 3).map(nameOf)].filter(Boolean);
  return `<div class="mt-row${live ? ' is-now' : ''}"><div class="t"><b>${m.startsAt ? fmtTime(when) : 'Now'}</b><span>${m.endsAt ? 'to ' + fmtTime(m.endsAt) : 'open room'}</span></div>
    <div class="w"><b>${esc(m.title)}</b><span>${esc(sub(m))}</span></div>
    <div class="mt-avs">${names.slice(0, 4).map((n) => av(n)).join('')}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap"><a class="h-btn ${live || !m.startsAt ? 'h-btn--primary' : 'h-btn--ghost'} h-btn--sm" href="/meet/room/?m=${m.id}">${live || !m.startsAt ? ic('video') + 'Join' : 'Open'}</a>${mine(m)}</div></div>`;
};
const laterRow = (m, extra) => `<div class="mt-row"><div class="t"><b style="font-size:14px;font-family:var(--h-font);font-weight:600">${fmtDay(m.startsAt)}</b><span>${fmtTime(m.startsAt)}</span></div><div class="w"><b>${esc(m.title)}</b><span>${esc(sub(m))}${repeats(m) ? ` · ${REPEAT[m.repeat] || 'Repeats'}${extra ? `, ${extra} more after this` : ''}` : ''}</span></div><div></div><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap"><a class="h-btn h-btn--ghost h-btn--sm" href="/meet/room/?m=${m.id}">Open</a>${mine(m)}</div></div>`;

function draw(up, notes, me, cal) {
  const now = new Date();
  const calList = cal && cal.connected ? cal.meetings : [];
  // Favor rooms and calendar meetings share one list, in time order.
  const items = [...up.map((m) => ({ at: Date.parse(m.startsAt || m.createdAt), hub: m })), ...calList.map((m) => ({ at: Date.parse(m.startsAt), cal: m }))].sort((a, b) => a.at - b.at);
  const isToday = (it) => (it.hub ? it.hub.status === 'live' || !it.hub.startsAt || sameDay(it.hub.startsAt, now) : sameDay(it.cal.startsAt, now));
  const todayList = items.filter(isToday);
  // A repeating Favor meeting shows once in Later, at its next occurrence, with the count of the ones after it.
  const later = [];
  const series = new Map();
  for (const it of items.filter((x) => !isToday(x))) {
    const sid = it.hub && it.hub.seriesId;
    if (!sid) { later.push({ it, extra: 0 }); continue; }
    const s = series.get(sid);
    if (s) s.extra++;
    else { const e = { it, extra: 0 }; series.set(sid, e); later.push(e); }
  }
  const canWrite = !!(cal && cal.canWrite);
  const needConnect = cal && !cal.connected;
  const first = (me.name || '').split(' ')[0];
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  root.innerHTML = `<div class="mt-intro"><div><h2 class="mt-h2">${greet}${first ? ', ' + esc(first) : ''}</h2><p>${todayList.length ? `${todayList.length} meeting${todayList.length === 1 ? '' : 's'} today.` : 'No meetings today.'}</p></div></div>
  <div class="mt-grid"><div class="mt-stack">
    <section class="h-card" style="overflow:hidden"><div class="mt-card" style="padding-bottom:6px"><div class="h-label">Today, ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      ${needConnect ? connectLine() : ''}${cal && cal.error ? `<div class="mt-card"><p class="mt-sub" style="margin:0">${esc(cal.error)}</p></div>` : ''}${todayList.length ? todayList.map((it) => (it.hub ? row(it.hub) : calRow(it.cal, canWrite, false))).join('') : `<div class="mt-card"><p class="mt-sub" style="margin:0">Nothing booked for today. Start a meeting now, or book one.</p></div>`}</section>
    ${later.length ? `<section class="h-card" style="overflow:hidden"><div class="mt-card" style="padding-bottom:6px"><div class="h-label">Later</div></div>${later.map(({ it, extra }) => (it.cal ? calRow(it.cal, canWrite, true) : laterRow(it.hub, extra))).join('')}</section>` : ''}
  </div><div class="mt-stack">
    <section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Latest notes</div>
      ${notes.slice(0, 3).map((m) => `<a class="libc h-card" style="box-shadow:none;margin-bottom:10px;text-decoration:none" href="/meet/notes/?m=${m.id}"><h4>${esc(m.title)}</h4><p>${esc(clip(m.summary, 150))}</p><div class="ft"><span>${m.endedAt ? fmtDay(m.endedAt) : ''}</span></div></a>`).join('') || `<p class="mt-sub" style="margin:0 0 10px">Notes show up here after a meeting that records.</p>`}
      <a class="h-btn h-btn--ghost h-btn--sm" href="/meet/library/" style="width:100%">All meeting notes</a></section>
  </div></div>`;
  root.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Move this meeting to Favor Meetings? The Zoom or Google Meet link on the invite is replaced with a Favor room, and Google sends everyone invited an updated invite.')) return;
    b.disabled = true;
    try { await api('meetings/calendar/switch', { method: 'POST', body: { eventId: b.dataset.switch } }); toast('Moved to Favor Meetings'); load(true); } catch (e) { b.disabled = false; if (e.code === 'consent') location.href = '/api/google/connect?add=meetings&next=' + encodeURIComponent('/meet/'); else toast(e.message); }
  }));
  root.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => askCancel(b)));
}

// Cancel asks in the page: the button becomes one line with Yes and Keep it.
function askCancel(b) {
  const wrap = document.createElement('span');
  wrap.className = 'mt-confirm';
  wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end';
  const series = b.dataset.series === '1';
  wrap.innerHTML = `<span class="mt-sub" style="margin:0">${series ? 'Cancel every meeting in this series?' : 'Cancel this meeting?'} Invitees get a cancellation.</span><button class="h-btn h-btn--primary h-btn--sm" data-yes="1">${series ? 'Cancel series' : 'Yes, cancel'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-no="1">Keep it</button>`;
  b.replaceWith(wrap);
  wrap.querySelector('[data-no]').addEventListener('click', () => wrap.replaceWith(b));
  wrap.querySelector('[data-yes]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api('meetings/' + b.dataset.cancel + '/update', { method: 'POST', body: { status: 'cancelled' } }); toast('Cancelled'); load(true); } catch (err) { toast(err.message); wrap.replaceWith(b); }
  });
}

async function startNow(e) {
  const btn = e && e.currentTarget;
  if (btn) btn.disabled = true;
  const name = ((await whoami()).name || '').split(' ')[0];
  try {
    const r = await api('meetings', { method: 'POST', body: { title: name ? `${name}'s meeting` : 'Meeting', rec: 'notes', access: 'staff' } });
    location.href = '/meet/room/?m=' + r.meeting.id;
  } catch (err) { if (btn) btn.disabled = false; toast(err.message); }
}

const nowBtn = $('#mt-now');
if (nowBtn) nowBtn.addEventListener('click', startNow);
load();
