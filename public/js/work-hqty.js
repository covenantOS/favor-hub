/* HQTY letters desk (Work Center tab, Support and admins). Every gift of $5,000 and up, newest first, grouped by month, with where its
   letter stands: To write, Printed, Signed, Mailed, Cannot send. Reads GET /api/work/hqty (the D1 copy of Blackbaud, no Blackbaud
   calls). Print opens one PDF (one page per gift) and marks the gifts Printed; Signed is a mark; Mark mailed writes one HQTY Letter
   action per gift in Blackbaud (1 call each, with Undo). The letter wording is edited once a month from the month button.
   Registers itself on the tab registry (work-tabs.js). Uses WCLetter (work-letter.js) to draw a page. */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const e = (s) => F().esc(s);
const AS = new URLSearchParams(location.search).get('as') || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOTS = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const H = { data: null, loading: false, error: '', filter: '', q: '', sel: new Set(), started: false, working: new Set() };
const STATE = { write: ['To write', 'wc-tag--gift'], printed: ['Printed', 'wc-tag--maybe'], signed: ['Signed', 'wc-tag--queued'], mailed: ['Mailed', 'wc-tag--done'], cannot: ['Cannot send', ''] };

async function load() {
  H.loading = true; H.error = '';
  try { H.data = await F().api('/api/work/hqty'); H.sel = new Set([...H.sel].filter((k) => H.data.rows.some((r) => r.key === k))); }
  catch (err) { H.error = err.message; }
  H.loading = false;
}
async function start() { if (H.started) return; H.started = true; await load(); if (W().S.view === 'hqty') view(); }

const recentFrom = () => { const t = H.data.today; let y = Number(t.slice(0, 4)); let m = Number(t.slice(5, 7)) - 1; if (m === 0) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}-01`; };
const blocked = (r) => r.flags.includes('No mailing address') || r.flags.includes('No partner credited');
const inFilter = (r, k) => {
  if (!k) return true;
  if (k === 'write') return r.state === 'write' && r.date >= recentFrom();
  if (k === 'earlier') return r.state === 'write' && r.date < recentFrom();
  if (k === 'mailed') return r.state === 'mailed' && r.stateDate >= H.data.today.slice(0, 7) + '-01';
  return r.state === k;
};
const visible = () => H.data.rows.filter((r) => inFilter(r, H.filter) && (!H.q || (r.partner.name + ' ' + r.fund + ' ' + r.address + ' ' + (r.through || '')).toLowerCase().includes(H.q.toLowerCase())));
const rowOf = (k) => H.data.rows.find((r) => r.key === k);
const count = () => (H.data ? H.data.stats.write : '');
const monthLabel = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1] + (ym.slice(0, 4) !== H.data.today.slice(0, 4) ? ' ' + ym.slice(0, 4) : '');

function stateCell(r) {
  const [l, cls] = STATE[r.state];
  let sub = '';
  if (r.state === 'write') sub = monthLabel(r.month) + ' letter';
  else if (r.state === 'mailed') sub = (r.source === 'blackbaud' ? 'Logged ' : 'Mailed ') + F().fd(r.stateDate);
  else if (r.state === 'cannot') sub = r.why;
  else sub = r.stateDate ? F().fd(r.stateDate) : '';
  return `<span class="wc-tag ${cls}">${l}</span><span class="wg-sub">${e(sub)}</span>`;
}
function actCell(r) {
  const f = F(); const off = blocked(r) ? ' disabled title="No mailing address or no partner credited"' : '';
  const prev = `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-prev="${e(r.key)}">${f.ic('brief')}Preview</button>`;
  const menu = `<button type="button" class="hq-more" data-hq-menu="${e(r.key)}" aria-label="More for ${e(r.partner.name)}" aria-haspopup="menu">${DOTS}</button>`;
  if (r.state === 'write') return `${prev}<button type="button" class="h-btn h-btn--primary h-btn--sm" data-hq-print="${e(r.key)}"${off}>${f.ic('print')}Print</button>${menu}`;
  if (r.state === 'printed') return `${prev}<button type="button" class="h-btn h-btn--primary h-btn--sm" data-hq-do="signed" data-key="${e(r.key)}">${f.ic('check')}Signed</button>${menu}`;
  if (r.state === 'signed') return `${prev}<button type="button" class="h-btn h-btn--primary h-btn--sm" data-hq-do="mailed" data-key="${e(r.key)}">${f.ic('mail')}Mark mailed</button>${menu}`;
  if (r.state === 'mailed') return `<span class="hq-ref">${r.actionId ? 'Action ' + e(r.actionId) : 'In Blackbaud'}</span>`;
  return `<span class="hq-ref">${e(r.why)}</span>${menu}`;
}
function rowHTML(r) {
  const f = F();
  const sub = r.through ? `Given through ${e(r.through)}` : r.partner.place ? e(r.partner.place) : '';
  const flags = r.flags.map((x) => `<span class="wc-tag wc-tag--warn">${e(x)}</span>`).join('');
  const picked = H.sel.has(r.key);
  const canPick = r.state !== 'mailed';
  return `<div class="wg-row hq-row${picked ? ' is-picked' : ''}${H.working.has(r.key) ? ' is-working' : ''}" data-key="${e(r.key)}">
    <label class="wg-cb">${canPick ? `<input type="checkbox" data-hq-pick="${e(r.key)}" ${picked ? 'checked' : ''} aria-label="Select ${e(r.partner.name)}" />` : ''}</label>
    <div class="wg-amt wg-c-amt">${f.money(r.amount)}<small>${f.fd(r.date)} · ${e(r.pay || r.type)}</small></div>
    <div class="wg-c-who"><a class="wg-name" href="/work/partner/${e(r.cid)}" data-partner-id="${e(r.cid)}">${e(r.partner.name)}</a><span class="wg-sub">${sub}</span>${flags ? `<div class="wg-badges">${flags}</div>` : ''}</div>
    <div class="hq-addr"><b>${e(r.fund || 'No fund on file')}</b>${r.address ? `<span class="wg-sub">${e(r.address)}</span>` : '<span class="wg-sub is-bad">No mailing address</span>'}</div>
    <div class="hq-state">${stateCell(r)}</div>
    <div class="wg-acts hq-acts">${actCell(r)}</div></div>`;
}

function view() {
  const el = $('#view'); if (!el) return;
  const f = F();
  if (!H.data && !H.error) { el.innerHTML = '<section class="h-card wc-sheet" aria-busy="true"><div class="h-skel" style="height:320px;border-radius:18px"></div></section>'; if (!H.loading) start(); return; }
  if (H.error && !H.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${e(H.error)}<p><button type="button" class="h-btn h-btn--primary" data-hq-reload>Try again</button></p></div></section>`; return; }
  const d = H.data; const s = d.stats; const mo = monthLabel(d.today.slice(0, 7));
  const stats = [['write', 'To write', s.write], ['printed', 'Printed, to sign', s.printed], ['signed', 'Signed, to mail', s.signed], ['mailed', 'Mailed this month', s.mailedMonth], ['earlier', 'Earlier gifts, no letter logged', s.earlier, 1]];
  const list = visible();
  const groups = [];
  for (const r of list) { const g = groups[groups.length - 1]; if (g && g.m === r.month) g.rows.push(r); else groups.push({ m: r.month, rows: [r] }); }
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n, warn]) => `<button type="button" class="wc-stat${H.filter === k ? ' is-on' : ''}${warn && n ? ' is-warn' : ''}" data-hq-filter="${k}"><b>${n}</b><span>${l}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" id="hq-sheet" aria-label="HQTY letters">
      <div class="wg-tools"><button type="button" class="hq-all${H.filter ? '' : ' is-on'}" data-hq-filter="">All gifts of $5,000 and up<span>${s.total}</span></button>
        <label class="wc-find">${f.ic('search')}<input type="search" id="hq-q" placeholder="Find a partner" value="${e(H.q)}" autocomplete="off" /></label><span class="wg-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-text>${f.ic('letter')}${e(mo)} letter</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="hqty-letters">${f.ic('sheet')}Google Sheets</button></div>
      <div class="wg-list">${groups.map((g) => `<div class="wg-group"><span>${e(monthLabel(g.m))} · ${g.rows.length}</span><button type="button" data-hq-grp="${e(g.m)}">Select all</button></div>${g.rows.map(rowHTML).join('')}`).join('')}
        ${!list.length ? `<div class="wg-empty"><b>${H.data.rows.length ? 'Nothing matches' : 'No gifts yet'}</b>${H.data.rows.length ? 'Clear the filter above to see the rest.' : 'Gifts of $5,000 and up show here after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div>` : ''}</div>
      <div class="wg-foot"><span>${s.total} gifts of $5,000 and up since ${f.fd(d.since)}. A gift counts as written when Blackbaud holds an HQTY Letter on its partner dated on or after the gift.</span></div>
    </section>`;
  bar(); sheet();
}

function bar() {
  let b = $('#hq-bulk');
  if (!b) { b = document.createElement('div'); b.id = 'hq-bulk'; b.className = 'wg-bulk'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Selected gifts'); document.body.appendChild(b); }
  const picked = [...H.sel].map(rowOf).filter(Boolean);
  b.classList.toggle('is-on', picked.length > 0 && W().S.view === 'hqty');
  if (!picked.length) { b.innerHTML = ''; return; }
  const f = F(); const has = (...st) => picked.some((r) => st.includes(r.state));
  b.innerHTML = `<b>${picked.length} selected</b>
    ${has('write', 'printed', 'signed') ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-bulk="print">${f.ic('print')}Print one PDF</button>` : ''}
    ${has('printed', 'write') ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-bulk="signed">${f.ic('check')}Signed</button>` : ''}
    ${has('signed', 'printed') ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-bulk="mailed">${f.ic('mail')}Mark mailed</button>` : ''}
    <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-bulk="cannot">Cannot send</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-hq-bulk="clear">Clear</button>`;
}

function sheet() {
  if (!window.FavorSheets || H.sheetOn) return;
  H.sheetOn = true;
  window.FavorSheets.register('hqty-letters', () => {
    const cols = [{ key: 'date', label: 'Gift date', type: 'date' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'partner', label: 'Partner', type: 'text' }, { key: 'through', label: 'Given through', type: 'text' },
      { key: 'fund', label: 'Fund', type: 'text' }, { key: 'address', label: 'Mailing address', type: 'text' }, { key: 'state', label: 'Letter', type: 'text' }, { key: 'on', label: 'On', type: 'date' }, { key: 'action', label: 'Blackbaud action', type: 'text' }, { key: 'flags', label: 'Flags', type: 'text' }];
    const data = visible().map((r) => ({ date: r.date, amount: r.amount, partner: r.partner.name, through: r.through || '', fund: r.fund, address: r.address, state: STATE[r.state][0] + (r.why ? ': ' + r.why : ''), on: r.stateDate || null, action: r.actionId, flags: r.flags.join(', ') }));
    return window.FavorSheets.screen('HQTY letters', [{ name: 'HQTY letters', columns: cols, rows: data }], { filters: H.filter ? 'Filter: ' + H.filter : '', classes: ['partner'] });
  });
}

/* ------------------------------------------------------------------ steps */
const pdfUrl = (ids) => '/api/work/hqty/pdf?ids=' + ids.join(',') + (AS ? '&as=' + encodeURIComponent(AS) : '');
function apply(ids, to, why, done) {
  const set = new Set(done || ids);
  for (const r of H.data.rows) {
    if (!set.has(r.giftId)) continue;
    if (to === 'printed' && r.state === 'write') { r.state = 'printed'; r.source = 'hub'; r.stateDate = H.data.today; }
    else if (to === 'signed') { r.state = 'signed'; r.source = 'hub'; r.stateDate = H.data.today; }
    else if (to === 'cannot') { r.state = 'cannot'; r.source = 'hub'; r.why = why; }
    else if (to === 'reset') { r.state = 'write'; r.source = ''; r.why = ''; r.stateDate = ''; }
  }
  recount();
}
function recount() {
  const d = H.data; const rf = recentFrom(); const ms = d.today.slice(0, 7) + '-01';
  d.stats = { write: 0, printed: 0, signed: 0, mailedMonth: 0, earlier: 0, total: d.rows.length };
  for (const r of d.rows) { if (r.state === 'write') d.stats[r.date >= rf ? 'write' : 'earlier']++; else if (r.state === 'printed') d.stats.printed++; else if (r.state === 'signed') d.stats.signed++; else if (r.state === 'mailed' && r.stateDate >= ms) d.stats.mailedMonth++; }
}
async function drive(bid) {
  let held = '';
  for (let i = 0; i < 60; i++) {
    const r = await F().post(`/api/work/batches/${bid}/run`);
    if (r.held === 'busy') { await sleep(1500); continue; }
    if (r.held) { held = r.held; break; }
    if (!r.left) break;
    await sleep(1200);
  }
  return held;
}
const reqId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));

/** One step for the gifts named by key. Resolves true when something changed. */
async function step(keys, to, why) {
  const rows = keys.map(rowOf).filter(Boolean);
  const ids = rows.map((r) => r.giftId);
  if (!ids.length) return false;
  ids.forEach((i) => H.working.add(i));
  let out;
  try { out = await F().post('/api/work/hqty/bulk', { ids, to, why: why || '', req: reqId() }); }
  catch (err) { ids.forEach((i) => H.working.delete(i)); F().toast(err.message, null, true); return false; }
  ids.forEach((i) => H.working.delete(i));
  const skip = (out.skipped || []).map((x) => x.why);
  if (to === 'mailed') {
    if (!out.batch) { F().toast(skip[0] || 'Nothing was saved.', null, true); await reload(); return false; }
    for (const r of rows) if ((out.done || []).includes(r.giftId)) { r.state = 'mailed'; r.source = 'hub'; r.stateDate = H.data.today; r.actionId = ''; }
    recount(); H.sel = new Set([...H.sel].filter((k) => rowOf(k) && rowOf(k).state !== 'mailed')); draw();
    F().toast(`Saving ${out.done.length} ${out.done.length === 1 ? 'letter' : 'letters'} to Blackbaud…`);
    try {
      const held = out.batch.run_when === 'tonight' ? 'tonight' : await drive(out.batch.id);
      const recent = (await F().api('/api/work/recent')).batches || [];
      const bad = (recent.find((b) => b.id === out.batch.id) || { items: [] }).items.find((x) => x.state === 'failed');
      if (bad) { F().toast(`${bad.error || 'Blackbaud turned it down.'} Nothing was lost. Recent has Try again.`, [out.batch.id], true); await reload(); return true; }
      F().toast(held === 'tonight' ? 'Mailed. It goes to Blackbaud tonight.' : held ? 'Mailed. Blackbaud is slow, so the rest goes when it answers.' : `Mailed ${out.done.length} ${out.done.length === 1 ? 'letter' : 'letters'}. One HQTY Letter action each.`, [out.batch.id]);
    } catch (err) { F().toast(err.message + ' It is saved, and Recent can send it again.', [out.batch.id], true); }
    await reload();
    return true;
  }
  apply(ids, to, why, out.done);
  if (skip.length && !(out.done || []).length) F().toast(skip[0], null, true);
  draw();
  return (out.done || []).length > 0;
}
async function reload() { await load(); if (W().S.view === 'hqty') view(); }
function draw() { if (W().S.view === 'hqty') view(); }

async function print(keys) {
  const rows = keys.map(rowOf).filter((r) => r && r.state !== 'mailed' && r.state !== 'cannot' && !blocked(r));
  const skipped = keys.length - rows.length;
  if (!rows.length) { F().toast('Nothing to print. Gifts with no mailing address or no partner credited stay off the print file.', null, true); return; }
  const win = window.open('', '_blank');
  const toMark = rows.filter((r) => r.state === 'write').map((r) => r.key);
  try { if (toMark.length) await step(toMark, 'printed'); } catch (_) { /* the print file still opens */ }
  const href = pdfUrl(rows.map((r) => r.giftId));
  if (win) win.location.href = href; else window.open(href, '_blank');
  F().toast(`Print file ready for ${rows.length} ${rows.length === 1 ? 'letter' : 'letters'}${skipped ? `. ${skipped} left out for no mailing address or partner` : ''}. Press Signed once they are signed.`);
}

/* ------------------------------------------------------------------ dialogs */
let layer = null;
function closeLayer() { if (layer) { layer.remove(); layer = null; document.removeEventListener('keydown', onKey, true); } }
function onKey(ev) { if (ev.key === 'Escape' && layer) { ev.stopPropagation(); closeLayer(); } }
function openLayer(html, wide) {
  closeLayer();
  layer = document.createElement('div'); layer.className = 'wg-layer';
  layer.innerHTML = `<div class="wg-scrim" data-hq-close></div><div class="wg-dlg${wide ? ' wg-dlg--wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(layer);
  document.addEventListener('keydown', onKey, true);
  return $('.wg-dlg', layer);
}

async function preview(key) {
  const r = rowOf(key); if (!r) return;
  const dlg = openLayer(`<div class="wg-dlg__head"><div><h2>${e(r.partner.name)}</h2><p>${F().money(r.amount)} on ${F().fd(r.date)} · ${e(r.fund || 'No fund on file')} · ${e(monthLabel(r.month))} letter</p></div><button type="button" class="pp-iconbtn" data-hq-close aria-label="Close">${F().ic('x')}</button></div><div class="hq-previewbody"><div class="hq-sheet" id="hq-pv"><div class="hq-skel"></div></div></div>
    <div class="wg-dlg__foot"><small>${r.state === 'write' ? 'Printing marks the gift Printed.' : 'The letter as it prints.'}</small><span><button type="button" class="h-btn h-btn--ghost" data-hq-close>Close</button>${r.state === 'write' || r.state === 'printed' || r.state === 'signed' ? `<button type="button" class="h-btn h-btn--primary" data-hq-print="${e(key)}"${blocked(r) ? ' disabled' : ''}>${F().ic('print')}Print</button>` : ''}</span></div>`);
  try { const out = await F().post('/api/work/hqty/pdf', { ids: [r.giftId] }); const box = $('#hq-pv', dlg); if (box) box.innerHTML = window.WCLetter.paper(out.letters[0]); }
  catch (err) { const box = $('#hq-pv', dlg); if (box) box.innerHTML = `<div class="hq-note is-bad">${e(err.message)}</div>`; }
}

function textEditor() {
  const d = H.data; const mo = monthLabel(d.today.slice(0, 7));
  const sample = visible().find((r) => r.month === d.today.slice(0, 7)) || H.data.rows.find((r) => r.month === d.today.slice(0, 7)) || H.data.rows[0];
  const dlg = openLayer(`<div class="wg-dlg__head"><div><h2>${e(mo)} letter</h2><p>One text for every ${e(mo)} gift. Blank lines start a new paragraph.</p></div><button type="button" class="pp-iconbtn" data-hq-close aria-label="Close">${F().ic('x')}</button></div>
    <div class="hq-compose"><div class="hq-compose__form"><label class="wg-lab" for="hq-body">The ${e(mo)} letter, used for every gift this month</label><textarea id="hq-body" rows="12" maxlength="2500">${e(d.text.body)}</textarea>
      <p class="hq-fields">Fields: {amount} {fund} {date}</p><button type="button" class="hq-link" data-hq-default>Use the starting text</button></div>
      <div class="hq-compose__page"><div class="hq-sheet" id="hq-pv"><div class="hq-skel"></div></div></div></div>
    <div class="wg-dlg__foot"><small>${sample ? 'The page shows ' + e(sample.partner.name) + '.' : ''} Letters already printed keep the text they printed with.</small><span><button type="button" class="h-btn h-btn--ghost" data-hq-close>Close</button><button type="button" class="h-btn h-btn--primary" data-hq-save>Save the ${e(mo)} letter</button></span></div>`, true);
  let t = 0;
  const draw = async () => {
    if (!sample) return;
    try { const out = await F().post('/api/work/hqty/pdf', { ids: [sample.giftId], text: $('#hq-body', dlg).value }); const box = $('#hq-pv', dlg); if (box) box.innerHTML = window.WCLetter.paper(out.letters[0]); }
    catch (err) { const box = $('#hq-pv', dlg); if (box) box.innerHTML = `<div class="hq-note is-bad">${e(err.message)}</div>`; }
  };
  $('#hq-body', dlg).addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 300); });
  dlg.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-hq-default]')) { $('#hq-body', dlg).value = d.text.defaultBody; draw(); return; }
    if (ev.target.closest('[data-hq-save]')) {
      try { await F().post('/api/work/hqty/text', { month: d.text.month, body: $('#hq-body', dlg).value }); closeLayer(); F().toast(`${mo} letter saved.`); await reload(); }
      catch (err) { F().toast(err.message, null, true); }
    }
  });
  draw();
}

function cannotDialog(keys) {
  const d = H.data; const rows = keys.map(rowOf).filter((r) => r && r.state !== 'mailed');
  if (!rows.length) return;
  const dlg = openLayer(`<div class="wg-dlg__head"><div><h2>Cannot send ${rows.length === 1 ? e(rows[0].partner.name) : rows.length + ' letters'}</h2><p>Pick the reason. The gift leaves To write and the reason stays on the row.</p></div><button type="button" class="pp-iconbtn" data-hq-close aria-label="Close">${F().ic('x')}</button></div>
    <div class="wg-dlg__body"><div class="hq-whys" role="radiogroup" aria-label="Reason">${d.whys.map((w, i) => `<label class="hq-why"><input type="radio" name="hq-why" value="${e(w)}"${i === 0 ? ' checked' : ''} /><span>${e(w)}</span></label>`).join('')}</div></div>
    <div class="wg-dlg__foot"><small></small><span><button type="button" class="h-btn h-btn--ghost" data-hq-close>Cancel</button><button type="button" class="h-btn h-btn--primary" data-hq-cannot>Mark Cannot send</button></span></div>`);
  dlg.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-hq-cannot]')) return;
    const why = ($('input[name="hq-why"]:checked', dlg) || {}).value || '';
    closeLayer();
    await step(rows.map((r) => r.key), 'cannot', why);
    H.sel.clear(); draw();
  });
}

let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(btn, key) {
  closeMenu();
  const r = rowOf(key); if (!r) return;
  const items = [];
  if (r.state === 'printed' || r.state === 'signed') items.push(['print', 'Print again']);
  if (r.state !== 'cannot') items.push(['cannot', 'Cannot send']);
  if (r.source === 'hub' && r.state !== 'write' && r.state !== 'mailed') items.push(['reset', 'Put back to To write']);
  menuEl = document.createElement('div'); menuEl.className = 'hq-menu'; menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = items.map(([k, l]) => `<button type="button" role="menuitem" data-hq-m="${k}" data-key="${e(key)}">${l}</button>`).join('');
  document.body.appendChild(menuEl);
  const b = btn.getBoundingClientRect(); const w = menuEl.offsetWidth;
  menuEl.style.left = Math.max(8, Math.min(b.right - w, innerWidth - w - 8)) + 'px';
  const h = menuEl.offsetHeight; menuEl.style.top = (b.bottom + h + 12 > innerHeight ? Math.max(8, b.top - h - 6) : b.bottom + 6) + 'px';
  const first = $('button', menuEl); if (first) first.focus();
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (ev) => {
  const t = ev.target; if (!t.closest) return;
  if (!t.closest('.hq-menu') && !t.closest('[data-hq-menu]')) closeMenu();
  if (t.closest('[data-hq-close]')) { closeLayer(); return; }
  const inRoot = t.closest('#wc-root') || t.closest('#hq-bulk') || t.closest('.wg-layer') || t.closest('.hq-menu');
  if (!inRoot || !H.data) return;
  const m = t.closest('[data-hq-m]');
  if (m) { closeMenu(); const k = m.dataset.hqM; const key = m.dataset.key; if (k === 'print') print([key]); else if (k === 'cannot') cannotDialog([key]); else if (k === 'reset') step([key], 'reset'); return; }
  const b = t.closest('button, a');
  if (!b) return;
  const d = b.dataset;
  if (d.hqFilter !== undefined) { H.filter = H.filter === d.hqFilter ? '' : d.hqFilter; view(); return; }
  if (b.hasAttribute('data-hq-reload')) { H.data = null; H.error = ''; H.started = false; view(); return; }
  if (b.hasAttribute('data-hq-text')) { textEditor(); return; }
  if (d.hqMenu) { openMenu(b, d.hqMenu); return; }
  if (d.hqPrev) { preview(d.hqPrev); return; }
  if (d.hqPrint) { closeLayer(); print([d.hqPrint]); return; }
  if (d.hqDo) { await step([d.key], d.hqDo); return; }
  if (d.hqGrp) { const list = visible().filter((r) => r.month === d.hqGrp && r.state !== 'mailed'); const all = list.every((r) => H.sel.has(r.key)); list.forEach((r) => (all ? H.sel.delete(r.key) : H.sel.add(r.key))); view(); return; }
  if (d.hqBulk) {
    const keys = [...H.sel];
    if (d.hqBulk === 'clear') { H.sel.clear(); view(); return; }
    if (d.hqBulk === 'print') { await print(keys); return; }
    if (d.hqBulk === 'cannot') { cannotDialog(keys); return; }
    await step(keys, d.hqBulk); H.sel.clear(); draw();
  }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.matches && t.matches('[data-hq-pick]')) { if (t.checked) H.sel.add(t.dataset.hqPick); else H.sel.delete(t.dataset.hqPick); const row = t.closest('.hq-row'); if (row) row.classList.toggle('is-picked', t.checked); bar(); }
});
let qT;
document.addEventListener('input', (ev) => {
  const t = ev.target; if (t.id !== 'hq-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { H.q = t.value; view(); const i = $('#hq-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && menuEl) closeMenu(); });
// The bar sits on the body, so leaving the tab takes it down.
document.addEventListener('click', (ev) => { const t = ev.target.closest && ev.target.closest('.wc-tab'); if (t && t.dataset.view !== 'hqty') { const b = $('#hq-bulk'); if (b) b.classList.remove('is-on'); } }, true);
document.addEventListener('favor:thanked-undone', () => { if (H.data) reload(); });

window.WCHqty = { H, view, count };
window.WCTabs.registerTab({ id: 'hqty', label: 'HQTY letters', roles: ['support'], after: 'open', count: () => count(), mount: () => view() });
})();
