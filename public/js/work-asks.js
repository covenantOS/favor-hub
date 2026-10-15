/* Asks (Work Center tab): every action tagged Amount of Ask in the last year, one row per ask in a table. Amount, partner, what the ask was
   about, when it was asked, the expected close, the director and the stage (No close date, Closing, Past the close date or Gave). Reads
   GET /api/work/asks one page at a time (the D1 copy of Blackbaud, no Blackbaud calls). The status, stage, search, director and tagged range
   filters and the sort all run on the server over every ask, and the shared PT pager (public/js/ptable.js) turns the pages. A row opens a side
   panel with the whole ask and the close date; the close-date chip on the row still opens the small dialog. The close date is saved with
   PUT /api/work/asks/:id/close in FavorOS database, with Undo.
   Registers through window.WCTabs. Directors see their own asks; the Support Team and admins pick a director or see everyone. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const PT = window.PT;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const KEY = 'asks';
// meta: the figures that do not change with the page (tiles, owners, badges, counts for the filters). rows: the page on screen.
const A = { meta: null, error: '', started: false, epoch: 0, rows: [], matched: 0, busy: false, owner: '', q: '', status: 'open', state: '', range: '12m', sort: 'asked', dir: 'desc', page: 1, sheetOn: false, undo: null, tt: null, panelId: null, fopen: false, sideId: null, sideRow: null };
const STATUS = [['open', 'Open'], ['gave', 'Gave'], ['review', 'Check amount'], ['former', 'From former staff'], ['all', 'All']];
const STAGES = [['', 'All stages'], ['open', 'No close date'], ['closing', 'Closing'], ['past', 'Past the close date'], ['gave', 'Gave']];
const STAGE_NAME = { open: 'No close date', closing: 'Closing', past: 'Past the close date', gave: 'Gave' };
// The order each column opens in, the first time its header is pressed.
const SORT_DIR = { amount: 'desc', asked: 'desc', partner: 'asc', close: 'asc', director: 'asc', stage: 'asc' };
const SORT_CHOICES = [['asked:desc', 'Newest asks first'], ['asked:asc', 'Oldest asks first'], ['amount:desc', 'Largest amount first'], ['amount:asc', 'Smallest amount first'], ['partner:asc', 'Partner A to Z'], ['close:asc', 'Close date, soonest'], ['stage:asc', 'Stage'], ['director:asc', 'Director']];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => (A.meta && A.meta.today) || new Date().toISOString().slice(0, 10);
const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(today().slice(0, 4)) ? ', ' + y : ''); };
const money = (a) => { const n = Number(a) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 }); };
const whole = (v) => { const n = Math.round(Number(v) || 0); return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US'); };
const short = (v) => { const n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '', f = (x) => String(+x.toFixed(1)); return a >= 999950000 ? s + '$' + f(a / 1e9) + 'B' : a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + (a < 1e5 ? f(a / 1000) : Math.round(a / 1000)) + 'K' : money(Math.round(n)); };
const ic = (n, cls) => (F() ? F().ic(n, cls) : W().ic(n, cls));
const daysFrom = (iso) => Math.max(0, Math.round((Date.parse(today() + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 86400000));
const ago = (iso) => { const n = daysFrom(iso); return n === 0 ? 'today' : n === 1 ? '1 day ago' : n.toLocaleString('en-US') + ' days ago'; };
const askedOn = (r) => r.first || r.date;
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const pageSize = () => PT.size(KEY, 50);

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
function params() {
  const p = new URLSearchParams();
  if (A.owner) p.set('owner', A.owner);
  if (A.range === 'all') p.set('range', 'all');
  p.set('status', A.status);
  if (A.q.trim()) p.set('q', A.q.trim());
  if (A.state) p.set('state', A.state);
  p.set('sort', A.sort);
  p.set('dir', A.dir);
  return p;
}
// The figures that come with every page. The director picker, the stage counts and the strip read these.
function meta(d) {
  A.owner = d.owner || '';
  A.meta = { today: d.today, synced: d.synced, days: d.days, range: d.range, owner: d.owner, owners: d.owners, everyone: d.everyone, stats: d.stats, former: d.former, review: d.review, total: d.total, counts: d.counts, shown: d.shown };
}
// Load the page on screen. The rows already drawn stay (dimmed) until the new page arrives. A response from an earlier filter is dropped.
// tab: also redraw the tab strip, whose count follows the director and the tagged range. quiet: no dimming (a refresh after a save).
async function load(tab, quiet) {
  const ep = ++A.epoch;
  A.error = '';
  if (!quiet) { A.busy = true; if (A.meta) view(); }
  try {
    for (;;) {
      const size = pageSize();
      const p = params();
      p.set('offset', String((A.page - 1) * size));
      p.set('limit', String(size));
      const d = await W().api('/api/work/asks?' + p.toString());
      if (ep !== A.epoch) return;
      // The filter now matches fewer asks than the page number reaches (an ask moved out): go to the last page.
      if (d.matched && A.page > PT.pages(d.matched, size)) { A.page = PT.pages(d.matched, size); continue; }
      A.rows = d.rows;
      A.matched = d.matched;
      meta(d);
      if (A.sideRow) { const fresh = A.rows.find((x) => x.id === A.sideRow.id); if (fresh) A.sideRow = fresh; }
      break;
    }
  } catch (e) {
    if (ep === A.epoch) { if (A.meta) W().toast(e.message); else A.error = e.message; }
  }
  if (ep !== A.epoch) return;
  A.busy = false;
  if (tab && A.meta) W().render(); else view();
  paintSide();
}
// The filter changed: back to page 1 and fetch it.
function changed(tab) { A.page = 1; load(tab); }
function start() {
  A.started = true;
  return load(false).then(() => W().refresh('asks'));
}

/* ------------------------------------------------------------------ rows */
function chip(r) {
  if (r.state === 'gave') return '<span class="pt-mute">-</span>';
  const label = !r.close ? 'No close date' : r.state === 'past' ? 'Past ' + fd(r.close.date) : 'Close by ' + fd(r.close.date);
  return `<button type="button" class="wa-chip${r.state === 'past' ? ' is-past' : !r.close ? ' is-none' : ''}" data-wa-close="${esc(r.id)}" aria-haspopup="dialog" aria-label="Expected close for ${esc(r.name)}: ${esc(label)}">${W().ic('clock')}${esc(label)}</button>`;
}
function stage(r, long) {
  if (r.state === 'gave') return `<span class="pt-badge pt-badge--good">Gave ${esc(money(r.gave.amount))} on ${esc(fd(r.gave.date, !!long))}</span>`;
  if (r.state === 'past') return '<span class="pt-badge pt-badge--warn">Past the close date</span>';
  if (r.state === 'closing') return '<span class="pt-badge pt-badge--gold">Closing</span>';
  return '<span class="pt-badge">No close date</span>';
}
const directors = (r) => (r.ownerNames && r.ownerNames.length ? r.ownerNames.join(', ') : 'No current director');
const prepBtn = (r) => `<button type="button" class="pt-icon pa-prep" data-wa-prep="${esc(r.cid)}" title="Call prep" aria-label="Prep for ${esc(r.name)}">${ic('brief')}</button>`;

// The columns, in order. fixed: always on. The Columns menu hides the others.
const COLS = [
  { k: 'amount', l: 'Amount', fixed: true, num: true, td: (r) => `<button type="button" class="pt-name pa-amt" data-pt-open data-pa-open="${esc(r.id)}" aria-label="Open the ${esc(money(r.amount))} ask for ${esc(r.name)}">${esc(money(r.amount))}</button>` },
  { k: 'partner', l: 'Partner', fixed: true, td: (r) => `<a class="pt-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a>${r.place ? ` <span class="pt-sub">${esc(r.place)}</span>` : ''}` },
  { k: 'about', l: 'About', plain: true, td: (r) => (r.line ? esc(r.line) : '<span class="pt-mute">No note</span>'), title: (r) => r.line },
  { k: 'asked', l: 'Asked', td: (r) => `${esc(fd(askedOn(r)))} <span class="pt-sub">· ${esc(ago(askedOn(r)))}</span>` },
  { k: 'close', l: 'Expected close', td: chip },
  { k: 'director', l: 'Director', td: (r) => esc(directors(r)), title: (r) => directors(r) },
  { k: 'stage', l: 'Stage', td: (r) => stage(r) },
];
const shownCols = () => {
  const hid = PT.hidden(KEY, []);
  const one = !A.meta || A.meta.owners.length <= 1;
  return COLS.filter((c) => c.fixed || (!hid.has(c.k) && !(c.k === 'director' && one)));
};

function rowHTML(r, cols) {
  return `<tr class="pa-row${r.state === 'past' ? ' is-past' : ''}${A.sideId === r.id ? ' is-open' : ''}" data-pt-row tabindex="-1" data-id="${esc(r.id)}">${cols.map((c) =>
    `<td class="pa-c-${c.k}${c.num ? ' is-num' : ''}${c.k === 'about' ? ' pa-about' : ''}"${c.title && c.title(r) ? ` title="${esc(c.title(r))}"` : ''}>${c.td(r)}</td>`).join('')}<td class="pa-c-act">${prepBtn(r)}</td></tr>`;
}
function tableHTML() {
  const cols = shownCols();
  const sort = { col: A.sort, dir: A.dir };
  const head = cols.map((c) => `<th class="pa-c-${c.k}${c.num ? ' is-num' : ''}" scope="col">${c.plain ? esc(c.l) : PT.th(KEY, c.k, c.l, sort, c.num ? 'is-num' : '')}</th>`).join('') + '<th class="pa-c-act" scope="col"><span class="pa-vh">Prep</span></th>';
  return `<div class="pt-wrap pt-wrap--fit"><table class="pt-table pa-table${A.busy ? ' is-busy' : ''}" data-pt-list="${KEY}" aria-label="Asks" aria-busy="${A.busy}"><thead><tr>${head}</tr></thead><tbody>${A.rows.map((r) => rowHTML(r, cols)).join('')}</tbody></table></div>`;
}

function view() {
  const el = $('#view');
  if (!el || !W().S || W().S.view !== 'asks') return;
  if (!A.meta) {
    if (A.error) { el.innerHTML = `<section class="h-card wc-sheet"><div class="pt-empty"><b>The asks did not load</b>${esc(A.error)}<p><button type="button" class="h-btn h-btn--primary" data-wa-reload>Try again</button></p></div></section>`; return; }
    el.innerHTML = window.WCSkel(5);
    if (!A.started) start();
    return;
  }
  // A panel left open on a page the hub swapped out has no element any more.
  if (A.sideId && !$('#pa-side-host')) { A.sideId = null; A.sideRow = null; }
  const m = A.meta; const s = m.stats;
  // Keep the search box's live text and its place when the page is redrawn while someone is typing in it.
  const typing = document.activeElement && document.activeElement.id === 'wa-q';
  const live = typing ? document.activeElement : null;
  const caret = live ? live.selectionStart : 0;
  const text = live ? live.value : A.q;
  const tiles = [['Open asks', s.open], ['Closing in 90 days', s.soon], ['Past the close date', s.past, 1], ['Gifts since the ask', s.gave]];
  const picker = m.owners.length > 1 ? `<select class="pt-sel pa-f${A.owner ? ' is-set' : ''}" data-wa-owner aria-label="Director"><option value="">Every director (${Number(m.everyone).toLocaleString('en-US')})</option>${m.owners.map((o) => `<option value="${esc(o.id)}"${A.owner === o.id ? ' selected' : ''}>${esc(o.name)} (${o.n})</option>`).join('')}</select>` : '';
  const count = (k) => ((m.counts || {})[k] || { n: 0 }).n.toLocaleString('en-US');
  const stageSel = `<select class="pt-sel pa-f${A.state ? ' is-set' : ''}" data-wa-state aria-label="Stage">${STAGES.map(([k, l]) => `<option value="${k}"${A.state === k ? ' selected' : ''}>${esc(l)}${k ? ' (' + count(k) + ')' : ' (' + m.shown.toLocaleString('en-US') + ')'}</option>`).join('')}</select>`;
  const sortNow = A.sort + ':' + A.dir;
  const sortSel = `<select class="pt-sel pa-f pa-sortsel" data-wa-sortsel aria-label="Sort">${(SORT_CHOICES.some(([v]) => v === sortNow) ? SORT_CHOICES : SORT_CHOICES.concat([[sortNow, 'Sorted by ' + A.sort]])).map(([v, l]) => `<option value="${v}"${v === sortNow ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const ownerName = A.owner ? ((m.owners.find((o) => o.id === A.owner) || {}).name || 'Director') : '';
  const active = [
    A.status !== 'open' ? ['status', (STATUS.find((x) => x[0] === A.status) || [0, A.status])[1]] : null,
    A.state ? ['state', STAGE_NAME[A.state]] : null,
    A.q.trim() ? ['q', 'Search: ' + A.q.trim()] : null,
    A.owner ? ['owner', ownerName] : null,
    A.range !== '12m' ? ['range', 'All time'] : null,
  ].filter(Boolean);
  const chips = active.map(([k, l]) => `<button type="button" class="pt-chip" data-wa-unf="${k}" aria-label="Clear filter: ${esc(l)}">${esc(l)}<i aria-hidden="true">×</i></button>`).join('');
  const size = pageSize();
  const nothing = A.matched === 0;
  const body = nothing
    ? (m.shown === 0 && !A.q.trim() && A.status === 'all' && !A.state ? '<div class="pt-empty"><b>No asks in the last year</b>An action with the Amount of Ask tag shows here.</div>' : '<div class="pt-empty"><b>Nothing matches</b>Clear a filter above to see more asks.</div>')
      : tableHTML();
  el.innerHTML = `
    <div class="h-card pa-strip" role="group" aria-label="Totals">${tiles.map(([l, t, warn]) => `<div class="pa-stat${warn && t.n ? ' is-warn' : ''}"><b>${t.n.toLocaleString('en-US')}</b><span>${esc(l)}</span><em>${whole(t.total)}</em></div>`).join('')}</div>
    <section class="h-card wc-sheet pa-sheet${A.fopen ? ' is-fopen' : ''}" id="wa-sheet" aria-label="Asks">
      <div class="pt-bar pa-bar" role="group" aria-label="Filter">
        <div class="pt-seg pa-f" role="group" aria-label="Status">${STATUS.map(([k, l]) => `<button type="button" class="${A.status === k ? 'is-on' : ''}" data-wa-status="${k}" aria-pressed="${A.status === k}">${esc(l)}${k === 'review' ? ' <span>' + m.review.n + '</span>' : k === 'former' ? ' <span>' + m.former.n + '</span>' : ''}</button>`).join('')}</div>
        ${stageSel}
        <label class="pt-search">${W().ic('search')}<input type="search" id="wa-q" data-pt-search placeholder="Find a partner" value="${esc(text)}" autocomplete="off" aria-label="Find a partner" /></label>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm wa-fbtn" data-wa-ftoggle aria-expanded="${A.fopen}">Filters${active.length ? ' ' + active.length : ''}</button>
        ${picker}
        <select class="pt-sel pa-f${A.range === 'all' ? ' is-set' : ''}" data-wa-range aria-label="Tagged range"><option value="12m"${A.range === '12m' ? ' selected' : ''}>Last 12 months</option><option value="all"${A.range === 'all' ? ' selected' : ''}>All time</option></select>
        ${sortSel}
        <span class="pt-spacer"></span>
        <span class="pa-f pa-dens">${PT.densityHTML()}</span>
        <span class="pa-f pa-colsbox">${PT.colsHTML(KEY, COLS.map((c) => ({ k: c.k, l: c.l, fixed: c.fixed })), [])}</span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm pa-f" data-sheets="asks" title="Open in Google Sheets" aria-label="Open in Google Sheets">${ic('sheet')}Google Sheets</button>
      </div>
      <div class="pt-chips" aria-label="Filters set">${chips}</div>
      ${body}
      ${PT.pager(KEY, { total: A.matched, page: A.page, size, noun: 'asks' })}
      <div class="pa-foot">${m.shown.toLocaleString('en-US')} ${m.shown === 1 ? 'ask' : 'asks'} in this view, ${A.range === 'all' ? 'tagged at any time' : 'tagged in the last 12 months'}. An amount tagged again on the same partner within 90 days counts once. Asks are listed under the partner's current director. Asks on partners no current director holds sit under From former staff, and asks that look far above what the partner has given, counting gifts sent through a donor-advised fund or foundation that name them, sit under Check amount. Neither is in the totals. A gift of the asked amount or more after the ask moves it to Gave.</div>
    </section>`;
  if (live) { const i = $('#wa-q'); if (i) { i.focus(); i.setSelectionRange(caret, caret); } }
  registerSheet();
  fit();
}
// The table scrolls inside its card (sticky header row); this sets how much of the screen sits above and below it, so the pager stays in view.
function fit() {
  const w = $('#wa-sheet .pt-wrap--fit'); if (!w) return;
  const pg = $('#wa-sheet .pt-pager');
  w.style.setProperty('--pt-fit', Math.round(w.getBoundingClientRect().top + window.scrollY + (pg ? pg.offsetHeight : 48) + 10) + 'px');
}
window.addEventListener('resize', fit);
document.addEventListener('pt:density', () => setTimeout(fit, 0));

function registerSheet() {
  if (!window.FavorSheets || A.sheetOn) return;
  A.sheetOn = true;
  // The export asks the server for every ask the filters match, not just the page on screen, in the order on screen.
  window.FavorSheets.register('asks', async () => {
    const cols = [{ key: 'status', label: 'Status', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Amount asked', type: 'money' },
      { key: 'asked', label: 'Asked on', type: 'date' }, { key: 'line', label: 'About', type: 'text' }, { key: 'close', label: 'Expected close', type: 'date' }, { key: 'gave', label: 'Gift amount', type: 'money' }, { key: 'gavedate', label: 'Gift date', type: 'date' }, { key: 'owner', label: 'Director', type: 'text' }];
    const p = params();
    p.set('limit', '5000');
    const d = await W().api('/api/work/asks?' + p.toString());
    const data = d.rows.map((r) => ({ status: STAGE_NAME[r.state], partner: r.name, place: r.place, amount: r.amount, asked: r.date, line: r.line, close: r.close ? r.close.date : null, gave: r.gave ? r.gave.amount : null, gavedate: r.gave ? r.gave.date : null, owner: r.ownerNames.join(', ') }));
    return window.FavorSheets.screen('Asks', [{ name: 'Asks', columns: cols, rows: data }], { filters: A.q ? 'Search: ' + A.q : '', classes: ['partner'] });
  });
}

/* ------------------------------------------------------------------ the side panel */
// One panel for the whole tab. It sits on the body, above the page header, so a redraw of the table leaves it open; it is removed when the hub swaps the page.
function sideHost() {
  let h = $('#pa-side-host');
  if (!h) {
    h = document.createElement('div');
    h.id = 'pa-side-host';
    h.innerHTML = '<div class="pt-scrim" data-pa-close></div><aside class="pt-side pa-side" id="pa-side" tabindex="-1"></aside>';
    document.body.appendChild(h);
  }
  return h;
}
const rowById = (id) => A.rows.find((x) => x.id === id) || (A.sideRow && A.sideRow.id === id ? A.sideRow : null);
function sideHTML(r) {
  const t = today(); const cur = r.close ? r.close.date : '';
  const i = A.rows.findIndex((x) => x.id === r.id);
  const text = r.text || r.line || '';
  const closeBlock = r.state === 'gave'
    ? `<div class="pa-block"><h3>Gift</h3><p>${esc(money(r.gave.amount))} on ${esc(fd(r.gave.date, true))}, ${esc(ago(r.gave.date))}.</p></div>`
    : `<div class="pa-block"><h3>Expected close</h3>
        <p class="pa-now">${cur ? esc(fd(cur, true)) + (r.state === 'past' ? ' (past)' : '') : 'No date yet'}</p>
        <div class="wa-quick">${quick(t).map(([l, v]) => `<button type="button" class="wa-q${cur === v ? ' is-on' : ''}" data-pa-pick="${v}"><span>${esc(l)}</span><em>${esc(fd(v, true))}</em></button>`).join('')}</div>
        <label class="wa-date"><span>Pick a date</span><input type="date" id="pa-date" min="${t}" value="${esc(cur)}" /></label>
        <div class="wa-foot2">${cur ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pa-clear>Clear</button>' : ''}<button type="button" class="h-btn h-btn--primary" data-pa-save>Save</button></div></div>`;
  return `<div class="pt-side__head"><div><span class="h-label">Ask</span><h2>${esc(money(r.amount))}</h2><span class="pt-sub">${esc(r.name)}${r.place ? ' · ' + esc(r.place) : ''}</span></div>
      <div class="pt-side__nav"><button type="button" class="pt-icon" data-pa-step="-1" aria-label="Previous ask"${i <= 0 ? ' disabled' : ''}>${svg('m6 15 6-6 6 6')}</button><button type="button" class="pt-icon" data-pa-step="1" aria-label="Next ask"${i < 0 || i >= A.rows.length - 1 ? ' disabled' : ''}>${svg('m6 9 6 6 6-6')}</button><button type="button" class="pt-icon" data-pa-close aria-label="Close">${svg('M6 6l12 12M18 6 6 18')}</button></div></div>
    <div class="pt-side__body">
      <dl>
        <dt>Partner</dt><dd><a href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a></dd>
        <dt>Place</dt><dd>${r.place ? esc(r.place) : '<span class="pt-mute">No city on file</span>'}</dd>
        <dt>Asked on</dt><dd>${esc(fd(askedOn(r), true))}, ${esc(ago(askedOn(r)))}${r.tags > 1 ? ` · tagged ${r.tags} times` : ''}</dd>
        <dt>Tagged by</dt><dd>${r.taggedNames && r.taggedNames.length ? esc([...new Set(r.taggedNames)].join(', ')) : '<span class="pt-mute">Not recorded</span>'}</dd>
        <dt>Director</dt><dd>${esc(directors(r))}</dd>
        <dt>Stage</dt><dd>${stage(r, true)}${r.review ? ' <span class="pt-badge pt-badge--gold">Check amount</span>' : ''}</dd>
      </dl>
      <div class="pa-block"><h3>The ask</h3><p class="pa-text">${text ? esc(text) : '<span class="pt-mute">No note on this ask</span>'}</p></div>
      ${closeBlock}
    </div>
    <div class="pt-side__foot"><button type="button" class="h-btn h-btn--ghost" data-wa-prep="${esc(r.cid)}">${ic('brief')}Prep</button><a class="h-btn h-btn--primary" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">Open partner</a></div>`;
}
function paintSide() {
  const h = $('#pa-side-host');
  if (!A.sideId) { if (h) closeSideDom(h); return; }
  const r = rowById(A.sideId); if (!r) return;
  A.sideRow = r;
  const host = sideHost(); const side = $('#pa-side', host);
  const keep = document.activeElement && side.contains(document.activeElement) ? document.activeElement.getAttribute('data-pa-step') : null;
  side.innerHTML = sideHTML(r);
  side.setAttribute('role', 'dialog'); side.setAttribute('aria-modal', 'true'); side.setAttribute('aria-label', `Ask from ${r.name}`);
  $('.pt-scrim', host).classList.add('is-on');
  requestAnimationFrame(() => side.classList.add('is-on'));
  if (keep) { const b = $(`[data-pa-step="${keep}"]:not([disabled])`, side); if (b) b.focus(); }
  $$('#view tr.pa-row').forEach((tr) => tr.classList.toggle('is-open', tr.dataset.id === A.sideId));
}
// The dialog and modal attributes come off a closed panel, so the list's keys (j, k, Enter) work again.
function closeSideDom(h) {
  const side = $('#pa-side', h);
  side.classList.remove('is-on'); side.removeAttribute('role'); side.removeAttribute('aria-modal');
  $('.pt-scrim', h).classList.remove('is-on');
}
function openSide(id) {
  const r = A.rows.find((x) => x.id === id); if (!r) return;
  A.sideId = id; A.sideRow = r;
  paintSide();
  const side = $('#pa-side'); if (side) side.focus({ preventScroll: true });
}
function closeSide() {
  if (!A.sideId) return false;
  const id = A.sideId;
  A.sideId = null;
  const h = $('#pa-side-host'); if (h) closeSideDom(h);
  $$('#view tr.pa-row.is-open').forEach((tr) => tr.classList.remove('is-open'));
  const tr = $(`#view tr.pa-row[data-id="${CSS.escape(id)}"]`);
  if (tr) PT.focusRow(tr);
  return true;
}
function stepSide(n) {
  const i = A.rows.findIndex((x) => x.id === A.sideId); if (i < 0) return;
  const next = A.rows[i + n]; if (!next) return;
  A.sideId = next.id; A.sideRow = next;
  paintSide();
  const tr = $(`#view tr.pa-row[data-id="${CSS.escape(next.id)}"]`);
  if (tr) { const b = tr.getBoundingClientRect(); if (b.top < 90 || b.bottom > innerHeight - 20) tr.scrollIntoView({ block: 'nearest' }); }
}

/* ------------------------------------------------------------------ the close date */
function panel(id) {
  const r = rowById(id); if (!r) return;
  const t = today(); const cur = r.close ? r.close.date : '';
  W().dialog(`<div class="wc-dlg__head"><div><span class="h-label">Asks</span><h2>Expected close</h2><p class="wa-dsub">${esc(r.name)} · ${money(r.amount)}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${W().ic('x')}</button></div>
    <div class="wc-dlg__body wa-panel">
      <div class="wa-quick">${quick(t).map(([l, v]) => `<button type="button" class="wa-q${cur === v ? ' is-on' : ''}" data-wa-pick="${v}"><span>${esc(l)}</span><em>${esc(fd(v, true))}</em></button>`).join('')}</div>
      <label class="wa-date"><span>Pick a date</span><input type="date" id="wa-date" min="${t}" value="${esc(cur)}" /></label>
      <div class="wa-foot2"><span>${cur ? 'Now ' + esc(fd(cur, true)) : 'No date yet'}</span>${cur ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wa-clear>Clear</button>' : ''}<button type="button" class="h-btn h-btn--primary" data-wa-save>Save</button></div>
    </div>`, () => { A.panelId = id; });
}

// Show a saved date at once, in the page and in the panel, before the refetch puts every row in its place.
function patchClose(id, date) {
  const apply = (r) => { if (!r || r.id !== id || r.state === 'gave') return; r.close = date ? { date, by: '' } : null; r.state = !date ? 'open' : date < today() ? 'past' : 'closing'; };
  A.rows.forEach(apply); apply(A.sideRow);
}
async function saveClose(id, date) {
  let out;
  try { out = await W().api(`/api/work/asks/${encodeURIComponent(id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) }); }
  catch (e) { W().toast(e.message); return; }
  W().closeLayer();
  toast(out.close ? `Expected close ${fd(out.close, true)}` : 'Close date cleared', id, out.previous);
  patchClose(id, out.close || null);
  view(); paintSide();
  load(true, true);
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
  // A previous date that has gone by cannot be set again; the ask goes back to no date then.
  const date = u.previous && u.previous >= today() ? u.previous : null;
  try {
    await W().api(`/api/work/asks/${encodeURIComponent(u.id)}/close`, { method: 'PUT', body: JSON.stringify({ date }) });
    W().toast('Undone.');
    patchClose(u.id, date);
    view(); paintSide();
    load(true, true);
  } catch (e) { W().toast(e.message); }
}

/* ------------------------------------------------------------------ events */
// The shared parts: the pager turns pages, a header sorts, the Columns menu redraws.
PT.on(KEY, {
  page(p) { A.page = p; load(false); },
  sort(col, dir) { A.dir = col === A.sort ? dir : SORT_DIR[col] || 'asc'; A.sort = col; A.page = 1; load(false); },
  cols() { view(); paintSide(); },
});

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
  // The side panel and its scrim sit beside #view.
  const host = t.closest('#pa-side-host');
  if (host) {
    if (t.closest('[data-pa-close]')) { closeSide(); return; }
    const step = t.closest('[data-pa-step]'); if (step) { if (!step.disabled) stepSide(Number(step.dataset.paStep)); return; }
    const pick = t.closest('[data-pa-pick]'); if (pick && A.sideId) { saveClose(A.sideId, pick.dataset.paPick); return; }
    if (t.closest('[data-pa-clear]') && A.sideId) { saveClose(A.sideId, null); return; }
    if (t.closest('[data-pa-save]') && A.sideId) { const v = ($('#pa-date', host) || {}).value; if (v) saveClose(A.sideId, v); else W().toast('Pick a date or one of the dates above.'); return; }
    const prep = t.closest('[data-wa-prep]'); if (prep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(prep.dataset.waPrep); }
    return;
  }
  if (!t.closest('#wc-root')) return;
  const open = t.closest('[data-pa-open]'); if (open) { openSide(open.dataset.paOpen); return; }
  const b = t.closest('button');
  // A click on the row itself, not on a link, button or field in it, opens the panel.
  if (!b) {
    const tr = t.closest('tr.pa-row');
    if (tr && !t.closest('a, input, select, label, summary')) openSide(tr.dataset.id);
    return;
  }
  const d = b.dataset;
  if (d.waFtoggle !== undefined) { A.fopen = !A.fopen; view(); return; }
  if (d.waUnf) {
    if (d.waUnf === 'status') A.status = 'open'; else if (d.waUnf === 'range') A.range = '12m'; else if (d.waUnf === 'state') A.state = ''; else if (d.waUnf === 'q') A.q = ''; else A.owner = '';
    changed(d.waUnf === 'range' || d.waUnf === 'owner'); return;
  }
  if (d.waStatus) { A.status = d.waStatus; changed(false); return; }
  if (d.waClose) { panel(d.waClose); return; }
  if (d.waPrep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(d.waPrep); return; }
  if (b.hasAttribute('data-wa-reload')) { A.meta = null; A.error = ''; A.started = false; A.epoch++; A.rows = []; view(); }
}, false);
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.matches) return;
  if (t.matches('[data-wa-range]')) { A.range = t.value; changed(true); return; }
  if (t.matches('[data-wa-owner]')) { A.owner = t.value; changed(true); return; }
  if (t.matches('[data-wa-state]')) { A.state = t.value; changed(false); return; }
  if (t.matches('[data-wa-sortsel]')) { const [c, dir] = t.value.split(':'); A.sort = c; A.dir = dir; changed(false); }
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
// The hub swapped to another page: the panel goes with the tab.
document.addEventListener('hub-swapped', () => { A.sideId = null; A.sideRow = null; const h = $('#pa-side-host'); if (h) h.remove(); });
// Keys with the panel open: Escape closes it, the arrow keys and j and k step to the next ask. They stay out of a field being typed in.
document.addEventListener('keydown', (e) => {
  if (!A.sideId || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!W().S || W().S.view !== 'asks') { closeSide(); return; }
  const typing = e.target && /^(input|textarea|select)$/i.test(e.target.tagName);
  if (e.key === 'Escape') { if ($('#layer .wc-dlg')) return; e.preventDefault(); e.stopPropagation(); closeSide(); return; }
  if (typing) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); stepSide(1); } else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); stepSide(-1); }
}, true);

window.WCAsks = { A, start, view, shapeQuick: quick, easter };
window.WCTabs.registerTab({ id: 'asks', label: 'Asks', roles: ['director', 'support'], after: 'open', count: () => (A.meta ? A.meta.stats.open.n : ''), dot: () => !!A.meta && A.meta.stats.past.n > 0, mount: () => view(), warm: () => { if (!A.started) start(); } });
})();
