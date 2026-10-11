/* Record maintenance inside the partner drawer and full page: the Contact, Codes and Record tabs. partner.js owns the shell and the
   Overview; this file draws the three tabs into an element partner.js keeps per partner and tab (window.FavorRecords.mount).
   Everything shown is read live from Blackbaud (GET /api/work/partners/:id/contact, /codes, /record). Every change goes through
   /api/work/batches like the Work Center's edits: saved, sent through the upkeep route's write guard, read back, and undone from the
   toast for 24 hours. After a save the tab reads the record again and shows what Blackbaud kept. */
(() => {
'use strict';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MON.map((m) => m.slice(0, 3));
const STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI'];
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const T = () => window.FavorPartner.tools;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fd = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON3[m - 1] + ' ' + d + ', ' + y; };
const md = (v) => (v ? MON3[v.m - 1] + ' ' + v.d : '');
const mdLong = (v) => (v ? MON[v.m - 1] + ' ' + v.d : '');
const chip = (t, cls) => `<span class="rc-chip${cls ? ' ' + cls : ''}">${esc(t)}</span>`;
const toggle = (name, label, on, off) => `<label class="rc-tog"><input type="checkbox" name="${name}"${on ? ' checked' : ''}${off ? ' disabled' : ''} /><i></i><span>${esc(label)}</span></label>`;
const opts = (list, cur, blank) => (blank ? `<option value=""${cur ? '' : ' selected'}>${esc(blank)}</option>` : '') + list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()));

function mount(el, c) {
  const S = { ask: null, draft: null, data: null, flags: null, err: '', editing: null, busy: false, conflict: null, form: {}, passThrough: null, status: 'active', loaded: 0 };
  const id = c.id;
  const tab = c.tab;
  const P = () => c.partner() || { name: '', household: [], kind: 'Individual', id };

  /* -------------------------------------------------------------- reading */
  async function load() {
    S.err = '';
    try {
      const api = T().api;
      if (tab === 'contact') {
        const [a, r] = await Promise.all([api(`/api/work/partners/${id}/contact`), api(`/api/work/partners/${id}/record`)]);
        S.data = a; S.flags = r.flags; S.record = r;
        c.merge(id, { phones: a.phones, emails: a.emails, addresses: a.addresses });
      } else if (tab === 'codes') {
        S.data = await api(`/api/work/partners/${id}/codes`);
        c.merge(id, { codes: S.data.codes });
      } else {
        S.data = await api(`/api/work/partners/${id}/record`);
        S.flags = S.data.flags;
        c.merge(id, { flags: S.data.flags });
      }
    } catch (e) { S.err = e.message || 'Blackbaud did not answer.'; }
    S.loaded = Date.now();
    draw();
  }
  el.addEventListener('rc:reload', () => { S.editing = null; S.conflict = null; load(); });

  /* -------------------------------------------------------------- drawing */
  const skeleton = '<div class="rc-skel"><i style="height:14px;width:30%"></i><i style="height:96px"></i><i style="height:96px"></i><i style="height:14px;width:24%"></i><i style="height:72px"></i></div>';
  function draw() {
    if (S.err && !S.data) el.innerHTML = `<div class="rc-err"><p>${esc(S.err)}</p><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-retry>Try again</button></div>`;
    else if (!S.data) el.innerHTML = skeleton;
    else el.innerHTML = (S.err ? `<div class="rc-err"><p>${esc(S.err)}</p></div>` : '') + (tab === 'contact' ? contactHTML() : tab === 'codes' ? codesHTML() : recordHTML());
  }

  /* ---- Contact */
  const rights = () => (S.data && S.data.can) || { contact: false, codes: false };
  function addrCard(a) {
    const edit = rights().contact && S.editing !== 'address:' + a.id;
    const chips = [chip(a.type), a.preferred ? chip('Preferred', 'rc-chip--ok') : '', a.doNotMail ? chip('Do not mail', 'rc-chip--bad') : '', a.inactive ? chip('Ended') : ''].join('');
    const meta = a.inactive ? `Used ${a.start ? fd(a.start) + ' to ' : 'until '}${fd(a.end)}` : a.seasonalStart ? `Every year ${md(a.seasonalStart)} to ${md(a.seasonalEnd)}` : a.start ? 'Since ' + fd(a.start) : '';
    if (S.editing === 'address:' + a.id) return `<div class="rc-card is-open">${addrForm(a)}</div>`;
    return `<div class="rc-card${a.inactive ? ' is-ended' : ''}"><div class="rc-card__chips">${chips}</div>
      <div class="rc-card__body"><b>${esc(a.lines) || 'No street'}</b><p>${esc([a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))}${a.country && a.country !== 'United States' ? ' · ' + esc(a.country) : ''}</p>${meta ? `<small>${esc(meta)}</small>` : ''}</div>
      ${edit ? `<button type="button" class="rc-edit" data-rc-edit="address:${esc(a.id)}">Edit</button>` : ''}</div>`;
  }
  function addrForm(a) {
    const t = S.data.tables;
    const v = Object.assign({}, a || { id: '', type: 'Home', lines: '', city: '', state: '', zip: '', country: 'United States', preferred: false, doNotMail: false, start: '', end: '', seasonalStart: null, seasonalEnd: null, inactive: false }, S.draft || {});
    v.start = v.start || '';
    v.end = v.end || '';
    const seasonal = v.type === 'Seasonal';
    const ss = v.seasonalStart || { m: 5, d: 1 };
    const se = v.seasonalEnd || { m: 10, d: 15 };
    const locked = a && a.type === 'Seasonal';
    return `<form class="rc-form" data-rc-form="address" data-id="${esc(v.id)}" autocomplete="off">
      <div class="rc-grid">
        <label>Type<select name="type"${locked ? ' disabled' : ''}>${opts(t.addressTypes, v.type)}</select></label>
        <label>Street<input type="text" name="lines" value="${esc(v.lines)}" maxlength="150" /></label>
        <label>City<input type="text" name="city" value="${esc(v.city)}" maxlength="50" /></label>
        <div class="rc-two"><label>State<input type="text" name="state" value="${esc(v.state)}" list="rc-states" maxlength="30" /></label><label>ZIP<input type="text" name="zip" value="${esc(v.zip)}" maxlength="12" /></label></div>
        <label>Country<input type="text" name="country" value="${esc(v.country || 'United States')}" maxlength="60" /></label>
        <label>In use from<input type="date" name="start" value="${esc(v.start)}" /></label>
        <label>In use until<input type="date" name="end" value="${esc(v.end)}" /></label>
      </div>
      <datalist id="rc-states">${STATES.map((x) => `<option value="${x}">`).join('')}</datalist>
      ${seasonal ? `<fieldset class="rc-season"><legend>Seasonal dates, every year</legend>
        <div class="rc-grid rc-grid--4"><label>From month<select name="sm">${MON.map((m, i) => `<option value="${i + 1}"${ss.m === i + 1 ? ' selected' : ''}>${m.slice(0, 3)}</option>`).join('')}</select></label><label>Day<input type="number" name="sd" min="1" max="31" value="${ss.d}" /></label>
        <label>To month<select name="em">${MON.map((m, i) => `<option value="${i + 1}"${se.m === i + 1 ? ' selected' : ''}>${m.slice(0, 3)}</option>`).join('')}</select></label><label>Day<input type="number" name="ed" min="1" max="31" value="${se.d}" /></label></div>
        <p class="rc-words" data-rc-words>${esc(words(ss, se))}</p></fieldset>` : ''}
      <div class="rc-toggles">${toggle('preferred', 'Preferred address', v.preferred)}${toggle('doNotMail', 'Do not mail', v.doNotMail)}</div>
      ${conflictHTML()}
      <div class="rc-foot">${a && !a.inactive ? (S.ask === 'endaddr:' + a.id ? `<span class="rc-ask"><label>Last day in use<input type="date" name="endday" value="${TODAY}" max="${TODAY}" /></label><button type="button" class="h-btn h-btn--sm rc-btn-bad" data-rc-endgo="${esc(a.id)}">End address</button></span>` : `<button type="button" class="rc-link rc-link--bad" data-rc-endaddr="${esc(a.id)}">End this address</button>`) : '<span></span>'}<span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>${a ? 'Save' : 'Add address'}</button></span></div></form>`;
  }
  const words = (a, b) => `Every year ${mdLong(a)} to ${mdLong(b)}`;
  function phoneCard(p) {
    if (S.editing === 'phone:' + p.id) return `<div class="rc-card is-open">${phoneForm(p)}</div>`;
    return `<div class="rc-card${p.inactive ? ' is-ended' : ''}"><div class="rc-card__chips">${chip(p.type || 'Phone')}${p.primary ? chip('Preferred', 'rc-chip--ok') : ''}${p.doNotCall ? chip('Do not call', 'rc-chip--bad') : ''}${p.inactive ? chip('Inactive') : ''}</div>
      <div class="rc-card__body"><b>${esc(p.number)}</b></div>${rights().contact ? `<button type="button" class="rc-edit" data-rc-edit="phone:${esc(p.id)}">Edit</button>` : ''}</div>`;
  }
  function phoneForm(p) {
    const v = p || { id: '', number: '', type: 'Cell Phone', primary: false, doNotCall: false };
    return `<form class="rc-form" data-rc-form="phone" data-id="${esc(v.id)}" autocomplete="off"><div class="rc-grid"><label>Number<input type="tel" name="number" value="${esc(v.number)}" maxlength="40" placeholder="(813) 555-0100" /></label>
      <label>Type<select name="type">${opts(S.data.tables.phoneTypes, v.type)}</select></label></div>
      <div class="rc-toggles">${toggle('primary', 'Preferred phone', v.primary)}${toggle('doNotCall', 'Do not call', v.doNotCall)}</div>${conflictHTML()}
      <div class="rc-foot">${p && !p.inactive ? `<button type="button" class="rc-link rc-link--bad" data-rc-end="phone:${esc(p.id)}">Mark inactive</button>` : '<span></span>'}<span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>${p ? 'Save' : 'Add phone'}</button></span></div></form>`;
  }
  function emailCard(e) {
    if (S.editing === 'email:' + e.id) return `<div class="rc-card is-open">${emailForm(e)}</div>`;
    return `<div class="rc-card${e.inactive ? ' is-ended' : ''}"><div class="rc-card__chips">${chip('Email')}${e.primary ? chip('Preferred', 'rc-chip--ok') : ''}${e.doNotEmail ? chip('Do not email', 'rc-chip--bad') : ''}${e.inactive ? chip('Inactive') : ''}</div>
      <div class="rc-card__body"><b>${esc(e.address)}</b></div>${rights().contact ? `<button type="button" class="rc-edit" data-rc-edit="email:${esc(e.id)}">Edit</button>` : ''}</div>`;
  }
  function emailForm(e) {
    const v = e || { id: '', address: '', primary: false, doNotEmail: false };
    return `<form class="rc-form" data-rc-form="email" data-id="${esc(v.id)}" autocomplete="off"><div class="rc-grid"><label>Email address<input type="email" name="address" value="${esc(v.address)}" maxlength="150" /></label></div>
      <div class="rc-toggles">${toggle('primary', 'Preferred email', v.primary)}${toggle('doNotEmail', 'Do not email', v.doNotEmail)}</div>${conflictHTML()}
      <div class="rc-foot">${e && !e.inactive ? `<button type="button" class="rc-link rc-link--bad" data-rc-end="email:${esc(e.id)}">Mark inactive</button>` : '<span></span>'}<span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>${e ? 'Save' : 'Add email'}</button></span></div></form>`;
  }
  function conflictHTML() {
    const cf = S.conflict;
    if (!cf) return '';
    return `<div class="rc-conflict" role="alert"><b>Changed in Blackbaud</b><p>${cf.map((x) => `${esc(label(x.key))} is now ${esc(show(x.theirs))}`).join('. ')}.</p><div><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-theirs>Use theirs</button> <button type="button" class="h-btn h-btn--primary h-btn--sm" data-rc-mine>Keep mine</button></div></div>`;
  }
  const label = (k) => ({ address_lines: 'Street', postal_code: 'ZIP', do_not_mail: 'Do not mail', do_not_call: 'Do not call', do_not_email: 'Do not email', seasonal_start: 'Season start', seasonal_end: 'Season end', primary: 'Preferred', preferred: 'Preferred' }[k] || k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
  const show = (v) => (v == null || v === '' ? 'blank' : typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'object' ? (v.m ? mdLong(v) : JSON.stringify(v)) : String(v).slice(0, 10) === String(v) || /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fd(v) : String(v));
  const sortRows = (list, mark) => list.slice().sort((a, b) => (a.inactive === b.inactive ? (b[mark] ? 1 : 0) - (a[mark] ? 1 : 0) : a.inactive ? 1 : -1));

  function flagRow() {
    const f = S.flags;
    if (!f) return '';
    const off = !rights().contact;
    return `<h3 class="rc-h">Record flags</h3><div class="rc-card rc-card--flags"><form data-rc-flags>${toggle('givesAnonymously', 'Gives anonymously', f.givesAnonymously, off)}${toggle('requestsNoEmail', 'Requests no email', f.requestsNoEmail, off)}${toggle('noValidAddress', 'No valid address', f.noValidAddress, off)}</form></div>`;
  }
  function contactHTML() {
    const d = S.data;
    const can = rights().contact;
    return `<div class="rc-sec"><h3 class="rc-h">Addresses${can ? '<button type="button" class="rc-add" data-rc-add="address">Add an address</button>' : ''}</h3>
      ${S.editing === 'address:new' ? `<div class="rc-card is-open">${addrForm(null)}</div>` : ''}
      ${d.addresses.length ? sortRows(d.addresses, 'preferred').map(addrCard).join('') : S.editing === 'address:new' ? '' : '<p class="rc-none">No address on file.</p>'}</div>
      <div class="rc-sec"><h3 class="rc-h">Phones${can ? '<button type="button" class="rc-add" data-rc-add="phone">Add a phone</button>' : ''}</h3>
      ${S.editing === 'phone:new' ? `<div class="rc-card is-open">${phoneForm(null)}</div>` : ''}
      ${d.phones.length ? sortRows(d.phones, 'primary').map(phoneCard).join('') : S.editing === 'phone:new' ? '' : '<p class="rc-none">No phone on file.</p>'}</div>
      <div class="rc-sec"><h3 class="rc-h">Emails${can ? '<button type="button" class="rc-add" data-rc-add="email">Add an email</button>' : ''}</h3>
      ${S.editing === 'email:new' ? `<div class="rc-card is-open">${emailForm(null)}</div>` : ''}
      ${d.emails.length ? sortRows(d.emails, 'primary').map(emailCard).join('') : S.editing === 'email:new' ? '' : '<p class="rc-none">No email on file.</p>'}</div>
      <div class="rc-sec">${flagRow()}</div>`;
  }

  /* ---- Codes */
  function codesHTML() {
    const d = S.data;
    const can = rights().codes;
    const active = d.codes.filter((x) => !x.inactive);
    const ended = d.codes.filter((x) => x.inactive);
    const codeCard = (x) => `<div class="rc-card${x.inactive ? ' is-ended' : ''}"><div class="rc-card__body"><b>${esc(x.code)}${x.morningRun ? ' ' + chip('Morning run', 'rc-chip--gold') : ''}${x.inactive ? ' ' + chip('Ended') : ''}</b><small>${x.inactive ? `${x.start ? fd(x.start) + ' to ' : 'Until '}${fd(x.end)}` : x.start ? 'Since ' + fd(x.start) : ''}</small></div>
      ${can && !x.morningRun ? (x.inactive ? `<button type="button" class="rc-edit" data-rc-code-reopen="${esc(x.id)}">Reopen</button>` : S.ask === 'code:' + x.id ? `<span class="rc-ask"><button type="button" class="h-btn h-btn--sm rc-btn-bad" data-rc-code-end="${esc(x.id)}">End today</button><button type="button" class="rc-edit" data-rc-noask>Keep</button></span>` : `<button type="button" class="rc-edit rc-edit--bad" data-rc-ask="code:${esc(x.id)}">End</button>`) : ''}</div>`;
    const sCard = (x) => `<div class="rc-card${x.inactive ? ' is-ended' : ''}"><div class="rc-card__body"><b>${esc(x.code)}${x.inactive ? ' ' + chip('Ended') : ''}</b><small>${x.inactive ? `${x.start ? fd(x.start) + ' to ' : 'Until '}${fd(x.end)}` : x.start ? 'Since ' + fd(x.start) : 'No start date'}</small></div>
      ${can ? (x.inactive ? `<button type="button" class="rc-edit" data-rc-sol-reopen="${esc(x.id)}">Reopen</button>` : S.ask === 'sol:' + x.id ? `<span class="rc-ask"><button type="button" class="h-btn h-btn--sm rc-btn-bad" data-rc-sol-end="${esc(x.id)}">End today</button><button type="button" class="rc-edit" data-rc-noask>Keep</button></span>` : `<button type="button" class="rc-edit rc-edit--bad" data-rc-ask="sol:${esc(x.id)}">End</button>`) : ''}</div>`;
    const addCode = S.editing === 'code:new' ? codeForm() : '';
    const addSol = S.editing === 'solicit:new' ? solicitForm() : '';
    return `<div class="rc-sec"><h3 class="rc-h">Constituent codes${can ? '<button type="button" class="rc-add" data-rc-add="code">Add a code</button>' : ''}</h3>${addCode}
      ${active.length ? active.map(codeCard).join('') : '<p class="rc-none">No active code.</p>'}${ended.length ? `<details class="rc-ended"><summary>${ended.length} ended</summary>${ended.map(codeCard).join('')}</details>` : ''}</div>
      <div class="rc-sec"><h3 class="rc-h">Solicit codes${can ? '<button type="button" class="rc-add" data-rc-add="solicit">Add a solicit code</button>' : ''}</h3>${addSol}
      ${d.solicit.filter((x) => !x.inactive).length ? d.solicit.filter((x) => !x.inactive).map(sCard).join('') : '<p class="rc-none">No solicit code.</p>'}${d.solicit.some((x) => x.inactive) ? `<details class="rc-ended"><summary>${d.solicit.filter((x) => x.inactive).length} ended</summary>${d.solicit.filter((x) => x.inactive).map(sCard).join('')}</details>` : ''}</div>`;
  }
  function codeForm() {
    const cur = S.form.code || (S.data.tables.constituentCodes.find((x) => !S.data.morningRun.includes(x)) || '');
    const morning = S.data.morningRun.includes(cur);
    const pt = S.passThrough;
    return `<form class="rc-form rc-card is-open" data-rc-form="code"><div class="rc-grid"><label>Code<select name="code">${opts(S.data.tables.constituentCodes, cur)}</select></label><label>Starts<input type="date" name="date" value="${esc(S.form.date || TODAY)}" /></label></div>
      ${morning ? `<div class="rc-check"><b>Gifts to check first</b><p>${pt === null ? 'Reading the gifts.' : pt.gifts === 0 ? 'No gifts on this record.' : pt.passed === 0 ? `None of the ${pt.gifts} gifts are soft-credited to someone else.` : pt.blocked ? `All ${pt.gifts} gifts are soft-credited to ${esc(pt.to.slice(0, 3).join(', ') || 'another partner')}. A record that only passes money along stays a Prospect.` : `${pt.passed} of ${pt.gifts} gifts are soft-credited to ${esc(pt.to.slice(0, 3).join(', ') || 'another partner')}.`}</p></div>` : ''}
      <div class="rc-foot"><small>${morning ? 'Partner and Prospect come from the morning run and its gift rules' : ''}</small><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy || morning ? ' disabled' : ''}>Add code</button></span></div></form>`;
  }
  function solicitForm() {
    return `<form class="rc-form rc-card is-open" data-rc-form="solicit"><div class="rc-grid"><label>Solicit code<select name="code">${opts(S.data.tables.solicitCodes, S.form.code || '', 'Pick a code')}</select></label><label>Starts<input type="date" name="date" value="${esc(S.form.date || TODAY)}" /></label></div>
      <div class="rc-foot"><span></span><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>Add solicit code</button></span></div></form>`;
  }

  /* ---- Record */
  function recordHTML() {
    const d = S.data;
    const f = d.flags;
    const p = P();
    const cur = f.deceased ? 'deceased' : f.inactive ? 'inactive' : 'active';
    const can = rights().codes;
    const isOrg = f.type === 'Organization';
    const pick = S.status || cur;
    const card = (k, title, sub) => `<button type="button" class="rc-status${pick === k ? ' is-on' : ''}${cur === k ? ' is-now' : ''}" data-rc-status="${k}"${can ? '' : ' disabled'}><b>${title}</b><span>${sub}</span></button>`;
    const cards = `<div class="rc-statuses">${card('active', 'Active', 'Partner or prospect today')}${card('inactive', 'Inactive', 'Left or asked to be removed')}${isOrg ? '' : card('deceased', 'Deceased', 'Passed away')}</div>`;
    let form = '';
    if (can && pick !== cur) form = pick === 'active' ? activeForm(cur, f) : statusForm(pick, d, p, f);
    const info = `<dl class="rc-dl"><dt>Record type</dt><dd>${esc(f.type || 'Individual')}</dd><dt>Status</dt><dd>${cur === 'deceased' ? 'Deceased' + (f.deceasedDate ? ' ' + esc(fd(f.deceasedDate)) : '') : cur === 'inactive' ? 'Inactive' : 'Active'}</dd>${d.lastStatusChange ? `<dt>Last change here</dt><dd>${esc(fd(String(d.lastStatusChange.at).slice(0, 10)))}</dd>` : ''}</dl>`;
    return `<div class="rc-sec"><h3 class="rc-h">Record status</h3>${cards}${form}${can ? '' : '<p class="rc-none">Admins and the Support Team change the record status.</p>'}</div><div class="rc-sec"><h3 class="rc-h">Record</h3>${info}</div>`;
  }
  function activeForm(cur, f) {
    return `<form class="rc-form rc-card is-open" data-rc-form="status" data-to="active"><p class="rc-line">${cur === 'deceased' ? 'Removes the deceased mark and date.' : 'Removes the inactive mark.'} The codes that ended with it open again.</p>
      <div class="rc-foot"><span></span><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>Mark active</button></span></div></form>`;
  }
  function statusForm(to, d, p, f) {
    const people = [{ id, name: p.name || 'This record' }].concat((p.household || []).filter((h) => h.id !== id).map((h) => ({ id: h.id, name: h.name })));
    const who = S.form.who || id;
    const others = people.filter((x) => x.id !== who);
    const dead = to === 'deceased';
    const fx = Object.assign({ endPartner: true, endAssignments: true, doNotSolicit: dead, noteOther: true }, S.form.fx || {});
    const hasPartner = who === id;
    const open = d.openActions || [];
    const tick = (k, title, sub, dis) => `<label class="rc-fx"><input type="checkbox" name="fx_${k}"${fx[k] ? ' checked' : ''}${dis ? ' disabled' : ''} /><span><b>${esc(title)}</b><small>${esc(sub)}</small></span></label>`;
    return `<form class="rc-form rc-card is-open" data-rc-form="status" data-to="${to}">
      <div class="rc-grid"><label>${dead ? 'Date of death' : 'Date'}<input type="date" name="date" value="${esc(S.form.date || TODAY)}" max="${TODAY}" /></label>${people.length > 1 ? `<label>Who<select name="who">${people.map((x) => `<option value="${esc(x.id)}"${x.id === who ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}</div>
      ${people.length > 1 ? `<div class="rc-note"><p>The other person in this household stays active and keeps their codes and assignment.</p>${toggle('fx_noteOther', 'Add a note to the other person\'s record', fx.noteOther)}</div>` : ''}
      <div class="rc-fxs">${tick('flag', dead ? 'Set deceased and the date' : 'Set inactive', 'Blackbaud record', true).replace('<input type="checkbox"', '<input type="checkbox" checked')}
        ${tick('endPartner', 'End the Partner code on that date', 'The code stays on the record, ended')}
        ${tick('endAssignments', 'End assignments on that date', 'The holder keeps credit for gifts dated before it')}
        ${tick('doNotSolicit', 'Add the Do Not Solicit solicit code', 'Stops mail and calls that name this partner')}
        ${tick('closeActions', 'Cancel open actions for this partner', open.length ? `${open.length} open` : 'None open')}</div>
      ${fx.closeActions && open.length ? `<div class="rc-open">${open.map((a) => `<label><input type="checkbox" name="close" value="${esc(a.id)}" checked /> ${esc(a.summary || a.category)}${a.due ? ' · ' + esc(fd(a.due)) : ''}</label>`).join('')}</div>` : ''}
      ${hasPartner ? '' : '<p class="rc-line">The effects apply to the person picked.</p>'}
      <div class="rc-foot"><small>${dead ? '' : ''}</small><span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-rc-cancel>Cancel</button> <button type="submit" class="h-btn h-btn--primary h-btn--sm"${S.busy ? ' disabled' : ''}>${dead ? 'Mark deceased' : 'Mark inactive'}</button></span></div></form>`;
  }

  /* -------------------------------------------------------------- writing */
  const formVals = (f) => {
    const g = (n) => f.elements[n];
    const v = (n) => (g(n) ? g(n).value : undefined);
    const b = (n) => (g(n) ? g(n).checked : undefined);
    return { v, b };
  };
  async function save(params, label, after) {
    if (S.busy) return;
    S.busy = true; draw();
    const ok = await T().run(params, label, after, { onConflict: (data) => { S.conflict = data.conflict || []; S.retry = params; S.busy = false; draw(); } });
    S.busy = false;
    if (ok) { S.editing = null; S.conflict = null; S.form = {}; S.draft = null; S.ask = null; await load(); }
    else draw();
    return ok;
  }
  /** The set sent for an address, and the base (what the person was looking at) for the conflict check. */
  function addressSet(f, a) {
    const { v, b } = formVals(f);
    const type = f.elements.type && !f.elements.type.disabled ? v('type') : a && a.type;
    const set = { type, lines: v('lines'), city: v('city'), state: v('state'), zip: v('zip'), country: v('country'), preferred: b('preferred'), doNotMail: b('doNotMail'), start: v('start') || null, end: v('end') || null };
    if (type === 'Seasonal') { set.seasonalStart = { m: Number(v('sm')), d: Number(v('sd')) }; set.seasonalEnd = { m: Number(v('em')), d: Number(v('ed')) }; }
    if (a && a.type === 'Seasonal') delete set.type;
    return set;
  }
  const baseOfAddress = (a) => ({ type: a.type, address_lines: a.lines, city: a.city, state: a.state, postal_code: a.zip, country: a.country, preferred: a.preferred, do_not_mail: a.doNotMail, start: a.start || null, end: a.end || null, seasonal_start: a.seasonalStart, seasonal_end: a.seasonalEnd });
  const baseOfPhone = (p) => ({ number: p.number, type: p.type, primary: p.primary, do_not_call: p.doNotCall });
  const baseOfEmail = (e) => ({ address: e.address, primary: e.primary, do_not_email: e.doNotEmail });

  function afterWrite() { /* the tab re-reads Blackbaud after every save; load() does that */ }

  async function onSubmit(f) {
    const kind = f.dataset.rcForm;
    const rowId = f.dataset.id || '';
    const { v, b } = formVals(f);
    if (kind === 'address') {
      const a = rowId ? S.data.addresses.find((x) => x.id === rowId) : null;
      const set = addressSet(f, a);
      if (set.type === 'Seasonal' && !a) T().toast(words(set.seasonalStart, set.seasonalEnd), null);
      return save({ op: 'pcontact', cid: id, kind: 'address', mode: a ? 'edit' : 'add', id: rowId || undefined, set, base: a ? baseOfAddress(a) : undefined }, a ? 'Address saved' : 'Address added');
    }
    if (kind === 'phone') {
      const p = rowId ? S.data.phones.find((x) => x.id === rowId) : null;
      const set = { number: v('number'), type: v('type'), primary: b('primary'), doNotCall: b('doNotCall') };
      return save({ op: 'pcontact', cid: id, kind: 'phone', mode: p ? 'edit' : 'add', id: rowId || undefined, set, base: p ? baseOfPhone(p) : undefined }, p ? 'Phone saved' : 'Phone added');
    }
    if (kind === 'email') {
      const e = rowId ? S.data.emails.find((x) => x.id === rowId) : null;
      const set = { address: v('address'), primary: b('primary'), doNotEmail: b('doNotEmail') };
      return save({ op: 'pcontact', cid: id, kind: 'email', mode: e ? 'edit' : 'add', id: rowId || undefined, set, base: e ? baseOfEmail(e) : undefined }, e ? 'Email saved' : 'Email added');
    }
    if (kind === 'code') return save({ op: 'pcode', cid: id, mode: 'add', code: v('code'), date: v('date') || TODAY }, 'Code added');
    if (kind === 'solicit') {
      if (!v('code')) { T().toast('Pick a solicit code.', null, true); return; }
      return save({ op: 'psolicit', cid: id, mode: 'add', code: v('code'), date: v('date') || TODAY }, 'Solicit code added');
    }
    if (kind === 'status') {
      const to = f.dataset.to;
      const who = v('who') || id;
      if (to === 'active') return save({ op: 'pstatus', cid: id, status: 'active' }, 'Marked active', () => c.merge(id, { flags: { deceased: false, inactive: false } }));
      const fx = { endPartner: b('fx_endPartner'), endAssignments: b('fx_endAssignments'), doNotSolicit: b('fx_doNotSolicit'), closeActions: b('fx_closeActions'), noteOther: b('fx_noteOther') };
      const closeIds = fx.closeActions ? $$('input[name="close"]:checked', f).map((x) => x.value) : [];
      const others = ((P().household || []).filter((h) => h.id !== who).map((h) => h.id)).concat(who !== id ? [id] : []);
      const params = { op: 'pstatus', cid: who, status: to, date: v('date') || TODAY, effects: fx, closeIds, alsoNote: fx.noteOther && others.length ? others[0] : undefined };
      return save(params, to === 'deceased' ? 'Marked deceased' : 'Marked inactive');
    }
  }

  /* -------------------------------------------------------------- events */
  el.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-rc-form]');
    if (!f) return;
    e.preventDefault();
    onSubmit(f);
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    const f = t.closest && t.closest('form[data-rc-form="address"]');
    if (f && /^(sm|sd|em|ed)$/.test(t.name)) {
      const w = $('[data-rc-words]', f);
      if (w) w.textContent = words({ m: Number(f.elements.sm.value), d: Number(f.elements.sd.value) }, { m: Number(f.elements.em.value), d: Number(f.elements.ed.value) });
    }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    const f = t.closest('form');
    if (f && f.dataset.rcFlags !== undefined && t.type === 'checkbox') {
      const flags = { givesAnonymously: f.elements.givesAnonymously.checked, requestsNoEmail: f.elements.requestsNoEmail.checked, noValidAddress: f.elements.noValidAddress.checked };
      await save({ op: 'pflags', cid: id, flags }, 'Record flags saved');
      return;
    }
    if (!f) return;
    if (f.dataset.rcForm === 'address' && t.name === 'type') {
      keepForm(f);
      draw();
      return;
    }
    if (f.dataset.rcForm === 'address' && /^(sm|sd|em|ed)$/.test(t.name)) {
      const w = $('[data-rc-words]', f);
      if (w) w.textContent = words({ m: Number(f.elements.sm.value), d: Number(f.elements.sd.value) }, { m: Number(f.elements.em.value), d: Number(f.elements.ed.value) });
    }
    if (f.dataset.rcForm === 'code' && t.name === 'code') {
      S.form.code = t.value; S.form.date = f.elements.date.value;
      S.passThrough = null; draw();
      if (S.data.morningRun.includes(t.value)) { try { S.passThrough = (await T().api(`/api/work/partners/${id}/codes?passthrough=1`)).passThrough; } catch (_) { S.passThrough = { gifts: 0, passed: 0, to: [], blocked: false }; } draw(); }
    }
    if (f.dataset.rcForm === 'solicit') { S.form.code = f.elements.code.value; S.form.date = f.elements.date.value; }
    if (f.dataset.rcForm === 'status') {
      S.form.date = f.elements.date ? f.elements.date.value : S.form.date;
      if (t.name === 'who') { S.form.who = t.value; draw(); return; }
      if (/^fx_/.test(t.name)) { S.form.fx = Object.assign(S.form.fx || {}, { [t.name.slice(3)]: t.checked }); if (t.name === 'fx_closeActions') draw(); }
    }
  });
  /** Keep what was typed when the form is drawn again (the type picker shows or hides the seasonal dates). */
  function keepForm(f) {
    const a = f.dataset.id ? S.data.addresses.find((x) => x.id === f.dataset.id) : null;
    const cur = addressSet(f, a);
    S.draft = Object.assign({}, cur, { type: f.elements.type.value });
  }
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (t.hasAttribute('data-rc-retry')) { S.data = null; draw(); load(); return; }
    if (d.rcAdd) { S.editing = d.rcAdd + ':new'; S.form = {}; S.draft = null; S.ask = null; S.conflict = null; S.passThrough = null; draw(); const i = $('form input:not([type=checkbox]), form select', el); if (i) i.focus(); return; }
    if (d.rcEdit) { S.editing = d.rcEdit; S.form = {}; S.draft = null; S.ask = null; S.conflict = null; draw(); return; }
    if (t.hasAttribute('data-rc-cancel')) { S.editing = null; S.form = {}; S.draft = null; S.ask = null; S.conflict = null; draw(); return; }
    if (d.rcAsk) { S.ask = d.rcAsk; draw(); return; }
    if (t.hasAttribute('data-rc-noask')) { S.ask = null; draw(); return; }
    if (d.rcEndaddr) { keepForm(t.closest('form')); S.ask = 'endaddr:' + d.rcEndaddr; draw(); return; }
    if (d.rcStatus) { S.status = d.rcStatus; S.form = { date: S.form.date }; draw(); return; }
    if (t.hasAttribute('data-rc-theirs')) { S.editing = S.editing; S.conflict = null; await load(); return; }
    if (t.hasAttribute('data-rc-mine') && S.retry) {
      // Keep mine: the same change again, with what is in Blackbaud now as the starting point.
      const p = Object.assign({}, S.retry);
      const live = {};
      for (const x of S.conflict || []) live[x.key] = x.theirs;
      p.base = Object.assign({}, p.base, live);
      S.conflict = null;
      await save(p, 'Saved');
      return;
    }
    if (d.rcEndgo) {
      const input = $('input[name="endday"]', el);
      const date = input && input.value ? input.value : TODAY;
      const a = S.data.addresses.find((x) => x.id === d.rcEndgo);
      await save({ op: 'pcontact', cid: id, kind: 'address', mode: 'end', id: d.rcEndgo, set: { end: date }, base: a ? { end: a.end || null } : undefined }, 'Address ended');
      return;
    }
    if (d.rcEnd) {
      const [kind, rid] = d.rcEnd.split(':');
      await save({ op: 'pcontact', cid: id, kind, mode: 'end', id: rid }, kind === 'phone' ? 'Phone marked inactive' : 'Email marked inactive');
      return;
    }
    if (d.rcCodeEnd) { await save({ op: 'pcode', cid: id, mode: 'end', id: d.rcCodeEnd, date: TODAY }, 'Code ended'); return; }
    if (d.rcCodeReopen) { await save({ op: 'pcode', cid: id, mode: 'reopen', id: d.rcCodeReopen }, 'Code reopened'); return; }
    if (d.rcSolEnd) { await save({ op: 'psolicit', cid: id, mode: 'end', id: d.rcSolEnd, date: TODAY }, 'Solicit code ended'); return; }
    if (d.rcSolReopen) { await save({ op: 'psolicit', cid: id, mode: 'reopen', id: d.rcSolReopen }, 'Solicit code reopened'); return; }
  });

  el.innerHTML = skeleton;
  load();
}

window.FavorRecords = { mount };
})();
