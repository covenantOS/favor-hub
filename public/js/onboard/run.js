/* One onboarding or offboarding run: the checklist by phase, each step with its owner and due date, the HR file, the buttons for
   what FavorOS does itself, and for an exit what the person still owns. */
(() => {
  'use strict';
  const O = window.Onb;
  const root = document.getElementById('ob-run');
  if (!O || !root) return;
  const { esc, api, ic } = O;
  const id = new URLSearchParams(location.search).get('id') || '';
  const S = { d: null, owned: null, docsOpen: false, banner: null, err: '' };
  const DUTY = { hr: 'HR file and shared drive', directory: 'Staff directory and groups', whatsapp: 'WhatsApp', training: 'Training', tech: 'Technical access', overseer: 'Oversight' };
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return COLORS[Math.abs(h) % 7]; };
  const time = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  /* ------------------------------------------------------------------ pieces */
  function ownerChip(s) {
    const who = s.owner_email ? `${O.avatar(s.owner_email, 'sm')}<span>${esc(s.owner_name)}</span>` : '<span>Nobody</span>';
    const flag = s.fallback ? '<span class="ob-chip ob-chip--sun" title="No owner is set for this duty, so the step went to whoever started the run">No owner set</span>' : '';
    return S.d.can.manage && S.d.run.status === 'active'
      ? `<button type="button" class="ob-owner" data-act="owner" aria-label="Change the owner, now ${esc(s.owner_name || 'nobody')}">${who}</button>${flag}`
      : `<span class="ob-owner ob-owner--static">${who}</span>${flag}`;
  }

  function dueChip(s) {
    if (!s.due_date) return S.d.can.manage ? '<button type="button" class="ob-due" data-act="due">Set a date</button>' : '';
    const cls = s.overdue ? ' is-late' : '';
    const word = (s.overdue ? 'Late, ' : 'Due ') + O.dayWord(s.due_date);
    return S.d.can.manage && S.d.run.status === 'active' ? `<button type="button" class="ob-due${cls}" data-act="due" aria-label="${esc(word)}, change the date">${esc(word)}</button>` : `<span class="ob-due${cls}">${esc(word)}</span>`;
  }

  function docsBlock(s) {
    if (s.key !== 'file' || !S.d.docs.length) return '';
    const got = S.d.docs.filter((x) => x.got).length;
    const can = S.d.can.manage || s.mine;
    return `<details class="ob-docs"${S.docsOpen ? ' open' : ''}><summary>HR file, ${got} of ${S.d.docs.length} received</summary><ul>${S.d.docs
      .map((x) => `<li><label class="ob-check"><input type="checkbox" data-doc="${esc(x.key)}"${x.got ? ' checked' : ''}${can ? '' : ' disabled'} /> ${esc(x.label)}</label></li>`)
      .join('')}</ul></details>`;
  }

  function autoAction(s) {
    if (s.kind !== 'auto' || s.status !== 'open' || !S.d.can.manage || S.d.run.status !== 'active') return '';
    if (s.key === 'hubadd') return `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="hubadd">${ic('spark')}Add to FavorOS</button>`;
    if (s.key === 'hubclose') return `<button type="button" class="h-btn h-btn--primary h-btn--sm ob-danger" data-act="hubclose">${ic('door')}Close FavorOS access</button>`;
    if (s.key === 'handover') return `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="handover">${ic('user')}Hand over open work</button>`;
    return '';
  }

  function stepRow(s) {
    const run = S.d.run;
    const closed = run.status !== 'active';
    const canTick = !closed && (S.d.can.manage || s.mine) && !(s.kind === 'auto' && !S.d.can.manage);
    const tickTitle = s.status === 'done' ? 'Marked done. Press to reopen' : 'Mark done';
    const link = s.link_url ? `<a class="ob-link" href="${esc(s.link_url)}"${/^https?:/.test(s.link_url) ? ' target="_blank" rel="noopener"' : ''}>${ic('link')}${esc(s.link_label || 'Open')}</a>` : '';
    const code = '';
    const skip = S.d.can.manage && !closed && s.status === 'open' ? '<button type="button" class="ob-ghost" data-act="skip">Skip</button>' : s.status === 'skipped' && S.d.can.manage && !closed ? '<button type="button" class="ob-ghost" data-act="reopen">Bring back</button>' : '';
    return `<li class="ob-step${s.status === 'done' ? ' is-done' : ''}${s.status === 'skipped' ? ' is-skip' : ''}${s.overdue ? ' is-late' : ''}" data-id="${esc(s.id)}" data-key="${esc(s.key)}">
      <button type="button" class="ob-tick" data-act="tick" aria-pressed="${s.status === 'done'}" aria-label="${esc(tickTitle)}: ${esc(s.title)}"${canTick ? '' : ' disabled'}>${ic('check')}</button>
      <div class="ob-step__body">
        <div class="ob-step__title"><span>${esc(s.title)}</span>${s.status === 'skipped' ? '<span class="ob-chip">Skipped</span>' : ''}${code}</div>
        ${s.detail ? `<p class="ob-step__detail">${esc(s.detail)}</p>` : ''}
        ${docsBlock(s)}
        <div class="ob-step__meta">${ownerChip(s)}${dueChip(s)}${link}${autoAction(s)}${skip}</div>
        ${s.done_at && s.status === 'done' ? `<small class="ob-step__done">Done ${esc(time(s.done_at))}${s.done_by ? ' by ' + esc(O.nameOf(s.done_by)) : ''}</small>` : ''}
      </div></li>`;
  }

  function groups() {
    return S.d.groups
      .map((g) => {
        const list = S.d.steps.filter((s) => s.grp === g.key);
        if (!list.length) return '';
        const done = list.filter((s) => s.status === 'done').length;
        return `<section class="ob-grp"><h2>${esc(g.label)} <span>${done} of ${list.filter((s) => s.status !== 'skipped').length}</span></h2><ul class="ob-steps">${list.map(stepRow).join('')}</ul></section>`;
      })
      .join('');
  }

  function ownedCard() {
    const o = S.owned;
    if (!o || S.d.run.kind !== 'offboard') return '';
    const row = (n, l) => `<div class="ob-own__n"><b>${n}</b><span>${l}</span></div>`;
    const list = (title, items, fmt) => (items.length ? `<h4>${title}</h4><ul class="ob-own__list">${items.slice(0, 6).map(fmt).join('')}${items.length > 6 ? `<li class="mute">and ${items.length - 6} more</li>` : ''}</ul>` : '');
    return `<section class="ob-card"><h3>Still theirs</h3><div class="ob-own">${row(o.counts.tasks, 'open tasks')}${row(o.counts.requests, 'request cards')}${row(o.counts.reports, 'direct reports')}${row(o.learn, 'in Learn')}</div>
      ${list('Tasks', o.tasks, (t) => `<li>${t.code ? `<span class="ob-chip ob-chip--mono">${esc(t.code)}</span> ` : ''}${esc(t.title)}</li>`)}
      ${list('Request cards', o.requests, (r) => `<li>${esc(r.title)}</li>`)}
      ${list('Direct reports', o.reports, (r) => `<li>${esc(r.name)}</li>`)}
      ${S.d.can.manage && S.d.run.status === 'active' && (o.counts.tasks || o.counts.requests || o.counts.reports) ? '<button type="button" class="rt-btn rt-btn--sm" data-act="handover">Hand over</button>' : ''}
      <p class="ob-note">Blackbaud assignments and partners are a step on the list. Credit for gifts dated in their time stays with them.</p></section>`;
  }

  function aside() {
    const d = S.d;
    const r = d.run;
    const person = (e, why) => (e && d.people[e] ? `<li>${O.avatar(e, 'sm')}<span><b>${esc(d.people[e].name)}</b><small>${esc(why)}</small></span></li>` : '');
    const welcome = r.kind === 'onboard'
      ? `<section class="ob-card"><h3>First-day note</h3>${d.can.manage && r.status === 'active' ? `<textarea class="ob-in" id="ob-welcome" rows="4" maxlength="1200" aria-label="Note on the first-day page">${esc(r.welcome)}</textarea><button type="button" class="rt-btn rt-btn--sm" data-act="savewelcome">Save the note</button>` : `<p>${esc(r.welcome) || 'No note.'}</p>`}</section>`
      : '';
    const link = r.kind === 'onboard' ? `<a class="ob-link" href="/welcome/">${ic('link')}First-day page</a>` : '';
    return `<aside class="ob-side">
      <section class="ob-card"><h3>People</h3><ul class="ob-people">${person(r.email, r.kind === 'onboard' ? 'Starting' : 'Leaving')}${person(r.supervisor_email, 'Supervisor')}${person(r.created_by, 'Started the run')}</ul>${link}</section>
      ${welcome}${ownedCard()}
      <section class="ob-card"><h3>History</h3><ul class="ob-log">${d.events.slice(0, 12).map((e) => `<li><span>${esc(e.actor)} ${esc(e.event)}${e.detail && e.detail[0] !== '{' ? ': ' + esc(e.detail.slice(0, 80)) : ''}</span><small>${esc(time(e.at))}</small></li>`).join('') || '<li class="mute">Nothing yet.</li>'}</ul></section>
    </aside>`;
  }

  function draw() {
    const d = S.d;
    const r = d.run;
    const closed = r.status !== 'active';
    const state = r.status === 'done' ? '<span class="ob-chip ob-chip--leaf">Finished</span>' : r.status === 'cancelled' ? '<span class="ob-chip">Cancelled</span>' : '';
    const banner = S.banner ? `<div class="ob-banner" role="status"><b>${esc(S.banner.title)}</b>${S.banner.lines.map((l) => `<p>${esc(l)}</p>`).join('')}<button type="button" class="ob-x" data-act="banner" aria-label="Dismiss">${ic('x')}</button></div>` : '';
    root.removeAttribute('aria-busy'); root.innerHTML = `<a class="ob-backlink" href="/onboarding/">${ic('back')}Onboarding</a>
      <header class="ob-rhead"><span class="rq-av ob-rhead__av" data-c="${hue(r.email)}">${esc(initials(r.name))}</span>
        <div class="ob-rhead__t"><h1>${esc(r.name)}</h1><p>${esc([r.title, r.team].filter(Boolean).join(' · ') || r.email)}</p>
          <div class="ob-rhead__chips"><span class="ob-chip ob-chip--${r.kind === 'offboard' ? 'sun' : 'sky'}">${O.kindWord(r.kind)}</span><span class="ob-chip">${esc(O.dateWord(r))}</span>${r.stays ? '<span class="ob-chip">Stays as a volunteer</span>' : ''}${state}</div></div>
        <div class="ob-rhead__p"><span class="ob-bar ob-bar--lg" role="progressbar" aria-valuenow="${O.pct(d.progress.done, d.progress.total)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${O.pct(d.progress.done, d.progress.total)}%"></i></span><small>${d.progress.done} of ${d.progress.total} done</small>
          ${d.can.manage && !closed ? '<div class="ob-rhead__acts"><button type="button" class="rt-btn rt-btn--sm" data-act="addstep">' + ic('plus') + 'Add a step</button><button type="button" class="rt-btn rt-btn--sm rt-btn--ghost" data-act="cancel">Cancel</button></div>' : ''}</div></header>
      ${banner}<p class="ob-err ob-err--page" role="alert"${S.err ? '' : ' hidden'}>${esc(S.err)}</p>
      <div class="ob-cols"><div class="ob-main">${groups()}</div>${aside()}</div>`;
  }

  /* ------------------------------------------------------------------ actions */
  async function act(promise) {
    S.err = '';
    try {
      const out = await promise;
      if (out && out.run) S.d = out;
      if (out && out.owned) S.owned = out.owned;
      draw();
      return out;
    } catch (e) {
      S.err = e.message;
      draw();
      O.toast(e.message, true);
      return null;
    }
  }

  const stepOf = (el) => S.d.steps.find((s) => s.id === el.closest('.ob-step').dataset.id);
  const patch = (s, body) => act(api(`runs/${id}/steps/${s.id}`, { method: 'PATCH', body }));

  async function hubAddSheet() {
    const r = S.d.run;
    const first = O.first(r.name);
    const dues = [['New hire: FavorOS', 7], ['New hire: Favor', 14]].map(([t, n]) => {
      const x = S.d.steps.find((s) => s.key === (n === 7 ? 'ospath' : 'favpath'));
      return `${t}${x && x.due_date ? ', due ' + O.dayWord(x.due_date) : ''}`;
    });
    const sup = r.supervisor_email && S.d.people[r.supervisor_email] ? S.d.people[r.supervisor_email].name : '';
    const body = `<p class="ob-p">FavorOS makes these changes for ${esc(r.name)} (${esc(r.email)}).</p><ul class="ob-do">
      <li>A FavorOS account, so they can sign in with their Favor Google account</li><li>A place on the staff list in pickers and Chat</li>
      <li>${sup ? 'Supervisor ' + esc(sup) + ' and ' : ''}start date ${esc(O.dayWord(r.date, true))}</li><li>The default Chat channels</li>${dues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <label class="ob-check"><input type="checkbox" id="ob-mailhire" checked /> Email ${esc(first)} the link to the first-day page</label>`;
    const go = await O.sheet({ title: 'Add to FavorOS', body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Add to FavorOS', primary: true }],
      onButton: (b, el, close) => close(b === 'yes' ? { mail: el.querySelector('#ob-mailhire').checked } : null) });
    if (!go) return;
    const out = await act(api(`runs/${id}/hub`, { method: 'POST', body: { action: 'add', confirm: true, emailWelcome: go.mail } }));
    if (out && out.result) resultSheet('FavorOS is ready for ' + first, out.result.items);
  }

  function resultSheet(title, items) {
    const body = `<ul class="ob-res">${items.map((i) => `<li class="is-${i.state}"><span>${i.state === 'done' ? ic('check') : i.state === 'failed' ? ic('x') : ic('chev')}</span><div><b>${esc(i.what)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ''}</div></li>`).join('')}</ul>`;
    return O.sheet({ title, body, buttons: [{ id: 'ok', label: 'Done', primary: true }] });
  }

  async function hubCloseSheet() {
    const r = S.d.run;
    const body = `<p class="ob-p">Do this on ${esc(O.dayWord(r.date, true))}, ${esc(r.name)}’s last day.</p><ul class="ob-do">
      <li>Blocks the FavorOS account and ends every open sign-in</li><li>Removes the Google link</li><li>Takes them off the staff list in pickers and Chat</li><li>Closes their assignments in Learn</li></ul>
      <p class="ob-p">Their tasks and request cards stay where they are until you hand them over. The Google account, Blackbaud and the other systems are separate steps on the list.</p>
      <label class="ob-check"><input type="checkbox" id="ob-sure" /> ${esc(r.name)} is leaving and their FavorOS access should close</label>`;
    const go = await O.sheet({ title: 'Close FavorOS access', body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Close access', primary: true, danger: true, disabled: true }],
      onOpen: (el) => { const c = el.querySelector('#ob-sure'); const b = el.querySelector('[data-ob-btn="yes"]'); c.addEventListener('change', () => { b.disabled = !c.checked; }); },
      onButton: (b, el, close) => close(b === 'yes' ? true : null) });
    if (!go) return;
    const out = await act(api(`runs/${id}/hub`, { method: 'POST', body: { action: 'close', confirm: true } }));
    if (out && out.result) resultSheet('FavorOS access closed', out.result.items);
  }

  async function handOverSheet() {
    const r = S.d.run;
    const pick = await window.ReqTasks.pick({ title: 'Who takes over their work', exclude: [r.email] });
    if (!pick || !pick.email) return;
    const o = S.owned || { counts: { tasks: 0, requests: 0, reports: 0 } };
    const to = window.ReqTasks.person(pick.email).name;
    const row = (k, n, l) => `<label class="ob-check"><input type="checkbox" data-w="${k}" checked${n ? '' : ' disabled'} /> ${n} ${l}</label>`;
    const body = `<p class="ob-p">Move to ${esc(to)}. Nothing is deleted.</p>${row('tasks', o.counts.tasks, 'open tasks in Projects')}${row('requests', o.counts.requests, 'request cards')}${row('reports', o.counts.reports, 'people who report to them, so their supervisor changes')}`;
    const go = await O.sheet({ title: 'Hand over open work', body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Hand over', primary: true }],
      onButton: (b, el, close) => close(b === 'yes' ? { tasks: el.querySelector('[data-w=tasks]').checked, requests: el.querySelector('[data-w=requests]').checked, reports: el.querySelector('[data-w=reports]').checked } : null) });
    if (!go) return;
    const out = await act(api(`runs/${id}/handover`, { method: 'POST', body: { to: pick.email, ...go } }));
    if (out && out.moved) O.toast(`Moved ${out.moved.tasks} tasks, ${out.moved.requests} request cards, ${out.moved.reports} reports to ${to}`);
  }

  async function dueSheet(s) {
    const body = `<label class="ob-lab">Due date<input class="ob-in" type="date" id="ob-due" value="${esc(s.due_date || '')}" /></label>`;
    const go = await O.sheet({ title: s.title, body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Save', primary: true }], onButton: (b, el, close) => close(b === 'yes' ? el.querySelector('#ob-due').value : null) });
    if (go !== null && go !== undefined) patch(s, { due_date: go || null });
  }

  async function addStepSheet() {
    const body = `<form class="ob-form" novalidate><p class="ob-err" role="alert" hidden></p><label class="ob-lab">Step<input class="ob-in" name="title" maxlength="160" required /></label>
      <label class="ob-lab">Detail<textarea class="ob-in" name="detail" rows="3" maxlength="800"></textarea></label>
      <div class="ob-lab">Owner<div data-pf="owner"></div></div>
      <div class="ob-2"><label class="ob-lab">Due date<input class="ob-in" name="due" type="date" /></label><label class="ob-lab">Phase<select class="ob-in" name="grp">${S.d.groups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join('')}</select></label></div></form>`;
    let pf = null;
    const r = await O.sheet({ title: 'Add a step', body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Add the step', primary: true }],
      onOpen: (el) => { pf = O.personField(el.querySelector('[data-pf]'), { label: 'Owner', placeholder: 'You, if left empty' }); },
      onButton: async (b, el, close) => {
        if (b === 'no') { close(null); return; }
        const f = el.querySelector('form'); const err = el.querySelector('.ob-err');
        try { close(await api(`runs/${id}/steps`, { method: 'POST', body: { title: f.elements.title.value, detail: f.elements.detail.value, owner_email: pf.get(), due_date: f.elements.due.value, grp: f.elements.grp.value } })); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
      } });
    if (r && r.run) { S.d = r; draw(); O.toast('Step added'); }
  }

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'banner') { S.banner = null; draw(); return; }
    if (a === 'addstep') return addStepSheet();
    if (a === 'hubadd') return hubAddSheet();
    if (a === 'hubclose') return hubCloseSheet();
    if (a === 'handover') return handOverSheet();
    if (a === 'savewelcome') { act(api(`runs/${id}`, { method: 'PATCH', body: { welcome: document.getElementById('ob-welcome').value } })).then(() => O.toast('Saved')); return; }
    if (a === 'cancel') {
      const go = await O.sheet({ title: 'Cancel this run', body: '<p class="ob-p">The record stays. Open tasks in Projects are dropped.</p>', buttons: [{ id: 'no', label: 'Keep it' }, { id: 'yes', label: 'Cancel the run', primary: true, danger: true }] });
      if (go === 'yes') { await act(api(`runs/${id}`, { method: 'PATCH', body: { status: 'cancelled' } })); }
      return;
    }
    const s = e.target.closest('.ob-step') ? stepOf(b) : null;
    if (!s) return;
    if (a === 'tick') return patch(s, { status: s.status === 'done' ? 'open' : 'done' });
    if (a === 'skip') return patch(s, { status: 'skipped' });
    if (a === 'reopen') return patch(s, { status: 'open' });
    if (a === 'due') return dueSheet(s);
    if (a === 'owner') {
      const p = await window.ReqTasks.pick({ title: 'Who owns this step', current: s.owner_email });
      if (p && p.email) patch(s, { owner_email: p.email });
    }
  });

  root.addEventListener('change', (e) => {
    const c = e.target.closest('[data-doc]');
    if (!c) return;
    S.docsOpen = true;
    act(api(`runs/${id}/docs/${encodeURIComponent(c.dataset.doc)}`, { method: 'PUT', body: { got: c.checked } }));
  });

  /* ------------------------------------------------------------------ load */
  async function load() {
    if (!id) { root.removeAttribute('aria-busy'); root.innerHTML = '<div class="ob-empty"><p>Pick a run from the Onboarding page.</p><a class="h-btn h-btn--primary" href="/onboarding/">Open Onboarding</a></div>'; return; }
    try {
      await window.ReqTasks.people();
      S.d = await api('runs/' + encodeURIComponent(id));
    } catch (e) {
      root.removeAttribute('aria-busy'); root.innerHTML = `<div class="ob-empty"><p>${esc(e.status === 403 ? 'This onboarding is for HR, the supervisor and the people who own its steps.' : e.status === 404 ? 'No such onboarding.' : e.message)}</p><a class="h-btn h-btn--primary" href="/onboarding/">Open Onboarding</a></div>`;
      return;
    }
    try {
      const n = JSON.parse(sessionStorage.getItem('ob-new') || 'null');
      if (n && n.id === id) {
        sessionStorage.removeItem('ob-new');
        const lines = [`${n.steps} steps, each with an owner and a due date${S.d.tasks ? ', and each one a task in Projects' : ''}.`];
        if (n.unset && n.unset.length) lines.push(`No owner is set for ${n.unset.map((k) => DUTY[k] || k).join(', ')}. Those steps went to you. Set owners on the Onboarding page, under Owners.`);
        S.banner = { title: `${S.d.run.kind === 'offboard' ? 'Offboarding' : 'Onboarding'} started for ${S.d.run.name}`, lines };
      }
    } catch (e) { /* no banner */ }
    document.title = S.d.run.name + ' - Onboarding - FavorOS';
    draw();
    if (S.d.run.kind === 'offboard' && S.d.can.manage) {
      try { S.owned = (await api(`runs/${id}/owned`)).owned; draw(); } catch (e) { /* the panel stays out */ }
    }
  }
  O.ready().then(load);
})();
