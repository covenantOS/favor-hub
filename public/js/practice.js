/* Practice mode: a pretend partner, a gift to enter and a call to log. Everything saves to the hub's own practice table. */
(() => {
  'use strict';
  const root = document.getElementById('pr');
  if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayWord = (d) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  let D = null;
  const last = { gift: null, call: null };
  const draft = { gift: {}, call: {} };

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
    D.entries.filter((e) => e.kind === 'gift' && e.ok).forEach((e) => rows.push({ date: e.fields.date, amount: Number(e.fields.amount), fund: e.fields.fund, type: e.fields.type + (e.fields.check ? ' ' + e.fields.check : ''), mine: true }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }
  function notes() {
    const rows = D.partner.notes.map((n) => ({ date: n.date, text: n.text, mine: false }));
    D.entries.filter((e) => e.kind === 'call' && e.ok).forEach((e) => rows.push({ date: e.at.slice(0, 10), text: `${e.fields.channel}. ${e.fields.summary} Next: ${e.fields.next}, due ${dayWord(e.fields.due)}.`, mine: true }));
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    return rows;
  }

  function partnerCard() {
    const p = D.partner;
    const total = history().reduce((s, g) => s + g.amount, 0);
    return `<section class="pr-card pr-partner" aria-label="The practice partner">
      <div class="pr-partner__top"><span class="pr-tag">Practice record</span><h2>${esc(p.name)}</h2><p>${esc(p.household)}</p></div>
      <dl class="pr-facts"><div><dt>Address</dt><dd>${esc(p.address)}</dd></div><div><dt>Phone</dt><dd>${esc(p.phone)}</dd></div><div><dt>Email</dt><dd>${esc(p.email)}</dd></div><div><dt>Partner since</dt><dd>${esc(dayWord(p.since))}</dd></div><div><dt>Given in total</dt><dd>${money(total)}</dd></div></dl>
      <h3>Gifts</h3>
      <ul class="pr-rows">${history().map((g) => `<li class="${g.mine ? 'is-mine' : ''}"><span>${esc(dayWord(g.date))}</span><b>${money(g.amount)}</b><span>${esc(g.fund)}</span><span>${esc(g.type)}${g.mine ? ' <i class="pr-you">You</i>' : ''}</span></li>`).join('')}</ul>
      <h3>Notes and contacts</h3>
      <ul class="pr-notes">${notes().map((n) => `<li class="${n.mine ? 'is-mine' : ''}"><span>${esc(dayWord(n.date))}${n.mine ? ' <i class="pr-you">You</i>' : ''}</span><p>${esc(n.text)}</p></li>`).join('')}</ul>
    </section>`;
  }

  function result(kind) {
    const r = last[kind];
    if (!r) return '';
    return `<div class="pr-result${r.ok ? ' is-ok' : ''}" role="status" aria-live="polite"><b>${r.ok ? 'Every field is right.' : 'Not yet. Fix the fields marked below and enter it again.'}</b><ul>${r.checks.map((c) => `<li class="${c.ok ? 'is-ok' : 'is-bad'}"><span aria-hidden="true">${c.ok ? '&#10003;' : '&#10005;'}</span><div><b>${esc(c.label)}</b>${c.ok ? '' : `<small>${esc(c.hint)}</small>`}</div></li>`).join('')}</ul></div>`;
  }

  function card(kind, form) {
    const s = D.scenarios[kind];
    const done = D.done[kind];
    return `<section class="pr-card pr-ex" data-kind="${kind}"><div class="pr-ex__h"><h2>${esc(s.title)}</h2>${done ? '<span class="pr-done">Done</span>' : ''}</div>
      <p class="pr-story">${esc(s.story)}</p>
      <ol class="pr-steps">${s.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <form class="pr-form" data-form="${kind}" novalidate>${form}<button type="submit" class="h-btn h-btn--primary">${kind === 'gift' ? 'Enter the gift' : 'Log the call'}</button></form>${result(kind)}</section>`;
  }

  function giftForm() {
    const v = draft.gift;
    return `<label>Date<input type="date" name="date" value="${esc(v.date || '')}" max="${today()}"></label>
      <label>Amount<input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(v.amount || '')}"></label>
      <label>Type<select name="type">${opts(D.giftTypes, v.type, 'Choose a type')}</select></label>
      <label>Check number<input type="text" name="check" inputmode="numeric" autocomplete="off" value="${esc(v.check || '')}"></label>
      <label class="pr-wide">Fund<select name="fund">${opts(D.funds, v.fund, 'Choose a fund')}</select></label>`;
  }
  function callForm() {
    const v = draft.call;
    return `<label>How you were in contact<select name="channel">${opts(D.channels, v.channel, 'Choose one')}</select></label>
      <label>Next step<select name="next">${opts(D.nextSteps, v.next, 'Choose one')}</select></label>
      <label class="pr-wide">Summary<textarea name="summary" rows="3" maxlength="600">${esc(v.summary || '')}</textarea></label>
      <label>Due date<input type="date" name="due" value="${esc(v.due || '')}" min="${today()}"></label>`;
  }

  function draw() {
    const all = D.done.all;
    root.removeAttribute('aria-busy');
    root.innerHTML = `<div class="pr-head"><div><h1>Practice</h1><p>A pretend partner and a pretend record. Nothing you enter here goes to Blackbaud or to a real partner.</p></div>
      <div class="pr-head__acts">${all ? '<span class="pr-done">Both exercises done</span>' : ''}<button type="button" class="h-btn h-btn--ghost" data-reset>Start over</button></div></div>
      ${D.ready ? '' : '<div class="pr-off" role="alert">Practice mode is not switched on yet. An admin needs to finish setting it up.</div>'}
      <div class="pr-grid">${partnerCard()}<div class="pr-side">${card('gift', giftForm())}${card('call', callForm())}</div></div>`;
  }

  root.addEventListener('input', (e) => {
    const f = e.target.closest('form[data-form]');
    if (f && e.target.name) draft[f.dataset.form][e.target.name] = e.target.value;
  });
  root.addEventListener('change', (e) => {
    const f = e.target.closest('form[data-form]');
    if (f && e.target.name) draft[f.dataset.form][e.target.name] = e.target.value;
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const d = await api('practice/' + kind, 'POST', draft[kind]);
      last[kind] = { ok: d.passed, checks: d.checks };
      D = Object.assign({}, D, d.state);
      if (d.passed) draft[kind] = {};
      draw();
      const r = root.querySelector(`.pr-ex[data-kind="${kind}"] .pr-result`);
      if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) { btn.disabled = false; alert(err.message); }
  });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-reset]')) return;
    if (!window.confirm('Clear everything you entered in the practice record?')) return;
    try {
      const d = await api('practice', 'DELETE');
      D = Object.assign({}, D, d);
      last.gift = null; last.call = null; draft.gift = {}; draft.call = {};
      draw();
    } catch (err) { alert(err.message); }
  });

  api('practice').then((d) => { D = d; draw(); }).catch((err) => {
    root.removeAttribute('aria-busy');
    root.innerHTML = `<div class="pr-head"><div><h1>Practice</h1></div></div><div class="pr-off" role="alert">${esc(err.message)}</div>`;
  });
})();
