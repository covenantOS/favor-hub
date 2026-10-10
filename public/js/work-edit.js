/* Full editing in the Work Center: the edit panel (every field of an action, its notes, tags and attachments, with the partner
   beside it), inline changes on the board (date, status, who), Edit selected, Delete, New action, Complete and schedule next,
   repeating follow-ups, Duplicate, Move, Opportunities, saved views, columns, export and keyboard shortcuts.
   Every change goes through /api/work/batches like the rest of the Work Center: saved first, sent to Blackbaud, checked, and
   undone from the toast or Recent for 24 hours. Loaded before work.js; it reaches the page's state through window.WC. */
(() => {
'use strict';
const W = () => window.WC;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATS = [['Phone call', 'Call', 'phone'], ['Email', 'Email', 'mail'], ['Meeting', 'Meeting', 'meet'], ['Mailing', 'Mailing', 'letter'], ['Task/Other', 'Task', 'task']];
const DUE_OUT = { 'Task/Other': 7, 'Phone call': 2, Email: 2, Mailing: 7, Meeting: 14 };
const COLS = [['type', 'Type', 4], ['what', 'Summary', 5], ['who', 'Fundraiser', 6], ['added', 'Added', 7]];
const BASE_COLS = ['44px', '112px', 'minmax(170px, 1.25fr)', '150px', 'minmax(200px, 2fr)', '150px', '88px'];
const E = {
  codes: null, me: { fid: null, type: null, name: null }, types: {}, views: [], opps: null, oppNames: {}, oppLoading: false,
  oppF: { fr: '', status: '', purpose: '', q: '', inactive: false }, cols: readCols(), panel: null,
};
function readCols() { try { return Object.assign({ type: 1, what: 1, who: 1, added: 1 }, JSON.parse(localStorage.getItem('wc.cols') || '{}')); } catch (_) { return { type: 1, what: 1, who: 1, added: 1 }; } }
const today = () => W().TODAY;
const addDays = (d, n) => W().addDays(d, n);
const nextMonday = () => { let d = addDays(today(), 1); while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addDays(d, 1); return d; };
const staffList = () => Object.keys(W().DATA.people).filter(W().live).filter(W().mayAssign).sort((a, b) => W().P(a).n.localeCompare(W().P(b).n));
const typeFor = (fid) => E.types[fid] || E.me.type || 'RDD Action';
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

/* ------------------------------------------------------------------ sending a change (optimistic, with saved, queued and failed states) */
// Every change: save the batch, send it, and report one of four states to whoever asked (the panel's status line, a row's tag, the toast).
async function send(params, o = {}) {
  const wc = W();
  const req = wc.reqId();
  const say = o.say || (() => {});
  say('saving', 'Saving…');
  let saved;
  try {
    saved = await wc.post('/api/work/batches', Object.assign({}, params, { req }));
  } catch (e) {
    if (e.data && e.data.error === 'conflict') { say('conflict', e.message, e.data.conflict); return { ok: false, conflict: e.data.conflict }; }
    say('failed', e.message || 'Blackbaud did not answer. Nothing was changed.');
    if (o.revert) o.revert();
    return { ok: false, error: e.message };
  }
  const b = saved.batch || {};
  if (!b.id) { say('saved', o.nothing || 'Nothing needed changing.'); return { ok: true, none: true }; }
  if (b.run_when === 'tonight') {
    say('queued', 'Saved. Blackbaud gets it after ' + wc.DATA.meter.resets + '.');
    wc.toast((o.label || 'Saved') + '. It goes to Blackbaud tonight.', b.id);
    wc.loadRecent();
    return { ok: true, queued: true, batch: b.id };
  }
  const ids = (saved.items || []).map((i) => String(i.id)).filter(Boolean);
  const r = await wc.driveBatch(b.id, ids.length ? ids : ['x'], { keep: true });
  await wc.loadRecent();
  const rec = wc.S.batches.find((x) => x.id === b.id);
  const failed = rec ? rec.items.filter((i) => i.state === 'failed') : [];
  if (failed.length) {
    const why = failed[0].error || 'Blackbaud turned it down.';
    say('failed', why);
    wc.toast(`${o.label || 'Change'}: ${why}`, b.id);
    if (o.revert) o.revert();
  } else if (r.held) {
    say('queued', r.held === 'wait' || r.held === 'error' ? 'Saved. Blackbaud is not taking changes right now; it goes when it answers.' : 'Saved. Blackbaud gets it after ' + wc.DATA.meter.resets + '.');
    wc.toast((o.label || 'Saved') + '. Waiting to send.', b.id);
  } else {
    say('saved', 'Saved to Blackbaud ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    wc.toast(o.label || 'Saved.', b.id);
  }
  E.lastBatch = b.id;
  if (o.after) await o.after();
  wc.refreshBoard();
  return { ok: !failed.length, batch: b.id, held: r.held };
}

/* ------------------------------------------------------------------ small building blocks */
const chip = (attr, v, label, on, icon) => `<button type="button" class="wc-choice${on ? ' is-on' : ''}" ${attr}="${esc(v)}">${icon ? W().ic(icon) : ''}${esc(label)}</button>`;
const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
function field(label, inner, cls) { return `<div class="wc-field${cls ? ' ' + cls : ''}"><span class="lab">${label}</span>${inner}</div>`; }
function peopleChips(list, name) {
  const wc = W();
  return `<div class="ep-people" data-people="${name}">${list.map((f) => `<span class="ep-person${wc.live(f) ? '' : ' is-left'}">${esc(wc.P(f).n)}${wc.gone(f)}<button type="button" data-unperson="${esc(f)}" aria-label="Remove ${esc(wc.P(f).n)}">×</button></span>`).join('')}
    <select class="ep-addperson" data-addperson="${name}" aria-label="Add a fundraiser"><option value="">Add a person…</option>${staffList().filter((f) => !list.includes(f)).map((f) => opt(f, wc.P(f).n)).join('')}</select></div>`;
}
function statusLine(state, text) {
  const icon = { saving: '<span class="wc-spin"></span>', saved: W().ic('check'), queued: W().ic('clock'), failed: W().ic('alert'), conflict: W().ic('alert') }[state] || '';
  return `<span class="ep-state ep-state--${state}">${icon}${esc(text)}</span>`;
}
function layer(html, cls, onMount) {
  const wc = W();
  const l = $('#layer');
  E.ret = document.activeElement;
  l.innerHTML = `<div class="wc-scrim" data-closelayer></div>${html}`;
  const box = l.lastElementChild;
  if (cls) box.classList.add(...cls.split(' '));
  requestAnimationFrame(() => { $$('.wc-scrim, .wc-drawer, .wc-dlg', l).forEach((x) => x.classList.add('is-on')); const f = $('[autofocus]', box); if (f) f.focus(); });
  if (onMount) onMount(box);
  void wc;
  return box;
}
function recurHTML(r, idp) {
  const on = !!r;
  const v = r || { every: 1, unit: 'month', left: null, until: null };
  return `<div class="ep-recur${on ? ' is-on' : ''}" data-recur="${idp}">
    <label class="wc-toggle"><input type="checkbox" data-recuron ${on ? 'checked' : ''} />Repeat this follow-up</label>
    <span class="ep-recur__rule">Every <input type="number" min="1" max="52" value="${v.every}" data-recurevery aria-label="How often" />
      <select data-recurunit aria-label="Unit">${[['day', 'days'], ['week', 'weeks'], ['month', 'months']].map(([k, l]) => opt(k, l, v.unit === k)).join('')}</select>
      <select data-recurend aria-label="Ends">${opt('', 'until I stop it', !v.left && !v.until)}${[2, 3, 4, 6, 12].map((n) => opt('n' + n, n + ' more times', v.left === n)).join('')}</select></span>
</div>`;
}
function readRecur(box) {
  const r = $('.ep-recur', box); if (!r || !$('[data-recuron]', r).checked) return null;
  const end = $('[data-recurend]', r).value;
  return { every: Number($('[data-recurevery]', r).value) || 1, unit: $('[data-recurunit]', r).value, left: end ? Number(end.slice(1)) : null };
}

/* ------------------------------------------------------------------ the edit panel */
const PANEL_TABS = [['details', 'Details'], ['notes', 'Notes'], ['tags', 'Tags'], ['files', 'Attachments']];

async function panel(id) {
  const wc = W();
  const a0 = wc.BYID[id];
  const box = layer(`<aside class="wc-drawer ep" role="dialog" aria-modal="true" aria-label="Edit action">
    <div class="wc-dlg__head ep-head"><div><span class="h-label">${esc(a0 ? a0.type + ' · ' + a0.cat : 'Action')}</span><h2>${esc(a0 ? a0.p : 'Loading…')}</h2>
      <p class="ep-sub">${a0 ? esc(a0.loc || 'No city on file') + ' · <a href="/work/partner/' + esc(a0.cid) + '">Partner page</a>' : ''}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close (Esc)">${wc.ic('x')}</button></div>
    <div class="ep-body"><div class="ep-main"><div class="h-skel" style="height:420px;border-radius:16px"></div></div><div class="ep-side" id="ep-side"></div></div>
    <div class="ep-foot"></div></aside>`);
  let d;
  try { d = await wc.api('/api/work/actions/' + encodeURIComponent(id)); } catch (e) {
    $('.ep-main', box).innerHTML = `<div class="wc-warn">${wc.ic('alert')}<span>${esc(e.message)}</span></div>`; return;
  }
  const act = d.action;
  E.panel = { id, act, orig: JSON.parse(JSON.stringify(act)), partner: d.partner, tab: 'details', box, dirty: {}, tags: null, notes: null, files: null };
  $('.h-label', box).textContent = (act.type || 'Action') + ' · ' + (act.category || '');
  $('h2', box).textContent = d.partner.name;
  $('.ep-sub', box).innerHTML = `${a0 ? esc(a0.loc || 'No city on file') + ' · ' : ''}Action ${esc(act.id)} · <a href="/work/partner/${esc(act.cid)}">Partner page</a>`;
  // The partner beside the panel is the partner page's own view, so the two always agree.
  const side = $('#ep-side', box);
  side.innerHTML = '<details class="ep-ctx" open><summary>About this partner</summary><div id="ep-pv"></div></details>';
  if (window.matchMedia('(max-width: 860px)').matches) $('details', side).open = false;
  if (window.FavorPartner) window.FavorPartner.mount($('#ep-pv', side), act.cid, { compact: true }).then((p) => { if (p && E.panel) E.panel.pv = p; });
  drawPanel();
}

function drawPanel() {
  const P = E.panel; if (!P) return;
  const wc = W();
  const a = P.act;
  const main = $('.ep-main', P.box);
  const done = a.status === 'Completed' || a.completed;
  main.innerHTML = `<div class="ep-tabs" role="tablist">${PANEL_TABS.map(([k, l]) => `<button type="button" role="tab" class="ep-tab${P.tab === k ? ' is-on' : ''}" data-eptab="${k}" aria-selected="${P.tab === k}">${l}${k === 'tags' && a.tags.length ? ` <i>${a.tags.length}</i>` : ''}</button>`).join('')}</div><div class="ep-pane" id="ep-pane"></div>`;
  const pane = $('#ep-pane', main);
  if (P.tab === 'details') {
    const C = E.codes || {};
    const opps = P.partner.opps || [];
    pane.innerHTML = `
      <div class="wc-field"><label for="ep-sum" class="lab">Summary</label><input type="text" id="ep-sum" data-f="summary" maxlength="255" value="${esc(a.summary)}" placeholder="What happened, or what to do" autofocus /></div>
      ${field('Category', `<div class="wc-choices">${CATS.map(([v, l, i]) => chip('data-fv="category" data-v', v, l, a.category === v, i)).join('')}</div>`)}
      <div class="wc-row2">${field('Type', `<select data-f="type">${opt('', 'No type', !a.type)}${(C.types || []).map((t) => opt(t, t.replace(/^RESERVED \((.*)\)$/, '$1'), a.type === t)).join('')}${a.type && !(C.types || []).includes(a.type) ? opt(a.type, a.type, true) : ''}</select>`)}
        ${field('Status', `<div class="wc-choices">${(C.statuses || ['Open', 'Completed', 'Canceled']).map((s) => chip('data-fv="status" data-v', s, s, a.status === s || (s === 'Open' && /past due/i.test(a.status)))).join('')}</div>`)}</div>
      <div class="wc-row3">${field(done ? 'Date' : 'Due', `<input type="date" data-f="date" value="${esc(a.date)}" />`)}${field('Start', `<input type="time" data-f="start_time" value="${esc(a.start_time)}" />`)}${field('End', `<input type="time" data-f="end_time" value="${esc(a.end_time)}" />`)}</div>
      ${done ? `<div class="wc-row2">${field('Completed on', `<input type="date" data-f="completed_date" value="${esc(a.completed_date)}" max="${today()}" />`)}${field('Outcome', `<div class="wc-choices">${[['', 'None'], ['Successful', 'Good'], ['Unsuccessful', 'Not good']].map(([v, l]) => chip('data-fv="outcome" data-v', v, l, a.outcome === v)).join('')}</div>`)}</div>` : ''}
      <div class="wc-row2">${field('Priority', `<div class="wc-choices">${['Low', 'Normal', 'High'].map((p) => chip('data-fv="priority" data-v', p, p, a.priority === p)).join('')}</div>`)}
        ${['Phone call', 'Email', 'Mailing'].includes(a.category) ? field('Direction', `<div class="wc-choices">${[['', 'None'], ['Outbound', 'Out'], ['Inbound', 'In']].map(([v, l]) => chip('data-fv="direction" data-v', v, l, a.direction === v)).join('')}</div>`) : '<div></div>'}</div>
      <div class="wc-row2">${a.category === 'Meeting' ? field('Location', `<select data-f="location">${opt('', 'None', !a.location)}${(C.locations || []).map((l) => opt(l, l, a.location === l)).join('')}</select>`) : '<div></div>'}
        ${field('Opportunity', `<select data-f="opportunity_id">${opt('', 'None', !a.opportunity_id)}${opps.map((o) => opt(o.id, o.name + (o.status ? ' · ' + o.status : ''), a.opportunity_id === o.id)).join('')}</select><button type="button" class="wc-linkbtn" data-newopp>New opportunity for this partner</button>`)}</div>
      ${field('Fundraisers', peopleChips(a.fundraisers, 'fundraisers') + (P.partner.holders && P.partner.holders.length ? `<small>Held by ${P.partner.holders.map((h) => esc(wc.P(h.fid).n) + (h.type ? ' (' + esc(h.type) + ')' : '')).join(', ')}</small>` : ''))}
      <div class="wc-field"><label for="ep-desc" class="lab">Description</label><textarea id="ep-desc" data-f="description" rows="5">${esc(a.description)}</textarea></div>
      ${done ? '' : recurHTML(a.recur, 'edit')}
      <p class="ep-meta">Added ${esc(String(a.added).slice(0, 10))}${a.author ? ' by ' + esc(a.author) : ''}${a.modified ? ' · Changed ' + esc(String(a.modified).slice(0, 10)) : ''}${a.pending ? ' · A change from here is still on its way to Blackbaud' : ''}</p>`;
  } else if (P.tab === 'notes') paneNotes(pane);
  else if (P.tab === 'tags') paneTags(pane);
  else paneFiles(pane);
  drawFoot();
}

function drawFoot(state, text) {
  const P = E.panel; if (!P) return;
  const wc = W();
  const a = P.act;
  const done = a.status === 'Completed' || a.completed;
  const dirty = Object.keys(P.dirty).length || P.recurDirty;
  const foot = $('.ep-foot', P.box);
  if (state) P.state = [state, text];
  const st = P.state ? statusLine(P.state[0], P.state[1]) : dirty ? statusLine('dirty', 'Not saved yet') : '<span class="ep-state"></span>';
  foot.innerHTML = `<div class="ep-foot__more">
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-ep="dup" title="Copy this action to this partner or others">Duplicate</button>
      ${wc.DATA.me.canMove ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-ep="move" title="Move it to another partner">Move</button>' : ''}
      ${wc.DATA.me.canDelete ? '<button type="button" class="h-btn h-btn--ghost h-btn--sm ep-del" data-ep="delete">Delete</button>' : ''}</div>
    <div class="ep-foot__main">${st}
      ${done ? '' : `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-ep="next" title="Complete this one and schedule the next">${wc.ic('cal')}Complete and next</button>
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-ep="complete" title="Mark complete (c)">${wc.ic('check')}Complete</button>`}
      <button type="button" class="h-btn h-btn--primary h-btn--sm" data-ep="save" ${dirty ? '' : 'disabled'} title="Save (Ctrl+Enter)">Save</button></div>`;
}

function markDirty(k, v) {
  const P = E.panel; if (!P) return;
  P.act[k] = v;
  const same = JSON.stringify(P.orig[k] ?? '') === JSON.stringify(v ?? '');
  if (same) delete P.dirty[k]; else P.dirty[k] = v;
  P.state = null;
  drawFoot();
}

async function savePanel(extra = {}) {
  const P = E.panel; if (!P) return;
  const wc = W();
  const set = Object.assign({}, P.dirty, extra);
  const seen = {};
  Object.keys(set).forEach((k) => { seen[k] = P.orig[k]; });
  const params = { op: 'edit', ids: [P.id], set, seen };
  if (P.recurDirty) params.recur = readRecur(P.box) || null;
  const row = wc.BYID[P.id];
  // Optimistic: the board shows the change at once; a refusal puts it back.
  const before = row ? { due: row.due, sum: row.sum, cat: row.cat, type: row.type, f: row.f } : null;
  if (row) {
    if (set.date) wc.S.ov[P.id] = Object.assign({}, wc.S.ov[P.id], { due: set.date });
    if (set.fundraisers) wc.S.ov[P.id] = Object.assign({}, wc.S.ov[P.id], { f: set.fundraisers });
    if (set.summary !== undefined) row.sum = set.summary;
    if (set.category) row.cat = set.category;
    if (set.type) row.type = set.type;
    if (set.status === 'Completed' || set.status === 'Canceled' || set.completed === true) wc.S.gone[P.id] = 1;
    wc.render();
  }
  const label = set.status === 'Completed' || set.completed ? 'Marked complete' : 'Saved the action';
  const r = await send(params, {
    label,
    say: (s, t, conflict) => {
      if (!E.panel || E.panel.id !== P.id) return;
      drawFoot(s, t);
      if (conflict) showConflict(conflict);
    },
    revert: () => { if (row && before) { Object.assign(row, { sum: before.sum, cat: before.cat, type: before.type }); delete wc.S.ov[P.id]; delete wc.S.gone[P.id]; wc.render(); } },
  });
  if (r.ok && E.panel && E.panel.id === P.id) {
    P.orig = JSON.parse(JSON.stringify(P.act));
    P.dirty = {}; P.recurDirty = false;
    if (set.status === 'Completed' || set.completed) { P.act.completed = true; P.act.status = 'Completed'; P.orig = JSON.parse(JSON.stringify(P.act)); }
    drawPanel();
    drawFoot(P.state ? P.state[0] : 'saved', P.state ? P.state[1] : 'Saved');
  }
  return r;
}

function showConflict(c) {
  const P = E.panel; if (!P) return;
  const lab = { summary: 'Summary', description: 'Description', date: 'Date', fundraisers: 'Fundraisers', category: 'Category', type: 'Type', status: 'Status', priority: 'Priority', location: 'Location', outcome: 'Outcome', direction: 'Direction' };
  const box = document.createElement('div');
  box.className = 'wc-warn ep-conflict';
  box.innerHTML = `${W().ic('alert')}<span><b>Changed in Blackbaud after you opened it.</b> ${c.fields.map((f) => `${lab[f] || f} is now “${esc(Array.isArray(c.current[f]) ? c.current[f].map((x) => W().P(x).n).join(', ') : String(c.current[f] ?? 'empty').slice(0, 80))}”`).join('; ')}. <button type="button" class="wc-linkbtn" data-keepmine>Keep mine and save</button> <button type="button" class="wc-linkbtn" data-takeirs>Use theirs</button></span>`;
  box.querySelector('[data-keepmine]').onclick = () => { c.fields.forEach((f) => { P.orig[f] = c.current[f]; }); box.remove(); savePanel(); };
  box.querySelector('[data-takeirs]').onclick = () => { c.fields.forEach((f) => { P.act[f] = f === 'date' ? String(c.current[f] || '').slice(0, 10) : c.current[f]; P.orig[f] = P.act[f]; delete P.dirty[f]; }); box.remove(); drawPanel(); };
  $('.ep-main', P.box).prepend(box);
}

/* notes, tags, attachments: read when the tab opens (one Blackbaud call each, kept ten minutes) */
async function loadExtra(what, fresh) {
  const P = E.panel; if (!P) return [];
  try { const r = await W().api(`/api/work/actions/${P.id}/extra?what=${what}${fresh ? '&fresh=1' : ''}`); return r.rows; } catch (e) { return { error: e.message }; }
}
async function paneNotes(pane, fresh) {
  const P = E.panel; const wc = W();
  if (!P.notes || fresh) { pane.innerHTML = '<div class="h-skel" style="height:120px;border-radius:14px"></div>'; P.notes = await loadExtra('notes', fresh); }
  if (!E.panel || E.panel.tab !== 'notes') return;
  const list = Array.isArray(P.notes) ? P.notes : [];
  const C = E.codes || {};
  pane.innerHTML = `${P.notes && P.notes.error ? `<div class="wc-warn">${wc.ic('alert')}<span>${esc(P.notes.error)}</span></div>` : ''}
    <div class="ep-list">${list.length ? list.map((n) => `<div class="ep-note" data-noteid="${esc(n.id)}"><div><b>${esc(n.summary || n.type)}</b><span class="wc-sub">${esc(n.type)}${n.date && n.date.y ? ' · ' + wc.fd(`${n.date.y}-${String(n.date.m || 1).padStart(2, '0')}-${String(n.date.d || 1).padStart(2, '0')}`, true) : ''}${n.author ? ' · ' + esc(n.author) : ''}</span><p>${esc(n.text)}</p></div>
      <div class="ep-note__acts"><button type="button" class="wc-linkbtn" data-noteedit="${esc(n.id)}">Edit</button><button type="button" class="wc-linkbtn ep-del" data-notedel="${esc(n.id)}">Remove</button></div></div>`).join('') : '<p class="wc-note">No notes on this action yet.</p>'}</div>
    <form class="ep-add" data-noteform><b class="lab">Add a note</b>
      <div class="wc-row2"><select name="type" aria-label="Note type">${(C.noteTypes || ['RDD Note']).map((t) => opt(t, t.replace(/^Reserved Note \((.*)\)$/, '$1'))).join('')}</select><input type="text" name="summary" maxlength="255" placeholder="Summary" /></div>
      <textarea name="text" rows="3" placeholder="The note"></textarea><input type="hidden" name="id" value="" />
      <div class="ep-add__acts"><button type="submit" class="h-btn h-btn--primary h-btn--sm">Add note</button><button type="button" class="wc-linkbtn" data-notecancel hidden>Cancel the edit</button></div></form>`;
}
function tagCat(name) { return ((E.codes && E.codes.tagCategories) || []).find((c) => c.name === name); }
function tagValueInput(cat, val) {
  const c = tagCat(cat);
  if (!c) return '<input type="text" name="value" placeholder="Value" />';
  if (c.type === 'Number') return `<input type="number" name="value" step="any" value="${esc(val ?? '')}" placeholder="Number" />`;
  if (c.type === 'CodeTableEntry' && c.values && c.values.length) return `<select name="value">${c.values.map((v) => opt(v, v, String(val) === v)).join('')}</select>`;
  if (c.type === 'Boolean') return `<select name="value">${opt('true', 'Yes', val !== false)}${opt('false', 'No', val === false)}</select>`;
  return `<input type="text" name="value" value="${esc(val ?? (c.type === 'CodeTableEntry' ? c.name : ''))}" placeholder="Value" />`;
}
async function paneTags(pane, fresh) {
  const P = E.panel; const wc = W();
  if (!P.tags || fresh) { pane.innerHTML = '<div class="h-skel" style="height:120px;border-radius:14px"></div>'; P.tags = await loadExtra('tags', fresh); }
  if (!E.panel || E.panel.tab !== 'tags') return;
  const list = Array.isArray(P.tags) ? P.tags : [];
  const cats = ((E.codes && E.codes.tagCategories) || []).filter((c) => !/^RESERVED|^NXT /.test(c.name) || list.some((t) => t.category === c.name));
  const more = ((E.codes && E.codes.tagCategories) || []).filter((c) => /^RESERVED|^NXT /.test(c.name));
  pane.innerHTML = `${P.tags && P.tags.error ? `<div class="wc-warn">${wc.ic('alert')}<span>${esc(P.tags.error)}</span></div>` : ''}
    <div class="ep-list">${list.length ? list.map((t) => `<form class="ep-tag" data-tagform="${esc(t.id)}"><b>${esc(t.category)}</b>${tagValueInput(t.category, t.value)}<button type="submit" class="wc-linkbtn">Change</button><button type="button" class="wc-linkbtn ep-del" data-tagdel="${esc(t.id)}" data-cat="${esc(t.category)}">Remove</button></form>`).join('') : '<p class="wc-note">No tags on this action yet.</p>'}</div>
    <div class="ep-quicktags"><span class="lab">Add with one click</span><div class="wc-choices">${['Thanked', 'Texted', 'Stewardship', 'Scheduling', 'Favor Presentation', 'Attended Event', 'Hosted Event'].filter((c) => tagCat(c) && !list.some((t) => t.category === c)).map((c) => `<button type="button" class="wc-choice" data-quicktag="${esc(c)}">${W().ic('plus')}${esc(c)}</button>`).join('')}</div></div>
    <form class="ep-add" data-tagadd><b class="lab">Add a tag with a value</b><div class="wc-row2"><select name="category" data-tagcat aria-label="Tag">${cats.concat(more).map((c) => opt(c.name, c.name.replace(/^RESERVED \((.*)\)$/, '$1'))).join('')}</select><span data-tagval>${tagValueInput(cats[0] ? cats[0].name : '')}</span></div>
      <div class="ep-add__acts"><button type="submit" class="h-btn h-btn--primary h-btn--sm">Add tag</button></div></form>`;
}
async function paneFiles(pane, fresh) {
  const P = E.panel; const wc = W();
  if (!P.files || fresh) { pane.innerHTML = '<div class="h-skel" style="height:120px;border-radius:14px"></div>'; P.files = await loadExtra('attachments', fresh); }
  if (!E.panel || E.panel.tab !== 'files') return;
  const list = Array.isArray(P.files) ? P.files : [];
  pane.innerHTML = `${P.files && P.files.error ? `<div class="wc-warn">${wc.ic('alert')}<span>${esc(P.files.error)}</span></div>` : ''}
    <div class="ep-list">${list.length ? list.map((f) => `<div class="ep-file"><span>${wc.ic(f.type === 'Link' ? 'ext' : 'clip')}</span><div><b>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name || f.url)}</a>` : esc(f.name || f.file)}</b><span class="wc-sub">${esc(f.type)}${f.file ? ' · ' + esc(f.file) : ''}${f.date ? ' · ' + wc.fd(f.date, true) : ''}</span></div><button type="button" class="wc-linkbtn ep-del" data-filedel="${esc(f.id)}">Remove</button></div>`).join('') : '<p class="wc-note">No attachments on this action yet.</p>'}</div>
    <form class="ep-add" data-linkform><b class="lab">Attach a link</b><div class="wc-row2"><input type="url" name="url" placeholder="https://" required /><input type="text" name="name" maxlength="150" placeholder="Name (optional)" /></div>
      <div class="ep-add__acts"><button type="submit" class="h-btn h-btn--primary h-btn--sm">Attach link</button></div></form>
    <form class="ep-add" data-fileform><b class="lab">Attach a file</b><input type="file" name="file" /><small>Up to 10 MB.</small>
      <div class="ep-add__acts"><button type="submit" class="h-btn h-btn--ghost h-btn--sm">Upload</button></div></form>`;
}
async function extraChange(params, what, label) {
  const P = E.panel;
  const r = await send(Object.assign({ ids: [P.id] }, params), { label, say: (s, t) => { if (E.panel === P) drawFoot(s, t); } });
  if (E.panel === P) { P[what] = null; const pane = $('#ep-pane', P.box); ({ notes: paneNotes, tags: paneTags, files: paneFiles })[what](pane, true); }
  return r;
}

/* ------------------------------------------------------------------ dialogs: complete and next, duplicate, move, delete, bulk edit, new action */
function dlg(title, sub, body, foot, onMount) {
  const wc = W();
  return layer(`<div class="wc-dlg ep-dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="wc-dlg__head"><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="wc-dlg__x" data-closelayer aria-label="Close">${wc.ic('x')}</button></div>
    <div class="wc-dlg__body">${body}</div><div class="wc-dlg__foot">${foot}</div></div>`, '', onMount);
}
const dateChips = (attr, cur, base) => [['+3 days', addDays(base, 3)], ['+1 week', addDays(base, 7)], ['+2 weeks', addDays(base, 14)], ['+1 month', addDays(base, 30)], ['Next Monday', nextMonday()]].map(([l, v]) => chip(attr, v, l, cur === v)).join('');

function dlgNext(id) {
  const wc = W();
  const a = wc.BYID[id] || (E.panel && E.panel.id === id ? { p: E.panel.partner.name, sum: E.panel.act.summary, cat: E.panel.act.category } : { p: 'Partner', sum: '' });
  const st = { out: '', date: addDays(today(), 14), sum: a.sum || '', cat: a.cat || 'Phone call' };
  dlg('Complete and schedule the next', esc(a.p), `
    ${field('How did it go?', `<div class="wc-choices">${[['', 'Leave blank'], ['Successful', 'Good'], ['Unsuccessful', 'Not good']].map(([v, l]) => chip('data-out', v, l, st.out === v)).join('')}</div>`)}
    <div class="wc-field"><label class="lab" for="nx-line">Add one line to this one <span class="wc-opt">(optional)</span></label><input type="text" id="nx-line" maxlength="200" placeholder="For example: Left a message, will try again" /></div>
    <div class="ep-split"><b class="lab">The next one</b>
      ${field('Due', `<div class="wc-choices" data-group="date">${dateChips('data-nd', st.date, today())}<input type="date" data-ndin value="${st.date}" min="${today()}" aria-label="Due" /></div>`)}
      ${field('Category', `<div class="wc-choices">${CATS.map(([v, l, i]) => chip('data-ncat', v, l, st.cat === v, i)).join('')}</div>`)}
      <div class="wc-field"><label class="lab" for="nx-sum">Summary</label><input type="text" id="nx-sum" maxlength="255" value="${esc(st.sum)}" autofocus /></div>
      ${recurHTML(null, 'next')}</div>`,
    `<button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go>${wc.ic('check')}Complete and schedule</button>`,
    (box) => {
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.hasAttribute('data-out')) { st.out = b.dataset.out; $$('[data-out]', box).forEach((x) => x.classList.toggle('is-on', x === b)); }
        if (b.dataset.nd) { st.date = b.dataset.nd; $('[data-ndin]', box).value = st.date; $$('[data-nd]', box).forEach((x) => x.classList.toggle('is-on', x === b)); }
        if (b.dataset.ncat) { st.cat = b.dataset.ncat; $$('[data-ncat]', box).forEach((x) => x.classList.toggle('is-on', x === b)); }
        if (b.hasAttribute('data-go')) {
          const params = { op: 'complete_next', ids: [id], complete: st.out ? { outcome: st.out } : {}, line: $('#nx-line', box).value, next: { date: $('[data-ndin]', box).value || st.date, summary: $('#nx-sum', box).value, category: st.cat }, recur: readRecur(box) };
          wc.closeLayer(); wc.S.gone[id] = 1; wc.render();
          await send(params, { label: `Completed. The next is due ${wc.fd(params.next.date)}`, revert: () => { delete wc.S.gone[id]; wc.render(); } });
        }
      });
      box.addEventListener('change', (e) => { if (e.target.matches('[data-ndin]')) { st.date = e.target.value; $$('[data-nd]', box).forEach((x) => x.classList.remove('is-on')); } if (e.target.matches('[data-recuron]')) e.target.closest('.ep-recur').classList.toggle('is-on', e.target.checked); });
    });
}

function partnerPicker(host, o) {
  if (!window.FavorPartner) { host.innerHTML = '<p class="wc-note">Partner search did not load. Reload the page.</p>'; return; }
  window.FavorPartner.search(host, { placeholder: o.placeholder || 'Find a partner: name, email, phone or lookup id', onPick: o.onPick });
}

function dlgCopy(id, mode) {
  const wc = W();
  const a = wc.BYID[id] || { p: E.panel ? E.panel.partner.name : 'this partner', cid: E.panel ? E.panel.act.cid : '' };
  const st = { cids: mode === 'dup' ? [{ cid: a.cid, name: a.p }] : [], date: '' };
  const move = mode === 'move';
  const draw = (box) => {
    $('[data-picked]', box).innerHTML = st.cids.map((c) => `<span class="ep-person">${esc(c.name)}<button type="button" data-unpick="${esc(c.cid)}" aria-label="Remove">×</button></span>`).join('') || `<span class="wc-note">${move ? 'Pick the partner it belongs to.' : 'Pick one or more partners.'}</span>`;
    $('[data-go]', box).disabled = !st.cids.length;
  };
  dlg(move ? 'Move to another partner' : 'Duplicate this action', esc(a.p), `
    <div class="wc-field"><span class="lab">${move ? 'Move it to' : 'Copy it to'}</span><div class="ep-people" data-picked></div><div data-find></div></div>
    ${move ? '' : field('Date on the copies <span class="wc-opt">(optional)</span>', `<input type="date" data-cdate />`)}
    <div class="wc-plan"><span class="wc-note">${move ? 'Notes and attachments stay with the original.' : 'Copies keep the summary, type, category, fundraisers and description.'}</span></div>`,
    `<button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go disabled>${move ? 'Move it' : 'Make the copies'}</button>`,
    (box) => {
      partnerPicker($('[data-find]', box), { onPick: (h) => { if (move) st.cids = [{ cid: h.cid, name: h.name }]; else if (!st.cids.some((c) => c.cid === h.cid)) st.cids.push({ cid: h.cid, name: h.name }); draw(box); $('[data-find] input', box).value = ''; } });
      draw(box);
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.unpick) { st.cids = st.cids.filter((c) => c.cid !== b.dataset.unpick); draw(box); }
        if (b.hasAttribute('data-go')) {
          const date = $('[data-cdate]', box) ? $('[data-cdate]', box).value : '';
          const params = move ? { op: 'move', ids: [id], to: st.cids[0].cid } : { op: 'duplicate', ids: [id], cids: st.cids.map((c) => c.cid), set: date ? { date } : undefined };
          wc.closeLayer();
          if (move) { wc.S.gone[id] = 1; wc.render(); }
          await send(params, { label: move ? `Moved to ${st.cids[0].name}` : `Copied to ${wc.plural(st.cids.length, 'partner')}`, revert: () => { delete wc.S.gone[id]; wc.render(); } });
        }
      });
    });
}

function dlgDelete(ids) {
  const wc = W();
  if (!ids.length) return;
  dlg(`Delete ${wc.plural(ids.length, 'action')}?`, '', `<div class="wc-warn">${wc.ic('alert')}<span>They come out of Blackbaud. Undo from the toast or Recent for 24 hours brings back a copy with the same fields; notes and attachments on them do not come back.</span></div>
    <ul class="ep-dellist">${ids.slice(0, 8).map((id) => { const a = wc.BYID[id]; return `<li><b>${esc(a ? a.p : 'Action ' + id)}</b> ${esc(a ? a.sum || a.type : '')}</li>`; }).join('')}${ids.length > 8 ? `<li>and ${ids.length - 8} more</li>` : ''}</ul>`,
    `<button class="h-btn h-btn--ghost" data-closelayer autofocus>Keep them</button><button class="h-btn h-btn--danger" data-go>Delete ${ids.length}</button>`,
    (box) => {
      $('[data-go]', box).onclick = async () => {
        wc.closeLayer(); wc.clearSel();
        ids.forEach((id) => { wc.S.gone[id] = 1; }); wc.render();
        if (E.panel && ids.includes(E.panel.id)) E.panel = null;
        await send({ op: 'delete', ids }, { label: `Deleted ${wc.plural(ids.length, 'action')}`, revert: () => { ids.forEach((id) => delete wc.S.gone[id]); wc.render(); } });
      };
    });
}

const BULK = [
  ['category', 'Category'], ['type', 'Type'], ['status', 'Status'], ['date', 'Due date'], ['priority', 'Priority'], ['direction', 'Direction'],
  ['location', 'Location'], ['outcome', 'Outcome'], ['fundraisers', 'Fundraisers (replace)'], ['line', 'Add a line to the description'], ['tag', 'Add a tag'],
];
function dlgBulk(ids) {
  const wc = W();
  if (!ids.length) return;
  const C = E.codes || {};
  const st = { on: {}, v: { category: 'Phone call', type: (C.types || [])[0] || '', status: 'Open', date: addDays(today(), 7), priority: 'High', direction: 'Outbound', location: (C.locations || [])[0] || '', outcome: 'Successful', fundraisers: [], line: '', tag: 'Thanked' } };
  const input = (k) => {
    const v = st.v[k];
    if (k === 'category') return `<select data-bv="category">${CATS.map(([c, l]) => opt(c, l, v === c)).join('')}</select>`;
    if (k === 'type') return `<select data-bv="type">${(C.types || []).map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'status') return `<select data-bv="status">${(C.statuses || ['Open', 'Completed', 'Canceled']).map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'date') return `<input type="date" data-bv="date" value="${v}" />`;
    if (k === 'priority') return `<select data-bv="priority">${['Low', 'Normal', 'High'].map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'direction') return `<select data-bv="direction">${opt('', 'None', !v)}${['Outbound', 'Inbound'].map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'location') return `<select data-bv="location">${opt('', 'None', !v)}${(C.locations || []).map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'outcome') return `<select data-bv="outcome">${opt('', 'None', !v)}${['Successful', 'Unsuccessful'].map((t) => opt(t, t, v === t)).join('')}</select>`;
    if (k === 'fundraisers') return `<select data-bv="fundraisers" multiple size="4">${staffList().map((f) => opt(f, wc.P(f).n, v.includes(f))).join('')}</select>`;
    if (k === 'line') return `<input type="text" data-bv="line" maxlength="200" value="${esc(v)}" placeholder="For example: Moved to Partner Care" />`;
    return `<select data-bv="tag">${((C.tagCategories || []).filter((c) => c.type === 'CodeTableEntry' && !/^NXT /.test(c.name))).map((c) => opt(c.name, c.name, v === c.name)).join('')}</select>`;
  };
  dlg(`Edit ${wc.plural(ids.length, 'action')}`, '', `<div class="ep-bulk">${BULK.map(([k, l]) => `<label class="ep-bulkrow"><input type="checkbox" data-bon="${k}" /><span>${l}</span><span class="ep-bulkin">${input(k)}</span></label>`).join('')}</div>
`,
    `<span class="wc-cost" data-bcost></span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go disabled>Change ${ids.length}</button>`,
    (box) => {
      const sync = () => { const n = Object.values(st.on).filter(Boolean).length; $('[data-go]', box).disabled = !n; $('[data-bcost]', box).textContent = n ? `About ${ids.length * 2 + Math.ceil(ids.length / 15) + 1} Blackbaud calls` : ''; };
      box.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.bon) st.on[t.dataset.bon] = t.checked;
        if (t.dataset.bv) { st.v[t.dataset.bv] = t.multiple ? Array.from(t.selectedOptions).map((o) => o.value) : t.value; st.on[t.dataset.bv] = true; const cb = $(`[data-bon="${t.dataset.bv}"]`, box); if (cb) cb.checked = true; }
        sync();
      });
      box.addEventListener('input', (e) => { if (e.target.dataset.bv === 'line') { st.v.line = e.target.value; st.on.line = !!e.target.value; $('[data-bon="line"]', box).checked = st.on.line; sync(); } });
      $('[data-go]', box).onclick = async () => {
        const set = {};
        for (const [k] of BULK) if (st.on[k] && k !== 'line' && k !== 'tag') set[k] = st.v[k];
        const params = { op: 'bulk_edit', ids, set, line: st.on.line ? st.v.line : '', tags: st.on.tag ? { add: [{ category: st.v.tag }] } : undefined };
        wc.closeLayer(); wc.clearSel();
        if (set.status === 'Completed' || set.status === 'Canceled') { ids.forEach((id) => { wc.S.gone[id] = 1; }); wc.render(); }
        await send(params, { label: `Changed ${wc.plural(ids.length, 'action')}`, revert: () => { ids.forEach((id) => delete wc.S.gone[id]); wc.render(); } });
      };
    });
}

/* New action: the partner (or several), what kind, done already or to do, and the smart defaults (the holder, the date from the kind) */
function dlgNew(pre = {}) {
  const wc = W();
  const st = { cids: pre.cid ? [{ cid: pre.cid, name: pre.name || 'Partner' }] : [], cat: 'Phone call', done: true, date: today(), dateSet: false, fr: [], frSet: false, type: '', typeSet: false, tags: [], next: false, nextDate: addDays(today(), 14), nextSum: '' };
  const defaults = () => {
    if (!st.dateSet) st.date = st.done ? today() : addDays(today(), DUE_OUT[st.cat] || 7);
    if (!st.frSet) { const h = st.holders && st.holders[0]; st.fr = h ? [h] : E.me.fid ? [E.me.fid] : []; }
    if (!st.typeSet) st.type = st.fr[0] ? typeFor(st.fr[0]) : E.me.type || 'RDD Action';
  };
  const learn = async (cid) => {
    try { const d = await wc.api('/api/work/partners/' + cid); st.holders = (d.partner.assignments || []).filter((x) => x.current).map((x) => x.fid).filter(wc.live); } catch (_) { st.holders = []; }
    defaults(); paint();
  };
  let box;
  const paint = () => {
    $('[data-picked]', box).innerHTML = st.cids.map((c) => `<span class="ep-person">${esc(c.name)}<button type="button" data-unpick="${esc(c.cid)}" aria-label="Remove">×</button></span>`).join('') || '<span class="wc-note">Pick the partner first.</span>';
    $$('[data-ncat]', box).forEach((x) => x.classList.toggle('is-on', x.dataset.ncat === st.cat));
    $$('[data-done]', box).forEach((x) => x.classList.toggle('is-on', String(st.done) === x.dataset.done));
    $('[data-ndate]', box).value = st.date;
    $('[data-ndatelab]', box).textContent = st.done ? 'Date it happened' : 'Due';
    $('[data-ntype]', box).value = st.type;
    $('[data-nfr]', box).innerHTML = peopleChips(st.fr, 'newfr');
    $$('[data-ntag]', box).forEach((x) => x.classList.toggle('is-on', st.tags.includes(x.dataset.ntag)));
    $('[data-nextbox]', box).hidden = !st.next;
    $('[data-go]', box).disabled = !st.cids.length;
    $('[data-go]', box).textContent = st.cids.length > 1 ? `Add to ${st.cids.length} partners` : 'Add action';
  };
  const C = E.codes || {};
  box = dlg('New action', '', `
    <div class="wc-field"><span class="lab">Partner</span><div class="ep-people" data-picked></div><div data-find></div></div>
    ${field('What kind', `<div class="wc-choices">${CATS.map(([v, l, i]) => `<button type="button" class="wc-choice" data-ncat="${esc(v)}">${wc.ic(i)}${l}</button>`).join('')}</div>`)}
    ${field('', `<div class="wc-choices"><button type="button" class="wc-choice" data-done="true">Done already</button><button type="button" class="wc-choice" data-done="false">To do</button></div>`)}
    <div class="wc-row2"><div class="wc-field"><span class="lab" data-ndatelab>Date</span><input type="date" data-ndate /></div>${field('Type', `<select data-ntype>${(C.types || []).map((t) => opt(t, t.replace(/^RESERVED \((.*)\)$/, '$1'))).join('')}</select>`)}</div>
    <div class="wc-field"><label class="lab" for="nw-sum">Summary</label><input type="text" id="nw-sum" maxlength="255" placeholder="For example: Called to thank for the September gift" /></div>
    <div class="wc-field"><label class="lab" for="nw-desc">Description <span class="wc-opt">(optional)</span></label><textarea id="nw-desc" rows="3"></textarea></div>
    ${field('Fundraiser', '<div data-nfr></div>')}
    ${field('Tags', `<div class="wc-choices">${['Thanked', 'Texted', 'Stewardship', 'Scheduling', 'Favor Presentation'].filter(tagCat).map((t) => `<button type="button" class="wc-choice" data-ntag="${esc(t)}">${esc(t)}</button>`).join('')}</div>`)}
    <label class="wc-toggle"><input type="checkbox" data-nnext />Add a follow-up</label>
    <div class="ep-split" data-nextbox hidden>${field('Follow-up due', `<div class="wc-choices">${dateChips('data-nd', st.nextDate, today())}<input type="date" data-ndin value="${st.nextDate}" min="${today()}" aria-label="Follow-up due" /></div>`)}
      <div class="wc-field"><label class="lab" for="nw-nsum">Follow-up summary</label><input type="text" id="nw-nsum" maxlength="255" placeholder="For example: Send the trip report" /></div>${recurHTML(null, 'new')}</div>`,
    `<button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go disabled>Add action</button>`,
    (b) => {
      box = b;
      partnerPicker($('[data-find]', box), { onPick: (h) => { if (!st.cids.some((c) => c.cid === h.cid)) st.cids.push({ cid: h.cid, name: h.name }); $('[data-find] input', box).value = ''; if (st.cids.length === 1) learn(h.cid); paint(); $('#nw-sum', box).focus(); } });
      defaults(); paint();
      if (pre.cid) learn(pre.cid); else setTimeout(() => { const i = $('[data-find] input', box); if (i) i.focus(); }, 60);
      box.addEventListener('click', async (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.unpick) { st.cids = st.cids.filter((c) => c.cid !== t.dataset.unpick); paint(); }
        if (t.dataset.ncat) { st.cat = t.dataset.ncat; if (st.cat === 'Task/Other' && !st.dateSet) st.done = false; defaults(); paint(); }
        if (t.dataset.done) { st.done = t.dataset.done === 'true'; defaults(); paint(); }
        if (t.dataset.ntag) { st.tags = st.tags.includes(t.dataset.ntag) ? st.tags.filter((x) => x !== t.dataset.ntag) : st.tags.concat([t.dataset.ntag]); paint(); }
        if (t.dataset.unperson) { st.fr = st.fr.filter((x) => x !== t.dataset.unperson); st.frSet = true; paint(); }
        if (t.dataset.nd) { st.nextDate = t.dataset.nd; $('[data-ndin]', box).value = st.nextDate; $$('[data-nd]', box).forEach((x) => x.classList.toggle('is-on', x === t)); }
        if (t.hasAttribute('data-go')) {
          const set = { category: st.cat, type: $('[data-ntype]', box).value, date: $('[data-ndate]', box).value || st.date, summary: $('#nw-sum', box).value, description: $('#nw-desc', box).value, fundraisers: st.fr, completed: st.done, status: st.done ? 'Completed' : 'Open' };
          if (['Phone call', 'Email', 'Mailing'].includes(st.cat)) set.direction = 'Outbound';
          const params = { op: 'new', cids: st.cids.map((c) => c.cid), set, tags: st.tags.length ? { add: st.tags.map((c) => ({ category: c })) } : undefined };
          if (st.next) params.next = { category: 'Task/Other', date: $('[data-ndin]', box).value || st.nextDate, summary: $('#nw-nsum', box).value || 'Follow up', fundraisers: st.fr, type: set.type };
          const r = readRecur(box); if (r && st.next) params.recur = r; else if (r && !st.done) params.recur = r;
          wc.closeLayer();
          await send(params, { label: st.cids.length > 1 ? `Added to ${st.cids.length} partners` : `Added for ${st.cids[0].name}` });
        }
      });
      box.addEventListener('change', (e) => {
        const t = e.target;
        if (t.matches('[data-ndate]')) { st.date = t.value; st.dateSet = true; }
        if (t.matches('[data-ntype]')) { st.type = t.value; st.typeSet = true; }
        if (t.matches('[data-addperson]') && t.value) { st.fr = st.fr.concat([t.value]); st.frSet = true; if (!st.typeSet) st.type = typeFor(t.value); paint(); }
        if (t.matches('[data-nnext]')) { st.next = t.checked; paint(); }
        if (t.matches('[data-ndin]')) st.nextDate = t.value;
        if (t.matches('[data-recuron]')) t.closest('.ep-recur').classList.toggle('is-on', t.checked);
      });
    });
}

/* ------------------------------------------------------------------ inline changes on the board: date, status, who */
function pop(anchor, html, onMount) {
  closePop();
  const r = anchor.getBoundingClientRect();
  const p = document.createElement('div');
  p.className = 'ep-pop';
  p.innerHTML = html;
  document.body.appendChild(p);
  const w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  p.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  E.pop = p;
  if (onMount) onMount(p);
  const f = $('input, button', p); if (f) f.focus();
}
function closePop() { if (E.pop) { E.pop.remove(); E.pop = null; } }
function inline(kind, id, anchor) {
  const wc = W();
  const a = wc.BYID[id]; if (!a) return;
  const c = wc.cur(a);
  if (kind === 'due') {
    pop(anchor, `<b class="lab">Due</b><div class="ep-pop__chips">${[['Today', today()], ['Tomorrow', addDays(today(), 1)], ['+1 week', addDays(today(), 7)], ['+2 weeks', addDays(today(), 14)], ['Next Monday', nextMonday()], ['+1 month', addDays(today(), 30)]].map(([l, v]) => `<button type="button" data-pd="${v}">${l}</button>`).join('')}</div><input type="date" data-pdin value="${esc(c.due)}" aria-label="Due date" />`, (p) => {
      const go = (v) => { closePop(); if (!v || v === c.due) return; wc.S.ov[id] = Object.assign({}, wc.S.ov[id], { due: v }); wc.render(); send({ op: 'edit', ids: [id], set: { date: v }, seen: { date: a.due } }, { label: `Moved to ${wc.fd(v)}`, revert: () => { delete wc.S.ov[id].due; wc.render(); }, say: (s, t, cf) => { if (cf) wc.toast('Someone changed that date in Blackbaud. Open the action to see it.'); } }); };
      p.addEventListener('click', (e) => { const b = e.target.closest('[data-pd]'); if (b) go(b.dataset.pd); });
      $('[data-pdin]', p).addEventListener('change', (e) => go(e.target.value));
    });
  } else if (kind === 'status') {
    pop(anchor, `<b class="lab">Status</b><div class="ep-pop__list"><button type="button" data-ps="complete">${wc.ic('check')}Completed today</button><button type="button" data-ps="next">${wc.ic('cal')}Completed, schedule the next</button><button type="button" data-ps="Canceled">${wc.ic('x')}Canceled</button><button type="button" data-ps="open">Keep it open</button></div>`, (p) => {
      p.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ps]'); if (!b) return; closePop();
        if (b.dataset.ps === 'open') return;
        if (b.dataset.ps === 'next') { dlgNext(id); return; }
        const st = b.dataset.ps === 'complete' ? 'Completed' : 'Canceled';
        wc.S.gone[id] = 1; wc.render();
        send({ op: 'edit', ids: [id], set: { status: st } }, { label: st === 'Completed' ? 'Marked complete' : 'Canceled', revert: () => { delete wc.S.gone[id]; wc.render(); } });
      });
    });
  } else if (kind === 'who') {
    const list = staffList();
    pop(anchor, `<b class="lab">Who it belongs to</b><input type="search" data-pwq placeholder="Find a person" aria-label="Find a person" /><div class="ep-pop__list ep-pop__people">${list.map((f) => `<button type="button" data-pw="${esc(f)}" class="${c.f.includes(f) ? 'is-on' : ''}">${esc(wc.P(f).n)}<span>${esc(wc.P(f).team || '')}</span></button>`).join('')}</div><small>Shift-click adds a person alongside.</small>`, (p) => {
      $('[data-pwq]', p).addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('[data-pw]', p).forEach((b) => { b.hidden = !b.textContent.toLowerCase().includes(q); }); });
      p.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pw]'); if (!b) return; closePop();
        const f = b.dataset.pw;
        const next = e.shiftKey ? (c.f.includes(f) ? c.f.filter((x) => x !== f) : c.f.concat([f])) : [f];
        const prev = c.f;
        wc.S.ov[id] = Object.assign({}, wc.S.ov[id], { f: next }); wc.render();
        send({ op: 'edit', ids: [id], set: { fundraisers: next }, seen: { fundraisers: a.f } }, { label: `Given to ${next.map((x) => wc.P(x).n).join(', ')}`, revert: () => { wc.S.ov[id] = Object.assign({}, wc.S.ov[id], { f: prev }); wc.render(); } });
      });
    });
  }
}

/* ------------------------------------------------------------------ tools above the board: new, views, columns, export, keys */
function afterOpen(idp) {
  const wc = W();
  const host = $('#wc-tools2');
  if (host) {
    host.innerHTML = `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-ep="new" title="New action (n)">${wc.ic('plus')}New action</button>
      <div class="ep-menu"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-menu="views">${wc.ic('filter')}Views${E.views.length ? ' (' + E.views.length + ')' : ''}</button></div>
      <div class="ep-menu"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-menu="cols">Columns</button></div>
      <div class="ep-menu"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-menu="export">${wc.ic('ext')}Export</button></div>
      <button type="button" class="h-btn h-btn--ghost h-btn--sm ep-keysbtn" data-ep="keys" title="Keyboard shortcuts (?)">Shortcuts</button>`;
  }
  applyCols(idp);
}
function applyCols(idp) {
  const sc = $(`#${idp || 'o'}-scroll`); if (!sc) return;
  const hide = COLS.filter(([k]) => !E.cols[k]);
  sc.className = sc.className.replace(/\s?wc-hc-\d/g, '') + hide.map(([, , n]) => ' wc-hc-' + n).join('');
  const cols = BASE_COLS.filter((_, i) => !hide.some(([, , n]) => n === i + 1)).join(' ');
  $$('.wc-grid', sc).forEach((g) => { g.style.setProperty('--cols', cols); });
}
function menu(kind, anchor) {
  const wc = W();
  if (kind === 'views') {
    pop(anchor, `<b class="lab">Saved views</b><div class="ep-pop__list">${E.views.length ? E.views.map((v) => `<div class="ep-viewrow"><button type="button" data-view="${esc(v.id)}">${esc(v.name)}${v.default ? ' <i>opens first</i>' : ''}</button><button type="button" class="ep-x" data-viewdel="${esc(v.id)}" aria-label="Delete ${esc(v.name)}">×</button></div>`).join('') : '<p class="wc-note">No saved views.</p>'}</div>
      <form data-viewsave class="ep-viewsave"><input type="text" name="name" maxlength="60" placeholder="Name this view" required /><label class="wc-toggle"><input type="checkbox" name="def" />Open with it</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">Save</button></form>`, (p) => {
      p.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.view) { applyView(E.views.find((v) => v.id === b.dataset.view)); closePop(); }
        if (b.dataset.viewdel) { try { E.views = (await wc.api('/api/work/views?id=' + encodeURIComponent(b.dataset.viewdel), { method: 'DELETE' })).views; } catch (er) { wc.toast(er.message); } closePop(); wc.render(); }
      });
      $('[data-viewsave]', p).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try { E.views = (await wc.post('/api/work/views', { name: f.name.value, default: f.def.checked, spec: currentSpec() })).views; wc.toast('Saved the view ' + f.name.value + '.'); } catch (er) { wc.toast(er.message); }
        closePop(); wc.render();
      });
    });
  } else if (kind === 'cols') {
    pop(anchor, `<b class="lab">Columns</b><div class="ep-pop__list">${COLS.map(([k, l]) => `<label class="wc-toggle"><input type="checkbox" data-col="${k}" ${E.cols[k] ? 'checked' : ''} />${l}</label>`).join('')}</div>`, (p) => {
      p.addEventListener('change', (e) => { const k = e.target.dataset.col; if (!k) return; E.cols[k] = e.target.checked ? 1 : 0; try { localStorage.setItem('wc.cols', JSON.stringify(E.cols)); } catch (_) {} applyCols('o'); });
    });
  } else if (kind === 'export') {
    const n = wc.S.list.length;
    pop(anchor, `<b class="lab">Export the ${wc.plural(n, 'action')} that match</b><div class="ep-pop__list"><button type="button" data-csv>${wc.ic('ext')}Download a CSV file</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="work-actions">Open in Google Sheets</button><button type="button" data-print>Print this list</button></div>`, (p) => {
      p.addEventListener('click', (e) => { if (e.target.closest('[data-csv]')) { csv(); closePop(); } if (e.target.closest('[data-print]')) { closePop(); window.print(); } });
    });
  }
}
function rowsForExport() {
  const wc = W();
  return wc.S.list.map((id) => wc.BYID[id]).filter(Boolean).map((a) => { const c = wc.cur(a); return { id: a.id, due: c.due, partner: a.p, lookup: a.lk || '', place: a.loc || '', type: a.type, category: a.cat, summary: a.sum || '', fundraisers: c.f.map((x) => wc.P(x).n).join(', '), added: a.add || '', priority: a.pri || '' }; });
}
const EXPORT_COLS = [['id', 'Action id', 'id'], ['due', 'Due', 'date'], ['partner', 'Partner', 'text'], ['lookup', 'Lookup id', 'id'], ['place', 'City', 'text'], ['type', 'Type', 'text'], ['category', 'Category', 'text'], ['summary', 'Summary', 'text'], ['fundraisers', 'Fundraisers', 'text'], ['added', 'Added', 'date'], ['priority', 'Priority', 'text']];
function csv() {
  const rows = rowsForExport();
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const text = [EXPORT_COLS.map((c) => c[1]).join(',')].concat(rows.map((r) => EXPORT_COLS.map((c) => q(r[c[0]])).join(','))).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = `work-center-${today()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  W().toast(`Downloaded ${W().plural(rows.length, 'action')}.`);
}
function currentSpec() { const S = W().S; return { view: S.view, f: Object.assign({}, S.f), sort: S.sort, dir: S.dir, cols: Object.assign({}, E.cols) }; }
function applyView(v) {
  if (!v) return;
  const S = W().S; const sp = v.spec || {};
  S.view = sp.view === 'stale' || sp.view === 'ty' || sp.view === 'opps' || sp.view === 'recent' ? sp.view : 'open';
  S.f = Object.assign({ fr: '', type: '', cat: '', due: '', q: '', cid: '', theirs: false, quick: '' }, sp.f || {});
  if (sp.sort) S.sort = sp.sort; if (sp.dir) S.dir = sp.dir;
  if (sp.cols) E.cols = Object.assign({ type: 1, what: 1, who: 1, added: 1 }, sp.cols);
  S.sel.clear(); S.shown = 100;
  W().render();
}

/* ------------------------------------------------------------------ Opportunities: moves management */
async function loadOpps(force) {
  const wc = W();
  if (E.oppLoading || (E.opps && !force)) return;
  E.oppLoading = true;
  try { const d = await wc.api('/api/work/opps'); E.opps = d.rows; E.oppNames = d.names || {}; } catch (e) { E.oppErr = e.message; } finally { E.oppLoading = false; }
  if (wc.S.view === 'opps') wc.render();
}
function oppMatches(o) {
  const f = E.oppF;
  if (!f.inactive && o.inactive) return false;
  if (f.fr && !o.fundraisers.includes(f.fr)) return false;
  if (f.status && (o.status || '(none)') !== f.status) return false;
  if (f.purpose && o.purpose !== f.purpose) return false;
  if (f.q) { const hay = (o.name + ' ' + (E.oppNames[o.cid] || '') + ' ' + o.summary).toLowerCase(); if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false; }
  return true;
}
function viewOpps() {
  const wc = W();
  const v = $('#view');
  if (!E.opps) { v.innerHTML = `<section class="h-card wc-sheet"><div class="h-skel" style="height:360px;border-radius:18px"></div></section>`; loadOpps(); return; }
  const base = E.opps.filter((o) => E.oppF.inactive || !o.inactive);
  const list = E.opps.filter(oppMatches);
  const C = E.codes || {};
  const by = {}; base.forEach((o) => { const k = o.status || '(none)'; by[k] = by[k] || { n: 0, ask: 0 }; by[k].n++; by[k].ask += o.ask || o.expected || 0; });
  const stages = (C.oppStatuses || []).filter((s) => by[s]).concat(by['(none)'] ? ['(none)'] : []);
  const frs = [...new Set(E.opps.flatMap((o) => o.fundraisers))].sort((a, b) => wc.P(a).n.localeCompare(wc.P(b).n));
  const purposes = [...new Set(E.opps.map((o) => o.purpose).filter(Boolean))].sort();
  v.innerHTML = `
    <div class="h-card wc-band ep-stages">${stages.slice(0, 8).map((s) => `<button type="button" class="wc-stat${E.oppF.status === s ? ' is-on' : ''}" data-ostage="${esc(s)}"><b>${by[s].n}</b><span>${esc(s === "(none)" ? "No status" : s)}</span>${by[s].ask ? `<small class="ep-stageamt">${money(by[s].ask)}</small>` : ""}</button>`).join('')}</div>
    <section class="h-card wc-sheet" aria-label="Opportunities">
      <div class="wc-filters">
        <label class="wc-find">${wc.ic('search')}<span class="sr-only">Find an opportunity</span><input type="search" data-oq placeholder="Find an opportunity or partner" value="${esc(E.oppF.q)}" /></label>
        <select class="wc-sel${E.oppF.fr ? ' is-set' : ''}" data-of="fr" aria-label="Fundraiser">${opt('', 'Every fundraiser', !E.oppF.fr)}${frs.map((f) => opt(f, wc.P(f).n, E.oppF.fr === f)).join('')}</select>
        <select class="wc-sel${E.oppF.status ? ' is-set' : ''}" data-of="status" aria-label="Status">${opt('', 'Every status', !E.oppF.status)}${stages.map((s) => opt(s, s === '(none)' ? 'No status' : s, E.oppF.status === s)).join('')}</select>
        <select class="wc-sel${E.oppF.purpose ? ' is-set' : ''}" data-of="purpose" aria-label="Purpose">${opt('', 'Every purpose', !E.oppF.purpose)}${purposes.map((s) => opt(s, s, E.oppF.purpose === s)).join('')}</select>
        <label class="wc-toggle"><input type="checkbox" data-oinactive ${E.oppF.inactive ? 'checked' : ''} />Show inactive</label>
        <button type="button" class="h-btn h-btn--primary h-btn--sm" data-ep="oppnew">${wc.ic('plus')}New opportunity</button>
      </div>
      <div class="wc-scroll ep-opps" role="table" aria-label="Opportunities">
        <div class="ep-orow ep-orow--head" role="row"><span>Opportunity</span><span>Partner</span><span>Status</span><span>Ask</span><span>Expected</span><span>Funded</span><span>Next date</span><span>Fundraisers</span></div>
        ${list.length ? list.slice(0, 400).map((o) => `<button type="button" class="ep-orow${o.inactive ? ' is-inactive' : ''}" role="row" data-opp="${esc(o.id)}"><span><b>${esc(o.name || 'No name')}</b><small>${esc(o.purpose)}</small></span><span>${esc(E.oppNames[o.cid] || 'Partner ' + o.cid)}</span><span><i class="ep-ostatus">${esc(o.status || 'No status')}</i></span><span>${o.ask ? money(o.ask) : ''}</span><span>${o.expected ? money(o.expected) : ''}</span><span>${o.funded ? money(o.funded) : ''}</span><span>${esc(wc.fd(o.deadline || o.expectedDate || o.askDate || ''))}</span><span>${o.fundraisers.map((f) => esc(wc.P(f).n)).join(', ')}</span></button>`).join('') : '<div class="wc-empty"><b>Nothing matches</b>Change a filter.</div>'}
      </div>
      <div class="wc-foot"><span>${list.length === base.length ? wc.plural(base.length, 'opportunity', 'opportunities') : `${list.length} of ${wc.plural(base.length, 'opportunity', 'opportunities')} match`}${list.length > 400 ? ' · showing the first 400' : ''}</span></div>
    </section>`;
}
function dlgOpp(o, pre = {}) {
  const wc = W();
  const C = E.codes || {};
  const isNew = !o;
  const v = o || { name: '', status: 'Planned', purpose: (C.oppPurposes || []).includes('Engagement') ? 'Engagement' : (C.oppPurposes || [''])[0], ask: '', askDate: '', expected: '', expectedDate: '', funded: '', fundedDate: '', deadline: '', fundraisers: E.me.fid ? [E.me.fid] : [], inactive: false, summary: '', cid: pre.cid || '' };
  const st = { cid: v.cid, name: pre.name || E.oppNames[v.cid] || '', fr: v.fundraisers.slice() };
  const box = dlg(isNew ? 'New opportunity' : v.name, isNew ? '' : esc(st.name), `
    ${isNew ? `<div class="wc-field"><span class="lab">Partner</span><div class="ep-people" data-picked>${st.cid ? `<span class="ep-person">${esc(st.name)}</span>` : ''}</div>${st.cid ? '' : '<div data-find></div>'}</div>` : ''}
    <div class="wc-field"><label class="lab" for="op-name">Name</label><input type="text" id="op-name" maxlength="255" value="${esc(v.name)}" placeholder="For example: 2026 year-end gift" autofocus /></div>
    <div class="wc-row2">${field('Status', `<select data-o="status">${opt('', 'No status', !v.status)}${(C.oppStatuses || []).map((s) => opt(s, s, v.status === s)).join('')}</select>`)}${field('Purpose', `<select data-o="purpose">${(C.oppPurposes || []).map((s) => opt(s, s, v.purpose === s)).join('')}${v.purpose && !(C.oppPurposes || []).includes(v.purpose) ? opt(v.purpose, v.purpose, true) : ''}</select>`)}</div>
    <div class="wc-row3">${field('Ask', `<input type="text" inputmode="decimal" data-o="ask_amount" value="${v.ask || ''}" placeholder="$" />`)}${field('Expected', `<input type="text" inputmode="decimal" data-o="expected_amount" value="${v.expected || ''}" placeholder="$" />`)}${field('Funded', `<input type="text" inputmode="decimal" data-o="funded_amount" value="${v.funded || ''}" placeholder="$" />`)}</div>
    <div class="wc-row3">${field('Asked on', `<input type="date" data-o="ask_date" value="${v.askDate}" />`)}${field('Expected by', `<input type="date" data-o="expected_date" value="${v.expectedDate}" />`)}${field('Funded on', `<input type="date" data-o="funded_date" value="${v.fundedDate}" />`)}</div>
    <div class="wc-row2">${field('Deadline', `<input type="date" data-o="deadline" value="${v.deadline}" />`)}${field('', `<label class="wc-toggle"><input type="checkbox" data-o="inactive" ${v.inactive ? 'checked' : ''} />Inactive</label>`)}</div>
    ${field('Fundraisers', `<div data-ofr>${peopleChips(st.fr, 'oppfr')}</div>`)}
    <div class="wc-field"><label class="lab" for="op-sum">Notes on it</label><textarea id="op-sum" rows="3">${esc(v.summary)}</textarea></div>
    ${isNew ? '' : `<div class="wc-field"><span class="lab">Linked actions</span><div data-linked><div class="h-skel" style="height:60px;border-radius:12px"></div></div></div>`}`,
    `<span class="wc-cost">${isNew ? '' : `<a href="/work/partner/${esc(v.cid)}">Partner page</a>`}</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go>${isNew ? 'Add opportunity' : 'Save'}</button>`,
    (b) => {
      if (isNew && !st.cid) partnerPicker($('[data-find]', b), { onPick: (h) => { st.cid = h.cid; st.name = h.name; $('[data-picked]', b).innerHTML = `<span class="ep-person">${esc(h.name)}</span>`; $('[data-find]', b).remove(); $('#op-name', b).focus(); } });
      if (!isNew) wc.api('/api/work/opps?linked=' + v.id).then((d) => { const host = $('[data-linked]', b); if (host) host.innerHTML = d.actions.length ? `<ul class="ep-linked">${d.actions.map((x) => `<li><button type="button" class="wc-linkbtn" data-openact="${esc(x.id)}">${esc(x.summary || x.type)}</button><span class="wc-sub">${wc.fd(x.date)} · ${esc(x.category)}${x.done ? ' · done' : ' · open'}</span></li>`).join('')}</ul>` : '<p class="wc-note">No linked actions.</p>'; }).catch(() => {});
      b.addEventListener('change', (e) => { if (e.target.matches('[data-addperson]') && e.target.value) { st.fr.push(e.target.value); $('[data-ofr]', b).innerHTML = peopleChips(st.fr, 'oppfr'); } });
      b.addEventListener('click', async (e) => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.unperson) { st.fr = st.fr.filter((x) => x !== t.dataset.unperson); $('[data-ofr]', b).innerHTML = peopleChips(st.fr, 'oppfr'); }
        if (t.dataset.openact) { wc.closeLayer(); setTimeout(() => panel(t.dataset.openact), 240); }
        if (!t.hasAttribute('data-go')) return;
        const set = { name: $('#op-name', b).value, summary: $('#op-sum', b).value, fundraisers: st.fr };
        $$('[data-o]', b).forEach((i) => { set[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.value; });
        if (!isNew) {
          // Send only what changed.
          const was = { name: v.name, summary: v.summary, status: v.status, purpose: v.purpose, ask_amount: String(v.ask || ''), expected_amount: String(v.expected || ''), funded_amount: String(v.funded || ''), ask_date: v.askDate, expected_date: v.expectedDate, funded_date: v.fundedDate, deadline: v.deadline, inactive: v.inactive, fundraisers: v.fundraisers };
          Object.keys(set).forEach((k) => { if (JSON.stringify(was[k] ?? '') === JSON.stringify(set[k] ?? '')) delete set[k]; });
          if (!Object.keys(set).length) { wc.closeLayer(); return; }
        } else if (!st.cid) { wc.toast('Pick the partner first.'); return; }
        wc.closeLayer();
        const params = isNew ? { op: 'opp_new', cid: st.cid, opp: set, ids: pre.link ? [pre.link] : [] } : { op: 'opp_edit', opp_id: v.id, opp: set };
        // Optimistic: the list shows it at once.
        if (!isNew && E.opps) { const row = E.opps.find((x) => x.id === v.id); if (row) { Object.assign(row, { name: set.name ?? row.name, status: set.status ?? row.status, inactive: set.inactive ?? row.inactive }); if (wc.S.view === 'opps') wc.render(); } }
        await send(params, { label: isNew ? `Added the opportunity ${set.name}` : 'Saved the opportunity', after: () => loadOpps(true) });
        if (pre.after) pre.after();
      });
    });
  void box;
}

/* ------------------------------------------------------------------ keyboard */
function keysDialog() {
  const k = (keys, what) => `<li><span>${keys.map((x) => `<kbd>${x}</kbd>`).join(' ')}</span>${what}</li>`;
  dlg('Keyboard shortcuts', '', `<ul class="ep-keys">${k(['j'], 'Next row')}${k(['k'], 'Previous row')}${k(['e'], 'Edit the row (or Enter)')}${k(['c'], 'Complete the row, or the selected ones')}${k(['n'], 'New action')}${k(['/'], 'Search the list')}${k(['x'], 'Select the row (or Space)')}${k(['Shift', 'click'], 'Select a range')}${k(['Ctrl', 'A'], 'Select everything that matches')}${k(['u'], 'Undo your last change')}${k(['Ctrl', 'Enter'], 'Save the edit panel')}${k(['Esc'], 'Close, or clear the selection')}${k(['?'], 'This list')}</ul>`, '<button class="h-btn h-btn--primary" data-closelayer autofocus>Got it</button>');
}
function focusedRow() { const r = document.activeElement && document.activeElement.closest && document.activeElement.closest('#view .wc-row[data-id]'); return r ? r.dataset.id : null; }
window.addEventListener('keydown', (e) => {
  const wc = W(); if (!wc || !document.getElementById('wc-root')) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  if (E.panel && $('.ep.is-on') && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (Object.keys(E.panel.dirty).length || E.panel.recurDirty) savePanel(); return; }
  if (e.key === 'Escape' && E.pop) { closePop(); e.stopPropagation(); return; }
  if (typing || e.ctrlKey && e.key.toLowerCase() !== 'z' || e.metaKey || e.altKey) return;
  const layerOpen = !!$('#layer .wc-dlg, #layer .wc-drawer');
  if (layerOpen) return;
  const k = e.key;
  if (k === '/' && (wc.S.view === 'open' || wc.S.view === 'stale') && $('#q')) { e.preventDefault(); e.stopPropagation(); $('#q').focus(); return; }
  if (k === '/' && wc.S.view === 'opps' && $('[data-oq]')) { e.preventDefault(); e.stopPropagation(); $('[data-oq]').focus(); return; }
  if (k === 'n') { e.preventDefault(); dlgNew(); return; }
  if (k === '?') { e.preventDefault(); keysDialog(); return; }
  if (k === 'u' || (e.ctrlKey && k.toLowerCase() === 'z')) {
    const b = wc.S.batches.find((x) => !x.undone && x.posted && Date.parse(x.undo_until) > Date.now());
    if (b) { e.preventDefault(); wc.undoBatch(b.id); } return;
  }
  if ((k === 'j' || k === 'k') && !focusedRow()) { const r = $('#view .wc-row[data-id]'); if (r) { e.preventDefault(); r.focus(); } return; }
  const id = focusedRow();
  if (k === 'e' && id && wc.BYID[id]) { e.preventDefault(); panel(id); return; }
  if (k === 'c') {
    const sel = wc.selIds();
    if (sel.length) { e.preventDefault(); wc.dlgComplete(sel); } else if (id && wc.BYID[id]) { e.preventDefault(); wc.dlgComplete([id]); }
  }
}, true);

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const wc = W(); if (!wc) return;
  if (E.pop && !e.target.closest('.ep-pop') && !e.target.closest('[data-inl], [data-menu]')) closePop();
  const t = e.target.closest('button, a'); if (!t) return;
  const d = t.dataset;
  if (d.inl) { e.preventDefault(); e.stopPropagation(); inline(d.inl, d.id, t); return; }
  if (d.menu) { e.preventDefault(); if (E.pop && E.popKind === d.menu) { closePop(); return; } menu(d.menu, t); E.popKind = d.menu; return; }
  if (d.opp) { const o = (E.opps || []).find((x) => x.id === d.opp); if (o) dlgOpp(o); return; }
  if (d.ostage !== undefined && t.hasAttribute('data-ostage')) { E.oppF.status = E.oppF.status === d.ostage ? '' : d.ostage; wc.render(); return; }
  if (d.ep === 'new') { dlgNew(); return; }
  if (d.ep === 'keys') { keysDialog(); return; }
  if (d.ep === 'oppnew') { dlgOpp(null); return; }
  const P = E.panel;
  if (!P || !t.closest('.ep')) return;
  if (d.eptab) { P.tab = d.eptab; drawPanel(); return; }
  if (d.fv) { const k = d.fv; const v = d.v; markDirty(k, v); $$(`[data-fv="${k}"]`, P.box).forEach((x) => x.classList.toggle('is-on', x === t)); if (k === 'category') { drawPanel(); return; } if (k === 'status') { P.act.completed = v === 'Completed'; if (v === 'Completed' && !P.act.completed_date) markDirty('completed_date', wc.TODAY); drawPanel(); } return; }
  if (d.unperson && t.closest('[data-people="fundraisers"]')) { markDirty('fundraisers', P.act.fundraisers.filter((x) => x !== d.unperson)); drawPanel(); return; }
  if (t.hasAttribute('data-newopp')) { dlgOpp(null, { cid: P.act.cid, name: P.partner.name, link: P.id, after: () => { wc.closeLayer(); setTimeout(() => panel(P.id), 260); } }); return; }
  if (d.ep === 'save') { savePanel(); return; }
  if (d.ep === 'complete') { savePanel({ status: 'Completed', completed: true }); return; }
  if (d.ep === 'next') { const id = P.id; wc.closeLayer(); E.panel = null; setTimeout(() => dlgNext(id), 240); return; }
  if (d.ep === 'dup' || d.ep === 'move') { const id = P.id; const m = d.ep; setTimeout(() => dlgCopy(id, m), 10); return; }
  if (d.ep === 'delete') { const id = P.id; setTimeout(() => dlgDelete([id]), 10); return; }
  if (d.notedel) { extraChange({ op: 'note', note: { id: d.notedel, remove: true } }, 'notes', 'Removed the note'); return; }
  if (d.noteedit) { const n = (P.notes || []).find((x) => x.id === d.noteedit); const f = $('[data-noteform]', P.box); if (n && f) { f.type.value = n.type; f.summary.value = n.summary; f.text.value = n.text; f.id.value = n.id; $('button[type=submit]', f).textContent = 'Save the note'; $('[data-notecancel]', f).hidden = false; f.summary.focus(); } return; }
  if (t.hasAttribute('data-notecancel')) { P.notes = P.notes; paneNotes($('#ep-pane', P.box)); return; }
  if (d.tagdel) { extraChange({ op: 'edit', set: {}, tags: { remove: [{ id: d.tagdel, category: d.cat }] } }, 'tags', 'Removed the ' + d.cat + ' tag'); return; }
  if (d.quicktag) { extraChange({ op: 'edit', set: {}, tags: { add: [{ category: d.quicktag }] } }, 'tags', 'Tagged ' + d.quicktag); return; }
  if (d.filedel) { extraChange({ op: 'attach', attach: { id: d.filedel, remove: true } }, 'files', 'Removed the attachment'); return; }
});
document.addEventListener('change', (e) => {
  const P = E.panel; if (!P || !e.target.closest('.ep')) return;
  const t = e.target;
  if (t.dataset.f && t.tagName !== 'TEXTAREA' && t.type !== 'text') { markDirty(t.dataset.f, t.value); return; }
  if (t.matches('[data-addperson="fundraisers"]') && t.value) { markDirty('fundraisers', P.act.fundraisers.concat([t.value])); drawPanel(); return; }
  if (t.matches('[data-recuron], [data-recurevery], [data-recurunit], [data-recurend]')) { P.recurDirty = true; const r = t.closest('.ep-recur'); if (r) r.classList.toggle('is-on', $('[data-recuron]', r).checked); drawFoot(); return; }
  if (t.matches('[data-tagcat]')) { const host = $('[data-tagval]', P.box); if (host) host.innerHTML = tagValueInput(t.value); }
});
document.addEventListener('input', (e) => {
  const wc = W();
  const t = e.target;
  if (t.matches && t.matches('[data-oq]')) { clearTimeout(E.oqT); E.oqT = setTimeout(() => { E.oppF.q = t.value; wc.render(); const i = $('[data-oq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160); return; }
  const P = E.panel; if (!P || !t.closest || !t.closest('.ep')) return;
  if (t.dataset.f && (t.tagName === 'TEXTAREA' || t.type === 'text')) markDirty(t.dataset.f, t.value);
});
document.addEventListener('change', (e) => {
  const wc = W(); const t = e.target; if (!wc || !t.closest || !t.closest('#view')) return;
  if (t.dataset.of) { E.oppF[t.dataset.of] = t.value; wc.render(); }
  if (t.matches('[data-oinactive]')) { E.oppF.inactive = t.checked; wc.render(); }
});
document.addEventListener('submit', async (e) => {
  const P = E.panel; const f = e.target; if (!P || !f.closest('.ep')) return;
  e.preventDefault();
  if (f.matches('[data-noteform]')) {
    const note = { type: f.type.value, summary: f.summary.value, text: f.text.value }; if (f.id.value) note.id = f.id.value;
    if (!note.summary && !note.text) return;
    await extraChange({ op: 'note', note }, 'notes', note.id ? 'Saved the note' : 'Added the note');
  } else if (f.matches('[data-tagform]')) {
    const v = f.value.value;
    await extraChange({ op: 'edit', set: {}, tags: { change: [{ id: f.dataset.tagform, value: f.value.type === 'number' ? Number(v) : v }] } }, 'tags', 'Changed the tag');
  } else if (f.matches('[data-tagadd]')) {
    await extraChange({ op: 'edit', set: {}, tags: { add: [{ category: f.category.value, value: f.value.value }] } }, 'tags', 'Added the tag');
  } else if (f.matches('[data-linkform]')) {
    await extraChange({ op: 'attach', attach: { url: f.url.value, name: f.name.value } }, 'files', 'Attached the link');
  } else if (f.matches('[data-fileform]')) {
    const file = f.file.files[0]; if (!file) return;
    const wc = W();
    drawFoot('saving', 'Uploading ' + file.name + '…');
    const fd = new FormData(); fd.append('file', file); fd.append('req', wc.reqId());
    try {
      const res = await fetch(`/api/work/actions/${P.id}/upload${wc.AS ? '?as=' + encodeURIComponent(wc.AS) : ''}`, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) throw new Error(out.message || 'The file did not upload.');
      if (out.batch && out.batch.id) { await wc.driveBatch(out.batch.id, [P.id], { keep: true }); await wc.loadRecent(); }
      drawFoot('saved', 'Attached ' + file.name);
      wc.toast('Attached ' + file.name + '.', out.batch && out.batch.id);
      P.files = null; paneFiles($('#ep-pane', P.box), true);
    } catch (er) { drawFoot('failed', er.message); }
  }
});
// The panel closes like any layer; forget it then.
new MutationObserver(() => { if (E.panel && !document.querySelector('#layer .ep')) E.panel = null; }).observe(document.getElementById('layer') || document.body, { childList: true });

/* ------------------------------------------------------------------ start: code tables, saved views, the opening view */
async function start() {
  const wc = W();
  try { const c = await wc.api('/api/work/codes'); E.codes = c.codes; E.me = c.me || E.me; E.types = c.types || {}; } catch (_) { E.codes = null; }
  try { E.views = (await wc.api('/api/work/views')).views || []; } catch (_) { E.views = []; }
  loadOpps();
  if (new URLSearchParams(location.search).get('view')) return;
  const def = E.views.find((v) => v.default);
  if (def) { const sp = def.spec || {}; Object.assign(wc.S, { view: sp.view || 'open', sort: sp.sort || wc.S.sort, dir: sp.dir || wc.S.dir }); wc.S.f = Object.assign({}, wc.S.f, sp.f || {}); if (sp.cols) E.cols = Object.assign({}, E.cols, sp.cols); }
  // With no saved view, a fundraiser opens on their own list plus others' actions on partners they hold (what Blackbaud's Work Center shows).
  else if (E.me.fid && wc.DATA.people[E.me.fid]) { wc.S.f.fr = E.me.fid; wc.S.f.theirs = true; }
  const act = new URLSearchParams(location.search).get('action');
  if (act && /^\d+$/.test(act)) setTimeout(() => panel(act), 300);
}

window.WCEdit = {
  panel, start, afterOpen, viewOpps, oppCount: () => (E.opps ? E.opps.filter((o) => !o.inactive).length : ''),
  act: { bulkedit: (ids) => dlgBulk(ids), delete: (ids) => dlgDelete(ids) },
  newAction: dlgNew, completeNext: dlgNext, opp: dlgOpp, _E: E,
};
})();
