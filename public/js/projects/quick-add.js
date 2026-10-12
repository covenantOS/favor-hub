/* Quick add: Tab then Q anywhere on a projects page, or the Add task button. Type a title, Enter adds it.
   Ctrl or Cmd with Enter adds it and leaves the box open for the next one. */
import { esc, icon, openSheet, choose, toast, dueLabel, avatar } from './ui-util.js';
import { api, personOf, Staff, loadStaff, CODE_KINDS } from './ui-data.js';
import { pickOwner, pickDate, pickCode, pickSection } from './ui-pickers.js';

let projectsP = null;
const projects = () => { if (!projectsP) projectsP = api.projects().then((d) => d.projects || []).catch(() => { projectsP = null; return []; }); return projectsP; };
export const dropProjectsCache = () => { projectsP = null; };

/** defaults: {project (a project row or null), section_id, owner_email, due_date}. ctx: the open Ctx (rows appear in it at once). */
export async function openQuickAdd(ctx, defaults = {}) {
  await loadStaff();
  const list = await projects();
  const st = {
    project: defaults.project !== undefined ? defaults.project : (ctx && ctx.project) || null,
    section_id: defaults.section_id || null,
    owner_email: defaults.owner_email !== undefined ? defaults.owner_email : Staff.me,
    due_date: defaults.due_date || null,
    codes: {},
  };
  const sectionsOf = () => (ctx && ctx.project && st.project && ctx.project.id === st.project.id ? ctx.sections : []);
  let busy = false;

  const body = () => `<form class="pj-qa" autocomplete="off">
    <input class="pj-qa__title" data-title type="text" maxlength="300" placeholder="What needs doing?" aria-label="Task title" enterkeyhint="done" />
    <div class="pj-qa__chips">
      <button type="button" class="rt-pchip pj-fbtn${st.project ? '' : ' is-empty'}" data-q="project">${st.project ? `<i class="pj-dot" data-c="${esc(st.project.color || 'leaf')}"></i><span>${esc(st.project.name)}</span>` : `${icon('list')}<span>No project</span>`}</button>
      ${sectionsOf().length ? `<button type="button" class="rt-pchip pj-fbtn${st.section_id ? '' : ' is-empty'}" data-q="section">${icon('list')}<span>${esc((sectionsOf().find((s) => s.id === st.section_id) || {}).name || 'First section')}</span></button>` : ''}
      <button type="button" class="rt-pchip pj-fbtn${st.owner_email ? '' : ' is-empty'}" data-q="owner">${avatar(st.owner_email ? personOf(st.owner_email) : null)}<span>${st.owner_email ? esc(personOf(st.owner_email).name) : 'Unassigned'}</span></button>
      <button type="button" class="rt-pchip pj-fbtn${st.due_date ? '' : ' is-empty'}" data-q="due">${icon('cal')}<span>${st.due_date ? esc(dueLabel(st.due_date)) : 'No date'}</span></button>
    </div>
    <div class="pj-qa__codes"><span class="pj-label">Codes</span>${CODE_KINDS.map((k) => `<button type="button" class="pj-codebtn${st.codes[k.field] ? ' is-set' : ''}" data-q="code" data-kind="${k.kind}" data-field="${k.field}"><small>${esc(k.label)}</small><b>${st.codes[k.field] ? esc(st.codes[k.field]) : 'Add'}</b></button>`).join('')}</div>
    <div class="pj-sheet__foot"><span class="pj-qa__hint">Ctrl Enter adds another</span><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="submit" class="pj-btn pj-btn--primary" data-add>Add task</button></div>
  </form>`;

  const s = openSheet({ title: 'New task', cls: 'pj-sheet--qa', html: body() });
  const draw = () => {
    const t = s.body.querySelector('[data-title]');
    const v = t ? t.value : '';
    const had = t && document.activeElement === t;
    s.body.innerHTML = body();
    const n = s.body.querySelector('[data-title]');
    n.value = v;
    if (had) n.focus();
  };
  setTimeout(() => { const t = s.body.querySelector('[data-title]'); if (t) t.focus(); }, 40);

  async function submit(again) {
    if (busy) return;
    const t = s.body.querySelector('[data-title]');
    const title = t.value.trim();
    if (!title) { t.focus(); t.classList.add('is-bad'); setTimeout(() => t.classList.remove('is-bad'), 600); return; }
    busy = true;
    const f = { title, owner_email: st.owner_email || undefined, due_date: st.due_date || undefined, ...st.codes };
    if (st.section_id) f.section_id = st.section_id;
    try {
      if (ctx && ctx.kind === 'project' && st.project && ctx.project && ctx.project.id === st.project.id) {
        if (!f.section_id) f.section_id = ctx.sections.length ? ctx.sections[0].id : null;
        ctx.create({ ...f, section_id: f.section_id });
        toast('Task added');
      } else if (ctx && ctx.kind === 'mine' && !st.project) {
        ctx.create({ ...f, owner_email: st.owner_email || Staff.me });
        toast('Task added');
      } else {
        const d = await api.createTask({ ...f, project_id: st.project ? st.project.id : undefined });
        const task = d.task;
        toast('Added ' + (task.code || 'task'), st.project ? { action: { label: 'Open', fn: () => { location.href = '/projects/p/?p=' + encodeURIComponent(st.project.key) + '&t=' + encodeURIComponent(task.code || task.id); } } } : {});
        if (ctx && ctx.kind === 'mine') ctx.reloadTasks();
      }
      if (again) { t.value = ''; st.codes = {}; draw(); const n = s.body.querySelector('[data-title]'); n.focus(); } else s.close();
    } catch (e) {
      toast(e.message || 'That did not save.', { error: true });
    }
    busy = false;
  }

  s.body.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  s.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(true); } });
  s.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const k = b.dataset.q;
    if (k === 'project') {
      const items = list.map((p) => ({ value: p.id, label: p.name, hint: p.key, dot: p.color, on: st.project && st.project.id === p.id }));
      items.push({ value: null, label: 'No project (a personal task)', on: !st.project });
      const v = await choose({ anchor: b, title: 'Project', items, search: list.length > 7, placeholder: 'Search projects' });
      if (v !== undefined) { st.project = v ? list.find((p) => p.id === v) : null; st.section_id = null; draw(); }
    } else if (k === 'section') {
      const v = await pickSection({ anchor: b, sections: sectionsOf(), value: st.section_id, none: 'First section' });
      if (v !== undefined) { st.section_id = v; draw(); }
    } else if (k === 'owner') {
      const r = await pickOwner({ title: 'Assign to', current: st.owner_email });
      if (r) { st.owner_email = r.email; draw(); }
    } else if (k === 'due') {
      const v = await pickDate({ anchor: b, value: st.due_date });
      if (v !== undefined) { st.due_date = v; draw(); }
    } else if (k === 'code') {
      const v = await pickCode({ anchor: b, kind: b.dataset.kind, value: st.codes[b.dataset.field] });
      if (v !== undefined) { if (v) st.codes[b.dataset.field] = v; else delete st.codes[b.dataset.field]; draw(); }
    }
  });
  return s;
}
