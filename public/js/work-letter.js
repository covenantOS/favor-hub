/* The letter composer (Work Center, round 3 Group C). Opens from Gifts to thank for Support and admins, one gift or many.
   Reads the merged pages from POST /api/work/gifts/letter (the wording lives in functions/_lib/work/letters.ts), shows them as paper,
   and on Print PDF and log or Copy for email logs the thank-you through FavorWG.thank (a Mailing action for a printed letter, an
   Email action for an emailed one, each with the Thanked tag). Also shared with the HQTY desk: WCLetter.paper(doc) draws a page.
   Public: window.WCLetter = { open, paper, text, blobOpen }. */
(() => {
'use strict';
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const e = (s) => F().esc(s);
let L = null;

/** One merged letter as a sheet of paper. */
function paper(d) {
  return `<article class="hq-paper" aria-label="Letter preview">
    <div class="hq-paper__brand">Favor International</div>
    <div class="hq-paper__date">${e(d.dateLine)}</div>
    <div class="hq-paper__addr">${d.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}</div>
    <p class="hq-paper__greet">${e(d.greeting)}</p>
    ${d.paragraphs.map((p) => `<p>${e(p)}</p>`).join('')}
    <p>${e(d.closing)}</p>
    <div class="hq-paper__sig"></div>
    ${d.signerName ? `<div class="hq-paper__name">${e(d.signerName)}</div>` : ''}${d.signerTitle ? `<div class="hq-paper__title">${e(d.signerTitle)}</div>` : ''}
  </article>`;
}
function text(d) {
  return [d.greeting, '', ...d.paragraphs.flatMap((p) => [p, '']), d.closing, '', d.signerName, d.signerTitle].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
}

/** Open a PDF the server returns in the window the click opened (so a pop-up blocker lets it through). */
async function blobOpen(win, path, body) {
  const AS = new URLSearchParams(location.search).get('as') || '';
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify(body) });
  if (!res.ok) { let m = 'The letter did not build. Try again.'; try { m = (await res.json()).message || m; } catch (_) { /* keep the plain message */ } if (win) win.close(); throw new Error(m); }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  if (win) win.location.href = href; else window.open(href, '_blank');
  setTimeout(() => URL.revokeObjectURL(href), 120000);
}

const payload = () => ({ items: L.items.map((g) => ({ giftId: g.giftId, cid: g.cid })), from: L.from || undefined, said: L.said, designation: L.designation, words: L.words, invitation: L.invitation });

let pT = 0;
function later() { clearTimeout(pT); pT = setTimeout(fetchDocs, 280); }
async function fetchDocs() {
  const my = ++L.seq;
  L.loading = true; drawPaper();
  try {
    const r = await F().post('/api/work/gifts/letter', payload());
    if (my !== L.seq) return;
    L.docs = r.letters; L.froms = r.froms; if (!L.from) L.from = r.from; L.error = '';
    if (L.idx >= L.docs.length) L.idx = 0;
    if (!L.drawn) { L.drawn = true; L.loading = false; drawAll(); return; }
  } catch (err) { if (my !== L.seq) return; L.error = err.message; }
  L.loading = false; drawPaper();
}

function drawPaper() {
  const box = $('#wl-paper'); if (!box) return;
  const d = L.docs && L.docs[L.idx];
  box.classList.toggle('is-busy', !!L.loading);
  box.innerHTML = L.error ? `<div class="hq-note is-bad">${e(L.error)}</div>` : d ? paper(d) : '<div class="hq-skel"></div>';
  const nav = $('#wl-nav');
  if (nav) nav.innerHTML = L.docs && L.docs.length > 1 ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wl-step="-1" aria-label="Previous letter"${L.idx === 0 ? ' disabled' : ''}>Back</button><span>Letter ${L.idx + 1} of ${L.docs.length}</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wl-step="1" aria-label="Next letter"${L.idx >= L.docs.length - 1 ? ' disabled' : ''}>Next</button>` : '';
}

function drawAll() {
  const root = $('#wl-dlg'); if (!root) return;
  const f = F(); const one = L.items.length === 1; const g0 = L.items[0];
  const d = L.docs && L.docs[L.idx];
  const last = d && d.last;
  root.innerHTML = `
    <div class="wg-dlg__head"><div><h2>${one ? 'Letter for ' + e(g0.name) : 'Letters for ' + L.items.length + ' partners'}</h2><p>${one ? `${f.money(g0.amount)} on ${f.fd(g0.date)}${g0.fund ? ' · ' + e(g0.fund) : ''}` : `${f.money(L.items.reduce((n, g) => n + g.amount, 0))} in gifts. The same wording goes on every letter.`}</p></div><button type="button" class="pp-iconbtn" data-wl-close aria-label="Close">${f.ic('x')}</button></div>
    <div class="hq-compose">
      <div class="hq-compose__form">
        <label class="wg-lab" for="wl-from">Letter from</label>
        <select id="wl-from" class="wc-sel">${(L.froms || []).map((p) => `<option value="${e(p.id)}"${p.id === L.from ? ' selected' : ''}>${e(p.name)}</option>`).join('')}</select>
        <label class="wg-lab" for="wl-said">What the director said</label>
        <textarea id="wl-said" rows="5" maxlength="1200" placeholder="Paste from the transcript">${e(L.said)}</textarea>
        ${last && last.text ? `<button type="button" class="hq-link" data-wl-last>Use the last contact note (${e(f.fd(last.date))})</button>` : ''}
        <div class="hq-switches" role="group" aria-label="Paragraphs">
          <button type="button" class="hq-sw${L.designation ? ' is-on' : ''}" data-wl-sw="designation" aria-pressed="${L.designation}">Designation</button>
          <button type="button" class="hq-sw${L.words ? ' is-on' : ''}" data-wl-sw="words" aria-pressed="${L.words}">Director's words</button>
          <button type="button" class="hq-sw${L.invitation ? ' is-on' : ''}" data-wl-sw="invitation" aria-pressed="${L.invitation}">Invitation</button>
        </div>
      </div>
      <div class="hq-compose__page"><div id="wl-nav" class="hq-nav"></div><div id="wl-paper" class="hq-sheet"></div></div>
    </div>
    <div class="wg-dlg__foot"><small>Logs a Mailing action with the Thanked tag when printed, an Email action when copied for email. Undo stays for 24 hours.</small><span>${one ? `<button type="button" class="h-btn h-btn--ghost" data-wl-copy>${f.ic('mail')}Copy for email</button>` : ''}<button type="button" class="h-btn h-btn--primary" data-wl-print>${f.ic('print')}${one ? 'Print PDF and log' : 'Print ' + L.items.length + ' letters and log'}</button></span></div>`;
  drawPaper();
}

/** items: [{ giftId, cid, name, amount, date, fund }]. */
function open(items, o = {}) {
  if (!items || !items.length) return;
  close();
  L = { items, from: o.from || '', said: '', designation: true, words: true, invitation: false, docs: null, froms: [], idx: 0, loading: true, error: '', seq: 0, drawn: false, busy: false };
  const wrap = document.createElement('div');
  wrap.className = 'wg-layer'; wrap.id = 'wl-layer';
  wrap.innerHTML = `<div class="wg-scrim" data-wl-close></div><div class="wg-dlg wg-dlg--wide" id="wl-dlg" role="dialog" aria-modal="true" aria-label="Letter"><div class="wg-skel"><i></i><i></i><i></i></div></div>`;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', onKey, true);
  fetchDocs();
}
function close() {
  const w = $('#wl-layer'); if (w) w.remove();
  document.removeEventListener('keydown', onKey, true);
  L = null;
}
function onKey(ev) { if (ev.key === 'Escape' && L) { ev.stopPropagation(); close(); } }

async function finish(how) {
  if (!L || L.busy) return;
  const f = F(); const items = L.items.slice(); const from = L.from;
  const person = (L.froms.find((p) => p.id === from) || {}).name || '';
  L.busy = true;
  let win = null;
  if (how === 'letter') win = window.open('', '_blank');
  try {
    if (how === 'letter') await blobOpen(win, '/api/work/gifts/letter', Object.assign(payload(), { pdf: true }));
    else { await navigator.clipboard.writeText(text(L.docs[L.idx])); }
  } catch (err) { if (L) L.busy = false; f.toast(err.message, null, true); return; }
  close();
  await f.thank(items.map((g) => ({ giftId: g.giftId, cid: g.cid })), { how, outcome: 'sent', line: person ? `Letter from ${person}` : '', owner: from || undefined, label: how === 'letter' ? (items.length === 1 ? `Letter logged for ${items[0].name}` : `${items.length} letters logged`) : `Email letter logged for ${items[0].name}` });
}

document.addEventListener('click', (ev) => {
  if (!L) return;
  const t = ev.target.closest ? ev.target : null; if (!t) return;
  if (t.closest('[data-wl-close]')) { close(); return; }
  const sw = t.closest('[data-wl-sw]');
  if (sw) { const k = sw.dataset.wlSw; L[k] = !L[k]; sw.classList.toggle('is-on', L[k]); sw.setAttribute('aria-pressed', String(L[k])); later(); return; }
  const st = t.closest('[data-wl-step]');
  if (st) { L.idx = Math.max(0, Math.min(L.docs.length - 1, L.idx + Number(st.dataset.wlStep))); drawPaper(); return; }
  if (t.closest('[data-wl-last]')) { const d = L.docs[L.idx]; const ta = $('#wl-said'); if (d && d.last && ta) { ta.value = d.last.text; L.said = d.last.text; later(); } return; }
  if (t.closest('[data-wl-print]')) { finish('letter'); return; }
  if (t.closest('[data-wl-copy]')) { finish('email'); }
}, true);
document.addEventListener('input', (ev) => { if (L && ev.target.id === 'wl-said') { L.said = ev.target.value; later(); } });
document.addEventListener('change', (ev) => { if (L && ev.target.id === 'wl-from') { L.from = ev.target.value; later(); } });

window.WCLetter = { open, paper, text, blobOpen };
})();
