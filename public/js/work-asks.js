/* Asks (Work Center tab): every action tagged Amount of Ask in the last year, in four columns: Asked with no close date, Closing, Past the
   close date and Gave. A close-date chip on each card opens a small panel and saves at once with Undo. Reads GET /api/work/asks (the D1
   copy of Blackbaud, no Blackbaud calls); the close date is saved with PUT /api/work/asks/:id/close in the hub database.
   Registers through window.WCTabs. Directors see their own asks; the Support Team and admins pick a director or see everyone. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const A = { data: null, loading: false, error: '', owner: '', mode: 'board', q: '', status: 'open', range: '12m', more: {}, started: false, undo: null };
const STATUS = [['open', 'Open'], ['gave', 'Gave'], ['review', 'Check amount'], ['all', 'All']];
const COLS_FOR = { open: ['open', 'closing', 'past'], gave: ['gave'], review: ['open', 'closing', 'past', 'gave'], all: ['open', 'closing', 'past', 'gave'] };
const PAGE = 20;
const COLS = [['open', 'Asked, no close date'], ['closing', 'Closing'], ['past', 'Past the close date'], ['gave', 'Gave']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => (A.data && A.data.today) || new Date().toISOString().slice(0, 10);
const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(today().slice(0, 4)) ? ', ' + y : ''); };
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === Number(n) ? 0 : 2, maximumFractionDigits: 2 });
const short = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 && v < 1e5 ? 1 : 0) + 'K' : money(Math.round(v)));
const ic = (n, cls) => (F() ? F().ic(n, cls) : W().ic(n, cls));
const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');

// Easter Sunday for a year (the anonymous Gregorian algorithm).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), dayN = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(dayN).padStart(2, '0')}`;
}
// The quick dates the panel offers, from today.
function quick(t) {
  const y = Number(t.slice(0, 4));
  const yearEnd = `${y}-12-31` >= t ? `${y}-12-31` : `${y + 1}-12-31`;
  let after = addDay(easter(y), 1);
  if (after <= t) after = addDay(easter(y + 1), 1);
  return [['In 30 days', addDay(t, 30)], ['In 60 days', addDay(t, 60)], ['By year end', yearEnd], ['After Easter', after]];
}

async function load(owner) {
  A.loading = true; A.error = '';
  try {
    const qs = [owner ? 'owner=' + encodeURIComponent(owner) : '', A.range === 'all' ? 'range=all' : ''].filter(Boolean).join('&');
    const d = await W().api('/api/work/asks' + (qs ? '?' + qs : ''));
    A.data = d; A.owner = d.owner || ''; A.more = {};
  } catch (e) { A.error = e.message; }
  A.loading = false;
}
async function start() {
  if (A.started) return;
  A.started = true;
  await load();
  W().render();
}

const rows = () => (A.data ? A.data.rows : []);
const match = (r) => !A.q || (r.name + ' ' + r.line + ' ' + r.place).toLowerCase().includes(A.q.toLowerCase());
const inStatus = (r) => (A.status === 'open' ? !r.review && r.state !== 'gave' : A.status === 'gave' ? !r.review && r.state === 'gave' : A.status === 'review' ? r.review : true);
const shown = () => rows().filter((r) => match(r) && inStatus(r));
const daysFrom = (iso) => Math.max(0, Math.round((Date.parse(today() + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000));
const count = () => (A.data ? A.data.stats.open.n : '');
const dot = () => !!A.data && A.data.stats.past.n > 0;

function chip(r) {
  const label = r.state === 'gave' ? '' : !r.close ? 'No close date' : r.state === 'past' ? 'Past ' + fd(r.close.date) : 'Close by ' + fd(r.close.date);
  if (r.state === 'gave') return `<span class="wa-gave">Gave ${money(r.gave.amount)} on ${esc(fd(r.gave.date, true))}</span>`;
  return `<button type="button" class="wa-chip${r.state === 'past' ? ' is-past' : !r.close ? ' is-none' : ''}" data-wa-close="${esc(r.id)}" aria-haspopup="dialog" aria-label="Expected close for ${esc(r.name)}: ${esc(label)}">${W().ic('clock')}${esc(label)}</button>`;
}
const asked = (r) => { const n = daysFrom(r.first || r.date); return `Asked ${fd(r.first || r.date, true)}${n > 0 ? ' · ' + (n === 1 ? '1 day ago' : n.toLocaleString('en-US') + ' days ago') : ' · today'}`; };
const prepBtn = (r) => `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-prep="${esc(r.cid)}">${ic('brief')}Prep</button>`;
const who = (r) => (A.data.owners.length > 1 && !A.owner ? `<span class="wa-who">${esc(r.ownerNames.join(', '))}</span>` : '');

function card(r) {
  return `<article class="wa-card${r.state === 'past' ? ' is-past' : ''}" data-id="${esc(r.id)}">
    <b class="wa-amt">${money(r.amount)}</b>
    <a class="wa-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a>
    ${r.place ? `<span class="wa-sub">${esc(r.place)}</span>` : ''}
    ${r.line ? `<p>${esc(r.line)}</p>` : ''}
    <span class="wa-sub">${esc(asked(r))}</span>${who(r)}
    <div class="wa-acts">${chip(r)}${prepBtn(r)}</div></article>`;
}

function colRows(k) {
  const l = shown().filter((r) => r.state === k);
  if (k === 'open') return l.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  if (k === 'closing') return l.sort((a, b) => (a.close.date < b.close.date ? -1 : a.close.date > b.close.date ? 1 : a.id < b.id ? -1 : 1));
  if (k === 'past') return l.sort((a, b) => (a.close.date < b.close.date ? 1 : a.close.date > b.close.date ? -1 : a.id < b.id ? 1 : -1));
  return l.sort((a, b) => (a.gave.date < b.gave.date ? 1 : a.gave.date > b.gave.date ? -1 : a.id < b.id ? 1 : -1));
}

function boardHTML() {
  const use = COLS.filter(([k]) => COLS_FOR[A.status].includes(k));
  return `<div class="wa-board" style="--wa-cols:${use.length}">${use.map(([k, label]) => {
    const l = colRows(k); const cap = PAGE + (A.more[k] || 0);
    const total = l.reduce((s, r) => s + (k === 'gave' ? r.gave.amount : r.amount), 0);
    return `<section class="wa-col" aria-label="${esc(label)}"><h4>${esc(label)} <b>${l.length}</b><em>${short(total)}</em></h4>
      ${l.slice(0, cap).map(card).join('') || '<div class="wa-col__empty">Nothing here</div>'}
      ${l.length > cap ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm wa-more" data-wa-more="${k}">Show ${Math.min(PAGE, l.length - cap)} more of ${l.length - cap}</button>` : ''}</section>`;
  }).join('')}</div>`;
}

const ORDER = { past: 0, closing: 1, open: 2, gave: 3 };
function listHTML() {
  const cap = PAGE * 5 + (A.more.list || 0);
  const l = shown().slice().sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return `<div class="wa-list">${l.slice(0, cap).map((r) => `<div class="wa-row${r.state === 'past' ? ' is-past' : ''}" data-id="${esc(r.id)}">
      <div class="wa-amt wa-c-amt">${money(r.amount)}<small>${esc('Asked ' + fd(r.date, true))}</small></div>
      <div class="wa-c-who"><a class="wa-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wa-sub">${esc(r.place)}</span>${who(r)}</div>
      <div class="wa-said wa-c-said">${esc(r.line)}</div>
      <div class="wa-c-close">${chip(r)}</div>
      <div class="wa-c-prep">${prepBtn(r)}</div></div>`).join('') || '<div class="wa-empty"><b>Nothing matches</b></div>'}
    ${l.length > cap ? `<div class="wa-moreRow"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-more="list">Show ${Math.min(PAGE * 5, l.length - cap)} more of ${l.length - cap}</button></div>` : ''}</div>`;
}

function view() {
  const el = $('#view');
  if (!el) return;
  if (!A.data && !A.error) { el.innerHTML = '<section class="h-card wc-sheet" aria-busy="true"><div class="h-skel" style="height:320px;border-radius:18px"></div></section>'; if (!A.loading) start(); return; }
  if (A.error && !A.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wa-empty"><b>The asks did not load</b>${esc(A.error)}<p><button type="button" class="h-btn h-btn--primary" data-wa-reload>Try again</button></p></div></section>`; return; }
  const d = A.data; const s = d.stats;
  const tiles = [['Open asks', s.open], ['Closing in 90 days', s.soon], ['Past the close date', s.past, 1], ['Gifts since the ask', s.gave]];
  const picker = d.owners.length > 1 ? `<select class="wc-sel${A.owner ? ' is-set' : ''}" data-wa-owner aria-label="Director"><option value="">Every director (${d.everyone})</option>${d.owners.map((o) => `<option value="${esc(o.id)}"${A.owner === o.id ? ' selected' : ''}>${esc(o.name)} (${o.n})</option>`).join('')}</select>` : '';
  el.innerHTML = `
    <div class="h-card wc-band wa-band" style="--n:4">${tiles.map(([l, t, warn]) => `<div class="wc-stat${warn && t.n ? ' is-warn' : ''}"><b>${t.n.toLocaleString('en-US')}</b><span>${esc(l)}</span><span class="wa-tot">${short(t.total)}</span></div>`).join('')}</div>
    <section class="h-card wc-sheet" id="wa-sheet" aria-label="Asks">
      <div class="wa-filters" role="group" aria-label="Filter">${STATUS.map(([k, l]) => `<button type="button" class="wa-fchip${A.status === k ? ' is-on' : ''}" data-wa-status="${k}" aria-pressed="${A.status === k}">${esc(l)}${k === 'review' ? ' <span>' + d.review.n + '</span>' : ''}</button>`).join('')}
        <select class="wc-sel wa-range${A.range === 'all' ? ' is-set' : ''}" data-wa-range aria-label="Tagged"><option value="12m"${A.range === '12m' ? ' selected' : ''}>Tagged in the last 12 months</option><option value="all"${A.range === 'all' ? ' selected' : ''}>All time</option></select></div>
      <div class="wa-tools"><div class="wa-seg" role="group" aria-label="View"><button type="button" class="${A.mode === 'board' ? 'is-on' : ''}" data-wa-mode="board" aria-pressed="${A.mode === 'board'}">Board</button><button type="button" class="${A.mode === 'list' ? 'is-on' : ''}" data-wa-mode="list" aria-pressed="${A.mode === 'list'}">List</button></div>
        <label class="wc-find">${W().ic('search')}<input type="search" id="wa-q" placeholder="Find a partner" value="${esc(A.q)}" autocomplete="off" /></label>${picker}<span class="wa-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="asks">${ic('sheet')}Google Sheets</button></div>
      ${shown().length || d.rows.length ? (A.mode === 'board' ? boardHTML() : listHTML()) : '<div class="wa-empty"><b>No asks in the last year</b>An action with the Amount of Ask tag shows here.</div>'}
      <div class="wa-foot">${plural(shown().length, 'ask')} shown, ${A.range === 'all' ? 'tagged at any time' : 'tagged in the last 12 months'}. An amount tagged again on the same partner within 90 days counts once. Asks that look far above what the partner has given sit under Check amount and are left out of the totals. A gift of the asked amount or more after the ask moves it to Gave.</div>
    </section>`;
  registerSheet();
}

function registerSheet() {
  if (!window.FavorSheets || A.sheetOn) return;
  A.sheetOn = true;
  window.FavorSheets.register('asks', () => {
    const lab = { open: 'No close date', closing: 'Closing', past: 'Past the close date', gave: 'Gave' };
    const cols = [{ key: 'status', label: 'Status', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Amount asked', type: 'money' },
      { key: 'asked', label: 'Asked on', type: 'date' }, { key: 'line', label: 'About', type: 'text' }, { key: 'close', label: 'Expected close', type: 'date' }, { key: 'gave', label: 'Gift amount', type: 'money' }, { key: 'gavedate', label: 'Gift date', type: 'date' }, { key: 'owner', label: 'Director', type: 'text' }];
    const data = shown().slice().sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.date < b.date ? 1 : -1)).map((r) => ({ status: lab[r.state], partner: r.name, place: r.place, amount: r.amount, asked: r.date, line: r.line, close: r.close ? r.close.date : null, gave: r.gave ? r.gave.amount : null, gavedate: r.gave ? r.gave.date : null, owner: r.ownerNames.join(', ') }));
    return window.FavorSheets.screen('Asks', [{ name: 'Asks', columns: cols, rows: data }], { filters: A.q ? 'Search: ' + A.q : '', classes: ['partner'] });
  });
}

/* ------------------------------------------------------------------ the close date */
function panel(id) {
  const r = rows().find((x) => x.id === id); if (!r) return;
  const t = today(); const cur = r.close ? r.close.date : '';
  W().dialog(`<div class="wc-dlg__head"><div><span class="h-label">Asks</span><h2>Expected close</h2><p class="wa-dsub">${esc(r.name)} · ${money(r.amount)}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${W().ic('x')}</button></div>
    <div class="wc-dlg__body wa-panel">
      <div class="wa-quick">${quick(t).map(([l, v]) => `<button type="button" class="wa-q${cur === v ? ' is-on' : ''}" data-wa-pick="${v}"><span>${esc(l)}</span><em>${esc(fd(v, true))}</em></button>`).join('')}</div>
      <label class="wa-date"><span>Pick a date</span><input type="date" id="wa-date" min="${t}" value="${esc(cur)}" /></label>
      <div class="wa-foot2"><span>${cur ? 'Now ' + esc(fd(cur, true)) : 'No date yet'}</span>${cur ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-clear>Clear</button>' : ''}<button type="button" class="h-btn h-btn--primary" data-wa-save>Save</button></div>
    </div>`, () => { A.panelId = id; });
}

async function saveClose(id, date) {
  const r = rows().find((x) => x.id === id); if (!r) return;
  let out;
  try { out = await W().api(`/api/work/asks/${encodeURIComponent(id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) }); }
  catch (e) { W().toast(e.message); return; }
  W().closeLayer();
  apply(id, out.close);
  toast(out.close ? `Expected close ${fd(out.close, true)}` : 'Close date cleared', id, out.previous);
}
// Move the card to its new column at once and recompute the totals the same way the server does.
function apply(id, date) {
  const d = A.data; const r = d.rows.find((x) => x.id === id); if (!r) return;
  const all = d.rows; d.rows = all.filter((x) => !x.review);
  r.close = date ? { date, by: 'you' } : null;
  if (r.state !== 'gave') r.state = !date ? 'open' : date < d.today ? 'past' : 'closing';
  const live = d.rows.filter((x) => x.state !== 'gave'); const horizon = addDay(d.today, 90);
  const sum = (l, f) => ({ n: l.length, total: l.reduce((t, x) => t + (f ? f(x) : x.amount), 0) });
  d.stats = { open: sum(live), soon: sum(live.filter((x) => x.state === 'closing' && x.close.date <= horizon)), past: sum(live.filter((x) => x.state === 'past')), gave: sum(d.rows.filter((x) => x.state === 'gave'), (x) => x.gave.amount) };
  d.rows = all;
  if (W().S.view === 'asks') W().render();
}
function toast(msg, id, previous) {
  const t = $('#toast'); if (!t) return;
  A.undo = { id, previous };
  t.innerHTML = `<span class="ok">${W().ic('check')}</span><span>${esc(msg)}</span><button class="h-btn h-btn--ghost h-btn--sm" data-wa-undo>${W().ic('undo')}Undo</button>`;
  t.classList.add('is-on'); clearTimeout(A.tt); A.tt = setTimeout(() => t.classList.remove('is-on'), 9000);
}
async function undo() {
  const u = A.undo; if (!u) return;
  A.undo = null; $('#toast').classList.remove('is-on');
  // A previous date that has gone by cannot be set again; the card goes back to no date then.
  const date = u.previous && u.previous >= today() ? u.previous : null;
  try { const out = await W().api(`/api/work/asks/${encodeURIComponent(u.id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) }); apply(u.id, out.close); W().toast('Undone.'); }
  catch (e) { W().toast(e.message); }
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', (e) => {
  const t = e.target; if (!t.closest) return;
  const un = t.closest('[data-wa-undo]'); if (un) { undo(); return; }
  const lay = t.closest('#layer');
  if (lay) {
    const p = t.closest('[data-wa-pick]'); if (p && A.panelId) { saveClose(A.panelId, p.dataset.waPick); return; }
    if (t.closest('[data-wa-clear]') && A.panelId) { saveClose(A.panelId, null); return; }
    if (t.closest('[data-wa-save]') && A.panelId) { const v = ($('#wa-date', lay) || {}).value; if (v) saveClose(A.panelId, v); else W().toast('Pick a date or one of the dates above.'); return; }
    return;
  }
  if (!t.closest('#wc-root')) return;
  const b = t.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.waMode) { A.mode = d.waMode; view(); return; }
  if (d.waStatus) { A.status = d.waStatus; A.more = {}; view(); return; }
  if (d.waClose) { panel(d.waClose); return; }
  if (d.waMore) { A.more[d.waMore] = (A.more[d.waMore] || 0) + PAGE * (d.waMore === 'list' ? 5 : 1); view(); return; }
  if (d.waPrep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(d.waPrep); return; }
  if (b.hasAttribute('data-wa-reload')) { A.data = null; A.error = ''; A.loading = false; A.started = false; view(); }
}, false);
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-wa-range]')) { A.range = t.value; A.data = null; view(); await load(A.owner); view(); W().render(); return; }
  if (t.matches && t.matches('[data-wa-owner]')) { A.data = null; view(); await load(t.value); view(); W().render(); }
});
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wa-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { A.q = t.value; A.more = {}; view(); const i = $('#wa-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});

window.WCAsks = { A, view, shapeQuick: quick, easter };
window.WCTabs.registerTab({ id: 'asks', label: 'Asks', roles: ['director', 'support'], after: 'open', count: () => count(), dot: () => dot(), mount: () => view() });
})();
