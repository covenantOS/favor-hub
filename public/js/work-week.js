/* My week (Work Center tab) and the goals strip above the tabs. A regional director sees this week's connections, meetings, event and
   one-on-ones against the weekly goals, the giving line, what counted and a report draft to copy. Support and admins open the same tab as
   Weekly reports with a director picker. Reads GET /api/work/week (the D1 copy of Blackbaud, no Blackbaud calls) and writes nothing.
   The draft text comes from work-week-report.js. Registers through window.WCTabs; work.js calls WCWeek.strip() above the tab bar. */
(() => {
'use strict';
const W = () => window.WC;
const R = () => window.WCWeekReport;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = {
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  send: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 11-10"/>',
  go: '<path d="m9 6 6 6-6 6"/>',
};
const ic = (n) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n] || ''}</svg>`;
const HOWIC = { Call: 'phone', Email: 'mail', Visit: 'meet', Letter: 'letter', Task: 'task' };
const rowIc = (how) => (W().I && W().I[HOWIC[how]] ? W().ic(HOWIC[how]) : '');

const S = { data: null, owner: '', back: 0, loading: false, error: '', started: false, kind: '', opts: { give: true, asks: true, refs: true, next: true }, edited: null, page: 1, sort: '', dir: 'desc' };
const todayDow = () => new Date(W().TODAY + 'T12:00:00Z').getUTCDay();

// A director with weekly goals: the server answers week: null for anyone else, and the tab and strip stay away.
const mayStrip = (me) => !!me && me.role === 'director' && !!me.fid && me.team === 'RDD';
const mayTab = (me) => !!me && (me.role === 'admin' || me.role === 'support' || mayStrip(me));

async function load(owner, back) {
  S.loading = true; S.error = '';
  try {
    const q = [];
    if (owner) q.push('owner=' + encodeURIComponent(owner));
    if (back) q.push('week=last');
    const d = await W().api('/api/work/week' + (q.length ? '?' + q.join('&') : ''));
    S.data = d; S.owner = d.owner || ''; S.back = back || 0; S.edited = null; S.page = 1;
  } catch (e) { S.error = e.message; }
  S.loading = false;
}
async function start() {
  if (S.started) return;
  S.started = true;
  await load('', 0);
  W().refresh('*'); // the strip above the tabs fills in; a refresh of the Your week tab alone would leave the placeholder
}
const wk = () => (S.data && S.data.week) || null;
const name = () => (S.data && S.data.ownerName) || (wk() && wk().name) || '';
const kindNow = () => S.kind || (S.back === 0 && todayDow() >= 1 && todayDow() <= 3 ? 'goals' : 'update');
const draftText = () => (S.edited != null ? S.edited : R().text(wk(), name(), kindNow(), S.opts));

// ---------------------------------------------------------------- the strip above the tabs
const meter = (label, short, n, goal) => `<div class="wwk-meter${n >= goal ? ' is-met' : ''}"><span class="wwk-meter__l"><span class="f">${esc(label)}</span><span class="s">${esc(short)}</span></span><b>${n}<small>/${goal}</small></b><i><u style="width:${Math.min(100, (n / goal) * 100)}%"></u></i></div>`;
function strip() {
  const me = W().DATA.me;
  if (!mayStrip(me) || W().S.view === 'week') return '';
  const hold = '<div class="h-card wwk-strip wwk-strip--wait" aria-hidden="true"></div>';
  if (!S.started) { start(); return hold; }
  const d = wk();
  if (S.loading && !d) return hold;
  if (!d || S.back !== 0 || S.owner !== me.fid) return '';
  const c = d.counts, g = d.goals, v = d.giving;
  return `<div class="h-card wwk-strip" data-wwk-go role="button" tabindex="0" aria-label="Open My week">
    <div class="wwk-strip__week"><span class="wwk-k">This week,<br>${esc(d.week.range)}</span>${meter('Connections', 'Connect', c.conn, g.conn)}${meter('Meetings', 'Meetings', c.mtg, g.mtg)}${meter('Event scheduled', 'Event', c.ev, g.ev)}${meter('One-on-ones', '1-on-1s', c.oo, g.oo)}</div>
    <div class="wwk-strip__give"><span class="wwk-k">Giving to goal</span><b>${R().short(v.ytd)}<small> of ${R().short(v.goal)}</small></b>
      <i class="wwk-pace"><u style="width:${v.pct}%"></u><s style="left:${v.ppct}%" title="Pace ${R().short(v.pace)}"></s></i><span class="wwk-sub">${v.behind > 0 ? R().short(v.behind) + ' behind pace' : 'On pace'}</span></div>
    <span class="wwk-strip__go">${ic('go')}</span></div>`;
}

// ---------------------------------------------------------------- the tab
// What counted: one line per action. The columns the person can hide (Partner always shows).
const COLS = [{ k: 'date', l: 'Date' }, { k: 'how', l: 'How' }, { k: 'who', l: 'Partner', fixed: true }, { k: 'said', l: 'What was said' }, { k: 'tags', l: 'Tags' }];
const pageSize = () => (window.PT ? window.PT.size('week', 25) : 25);
const th = (col, label) => (window.PT ? window.PT.th('week', col, label, { col: S.sort, dir: S.dir }) : esc(label));
const SORTS = {
  date: (r) => r.date || '',
  how: (r) => String(r.how || '').toLowerCase(),
  name: (r) => String(r.name || '').toLowerCase(),
};
function orderedRows(rows) {
  const key = SORTS[S.sort];
  if (!key) return rows;
  const sgn = S.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((x, y) => { const p = key(x), q = key(y); return (p < q ? -1 : p > q ? 1 : 0) * sgn; });
}
function rowHTML(r, hide) {
  const tags = r.tags.concat(r.ask > 0 ? ['Ask ' + R().money(r.ask)] : [], r.refs > 0 ? [r.refs + (r.refs === 1 ? ' referral' : ' referrals')] : []);
  return `<tr class="ptl-row" data-pt-row tabindex="-1">
    ${hide.has('date') ? '' : `<td class="c-date"><b>${esc(R().fd(r.date))}</b></td>`}
    ${hide.has('how') ? '' : `<td class="c-how"><span class="wwk-how">${rowIc(r.how)}${esc(r.how)}</span></td>`}
    <td class="c-who"><a class="pt-name wwk-name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}" data-pt-open title="${esc(r.name)}">${esc(r.name)}</a></td>
    ${hide.has('said') ? '' : `<td class="c-said is-clip" title="${esc(r.said || '')}"><span class="pt-sub">${esc(r.said || '')}</span></td>`}
    ${hide.has('tags') ? '' : `<td class="c-tags" title="${esc(tags.join(', '))}">${tags.map((t) => `<span class="pt-badge">${esc(t)}</span>`).join(' ')}</td>`}</tr>`;
}
const GOALCARDS = [['conn', 'Connections', 'A two-way phone call or an in-person visit or meeting with a partner or prospect, counted once per partner; letters, voicemails, emails and texts do not count.'], ['mtg', 'Meetings attended or hosted', 'Actions tagged Attended Event or Hosted Event.'], ['ev', 'Event scheduled', 'An event on the calendar this week.'], ['oo', 'One-on-ones', 'Meetings with one partner.']];

function view() {
  const el = $('#view'); if (!el) return;
  if (!S.data && !S.error) { el.innerHTML = window.WCSkel(5); if (!S.loading) start(); return; }
  if (S.error) { el.innerHTML = `<section class="h-card wc-sheet wwk-empty"><b>The week did not load</b><span>${esc(S.error)}</span><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wwk-retry>Try again</button></section>`; return; }
  const d = wk();
  if (!d) { el.innerHTML = '<section class="h-card wc-sheet wwk-empty"><b>No director to show</b><span>My week covers the regional directors.</span></section>'; return; }
  const me = W().DATA.me, picker = S.data.directors.length > 1 || !mayStrip(me);
  const PT = window.PT;
  const kind = kindNow(), c = d.counts, g = d.goals, v = d.giving, total = d.rows.length + d.moreRows;
  const sel = picker ? `<select class="wc-sel" data-wwk-dir aria-label="Director">${S.data.directors.map((x) => `<option value="${esc(x.fid)}"${x.fid === S.owner ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
  const hide = PT ? PT.hidden('week') : new Set();
  const nCols = COLS.filter((x) => x.fixed || !hide.has(x.k)).length;
  const allRows = orderedRows(d.rows);
  if (PT) S.page = PT.clampPage(S.page, allRows.length, pageSize());
  const pageRows = PT ? PT.slice(allRows, S.page, pageSize()) : allRows;
  el.innerHTML = `<div class="wwk-grid">
    <section class="h-card wc-sheet wwk-card">
      <div class="wwk-tools">${sel}<div class="wwk-seg" role="group" aria-label="Week">${[[0, 'This week'], [1, 'Last week']].map(([b, l]) => `<button type="button" class="${S.back === b ? 'is-on' : ''}" data-wwk-week="${b}" aria-pressed="${S.back === b}">${l}</button>`).join('')}</div><span class="wwk-spacer"></span><span class="wwk-sub">${esc(d.week.range)}</span></div>
      <div class="wwk-goalgrid">${GOALCARDS.map(([k, l, h]) => `<div class="wwk-goal${c[k] >= g[k] ? ' is-met' : ''}" title="${h.replace(/"/g, '&quot;')}"><b>${c[k]}<small> of ${g[k]}</small></b><span>${l}</span><i><u style="width:${Math.min(100, (c[k] / g[k]) * 100)}%"></u></i></div>`).join('')}</div>
      <div class="wwk-give"><b>${R().short(v.ytd)}<small> of ${R().short(v.goal)} credited this year</small></b>
        <span class="wwk-sub">${v.behind > 0 ? `${R().short(v.behind)} behind pace. ${R().money(v.perWeek)} a week for ${v.weeks} ${v.weeks === 1 ? 'week' : 'weeks'} reaches the goal.` : v.ytd >= v.goal && v.goal ? 'The goal is met.' : 'On pace for the goal.'}</span>
        <i class="wwk-pace wwk-pace--big"><u style="width:${v.pct}%"></u><s style="left:${v.ppct}%" title="Pace ${R().short(v.pace)}"></s></i></div>
      <div class="pt-bar"><b class="ptl-title">What counted · ${total} ${total === 1 ? 'action' : 'actions'}</b><span class="pt-spacer"></span>${PT ? PT.colsHTML('week', COLS) : ''}${PT ? PT.densityHTML() : ''}</div>
      <div class="ptl-wrap">
        <table class="pt-table ptl-table ptl-week">
          <thead><tr>${hide.has('date') ? '' : `<th>${th('date', 'Date')}</th>`}${hide.has('how') ? '' : `<th>${th('how', 'How')}</th>`}<th>${th('name', 'Partner')}</th>${hide.has('said') ? '' : '<th>What was said</th>'}${hide.has('tags') ? '' : '<th>Tags</th>'}</tr></thead>
          <tbody data-pt-list="week">${pageRows.map((r) => rowHTML(r, hide)).join('') || `<tr><td colspan="${nCols}"><div class="wwk-none">Nothing counted yet this week.</div></td></tr>`}</tbody>
        </table>
      </div>
      ${PT ? PT.pager('week', { total: allRows.length, page: S.page, noun: 'actions', label: d.moreRows ? '(' + d.moreRows + ' more not listed)' : '' }) : ''}
    </section>
    <section class="h-card wwk-report" aria-label="Report draft">
      <h3>Report draft</h3>
      <div class="wwk-seg" role="group" aria-label="Draft">${[['goals', 'Goals for the week'], ['update', 'Update for the week']].map(([k, l]) => `<button type="button" class="${kind === k ? 'is-on' : ''}" data-wwk-kind="${k}" aria-pressed="${kind === k}">${l}</button>`).join('')}</div>
      <div class="wwk-opts">${[['give', 'Giving'], ['asks', 'Asks'], ['refs', 'Number of Referrals'], ['next', 'Next']].map(([k, l]) => `<label class="wwk-check"><input type="checkbox" data-wwk-opt="${k}"${S.opts[k] ? ' checked' : ''}/>${l}</label>`).join('')}</div>
      <textarea id="wwk-draft" spellcheck="false" aria-label="Report draft">${esc(draftText())}</textarea>
      <div class="wwk-acts"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-wwk-copy="wa">${ic('copy')}Copy for WhatsApp</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wwk-copy="mail">${ic('mail')}Copy for email</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-wwk-mailto>${ic('send')}Open in my email</button>${S.edited != null ? '<button type="button" class="wwk-reset" data-wwk-reset>Reset the draft</button>' : ''}</div>
    </section></div>`;
}

// ---------------------------------------------------------------- copy and mail
function fallbackCopy(t) { const x = document.createElement('textarea'); x.value = t; x.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch (_) { /* nothing to do */ } x.remove(); }
function copyText(t, msg) {
  const done = () => W().toast(msg);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => { fallbackCopy(t); done(); });
  else { fallbackCopy(t); done(); }
}
const current = () => { const ta = $('#wwk-draft'); return ta ? ta.value : draftText(); };
function mailto() {
  const t = current(), sub = R().subject(wk(), name(), kindNow());
  const href = 'mailto:?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(t);
  if (href.length <= 1800) { location.href = href; W().toast('Your email app opened with the draft'); return; }
  copyText(sub + '\n\n' + t, 'Draft copied');
  location.href = 'mailto:?subject=' + encodeURIComponent(sub);
}

document.addEventListener('input', (e) => { if (e.target && e.target.id === 'wwk-draft') { S.edited = e.target.value; if (!$('[data-wwk-reset]')) { const b = document.createElement('button'); b.type = 'button'; b.className = 'wwk-reset'; b.setAttribute('data-wwk-reset', ''); b.textContent = 'Reset the draft'; $('.wwk-acts').appendChild(b); } } });
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-wwk-go]')) { e.preventDefault(); goWeek(); } });
function goWeek() { const wc = W(); wc.S.view = 'week'; wc.S.sel.clear(); wc.render(); }
document.addEventListener('click', async (e) => {
  const t = e.target.closest && e.target.closest('[data-wwk-go],[data-wwk-week],[data-wwk-kind],[data-wwk-copy],[data-wwk-mailto],[data-wwk-reset],[data-wwk-retry]');
  if (!t || !W()) return;
  if (t.hasAttribute('data-wwk-go')) { goWeek(); return; }
  if (t.hasAttribute('data-wwk-retry')) { S.error = ''; S.data = null; S.started = false; W().render(); return; }
  if (t.dataset.wwkWeek !== undefined) { const b = Number(t.dataset.wwkWeek); if (b !== S.back) { S.loading = true; await load(S.owner, b); S.kind = ''; W().render(); } return; }
  if (t.dataset.wwkKind) { S.kind = t.dataset.wwkKind; S.edited = null; view(); return; }
  if (t.hasAttribute('data-wwk-reset')) { S.edited = null; view(); return; }
  if (t.dataset.wwkCopy === 'wa') { copyText(R().whatsapp(current()), 'Copied for WhatsApp'); return; }
  if (t.dataset.wwkCopy === 'mail') { copyText(R().subject(wk(), name(), kindNow()) + '\n\n' + current(), 'Copied for email'); return; }
  if (t.hasAttribute('data-wwk-mailto')) { mailto(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (!t || !t.matches) return;
  if (t.matches('[data-wwk-opt]')) { S.opts[t.dataset.wwkOpt] = t.checked; S.edited = null; view(); return; }
  if (t.matches('[data-wwk-dir]')) { await load(t.value, S.back); S.kind = ''; W().render(); }
});

// Pager, sortable headers and the Columns menu for What counted (public/js/ptable.js).
if (window.PT) {
  window.PT.on('week', {
    page(p) { S.page = p; view(); },
    sort(col, dir) { if (col === 'how' || col === 'name') dir = S.sort === col ? dir : 'asc'; S.sort = col; S.dir = dir; S.page = 1; view(); },
    cols() { view(); },
  });
}

window.WCWeek = { strip, view, state: S };
const reg = () => window.WCTabs.registerTab({
  id: 'week',
  get label() { return mayStrip(W() && W().DATA && W().DATA.me) ? 'My week' : 'Weekly reports'; },
  roles: ['director', 'support'],
  show: (me) => mayTab(me),
  after: 'asks',
  count: () => '',
  mount: view,
});
if (window.WCTabs) reg(); else document.addEventListener('DOMContentLoaded', reg);
})();
