// Meetings home: what is on now, today, later this week, the latest notes, and the person's meeting link.
import { $, esc, ic, av, api, fmtTime, fmtDay, toast, whoami, pump } from './ui.js';

const root = $('#mt-home');

async function load() {
  try {
    const [up, recent, who] = await Promise.all([api('meetings?scope=upcoming'), api('meetings?scope=notes'), whoami()]);
    draw(up.meetings, recent.meetings, who);
    pump(null, null);
  } catch (e) {
    root.innerHTML = `<div class="h-card mt-card"><p>${esc(e.message)}</p></div>`;
  }
  root.removeAttribute('aria-busy');
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const sub = (m) => {
  const bits = [];
  const n = (m.invitees || []).length;
  if (m.status === 'live') bits.push(m.inRoom ? `${m.inRoom} in the room` : 'Open now');
  else if (n) bits.push(`${n + 1} people`);
  bits.push(m.rec === 'video' ? 'notes on, video recording on' : m.rec === 'notes' ? 'notes on' : 'not recorded');
  return bits.join(', ');
};
const row = (m) => {
  const when = m.startsAt || m.createdAt;
  const live = m.status === 'live';
  const names = [m.hostName, ...(m.invitees || []).slice(0, 3).map((i) => i.name || i.email)].filter(Boolean);
  return `<div class="mt-row${live ? ' is-now' : ''}"><div class="t"><b>${m.startsAt ? fmtTime(when) : 'Now'}</b><span>${m.endsAt ? 'to ' + fmtTime(m.endsAt) : 'open room'}</span></div>
    <div class="w"><b>${esc(m.title)}</b><span>${esc(sub(m))}</span></div>
    <div class="mt-avs">${names.slice(0, 4).map((n) => av(n)).join('')}</div>
    <div><a class="h-btn ${live || !m.startsAt ? 'h-btn--primary' : 'h-btn--ghost'} h-btn--sm" href="/meet/room/?m=${m.id}">${live || !m.startsAt ? ic('video') + 'Join' : 'Open'}</a></div></div>`;
};

function draw(up, notes, who) {
  const now = new Date();
  const todayList = up.filter((m) => m.status === 'live' || !m.startsAt || sameDay(m.startsAt, now));
  const later = up.filter((m) => !todayList.includes(m));
  const first = (who.name || '').split(' ')[0];
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  root.innerHTML = `<div class="mt-intro"><div><h2 class="mt-h2">${greet}${first ? ', ' + esc(first) : ''}</h2><p>${todayList.length ? `${todayList.length} meeting${todayList.length === 1 ? '' : 's'} today.` : 'No meetings today.'} Every recorded meeting gets a transcript and notes in the hub when it ends.</p></div></div>
  <div class="mt-grid"><div class="mt-stack">
    <section class="h-card" style="overflow:hidden"><div class="mt-card" style="padding-bottom:6px"><div class="h-label">Today, ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div></div>
      ${todayList.length ? todayList.map(row).join('') : `<div class="mt-card"><p class="mt-sub" style="margin:0">Nothing booked for today. Start a meeting now, or book one.</p></div>`}</section>
    ${later.length ? `<section class="h-card" style="overflow:hidden"><div class="mt-card" style="padding-bottom:6px"><div class="h-label">Later</div></div>${later.map((m) => `<div class="mt-row"><div class="t"><b style="font-size:14px;font-family:var(--h-font);font-weight:600">${fmtDay(m.startsAt)}</b><span>${fmtTime(m.startsAt)}</span></div><div class="w"><b>${esc(m.title)}</b><span>${esc(sub(m))}</span></div><div></div><div><a class="h-btn h-btn--ghost h-btn--sm" href="/meet/room/?m=${m.id}">Open</a></div></div>`).join('')}</section>` : ''}
  </div><div class="mt-stack">
    <section class="h-card mt-card"><div class="h-label" style="margin-bottom:10px">Latest notes</div>
      ${notes.slice(0, 3).map((m) => `<a class="libc h-card" style="box-shadow:none;margin-bottom:10px;text-decoration:none" href="/meet/notes/?m=${m.id}"><h4>${esc(m.title)}</h4><p>${esc((m.summary || '').slice(0, 140))}</p><div class="ft"><span>${m.endedAt ? fmtDay(m.endedAt) : ''}</span></div></a>`).join('') || `<p class="mt-sub" style="margin:0 0 10px">Notes show up here after a meeting that records.</p>`}
      <a class="h-btn h-btn--ghost h-btn--sm" href="/meet/library/" style="width:100%">All meeting notes</a></section>
    <section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Start a meeting with a link</div>
      <p class="mt-sub" style="margin:0 0 10px">Make a room now and send the link to anyone signed in to the hub.</p>
      <button class="h-btn h-btn--ghost h-btn--sm" id="mt-now2">${ic('video')}Start a meeting now</button></section>
  </div></div>`;
  for (const b of [$('#mt-now'), $('#mt-now2')]) b && b.addEventListener('click', startNow);
}

async function startNow() {
  const name = ((await whoami()).name || '').split(' ')[0];
  try {
    const r = await api('meetings', { method: 'POST', body: { title: name ? `${name}'s meeting` : 'Meeting', rec: 'notes', access: 'staff' } });
    location.href = '/meet/room/?m=' + r.meeting.id;
  } catch (e) { toast(e.message); }
}

load();
