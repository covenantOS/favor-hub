/* The partner, one view everywhere: a slide-over drawer from any partner name in the hub (one click), the full page at
   /work/partner/<id>, and a compact copy beside the Work Center's edit panel. Reads GET /api/work/partners/:id (the D1 copy of
   Blackbaud) and the partner's notes (live, kept ten minutes). Writes go through /api/work/batches like the Work Center: saved,
   sent to Blackbaud, checked, and undone from the toast for 24 hours.
   Public: window.FavorPartner = { open, mount, view, search, href }. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(TODAY.slice(0, 4)) ? ', ' + y : ''); };
const money = (a) => (a == null ? '' : '$' + Number(a).toLocaleString('en-US', { minimumFractionDigits: Math.round(a) === Number(a) ? 0 : 2, maximumFractionDigits: 2 }));
const short = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 && v < 1e5 ? 1 : 0) + 'K' : money(Math.round(v)));
const dayn = (iso) => Math.round((Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') - Date.parse(TODAY + 'T12:00:00Z')) / 86400000);
const plain = (t) => String(t || '').replace(/^RESERVED \((.*)\)$/, '$1');
const ini = (n) => String(n || '').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
const I = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', text: '<path d="M4 5h16v11H9l-5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12"/><path d="M3 13h18"/><path d="M12 9c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/>',
  meet: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/>', letter: '<path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M8 13h8"/><path d="M8 17h5"/>', task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/>', ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
};
const ic = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const CAT_IC = { 'Phone call': 'phone', Email: 'mail', Mailing: 'letter', Meeting: 'meet', 'Task/Other': 'task' };
const href = (id) => '/work/partner/' + encodeURIComponent(id);
const AS = new URLSearchParams(location.search).get('as') || '';

async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

/* ------------------------------------------------------------------ data */
const CACHE = new Map(); // id -> { at, p }
const LOCAL = new Map(); // id -> { events: [], tasks: [], done: Set, moved: {} } changes made here that the copy of Blackbaud does not show yet
const local = (id) => { if (!LOCAL.has(id)) LOCAL.set(id, { events: [], tasks: [], done: new Set(), moved: {} }); return LOCAL.get(id); };
async function load(id, fresh) {
  const c = CACHE.get(id);
  if (c && !fresh && Date.now() - c.at < 60000) return c.p;
  const d = await api('/api/work/partners/' + encodeURIComponent(id));
  CACHE.set(id, { at: Date.now(), p: d.partner });
  return d.partner;
}
let GATE = null;
async function allowed() {
  if (GATE !== null) return GATE;
  try { GATE = !!(await api('/api/work/gate')).open; } catch (_) { GATE = false; }
  return GATE;
}
let CODES = null;
async function codes() { if (CODES) return CODES; try { CODES = await api('/api/work/codes'); } catch (_) { CODES = { codes: {}, me: {}, types: {} }; } return CODES; }

/* ------------------------------------------------------------------ writes */
async function run(params, label, after) {
  toast('Saving…');
  let out;
  try { out = await post('/api/work/batches', Object.assign({ req: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())) }, params)); } catch (e) { toast(e.message, null, true); return false; }
  const b = out.batch || {};
  if (b.id && b.run_when !== 'tonight') {
    for (let i = 0; i < 40; i++) { let r; try { r = await post(`/api/work/batches/${b.id}/run`); } catch (e) { toast(e.message, b.id, true); return false; } if (!r.left || r.held) break; await new Promise((res) => setTimeout(res, 1200)); }
    try {
      const rec = ((await api('/api/work/recent')).batches || []).find((x) => x.id === b.id);
      const bad = rec && rec.items.find((i) => i.state === 'failed');
      if (bad) { toast(bad.error || 'Blackbaud turned it down.', b.id, true); return false; }
    } catch (_) { /* the change is saved; the toast still offers Undo */ }
  }
  toast(b.run_when === 'tonight' ? label + '. It goes to Blackbaud tonight.' : label + '.', b.id);
  if (after) after();
  return true;
}
// The changes whose Undo was pressed, shared with the Work Center and the thank-you toast: a change is undone once.
const UNDOING = (window.favorUndoing = window.favorUndoing || new Set());
async function undo(bid) {
  if (UNDOING.has(bid)) return;
  UNDOING.add(bid);
  toast('Undoing…');
  try {
    const out = await post(`/api/work/batches/${bid}/undo`);
    if (out.batch && out.batch.id) for (let i = 0; i < 30; i++) { const r = await post(`/api/work/batches/${out.batch.id}/run`); if (!r.left || r.held) break; }
    // When some rows did not go back, Undo opens again for them.
    try { const b = ((await api('/api/work/recent')).batches || []).find((x) => x.id === bid); if (!b || (!b.undone && !b.undoing)) UNDOING.delete(bid); } catch (_) { /* the button stays off until the page reloads */ }
    toast('Undone.');
    if (V.id) { LOCAL.delete(V.id); refresh(true); }
  } catch (e) {
    // Already undone, or being undone: the button stays off. Any other failure puts it back.
    if (!(e.data && e.data.error === 'already_undone')) UNDOING.delete(bid);
    toast(e.message, null, true);
  }
}
let toastEl = null;
function toast(msg, bid, bad) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'pp-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.innerHTML = `<span class="${bad ? 'is-bad' : ''}">${esc(msg)}</span>${bid ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pp-undo="${esc(bid)}"${UNDOING.has(bid) ? ' disabled aria-busy="true"' : ''}>Undo</button>` : ''}`;
  toastEl.classList.add('is-on'); clearTimeout(toastEl._h); toastEl._h = setTimeout(() => toastEl.classList.remove('is-on'), bid ? 9000 : msg.endsWith('…') ? 30000 : 4200);
}

/* ------------------------------------------------------------------ the view */
const V = { id: null, p: null, filter: 'all', shown: 8, compose: null, notes: null, host: null, mode: 'drawer', editing: null };
function holderOf(p) { const cur = (p.assignments || []).filter((a) => a.current); return cur; }
function figure(label, value, sub) { return `<div class="pp-fig"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`; }
function eventsOf(p) {
  const L = local(p.id);
  const ev = [];
  for (const g of (p.giving.recent || [])) ev.push({ t: 'gift', d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: [g.type === 'RecurringGiftPayment' ? 'Monthly gift' : g.type, g.comment].filter(Boolean).join(' · ') });
  for (const g of ((p.giving.soft && p.giving.soft.recent) || [])) ev.push({ t: 'gift', d: g.date, a: g.amount, what: g.fund || 'No fund on file', how: 'Soft credit' });
  for (const a of (p.actions.recent || [])) ev.push({ t: 'act', id: a.id, d: a.done || a.due, icon: CAT_IC[a.category] || 'task', what: a.summary || plain(a.type), text: a.description, by: (a.fundraisers || []).map((f) => f.name).join(', ') + (a.outcome ? ' · ' + a.outcome : '') });
  for (const n of (V.notes || [])) ev.push({ t: 'note', d: n.date, what: n.summary || n.type, text: n.text && n.text !== n.summary ? n.text : '', by: n.type });
  for (const e of L.events) if (!ev.some((x) => x.t === e.t && x.what === e.what && x.d === e.d)) ev.push(e);
  return ev.filter((e) => e.d).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}
function tasksOf(p) {
  const L = local(p.id);
  const list = (p.actions.open || []).map((a) => ({ id: a.id, what: a.summary || plain(a.type), kind: a.category, by: (a.fundraisers || []).map((f) => f.name).join(', '), due: L.moved[a.id] || a.due, done: L.done.has(a.id) }));
  for (const t of L.tasks) if (!list.some((x) => x.what === t.what && x.due === t.due)) list.push(t);
  return list.sort((a, b) => (a.due < b.due ? -1 : 1));
}
/** Gifts on this partner that no one has thanked yet (Gifts to thank), with the Thank button. A thank-you made here clears the card at once. */
function oweCards(p) {
  const L = local(p.id);
  const list = (p.toThank || []).filter((g) => !L.thanked || !L.thanked.has(g.key));
  if (!list.length || !window.FavorWG) return L.thankedNow ? `<div class="wg-owe is-done"><div><b>Thanked just now</b><span>By ${esc(L.thankedNow)}</span></div></div>` : '';
  return list.slice(0, 3).map((g) => `<div class="wg-owe" data-wg-owe="${esc(g.key)}"><div><b>${money(g.amount)} to thank</b><span>${esc(fd(g.date))} · ${esc(g.fund || '')} · ${g.ageDays > 1 ? g.ageDays + ' days' : g.ageDays === 1 ? 'Yesterday' : 'Today'}${g.soft ? ' · Soft credit' : ''}</span></div><button type="button" class="h-btn h-btn--primary h-btn--sm" data-pp-thank="${esc(g.key)}">${ic('check')}Thank</button></div>`).join('') + (list.length > 3 ? `<p class="pp-empty" style="margin:6px 28px 0">${list.length - 3} more gifts to thank</p>` : '');
}
function view(p, o = {}) {
  const g = p.giving;
  const holders = holderOf(p);
  const phones = p.contact.phones || [];
  const callable = phones.find((x) => !x.doNotCall);
  const mobile = phones.find((x) => !x.doNotCall && /mobile|cell/i.test(x.type)) || null;
  const email = (p.contact.emails || []).find((x) => !x.doNotEmail);
  const iw = p.iwave;
  const evs = eventsOf(p).filter((e) => V.filter === 'all' || (V.filter === 'gifts' && e.t === 'gift') || (V.filter === 'contacts' && e.t === 'act') || (V.filter === 'notes' && e.t === 'note'));
  const tasks = tasksOf(p);
  let month = '';
  const shown = o.compact ? 5 : V.shown;
  const tl = evs.slice(0, shown).map((e) => {
    const m = String(e.d).slice(0, 7);
    const head = m !== month ? `<li class="pp-month">${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}</li>` : '';
    month = m;
    const when = `<span class="when">${fd(e.d)}</span>`;
    if (e.t === 'gift') return head + `<li class="pp-ev pp-ev--gift${e.fresh ? ' pp-ev--new' : ''}"><span class="pp-ev__dot">${ic('gift')}</span><div><span class="pp-amt">${money(e.a)}</span> <b>to ${esc(e.what)}</b>${e.how ? `<p class="by">${esc(e.how)}</p>` : ''}</div>${when}</li>`;
    if (e.t === 'note') return head + `<li class="pp-ev pp-ev--note${e.fresh ? ' pp-ev--new' : ''}"><span class="pp-ev__dot">${ic('note')}</span><div><b>${esc(e.what)}</b>${e.text ? `<p>${esc(e.text)}</p>` : ''}<p class="by">Note${e.by ? ' · ' + esc(e.by) : ''}</p></div>${when}</li>`;
    return head + `<li class="pp-ev${e.fresh ? ' pp-ev--new' : ''}"><span class="pp-ev__dot">${ic(e.icon || 'task')}</span><div><b>${esc(e.what)}</b>${e.text ? `<p>${esc(String(e.text).slice(0, 400))}</p>` : ''}${e.by ? `<p class="by">${esc(e.by)}</p>` : ''}</div>${when}</li>`;
  }).join('');
  const years = (g.years || []).slice(0, 8).reverse();
  const max = Math.max(1, ...years.map((y) => y.total));
  const flags = [p.deceased ? 'Deceased' : '', p.inactive ? 'Inactive' : '', p.flags.doNotCall ? 'Do not call' : '', p.flags.doNotEmail ? 'Do not email' : '', p.flags.doNotMail ? 'Do not mail' : ''].filter(Boolean);
  const head = `
    <div class="pp-head">
      <div><span class="pp-kicker">${esc(p.kind)} · ${esc(p.lookup)}${g.firstDate ? ' · Giving since ' + esc(String(g.firstDate).slice(0, 4)) : ''}</span>
        <h1>${o.full ? esc(p.name) : `<a href="${href(p.id)}" class="pp-h1link">${esc(p.name)}</a>`}</h1>
        <p class="pp-house">${esc(p.place || 'No city on file')}${p.household && p.household.length ? ' · ' + p.household.map((h) => `${esc(h.relation || 'Household')} <a href="${href(h.id)}" class="pp-link" data-partner-id="${esc(h.id)}">${esc(h.name)}</a>`).join(', ') : ''}</p></div>
      <div class="pp-meta">
        ${holders.length ? holders.slice(0, 2).map((h) => `<div class="pp-holder"><i>${esc(ini(h.name))}</i><span><b>${esc(h.name)}</b>${h.type ? ' · ' + esc(h.type) : ''}</span></div>`).join('') : '<div class="pp-holder"><span>No current holder</span></div>'}
        ${iw ? `<div class="pp-iw" title="iWave${iw.ratedOn ? ', rated ' + esc(fd(iw.ratedOn, true)) : ''}">iWave <span class="pp-iw__dots">${Array.from({ length: 10 }, (_, i) => `<s class="${iw.overall != null && i < iw.overall ? 'on' : ''}"></s>`).join('')}</span> ${iw.overall != null ? esc(iw.overall) : 'Not rated'}${iw.capacityBand ? ' · ' + esc(iw.capacityBand) : iw.capacity ? ' · ' + short(iw.capacity) : ''}</div>` : ''}
        ${flags.length ? `<div class="pp-flags">${flags.map((f) => `<span class="pp-flag">${esc(f)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  const acts = `<div class="pp-acts">
      ${callable ? `<a class="pp-tap" href="tel:${esc(callable.number.replace(/[^\d+]/g, ''))}">${ic('phone')}Call <small>${esc(callable.number)}</small></a>` : `<span class="pp-tap is-off">${ic('phone')}No phone to call</span>`}
      ${mobile ? `<a class="pp-tap" href="sms:${esc(mobile.number.replace(/[^\d+]/g, ''))}">${ic('text')}Text</a>` : ''}
      ${email ? `<a class="pp-tap" href="mailto:${esc(email.address)}">${ic('mail')}Email</a>` : ''}
      <span class="pp-acts__sep"></span>
      <button type="button" class="h-btn h-btn--primary h-btn--sm" data-pp-compose="contact">${ic('plus')}Log a contact</button>
      ${window.FavorPrep ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-prep="${esc(p.id)}">Call prep</button>` : ''}
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pp-compose="task">Task</button>
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pp-compose="note">Note</button>
    </div>`;
  const giving = `<div class="pp-giving">
      ${figure('Lifetime', money(Math.round(g.total)), g.count ? g.count.toLocaleString('en-US') + ' gifts' : 'No gifts')}
      ${figure('This year', money(Math.round(g.ytd)), 'Last 12 months ' + short(g.last12))}
      ${figure('Last gift', g.last ? money(g.last.amount) : 'None', g.last ? fd(g.last.date) + (g.last.fund ? ' · ' + esc(g.last.fund) : '') : '')}
      ${figure('Largest', g.largest ? money(g.largest.amount) : 'None', g.largest ? fd(g.largest.date, true) : '')}
    </div>`;
  const due = o.compact ? `<section class="pp-sec"><h3>Due and open</h3><div class="pp-due">${tasks.length ? tasks.map((t) => `<div class="pp-task pp-task--ro"><span></span><div class="pp-task__what"><b>${esc(t.what)}</b><span>${esc(t.kind || '')}${t.by ? ' · ' + esc(t.by) : ''}</span></div><span class="pp-datechip${dayn(t.due) < 0 ? ' is-late' : ''}">${dayn(t.due) < 0 ? -dayn(t.due) + ' days late' : 'Due ' + fd(t.due)}</span></div>`).join('') : '<p class="pp-empty">Nothing due.</p>'}</div></section>` : `<section class="pp-sec"><h3>Due and open <button type="button" data-pp-compose="task">Add a task</button></h3>
      <div class="pp-due">${tasks.length ? tasks.map((t) => { const n = dayn(t.due); return `<div class="pp-task${t.done ? ' is-done' : ''}"><button type="button" class="pp-check" data-pp-done="${esc(t.id)}" aria-label="Complete ${esc(t.what)}" ${t.local ? 'disabled' : ''}>${ic('check')}</button><div class="pp-task__what">${t.local ? `<b>${esc(t.what)}</b>` : `<button type="button" class="pp-taskopen" data-pp-task="${esc(t.id)}">${esc(t.what)}</button>`}<span>${esc(t.kind || '')}${t.by ? ' · ' + esc(t.by) : ''}${t.local ? ' · Saving' : ''}</span></div><button type="button" class="pp-datechip${n < 0 && !t.done ? ' is-late' : ''}" data-pp-move="${esc(t.id)}" ${t.local || t.done ? 'disabled' : ''}>${t.done ? 'Done today' : n < 0 ? -n + (n === -1 ? ' day late' : ' days late') : n === 0 ? 'Today' : 'Due ' + fd(t.due)}</button></div>`; }).join('') : '<p class="pp-empty">Nothing due.</p>'}</div></section>`;
  const timeline = `<section class="pp-sec"><h3>Timeline <span class="pp-filter"${o.compact ? ' hidden' : ''}>${[['all', 'All'], ['gifts', 'Gifts'], ['contacts', 'Contacts'], ['notes', 'Notes']].map(([k, l]) => `<button type="button" class="${V.filter === k ? 'is-on' : ''}" data-pp-filter="${k}">${l}</button>`).join('')}</span></h3>
      <ul class="pp-tl">${tl || '<li class="pp-empty" style="padding-left:34px">Nothing here yet.</li>'}</ul>
      ${evs.length > shown && !o.compact ? `<button type="button" class="pp-more" data-pp-more>Show ${Math.min(30, evs.length - shown)} older</button>` : ''}</section>`;
  if (o.compact) return `<div class="pp pp--compact">${head}${oweCards(p)}${giving}${due}${timeline}<p class="pp-compactfoot"><a class="h-btn h-btn--ghost h-btn--sm" href="${href(p.id)}">${ic('expand')}Full partner page</a></p></div>`;
  const chart = years.length ? `<section class="pp-sec"><h3>Giving by year</h3><div class="pp-chart" style="grid-template-columns:repeat(${years.length}, minmax(0, 1fr))">${years.map((y) => `<div class="pp-bar2${y.year === TODAY.slice(0, 4) ? ' is-now' : ''}" title="${esc(y.year)}: ${money(Math.round(y.total))}${y.soft ? ' plus ' + money(Math.round(y.soft)) + ' soft credit' : ''}"><em>${short(y.total)}</em><i style="height:${Math.max(4, Math.round(y.total / max * 92))}px"></i><span>${esc(y.year)}</span></div>`).join('')}</div></section>` : '';
  const opps = `<section class="pp-sec"><h3>Opportunities <button type="button" data-pp-oppnew>New opportunity</button></h3>
      ${(p.opportunities || []).length ? p.opportunities.map((x) => V.editing === 'opp' + x.id ? oppForm(x) : `<div class="pp-opp"><div><b>${esc(x.name)}</b><span class="sub">${[x.ask ? 'Ask ' + money(x.ask) : '', x.expected ? 'Expected ' + money(x.expected) : '', x.funded ? 'Funded ' + money(x.funded) : '', x.deadline || x.expectedDate ? 'By ' + fd(x.deadline || x.expectedDate, true) : ''].filter(Boolean).join(' · ') || esc(x.purpose)}</span></div><span class="pp-stage${/awarded|application|submitted/i.test(x.status) ? ' pp-stage--warm' : ''}">${esc(x.status || 'No status')}</span><button type="button" class="pp-iconbtn" aria-label="Edit ${esc(x.name)}" data-pp-opp="${esc(x.id)}">${ic('edit')}</button></div>`).join('') : '<p class="pp-empty">None.</p>'}
      ${V.editing === 'oppnew' ? oppForm(null) : ''}</section>`;
  const c = p.contact;
  const row = (dt, dd, btn) => `<dt>${dt}</dt><dd>${dd}</dd>${btn || '<span></span>'}`;
  const fieldRow = (kind, x, i) => {
    const key = kind + (x.id || i);
    if (V.editing === key) {
      const v = kind === 'phone' ? x.number : kind === 'email' ? x.address : '';
      return `<dt>${kind === 'phone' ? esc(x.type || 'Phone') : 'Email'}</dt><dd><form class="pp-inline" data-pp-field="${kind}" data-id="${esc(x.id || '')}"><input type="text" name="v" value="${esc(v)}" /><label class="pp-chk"><input type="checkbox" name="dn" ${(kind === 'phone' ? x.doNotCall : x.doNotEmail) ? 'checked' : ''}/>${kind === 'phone' ? 'Do not call' : 'Do not email'}</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button><button type="button" class="pp-edit" data-pp-cancel>Cancel</button></form></dd><span></span>`;
    }
    return row(kind === 'phone' ? esc(x.type || 'Phone') : 'Email', `${esc(kind === 'phone' ? x.number : x.address)}${x.primary ? '<small>Primary</small>' : ''}${(kind === 'phone' ? x.doNotCall : x.doNotEmail) ? `<small class="is-bad">Do not ${kind === 'phone' ? 'call' : 'email'}</small>` : ''}`, x.id ? `<button type="button" class="pp-edit" data-pp-edit="${kind}${esc(x.id)}">Edit</button>` : '');
  };
  const a = c.address;
  const addrRow = a ? (V.editing === 'address' ? `<dt>Address</dt><dd><form class="pp-inline pp-inline--addr" data-pp-field="address" data-id="${esc(a.id || '')}"><input type="text" name="lines" value="${esc(a.lines)}" placeholder="Street" /><input type="text" name="city" value="${esc(a.city)}" placeholder="City" /><input type="text" name="state" value="${esc(a.state)}" placeholder="State" /><input type="text" name="zip" value="${esc(a.zip)}" placeholder="ZIP" /><label class="pp-chk"><input type="checkbox" name="dn" ${a.doNotMail ? 'checked' : ''}/>Do not mail</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button><button type="button" class="pp-edit" data-pp-cancel>Cancel</button></form></dd><span></span>`
    : row('Address', `${esc([a.lines, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))}${a.doNotMail ? '<small class="is-bad">Do not mail</small>' : ''}${c.otherAddresses ? `<small>${c.otherAddresses} more on file</small>` : ''}`, a.id ? '<button type="button" class="pp-edit" data-pp-edit="address">Edit</button>' : '')) : row('Address', 'None on file');
  const details = `<details class="pp-fold"${V.editing && !String(V.editing).startsWith('opp') ? ' open' : ''}><summary>Contact details, codes and assignments</summary>
      <dl class="pp-dl">
        ${(c.phones || []).map((x, i) => fieldRow('phone', x, i)).join('')}
        ${V.editing === 'phonenew' ? `<dt>New phone</dt><dd><form class="pp-inline" data-pp-field="phone" data-id=""><input type="text" name="v" placeholder="(813) 555-0100" /><label class="pp-chk"><input type="checkbox" name="dn" />Do not call</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">Add</button><button type="button" class="pp-edit" data-pp-cancel>Cancel</button></form></dd><span></span>` : ''}
        ${(c.emails || []).map((x, i) => fieldRow('email', x, i)).join('')}
        ${V.editing === 'emailnew' ? `<dt>New email</dt><dd><form class="pp-inline" data-pp-field="email" data-id=""><input type="text" name="v" placeholder="name@example.com" /><label class="pp-chk"><input type="checkbox" name="dn" />Do not email</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">Add</button><button type="button" class="pp-edit" data-pp-cancel>Cancel</button></form></dd><span></span>` : ''}
        ${addrRow}
        ${row('Add', `<button type="button" class="pp-edit" data-pp-edit="phonenew">Phone</button> <button type="button" class="pp-edit" data-pp-edit="emailnew">Email</button>`)}
        ${row('Codes', (p.codes || []).map(esc).join(' · ') || 'None')}
        ${row('Assignments', (p.assignments || []).map((x) => `${esc(x.name)}${x.type ? ' (' + esc(x.type) + ')' : ''}${x.current ? '' : ' until ' + esc(fd(x.to, true))}`).join('<br>') || 'None')}
        ${(p.recurring || []).length ? row('Recurring', p.recurring.map((r) => `${money(r.amount)} ${esc(r.status)}${r.fund ? ' · ' + esc(r.fund) : ''}${r.lastPayment ? ' · last ' + fd(r.lastPayment) : ''}`).join('<br>')) : ''}
        ${row('Added', esc(fd(p.addedOn, true)))}
      </dl>
      <p class="pp-links"><a class="h-btn h-btn--ghost h-btn--sm" href="https://host.nxt.blackbaud.com/constituent/records/${esc(p.id)}?envid=p-5_k5FlbubEyEQnUJw7C9Rw" target="_blank" rel="noopener">${ic('ext')}Open in Blackbaud</a></p></details>`;
  return `<div class="pp">${head}${acts}${oweCards(p)}<div class="pp-composer">${V.compose ? composer(V.compose, p) : ''}</div>${giving}${due}${timeline}${chart}${opps}${details}<div class="pp-pad"></div></div>`;
}
function oppForm(x) {
  const C = (CODES && CODES.codes) || {};
  const st = (C.oppStatuses || ['Researching', 'Planned', 'Application in Progress', 'Application Submitted', 'Awarded - Active', 'Awarded - Closed', 'Declined', 'Abandoned']);
  const v = x || { name: '', status: 'Planned', ask: '', expected: '', deadline: '', expectedDate: '' };
  return `<form class="pp-compose pp-oppform" data-pp-oppform="${x ? esc(x.id) : ''}"><div class="pp-compose__row"><input type="text" name="name" value="${esc(v.name)}" placeholder="Opportunity name" required /><select name="status">${st.map((s) => `<option${v.status === s ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
    <div class="pp-compose__row"><input type="text" name="ask" inputmode="decimal" value="${v.ask || ''}" placeholder="Ask $" /><input type="text" name="expected" inputmode="decimal" value="${v.expected || ''}" placeholder="Expected $" /></div>
    <div class="pp-compose__row"><label class="pp-lab">Expected by<input type="date" name="expected_date" value="${esc(v.expectedDate || '')}" /></label><label class="pp-lab">Deadline<input type="date" name="deadline" value="${esc(v.deadline || '')}" /></label></div>
    <div class="pp-compose__foot"><span></span><span><button type="button" class="pp-edit" data-pp-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm">${x ? 'Save' : 'Add opportunity'}</button></span></div></form>`;
}
function composer(k, p) {
  const t = { contact: 'Log a contact', task: 'Add a task', note: 'Add a note' }[k];
  const kinds = [['Phone call', 'Call', 'phone'], ['Email', 'Email', 'mail'], ['Meeting', 'Meeting', 'meet'], ['Mailing', 'Mailing', 'letter'], ['Task/Other', 'Task', 'task']];
  const pick = k === 'task' ? 'Task/Other' : 'Phone call';
  const holders = holderOf(p);
  const me = CODES && CODES.me && CODES.me.fid ? CODES.me : null;
  const who = holders[0] ? holders[0].name : me ? me.name : '';
  return `<form class="pp-compose" data-pp-save="${k}"><div class="pp-compose__top"><b>${t}</b><button type="button" class="pp-iconbtn" data-pp-close-compose aria-label="Cancel">${ic('x')}</button></div>
    ${k === 'note' ? '' : `<div class="pp-seg">${kinds.map(([v, l, i]) => `<button type="button" class="${v === pick ? 'is-on' : ''}" data-pp-kind="${v}">${ic(i)}${l}</button>`).join('')}</div>`}
    <input type="text" name="what" placeholder="${k === 'note' ? 'The note' : k === 'task' ? 'What to do' : 'What happened'}" maxlength="255" required />
    ${k === 'note' ? '<textarea name="text" placeholder="More detail (optional)"></textarea>' : `<div class="pp-compose__row"><label class="pp-lab">${k === 'task' ? 'Due' : 'Date'}<input type="date" name="when" value="${k === 'task' ? new Date(Date.parse(TODAY + 'T12:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) : TODAY}" /></label>${k === 'contact' ? '<div class="pp-seg pp-seg--tags"><button type="button" data-pp-tag="Thanked">Thanked</button><button type="button" data-pp-tag="Stewardship">Stewardship</button><button type="button" data-pp-tag="Scheduling">Scheduling</button></div>' : '<span></span>'}</div>`}
    <div class="pp-compose__foot"><small>${k === 'note' ? 'Note on the partner record' : who ? 'For ' + esc(who) : ''}</small><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button></div></form>`;
}

/* ------------------------------------------------------------------ drawing into a host: drawer, full page or compact */
const skeleton = '<div class="pp-skel"><i style="height:16px;width:34%"></i><i style="height:40px;width:68%"></i><i style="height:14px;width:44%"></i><i style="height:38px"></i><i style="height:76px"></i><i style="height:160px"></i></div>';
function paint() {
  if (!V.host || !V.p) return;
  const sc = V.host;
  const y = sc.scrollTop;
  sc.classList.toggle('pp-ro', V.p.canEdit === false);
  sc.innerHTML = view(V.p, { full: V.mode === 'full' });
  sc.scrollTop = y;
}
async function show(host, id, mode) {
  Object.assign(V, { id, p: null, filter: 'all', shown: 8, compose: null, notes: null, host, mode, editing: null });
  host.innerHTML = skeleton;
  codes();
  try {
    const p = await load(id);
    if (V.id !== id) return null;
    V.p = p; paint();
    api('/api/work/partners/' + encodeURIComponent(id) + '/notes').then((d) => { if (V.id === id) { V.notes = d.rows || []; paint(); } }).catch(() => {});
    return p;
  } catch (e) {
    host.innerHTML = `<div class="pp-err"><h2>${e.status === 404 ? 'No partner found' : 'The partner did not load'}</h2><p>${esc(e.message)}</p></div>`;
    return null;
  }
}
async function refresh(fresh) {
  if (!V.id) return;
  try { V.p = await load(V.id, fresh); paint(); } catch (_) { /* keep what is shown */ }
}
/** The compact view beside the Work Center's edit panel. It has its own state, so it never disturbs an open drawer. */
async function mount(el, id, o = {}) {
  el.innerHTML = skeleton;
  try {
    const p = await load(id);
    el.innerHTML = view(p, { compact: !!o.compact });
    if (o.onLoad) o.onLoad(p);
    return p;
  } catch (e) {
    el.innerHTML = `<div class="pp-err"><p>${esc(e.message)}</p></div>`;
    return null;
  }
}

/* drawer */
let drawerEl = null;
function open(id) {
  if (!id) return;
  peekHide();
  const L = document.body;
  if (!drawerEl) {
    drawerEl = document.createElement('div');
    drawerEl.className = 'pp-layer';
    L.appendChild(drawerEl);
  }
  drawerEl.innerHTML = `<div class="pp-scrim" data-pp-close></div><aside class="pp-drawer" role="dialog" aria-modal="true" aria-label="Partner">
    <div class="pp-bar"><span class="pp-bar__name"></span><span class="pp-bar__acts"><a class="h-btn h-btn--ghost h-btn--sm" href="${href(id)}" data-pp-full>${ic('expand')}Open full page</a><button type="button" class="pp-iconbtn" data-pp-close aria-label="Close (Esc)">${ic('x')}</button></span></div>
    <div class="pp-scroll"></div></aside>`;
  requestAnimationFrame(() => $$('.pp-scrim, .pp-drawer', drawerEl).forEach((x) => x.classList.add('is-on')));
  const sc = $('.pp-scroll', drawerEl);
  sc.addEventListener('scroll', () => $('.pp-bar', drawerEl).classList.toggle('is-stuck', sc.scrollTop > 60));
  show(sc, id, 'drawer').then((p) => { if (p) { $('.pp-bar__name', drawerEl).textContent = p.name; $('.pp-drawer', drawerEl).setAttribute('aria-label', p.name); const f = $('.pp-drawer .pp-h1link', drawerEl); if (f) f.focus({ preventScroll: true }); } });
  document.documentElement.classList.add('pp-locked');
}
function close() {
  if (!drawerEl) return;
  $$('.pp-scrim, .pp-drawer', drawerEl).forEach((x) => x.classList.remove('is-on'));
  document.documentElement.classList.remove('pp-locked');
  setTimeout(() => { if (drawerEl) drawerEl.innerHTML = ''; }, 260);
  if (V.mode === 'drawer') Object.assign(V, { id: null, host: null, p: null });
}

/* ------------------------------------------------------------------ hover preview */
let peekEl = null, peekT = 0, peekFor = null;
function peekHide() { clearTimeout(peekT); peekFor = null; if (peekEl) peekEl.classList.remove('is-on'); }
async function peek(el, id) {
  if (!(await allowed())) return;
  peekFor = el;
  let p;
  try { p = await load(id); } catch (_) { return; }
  if (peekFor !== el) return;
  if (!peekEl) { peekEl = document.createElement('div'); peekEl.className = 'pp-peek'; peekEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(peekEl); }
  const h = holderOf(p)[0];
  peekEl.innerHTML = `<h4>${esc(p.name)}</h4><p>${esc(p.place || 'No city on file')}${h ? ' · ' + esc(h.name) : ''}</p><dl><dt>Last gift</dt><dd>${p.giving.last ? money(p.giving.last.amount) + ' on ' + fd(p.giving.last.date) : 'None'}</dd><dt>This year</dt><dd>${money(Math.round(p.giving.ytd))}</dd><dt>Lifetime</dt><dd>${money(Math.round(p.giving.total))}</dd><dt>Last contact</dt><dd>${p.lastContact ? esc(p.lastContact.category || p.lastContact.type) + ', ' + fd(p.lastContact.date) : 'None'}</dd><dt>Open</dt><dd>${p.actions.openCount} ${p.actions.openCount === 1 ? 'action' : 'actions'}</dd></dl>`;
  const r = el.getBoundingClientRect();
  peekEl.style.left = Math.max(8, Math.min(window.innerWidth - 316, r.left)) + 'px';
  peekEl.style.top = (r.bottom + 236 > window.innerHeight ? Math.max(8, r.top - 232) : r.bottom + 8) + 'px';
  peekEl.classList.add('is-on');
}
function idOf(el) {
  if (el.dataset.partnerId) return el.dataset.partnerId;
  const m = (el.getAttribute('href') || '').match(/^\/work\/partner\/(\d+)/);
  return m ? m[1] : null;
}
const NAME_SEL = 'a[href^="/work/partner/"]:not([data-pp-full]):not([data-i]), [data-partner-id], [data-partner-lookup]';
async function idForLookup(lk) {
  try { const d = await api('/api/work/partners?wide=1&q=' + encodeURIComponent(lk)); const hit = (d.rows || []).find((h) => String(h.lookup) === String(lk)) || (d.rows || [])[0]; return hit ? hit.cid : null; } catch (_) { return null; }
}
if (window.matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest(NAME_SEL);
    if (!el || el.closest('.pp-drawer, .pp-peek')) return;
    const id = idOf(el);
    if (!id) return;
    clearTimeout(peekT); peekT = setTimeout(() => peek(el, id), 320);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest(NAME_SEL)) peekHide(); });
}

/* ------------------------------------------------------------------ one click from anywhere */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t.closest) return;
  const undoBtn = t.closest('[data-pp-undo]');
  if (undoBtn) { if (!undoBtn.disabled) { undoBtn.disabled = true; undo(undoBtn.dataset.ppUndo); } return; }
  const name = t.closest(NAME_SEL);
  if (name && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    const onFullPage = /^\/work\/partner\/\d+/.test(location.pathname);
    // Staff without the Work Center keep the link's own behavior (the gate answer is read when the page loads).
    if (GATE !== true) return;
    e.preventDefault(); e.stopPropagation();
    let id = idOf(name);
    if (!id && name.dataset.partnerLookup) id = await idForLookup(name.dataset.partnerLookup);
    if (!id) return;
    if (onFullPage && V.id === id) return;
    open(id);
    return;
  }
  if (t.closest('[data-pp-close]')) { close(); return; }
  const b = t.closest('button');
  if (!b || !b.closest('.pp')) return;
  const d = b.dataset;
  if (d.ppThank) {
    const g = (V.p.toThank || []).find((x) => x.key === d.ppThank); if (!g || !window.FavorWG) return;
    const ph = (V.p.contact.phones || []).find((x) => !x.doNotCall);
    window.FavorWG.pop(b, { giftId: g.giftId, cid: g.cid, name: V.p.name, amount: g.amount, date: g.date, fund: g.fund, phone: ph ? ph.number : null, left: g.left, tasks: (g.taskIds || []).length });
    return;
  }
  if (d.ppCompose) { V.compose = d.ppCompose; V.editing = null; paint(); setTimeout(() => { const i = $('.pp-composer input[name="what"]', V.host); if (i) i.focus(); }, 30); return; }
  if (b.hasAttribute('data-pp-close-compose')) { V.compose = null; paint(); return; }
  if (d.ppKind) { $$('[data-pp-kind]', b.parentElement).forEach((x) => x.classList.toggle('is-on', x === b)); return; }
  if (d.ppTag) { b.classList.toggle('is-on'); return; }
  if (d.ppFilter) { V.filter = d.ppFilter; paint(); return; }
  if (b.hasAttribute('data-pp-more')) { V.shown += 30; paint(); return; }
  if (d.ppEdit) { V.editing = d.ppEdit; paint(); setTimeout(() => { const i = $('.pp-inline input[type="text"]', V.host); if (i) i.focus(); }, 30); return; }
  if (b.hasAttribute('data-pp-cancel')) { V.editing = null; paint(); return; }
  if (d.ppOpp) { V.editing = 'opp' + d.ppOpp; paint(); return; }
  if (b.hasAttribute('data-pp-oppnew')) { V.editing = 'oppnew'; paint(); return; }
  if (d.ppTask) {
    // On the Work Center the action opens in its edit panel; elsewhere the Work Center opens on it.
    if (window.WCEdit && window.WCEdit.panel) { close(); setTimeout(() => window.WCEdit.panel(d.ppTask), 200); } else location.href = '/work/?action=' + encodeURIComponent(d.ppTask);
    return;
  }
  if (d.ppDone) {
    const id = d.ppDone; const L = local(V.id); const p = V.p;
    const task = (p.actions.open || []).find((a) => a.id === id);
    L.done.add(id); paint();
    const ok = await run({ op: 'edit', ids: [id], set: { status: 'Completed' }, seen: { status: 'Open' } }, 'Marked complete', () => {
      L.events.push({ t: 'act', d: TODAY, icon: CAT_IC[task && task.category] || 'task', what: task ? task.summary || task.type : 'Completed', by: 'Completed just now', fresh: 1 });
      paint();
    });
    if (!ok) { L.done.delete(id); paint(); }
    return;
  }
  if (d.ppMove) {
    const id = d.ppMove;
    const anchor = b;
    const r = anchor.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'pp-pop';
    const plus = (n) => new Date(Date.parse(TODAY + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    pop.innerHTML = `${[['Tomorrow', plus(1)], ['+1 week', plus(7)], ['+2 weeks', plus(14)], ['+1 month', plus(30)]].map(([l, v]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}<input type="date" min="${TODAY}" aria-label="New due date" />`;
    document.body.appendChild(pop);
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
    const go = async (v) => {
      pop.remove(); if (!v) return;
      const L = local(V.id); const was = L.moved[id];
      L.moved[id] = v; paint();
      const task = (V.p.actions.open || []).find((a) => a.id === id);
      const ok = await run({ op: 'edit', ids: [id], set: { date: v }, seen: { date: task ? task.due : undefined } }, 'Moved to ' + fd(v));
      if (!ok) { if (was) L.moved[id] = was; else delete L.moved[id]; paint(); }
    };
    pop.addEventListener('click', (ev) => { const x = ev.target.closest('[data-v]'); if (x) go(x.dataset.v); });
    $('input', pop).addEventListener('change', (ev) => go(ev.target.value));
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
    return;
  }
}, true);
allowed();

// A thank-you saved from the drawer, the Gifts to thank tab or the brief clears the card here too, and an undo brings it back.
document.addEventListener('favor:thanked', (e) => {
  const dt = e.detail || {};
  if (!V.p) return;
  const L = local(V.p.id);
  let hit = false;
  for (const i of dt.items || []) if (String(i.cid) === V.p.id) { (L.thanked || (L.thanked = new Set())).add(`${i.giftId}:${i.cid}`); hit = true; }
  if (hit && !dt.left) L.thankedNow = 'you';
  if (hit) paint();
});
document.addEventListener('favor:thanked-undone', () => { if (!V.id) return; const L = local(V.id); L.thanked = new Set(); L.thankedNow = ''; refresh(true); });
document.addEventListener('favor:thanked-failed', () => { if (!V.id) return; const L = local(V.id); L.thanked = new Set(); L.thankedNow = ''; refresh(true); });
function openCompose(id, kind) { open(id); const t = setInterval(() => { if (V.id === id && V.p) { clearInterval(t); V.compose = kind; paint(); } }, 120); setTimeout(() => clearInterval(t), 6000); }

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (!f.closest || !f.closest('.pp')) return;
  e.preventDefault();
  const p = V.p; if (!p) return;
  const cid = p.id;
  const L = local(cid);
  if (f.dataset.ppSave) {
    const k = f.dataset.ppSave;
    const what = f.what.value.trim(); if (!what) return;
    if (k === 'note') {
      L.events.push({ t: 'note', d: TODAY, what, text: f.text ? f.text.value : '', by: 'Saving', fresh: 1 });
      V.compose = null; paint();
      const ok = await run({ op: 'pnote', cid, note: { summary: what, text: f.text ? f.text.value : '' } }, 'Note added', async () => { L.events = L.events.filter((x) => !(x.t === 'note' && x.what === what)); try { V.notes = (await api('/api/work/partners/' + cid + '/notes?fresh=1')).rows || []; } catch (_) {} paint(); });
      if (!ok) { L.events = L.events.filter((x) => x.what !== what); paint(); }
      return;
    }
    const cat = ($('[data-pp-kind].is-on', f) || {}).dataset ? $('[data-pp-kind].is-on', f).dataset.ppKind : 'Phone call';
    const when = f.when ? f.when.value : TODAY;
    const C = await codes();
    const holders = holderOf(p);
    const fr = holders[0] ? [holders[0].fid] : C.me && C.me.fid ? [C.me.fid] : [];
    const type = (fr[0] && C.types && C.types[fr[0]]) || (C.me && C.me.type) || 'RDD Action';
    const tags = $$('[data-pp-tag].is-on', f).map((x) => ({ category: x.dataset.ppTag }));
    const set = { category: cat, type, date: when, summary: what, fundraisers: fr, completed: k === 'contact', status: k === 'contact' ? 'Completed' : 'Open' };
    if (['Phone call', 'Email', 'Mailing'].includes(cat)) set.direction = 'Outbound';
    if (k === 'contact') L.events.push({ t: 'act', d: when, icon: CAT_IC[cat], what, by: 'Saving', fresh: 1 });
    else L.tasks.push({ id: 'local' + Date.now(), what, kind: cat, by: holders[0] ? holders[0].name : '', due: when, local: true });
    V.compose = null; paint();
    const ok = await run({ op: 'new', cids: [cid], set, tags: tags.length ? { add: tags } : undefined }, k === 'contact' ? 'Contact logged' : 'Task added', () => {
      for (const ev of L.events) if (ev.what === what && ev.by === 'Saving') ev.by = 'Saved just now';
      for (const t of L.tasks) if (t.what === what) t.by = (t.by ? t.by + ' · ' : '') + 'saved';
      paint();
      // Blackbaud's copy reads the new action in within a minute; the list then comes from it.
      setTimeout(() => { L.tasks = L.tasks.filter((t) => t.what !== what); refresh(true); }, 45000);
    });
    if (!ok) { L.events = L.events.filter((x) => x.what !== what); L.tasks = L.tasks.filter((x) => x.what !== what); paint(); }
    return;
  }
  if (f.dataset.ppField) {
    const kind = f.dataset.ppField; const id = f.dataset.id;
    let set;
    if (kind === 'address') set = { address_lines: f.lines.value, city: f.city.value, state: f.state.value, postal_code: f.zip.value, do_not_mail: f.dn.checked };
    else set = kind === 'phone' ? { number: f.v.value, do_not_call: f.dn.checked } : { address: f.v.value, do_not_email: f.dn.checked };
    // Optimistic: show the new value at once.
    const c = p.contact;
    if (kind === 'phone' && id) Object.assign(c.phones.find((x) => x.id === id) || {}, { number: set.number, doNotCall: set.do_not_call });
    else if (kind === 'email' && id) Object.assign(c.emails.find((x) => x.id === id) || {}, { address: set.address, doNotEmail: set.do_not_email });
    else if (kind === 'address' && c.address) Object.assign(c.address, { lines: set.address_lines, city: set.city, state: set.state, zip: set.postal_code, doNotMail: set.do_not_mail });
    else if (kind === 'phone') c.phones.push({ number: set.number, type: 'Mobile', primary: false, doNotCall: set.do_not_call });
    else c.emails.push({ address: set.address, primary: false, doNotEmail: set.do_not_email });
    V.editing = null; paint();
    const ok = await run({ op: 'pfield', cid, field: { kind, id: id || undefined, set } }, kind === 'address' ? 'Address saved' : kind === 'phone' ? 'Phone saved' : 'Email saved');
    if (!ok) refresh(true);
    return;
  }
  if (f.dataset.ppOppform !== undefined) {
    const id = f.dataset.ppOppform;
    const opp = { name: f.name.value, status: f.status.value, ask_amount: f.ask.value, expected_amount: f.expected.value, expected_date: f.expected_date.value, deadline: f.deadline.value };
    if (id) { const x = p.opportunities.find((o) => o.id === id); if (x) Object.assign(x, { name: opp.name, status: opp.status, ask: Number(String(opp.ask_amount).replace(/[$,]/g, '')) || 0, expected: Number(String(opp.expected_amount).replace(/[$,]/g, '')) || 0, expectedDate: opp.expected_date, deadline: opp.deadline }); }
    else p.opportunities.unshift({ id: 'new', name: opp.name, status: opp.status, ask: Number(String(opp.ask_amount).replace(/[$,]/g, '')) || 0, expected: 0, funded: 0, purpose: '', deadline: opp.deadline, expectedDate: opp.expected_date, by: [] });
    V.editing = null; paint();
    const ok = await run(id ? { op: 'opp_edit', opp_id: id, opp } : { op: 'opp_new', cid, opp }, id ? 'Opportunity saved' : 'Opportunity added', () => { CACHE.delete(cid); });
    if (!ok) refresh(true);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawerEl && $('.pp-drawer.is-on', drawerEl)) { if (V.compose || V.editing) { V.compose = null; V.editing = null; paint(); } else close(); e.stopPropagation(); }
}, true);

/* ------------------------------------------------------------------ search: the header box, the search page, pickers */
function search(host, o = {}) {
  host.innerHTML = `<div class="pv-find"><label class="pv-find__box">${ic('search')}<input type="search" placeholder="${esc(o.placeholder || 'Find a partner')}" autocomplete="off" aria-label="Find a partner" /></label><ul class="pv-find__list" role="listbox" hidden></ul></div>`;
  const input = host.querySelector('input');
  wireSearch(input, host.querySelector('.pv-find__list'), o);
  return input;
}
function wireSearch(input, list, o = {}) {
  let timer = 0; let seq = 0; let hits = []; let hi = -1;
  const draw = () => {
    list.hidden = false;
    list.innerHTML = hits.length
      ? hits.map((h, i) => `<li role="option" class="${i === hi ? 'is-hi' : ''}"><a href="${href(h.cid)}" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.place || 'No city on file')} · ${esc(h.lookup)}${h.deceased ? ' · deceased' : ''}</span></a></li>`).join('')
      : '<li class="is-none">No partner found.</li>';
  };
  const pick = (h) => { list.hidden = true; if (o.onPick) o.onPick(h); else { input.value = ''; open(h.cid); } };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const t = input.value.trim();
    if (t.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      try { const d = await api('/api/work/partners?wide=1&q=' + encodeURIComponent(t)); if (mine !== seq) return; hits = d.rows || []; hi = hits.length ? 0 : -1; draw(); } catch (e) { list.hidden = false; list.innerHTML = `<li class="is-none">${esc(e.message)}</li>`; }
    }, 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); hi = (hi + 1) % hits.length; draw(); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); hi = (hi - 1 + hits.length) % hits.length; draw(); }
    else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); pick(hits[hi]); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('click', (e) => { const a = e.target.closest('a[data-i]'); if (a) { e.preventDefault(); e.stopPropagation(); pick(hits[Number(a.dataset.i)]); } }, true);
  document.addEventListener('click', (e) => { if (!list.contains(e.target) && e.target !== input) list.hidden = true; });
}
// The header box on every page (the layout draws it for Work Center users).
const headBox = document.getElementById('pp-headsearch');
if (headBox) {
  allowed().then((ok) => {
    if (!ok) return;
    headBox.hidden = false;
    const btn = document.querySelector('.h-top__search'); if (btn) btn.hidden = true;
    wireSearch($('input', headBox), $('.pv-find__list', headBox), {});
  });
}

/* ------------------------------------------------------------------ the full page: /work/partner/<id>, and /work/partner/ to search */
const root = document.getElementById('pv-root');
if (root) {
  const m = location.pathname.match(/\/work\/partner\/(\d+)/);
  if (m) {
    show(root, m[1], 'full').then((p) => { if (p) { document.title = p.name + ' - Favor Hub'; const t = document.querySelector('.h-top__title'); if (t) t.textContent = p.name; } });
  } else {
    root.innerHTML = '<div class="pp-landing"><h1>Find a partner</h1><div id="pv-search"></div></div>';
    const input = search($('#pv-search'), { onPick: (h) => { location.href = href(h.cid); } });
    input.focus();
  }
}

window.FavorPartner = { open, close, mount, view, search, href, refresh, openCompose };
})();
