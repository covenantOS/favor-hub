/* The Board view: columns by section or by status, cards you drag between them, an add field at the foot of each column. */
import { esc, icon, phone, choose, askText } from './ui-util.js';
import { dnd } from './ui-dnd.js';
import { checkBtn, codeChips, dueHtml, counts, stateTag, priorityIcon, ownerBtn, fromMeeting } from './ui-rows.js';
import { pickOwner } from './ui-pickers.js';
import { STATUS } from './ui-util.js';

const STATUSES = ['open', 'doing', 'waiting', 'done'];

const PAGE = 40;
const STEP = 80;

export function mountBoard(root, ctx, o) {
  const shown = new Map();
  const colKey = (id) => mode() + ':' + id;
  const limitOf = (id) => shown.get(colKey(id)) || PAGE;
  let skeleton = '';
  let destroyed = false;
  let cache = new Map();
  const mode = () => (ctx.boardBy === 'status' ? 'status' : 'section');
  root.classList.add('pj-board');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Board');

  const cardHtml = (t) => {
    const done = t.status === 'done';
    return `<article class="pj-card${done ? ' is-done' : ''}${t.pending ? ' is-pending' : ''}${t.overdue ? ' is-late' : ''}" data-id="${esc(t.id)}" tabindex="-1"><div class="pj-card__top">${checkBtn(t)}<span class="pj-title" data-act="open">${esc(t.title)}</span></div>${t.appeal_code || t.source_code || t.fund_code || t.campaign_code ? `<div class="pj-card__chips">${codeChips(t, 4)}</div>` : ''}${stateTag(t) ? `<div class="pj-card__tags">${stateTag(t)}</div>` : ''}${t.meeting ? `<div class="pj-card__tags">${fromMeeting(t)}</div>` : ''}<div class="pj-card__foot">${t.code ? `<span class="pj-code-id">${esc(t.code)}</span>` : ''}<span class="pj-card__counts">${counts(t)}</span><span class="pj-sp"></span>${priorityIcon(t)}${dueHtml(t)}${ownerBtn(t)}</div></article>`;
  };
  const cardCached = (t) => {
    const key = [t.title, t.status, t.due_date, t.due_time, t.priority, t.owner_email, t.code, t.appeal_code, t.source_code, t.fund_code, t.campaign_code, t.subtasks && t.subtasks.done, t.subtasks && t.subtasks.total, t.comments, t.files, t.blocked, t.overdue, t.pending].join('|');
    const c = cache.get(t.id);
    if (c && c.key === key) return c.html;
    const html = cardHtml(t);
    cache.set(t.id, { key, html });
    return html;
  };

  function columns() {
    if (mode() === 'status') {
      const m = new Map(STATUSES.map((s) => [s, []]));
      for (const t of ctx.tasks) { if (!ctx.matches(t)) continue; (m.get(t.status === 'dropped' ? 'done' : t.status) || m.get('open')).push(t); }
      for (const a of m.values()) a.sort((x, y) => x.sort - y.sort);
      return STATUSES.map((s) => ({ id: s, name: STATUS[s], tasks: m.get(s), status: true }));
    }
    const m = ctx.grouped();
    const cols = ctx.sections.map((s) => ({ id: s.id, name: s.name, tasks: m.get(s.id) || [], section: true }));
    const none = m.get('') || [];
    if (none.length || !ctx.sections.length) cols.push({ id: '', name: ctx.sections.length ? 'No section' : 'Tasks', tasks: none });
    return cols;
  }

  function render() {
    if (destroyed) return;
    if (ctx.loading) { root.innerHTML = '<div class="pj-skel pj-skel--board" aria-busy="true"><i></i><i></i><i></i></div>'; skeleton = ''; return; }
    if (ctx.error) { root.innerHTML = `<div class="pj-empty pj-empty--err"><p>${esc(ctx.error)}</p><button type="button" class="pj-btn" data-act="retry">Try again</button></div>`; skeleton = ''; return; }
    const cols = columns();
    const sk = mode() + '|' + cols.map((c) => c.id + ':' + c.name).join(';');
    let focused = null;
    if (sk !== skeleton) {
      const a = document.activeElement;
      if (a && a.classList && a.classList.contains('pj-add__in') && root.contains(a)) focused = { gid: a.closest('.pj-add').dataset.gid, v: a.value };
      root.innerHTML = cols.map((c) => `<section class="pj-col" data-zone="${esc(c.id)}" data-status="${c.status ? esc(c.id) : ''}" role="group" aria-label="${esc(c.name)}"><header class="pj-col__h">${c.status ? `<i class="pj-sdot" data-s="${esc(c.id)}"></i>` : ''}<h3>${esc(c.name)}</h3><span class="pj-sec__n" data-n></span><span class="pj-sec__sp"></span>${c.section ? `<button type="button" class="pj-sec__more" data-act="secmenu" aria-label="Section menu for ${esc(c.name)}">${icon('more')}</button>` : ''}</header><div class="pj-col__cards" data-cards></div><button type="button" class="pj-showmore" data-act="more" hidden></button>${c.status && c.id === 'done' ? '' : `<form class="pj-add" data-gid="${esc(c.id)}" autocomplete="off"><span class="pj-add__plus">${icon('plus')}</span><input class="pj-add__in" type="text" maxlength="300" placeholder="Add a task" aria-label="Add a task to ${esc(c.name)}" enterkeyhint="done" /></form>`}</section>`).join('') + (mode() === 'section' && ctx.project ? `<div class="pj-col pj-col--new"><button type="button" class="pj-addsec" data-act="addsec">${icon('plus')}Add section</button></div>` : '');
      skeleton = sk;
    }
    const zones = [...root.querySelectorAll('.pj-col:not(.pj-col--new)')];
    cols.forEach((c, i) => {
      const z = zones[i];
      const n = z.querySelector('[data-n]');
      const sc = mode() === 'section' && ctx.counts && !ctx.showDone && !ctx.filter.q ? (ctx.counts.by_section[c.id || ''] || {}).done : 0;
      n.textContent = c.tasks.length + (sc ? ' · ' + sc + ' done' : '');
      const box = z.querySelector('[data-cards]');
      const lim = limitOf(c.id);
      const left = Math.max(0, c.tasks.length - lim);
      const more = z.querySelector('[data-act="more"]');
      if (more) { more.hidden = !left; more.textContent = left ? 'Show ' + Math.min(left, STEP) + ' more of ' + left : ''; }
      const part = left ? c.tasks.slice(0, lim) : c.tasks;
      const ids = part.map((t) => t.id);
      const htmls = part.map(cardCached);
      const same = box._ids && box._ids.length === ids.length && box._ids.every((v, k) => v === ids[k]);
      if (same) {
        for (let k = 0; k < ids.length; k++) if (box._html[k] !== htmls[k]) { const tpl = document.createElement('template'); tpl.innerHTML = htmls[k]; box.children[k].replaceWith(tpl.content.firstElementChild); }
      } else box.innerHTML = htmls.join('');
      box._ids = ids; box._html = htmls;
    });
    if (focused) { const f = root.querySelector(`.pj-add[data-gid="${CSS.escape(focused.gid)}"] .pj-add__in`); if (f) { f.value = focused.v; f.focus({ preventScroll: true }); } }
  }

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    const a = act ? act.dataset.act : '';
    if (a === 'retry') { ctx.load(o.key); return; }
    if (a === 'more') { const z = e.target.closest('.pj-col'); shown.set(colKey(z.dataset.zone), limitOf(z.dataset.zone) + STEP); render(); return; }
    if (a === 'addsec') { const s = await ctx.addSection('New section'); if (s) { skeleton = ''; render(); const sc = root; sc.scrollLeft = sc.scrollWidth; } return; }
    if (a === 'secmenu') {
      const z = e.target.closest('.pj-col');
      const sid = z.dataset.zone;
      const i = ctx.sections.findIndex((s) => s.id === sid);
      const items = [{ value: 'rename', label: 'Rename', icon: 'list' }];
      if (i > 0) items.push({ value: 'up', label: 'Move left', icon: 'back' });
      if (i < ctx.sections.length - 1) items.push({ value: 'down', label: 'Move right', icon: 'right' });
      items.push({ value: 'del', label: 'Delete section', hint: 'Its tasks stay, with no section', icon: 'trash' });
      const v = await choose({ anchor: act, title: 'Section', items });
      if (v === 'rename') { const name = await askText({ title: 'Rename section', value: ctx.sections[i].name, label: 'Name' }); if (name) ctx.renameSection(sid, name); }
      else if (v === 'up') ctx.moveSection(sid, -1);
      else if (v === 'down') ctx.moveSection(sid, 1);
      else if (v === 'del') ctx.deleteSection(sid);
      return;
    }
    const card = e.target.closest('.pj-card');
    if (!card) return;
    const t = ctx.by.get(card.dataset.id);
    if (!t) return;
    if (a === 'done') { ctx.patch(t.id, { done: t.status !== 'done' }); return; }
    if (a === 'owner') { const r = await pickOwner({ title: 'Assign to', current: t.owner_email }); if (r) ctx.patch(t.id, { owner_email: r.email }); return; }
    if (String(t.id).startsWith('tmp-')) return;
    o.open(t);
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('.pj-add');
    if (!f) return;
    e.preventDefault();
    const inp = f.querySelector('input');
    const title = inp.value.trim();
    if (!title) return;
    inp.value = '';
    const gid = f.dataset.gid;
    shown.set(colKey(gid), Infinity);
    const body = { title };
    if (mode() === 'status') { body.section_id = null; } else body.section_id = gid || null;
    const ow = ctx.filter.owner;
    if (ow && ow !== 'none') body.owner_email = ow === 'me' ? ctx.me : ow;
    const p = ctx.create(body);
    if (mode() === 'status' && gid !== 'open') p.then((t) => { if (t && t.id) ctx.patch(t.id, { status: gid }, { quiet: true }); });
    inp.focus({ preventScroll: true });
  });
  root.addEventListener('keydown', (e) => { const i = e.target.closest && e.target.closest('.pj-add__in'); if (i && e.key === 'Escape') { e.stopPropagation(); i.value = ''; i.blur(); } });

  const stop = dnd(root, {
    item: '.pj-card', zone: '.pj-col:not(.pj-col--new)', body: '[data-cards]', scrollX: '.pj-board',
    canStart: (item) => !String(item.dataset.id).startsWith('tmp-'),
    onDrop: async (d) => {
      const t = ctx.by.get(d.id);
      if (!t) return;
      if (mode() === 'status') {
        if (d.zone === t.status) return;
        if (d.zone === 'done') { ctx.patch(t.id, { done: true }); return; }
        if (t.status === 'done') { const ok = await ctx.patch(t.id, { done: false }); if (!ok) return; if (d.zone === 'open') return; }
        ctx.patch(t.id, { status: d.zone });
        return;
      }
      ctx.move(d.id, { section_id: d.zone || null, before: d.beforeId || undefined, after: d.afterId || undefined });
    },
  });
  const off = ctx.on(() => render());
  render();
  return {
    destroy() { destroyed = true; off(); stop(); root.innerHTML = ''; root.classList.remove('pj-board'); },
    render: () => { skeleton = ''; cache.clear(); render(); },
    focusAdd: (gid) => { const f = root.querySelector(gid !== undefined ? `.pj-add[data-gid="${CSS.escape(gid)}"] input` : '.pj-add input'); if (f) f.focus(); },
  };
}
