/* Plan a project: describe it in a sentence, get a draft with sections, tasks, owners and dates, edit it, then create it.
   Nothing is saved until Create. openPlanner() resolves to the created project, or null when dismissed. */
import { esc, icon, avatar, openSheet, toast, debounce, shortDate, todayStr, PRIORITY, phone } from './ui-util.js';
import { api, personOf, loadStaff } from './ui-data.js';
import { pickOwner } from './ui-pickers.js';
import { dropProjectsCache } from './quick-add.js';

const TEMPLATE_HINTS = [
  ['newsletter', 'Weekly newsletter'],
  ['appeal', 'Monthly appeal letter'],
  ['banquet', 'Banquet or hosted dinner'],
  ['grant', 'Grant application'],
  ['print', 'Print order'],
  ['church-newsletter', 'Church newsletter'],
];

export async function openPlanner({ prompt = '' } = {}) {
  await loadStaff();
  const st = { prompt, template: '', date: '', plan: null, warnings: [], busy: false };
  return new Promise((resolve) => {
    let result = null;
    const s = openSheet({ title: 'Plan a project', cls: 'pj-sheet--plan', html: '', onClose: () => resolve(result) });
    const body = s.body;
    const err = (m) => { const e = body.querySelector('[data-err]'); if (e) { e.textContent = m || ''; e.hidden = !m; } };

    /* ---------------------------------------------------------------- step 1: the sentence */
    function askView() {
      body.innerHTML = `<form class="pj-pl" data-ask autocomplete="off">
        <label class="pj-label" for="pl-prompt">What is the project?</label>
        <textarea id="pl-prompt" class="pj-field" rows="3" maxlength="600" placeholder="Banquet in Houston on December 6 for about 80 partners">${esc(st.prompt)}</textarea>
        <span class="pj-label">Start from</span>
        <div class="pj-chips" role="group" aria-label="Template">
          <button type="button" class="pj-fchipbtn${st.template ? '' : ' is-on'}" data-t="" aria-pressed="${!st.template}">Best match</button>
          ${TEMPLATE_HINTS.map(([id, label]) => `<button type="button" class="pj-fchipbtn${st.template === id ? ' is-on' : ''}" data-t="${id}" aria-pressed="${st.template === id}">${esc(label)}</button>`).join('')}
        </div>
        <label class="pj-label" for="pl-date">Date</label>
        <input id="pl-date" class="pj-field pj-pl__date" type="date" min="${todayStr()}" value="${esc(st.date)}" />
        <p class="pj-err" data-err hidden></p>
        <div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="submit" class="pj-btn pj-btn--primary" data-go>Draft plan</button></div>
      </form>`;
      setTimeout(() => { const t = body.querySelector('#pl-prompt'); if (t) t.focus(); }, 40);
    }
    body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ask] [data-t]');
      if (!t) return;
      st.template = t.dataset.t;
      body.querySelectorAll('[data-ask] [data-t]').forEach((b) => { const on = b === t; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
    });
    body.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-ask]');
      if (!f) return;
      e.preventDefault();
      st.prompt = body.querySelector('#pl-prompt').value.trim();
      st.date = body.querySelector('#pl-date').value;
      if (st.prompt.length < 3 && !st.template) { err('Describe the project in a sentence, or pick a template.'); return; }
      const go = body.querySelector('[data-go]');
      go.disabled = true;
      go.textContent = 'Drafting';
      try {
        const d = await api.planDraft({ prompt: st.prompt || TEMPLATE_HINTS.find((x) => x[0] === st.template)[1], template: st.template || undefined, date: st.date || undefined });
        st.plan = d.plan;
        st.warnings = d.warnings || [];
        planView();
      } catch (ex) {
        err(ex.message || 'The draft did not come back. Try again.');
        go.disabled = false;
        go.textContent = 'Draft plan';
      }
    });

    /* ---------------------------------------------------------------- step 2: the plan */
    const taskRow = (t, si, ki) => {
      const o = t.owner_email ? personOf(t.owner_email) : null;
      const warn = st.warnings.some((w) => w.email === t.owner_email && weekOf(t.due_date) === w.week);
      return `<li class="pj-pl__task${warn ? ' is-warn' : ''}" data-s="${si}" data-k="${ki}">
        <input class="pj-field pj-pl__title" data-f="title" type="text" maxlength="200" value="${esc(t.title)}" aria-label="Task" />
        <button type="button" class="rt-pchip pj-fbtn pj-pl__own" data-a="owner" aria-label="Owner">${avatar(o, 'sm')}<span>${esc(o ? o.name : 'No owner')}</span></button>
        <input class="pj-field pj-pl__due" data-f="due_date" type="date" value="${esc(t.due_date || '')}" aria-label="Due date" />
        <select class="pj-field pj-pl__pri" data-f="priority" aria-label="Priority">${['high', 'normal', 'low'].map((p) => `<option value="${p}"${t.priority === p ? ' selected' : ''}>${PRIORITY[p]}</option>`).join('')}</select>
        <button type="button" class="pj-ib pj-pl__rm" data-a="rm-task" aria-label="Remove task">${icon('x')}</button>
      </li>`;
    };
    function planView() {
      const p = st.plan;
      const total = p.sections.reduce((n, x) => n + x.tasks.length, 0);
      const lead = personOf(p.lead_email);
      body.innerHTML = `<form class="pj-pl" data-plan autocomplete="off">
        <label class="pj-label" for="pp-name">Name</label>
        <input id="pp-name" class="pj-field" data-p="name" type="text" maxlength="120" value="${esc(p.name)}" />
        <div class="pj-pf__row">
          <div class="pj-grow"><span class="pj-label">Lead</span><button type="button" class="rt-pchip pj-fbtn" data-a="lead">${avatar(lead)}<span>${esc(lead.name)}</span></button></div>
          <div class="pj-grow"><label class="pj-label" for="pp-team">Team</label><input id="pp-team" class="pj-field" data-p="team" type="text" maxlength="40" value="${esc(p.team)}" /></div>
          <div class="pj-grow"><label class="pj-label" for="pp-due">${esc(p.anchor_label || 'Date')}</label><input id="pp-due" class="pj-field" data-p="due_date" type="date" value="${esc(p.due_date || '')}" /></div>
        </div>
        <label class="pj-label" for="pp-desc">Description</label>
        <textarea id="pp-desc" class="pj-field" data-p="description" rows="2" maxlength="1000">${esc(p.description)}</textarea>
        <div class="pj-pl__warns" data-warns>${warnHtml()}</div>
        ${p.sections.map((sec, si) => `<section class="pj-pl__sec" data-sec="${si}">
          <div class="pj-pl__sech"><input class="pj-field pj-pl__secname" data-f="section" data-s="${si}" type="text" maxlength="80" value="${esc(sec.name)}" aria-label="Section name" /><button type="button" class="pj-ib" data-a="rm-sec" data-s="${si}" aria-label="Remove section">${icon('trash')}</button></div>
          <ul class="pj-pl__list">${sec.tasks.map((t, ki) => taskRow(t, si, ki)).join('')}</ul>
          <button type="button" class="pj-btn pj-pl__add" data-a="add-task" data-s="${si}">${icon('plus')}Add task</button>
        </section>`).join('')}
        <button type="button" class="pj-btn pj-pl__add" data-a="add-sec">${icon('plus')}Add section</button>
        <p class="pj-err" data-err hidden></p>
        <div class="pj-sheet__foot"><button type="button" class="pj-btn" data-a="back">Back</button><button type="submit" class="pj-btn pj-btn--primary" data-create>Create project with ${total} ${total === 1 ? 'task' : 'tasks'}</button></div>
      </form>`;
    }
    const weekOf = (d) => {
      if (!d) return '';
      const t = new Date(d + 'T12:00:00Z');
      return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
    };
    function warnHtml() {
      if (!st.warnings.length) return '';
      return `<div class="pj-pl__warn" role="status"><b>${icon('flag')}Heavy weeks</b><ul>${st.warnings.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul></div>`;
    }
    const total = () => st.plan.sections.reduce((n, x) => n + x.tasks.length, 0);
    const recount = () => { const c = body.querySelector('[data-create]'); if (c) c.textContent = `Create project with ${total()} ${total() === 1 ? 'task' : 'tasks'}`; };
    const recheck = debounce(async () => {
      try {
        const d = await api.planCheck(st.plan.sections.flatMap((x) => x.tasks));
        st.warnings = d.warnings || [];
        const w = body.querySelector('[data-warns]');
        if (w) w.innerHTML = warnHtml();
        body.querySelectorAll('.pj-pl__task').forEach((li) => {
          const t = st.plan.sections[Number(li.dataset.s)]?.tasks[Number(li.dataset.k)];
          li.classList.toggle('is-warn', !!t && st.warnings.some((x) => x.email === t.owner_email && x.week === weekOf(t.due_date)));
        });
      } catch (_) { /* the warnings are advice; the plan still creates */ }
    }, 350);
    const readTop = () => {
      body.querySelectorAll('[data-p]').forEach((i) => { if (i.tagName === 'INPUT' || i.tagName === 'TEXTAREA') st.plan[i.dataset.p] = i.value; });
    };

    body.addEventListener('input', (e) => {
      const i = e.target.closest('[data-f]');
      if (!i || !st.plan) return;
      const li = i.closest('.pj-pl__task');
      if (i.dataset.f === 'section') { st.plan.sections[Number(i.dataset.s)].name = i.value; return; }
      const t = st.plan.sections[Number(li.dataset.s)].tasks[Number(li.dataset.k)];
      t[i.dataset.f] = i.value;
      if (i.dataset.f === 'due_date' || i.dataset.f === 'priority') recheck();
    });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b || !st.plan) return;
      const a = b.dataset.a;
      const li = b.closest('.pj-pl__task');
      const y = body.scrollTop;
      const redraw = () => { readTop(); planView(); body.scrollTop = y; };
      if (a === 'back') { askView(); return; }
      if (a === 'owner') {
        const t = st.plan.sections[Number(li.dataset.s)].tasks[Number(li.dataset.k)];
        const r = await pickOwner({ title: 'Owner', current: t.owner_email, clear: 'No owner' });
        if (r === null || r === undefined) return;
        t.owner_email = r.email || null;
        readTop();
        planView();
        body.scrollTop = y;
        recheck();
      } else if (a === 'lead') {
        const r = await pickOwner({ title: 'Project lead', current: st.plan.lead_email, clear: '' });
        if (r && r.email) { readTop(); st.plan.lead_email = r.email; planView(); body.scrollTop = y; }
      } else if (a === 'rm-task') {
        st.plan.sections[Number(li.dataset.s)].tasks.splice(Number(li.dataset.k), 1);
        redraw();
        recheck();
      } else if (a === 'rm-sec') {
        st.plan.sections.splice(Number(b.dataset.s), 1);
        redraw();
        recheck();
      } else if (a === 'add-task') {
        const sec = st.plan.sections[Number(b.dataset.s)];
        const last = sec.tasks[sec.tasks.length - 1];
        sec.tasks.push({ title: '', owner_email: st.plan.lead_email, due_date: (last && last.due_date) || st.plan.due_date || todayStr(), priority: 'normal', description: '' });
        redraw();
        const rows = body.querySelectorAll(`[data-sec="${b.dataset.s}"] .pj-pl__title`);
        if (rows.length) rows[rows.length - 1].focus();
      } else if (a === 'add-sec') {
        st.plan.sections.push({ name: 'New section', tasks: [] });
        redraw();
      }
    });
    body.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-plan]');
      if (!f) return;
      e.preventDefault();
      readTop();
      const p = st.plan;
      if (!p.name.trim()) { err('Give the project a name.'); return; }
      const sections = p.sections.map((x) => ({ ...x, tasks: x.tasks.filter((t) => t.title.trim()) })).filter((x) => x.tasks.length);
      if (!sections.length) { err('Add at least one task.'); return; }
      const go = body.querySelector('[data-create]');
      go.disabled = true;
      go.textContent = 'Creating';
      try {
        const r = await api.planCreate({ ...p, name: p.name.trim(), sections, start_date: null });
        dropProjectsCache();
        result = r.project;
        s.close();
      } catch (ex) {
        err(ex.message || 'That did not save.');
        go.disabled = false;
        recount();
      }
    });

    askView();
    void phone; void shortDate; void toast;
  });
}
