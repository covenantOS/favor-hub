/* Communication picture: every touch with one partner in the last 12 months and the thank-you count against the yearly target.
   Used on the partner panel (partner.js) and under a Cadence row (work-cadence.js). Reads GET /api/work/partners/:id/comm.
   The No texts flag posts to /api/work/cadence/notext (Partner Care and admins). Exposes window.FavorComm. */
(() => {
'use strict';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso, today) => {
  if (window.FavorUI && window.FavorUI.day) { try { return window.FavorUI.day(iso); } catch (_) { /* fall through */ } }
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return MON[m - 1] + ' ' + d + (String(y) !== String(today).slice(0, 4) ? ', ' + y : '');
};
const PLURAL = { call: ['call', 'calls'], text: ['text', 'texts'], email: ['email', 'emails'], card: ['card or mailing', 'cards or mailings'], meeting: ['meeting', 'meetings'], letter: ['HQ letter', 'HQ letters'], receipt: ['receipt', 'receipts'] };
const cache = new Map();
const open = new Set();

async function api(path, opts) {
  const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-hub-request': '1' } }, opts || {}));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) { const e = new Error(j.message || 'That did not load.'); e.status = r.status; throw e; }
  return j;
}

function html(c, o) {
  const t = c.tally;
  const segs = Array.from({ length: t.target }, (_, i) => `<span class="${i < t.count ? 'on' : ''}"></span>`).join('');
  const kinds = t.byKind.map((k) => `${k.n} ${PLURAL[k.kind][k.n === 1 ? 0 : 1]}`).join(' · ');
  const shown = o.all ? c.touches : c.touches.slice(0, 8);
  const flag = c.noText
    ? `<button type="button" class="cm-flag is-on" data-cm-flag="off" title="Clear the flag">No texts: ${esc(c.noText.reason)} · Clear</button>`
    : o.canFlag ? '<button type="button" class="cm-flag" data-cm-flag="on">Mark no texts</button>' : '';
  const rows = shown.map((x) => `<li class="cm-row${x.left ? ' is-left' : ''}"><span class="cm-d">${esc(day(x.date, c.today))}</span><span class="cm-k">${esc(x.kind === 'text' ? 'Text' : x.kind === 'call' ? 'Call' : x.kind === 'email' ? 'Email' : x.kind === 'card' ? 'Card or mailing' : x.kind === 'meeting' ? 'Meeting' : x.kind === 'letter' ? 'HQ letter' : 'Receipt')}${x.left ? ' · left a message' : ''}</span><span class="cm-w">${esc(x.what)}</span><span class="cm-s">${x.thanks ? '<em>Thank-you</em> · ' : ''}${esc(x.source)}</span></li>`).join('');
  return `<div class="cm" data-cm="${esc(c.cid)}">
    <div class="cm-head"><div class="cm-count">${t.count > t.target ? `<b>${t.count}</b><span>thank-yous in ${esc(t.year)}, past the target of ${t.target}</span>` : `<b>${t.count} of ${t.target}</b><span>thank-yous in ${esc(t.year)}</span>`}</div>${flag}</div>
    <div class="cm-tally" role="img" aria-label="${t.count} thank-yous, target ${t.target}">${segs}</div>
    <div class="cm-sub">${esc([kinds, t.last12 + ' in the last 12 months'].filter(Boolean).join(' · '))}</div>
    <ul class="cm-list">${rows || '<li class="cm-empty">No contact in the last 12 months.</li>'}</ul>
    ${c.touches.length > 8 && !o.all ? `<button type="button" class="cm-more" data-cm-more>Show ${c.touches.length - 8} older</button>` : ''}
    <div class="cm-foot">Not listed: monthly appeal mailings and GoHighLevel emails</div></div>`;
}

function paint(el, cid, o) {
  const c = cache.get(cid);
  if (!c) return;
  el.innerHTML = html(c, Object.assign({ all: open.has(cid) }, o));
  el.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ev.stopPropagation();
    if (b.hasAttribute('data-cm-more')) { open.add(cid); paint(el, cid, o); return; }
    if (b.dataset.cmFlag) {
      const on = b.dataset.cmFlag === 'on';
      b.disabled = true;
      try {
        await api('/api/work/cadence/notext', { method: 'POST', body: JSON.stringify({ cid, on, reason: 'Replied STOP' }) });
        c.noText = on ? { reason: 'Replied STOP', by: '', at: '' } : null;
        paint(el, cid, o);
        if (o.onFlag) o.onFlag(cid, on ? 'Replied STOP' : '');
      } catch (e) { b.disabled = false; b.textContent = e.message; }
    }
  };
}

/** Draw the picture into el, from the copy kept for this partner at once when there is one, then fresh. */
async function mount(el, cid, o) {
  o = o || {};
  if (cache.has(cid)) paint(el, cid, o);
  else el.innerHTML = '<div class="cm cm--load" aria-busy="true"><div class="cm-sk"></div><div class="cm-sk"></div><div class="cm-sk"></div></div>';
  try {
    const d = await api('/api/work/partners/' + encodeURIComponent(cid) + '/comm');
    cache.set(cid, d.comm);
    if (el.isConnected) paint(el, cid, o);
  } catch (e) {
    if (!cache.has(cid) && el.isConnected) el.innerHTML = `<div class="cm"><div class="cm-empty">${esc(e.message)}</div></div>`;
  }
}
window.FavorComm = { mount, html, cache };
})();
