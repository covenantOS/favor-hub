/* Declines (Work Center tab): declined recurring payments and zeroed gifts, from the D1 copy of Blackbaud. Each row is one decline
   with the reason the processor gave, the partner's phone and email, and a button that logs the follow-up (call, text, email, card
   or note) as an Information Update action on the partner through POST /api/work/declines/log. This file then sends the batch with
   /api/work/batches/:id/run, the way Cadence does. Reads GET /api/work/declines (no Blackbaud calls). Nothing here charges a card or
   changes a schedule. Registers itself with window.WCTabs. Needs thank.js (window.FavorWG) and work.js (window.WC). */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const D = { data: null, loading: false, error: '', started: false, kind: '', q: '', closed: false, shown: 100, local: {}, sheetOn: false };
const KINDS = { hard: 'Hard rejects', soft: 'Soft rejects', other: 'Full amount or zeroed' };
const STATUS = { open: 'Still open', fixed: 'Card or bank fixed', ended: 'Partner ended the gift', unreachable: 'Cannot reach', no_action: 'Nothing to do' };
const HOW_LABEL = { call: 'Call', text: 'Text', email: 'Email', card: 'Card', note: 'Note' };
const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');

async function load() {
  D.loading = true; D.error = '';
  try { D.data = await W().api('/api/work/declines'); D.local = {}; D.shown = 100; } catch (e) { D.error = e.message; }
  D.loading = false;
}
async function start() {
  if (D.started) return;
  D.started = true;
  await load();
  W().refresh('declines');
}

const stateOf = (r) => (D.local[r.key] ? D.local[r.key] : r.state);
const rows = () => (D.data ? D.data.rows : []);
const open = () => rows().filter((r) => stateOf(r) === 'open');
const inKind = (r, k) => !k || (k === 'other' ? r.kind === 'full' || r.kind === 'zeroed' : r.kind === k);
const visible = () => rows().filter((r) => (D.closed ? stateOf(r) !== 'open' : stateOf(r) === 'open') && inKind(r, D.kind) && (!D.q || (r.name + ' ' + r.place + ' ' + r.reason).toLowerCase().includes(D.q.toLowerCase())));
const count = () => (D.data ? open().length : '');

function stateTag(r) {
  const s = stateOf(r);
  if (s === 'paid') return `<span class="wc-tag wc-tag--done">Paid since ${esc(F().fd(r.paidSince))}</span>`;
  if (s === 'ended') return `<span class="wc-tag">Schedule ${esc(String(r.scheduleStatus || 'ended').toLowerCase())}</span>`;
  if (s === 'done') return `<span class="wc-tag wc-tag--done">${esc(STATUS[r.status] || 'Closed')}</span>`;
  return '';
}

function rowHTML(r) {
  const f = F();
  const money = r.amount != null && r.amount > 0 ? f.money(r.amount) : '';
  const hard = r.kind === 'hard';
  const attempts = r.attempts > 1 ? `<span class="wg-sub">${r.attempts} declines in ${esc(String(D.data.window))} days</span>` : '';
  const last = r.last ? `Last: ${esc(HOW_LABEL[r.last.how] || r.last.how)}${r.last.outcome === 'left' ? ', left a message' : ''} ${esc(f.fd(r.last.at.slice(0, 10)))} by ${esc(r.last.by)}` : 'No follow-up yet';
  const call = r.phone ? `<a class="wg-icon" href="${tel(r.phone)}" title="Call ${esc(r.phone)}" aria-label="Call ${esc(r.name)}">${f.ic('phone')}</a>` : `<span class="wg-icon is-off" title="No phone to call">${f.ic('phone')}</span>`;
  const who = r.holders.length ? r.holders.join(', ') : '';
  return `<div class="wg-row wfn-row" data-key="${esc(r.key)}">
    <div class="wfn-who"><a class="wg-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wg-sub">${r.place ? esc(r.place) + ' · ' : ''}${esc(r.method)}${money ? ' · ' + esc(money) : ''}</span>${who ? `<span class="wg-sub">Held by ${esc(who)}</span>` : ''}</div>
    <div class="wfn-why"><span class="wc-tag${hard ? ' wc-tag--gift' : ''}">${esc(r.kindLabel)}</span>${stateTag(r)}<span class="wg-sub">${esc(r.reason || '')}</span>${attempts}</div>
    <div class="wfn-due"><b class="${r.age >= 7 && stateOf(r) === 'open' ? 'is-late' : ''}">${esc(f.fd(r.date))}</b><span class="wg-sub">${r.age === 0 ? 'Today' : r.age === 1 ? 'Yesterday' : r.age + ' days ago'}</span></div>
    <div class="wfn-last"><span class="wg-sub">${last}</span></div>
    <div class="wg-acts">${call}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wfn-log="${esc(r.key)}">${f.ic('check')}Log</button></div></div>`;
}

function view() {
  const f = F(); const el = $('#view');
  if (!el) return;
  if (!D.data && !D.error) { el.innerHTML = window.WCSkel(5); if (!D.loading) start(); return; }
  if (D.error && !D.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${esc(D.error)}<p><button type="button" class="h-btn h-btn--primary" data-wfn-reload>Try again</button></p></div></section>`; return; }
  const o = open(); const s = D.data.stats;
  const hard = o.filter((r) => r.kind === 'hard').length; const soft = o.filter((r) => r.kind === 'soft').length; const other = o.length - hard - soft;
  const stats = [['', 'Open', o.length], ['hard', KINDS.hard, hard, hard > 0], ['soft', KINDS.soft, soft], ['other', KINDS.other, other], ['', 'Closed this week', s.closedWeek]];
  const list = visible();
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n, warn]) => `<button type="button" class="wc-stat${k && D.kind === k ? ' is-on' : ''}${warn ? ' is-warn' : ''}" ${k ? `data-wfn-kind="${k}"` : 'data-wfn-noop'}><b>${n}</b><span>${esc(l)}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" aria-label="Declines">
      <div class="wg-tools"><div class="pp-seg" role="group" aria-label="Which list"><button type="button" class="${!D.closed ? 'is-on' : ''}" data-wfn-closed="0">Open</button><button type="button" class="${D.closed ? 'is-on' : ''}" data-wfn-closed="1">Closed or paid</button></div>
        <label class="wc-find">${f.ic('search')}<input type="search" id="wfn-q" placeholder="Find a partner" value="${esc(D.q)}" autocomplete="off" /></label>${D.kind ? `<button type="button" class="wcd-chip" data-wfn-kind="">${f.ic('x')}${esc(KINDS[D.kind])}</button>` : ''}<span class="wg-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="declines">${f.ic('sheet')}Google Sheets</button></div>
      <div class="wg-list">${list.slice(0, D.shown).map(rowHTML).join('') || `<div class="wg-empty"><b>${D.closed ? 'Nothing closed yet' : 'No open declines'}</b>${D.closed ? 'Declines you close, and declines that were paid since, show here.' : 'New declines appear after the Blackbaud copy refreshes at 5 AM and 5 PM.'}</div>`}
        ${list.length > D.shown ? `<div class="wg-group"><span>${list.length - D.shown} more</span><button type="button" data-wfn-more>Show ${Math.min(100, list.length - D.shown)} more</button></div>` : ''}</div>
      <div class="wg-foot"><span>${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'decline' : 'declines'} from the last ${esc(String(D.data.window))} days. Each follow-up you log adds an Information Update action on the partner. A decline clears itself once a later payment on the same schedule goes through.</span></div>
    </section>`;
  registerSheet();
}

function registerSheet() {
  if (!window.FavorSheets || D.sheetOn) return;
  D.sheetOn = true;
  const cols = [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'date', label: 'Date', type: 'date' },
    { key: 'method', label: 'Method', type: 'text' }, { key: 'amount', label: 'Schedule amount', type: 'currency' }, { key: 'attempts', label: 'Declines', type: 'number' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'email', label: 'Email', type: 'text' },
    { key: 'holder', label: 'Held by', type: 'text' }, { key: 'state', label: 'State', type: 'text' }];
  const rowOf = (r) => ({ partner: r.name, place: r.place, kind: r.kindLabel, reason: r.reason, date: r.date, method: r.method, amount: r.amount, attempts: r.attempts, phone: r.phone || '', email: r.email || '', holder: r.holders.join(', '), state: stateOf(r) === 'open' ? 'Open' : stateOf(r) === 'paid' ? 'Paid since' : stateOf(r) === 'ended' ? 'Schedule ended' : STATUS[r.status] || 'Closed' });
  window.FavorSheets.register('declines', () => window.FavorSheets.screen('Declines', [{ name: 'Declines', columns: cols, rows: visible().map(rowOf) }], { filters: (D.closed ? 'Closed or paid' : 'Open') + (D.kind ? ', ' + KINDS[D.kind] : ''), classes: ['partner'] }));
}

/* ------------------------------------------------------------------ logging a follow-up */
let popEl = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener('keydown', onKey, true); } }
function onKey(e) { if (e.key === 'Escape' && popEl) { e.stopPropagation(); closePop(); } }
function place(anchor) {
  const r = anchor.getBoundingClientRect(); const w = Math.min(360, innerWidth - 24);
  popEl.style.width = w + 'px';
  popEl.style.left = Math.max(12, Math.min(r.left - w + r.width, innerWidth - w - 12)) + 'px';
  const h = popEl.offsetHeight; let top = r.bottom + 8; if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
  popEl.style.top = top + 'px';
}
function logPop(anchor, r) {
  const f = F(); const e = esc;
  closePop();
  const st = { how: r.phone ? 'call' : r.email ? 'email' : 'note', reach: 'talked', status: 'open' };
  popEl = document.createElement('div');
  popEl.className = 'wg-pop'; popEl.setAttribute('role', 'dialog'); popEl.setAttribute('aria-label', `Log a follow-up for ${r.name}`);
  document.body.appendChild(popEl);
  const off = (h) => (h === 'call' || h === 'text' ? !r.phone : h === 'email' ? !r.email : h === 'card' ? !r.hasAddress : false);
  const draw = () => {
    const keep = $('#wfn-line', popEl) ? $('#wfn-line', popEl).value : '';
    const attempt = st.how === 'call' && st.reach === 'left';
    popEl.innerHTML = `<h4><span>${e(r.name)}<small>${e(r.kindLabel)} · ${e(f.fd(r.date))}${r.phone && (st.how === 'call' || st.how === 'text') ? ' · ' + e(r.phone) : ''}</small></span><button type="button" class="pp-iconbtn" data-wfn-x aria-label="Close">${f.ic('x')}</button></h4>
      <div class="pp-seg" role="group" aria-label="How">${['call', 'text', 'email', 'card', 'note'].map((h) => `<button type="button" class="${st.how === h ? 'is-on' : ''}" data-wfn-how="${h}" ${off(h) ? 'disabled title="Nothing on file for this"' : ''}>${HOW_LABEL[h]}</button>`).join('')}</div>
      ${st.how === 'call' ? `<div class="pp-seg" role="group" aria-label="Result"><button type="button" class="${st.reach === 'talked' ? 'is-on' : ''}" data-wfn-reach="talked">Talked</button><button type="button" class="${st.reach === 'left' ? 'is-on' : ''}" data-wfn-reach="left">Left a message</button></div>` : ''}
      <input type="text" id="wfn-line" maxlength="240" placeholder="${st.how === 'note' ? 'What happened' : attempt ? 'Anything to note' : 'What was said'}" value="${e(keep)}" autocomplete="off" />
      ${attempt ? '' : `<label class="wfn-status"><span>Where it stands</span><select id="wfn-status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>`}
      <div class="wg-pop__foot"><small>${attempt ? 'Logs the attempt. The decline stays open and a reminder comes tomorrow.' : ''}</small><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wfn-save>${attempt ? 'Save attempt' : 'Save'}</button></div>`;
    place(anchor);
  };
  draw();
  document.addEventListener('keydown', onKey, true);
  popEl.addEventListener('change', (ev) => { if (ev.target.id === 'wfn-status') st.status = ev.target.value; });
  popEl.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-wfn-x')) { closePop(); return; }
    if (t.dataset.wfnHow) { st.how = t.dataset.wfnHow; draw(); return; }
    if (t.dataset.wfnReach) { st.reach = t.dataset.wfnReach; draw(); return; }
    if (t.hasAttribute('data-wfn-save')) {
      const line = $('#wfn-line', popEl).value.trim();
      if (st.how === 'note' && !line) { $('#wfn-line', popEl).focus(); return; }
      const sel = $('#wfn-status', popEl); if (sel) st.status = sel.value;
      closePop();
      await save(r, st.how, st.reach, st.status, line);
    }
  });
  popEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'wfn-line') { ev.preventDefault(); const b = $('[data-wfn-save]', popEl); if (b) b.click(); } });
  setTimeout(() => { const i = $('#wfn-line', popEl); if (i) i.focus(); }, 30);
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

async function save(r, how, reach, status, line) {
  const f = F();
  const left = how === 'call' && reach === 'left';
  f.toast('Saving…');
  let out;
  try { out = await f.post('/api/work/declines/log', { giftId: r.giftId, cid: r.cid, how, outcome: how === 'call' ? reach : '', status, line, req: f.reqId() }); } catch (e) { f.toast(e.message, null, true); if (e.status === 409) { await load(); W().render(); } return; }
  if (!out.batch) { f.toast('That follow-up was already saved.', null, true); return; }
  const bid = out.batch.id;
  if (!left && status !== 'open') D.local[r.key] = 'done';
  r.last = { how, at: new Date().toISOString(), by: 'You', outcome: left ? 'left' : 'sent' };
  if (!left && status !== 'open') r.status = status;
  view();
  let held = '';
  try { if (out.batch.run_when !== 'tonight') held = await drive(bid); else held = 'tonight'; } catch (e) { f.toast(e.message + ' It is saved, and Recent can send it again.', [bid], true); return; }
  let bad = null;
  try {
    const recent = (await f.api('/api/work/recent')).batches || [];
    for (const b of recent) if (b.id === bid) { const x = (b.items || []).find((i) => i.state === 'failed'); if (x) bad = x.error || 'Blackbaud turned it down.'; }
  } catch (_) { /* saved; the toast still offers Undo */ }
  if (bad) { f.toast(`${bad} Nothing was lost. Recent has Try again.`, [bid], true); await load(); W().render(); return; }
  const what = left ? `Message logged for ${r.name}. Call again tomorrow` : `Follow-up logged for ${r.name}`;
  f.toast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', [bid]);
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#wc-root')) return;
  const b = t.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.wfnKind !== undefined) { D.kind = D.kind === d.wfnKind ? '' : d.wfnKind; D.shown = 100; view(); return; }
  if (d.wfnClosed !== undefined) { D.closed = d.wfnClosed === '1'; D.shown = 100; view(); return; }
  if (b.hasAttribute('data-wfn-reload')) { D.data = null; D.error = ''; D.loading = false; D.started = false; view(); return; }
  if (b.hasAttribute('data-wfn-more')) { D.shown += 100; view(); return; }
  if (d.wfnLog) { const r = rows().find((x) => x.key === d.wfnLog); if (r) { e.preventDefault(); logPop(b, r); } }
}, false);
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wfn-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { D.q = t.value; D.shown = 100; view(); const i = $('#wfn-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});
// An undo of a follow-up (the toast's Undo is shared with the other tabs) puts the row back.
document.addEventListener('favor:thanked-undone', async () => { if (!D.started) return; await load(); W().render(); });

if (window.WCTabs) {
  window.WCTabs.registerTab({ id: 'declines', label: 'Declines', roles: ['partner_care', 'support'], after: 'open', count: () => count(), mount: () => view(), warm: () => start() });
}
window.WCDeclines = { start, view, count, D };
})();
