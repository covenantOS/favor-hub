/* Grants (Work Center tab for the grants team and the Support Team): the RESERVED (Grant ...) actions on foundations from the D1 copy of
   Blackbaud, by kind. The Log button records a request, LOI, report, task or cultivation step on a foundation and attaches the PDF to the
   action in the same batch (POST /api/work/grants/log, a form post); this file then sends the batch with /api/work/batches/:id/run.
   A row's Attach file button uses the action upload route. Reads GET /api/work/grants (no Blackbaud calls).
   Registers itself with window.WCTabs. Needs thank.js (window.FavorWG) and work.js (window.WC). */
(() => {
'use strict';
const W = () => window.WC;
const F = () => window.FavorWG;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = { data: null, loading: false, error: '', started: false, kind: '', q: '', done: false, page: 1, sort: '', dir: 'desc', sheetOn: false };
const KIND_TABS = { request: 'Requests', loi: 'LOIs', report: 'Reports', conversation: 'Conversations', other: 'Tasks and cultivation' };

async function load() {
  G.loading = true; G.error = '';
  try { G.data = await W().api('/api/work/grants'); G.page = 1; } catch (e) { G.error = e.message; }
  G.loading = false;
}
async function start() {
  if (G.started) return;
  G.started = true;
  await load();
  W().refresh('grants');
}
const rows = () => (G.data ? G.data.rows : []);
const inKind = (r, k) => !k || (k === 'other' ? r.kind === 'task' || r.kind === 'cultivation' || !r.kind : r.kind === k);
const visible = () => rows().filter((r) => (G.done ? !r.open : r.open) && inKind(r, G.kind) && (!G.q || (r.foundation + ' ' + r.summary).toLowerCase().includes(G.q.toLowerCase())));
const count = () => (G.data ? G.data.stats.open : '');

// Columns the person can hide. Foundation and the row buttons always show.
const COLS = [{ k: 'who', l: 'Foundation', fixed: true }, { k: 'kind', l: 'Kind' }, { k: 'sum', l: 'Entry' }, { k: 'award', l: 'Award and file' }, { k: 'date', l: 'Date' }, { k: 'by', l: 'Fundraiser' }];
const pageSize = () => (window.PT ? window.PT.size('grants', 50) : 50);
const SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const th = (col, label) => (window.PT ? window.PT.th('grants', col, label, { col: G.sort, dir: G.dir }) : esc(label));
const SORTS = {
  name: (r) => String(r.foundation || '').toLowerCase(),
  kind: (r) => String(r.kindLabel || '').toLowerCase(),
  date: (r) => r.date || '',
  by: (r) => (r.who || []).join(', ').toLowerCase(),
};
function ordered(list) {
  const key = SORTS[G.sort];
  if (!key) return list;
  const sgn = G.dir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sgn; });
}

function rowHTML(r, hide) {
  const f = F();
  const local = r.local ? ' <span class="pt-badge pt-badge--gold">Just logged</span>' : '';
  const acts = r.local && String(r.id).startsWith('local-') ? '' : `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wgr-open="${esc(r.id)}" data-pt-open>${f.ic('expand')}Open</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wgr-attach="${esc(r.id)}">${f.ic('plus')}File</button>`;
  const award = r.award ? `<a class="wgr-award" href="/work/partner/${esc(r.cid)}?opp=${esc(r.award.id)}" title="Award: ${esc(r.award.name)}${r.award.amount ? ' · ' + esc(f.money(r.award.amount)) : ''}">Award: ${esc(r.award.name)}${r.award.amount ? ' · ' + f.money(r.award.amount) : ''}</a>` : r.kind === 'report' ? '<span class="pt-sub">No award on record</span>' : '';
  const file = r.file ? `<span class="pt-badge pt-badge--good" title="${esc(r.file)}">${esc(r.file)}</span> ` : '';
  const by = (r.who || []).join(', ');
  const full = [r.summary, r.description].filter(Boolean).join(' · ');
  return `<tr class="ptl-row" data-id="${esc(r.id)}" data-pt-row tabindex="-1">
    <td class="c-who"><div class="ptl-who"><a class="pt-name wg-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}" title="${esc(r.foundation)}">${esc(r.foundation)}</a><span class="pt-sub ptl-place" title="${esc(r.place)}">${esc(r.place)}</span></div></td>
    ${hide.has('kind') ? '' : `<td class="c-kind"><span class="pt-badge">${esc(r.kindLabel)}</span>${local}</td>`}
    ${hide.has('sum') ? '' : `<td class="c-sum is-clip" title="${esc(full)}"><span class="wgr-sum">${esc(r.summary)}</span></td>`}
    ${hide.has('award') ? '' : `<td class="c-award is-clip">${file}${award}</td>`}
    ${hide.has('date') ? '' : `<td class="c-date"><b>${r.date ? esc(f.fd(r.date)) : ''}</b> <span class="pt-sub">${r.open ? 'Due' : esc(r.category)}</span></td>`}
    ${hide.has('by') ? '' : `<td class="c-by" title="${esc(by)}"><span class="pt-sub">${esc(by)}</span></td>`}
    <td class="c-acts"><div class="pt-acts">${acts}</div></td></tr>`;
}

function view() {
  const f = F(); const el = $('#view');
  if (!el) return;
  if (!G.data && !G.error) { el.innerHTML = window.WCSkel(5); if (!G.loading) start(); return; }
  if (G.error && !G.data) { el.innerHTML = `<section class="h-card wc-sheet"><div class="wg-empty"><b>The list did not load</b>${esc(G.error)}<p><button type="button" class="h-btn h-btn--primary" data-wgr-reload>Try again</button></p></div></section>`; return; }
  const PT = window.PT;
  const s = G.data.stats; const list = ordered(visible());
  const hide = PT ? PT.hidden('grants') : new Set();
  const n = 1 + COLS.filter((c) => c.fixed || !hide.has(c.k)).length;
  if (PT) G.page = PT.clampPage(G.page, list.length, pageSize());
  const pageList = PT ? PT.slice(list, G.page, pageSize()) : list;
  const kinds = [['request', 'Requests'], ['loi', 'LOIs'], ['report', 'Reports'], ['conversation', 'Conversations'], ['other', 'Tasks and cultivation']];
  el.innerHTML = `
    <section class="h-card wc-sheet ptl-sheet" aria-label="Grants">
      <div class="pt-bar"><div class="pt-seg" role="group" aria-label="Which list"><button type="button" class="${!G.done ? 'is-on' : ''}" data-wgr-done="0">Open<span>${Number(s.open).toLocaleString('en-US')}</span></button><button type="button" class="${G.done ? 'is-on' : ''}" data-wgr-done="1">Done</button></div>
        <label class="pt-search">${SEARCH_SVG}<span class="sr-only">Find a foundation</span><input type="search" id="wgr-q" data-pt-search placeholder="Find a foundation" value="${esc(G.q)}" autocomplete="off" /></label>
        <select class="pt-sel${G.kind ? ' is-set' : ''}" data-wgr-kindsel aria-label="Kind"><option value="">All kinds</option>${kinds.map(([k, l]) => `<option value="${k}"${G.kind === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <span class="ptl-done" title="Entries logged this month">This month <b>${s.requestsMonth}</b> requests, <b>${s.loisMonth}</b> LOIs, <b>${s.reportsMonth}</b> reports</span>
        <span class="pt-spacer"></span>
        ${PT ? PT.colsHTML('grants', COLS) : ''}
        ${PT ? PT.densityHTML() : ''}
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="grants">${f.ic('sheet')}Open in Google Sheets</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wgr-talk>Conversation</button><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wgr-log>${f.ic('plus')}Log</button></div>
      <div class="ptl-wrap pt-wrap pt-wrap--fit" style="--pt-fit:360px">
        <table class="pt-table ptl-table ptl-grants">
          <thead><tr><th>${th('name', 'Foundation')}</th>${hide.has('kind') ? '' : `<th>${th('kind', 'Kind')}</th>`}${hide.has('sum') ? '' : '<th>Entry</th>'}${hide.has('award') ? '' : '<th>Award and file</th>'}${hide.has('date') ? '' : `<th>${th('date', 'Date')}</th>`}${hide.has('by') ? '' : `<th>${th('by', 'Fundraiser')}</th>`}<th><span class="sr-only">Actions</span></th></tr></thead>
          <tbody data-pt-list="grants">${pageList.map((r) => rowHTML(r, hide)).join('') || `<tr><td colspan="${n}"><div class="pt-empty"><b>${G.done ? 'Nothing logged yet' : 'No open grant tasks'}</b>${G.done ? 'Requests, LOIs and reports you log show here.' : 'A to-do you log with a due date shows here until it is done.'}</div></td></tr>`}</tbody>
        </table>
      </div>
      ${PT ? PT.pager('grants', { total: list.length, page: G.page, noun: 'entries' }) : ''}
      <div class="wg-foot"><span>${list.length.toLocaleString('en-US')} ${list.length === 1 ? 'entry' : 'entries'} from the last 24 months. Log adds one action on the foundation and attaches the file you pick.</span></div>
    </section>`;
  registerSheet();
}

function registerSheet() {
  if (!window.FavorSheets || G.sheetOn) return;
  G.sheetOn = true;
  const cols = [{ key: 'foundation', label: 'Foundation', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'summary', label: 'Summary', type: 'text' },
    { key: 'date', label: 'Date', type: 'date' }, { key: 'how', label: 'How', type: 'text' }, { key: 'state', label: 'State', type: 'text' }, { key: 'who', label: 'Fundraiser', type: 'text' }];
  window.FavorSheets.register('grants', () => window.FavorSheets.screen('Grants', [{ name: 'Grants', columns: cols, rows: visible().map((r) => ({ foundation: r.foundation, place: r.place, kind: r.kindLabel, summary: r.summary, date: r.date || null, how: r.category, state: r.open ? 'Open' : 'Done', who: r.who.join(', ') })) }], { filters: G.done ? 'Done' : 'Open', classes: ['partner'] }));
}

/* ------------------------------------------------------------------ the log form */
function logDialog(opts) {
  const f = F(); const w = W(); const e = esc; const d = G.data;
  const today = d.today;
  const st = { cid: '', name: '', kind: opts && opts.kind ? opts.kind : 'request', how: opts && opts.kind === 'conversation' ? 'call' : 'portal', state: 'sent', file: null };
  const draw = (box) => {
    $('[data-picked]', box).innerHTML = st.cid ? `<span class="ep-person">${e(st.name)}<button type="button" data-unpick aria-label="Remove">×</button></span>` : '<span class="wc-note">Pick the foundation first.</span>';
    box.querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('is-on', x.dataset.kind === st.kind));
    box.querySelectorAll('[data-how]').forEach((x) => x.classList.toggle('is-on', x.dataset.how === st.how));
    box.querySelectorAll('[data-state]').forEach((x) => x.classList.toggle('is-on', x.dataset.state === st.state));
    $('[data-datelab]', box).textContent = st.state === 'sent' ? 'Date sent' : 'Due';
    const date = $('[data-date]', box);
    if (st.state === 'sent') date.max = today; else date.removeAttribute('max');
    const talk = st.kind === 'conversation';
    box.querySelectorAll('[data-full]').forEach((x) => { x.hidden = talk; });
    box.querySelectorAll('[data-talk]').forEach((x) => { x.hidden = !talk; });
    box.querySelectorAll('[data-how]').forEach((x) => { x.hidden = talk ? x.dataset.how === 'portal' : x.dataset.how === 'call' || x.dataset.how === 'meeting'; });
    if (talk && st.how === 'portal') st.how = 'call';
    if (!talk && (st.how === 'call' || st.how === 'meeting')) st.how = 'portal';
    box.querySelectorAll('[data-how]').forEach((x) => x.classList.toggle('is-on', x.dataset.how === st.how));
    $('[data-go]', box).disabled = !st.cid || (talk ? !$('#wgr-who', box).value.trim() || !$('#wgr-said', box).value.trim() : !$('#wgr-sum', box).value.trim());
  };
  w.dialog(`<div class="wc-dlg__head"><div><h2>Log a grant entry</h2><p>One action on the foundation, with the file attached.</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${f.ic('x')}</button></div>
    <div class="wc-dlg__body">
      <div class="wc-field"><span class="lab">Foundation</span><div class="ep-people" data-picked></div><div data-find></div></div>
      <div class="wc-field"><span class="lab">What</span><div class="wc-choices">${d.kinds.map((k) => `<button type="button" class="wc-choice" data-kind="${k.id}">${e(k.label)}</button>`).join('')}</div></div>
      <div class="wc-field" data-talk hidden><label class="lab" for="wgr-who">Who</label><input type="text" id="wgr-who" maxlength="120" autocomplete="off" placeholder="Program officer" /></div>
      <div class="wc-field" data-talk hidden><label class="lab" for="wgr-said">What was said</label><textarea id="wgr-said" rows="3"></textarea></div>
      <div class="wc-field" data-full><span class="lab">Done or to do</span><div class="wc-choices"><button type="button" class="wc-choice" data-state="sent">Sent</button><button type="button" class="wc-choice" data-state="todo">To do</button></div></div>
      <div class="wc-row2"><div class="wc-field" data-full><span class="lab" data-datelab>Date sent</span><input type="date" data-date value="${e(today)}" /></div>
        <div class="wc-field"><span class="lab">How</span><div class="wc-choices">${d.hows.map((h) => `<button type="button" class="wc-choice" data-how="${h.id}">${e(h.label)}</button>`).join('')}</div></div></div>
      <div class="wc-field" data-full><label class="lab" for="wgr-sum">Summary</label><input type="text" id="wgr-sum" maxlength="255" autocomplete="off" /></div>
      <div class="wc-field" data-full><label class="lab" for="wgr-notes">Notes <span class="wc-opt">(optional)</span></label><textarea id="wgr-notes" rows="3" placeholder="Amount requested, program, deadline"></textarea></div>
      <div class="wc-field" data-full><label class="lab" for="wgr-file">File <span class="wc-opt">(optional, up to 10 MB)</span></label><input type="file" id="wgr-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" /></div>
    </div>
    <div class="wc-dlg__foot"><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go disabled>${f.ic('check')}Log it</button></div>`,
  (box) => {
    if (window.FavorPartner) window.FavorPartner.search($('[data-find]', box), { placeholder: 'Find the foundation: name, email, phone or lookup id', onPick: (h) => { st.cid = h.cid; st.name = h.name; $('[data-find] input', box).value = ''; draw(box); $(st.kind === 'conversation' ? '#wgr-who' : '#wgr-sum', box).focus(); } });
    draw(box);
    box.addEventListener('input', () => draw(box));
    box.addEventListener('click', async (ev) => {
      const t = ev.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-unpick')) { st.cid = ''; st.name = ''; draw(box); }
      if (t.dataset.kind) { st.kind = t.dataset.kind; draw(box); }
      if (t.dataset.how) { st.how = t.dataset.how; draw(box); }
      if (t.dataset.state) { st.state = t.dataset.state; draw(box); }
      if (t.hasAttribute('data-go')) {
        const fd = new FormData();
        fd.append('cid', st.cid); fd.append('kind', st.kind); fd.append('how', st.how); fd.append('state', st.state);
        fd.append('date', st.kind === 'conversation' ? today : $('[data-date]', box).value || today); fd.append('summary', $('#wgr-sum', box).value.trim()); fd.append('notes', $('#wgr-notes', box).value); fd.append('req', f.reqId());
        if (st.kind === 'conversation') { fd.append('who', $('#wgr-who', box).value.trim()); fd.append('said', $('#wgr-said', box).value.trim()); }
        const file = $('#wgr-file', box).files[0]; if (file) fd.append('file', file);
        w.closeLayer();
        await submit(fd, st.name, file ? file.name : '');
      }
    });
  });
}

async function postForm(url, fd) {
  const w = W();
  const res = await fetch(url + (w.AS ? '?as=' + encodeURIComponent(w.AS) : ''), { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) { const er = new Error(out.message || 'Something went wrong. Try again.'); er.status = res.status; throw er; }
  return out;
}
async function drive(bid) {
  let held = '';
  for (let i = 0; i < 60; i++) {
    const r = await F().post(`/api/work/batches/${bid}/run`);
    if (r.held === 'busy') { await sleep(1500); continue; }
    if (r.held) { held = r.held; break; }
    if (!r.left) break;
    await sleep(1200);
  }
  return held;
}
async function afterBatch(out, what) {
  const f = F();
  if (!out.batch) { f.toast('That entry was already saved.', null, true); return; }
  const bid = out.batch.id;
  let held = '';
  try { held = out.batch.run_when === 'tonight' ? 'tonight' : await drive(bid); } catch (e) { f.toast(e.message + ' It is saved, and Recent can send it again.', [bid], true); await load(); W().render(); return; }
  let bad = null;
  try {
    const recent = (await f.api('/api/work/recent')).batches || [];
    for (const b of recent) if (b.id === bid) { const x = (b.items || []).find((i) => i.state === 'failed'); if (x) bad = x.error || 'Blackbaud turned it down.'; }
  } catch (_) { /* saved; the toast still offers Undo */ }
  await load(); W().render();
  if (bad) { f.toast(`${bad} Nothing was lost. Recent has Try again.`, [bid], true); return; }
  f.toast(held === 'tonight' ? `${what}. It goes to Blackbaud tonight.` : held ? `${what}. Blackbaud is slow, so the rest goes when it answers.` : what + '.', [bid]);
}
async function submit(fd, name, fileName) {
  const f = F();
  f.toast(fileName ? 'Uploading ' + fileName + '…' : 'Saving…');
  let out;
  try { out = await postForm('/api/work/grants/log', fd); } catch (e) { f.toast(e.message, null, true); return; }
  await afterBatch(out, `Logged for ${name}`);
}
function attachPick(id) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
  inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    const f = F();
    f.toast('Uploading ' + file.name + '…');
    const fd = new FormData(); fd.append('file', file); fd.append('req', f.reqId());
    let out;
    try { out = await postForm(`/api/work/actions/${encodeURIComponent(id)}/upload`, fd); } catch (e) { f.toast(e.message, null, true); return; }
    await afterBatch(out, 'Attached ' + file.name);
  });
  inp.click();
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#wc-root')) return;
  const b = t.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.wgrKind !== undefined) { G.kind = G.kind === d.wgrKind ? '' : d.wgrKind; G.page = 1; view(); return; }
  if (d.wgrDone !== undefined) { G.done = d.wgrDone === '1'; G.page = 1; view(); return; }
  if (b.hasAttribute('data-wgr-reload')) { G.data = null; G.error = ''; G.loading = false; G.started = false; view(); return; }
  if (b.hasAttribute('data-wgr-log')) { logDialog(); return; }
  if (b.hasAttribute('data-wgr-talk')) { logDialog({ kind: 'conversation' }); return; }
  if (d.wgrOpen) { if (window.WCEdit && window.WCEdit.panel) window.WCEdit.panel(d.wgrOpen); return; }
  if (d.wgrAttach) { attachPick(d.wgrAttach); }
}, false);
let qT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'wgr-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { G.q = t.value; G.page = 1; view(); const i = $('#wgr-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 160);
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.matches || !t.matches('[data-wgr-kindsel]') || !t.closest('#wc-root')) return;
  G.kind = t.value; G.page = 1; view();
});
// Pager, sortable headers and the Columns menu (public/js/ptable.js).
if (window.PT) {
  window.PT.on('grants', {
    page(p) { G.page = p; view(); },
    sort(col, dir) { if (col === 'name' || col === 'kind' || col === 'by') dir = G.sort === col ? dir : 'asc'; G.sort = col; G.dir = dir; G.page = 1; view(); },
    cols() { view(); },
  });
}
document.addEventListener('favor:thanked-undone', async () => { if (!G.started) return; await load(); W().render(); });

if (window.WCTabs) {
  window.WCTabs.registerTab({ id: 'grants', label: 'Grants', roles: ['grants', 'support'], after: 'open', count: () => count(), mount: () => view(), warm: () => start() });
}
window.WCGrants = { start, view, count, G };
})();
