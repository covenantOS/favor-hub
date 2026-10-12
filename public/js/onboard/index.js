/* Onboarding: the list of runs in progress, the start sheet, the checklist template and the duty owners. */
(() => {
  'use strict';
  const O = window.Onb;
  const root = document.getElementById('ob-root');
  if (!O || !root) return;
  const { esc, api, ic } = O;
  const S = { can: { manage: false }, runs: [], done: null, owners: {}, duties: [], tab: 'active', tplKind: 'onboard', tpl: null, loading: true };

  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return COLORS[Math.abs(h) % 7]; };

  /* ------------------------------------------------------------------ the list */
  function runCard(r) {
    const late = r.late ? `<span class="ob-chip ob-chip--red">${r.late} late</span>` : '';
    const next = r.status === 'active' && r.next ? `<small class="ob-run__next">Next: ${esc(r.next.title)}${r.next.due ? ', ' + esc(O.dayWord(r.next.due)) : ''}</small>` : '';
    const state = r.status === 'done' ? '<span class="ob-chip ob-chip--leaf">Finished</span>' : r.status === 'cancelled' ? '<span class="ob-chip">Cancelled</span>' : '';
    return `<a class="ob-run" href="/onboarding/run/?id=${encodeURIComponent(r.id)}">
      <span class="rq-av" data-c="${hue(r.email)}">${esc(initials(r.name))}</span>
      <span class="ob-run__main"><b>${esc(r.name)}</b><span>${esc([r.title, r.team].filter(Boolean).join(' · ') || r.email)}</span>${next}</span>
      <span class="ob-run__meta"><span class="ob-chip ob-chip--${r.kind === 'offboard' ? 'sun' : 'sky'}">${O.kindWord(r.kind)}</span><span class="ob-chip">${esc(O.dateWord(r))}</span>${late}${state}</span>
      <span class="ob-run__prog"><span class="ob-bar" role="progressbar" aria-valuenow="${O.pct(r.done, r.steps)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${O.pct(r.done, r.steps)}%"></i></span><small>${r.done} of ${r.steps} done</small></span>
    </a>`;
  }

  function listPanel(runs, empty) {
    if (!runs.length) return `<div class="ob-empty"><p>${esc(empty)}</p>${S.can.manage && S.tab === 'active' ? '<button type="button" class="h-btn h-btn--primary" data-ob-start="onboard">Start onboarding</button>' : ''}</div>`;
    return `<div class="ob-runs">${runs.map(runCard).join('')}</div>`;
  }

  /* ------------------------------------------------------------------ the checklist */
  const DUTY_WORD = { supervisor: 'The supervisor', hire: 'The new hire', starter: 'Whoever starts the run' };
  function tplPanel() {
    const t = S.tpl;
    if (!t) return '<div class="ob-empty"><p>Loading the checklist.</p></div>';
    const duties = t.duties;
    const dayLabel = S.tplKind === 'onboard' ? 'start date' : 'last day';
    const byGroup = t.groups.map((g) => ({ g, steps: t.steps.filter((s) => s.grp === g.key).sort((a, b) => a.sort - b.sort) }));
    return `<div class="ob-tplbar"><div class="ob-seg" role="tablist" aria-label="Checklist">
        <button type="button" role="tab" aria-selected="${S.tplKind === 'onboard'}" class="${S.tplKind === 'onboard' ? 'is-on' : ''}" data-tpl-kind="onboard">Onboarding</button>
        <button type="button" role="tab" aria-selected="${S.tplKind === 'offboard'}" class="${S.tplKind === 'offboard' ? 'is-on' : ''}" data-tpl-kind="offboard">Offboarding</button></div>
        <span class="ob-saved" id="ob-saved" role="status"></span>
        <button type="button" class="rt-btn rt-btn--sm" data-tpl-add>${ic('plus')}Add a step</button>
        <button type="button" class="rt-btn rt-btn--sm rt-btn--ghost" data-tpl-reset${t.steps.some((s) => s.edited) ? '' : ' disabled'}>Back to the built-in list</button></div>
      ${byGroup.map(({ g, steps }) => `<section class="ob-tgrp"><h3>${esc(g.label)}</h3>${steps.map((s) => `
        <div class="ob-trow${s.active ? '' : ' is-off'}" data-key="${esc(s.key)}">
          <input class="ob-in ob-trow__title" data-f="title" value="${esc(s.title)}" maxlength="160" aria-label="Step title" />
          <textarea class="ob-in ob-trow__detail" data-f="detail" rows="2" maxlength="800" aria-label="Step detail">${esc(s.detail)}</textarea>
          <div class="ob-trow__meta">
            <label>Owner<select class="ob-in" data-f="duty">${duties.map((d) => `<option value="${esc(d.key)}"${d.key === s.duty ? ' selected' : ''}>${esc(DUTY_WORD[d.key] || d.label)}</option>`).join('')}</select></label>
            <label>Days from ${dayLabel}<input class="ob-in" type="number" data-f="offset_days" min="-120" max="365" value="${s.offset_days}" /></label>
            <label>Phase<select class="ob-in" data-f="grp">${t.groups.map((x) => `<option value="${esc(x.key)}"${x.key === s.grp ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
            <label class="ob-check"><input type="checkbox" data-f="active"${s.active ? ' checked' : ''} /> Include</label>
          </div>
        </div>`).join('')}</section>`).join('')}`;
  }

  /* ------------------------------------------------------------------ owners */
  function ownersPanel() {
    return `<div class="ob-owners">${S.duties
      .map((d) => `<div class="ob-orow"><div><b>${esc(d.label)}</b><small>${esc(d.hint)}</small></div><div data-owner="${esc(d.key)}"></div></div>`)
      .join('')}<p class="ob-note">A duty with no owner sends its steps to whoever starts the run.</p></div>`;
  }

  /* ------------------------------------------------------------------ the page */
  function counts() {
    const on = S.runs.filter((r) => r.kind === 'onboard').length;
    const off = S.runs.filter((r) => r.kind === 'offboard').length;
    return { on, off };
  }

  function draw() {
    const c = counts();
    const lede = S.loading ? '' : `${c.on} onboarding and ${c.off} offboarding in progress.`;
    const tabs = [['active', `In progress <span>${S.runs.length}</span>`], ['done', 'Finished']].concat(S.can.manage ? [['checklist', 'Checklist'], ['owners', 'Owners']] : []);
    root.removeAttribute('aria-busy'); root.innerHTML = `<header class="ob-head"><div><h1>Onboarding</h1><p class="h-lede">${lede}</p></div>
      ${S.can.manage ? `<div class="ob-head__acts"><button type="button" class="h-btn h-btn--primary" id="ob-start" data-ob-start="onboard">${ic('plus')}Start onboarding</button><button type="button" class="h-btn h-btn--ghost" data-ob-start="offboard">${ic('door')}Start offboarding</button></div>` : ''}</header>
      <div class="ob-tabs" role="tablist" aria-label="Onboarding">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${S.tab === k}" class="${S.tab === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
      <div id="ob-panel" aria-live="polite">${S.loading ? '<div class="ob-skel"></div><div class="ob-skel"></div>' : S.tab === 'active' ? listPanel(S.runs, 'No onboarding or offboarding in progress.') : S.tab === 'done' ? listPanel(S.done || [], S.done ? 'Nothing finished yet.' : 'Loading.') : S.tab === 'checklist' ? tplPanel() : ownersPanel()}</div>`;
    if (S.tab === 'owners' && !S.loading) {
      root.querySelectorAll('[data-owner]').forEach((el) => {
        const duty = el.dataset.owner;
        O.personField(el, {
          value: S.owners[duty] || '',
          label: duty,
          placeholder: 'Nobody yet',
          onChange: async (email) => {
            try { await api('owners', { method: 'PUT', body: { duty, email } }); S.owners[duty] = email; O.toast('Saved'); } catch (e) { O.toast(e.message, true); }
          },
        });
      });
    }
  }

  async function load() {
    try {
      const d = await api('');
      S.can = d.can; S.runs = d.runs; S.owners = d.owners; S.duties = d.duties;
    } catch (e) {
      root.removeAttribute('aria-busy'); root.innerHTML = `<div class="ob-empty"><p>${esc(e.status === 503 ? 'Onboarding is not switched on yet.' : e.message)}</p></div>`;
      return;
    }
    S.loading = false;
    const want = location.hash.replace('#', '');
    if (['done', 'checklist', 'owners'].includes(want) && (want === 'done' || S.can.manage)) S.tab = want;
    await tabData();
    draw();
  }

  async function tabData() {
    if (S.tab === 'done' && !S.done) S.done = (await api('?status=done')).runs;
    if (S.tab === 'checklist') S.tpl = await api('template?kind=' + S.tplKind);
    if (S.tab === 'owners') await (window.ReqTasks && window.ReqTasks.people());
  }

  /* ------------------------------------------------------------------ start */
  async function startSheet(kind, pre = {}) {
    await window.ReqTasks.people();
    const people = window.ReqTasks.list();
    const teams = [...new Set(people.map((p) => p.team).filter(Boolean))].sort();
    const monday = (() => { const d = new Date(O.today() + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1); return d.toISOString().slice(0, 10); })();
    let mode = kind;
    const body = () => mode === 'onboard'
      ? `<form class="ob-form" novalidate><p class="ob-err" role="alert" hidden></p>
          <label class="ob-lab">Name<input class="ob-in" name="name" autocomplete="off" maxlength="120" value="${esc(pre.name || '')}" required /></label>
          <label class="ob-lab">Favor email<input class="ob-in" name="email" type="email" inputmode="email" autocapitalize="none" autocomplete="off" placeholder="name@favorintl.org" value="${esc(pre.email || '')}" required /></label>
          <div class="ob-2"><label class="ob-lab">Role<input class="ob-in" name="title" autocomplete="off" maxlength="120" /></label>
          <label class="ob-lab">Team<input class="ob-in" name="team" list="ob-teams" autocomplete="off" maxlength="80" /><datalist id="ob-teams">${teams.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist></label></div>
          <div class="ob-lab">Supervisor<div data-pf="supervisor"></div></div>
          <label class="ob-lab">Start date<input class="ob-in" name="date" type="date" value="${monday}" required /></label>
          <label class="ob-check"><input type="checkbox" name="hq" checked /> Works at headquarters (door code, tour, devotions)</label>
          <label class="ob-lab">Note on the first-day page<textarea class="ob-in" name="welcome" rows="3" maxlength="1200"></textarea></label></form>`
      : `<form class="ob-form" novalidate><p class="ob-err" role="alert" hidden></p>
          <div class="ob-lab">Person leaving<div data-pf="who"></div></div>
          <div class="ob-lab">Supervisor<div data-pf="supervisor"></div></div>
          <label class="ob-lab">Last day<input class="ob-in" name="date" type="date" value="${O.today()}" required /></label>
          <label class="ob-check"><input type="checkbox" name="stays" /> Stays on as a volunteer, accounts stay open</label></form>`;
    let pfs = {};
    const wire = (el) => {
      pfs = {};
      el.querySelectorAll('[data-pf]').forEach((h) => { pfs[h.dataset.pf] = O.personField(h, { label: h.dataset.pf, placeholder: h.dataset.pf === 'who' ? 'Search by name' : 'Search by name or team' }); });
    };
    const result = await O.sheet({
      title: kind === 'onboard' ? 'Start onboarding' : 'Start offboarding',
      body: body(),
      buttons: [{ id: 'cancel', label: 'Cancel' }, { id: 'go', label: kind === 'onboard' ? 'Start onboarding' : 'Start offboarding', primary: true }],
      onOpen: (el) => { wire(el); if (mode === 'offboard' && pre.email && pfs.who) pfs.who.set(pre.email); const f = el.querySelector('input'); if (f && !matchMedia('(max-width: 860px)').matches) f.focus(); },
      onButton: async (id, el, close) => {
        if (id === 'cancel') { close(null); return; }
        const f = el.querySelector('form');
        const err = el.querySelector('.ob-err');
        const v = (n) => (f.elements[n] ? f.elements[n].value.trim() : '');
        const payload = { kind: mode, date: v('date'), supervisor_email: pfs.supervisor ? pfs.supervisor.get() : '' };
        if (mode === 'onboard') Object.assign(payload, { name: v('name'), email: v('email').toLowerCase(), title: v('title'), team: v('team'), hq: f.elements.hq.checked, welcome: v('welcome') });
        else {
          const who = pfs.who && pfs.who.get();
          const p = who ? window.ReqTasks.person(who) : null;
          Object.assign(payload, { email: who || '', name: p ? p.name : '', title: p ? p.title : '', team: p ? p.team : '', stays: f.elements.stays.checked });
        }
        const btn = el.querySelector('[data-ob-btn="go"]');
        btn.disabled = true;
        err.hidden = true;
        try {
          const r = await api('runs', { method: 'POST', body: payload });
          close({ run: r.run, unset: r.unset, steps: r.steps.length });
        } catch (e) {
          btn.disabled = false;
          err.textContent = e.message;
          err.hidden = false;
          err.scrollIntoView({ block: 'nearest' });
        }
      },
    });
    if (result && result.run) {
      sessionStorage.setItem('ob-new', JSON.stringify({ id: result.run.id, unset: result.unset, steps: result.steps }));
      location.href = '/onboarding/run/?id=' + encodeURIComponent(result.run.id);
    }
  }

  /* ------------------------------------------------------------------ events */
  root.addEventListener('click', async (e) => {
    const start = e.target.closest('[data-ob-start]');
    if (start) { startSheet(start.dataset.obStart); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      S.tab = tab.dataset.tab;
      history.replaceState(null, '', S.tab === 'active' ? location.pathname : '#' + S.tab);
      try { await tabData(); } catch (err) { O.toast(err.message, true); }
      draw();
      return;
    }
    const kind = e.target.closest('[data-tpl-kind]');
    if (kind) { S.tplKind = kind.dataset.tplKind; S.tpl = null; draw(); S.tpl = await api('template?kind=' + S.tplKind); draw(); return; }
    if (e.target.closest('[data-tpl-reset]')) {
      const go = await O.sheet({ title: 'Back to the built-in list', body: '<p class="ob-p">Your changes to this checklist are removed. Runs already started keep their steps.</p>', buttons: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Reset the list', primary: true }] });
      if (go === 'yes') { S.tpl = await api('template/reset', { method: 'POST', body: { kind: S.tplKind } }).then(async () => api('template?kind=' + S.tplKind)); draw(); O.toast('Reset'); }
      return;
    }
    if (e.target.closest('[data-tpl-add]')) {
      const t = S.tpl;
      const body = `<form class="ob-form" novalidate><p class="ob-err" role="alert" hidden></p><label class="ob-lab">Step<input class="ob-in" name="title" maxlength="160" required /></label>
        <label class="ob-lab">Detail<textarea class="ob-in" name="detail" rows="3" maxlength="800"></textarea></label>
        <div class="ob-2"><label class="ob-lab">Owner<select class="ob-in" name="duty">${t.duties.map((d) => `<option value="${esc(d.key)}">${esc(DUTY_WORD[d.key] || d.label)}</option>`).join('')}</select></label>
        <label class="ob-lab">Days from ${S.tplKind === 'onboard' ? 'start date' : 'last day'}<input class="ob-in" name="offset_days" type="number" value="0" /></label></div>
        <label class="ob-lab">Phase<select class="ob-in" name="grp">${t.groups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)}</option>`).join('')}</select></label></form>`;
      const r = await O.sheet({
        title: 'Add a step', body, buttons: [{ id: 'no', label: 'Cancel' }, { id: 'add', label: 'Add the step', primary: true }],
        onButton: async (id, el, close) => {
          if (id === 'no') { close(null); return; }
          const f = el.querySelector('form'); const err = el.querySelector('.ob-err');
          try {
            const out = await api('template', { method: 'PUT', body: { kind: S.tplKind, title: f.elements.title.value, detail: f.elements.detail.value, duty: f.elements.duty.value, offset_days: Number(f.elements.offset_days.value) || 0, grp: f.elements.grp.value } });
            close(out);
          } catch (x) { err.textContent = x.message; err.hidden = false; }
        },
      });
      if (r && r.steps) { S.tpl = await api('template?kind=' + S.tplKind); draw(); O.toast('Step added'); }
    }
  });

  // The checklist saves a field the moment it changes.
  let savedT = 0;
  root.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-f]');
    const row = e.target.closest('.ob-trow');
    if (!f || !row) return;
    const key = row.dataset.key;
    const field = f.dataset.f;
    const value = f.type === 'checkbox' ? f.checked : f.type === 'number' ? Number(f.value) || 0 : f.value;
    try {
      await api('template', { method: 'PUT', body: { kind: S.tplKind, key, [field]: value } });
      if (field === 'active') row.classList.toggle('is-off', !value);
      const s = document.getElementById('ob-saved');
      if (s) { s.textContent = 'Saved'; clearTimeout(savedT); savedT = setTimeout(() => { s.textContent = ''; }, 1800); }
      const rec = S.tpl && S.tpl.steps.find((x) => x.key === key);
      if (rec) { rec[field] = value; rec.edited = true; }
      const reset = root.querySelector('[data-tpl-reset]');
      if (reset) reset.disabled = false;
    } catch (err) { O.toast(err.message, true); }
  });

  O.ready().then(load).then(() => {
    // Admin > People links here with ?start=onboard|offboard&email=&name= to open the sheet for that person.
    const q = new URLSearchParams(location.search);
    const k = q.get('start');
    if (S.can.manage && (k === 'onboard' || k === 'offboard')) {
      startSheet(k, { email: q.get('email') || '', name: q.get('name') || '' });
      history.replaceState(null, '', location.pathname);
    }
  });
})();
