/* Asks (Work Center tab): every action tagged Amount of Ask in the last year, in four columns: Asked with no close date, Closing, Past the
   close date and Gave. A close-date chip on each card opens a small panel and saves at once with Undo. Reads GET /api/work/asks one page
   of 50 at a time (the D1 copy of Blackbaud, no Blackbaud calls). Every filter (status, search, director, tagged range) runs on the server
   over all asks. A column loads its next page when the sentinel at its end scrolls into view. The close date is saved with
   PUT /api/work/asks/:id/close in FavorOS database.
   Registers through window.WCTabs. Directors see their own asks; the Support Team and admins pick a director or see everyone. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const PAGE = 50;
// meta: the figures that do not change with the page (tiles, owners, badges, counts for the filter). cols: loaded pages, by column key.
const A = { meta: null, error: '', started: false, epoch: 0, cols: {}, owner: '', mode: 'board', q: '', status: 'open', range: '12m', sheetOn: false, undo: null, io: null, tt: null, panelId: null, fopen: false };
const STATUS = [['open', 'Open'], ['gave', 'Gave'], ['review', 'Check amount'], ['former', 'From former staff'], ['all', 'All']];
const COLS_FOR = { open: ['open', 'closing', 'past'], gave: ['gave'], review: ['open', 'closing', 'past', 'gave'], former: ['open', 'closing', 'past', 'gave'], all: ['open', 'closing', 'past', 'gave'] };
const COLS = [['open', 'Asked, no close date'], ['closing', 'Closing'], ['past', 'Past the close date'], ['gave', 'Gave']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => (A.meta && A.meta.today) || new Date().toISOString().slice(0, 10);
const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(today().slice(0, 4)) ? ', ' + y : ''); };
const money = (a) => { const n = Number(a) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 }); };
const short = (v) => { const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '', f = (x) => String(+x.toFixed(1)); return a >= 999950000 ? s + '$' + f(a / 1e9) + 'B' : a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + (a < 1e5 ? f(a / 1000) : Math.round(a / 1000)) + 'K' : money(Math.round(n)); };
const ic = (n, cls) => (F() ? F().ic(n, cls) : W().ic(n, cls));
const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');
const daysFrom = (iso) => Math.max(0, Math.round((Date.parse(today() + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000));
const skel = (h) => `<div class="h-skel" style="height:${h}px;border-radius:14px"></div>`;

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

/* ------------------------------------------------------------------ loading */
// The columns on screen: the board's columns for the status, or the one list.
const keys = () => (A.mode === 'list' ? ['list'] : COLS_FOR[A.status].slice());
const stateOf = (k) => (k === 'list' ? '' : k);
const rowsIn = (k) => (A.cols[k] ? A.cols[k].rows : []);

function query(k, offset, limit) {
  const p = new URLSearchParams();
  if (A.owner) p.set('owner', A.owner);
  if (A.range === 'all') p.set('range', 'all');
  p.set('status', A.status);
  if (A.q.trim()) p.set('q', A.q.trim());
  if (stateOf(k)) p.set('state', stateOf(k));
  p.set('offset', String(offset));
  p.set('limit', String(limit));
  return '/api/work/asks?' + p.toString();
}
// The figures that come with every page. The director picker and the tiles read these.
function meta(d) {
  A.owner = d.owner || '';
  A.meta = { today: d.today, synced: d.synced, days: d.days, range: d.range, owner: d.owner, owners: d.owners, everyone: d.everyone, stats: d.stats, former: d.former, review: d.review, total: d.total, counts: d.counts, shown: d.shown };
}
// Load one page of one column (offset 0 replaces what is loaded). A response from an earlier filter is dropped.
async function pull(k, offset, limit) {
  const ep = A.epoch;
  const c = (A.cols[k] = A.cols[k] || { rows: [], matched: null, busy: false });
  if (c.busy) return;
  c.busy = true;
  try {
    const d = await W().api(query(k, offset, limit));
    if (ep !== A.epoch) return;
    c.rows = offset ? c.rows.concat(d.rows) : d.rows;
    c.matched = d.rows.length ? d.matched : c.rows.length;
    meta(d);
  } catch (e) {
    if (ep === A.epoch) { if (A.meta) W().toast(e.message); else A.error = e.message; }
  } finally {
    c.busy = false;
  }
}
const fetchAll = () => Promise.all(keys().map((k) => pull(k, 0, PAGE)));
// The filter changed: drop the loaded pages and fetch the first page of each column again.
function changed(tab) {
  A.epoch++; A.cols = {}; A.error = '';
  view();
  fetchAll().then(() => (tab ? W().render() : view()));
}
function start() {
  A.started = true;
  fetchAll().then(() => W().refresh('asks'));
}
// After a close date is saved or undone: refetch what is loaded, so each card sits in its new column with the same page depth.
async function refreshLoaded() {
  await Promise.all(Object.keys(A.cols).map((k) => pull(k, 0, Math.max(PAGE, A.cols[k].rows.length))));
  W().render();
}
// The next page of one column, from the sentinel at its end.
function more(k) {
  const c = A.cols[k];
  if (!c || c.busy || c.matched == null || c.rows.length >= c.matched) return;
  pull(k, c.rows.length, PAGE).then(() => view());
}
function watch() {
  if (A.io) { A.io.disconnect(); A.io = null; }
  const els = $$('#view [data-wa-sentinel]');
  if (!els.length || !('IntersectionObserver' in window)) return;
  A.io = new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) more(en.target.dataset.waSentinel); }), { rootMargin: '480px 0px' });
  els.forEach((el) => A.io.observe(el));
}

/* ------------------------------------------------------------------ cards and rows */
function chip(r) {
  const label = r.state === 'gave' ? '' : !r.close ? 'No close date' : r.state === 'past' ? 'Past ' + fd(r.close.date) : 'Close by ' + fd(r.close.date);
  if (r.state === 'gave') return `<span class="wa-gave">Gave ${money(r.gave.amount)} on ${esc(fd(r.gave.date, true))}</span>`;
  return `<button type="button" class="wa-chip${r.state === 'past' ? ' is-past' : !r.close ? ' is-none' : ''}" data-wa-close="${esc(r.id)}" aria-haspopup="dialog" aria-label="Expected close for ${esc(r.name)}: ${esc(label)}">${W().ic('clock')}${esc(label)}</button>`;
}
const asked = (r) => { const n = daysFrom(r.first || r.date); return `Asked ${fd(r.first || r.date, true)}${n > 0 ? ' · ' + (n === 1 ? '1 day ago' : n.toLocaleString('en-US') + ' days ago') : ' · today'}`; };
const prepBtn = (r) => `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-prep="${esc(r.cid)}">${ic('brief')}Prep</button>`;
const who = (r) => (A.meta.owners.length > 1 && !A.owner ? `<span class="wa-who">${esc(r.ownerNames.join(', '))}</span>` : '');

function card(r) {
  return `<article class="wa-card${r.state === 'past' ? ' is-past' : ''}" data-id="${esc(r.id)}">
    <b class="wa-amt">${money(r.amount)}</b>
    <a class="wa-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a>
    ${r.place ? `<span class="wa-sub">${esc(r.place)}</span>` : ''}
    ${r.line ? `<p>${esc(r.line)}</p>` : ''}
    <span class="wa-sub">${esc(asked(r))}</span>${who(r)}
    <div class="wa-acts">${chip(r)}${prepBtn(r)}</div></article>`;
}
// The row for the list view. Its sentinel loads the next page.
function row(r) {
  return `<div class="wa-row${r.state === 'past' ? ' is-past' : ''}" data-id="${esc(r.id)}">
      <div class="wa-amt wa-c-amt">${money(r.amount)}<small>${esc('Asked ' + fd(r.date, true))}</small></div>
      <div class="wa-c-who"><a class="wa-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wa-sub">${esc(r.place)}</span>${who(r)}</div>
      <div class="wa-said wa-c-said">${esc(r.line)}</div>
      <div class="wa-c-close">${chip(r)}</div>
      <div class="wa-c-prep">${prepBtn(r)}</div></div>`;
}
// The sentinel at the end of a column or the list. It is empty when every ask of the column is loaded.
const sentinel = (k, more) => (more ? `<div class="wa-sentinel" data-wa-sentinel="${k}">${A.cols[k] && A.cols[k].busy ? '<span>Loading more asks</span>' : ''}</div>` : '');

function colHTML(k, label) {
  const c = A.cols[k];
  const cnt = (A.meta.counts || {})[k] || { n: 0, total: 0 };
  const rows = c ? c.rows : [];
  const body = !c ? skel(120) : rows.map(card).join('') || (cnt.n ? '' : '<div class="wa-col__empty">Nothing here</div>');
  return `<section class="wa-col" aria-label="${esc(label)}"><h4>${esc(label)} <b>${cnt.n.toLocaleString('en-US')}</b><em>${short(cnt.total)}</em></h4>
      ${body}${sentinel(k, !!c && rows.length < cnt.n)}</section>`;
}
function boardHTML() {
  const use = COLS.filter(([k]) => COLS_FOR[A.status].includes(k));
  return `<div class="wa-board" style="--wa-cols:${use.length}">${use.map(([k, label]) => colHTML(k, label)).join('')}</div>`;
}
function listHTML() {
  const c = A.cols.list;
  const rows = c ? c.rows : [];
  const body = !c ? skel(320) : rows.map(row).join('') || '<div class="wa-empty"><b>Nothing matches</b></div>';
  return `<div class="wa-list">${body}${c ? sentinel('list', rows.length < c.matched) : ''}</div>`;
}

function view() {
  const el = $('#view');
  if (!el || !W().S || W().S.view !== 'asks') return;
  if (!A.meta) {
    if (A.error) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wa-empty"><b>The asks did not load</b>${esc(A.error)}<p><button type="button" class="h-btn h-btn--primary" data-wa-reload>Try again</button></p></div></section>`; return; }
    el.innerHTML = window.WCSkel(5);
    if (!A.started) start();
    return;
  }
  const m = A.meta; const s = m.stats;
  // Keep the search box's live text and its place when the page is redrawn while someone is typing in it.
  const typing = document.activeElement && document.activeElement.id === 'wa-q';
  const live = typing ? document.activeElement : null;
  const caret = live ? live.selectionStart : 0;
  const text = live ? live.value : A.q;
  const tiles = [['Open asks', s.open], ['Closing in 90 days', s.soon], ['Past the close date', s.past, 1], ['Gifts since the ask', s.gave]];
  const picker = m.owners.length > 1 ? `<select class="wc-sel${A.owner ? ' is-set' : ''}" data-wa-owner aria-label="Director"><option value="">Every director (${Number(m.everyone).toLocaleString('en-US')})</option>${m.owners.map((o) => `<option value="${esc(o.id)}"${A.owner === o.id ? ' selected' : ''}>${esc(o.name)} (${o.n})</option>`).join('')}</select>` : '';
  // On a phone the filters sit behind one button; whatever is set shows as chips that clear it.
  const ownerName = A.owner ? ((m.owners.find((o) => o.id === A.owner) || {}).name || 'Director') : '';
  const active = [A.status !== 'open' ? ['status', (STATUS.find((x) => x[0] === A.status) || [0, A.status])[1]] : null, A.range !== '12m' ? ['range', 'All time'] : null, A.owner ? ['owner', ownerName] : null].filter(Boolean);
  const activeHTML = active.length ? `<div class="wa-active">${active.map(([k, l]) => `<button type="button" class="wa-achip" data-wa-unf="${k}" aria-label="Clear filter: ${esc(l)}">${esc(l)}<span aria-hidden="true">×</span></button>`).join('')}</div>` : '';
  const shownN = keys().reduce((n, k) => n + rowsIn(k).length, 0);
  const M = m.shown;
  const body = M === 0 && !text.trim() && A.status === 'all' ? '<div class="wa-empty"><b>No asks in the last year</b>An action with the Amount of Ask tag shows here.</div>'
    : M === 0 ? '<div class="wa-empty"><b>Nothing matches</b></div>'
      : A.mode === 'board' ? boardHTML() : listHTML();
  el.innerHTML = `
    <div class="h-card wc-band wa-band" style="--n:4">${tiles.map(([l, t, warn]) => `<div class="wc-stat${warn && t.n ? ' is-warn' : ''}"><b>${t.n.toLocaleString('en-US')}</b><span>${esc(l)}</span><span class="wa-tot">${short(t.total)}</span></div>`).join('')}</div>
    <section class="h-card wc-sheet${A.fopen ? ' is-fopen' : ''}" id="wa-sheet" aria-label="Asks">
      <div class="wa-filters" role="group" aria-label="Filter">${STATUS.map(([k, l]) => `<button type="button" class="wa-fchip${A.status === k ? ' is-on' : ''}" data-wa-status="${k}" aria-pressed="${A.status === k}">${esc(l)}${k === 'review' ? ' <span>' + m.review.n + '</span>' : k === 'former' ? ' <span>' + m.former.n + '</span>' : ''}</button>`).join('')}
        <select class="wc-sel wa-range${A.range === 'all' ? ' is-set' : ''}" data-wa-range aria-label="Tagged"><option value="12m"${A.range === '12m' ? ' selected' : ''}>Tagged in the last 12 months</option><option value="all"${A.range === 'all' ? ' selected' : ''}>All time</option></select></div>
      <div class="wa-tools"><div class="wa-seg" role="group" aria-label="View"><button type="button" class="${A.mode === 'board' ? 'is-on' : ''}" data-wa-mode="board" aria-pressed="${A.mode === 'board'}">Board</button><button type="button" class="${A.mode === 'list' ? 'is-on' : ''}" data-wa-mode="list" aria-pressed="${A.mode === 'list'}">List</button></div>
        <label class="wc-find">${W().ic('search')}<input type="search" id="wa-q" placeholder="Find a partner" value="${esc(text)}" autocomplete="off" /></label><button type="button" class="h-btn h-btn--ghost h-btn--sm wa-fbtn" data-wa-ftoggle aria-expanded="${A.fopen}">Filters${active.length ? ' ' + active.length : ''}</button>${picker}<span class="wa-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="asks">${ic('sheet')}Open in Google Sheets</button></div>
      ${activeHTML}
      <div class="wa-count" aria-live="polite">Showing ${shownN.toLocaleString('en-US')} of ${M.toLocaleString('en-US')} ${M === 1 ? 'ask' : 'asks'}</div>
      ${body}
      <div class="wa-foot">${plural(M, 'ask')} shown, ${A.range === 'all' ? 'tagged at any time' : 'tagged in the last 12 months'}. An amount tagged again on the same partner within 90 days counts once. Asks are listed under the partner's current director. Asks on partners no current director holds sit under From former staff, and asks that look far above what the partner has given sit under Check amount. Neither is in the totals. A gift of the asked amount or more after the ask moves it to Gave.</div>
    </section>`;
  if (live) { const i = $('#wa-q'); if (i) { i.focus(); i.setSelectionRange(caret, caret); } }
  registerSheet();
  watch();
}

function registerSheet() {
  if (!window.FavorSheets || A.sheetOn) return;
  A.sheetOn = true;
  // The export asks the server for every ask the filter matches, not just the loaded pages.
  window.FavorSheets.register('asks', async () => {
    const lab = { open: 'No close date', closing: 'Closing', past: 'Past the close date', gave: 'Gave' };
    const cols = [{ key: 'status', label: 'Status', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Amount asked', type: 'money' },
      { key: 'asked', label: 'Asked on', type: 'date' }, { key: 'line', label: 'About', type: 'text' }, { key: 'close', label: 'Expected close', type: 'date' }, { key: 'gave', label: 'Gift amount', type: 'money' }, { key: 'gavedate', label: 'Gift date', type: 'date' }, { key: 'owner', label: 'Director', type: 'text' }];
    const p = new URLSearchParams();
    if (A.owner) p.set('owner', A.owner);
    if (A.range === 'all') p.set('range', 'all');
    p.set('status', A.status);
    if (A.q.trim()) p.set('q', A.q.trim());
    p.set('limit', '5000');
    const d = await W().api('/api/work/asks?' + p.toString());
    const data = d.rows.map((r) => ({ status: lab[r.state], partner: r.name, place: r.place, amount: r.amount, asked: r.date, line: r.line, close: r.close ? r.close.date : null, gave: r.gave ? r.gave.amount : null, gavedate: r.gave ? r.gave.date : null, owner: r.ownerNames.join(', ') }));
    return window.FavorSheets.screen('Asks', [{ name: 'Asks', columns: cols, rows: data }], { filters: A.q ? 'Search: ' + A.q : '', classes: ['partner'] });
  });
}

/* ------------------------------------------------------------------ the close date */
function panel(id) {
  const r = Object.values(A.cols).flatMap((c) => c.rows).find((x) => x.id === id); if (!r) return;
  const t = today(); const cur = r.close ? r.close.date : '';
  W().dialog(`<div class="wc-dlg__head"><div><span class="h-label">Asks</span><h2>Expected close</h2><p class="wa-dsub">${esc(r.name)} · ${money(r.amount)}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${W().ic('x')}</button></div>
    <div class="wc-dlg__body wa-panel">
      <div class="wa-quick">${quick(t).map(([l, v]) => `<button type="button" class="wa-q${cur === v ? ' is-on' : ''}" data-wa-pick="${v}"><span>${esc(l)}</span><em>${esc(fd(v, true))}</em></button>`).join('')}</div>
      <label class="wa-date"><span>Pick a date</span><input type="date" id="wa-date" min="${t}" value="${esc(cur)}" /></label>
      <div class="wa-foot2"><span>${cur ? 'Now ' + esc(fd(cur, true)) : 'No date yet'}</span>${cur ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-clear>Clear</button>' : ''}<button type="button" class="h-btn h-btn--primary" data-wa-save>Save</button></div>
    </div>`, () => { A.panelId = id; });
}

async function saveClose(id, date) {
  let out;
  try { out = await W().api(`/api/work/asks/${encodeURIComponent(id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) }); }
  catch (e) { W().toast(e.message); return; }
  W().closeLayer();
  toast(out.close ? `Expected close ${fd(out.close, true)}` : 'Close date cleared', id, out.previous);
  refreshLoaded();
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
  try {
    await W().api(`/api/work/asks/${encodeURIComponent(u.id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) });
    W().toast('Undone.');
    refreshLoaded();
  } catch (e) { W().toast(e.message); }
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
  if (d.waFtoggle !== undefined) { A.fopen = !A.fopen; view(); return; }
  if (d.waUnf) { if (d.waUnf === 'status') A.status = 'open'; else if (d.waUnf === 'range') A.range = '12m'; else A.owner = ''; changed(true); return; }
  if (d.waMode) { A.mode = d.waMode; changed(false); return; }
  if (d.waStatus) { A.status = d.waStatus; changed(false); return; }
  if (d.waClose) { panel(d.waClose); return; }
  if (d.waPrep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(d.waPrep); return; }
  if (b.hasAttribute('data-wa-reload')) { A.meta = null; A.error = ''; A.started = false; A.epoch++; A.cols = {}; view(); }
}, false);
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-wa-range]')) { A.range = t.value; changed(true); return; }
  if (t.matches && t.matches('[data-wa-owner]')) { A.owner = t.value; changed(true); }
});
let qT;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'wa-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => {
    const i = $('#wa-q'); if (!i || i.value === A.q) return;
    A.q = i.value;
    changed(false);
  }, 280);
});

window.WCAsks = { A, start, view, shapeQuick: quick, easter };
window.WCTabs.registerTab({ id: 'asks', label: 'Asks', roles: ['director', 'support'], after: 'open', count: () => (A.meta ? A.meta.stats.open.n : ''), dot: () => !!A.meta && A.meta.stats.past.n > 0, mount: () => view(), warm: () => { if (!A.started) start(); } });
})();
