/* Gift images (Work Center tab for the admin desk and the Support Team): the gifts whose check or letter image belongs in Blackbaud (a
   gift of $5,000 or more, a gift from a giving fund or foundation, a designated gift) and that are not known to have one. Check asks
   Blackbaud whether a gift has an attachment (1 call each, POST /api/work/giftimages/check). Attach puts an image on the gift
   (POST /api/work/giftimages/attach, a form post). Reads GET /api/work/giftimages (no Blackbaud calls).
   Registers itself with window.WCTabs. Needs thank.js (window.FavorWG) and work.js (window.WC). */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = { data: null, loading: false, error: '', started: false, why: '', q: '', designated: false, shown: 100, busy: new Set(), sheetOn: false };
const WHYS = { big: '$5,000 or more', giving_fund: 'Giving funds and foundations', designated: 'Designated funds' };

async function load() {
  I.loading = true; I.error = '';
  try { I.data = await W().api('/api/work/giftimages'); I.shown = 100; } catch (e) { I.error = e.message; }
  I.loading = false;
}
async function start() {
  if (I.started) return;
  I.started = true;
  await load();
  W().render();
}
const rows = () => (I.data ? I.data.rows : []);
const visible = () => rows().filter((r) => (I.why ? r.why === I.why : I.designated || r.why !== 'designated') && (!I.q || (r.name + ' ' + r.fund + ' ' + r.check).toLowerCase().includes(I.q.toLowerCase())));
const count = () => (I.data ? rows().filter((r) => r.why !== 'designated').length : '');

function rowHTML(r) {
  const f = F();
  const busy = I.busy.has(r.giftId);
  const state = r.state === 'none' ? '<span class="wc-tag wc-tag--gift">No attachment</span>' : '<span class="wc-tag">Not checked</span>';
  return `<div class="wg-row wgi-row" data-id="${esc(r.giftId)}">
    <div class="wg-amt wg-c-amt">${f.money(r.amount)}<small class="${r.age > 14 ? 'is-late' : ''}">${esc(f.fd(r.date))} · ${r.age === 0 ? 'Today' : r.age + (r.age === 1 ? ' day' : ' days')}</small></div>
    <div class="wgi-who"><a class="wg-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wg-sub">${esc(r.method)}${r.check ? ' · check ' + esc(r.check) : ''}</span></div>
    <div class="wgi-why"><span class="wc-tag">${esc(r.whyLabel)}</span>${state}<span class="wg-sub">${esc(r.fund)}</span></div>
    <div class="wg-acts"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wgi-check="${esc(r.giftId)}" ${busy ? 'disabled' : ''}>${f.ic('search')}Check</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wgi-attach="${esc(r.giftId)}" ${busy ? 'disabled' : ''}>${f.ic('plus')}Attach</button></div></div>`;
}

function view() {
  const f = F(); const el = $('#view');
  if (!el) return;
  if (!I.data && !I.error) { el.innerHTML = window.WCSkel(5); if (!I.loading) start(); return; }
  if (I.error && !I.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${esc(I.error)}<p><button type="button" class="h-btn h-btn--primary" data-wgi-reload>Try again</button></p></div></section>`; return; }
  const s = I.data.stats; const list = visible(); const lane = I.data.lane;
  const stats = [['', 'To attach', s.need], ['', 'Not checked', s.unchecked], ['big', WHYS.big, s.big], ['giving_fund', WHYS.giving_fund, s.giving], ['designated', WHYS.designated, s.designated]];
  const unchecked = list.filter((r) => r.state === 'unknown').slice(0, I.data.checkMax);
  el.innerHTML = `
    <div class="h-card wc-band wg-band" style="--n:5">${stats.map(([k, l, n]) => `<button type="button" class="wc-stat${k && I.why === k ? ' is-on' : ''}" ${k ? `data-wgi-why="${k}"` : 'data-wgi-noop'}><b>${n}</b><span>${esc(l)}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" aria-label="Gift images">
      <div class="wg-tools"><label class="wc-find">${f.ic('search')}<input type="search" id="wgi-q" placeholder="Find a partner or check number" value="${esc(I.q)}" autocomplete="off" /></label>
        <label class="wgi-toggle"><input type="checkbox" data-wgi-designated ${I.designated ? 'checked' : ''} />Include designated funds</label>${I.why ? `<button type="button" class="wcd-chip" data-wgi-why="">${f.ic('x')}${esc(WHYS[I.why])}</button>` : ''}<span class="wg-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="giftimages">${f.ic('sheet')}Google Sheets</button>
        <button type="button" class="h-btn h-btn--primary h-btn--sm" data-wgi-checkmany ${unchecked.length && (!lane || lane.left >= unchecked.length) ? '' : 'disabled'}>${f.ic('search')}Check ${unchecked.length} in Blackbaud</button></div>
      <div class="wg-list">${list.slice(0, I.shown).map(rowHTML).join('') || `<div class="wg-empty"><b>Every image is in</b>Gifts that need a check or letter image show here until one is attached.</div>`}
        ${list.length > I.shown ? `<div class="wg-group"><span>${list.length - I.shown} more</span><button type="button" data-wgi-more>Show ${Math.min(100, list.length - I.shown)} more</button></div>` : ''}</div>
      <div class="wg-foot"><span>${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'gift' : 'gifts'} from the last ${esc(String(I.data.window))} days. The Blackbaud copy holds no attachments, so Check asks Blackbaud (1 call per gift)${lane ? `; ${lane.left} calls are left in today's allowance for this` : ''}. Attach costs 3 calls.</span></div>
    </section>`;
  registerSheet();
}

function registerSheet() {
  if (!window.FavorSheets || I.sheetOn) return;
  I.sheetOn = true;
  const cols = [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'amount', label: 'Amount', type: 'currency' }, { key: 'date', label: 'Gift date', type: 'date' }, { key: 'method', label: 'Method', type: 'text' }, { key: 'check', label: 'Check number', type: 'text' },
    { key: 'fund', label: 'Fund', type: 'text' }, { key: 'why', label: 'Why an image', type: 'text' }, { key: 'state', label: 'State', type: 'text' }];
  window.FavorSheets.register('giftimages', () => window.FavorSheets.screen('Gift images', [{ name: 'Gift images', columns: cols, rows: visible().map((r) => ({ partner: r.name, amount: r.amount, date: r.date, method: r.method, check: r.check, fund: r.fund, why: r.whyLabel, state: r.state === 'none' ? 'No attachment' : 'Not checked' })) }], { classes: ['partner'] }));
}

async function check(ids) {
  const f = F();
  ids.forEach((id) => I.busy.add(id)); view();
  f.toast(ids.length > 1 ? `Checking ${ids.length} gifts…` : 'Checking…');
  try {
    const out = await f.post('/api/work/giftimages/check', { giftIds: ids });
    const bad = out.failed && out.failed.length;
    f.toast(`${out.has} already ${out.has === 1 ? 'has' : 'have'} an attachment, ${out.none} ${out.none === 1 ? 'has' : 'have'} none${bad ? `, ${bad} could not be read` : ''}.`, null, !!bad && !out.checked);
  } catch (e) { f.toast(e.message, null, true); }
  ids.forEach((id) => I.busy.delete(id));
  await load(); W().render();
}

function attachPick(id) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,.pdf,.jpg,.jpeg,.png';
  inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    const f = F(); const w = W();
    I.busy.add(id); view();
    f.toast('Attaching ' + file.name + '…');
    const fd = new FormData(); fd.append('giftId', id); fd.append('kind', 'check'); fd.append('file', file);
    try {
      const res = await fetch('/api/work/giftimages/attach' + (w.AS ? '?as=' + encodeURIComponent(w.AS) : ''), { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.message || 'The image did not attach.');
      f.toast('Attached ' + file.name + '.');
    } catch (e) { f.toast(e.message, null, true); }
    I.busy.delete(id);
    await load(); W().render();
  });
  inp.click();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#wc-root')) return;
  const cb = t.closest('[data-wgi-designated]');
  if (cb) { I.designated = cb.checked; I.shown = 100; view(); return; }
  const b = t.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.wgiWhy !== undefined) { I.why = I.why === d.wgiWhy ? '' : d.wgiWhy; I.shown = 100; view(); return; }
  if (b.hasAttribute('data-wgi-reload')) { I.data = null; I.error = ''; I.loading = false; I.started = false; view(); return; }
  if (b.hasAttribute('data-wgi-more')) { I.shown += 100; view(); return; }
  if (b.hasAttribute('data-wgi-checkmany')) { const ids = visible().filter((r) => r.state === 'unknown').slice(0, I.data.checkMax).map((r) => r.giftId); if (ids.length) check(ids); return; }
  if (d.wgiCheck) { check([d.wgiCheck]); return; }
  if (d.wgiAttach) { attachPick(d.wgiAttach); }
}, false);
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wgi-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { I.q = t.value; I.shown = 100; view(); const i = $('#wgi-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});

if (window.WCTabs) {
  window.WCTabs.registerTab({ id: 'giftimages', label: 'Gift images', roles: ['support'], after: 'open', count: () => count(), mount: () => view(), warm: () => start() });
}
window.WCGiftImages = { start, view, count, I };
})();
