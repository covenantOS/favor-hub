/* Gifts to thank (Work Center tab): every gift on the partners a director holds, soft credits included, until someone thanks it. The
   gifts on the 24-hour clock come first, least time left first; gifts whose clock ran out more than a day ago fold under Older. Row buttons: Call, Prep (the call-prep brief), Thank (a short form). Pick many and thank them by letter or email.
   Reads GET /api/work/gifts (the D1 copy of Blackbaud, no Blackbaud calls); thank-yous go through thank.js.
   Loaded before work.js; reaches the page through window.WC. Public: window.WCGifts = { start, view, count, dot }. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
// Rows page with the shared pager (public/js/ptable.js, key wc-gifts). G.page goes back to 1 when the filter, search, director, sort or Older switch changes.
const KEY = 'wc-gifts';
const G = { olderOpen: false, page: 1, sig: '', sort: { col: 'due', dir: 'asc' }, data: null, loading: false, error: '', owner: null, quick: '', q: '', sel: new Set(), gone: new Set(), leftNow: {}, shelf: [], weekAdd: 0, started: false };
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function load(owner) {
  G.loading = true; G.error = '';
  try {
    const d = await W().api('/api/work/gifts' + (owner ? '?owner=' + encodeURIComponent(owner) : ''));
    G.data = d; G.owner = d.owner || ''; G.gone = new Set(); G.leftNow = {}; G.shelf = (d.shelf || []).map((s) => ({ giftId: s.giftId, cid: s.cid, name: s.name, how: s.how })); G.weekAdd = 0;
    G.sel = new Set([...G.sel].filter((k) => d.rows.some((r) => r.key === k)));
  } catch (e) { G.error = e.message; }
  G.loading = false;
}
async function start() {
  if (G.started) return;
  G.started = true;
  await load();
  W().refresh('gifts');
}

const rows = () => (G.data ? G.data.rows.filter((r) => !G.gone.has(r.key)) : []);
// Minutes left on the 24-hour clock, read now (the page may stay open for hours). Older: ran out more than a day ago.
const minsLeft = (r) => (r.clock && r.clock.due ? Math.round((Date.parse(r.clock.due) - Date.now()) / 60000) : 24 * 60 - r.hours * 60);
const isLate = (r) => minsLeft(r) <= 0;
const isOlder = (r) => minsLeft(r) <= -24 * 60;
const dueDay = (r) => (r.clock && r.clock.due ? new Date(Date.parse(r.clock.due)).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : r.date);
// Soonest due day first, the largest gift first within a day; then the ones that ran out, then Older, newest first.
const byClock = (a, b) => {
  const ma = minsLeft(a), mb = minsLeft(b);
  const ra = ma > 0 ? 0 : ma > -1440 ? 1 : 2, rb = mb > 0 ? 0 : mb > -1440 ? 1 : 2;
  if (ra !== rb) return ra - rb;
  const da = dueDay(a), db = dueDay(b);
  if (da !== db) return ra === 0 ? (da < db ? -1 : 1) : (da < db ? 1 : -1);
  return b.amount - a.amount || ma - mb || (a.key < b.key ? -1 : 1);
};
const isFirst = (r) => r.badges.some((b) => /first/i.test(b));
const quickOf = (r, q) => (q === 'late' ? isLate(r) : q === 'first' ? isFirst(r) : q === 'big' ? r.amount >= 1000 : true);
const visible = () => rows().filter((r) => quickOf(r, G.quick) && (!G.q || (r.partner.name + ' ' + r.fund).toLowerCase().includes(G.q.toLowerCase())));
const count = () => (G.data ? rows().length : '');
const dot = () => !!G.data && rows().some(isLate);
const nameOf = (r) => r.partner.name;
const ago = (r) => (r.ageDays === 0 ? 'Today' : r.ageDays === 1 ? 'Yesterday' : Number(r.ageDays).toLocaleString('en-US') + ' days');
const badge = (b) => `<span class="wc-tag ${/first/i.test(b) ? 'wc-tag--done' : /largest|\$1,000/i.test(b) ? 'wc-tag--gift' : /soft/i.test(b) ? 'wc-tag--maybe' : ''}">${/^soft credit$/i.test(b) && window.FavorUI && FavorUI.term ? FavorUI.term('soft') : F().esc(b)}</span>`;
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');
const mayLetter = () => { const me = W().DATA.me || {}; return (me.role === 'admin' || me.role === 'support') && !!window.WCLetter; };
const asGift = (r) => ({ team: r.team, giftId: r.giftId, cid: r.cid, name: nameOf(r), amount: r.amount, date: r.date, fund: r.fund, phone: r.partner.phone, left: G.leftNow[r.key] || r.left, tasks: r.taskIds && r.taskIds.length });

// Sorting: Due is the clock order the list always had (groups: on the clock, then Older). Any other column lists the rows flat.
const SORT_DEFAULT_DIR = { due: 'asc', amount: 'desc', partner: 'asc', fund: 'asc' };
const sortedRows = (list) => {
  const s = G.sort; const m = s.dir === 'asc' ? 1 : -1;
  const by = { due: byClock, amount: (a, b) => a.amount - b.amount || byClock(a, b), partner: (a, b) => nameOf(a).localeCompare(nameOf(b)) || byClock(a, b), fund: (a, b) => String(a.fund).localeCompare(String(b.fund)) || byClock(a, b) }[s.col] || byClock;
  return list.slice().sort((a, b) => by(a, b) * m);
};
const grouped = () => G.sort.col === 'due' && G.sort.dir === 'asc';
const th = (col, label) => PT.th(KEY, col, label, G.sort);
PT.on(KEY, {
  page(p) { G.page = p; view(); const sc = $('#wg-sheet .wg-scroll'); if (sc) sc.scrollTop = 0; },
  sort(col) { G.sort = G.sort.col === col ? { col, dir: G.sort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: SORT_DEFAULT_DIR[col] || 'asc' }; view(); },
});

function clockLine(r) {
  const f = F();
  const c = f.clock && r.clock ? f.clock(r.clock.due) : null;
  if (!c || !c.label || isOlder(r)) return `<small class="${r.ageDays > 1 ? 'is-late' : ''}">${f.fd(r.date)} · ${ago(r)}</small>`;
  return `<small class="wg-clock${c.late ? ' is-late' : c.soon ? ' is-soon' : ''}">${f.esc(c.label)}</small>`;
}
function rowHTML(r) {
  const f = F(); const e = f.esc; const p = r.partner;
  const ctx = [p.count > 0 ? 'Lifetime ' + f.whole(p.lifetime) + ' · ' + p.count.toLocaleString('en-US') + (p.count === 1 ? ' gift' : ' gifts') : '', p.lastContact ? 'Last contact ' + f.fd(p.lastContact) : 'No contact yet'].filter(Boolean).join(' · ');
  const call = p.phone && !p.doNotCall ? `<a class="wg-icon" href="${tel(p.phone)}" title="Call ${e(p.phone)}" aria-label="Call ${e(nameOf(r))}">${f.ic('phone')}</a>` : `<span class="wg-icon is-off" title="${p.doNotCall ? 'Do not call' : 'No phone to call'}">${f.ic('phone')}</span>`;
  const left = G.leftNow[r.key] || r.left;
  const who = G.data.owners.length > 1 && !G.owner ? `<div class="wg-who">${r.ownerNames.map((n) => `<span class="wg-ini">${e(String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase() || '?')}</span>${e(n)}`).join(', ')}</div>` : '';
  return `<div class="wg-row wg-gift${G.sel.has(r.key) ? ' is-picked' : ''}" data-key="${e(r.key)}" data-pt-row tabindex="-1">
    <label class="wg-cb"><input type="checkbox" data-wg-pick="${e(r.key)}" ${G.sel.has(r.key) ? 'checked' : ''} aria-label="Select ${e(nameOf(r))}" /></label>
    <div class="wg-amt wg-c-amt${f.money(r.amount).length > 10 ? ' is-long' : ''}">${f.money(r.amount)}${clockLine(r)}</div>
    <div class="wg-c-who">${who}<a class="wg-name" href="/work/partner/${e(r.cid)}" data-partner-id="${e(r.cid)}">${e(nameOf(r))}</a><span class="wg-sub">${p.place ? e(p.place) + ' · ' : ''}${e(ctx)}${r.soft ? ` · Given through ${e(r.soft.giver)}` : ''}</span></div>
    <div class="wg-fund wg-c-fund"><b>${e(r.fund)}</b><span class="wg-sub">${r.pay === 'Other' && window.FavorUI && FavorUI.term ? FavorUI.term('other', 'Other') : e(r.pay || '')}</span><div class="wg-badges">${r.badges.map(badge).join('')}${r.taskIds && r.taskIds.length ? '<span class="wc-tag" title="An open thank-you task for this gift closes with the thank-you">Task open</span>' : ''}${left ? `<span class="wc-tag wc-tag--queued" title="${e(left.by || '')}">Left a message ${e(f.fd(left.date))}</span>` : ''}</div></div>
    <div class="wg-acts">${call}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-pt-open data-wg-prep="${e(r.cid)}" data-gift="${e(r.key)}">${f.ic('brief')}Prep</button>${mayLetter() ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-letter="${e(r.key)}">${f.ic('letter')}Letter</button>` : ''}<button type="button" class="h-btn h-btn--primary h-btn--sm" data-wg-thank="${e(r.key)}">${f.ic('check')}Thank${f.ic('down', 'wg-caret')}</button></div></div>`;
}

function view() {
  const f = F(); const e = f.esc; const el = $('#view');
  if (!el) return;
  if (!G.data && !G.error) { el.innerHTML = window.WCSkel(5); if (!G.loading) start(); return; }
  if (G.error && !G.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${e(G.error)}<p><button type="button" class="h-btn h-btn--primary" data-wg-reload>Try again</button></p></div></section>`; return; }
  const d = G.data; const all = rows();
  const late = all.filter(isLate).length; const first = all.filter(isFirst).length; const big = all.filter((r) => r.amount >= 1000).length;
  const stats = [['', 'To thank', all.length], ['late', 'Overdue', late, 1], ['first', 'First gifts', first], ['big', '$1,000 and up', big], ['', 'Thanked this week', d.stats.week + G.weekAdd, 0, 1]];
  const list = visible().sort(byClock);
  const curL = list.filter((r) => !isOlder(r)); const oldL = list.filter(isOlder);
  const olderOpen = G.olderOpen || !curL.length;
  const pool = sortedRows(olderOpen ? list : curL);
  const sig = [G.quick, G.q, G.owner, olderOpen, G.sort.col, G.sort.dir].join('|');
  if (G.sig !== sig) { G.sig = sig; G.page = 1; }
  const size = PT.size(KEY, 50); G.page = PT.clampPage(G.page, pool.length, size);
  const pageRows = PT.slice(pool, G.page, size);
  G.pageKeys = pageRows.map((r) => r.key);
  const groupHead = (old) => (old
    ? `<div class="wg-group wg-group--older is-open"><span>Older · ${oldL.length.toLocaleString('en-US')}</span><button type="button" data-wg-all="late">Select all</button></div>`
    : `<div class="wg-group"><span>On the 24-hour clock · ${curL.length.toLocaleString('en-US')}</span><button type="button" data-wg-all="new">Select all</button></div>`);
  let body = ''; let lastOld = null;
  for (const r of pageRows) {
    const old = isOlder(r);
    if (grouped() && old !== lastOld) { body += groupHead(old); lastOld = old; }
    body += rowHTML(r);
  }
  const pageOn = pageRows.length && pageRows.every((r) => G.sel.has(r.key));
  const picker = d.owners.length > 1 ? `<select class="pt-sel wc-sel${G.owner ? ' is-set' : ''}" data-wg-owner aria-label="Director"><option value="">Every director (${Number(d.everyone).toLocaleString('en-US')})</option>${d.owners.map((o) => `<option value="${e(o.id)}"${G.owner === o.id ? ' selected' : ''}>${e(o.name)} (${Number(o.n).toLocaleString('en-US')})</option>`).join('')}</select>` : '';
  const who = d.owners.length > 1 || W().DATA.me.role === 'admin' ? "directors' partners" : 'your partners';
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n, warn, plain]) => (plain ? `<button type="button" class="wc-stat${warn && n ? ' is-warn' : ''}" data-wg-noop><b>${(Number(n) || 0).toLocaleString('en-US')}</b><span>${l}</span></button>` : `<div class="wc-stat wc-stat--split${k && G.quick === k ? ' is-on' : !k && !G.quick ? ' is-on' : ''}${warn && n ? ' is-warn' : ''}"><button type="button" class="wc-stat__n" data-wg-tile="${k}" data-wg-tile-n="${n}" aria-label="${n} ${l}, open the gifts behind it"><b>${(Number(n) || 0).toLocaleString('en-US')}</b></button><button type="button" class="wc-stat__l" data-wg-quick="${k}"><span>${l}</span></button></div>`)).join('')}</div>
    <section class="h-card wc-sheet" id="wg-sheet" aria-label="Gifts to thank">
      <div class="pt-bar wg-tools"><label class="pt-search">${f.ic('search')}<span class="sr-only">Find a partner</span><input type="search" id="wg-q" data-pt-search placeholder="Find a partner" value="${e(G.q)}" autocomplete="off" /></label>${picker}
        ${oldL.length && curL.length ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm wg-oldbtn${olderOpen ? ' is-on' : ''}" data-wg-older aria-pressed="${olderOpen}">Older gifts <b>${oldL.length.toLocaleString('en-US')}</b></button>` : ''}
        <span class="pt-spacer"></span>${PT.densityHTML()}
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="gifts-to-thank">${f.ic('sheet')}Open in Google Sheets</button></div>
      <div class="wg-scroll wg-list" data-pt-list="${KEY}">
        <div class="wg-head wg-gift"><label class="wg-cb"><input type="checkbox" data-wg-pickall ${pageOn ? 'checked' : ''} aria-label="Select every gift on this page" /></label><span class="wg-hc">${th('amount', 'Gift')}${th('due', 'Due')}</span><span>${th('partner', 'Partner')}</span><span>${th('fund', 'Fund')}</span><span></span></div>
        ${body}
        ${!list.length ? `<div class="wg-empty"><b>${all.length ? 'Nothing matches' : 'All thanked'}</b>${all.length ? 'Clear the filter above to see the rest.' : 'New gifts show here after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div>` : ''}
      </div>
      ${G.shelf.length ? `<div class="wg-done"><span>Thanked today</span>${G.shelf.map((t) => `<span class="wc-tag wc-tag--done">${e(t.name)} · ${e(t.how)}</span>`).join('')}</div>` : ''}
      <div class="wg-foot">${PT.pager(KEY, { total: pool.length, page: G.page, size, label: `gifts on ${who}, soft credits included, from the last ${d.days} days${W().DATA.me.role === 'partner_care' ? '. First gifts and gifts under $1,000 on partners Partner Care holds' : ''}` })}</div>
    </section>`;
  bulkBar();
  registerSheet();
  if (W().fit) W().fit();
}
const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function bulkBar() {
  let b = $('#wg-bulk');
  if (!b) { b = document.createElement('div'); b.id = 'wg-bulk'; b.className = 'wg-bulk'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Selected gifts'); document.body.appendChild(b); }
  const on = W().S.view === 'gifts' && G.sel.size > 0;
  b.classList.toggle('is-on', on);
  if (!on) return;
  const f = F();
  b.innerHTML = `<b>${G.sel.size} selected</b>${mayLetter() ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-bulk="letters">${f.ic('letter')}Letters, one PDF</button>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-bulk="letter">${f.ic('letter')}Thank by letter</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-bulk="email">${f.ic('mail')}Thank by email</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-clear>Clear</button>`;
}
function hideBulk() { const b = $('#wg-bulk'); if (b) b.classList.remove('is-on'); }

function registerSheet() {
  if (!window.FavorSheets || G.sheetOn) return;
  G.sheetOn = true;
  window.FavorSheets.register('gifts-to-thank', () => {
    const list = visible().sort(byClock);
    const cols = [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'date', label: 'Gift date', type: 'date' }, { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'fund', label: 'Fund', type: 'text' }, { key: 'how', label: 'Paid by', type: 'text' }, { key: 'badges', label: 'Notes', type: 'text' }, { key: 'owner', label: 'Director', type: 'text' }, { key: 'last', label: 'Last contact', type: 'date' }];
    const data = list.map((r) => ({ partner: nameOf(r), place: r.partner.place, date: r.date, amount: r.amount, fund: r.fund, how: r.pay, badges: r.badges.join(', '), owner: r.ownerNames.join(', '), last: r.partner.lastContact || null }));
    return window.FavorSheets.screen('Gifts to thank', [{ name: 'Gifts to thank', columns: cols, rows: data }], { filters: G.quick ? 'Filter: ' + G.quick : '', classes: ['partner'] });
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const root = $('#wc-root'); const t = e.target;
  if (!root || !t.closest || !t.closest('#wc-root')) return;
  const b = t.closest('button, a, input[data-wg-pick], input[data-wg-pickall]');
  if (!b) return;
  const d = b.dataset;
  if (d.wgTile !== undefined && window.FavorDrill) {
    // The number opens the gifts the tile counted, from this page's own list.
    const T = { '': ['Gifts to thank', () => true], late: ['Gifts past the 24-hour clock', isLate], first: ['First gifts to thank', isFirst], big: ['Gifts of $1,000 and up to thank', (r) => r.amount >= 1000] }[d.wgTile];
    if (!T) return;
    const list = rows().filter(T[1]).map((r) => ({ date: r.date, partner: r.partner.name, place: r.partner.place || '', amount: r.amount, fund: r.fund || '', waiting: r.ageDays, notes: r.badges.join(', ') }));
    window.FavorDrill.open({
      title: T[0], shown: Number(d.wgTileN), shownType: 'int', shownLabel: 'On Gifts to thank', defs: ['Gifts to thank'],
      columns: [{ key: 'date', label: 'Gift date', type: 'text' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'amount', label: 'Gift', type: 'money' }, { key: 'fund', label: 'Fund', type: 'text' }, { key: 'waiting', label: 'Days waiting', type: 'int' }, { key: 'notes', label: 'Notes', type: 'text' }],
      rows: list, total: list.length, totalLabel: 'Gifts behind it', rowsLabel: 'Gifts in this count', sheetTitle: T[0] + ' rows',
    });
    return;
  }
  if (b.hasAttribute('data-wg-pickall')) { const keys = G.pageKeys || []; keys.forEach((k) => (b.checked ? G.sel.add(k) : G.sel.delete(k))); view(); return; }
  if (d.wgQuick !== undefined) { G.quick = G.quick === d.wgQuick ? '' : d.wgQuick; view(); return; }
  if (b.hasAttribute('data-wg-reload')) { G.data = null; G.error = ''; G.loading = false; G.started = false; view(); return; }
  if (b.hasAttribute('data-wg-older')) { G.olderOpen = !G.olderOpen; view(); return; }
  if (d.wgAll) { const list = visible().filter((r) => (d.wgAll === 'late' ? isOlder(r) : !isOlder(r))); const every = list.every((r) => G.sel.has(r.key)); list.forEach((r) => (every ? G.sel.delete(r.key) : G.sel.add(r.key))); view(); return; }
  if (b.hasAttribute('data-wg-clear')) { G.sel.clear(); view(); return; }
  if (d.wgPick) { if (b.checked) G.sel.add(d.wgPick); else G.sel.delete(d.wgPick); const row = b.closest('.wg-row'); if (row) row.classList.toggle('is-picked', b.checked); const all = $('[data-wg-pickall]'); if (all) { const ks = G.pageKeys || []; all.checked = ks.length > 0 && ks.every((k) => G.sel.has(k)); } bulkBar(); return; }
  if (d.wgThank) {
    const r = rows().find((x) => x.key === d.wgThank); if (!r) return;
    e.preventDefault();
    F().pop(b, asGift(r), { owner: G.owner || (r.owners && r.owners[0]) });
    return;
  }
  if (d.wgLetter) { const r = rows().find((x) => x.key === d.wgLetter); if (r && window.WCLetter) { e.preventDefault(); window.WCLetter.open([asGift(r)], { from: G.owner || (r.owners && r.owners[0]) || '' }); } return; }
  if (d.wgPrep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(d.wgPrep, { gift: d.gift }); return; }
}, false);
// The bulk bar sits on the body, outside the Work Center's root.
document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const b = t.closest('#wg-bulk [data-wg-bulk]');
  if (b) {
    const gifts = [...G.sel].map((k) => rows().find((r) => r.key === k)).filter(Boolean).map(asGift);
    if (b.dataset.wgBulk === 'letters') { if (gifts.length && window.WCLetter) window.WCLetter.open(gifts, { from: G.owner || '' }); return; }
    if (gifts.length) F().bulk(gifts, b.dataset.wgBulk, { owner: G.owner || undefined });
    return;
  }
  if (t.closest('#wg-bulk [data-wg-clear]')) { G.sel.clear(); view(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-wg-owner]')) { G.sel.clear(); G.page = 1; G.data = null; view(); await load(t.value); view(); W().render(); }
});
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wg-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { G.q = t.value; view(); const i = $('#wg-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});

// A thank-you saved anywhere (this tab, the partner drawer, the brief) updates the rows without a reload.
document.addEventListener('favor:thanked', (e) => {
  const dt = e.detail || {};
  if (!G.data) return;
  const keys = (dt.items || []).map((i) => `${i.giftId}:${i.cid}`);
  for (const g of dt.gone || []) for (const r of G.data.rows) if (r.giftId === String(g)) G.gone.add(r.key);
  if (dt.left) {
    for (const k of keys) G.leftNow[k] = { date: F().TODAY, by: 'you', how: dt.how };
  } else {
    for (const k of keys) {
      const r = G.data.rows.find((x) => x.key === k);
      if (!r || G.gone.has(k)) continue;
      G.gone.add(k); G.sel.delete(k); G.weekAdd++;
      G.shelf.push({ giftId: r.giftId, cid: r.cid, name: nameOf(r), how: dt.how });
    }
  }
  if (W().S.view === 'gifts') {
    if (!dt.left) keys.forEach((k) => { const el = $(`.wg-row[data-key="${CSS.escape(k)}"]`); if (el) el.classList.add('is-leaving'); });
    setTimeout(() => { if (W().S.view === 'gifts') view(); }, dt.left ? 0 : 380);
  } else W().render();
});
document.addEventListener('favor:thanked-failed', async () => { G.started = true; await load(G.owner); if (W().S.view === 'gifts') view(); });
document.addEventListener('favor:thanked-undone', async () => { await load(G.owner); W().render(); });

window.WCGifts = { start, view, count, dot, hideBulk, G };
// The tab goes in through the Work Center's own list of extra tabs, right after Open actions, for the roles that thank gifts.
// Registered once every script has loaded, so the tab lands right after Open actions, ahead of the tabs other files add after it.
// Registered at once, so the address ?view=gifts finds the tab however fast the board arrives.
if (window.WCTabs) window.WCTabs.registerTab({ id: 'gifts', label: 'Gifts to thank', after: 'open', show: (me) => !!(me && me.canGifts), count: () => count(), dot: () => dot(), mount: () => view() });
else addEventListener('DOMContentLoaded', () => (window.WCX = window.WCX || []).push({ k: 'gifts', label: 'Gifts to thank', after: 'open', show: (me) => !!(me && me.canGifts), count: () => count(), dot: () => dot(), view: () => view() }));
})();
