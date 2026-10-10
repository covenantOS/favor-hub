/* The call-prep brief: one screen before a call or a visit. Opens from a gift row, a portfolio row, the reminders bell and the
   partner drawer; any button with data-prep="<partner id>" opens it. Reads GET /api/work/prep/:id (the D1 copy of Blackbaud plus the
   partner's notes) and sets the call in Partner Care's order: Thank, Pray, Report, Ask, Thank, Pray. Needs thank.js (loaded first).
   Public: window.FavorPrep = { open, close }. */
(() => {
'use strict';
if (window.FavorPrep) return;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
let layer = null;

const tel = (n) => 'tel:' + String(n).replace(/[^\d+]/g, '');
const sms = (n) => 'sms:' + String(n).replace(/[^\d+]/g, '');

function close() {
  if (!layer) return;
  layer.remove(); layer = null;
  document.documentElement.classList.remove('wg-locked');
  document.removeEventListener('keydown', onKey, true);
}
function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

function stepHTML(s) {
  const e = F().esc;
  return `<li><div><b>${e(s.title)}</b><p>${s.pre ? e(s.pre) : ''}${s.strong ? `<em>${e(s.strong)}</em>` : ''}${s.post ? e(s.post) : ''}</p></div></li>`;
}

function briefHTML(b, owedRows) {
  const f = F(); const e = f.esc;
  const gifts = b.giving;
  const house = b.household && b.household.length ? b.household.map((h) => `${e(h.relation || 'Household')} ${e(h.name)}`).join(', ') : 'No household on file';
  const dnc = b.flags.includes('Do not call');
  const call = b.call && !dnc ? `<a class="pp-tap" href="${tel(b.call.number)}">${f.ic('phone')}Call <small>${e(b.call.number)}</small></a>` : `<span class="pp-tap is-off">${f.ic('phone')}${dnc ? 'Do not call' : 'No phone to call'}</span>`;
  const text = b.text && !dnc ? `<a class="pp-tap" href="${sms(b.text.number)}">${f.ic('text')}Text</a>` : '';
  const owed = owedRows && owedRows.length ? owedRows.slice().sort((a, c) => (a.date < c.date ? -1 : 1))[0] : null;
  const m = (b.monthly || []).find((x) => /active/i.test(x.status)) || (b.monthly || [])[0];
  const monthly = m ? `${f.money(m.amount)} a month${m.status && !/active/i.test(m.status) ? ', ' + e(m.status.toLowerCase()) : ''}${m.since ? ', since ' + e(f.fd(m.since, true)) : ''}` : 'None';
  const iw = b.iwave && b.iwave.overall != null ? `${b.iwave.overall} of 10${b.iwave.band ? ' · ' + e(b.iwave.band) : ''}` : 'Not rated';
  const dne = b.flags.includes('Do not email');
  return `
    <div class="wg-dlg__head"><div><span class="wg-kick">Call prep · ${e(b.kind)} · ${e(b.lookup)}${b.since ? ' · Partner since ' + e(b.since) : ''}</span><h2>${e(b.name)}</h2><p>${e([b.place || 'No city on file', house].join(' · '))}</p></div><button type="button" class="pp-iconbtn" data-wg-pclose aria-label="Close (Esc)">${f.ic('x')}</button></div>
    <div class="wg-brief__acts">${call}${text}<button type="button" class="h-btn h-btn--primary h-btn--sm" data-wg-logcall>${f.ic('plus')}Log this call</button>${owed ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-pthank>${f.ic('check')}Thank${f.ic('down', 'wg-caret')}</button>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-print>${f.ic('print')}Print</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wg-partner>${f.ic('expand')}Partner</button></div>
    <div class="wg-dlg__body"><div class="wg-brief__grid">
      <div class="wg-bsec"><h3>The call</h3><ol class="wg-steps">${b.steps.map(stepHTML).join('')}</ol>${b.notesLive ? '' : '<p class="wg-note">Notes on the partner record did not load, so the prayer line reads the logged contacts only.</p>'}</div>
      <div>
        ${b.flags.length ? `<div class="wg-bsec"><div class="wg-alert">${b.flags.map((x) => `<span class="wc-tag wc-tag--warn">${e(x)}</span>`).join('')}</div></div>` : ''}
        <div class="wg-bsec"><h3>Giving</h3><div class="wg-facts"><div><b>${f.short(gifts.lifetime)}</b><span>Lifetime, ${gifts.count.toLocaleString('en-US')} ${gifts.count === 1 ? 'gift' : 'gifts'}</span></div><div><b>${f.short(gifts.last12)}</b><span>12 months${gifts.prior12 ? ', ' + f.short(gifts.prior12) + ' the year before' : ''}</span></div><div><b>${gifts.largest ? f.short(gifts.largest.amount) : '-'}</b><span>Largest${gifts.largest ? ', ' + e(f.fd(gifts.largest.date, true)) : ''}</span></div></div></div>
        <div class="wg-bsec"><dl class="wg-kv"><dt>Gives to</dt><dd>${e(b.gives ? b.gives.fund : gifts.last && gifts.last.fund ? gifts.last.fund : 'No designation on record')}</dd><dt>Monthly</dt><dd>${monthly}</dd><dt>iWave</dt><dd>${iw}</dd><dt>Email</dt><dd class="${dne ? 'is-bad' : ''}">${dne ? 'Do not email' : e(b.email || 'None on file')}</dd></dl></div>
        <div class="wg-bsec"><h3>Last contacts</h3><ul class="wg-said">${b.contacts.map((c) => `<li><b>${e(f.fd(c.date, true))} · ${e(c.category)}</b> ${e(c.text || c.summary || '')}${c.by ? `<small>${e(c.by)}</small>` : ''}</li>`).join('') || '<li>No contact on file.</li>'}</ul></div>
        <div class="wg-bsec"><h3>Open tasks</h3><ul class="wg-said">${b.open.map((t) => `<li><b>${e(t.what)}</b> · ${t.due && f.dayn(t.due) < 0 ? `<span class="is-late">${-f.dayn(t.due)} days late</span>` : 'due ' + e(f.fd(t.due, true))}</li>`).join('') || '<li>None.</li>'}</ul></div>
      </div></div></div>`;
}

async function open(cid, o = {}) {
  const f = F();
  if (!f || !cid) return;
  close(); f.closePop();
  layer = document.createElement('div');
  layer.className = 'wg-layer wg-prt';
  layer.innerHTML = '<div class="wg-scrim" data-wg-pclose></div><div class="wg-dlg wg-dlg--wide wg-brief" role="dialog" aria-modal="true" aria-label="Call prep"><div class="wg-skel"><i style="width:30%"></i><i style="height:34px;width:60%"></i><i style="height:200px"></i></div></div>';
  document.body.appendChild(layer);
  document.documentElement.classList.add('wg-locked');
  document.addEventListener('keydown', onKey, true);
  const box = $('.wg-dlg', layer);
  let d;
  try { d = await f.api('/api/work/prep/' + encodeURIComponent(cid)); } catch (e) {
    box.innerHTML = `<div class="wg-dlg__head"><div><h2>${e.status === 404 ? 'No partner found' : 'The brief did not load'}</h2><p>${f.esc(e.message)}</p></div><button type="button" class="pp-iconbtn" data-wg-pclose aria-label="Close">${f.ic('x')}</button></div>`;
    return;
  }
  if (!layer) return;
  const b = d.brief;
  box.innerHTML = briefHTML(b, d.owedRows || []);
  const owed = (d.owedRows || []).slice().sort((a, c) => (a.date < c.date ? -1 : 1))[0];
  layer.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.hasAttribute('data-wg-pclose')) { close(); return; }
    if (t.hasAttribute('data-wg-print')) { document.documentElement.classList.add('wg-printing'); setTimeout(() => { window.print(); setTimeout(() => document.documentElement.classList.remove('wg-printing'), 400); }, 50); return; }
    if (t.hasAttribute('data-wg-partner')) { close(); if (window.FavorPartner) window.FavorPartner.open(cid); else location.href = '/work/partner/' + encodeURIComponent(cid); return; }
    if (t.hasAttribute('data-wg-logcall')) { close(); if (window.FavorPartner) (window.FavorPartner.openCompose || window.FavorPartner.open)(cid, 'contact'); return; }
    if (t.hasAttribute('data-wg-pthank') && owed) {
      f.pop(t, { giftId: owed.giftId, cid: owed.cid, name: b.name, amount: owed.amount, date: owed.date, fund: owed.fund, phone: b.call ? b.call.number : null }, { done: () => { box.innerHTML = briefHTML(Object.assign({}, b, { owed: [], steps: b.steps.map((s, i) => (i === 0 ? { n: 1, title: 'Thank', post: 'Thanked just now.' } : s)) }), []); } });
    }
  });
  void o;
}

// Any button marked data-prep="<partner id>" opens the brief: gift rows, portfolio rows, the reminders bell and the drawer.
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-prep]');
  if (!t || !/^\d{1,12}$/.test(t.dataset.prep || '')) return;
  e.preventDefault(); e.stopPropagation();
  open(t.dataset.prep);
}, true);

window.FavorPrep = { open, close };
})();
