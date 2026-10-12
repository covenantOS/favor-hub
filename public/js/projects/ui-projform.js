/* New project and project details: one form. Members are added and removed here too. */
import { esc, icon, avatar, openSheet, toast, choose, COLOR_NAMES } from './ui-util.js';
import { api, personOf, Staff, loadStaff } from './ui-data.js';
import { pickOwner } from './ui-pickers.js';
import { dropProjectsCache } from './quick-add.js';

const STATUSES = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };
const autoKey = (name) => String(name || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((w, i, a) => (a.length > 1 ? w[0] : w.slice(0, 3))).join('').toUpperCase().slice(0, 5);

/** project: an existing project row to edit, or null for a new one. members: the current Person list when editing. Resolves to the saved project or null. */
export async function openProjectForm({ project = null, members = [] } = {}) {
  await loadStaff();
  const edit = !!project;
  const st = {
    name: project ? project.name : '', key: project ? project.key : '', keyTouched: edit, team: project ? project.team : '', description: project ? project.description : '',
    lead: project ? project.lead_email : Staff.me, visibility: project ? project.visibility : 'staff', color: project ? project.color : 'leaf', status: project ? project.status : 'active',
    start: project ? project.start_date || '' : '', due: project ? project.due_date || '' : '', members: members.map((m) => m.email),
  };
  const orig = new Set(st.members);
  return new Promise((resolve) => {
    let result = null;
    const html = () => `<form class="pj-pf" autocomplete="off">
      <label class="pj-label" for="pf-name">Name</label>
      <input id="pf-name" class="pj-field" data-v="name" type="text" maxlength="80" value="${esc(st.name)}" placeholder="Fall newsletter" />
      <div class="pj-pf__row">
        <div><label class="pj-label" for="pf-key">Key</label><input id="pf-key" class="pj-field pj-field--key" data-v="key" type="text" maxlength="5" value="${esc(st.key)}" placeholder="FNL" ${edit ? 'disabled' : ''} /></div>
        <div class="pj-grow"><label class="pj-label" for="pf-team">Team</label><input id="pf-team" class="pj-field" data-v="team" type="text" maxlength="40" value="${esc(st.team)}" placeholder="Marketing" /></div>
      </div>
      <label class="pj-label" for="pf-desc">Description</label>
      <textarea id="pf-desc" class="pj-field" data-v="description" rows="3" maxlength="1000">${esc(st.description)}</textarea>
      <div class="pj-pf__row">
        <div class="pj-grow"><span class="pj-label">Lead</span><button type="button" class="rt-pchip pj-fbtn" data-p="lead">${avatar(personOf(st.lead))}<span>${esc(personOf(st.lead).name)}</span></button></div>
        <div class="pj-grow"><span class="pj-label">Who can see it</span><button type="button" class="rt-pchip pj-fbtn" data-p="vis">${icon('lock')}<span>${st.visibility === 'members' ? 'Members only' : 'All staff'}</span></button></div>
      </div>
      <div class="pj-pf__row">
        <div class="pj-grow"><label class="pj-label" for="pf-start">Start</label><input id="pf-start" class="pj-field" data-v="start" type="date" value="${esc(st.start)}" /></div>
        <div class="pj-grow"><label class="pj-label" for="pf-due">Due</label><input id="pf-due" class="pj-field" data-v="due" type="date" value="${esc(st.due)}" /></div>
      </div>
      <span class="pj-label">Color</span>
      <div class="pj-swatches" role="radiogroup" aria-label="Color">${COLOR_NAMES.map((c) => `<button type="button" role="radio" aria-checked="${st.color === c}" class="pj-swatch${st.color === c ? ' is-on' : ''}" data-c="${c}" data-p="color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
      ${edit ? `<span class="pj-label">Status</span><button type="button" class="rt-pchip pj-fbtn" data-p="status"><span>${STATUSES[st.status] || st.status}</span></button>` : ''}
      <span class="pj-label">Members</span>
      <div class="pj-members">${st.members.map((e) => `<span class="pj-fchip">${avatar(personOf(e))}<span>${esc(personOf(e).name.split(' ')[0])}</span><button type="button" data-p="rm" data-email="${esc(e)}" aria-label="Remove ${esc(personOf(e).name)}">${icon('x')}</button></span>`).join('')}<button type="button" class="rt-pchip pj-fbtn is-empty" data-p="add">${icon('plus')}<span>Add people</span></button></div>
      <p class="pj-err" data-err hidden></p>
      <div class="pj-sheet__foot"><button type="button" class="pj-btn" data-sheet-x>Cancel</button><button type="submit" class="pj-btn pj-btn--primary" data-save>${edit ? 'Save' : 'Create project'}</button></div>
    </form>`;
    const s = openSheet({ title: edit ? 'Project details' : 'New project', cls: 'pj-sheet--form', html: html(), onClose: () => resolve(result) });
    const read = () => { s.body.querySelectorAll('[data-v]').forEach((i) => { if (i.tagName === 'INPUT' || i.tagName === 'TEXTAREA') st[i.dataset.v] = i.value; }); };
    const draw = () => { read(); const y = s.body.scrollTop; s.body.innerHTML = html(); s.body.scrollTop = y; };
    setTimeout(() => { const n = s.body.querySelector('[data-v="name"]'); if (n && !edit) n.focus(); }, 40);
    s.body.addEventListener('input', (e) => {
      const i = e.target.closest('[data-v]');
      if (!i) return;
      if (i.dataset.v === 'name' && !st.keyTouched) { const k = autoKey(i.value); st.key = k; const ki = s.body.querySelector('[data-v="key"]'); if (ki) ki.value = k; }
      if (i.dataset.v === 'key') { st.keyTouched = true; i.value = i.value.replace(/[^A-Za-z]/g, '').toUpperCase(); }
    });
    s.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      const k = b.dataset.p;
      if (k === 'color') { read(); st.color = b.dataset.v; draw(); }
      else if (k === 'lead') { const r = await pickOwner({ title: 'Project lead', current: st.lead, clear: '' }); if (r && r.email) { st.lead = r.email; if (!st.members.includes(r.email)) st.members.push(r.email); draw(); } }
      else if (k === 'vis') { read(); const v = await choose({ anchor: b, title: 'Who can see it', items: [{ value: 'staff', label: 'All staff', hint: 'Anyone signed in to FavorOS can open it', on: st.visibility === 'staff' }, { value: 'members', label: 'Members only', hint: 'Only the people listed here', on: st.visibility === 'members' }] }); if (v) { st.visibility = v; draw(); } }
      else if (k === 'status') { read(); const v = await choose({ anchor: b, title: 'Status', items: Object.entries(STATUSES).map(([value, label]) => ({ value, label, on: st.status === value })) }); if (v) { st.status = v; draw(); } }
      else if (k === 'add') { read(); const r = await pickOwner({ title: 'Add a member', clear: '', exclude: st.members }); if (r && r.email) { st.members.push(r.email); draw(); } }
      else if (k === 'rm') { read(); const em = b.dataset.email; if (em === st.lead) { toast('The lead stays a member.'); return; } st.members = st.members.filter((x) => x !== em); draw(); }
    });
    s.body.addEventListener('submit', async (e) => {
      e.preventDefault();
      read();
      const err = s.body.querySelector('[data-err]');
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!st.name.trim()) { fail('Give the project a name.'); return; }
      if (!edit && !/^[A-Z]{2,5}$/.test(st.key)) { fail('The key is 2 to 5 capital letters.'); return; }
      const save = s.body.querySelector('[data-save]');
      save.disabled = true;
      try {
        const body = { name: st.name.trim(), team: st.team.trim(), description: st.description.trim(), lead_email: st.lead, visibility: st.visibility, color: st.color, start_date: st.start || null, due_date: st.due || null };
        let p;
        if (edit) {
          body.status = st.status;
          p = (await api.patchProject(project.id, body)).project;
          const add = st.members.filter((m) => !orig.has(m)); const remove = [...orig].filter((m) => !st.members.includes(m));
          if (add.length || remove.length) await api.members(project.id, { add, remove });
        } else {
          p = (await api.createProject({ ...body, key: st.key, members: st.members.filter((m) => m !== st.lead) })).project;
        }
        dropProjectsCache();
        result = p;
        s.close();
      } catch (ex) {
        fail(ex.message || 'That did not save.');
        save.disabled = false;
      }
    });
  });
}
