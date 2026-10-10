/* Gifts to thank (Work Center tab): every gift on the partners a director holds, soft credits included, oldest first, until someone
   thanks it. Row buttons: Call, Prep (the call-prep brief), Thank (a short form). Pick many and thank them by letter or email.
   Reads GET /api/work/gifts (the D1 copy of Blackbaud, no Blackbaud calls); thank-yous go through thank.js.
   Loaded before work.js; reaches the page through window.WC. Public: window.WCGifts = { start, view, count, dot }. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const G = { data: null, loading: false, error: '', owner: null, quick: '', q: '', sel: new Set(), gone: new Set(), leftNow: {}, shelf: [], weekAdd: 0, started: false };
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
  W().render();
}

const rows = () => (G.data ? G.data.rows.filter((r) => !G.gone.has(r.key)) : []);
const isLate = (r) => r.hours >= 24;
const isFirst = (r) => r.badges.some((b) => /first/i.test(b));
const quickOf = (r, q) => (q === 'late' ? isLate(r) : q === 'first' ? isFirst(r) : q === 'big' ? r.amount >= 1000 : true);
const visible = () => rows().filter((r) => quickOf(r, G.quick) && (!G.q || (r.partner.name + ' ' + r.fund).toLowerCase().includes(G.q.toLowerCase())));
const count = () => (G.data ? rows().length : '');
const dot = () => !!G.data && rows().some(isLate);
const nameOf = (r) => r.partner.name;
const ago = (r) => (r.ageDays === 0 ? 'Today' : r.ageDays === 1 ? 'Yesterday' : r.ageDays + ' days');
const badge = (b) => `<span class="wc-tag ${/first/i.test(b) ? 'wc-tag--done' : /largest|\$1,000/i.test(b) ? 'wc-tag--gift' : /soft/i.test(b) ? 'wc-tag--maybe' : ''}">${F().esc(b)}</span>`;
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');
const asGift = (r) => ({ giftId: r.giftId, cid: r.cid, name: nameOf(r), amount: r.amount, date: r.date, fund: r.fund, phone: r.partner.phone, left: G.leftNow[r.key] || r.left, tasks: r.taskIds && r.taskIds.length });

function rowHTML(r) {
  const f = F(); const e = f.esc; const p = r.partner;
  const ctx = [p.lifetime ? 'Lifetime ' + f.short(p.lifetime) : '', p.count > 1 ? p.count.toLocaleString('en-US') + ' gifts' : '', p.lastContact ? 'Last contact ' + f.fd(p.lastContact) : 'No contact yet'].filter(Boolean).join(' · ');
  const call = p.phone && !p.doNotCall ? `<a class="wg-icon" href="${tel(p.phone)}" title="Call ${e(p.phone)}" aria-label="Call ${e(nameOf(r))}">${f.ic('phone')}</a>` : `<span class="wg-icon is-off" title="${p.doNotCall ? 'Do not call' : 'No phone to call'}">${f.ic('phone')}</span>`;
  const left = G.leftNow[r.key] || r.left;
  const who = G.data.owners.length > 1 && !G.owner ? `<div class="wg-who">${r.ownerNames.map((n) => `<span class="wg-ini">${e(n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase())}</span>${e(n)}`).join(', ')}</div>` : '';
  return `<div class="wg-row wg-gift${G.sel.has(r.key) ? ' is-picked' : ''}" data-key="${e(r.key)}">
    <label class="wg-cb"><input type="checkbox" data-wg-pick="${e(r.key)}" ${G.sel.has(r.key) ? 'checked' : ''} aria-label="Select ${e(nameOf(r))}" /></label>
    <div class="wg-amt wg-c-amt">${f.money(r.amount)}<small class="${r.ageDays > 1 ? 'is-late' : ''}">${f.fd(r.date)} · ${ago(r)}</small></div>
    <div class="wg-c-who">${who}<a class="wg-name" href="/work/partner/${e(r.cid)}" data-partner-id="${e(r.cid)}">${e(nameOf(r))}</a><span class="wg-sub">${p.place ? e(p.place) + ' · ' : ''}${e(ctx)}${r.soft ? ` · Given through ${e(r.soft.giver)}` : ''}</span></div>
    <div class="wg-fund wg-c-fund"><b>${e(r.fund)}</b><span class="wg-sub">${e(r.pay || '')}</span><div class="wg-badges">${r.badges.map(badge).join('')}${r.taskIds && r.taskIds.length ? '<span class="wc-tag" title="An open thank-you task for this gift closes with the thank-you">Task open</span>' : ''}${left ? `<span class="wc-tag wc-tag--queued" title="${e(left.by || '')}">Left a message ${e(f.fd(left.date))}</span>` : ''}</div></div>
    <div class="wg-acts">${call}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-prep="${e(r.cid)}" data-gift="${e(r.key)}">${f.ic('brief')}Prep</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wg-thank="${e(r.key)}">${f.ic('check')}Thank${f.ic('down', 'wg-caret')}</button></div></div>`;
}

function view() {
  const f = F(); const e = f.esc; const el = $('#view');
  if (!el) return;
  if (!G.data && !G.error) { el.innerHTML = '<section class="h-card wc-sheet" aria-busy="true"><div class="h-skel" style="height:320px;border-radius:18px"></div></section>'; if (!G.loading) start(); return; }
  if (G.error && !G.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${e(G.error)}<p><button type="button" class="h-btn h-btn--primary" data-wg-reload>Try again</button></p></div></section>`; return; }
  const d = G.data; const all = rows();
  const late = all.filter(isLate).length; const first = all.filter(isFirst).length; const big = all.filter((r) => r.amount >= 1000).length;
  const stats = [['', 'To thank', all.length], ['late', 'Over 24 hours', late, 1], ['first', 'First gifts', first], ['big', '$1,000 and up', big], ['', 'Thanked this week', d.stats.week + G.weekAdd, 0, 1]];
  const list = visible().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const lateL = list.filter(isLate); const newL = list.filter((r) => !isLate(r));
  const lw = d.lastWorkday; const since = lw === f.TODAY || lw === addDay(f.TODAY, -1) ? 'yesterday' : WEEKDAY[new Date(lw + 'T12:00:00Z').getUTCDay()];
  const picker = d.owners.length > 1 ? `<select class="wc-sel${G.owner ? ' is-set' : ''}" data-wg-owner aria-label="Director"><option value="">Every director (${d.everyone})</option>${d.owners.map((o) => `<option value="${e(o.id)}"${G.owner === o.id ? ' selected' : ''}>${e(o.name)} (${o.n})</option>`).join('')}</select>` : '';
  const who = d.owners.length > 1 || W().DATA.me.role === 'admin' ? "directors' partners" : 'your partners';
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n, warn, plain]) => `<button type="button" class="wc-stat${!plain && G.quick === k && k ? ' is-on' : !plain && !k && !G.quick ? ' is-on' : ''}${warn && n ? ' is-warn' : ''}" ${plain ? 'data-wg-noop' : `data-wg-quick="${k}"`}><b>${n}</b><span>${l}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" id="wg-sheet" aria-label="Gifts to thank">
      <div class="wg-tools"><label class="wc-find">${f.ic('search')}<input type="search" id="wg-q" placeholder="Find a partner" value="${e(G.q)}" autocomplete="off" /></label>${picker}<span class="wg-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="gifts-to-thank">${f.ic('sheet')}Google Sheets</button></div>
      <div class="wg-list">
        ${lateL.length ? `<div class="wg-group is-late"><span>Over 24 hours · ${lateL.length}</span><button type="button" data-wg-all="late">Select all</button></div>${lateL.map(rowHTML).join('')}` : ''}
        ${newL.length ? `<div class="wg-group"><span>New since ${e(since)} · ${newL.length}</span><button type="button" data-wg-all="new">Select all</button></div>${newL.map(rowHTML).join('')}` : ''}
        ${!list.length ? `<div class="wg-empty"><b>${all.length ? 'Nothing matches' : 'All thanked'}</b>${all.length ? 'Clear the filter above to see the rest.' : 'New gifts show here after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div>` : ''}
      </div>
      ${G.shelf.length ? `<div class="wg-done"><span>Thanked today</span>${G.shelf.map((t) => `<span class="wc-tag wc-tag--done">${e(t.name)} · ${e(t.how)}</span>`).join('')}</div>` : ''}
      <div class="wg-foot"><span>${all.length} ${all.length === 1 ? 'gift' : 'gifts'} on ${who}, soft credits included, from the last ${d.days} days</span></div>
    </section>`;
  bulkBar();
  registerSheet();
}
const addDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function bulkBar() {
  let b = $('#wg-bulk');
  if (!b) { b = document.createElement('div'); b.id = 'wg-bulk'; b.className = 'wg-bulk'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Selected gifts'); document.body.appendChild(b); }
  const on = W().S.view === 'gifts' && G.sel.size > 0;
  b.classList.toggle('is-on', on);
  if (!on) return;
  const f = F();
  b.innerHTML = `<b>${G.sel.size} selected</b><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-bulk="letter">${f.ic('letter')}Thank by letter</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-bulk="email">${f.ic('mail')}Thank by email</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-clear>Clear</button>`;
}
function hideBulk() { const b = $('#wg-bulk'); if (b) b.classList.remove('is-on'); }

function registerSheet() {
  if (!window.FavorSheets || G.sheetOn) return;
  G.sheetOn = true;
  window.FavorSheets.register('gifts-to-thank', () => {
    const list = visible().sort((a, b) => (a.date < b.date ? -1 : 1));
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
  const b = t.closest('button, a, input[data-wg-pick]');
  if (!b) return;
  const d = b.dataset;
  if (d.wgQuick !== undefined) { G.quick = G.quick === d.wgQuick ? '' : d.wgQuick; view(); return; }
  if (b.hasAttribute('data-wg-reload')) { G.data = null; G.error = ''; G.loading = false; G.started = false; view(); return; }
  if (d.wgAll) { const list = visible().filter((r) => (d.wgAll === 'late' ? isLate(r) : !isLate(r))); const every = list.every((r) => G.sel.has(r.key)); list.forEach((r) => (every ? G.sel.delete(r.key) : G.sel.add(r.key))); view(); return; }
  if (b.hasAttribute('data-wg-clear')) { G.sel.clear(); view(); return; }
  if (d.wgPick) { if (b.checked) G.sel.add(d.wgPick); else G.sel.delete(d.wgPick); const row = b.closest('.wg-row'); if (row) row.classList.toggle('is-picked', b.checked); bulkBar(); return; }
  if (d.wgThank) {
    const r = rows().find((x) => x.key === d.wgThank); if (!r) return;
    e.preventDefault();
    F().pop(b, asGift(r), { owner: G.owner || (r.owners && r.owners[0]) });
    return;
  }
  if (d.wgPrep) { e.preventDefault(); if (window.FavorPrep) window.FavorPrep.open(d.wgPrep, { gift: d.gift }); return; }
}, false);
// The bulk bar sits on the body, outside the Work Center's root.
document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const b = t.closest('#wg-bulk [data-wg-bulk]');
  if (b) {
    const gifts = [...G.sel].map((k) => rows().find((r) => r.key === k)).filter(Boolean).map(asGift);
    if (gifts.length) F().bulk(gifts, b.dataset.wgBulk, { owner: G.owner || undefined });
    return;
  }
  if (t.closest('#wg-bulk [data-wg-clear]')) { G.sel.clear(); view(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches && t.matches('[data-wg-owner]')) { G.sel.clear(); G.data = null; view(); await load(t.value); view(); W().render(); }
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
addEventListener('DOMContentLoaded', () => (window.WCX = window.WCX || []).push({ k: 'gifts', label: 'Gifts to thank', after: 'open', show: (me) => !!(me && me.canGifts), count: () => count(), dot: () => dot(), view: () => view() }));
})();
