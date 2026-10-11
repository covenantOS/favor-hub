/* Add a partner: the full new-partner form in a slide-over, from the Work Center's tool row and from Find a partner. Individual,
   household (two people joined as spouses) or organization (a type code and a main contact joined to it), with links to partners already
   in Blackbaud. Records already in Blackbaud show beside the form as you type (the hub's copy at once, Blackbaud's own duplicate search a
   moment after you stop). Add stays locked until "None of these is the same person" is ticked, and any edit to a name, phone, email or
   city clears the tick. Support and admins only; the server checks again on save and repeats the duplicate check.
   ?standin=1 sends the add to the stand-in route, which builds the same calls and makes nothing in Blackbaud.
   Public: window.FavorAddPartner = { open, mountButtons }. */
(() => {
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STANDIN = new URLSearchParams(location.search).get('standin') === '1';
const AS = new URLSearchParams(location.search).get('as') || '';
const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI'];
const KINDS = [['individual', 'Individual'], ['household', 'Household'], ['organization', 'Organization']];
const MAX_LIVE = 8;
const digits = (s) => String(s || '').replace(/\D/g, '');

async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });

let OPTS = null;
let OPTSP = null;
function options() {
  if (OPTS) return Promise.resolve(OPTS);
  if (!OPTSP) OPTSP = api('/api/work/partner-add/options').then((o) => (OPTS = o), () => (OPTS = { can: false }));
  return OPTSP;
}

/* The buttons: anything with data-add-partner shows for people who may add a partner, and opens the form. */
function mountButtons() {
  options().then((o) => {
    if (!o.can) return;
    const show = () => document.querySelectorAll('[data-add-partner][hidden]').forEach((b) => { b.hidden = false; });
    show();
    if (!document.documentElement.dataset.adObserver) {
      document.documentElement.dataset.adObserver = '1';
      new MutationObserver(show).observe(document.body, { childList: true, subtree: true });
    }
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-add-partner]');
  if (b) { e.preventDefault(); open(); }
});

let layer = null;
function open() {
  options().then((o) => {
    if (!o.can) return;
    draw(o);
  });
}

function draw(o) {
  if (layer) layer.remove();
  layer = document.createElement('div');
  layer.className = 'pp-layer';
  layer.innerHTML = `<div class="pp-scrim" data-ad-close></div><aside class="pp-drawer ad-drawer" role="dialog" aria-modal="true" aria-label="Add a partner"><div class="pp-bar"><span class="pp-bar__name">Add a partner</span><span class="pp-bar__acts"><button type="button" class="pp-iconbtn" data-ad-close aria-label="Close (Esc)"><svg class="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6 6 18"/></svg></button></span></div><div class="pp-scroll ad-scroll"></div></aside>`;
  document.body.appendChild(layer);
  requestAnimationFrame(() => layer.querySelectorAll('.pp-scrim, .pp-drawer').forEach((x) => x.classList.add('is-on')));
  document.documentElement.classList.add('pp-locked');
  const host = $('.ad-scroll', layer);
  const S = {
    kind: 'individual', title: '', first: '', middle: '', last: '', suffix: '',
    stitle: '', sfirst: '', smiddle: '', slast: '', ssuffix: '', sphone: '', sphoneType: '', semail: '',
    org: '', typeCode: '', cfirst: '', clast: '', ctitle: '', crole: 'Employee', cposition: '', cphone: '', cemail: '',
    phone: '', phoneType: '', email: '', street: '', city: '', state: '', zip: '',
    code: 'Prospect', holder: '', holderNote: '', holderTouched: false,
    relations: [], notSame: false, matches: [], status: '', warn: false, liveSig: '', liveCount: 0, busy: false, done: null, err: '',
  };
  let t1 = 0, t2 = 0, seq = 0, tickSig = '', stateTimer = 0;
  const sig = () => JSON.stringify([S.kind, S.first, S.last, S.sfirst, S.slast, S.org, digits(S.phone), S.email, S.city, S.state, S.zip].map((x) => String(x).trim().toLowerCase()));
  const probe = () => ({ kind: S.kind, first: S.first, last: S.last, spouse_first: S.sfirst, spouse_last: S.slast || S.last, org: S.org, phone: S.phone, email: S.email, city: S.city, state: S.state, zip: S.zip });
  const mailOk = (v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  const phoneOk = (v) => !v || digits(v).length === 10;
  const valid = () => {
    if (S.kind === 'organization') { if (S.org.trim().length < 3) return false; if ((S.cfirst.trim() || S.clast.trim()) && !(S.cfirst.trim() && S.clast.trim())) return false; }
    else { if (!S.first.trim() || !S.last.trim()) return false; if (S.kind === 'household' && !S.sfirst.trim()) return false; }
    return phoneOk(S.phone) && mailOk(S.email) && phoneOk(S.sphone) && mailOk(S.semail) && phoneOk(S.cphone) && mailOk(S.cemail) && S.relations.every((r) => r.id);
  };

  const sel = (name, list, cur, blank) => `<select name="${name}">${blank != null ? `<option value=""${cur ? '' : ' selected'}>${esc(blank)}</option>` : ''}${list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  const inp = (name, label, val, type, extra) => `<label>${esc(label)}<input type="${type || 'text'}" name="${name}" value="${esc(val)}" autocomplete="off"${extra || ''} /></label>`;
  const personFields = (p, who) => `<div class="ad-grid ad-grid--name"><label>Title${sel(p + 'title', o.titles, who.title, '')}</label>${inp(p + 'first', 'First name', who.first)}${inp(p + 'middle', 'Middle', who.middle)}${inp(p + 'last', 'Last name', who.last)}<label>Suffix${sel(p + 'suffix', o.suffixes, who.suffix, '')}</label></div>`;
  const holderSel = () => `<label>Held by<select name="holder"><option value="">No one yet</option>${o.holders.map((h) => `<option value="${esc(h.fid)}"${h.fid === S.holder ? ' selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>`;

  function formHTML() {
    const org = S.kind === 'organization';
    return `<div class="ad-kinds" role="group" aria-label="What kind of record">${KINDS.map(([k, l]) => `<button type="button" class="${S.kind === k ? 'is-on' : ''}" data-ad-kind="${k}">${l}</button>`).join('')}</div>
      ${org ? `<div class="ad-sec"><h3>Organization</h3><div class="ad-grid">${inp('org', 'Organization name', S.org)}<label>Type${sel('typeCode', o.typeCodes, S.typeCode, '')}</label></div></div>
        <div class="ad-sec"><h3>Main contact</h3><div class="ad-grid ad-grid--name"><label>Title${sel('ctitle', o.titles, S.ctitle, '')}</label>${inp('cfirst', 'First name', S.cfirst)}${inp('clast', 'Last name', S.clast)}<label>Is the organization's${sel('crole', o.contactRoles, S.crole)}</label>${inp('cposition', 'Position', S.cposition)}</div>
        <div class="ad-grid">${inp('cphone', 'Contact phone', S.cphone, 'tel')}${inp('cemail', 'Contact email', S.cemail, 'email')}</div></div>`
      : `<div class="ad-sec"><h3>${S.kind === 'household' ? 'First person' : 'Person'}</h3>${personFields('', { title: S.title, first: S.first, middle: S.middle, last: S.last, suffix: S.suffix })}</div>
        ${S.kind === 'household' ? `<div class="ad-sec"><h3>Second person</h3>${personFields('s', { title: S.stitle, first: S.sfirst, middle: S.smiddle, last: S.slast, suffix: S.ssuffix })}<div class="ad-grid">${inp('sphone', 'Phone', S.sphone, 'tel')}${inp('semail', 'Email', S.semail, 'email')}</div></div>` : ''}`}
      <div class="ad-sec"><h3>Reach</h3><div class="ad-grid">${inp('phone', org ? 'Organization phone' : 'Phone', S.phone, 'tel')}<label>Phone type${sel('phoneType', o.phoneTypes, S.phoneType || (org ? 'Business Phone' : 'Cell Phone'))}</label>${inp('email', org ? 'Organization email' : 'Email', S.email, 'email')}</div>
        ${inp('street', 'Street', S.street)}
        <div class="ad-grid ad-grid--3">${inp('city', 'City', S.city)}<label>State<input type="text" name="state" value="${esc(S.state)}" list="ad-states" maxlength="30" autocomplete="off" /></label>${inp('zip', 'ZIP', S.zip)}</div><datalist id="ad-states">${STATES.map((x) => `<option value="${x}">`).join('')}</datalist></div>
      <div class="ad-sec"><h3>Relationships<button type="button" class="rc-add" data-ad-addrel>Add a relationship</button></h3>${S.relations.length ? S.relations.map((r, i) => relRow(r, i)).join('') : '<p class="rc-none">No relationship to a partner already in Blackbaud.</p>'}</div>
      <div class="ad-sec"><h3>Code and holder</h3><div class="ad-grid"><label>Code${sel('code', ['Prospect', 'Partner'], S.code)}</label>${holderSel()}</div><p class="ad-note" data-ad-holder>${esc(S.holderNote)}</p></div>`;
  }
  const relRow = (r, i) => `<div class="ad-rel" data-i="${i}"><label>Related to<input type="text" name="rel_q" value="${esc(r.name || r.q || '')}" placeholder="Find a partner" autocomplete="off" />${r.hits && !r.id ? `<ul class="ad-hits">${r.hits.length ? r.hits.map((h) => `<li><button type="button" data-ad-pick="${i}" data-id="${esc(h.cid)}" data-name="${esc(h.name)}">${esc(h.name)}<span>${esc(h.place || '')}</span></button></li>`).join('') : '<li class="is-none">No partner found.</li>'}</ul>` : ''}</label>
    <label>The other partner is their${sel('rel_type', o.relations, r.type || o.relations[0])}</label><button type="button" class="rc-link rc-link--bad" data-ad-remrel="${i}">Remove</button></div>`;
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const matchHTML = (m) => {
    const strong = m.reasons.some((x) => /phone|email|and city|domain/i.test(x));
    const meta = [m.since ? (m.gifts ? 'Partner since ' + m.since.slice(0, 4) : 'Added ' + m.since.slice(0, 4)) : '', m.gifts ? `last gift ${money(m.lastAmount)}` : 'no gifts', m.holders.length ? 'held by ' + m.holders.join(', ') : ''].filter(Boolean).join(' · ');
    return `<div class="ad-match${strong ? ' is-strong' : ''}"><div><b>${esc(m.name)}${m.deceased ? ' (deceased)' : ''}</b><p>${esc(m.place || 'No address')}${m.lookup ? ' · ' + esc(m.lookup) : ''}${meta ? '<br>' + esc(meta) : ''}</p><div class="ad-why">${m.reasons.map((w) => `<span class="rc-chip${/phone|email|and city|domain/i.test(w) ? ' rc-chip--gold' : ''}">${esc(w)}</span>`).join('')}</div></div><a class="h-btn h-btn--ghost h-btn--sm" href="/work/partner/${esc(m.cid)}" target="_blank" rel="noopener">Open this record</a></div>`;
  };
  const ready = () => (S.kind === 'organization' ? S.org.trim().length >= 3 : S.last.trim().length >= 2) || digits(S.phone).length >= 10 || /@/.test(S.email);
  function matchesHTML() {
    if (!ready()) return `<div class="ad-matches__idle">Records already in Blackbaud show here as you type a name, phone or email.</div>`;
    return `<div class="ad-matches__head"><b>${S.matches.length ? S.matches.length + (S.matches.length === 1 ? ' record' : ' records') + ' already in Blackbaud' : 'Already in Blackbaud'}</b><span class="${S.warn ? 'is-warn' : ''}" aria-live="polite">${esc(S.status)}</span></div>
      ${S.matches.length ? S.matches.map(matchHTML).join('') : '<div class="ad-clear">No match on name, phone, email or city</div>'}
      <label class="ad-tick"><input type="checkbox" data-ad-notsame ${S.notSame ? 'checked' : ''} /> None of these is the same person</label>`;
  }
  function footHTML() {
    const ok = !S.busy && S.notSame && valid() && ready();
    return `${S.err ? `<p class="ad-err" role="alert">${esc(S.err)}</p>` : ''}<span class="ad-foot__hint">${S.notSame ? '' : ready() ? 'Tick the box above to continue.' : ''}</span><span><button type="button" class="h-btn h-btn--ghost" data-ad-close>Cancel</button> <button type="button" class="h-btn h-btn--primary" data-ad-go${ok ? '' : ' disabled'}>${S.busy ? 'Adding…' : STANDIN ? 'Try the stand-in' : 'Add as new partner'}</button></span>`;
  }
  function shell() {
    if (S.done) { host.innerHTML = doneHTML(); return; }
    host.innerHTML = `<div class="ad"><div class="ad-head"><span class="pp-kicker">New partner</span><h1>Add a partner</h1><p>${STANDIN ? 'Stand-in: nothing is made in Blackbaud.' : 'Matching records show as you type.'}</p></div>
      <div class="ad-body"><form class="ad-form" autocomplete="off" onsubmit="return false">${formHTML()}</form><div class="ad-matches" id="ad-matches">${matchesHTML()}</div></div><div class="ad-foot" id="ad-foot">${footHTML()}</div></div>`;
  }
  const drawMatches = () => { const m = $('#ad-matches', host); if (m) m.innerHTML = matchesHTML(); };
  const drawFoot = () => { const f = $('#ad-foot', host); if (f) f.innerHTML = footHTML(); };
  function doneHTML() {
    const d = S.done;
    if (STANDIN) return `<div class="ad ad-done"><h1>Stand-in answered</h1><p>Nothing was made in Blackbaud. ${d.calls.length} calls built for ${esc(d.name)}:</p><pre>${d.calls.map((c) => esc(c.method + ' ' + c.path)).join('\n')}</pre><p><button type="button" class="h-btn h-btn--primary" data-ad-close>Close</button></p></div>`;
    return `<div class="ad ad-done"><span class="pp-kicker">Added</span><h1>${esc(d.name)}</h1><p>Record ${esc(d.lookup || '')}. The code, the holder and the links are in Blackbaud. Source code, addressee and salutation come from the record review the next weekday.</p>
      ${d.warnings && d.warnings.length ? `<div class="rc-conflict" role="alert"><b>Finish in Blackbaud</b><p>${d.warnings.map(esc).join(' ')}</p></div>` : ''}
      <p class="ad-done__acts"><button type="button" class="h-btn h-btn--primary" data-ad-open="${esc(d.cid)}">Open the record</button> <button type="button" class="h-btn h-btn--ghost" data-ad-again>Add another</button></p></div>`;
  }

  async function check(live) {
    const my = ++seq;
    const s = sig();
    try {
      const out = await post('/api/work/partner-add/matches', Object.assign(probe(), { live }));
      if (my !== seq && !live) return;
      if (s !== sig()) return;
      S.matches = out.matches;
      if (live) { S.liveSig = s; S.liveCount++; }
      S.status = !out.ready ? '' : out.live === 'ran' ? 'Checked in Blackbaud at ' + new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET' : out.live === 'failed' ? 'Blackbaud did not answer. These are from the hub\'s copy.' : '';
      S.warn = out.live === 'failed';
    } catch (e) { S.status = e.message; S.warn = true; }
    drawMatches(); drawFoot();
  }
  function changed(resetTick) {
    if (resetTick && S.notSame && sig() !== tickSig) S.notSame = false;
    clearTimeout(t1); clearTimeout(t2);
    t1 = setTimeout(() => check(false), 250);
    t2 = setTimeout(() => { if (S.liveCount < MAX_LIVE && sig() !== S.liveSig && ready()) { S.status = 'Checking Blackbaud…'; S.warn = false; drawMatches(); check(true); } }, 1300);
    drawMatches(); drawFoot();
  }
  async function guessHolder() {
    if (S.holderTouched) return;
    try {
      const g = await api('/api/work/partner-add/holder?state=' + encodeURIComponent(S.state));
      if (S.holderTouched) return;
      S.holder = g.fid || '';
      S.holderNote = g.source === 'territory' ? `${g.name} holds ${S.state.toUpperCase()}.` : g.source === 'partner_care' ? (S.state.trim() ? `No region lists ${S.state.toUpperCase()}. Partner Care holds it.` : 'No state yet. Partner Care holds it.') : '';
      const f = $('select[name="holder"]', host); if (f) f.value = S.holder;
      const n = $('[data-ad-holder]', host); if (n) n.textContent = S.holderNote;
    } catch (_) { /* the picker stays as it is */ }
  }

  shell();
  guessHolder();

  const fieldMap = { title: 'title', first: 'first', middle: 'middle', last: 'last', suffix: 'suffix', stitle: 'stitle', sfirst: 'sfirst', smiddle: 'smiddle', slast: 'slast', ssuffix: 'ssuffix', sphone: 'sphone', semail: 'semail', org: 'org', typeCode: 'typeCode', cfirst: 'cfirst', clast: 'clast', ctitle: 'ctitle', crole: 'crole', cposition: 'cposition', cphone: 'cphone', cemail: 'cemail', phone: 'phone', phoneType: 'phoneType', email: 'email', street: 'street', city: 'city', state: 'state', zip: 'zip', code: 'code' };
  const identity = new Set(['first', 'last', 'sfirst', 'slast', 'org', 'phone', 'email', 'city', 'state', 'zip']);
  layer.addEventListener('input', (e) => {
    const t = e.target;
    const n = t.name;
    if (!n) return;
    if (n === 'rel_q') {
      const row = t.closest('.ad-rel'); const i = Number(row.dataset.i);
      S.relations[i].q = t.value; S.relations[i].id = ''; S.relations[i].name = '';
      clearTimeout(S.relations[i].t);
      S.relations[i].t = setTimeout(async () => {
        if (t.value.trim().length < 2) { S.relations[i].hits = null; return; }
        try { S.relations[i].hits = (await api('/api/work/partners?wide=1&q=' + encodeURIComponent(t.value.trim()))).rows || []; } catch (_) { S.relations[i].hits = []; }
        const pos = t.selectionStart; shell(); drawFoot();
        const again = host.querySelectorAll('input[name="rel_q"]')[i]; if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      }, 250);
      drawFoot();
      return;
    }
    if (!(n in fieldMap)) return;
    S[fieldMap[n]] = t.value;
    if (n === 'state') { clearTimeout(stateTimer); stateTimer = setTimeout(guessHolder, 400); }
    if (identity.has(n)) changed(true); else drawFoot();
  });
  layer.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'holder') { S.holder = t.value; S.holderTouched = true; S.holderNote = ''; const n = $('[data-ad-holder]', host); if (n) n.textContent = ''; return; }
    if (t.name === 'rel_type') { const i = Number(t.closest('.ad-rel').dataset.i); S.relations[i].type = t.value; return; }
    if (t.name in fieldMap && t.tagName === 'SELECT') { S[fieldMap[t.name]] = t.value; drawFoot(); return; }
    if (t.hasAttribute('data-ad-notsame')) { S.notSame = t.checked; tickSig = sig(); drawFoot(); }
  });
  layer.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (e.target.closest('[data-ad-close]')) { close(); return; }
    if (!b) return;
    if (b.dataset.adKind) { S.kind = b.dataset.adKind; S.notSame = false; shell(); changed(false); return; }
    if (b.hasAttribute('data-ad-addrel')) { S.relations.push({ id: '', name: '', q: '', type: o.relations[0], hits: null }); shell(); drawFoot(); const last = host.querySelectorAll('input[name="rel_q"]'); if (last.length) last[last.length - 1].focus(); return; }
    if (b.dataset.adRemrel !== undefined) { S.relations.splice(Number(b.dataset.adRemrel), 1); shell(); drawFoot(); return; }
    if (b.dataset.adPick !== undefined) { const r = S.relations[Number(b.dataset.adPick)]; r.id = b.dataset.id; r.name = b.dataset.name; r.hits = null; shell(); drawFoot(); return; }
    if (b.dataset.adOpen) { close(); if (window.FavorPartner) window.FavorPartner.open(b.dataset.adOpen); return; }
    if (b.hasAttribute('data-ad-again')) { draw(o); return; }
    if (b.hasAttribute('data-ad-go') && !b.disabled) {
      S.busy = true; S.err = ''; drawFoot();
      const org = S.kind === 'organization';
      const body = Object.assign(probe(), {
        title: S.title, middle: S.middle, suffix: S.suffix, phone_type: S.phoneType || (org ? 'Business Phone' : 'Cell Phone'),
        spouse_title: S.stitle, spouse_middle: S.smiddle, spouse_suffix: S.ssuffix, spouse_phone: S.sphone, spouse_email: S.semail,
        type_code: org ? S.typeCode : '',
        contact: org && (S.cfirst.trim() || S.clast.trim()) ? { first: S.cfirst, last: S.clast, title: S.ctitle, phone: S.cphone, email: S.cemail, position: S.cposition, role: S.crole } : null,
        relations: S.relations.filter((r) => r.id).map((r) => ({ id: r.id, type: r.type })),
        street: S.street, code: S.code, holder: S.holder, none_same: true,
      });
      try {
        S.done = await post(STANDIN ? '/api/work/partner-add/standin' : '/api/work/partner-add', body);
        S.busy = false;
        shell();
      } catch (err) { S.busy = false; S.err = err.message; drawFoot(); }
    }
  });
  document.addEventListener('keydown', onKey, true);
  function onKey(e) { if (e.key === 'Escape' && layer && layer.isConnected) { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener('keydown', onKey, true);
    if (!layer) return;
    layer.querySelectorAll('.pp-scrim, .pp-drawer').forEach((x) => x.classList.remove('is-on'));
    document.documentElement.classList.remove('pp-locked');
    const l = layer; layer = null;
    setTimeout(() => l.remove(), 240);
  }
  const first = $('input[name="first"], input[name="org"]', host); if (first) first.focus();
}

window.FavorAddPartner = { open, mountButtons };
// Only the Work Center and Find a partner carry the button, so only those pages ask who may add a partner.
if (/^\/work(\/|$)/.test(location.pathname)) mountButtons();
})();
