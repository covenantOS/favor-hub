/* Cadence (Work Center tab for Partner Care): the Partner Care manual's contact rules applied to the D1 copy of Blackbaud. Each row is a
   partner who is due, with the steps as buttons in the manual's order (call, text, email, card). A step opens a small form and saves one
   contact on the partner through POST /api/work/cadence/step, which saves an ordinary batch; this file then sends it with
   /api/work/batches/:id/run, the way Gifts to thank does. Reads GET /api/work/cadence (no Blackbaud calls).
   Registers itself with window.WCTabs. Needs thank.js (window.FavorWG) and work.js (window.WC). */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { data: null, loading: false, error: '', started: false, owner: '', q: '', quick: '', page: 1, sort: '', dir: 'desc', local: {}, leftNow: {}, weekAdd: 0, sheetOn: false, cm: new Set() };
const WORD = { call: 'Called', text: 'Texted', email: 'Emailed', card: 'Card' };
const ICON = { call: 'phone', text: 'text', email: 'mail', card: 'card' };
const QUICK = { due: 'Due now', first: 'First-time partners', repeat: 'Monthly, twice a year, annual', quarterly: 'Quarterly gifts to thank' };
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');

async function load(owner) {
  C.loading = true; C.error = '';
  try {
    const d = await W().api('/api/work/cadence' + (owner !== undefined && owner !== null ? '?owner=' + encodeURIComponent(owner) : ''));
    C.data = d; C.owner = d.owner || ''; C.local = {}; C.leftNow = {}; C.weekAdd = 0; C.page = 1;
  } catch (e) { C.error = e.message; }
  C.loading = false;
}
async function start() {
  if (C.started) return;
  C.started = true;
  await load();
  W().refresh('cadence');
}

const stepsOf = (r) => {
  const got = C.local[r.cid];
  if (!got) return r.steps;
  const reached = r.steps.some((s) => s.group === 'reach' && got.has(s.k));
  return r.steps.filter((s) => !got.has(s.k) && !(reached && s.group === 'reach'));
};
const stepName = (s) => (s.group === 'reach' ? 'Reach out' : s.label);
const finished = (r) => !!C.local[r.cid] && (r.need === 'any' ? r.steps.some((s) => C.local[r.cid].has(s.k)) : stepsOf(r).length === 0);
const rows = () => (C.data ? C.data.rows.filter((r) => !finished(r)) : []);
const isDue = (r) => r.over >= 0;
const QTEST = { due: isDue, first: (r) => isDue(r) && r.rule === 'first', repeat: (r) => isDue(r) && ['monthly', 'semi', 'annual'].includes(r.rule), quarterly: (r) => isDue(r) && r.rule === 'quarterly' };
const visible = () => rows().filter((r) => (!C.quick || QTEST[C.quick](r)) && (!C.q || (r.name + ' ' + r.place).toLowerCase().includes(C.q.toLowerCase())));
const count = () => (C.data ? rows().filter(isDue).length : '');
const dot = () => !!C.data && rows().some((r) => r.over >= 7);

function dueLabel(r) {
  const f = F();
  const os = r.overStep ? r.steps.find((x) => x.k === r.overStep) : null;
  const step = os ? stepName(os) : '';
  if (r.over > 0) return `<b class="is-late">${step ? esc(step) + ' ' : ''}${r.over} ${r.over === 1 ? 'day' : 'days'} over</b>`;
  if (r.over === 0) return '<b>Due today</b>';
  return `<b>Due ${esc(f.fd(r.due))}</b>`;
}

/* The other late steps, oldest first, so a card never logged does not read as a partner nobody has called. */
function lateLine(r) {
  const os = r.steps.find((x) => x.k === r.overStep);
  const late = r.steps.filter((s) => typeof s.late === 'number' && s.late > 0 && stepName(s) !== (os ? stepName(os) : '')).sort((a, b) => b.late - a.late);
  const seen = new Set();
  return late.filter((s) => !seen.has(stepName(s)) && seen.add(stepName(s))).map((s) => `${stepName(s)} ${s.late} ${s.late === 1 ? 'day' : 'days'} late`).join(' · ');
}

function stepBtn(r, s, nextK) {
  const f = F();
  const next = s.k === nextK;
  const title = s.off || `${s.label} ${r.name}`;
  return `<button type="button" class="wcd-seq${next ? ' is-next' : ''}" ${s.off ? 'disabled' : ''} data-wcd-step="${esc(r.cid)}" data-k="${s.k}" title="${esc(title)}">${f.ic(ICON[s.k])}${esc(s.label)}</button>`;
}

// Columns the person can hide. Partner, Due, the step buttons and the row buttons always show.
const COLS = [{ k: 'who', l: 'Partner', fixed: true }, { k: 'rule', l: 'Frequency' }, { k: 'due', l: 'Due', fixed: true }, { k: 'steps', l: 'Steps', fixed: true }, { k: 'last', l: 'Last contact' }, { k: 'holder', l: 'Held by' }, { k: 'found', l: 'Came in through' }];
const HIDE_DEFAULT = ['found'];
const hiddenCols = () => (window.PT ? window.PT.hidden('cadence', HIDE_DEFAULT) : new Set(HIDE_DEFAULT));
const colCount = (hide) => 1 + COLS.filter((c) => c.fixed || !hide.has(c.k)).length;
const pageSize = () => (window.PT ? window.PT.size('cadence', 50) : 50);
const SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const sortState = () => ({ col: C.sort, dir: C.dir });
const th = (col, label) => (window.PT ? window.PT.th('cadence', col, label, sortState()) : esc(label));
const SORTS = {
  name: (r) => String(r.name || '').toLowerCase(),
  rule: (r) => String(r.ruleLabel || '').toLowerCase(),
  over: (r) => (typeof r.over === 'number' ? r.over : -1e9),
  last: (r) => (r.last && r.last.date ? r.last.date : ''),
};
function ordered(list) {
  const key = SORTS[C.sort];
  if (!key) return list;
  const sgn = C.dir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sgn; });
}

function rowHTML(r, hide, n) {
  const f = F();
  const steps = stepsOf(r);
  const nextK = (steps.find((s) => !s.off) || {}).k;
  const left = C.leftNow[r.cid];
  const call = r.phone ? `<a class="pt-icon" href="${tel(r.phone)}" title="Call ${esc(r.phone)}" aria-label="Call ${esc(r.name)}">${f.ic('phone')}</a>` : `<span class="pt-icon is-off" title="No phone to call">${f.ic('phone')}</span>`;
  const lastTxt = r.last ? `${f.fd(r.last.date)} · ${r.last.what.toLowerCase()}` : 'No contact on record';
  const holders = (r.holderNames || []).join(', ');
  const late = lateLine(r);
  const lateN = late ? late.split(' · ').length : 0;
  const where = [r.place, r.pattern].filter(Boolean).join(' · ');
  const open = C.cm.has(r.cid);
  const comm = `<button type="button" class="wcd-comm ptl-comm${open ? ' is-open' : ''}" data-wcd-comm="${esc(r.cid)}" aria-expanded="${open}" title="Communication history and preferences">Communication${C.data.noText && C.data.noText[r.cid] ? ' <span class="pt-badge pt-badge--warn">No texts</span>' : ''}</button>`;
  const main = `<tr class="ptl-row${open ? ' is-open' : ''}" data-cid="${esc(r.cid)}" data-pt-row tabindex="-1">
    <td class="c-who"><div class="ptl-who"><a class="pt-name wg-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}" data-pt-open title="${esc(r.name)}">${esc(r.name)}</a><span class="pt-sub ptl-place" title="${esc(where + (r.found ? ' · Came in through ' + r.found.label : ''))}">${esc(where)}</span></div></td>
    ${hide.has('rule') ? '' : `<td class="c-rule" title="${esc(r.line || '')}"><span class="pt-badge${r.rule === 'first' ? ' pt-badge--good' : ''}">${esc(r.ruleLabel)}</span></td>`}
    <td class="c-due">${dueLabel(r)}${lateN ? ` <span class="pt-badge pt-badge--warn" title="${esc(late)}">+${lateN} late</span>` : ''}${left ? ' <span class="pt-badge pt-badge--gold">Left a message today</span>' : ''}</td>
    <td class="c-steps"><div class="ptl-steps">${steps.map((s) => stepBtn(r, s, nextK)).join('')}</div></td>
    ${hide.has('last') ? '' : `<td class="c-last" title="${esc(lastTxt)}"><span class="pt-sub">${esc(lastTxt)}</span></td>`}
    ${hide.has('holder') ? '' : `<td class="c-holder" title="${esc(holders)}"><span class="pt-sub">${esc(holders)}</span></td>`}
    ${hide.has('found') ? '' : `<td class="c-found" title="${r.found ? esc(r.found.code) : ''}"><span class="pt-sub">${r.found ? esc(r.found.label) : ''}</span></td>`}
    <td class="c-acts"><div class="pt-acts">${call}${comm}</div></td></tr>`;
  return main + (open ? `<tr class="ptl-expand"><td colspan="${n}"><div class="cm-expand" data-wcd-cm="${esc(r.cid)}"></div></td></tr>` : '');
}

function view() {
  const f = F(); const el = $('#view');
  if (!el) return;
  if (!C.data && !C.error) { el.innerHTML = window.WCSkel(5); if (!C.loading) start(); return; }
  if (C.error && !C.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${esc(C.error)}<p><button type="button" class="h-btn h-btn--primary" data-wcd-reload>Try again</button></p></div></section>`; return; }
  const PT = window.PT;
  const d = C.data; const all = rows(); const due = all.filter(isDue);
  const quick = [['', 'All', all.length, 'Every partner in the queue'], ['due', 'Due now', due.length, QUICK.due], ['first', 'First-time', due.filter((r) => r.rule === 'first').length, QUICK.first], ['repeat', 'Monthly to annual', due.filter((r) => ['monthly', 'semi', 'annual'].includes(r.rule)).length, QUICK.repeat], ['quarterly', 'Quarterly', due.filter((r) => r.rule === 'quarterly').length, QUICK.quarterly]];
  const list = ordered(visible());
  const hide = hiddenCols(); const n = colCount(hide);
  if (PT) C.page = PT.clampPage(C.page, list.length, pageSize());
  const pageList = PT ? PT.slice(list, C.page, pageSize()) : list;
  const chips = d.owners.length > 1 && d.owners.some((o) => o.n !== d.everyone);
  const mine = d.me && d.owners.some((o) => o.id === d.me) ? d.me : '';
  const seg = chips ? `<div class="pt-seg" role="group" aria-label="Whose list">${mine ? `<button type="button" class="${C.owner === mine ? 'is-on' : ''}" data-wcd-owner="${esc(mine)}">Mine</button>` : ''}<button type="button" class="${!C.owner ? 'is-on' : ''}" data-wcd-owner="all">All of Partner Care</button></div>` : '';
  el.innerHTML = `
    <section class="h-card wc-sheet ptl-sheet" aria-label="Cadence">
      <div class="pt-bar">${seg}<label class="pt-search">${SEARCH_SVG}<span class="sr-only">Find a partner</span><input type="search" id="wcd-q" data-pt-search placeholder="Find a partner" value="${esc(C.q)}" autocomplete="off" /></label>
        <div class="pt-seg" role="group" aria-label="Show">${quick.map(([k, l, c, tip]) => `<button type="button" class="${C.quick === k ? 'is-on' : ''}" data-wcd-quick="${k}" aria-pressed="${C.quick === k}" title="${esc(tip)}">${esc(l)}<span>${c.toLocaleString('en-US')}</span></button>`).join('')}</div>
        <span class="pt-spacer"></span>
        ${PT ? PT.colsHTML('cadence', COLS, HIDE_DEFAULT) : ''}
        ${PT ? PT.densityHTML() : ''}
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wcd-print>${f.ic('print')}Print the three lists</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="cadence">${f.ic('sheet')}Open in Google Sheets</button></div>
      <div class="ptl-wrap">
        <table class="pt-table ptl-table ptl-cadence">
          <thead><tr><th>${th('name', 'Partner')}</th>${hide.has('rule') ? '' : `<th>${th('rule', 'Frequency')}</th>`}<th>${th('over', 'Due')}</th><th>Steps</th>${hide.has('last') ? '' : `<th>${th('last', 'Last contact')}</th>`}${hide.has('holder') ? '' : '<th>Held by</th>'}${hide.has('found') ? '' : '<th>Came in through</th>'}<th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody data-pt-list="cadence">${pageList.map((r) => rowHTML(r, hide, n)).join('') || `<tr><td colspan="${n}"><div class="pt-empty"><b>${all.length ? 'Nothing matches' : 'Queue clear'}</b>${all.length ? 'Clear the filter above to see the rest.' : 'New partners come due after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div></td></tr>`}</tbody>
        </table>
      </div>
      ${PT ? PT.pager('cadence', { total: list.length, page: C.page, noun: 'partners' }) : ''}
      <div class="wg-foot"><span>${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'partner' : 'partners'}. ${(d.stats.week + C.weekAdd).toLocaleString('en-US')} done this week. Each step you press logs an action on the partner.${d.unreachable ? ` ${d.unreachable.toLocaleString('en-US')} more ${d.unreachable === 1 ? 'partner is' : 'partners are'} due with no phone, email or mailing address for the step they need.` : ''}</span></div>
    </section>`;
  registerSheet();
  mountComm();
}

function mountComm() {
  if (!window.FavorComm) return;
  document.querySelectorAll('[data-wcd-cm]').forEach((el) => window.FavorComm.mount(el, el.dataset.wcdCm, { canFlag: true, onFlag: async () => { await load(C.owner || 'all'); view(); W().render(); } }));
}

/* ------------------------------------------------------------------ the three lists */
const splitLists = (list) => {
  const sorted = list.filter(isDue).sort((a, b) => (b.overMax ?? b.over) - (a.overMax ?? a.over));
  const n = Math.ceil(sorted.length / 3);
  return [['Friday', sorted.slice(0, n)], ['Saturday', sorted.slice(n, 2 * n)], ['Sunday', sorted.slice(2 * n)]];
};
const needText = (r) => stepsOf(r).filter((s) => !s.off).map((s) => s.label).join(', ') || 'No step possible';
function printDialog() {
  const f = F(); const e = esc;
  const lists = splitLists(visible());
  const L = document.createElement('div');
  L.className = 'wg-layer wcd-printlayer';
  L.innerHTML = `<div class="wg-scrim" data-wcd-close></div><div class="wg-dlg wg-dlg--wide" role="dialog" aria-modal="true" aria-label="The three lists">
    <div class="wg-dlg__head"><div><h2>The three lists</h2><p>Friday, Saturday and Sunday, from the queue as it stands. The partners who have waited longest are on Friday.</p></div><button type="button" class="pp-iconbtn" data-wcd-close aria-label="Close">${f.ic('x')}</button></div>
    <div class="wg-dlg__body"><div class="wcd-lists3">${lists.map(([day, l]) => `<div class="wcd-list3"><h3>${day}<span>${l.length}</span></h3>${l.map((r) => `<div class="wcd-l3row"><b>${e(r.name)}</b><span>${e(r.ruleLabel)} · ${e(needText(r))}${r.phone ? ' · ' + e(r.phone) : ''}</span></div>`).join('') || '<div class="wg-sub">None</div>'}</div>`).join('')}</div></div>
    <div class="wg-dlg__foot"><small>Ordered by how long each partner has waited</small><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="cadence-lists">${f.ic('sheet')}Open in Google Sheets</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wcd-doprint>${f.ic('print')}Print</button></span></div></div>`;
  document.body.appendChild(L);
}
function closeDialog() { const L = $('.wcd-printlayer'); if (L) L.remove(); }

function registerSheet() {
  if (!window.FavorSheets || C.sheetOn) return;
  C.sheetOn = true;
  const cols = [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'rule', label: 'Rule', type: 'text' }, { key: 'pattern', label: 'Giving', type: 'text' }, { key: 'found', label: 'Came in through', type: 'text' }, { key: 'steps', label: 'Steps', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' }, { key: 'last', label: 'Last contact', type: 'date' }, { key: 'over', label: 'Days over', type: 'number' }, { key: 'holder', label: 'Held by', type: 'text' }];
  const rowOf = (r) => ({ partner: r.name, place: r.place, rule: r.ruleLabel, pattern: r.pattern, found: r.found ? r.found.label : '', steps: needText(r), phone: r.phone || '', last: r.last ? r.last.date : null, over: r.over, holder: r.holderNames.join(', ') });
  window.FavorSheets.register('cadence', () => window.FavorSheets.screen('Cadence', [{ name: 'Cadence', columns: cols, rows: visible().map(rowOf) }], { filters: C.quick ? 'Filter: ' + QUICK[C.quick] : '', classes: ['partner'] }));
  window.FavorSheets.register('cadence-lists', () => window.FavorSheets.screen('Cadence, the three lists', splitLists(visible()).map(([day, l]) => ({ name: day, columns: cols, rows: l.map(rowOf) })), { classes: ['partner'] }));
}

/* ------------------------------------------------------------------ pressing a step */
let popEl = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener('keydown', onKey, true); } }
function onKey(e) { if (e.key === 'Escape' && popEl) { e.stopPropagation(); closePop(); } }
function place(anchor) {
  const r = anchor.getBoundingClientRect(); const w = Math.min(340, innerWidth - 24);
  popEl.style.width = w + 'px';
  popEl.style.left = Math.max(12, Math.min(r.left, innerWidth - w - 12)) + 'px';
  const h = popEl.offsetHeight; let top = r.bottom + 8; if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
  popEl.style.top = top + 'px';
}
function stepPop(anchor, r, k) {
  const f = F(); const e = esc;
  closePop();
  const st = { reach: 'talked' };
  popEl = document.createElement('div');
  popEl.className = 'wg-pop'; popEl.setAttribute('role', 'dialog'); popEl.setAttribute('aria-label', `${k} ${r.name}`);
  document.body.appendChild(popEl);
  const label = { call: 'Call', text: 'Text', email: 'Email', card: 'Card' }[k];
  const draw = () => {
    const keep = $('#wcd-line', popEl) ? $('#wcd-line', popEl).value : '';
    const attempt = k === 'call' && st.reach === 'left';
    popEl.innerHTML = `<h4><span>${label} ${e(r.name)}<small>${e(r.ruleLabel)}${r.place ? ' · ' + e(r.place) : ''}</small></span><button type="button" class="pp-iconbtn" data-wcd-x aria-label="Close">${f.ic('x')}</button></h4>
      ${k === 'call' ? `<div class="pp-seg" role="group" aria-label="Result"><button type="button" class="${st.reach === 'talked' ? 'is-on' : ''}" data-wcd-reach="talked">Talked</button><button type="button" class="${st.reach === 'left' ? 'is-on' : ''}" data-wcd-reach="left">Left a message</button></div>` : ''}
      <input type="text" id="wcd-line" maxlength="200" placeholder="${k === 'card' ? 'What you wrote' : attempt ? 'Anything to note' : 'What was said'}" value="${e(keep)}" autocomplete="off" />
      <div class="wg-pop__foot"><small>${attempt ? 'Logs the attempt. The step stays due and a reminder comes tomorrow.' : r.phone && (k === 'call' || k === 'text') ? e(r.phone) : ''}</small><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wcd-save>${attempt ? 'Save attempt' : 'Save ' + label.toLowerCase()}</button></div>`;
    place(anchor);
  };
  draw();
  document.addEventListener('keydown', onKey, true);
  popEl.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-wcd-x')) { closePop(); return; }
    if (t.dataset.wcdReach) { st.reach = t.dataset.wcdReach; draw(); return; }
    if (t.hasAttribute('data-wcd-save')) {
      const line = $('#wcd-line', popEl).value.trim();
      closePop();
      await save(r, k, st.reach, line);
    }
  });
  popEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'wcd-line') { ev.preventDefault(); const b = $('[data-wcd-save]', popEl); if (b) b.click(); } });
  setTimeout(() => { const i = $('#wcd-line', popEl); if (i) i.focus(); }, 30);
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!popEl) { document.removeEventListener('click', off); return; } const path = ev.composedPath ? ev.composedPath() : []; if (!path.includes(popEl) && !path.includes(anchor)) { closePop(); document.removeEventListener('click', off); } }), 0);
}
addEventListener('resize', closePop);

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

async function save(r, k, reach, line) {
  const f = F();
  const left = k === 'call' && reach === 'left';
  f.toast('Saving…');
  let out;
  try { out = await f.post('/api/work/cadence/step', { cid: r.cid, step: k, outcome: left ? 'left' : 'talked', line, req: f.reqId() }); } catch (e) { f.toast(e.message, null, true); if (e.status === 409) { await load(C.owner || 'all'); W().render(); } return; }
  if (!out.batch) { f.toast('That step was already saved.', null, true); return; }
  const bid = out.batch.id;
  // Show the result at once; the send follows. If Blackbaud turns something down, the list is read again.
  if (left) C.leftNow[r.cid] = true;
  else {
    (C.local[r.cid] || (C.local[r.cid] = new Set())).add(k);
    const done = finished(r);
    if (done) { C.weekAdd++; const el = $(`.ptl-row[data-cid="${CSS.escape(r.cid)}"]`); if (el) el.classList.add('is-leaving'); }
    setTimeout(() => { if (W().S.view === 'cadence') view(); W().render(); }, done ? 380 : 0);
  }
  if (left) view();
  let held = '';
  try { if (out.batch.run_when !== 'tonight') held = await drive(bid); else held = 'tonight'; } catch (e) { f.toast(e.message + ' It is saved, and Recent can send it again.', [bid], true); return; }
  let bad = null;
  try {
    const recent = (await f.api('/api/work/recent')).batches || [];
    for (const b of recent) if (b.id === bid) { const x = (b.items || []).find((i) => i.state === 'failed'); if (x) bad = x.error || 'Blackbaud turned it down.'; }
  } catch (_) { /* saved; the toast still offers Undo */ }
  if (bad) { f.toast(`${bad} Nothing was lost. Recent has Try again.`, [bid], true); await load(C.owner || 'all'); W().render(); return; }
  const what = left ? `Message logged for ${r.name}. Call again tomorrow` : `${{ call: 'Call', text: 'Text', email: 'Email', card: 'Card' }[k]} logged for ${r.name}`;
  f.toast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', [bid]);
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t.closest) return;
  if (t.closest('.wcd-printlayer')) {
    if (t.closest('[data-wcd-close]')) closeDialog();
    else if (t.closest('[data-wcd-doprint]')) { document.body.classList.add('wcd-printing'); window.print(); setTimeout(() => document.body.classList.remove('wcd-printing'), 300); }
    return;
  }
  if (!t.closest('#wc-root')) return;
  const b = t.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.wcdComm) { if (C.cm.has(d.wcdComm)) C.cm.delete(d.wcdComm); else C.cm.add(d.wcdComm); view(); return; }
  if (d.wcdQuick !== undefined) { C.quick = C.quick === d.wcdQuick ? '' : d.wcdQuick; C.page = 1; view(); return; }
  if (b.hasAttribute('data-wcd-reload')) { C.data = null; C.error = ''; C.loading = false; C.started = false; view(); return; }
  if (b.hasAttribute('data-wcd-print')) { printDialog(); return; }
  if (d.wcdOwner !== undefined) { C.data = null; view(); await load(d.wcdOwner); view(); W().render(); return; }
  if (d.wcdStep) {
    const r = rows().find((x) => x.cid === d.wcdStep); if (!r) return;
    e.preventDefault();
    stepPop(b, r, d.k);
  }
}, false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.wcd-printlayer') && !popEl) closeDialog(); });
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wcd-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { C.q = t.value; C.page = 1; view(); const i = $('#wcd-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});
// An undo of a step (the toast's Undo is shared with Gifts to thank) puts the row back.
document.addEventListener('favor:thanked-undone', async () => { if (!C.started) return; await load(C.owner || 'all'); W().render(); });

// Pager, sortable headers and the Columns menu (public/js/ptable.js).
if (window.PT) {
  window.PT.on('cadence', {
    page(p) { C.page = p; view(); },
    sort(col, dir) { if (col === 'name' || col === 'rule') dir = C.sort === col ? dir : 'asc'; C.sort = col; C.dir = dir; C.page = 1; view(); },
    cols() { view(); },
  });
}

if (window.WCTabs) {
  window.WCTabs.registerTab({ id: 'cadence', label: 'Cadence', roles: ['partner_care'], after: 'open', count: () => count(), dot: () => dot(), mount: () => view(), warm: () => start() });
}
window.WCCadence = { start, view, count, dot, C };
})();
