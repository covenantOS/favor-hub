/* Practice mode: a pretend partner, an Add gift form laid out like Raiser's Edge NXT's, and the Work Center's Log a contact and
   Add a task. Everything saves to FavorOS's own practice table; nothing reaches Blackbaud. */
(() => {
  'use strict';
  const root = document.getElementById('pr');
  if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayWord = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric' }) : '');
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const us = (iso) => (iso ? iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4) : '');
  const plus = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  let D = null;
  const last = { gift: null, call: null, task: null };
  const draft = { gift: {}, call: {}, task: {} };
  let giftOpen = false;

  async function api(path, method, body) {
    const init = { method: method || 'GET', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api/growth/' + path, init); } catch (e) { throw new Error('No connection. Check your internet and try again.'); }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) throw new Error((data && data.message) || 'Something went wrong. Try again.');
    return data;
  }

  const opts = (list, cur, ph) => `<option value="">${esc(ph)}</option>` + list.map((x) => `<option${x === cur ? ' selected' : ''}>${esc(x)}</option>`).join('');

  function history() {
    const rows = D.partner.history.map((g) => ({ date: g.date, amount: g.amount, fund: g.fund, type: g.type, mine: false }));
    D.entries.filter((e) => e.kind === 'gift' && e.ok).forEach((e) => rows.push({ date: e.fields.date, amount: Number(e.fields.amount), fund: e.fields.fund, type: 'One-time gift', mine: true }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }
  function notes() {
    const rows = D.partner.notes.map((n) => ({ date: n.date, text: n.text, mine: false }));
    D.entries.filter((e) => e.ok && (e.kind === 'call' || e.kind === 'task')).forEach((e) => rows.push({
      date: e.at.slice(0, 10), mine: true,
      text: e.kind === 'call' ? `Call. ${e.fields.what}` : `Task, due ${dayWord(e.fields.due)}. ${e.fields.what}`,
    }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }

  function partnerCard() {
    const p = D.partner;
    const total = history().reduce((s, g) => s + g.amount, 0);
    return `<section class="pr-card pr-partner" aria-label="The practice partner">
      <div class="pr-partner__top"><span class="pr-tag">Practice record</span><h2>${esc(p.name)}</h2><p>${esc(p.household)}</p></div>
      <dl class="pr-facts"><div><dt>Address</dt><dd>${esc(p.address)}</dd></div><div><dt>Phone</dt><dd>${esc(p.phone)}</dd></div><div><dt>Email</dt><dd>${esc(p.email)}</dd></div><div><dt>Partner since</dt><dd>${esc(dayWord(p.since))}</dd></div><div><dt>Given in total</dt><dd>${money(total)}</dd></div></dl>
      <div class="pr-sech"><h3>Giving history</h3><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-open-gift>+ Add gift</button></div>
      <div class="pr-table" role="table" aria-label="Giving history"><div class="pr-tr pr-tr--h" role="row"><span role="columnheader">Date</span><span role="columnheader">Amount</span><span role="columnheader">Type</span><span role="columnheader">Fund</span></div>${history().map((g) => `<div class="pr-tr${g.mine ? ' is-mine' : ''}" role="row"><span role="cell">${esc(dayWord(g.date))}</span><b role="cell">${money(g.amount)}</b><span role="cell">${esc(g.type)}</span><span role="cell">${esc(g.fund)}${g.mine ? ' <i class="pr-you">You</i>' : ''}</span></div>`).join('')}</div>
      <h3>Notes and contacts</h3>
      <ul class="pr-notes">${notes().map((n) => `<li class="${n.mine ? 'is-mine' : ''}"><span>${esc(dayWord(n.date))}${n.mine ? ' <i class="pr-you">You</i>' : ''}</span><p>${esc(n.text)}</p></li>`).join('')}</ul>
    </section>`;
  }

  function result(kind) {
    const r = last[kind];
    if (!r) return '';
    return `<div class="pr-result${r.ok ? ' is-ok' : ''}" role="status" aria-live="polite"><b>${r.ok ? 'Every field is right.' : 'Not yet. Fix the fields marked below and save again.'}</b><ul>${r.checks.map((c) => `<li class="${c.ok ? 'is-ok' : 'is-bad'}"><span aria-hidden="true">${c.ok ? '&#10003;' : '&#10005;'}</span><div><b>${esc(c.label)}</b>${c.ok ? '' : `<small>${esc(c.hint)}</small>`}</div></li>`).join('')}</ul></div>`;
  }

  /* The Add gift form, in Raiser's Edge NXT's order: Gift details, Gift splits, Soft credits, acknowledgement and receipt status, Save. */
  function giftForm() {
    const v = draft.gift;
    const method = v.method || 'Cash';
    return `<form class="pr-gift" data-form="gift" novalidate aria-label="Add gift for ${esc(D.partner.name)}">
      <div class="pr-gift__bar"><b>Add gift for ${esc(D.partner.name)}</b><button type="button" class="pr-x" data-close-gift aria-label="Close">&times;</button></div>
      <div class="pr-gtabs" role="tablist"><span class="is-on" role="tab" aria-selected="true">Gift details</span><span role="tab" aria-selected="false" aria-disabled="true">Fundraiser credits</span><span role="tab" aria-selected="false" aria-disabled="true">Custom fields</span></div>
      <label class="pr-req">Amount<input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="$0.00" value="${esc(v.amount || '')}"></label>
      <label class="pr-req">Gift date<input type="text" name="date" inputmode="numeric" autocomplete="off" placeholder="MM/DD/YYYY" value="${esc(v.date !== undefined ? v.date : us(today()))}"><small>Use the format MM/DD/YYYY.</small></label>
      <p class="pr-ro">Receipt amount: <b>${esc(v.amount ? '$' + String(v.amount).replace(/[$,]/g, '') : '$0.00')}</b></p>
      <label class="pr-req">Gift type<select name="type">${D.giftTypes.map((x) => `<option${x === (v.type || 'One-time gift') ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <div class="pr-field"><span>Payment method</span><div class="pr-pay" role="group" aria-label="Payment method">${D.methods.map((m) => `<button type="button" class="${m === method ? 'is-on' : ''}" data-method="${esc(m)}" aria-pressed="${m === method}">${esc(m)}</button>`).join('')}</div></div>
      ${method === 'Check' ? `<div class="pr-two"><label>Check number<input type="text" name="check" inputmode="numeric" autocomplete="off" value="${esc(v.check || '')}"></label><label>Check date<input type="text" name="checkDate" inputmode="numeric" autocomplete="off" placeholder="MM/DD/YYYY" value="${esc(v.checkDate || '')}"></label></div>` : ''}
      <h4>Gift splits</h4>
      <label>Appeal<select name="appeal">${`<option value="">Search for an appeal</option>` + D.appeals.map((a) => `<option value="${esc(a.code)}"${a.code === v.appeal ? ' selected' : ''}>${esc(a.code)}</option>`).join('')}</select></label>
      <label>Package<select name="package" disabled><option>Search for a package</option></select></label>
      <label>Campaign<select name="campaign" disabled><option>Search for a campaign</option></select></label>
      <label class="pr-req">Fund<select name="fund">${opts(D.funds, v.fund, 'Search for a fund')}</select></label>
      <p class="pr-ro">Soft credits: none. Acknowledgement status: Needs acknowledgement. Receipt status: Needs receipt.</p>
      <div class="pr-gift__foot"><button type="submit" class="h-btn h-btn--primary">Save</button><button type="button" class="h-btn h-btn--ghost" data-close-gift>Cancel</button></div>
    </form>${result('gift')}`;
  }

  /* Log a contact and Add a task, as the Work Center's partner page has them. */
  function contactForm() {
    const v = draft.call;
    const kind = v.kind || 'Phone call';
    const tags = v.tags || [];
    return `<form class="pr-compose" data-form="call" novalidate><div class="pr-compose__top"><b>Log a contact</b></div>
      <div class="pr-seg" role="group" aria-label="Kind">${D.kinds.map(([val, lab]) => `<button type="button" class="${val === kind ? 'is-on' : ''}" data-kind="call:${esc(val)}" aria-pressed="${val === kind}">${esc(lab)}</button>`).join('')}</div>
      <label>What happened<input type="text" name="what" maxlength="255" value="${esc(v.what || '')}"></label>
      <div class="pr-compose__row"><label>Date<input type="date" name="date" value="${esc(v.date !== undefined ? v.date : today())}"></label><div class="pr-seg pr-seg--tags" role="group" aria-label="Tags">${D.tags.map((t) => `<button type="button" class="${tags.includes(t) ? 'is-on' : ''}" data-tag="${esc(t)}" aria-pressed="${tags.includes(t)}">${esc(t)}</button>`).join('')}</div></div>
      <div class="pr-compose__foot"><small>For you</small><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button></div></form>${result('call')}`;
  }
  function taskForm() {
    const v = draft.task;
    const kind = v.kind || 'Task/Other';
    return `<form class="pr-compose" data-form="task" novalidate><div class="pr-compose__top"><b>Add a task</b></div>
      <div class="pr-seg" role="group" aria-label="Kind">${D.kinds.map(([val, lab]) => `<button type="button" class="${val === kind ? 'is-on' : ''}" data-kind="task:${esc(val)}" aria-pressed="${val === kind}">${esc(lab)}</button>`).join('')}</div>
      <label>What to do<input type="text" name="what" maxlength="255" value="${esc(v.what || '')}"></label>
      <div class="pr-compose__row"><label>Due<input type="date" name="due" value="${esc(v.due !== undefined ? v.due : plus(today(), 7))}"></label><span></span></div>
      <div class="pr-compose__foot"><small>For you</small><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button></div></form>${result('task')}`;
  }

  function card(kind) {
    const s = D.scenarios[kind];
    const done = kind === 'gift' ? D.done.gift : D.done.call && D.done.task;
    const body = kind === 'gift'
      ? (giftOpen ? giftForm() : `<div class="pr-ex__go"><button type="button" class="h-btn h-btn--primary" data-open-gift>+ Add gift</button></div>${result('gift')}`)
      : contactForm() + taskForm();
    return `<section class="pr-card pr-ex" data-ex="${kind}"><div class="pr-ex__h"><h2>${esc(s.title)}</h2>${done ? '<span class="pr-done">Done</span>' : ''}</div>
      <p class="pr-for">${esc(s.forWho)}</p><p class="pr-story">${esc(s.story)}</p>
      <ol class="pr-steps">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>${body}</section>`;
  }

  function draw() {
    const all = D.done.all;
    root.removeAttribute('aria-busy');
    root.innerHTML = `<div class="pr-head"><div><h1>Practice</h1><p>A pretend partner and a pretend record. Nothing you enter here goes to Blackbaud or to a real partner.</p></div>
      <div class="pr-head__acts">${all ? '<span class="pr-done">Both exercises done</span>' : ''}<button type="button" class="h-btn h-btn--ghost" data-reset>Start over</button></div></div>
      ${D.ready ? '' : '<div class="pr-off" role="alert">Practice mode is not switched on yet. An admin needs to finish setting it up.</div>'}
      <div class="pr-grid">${partnerCard()}<div class="pr-side">${card('gift')}${card('call')}</div></div>`;
  }

  const store = (e) => {
    const f = e.target.closest('form[data-form]');
    if (f && e.target.name) draft[f.dataset.form][e.target.name] = e.target.value;
    return f;
  };
  root.addEventListener('input', (e) => {
    const f = store(e);
    if (f && f.dataset.form === 'gift' && e.target.name === 'amount') {
      const ro = f.querySelector('.pr-ro b');
      if (ro) ro.textContent = e.target.value ? '$' + e.target.value.replace(/[$,]/g, '') : '$0.00';
    }
  });
  root.addEventListener('change', (e) => {
    const f = store(e);
    if (f && f.dataset.form === 'gift' && e.target.name === 'appeal') draw();
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = Object.assign({}, draft[kind]);
      if (kind === 'gift') { if (body.date === undefined) body.date = us(today()); if (!body.type) body.type = 'One-time gift'; if (!body.method) body.method = 'Cash'; }
      if (kind === 'call') { if (body.date === undefined) body.date = today(); if (!body.kind) body.kind = 'Phone call'; }
      if (kind === 'task') { if (body.due === undefined) body.due = plus(today(), 7); if (!body.kind) body.kind = 'Task/Other'; }
      const d = await api('practice/' + kind, 'POST', body);
      last[kind] = { ok: d.passed, checks: d.checks };
      D = Object.assign({}, D, d.state);
      if (d.passed) { draft[kind] = {}; if (kind === 'gift') giftOpen = false; }
      draw();
      const r = root.querySelector(`.pr-ex[data-ex="${kind === 'gift' ? 'gift' : 'call'}"] .pr-result`);
      if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) { btn.disabled = false; alert(err.message); }
  });
  root.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-open-gift]')) { giftOpen = true; draw(); const f = root.querySelector('.pr-gift input'); if (f) f.focus({ preventScroll: false }); return; }
    if (t.closest('[data-close-gift]')) { giftOpen = false; draw(); return; }
    const m = t.closest('[data-method]');
    if (m) { draft.gift.method = m.dataset.method; draw(); return; }
    const k = t.closest('[data-kind]');
    if (k) { const [form, val] = k.dataset.kind.split(':'); draft[form].kind = val; const keep = root.querySelector(`form[data-form="${form}"] input[name=what]`); if (keep) draft[form].what = keep.value; draw(); return; }
    const g = t.closest('[data-tag]');
    if (g) { const set = new Set(draft.call.tags || []); set.has(g.dataset.tag) ? set.delete(g.dataset.tag) : set.add(g.dataset.tag); draft.call.tags = [...set]; const keep = root.querySelector('form[data-form="call"] input[name=what]'); if (keep) draft.call.what = keep.value; draw(); return; }
    if (!t.closest('[data-reset]')) return;
    if (!window.confirm('Clear everything you entered in the practice record?')) return;
    try {
      const d = await api('practice', 'DELETE');
      D = Object.assign({}, D, d);
      last.gift = last.call = last.task = null; draft.gift = {}; draft.call = {}; draft.task = {}; giftOpen = false;
      draw();
    } catch (err) { alert(err.message); }
  });

  api('practice').then((d) => { D = d; draw(); }).catch((err) => {
    root.removeAttribute('aria-busy');
    root.innerHTML = `<div class="pr-head"><div><h1>Practice</h1></div></div><div class="pr-off" role="alert">${esc(err.message)}</div>`;
  });
})();
