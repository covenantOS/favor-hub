/* The partner page's story and timeline. Everything here comes from /api/brief/story/:id and /api/brief/timeline/:id, which hold the
   rules (giving rhythm, health, next best action, what counts as an event). This file loads the two answers and draws them; partner.js
   calls it and keeps the state. Public: window.FavorBrief = { load, storyHTML, events }. */
(() => {
'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = (path) => (window.FavorWG ? window.FavorWG.api(path) : fetch(path, { credentials: 'same-origin' }).then((r) => r.json()));
const HEALTH = { growing: 'Growing', steady: 'Steady', slipping: 'Slipping', lapsing: 'Lapsing', atrisk: 'At risk', new: 'New', none: 'No gifts' };

async function load(id) {
  const [story, tl] = await Promise.all([api('/api/brief/story/' + encodeURIComponent(id)).catch(() => null), api('/api/brief/timeline/' + encodeURIComponent(id)).catch(() => null)]);
  return { story, tl };
}

const ICON = { call: 'phone', email: 'mail', meeting: 'meet', mail: 'letter', note: 'note', task: 'task', event: 'meet', chat: 'text', clip: 'link', mention: 'text' };

/** This person's own email with the partner and emails naming them (Gmail, read apart so the timeline never waits on it). */
function loadMail(id) {
  return fetch('/api/today/partner-mail?cid=' + encodeURIComponent(id), { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then((r) => (r.ok ? r.json() : { events: [] })).then((d) => d.events || []).catch(() => []);
}

/** The timeline answer in the shape partner.js draws: gifts, contacts (t act), notes, and things from this hub (t hub). */
function events(tl) {
  return (tl.events || []).map((e) => {
    if (e.kind === 'gift') return { t: 'gift', d: e.at.slice(0, 10), a: e.amount, what: e.fund || 'No fund on file', how: e.text };
    if (e.kind === 'note') return { t: 'note', d: e.at.slice(0, 10), what: e.title, text: e.text, by: e.by };
    // Mentions and meetings carry a prefilled "Add to contact log" (log) and whether it was added (logged).
    if (e.kind === 'chat' || e.kind === 'clip' || e.kind === 'mention' || e.id.startsWith('meet:')) return { t: 'hub', src: e.id, d: e.at.slice(0, 10), icon: ICON[e.kind], what: e.title, text: e.text, by: e.by, href: e.href, log: e.log || null, logged: !!e.logged };
    return { t: 'act', id: e.id.replace(/^act:/, ''), d: e.at.slice(0, 10), icon: ICON[e.kind] || 'task', what: e.title, text: e.text, by: e.by + (e.open ? (e.by ? ' · ' : '') + 'Open' : '') };
  });
}

function storyHTML(V) {
  const s = V.story;
  if (s === false) return '';
  if (!s || !s.story) return `<section class="pp-story" aria-busy="true"><div class="pp-story__h"><h3>Giving pattern</h3></div><div class="pp-skel"><i style="height:14px;width:92%"></i><i style="height:14px;width:78%"></i><i style="height:14px;width:60%"></i></div></section>`;
  const st = s.story;
  const n = s.nba || {};
  const callable = (V.p.contact.phones || []).some((x) => !x.doNotCall);
  const go = n.kind === 'none' ? '' : (n.channel === 'call' || n.channel === 'visit') && callable && window.FavorCall
    ? `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-pp-callmode="${esc(V.p.id)}">Call mode</button>`
    : `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pp-compose="contact">Log a contact</button>`;
  const r = s.rhythm || {};
  const day = (d) => (d && window.FavorUI ? window.FavorUI.day(String(d).slice(0, 10)) : String(d || '').slice(0, 10));
  const CAD = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', 'twice a year': 'Twice a year' };
  const facts = [
    CAD[r.cadence] ? ['Gives', CAD[r.cadence]] : null,
    r.lastDate ? ['Last gift', day(r.lastDate)] : null,
    r.lateDays > 0 ? ['Next gift', r.lateDays + (r.lateDays === 1 ? ' day late' : ' days late'), 'late'] : r.expectedNext ? ['Next gift', 'About ' + day(r.expectedNext)] : null,
  ].filter(Boolean);
  // A written summary shows only when it is short (two sentences at most). Longer text gives way to the facts.
  const txt = String(st.text || '').trim();
  const short = txt && txt.length <= 180 && (txt.match(/[.!?](\s|$)/g) || []).length <= 2 ? txt : '';
  return `<section class="pp-story">
    <div class="pp-story__h"><h3>Giving pattern</h3><span class="pp-health pp-health--${esc(st.health)}">${esc(HEALTH[st.health] || st.health)}</span></div>
    <p class="pp-story__t">${esc(short || st.why || '')}</p>
    ${facts.length ? `<dl class="pp-story__f">${facts.map(([k, v, c]) => `<div${c ? ' class="is-' + c + '"' : ''}><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    ${n.label ? `<div class="pp-nba pp-nba--${esc(n.kind)}"><div><small>Next</small><b>${esc(n.label)}</b><span>${esc(n.why)}</span></div>${go}</div>` : ''}
  </section>`;
}

window.FavorBrief = { load, loadMail, storyHTML, events, HEALTH };
})();
