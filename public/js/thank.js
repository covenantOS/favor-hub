/* Saying thank you for a gift: the Thank form (a small popover on a gift row or the partner drawer), thank many at once, and the
   undo toast. Shared by the Gifts to thank tab, the partner drawer and the call-prep brief.
   Writes through POST /api/work/gifts/thank, which saves ordinary batches (Recent and Undo apply), then sends each one with
   /api/work/batches/:id/run, the way the rest of the Work Center does. Public: window.FavorWG = { thank, pop, bulk, toast, helpers }. */
(() => {
'use strict';
if (window.FavorWG) return;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(TODAY.slice(0, 4)) ? ', ' + y : ''); };
const money = (a) => '$' + Number(a || 0).toLocaleString('en-US', { minimumFractionDigits: Math.round(a) === Number(a) ? 0 : 2, maximumFractionDigits: 2 });
const short = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 && v < 1e5 ? 1 : 0) + 'K' : money(Math.round(v)));
const dayn = (iso) => Math.round((Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z') - Date.parse(TODAY + 'T12:00:00Z')) / 86400000);
const AS = new URLSearchParams(location.search).get('as') || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reqId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const I = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', text: '<path d="M4 5h16v11H9l-5 4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', letter: '<path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>', meet: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', down: '<path d="m6 9 6 6 6-6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  brief: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6"/><path d="M10 16h6"/>', print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', sheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
};
const ic = (n, cls) => `<svg class="h-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const HOWS = [['call', 'Call', 'phone'], ['text', 'Text', 'text'], ['email', 'Email', 'mail'], ['letter', 'Letter', 'letter'], ['card', 'Card', 'card'], ['visit', 'Visit', 'meet']];
const WORD = { call: 'call', text: 'text', email: 'email', letter: 'letter', card: 'card', visit: 'visit' };

async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

/* ------------------------------------------------------------------ the toast, with Undo for one or two batches */
// The changes whose Undo was pressed, shared with the Work Center and the partner drawer: a change is undone once.
const UNDOING = (window.favorUndoing = window.favorUndoing || new Set());
let toastEl = null;
function toast(msg, bids, bad) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'wg-toast'; toastEl.className = 'pp-toast wg-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
  toastEl.innerHTML = `<span class="${bad ? 'is-bad' : ''}">${esc(msg)}</span>${bids && bids.length ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-undo="${esc(bids.join(','))}"${bids.every((x) => UNDOING.has(x)) ? ' disabled aria-busy="true"' : ''}>${ic('undo')}Undo</button>` : ''}`;
  toastEl.classList.add('is-on'); clearTimeout(toastEl._h);
  toastEl._h = setTimeout(() => toastEl.classList.remove('is-on'), bids && bids.length ? 9000 : msg.endsWith('…') ? 30000 : 4800);
}

/* ------------------------------------------------------------------ sending */
async function drive(bid) {
  let held = '';
  for (let i = 0; i < 60; i++) {
    const r = await post(`/api/work/batches/${bid}/run`);
    if (r.held === 'busy') { await sleep(1500); continue; }
    if (r.held) { held = r.held; break; }
    if (!r.left) break;
    await sleep(1200);
  }
  return held;
}

/**
 * Thank the gifts. items: [{ giftId, cid }]. Resolves to { ok, items (the ones saved), batches, outcome } or null when nothing was saved.
 * The page that asked hears 'favor:thanked' once the batches are saved and sent, so each screen updates its own rows.
 */
async function thank(items, o) {
  const label = o.label || 'Thank-you saved';
  toast('Saving…');
  let out;
  try {
    out = await post('/api/work/gifts/thank', { items: items.map((i) => ({ giftId: i.giftId, cid: i.cid })), how: o.how, outcome: o.outcome, line: o.line || '', followUp: !!o.followUp, owner: o.owner || undefined, req: reqId() });
  } catch (e) { toast(e.message, null, true); return null; }
  const batches = out.batches || [];
  if (!batches.length) { toast((out.skipped && out.skipped[0] && out.skipped[0].why) || 'Nothing was saved. Those gifts were already thanked.', null, true); document.dispatchEvent(new CustomEvent('favor:thanked', { detail: { items: [], gone: (out.skipped || []).map((s) => s.giftId) } })); return null; }
  const bids = batches.map((b) => b.id);
  const detail = { items: items.filter((i) => batches.some((b) => b.gifts.includes(String(i.giftId)))), outcome: out.outcome, how: o.how, batches: bids, left: !!out.left, followUp: !!o.followUp };
  // Show the result at once; the send follows. If Blackbaud turns something down, the list puts the gift back.
  document.dispatchEvent(new CustomEvent('favor:thanked', { detail }));
  let held = '';
  try { for (const b of batches) if (b.run_when !== 'tonight') held = (await drive(b.id)) || held; else held = 'tonight'; } catch (e) { toast(e.message + ' It is saved, and Recent can send it again.', bids, true); return Object.assign({ ok: false }, detail); }
  let bad = null;
  try {
    const recent = (await api('/api/work/recent')).batches || [];
    for (const b of recent) if (bids.includes(b.id)) { const f = (b.items || []).find((x) => x.state === 'failed'); if (f) bad = f.error || 'Blackbaud turned it down.'; }
  } catch (_) { /* the change is saved; the toast still offers Undo */ }
  if (bad) { toast(`${bad} Nothing was lost. Recent has Try again.`, bids, true); document.dispatchEvent(new CustomEvent('favor:thanked-failed', { detail })); return Object.assign({ ok: false }, detail); }
  toast(held === 'tonight' ? `${label}. It goes to Blackbaud tonight.` : held ? `${label}. Blackbaud is slow, so the rest goes when it answers.` : label + '.', bids);
  return Object.assign({ ok: true }, detail);
}

// After an undo: a change that is undone, or whose undo is still being sent, keeps its button off. When some rows did not go back, Undo opens again.
async function settleUndo(ids) {
  try {
    const recent = (await api('/api/work/recent')).batches || [];
    ids.forEach((bid) => { const b = recent.find((x) => x.id === bid); if (!b || (!b.undone && !b.undoing)) UNDOING.delete(bid); });
  } catch (_) { /* the button stays off until the page reloads */ }
}
async function undo(csv) {
  const ids = csv.split(',').filter(Boolean).filter((bid) => !UNDOING.has(bid)); // a change is undone once
  if (!ids.length) return;
  ids.forEach((bid) => UNDOING.add(bid));
  toast('Undoing…');
  let at = '';
  try {
    for (const bid of ids) {
      at = bid;
      try {
        const r = await post(`/api/work/batches/${bid}/undo`);
        if (r.batch && r.batch.id) await drive(r.batch.id);
      } catch (e) {
        // Already undone, or being undone: it is on its way back and the button stays off.
        if (!(e.data && e.data.error === 'already_undone')) throw e;
      }
    }
    await settleUndo(ids);
    toast('Undone.');
    document.dispatchEvent(new CustomEvent('favor:thanked-undone', { detail: { batches: ids } }));
  } catch (e) {
    ids.slice(ids.indexOf(at)).forEach((bid) => UNDOING.delete(bid)); // the one that failed and the ones not tried
    toast(e.message, null, true);
  }
}
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-wg-undo]'); if (b && !b.disabled) { e.preventDefault(); b.disabled = true; undo(b.dataset.wgUndo); } });

/* ------------------------------------------------------------------ popover */
let popEl = null;
function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener('keydown', onKey, true); } }
function onKey(e) { if (e.key === 'Escape' && popEl) { e.stopPropagation(); closePop(); } }
function place(anchor) {
  if (!popEl) return;
  const r = anchor.getBoundingClientRect(); const w = Math.min(360, innerWidth - 24);
  popEl.style.width = w + 'px';
  popEl.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + 'px';
  const h = popEl.offsetHeight; let top = r.bottom + 8; if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
  popEl.style.top = top + 'px';
}

/**
 * The Thank form for one gift. g: { giftId, cid, name, amount, date, fund, phone, left, tasks }.
 * o.owner is the director whose list it is (Support thanking for someone); o.done runs after the thank-you is saved.
 */
function pop(anchor, g, o = {}) {
  closePop();
  const st = { how: 'call', reach: 'talked' };
  popEl = document.createElement('div');
  popEl.className = 'wg-pop'; popEl.setAttribute('role', 'dialog'); popEl.setAttribute('aria-label', 'Thank ' + g.name);
  document.body.appendChild(popEl);
  const draw = () => {
    const keepLine = $('#wg-line', popEl) ? $('#wg-line', popEl).value : '';
    const keepFu = $('#wg-fu', popEl) ? $('#wg-fu', popEl).checked : false;
    const attempt = st.how === 'call' && st.reach === 'left';
    popEl.innerHTML = `<h4><span>Thank ${esc(g.name)}<small>${money(g.amount)} on ${fd(g.date)} · ${esc(g.fund || '')}</small></span><button type="button" class="pp-iconbtn" data-wg-x aria-label="Close">${ic('x')}</button></h4>
      <div class="pp-seg wg-how" role="group" aria-label="How">${HOWS.filter(([k]) => g.team !== 'pc' || !['text', 'visit'].includes(k)).map(([k, l, i]) => `<button type="button" class="${st.how === k ? 'is-on' : ''}" data-wg-how="${k}">${ic(i)}${l}</button>`).join('')}</div>
      ${st.how === 'call' ? `<div class="pp-seg" role="group" aria-label="Result"><button type="button" class="${st.reach === 'talked' ? 'is-on' : ''}" data-wg-reach="talked">Talked</button><button type="button" class="${st.reach === 'left' ? 'is-on' : ''}" data-wg-reach="left">Left a message</button></div>` : ''}
      ${g.left ? `<p class="wg-note">You left a message ${esc(fd(g.left.date))}${g.left.by ? ' (' + esc(g.left.by) + ')' : ''}. The gift stays on the list until it is thanked.</p>` : ''}
      <input type="text" id="wg-line" maxlength="200" placeholder="${attempt ? 'Anything to note' : 'What was said'}" value="${esc(keepLine)}" autocomplete="off" />
      <label class="wg-check"><input type="checkbox" id="wg-fu" ${keepFu ? 'checked' : ''} /> Follow up in 2 weeks</label>
      ${g.tasks ? '<p class="wg-note">An open thank-you task for this gift closes with it.</p>' : ''}
      <div class="wg-pop__foot"><small>${attempt ? 'Logs the attempt. The gift stays here and a reminder comes tomorrow.' : g.phone ? esc(g.phone) : 'No phone on file'}</small><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wg-save>${attempt ? 'Save attempt' : 'Save thank-you'}</button></div>`;
    place(anchor);
  };
  draw();
  document.addEventListener('keydown', onKey, true);
  popEl.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-wg-x')) { closePop(); return; }
    if (t.dataset.wgHow) { st.how = t.dataset.wgHow; if (st.how !== 'call') st.reach = 'talked'; draw(); return; }
    if (t.dataset.wgReach) { st.reach = t.dataset.wgReach; draw(); return; }
    if (t.hasAttribute('data-wg-save')) {
      const line = $('#wg-line', popEl).value.trim(); const followUp = $('#wg-fu', popEl).checked;
      const left = st.how === 'call' && st.reach === 'left';
      closePop();
      const label = left ? `Logged a message for ${g.name}. A reminder comes tomorrow` : `Thanked ${g.name} by ${WORD[st.how]}`;
      const res = await thank([{ giftId: g.giftId, cid: g.cid }], { how: st.how, outcome: left ? 'left' : 'talked', line, followUp, owner: o.owner, label });
      if (res && o.done) o.done(res);
    }
  });
  setTimeout(() => { const i = $('#wg-line', popEl); if (i) i.focus(); }, 30);
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!popEl) { document.removeEventListener('click', off); return; } const path = ev.composedPath ? ev.composedPath() : []; if (!path.includes(popEl) && !path.includes(anchor)) { closePop(); document.removeEventListener('click', off); } }), 0);
}
addEventListener('resize', () => { if (popEl) closePop(); });

/* ------------------------------------------------------------------ thank many */
function bulk(gifts, how, o = {}) {
  closePop();
  const total = gifts.reduce((n, g) => n + g.amount, 0);
  const L = document.createElement('div');
  L.className = 'wg-layer';
  L.innerHTML = `<div class="wg-scrim" data-wg-close></div><div class="wg-dlg" role="dialog" aria-modal="true" aria-label="Thank ${gifts.length} partners">
    <div class="wg-dlg__head"><div><h2>Thank ${gifts.length} ${gifts.length === 1 ? 'partner' : 'partners'} by ${WORD[how]}</h2><p>${money(total)} in gifts. Each partner gets one ${WORD[how]} record with the Thanked tag, and any open thank-you task for that gift closes.</p></div><button type="button" class="pp-iconbtn" data-wg-close aria-label="Close">${ic('x')}</button></div>
    <div class="wg-dlg__body"><ul class="wg-bulklist">${gifts.slice(0, 8).map((g) => `<li><b>${esc(g.name)}</b><span>${money(g.amount)} · ${fd(g.date)}</span></li>`).join('')}${gifts.length > 8 ? `<li class="is-more">and ${gifts.length - 8} more</li>` : ''}</ul>
      <label class="wg-lab">One line for every record (optional)<input type="text" id="wg-bline" maxlength="200" placeholder="For example: Sent the September thank-you letter" /></label>
      <label class="wg-check"><input type="checkbox" id="wg-bfu" /> Follow up in 2 weeks</label></div>
    <div class="wg-dlg__foot"><small>Uses about ${gifts.length * 2} Blackbaud calls. Undo stays for 24 hours.</small><span><button type="button" class="h-btn h-btn--ghost" data-wg-close>Cancel</button><button type="button" class="h-btn h-btn--primary" data-wg-go>${ic('check')}Thank ${gifts.length}</button></span></div></div>`;
  document.body.appendChild(L);
  const close = () => L.remove();
  L.addEventListener('click', async (e) => {
    if (e.target.closest('[data-wg-close]')) { close(); return; }
    if (e.target.closest('[data-wg-go]')) {
      const line = $('#wg-bline', L).value.trim(); const followUp = $('#wg-bfu', L).checked;
      close();
      const res = await thank(gifts.map((g) => ({ giftId: g.giftId, cid: g.cid })), { how, outcome: how === 'call' || how === 'visit' || how === 'text' ? 'talked' : 'sent', line, followUp, owner: o.owner, label: `Thanked ${gifts.length} ${gifts.length === 1 ? 'partner' : 'partners'} by ${WORD[how]}` });
      if (res && o.done) o.done(res);
    }
  });
  const onEsc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc, true); } };
  document.addEventListener('keydown', onEsc, true);
  setTimeout(() => { const i = $('#wg-bline', L); if (i) i.focus(); }, 40);
}

window.FavorWG = { api, post, esc, ic, I, fd, money, short, dayn, TODAY, thank, pop, bulk, toast, closePop, reqId, HOWS };
})();
