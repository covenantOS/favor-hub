/* Partners > All partners: every Blackbaud record (individuals, households, organizations, churches, foundations, givers or not) in one
   table. Search by name, email, phone, lookup ID, street, city or ZIP; filter, sort, page, save a view, star, tag, export, and find
   possible duplicates. Reads /api/partners (a copy of Blackbaud kept in FavorOS, rebuilt each hour after Blackbaud's sync). A name opens
   the partner's panel; the panel's Open full page goes to /work/partner/<id>. Nothing here writes to Blackbaud: stars, tags, saved
   views and merge requests are FavorOS's own. Shared list parts: public/js/ptable.js. */
(() => {
'use strict';
const root = document.getElementById('pd-root');
if (!root || !window.PT) return;
const PT = window.PT;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = PT.esc;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fd = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (y !== Number(TODAY.slice(0, 4)) ? ', ' + y : ''); };
const ago = (iso) => { if (!iso) return ''; const n = Math.round((Date.parse(TODAY + 'T12:00:00Z') - Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')) / 86400000); return n <= 0 ? 'today' : n === 1 ? '1 day ago' : n < 60 ? n + ' days ago' : n < 730 ? Math.round(n / 30.4) + ' months ago' : Math.round(n / 365) + ' years ago'; };
const whole = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
const money = (v) => { const n = Number(v) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 }); };
const short = (v) => { const n = Number(v) || 0, f = (x) => String(+x.toFixed(1)); return n >= 999500 ? '$' + f(n / 1e6) + 'M' : n >= 10000 ? '$' + Math.round(n / 1000) + 'K' : whole(n); };
const N = (n) => (Number(n) || 0).toLocaleString('en-US');
const I = {
  star: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>', down: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>', tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', merge: '<path d="M6 4v5a5 5 0 0 0 5 5h7"/><path d="M6 20v-4"/><path d="m15 11 3 3-3 3"/>', save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h8V4"/><path d="M8 20v-6h8v6"/>',
  views: '<path d="M4 6h16M4 12h16M4 18h10"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const ic = (n, cls) => `<svg class="h-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;

async function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.body ? { 'Content-Type': 'application/json' } : {});
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sign in again.'); }
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; throw e; }
  return data;
}
const post = (path, b) => api(path, { method: 'POST', body: JSON.stringify(b || {}) });

/* ------------------------------------------------------------------ state */
const DEF = { q: '', kinds: [], status: [], states: [], holder: '', codes: [], codesNot: [], solicit: [], solicitNot: [], tags: [], band: '', firstFrom: '', firstTo: '', lastFrom: '', lastTo: '', noContactDays: 0, major: false, recurring: false, openActions: false, starred: false, deceased: 'exclude', inactive: 'exclude', sort: 'name', dir: 'asc' };
const ARRS = ['kinds', 'status', 'states', 'codes', 'codesNot', 'solicit', 'solicitNot', 'tags'];
const BOOLS = ['major', 'recurring', 'openActions', 'starred'];
const S = { spec: Object.assign({}, DEF), page: 1, size: PT.size('pd', 50), data: null, menus: null, sel: new Set(), pane: 'all', views: null, view: '', error: '', busy: false, seq: 0, side: null, fopen: false, recent: null, dups: null, merges: null };

function specFromUrl() {
  const u = new URLSearchParams(location.search);
  const s = Object.assign({}, DEF);
  for (const k of Object.keys(DEF)) {
    if (!u.has(k)) continue;
    const v = u.get(k);
    if (ARRS.includes(k)) s[k] = v ? v.split(',') : [];
    else if (BOOLS.includes(k)) s[k] = v === '1' || v === 'true';
    else if (k === 'noContactDays') s[k] = Number(v) || 0;
    else s[k] = v;
  }
  S.page = Math.max(1, Number(u.get('page')) || 1);
  S.pane = ['all', 'recent', 'dups', 'merges'].includes(u.get('pane')) ? u.get('pane') : 'all';
  S.view = u.get('view') || '';
  return s;
}
function params(spec, extra) {
  const p = new URLSearchParams();
  for (const k of Object.keys(DEF)) {
    const v = spec[k], d = DEF[k];
    if (ARRS.includes(k)) { if (v.length) p.set(k, v.join(',')); }
    else if (BOOLS.includes(k)) { if (v) p.set(k, '1'); }
    else if (v !== d && v !== '' && v != null) p.set(k, String(v));
  }
  if (extra) for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) p.set(k, String(v));
  return p;
}
function syncUrl() {
  const p = params(S.spec, { page: S.page > 1 ? S.page : '', pane: S.pane !== 'all' ? S.pane : '', view: S.view });
  const qs = p.toString();
  history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : ''));
}

/* ------------------------------------------------------------------ columns */
const COLS = [
  { k: 'kind', l: 'Kind' }, { k: 'place', l: 'City and state', s: 'place' }, { k: 'holder', l: 'Holder', s: 'holder' }, { k: 'status', l: 'Status', s: 'status' },
  { k: 'lifetime', l: 'Lifetime', s: 'lifetime', num: 1 }, { k: 'last_gift', l: 'Last gift', s: 'last_gift', num: 1 }, { k: 'ytd', l: 'This year', s: 'ytd', num: 1 },
  { k: 'l12', l: 'Last 12 months', s: 'l12', num: 1 }, { k: 'last_year', l: 'Last year', s: 'last_year', num: 1 }, { k: 'largest', l: 'Largest gift', s: 'largest', num: 1 },
  { k: 'gifts', l: 'Gifts', s: 'gifts', num: 1 }, { k: 'first_gift', l: 'First gift', s: 'first_gift' }, { k: 'last_contact', l: 'Last contact', s: 'last_contact' },
  { k: 'open', l: 'Open actions', s: 'open', num: 1 }, { k: 'codes', l: 'Constituent codes' }, { k: 'solicit', l: 'Solicit codes' },
  { k: 'email', l: 'Email', contact: 1 }, { k: 'phone', l: 'Phone', contact: 1 }, { k: 'zip', l: 'ZIP' }, { k: 'lookup', l: 'Lookup ID', s: 'lookup' }, { k: 'added', l: 'Added', s: 'added' },
];
const HIDE_DEFAULT = ['l12', 'last_year', 'largest', 'gifts', 'first_gift', 'solicit', 'email', 'phone', 'zip', 'lookup', 'added'];
let HIDDEN = PT.hidden('pd', HIDE_DEFAULT);
const shown = () => COLS.filter((c) => !HIDDEN.has(c.k) && (!c.contact || (S.data && S.data.contacts)));

const KIND = { individual: 'Individual', household: 'Household', organization: 'Organization', church: 'Church', foundation: 'Foundation' };
const STATUS = { active: 'Active', lybunt: 'LYBUNT', lapsed: 'Lapsed', never: 'Never gave' };
const STATUS_TIP = { active: 'The household gave in the last 12 months', lybunt: 'The household last gave 12 to 24 months ago', lapsed: 'The household last gave more than 24 months ago', never: 'No gift credited to this record or its household' };
const pipes = (s) => String(s || '').split('|').filter(Boolean);

function cell(c, r) {
  switch (c.k) {
    case 'kind': return r.kind === 'individual' && r.spouse_id ? `<span title="Household with ${esc(r.spouse_name || 'a spouse')}">Household</span>` : esc(KIND[r.kind] || r.kind);
    case 'place': return esc([r.city, r.state].filter(Boolean).join(', ')) || '<span class="pt-mute">No address</span>';
    case 'holder': return r.holder_names ? esc(r.holder_names) : '<span class="pt-mute">No one</span>';
    case 'status': return `<span class="pt-badge${r.status === 'active' ? ' pt-badge--good' : r.status === 'lybunt' ? ' pt-badge--gold' : r.status === 'lapsed' ? ' pt-badge--warn' : ''}" title="${esc(STATUS_TIP[r.status] || '')}">${esc(STATUS[r.status] || r.status)}</span>`;
    case 'lifetime':
      if (!(r.lifetime > 0) && r.passed_on > 0) return `<span class="pt-mute" title="None of its own. It passed on ${esc(whole(r.passed_on))} in ${N(r.passed_n)} gifts for other partners.">Passes on ${esc(short(r.passed_on))}</span>`;
      return r.lifetime > 0 ? `<span title="${esc(whole(r.lifetime))} credited to the household">${esc(short(r.lifetime))}</span>` : '<span class="pt-mute">None yet</span>';
    case 'last_gift': return r.last_gift ? `${esc(money(r.last_amt))} <span class="pt-sub">${esc(fd(r.last_gift))}</span>` : '';
    case 'ytd': return r.ytd > 0 ? esc(whole(r.ytd)) : '';
    case 'l12': return r.l12 > 0 ? esc(whole(r.l12)) : '';
    case 'last_year': return r.last_year > 0 ? esc(whole(r.last_year)) : '';
    case 'largest': return r.largest > 0 ? esc(money(r.largest)) : '';
    case 'gifts': return r.gifts ? N(r.gifts) : '';
    case 'first_gift': return esc(fd(r.first_gift));
    case 'last_contact': return r.last_contact ? `<span title="${esc(fd(r.last_contact))}">${esc(ago(r.last_contact))}</span>` : '<span class="pt-mute">None logged</span>';
    case 'open': return r.open_actions ? N(r.open_actions) : '';
    case 'codes': return esc(pipes(r.codes).join(', '));
    case 'solicit': return esc(pipes(r.solicit).join(', '));
    case 'email': return r.hidden ? '<span class="pt-mute" title="Contact details need the contacts package">Hidden</span>' : r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '';
    case 'phone': return r.hidden ? '<span class="pt-mute">Hidden</span>' : r.phone ? `<a href="tel:${esc(String(r.phone).replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : '';
    case 'zip': return esc(r.zip || '');
    case 'lookup': return esc(r.lookup || '');
    case 'added': return esc(fd(r.added));
  }
  return '';
}

/* ------------------------------------------------------------------ loading */
async function load(opts = {}) {
  const seq = ++S.seq;
  S.busy = true;
  if (!opts.quiet) paintBusy();
  try {
    let d;
    const want = params(S.spec, { page: S.page, size: S.size, menus: S.menus ? '' : '1' }).toString();
    if (window.__pdEarly && !S.data) {
      d = await window.__pdEarly.catch(() => null);
      window.__pdEarly = null;
      if (!d || d.ok === false || d.page !== S.page || d.size !== S.size) d = null;
    }
    if (!d) d = await api('/api/partners?' + want);
    if (seq !== S.seq) return;
    if (d.menus) S.menus = d.menus;
    S.data = d;
    S.error = '';
    const last = PT.pages(d.total, S.size);
    if (S.page > last) { S.page = last; return load(opts); }
  } catch (e) {
    if (seq !== S.seq) return;
    S.error = e.message;
  } finally {
    if (seq === S.seq) { S.busy = false; syncUrl(); paint(); }
  }
}
function changed() { S.page = 1; S.sel.clear(); load(); }

/* ------------------------------------------------------------------ painting */
function paintBusy() { const t = $('#pd-table'); if (t) t.classList.add('is-busy'); }

const optList = (list, cur, label, fmt) => `<option value="">${esc(label)}</option>` + (list || []).map((o) => `<option value="${esc(o.v)}"${cur === o.v ? ' selected' : ''}>${esc(fmt ? fmt(o) : o.v)} (${N(o.n)})</option>`).join('');

function bar() {
  const d = S.data || { facets: { kinds: {}, status: {} } };
  const s = S.spec;
  const kseg = [['', 'All'], ['individual', 'Individuals'], ['household', 'Households'], ['organization', 'Organizations'], ['church', 'Churches'], ['foundation', 'Foundations']]
    .map(([k, l]) => { const on = k ? s.kinds.length === 1 && s.kinds[0] === k : !s.kinds.length; const n = k ? d.facets.kinds[k] : null; return `<button type="button" data-kind="${k}" aria-pressed="${on}">${l}${n != null ? `<span>${N(n)}</span>` : ''}</button>`; }).join('');
  const sseg = [['', 'Any status'], ['active', 'Active'], ['lybunt', 'LYBUNT'], ['lapsed', 'Lapsed'], ['never', 'Never gave']]
    .map(([k, l]) => { const on = k ? s.status.length === 1 && s.status[0] === k : !s.status.length; const n = k ? d.facets.status[k] : null; return `<button type="button" data-status="${k}" aria-pressed="${on}"${k ? ` title="${esc(STATUS_TIP[k])}"` : ''}>${l}${n != null ? `<span>${N(n || 0)}</span>` : ''}</button>`; }).join('');
  const m = S.menus || {};
  const holderOpts = `<option value="">Any holder</option>${S.data && S.data.fid ? `<option value="_mine"${s.holder === '_mine' ? ' selected' : ''}>My partners</option>` : ''}<option value="_none"${s.holder === '_none' ? ' selected' : ''}>No holder</option>` +
    (m.holders || []).map((h) => `<option value="${esc(h.v)}"${s.holder === h.v ? ' selected' : ''}>${esc(h.name)} (${N(h.n)})</option>`).join('');
  const viewsBtn = `<details class="pd-menu" data-pd-views><summary class="h-btn h-btn--ghost h-btn--sm">${ic('views')}${S.view && S.views ? esc((S.views.find((v) => v.id === S.view) || {}).name || 'Views') : 'Views'}</summary><div class="pd-menu__list" id="pd-views">${viewsHTML()}</div></details>`;
  return `<div class="pt-bar pd-bar1">
      <label class="pt-search"><svg viewBox="0 0 24 24" aria-hidden="true">${I.search}</svg><span class="sr-only">Search partners</span><input id="pd-q" data-pt-search type="search" placeholder="Name, email, phone, lookup ID, street, city or ZIP" value="${esc(s.q)}" autocomplete="off" /></label>
      <div class="pt-seg" role="group" aria-label="Kind">${kseg}</div>
      <span class="pt-spacer"></span>
      ${viewsBtn}
      ${PT.colsHTML('pd', COLS.filter((c) => !c.contact || (S.data && S.data.contacts)), HIDE_DEFAULT)}
      <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-export>${ic('down')}Export</button>
      ${window.FavorSheets ? window.FavorSheets.buttonHtml('partners', 'Sheets') : ''}
      ${PT.densityHTML()}
    </div>
    <div class="pt-bar pd-bar2">
      <div class="pt-seg" role="group" aria-label="Status">${sseg}</div>
      <select class="pt-sel${s.holder ? ' is-set' : ''}" data-f="holder" aria-label="Holder">${holderOpts}</select>
      <select class="pt-sel${s.states.length ? ' is-set' : ''}" data-add="states" aria-label="State">${optList(m.states, '', s.states.length ? 'Add a state' : 'Any state')}</select>
      <select class="pt-sel${s.band ? ' is-set' : ''}" data-f="band" aria-label="Lifetime giving"><option value="">Any lifetime giving</option>${Object.entries(m.bands || {}).map(([k, l]) => `<option value="${k}"${s.band === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select class="pt-sel${s.codes.length ? ' is-set' : ''}" data-add="codes" aria-label="Constituent code">${optList(m.codes, '', s.codes.length ? 'Add a code' : 'Any constituent code')}</select>
      <select class="pt-sel${s.tags.length ? ' is-set' : ''}" data-add="tags" aria-label="Tag">${optList((m.tags || []).map((t) => ({ v: t.tag, n: t.n })), '', 'Any tag')}</select>
      <button type="button" class="h-btn h-btn--ghost h-btn--sm${S.fopen ? ' is-on' : ''}" data-more aria-expanded="${S.fopen}">${ic('filter')}More filters${moreCount() ? ' ' + moreCount() : ''}</button>
    </div>
    ${S.fopen ? moreHTML() : ''}
    <div class="pt-chips" id="pd-chips">${chips()}</div>`;
}
function moreCount() { const s = S.spec; return [s.codesNot.length, s.solicit.length, s.solicitNot.length, s.firstFrom || s.firstTo, s.lastFrom || s.lastTo, s.noContactDays, s.major, s.recurring, s.openActions, s.deceased !== 'exclude', s.inactive !== 'exclude'].filter(Boolean).length; }
function moreHTML() {
  const s = S.spec, m = S.menus || {};
  const tri = (k, l) => `<label><span>${l}</span><select class="pt-sel${s[k] !== 'exclude' ? ' is-set' : ''}" data-f="${k}"><option value="exclude"${s[k] === 'exclude' ? ' selected' : ''}>Leave out</option><option value="include"${s[k] === 'include' ? ' selected' : ''}>Include</option><option value="only"${s[k] === 'only' ? ' selected' : ''}>Only these</option></select></label>`;
  const chk = (k, l) => `<label class="pd-chk"><input type="checkbox" data-b="${k}"${s[k] ? ' checked' : ''} />${l}</label>`;
  return `<div class="pd-more" role="group" aria-label="More filters">
    <label><span>Without the code</span><select class="pt-sel" data-add="codesNot">${optList(m.codes, '', 'Pick a code')}</select></label>
    <label><span>Has the solicit code</span><select class="pt-sel" data-add="solicit">${optList(m.solicit, '', 'Pick a solicit code')}</select></label>
    <label><span>Without the solicit code</span><select class="pt-sel" data-add="solicitNot">${optList(m.solicit, '', 'Pick a solicit code')}</select></label>
    <label><span>First gift from</span><input type="date" class="pt-sel" data-f="firstFrom" value="${esc(s.firstFrom)}" /></label>
    <label><span>First gift to</span><input type="date" class="pt-sel" data-f="firstTo" value="${esc(s.firstTo)}" /></label>
    <label><span>Last gift from</span><input type="date" class="pt-sel" data-f="lastFrom" value="${esc(s.lastFrom)}" /></label>
    <label><span>Last gift to</span><input type="date" class="pt-sel" data-f="lastTo" value="${esc(s.lastTo)}" /></label>
    <label><span>No contact logged in</span><select class="pt-sel${s.noContactDays ? ' is-set' : ''}" data-f="noContactDays"><option value="0">Any time</option>${[30, 90, 180, 365, 730].map((n) => `<option value="${n}"${Number(s.noContactDays) === n ? ' selected' : ''}>${n === 365 ? 'a year' : n === 730 ? 'two years' : n + ' days'}</option>`).join('')}</select></label>
    ${tri('deceased', 'Deceased')}${tri('inactive', 'Inactive records')}
    <div class="pd-chks">${chk('major', 'Major partners (a $1,000 gift)')}${chk('recurring', 'Active recurring gift')}${chk('openActions', 'Has open actions')}${chk('starred', 'Starred by me')}</div>
  </div>`;
}
function chips() {
  const s = S.spec, out = [];
  const add = (k, v, l) => out.push(`<button type="button" class="pt-chip" data-unf="${k}" data-v="${esc(v)}">${esc(l)}<i aria-label="Remove">×</i></button>`);
  if (s.q) add('q', '', 'Search: ' + s.q);
  for (const k of s.kinds) add('kinds', k, KIND[k] || k);
  for (const k of s.status) add('status', k, STATUS[k] || k);
  if (s.holder) add('holder', '', s.holder === '_mine' ? 'My partners' : s.holder === '_none' ? 'No holder' : 'Holder: ' + (((S.menus || {}).holders || []).find((h) => h.v === s.holder) || { name: s.holder }).name);
  for (const v of s.states) add('states', v, 'State: ' + v);
  if (s.band) add('band', '', 'Lifetime: ' + ((S.menus || {}).bands || {})[s.band]);
  for (const v of s.codes) add('codes', v, 'Code: ' + v);
  for (const v of s.codesNot) add('codesNot', v, 'Not code: ' + v);
  for (const v of s.solicit) add('solicit', v, 'Solicit: ' + v);
  for (const v of s.solicitNot) add('solicitNot', v, 'Not solicit: ' + v);
  for (const v of s.tags) add('tags', v, 'Tag: ' + v);
  if (s.firstFrom || s.firstTo) add('first', '', 'First gift ' + [s.firstFrom && 'from ' + fd(s.firstFrom), s.firstTo && 'to ' + fd(s.firstTo)].filter(Boolean).join(' '));
  if (s.lastFrom || s.lastTo) add('last', '', 'Last gift ' + [s.lastFrom && 'from ' + fd(s.lastFrom), s.lastTo && 'to ' + fd(s.lastTo)].filter(Boolean).join(' '));
  if (s.noContactDays) add('noContactDays', '', 'No contact in ' + s.noContactDays + ' days');
  if (s.major) add('major', '', 'Major partners');
  if (s.recurring) add('recurring', '', 'Recurring gift');
  if (s.openActions) add('openActions', '', 'Has open actions');
  if (s.starred) add('starred', '', 'Starred');
  if (s.deceased !== 'exclude') add('deceased', '', s.deceased === 'only' ? 'Deceased only' : 'With deceased');
  if (s.inactive !== 'exclude') add('inactive', '', s.inactive === 'only' ? 'Inactive only' : 'With inactive');
  if (out.length > 1) out.push('<button type="button" class="pd-clear" data-unf="all">Clear all</button>');
  return out.join('');
}
function viewsHTML() {
  const vs = S.views || [];
  const mine = vs.filter((v) => v.mine), shared = vs.filter((v) => !v.mine);
  const item = (v) => `<div class="pd-vrow"><button type="button" data-view="${esc(v.id)}" class="${S.view === v.id ? 'is-on' : ''}">${esc(v.name)}${v.scope === 'all' && v.mine ? ' <em>shared</em>' : ''}${!v.mine ? ` <em>${esc(v.ownerName)}</em>` : ''}</button>${v.mine ? `<button type="button" class="pd-vdel" data-viewdel="${esc(v.id)}" aria-label="Delete ${esc(v.name)}">${ic('x')}</button>` : ''}</div>`;
  return `${S.views == null ? '<p class="pd-mute">Loading views</p>' : ''}${mine.length ? '<h5>My views</h5>' + mine.map(item).join('') : ''}${shared.length ? '<h5>Shared with everyone</h5>' + shared.map(item).join('') : ''}
    ${S.views && !vs.length ? '<p class="pd-mute">No saved views yet.</p>' : ''}
    <form class="pd-vsave" data-viewsave><input name="name" maxlength="60" placeholder="Name this view" aria-label="View name" required /><label class="pd-chk"><input type="checkbox" name="all" />Share with everyone</label><button type="submit" class="h-btn h-btn--primary h-btn--sm">${ic('save')}Save the filters, sort and columns</button></form>`;
}

function tableHTML() {
  const d = S.data;
  const cols = shown();
  const sort = { col: S.spec.sort, dir: S.spec.dir };
  const rows = d ? d.rows : [];
  const allOn = rows.length && rows.every((r) => S.sel.has(String(r.id)));
  const head = `<tr><th class="pt-cb"><input type="checkbox" data-selall aria-label="Select every partner on this page"${allOn ? ' checked' : ''} /></th><th class="pd-starth"><span class="sr-only">Star</span></th>
    <th>${PT.th('pd', 'name', 'Name', sort)}</th>${cols.map((c) => `<th class="${c.num ? 'is-num' : ''}">${c.s ? PT.th('pd', c.s, c.l, sort, c.num ? 'is-num' : '') : esc(c.l)}</th>`).join('')}</tr>`;
  const body = !d ? '' : rows.length ? rows.map((r) => {
    const id = String(r.id);
    const badges = [r.deceased ? '<span class="pt-badge pt-badge--warn">Deceased</span>' : '', r.inactive ? '<span class="pt-badge">Inactive</span>' : '', r.recurring ? '<span class="pt-badge pt-badge--good" title="An active recurring gift">Recurring</span>' : ''].join('');
    return `<tr data-pt-row tabindex="-1" data-id="${esc(id)}" class="${S.sel.has(id) ? 'is-picked' : ''}">
      <td class="pt-cb"><input type="checkbox" data-sel="${esc(id)}"${S.sel.has(id) ? ' checked' : ''} aria-label="Select ${esc(r.name)}" tabindex="-1" /></td>
      <td class="pd-star"><button type="button" class="pd-starb${r.star ? ' is-on' : ''}" data-star="${esc(id)}" aria-pressed="${!!r.star}" aria-label="${r.star ? 'Unstar' : 'Star'} ${esc(r.name)}" title="${r.star ? 'Starred' : 'Star'} (s)">${ic('star')}</button></td>
      <td class="pd-name"><a class="pt-name" href="/work/partner/${esc(id)}" data-partner-id="${esc(id)}" data-pt-open>${esc(r.name)}</a>${r.lookup ? `<span class="pt-sub"> ${esc(r.lookup)}</span>` : ''}${badges}</td>
      ${cols.map((c) => `<td class="${c.num ? 'is-num' : ''}${c.k === 'codes' ? ' is-clip' : ''}">${cell(c, r)}</td>`).join('')}</tr>`;
  }).join('') : `<tr><td colspan="${cols.length + 3}"><div class="pt-empty"><b>No partners match</b>Change the search or a filter, or clear them all.</div></td></tr>`;
  const skel = !d ? Array.from({ length: 14 }, () => `<tr class="pt-loading">${'<td><i></i></td>'.repeat(cols.length + 3)}</tr>`).join('') : '';
  return `<div class="pt-wrap pt-wrap--fit pd-wrap"><table class="pt-table pd-table${S.busy ? ' is-busy' : ''}" id="pd-table"><thead>${head}</thead><tbody data-pt-list="pd">${body}${skel}</tbody></table></div>`;
}

function footHTML() {
  const d = S.data; if (!d) return '';
  const built = d.builtAt ? new Date(d.builtAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return `${PT.pager('pd', { total: d.total, page: S.page, size: S.size, label: d.total === 1 ? 'partner' : 'partners' })}
    <div class="pd-foot"><span>${N(d.total)} ${d.total === 1 ? 'record matches' : 'records match'} of ${N(d.records)} in Blackbaud. Lifetime giving for these: ${esc(whole(d.lifetime))} (spouses share their household's figure).</span>
      <span>${built ? 'Copy of Blackbaud from ' + esc(built) + '. ' : ''}Lifetime and status follow the partner rule the KPI dashboard and the Brain use: soft credits count for the partner named, spouses are one household.</span>
      <span class="pd-keys"><kbd>j</kbd><kbd>k</kbd> move <kbd>Enter</kbd> open <kbd>x</kbd> select <kbd>s</kbd> star <kbd>/</kbd> search <kbd>[</kbd><kbd>]</kbd> page</span></div>`;
}

function paneTabs() {
  const t = [['all', 'Partners'], ['recent', 'Recently opened'], ['dups', 'Possible duplicates'], ['merges', 'Merge requests']];
  return `<div class="pd-panes" role="tablist" aria-label="Lists">${t.map(([k, l]) => `<button type="button" role="tab" aria-selected="${S.pane === k}" data-pane="${k}">${l}${k === 'merges' && S.merges && S.merges.length ? ` <span>${S.merges.length}</span>` : ''}</button>`).join('')}</div>`;
}

function paint() {
  if (S.pane !== 'all') { paintPane(); return; }
  const typing = document.activeElement && document.activeElement.id === 'pd-q';
  const caret = typing ? document.activeElement.selectionStart : 0;
  const qv = typing ? document.activeElement.value : null;
  const cursor = (document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-pt-row]')) ? document.activeElement.closest('[data-pt-row]').dataset.id : '';
  const openViews = !!$('[data-pd-views][open]');
  if (S.error && !S.data) { root.innerHTML = `${paneTabs()}<section class="h-card pd-sheet"><div class="pt-empty"><b>The partners did not load</b>${esc(S.error)}<p><button type="button" class="h-btn h-btn--primary" data-reload>Try again</button></p></div></section>`; return; }
  root.innerHTML = `${paneTabs()}<section class="h-card pd-sheet" aria-label="All partners">${bar()}${tableHTML()}${footHTML()}</section>`;
  if (typing) { const i = $('#pd-q'); i.value = qv; i.focus(); i.setSelectionRange(caret, caret); }
  if (cursor) { const r = $(`#pd-table tr[data-id="${CSS.escape(cursor)}"]`); if (r) PT.focusRow(r); }
  if (openViews) { const v = $('[data-pd-views]'); if (v) v.setAttribute('open', ''); }
  bulk();
}

/* ------------------------------------------------------------------ other panes */
function miniTable(rows, empty) {
  if (!rows) return '<div class="pt-empty">Loading</div>';
  if (!rows.length) return `<div class="pt-empty"><b>${esc(empty)}</b></div>`;
  return `<div class="pt-wrap"><table class="pt-table"><thead><tr><th>Name</th><th>Kind</th><th>City and state</th><th>Holder</th><th class="is-num">Lifetime</th><th class="is-num">Last gift</th></tr></thead><tbody data-pt-list="pd-mini">${rows.map((r) =>
    `<tr data-pt-row tabindex="-1"><td><a class="pt-name" href="/work/partner/${esc(r.id)}" data-partner-id="${esc(r.id)}" data-pt-open>${esc(r.name || 'Record ' + r.id)}</a>${r.lookup ? `<span class="pt-sub"> ${esc(r.lookup)}</span>` : ''}</td><td>${esc(KIND[r.kind] || '')}</td><td>${esc([r.city, r.state].filter(Boolean).join(', '))}</td><td>${esc(r.holder_names || '')}</td><td class="is-num">${r.lifetime > 0 ? esc(short(r.lifetime)) : ''}</td><td class="is-num">${r.last_gift ? esc(money(r.last_amt)) + ' <span class="pt-sub">' + esc(fd(r.last_gift)) + '</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
const pcell = (r) => `<a class="pt-name" href="/work/partner/${esc(r.id)}" data-partner-id="${esc(r.id)}">${esc(r.name || 'Record ' + r.id)}</a>${r.lookup ? `<span class="pt-sub"> ${esc(r.lookup)}</span>` : ''}<div class="pt-sub">${esc([r.city, r.state].filter(Boolean).join(', '))}${r.lifetime > 0 ? ' · ' + esc(short(r.lifetime)) : ''}${r.holder_names ? ' · ' + esc(r.holder_names) : ''}</div>`;
function paintPane() {
  let body = '';
  if (S.pane === 'recent') {
    if (!S.recent) api('/api/partners/recent').then((d) => { S.recent = d.rows; paint(); }).catch((e) => toast(e.message));
    body = `<div class="pd-panehead"><b>Recently opened</b><span>The last partner records you opened, on any device.</span></div>${miniTable(S.recent, 'Partners you open show here.')}`;
  } else if (S.pane === 'dups') {
    if (!S.dups) api('/api/partners/duplicates').then((d) => { S.dups = d.pairs; paint(); }).catch((e) => toast(e.message));
    const rows = S.dups;
    body = `<div class="pd-panehead"><b>Possible duplicates</b><span>Records that share an email, a phone, or a name and ZIP (spouses left out). Ask Support to merge two, or mark them not the same so they leave this list. FavorOS never merges records itself; Support merges them in Blackbaud.</span></div>` +
      (!rows ? '<div class="pt-empty">Loading</div>' : !rows.length ? '<div class="pt-empty"><b>No possible duplicates</b></div>' :
        `<div class="pt-wrap"><table class="pt-table pd-dups"><thead><tr><th>Record</th><th>Looks like</th><th>Shared</th><th></th></tr></thead><tbody data-pt-list="pd-dups">${rows.map((p) =>
          `<tr data-pt-row tabindex="-1"><td class="is-wrap">${pcell(p.a)}</td><td class="is-wrap">${pcell(p.b)}</td><td>${esc(p.why.join(', '))}</td><td class="is-num"><span class="pt-acts"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-askmerge="${esc(p.a.id)},${esc(p.b.id)}">${ic('merge')}Ask to merge</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-notsame="${esc(p.a.id)},${esc(p.b.id)}">Not the same</button></span></td></tr>`).join('')}</tbody></table></div>
          <div class="pd-foot"><span>${N(rows.length)} pairs${rows.length >= 500 ? ' (the first 500)' : ''}.</span></div>`);
  } else if (S.pane === 'merges') {
    if (!S.merges) loadMerges();
    const rows = S.merges;
    body = `<div class="pd-panehead"><b>Merge requests</b><span>Two records someone believes are one partner. The Support Team merges them in Blackbaud's database view, then marks the request merged here.</span></div>` +
      (!rows ? '<div class="pt-empty">Loading</div>' : !rows.length ? '<div class="pt-empty"><b>No merge requests waiting</b></div>' :
        `<div class="pt-wrap"><table class="pt-table"><thead><tr><th>Keep</th><th>Merge into it</th><th>Note</th><th>Asked by</th><th></th></tr></thead><tbody data-pt-list="pd-merges">${rows.map((m) =>
          `<tr data-pt-row tabindex="-1"><td class="is-wrap">${pcell(m.keep)}</td><td class="is-wrap">${pcell(m.other)}</td><td class="is-wrap">${esc(m.note || '')}</td><td>${esc(m.by)} <span class="pt-sub">${esc(fd(String(m.at).slice(0, 10)))}</span></td><td class="is-num"><span class="pt-acts"><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-mdone="${esc(m.id)}">${ic('check')}Merged</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-mnot="${esc(m.id)}">Not the same</button></span></td></tr>`).join('')}</tbody></table></div>`);
  }
  root.innerHTML = `${paneTabs()}<section class="h-card pd-sheet">${body}</section>`;
}
function loadMerges() { api('/api/partners/merges').then((d) => { S.merges = d.merges; if (S.pane === 'merges') paint(); else { const t = $('.pd-panes'); if (t) t.outerHTML = paneTabs(); } }).catch(() => { S.merges = []; }); }

/* ------------------------------------------------------------------ bulk bar */
function bulk() {
  const b = $('#pd-bulk'); if (!b) return;
  const n = S.sel.size;
  if (!n || S.pane !== 'all') { b.classList.remove('is-on'); b.innerHTML = ''; return; }
  b.classList.add('is-on');
  b.innerHTML = `<span class="pd-bulk__n">${N(n)}</span><span>selected</span>
    <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-bulk="tag">${ic('tag')}Add a tag</button>
    <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-bulk="star">${ic('star')}Star</button>
    <button type="button" class="h-btn h-btn--ghost h-btn--sm" data-bulk="export">${ic('down')}Export</button>
    ${n === 2 ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-bulk="merge">${ic('merge')}Ask to merge</button>` : ''}
    <button type="button" class="pd-bulk__x" data-bulk="clear" aria-label="Clear the selection">${ic('x')}</button>`;
}

let tt;
function toast(msg) {
  let t = $('#pd-toast');
  if (!t) { t = document.createElement('div'); t.id = 'pd-toast'; t.className = 'pd-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('is-on'), 4200);
}

/* ------------------------------------------------------------------ actions */
async function star(id, on) {
  const r = S.data && S.data.rows.find((x) => String(x.id) === id);
  if (r) r.star = on;
  const b = $(`[data-star="${CSS.escape(id)}"]`); if (b) { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
  try { await post('/api/partners/stars/' + encodeURIComponent(id), { on }); } catch (e) { toast(e.message); if (r) r.star = !on; paint(); }
}
async function exportCsv(ids) {
  const p = params(S.spec, ids ? { ids: ids.join(',') } : null).toString();
  const res = await fetch('/api/partners/export?' + p, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } });
  if (!res.ok) { toast('The export did not finish. Try again.'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'partners-' + TODAY + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(ids ? `Exported ${N(ids.length)} partners.` : `Exported ${N(Math.min(S.data.total, 25000))} partners.`);
}
function askMerge(a, b) {
  const note = prompt('Ask the Support Team to merge these two records. Add a note for them (which one to keep, why they are the same):', '');
  if (note === null) return;
  post('/api/partners/merge', { keep: a, other: b, note }).then(() => { toast('Sent to the Support Team. It shows under Merge requests.'); S.merges = null; loadMerges(); }).catch((e) => toast(e.message));
}

document.addEventListener('click', (e) => {
  const t = e.target; if (!t.closest || !t.closest('#pd-root, #pd-bulk')) return;
  const d = (sel) => t.closest(sel);
  let x;
  if ((x = d('[data-pane]'))) { S.pane = x.dataset.pane; if (S.pane === 'recent') S.recent = null; if (S.pane === 'dups') S.dups = null; syncUrl(); paint(); return; }
  if ((x = d('[data-kind]'))) { S.spec.kinds = x.dataset.kind ? [x.dataset.kind] : []; changed(); return; }
  if ((x = d('[data-status]'))) { S.spec.status = x.dataset.status ? [x.dataset.status] : []; changed(); return; }
  if ((x = d('[data-unf]'))) {
    const k = x.dataset.unf, v = x.dataset.v;
    if (k === 'all') { S.spec = Object.assign({}, DEF, { sort: S.spec.sort, dir: S.spec.dir }); S.view = ''; }
    else if (k === 'first') { S.spec.firstFrom = ''; S.spec.firstTo = ''; }
    else if (k === 'last') { S.spec.lastFrom = ''; S.spec.lastTo = ''; }
    else if (ARRS.includes(k)) S.spec[k] = S.spec[k].filter((y) => y !== v);
    else S.spec[k] = DEF[k];
    changed(); return;
  }
  if (d('[data-more]')) { S.fopen = !S.fopen; paint(); return; }
  if (d('[data-reload]')) { S.error = ''; load(); return; }
  if (d('[data-export]')) { exportCsv(null); return; }
  if ((x = d('[data-star]'))) { e.preventDefault(); star(x.dataset.star, !x.classList.contains('is-on')); return; }
  if ((x = d('[data-sel]'))) { const id = x.dataset.sel; if (x.checked) S.sel.add(id); else S.sel.delete(id); const tr = x.closest('tr'); if (tr) tr.classList.toggle('is-picked', x.checked); bulk(); return; }
  if ((x = d('[data-selall]'))) { const rows = (S.data && S.data.rows) || []; rows.forEach((r) => (x.checked ? S.sel.add(String(r.id)) : S.sel.delete(String(r.id)))); paint(); return; }
  if ((x = d('[data-view]'))) { const v = (S.views || []).find((y) => y.id === x.dataset.view); if (v) { S.spec = Object.assign({}, DEF, v.spec); if (v.cols && v.cols.length) { HIDDEN = new Set(COLS.map((c) => c.k).filter((k) => !v.cols.includes(k))); try { localStorage.setItem('pt.cols.pd', JSON.stringify([...HIDDEN])); } catch (_) { /* private mode */ } } S.view = v.id; changed(); } return; }
  if ((x = d('[data-viewdel]'))) { if (!confirm('Delete this saved view?')) return; post('/api/partners/views/' + encodeURIComponent(x.dataset.viewdel) + '/delete').then((r) => { S.views = r.views; if (S.view === x.dataset.viewdel) S.view = ''; paint(); }).catch((er) => toast(er.message)); return; }
  if ((x = d('[data-askmerge]'))) { const [a, b] = x.dataset.askmerge.split(','); askMerge(a, b); return; }
  if ((x = d('[data-notsame]'))) { const [a, b] = x.dataset.notsame.split(','); post('/api/partners/merges/decide', { keep: a, other: b, state: 'not_same' }).then(() => { S.dups = S.dups.filter((p) => !(String(p.a.id) === a && String(p.b.id) === b)); paint(); toast('Marked not the same.'); }).catch((er) => toast(er.message)); return; }
  if ((x = d('[data-mdone]')) || (x = d('[data-mnot]'))) { const done = !!x.dataset.mdone; post('/api/partners/merges/decide', { id: x.dataset.mdone || x.dataset.mnot, state: done ? 'done' : 'not_same' }).then((r) => { S.merges = r.merges; paint(); toast(done ? 'Marked merged.' : 'Marked not the same.'); }).catch((er) => toast(er.message)); return; }
  if ((x = d('[data-bulk]'))) {
    const ids = [...S.sel];
    const k = x.dataset.bulk;
    if (k === 'clear') { S.sel.clear(); paint(); return; }
    if (k === 'export') { exportCsv(ids); return; }
    if (k === 'merge') { askMerge(ids[0], ids[1]); return; }
    if (k === 'star') { Promise.all(ids.map((id) => post('/api/partners/stars/' + encodeURIComponent(id), { on: true }))).then(() => { toast(`Starred ${N(ids.length)}.`); load({ quiet: true }); }).catch((er) => toast(er.message)); return; }
    if (k === 'tag') {
      const tag = prompt(`Add a tag to ${ids.length === 1 ? 'this partner' : N(ids.length) + ' partners'}. Tags are FavorOS labels everyone can see and filter by; they do not go to Blackbaud.`, '');
      if (!tag || !tag.trim()) return;
      post('/api/partners/tags', { cids: ids, tag }).then((r) => { if (S.menus) S.menus.tags = r.tags; toast(`Tagged ${N(ids.length)} with ${tag.trim()}.`); paint(); }).catch((er) => toast(er.message));
    }
  }
});
document.addEventListener('submit', (e) => {
  const f = e.target; if (!f.matches || !f.matches('[data-viewsave]')) return;
  e.preventDefault();
  const name = f.elements.name.value.trim(); if (!name) return;
  const cur = (S.views || []).find((v) => v.id === S.view && v.mine && v.name === name);
  post('/api/partners/views', { id: cur ? cur.id : '', name, spec: S.spec, cols: COLS.map((c) => c.k).filter((k) => !HIDDEN.has(k)), scope: f.elements.all.checked ? 'all' : 'private' })
    .then((r) => { S.views = r.views; S.view = r.id; syncUrl(); paint(); toast('View saved.'); }).catch((er) => toast(er.message));
});
document.addEventListener('change', (e) => {
  const t = e.target; if (!t.closest || !t.closest('#pd-root')) return;
  if (t.dataset.f) { const k = t.dataset.f; S.spec[k] = k === 'noContactDays' ? Number(t.value) || 0 : t.value; changed(); return; }
  if (t.dataset.add) { const k = t.dataset.add; if (t.value && !S.spec[k].includes(t.value)) S.spec[k] = S.spec[k].concat(t.value); changed(); return; }
  if (t.dataset.b) { S.spec[t.dataset.b] = t.checked; changed(); }
});
let qt;
document.addEventListener('input', (e) => {
  if (e.target.id !== 'pd-q') return;
  clearTimeout(qt);
  qt = setTimeout(() => { const v = e.target.value.trim(); if (v === S.spec.q) return; S.spec.q = v; changed(); }, 220);
});
document.addEventListener('keydown', (e) => {
  if (!document.body.contains(root) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter' && e.target.id === 'pd-q') { clearTimeout(qt); S.spec.q = e.target.value.trim(); changed(); return; }
  if (e.key !== 's' || /input|textarea|select/i.test(e.target.tagName)) return;
  const row = e.target.closest && e.target.closest('#pd-table tr[data-id]'); if (!row) return;
  e.preventDefault(); const b = $('[data-star]', row); if (b) star(b.dataset.star, !b.classList.contains('is-on'));
});
// Views load the first time the menu opens.
document.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('[data-pd-views]') && e.target.open && S.views == null) api('/api/partners/views').then((d) => { S.views = d.views; const l = $('#pd-views'); if (l) l.innerHTML = viewsHTML(); }).catch(() => { S.views = []; }); }, true);

PT.on('pd', {
  page: (p, size) => { S.page = p; S.size = size; S.sel.clear(); load(); },
  // A new column sorts names and places A to Z and numbers and dates largest or newest first; the same column again flips it.
  sort: (col, dir) => { const fresh = col !== S.spec.sort; S.spec.sort = col; S.spec.dir = fresh ? (['name', 'place', 'holder', 'kind', 'lookup'].includes(col) ? 'asc' : 'desc') : dir; changed(); },
  cols: (set) => { HIDDEN = set || new Set(HIDE_DEFAULT); paint(); },
});

if (window.FavorSheets) {
  window.FavorSheets.register('partners', async () => {
    const ids = [...S.sel];
    const d = await api('/api/partners/export?format=json&' + params(S.spec, ids.length ? { ids: ids.join(',') } : null).toString());
    return window.FavorSheets.screen('Partners', [{ name: 'Partners', columns: d.columns, rows: d.rows }], { filters: chipsText(), classes: ['partner'] });
  });
}
function chipsText() { const el = document.createElement('div'); el.innerHTML = chips(); return $$('.pt-chip', el).map((c) => c.textContent.replace('×', '').trim()).join('; '); }

S.spec = specFromUrl();
paint();
load();
if (window.__hubPartnerTools !== false) loadMerges();
})();
