/* My partners: every partner a director holds, quiet ones first, sorted by what they give. A tab on the Work Center (added through
   window.WCX, see work.js). Reads /api/work/portfolio (the D1 copy of Blackbaud); Plan calls and + Task write through the same
   batches as every other Work Center change (saved, sent to Blackbaud, checked, undone from the toast for 24 hours). */
(() => {
'use strict';
const WC = () => window.WC;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => WC().TODAY;
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(today().slice(0, 4)) ? ', ' + y : ''); };
const money = (a) => '$' + Math.round(Number(a) || 0).toLocaleString('en-US');
const short = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 && v < 1e5 ? 1 : 0) + 'K' : money(v));
const WDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (ymd) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const dayLabel = (ymd) => WDAY[dow(ymd)] + ' ' + fd(ymd);
const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many || one + 's');
const I = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  brief: '<path d="M8 4h8v3H8z"/><path d="M6 6h12v15H6z"/><path d="M9 11h6"/><path d="M9 15h4"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
};
const ic = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const SHEET = '<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><path d="M6 2.5h8.5L19 7v13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1z" fill="#0f9d58" stroke="none"/><path d="M14.5 2.5V7H19" fill="#87ceac" stroke="none"/><rect x="8" y="10.5" width="8" height="7" rx=".5" fill="#fff" stroke="none"/><path d="M8 13h8M8 15.3h8M11 10.5v7" stroke="#0f9d58" stroke-width=".9" fill="none"/></svg>';

const M = { owner: '', directors: [], data: null, f: 'q90', sort: 'l12', dir: -1, sel: new Set(), q: '', shown: 100, loading: false, error: '', at: 0 };
const FILTERS = [['q90', '90 days'], ['q180', '180 days'], ['gave', 'Gave, not contacted'], ['lapsed', 'Lapsed'], ['all', 'All']];

/* ------------------------------------------------------------------ the rules (the server's, repeated so a filter needs no round trip) */
const quietAt = (r, n) => r.quiet === null || r.quiet >= n;
const TEST = {
  all: () => true,
  q90: (r) => quietAt(r, 90),
  q180: (r) => quietAt(r, 180),
  gave: (r) => r.ytd > 0 && quietAt(r, 30),
  lapsed: (r) => r.lastYear > 0 && r.ytd <= 0,
  nophone: (r) => !r.phone,
};
const rows = () => (M.data ? M.data.rows : []);
function visible() {
  const q = M.q.trim().toLowerCase();
  const list = rows().filter((r) => TEST[M.f](r) && (!q || (r.name + ' ' + r.place + ' ' + r.lookup).toLowerCase().includes(q)));
  const key = { quiet: (r) => (r.quiet === null ? 1e9 : r.quiet), l12: (r) => r.l12, life: (r) => r.life, name: (r) => r.name.toLowerCase() }[M.sort];
  return list.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * M.dir || b.life - a.life; });
}

/* ------------------------------------------------------------------ loading */
async function load(owner, fresh) {
  M.loading = true; M.error = '';
  try {
    const d = await WC().api('/api/work/portfolio' + (owner || fresh ? '?' + [owner ? 'owner=' + encodeURIComponent(owner) : '', fresh ? 'fresh=1' : ''].filter(Boolean).join('&') : ''));
    M.directors = d.directors || []; M.owner = d.owner || ''; M.data = d.portfolio; M.at = Date.now();
    M.sel = new Set([...M.sel].filter((c) => rows().some((r) => r.cid === c)));
    try { sessionStorage.setItem('wm.owner', M.owner); } catch (_) { /* a private window */ }
  } catch (e) { M.error = e.message; }
  M.loading = false;
}
const nameOf = (fid) => { const d = M.directors.find((x) => x.fid === fid); return d ? d.name : 'this director'; };
const isMine = () => { const me = WC().DATA.me; return !!me.fid && me.fid === M.owner; };

/* ------------------------------------------------------------------ the tab */
function rowHTML(r) {
  const on = M.sel.has(r.cid);
  const q = r.quiet;
  const cls = q === null || q >= 180 ? 'is-180' : q >= 90 ? 'is-90' : '';
  const g = r.gift;
  const delta = r.p12 ? (r.l12 >= r.p12 ? 'Up from ' : 'Down from ') + short(r.p12) : r.l12 ? 'New this year' : 'No gifts';
  const tel = r.phone ? 'tel:' + r.phone.replace(/[^\d+]/g, '') : '';
  const call = tel ? `<a class="wm-icon" href="${esc(tel)}" title="Call ${esc(r.phone)}" aria-label="Call ${esc(r.name)}">${ic('phone')}</a>` : `<span class="wm-icon is-off" title="${r.dnc ? 'Do not call' : 'No phone to call'}" aria-label="${r.dnc ? 'Do not call' : 'No phone to call'}">${ic('phone')}</span>`;
  const next = r.next ? (r.next.planned ? `<span class="wc-tag wc-tag--done" title="${esc(r.next.summary)}">${esc(r.next.summary ? r.next.summary.slice(0, 26) : 'Task')} ${fd(r.next.due)}</span>` : `<span class="wc-tag" title="${esc(r.next.summary)} · due ${fd(r.next.due, true)}">${esc((r.next.summary || 'Open task').slice(0, 34))}</span>`) : `<button type="button" class="wm-addtask" data-wm-task1="${esc(r.cid)}">+ Task</button>`;
  const prep = window.WCPrep && window.WCPrep.open;
  return `<div class="wm-row wm-port${on ? ' is-picked' : ''}" data-cid="${esc(r.cid)}">
    <label class="wm-cb"><input type="checkbox" data-wm-pick="${esc(r.cid)}" ${on ? 'checked' : ''} aria-label="Select ${esc(r.name)}" /></label>
    <div class="wm-c-who"><a class="wm-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a><span class="wm-sub">${esc(r.place || 'No city on file')}${r.lookup ? ' · ' + esc(r.lookup) : ''}</span></div>
    <div class="wm-quiet wm-c-quiet ${cls}"><b>${q === null ? 'Never' : q + (q === 1 ? ' day' : ' days')}</b><small>${r.last ? fd(r.last.date, true) + ' · ' + esc(r.last.how) : 'No contact on file'}</small></div>
    <div class="wm-num wm-c-last">${g ? money(g.amount) : 'None'}<small>${g ? fd(g.date, true) + (g.soft ? ' · soft credit' : '') : ''}</small></div>
    <div class="wm-num wm-c-12">${money(r.l12)}<small>${esc(delta)}</small></div>
    <div class="wm-num wm-c-life">${short(r.life)}<small>${plural(r.gifts, 'gift')}</small></div>
    <div class="wm-next wm-c-next">${next}</div>
    <div class="wm-acts">${call}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-prep="${esc(r.cid)}">${ic('brief')}${prep ? 'Prep' : 'Open'}</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-log="${esc(r.cid)}">Log</button></div>
  </div>`;
}

function paint() {
  const host = $('#view'); if (!host) return;
  if (M.loading && !M.data) { host.innerHTML = '<section class="h-card wc-sheet" aria-busy="true"><div class="h-skel" style="height:360px;border-radius:18px"></div></section>'; return; }
  if (M.error && !M.data) { host.innerHTML = `<div class="h-card wc-gate"><h2>My partners did not load</h2><p>${esc(M.error)}</p><p><button class="h-btn h-btn--primary" data-wm-reload>Try again</button></p></div>`; return; }
  if (!M.data) { host.innerHTML = '<div class="h-card wc-gate"><h2>No portfolio to show</h2><p>No director is set up for you here yet. Ask the technology team through Feedback.</p></div>'; return; }
  const st = M.data.stats;
  const list = visible();
  const shown = list.slice(0, M.shown);
  const stats = [['all', 'Partners held', st.held], ['q90', 'Quiet 90 days or more', st.quiet90, 1], ['gave', 'Gave this year, no contact in 30 days', st.gaveNoContact], ['lapsed', 'Gave last year, not this year', st.lapsed], ['nophone', 'No phone to call', st.noPhone]];
  const allOn = shown.length && shown.every((r) => M.sel.has(r.cid));
  const sb = (k, l) => `<button type="button" class="${M.sort === k ? 'is-on' : ''}" data-wm-sort="${k}">${l}${M.sort === k ? (M.dir < 0 ? ' ↓' : ' ↑') : ''}</button>`;
  const who = isMine() ? 'you' : nameOf(M.owner);
  host.innerHTML = `
    <div class="h-card wc-band wm-band">${stats.map(([k, l, n, warn]) => `<button type="button" class="wc-stat${M.f === k ? ' is-on' : ''}${warn ? ' is-warn' : ''}" data-wm-f="${k}"><b>${n.toLocaleString('en-US')}</b><span>${l}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet wm-sheet" aria-label="My partners">
      <div class="wm-tools">
        ${M.directors.length > 1 ? `<select class="wc-sel" data-wm-owner aria-label="Whose partners">${M.directors.map((d) => `<option value="${esc(d.fid)}"${d.fid === M.owner ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>` : ''}
        <label class="wc-find wm-find">${ic('search')}<span class="sr-only">Find a partner</span><input id="wm-q" type="search" placeholder="Find a partner" value="${esc(M.q)}" autocomplete="off" /></label>
        <div class="wm-seg" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" class="${M.f === k ? 'is-on' : ''}" data-wm-f="${k}" aria-pressed="${M.f === k}">${l}</button>`).join('')}${M.f === 'nophone' ? '<button type="button" class="is-on" data-wm-f="nophone" aria-pressed="true">No phone</button>' : ''}</div>
        <span class="wm-spacer"></span>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-sheets="work-partners">${SHEET}Google Sheets</button>
      </div>
      <div class="wm-list">
        <div class="wm-row wm-port wm-head" role="row"><label class="wm-cb"><input type="checkbox" data-wm-pickall ${allOn ? 'checked' : ''} aria-label="Select every partner shown" /></label><span>Partner</span>${sb('quiet', 'Last contact')}<span>Last gift</span>${sb('l12', '12 months')}<span class="wm-c-life">${sb('life', 'Lifetime')}</span><span>Next step</span><span></span></div>
        ${shown.map(rowHTML).join('') || `<div class="wm-empty"><b>${M.f === 'all' && !M.q ? 'No partners held' : 'Nobody here'}</b>${M.f === 'q90' ? 'Every partner in this list has had a contact in the last 90 days.' : 'Change the filter or the search.'}</div>`}
        ${list.length > shown.length ? `<div class="wm-more"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-more>Show ${Math.min(100, list.length - shown.length)} more of ${list.length - shown.length}</button></div>` : ''}
      </div>
      <div class="wm-bulk${M.sel.size ? ' is-on' : ''}" role="region" aria-label="Selected partners"><b>${M.sel.size} selected</b><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-plan>${ic('clock')}Plan calls</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wm-clear>Clear</button></div>
      <div class="wm-foot"><span>${list.length.toLocaleString('en-US')} of ${st.held.toLocaleString('en-US')} partners held by ${esc(who)} as RDD, Prospect Steward or Church Engagement Director. A contact is a completed call, visit or email. A mailed letter is not one.</span><span class="copy-stamp" data-copy-stamp data-iso="${esc(WC().DATA.synced || '')}"></span></div>
    </section>`;
}

async function view() {
  const mine = () => WC().S.view === 'mine';
  if (!M.data) {
    let owner = ''; try { owner = sessionStorage.getItem('wm.owner') || ''; } catch (_) { /* none */ }
    const me = WC().DATA.me;
    M.loading = true; paint();
    await load(me.role === 'director' && me.fid ? me.fid : owner);
    if (!mine()) return;
  }
  paint();
  // Quiet partners first on the first visit, unless nobody is quiet.
  if (M.data && !M.touched) { M.touched = true; if (!M.data.stats.quiet90 && M.f === 'q90') { M.f = 'all'; paint(); } }
}

/* ------------------------------------------------------------------ writing: + Task and Plan calls */
const typeFor = (fid) => { const E = window.WCEdit && window.WCEdit._E; return (E && E.types && E.types[fid]) || (E && E.me && E.me.type) || 'RDD Action'; };
async function sendBatch(params, label) {
  const wc = WC();
  const req = wc.reqId();
  let saved;
  try { saved = await wc.post('/api/work/batches', Object.assign({}, params, { req })); } catch (e) { wc.toast(e.message || 'Blackbaud did not answer. Nothing was changed.'); return null; }
  const b = saved.batch || {};
  if (!b.id) { wc.toast('Nothing needed changing.'); return { none: true }; }
  if (b.run_when === 'tonight') { wc.toast(label + '. It goes to Blackbaud tonight.', b.id); wc.loadRecent(); return { batch: b.id, queued: true }; }
  const ids = (saved.items || []).map((i) => String(i.id)).filter(Boolean);
  const r = await wc.driveBatch(b.id, ids.length ? ids : ['x'], { keep: true });
  await wc.loadRecent();
  const rec = wc.S.batches.find((x) => x.id === b.id);
  const failed = rec ? rec.items.filter((i) => i.state === 'failed') : [];
  if (failed.length) { wc.toast(label + ': ' + (failed[0].error || 'Blackbaud turned it down.'), b.id); return { batch: b.id, failed: failed.length }; }
  wc.toast(r.held ? label + '. Waiting to send.' : label, b.id);
  return { batch: b.id, ok: true };
}
const callSet = (date, fid, name) => ({ category: 'Phone call', type: typeFor(fid), date, summary: 'Call to check in', description: name ? 'Quiet partner. Call ' + name + ' to check in.' : '', fundraisers: [fid], completed: false, direction: 'Outbound' });

async function addOneTask(cid) {
  const r = rows().find((x) => x.cid === cid); if (!r || !M.owner) return;
  // The next weekday that is not today.
  let d = addDays(today(), 1); while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  const prev = r.next;
  r.next = { id: 'pending', due: d, summary: 'Call to check in', planned: true }; paint();
  const out = await sendBatch({ op: 'new', cids: [cid], set: callSet(d, M.owner, r.name) }, 'Call task added for ' + fd(d));
  if (!out || out.failed) { r.next = prev; paint(); return; }
  if (isMine()) WC().post('/api/work/reminders', { kind: 'plan_call', ref_id: out.batch || null, cid, title: 'Call ' + r.name, note: reasonOf(r), when: { date: d, time: '09:00' }, source: 'plan_calls' }).then(() => window.WCBell && window.WCBell.refresh()).catch(() => {});
}
const reasonOf = (r) => money(r.l12) + ' in 12 months, ' + (r.quiet === null ? 'no contact on record' : 'quiet ' + r.quiet + ' days');

function weekdays(span) { const out = []; for (let i = 1; i <= span; i++) { const d = addDays(today(), i); if (dow(d) !== 0 && dow(d) !== 6) out.push(d); } return out; }
function spread(ids, days) { const out = {}; ids.forEach((c, i) => { out[c] = days[Math.min(days.length - 1, Math.floor((i * days.length) / ids.length))]; }); return out; }

function planDialog() {
  const all = rows().filter((r) => M.sel.has(r.cid)).sort((a, b) => b.l12 - a.l12 || b.life - a.life);
  if (!all.length) return;
  const withTask = all.filter((r) => r.next).length;
  const st = { span: 14, skip: withTask > 0 && withTask < all.length, remind: true };
  const wc = WC();
  const pick = () => (st.skip ? all.filter((r) => !r.next) : all);
  const draw = (el) => {
    const ps = pick(); const days = weekdays(st.span); const map = spread(ps.map((r) => r.cid), days);
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>Plan ${plural(ps.length, 'call')}</h2><p>One phone call task each, for ${esc(isMine() ? 'you' : nameOf(M.owner))}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${wc.ic('x')}</button></div>
      <div class="wc-dlg__body">
        <div class="wc-field"><span class="lab">Spread over</span><div class="wc-choices">${[[7, 'This week'], [14, 'Two weeks'], [30, 'A month']].map(([n, l]) => `<button type="button" class="wc-choice${st.span === n ? ' is-on' : ''}" data-wm-span="${n}">${l}</button>`).join('')}</div></div>
        <div class="wm-plan">${ps.map((r) => `<div class="wm-plan__row"><b>${esc(dayLabel(map[r.cid]))}</b><span>Call ${esc(r.name)}<small>${esc(reasonOf(r))}</small></span></div>`).join('') || '<p class="wc-note">Nothing to plan.</p>'}</div>
        ${withTask && withTask < all.length ? `<label class="wm-check2"><input type="checkbox" data-wm-skip ${st.skip ? 'checked' : ''} /> Leave out the ${withTask} that already have a task</label>` : ''}
        ${isMine() ? `<label class="wm-check2"><input type="checkbox" data-wm-remind ${st.remind ? 'checked' : ''} /> Remind me at 9 AM each day</label>` : ''}
      </div>
      <div class="wc-dlg__foot"><span class="wc-cost">About ${plural(ps.length * 2, 'Blackbaud call')}</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-wm-plango ${ps.length ? '' : 'disabled'}>Add ${plural(ps.length, 'task')}</button></div>`;
  };
  wc.dialog('', (el) => {
    draw(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.wmSpan) { st.span = Number(b.dataset.wmSpan); draw(el); return; }
      if (b.hasAttribute('data-wm-plango')) {
        const ps = pick(); const days = weekdays(st.span); const map = spread(ps.map((r) => r.cid), days);
        const remind = st.remind && isMine();
        wc.closeLayer();
        const batchOf = {};
        for (let i = 0; i < ps.length; i += 200) {
          const part = ps.slice(i, i + 200);
          const dates = Object.fromEntries(part.map((r) => [r.cid, map[r.cid]]));
          const out = await sendBatch({ op: 'new', cids: part.map((r) => r.cid), dates, set: callSet(dates[part[0].cid], M.owner, ''), }, 'Planned ' + plural(part.length, 'call'));
          if (!out || out.failed) return;
          part.forEach((r) => { batchOf[r.cid] = out.batch || null; });
        }
        ps.forEach((r) => { r.next = { id: 'pending', due: map[r.cid], summary: 'Call to check in', planned: true }; });
        if (remind) {
          try { await wc.post('/api/work/reminders', { items: ps.map((r) => ({ kind: 'plan_call', ref_id: batchOf[r.cid], cid: r.cid, title: 'Call ' + r.name, note: reasonOf(r), when: { date: map[r.cid], time: '09:00' }, source: 'plan_calls' })) }); if (window.WCBell) window.WCBell.refresh(); } catch (err) { wc.toast('The calls are planned. The reminders did not save: ' + err.message); }
        }
        M.sel.clear(); if (wc.S.view === 'mine') paint();
      }
    });
    el.addEventListener('change', (e) => { if (e.target.matches('[data-wm-skip]')) { st.skip = e.target.checked; draw(el); } if (e.target.matches('[data-wm-remind]')) st.remind = e.target.checked; });
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', async (e) => {
  const t = e.target.closest ? e.target.closest('button, a') : null;
  if (!t || !t.closest('#wc-root, #layer')) return;
  const d = t.dataset;
  if (d.wmF) { M.f = d.wmF; M.shown = 100; M.sel.clear(); paint(); return; }
  if (d.wmSort) { if (M.sort === d.wmSort) M.dir = -M.dir; else { M.sort = d.wmSort; M.dir = d.wmSort === 'name' ? 1 : -1; } paint(); return; }
  if (t.hasAttribute('data-wm-more')) { M.shown += 100; paint(); return; }
  if (t.hasAttribute('data-wm-clear')) { M.sel.clear(); paint(); return; }
  if (t.hasAttribute('data-wm-plan')) { planDialog(); return; }
  if (t.hasAttribute('data-wm-reload')) { M.loading = true; paint(); await load(M.owner, true); paint(); return; }
  if (d.wmTask1) { addOneTask(d.wmTask1); return; }
  if (d.wmPrep) { if (window.WCPrep && window.WCPrep.open) window.WCPrep.open(d.wmPrep); else if (window.FavorPartner) window.FavorPartner.open(d.wmPrep); return; }
  if (d.wmLog) {
    const r = rows().find((x) => x.cid === d.wmLog);
    if (window.WCLog && window.WCLog.open) window.WCLog.open({ cid: d.wmLog, name: r ? r.name : '' });
    else if (window.WCEdit && window.WCEdit.newAction) window.WCEdit.newAction({ cid: d.wmLog, name: r ? r.name : 'Partner' });
    return;
  }
});
document.addEventListener('change', async (e) => {
  const t = e.target; if (!t.closest || !t.closest('#wc-root')) return;
  if (t.dataset.wmPick) { if (t.checked) M.sel.add(t.dataset.wmPick); else M.sel.delete(t.dataset.wmPick); const row = t.closest('.wm-row'); if (row) row.classList.toggle('is-picked', t.checked); updateBulk(); return; }
  if (t.hasAttribute('data-wm-pickall')) { const list = visible().slice(0, M.shown); list.forEach((r) => (t.checked ? M.sel.add(r.cid) : M.sel.delete(r.cid))); paint(); return; }
  if (t.hasAttribute('data-wm-owner')) { M.loading = true; M.sel.clear(); M.f = 'q90'; M.shown = 100; await load(t.value); paint(); return; }
});
function updateBulk() { const b = $('.wm-bulk'); if (!b) return; b.classList.toggle('is-on', M.sel.size > 0); $('b', b).textContent = M.sel.size + ' selected'; const all = $('[data-wm-pickall]'); if (all) { const list = visible().slice(0, M.shown); all.checked = list.length > 0 && list.every((r) => M.sel.has(r.cid)); } }
let qT = 0;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'wm-q') return;
  clearTimeout(qT);
  qT = setTimeout(() => { M.q = e.target.value; M.shown = 100; paint(); const q = $('#wm-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 160);
});

/* ------------------------------------------------------------------ register with the Work Center */
function sheetsSpec() {
  const list = visible();
  const cols = [['name', 'Partner', 'text'], ['lookup', 'Lookup id', 'id'], ['place', 'City', 'text'], ['last_contact', 'Last contact', 'date'], ['quiet_days', 'Days since contact', 'int'], ['last_gift', 'Last gift', 'money'], ['last_gift_date', 'Last gift date', 'date'], ['twelve', 'Last 12 months', 'money'], ['prior12', 'The 12 months before', 'money'], ['life', 'Lifetime', 'money'], ['gifts', 'Gifts', 'int'], ['next', 'Next step', 'text'], ['phone', 'Phone', 'text']];
  const out = list.map((r) => ({ name: r.name, lookup: r.lookup, place: r.place, last_contact: r.last ? r.last.date : '', quiet_days: r.quiet === null ? '' : r.quiet, last_gift: r.gift ? r.gift.amount : '', last_gift_date: r.gift ? r.gift.date : '', twelve: r.l12, prior12: r.p12, life: r.life, gifts: r.gifts, next: r.next ? (r.next.summary || 'Open task') + (r.next.due ? ' ' + r.next.due : '') : '', phone: r.phone || '' }));
  const label = (FILTERS.find((x) => x[0] === M.f) || ['', 'No phone'])[1];
  return window.FavorSheets.screen('My partners', [{ name: 'Partners', columns: cols.map(([key, l, type]) => ({ key, label: l, type })), rows: out }], { filters: 'Showing: ' + label + (M.q ? ', search ' + M.q : '') + ', ' + nameOf(M.owner), classes: ['partner'] });
}
if (window.FavorSheets) window.FavorSheets.register('work-partners', sheetsSpec);
else document.addEventListener('DOMContentLoaded', () => window.FavorSheets && window.FavorSheets.register('work-partners', sheetsSpec));

window.WCX = window.WCX || [];
window.WCX.push({
  k: 'mine', label: 'My partners', after: 'open',
  show: (me) => me && (me.role === 'admin' || me.role === 'support' || (me.role === 'director' && !!me.fid)),
  count: () => (M.data ? M.data.stats.quiet90 : ''),
  view,
});
// Load the portfolio once the Work Center has its lists, so the tab can show how many partners are quiet before it is opened.
(function warm(n) {
  const wc = window.WC;
  if (!wc || !wc.S || !wc.S.loaded) { if (n < 80) setTimeout(() => warm(n + 1), 250); return; }
  const me = wc.DATA.me;
  if (!(me.role === 'admin' || me.role === 'support' || (me.role === 'director' && me.fid)) || M.data || M.loading) return;
  let owner = ''; try { owner = sessionStorage.getItem('wm.owner') || ''; } catch (_) { /* none */ }
  load(me.role === 'director' && me.fid ? me.fid : owner).then(() => { if (wc.S.view !== 'mine') wc.render(); });
})(0);
window.WCMine = { reload: async () => { await load(M.owner, true); if (WC().S.view === 'mine') paint(); }, _M: M };
})();
