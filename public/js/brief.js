/* The morning briefing on Today: Since you were away, the briefing (gifts since the last workday, thank-yous, late actions, today's
   meetings with one line of prep), Moments, and Focus mode (only the next three things). Every number and line comes from
   GET /api/brief/today (the data and its rules live in functions/_lib/brief); this file only draws them. Meetings come from the Today
   page's own /api/hub/day answer through FavorOS:day event, so the calendar is read once. */
(() => {
'use strict';
const root = document.getElementById('br-root');
if (!root) return;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => { const v = Number(n) || 0; return '$' + (Math.round(v) === v ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (iso) => { const [, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d; };
const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const I = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12"/><path d="M3 13h18"/><path d="M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  meet: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="M5 12h14"/><path d="m11 6-6 6 6 6"/>',
};
const ic = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const pname = (id, name) => `<a class="br-p" href="/work/partner/${esc(id)}" data-partner-id="${esc(id)}">${esc(String(name || '').trim() || 'No name on file')}</a>`;
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage refused */ } },
};
const OWNER_KEY = 'favor.hub.brief.owner';
const FOCUS_KEY = 'favor.hub.brief.focus';

const S = { data: null, away: null, day: null, cards: null, prep: {}, owner: store.get(OWNER_KEY, ''), focus: store.get(FOCUS_KEY, '') === '1', skipped: new Set(), lead: null, error: '' };

async function get(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.ok === false) throw new Error(d.message || 'Could not load.');
  return d;
}

/* ------------------------------------------------------------------ meetings */
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function meetings() {
  const g = S.day && S.day.google;
  const list = ((g && g.events) || []).filter((e) => !e.allDay && !e.declined && Date.parse(e.end) > Date.now());
  const partners = (g && g.partners) || {};
  return list.slice(0, 5).map((e) => {
    const ps = (e.people || []).map((x) => partners[x]).filter(Boolean);
    const named = [...new Map(ps.map((p) => [p.id, p])).values()];
    return { e, partners: named, href: e.hub ? '/meet/room/?m=' + encodeURIComponent(e.hub) : e.meet || e.link || '/meet/' };
  });
}
function wantPrep() {
  const ids = meetings().flatMap((m) => m.partners.map((p) => p.id)).filter((id) => !(id in S.prep));
  if (!ids.length) return;
  ids.forEach((id) => { S.prep[id] = null; });
  get('/api/brief/prep/lines?cids=' + encodeURIComponent(ids.slice(0, 6).join(','))).then((d) => { Object.assign(S.prep, d.lines || {}); draw(); }).catch(() => ids.forEach((id) => { S.prep[id] = false; }));
}
function meetingRow(m) {
  const e = m.e;
  const live = Date.now() >= Date.parse(e.start);
  let prep = '';
  if (m.partners.length) {
    prep = m.partners.slice(0, 2).map((p) => {
      const l = S.prep[p.id];
      return `<span class="br-prep">${pname(p.id, p.name)}${l ? ': ' + esc(l.line) : l === null ? '<i class="br-dots">Reading the record</i>' : ''}</span>`;
    }).join('');
  } else {
    const n = (e.people || []).length;
    prep = `<span class="br-prep">${esc(e.source || 'Meeting')}${n ? ', ' + n + (n === 1 ? ' guest' : ' guests') : ''}</span>`;
  }
  return `<li class="br-row"><span class="br-ico br-ico--meet">${ic('meet')}</span><div class="br-main"><a class="br-t" href="${esc(m.href)}"${e.hub ? '' : ' target="_blank" rel="noopener"'}>${esc(e.title)}</a>${prep}</div><span class="br-when${live ? ' is-live' : ''}">${live ? 'Now' : esc(clock(e.start))}</span></li>`;
}

/* ------------------------------------------------------------------ pieces */
const nameOwner = (b) => { const d = (b.directors || []).find((x) => x.fid === b.owner); return d ? d.name : ''; };

function away() {
  const a = S.away;
  if (!a || !a.parts.length) return '';
  return `<section class="h-card br-away" aria-label="Since you were away">
    <div class="br-head"><h2>Since you were away</h2><span>${a.days === 1 ? 'A day' : a.days + ' days'}</span><button type="button" class="br-x" data-br-away-x aria-label="Close">${ic('x')}</button></div>
    ${a.summary ? `<p class="br-lead">${esc(a.summary)}</p>` : ''}
    <div class="br-chips">${a.parts.map((p) => `<a class="br-chip" href="${esc(p.href)}"><b>${esc(p.label)}</b><span>${esc(p.line)}</span></a>`).join('')}</div>
  </section>`;
}

function giftRows(b) {
  const o = b.overnight;
  if (!o || !o.rows.length) return '';
  return `<div class="br-col"><h3>${ic('gift')}New gifts <small>${o.count} since ${esc(fd(b.since))}, ${money(o.total)}</small></h3><ul class="br-list">${o.rows.slice(0, 5).map((g) =>
    `<li class="br-row"><div class="br-main">${pname(g.cid, g.name)}<span class="br-prep">${money(g.amount)}${g.fund ? ' to ' + esc(g.fund) : ''}${g.place ? ', ' + esc(g.place) : ''}</span></div>${g.thanked ? '<span class="br-tag br-tag--ok">Thanked</span>' : `<span class="br-when">${esc(fd(g.date))}</span>`}</li>`).join('')}</ul></div>`;
}

function thankRows(b) {
  const t = b.thanks;
  if (!t || !t.rows.length) return '';
  return `<div class="br-col"><h3>${ic('phone')}To thank <small>${t.total}${t.over24 ? ', ' + t.over24 + ' waiting over a day' : ''}</small></h3><ul class="br-list">${t.rows.slice(0, 5).map((g, i) =>
    `<li class="br-row"><div class="br-main">${pname(g.cid, g.name)}<span class="br-prep">${money(g.amount)}${g.fund ? ' to ' + esc(g.fund) : ''}, ${g.ageDays >= 1 ? g.ageDays + (g.ageDays === 1 ? ' day' : ' days') + ' ago' : 'today'}</span></div><button type="button" class="h-btn h-btn--primary h-btn--sm" data-br-thank="${i}">Thank</button></li>`).join('')}</ul>${t.total > 5 ? '<a class="br-more" href="/work/?view=gifts">All gifts to thank</a>' : ''}</div>`;
}

function lateRows(b) {
  const l = b.late;
  if (!l || !l.count) return '';
  return `<div class="br-col"><h3>${ic('clock')}Late <small>${l.count}</small></h3><ul class="br-list">${l.rows.map((x) => `<li class="br-row"><div class="br-main"><a class="br-t" href="${esc(x.href)}">${esc(x.text)}</a><span class="br-prep">${esc(x.sub || '')}</span></div><span class="br-tag br-tag--late">Late</span></li>`).join('')}</ul>${l.count > l.rows.length ? `<a class="br-more" href="/work/">${l.count - l.rows.length} more in the Work Center</a>` : ''}</div>`;
}

function meetingCol() {
  const ms = meetings();
  if (!ms.length) return '';
  return `<div class="br-col"><h3>${ic('meet')}Today's meetings <small>${ms.length}</small></h3><ul class="br-list">${ms.map(meetingRow).join('')}</ul></div>`;
}

function picker(b) {
  if (!b.partners || (b.directors || []).length < 2) return '';
  return `<label class="br-pick"><span class="sr-only">Whose partners</span><select data-br-owner>${[['', 'All partners I can see'], ...b.directors.map((d) => [d.fid, d.name])].map(([v, l]) => `<option value="${esc(v)}"${v === (S.owner || b.owner) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function moments(b) {
  const list = (b.moments || []).slice(0, 6);
  if (!list.length) return '';
  const KIND = { largest: 'Largest gift', first: 'First gift', quiet: 'Gone quiet', anniversary: 'Anniversary' };
  return `<section class="br-moments" aria-label="Moments"><div class="br-head"><h2>Moments</h2><span>${list.length} worth a call</span></div><div class="br-mgrid">${list.map((m) => `<article class="h-card br-m br-m--${esc(m.kind)}">
    <span class="br-kind">${ic('star')}${esc(KIND[m.kind] || m.kind)}</span><h3>${pname(m.cid, m.name)}</h3><p>${esc(m.line)}</p>
    <div class="br-m__acts"><a class="h-btn h-btn--primary h-btn--sm" href="${esc(m.href)}" data-br-call="${esc(m.cid)}">${esc(m.step.label)}</a><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-br-dismiss="${esc(m.id)}">Not now</button></div></article>`).join('')}</div></section>`;
}

/* ------------------------------------------------------------------ focus */
function focusItems() {
  const b = S.data;
  const out = [];
  const soon = meetings().find((m) => Date.parse(m.e.start) - Date.now() < 3600000 && Date.parse(m.e.start) - Date.now() > -1800000);
  if (soon) out.push({ id: 'meet:' + soon.e.id, text: soon.e.title, sub: (Date.now() >= Date.parse(soon.e.start) ? 'Happening now' : 'At ' + clock(soon.e.start)), href: soon.href, tag: 'Meeting' });
  for (const l of b.focus || []) out.push({ id: l.id, text: l.text, sub: l.sub, href: l.href, tag: l.urgency >= 3 ? 'Today' : 'Soon' });
  for (const c of S.cards || []) if (c.warn) out.push({ id: 'card:' + c.id, text: `${c.n} ${c.what}`, sub: c.note, href: c.href, tag: c.label });
  return out.filter((x) => !S.skipped.has(x.id)).slice(0, 3);
}
function focus() {
  const items = focusItems();
  return `<section class="h-card br-focus" aria-label="Focus"><div class="br-head"><h2>${ic('focus')}Your next three</h2><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-br-focus="0">${ic('back')}Show everything</button></div>
    ${items.length ? `<ol class="br-three">${items.map((x, i) => `<li><span class="br-num">${i + 1}</span><div class="br-main"><a class="br-t" href="${esc(x.href)}">${esc(x.text)}</a><span class="br-prep">${esc(x.sub || '')}</span></div><span class="br-tag">${esc(x.tag)}</span><button type="button" class="br-skip" data-br-skip="${esc(x.id)}">Skip</button></li>`).join('')}</ol>` : '<p class="br-clear">Nothing is waiting. Take the time to call a partner.</p>'}</section>`;
}

/* ------------------------------------------------------------------ the page */
function draw() {
  const b = S.data;
  document.querySelector('.r2t')?.classList.toggle('is-focus', S.focus);
  if (!b) { root.innerHTML = S.error ? '' : '<div class="r2t-skel br-skel"></div>'; return; }
  const toggle = `<button type="button" class="h-btn h-btn--ghost h-btn--sm br-focusbtn" data-br-focus="1">${ic('focus')}Focus</button>`;
  if (S.focus) { root.innerHTML = focus(); return; }
  const cols = [giftRows(b), thankRows(b), lateRows(b), meetingCol()].filter(Boolean);
  const empty = !cols.length && !(b.moments || []).length;
  const who = b.owner ? nameOwner(b) : '';
  root.innerHTML = `${away()}<section class="h-card br-card" aria-label="Briefing">
    <div class="br-head"><h2>Your briefing</h2>${who ? `<span>${esc(who)}'s partners</span>` : ''}${picker(b)}${toggle}</div>
    ${S.lead ? `<p class="br-lead">${esc(S.lead)}</p>` : `<p class="br-lead br-lead--plain">${esc(b.headline)}</p>`}
    ${cols.length ? `<div class="br-cols">${cols.join('')}</div>` : empty ? '<p class="br-clear">Nothing came in overnight, nothing is late and nobody is waiting on a thank-you.</p>' : ''}
  </section>${moments(b)}`;
}

async function load(fresh) {
  try {
    const q = [S.owner ? 'owner=' + encodeURIComponent(S.owner) : '', fresh ? 'fresh=1' : ''].filter(Boolean).join('&');
    const d = await get('/api/brief/today' + (q ? '?' + q : ''));
    if (!d.briefing) { root.hidden = true; return; }
    S.data = d.briefing;
    if (d.away) S.away = d.away;
    if (!S.owner && d.briefing.owner) S.owner = '';
    S.lead = null;
    draw();
    wantPrep();
    get('/api/brief/lead' + (S.owner ? '?owner=' + encodeURIComponent(S.owner) : '')).then((l) => { if (l.text) { S.lead = l.text; draw(); } }).catch(() => {});
  } catch (e) {
    S.error = e.message;
    root.innerHTML = '';
  }
}

root.addEventListener('click', (e) => {
  const call = e.target.closest('[data-br-call]');
  if (call && window.FavorCall && !e.metaKey && !e.ctrlKey) { e.preventDefault(); window.FavorCall.open(call.dataset.brCall); return; }
  const t = e.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-br-away-x')) { S.away = null; draw(); fetch('/api/brief/seen', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'X-Hub-Request': '1' }, body: '{}' }).catch(() => {}); return; }
  if (t.dataset.brFocus != null) { S.focus = t.dataset.brFocus === '1'; store.set(FOCUS_KEY, S.focus ? '1' : '0'); draw(); return; }
  if (t.dataset.brSkip) { S.skipped.add(t.dataset.brSkip); draw(); return; }
  if (t.dataset.brDismiss) {
    const id = t.dataset.brDismiss;
    const until = new Date(Date.now() + 14 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    S.data.moments = S.data.moments.filter((m) => m.id !== id); draw();
    fetch('/api/hub/snooze', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'moment:' + id, until }) }).catch(() => {});
    return;
  }
  if (t.dataset.brThank != null) {
    const g = S.data.thanks.rows[Number(t.dataset.brThank)];
    if (g && window.FavorWG) window.FavorWG.pop(t, { giftId: g.giftId, cid: g.cid, name: g.name, amount: g.amount, date: g.date, fund: g.fund, phone: g.phone, left: g.left, tasks: g.tasks, team: g.team }, { owner: g.owner, done: () => load(true) });
  }
});
root.addEventListener('change', (e) => {
  if (!e.target.matches('[data-br-owner]')) return;
  S.owner = e.target.value; store.set(OWNER_KEY, S.owner); S.data = null; draw(); load(false);
});
document.addEventListener('hub:day', (e) => { S.day = e.detail; if (S.data) { draw(); wantPrep(); } });
document.addEventListener('hub:cards', (e) => { S.cards = e.detail; if (S.data && S.focus) draw(); });
if (window.__hubDay) S.day = window.__hubDay;
draw();
load(false);
})();
