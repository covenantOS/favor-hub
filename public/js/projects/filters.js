/* The filter bar under a project's view tabs: assignee, due, status, tag, Show completed, and saved views.
   The filters live in the page address (owner, due, status, code, q, done) so a link or a reload keeps them. */
import { esc, icon, choose, askText, toast, STATUS } from './ui-util.js';
import { api, personOf } from './ui-data.js';

const DUE = { overdue: 'Overdue', today: 'Today', week: 'Next 7 days', none: 'No date' };
const KEYS = ['q', 'owner', 'due', 'status', 'code'];

/** Put the filters in the address into the Ctx, before the first load. */
export function readFilters(ctx, sp) {
  for (const k of KEYS) ctx.filter[k] = sp.get(k) || '';
  if (!DUE[ctx.filter.due]) ctx.filter.due = '';
  if (ctx.filter.status && !STATUS[ctx.filter.status]) ctx.filter.status = '';
  if (ctx.filter.status === 'done' || sp.get('done') === '1') ctx.showDone = true;
}

/** Write the Ctx filters to the address without adding a history entry. */
export function writeFilters(ctx) {
  const u = new URL(location.href);
  for (const k of KEYS) { if (ctx.filter[k]) u.searchParams.set(k, ctx.filter[k]); else u.searchParams.delete(k); }
  if (ctx.showDone) u.searchParams.set('done', '1'); else u.searchParams.delete('done');
  history.replaceState(history.state, '', u);
}

export const activeCount = (ctx) => KEYS.filter((k) => k !== 'q' && ctx.filter[k]).length + (ctx.filter.priority ? 1 : 0);

function codesIn(ctx) {
  const m = new Map();
  for (const t of ctx.tasks) {
    for (const [f, label] of [['appeal_code', 'Appeal'], ['source_code', 'Source'], ['fund_code', 'Fund'], ['campaign_code', 'Campaign']]) {
      const c = t[f];
      if (c && !m.has(c)) m.set(c, label);
    }
  }
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

export function mountFilterBar(el, ctx, o = {}) {
  let views = [];
  let destroyed = false;
  const project = o.project || '';
  const loadViews = () => api.views(project).then((d) => { views = d.views || []; paint(); }).catch(() => { views = []; });

  function chip(k, label, value, on) {
    return `<button type="button" class="pj-fchip${on ? ' is-on' : ''}" data-f="${k}" aria-haspopup="listbox"><span class="pj-fchip__k">${esc(label)}</span>${on ? `<span class="pj-fchip__v">${esc(value)}</span>` : ''}${icon('down')}</button>`;
  }
  function paint() {
    if (destroyed) return;
    const f = ctx.filter;
    const o2 = f.owner;
    const ownerName = o2 === 'me' ? 'Me' : o2 === 'none' ? 'Unassigned' : o2 ? (personOf(o2) || { name: o2 }).name : '';
    const n = activeCount(ctx) + (f.q ? 1 : 0);
    el.innerHTML = `${chip('owner', 'Assignee', ownerName, !!o2)}${chip('due', 'Due', DUE[f.due] || '', !!f.due)}${chip('status', 'Status', STATUS[f.status] || '', !!f.status)}${chip('code', 'Tag', f.code, !!f.code)}
      <label class="pj-fshow"><input type="checkbox" data-f="done" ${ctx.showDone ? 'checked' : ''} /><span>Show completed</span></label>
      ${n ? '<button type="button" class="pj-fclear" data-f="clear">Clear filters</button>' : ''}
      <span class="pj-fsp"></span>
      <button type="button" class="pj-fchip" data-f="views" aria-haspopup="listbox"><span class="pj-fchip__k">Views</span>${views.length ? `<span class="pj-fchip__n">${views.length}</span>` : ''}${icon('down')}</button>`;
  }

  function set(k, v) {
    ctx.filter[k] = v || '';
    if (k === 'status' && v === 'done' && !ctx.showDone) { ctx.setShowDone(true); }
    ctx.emit('filter');
  }
  const queryNow = () => ({ q: ctx.filter.q, owner: ctx.filter.owner, due: ctx.filter.due, status: ctx.filter.status, code: ctx.filter.code, priority: ctx.filter.priority, show_done: ctx.showDone });
  async function applyView(v) {
    const q = v.query || {};
    for (const k of KEYS) ctx.filter[k] = typeof q[k] === 'string' ? q[k] : '';
    ctx.filter.priority = typeof q.priority === 'string' ? q.priority : '';
    const want = !!q.show_done || ctx.filter.status === 'done';
    if (want !== ctx.showDone) await ctx.setShowDone(want); else ctx.emit('filter');
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const k = b.dataset.f;
    if (k === 'done') return;
    if (k === 'clear') { for (const x of KEYS) ctx.filter[x] = ''; ctx.filter.priority = ''; ctx.emit('filter'); return; }
    if (k === 'owner') {
      const mem = (ctx.members || []).map((m) => ({ value: m.email, label: m.name || (personOf(m.email) || {}).name || m.email, on: ctx.filter.owner === m.email }));
      const v = await choose({ anchor: b, title: 'Assignee', search: mem.length > 8, placeholder: 'Find a person', items: [{ value: '', label: 'Anyone', on: !ctx.filter.owner }, { value: 'me', label: 'Me', on: ctx.filter.owner === 'me' }, { value: 'none', label: 'Unassigned', on: ctx.filter.owner === 'none' }, ...mem] });
      if (v !== undefined) set('owner', v);
    } else if (k === 'due') {
      const v = await choose({ anchor: b, title: 'Due', items: [{ value: '', label: 'Any time', on: !ctx.filter.due }, ...Object.entries(DUE).map(([value, label]) => ({ value, label, on: ctx.filter.due === value }))] });
      if (v !== undefined) set('due', v);
    } else if (k === 'status') {
      const v = await choose({ anchor: b, title: 'Status', items: [{ value: '', label: 'Any status', on: !ctx.filter.status }, ...['open', 'doing', 'waiting', 'done'].map((value) => ({ value, label: STATUS[value], on: ctx.filter.status === value }))] });
      if (v !== undefined) set('status', v);
    } else if (k === 'code') {
      const cs = codesIn(ctx);
      const v = await choose({ anchor: b, title: 'Tag', search: cs.length > 8, placeholder: 'Find a code', items: [{ value: '', label: 'Any tag', on: !ctx.filter.code }, ...cs.map(([value, hint]) => ({ value, label: value, hint, on: ctx.filter.code === value }))] });
      if (v !== undefined) set('code', v);
    } else if (k === 'views') {
      const items = views.map((v) => ({ value: 'v:' + v.id, label: v.name, icon: 'filter' }));
      items.push({ value: 'save', label: 'Save these filters as a view', icon: 'plus' });
      if (views.length) items.push({ value: 'delete', label: 'Delete a view', icon: 'trash' });
      const pick = await choose({ anchor: b, title: 'Saved views', items });
      if (pick === 'save') {
        const name = await askText({ title: 'Save view', label: 'Name', action: 'Save', placeholder: 'Overdue and mine' });
        if (!name || !name.trim()) return;
        try { await api.saveView({ name: name.trim(), project_id: project || undefined, query: queryNow() }); toast('View saved'); await loadViews(); } catch (err) { toast(err.message || 'The view did not save.', { error: true }); }
      } else if (pick === 'delete') {
        const del = await choose({ anchor: b, title: 'Delete a view', items: views.map((v) => ({ value: v.id, label: v.name, icon: 'trash' })) });
        if (!del) return;
        try { await api.deleteView(del); await loadViews(); } catch (err) { toast(err.message || 'The view was not deleted.', { error: true }); }
      } else if (typeof pick === 'string' && pick.startsWith('v:')) {
        const v = views.find((x) => 'v:' + x.id === pick);
        if (v) applyView(v);
      }
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.f === 'done') ctx.setShowDone(e.target.checked);
  });

  const off = ctx.on((w) => { if (w === 'filter' || w === 'load') { writeFilters(ctx); paint(); } });
  paint();
  loadViews();
  return { paint, destroy() { destroyed = true; off(); el.innerHTML = ''; } };
}
