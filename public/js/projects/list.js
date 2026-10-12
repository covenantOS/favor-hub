/* The List view: sections (or due-date groups on My tasks), rows, instant inline add, drag to reorder, multi-select with a bulk bar,
   and the keyboard. It draws from a Ctx (ui-data.js) and changes things only through it. */
import { esc, icon, phone, choose, toast, todayStr, addDays, openSheet, sheetOpen, dueLabel } from './ui-util.js';
import { dnd } from './ui-dnd.js';
import { checkBtn, codeChips, dueHtml, counts, projChip, stateTag, priorityIcon, ownerBtn } from './ui-rows.js';
import { pickOwner, pickDate, pickPriority, pickSection } from './ui-pickers.js';

const FOLD_KEY = 'favor.hub.projects.folded.v1';
const folded = () => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch (_) { return {}; } };
const setFolded = (m) => { try { localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (_) { /* private mode */ } };

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Due-date groups for My tasks. */
function dueGroups(ctx) {
  const t = todayStr();
  const week = addDays(t, 7);
  const g = { overdue: [], today: [], week: [], later: [], none: [], done: [] };
  for (const x of ctx.tasks) {
    if (!ctx.matches(x)) continue;
    if (x.status === 'done') g.done.push(x);
    else if (!x.due_date) g.none.push(x);
    else if (x.due_date < t) g.overdue.push(x);
    else if (x.due_date === t) g.today.push(x);
    else if (x.due_date <= week) g.week.push(x);
    else g.later.push(x);
  }
  const by = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.sort - b.sort || a.title.localeCompare(b.title);
  Object.values(g).forEach((a) => a.sort(by));
  const out = [
    { id: 'overdue', name: 'Overdue', tasks: g.overdue, drop: null, tone: 'late', noAdd: true },
    { id: 'today', name: 'Today', tasks: g.today, drop: () => ({ due_date: t }), add: { due_date: t } },
    { id: 'week', name: 'Next 7 days', tasks: g.week, drop: () => ({ due_date: addDays(t, 1) }), add: { due_date: addDays(t, 1) } },
    { id: 'later', name: 'Later', tasks: g.later, drop: () => ({ due_date: addDays(t, 14) }), add: { due_date: addDays(t, 14) } },
    { id: 'none', name: 'No date', tasks: g.none, drop: () => ({ due_date: null }), add: {} },
  ];
  if (ctx.showDone) out.push({ id: 'done', name: 'Completed', tasks: g.done, drop: null, noAdd: true });
  return out.filter((x) => x.id !== 'overdue' || x.tasks.length);
}

function sectionGroups(ctx) {
  const m = ctx.grouped();
  const filtering = !!(ctx.filter.q || ctx.filter.owner || ctx.filter.priority);
  const out = ctx.sections.map((s) => ({ id: s.id, name: s.name, tasks: m.get(s.id) || [], section: true }));
  const none = m.get('') || [];
  if (none.length || !ctx.sections.length) out.push({ id: '', name: ctx.sections.length ? 'No section' : 'Tasks', tasks: none, section: false, plain: !ctx.sections.length });
  return filtering ? out.filter((g) => g.tasks.length) : out;
}

export function mountList(root, ctx, o) {
  const mine = o.mode === 'mine';
  let cur = null;
  let editing = null;
  let lastSel = null;
  let skeleton = '';
  let cache = new Map();
  let destroyed = false;
  root.classList.add('pj-list');
  
  /* ---------------------------------------------------------------- rows */
  const rowHtml = (t) => {
    const done = t.status === 'done';
    const sel = ctx.sel.has(t.id);
    const cls = 'pj-row' + (done ? ' is-done' : '') + (sel ? ' is-sel' : '') + (cur === t.id ? ' is-cur' : '') + (t.pending ? ' is-pending' : '') + (t.blocked ? ' is-blocked' : '') + (t.overdue ? ' is-late' : '');
    return `<div class="${cls}" role="listitem" data-id="${esc(t.id)}" tabindex="-1"><span class="pj-row__lead"><span class="pj-grip" data-grip aria-hidden="true">${icon('grip')}</span><input type="checkbox" class="pj-sel" data-act="sel" aria-label="Select ${esc(t.title)}"${sel ? ' checked' : ''} /></span>${checkBtn(t)}<span class="pj-row__title"><span class="pj-title" data-act="open">${esc(t.title)}</span>${stateTag(t)}<span class="pj-row__counts">${counts(t)}</span></span><span class="pj-row__meta"><span class="pj-row__chips">${mine ? projChip(t) : ''}${codeChips(t, phone() ? 2 : 4)}</span>${t.code ? `<span class="pj-code-id">${esc(t.code)}</span>` : ''}<button type="button" class="pj-duebtn" data-act="due" aria-label="${t.due_date ? 'Due ' + esc(dueLabel(t.due_date, t.due_time)) : 'Add date'}">${dueHtml(t) || '<span class="pj-due pj-due--empty">Add date</span>'}</button><button type="button" class="pj-pribtn" data-act="pri" data-ui-tooltip="pj-tip" aria-label="Priority">${priorityIcon(t) || `<span class="pj-pri pj-pri--normal">${icon('flag')}</span>`}</button></span>${ownerBtn(t)}</div>`;
  };
  const rowCached = (t) => {
    const key = t.title + '|' + t.status + '|' + t.due_date + '|' + t.due_time + '|' + t.priority + '|' + (t.owner_email || '') + '|' + (t.section_id || '') + '|' + t.code + '|' + t.appeal_code + t.source_code + t.fund_code + t.campaign_code + '|' + (t.subtasks ? t.subtasks.done + '/' + t.subtasks.total : '') + '|' + t.comments + '|' + t.files + '|' + t.blocked + t.overdue + (t.pending ? 'p' : '') + '|' + ctx.sel.has(t.id) + (cur === t.id) + '|' + (t.project ? t.project.key : '');
    const c = cache.get(t.id);
    if (c && c.key === key) return c.html;
    const html = rowHtml(t);
    cache.set(t.id, { key, html });
    return html;
  };

  /* ---------------------------------------------------------------- render */
  function groupsNow() { return mine ? dueGroups(ctx) : sectionGroups(ctx); }
  const foldMap = () => folded();

  function skeletonHtml(groups) {
    const fm = foldMap();
    const fk = (g) => (mine ? 'mine:' : (ctx.project ? ctx.project.id : '') + ':') + g.id;
    return groups.map((g) => {
      const f = !!fm[fk(g)];
      const head = g.plain ? '' : `<header class="pj-sec__h${g.tone ? ' is-' + g.tone : ''}"><button type="button" class="pj-sec__tog" data-act="fold" aria-expanded="${!f}" aria-label="${f ? 'Open' : 'Close'} ${esc(g.name)}">${icon('right')}</button><h3 class="pj-sec__name" ${g.section ? 'data-act="rename" title="Double-click to rename"' : ''}>${esc(g.name)}</h3><span class="pj-sec__n" data-n></span><span class="pj-sec__sp"></span>${g.section ? `<button type="button" class="pj-sec__more" data-act="secmenu" aria-label="Section menu for ${esc(g.name)}">${icon('more')}</button>` : ''}</header>`;
      const add = g.noAdd ? '' : `<form class="pj-add" data-gid="${esc(g.id)}" autocomplete="off"><span class="pj-add__plus">${icon('plus')}</span><input class="pj-add__in" type="text" maxlength="300" placeholder="${mine && g.id !== 'none' ? 'Add a task for ' + esc(g.name.toLowerCase()) : 'Add a task'}" aria-label="Add a task to ${esc(g.name)}" enterkeyhint="done" /></form>`;
      return `<section class="pj-sec${f ? ' is-folded' : ''}" data-zone="${esc(g.id)}" data-fold="${esc(fk(g))}" role="group" aria-label="${esc(g.name)}">${head}<div class="pj-sec__b"><div class="pj-sec__rows" data-rows role="list"></div>${add}</div></section>`;
    }).join('') + (!mine && ctx.project && !ctx.filter.q ? `<button type="button" class="pj-addsec" data-act="addsec">${icon('plus')}Add section</button>` : '');
  }

  function render() {
    if (destroyed) return;
    if (ctx.loading) { root.innerHTML = '<div class="pj-skel" aria-busy="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>'; skeleton = ''; return; }
    if (ctx.error) { root.innerHTML = `<div class="pj-empty pj-empty--err"><p>${esc(ctx.error)}</p><button type="button" class="pj-btn" data-act="retry">Try again</button></div>`; skeleton = ''; return; }
    const groups = groupsNow();
    const sk = groups.map((g) => g.id + '|' + g.name + '|' + !!foldMap()[(mine ? 'mine:' : (ctx.project ? ctx.project.id : '') + ':') + g.id] + '|' + !!g.noAdd + '|' + (g.plain ? 1 : 0)).join(';') + '|' + ctx.filter.q + '|' + (ctx.tasks.length === 0);
    let focused = null;
    if (sk !== skeleton) {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('pj-add__in') && root.contains(a)) focused = { gid: a.closest('.pj-add').dataset.gid, v: a.value, s: a.selectionStart };
      root.innerHTML = (ctx.tasks.length === 0 && !ctx.filter.q ? `<div class="pj-empty pj-empty--first"><b>${mine ? 'Nothing assigned to you' : 'No tasks yet'}</b><span>${mine ? 'Add a task below, or ask someone to assign you one.' : 'Type a title below and press Enter. Keep typing to add the next one.'}</span></div>` : '') + skeletonHtml(groups);
      skeleton = sk;
      cache = new Map([...cache].filter(([id]) => ctx.by.has(id)));
    }
    const zones = [...root.querySelectorAll('.pj-sec')];
    groups.forEach((g, i) => {
      const z = zones[i];
      if (!z) return;
      const n = z.querySelector('[data-n]');
      if (n) n.textContent = g.tasks.length;
      const rows = z.querySelector('[data-rows]');
      if (z.classList.contains('is-folded')) { if (rows.firstChild) rows.textContent = ''; rows._ids = []; rows._html = []; return; }
      const ids = g.tasks.map((t) => t.id);
      const htmls = g.tasks.map((t) => (t.id === editing && rows._html ? (rows._html[rows._ids.indexOf(t.id)] || rowCached(t)) : rowCached(t)));
      const oldIds = rows._ids || [];
      const oldHtml = rows._html || [];
      const sameOrder = oldIds.length === ids.length && oldIds.every((v, k) => v === ids[k]);
      if (sameOrder && oldHtml.length) {
        const kids = rows.children;
        for (let k = 0; k < ids.length; k++) {
          if (oldHtml[k] !== htmls[k]) {
            const tpl = document.createElement('template');
            tpl.innerHTML = htmls[k];
            kids[k].replaceWith(tpl.content.firstElementChild);
          }
        }
      } else {
        rows.innerHTML = htmls.join('');
      }
      rows._ids = ids; rows._html = htmls;
    });
    if (focused) {
      const f = root.querySelector(`.pj-add[data-gid="${CSS.escape(focused.gid)}"] .pj-add__in`);
      if (f) { f.value = focused.v; f.focus({ preventScroll: true }); try { f.setSelectionRange(focused.s, focused.s); } catch (_) { /* ok */ } }
    }
    root.classList.toggle('is-selecting', !!ctx.selecting || ctx.sel.size > 0);
    renderBulk();
  }

  /* ---------------------------------------------------------------- selection */
  const visibleRows = () => [...root.querySelectorAll('.pj-sec:not(.is-folded) .pj-row')];
  function setSel(id, on) { if (on) ctx.sel.add(id); else ctx.sel.delete(id); }
  function selectRange(toId) {
    const ids = visibleRows().map((r) => r.dataset.id);
    const a = ids.indexOf(lastSel || toId), b = ids.indexOf(toId);
    if (b < 0) return;
    const [x, y] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
    for (let i = x; i <= y; i++) ctx.sel.add(ids[i]);
  }
  function toggleSelect(id, e) {
    if (e && e.shiftKey && lastSel) selectRange(id);
    else setSel(id, !ctx.sel.has(id));
    lastSel = id;
    ctx.emit('select');
  }

  /* ---------------------------------------------------------------- the bulk bar */
  let bar = null;
  function renderBulk() {
    const n = ctx.sel.size;
    if (!n) { if (bar) { bar.remove(); bar = null; } document.documentElement.classList.remove('pj-bulk-open'); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'pj-bulk';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Selected tasks');
      document.body.appendChild(bar);
      bar.addEventListener('click', onBulk);
    }
    const tasks = [...ctx.sel].map((id) => ctx.by.get(id)).filter(Boolean);
    const allDone = tasks.length && tasks.every((t) => t.status === 'done');
    bar.innerHTML = `<span class="pj-bulk__n">${n} selected</span><button type="button" class="pj-bulk__b" data-b="done">${icon('check')}${allDone ? 'Reopen' : 'Complete'}</button><button type="button" class="pj-bulk__b" data-b="owner">${icon('user')}Assign</button><button type="button" class="pj-bulk__b" data-b="due">${icon('cal')}Due date</button><button type="button" class="pj-bulk__b" data-b="pri">${icon('flag')}Priority</button>${mine ? '' : `<button type="button" class="pj-bulk__b" data-b="section">${icon('list')}Move</button>`}<button type="button" class="pj-bulk__b pj-bulk__b--danger" data-b="del">${icon('trash')}Remove</button><button type="button" class="pj-bulk__x" data-b="clear" aria-label="Clear selection">${icon('x')}</button>`;
    document.documentElement.classList.add('pj-bulk-open');
  }
  async function onBulk(e) {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const ids = [...ctx.sel];
    const k = b.dataset.b;
    if (k === 'clear') { ctx.sel.clear(); ctx.selecting = false; ctx.emit('select'); return; }
    if (k === 'done') { const all = ids.every((id) => (ctx.by.get(id) || {}).status === 'done'); await ctx.bulk(ids, { done: !all }); return; }
    if (k === 'owner') { const r = await pickOwner({ title: 'Assign ' + ids.length + ' tasks' }); if (r) await ctx.bulk(ids, { owner_email: r.email }); return; }
    if (k === 'due') { const v = await pickDate({ anchor: b, title: 'Due date for ' + ids.length + ' tasks', value: '' }); if (v !== undefined) await ctx.bulk(ids, { due_date: v }); return; }
    if (k === 'pri') { const v = await pickPriority({ anchor: b }); if (v) await ctx.bulk(ids, { priority: v }); return; }
    if (k === 'section') {
      const v = await pickSection({ anchor: b, sections: ctx.sections });
      if (v === undefined) return;
      for (const id of ids) await ctx.move(id, { section_id: v });
      return;
    }
    if (k === 'del') { await ctx.remove(ids); }
  }

  /* ---------------------------------------------------------------- events */
  const taskOf = (el) => { const r = el.closest('.pj-row'); return r ? ctx.by.get(r.dataset.id) : null; };

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    const a = act ? act.dataset.act : '';
    if (a === 'retry') { ctx.load(o.key); return; }
    if (a === 'fold') { toggleFold(e.target.closest('.pj-sec')); return; }
    if (a === 'secmenu') { sectionMenu(e.target.closest('.pj-sec'), act); return; }
    if (a === 'addsec') { addSection(); return; }
    const hdr = e.target.closest('.pj-sec__h');
    if (hdr && !a) { toggleFold(hdr.closest('.pj-sec')); return; }
    const row = e.target.closest('.pj-row');
    if (!row) return;
    const t = ctx.by.get(row.dataset.id);
    if (!t) return;
    cur = t.id;
    if (a === 'done') { ctx.patch(t.id, { done: t.status !== 'done' }); return; }
    if (a === 'sel') { toggleSelect(t.id, e); return; }
    if (a === 'owner') { const r = await pickOwner({ title: 'Assign to', current: t.owner_email }); if (r) ctx.patch(t.id, { owner_email: r.email }); return; }
    if (a === 'due') { const v = await pickDate({ anchor: act, value: t.due_date }); if (v !== undefined) ctx.patch(t.id, { due_date: v }); return; }
    if (a === 'pri') { const v = await pickPriority({ anchor: act, value: t.priority }); if (v) ctx.patch(t.id, { priority: v }); return; }
    if (ctx.selecting || ctx.sel.size || e.metaKey || e.ctrlKey || e.shiftKey) { toggleSelect(t.id, e); return; }
    if (String(t.id).startsWith('tmp-')) return;
    o.open(t);
  });

  root.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.pj-title');
    if (title) { e.preventDefault(); const t = taskOf(title); if (t) editTitle(t.id); return; }
    const nm = e.target.closest('.pj-sec__name[data-act="rename"]');
    if (nm) renameSection(nm);
  });

  root.addEventListener('submit', (e) => {
    const f = e.target.closest('.pj-add');
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input');
    const title = inp.value.trim();
    if (!title) return;
    inp.value = '';
    addTask(f.dataset.gid, title);
    inp.focus({ preventScroll: true });
    requestAnimationFrame(() => inp.scrollIntoView({ block: 'nearest' }));
  });
  root.addEventListener('keydown', (e) => {
    const inp = e.target.closest && e.target.closest('.pj-add__in');
    if (inp && e.key === 'Escape') { e.stopPropagation(); inp.value = ''; inp.blur(); }
    else if (inp && e.key === 'ArrowUp' && !inp.value) { e.preventDefault(); const rows = visibleRows(); const own = [...inp.closest('.pj-sec').querySelectorAll('.pj-row')]; const last = own[own.length - 1] || rows[rows.length - 1]; if (last) { setCursor(last.dataset.id); inp.blur(); } }
  });

  function addTask(gid, title) {
    const f = { title };
    if (mine) {
      const g = groupsNow().find((x) => x.id === gid);
      Object.assign(f, g && g.add ? g.add : {}, { owner_email: ctx.me });
    } else {
      f.section_id = gid || null;
      const ow = ctx.filter.owner;
      if (ow && ow !== 'none') f.owner_email = ow === 'me' ? ctx.me : ow;
    }
    return ctx.create(f);
  }

  /* ---------------------------------------------------------------- titles and sections */
  function editTitle(id) {
    const row = root.querySelector(`.pj-row[data-id="${CSS.escape(id)}"]`);
    const t = ctx.by.get(id);
    if (!row || !t) return;
    const span = row.querySelector('.pj-title');
    editing = id;
    const inp = document.createElement('input');
    inp.className = 'pj-title-edit';
    inp.value = t.title;
    inp.maxLength = 300;
    inp.setAttribute('aria-label', 'Task title');
    span.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const end = (save) => {
      if (done) return; done = true;
      editing = null;
      const v = inp.value.trim();
      if (save && v && v !== t.title) ctx.patch(id, { title: v }); else ctx.emit('edit-end');
      const r = root.querySelector(`.pj-row[data-id="${CSS.escape(id)}"]`);
      if (r && r.contains(inp)) { const s = document.createElement('span'); s.className = 'pj-title'; s.dataset.act = 'open'; s.textContent = save && v ? v : t.title; inp.replaceWith(s); }
      setCursor(id);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); end(true); } if (e.key === 'Escape') { e.stopPropagation(); end(false); } });
    inp.addEventListener('blur', () => end(true));
  }

  function toggleFold(z) {
    if (!z) return;
    const m = folded();
    const k = z.dataset.fold;
    if (m[k]) delete m[k]; else m[k] = 1;
    setFolded(m);
    skeleton = '';
    render();
  }
  function renameSection(h3) {
    const z = h3.closest('.pj-sec');
    const sid = z.dataset.zone;
    h3.contentEditable = 'plaintext-only';
    if (h3.contentEditable !== 'plaintext-only') h3.contentEditable = 'true';
    h3.focus();
    const sel = getSelection(); const r = document.createRange(); r.selectNodeContents(h3); sel.removeAllRanges(); sel.addRange(r);
    let done = false;
    const end = (save) => {
      if (done) return; done = true;
      h3.contentEditable = 'false';
      const v = h3.textContent.trim();
      if (save && v) ctx.renameSection(sid, v); else h3.textContent = (ctx.sections.find((s) => s.id === sid) || {}).name || '';
    };
    h3.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); end(true); h3.blur(); } if (e.key === 'Escape') { e.stopPropagation(); end(false); h3.blur(); } });
    h3.addEventListener('blur', () => end(true), { once: true });
  }
  async function sectionMenu(z, anchor) {
    const sid = z.dataset.zone;
    const i = ctx.sections.findIndex((s) => s.id === sid);
    const items = [{ value: 'rename', label: 'Rename', icon: 'list' }];
    if (i > 0) items.push({ value: 'up', label: 'Move up', icon: 'up' });
    if (i < ctx.sections.length - 1) items.push({ value: 'down', label: 'Move down', icon: 'down' });
    items.push({ value: 'del', label: 'Delete section', hint: 'Its tasks stay, with no section', icon: 'trash' });
    const v = await choose({ anchor, title: 'Section', items });
    if (v === 'rename') renameSection(z.querySelector('.pj-sec__name'));
    else if (v === 'up') ctx.moveSection(sid, -1);
    else if (v === 'down') ctx.moveSection(sid, 1);
    else if (v === 'del') ctx.deleteSection(sid);
  }
  async function addSection() {
    const s = await ctx.addSection('New section');
    if (!s) return;
    skeleton = '';
    render();
    const z = root.querySelector(`.pj-sec[data-zone="${CSS.escape(s.id)}"]`);
    if (z) { z.scrollIntoView({ block: 'nearest' }); renameSection(z.querySelector('.pj-sec__name')); }
  }

  /* ---------------------------------------------------------------- the cursor and the keyboard */
  function setCursor(id) {
    cur = id;
    for (const r of root.querySelectorAll('.pj-row.is-cur')) r.classList.remove('is-cur');
    const row = id && root.querySelector(`.pj-row[data-id="${CSS.escape(id)}"]`);
    if (row) { row.classList.add('is-cur'); row.scrollIntoView({ block: 'nearest' }); }
  }
  const focusAdd = (gid) => {
    const z = gid !== undefined ? root.querySelector(`.pj-add[data-gid="${CSS.escape(gid)}"]`) : null;
    const f = z || root.querySelector('.pj-add');
    if (f) { const i = f.querySelector('input'); i.focus(); i.scrollIntoView({ block: 'nearest' }); }
  };
  function onKey(e) {
    if (destroyed || e.defaultPrevented) return;
    if (e.metaKey && e.key !== 'a') return;
    const el = document.activeElement;
    if (sheetOpen() || document.querySelector('.pj-dr.is-open')) { return; }
    if (typing(el)) return;
    const k = e.key;
    const rows = visibleRows();
    const idx = rows.findIndex((r) => r.dataset.id === cur);
    const inList = root.contains(el) || el === document.body || !el;
    if (!inList) return;
    if (k === 'ArrowDown' || k === 'j') {
      e.preventDefault();
      if (e.altKey && cur) { moveBy(cur, 1); return; }
      const n = rows[Math.min(rows.length - 1, idx + 1)];
      if (n) { setCursor(n.dataset.id); n.focus({ preventScroll: true }); }
    } else if (k === 'ArrowUp' || k === 'k') {
      e.preventDefault();
      if (e.altKey && cur) { moveBy(cur, -1); return; }
      const n = rows[Math.max(0, idx < 0 ? rows.length - 1 : idx - 1)];
      if (n) { setCursor(n.dataset.id); n.focus({ preventScroll: true }); }
    } else if (k === ' ' && cur) {
      e.preventDefault();
      const ids = ctx.sel.size ? [...ctx.sel] : [cur];
      const all = ids.every((id) => (ctx.by.get(id) || {}).status === 'done');
      ctx.bulk(ids, { done: !all });
    } else if (k === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const t = cur && ctx.by.get(cur);
      focusAdd(t && !mine ? t.section_id || '' : undefined);
    } else if ((k === 'o' || k === 'ArrowRight') && cur) {
      const t = ctx.by.get(cur); if (t && !String(t.id).startsWith('tmp-')) { e.preventDefault(); o.open(t); }
    } else if (k === 'x' && cur) {
      e.preventDefault(); setSel(cur, !ctx.sel.has(cur)); lastSel = cur; ctx.emit('select');
    } else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); rows.forEach((r) => ctx.sel.add(r.dataset.id)); ctx.emit('select');
    } else if (k === 'F2' && cur) {
      e.preventDefault(); editTitle(cur);
    } else if ((k === 'Delete' || k === 'Backspace') && (ctx.sel.size || cur)) {
      e.preventDefault(); ctx.remove(ctx.sel.size ? [...ctx.sel] : [cur]);
    } else if (k === 'Escape') {
      if (ctx.sel.size || ctx.selecting) { ctx.sel.clear(); ctx.selecting = false; ctx.emit('select'); } else if (cur) { cur = null; cache.clear(); render(); }
    } else if (k === 'd' && cur) {
      e.preventDefault(); const t = ctx.by.get(cur); const r = root.querySelector(`.pj-row[data-id="${CSS.escape(cur)}"] [data-act="due"]`); pickDate({ anchor: r, value: t.due_date }).then((v) => { if (v !== undefined) ctx.patch(cur, { due_date: v }); });
    } else if (k === 'a' && cur) {
      e.preventDefault(); const t = ctx.by.get(cur); pickOwner({ title: 'Assign to', current: t.owner_email }).then((r) => { if (r) ctx.patch(cur, { owner_email: r.email }); });
    }
  }
  function moveBy(id, dir) {
    if (mine) return;
    const t = ctx.by.get(id);
    const sib = ctx.grouped().get(t.section_id || '') || [];
    const i = sib.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= sib.length) return;
    ctx.move(id, dir > 0 ? { section_id: t.section_id, after: sib[j].id } : { section_id: t.section_id, before: sib[j].id }).then(() => setCursor(id));
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', () => {});

  /* ---------------------------------------------------------------- drag */
  const stop = dnd(root, {
    item: '.pj-row', zone: '.pj-sec', body: '[data-rows]', grip: '[data-grip]',
    canStart: (item) => !(ctx.selecting || ctx.sel.size > 0 && phone()) && item.dataset.id !== editing && !String(item.dataset.id).startsWith('tmp-'),
    onDrop: (d) => {
      if (mine) {
        const g = dueGroups(ctx).find((x) => x.id === d.zone);
        if (g && g.drop) { const t = ctx.by.get(d.id); const body = g.drop(t); if (body && body.due_date !== t.due_date) ctx.patch(d.id, body); }
        return;
      }
      ctx.move(d.id, { section_id: d.zone || null, before: d.beforeId || undefined, after: d.afterId || undefined });
    },
  });

  const off = ctx.on((what) => { if (what === 'edit-end' && editing) return; render(); });
  render();
  return {
    destroy() { destroyed = true; off(); stop(); document.removeEventListener('keydown', onKey); if (bar) bar.remove(); document.documentElement.classList.remove('pj-bulk-open'); root.innerHTML = ''; root.classList.remove('pj-list'); },
    focusAdd, setCursor, render: () => { cache.clear(); render(); }, cursor: () => cur,
    addTo: (gid, title) => addTask(gid, title),
    firstGroupId: () => { const g = groupsNow()[0]; return g ? g.id : ''; },
    currentGroupId: () => { const t = cur && ctx.by.get(cur); return t ? t.section_id || '' : undefined; },
  };
}
