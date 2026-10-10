/* Add a partner from Entry. Support opens it from a row that matched no record. The form fills from the row; the right side lists records
   already in Blackbaud as you type (the hub's copy at once, Blackbaud's own duplicate search a moment after you stop typing). Add stays
   locked until "None of these is the same person" is ticked, and typing in a name, phone, email or city box clears the tick.
   Loaded before work.js; it reaches the page through window.WC. ?standin=1 on the page sends the add to the stand-in route, which
   makes nothing in Blackbaud. */
(() => {
'use strict';
const W = () => window.WC;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STANDIN = new URLSearchParams(location.search).get('standin') === '1';
const KINDS = [['individual', 'Individual'], ['household', 'Household'], ['organization', 'Organization']];
const CODES = ['Prospect', 'Partner', 'Church'];
const MAX_LIVE = 8;

function parseRow(r) {
  const base = String(r.name || '').split(' - ')[0].trim();
  const org = r.org || '';
  let first = '', last = '', sfirst = '';
  let kind = 'individual';
  let n = base.includes(',') ? base.replace(/^(.+?),\s*(.+)$/, '$2 $1') : base;
  const pair = n.match(/^(\S+)\s+(?:and|&)\s+(\S+)\s+(.+)$/i);
  if (pair) { kind = 'household'; first = pair[1]; sfirst = pair[2]; last = pair[3]; }
  else { const parts = n.split(/\s+/); first = parts.shift() || ''; last = parts.join(' '); }
  if (org && !last) kind = 'organization';
  let street = '', city = '', state = '', zip = '';
  const a = String(r.addr || '').trim();
  const m = a.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\.?\s*(\d{5}(?:-\d{4})?)?\s*$/);
  if (m) { street = m[1]; city = m[2]; state = m[3].toUpperCase(); zip = m[4] || ''; }
  else if (a) street = a;
  return { kind, first, last, sfirst, slast: last, org: kind === 'organization' ? (org || base) : '', phone: r.phoneV || '', email: r.emailV || '', street, city, state, zip };
}

function open(rowId) {
  const wc = W();
  const d = wc.S.in.data;
  const row = d && d.rows.find((x) => x.id === rowId);
  if (!row) return;
  const owners = d.owners;
  const st = Object.assign(parseRow(row), { code: 'Prospect', holder: owners.some((o) => o.fid === row.owner) ? row.owner : '', notSame: false, matches: [], status: '', warn: false, liveSig: '', liveCount: 0, done: null, busy: false });
  const probe = () => ({ kind: st.kind, first: st.first, last: st.last, spouse_first: st.sfirst, spouse_last: st.slast || st.last, org: st.org, phone: st.phone, email: st.email, city: st.city, state: st.state, zip: st.zip });
  const sig = () => JSON.stringify([st.kind, st.first, st.last, st.sfirst, st.slast, st.org, st.phone.replace(/\D/g, ''), st.email, st.city, st.state, st.zip].map((x) => String(x).trim().toLowerCase()));
  let el = null, t1 = 0, t2 = 0, seq = 0, tickSig = '';

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const mdY = (iso) => (iso ? wc.fd(iso, true) : '');
  const matchHTML = (m) => {
    const strong = m.reasons.some((x) => /phone|email|and city|domain/i.test(x));
    const meta = [m.since ? (m.gifts ? 'Partner since ' + m.since.slice(0, 4) : 'Added ' + m.since.slice(0, 4)) : '', m.gifts ? `last gift ${money(m.lastAmount)}, ${mdY(m.lastGift)}` : m.fromCopy ? 'no gifts' : '', m.holders.length ? 'held by ' + m.holders.join(', ') : m.fromCopy ? 'held by no one' : ''].filter(Boolean).join(' · ');
    const reach = [m.phone ? m.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : '', m.email].filter(Boolean).join(' · ');
    return `<div class="ap-match${strong ? ' is-strong' : ''}"><b>${esc(m.name)}${m.deceased ? ' (deceased)' : ''}</b><p>${esc(m.place || 'No address')}${m.lookup ? ' · ' + esc(m.lookup) : ''}${reach ? ' · ' + esc(reach) : ''}${meta ? '<br>' + esc(meta) : ''}</p>
      <div class="ap-why">${m.reasons.map((w) => `<span class="wc-tag ${/phone|email|and city|domain/i.test(w) ? 'wc-tag--gift' : ''}">${esc(w)}</span>`).join('')}</div>
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-use="${esc(m.cid)}" data-copy="${m.fromCopy ? 1 : 0}">Use this record</button></div>`;
  };
  const matchesHTML = () => {
    const ready = (st.kind === 'organization' ? st.org.trim().length >= 3 : st.last.trim().length >= 2) || st.phone.replace(/\D/g, '').length >= 10 || /@/.test(st.email);
    if (!ready) return '<h3><span>Already in Blackbaud?</span><span></span></h3><div class="ap-idle">Type a name, phone or email. Records already in Blackbaud show here.</div>';
    return `<h3><span>Already in Blackbaud?</span><span>${st.matches.length ? st.matches.length + ' found' : ''}</span></h3>
      <div class="ap-status${st.warn ? ' is-warn' : ''}" aria-live="polite">${esc(st.status)}</div>
      ${st.matches.length ? st.matches.map(matchHTML).join('') : '<div class="ap-clear">No match on name, phone, email or city</div>'}`;
  };
  const field = (name, ph, type, val) => `<input type="${type || 'text'}" name="${name}" value="${esc(val)}" placeholder="${ph}" autocomplete="off" aria-label="${ph}" />`;
  const formHTML = () => `
    <div class="ap-src"><b>${esc(row.name || 'This row')}</b>${row.notes ? '<br>' + esc(row.notes.slice(0, 220)) : ''}</div>
    <div class="ap-seg" role="group" aria-label="What kind of record">${KINDS.map(([k, l]) => `<button type="button" class="${st.kind === k ? 'is-on' : ''}" data-kind="${k}">${l}</button>`).join('')}</div>
    ${st.kind === 'organization' ? field('org', 'Organization name', 'text', st.org) : `<div class="ap-two">${field('first', 'First name', 'text', st.first)}${field('last', 'Last name', 'text', st.last)}</div>`}
    ${st.kind === 'household' ? `<div class="ap-two">${field('sfirst', 'Spouse first name', 'text', st.sfirst)}${field('slast', 'Spouse last name', 'text', st.slast || st.last)}</div>` : ''}
    <div class="ap-two">${field('phone', 'Phone', 'tel', st.phone)}${field('email', 'Email', 'email', st.email)}</div>
    ${field('street', 'Street', 'text', st.street)}
    <div class="ap-three">${field('city', 'City', 'text', st.city)}${field('state', 'State', 'text', st.state)}${field('zip', 'ZIP', 'text', st.zip)}</div>
    <div class="ap-two"><label class="ap-lab">Code<select name="code">${CODES.map((c) => `<option${c === st.code ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="ap-lab">Held by<select name="holder"><option value="">No one yet</option>${owners.map((o) => `<option value="${esc(o.fid)}"${o.fid === st.holder ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>`;
  const footHTML = () => {
    const ok = !st.busy && st.notSame && formValid();
    return `<label class="ap-check"><input type="checkbox" data-notsame ${st.notSame ? 'checked' : ''} /> None of these is the same person</label>
      <button type="button" class="h-btn h-btn--ghost" data-closelayer>Cancel</button>
      <button type="button" class="h-btn h-btn--primary" data-addgo ${ok ? '' : 'disabled'}>${st.busy ? 'Adding…' : STANDIN ? 'Try the stand-in' : 'Add as new partner'}</button>`;
  };
  const formValid = () => (st.kind === 'organization' ? st.org.trim().length >= 3 : st.first.trim() && st.last.trim() && (st.kind !== 'household' || st.sfirst.trim())) && (!st.phone || st.phone.replace(/\D/g, '').length === 10) && (!st.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.email));
  const drawMatches = () => { const m = $('#ap-matches', el); if (m) m.innerHTML = matchesHTML(); };
  const drawFoot = () => { const f = $('#ap-foot', el); if (f) f.innerHTML = footHTML(); };
  const drawForm = () => { const f = $('#ap-form', el); if (f) f.innerHTML = formHTML(); };

  async function check(live) {
    const my = ++seq;
    const s = sig();
    try {
      const out = await wc.post('/api/work/partner-add/matches', Object.assign(probe(), { live }));
      if (my !== seq && !live) return;
      if (s !== sig()) return;
      st.matches = out.matches;
      if (live) { st.liveSig = s; st.liveCount++; }
      st.warn = false;
      st.status = !out.ready ? '' : out.live === 'ran' ? 'Checked in Blackbaud at ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : out.live === 'failed' ? 'Blackbaud did not answer. These come from the hub\'s copy, which can be 12 hours old.' : 'Checking Blackbaud…';
      st.warn = out.live === 'failed';
    } catch (e) { st.status = e.message; st.warn = true; }
    drawMatches();
  }
  function changed(resetTick) {
    if (resetTick && st.notSame && sig() !== tickSig) { st.notSame = false; }
    clearTimeout(t1); clearTimeout(t2);
    t1 = setTimeout(() => check(false), 250);
    t2 = setTimeout(() => { if (st.liveCount < MAX_LIVE && sig() !== st.liveSig) { st.status = 'Checking Blackbaud…'; st.warn = false; drawMatches(); check(true); } }, 1300);
    drawFoot();
  }

  wc.dialog('', (box) => {
    el = box;
    box.classList.add('ap-dlg');
    const owner = wc.P ? wc.P(row.owner).n : '';
    box.innerHTML = `<div class="wc-dlg__head"><div><h2>Add a partner</h2><p>From ${esc(owner)}'s contact on ${esc(wc.fd(row.date, true))}${STANDIN ? ' · stand-in: nothing is made in Blackbaud' : ''}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${wc.ic('x')}</button></div>
      <div class="wc-dlg__body" id="ap-body"><div class="ap"><form class="ap-form" id="ap-form" autocomplete="off" onsubmit="return false">${formHTML()}</form><div class="ap-matches" id="ap-matches">${matchesHTML()}</div></div></div>
      <div class="wc-dlg__foot" id="ap-foot">${footHTML()}</div>`;
    check(false); if (formValid() || st.last || st.org) t2 = setTimeout(() => { st.status = 'Checking Blackbaud…'; drawMatches(); check(true); }, 400);
    box.addEventListener('input', (e) => {
      const n = e.target.name; if (!n) return;
      const v = e.target.value;
      if (n === 'code') { st.code = v; drawFoot(); return; }
      if (n === 'holder') { st.holder = v; return; }
      const map = { first: 'first', last: 'last', sfirst: 'sfirst', slast: 'slast', org: 'org', phone: 'phone', email: 'email', street: 'street', city: 'city', state: 'state', zip: 'zip' };
      if (map[n]) { st[map[n]] = v; if (n !== 'street') changed(true); else drawFoot(); }
    });
    box.addEventListener('change', (e) => {
      if (e.target.name === 'code') st.code = e.target.value;
      if (e.target.name === 'holder') st.holder = e.target.value;
      if (e.target.hasAttribute('data-notsame')) { st.notSame = e.target.checked; tickSig = sig(); drawFoot(); }
    });
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.kind) { st.kind = b.dataset.kind; st.notSame = false; drawForm(); changed(false); return; }
      if (b.dataset.use) {
        if (b.dataset.copy !== '1') { wc.toast('That record is new in Blackbaud and the hub\'s copy has not read it yet. Try again after the next refresh.'); return; }
        b.disabled = true;
        try {
          const out = await wc.api('/api/work/entry/' + row.id, { method: 'PATCH', body: JSON.stringify({ constituent_id: b.dataset.use }) });
          wc.closeLayer();
          await wc.entryReload();
          wc.toast('Matched the row to the existing record. Nothing was added to Blackbaud.');
          void out;
        } catch (err) { b.disabled = false; wc.toast(err.message); }
        return;
      }
      if (b.hasAttribute('data-addgo') && !b.disabled) {
        st.busy = true; drawFoot();
        const body = Object.assign(probe(), { street: st.street, code: st.code, holder: st.holder, none_same: true, row: row.id });
        try {
          const out = await wc.post(STANDIN ? '/api/work/partner-add/standin' : '/api/work/partner-add', body);
          st.done = out; st.busy = false;
          if (STANDIN) {
            $('#ap-body', el).innerHTML = `<div class="ap-done"><b>Stand-in answered. Nothing was made in Blackbaud.</b><span>${out.calls.length} calls built for ${esc(out.name)}:</span><code>${out.calls.map((c) => esc(c.method + ' ' + c.path)).join('\n')}</code></div>`;
            $('#ap-foot', el).innerHTML = '<button type="button" class="h-btn h-btn--primary" data-closelayer>Close</button>';
            return;
          }
          wc.closeLayer();
          await wc.entryReload();
          wc.toast(`Added ${out.name}${out.lookup ? ' (record ' + out.lookup + ')' : ''}. The row is ready to enter.${out.warnings && out.warnings.length ? ' ' + out.warnings.join(' ') : ''}`);
        } catch (err) { st.busy = false; drawFoot(); wc.toast(err.message); }
      }
    });
  });
}

window.WCAdd = { open };
})();
