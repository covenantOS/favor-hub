// The prep sheet. All of it comes from /api/meet/meetings/:id/prep; this file only draws it.
import { $, esc, ic, av, api, fmtDay, fmtTime } from './ui.js';
const MID = new URLSearchParams(location.search).get('m') || '';
const root = $('#mt-prep');
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const day = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

function person(a) {
  const bits = [a.title || a.team, a.role === 'host' ? 'Host' : '', a.you ? 'You' : ''].filter(Boolean).map(esc).join(' · ');
  const held = a.held ? `<span>Holds ${a.held.count.toLocaleString('en-US')} partners, ${money(a.held.last12)} given in 12 months</span>` : '';
  const tasks = a.between.length ? `<ul class="pr-tasks">${a.between.map((t) => `<li><a href="${esc(t.url)}">${esc(t.title)}</a><em>${t.mine ? 'You owe' : 'Owes you'}${t.due ? ' · due ' + esc(day(t.due)) : ''}</em></li>`).join('')}</ul>` : '';
  return `<div class="pr-p">${av(a.name)}<div><b>${esc(a.name)}</b><span>${bits || esc(a.email)}</span>${held}${tasks}</div></div>`;
}

function partner(p) {
  if (!p.detail) return `<div class="pr-pc"><b>${esc(p.name)}</b><span>A partner on record.</span></div>`;
  const rows = [
    ['Given in all', `${money(p.lifetime)} over ${p.count} gifts`],
    ['Last 12 months', money(p.last12)],
    p.last ? ['Last gift', `${money(p.last.amount)} to ${p.last.fund || 'no fund on file'}, ${day(p.last.date)}`] : null,
    p.largest ? ['Largest gift', `${money(p.largest.amount)}, ${day(p.largest.date)}`] : null,
    p.lastContact ? ['Last contact', `${p.lastContact.category}, ${day(p.lastContact.date)}${p.lastContact.summary ? ': ' + p.lastContact.summary : ''}`] : null,
    p.holders.length ? ['Held by', p.holders.join(', ')] : null,
  ].filter(Boolean);
  return `<div class="pr-pc"><div class="pr-pc__h"><div><b>${esc(p.name)}</b><span>${esc(p.place)}</span></div><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(p.url)}">Partner page</a></div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${p.open.length ? `<div class="h-label" style="margin:10px 0 4px">Open on the record</div><ul class="pr-tasks">${p.open.map((o) => `<li>${esc(o.what)}<em>${o.due ? 'due ' + esc(day(o.due)) : ''}</em></li>`).join('')}</ul>` : ''}</div>`;
}

function draw(d) {
  const m = d.meeting;
  document.title = 'Prep, ' + m.title + ' - FavorOS';
  const when = m.startsAt ? `${fmtDay(m.startsAt)}, ${fmtTime(m.startsAt)}${m.endsAt ? ' to ' + fmtTime(m.endsAt) : ''}` : 'Open room';
  root.innerHTML = `<div class="nt-head"><div><div class="h-label" style="margin-bottom:6px">Prep</div><h2>${esc(m.title)}</h2><div class="nt-meta"><span>${ic('cal')}${esc(when)}</span><span>${ic('users')}${d.attendees.length} ${d.attendees.length === 1 ? 'person' : 'people'}</span></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${m.status === 'ended' ? `<a class="h-btn h-btn--ghost h-btn--sm" href="/meet/notes/?m=${esc(m.id)}">Notes</a>` : `<a class="h-btn h-btn--primary h-btn--sm" href="/meet/room/?m=${esc(m.id)}">${ic('video')}Open the room</a>`}</div></div>
    <p class="pr-line">${esc(d.line)}</p>
    <div class="mt-grid"><div class="mt-stack">
      ${m.agenda ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Agenda</div><p class="nt-sum" style="white-space:pre-wrap">${esc(m.agenda)}</p></section>` : ''}
      ${d.last ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Last time, ${esc(day(d.last.date))}</div><p class="nt-sum"><a href="/meet/notes/?m=${esc(d.last.id)}">${esc(d.last.title)}</a>. ${esc(d.last.summary)}</p>
        ${d.last.decisions.length ? `<div class="h-label" style="margin:10px 0 4px">Decided</div><ul class="nt-list">${d.last.decisions.map((t) => `<li><span class="b">${ic('check')}</span><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
        ${d.last.open.length ? `<div class="h-label" style="margin:10px 0 4px">Still open</div><ul class="pr-tasks">${d.last.open.map((o) => `<li>${esc(o.text)}<em>${esc([o.owner, o.due ? 'due ' + o.due : ''].filter(Boolean).join(' · '))}</em></li>`).join('')}</ul>` : ''}</section>` : ''}
      ${d.openItems.length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:6px">Open from past meetings with these people</div>${d.openItems.map((o) => `<a class="pr-oi" href="/meet/notes/?m=${esc(o.meetingId)}"><b>${esc(o.text)}</b><span>${esc([o.owner, o.due ? 'due ' + o.due : '', o.title + ', ' + day(o.date)].filter(Boolean).join(' · '))}</span></a>`).join('')}</section>` : ''}
      ${!m.agenda && !d.last && !d.openItems.length ? `<section class="h-card mt-card"><p class="mt-sub" style="margin:0">No agenda, no earlier meeting with this group and nothing open between these people.</p></section>` : ''}
    </div><div class="mt-stack">
      <section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Who is coming</div>${d.attendees.map(person).join('')}</section>
      ${d.partners.length ? `<section class="h-card mt-card"><div class="h-label" style="margin-bottom:8px">Partners</div>${d.partners.map(partner).join('')}</section>` : ''}
    </div></div>`;
}

(async () => {
  try { draw(await api('meetings/' + MID + '/prep')); } catch (e) { root.innerHTML = `<div class="h-card mt-card" style="max-width:560px"><h2 class="mt-h2">Prep not available</h2><p class="mt-sub" style="font-size:14px">${esc(e.message)}</p><a class="h-btn h-btn--primary" href="/meet/">Meetings</a></div>`; }
  root.removeAttribute('aria-busy');
})();
