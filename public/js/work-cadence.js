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
const C = { data: null, loading: false, error: '', started: false, owner: '', q: '', quick: '', shown: 100, local: {}, leftNow: {}, weekAdd: 0, sheetOn: false };
const WORD = { call: 'Called', text: 'Texted', email: 'Emailed', card: 'Card' };
const ICON = { call: 'phone', text: 'text', email: 'mail', card: 'card' };
const QUICK = { due: 'Due now', first: 'First-time partners', repeat: 'Monthly, twice a year, annual', quarterly: 'Quarterly gifts to thank' };
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');

async function load(owner) {
  C.loading = true; C.error = '';
  try {
    const d = await W().api('/api/work/cadence' + (owner !== undefined && owner !== null ? '?owner=' + encodeURIComponent(owner) : ''));
    C.data = d; C.owner = d.owner || ''; C.local = {}; C.leftNow = {}; C.weekAdd = 0; C.shown = 100;
  } catch (e) { C.error = e.message; }
  C.loading = false;
}
async function start() {
  if (C.started) return;
  C.started = true;
  await load();
  W().render();
}

const stepsOf = (r) => (C.local[r.cid] ? r.steps.filter((s) => !C.local[r.cid].has(s.k)) : r.steps);
const finished = (r) => !!C.local[r.cid] && (r.need === 'any' ? r.steps.some((s) => C.local[r.cid].has(s.k)) : stepsOf(r).length === 0);
const rows = () => (C.data ? C.data.rows.filter((r) => !finished(r)) : []);
const isDue = (r) => r.over >= 0;
const QTEST = { due: isDue, first: (r) => isDue(r) && r.rule === 'first', repeat: (r) => isDue(r) && ['monthly', 'semi', 'annual'].includes(r.rule), quarterly: (r) => isDue(r) && r.rule === 'quarterly' };
const visible = () => rows().filter((r) => (!C.quick || QTEST[C.quick](r)) && (!C.q || (r.name + ' ' + r.place).toLowerCase().includes(C.q.toLowerCase())));
const count = () => (C.data ? rows().filter(isDue).length : '');
const dot = () => !!C.data && rows().some((r) => r.over >= 7);

function dueLabel(r) {
  const f = F();
  if (r.over > 0) return `<b class="is-late">${r.over} ${r.over === 1 ? 'day' : 'days'} over</b>`;
  if (r.over === 0) return '<b>Due today</b>';
  return `<b>Due ${esc(f.fd(r.due))}</b>`;
}

function stepBtn(r, s, nextK) {
  const f = F();
  const next = s.k === nextK;
  const title = s.off || `${s.label} ${r.name}`;
  return `<button type="button" class="wcd-seq${next ? ' is-next' : ''}" ${s.off ? 'disabled' : ''} data-wcd-step="${esc(r.cid)}" data-k="${s.k}" title="${esc(title)}">${f.ic(ICON[s.k])}${esc(s.label)}</button>`;
}

function rowHTML(r) {
  const f = F();
  const steps = stepsOf(r);
  const nextK = (steps.find((s) => !s.off) || {}).k;
  const left = C.leftNow[r.cid];
  const call = r.phone ? `<a class="wg-icon" href="${tel(r.phone)}" title="Call ${esc(r.phone)}" aria-label="Call ${esc(r.name)}">${f.ic('phone')}</a>` : `<span class="wg-icon is-off" title="No phone to call">${f.ic('phone')}</span>`;
  const last = r.last ? `Last: ${esc(r.last.what)} ${esc(f.fd(r.last.date))}` : 'Last: No contact on record';
  const who = C.data.owners.length > 1 && !C.owner ? r.holderNames.join(', ') : '';
  return `<div class="wg-row wcd-row" data-cid="${esc(r.cid)}">
    <div class="wcd-who"><a class="wg-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wg-sub">${r.place ? esc(r.place) + ' · ' : ''}${esc(r.pattern)}</span></div>
    <div class="wcd-why"><span class="wc-tag${r.rule === 'first' ? ' wc-tag--done' : ''}">${esc(r.ruleLabel)}</span>${left ? `<span class="wc-tag wc-tag--queued">Left a message today</span>` : ''}<span class="wg-sub">${esc(r.line)}</span><span class="wg-sub">${last}</span></div>
    <div class="wcd-due">${dueLabel(r)}<span class="wg-sub">${esc(who)}</span></div>
    <div class="wcd-steps">${steps.map((s) => stepBtn(r, s, nextK)).join('')}</div>
    <div class="wg-acts">${call}</div></div>`;
}

function view() {
  const f = F(); const el = $('#view');
  if (!el) return;
  if (!C.data && !C.error) { el.innerHTML = '<section class="h-card wc-sheet" aria-busy="true"><div class="h-skel" style="height:320px;border-radius:18px"></div></section>'; if (!C.loading) start(); return; }
  if (C.error && !C.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${esc(C.error)}<p><button type="button" class="h-btn h-btn--primary" data-wcd-reload>Try again</button></p></div></section>`; return; }
  const d = C.data; const all = rows(); const due = all.filter(isDue);
  const stats = [['due', 'Due now', due.length, 1], ['first', 'First-time partners', due.filter((r) => r.rule === 'first').length], ['repeat', QUICK.repeat, due.filter((r) => ['monthly', 'semi', 'annual'].includes(r.rule)).length], ['quarterly', QUICK.quarterly, due.filter((r) => r.rule === 'quarterly').length], ['', 'Done this week', d.stats.week + C.weekAdd]];
  const list = visible();
  const chips = d.owners.length > 1 && d.owners.some((o) => o.n !== d.everyone);
  const mine = d.me && d.owners.some((o) => o.id === d.me) ? d.me : '';
  const seg = chips ? `<div class="pp-seg" role="group" aria-label="Whose list">${mine ? `<button type="button" class="${C.owner === mine ? 'is-on' : ''}" data-wcd-owner="${esc(mine)}">Mine</button>` : ''}<button type="button" class="${!C.owner ? 'is-on' : ''}" data-wcd-owner="all">All of Partner Care</button></div>` : '';
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n, warn]) => `<button type="button" class="wc-stat${k && C.quick === k ? ' is-on' : ''}${warn && n ? ' is-warn' : ''}" ${k ? `data-wcd-quick="${k}"` : 'data-wcd-noop'}><b>${n}</b><span>${esc(l)}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" aria-label="Cadence">
      <div class="wg-tools">${seg}<label class="wc-find">${f.ic('search')}<input type="search" id="wcd-q" placeholder="Find a partner" value="${esc(C.q)}" autocomplete="off" /></label>${C.quick ? `<button type="button" class="wcd-chip" data-wcd-quick="">${f.ic('x')}${esc(QUICK[C.quick])}</button>` : ''}<span class="wg-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wcd-print>${f.ic('print')}Print the three lists</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="cadence">${f.ic('sheet')}Google Sheets</button></div>
      <div class="wg-list">${list.slice(0, C.shown).map(rowHTML).join('') || `<div class="wg-empty"><b>${all.length ? 'Nothing matches' : 'Queue clear'}</b>${all.length ? 'Clear the filter above to see the rest.' : 'New partners come due after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div>`}
        ${list.length > C.shown ? `<div class="wg-group"><span>${list.length - C.shown} more</span><button type="button" data-wcd-more>Show ${Math.min(100, list.length - C.shown)} more</button></div>` : ''}</div>
      <div class="wg-foot"><span>${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'partner' : 'partners'}. Each step you press logs an action on the partner.${d.unreachable ? ` ${d.unreachable.toLocaleString('en-US')} more ${d.unreachable === 1 ? 'partner is' : 'partners are'} due with no phone, email or mailing address for the step they need.` : ''}</span></div>
    </section>`;
  registerSheet();
}

/* ------------------------------------------------------------------ the three lists */
const splitLists = (list) => {
  const sorted = list.filter(isDue).sort((a, b) => b.over - a.over);
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
    <div class="wg-dlg__foot"><small>Ordered by how long each partner has waited</small><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="cadence-lists">${f.ic('sheet')}Google Sheets</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wcd-doprint>${f.ic('print')}Print</button></span></div></div>`;
  document.body.appendChild(L);
}
function closeDialog() { const L = $('.wcd-printlayer'); if (L) L.remove(); }

function registerSheet() {
  if (!window.FavorSheets || C.sheetOn) return;
  C.sheetOn = true;
  const cols = [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'rule', label: 'Rule', type: 'text' }, { key: 'pattern', label: 'Giving', type: 'text' }, { key: 'steps', label: 'Steps', type: 'text' },
    { key: 'phone', label: 'Phone', type: 'text' }, { key: 'last', label: 'Last contact', type: 'date' }, { key: 'over', label: 'Days over', type: 'number' }, { key: 'holder', label: 'Held by', type: 'text' }];
  const rowOf = (r) => ({ partner: r.name, place: r.place, rule: r.ruleLabel, pattern: r.pattern, steps: needText(r), phone: r.phone || '', last: r.last ? r.last.date : null, over: r.over, holder: r.holderNames.join(', ') });
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
    if (done) { C.weekAdd++; const el = $(`.wcd-row[data-cid="${CSS.escape(r.cid)}"]`); if (el) el.classList.add('is-leaving'); }
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
  if (d.wcdQuick !== undefined) { C.quick = C.quick === d.wcdQuick ? '' : d.wcdQuick; C.shown = 100; view(); return; }
  if (b.hasAttribute('data-wcd-reload')) { C.data = null; C.error = ''; C.loading = false; C.started = false; view(); return; }
  if (b.hasAttribute('data-wcd-more')) { C.shown += 100; view(); return; }
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
  qT = setTimeout(() => { C.q = t.value; C.shown = 100; view(); const i = $('#wcd-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});
// An undo of a step (the toast's Undo is shared with Gifts to thank) puts the row back.
document.addEventListener('favor:thanked-undone', async () => { if (!C.started) return; await load(C.owner || 'all'); W().render(); });

if (window.WCTabs) {
  window.WCTabs.registerTab({ id: 'cadence', label: 'Cadence', roles: ['partner_care'], after: 'open', count: () => count(), dot: () => dot(), mount: () => view() });
}
window.WCCadence = { start, view, count, dot, C };
})();
