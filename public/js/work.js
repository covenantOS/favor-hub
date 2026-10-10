/* The Work Center: every open action, the week's contacts to enter, the thank-yous still owed, and Recent with Undo.
   Reads /api/work/* (a copy of Blackbaud, refreshed at 5 AM and 5 PM) and writes through the same routes, which save each change,
   send it to Blackbaud 15 at a time, and check it. Ported from the clickable prototype. */
(() => {
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('wc-root');
if (!root) return;
const QS = new URLSearchParams(location.search);
const AS = QS.get('as') || '';

// ------------------------------------------------------------ talking to the hub
async function api(path, opts = {}) {
  const url = AS ? path + (path.includes('?') ? '&' : '?') + 'as=' + encodeURIComponent(AS) : path;
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.headers || {});
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'signin') {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('Sign in again.');
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || 'Something went wrong. Try again.');
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) });
const patch = (path, body) => api(path, { method: 'PATCH', body: JSON.stringify(body || {}) });

// ------------------------------------------------------------ helpers
let DATA = { me: { role: 'admin', canDelete: true, canMove: true, canEntry: true, anyTeam: true }, people: {}, today: '', synced: '', meter: { used: 0, cap: 3000, lane: 2400, resets: '8:00 PM' }, counts: {} };
let TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const now = () => new Date();
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayn = (iso) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(TODAY + 'T12:00:00Z')) / 86400000);
const fd = (iso, yr) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr || y !== Number(TODAY.slice(0, 4)) ? ', ' + y : ''); };
const addDays = (iso, n) => { const t = new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000); return t.toISOString().slice(0, 10); };
const money = (a) => '$' + (Math.round(a) === a ? a.toLocaleString('en-US') : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const plural = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : (many || one + 's'));
const et = (iso, o) => new Date(iso).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
const clock = () => et(now(), { hour: 'numeric', minute: '2-digit' });
const P = (fid) => (DATA.people[fid] || { n: 'Fundraiser ' + fid, team: '', active: 0, listed: 0 });
const first = (fid) => P(fid).n.split(' ')[0];
const ini = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const live = (fid) => { const p = DATA.people[fid]; return !!(p && p.active && p.listed); };
// how a name reads when that person can no longer own work: left Favor, or never set up as a fundraiser
// Only an admin hands work to another team. Everyone else picks from their own team and the directors they support; the server enforces it.
const mayAssign = (fid) => { const m = DATA.me; return !!m.anyTeam || fid === m.fid || (m.fids || []).includes(fid) || (!!m.team && P(fid).team === m.team); };
const gone = (fid) => { if (live(fid)) return ''; const p = DATA.people[fid]; return p && (p.listed || p.left) ? ' (left)' : ' (inactive)'; };
const I = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  letter: '<path d="M4 4h16v16H4z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/>', meet: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/><path d="M15.5 14.5c2.6 0 4.6 1.6 5.5 4.5"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>', clip: '<path d="M8 4h8v3H8z"/><path d="M6 6h12v15H6z"/><path d="M9 11h6"/><path d="M9 15h4"/>',
  paste: '<path d="M9 4h6v3H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="M9 12h6"/><path d="M9 16h4"/>', many: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2.5 20c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><path d="M13 16c.9-.4 1.9-.5 3-.5 2.5 0 4.7 1.5 5.5 4.5"/>',
  filter: '<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', swap: '<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const ic = (n, cls) => `<svg class="h-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ''}</svg>`;
const CAT_IC = { 'Phone call': 'phone', Email: 'mail', Mailing: 'letter', Meeting: 'meet', 'Task/Other': 'task' };

// ------------------------------------------------------------ state
let ACTS = [];
let BYID = {};
const S = {
  view: 'open', sel: new Set(), anchor: null, list: [],
  f: { fr: '', type: '', cat: '', due: '', q: '', cid: '', theirs: false, quick: '' }, sort: 'due', dir: -1, shown: 100,
  gone: {}, ov: {}, saving: {}, queued: {}, back: {},
  batches: [], gate: null, loaded: false, error: '', running: null,
  in: { rdd: '', lane: 'wait', paste: false, data: null, loading: false, ta: {} },
  ty: { owner: '' }, st: { lane: 'left' },
};

// A row from /api/work/board in the shape the lists below use.
function adapt(r) {
  return {
    id: r.id, due: r.due, add: r.added, type: r.type, cat: r.category, sum: r.summary, desc: r.description, cid: r.cid, p: r.partner, loc: r.place, lk: r.lookup,
    f: r.fundraisers || [], dec: r.deceased ? 1 : 0, ty: r.ty ? 1 : 0, ctg: r.ctg ? 1 : 0, pri: r.priority,
    gift: r.gift ? { id: r.gift.id, a: r.gift.amount, d: r.gift.date, fund: r.gift.fund } : null,
    later: r.later ? { id: r.later.id, d: r.later.date, by: r.later.by || [], s: r.later.summary, cat: r.later.category, k: r.later.strength === 'thanked' ? 's' : 'l' } : null,
    hold: r.holders || [], grp: r.group, pending: r.pending || null, reopened: !!r.reopened,
  };
}
function takeBoard(d) {
  DATA = Object.assign({}, DATA, { me: d.me || DATA.me, people: d.people, today: d.today, synced: d.synced, meter: d.meter, counts: d.counts, orphans: d.orphans });
  TODAY = d.today;
  ACTS = d.rows.map(adapt);
  BYID = Object.fromEntries(ACTS.map((a) => [a.id, a]));
  S.gone = {}; S.ov = {}; S.back = {};
  S.sel = new Set([...S.sel].filter((id) => BYID[id] || (S.in.data && S.in.data.rows.some((r) => r.id === id))));
}

// ------------------------------------------------------------ derived
function pendingOf(a) { return a.pending && a.pending.state === 'saving' ? 'saving' : ''; }
function queuedOf(a) { return a.pending && a.pending.state === 'queued' ? a.pending.label : ''; }
function isOpenNow(a) { return !S.gone[a.id]; }
function cur(a) { const o = S.ov[a.id] || {}; return { due: o.due || a.due, f: o.f || a.f }; }
function lateClass(due) { const n = dayn(due); if (n > 0) return ['ok', 'Due in ' + plural(n, 'day')]; if (n === 0) return ['soon', 'Due today']; if (n >= -7) return ['soon', -n + (n === -1 ? ' day late' : ' days late')]; if (n <= -365) return ['old', Math.floor(-n / 365) + (n <= -730 ? ' years late' : ' year late')]; return ['', -n + ' days late']; }
function hasDeparted(a) { return cur(a).f.some((x) => !live(x)); }
const LANES = [
  { k: 'left', n: 'Owner left or inactive', hint: 'Someone on it left Favor or is not set up as a fundraiser. Give it to the partner\'s current holder.', test: (a) => hasDeparted(a) },
  { k: 'none', n: 'No owner', hint: 'Blackbaud shows these to nobody.', test: (a) => cur(a).f.length === 0 },
  { k: 'year', n: 'A year late or more', hint: 'More than a year past due.', test: (a) => dayn(cur(a).due) <= -365 },
  { k: '90', n: '90 days to a year', hint: 'Close as no longer needed, or reschedule.', test: (a) => dayn(cur(a).due) < -90 && dayn(cur(a).due) > -365 },
  { k: '30', n: '30 to 90 days late', hint: 'Still counted. Check before closing.', test: (a) => dayn(cur(a).due) < -30 && dayn(cur(a).due) >= -90 },
  { k: 'ctg', n: 'Recurring Gift tasks', hint: 'Made by a Blackbaud workflow for every new recurring gift.', test: (a) => a.ctg },
];
function matches(a, f, skip) {
  if (!isOpenNow(a)) return false;
  const c = cur(a);
  if (f.fr && skip !== 'fr') {
    if (f.fr === '_none') { if (c.f.length) return false; }
    else if (!c.f.includes(f.fr) && !(f.theirs && a.hold.includes(f.fr))) return false;
  }
  if (f.type && skip !== 'type' && a.type !== f.type) return false;
  if (f.cat && skip !== 'cat' && a.cat !== f.cat) return false;
  if (f.cid && a.cid !== f.cid) return false;
  if (f.due && skip !== 'due') {
    const n = dayn(c.due);
    if (f.due === 'past' && !(n < 0)) return false;
    if (f.due === 'today' && n !== 0) return false;
    if (f.due === 'week' && !(n >= 0 && n <= 7)) return false;
    if (f.due === 'l30' && !(n < -30)) return false;
    if (f.due === 'l90' && !(n < -90)) return false;
    if (f.due === 'l365' && !(n <= -365)) return false;
  }
  if (f.quick === 'ty' && !a.ty) return false;
  if (f.quick === 'done' && !(a.ty && a.later)) return false;
  if (f.quick === 'ctg' && !a.ctg) return false;
  if (f.quick === 'past' && !(dayn(c.due) < 0)) return false;
  if (f.q) {
    const q = norm(f.q);
    const hay = norm(a.p + ' ' + a.sum + ' ' + a.desc + ' ' + a.id + ' ' + (a.lk || '') + ' ' + c.f.map((x) => P(x).n).join(' '));
    if (!q.split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}
function sorted(list) {
  const by = S.sort;
  const k = (a) => by === 'partner' ? a.p.toLowerCase() : by === 'added' ? a.add : by === 'fr' ? (cur(a).f.map((x) => P(x).n).join() || '~') : cur(a).due;
  return list.slice().sort((x, y) => (k(x) < k(y) ? -1 : k(x) > k(y) ? 1 : x.id - y.id) * S.dir);
}
function meterUsed() { return DATA.meter.used || 0; }
function meterHTML() {
  const used = meterUsed();
  const pct = Math.min(100, Math.round(used / DATA.meter.cap * 100));
  return `<span class="wc-pill wc-meter${used >= 2200 ? ' is-high' : ''}" title="Favor's upkeep may make 3,000 Blackbaud calls a day, and the Work Center uses up to 2,400 of them. The giving form shares the same Blackbaud account, so the hub stays well under the limit. The count starts again at ${esc(DATA.meter.resets)}.">Blackbaud today <b>${used.toLocaleString()}</b> of 3,000<span class="wc-meter__bar"><i style="width:${Math.max(2, pct)}%"></i></span></span>`;
}
const syncedLabel = () => DATA.synced ? et(DATA.synced, { hour: 'numeric', minute: '2-digit' }) : 'a recent sync';

// ------------------------------------------------------------ page
function gateScreen(g) {
  const before = g.reason === 'before_release';
  root.innerHTML = `<div class="h-card wc-gate"><div class="wc-batch__icon">${ic('lock')}</div><h2>${before ? 'The Work Center opens for you soon' : 'The Work Center is for the people whose job touches it'}</h2>
    <p>${before ? 'This page is not open for your account yet.' : 'It holds the open actions, thank-yous and partner work of the Support Team, the regional directors, Partner Care and church engagement. If your work needs it, tell Will Hamilton through Feedback.'}</p></div>`;
}
function skeleton() {
  root.innerHTML = `<div class="wc-intro"><p>Every open action in Blackbaud, the week's contacts to enter, and the thank-yous still owed, in one place. Pick as many as you need and finish them together.</p></div>
    <div id="view"><section class="h-card wc-sheet" id="wc-board" aria-busy="true" aria-label="Open actions"><div class="h-skel" style="height:360px;border-radius:18px"></div></section></div>`;
}
function errorScreen(msg) {
  root.innerHTML = `<div class="h-card wc-gate"><div class="wc-batch__icon">${ic('alert')}</div><h2>The list did not load</h2><p>${esc(msg)}</p>
    <p><button class="h-btn h-btn--primary" data-reload>Try again</button></p></div>`;
}
function entryWaiting() {
  const d = S.in.data; if (!d) return Number(DATA.entryWaiting) || 0;
  return d.owners.reduce((n, o) => n + o.wait + o.late, 0);
}
function page() {
  const g = S.gate || {};
  const main = root;
  hideBar();
  const openN = ACTS.filter(isOpenNow).length;
  const intakeWait = entryWaiting();
  const tyN = tyGroups('').length;
  const staleN = ACTS.filter((a) => isOpenNow(a) && LANES.some((l) => l.test(a))).length;
  main.innerHTML = `
    <div class="wc-intro">
      <p>Every open action in Blackbaud, the week's contacts to enter, and the thank-yous still owed, in one place. Pick as many as you need and finish them together.</p>
      <div class="wc-chips">
        ${g.admin && g.release === 'admins' ? '<span class="wc-pill wc-pill--gold" title="Only admins see this page.">' + ic('lock') + 'Admins only</span>' : ''}
        <span class="wc-pill" title="The hub reads a copy of Blackbaud that refreshes at 5 AM and 5 PM. What you do here shows at once."><i class="dot"></i>Blackbaud copy from ${esc(syncedLabel())}</span>
        ${meterHTML()}
        ${g.admin ? `<button type="button" class="wc-pill wc-pill--btn" data-settings aria-label="Work Center settings">${ic('gear')}Settings</button>` : ''}
      </div>
    </div>
    <div class="wc-tabs" role="tablist" aria-label="Work Center">
      ${withExtraTabs([['open', 'Open actions', openN], ['intake', 'Entry', intakeWait], ['ty', 'Thank-yous', tyN], ['stale', 'Stale', staleN], ['opps', 'Opportunities', window.WCEdit ? window.WCEdit.oppCount() : ''], ['recent', 'Recent', S.batches.length]].filter(([k]) => k !== 'intake' || DATA.me.canEntry)).map(([k, l, n]) =>
        `<button class="wc-tab${S.view === k ? ' is-on' : ''}" role="tab" aria-selected="${S.view === k}" data-view="${k}">${l}${n !== '' && (n || k !== 'recent') ? `<span>${n}</span>` : ''}</button>`).join('')}
    </div>
    <div id="view"></div>`;
  Object.assign({ open: viewOpen, intake: viewIntake, ty: viewTy, stale: viewStale, recent: viewRecent, opps: () => window.WCEdit && window.WCEdit.viewOpps() }, extraViews())[S.view]();
}
// Tabs other files add (window.WCX = [{ k, label, after, count(), show(), view() }]): My partners and any later tab. They sit after the tab named in `after`.
function extraTabs() { return (window.WCX || []).filter((t) => !t.show || t.show(DATA.me)); }
function extraViews() { return Object.fromEntries((window.WCX || []).map((t) => [t.k, t.view])); }
function withExtraTabs(base) {
  const out = base.slice();
  for (const t of extraTabs()) { const at = out.findIndex((x) => x[0] === t.after); out.splice(at < 0 ? out.length : at + 1, 0, [t.k, t.label, t.count ? t.count() : '']); }
  return out;
}

// ------------------------------------------------------------ the shared action table
function rowHTML(a) {
  const c = cur(a);
  const [lc, ll] = lateClass(c.due);
  const picked = S.sel.has(a.id);
  const saving = S.saving[a.id] || pendingOf(a);
  const queued = S.queued[a.id] || queuedOf(a);
  const back = S.back[a.id] || a.reopened;
  const tags = [];
  if (saving === 'saving') tags.push('<span class="wc-tag wc-tag--saving">Saving</span>');
  if (saving === 'failed') tags.push('<span class="wc-tag wc-tag--warn">Blackbaud did not answer. Select it and try again.</span>');
  if (queued) tags.push(`<span class="wc-tag wc-tag--queued">${ic('clock')}${esc(queued)}</span>`);
  if (back) tags.push('<span class="wc-tag wc-tag--maybe" title="Someone opened this action again in Blackbaud after it was closed.">Reopened</span>');
  if (a.gift && (a.ty || a.ctg)) tags.push(`<span class="wc-tag wc-tag--gift" title="The gift this task is about">${money(a.gift.a)} on ${fd(a.gift.d)}</span>`);
  if (a.ty && a.later) tags.push(a.later.k === 's'
    ? `<span class="wc-tag wc-tag--done" title="${esc(a.later.s)}">Thanked ${fd(a.later.d)}</span>`
    : `<span class="wc-tag wc-tag--maybe" title="${esc(a.later.s)}">Contact ${fd(a.later.d)}, maybe done</span>`);
  if (a.grp) tags.push(`<span class="wc-tag" title="Another open task is about the same gift">${a.grp.length} tasks, one gift</span>`);
  if (a.dec) tags.push('<span class="wc-tag wc-tag--warn">Deceased</span>');
  const who = c.f.length ? c.f.map((x) => `<span class="${live(x) ? '' : 'left'}" title="${live(x) ? esc(P(x).team) : 'Left Favor or not set up as a fundraiser'}">${esc(P(x).n)}${gone(x)}</span>`).join('') : '<span class="none">No one</span>';
  const theirs = S.f.fr && S.f.theirs && !c.f.includes(S.f.fr) && a.hold.includes(S.f.fr);
  const disabled = saving === 'saving' || queued;
  return `<div class="wc-row${picked ? ' is-picked' : ''}${saving === 'saving' ? ' is-saving' : ''}${back ? ' is-back' : ''}" role="row" tabindex="-1" data-id="${a.id}" aria-selected="${picked}">
    <div class="wc-cb" data-cb><input type="checkbox" ${picked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Select ${esc(a.p)}, ${esc(a.sum || a.type)}" tabindex="-1" /></div>
    <div class="wc-due"><button type="button" class="wc-inl" data-inl="due" data-id="${a.id}" title="Change the date"><b>${fd(c.due)}</b><span class="wc-late ${lc ? 'wc-late--' + lc : ''}">${ll}</span></button></div>
    <div class="wc-partner"><a class="wc-plink" href="/work/partner/${esc(a.cid)}" data-partner-id="${esc(a.cid)}">${esc(a.p)}</a><span class="wc-sub">${esc(a.loc || 'No city on file')}${a.lk ? ' · ' + esc(a.lk) : ''}</span></div>
    <div class="wc-type"><b>${esc(a.type)}</b><span class="wc-cat">${ic(CAT_IC[a.cat] || 'task')}${esc(a.cat)}<button type="button" class="wc-inl wc-st" data-inl="status" data-id="${a.id}" title="Change the status">Open</button></span></div>
    <div class="wc-what"><button type="button" class="wc-open${a.sum ? '' : ' is-empty'}" data-open="${a.id}" title="${esc(a.desc)}">${esc(a.sum || (a.desc ? a.desc.slice(0, 80) : 'No summary'))}</button>${tags.length ? `<div class="wc-tags">${tags.join('')}</div>` : ''}</div>
    <div class="wc-who"><button type="button" class="wc-inl wc-inl--who" data-inl="who" data-id="${a.id}" title="Change who it belongs to">${who}</button>${theirs ? '<span class="wc-sub">On ' + esc(first(S.f.fr)) + '\'s partner</span>' : ''}</div>
    <div class="wc-added">${fd(a.add)}</div>
  </div>`;
}
function tableHTML(list, total, idp) {
  const shown = list.slice(0, S.shown);
  const allOn = shown.length && shown.every((a) => S.sel.has(a.id));
  const sb = (k, l) => `<button type="button" class="sort${S.sort === k ? ' is-on' : ''}" data-sort="${k}">${l}${S.sort === k ? (S.dir < 0 ? ' ↓' : ' ↑') : ''}</button>`;
  return `<div class="wc-selbanner" id="${idp}-banner"></div>
  <div class="wc-scroll" id="${idp}-scroll" role="grid" aria-multiselectable="true" aria-rowcount="${list.length}">
    <div class="wc-head wc-grid" role="row"><div class="wc-cb" data-cball><input type="checkbox" ${allOn ? 'checked' : ''} aria-label="Select every action shown" /></div>${sb('due', 'Due')}${sb('partner', 'Partner')}<span>Type</span><span>Summary</span>${sb('fr', 'Fundraiser')}${sb('added', 'Added')}</div>
    <div class="wc-grid" id="${idp}-rows">${shown.length ? shown.map((a) => rowHTML(a)).join('') : `<div class="wc-empty"><b>Nothing matches</b>Change a filter or clear them all.</div>`}</div>
    ${list.length > S.shown ? `<div class="wc-more"><button class="h-btn h-btn--ghost h-btn--sm" data-more>Show ${Math.min(100, list.length - S.shown)} more of ${list.length - S.shown}</button></div>` : ''}
  </div>
  <div class="wc-foot"><span>${list.length === total ? plural(total, 'open action') : `${list.length.toLocaleString()} of ${plural(total, 'open action')} match`}</span>
    <span class="wc-keys"><span><kbd>Shift</kbd>click a range</span><span><kbd>Space</kbd>select</span><span><kbd>Ctrl</kbd><kbd>A</kbd>all that match</span><span><kbd>Esc</kbd>clear</span></span></div>`;
}
function afterTable(idp, list) {
  const all = $(`#${idp}-scroll [data-cball] input`);
  if (all) { const shown = list.slice(0, S.shown); const n = shown.filter((a) => S.sel.has(a.id)).length; all.indeterminate = n > 0 && n < shown.length; }
  banner(idp, list);
}
function banner(idp, list) {
  const b = $(`#${idp}-banner`); if (!b) return;
  const shown = list.slice(0, S.shown);
  const allShown = shown.length && shown.every((a) => S.sel.has(a.id));
  const allList = list.length && list.every((a) => S.sel.has(a.id));
  if (allShown && list.length > shown.length && !allList) {
    b.innerHTML = `All ${shown.length} shown are selected. <button type="button" data-allmatch>Select all ${list.length} that match</button>`; b.classList.add('is-on');
  } else if (allList && list.length > 1 && S.sel.size >= list.length && list.length > shown.length) {
    b.innerHTML = `All ${list.length} that match are selected, including ${list.length - shown.length} below. <button type="button" data-clearsel>Clear</button>`; b.classList.add('is-on');
  } else { b.classList.remove('is-on'); b.innerHTML = ''; }
}

// ------------------------------------------------------------ open actions view
function viewOpen() {
  const f = S.f;
  const base = ACTS.filter(isOpenNow);
  const list = sorted(base.filter((a) => matches(a, f)));
  S.list = list.map((a) => a.id);
  const cnt = (fn) => base.filter(fn).length;
  const stats = [
    ['', 'Open', base.length], ['past', 'Past due', cnt((a) => dayn(cur(a).due) < 0)], ['ty', 'Thank-you tasks', cnt((a) => a.ty)],
    ['done', 'Thanked already or likely', cnt((a) => a.ty && a.later)], ['ctg', 'Recurring Gift tasks', cnt((a) => a.ctg)],
  ];
  // option counts respect the other filters
  const frCount = {}; base.filter((a) => matches(a, f, 'fr')).forEach((a) => { const c = cur(a).f; if (!c.length) frCount._none = (frCount._none || 0) + 1; c.forEach((x) => { frCount[x] = (frCount[x] || 0) + 1; }); });
  const frs = Object.keys(frCount).filter((k) => k !== '_none').sort((a, b) => (live(b) - live(a)) || P(a).n.localeCompare(P(b).n));
  const typeCount = {}; base.filter((a) => matches(a, f, 'type')).forEach((a) => { typeCount[a.type] = (typeCount[a.type] || 0) + 1; });
  const catCount = {}; base.filter((a) => matches(a, f, 'cat')).forEach((a) => { catCount[a.cat] = (catCount[a.cat] || 0) + 1; });
  const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
  const frOpts = opt('', 'Every fundraiser', !f.fr) +
    `<optgroup label="Working at Favor">${frs.filter(live).map((k) => opt(k, `${P(k).n} (${frCount[k]})`, f.fr === k)).join('')}</optgroup>` +
    `<optgroup label="Left Favor or not set up">${frs.filter((k) => !live(k)).map((k) => opt(k, `${P(k).n} (${frCount[k]})`, f.fr === k)).join('')}</optgroup>` +
    (frCount._none ? opt('_none', `No fundraiser (${frCount._none})`, f.fr === '_none') : '');
  const typeOpts = opt('', 'Every type', !f.type) + Object.keys(typeCount).sort((a, b) => typeCount[b] - typeCount[a]).map((k) => opt(k, `${k} (${typeCount[k]})`, f.type === k)).join('');
  const catOpts = opt('', 'Every category', !f.cat) + Object.keys(catCount).sort().map((k) => opt(k, `${k} (${catCount[k]})`, f.cat === k)).join('');
  const DUES = [['', 'Any due date'], ['past', 'Past due'], ['today', 'Due today'], ['week', 'Due in the next 7 days'], ['l30', 'More than 30 days late'], ['l90', 'More than 90 days late'], ['l365', 'A year late or more']];
  const dueOpts = DUES.map(([v, l]) => opt(v, l, f.due === v)).join('');
  const chips = [];
  if (f.cid) { const a = ACTS.find((x) => x.cid === f.cid); chips.push(['cid', 'Partner: ' + (a ? a.p : f.cid)]); }
  if (f.fr) chips.push(['fr', f.fr === '_none' ? 'No fundraiser' : 'Fundraiser: ' + P(f.fr).n + (f.theirs ? ', with their partners' : '')]);
  if (f.type) chips.push(['type', 'Type: ' + f.type]);
  if (f.cat) chips.push(['cat', 'Category: ' + f.cat]);
  if (f.due) chips.push(['due', DUES.find((d) => d[0] === f.due)[1]]);
  if (f.quick) chips.push(['quick', stats.find((s) => s[0] === f.quick)[1]]);
  if (f.q) chips.push(['q', 'Search: ' + f.q]);
  $('#view').innerHTML = `
    <div class="h-card wc-band">${stats.map(([k, l, n]) => `<button type="button" class="wc-stat${f.quick === k && (k || !f.quick) ? ' is-on' : ''}" data-quick="${k}"><b data-countup="${n}">${n}</b><span>${l}</span></button>`).join('')}</div>
    <section class="h-card wc-sheet" id="wc-board" aria-label="Open actions">
      <div class="wc-filters" id="filters">
        <div class="wc-sheettitle"><b>Filters</b><button class="wc-dlg__x" data-closefilters aria-label="Close filters">${ic('x')}</button></div>
        <label class="wc-find">${ic('search')}<span class="sr-only">Find a partner or summary</span><input id="q" type="search" placeholder="Find a partner, summary or id" value="${esc(f.q)}" autocomplete="off" /></label>
        <select class="wc-sel${f.fr ? ' is-set' : ''}" data-f="fr" aria-label="Fundraiser">${frOpts}</select>
        ${f.fr && f.fr !== '_none' ? `<label class="wc-toggle" title="Blackbaud's Work Center also lists other people's open actions on the partners this fundraiser holds"><input type="checkbox" data-theirs ${f.theirs ? 'checked' : ''} />Include their partners</label>` : ''}
        <select class="wc-sel${f.type ? ' is-set' : ''}" data-f="type" aria-label="Type">${typeOpts}</select>
        <select class="wc-sel${f.cat ? ' is-set' : ''}" data-f="cat" aria-label="Category">${catOpts}</select>
        <select class="wc-sel${f.due ? ' is-set' : ''}" data-f="due" aria-label="Due">${dueOpts}</select>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm wc-phonly" data-cball>Select all</button>
        <button type="button" class="h-btn h-btn--ghost h-btn--sm wc-filterbtn" data-openfilters>${ic('filter')}Filters${chips.filter((c) => c[0] !== 'q').length ? ' (' + chips.filter((c) => c[0] !== 'q').length + ')' : ''}</button>
      </div>
      <div class="wc-tools2" id="wc-tools2"></div>
      <div class="wc-active">${chips.map(([k, l]) => `<button type="button" class="wc-fchip" data-unf="${k}">${esc(l)}<i aria-label="Remove">×</i></button>`).join('')}${chips.length > 1 ? '<button type="button" class="wc-clear" data-unf="all">Clear all</button>' : ''}</div>
      ${tableHTML(list, base.length, 'o')}
    </section>`;
  afterTable('o', list);
  countUp();
  bar();
  if (window.WCEdit) window.WCEdit.afterOpen('o');
}

// ------------------------------------------------------------ selection (shared by every list)
function curList() { return S.list; }
function setSel(id, on) { if (on) S.sel.add(id); else S.sel.delete(id); }
function inRow(id) { return S.in.data ? S.in.data.rows.find((x) => x.id === id) : null; }
function selectable(id) {
  if (S.view === 'intake') { const r = inRow(id); return !!r && !['dup', 'posted', 'saving'].includes(rowState(r).k); }
  const a = BYID[id];
  if (a) return !(S.saving[id] === 'saving' || S.queued[id] || pendingOf(a) || queuedOf(a));
  return true;
}
function refreshSel() {
  $$('#view .wc-row[data-id]').forEach((r) => {
    const on = S.sel.has(r.dataset.id); r.classList.toggle('is-picked', on); r.setAttribute('aria-selected', on);
    const cb = $('input', r); if (cb) cb.checked = on;
  });
  if (S.view === 'open' || S.view === 'stale') { const list = S.list.map((id) => BYID[id]); afterTable(S.view === 'open' ? 'o' : 's', list); const all = $('#view [data-cball] input'); if (all) { const shown = list.slice(0, S.shown); all.checked = shown.length > 0 && shown.every((a) => S.sel.has(a.id)); all.indeterminate = !all.checked && shown.some((a) => S.sel.has(a.id)); } }
  if (S.view === 'ty' || S.view === 'intake') {
    const all = $('#view .wc-head [data-cball] input');
    if (all) { const ids = S.list.filter(selectable); const n = ids.filter((i) => S.sel.has(i)).length; all.checked = ids.length > 0 && n === ids.length; all.indeterminate = n > 0 && n < ids.length; }
  }
  bar();
}
function rangeTo(id) {
  const L = curList(); const a = L.indexOf(S.anchor), b = L.indexOf(id);
  if (a < 0 || b < 0) { setSel(id, !S.sel.has(id)); S.anchor = id; return; }
  const on = S.sel.has(S.anchor);
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (selectable(L[i]) && isVisible(L[i])) setSel(L[i], on);
}
// Select all leaves out stale tasks tied to a gift of $1,000 or more; those are picked by hand
function bulkable(id) { return selectable(id) && !(S.view === 'stale' && BYID[id] && BYID[id].gift && BYID[id].gift.a >= 1000); }
function isVisible(id) { return !!$(`#view .wc-row[data-id="${CSS.escape(id)}"]`); }

// pointer: click, shift-click range, ctrl-click, drag down the checkbox column to paint
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const cb = e.target.closest('#view .wc-row[data-id] [data-cb]');
  if (!cb || e.button !== 0) return;
  const row = cb.closest('.wc-row'); const id = row.dataset.id;
  if (!selectable(id)) return;
  e.preventDefault();
  if (e.shiftKey && S.anchor) { rangeTo(id); refreshSel(); row.focus({ preventScroll: true }); return; }
  const on = !S.sel.has(id); setSel(id, on); S.anchor = id;
  drag = { on, moved: false, pointerType: e.pointerType };
  document.body.classList.add('wc-dragging');
  refreshSel(); row.focus({ preventScroll: true });
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  // near the top or bottom edge of the list box, scroll it so a long drag keeps going
  const box = $('#view .wc-scroll');
  if (box && box.scrollHeight > box.clientHeight) { const r = box.getBoundingClientRect(); if (e.clientY > r.bottom - 36) box.scrollTop += 18; else if (e.clientY < r.top + 70) box.scrollTop -= 18; }
  const el = document.elementFromPoint(e.clientX, e.clientY); const row = el && el.closest('#view .wc-row[data-id]');
  if (row && selectable(row.dataset.id) && S.sel.has(row.dataset.id) !== drag.on) { setSel(row.dataset.id, drag.on); drag.moved = true; refreshSel(); }
});
document.addEventListener('pointerup', () => { if (drag) { drag = null; document.body.classList.remove('wc-dragging'); } });
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t.closest('#wc-root')) return;
  if (t.closest('[data-cb]')) { e.preventDefault(); return; }
  const row = t.closest('#view .wc-row[data-id]');
  if (row && !t.closest('button, a, input, select, textarea, label')) {
    const id = row.dataset.id; if (!selectable(id)) return;
    if (e.shiftKey && S.anchor) rangeTo(id); else { setSel(id, !S.sel.has(id)); S.anchor = id; }
    window.getSelection().removeAllRanges();
    refreshSel(); row.focus({ preventScroll: true }); return;
  }
  const all = t.closest('[data-cball]');
  if (all) { e.preventDefault(); const list = S.list.slice(0, S.shown).filter(bulkable).filter(isVisible); const on = !list.every((id) => S.sel.has(id)); list.forEach((id) => setSel(id, on)); refreshSel(); return; }
  if (t.closest('[data-allmatch]')) { S.list.filter(bulkable).forEach((id) => S.sel.add(id)); refreshSel(); return; }
  if (t.closest('[data-clearsel]')) { clearSel(); return; }
});
document.addEventListener('mousedown', (e) => { if (e.shiftKey && e.target.closest('#view .wc-row')) e.preventDefault(); });
document.addEventListener('keydown', (e) => {
  if (!document.body.contains(root)) return;
  if (e.key === 'Escape') { if (closeLayer()) return; if ($('#filters.is-sheet')) { $('#filters').classList.remove('is-sheet'); return; } if (S.sel.size) { clearSel(); return; } }
  const row = e.target.closest && e.target.closest('#view .wc-row[data-id]');
  const inGrid = e.target.closest && e.target.closest('#view [role=grid], #view .wc-grid, #view .wc-tg');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && inGrid && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); S.list.filter(bulkable).forEach((id) => S.sel.add(id)); refreshSel(); return; }
  if (!row || /input|textarea|select/i.test(e.target.tagName)) return;
  const rows = $$('#view .wc-row[data-id]'); const i = rows.indexOf(row);
  if (e.key === ' ' || e.key === 'x') { e.preventDefault(); if (e.shiftKey && S.anchor) rangeTo(row.dataset.id); else if (selectable(row.dataset.id)) { setSel(row.dataset.id, !S.sel.has(row.dataset.id)); S.anchor = row.dataset.id; } refreshSel(); }
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); const n = rows[i + 1]; if (n) { n.focus(); if (e.shiftKey && selectable(n.dataset.id)) { setSel(n.dataset.id, true); refreshSel(); } } }
  if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); const n = rows[i - 1]; if (n) { n.focus(); if (e.shiftKey && selectable(n.dataset.id)) { setSel(n.dataset.id, true); refreshSel(); } } }
  if (e.key === 'Enter' && BYID[row.dataset.id]) { e.preventDefault(); drawer(row.dataset.id); }
});
document.addEventListener('focusin', (e) => { const r = e.target.closest && e.target.closest('#view .wc-row[data-id]'); if (r) { $$('#view .wc-row[tabindex="0"]').forEach((x) => { if (x !== r) x.tabIndex = -1; }); r.tabIndex = 0; } });
function clearSel() { S.sel.clear(); S.anchor = null; refreshSel(); }

// ------------------------------------------------------------ the bar
function hideBar() { $('#bar').classList.remove('is-on', 'is-busy'); }
function bar(busy) {
  const b = $('#bar');
  if (busy) { b.className = 'wc-bar is-on is-busy'; b.innerHTML = `<span class="wc-bar__prog"><span id="prog-l">${esc(busy)}</span><span class="wc-bar__track"><i id="prog-i" style="width:4%"></i></span></span>`; return; }
  if (S.view === 'intake') { introBar(); return; }
  if (S.view === 'ty') { tyBar(); return; }
  const ids = [...S.sel].filter((id) => BYID[id]);
  if (!ids.length || S.view === 'recent' || S.view === 'opps') { b.classList.remove('is-on', 'is-busy'); return; }
  const tyN = ids.filter((id) => BYID[id].ty).length;
  b.className = 'wc-bar is-on';
  b.innerHTML = `<span class="wc-bar__n">${ids.length}</span><span class="wc-bar__l">selected${tyN ? ` · ${tyN} thank-you` : ''}</span>
    <span class="wc-bar__acts"><button class="h-btn h-btn--primary h-btn--sm" data-do="complete">${ic('check')}Mark complete</button>
    <button class="h-btn h-btn--ghost h-btn--sm" data-do="reassign">${ic('user')}Reassign</button>
    <button class="h-btn h-btn--ghost h-btn--sm" data-do="reschedule">${ic('cal')}Reschedule</button>
    <button class="h-btn h-btn--ghost h-btn--sm" data-do="bulkedit" title="Change any field on every selected action">${ic('filter')}Edit</button>
    ${DATA.me.canDelete ? `<button class="h-btn h-btn--ghost h-btn--sm wc-bar__del" data-do="delete" title="Delete the selected actions">${ic('x')}Delete</button>` : ''}</span>
    <button class="wc-bar__x" data-do="clear" aria-label="Clear the selection" title="Clear (Esc)">${ic('x')}</button>`;
}
function tyBar() {
  const b = $('#bar');
  const ks = [...S.sel].filter((k) => S.tyMap && S.tyMap[k]);
  if (!ks.length) { b.classList.remove('is-on', 'is-busy'); return; }
  S.tyMode = ks.every((k) => S.tyMap[k].later) ? 'close' : 'mark';
  const n = tyIds(ks).length;
  b.className = 'wc-bar is-on';
  b.innerHTML = `<span class="wc-bar__n">${ks.length}</span><span class="wc-bar__l">selected${n !== ks.length ? ` · ${n} tasks` : ''}</span><span class="wc-bar__acts"><button class="h-btn h-btn--primary h-btn--sm" data-do="complete">${ic('check')}${S.tyMode === 'close' ? 'Close as thanked' : 'Mark thanked'}</button><button class="h-btn h-btn--ghost h-btn--sm" data-do="reassign">${ic('user')}Reassign</button><button class="h-btn h-btn--ghost h-btn--sm" data-do="reschedule">${ic('cal')}Reschedule</button></span><button class="wc-bar__x" data-do="clear" aria-label="Clear the selection">${ic('x')}</button>`;
}
function introBar() {
  const b = $('#bar');
  const rs = visibleIntake().filter((r) => S.sel.has(r.id));
  const ready = rs.filter((r) => rowState(r).k === 'ready');
  if (!rs.length) { b.classList.remove('is-on', 'is-busy'); return; }
  const calls = estCreate(ready);
  b.className = 'wc-bar is-on';
  b.innerHTML = `<span class="wc-bar__n">${rs.length}</span><span class="wc-bar__l">selected · ${ready.length} ready</span>
    <span class="wc-bar__acts"><button class="h-btn h-btn--primary h-btn--sm" data-do="post" ${ready.length ? '' : 'disabled'}>${ic('check')}Enter ${ready.length} in Blackbaud</button>
    <button class="h-btn h-btn--ghost h-btn--sm" data-do="setdate">${ic('cal')}Set date</button>
    <button class="h-btn h-btn--ghost h-btn--sm" data-do="skip">${ic('x')}Skip</button></span>
    <button class="wc-bar__x" data-do="clear" aria-label="Clear the selection">${ic('x')}</button>`;
  b.title = `About ${calls} Blackbaud calls`;
}

// ------------------------------------------------------------ layers (dialogs, drawer)
function closeLayer() {
  const l = $('#layer'); if (!l.innerHTML) return false;
  $$('.wc-dlg, .wc-drawer, .wc-scrim', l).forEach((x) => x.classList.remove('is-on'));
  setTimeout(() => { l.innerHTML = ''; }, 220);
  if (S.retFocus) { try { S.retFocus.focus(); } catch (_) {} S.retFocus = null; }
  return true;
}
function dialog(html, mount) {
  S.retFocus = document.activeElement;
  const l = $('#layer');
  l.innerHTML = `<div class="wc-scrim" data-closelayer></div><div class="wc-dlg" role="dialog" aria-modal="true">${html}</div>`;
  requestAnimationFrame(() => { $$('.wc-scrim, .wc-dlg', l).forEach((x) => x.classList.add('is-on')); const f = $('.wc-dlg [autofocus]', l) || $('.wc-dlg button.h-btn--primary', l); if (f) f.focus(); });
  if (mount) mount($('.wc-dlg', l));
}
function drawer(id) {
  if (window.WCEdit && window.WCEdit.panel) { window.WCEdit.panel(id); return; }
  const a = BYID[id]; if (!a) return;
  S.retFocus = document.activeElement;
  const c = cur(a); const [lc, ll] = lateClass(c.due);
  const later = a.later ? `<div class="wc-plan"><b>${a.later.k === 's' ? 'A thank-you was logged after this task' : 'A contact was logged after this task'}</b><span>${esc(a.later.s || 'No summary')} · ${fd(a.later.d)} · ${a.later.by.map((x) => esc(P(x).n)).join(', ') || 'no fundraiser'}</span><span class="wc-note">${a.later.k === 's' ? 'Close this task as thanked and nothing else is written.' : 'Check it was the thank-you before you close the task.'}</span></div>` : '';
  const l = $('#layer');
  l.innerHTML = `<div class="wc-scrim" data-closelayer></div><aside class="wc-drawer" role="dialog" aria-modal="true" aria-label="${esc(a.p)}">
    <div class="wc-dlg__head"><div><span class="h-label">${esc(a.type)} · ${esc(a.cat)}</span><h2>${esc(a.p)}</h2><p>${esc(a.loc || 'No city on file')}${a.lk ? ' · Constituent ' + esc(a.lk) : ''}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
    <div class="wc-drawer__body">
      <div class="wc-quote">${esc(a.sum || 'No summary')}${a.desc ? '\n\n' + esc(a.desc) : ''}</div>
      <dl class="wc-dl"><dt>Due</dt><dd>${fd(c.due, true)} <span class="wc-late ${lc ? 'wc-late--' + lc : ''}">${ll}</span></dd>
        <dt>Fundraiser</dt><dd>${c.f.length ? c.f.map((x) => esc(P(x).n) + gone(x)).join(', ') : 'No one'}</dd>
        <dt>Partner held by</dt><dd>${a.hold.length ? a.hold.map((x) => esc(P(x).n)).join(', ') : 'No current holder'}</dd>
        ${a.gift ? `<dt>Gift</dt><dd>${money(a.gift.a)} on ${fd(a.gift.d, true)}${a.gift.fund ? ' · ' + esc(a.gift.fund) : ''}</dd>` : ''}
        <dt>Added</dt><dd>${fd(a.add, true)}</dd><dt>Action id</dt><dd>${esc(a.id)}</dd></dl>
      ${later}
      <div class="wc-chips"><a class="h-btn h-btn--primary h-btn--sm" href="/work/partner/${esc(a.cid)}">Partner page</a><a class="h-btn h-btn--ghost h-btn--sm" href="https://host.nxt.blackbaud.com/constituent/records/${esc(a.cid)}?envid=p-5_k5FlbubEyEQnUJw7C9Rw" target="_blank" rel="noopener">${ic('ext')}Open in Blackbaud</a>
        <button class="h-btn h-btn--ghost h-btn--sm" data-onlypartner="${esc(a.cid)}">Only this partner's actions</button></div>
      <div class="wc-chips"><button class="h-btn h-btn--primary" data-one="complete" data-id="${a.id}">${ic('check')}Mark complete</button><button class="h-btn h-btn--ghost" data-one="reassign" data-id="${a.id}">Reassign</button><button class="h-btn h-btn--ghost" data-one="reschedule" data-id="${a.id}">Reschedule</button></div>
    </div></aside>`;
  requestAnimationFrame(() => { $$('.wc-scrim, .wc-drawer', l).forEach((x) => x.classList.add('is-on')); $('.wc-drawer .wc-dlg__x', l).focus(); });
}

// ------------------------------------------------------------ writes: plan, cost, run
const CHUNK = 15;
// Each changed action is read back once by the sync worker afterwards (1 Blackbaud call, 2 with tags), so the plan adds those.
function costOf(n, extraPerItem = 0) { return n + Math.ceil(n * extraPerItem) + Math.ceil(n / CHUNK) + n; }
// Mark complete: 1 PATCH each. Logged as a thank-you: an RDD, PC or CED task is completed in place (PATCH + Thanked tag = 2);
// a Follow Up task gets a new completed contact (POST + tag) and is then closed (PATCH) = 4 with its two tags. Plus one read-back per 15.
function completeCost(ids, how) {
  const thank = how && how !== 'none' && how !== 'logged';
  return ids.reduce((n, id) => n + (thank && BYID[id].ty ? (BYID[id].type === 'Follow Up - New Gift' ? 3 + 3 : 2 + 2) : 1 + 1), 0) + Math.ceil(ids.length / CHUNK);
}
// The Work Center may use 2,400 of the 3,000 upkeep calls a day; the last 600 stay for Foundation prospects, the
// morning jobs and one-off fixes. A change that would cross 2,400 waits for the reset.
function budgetLine(calls) {
  const used = meterUsed(); const left = DATA.meter.lane - used;
  if (calls > 15 && calls > left) return { tonight: true, html: `<div class="wc-warn">${ic('clock')}<span><b>These go to Blackbaud tonight.</b> They send after ${esc(DATA.meter.resets)}, when the daily count starts again.</span></div>` };
  return { tonight: false, html: '' };
}
function whoCounts(ids) { const m = {}; ids.forEach((id) => cur(BYID[id]).f.forEach((x) => { m[x] = (m[x] || 0) + 1; })); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="wc-tag">${esc(P(k).n)} ${n}</span>`).join(''); }
function selIds() { return [...S.sel].filter((id) => BYID[id] && selectable(id)); }
const HOW_CAT = { letter: 'Mailing', card: 'Mailing', call: 'Phone call', text: 'Phone call', email: 'Email', visit: 'Meeting' };

function dlgComplete(ids, mode) {
  ids = ids || selIds(); if (!ids.length) return;
  const tys = ids.filter((id) => BYID[id].ty);
  const closeAsThanked = mode === 'close';
  const st = { date: TODAY, how: closeAsThanked ? 'logged' : '', line: '', out: '', own: false };
  const draw = (el) => {
    const calls = completeCost(ids, closeAsThanked ? 'logged' : st.how);
    const bl = budgetLine(calls);
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>${closeAsThanked ? 'Close ' + plural(ids.length, 'task') + ' as thanked' : 'Mark ' + plural(ids.length, 'action') + ' complete'}</h2>
        <p>${closeAsThanked ? 'A thank-you is already in Blackbaud for each of these. Nothing new is written; each task closes on the day its thank-you was logged.' : 'Each action keeps its own summary.'}</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
      <div class="wc-dlg__body">
        ${closeAsThanked ? '' : `<div class="wc-field"><span class="lab">Completed on</span>
          <div class="wc-choices">${[['today', 'Today', TODAY], ['yday', 'Yesterday', addDays(TODAY, -1)], ['own', 'Each one\'s due date', '']].map(([k, l, v]) => `<button type="button" class="wc-choice${(k === 'own' ? st.own : !st.own && st.date === v) ? ' is-on' : ''}" data-date="${k}" data-v="${v}">${l}</button>`).join('')}
          <input type="date" value="${st.own ? '' : st.date}" max="${TODAY}" data-datein aria-label="Completed on" style="width:170px;height:34px;border-radius:999px;border:1px solid var(--h-line-2);padding:0 12px;background:#fff" /></div></div>
        ${tys.length ? `<div class="wc-field"><span class="lab">${tys.length === ids.length ? 'How did the thank-you go out?' : `${tys.length} of these are thank-you tasks. How did the thank-you go out?`}</span>
          <div class="wc-choices">${[['letter', 'Letter', 'letter'], ['card', 'Card', 'letter'], ['call', 'Call', 'phone'], ['text', 'Text', 'phone'], ['email', 'Email', 'mail'], ['visit', 'Visit', 'meet'], ['none', 'Close only', 'x']].map(([k, l, i]) => `<button type="button" class="wc-choice${st.how === k ? ' is-on' : ''}" data-how="${k}">${ic(i)}${l}</button>`).join('')}</div>
          <small>${st.how && st.how !== 'none' ? `Each thank-you task becomes the fundraiser's ${HOW_CAT[st.how]} contact with Thanked, so it counts on the KPI dashboard once. No second action is added.` : 'Pick how it went out and the task counts as the fundraiser\'s thank-you contact.'}</small></div>` : ''}
        <div class="wc-field"><label for="line">Add one line to every action <span style="font-weight:400;color:var(--h-ink-3)">(optional)</span></label>
          <input type="text" id="line" maxlength="200" placeholder="For example: Sent thank you letter" value="${esc(st.line)}" />
          <small>It goes at the end of each action's description, with today's date and your name.</small></div>
        <div class="wc-field"><span class="lab">How did it go? <span style="font-weight:400;color:var(--h-ink-3)">(optional)</span></span>
          <div class="wc-choices">${[['', 'Leave blank'], ['Successful', 'Good'], ['Unsuccessful', 'Not good']].map(([k, l]) => `<button type="button" class="wc-choice${st.out === k ? ' is-on' : ''}" data-out="${k}">${l}</button>`).join('')}</div></div>`}
        <div class="wc-plan"><b>What happens</b>
          <ul><li>${plural(ids.length, 'action')} marked complete in Blackbaud${closeAsThanked ? ', each on its thank-you\'s date' : st.own ? ', each on its own due date' : ' on ' + fd(st.date, true)}.</li>
          <li>They leave this list and every Work Center list at once.</li><li>Undo from Recent until ${clock()} tomorrow.</li></ul>
          <div class="who">${whoCounts(ids)}</div></div>
        ${bl.html}
      </div>
      <div class="wc-dlg__foot"><span class="wc-cost">Uses ${plural(calls, 'Blackbaud call')} of today's 3,000</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button>
        <button class="h-btn h-btn--primary" data-go>${ic('check')}${closeAsThanked ? 'Close ' + ids.length : 'Mark ' + ids.length + ' complete'}</button></div>`;
  };
  dialog('', (el) => {
    draw(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const keep = () => { st.line = $('#line', el) ? $('#line', el).value : st.line; };
      if (b.dataset.date) { if (b.dataset.date === 'own') st.own = true; else { st.own = false; st.date = b.dataset.v; } keep(); draw(el); }
      if (b.dataset.how) { st.how = st.how === b.dataset.how ? '' : b.dataset.how; keep(); draw(el); }
      if (b.dataset.out !== undefined && b.hasAttribute('data-out')) { st.out = b.dataset.out; keep(); draw(el); }
      if (b.hasAttribute('data-go')) {
        keep();
        const calls = completeCost(ids, closeAsThanked ? 'logged' : st.how);
        const tonight = budgetLine(calls).tonight;
        closeLayer();
        const label = closeAsThanked ? `Closed ${plural(ids.length, 'thank-you task')} as thanked` : `Marked ${plural(ids.length, 'action')} complete` + (st.how && st.how !== 'none' ? ' as thank-you ' + ({ letter: 'letters', card: 'cards', call: 'calls', text: 'texts', email: 'emails', visit: 'visits' })[st.how] : '');
        const params = closeAsThanked ? { op: 'close_thanked' } : { op: 'complete', date: st.own ? null : st.date, own: st.own, line: st.line, outcome: st.out, how: st.how };
        runJob({ params, ids, label, calls, tonight, apply: (id) => { S.gone[id] = 1; } });
      }
    });
    el.addEventListener('change', (e) => { if (e.target.matches('[data-datein]') && e.target.value) { st.own = false; st.date = e.target.value; st.line = $('#line', el).value; draw(el); } });
    el.addEventListener('input', (e) => { if (e.target.id === 'line') st.line = e.target.value; });
  });
}
function holderFor(a) { const f = cur(a).f; return a.hold.find((h) => live(h) && !f.includes(h)) || null; }
function dlgReassign(ids) {
  ids = ids || selIds(); if (!ids.length) return;
  const curF = {}; ids.forEach((id) => cur(BYID[id]).f.forEach((x) => { curF[x] = (curF[x] || 0) + 1; }));
  const depart = Object.keys(curF).filter((x) => !live(x));
  const withHolder = ids.filter((id) => holderFor(BYID[id]));
  const noOne = !Object.keys(curF).length; // none of these has a fundraiser yet, so there is nobody to replace
  const st = { mode: noOne ? 'add' : withHolder.length && depart.length ? 'holder' : 'replace', from: depart[0] || Object.keys(curF)[0] || '', to: '', add: '' };
  const staff = Object.keys(DATA.people).filter(live).filter(mayAssign).sort((a, b) => P(a).n.localeCompare(P(b).n));
  const opts = (sel, list, blank) => (blank ? `<option value="">${blank}</option>` : '') + list.map((k) => `<option value="${k}"${sel === k ? ' selected' : ''}>${esc(P(k).n)}${curF[k] ? ' (' + curF[k] + ')' : ''}</option>`).join('');
  const next = (a) => {
    let nf = null;
    if (st.mode === 'holder') { const h = holderFor(a); if (h) nf = cur(a).f.filter(live).concat([h]); }
    else if (st.mode === 'replace' && st.to && cur(a).f.includes(st.from)) nf = cur(a).f.filter((x) => x !== st.from).concat(cur(a).f.includes(st.to) ? [] : [st.to]);
    else if (st.mode === 'add' && st.add && !cur(a).f.includes(st.add)) nf = cur(a).f.concat([st.add]);
    return nf;
  };
  const plan = () => {
    const m = {}; let n = 0;
    ids.forEach((id) => { const a = BYID[id]; const nf = next(a); if (nf) { n++; nf.forEach((x) => { if (!cur(a).f.includes(x)) m[x] = (m[x] || 0) + 1; }); } });
    return { n, m };
  };
  const draw = (el) => {
    const p = plan();
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>Reassign ${plural(ids.length, 'action')}</h2><p>The partner and the summary stay as they are. Only who the action belongs to changes.</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
      <div class="wc-dlg__body"><div class="wc-radio">
        <label class="${st.mode === 'holder' ? 'is-on' : ''}"><input type="radio" name="m" value="holder" ${st.mode === 'holder' ? 'checked' : ''} /><div><b>Give each to its partner's current holder</b><span>${withHolder.length} of ${ids.length} have a holder who is not on the action yet. Anyone who left Favor comes off. The rest stay as they are.</span></div></label>
        <label class="${st.mode === 'replace' ? 'is-on' : ''}"><input type="radio" name="m" value="replace" ${st.mode === 'replace' ? 'checked' : ''} /><div><b>Replace one fundraiser with another</b>
          <div class="inline"><select data-k="from" aria-label="Replace">${opts(st.from, Object.keys(curF))}</select><span>with</span><select data-k="to" aria-label="With">${opts(st.to, staff, 'Pick a person')}</select></div></div></label>
        <label class="${st.mode === 'add' ? 'is-on' : ''}"><input type="radio" name="m" value="add" ${st.mode === 'add' ? 'checked' : ''} /><div><b>Add a fundraiser to each</b><span>Everyone already on it stays.</span>
          <div class="inline"><select data-k="add" aria-label="Add">${opts(st.add, staff, 'Pick a person')}</select></div></div></label></div>
        <div class="wc-plan"><b>${p.n ? plural(p.n, 'action') + ' change' : 'Nothing changes yet'}</b>${Object.keys(p.m).length ? `<div class="who">${Object.entries(p.m).map(([k, n]) => `<span class="wc-tag wc-tag--done">${esc(P(k).n)} gets ${n}</span>`).join('')}</div>` : ''}<span class="wc-note"></span></div>
        ${budgetLine(costOf(p.n)).html}
      </div>
      <div class="wc-dlg__foot"><span class="wc-cost">Uses ${plural(costOf(p.n), 'Blackbaud call')}</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go ${p.n ? '' : 'disabled'}>${ic('user')}Reassign ${p.n || ''}</button></div>`;
  };
  const drawR = (el) => { draw(el); if (noOne) { const r = el.querySelector('input[value="replace"]'); if (r) r.closest('label').remove(); } };
  dialog('', (el) => {
    drawR(el);
    el.addEventListener('change', (e) => { if (e.target.name === 'm') st.mode = e.target.value; if (e.target.dataset.k) { st[e.target.dataset.k] = e.target.value; st.mode = e.target.dataset.k === 'add' ? 'add' : 'replace'; } drawR(el); });
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-go]')) return;
      const changes = {};
      ids.forEach((id) => { const a = BYID[id]; const nf = next(a); if (nf) changes[id] = { prev: cur(a).f, next: nf }; });
      const cids = Object.keys(changes); closeLayer();
      runJob({ params: { op: 'reassign', mode: st.mode, from: st.from, to: st.to, add: st.add }, ids: cids, label: `Reassigned ${plural(cids.length, 'action')}`, calls: costOf(cids.length), tonight: budgetLine(costOf(cids.length)).tonight,
        apply: (id) => { S.ov[id] = Object.assign({}, S.ov[id], { f: changes[id].next }); }, keep: true });
    });
  });
}
function dlgReschedule(ids) {
  ids = ids || selIds(); if (!ids.length) return;
  const nextMon = (() => { let d = addDays(TODAY, 1); while (new Date(d + 'T12:00:00Z').getUTCDay() !== 1) d = addDays(d, 1); return d; })();
  const st = { mode: 'date', date: addDays(TODAY, 7), by: 7 };
  const draw = (el) => {
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>Reschedule ${plural(ids.length, 'action')}</h2><p>A new due date takes an action off the past-due count. It stays open.</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
      <div class="wc-dlg__body"><div class="wc-field"><span class="lab">New due date for all of them</span>
        <div class="wc-choices">${[['In a week', addDays(TODAY, 7)], ['In two weeks', addDays(TODAY, 14)], ['Next Monday', nextMon], ['Nov 1', TODAY.slice(0, 4) + '-11-01']].map(([l, v]) => `<button type="button" class="wc-choice${st.mode === 'date' && st.date === v ? ' is-on' : ''}" data-d="${v}">${l}</button>`).join('')}
        <input type="date" data-din value="${st.mode === 'date' ? st.date : ''}" min="${TODAY}" aria-label="New due date" style="width:170px;height:34px;border-radius:999px;border:1px solid var(--h-line-2);padding:0 12px;background:#fff" /></div></div>
        <div class="wc-field"><span class="lab">Or move each one from today</span><div class="wc-choices">${[7, 14, 30].map((n) => `<button type="button" class="wc-choice${st.mode === 'by' && st.by === n ? ' is-on' : ''}" data-by="${n}">+${n} days</button>`).join('')}</div></div>
        <div class="wc-plan"><b>${plural(ids.length, 'action')} due ${st.mode === 'date' ? fd(st.date, true) : 'on ' + fd(addDays(TODAY, st.by), true)}</b><span class="wc-note">Blackbaud shows the new date at once.</span></div>
        ${budgetLine(costOf(ids.length)).html}</div>
      <div class="wc-dlg__foot"><span class="wc-cost">Uses ${plural(costOf(ids.length), 'Blackbaud call')}</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button><button class="h-btn h-btn--primary" data-go>${ic('cal')}Reschedule ${ids.length}</button></div>`;
  };
  dialog('', (el) => {
    draw(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) { st.mode = 'date'; st.date = b.dataset.d; draw(el); }
      if (b.dataset.by) { st.mode = 'by'; st.by = Number(b.dataset.by); draw(el); }
      if (b.hasAttribute('data-go')) {
        const nd = st.mode === 'date' ? st.date : addDays(TODAY, st.by);
        closeLayer();
        runJob({ params: st.mode === 'date' ? { op: 'reschedule', due: nd } : { op: 'reschedule', by: st.by }, ids, label: `Moved ${plural(ids.length, 'action')} to ${fd(nd)}`, calls: costOf(ids.length), tonight: budgetLine(costOf(ids.length)).tonight,
          apply: (id) => { S.ov[id] = Object.assign({}, S.ov[id], { due: nd }); }, keep: true });
      }
    });
    el.addEventListener('change', (e) => { if (e.target.matches('[data-din]') && e.target.value) { st.mode = 'date'; st.date = e.target.value; draw(el); } });
  });
}

// ------------------------------------------------------------ running a batch
// The hub saves the batch first (so nothing is lost if Blackbaud is down), then the page asks it to send the next chunk
// until nothing is left. Each answer says which rows reached Blackbaud; a failure stays on its row.
let guard = null;
function guardTab(on) {
  if (on && !guard) { guard = (e) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', guard); }
  if (!on && guard) { window.removeEventListener('beforeunload', guard); guard = null; }
}
const VERB = { Marked: 'Marking', Closed: 'Closing', Reassigned: 'Reassigning', Moved: 'Moving', Entered: 'Entering' };
function progress(done, total, text) {
  const pi = $('#prog-i'), pl = $('#prog-l');
  if (pi) pi.style.width = Math.max(4, Math.round(done / Math.max(1, total) * 100)) + '%';
  if (pl) pl.textContent = text || `${done} of ${total} sent to Blackbaud`;
}
const reqId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function driveBatch(bid, ids, job, opts = {}) {
  guardTab(true);
  let done = 0, held = '', busyWaits = 0, idle = 0;
  const total = ids.length;
  try {
    for (let guardN = 0; guardN < 400; guardN++) {
      const r = await post(`/api/work/batches/${bid}/run`);
      if (r.meter) { DATA.meter = r.meter; $$('.wc-meter').forEach((m) => { m.outerHTML = meterHTML(); }); }
      for (const it of r.items) {
        if (it.state === 'posted') { done++; delete S.saving[it.id]; if (job.apply && !opts.undo) job.apply(it.id); if (job.applyEntry) job.applyEntry(it.id); const row = $(`#view .wc-row[data-id="${CSS.escape(it.id)}"]`); if (row && !job.keep && !job.entry) row.classList.add('is-leaving'); }
        else if (it.state === 'failed') { S.saving[it.id] = 'failed'; if (job.failEntry) job.failEntry(it.id, it.error); }
      }
      progress(Math.min(done, total), total, opts.undo ? `Undoing… ${Math.min(done, total)} of ${total}` : undefined);
      if (r.held === 'busy') { if (++busyWaits > 20) { held = 'busy'; break; } await sleep(1500); continue; }
      if (r.held) { held = r.held; break; }
      if (!r.left) break;
      // Two rounds in a row that sent nothing and failed nothing: Blackbaud is not taking calls. Stop, keep what is saved, and let the person try again later.
      idle = r.items.some((it) => it.state === 'posted' || it.state === 'failed') ? 0 : idle + 1;
      if (idle >= 2) { held = 'wait'; break; }
      if (idle) await sleep(2000);
    }
  } catch (e) {
    held = 'error'; S.lastError = e.message;
  } finally { guardTab(false); }
  return { done, held };
}
async function runJob(job) {
  const ids = job.ids.slice();
  S.sel.clear(); S.anchor = null; $('#toast').classList.remove('is-on');
  ids.forEach((id) => { S.saving[id] = 'saving'; if (job.entry && inRow(id)) inRow(id).state = 'posting'; });
  render();
  bar(`${job.label.replace(/^(\w+)/, (m) => VERB[m] || m)}…`);
  let saved;
  const req = reqId(); // one per press: a second click or a retry after a lost answer gets this same batch back
  try {
    saved = await post('/api/work/batches', Object.assign({}, job.params, job.entry ? { op: 'create', submission_ids: ids } : { ids }, { req }));
  } catch (e) {
    ids.forEach((id) => { delete S.saving[id]; if (job.entry && inRow(id)) inRow(id).state = 'waiting'; });
    render(); toast(e.message || 'Blackbaud did not answer. Nothing was changed.'); return;
  }
  const batch = saved.batch || {};
  if (saved.changed) job.label += ` (${saved.changed} left alone: changed in Blackbaud since your list loaded)`;
  const handled = new Set((saved.items || []).map((i) => String(i.id)));
  ids.forEach((id) => { if (!handled.has(id)) { delete S.saving[id]; if (job.entry && inRow(id)) inRow(id).state = 'waiting'; } });
  if (!batch.id) { render(); toast(job.entry ? 'Those contacts are already in Blackbaud. Nothing was added twice.' : 'Those actions were already handled. Reload the list if it looks out of date.'); refreshBoard(); return; }
  const sent = ids.filter((id) => handled.has(id));
  if (batch.run_when === 'tonight') {
    sent.forEach((id) => { delete S.saving[id]; S.queued[id] = job.params.op === 'complete' || job.params.op === 'close_thanked' ? 'Marked complete · goes to Blackbaud tonight' : 'Change goes to Blackbaud tonight'; if (job.entry && inRow(id)) inRow(id).state = 'posting'; });
    render(); toast(`${job.label}. Blackbaud gets ${sent.length === 1 ? 'it' : 'them'} after ${DATA.meter.resets}.`, batch.id); refreshBoard(); loadRecent();
    return;
  }
  const res = await driveBatch(batch.id, sent, job);
  S.saving = Object.fromEntries(Object.entries(S.saving).filter(([, v]) => v === 'failed'));
  if (res.held && res.held !== 'error') {
    sent.forEach((id) => { if (!S.saving[id] && !isDoneId(id, job)) S.queued[id] = res.held === 'off' || res.held === 'wait' ? 'Saved · waiting to send' : 'Goes to Blackbaud tonight'; });
  }
  await loadRecent();
  render();
  const failed = Object.values(S.saving).filter((v) => v === 'failed').length;
  if (res.held === 'error') toast(`${S.lastError || 'Blackbaud did not answer.'} What was not sent stays saved. Open Recent to try again.`, batch.id);
  else if (res.held === 'wait') toast('Blackbaud is not taking changes right now. Yours are saved. Open Recent and press Try again in a few minutes.', batch.id);
  else if (res.held === 'off') toast('Sending to Blackbaud is switched off. Your changes are saved and go when it is switched back on.', batch.id);
  else if (res.held) toast(`${job.label}. The rest goes to Blackbaud after ${DATA.meter.resets}.`, batch.id);
  else toast(failed ? `${job.label.replace(/^(\w+) (\d+)/, (m, v, n) => v + ' ' + Math.max(0, n - failed))}. ${failed} did not go through.` : job.label + '.', batch.id);
  refreshBoard();
}
const isDoneId = (id, job) => (job.entry ? !!(inRow(id) && inRow(id).state === 'posted') : !!S.gone[id] || !!(S.ov[id]));
async function undoBatch(bid) {
  $('#toast').classList.remove('is-on');
  let out;
  try { out = await post(`/api/work/batches/${bid}/undo`); } catch (e) { toast(e.message); return; }
  const b = out.batch;
  if (b && b.id) {
    bar('Undoing…');
    const items = (S.batches.find((x) => x.id === bid) || { items: [] }).items.filter((i) => i.state === 'posted').map((i) => i.id);
    await driveBatch(b.id, items.length ? items : ['x'], {}, { undo: true });
  }
  await refreshBoard(); await loadRecent(); if (S.view === 'intake') await loadEntry(); render();
  toast('Undone.' + (out.tagsStay ? ' The Thanked and Texted tags stay on those actions in Blackbaud.' : '') + (out.unresolved ? ` ${out.unresolved} contact${out.unresolved === 1 ? '' : 's'} need a look in Blackbaud. Recent lists them.` : ''));
}
async function retryBatch(bid) {
  let out;
  try { out = await post(`/api/work/batches/${bid}/retry`); } catch (e) { toast(e.message); return; }
  const b = S.batches.find((x) => x.id === bid);
  const ids = b ? b.items.filter((i) => i.state === 'failed').map((i) => i.id) : [];
  bar('Trying again…');
  const res = await driveBatch(bid, ids.length ? ids : ['x'], {});
  await refreshBoard(); await loadRecent(); if (S.view === 'intake') await loadEntry(); render();
  toast(res.held ? 'Blackbaud did not answer. What did not go through stays saved.' : `Tried ${out.requeued || ''} again.`);
}
function toast(msg, bid) {
  const t = $('#toast');
  t.innerHTML = `<span class="ok">${ic('check')}</span><span>${esc(msg)}</span>${bid ? `<button class="h-btn h-btn--ghost h-btn--sm" data-undo="${bid}">${ic('undo')}Undo</button>` : ''}`;
  t.classList.add('is-on'); clearTimeout(S.tt); S.tt = setTimeout(() => t.classList.remove('is-on'), bid ? 9000 : 5200);
}

// ------------------------------------------------------------ Entry (Support intake)
const HOWS = [['call', 'Call'], ['vm', 'Voicemail'], ['text', 'Text'], ['email', 'Email'], ['meet', 'Meeting'], ['mail', 'Mail']];
const TAGS = [['thanked', 'Thanked'], ['texted', 'Texted'], ['stewardship', 'Stewardship'], ['scheduling', 'Scheduling']];
const rowsOf = () => (S.in.data ? S.in.data.rows : []);
const partnerOf = (cid) => (S.in.data && S.in.data.partners[cid]) || S.in.known[cid] || null;
S.in.known = {};
function visibleIntake() {
  const lane = S.in.lane;
  return rowsOf().filter((r) => r.owner === S.in.rdd).filter((r) => {
    const s = rowState(r).k;
    if (lane === 'wait') return r.wk === 'this' && s !== 'dup' && s !== 'posted' && s !== 'skip';
    if (lane === 'late') return r.wk !== 'this' && s !== 'dup' && s !== 'posted' && s !== 'skip';
    if (lane === 'in') return s === 'dup' || s === 'posted';
    return true;
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}
function rowState(r) {
  if (r.state === 'posted') return { k: 'posted', l: 'Entered', note: r.posted ? 'Entered ' + fd(r.posted.at.slice(0, 10)) + (r.posted.by ? ' by ' + r.posted.by.split(' ')[0] : '') : '' };
  if (r.state === 'posting' || S.saving[r.id] === 'saving') return { k: 'saving', l: 'Saving' };
  if (r.state === 'failed' || S.saving[r.id] === 'failed') return { k: 'fail', l: 'Not sent', note: 'Blackbaud did not answer. Try again.' };
  if (r.state === 'in_blackbaud') return { k: 'dup', l: 'In Blackbaud', note: r.dup ? `Entered ${fd(r.dup.added)}${r.dup.same ? '' : ', dated a day apart'}` : 'Ticked on the sheet' };
  if (r.state === 'skipped') return { k: 'skip', l: 'Skipped' };
  if (!r.cid) return { k: 'pick', l: r.cands.length ? 'Pick a record' : 'Find the partner' };
  if (!r.ch) return { k: 'pick', l: 'Pick how' };
  return { k: 'ready', l: 'Ready' };
}
function estCreate(rows) { const tags = rows.reduce((n, r) => n + r.tags.length + (r.ch === 'text' ? 1 : 0) + (r.ask ? 1 : 0), 0); return rows.length + tags + Math.ceil(rows.length / CHUNK) + rows.length * 2; }
function owners() { return S.in.data ? S.in.data.owners : []; }
function intakeRowHTML(r) {
  const st = rowState(r); const d = r.cid ? partnerOf(r.cid) : null;
  const locked = st.k === 'dup' || st.k === 'posted' || st.k === 'saving';
  const picked = S.sel.has(r.id);
  let partner;
  const how = { email: 'matched by email', phone: 'matched by phone', name: 'matched by name', name_portfolio: 'name, in ' + esc(first(r.owner)) + '\'s portfolio', picked: 'picked' }[r.how] || 'matched by name';
  if (r.cid && d) partner = `<b class="wc-pname"><a class="wc-ppage wc-ppage--name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(d.n)}</a></b><span class="wc-match">${esc(d.loc || 'No city on file')} · ${esc(d.lk)} · <i>${how}</i>${locked ? '' : `<span style="white-space:nowrap"> · <button type="button" class="wc-linkbtn" data-unpick="${r.id}">Change</button></span>`}</span>`;
  else if (r.cid) partner = `<b class="wc-pname"><a class="wc-ppage wc-ppage--name" href="/work/partner/${esc(r.cid)}" data-partner-id="${esc(r.cid)}">${esc(r.name)}</a></b><span class="wc-match">Partner ${esc(r.cid)} · <i>${how}</i>${locked ? '' : ` · <button type="button" class="wc-linkbtn" data-unpick="${r.id}">Change</button>`}</span>`;
  else if (r.cands.length) partner = `<b class="wc-pname">${esc(r.name)}</b><span class="wc-match">${r.cands.length === 1 ? 'One record has this name. Is it the partner?' : r.cands.length + ' records match. Pick one:'}</span><div class="wc-pickp">${r.cands.map((c) => { const x = partnerOf(c) || { n: 'Record ' + c, loc: '', lk: '', hold: [] }; return `<button type="button" data-pick="${r.id}" data-cid="${c}">${esc(x.n)}<span>${esc(x.loc || 'no city')} · ${esc(x.lk)}${x.hold.length ? ' · ' + esc(P(x.hold[0]).n) : ''}</span></button>`; }).join('')}</div>`;
  else partner = `<b class="wc-pname">${esc(r.name)}</b><span class="wc-match">${r.isNew && /y/i.test(r.isNew) ? 'Marked new on the sheet. ' : ''}No record found by ${r.email ? 'email or ' : ''}name.</span><div class="wc-ta"><input type="search" placeholder="Find the partner" data-ta="${r.id}" value="${esc((r.name.split(' - ')[0] || '').replace(/^(.+?),\s*(.+)$/, '$2 $1'))}" aria-label="Find the partner for ${esc(r.name)}" autocomplete="off" /></div>`;
  const srcLabel = r.source === 'many' ? 'One contact, many partners' : r.source === 'sheet' ? 'Tracking sheet' : r.source === 'paste' ? (r.row ? 'Sheet row ' + r.row : 'Pasted') : 'Typed';
  return `<div class="wc-row${picked ? ' is-picked' : ''}${st.k === 'dup' ? ' is-dup' : ''}${st.k === 'posted' ? ' is-posted' : ''}" role="row" tabindex="-1" data-id="${r.id}" aria-selected="${picked}">
    <div class="wc-cb" data-cb><input type="checkbox" ${picked ? 'checked' : ''} ${locked ? 'disabled' : ''} tabindex="-1" aria-label="Select ${esc(r.name)}" /></div>
    <div class="wc-pc">${partner}</div>
    <div class="wc-dc"><input class="cell" type="date" value="${r.date}" ${locked ? 'disabled' : ''} data-rdate="${r.id}" aria-label="Date of the contact" /><span class="wc-sub">${srcLabel}</span></div>
    <div class="wc-hc"><div class="wc-hows" role="group" aria-label="How">${HOWS.map(([k, l]) => `<button type="button" class="wc-how${r.ch === k ? ' is-on' : ''}" data-rch="${r.id}" data-v="${k}" ${locked ? 'disabled' : ''}>${l}</button>`).join('')}</div>${r.act && !r.ch ? `<span class="wc-sub">The sheet says “${esc(r.act.slice(0, 40))}”</span>` : ''}</div>
    <div class="wc-statewrap"><span class="wc-state wc-state--${st.k === 'saving' ? 'dup' : st.k}">${st.k === 'saving' ? '<span class="wc-spin"></span>' : ''}${st.l}</span>${st.note ? `<small>${esc(st.note)}</small>` : ''}</div>
    <div class="wc-sc"><input class="cell" type="text" maxlength="255" value="${esc(r.sum)}" data-rsum="${r.id}" ${locked ? 'disabled' : ''} aria-label="Summary" placeholder="Summary" /><div class="notes" title="${esc(r.notes)}">${esc(r.notes || 'No notes on the sheet')}</div></div>
    <div class="wc-tagcell"><div class="wc-ttog">${TAGS.map(([k, l]) => `<button type="button" class="wc-tt${r.tags.includes(k) ? ' is-on' : ''}" data-rtag="${r.id}" data-v="${k}" ${locked ? 'disabled' : ''}>${l}</button>`).join('')}
      <label class="wc-ask">Ask $<input type="text" inputmode="decimal" value="${esc(r.ask)}" data-rask="${r.id}" ${locked ? 'disabled' : ''} aria-label="Amount of ask" /></label></div></div>
  </div>`;
}
function weekCounts(fid) {
  const o = owners().find((x) => x.fid === fid);
  return o ? { sub: o.sub, inBB: o.inBB, wait: o.wait, late: o.late, in: o.in, all: o.all } : { sub: 0, inBB: 0, wait: 0, late: 0, in: 0, all: 0 };
}
async function loadEntry(owner) {
  const want = owner !== undefined ? owner : S.in.rdd;
  S.in.loading = true;
  try {
    const d = await api('/api/work/entry' + (want ? '?owner=' + encodeURIComponent(want) : ''));
    S.in.data = d; S.in.rdd = d.owner || want; S.in.error = '';
    d.owners.forEach((o) => { if (!DATA.people[o.fid]) DATA.people[o.fid] = { n: o.name, team: 'RDD', active: 1, listed: 1 }; });
  } catch (e) { S.in.error = e.message; }
  S.in.loading = false;
}
// The hub reads the owner's tracking sheet tabs itself. Opening Entry does it quietly (at most every ten minutes); the button does it on demand.
async function readSheet(fid, force, say) {
  const o = S.in.data && S.in.data.owners.find((x) => x.fid === fid);
  if (!o || !o.tab) { if (say) toast('This tracking sheet has no tab for ' + (o ? o.name : 'this person') + ' yet. Use Paste rows.'); return; }
  try {
    const res = await post('/api/work/entry/sheet', { owner: fid, force: !!force });
    const n = (res.added || []).length;
    if (n) { await loadEntry(fid); if (S.view === 'intake') render(); }
    if (say) toast(n ? `Read ${plural(n, 'new row')} from the tracking sheet${res.skipped ? `. ${res.skipped} were already here` : ''}.` : res.skipped ? `Nothing new. All ${res.skipped} rows on the sheet are already here.` : 'Nothing new on the sheet.');
  } catch (err) { if (say) toast(err.message); }
}
function viewIntake() {
  const d = S.in.data;
  if (S.in.loading && !d) { $('#view').innerHTML = '<section class="h-card wc-sheet" id="wc-intake"><div class="h-skel" style="height:300px;border-radius:18px"></div></section>'; return; }
  if (!d) { $('#view').innerHTML = `<div class="h-card wc-empty"><b>Entry did not load</b>${esc(S.in.error || 'Try again in a minute.')} <button class="h-btn h-btn--ghost h-btn--sm" data-reentry>Try again</button></div>`; return; }
  if (!d.owners.length) { $('#view').innerHTML = '<div class="h-card wc-empty"><b>No one is set up for Entry yet</b>An admin adds the people whose contacts Support enters in Settings.</div>'; return; }
  const me = d.owners.find((x) => x.fid === S.in.rdd) || d.owners[0];
  const w = weekCounts(me.fid);
  const bb = d.bb || { this: 0, last: 0, lastByMon3: 0 };
  const list = visibleIntake(); S.list = list.map((r) => r.id);
  const dl = Date.parse(d.deadline.iso) - Date.now();
  const clk = (ms) => { const m = Math.max(0, ms); return `${Math.floor(m / 86400000)}<small>d</small> ${Math.floor(m % 86400000 / 3600000)}<small>h</small> ${Math.floor(m % 3600000 / 60000)}<small>m</small>`; };
  const lanes = [['wait', 'This week', w.wait], ['late', 'Late', w.late], ['in', 'In Blackbaud', w.in], ['all', 'All rows', w.all]];
  const readyAll = list.filter((r) => rowState(r).k === 'ready');
  const span = `${fd(d.deadline.from)} to ${Number(d.deadline.to.slice(8))}`;
  $('#view').innerHTML = `
    <div class="wc-owners" role="tablist" aria-label="Whose contacts">
      ${d.owners.map((x) => { const n = x.wait + x.late; return `<button type="button" class="wc-owner${S.in.rdd === x.fid ? ' is-on' : ''}" data-rdd="${x.fid}" title="${esc(x.type)}"><span class="wc-ini">${ini(x.name)}</span>${esc(x.name)}${n ? `<em class="warn">${n}</em>` : x.all ? '<em>Done</em>' : '<em class="none">Nothing yet</em>'}</button>`; }).join('')}
    </div>
    <section class="h-card wc-clock" aria-label="This week's deadline">
      <div class="wc-clock__left"><span class="h-label">${esc(me.name)} · due ${esc(d.deadline.label.replace('Monday', 'Monday'))}</span><div class="wc-clock__time" id="clock">${clk(dl)}</div><div class="wc-clock__when">Contacts from ${esc(span)}. The report is pulled Wednesday at noon.</div></div>
      <div class="wc-prog"><div class="wc-prog__nums"><span><b>${w.inBB}</b>of ${w.sub} submitted this week are in Blackbaud</span><span class="wc-prog__side">${bb.this} ${esc(me.type)}s dated this week in Blackbaud<br />Last week: ${bb.lastByMon3} of ${bb.last} in by Monday 3:00 PM</span></div>
        <div class="wc-prog__bar" role="img" aria-label="${w.inBB} of ${w.sub} entered"><i style="width:${w.sub ? w.inBB / w.sub * 100 : 0}%"></i><i style="width:${w.sub ? w.wait / w.sub * 100 : 0}%"></i></div>
        <div class="wc-prog__legend"><span><i></i>In Blackbaud ${w.inBB}</span><span><i class="w"></i>Waiting ${w.wait}</span><span><i class="b"></i>Late from earlier weeks ${w.late}</span></div></div>
    </section>
    <section class="h-card wc-sheet" id="wc-intake" aria-label="Contacts to enter">
      <div class="wc-filters"><div class="wc-lanes" role="tablist">${lanes.map(([k, l, n]) => `<button type="button" class="wc-lane${S.in.lane === k ? ' is-on' : ''}" data-lane="${k}">${l}<span>${n}</span></button>`).join('')}</div>
        <div class="wc-tools"><button type="button" class="h-btn h-btn--ghost h-btn--sm wc-phonly" data-cball>Select all</button>${me.tab ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-readsheet>${ic('paste')}Read the sheet</button>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-paste>${ic('paste')}Paste rows</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-many>${ic('many')}One contact, many partners</button></div></div>
      <div class="wc-paste${S.in.paste ? ' is-on' : ''}" id="paste">
        <label for="pastebox" class="wc-pastelab">Paste rows from ${esc(me.name)}'s tracking sheet: Name, New?, Date, Phone, Email, Address, Ask, Action, Notes</label>
        <textarea id="pastebox" placeholder="Copy the rows in the sheet (Ctrl C) and paste them here (Ctrl V)."></textarea>
        <div class="wc-paste__acts"><button type="button" class="h-btn h-btn--primary h-btn--sm" data-readpaste>Read the rows</button><button type="button" class="wc-clear" data-paste>Close</button><small>Each row is matched to a partner by email, then phone, then name. Rows already here or in Blackbaud are skipped.</small></div>
      </div>
      <div class="wc-scroll wc-scroll--in" role="grid" aria-multiselectable="true">
        ${list.length ? `<div class="wc-head wc-ig"><div class="wc-cb" data-cball><input type="checkbox" aria-label="Select every row shown" /></div><span>Partner</span><span>Date</span><span>How</span><span>State</span></div>
        <div class="wc-ig">${list.map(intakeRowHTML).join('')}</div>` : `<div class="wc-empty"><b>${S.in.lane === 'wait' && w.all ? 'Everything submitted this week is in Blackbaud' : w.all ? 'Nothing in this lane' : 'Nothing pasted for ' + esc(me.name) + ' yet'}</b>${w.all ? '' : 'Paste rows from the tracking sheet, or use One contact, many partners.'}</div>`}
      </div>
      <div class="wc-foot"><span>${readyAll.length} of ${list.length} rows ready${readyAll.length ? ` · entering them all uses about ${estCreate(readyAll)} Blackbaud calls` : ''}</span>
        ${readyAll.length ? `<button class="h-btn h-btn--primary h-btn--sm" data-postall>${ic('check')}Enter ${readyAll.length} ready rows</button>` : '<span></span>'}</div>
    </section>`;
  const all = $('#view .wc-head [data-cball] input');
  if (all) { const sel = list.filter((r) => selectable(r.id)); all.checked = sel.length > 0 && sel.every((r) => S.sel.has(r.id)); }
  bar();
}
function postRows(rows) {
  rows = rows.filter((r) => rowState(r).k === 'ready'); if (!rows.length) return;
  flushEdits();
  const calls = estCreate(rows);
  const me = owners().find((x) => x.fid === S.in.rdd);
  runJob({ entry: true, params: {}, ids: rows.map((r) => r.id), label: `Entered ${plural(rows.length, 'contact')} for ${me ? me.name : P(S.in.rdd).n}`, calls, tonight: budgetLine(calls).tonight });
}
// a row's fields are saved to the hub as they change; typing waits half a second
const pendingEdits = {};
function editRow(id, fields, soon) {
  const r = inRow(id); if (!r) return;
  Object.assign(r, fields.local || {});
  pendingEdits[id] = Object.assign(pendingEdits[id] || {}, fields.server);
  clearTimeout(editRow.t);
  editRow.t = setTimeout(flushEdits, soon ? 600 : 0);
}
async function flushEdits() {
  clearTimeout(editRow.t);
  const ids = Object.keys(pendingEdits);
  for (const id of ids) {
    const body = pendingEdits[id]; delete pendingEdits[id];
    try {
      const out = await patch('/api/work/entry/' + id, body);
      const i = S.in.data.rows.findIndex((x) => x.id === id);
      if (i >= 0) S.in.data.rows[i] = out.row;
      Object.assign(S.in.data.partners, out.partners || {});
      if ('constituent_id' in body || 'contact_date' in body || 'skip' in body) { await loadEntry(); render(); }
    } catch (e) { toast(e.message); await loadEntry(); render(); }
  }
}
function openPop(input, items) {
  closePop();
  const r = input.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.id = 'wc-pop'; pop.className = 'wc-ta__list wc-pop';
  pop.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px;width:${Math.max(280, Math.round(r.width))}px;z-index:120`;
  pop.innerHTML = items;
  document.body.appendChild(pop);
}
function closePop() { const p = $('#wc-pop'); if (p) p.remove(); }
async function searchPartners(q, owner) {
  const out = await api('/api/work/partners?q=' + encodeURIComponent(q) + (owner ? '&owner=' + encodeURIComponent(owner) : ''));
  out.rows.forEach((h) => { S.in.known[h.cid] = { n: h.name, loc: h.place, lk: h.lookup, hold: h.holders, dec: h.deceased ? 1 : 0 }; });
  return out.rows;
}
function dlgMany() {
  const me = owners().find((x) => x.fid === S.in.rdd);
  const st = { date: TODAY, ch: 'mail', sum: '', tags: ['thanked'], picks: [], q: '', hi: 0, res: [], pool: [] };
  const hh = () => {
    const out = [];
    st.picks.forEach((c) => { const d = partnerOf(c); if (!d) return; const last = d.n.split(' ').pop(); st.pool.filter((x) => x.cid !== c && !st.picks.includes(x.cid) && x.place && x.place === d.loc && x.name.split(' ').pop() === last).slice(0, 1).forEach((x) => out.push([{ n: d.n }, { n: x.name, cid: x.cid }])); });
    return out;
  };
  const draw = (el, keepFocus) => {
    const res = st.res.filter((h) => !st.picks.includes(h.cid));
    const household = hh();
    const calls = st.picks.length + st.picks.length * st.tags.length + Math.ceil(st.picks.length / CHUNK) + st.picks.length * 2;
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>One contact, many partners</h2><p>One date, one summary, one way it went out. Blackbaud gets one ${esc(me ? me.type : 'RDD Action')} on each partner, with ${esc(me ? me.name : 'the owner')} as fundraiser.</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
      <div class="wc-dlg__body">
        <div class="wc-row2"><div class="wc-field"><label for="m-date">Date of the contact</label><input type="date" id="m-date" value="${st.date}" max="${TODAY}" /></div>
          <div class="wc-field"><span class="lab">How</span><div class="wc-choices">${HOWS.map(([k, l]) => `<button type="button" class="wc-choice${st.ch === k ? ' is-on' : ''}" data-mch="${k}">${l}</button>`).join('')}</div></div></div>
        <div class="wc-field"><label for="m-sum">Summary</label><input type="text" id="m-sum" maxlength="255" placeholder="For example: Sent thank you letter for the September gift" value="${esc(st.sum)}" /></div>
        <div class="wc-field"><span class="lab">Tags</span><div class="wc-ttog">${TAGS.map(([k, l]) => `<button type="button" class="wc-tt${st.tags.includes(k) ? ' is-on' : ''}" data-mtag="${k}">${l}</button>`).join('')}</div></div>
        <div class="wc-field"><label for="m-q">Partners <span style="font-weight:400;color:var(--h-ink-3)">(${st.picks.length} picked)</span></label>
          <div class="wc-chipsel">${st.picks.map((c) => `<button type="button" class="wc-fchip" data-unpickm="${c}">${esc((partnerOf(c) || { n: c }).n)}<i>×</i></button>`).join('')}<input type="search" id="m-q" placeholder="Type a name, or paste a list of names" value="${esc(st.q)}" autocomplete="off" /></div>
          ${res.length ? `<div class="wc-ta"><div class="wc-ta__list" style="position:static">${res.map((d, i) => `<button type="button" class="${i === st.hi ? 'is-hi' : ''}" data-pickm="${d.cid}">${esc(d.name)}<span>${esc(d.place || 'no city')} · ${esc(d.lookup)}${d.holders.length ? ' · ' + d.holders.map((h) => esc(P(h).n)).join(', ') : ''}${d.deceased ? ' · deceased' : ''}</span></button>`).join('')}</div></div>` : ''}
          ${household.length ? household.map(([a, b]) => `<div class="wc-hh">${esc(a.n)} and ${esc(b.n)} share a last name and a city. If it is one household, pick one record so the contact counts once. <button type="button" class="wc-clear" data-pickm="${b.cid}">Add ${esc(b.n.split(' ')[0])} anyway</button></div>`).join('') : ''}
          <small>Pasting several names at once picks every one that matches a single record.</small></div>
        ${budgetLine(calls).html}
      </div>
      <div class="wc-dlg__foot"><span class="wc-cost">${st.picks.length ? `${plural(st.picks.length, 'action')}, about ${plural(calls, 'Blackbaud call')}` : 'Pick at least one partner'}</span><button class="h-btn h-btn--ghost" data-closelayer>Cancel</button>
        <button class="h-btn h-btn--primary" data-go ${st.picks.length && st.sum.trim() ? '' : 'disabled'}>${ic('check')}Enter for ${plural(st.picks.length, 'partner')}</button></div>`;
    if (keepFocus) { const q = $('#m-q', el); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  };
  let qt;
  dialog('', (el) => {
    draw(el);
    el.addEventListener('input', (e) => {
      if (e.target.id === 'm-q') {
        const v = e.target.value; st.q = v;
        if (/[\n;]/.test(v) || (v.match(/,/g) || []).length > 1) {
          const names = v.split(/[\n;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 40);
          (async () => {
            for (const nm of names) {
              const key = norm(nm.includes(',') ? nm.split(',').slice(1).join(' ') + ' ' + nm.split(',')[0] : nm);
              try { const hits = (await searchPartners(nm.includes(',') ? nm.split(',').slice(1).join(' ') + ' ' + nm.split(',')[0] : nm, S.in.rdd)).filter((h) => norm(h.name) === key); if (hits.length === 1 && !st.picks.includes(hits[0].cid)) st.picks.push(hits[0].cid); } catch (_) {}
            }
            st.q = ''; st.res = []; draw(el, true);
          })();
          return;
        }
        clearTimeout(qt);
        qt = setTimeout(async () => {
          if (st.q.length < 2) { st.res = []; draw(el, true); return; }
          try { st.res = await searchPartners(st.q, S.in.rdd); st.pool = st.pool.concat(st.res); } catch (_) { st.res = []; }
          st.hi = 0; draw(el, true);
        }, 220);
      }
      if (e.target.id === 'm-sum') { st.sum = e.target.value; const go = $('[data-go]', el); go.disabled = !(st.picks.length && st.sum.trim()); }
    });
    el.addEventListener('change', (e) => { if (e.target.id === 'm-date') st.date = e.target.value; });
    el.addEventListener('keydown', (e) => { if (e.target.id === 'm-q' && e.key === 'Enter') { e.preventDefault(); const b = $$('[data-pickm]', el)[st.hi]; if (b) b.click(); } if (e.target.id === 'm-q' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); st.hi = Math.max(0, st.hi + (e.key === 'ArrowDown' ? 1 : -1)); draw(el, true); } });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const keep = () => { const s = $('#m-sum', el); if (s) st.sum = s.value; };
      if (b.dataset.mch) { st.ch = b.dataset.mch; keep(); draw(el); }
      if (b.dataset.mtag) { const t = b.dataset.mtag; st.tags = st.tags.includes(t) ? st.tags.filter((x) => x !== t) : st.tags.concat([t]); keep(); draw(el); }
      if (b.dataset.pickm) { st.picks.push(b.dataset.pickm); st.q = ''; st.res = []; keep(); draw(el, true); }
      if (b.dataset.unpickm) { st.picks = st.picks.filter((x) => x !== b.dataset.unpickm); keep(); draw(el); }
      if (b.hasAttribute('data-go') && !b.disabled) {
        const picks = st.picks.slice();
        closeLayer();
        bar('Entering…');
        let out;
        try { out = await post('/api/work/entry/many', { owner: S.in.rdd, date: st.date, channel: st.ch, summary: st.sum, tags: st.tags, constituent_ids: picks, req: reqId() }); }
        catch (err) { hideBar(); toast(err.message); return; }
        S.in.lane = 'all';
        if (out.batch && out.batch.id && out.batch.run_when !== 'tonight') {
          const ids = (out.items || []).map((i) => i.id);
          ids.forEach((id) => { S.saving[id] = 'saving'; });
          await loadEntry(); render(); bar('Entering…');
          const res = await driveBatch(out.batch.id, ids, { entry: true });
          S.saving = {};
          await loadEntry(); await loadRecent(); render();
          toast(res.held ? 'Some contacts are saved and go to Blackbaud when it answers.' : `Entered ${plural(out.created, 'contact')} for ${out.owner}${out.dups ? `. ${out.dups} were already in Blackbaud and were skipped` : ''}.`, out.batch.id);
        } else {
          await loadEntry(); await loadRecent(); render();
          toast(out.batch && out.batch.id ? `Saved. Blackbaud gets them after ${DATA.meter.resets}.` : `All ${out.dups} were already in Blackbaud. Nothing was added twice.`, out.batch && out.batch.id ? out.batch.id : undefined);
        }
      }
    });
  });
}

// ------------------------------------------------------------ Thank-yous
function tyGroups(owner) {
  const seen = new Set(); const out = [];
  ACTS.filter((a) => a.ty && isOpenNow(a) && (!owner || cur(a).f.includes(owner))).forEach((a) => {
    if (seen.has(a.id)) return;
    const ids = (a.grp || [a.id]).filter((id) => BYID[id] && isOpenNow(BYID[id]));
    ids.forEach((id) => seen.add(id));
    const lead = BYID[ids[0]] || a;
    const later = ids.map((id) => BYID[id].later).find((l) => l && l.k === 's') || ids.map((id) => BYID[id].later).find(Boolean) || null;
    out.push({ key: lead.id, ids, a: lead, later });
  });
  return out;
}
function viewTy() {
  const owners = {}; ACTS.filter((a) => a.ty && isOpenNow(a)).forEach((a) => cur(a).f.forEach((x) => { owners[x] = (owners[x] || 0) + 1; }));
  const ownList = Object.keys(owners).filter(live).sort((a, b) => owners[b] - owners[a]);
  if (S.ty.owner && !owners[S.ty.owner]) S.ty.owner = '';
  const gs = tyGroups(S.ty.owner);
  const sec = { s: gs.filter((g) => g.later && g.later.k === 's'), l: gs.filter((g) => g.later && g.later.k === 'l'), o: gs.filter((g) => !g.later) };
  if (!S.ty.lane || (!sec[S.ty.lane].length && gs.length)) S.ty.lane = sec.s.length ? 's' : sec.l.length ? 'l' : 'o';
  const L = sec[S.ty.lane];
  S.list = L.map((g) => g.key);
  S.tyMap = Object.fromEntries(gs.map((g) => [g.key, g]));
  const LANE = {
    s: ['Thanked already', 'A thank-you was logged on the partner after the task was made. Closing writes nothing new; each task closes on the day its thank-you was logged.'],
    l: ['Probably done', 'Someone called, emailed or wrote after the task. Close it when that contact was the thank-you.'],
    o: ['Owed', 'No contact since the task. Select the ones you thanked and press Mark thanked. Each row is one gift, even when Blackbaud holds two tasks for it.'],
  };
  const rowT = (g) => {
    const a = g.a; const picked = S.sel.has(g.key); const age = -dayn(a.add);
    const saving = g.ids.some((id) => S.saving[id] === 'saving' || pendingOf(BYID[id])); const failed = g.ids.some((id) => S.saving[id] === 'failed');
    const evid = g.later ? `<b>${esc(g.later.s || '(no summary)')}</b><span>${g.later.k === 's' ? 'Thanked' : ({ 'Phone call': 'Call', Email: 'Email', Mailing: 'Mailing', Meeting: 'Meeting' })[g.later.cat] || 'Contact'} ${fd(g.later.d)} · ${g.later.by.map((x) => esc(P(x).n)).join(', ') || 'no fundraiser'}</span>` : `<b>${age <= 0 ? 'Owed since today' : 'Owed ' + plural(age, 'day')}</b><span>No contact logged on this partner since the task was made</span>`;
    const btn = S.ty.lane === 's' ? 'Close' : S.ty.lane === 'l' ? 'That was it' : 'Thanked';
    return `<div class="wc-row${picked ? ' is-picked' : ''}${saving ? ' is-saving' : ''}" role="row" tabindex="-1" data-id="${g.key}" aria-selected="${picked}">
      <div class="wc-cb" data-cb><input type="checkbox" ${picked ? 'checked' : ''} ${saving ? 'disabled' : ''} tabindex="-1" aria-label="Select ${esc(a.p)}" /></div>
      <div class="wc-partner"><a class="wc-plink" href="/work/partner/${esc(a.cid)}" data-partner-id="${esc(a.cid)}">${esc(a.p)}</a><span class="wc-sub">${esc(a.loc || 'No city on file')} · ${cur(a).f.map((x) => esc(P(x).n)).join(', ')}</span></div>
      <div class="wc-what wc-task"><b>${esc(a.sum || a.type)}</b><div class="wc-tags">${a.gift ? `<span class="wc-tag wc-tag--gift">${money(a.gift.a)} on ${fd(a.gift.d)}${a.gift.fund ? ' · ' + esc(a.gift.fund) : ''}</span>` : '<span class="wc-tag">Gift not named in the task</span>'}${g.ids.length > 1 ? `<span class="wc-tag" title="Blackbaud holds ${g.ids.length} open tasks for this one gift. Closing the row closes all of them.">${g.ids.length} tasks, one gift</span>` : ''}${saving ? '<span class="wc-tag wc-tag--saving">Saving</span>' : ''}${failed ? '<span class="wc-tag wc-tag--warn">Did not go through. Try again.</span>' : ''}</div></div>
      <div class="wc-evid">${evid}</div>
      <div class="wc-rowbtn"><button class="h-btn h-btn--ghost h-btn--sm" ${S.ty.lane === 'o' ? 'data-tydone' : 'data-tyclose'}="${g.key}">${btn}</button></div></div>`;
  };
  $('#view').innerHTML = `
    <div class="wc-owners" role="tablist" aria-label="Whose thank-yous">
      <button type="button" class="wc-owner${!S.ty.owner ? ' is-on' : ''}" data-owner=""><span class="wc-ini">All</span>Everyone<em>${tyGroups('').length}</em></button>
      ${ownList.map((x) => `<button type="button" class="wc-owner${S.ty.owner === x ? ' is-on' : ''}" data-owner="${x}"><span class="wc-ini">${ini(P(x).n)}</span>${esc(P(x).n)}<em>${tyGroups(x).length}</em></button>`).join('')}
    </div>
    <section class="h-card wc-sheet" id="wc-ty" aria-label="Thank-yous">
      <div class="wc-filters"><div class="wc-lanes" role="tablist">${['s', 'l', 'o'].map((k) => `<button type="button" class="wc-lane${S.ty.lane === k ? ' is-on' : ''}" data-tylane="${k}">${LANE[k][0]}<span>${sec[k].length}</span></button>`).join('')}</div>
        <div class="wc-tools"><button type="button" class="h-btn h-btn--ghost h-btn--sm wc-phonly" data-cball>Select all</button>${S.ty.lane === 's' && L.length ? `<button class="h-btn h-btn--primary h-btn--sm" data-tycloseall="s">${ic('check')}Close all ${L.length}</button>` : ''}</div></div>
      <div class="wc-lanehead"><p>${LANE[S.ty.lane][1]}</p></div>
      <div class="wc-scroll" role="grid" aria-multiselectable="true">
        ${L.length ? `<div class="wc-head wc-tg" role="row"><div class="wc-cb" data-cball><input type="checkbox" aria-label="Select every row" /></div><span>Partner</span><span>Task</span><span>${S.ty.lane === 'o' ? 'Owed' : 'Logged after the task'}</span><span></span></div>
        <div class="wc-tg">${L.map(rowT).join('')}</div>` : `<div class="wc-empty"><b>Nothing here</b>${gs.length ? 'Pick another lane above.' : 'Every thank-you task for this person is closed.'}</div>`}
      </div>
      <div class="wc-foot"><span>${plural(L.length, 'row')} · ${plural(L.reduce((n, g) => n + g.ids.length, 0), 'open task')} in Blackbaud</span><span class="wc-keys"><span><kbd>Shift</kbd>click a range</span><span><kbd>Esc</kbd>clear</span></span></div>
    </section>`;
  refreshSel();
}
function tyIds(keys) { return [].concat(...keys.map((k) => (S.tyMap[k] ? S.tyMap[k].ids : [k]))).filter((id) => BYID[id] && isOpenNow(BYID[id])); }

// ------------------------------------------------------------ Stale
function viewStale() {
  const base = ACTS.filter(isOpenNow);
  const lane = LANES.find((l) => l.k === S.st.lane);
  const list = sorted(base.filter(lane.test));
  S.list = list.map((a) => a.id);
  const big = list.filter((a) => a.gift && a.gift.a >= 1000);
  $('#view').innerHTML = `
    <div class="wc-lanecards">${LANES.map((l) => `<button type="button" class="wc-lc${l.k === S.st.lane ? ' is-on' : ''}" data-stl="${l.k}"><b>${base.filter(l.test).length}</b><span>${l.n}</span><small>${l.hint}</small></button>`).join('')}</div>
    <section class="h-card wc-sheet" id="wc-stale"><div class="wc-lanehead"><p><b>${esc(lane.n)}.</b> ${esc(lane.hint)}${big.length ? ` ${plural(big.length, 'task')} here ${big.length === 1 ? 'is' : 'are'} about a gift of $1,000 or more and ${big.length === 1 ? 'is' : 'are'} left out of Select all; pick ${big.length === 1 ? 'it' : 'them'} by hand.` : ''}</p>
      ${S.st.lane === 'left' ? `<button class="h-btn h-btn--primary h-btn--sm" data-stbulk="holder">${ic('user')}Give all to current holders</button>` : ['year', '90', 'none'].includes(S.st.lane) ? `<button class="h-btn h-btn--ghost h-btn--sm" data-stbulk="close">${ic('check')}Close all as no longer needed</button>` : ''}</div>
      ${tableHTML(list, base.length, 's')}</section>`;
  afterTable('s', list);
  bar();
}

// ------------------------------------------------------------ Recent
async function loadRecent() { try { S.batches = (await api('/api/work/recent')).batches; } catch (_) { /* the list keeps what it had */ } }
function viewRecent() {
  const bs = S.batches;
  $('#view').innerHTML = `${bs.length ? `<div class="wc-batches">${bs.map((b) => {
    const status = b.undone ? 'Undone' : b.tonight ? `${b.tonight} go to Blackbaud tonight` : b.failed ? `${b.posted} in Blackbaud · ${b.failed} did not go through` : b.queued ? `${b.posted} in Blackbaud · ${b.queued} sending` : `${b.posted} in Blackbaud`;
    const tomorrow = et(b.undo_until, { hour: 'numeric', minute: '2-digit' });
    return `<article class="h-card wc-batch${S.openB === b.id ? ' is-open' : ''}"><div class="wc-batch__head"><span class="wc-batch__icon${b.undone ? ' undone' : b.failed ? ' fail' : ''}">${ic(b.undone ? 'undo' : b.failed ? 'alert' : b.op === 'reassign' ? 'user' : b.op === 'reschedule' ? 'cal' : 'check')}</span>
      <div><b>${esc(b.label)}</b><span>${esc(b.actor)} · ${esc(et(b.at, { hour: 'numeric', minute: '2-digit' }))} ${et(b.at, { month: 'numeric', day: 'numeric' }) === et(now(), { month: 'numeric', day: 'numeric' }) ? 'today' : 'on ' + esc(et(b.at, { month: 'short', day: 'numeric' }))} · ${status} · ${plural(b.calls, 'Blackbaud call')}</span></div>
      <div class="wc-batch__acts">${b.failed && !b.undone ? `<button class="h-btn h-btn--primary h-btn--sm" data-retry="${b.id}">Try ${b.failed} again</button>` : ''}
        ${b.undone ? '' : `<button class="h-btn h-btn--ghost h-btn--sm" data-undo="${b.id}">${ic('undo')}Undo</button><small>until ${esc(tomorrow)} ${et(b.undo_until, { month: 'numeric', day: 'numeric' }) === et(now(), { month: 'numeric', day: 'numeric' }) ? 'today' : 'tomorrow'}</small>`}
        <button class="wc-clear" data-openb="${b.id}">${S.openB === b.id ? 'Hide' : 'Show'} ${b.items.length}</button></div></div>
      <ul>${b.items.map((it) => `<li><b>${esc(it.name)}</b><span>${esc(it.what)}</span><span class="wc-state wc-state--${({ posted: 'ready', failed: 'fail', tonight: 'pick', saving: 'dup', undone: 'dup', queued: 'pick' })[it.state] || 'dup'}">${({ posted: 'In Blackbaud', failed: 'Not sent', tonight: 'Tonight', saving: 'Sending', undone: 'Undone', queued: 'Waiting' })[it.state] || it.state}</span></li>`).join('')}</ul></article>`; }).join('')}</div>`
    : `<div class="h-card wc-empty"><b>Nothing done here yet today</b>What you finish in the Work Center lands here, with Undo for 24 hours.</div>`}`;
}

// ------------------------------------------------------------ settings (admins)
async function dlgSettings() {
  let cfg, staff;
  try { [cfg, staff] = await Promise.all([api('/api/work/settings'), api('/api/work/staff')]); } catch (e) { toast(e.message); return; }
  const s = cfg.settings; let rows = staff.staff;
  const draw = (el) => {
    el.innerHTML = `<div class="wc-dlg__head"><div><h2>Work Center settings</h2><p>Who can open it, and how it sends to Blackbaud.</p></div><button class="wc-dlg__x" data-closelayer aria-label="Close">${ic('x')}</button></div>
      <div class="wc-dlg__body">
        <div class="wc-field"><span class="lab">Who can open the Work Center</span><div class="wc-choices">${[['admins', 'Admins only'], ['support', 'Admins and everyone listed below']].map(([k, l]) => `<button type="button" class="wc-choice${s.release === k ? ' is-on' : ''}" data-set="release" data-v="${k}">${l}</button>`).join('')}</div>
          <small>Everyone below with Work Center ticked opens it, and the team they are on sets what they see and may change.</small></div>
        <div class="wc-field"><span class="lab">Sending to Blackbaud</span><div class="wc-choices">${[['on', 'On'], ['off', 'Off, save only']].map(([k, l]) => `<button type="button" class="wc-choice${s.posting === k ? ' is-on' : ''}" data-set="posting" data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="wc-field"><span class="lab">A thank-you is recorded as</span><div class="wc-choices">${[['one', 'One record (the task itself)'], ['two', 'The task plus its own record']].map(([k, l]) => `<button type="button" class="wc-choice${s.thank_mode === k ? ' is-on' : ''}" data-set="thank_mode" data-v="${k}">${l}</button>`).join('')}</div></div>
        <div class="wc-field"><span class="lab">The people</span>
          <div class="wc-staff">${rows.map((r) => `<div class="wc-staffrow"><b>${esc(r.name)}</b><span>${esc(r.email)} · ${esc(r.team)}</span>
            <label><input type="checkbox" data-staff="${esc(r.email)}" data-k="work_center" ${r.work_center ? 'checked' : ''}/> Work Center</label>
            <label><input type="checkbox" data-staff="${esc(r.email)}" data-k="entry_owner" ${r.entry_owner ? 'checked' : ''}/> Entry chip</label></div>`).join('') || '<small>No one is listed yet.</small>'}</div></div>
      </div>
      <div class="wc-dlg__foot"><span class="wc-cost"></span><button class="h-btn h-btn--primary" data-closelayer>Done</button></div>`;
  };
  dialog('', (el) => {
    draw(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-set]'); if (!b) return;
      try { const out = await post('/api/work/settings', { [b.dataset.set]: b.dataset.v }); Object.assign(s, out.settings); if (b.dataset.set === 'release') S.gate.release = out.settings.release; draw(el); } catch (err) { toast(err.message); }
    });
    el.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-staff]'); if (!c) return;
      const r = rows.find((x) => x.email === c.dataset.staff); r[c.dataset.k] = c.checked ? 1 : 0;
      try { const out = await post('/api/work/staff', r); rows = out.staff; } catch (err) { toast(err.message); }
    });
  });
}

// ------------------------------------------------------------ render + events
function centerOn(sel) { $$(sel).forEach((c) => { const on = $('.is-on', c); if (on && c.scrollWidth > c.clientWidth) c.scrollLeft = on.offsetLeft - (c.clientWidth - on.offsetWidth) / 2; }); }
function render() { if (!S.loaded) return; const y = window.scrollY; const sc = $('#view .wc-scroll'); const st = sc ? sc.scrollTop : 0; page(); window.scrollTo(0, y); const sc2 = $('#view .wc-scroll'); if (sc2) sc2.scrollTop = st; centerOn('.wc-tabs, .wc-owners, .wc-lanes'); }
function countUp() { $$('[data-countup]').forEach((el) => { const n = Number(el.dataset.countup); if (S.counted) { el.textContent = n.toLocaleString(); return; } const t0 = performance.now(); const f = (t) => { const p = Math.min(1, (t - t0) / 650); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))).toLocaleString(); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }); S.counted = true; }
// Re-read the lists from the hub (which lays its own pending changes over Blackbaud's copy) without disturbing what the person is doing.
let refreshing = false;
async function refreshBoard() {
  if (refreshing) return; refreshing = true;
  try {
    const keepGone = Object.assign({}, S.gone);
    const [b] = await Promise.all([api('/api/work/board?limit=3000'), S.in.data ? loadEntry() : Promise.resolve()]);
    takeBoard(b);
    void keepGone;
    if (!document.querySelector('.wc-dlg, .wc-drawer') && !S.running && !drag) render();
  } catch (_) { /* the page keeps what it has */ } finally { refreshing = false; }
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a'); if (!t) return;
  if (!t.closest('#wc-root, #layer, #toast, #bar, #wc-pop')) return;
  const d = t.dataset;
  if (t.matches('a[href="#"]')) e.preventDefault();
  if (t.hasAttribute('data-reload')) { init(); return; }
  if (t.hasAttribute('data-closelayer')) { closeLayer(); return; }
  if (t.hasAttribute('data-settings')) { dlgSettings(); return; }
  if (d.view) {
    S.view = d.view; S.sel.clear(); S.anchor = null; S.shown = 100;
    if (d.view === 'intake' && !S.in.data) { S.in.loading = true; render(); await loadEntry(); }
    if (d.view === 'intake') readSheet(S.in.rdd);
    if (d.view === 'recent') await loadRecent();
    render(); return;
  }
  if (d.quick !== undefined && t.hasAttribute('data-quick')) { S.f.quick = S.f.quick === d.quick ? '' : d.quick; S.sel.clear(); render(); return; }
  if (d.unf) { if (d.unf === 'all') S.f = { fr: '', type: '', cat: '', due: '', q: '', cid: '', theirs: false, quick: '' }; else { S.f[d.unf] = d.unf === 'theirs' ? false : ''; if (d.unf === 'fr') S.f.theirs = false; } render(); return; }
  if (d.sort) { if (S.sort === d.sort) S.dir = -S.dir; else { S.sort = d.sort; S.dir = d.sort === 'partner' || d.sort === 'fr' ? 1 : -1; } render(); return; }
  if (t.hasAttribute('data-more')) { S.shown += 100; render(); return; }
  if (d.open) { drawer(d.open); return; }
  if (d.onlypartner) { S.f.cid = d.onlypartner; S.view = 'open'; closeLayer(); render(); return; }
  if (d.one) { const id = d.id; closeLayer(); setTimeout(() => ({ complete: dlgComplete, reassign: dlgReassign, reschedule: dlgReschedule })[d.one]([id]), 240); return; }
  if (d.do) {
    if (d.do === 'clear') { clearSel(); return; }
    if (S.view === 'intake') {
      const rs = visibleIntake().filter((r) => S.sel.has(r.id));
      if (d.do === 'post') postRows(rs);
      if (d.do === 'skip') { rs.forEach((r) => editRow(r.id, { local: { state: 'skipped' }, server: { skip: true } })); S.sel.clear(); render(); toast(`Skipped ${plural(rs.length, 'row')}. They stay on the sheet.`); }
      if (d.do === 'setdate') { const v = prompt('Date for the selected rows (YYYY-MM-DD)', TODAY); if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) { rs.forEach((r) => editRow(r.id, { local: { date: v }, server: { contact_date: v } })); render(); } }
      return;
    }
    const ids = S.view === 'ty' ? tyIds([...S.sel]) : selIds();
    const own = { complete: () => dlgComplete(ids, S.view === 'ty' && S.tyMode === 'close' ? 'close' : undefined), reassign: () => dlgReassign(ids), reschedule: () => dlgReschedule(ids) }[d.do];
    if (own) own(); else if (window.WCEdit && window.WCEdit.act[d.do]) window.WCEdit.act[d.do](ids);
    return;
  }
  if (d.undo) { undoBatch(d.undo); return; }
  if (d.openb) { S.openB = S.openB === d.openb ? null : d.openb; render(); return; }
  if (d.retry) { retryBatch(d.retry); return; }
  // Entry
  if (t.hasAttribute('data-reentry')) { S.in.loading = true; render(); await loadEntry(); render(); return; }
  if (d.rdd) { S.sel.clear(); S.in.rdd = d.rdd; S.in.loading = true; await loadEntry(d.rdd); const w = weekCounts(d.rdd); S.in.lane = w.wait ? 'wait' : w.late ? 'late' : 'all'; render(); readSheet(d.rdd); return; }
  if (d.lane) { S.in.lane = d.lane; S.sel.clear(); render(); return; }
  if (t.hasAttribute('data-readsheet')) { t.disabled = true; await readSheet(S.in.rdd, true, true); t.disabled = false; return; }
  if (t.hasAttribute('data-paste')) { S.in.paste = !S.in.paste; render(); if (S.in.paste) $('#pastebox').focus(); return; }
  if (t.hasAttribute('data-readpaste')) {
    const text = $('#pastebox').value; if (!text.trim()) { toast('Copy whole rows from the sheet first, then paste them here.'); return; }
    t.disabled = true;
    try {
      const res = await post('/api/work/entry/paste', { owner: S.in.rdd, text });
      S.in.paste = false; S.in.lane = 'all'; await loadEntry(); render();
      const n = res.added.length;
      toast(n ? `Read ${plural(n, 'row')}${res.skipped ? `. ${res.skipped} were already here and were skipped` : ''}.` : res.skipped ? `All ${res.skipped} rows are already here. Nothing was added twice.` : 'No rows found. Copy whole rows from the sheet.');
    } catch (err) { t.disabled = false; toast(err.message); }
    return;
  }
  if (t.hasAttribute('data-many')) { dlgMany(); return; }
  if (t.hasAttribute('data-postall')) { postRows(visibleIntake()); return; }
  if (d.pick) { editRow(d.pick, { local: { cid: d.cid, how: 'picked', cands: [] }, server: { constituent_id: d.cid } }); render(); return; }
  if (d.unpick) { editRow(d.unpick, { local: { cid: null, how: 'none' }, server: { constituent_id: null } }); render(); setTimeout(() => { const i = $(`[data-ta="${d.unpick}"]`); if (i) i.focus(); }, 30); return; }
  if (d.rch) { const r = inRow(d.rch); const v = r.ch === d.v ? '' : d.v; editRow(d.rch, { local: { ch: v }, server: { channel: v } }); render(); return; }
  if (d.rtag) { const r = inRow(d.rtag); const tags = r.tags.includes(d.v) ? r.tags.filter((x) => x !== d.v) : r.tags.concat([d.v]); editRow(d.rtag, { local: { tags }, server: { tags } }); t.classList.toggle('is-on'); return; }
  if (d.tapick) { closePop(); editRow(d.tapick, { local: { cid: d.cid, how: 'picked', cands: [] }, server: { constituent_id: d.cid } }); render(); return; }
  // Thank-yous
  if (d.tylane) { S.ty.lane = d.tylane; S.sel.clear(); render(); return; }
  if (d.owner !== undefined && t.hasAttribute('data-owner')) { S.ty.owner = d.owner; S.ty.lane = ''; S.sel.clear(); render(); return; }
  if (d.tycloseall) { const keys = S.list.filter((k) => S.tyMap[k] && S.tyMap[k].later && S.tyMap[k].later.k === 's'); dlgComplete(tyIds(keys), 'close'); return; }
  if (d.tyclose) { dlgComplete(tyIds([d.tyclose]), S.ty.lane === 's' ? 'close' : undefined); return; }
  if (d.tydone) { dlgComplete(tyIds([d.tydone])); return; }
  // Stale
  if (d.stl) { S.st.lane = d.stl; S.sel.clear(); S.shown = 100; render(); return; }
  if (d.stbulk) { const pick = S.list.filter((id) => !(BYID[id].gift && BYID[id].gift.a >= 1000)).filter(selectable); if (d.stbulk === 'holder') dlgReassign(pick); else { dlgComplete(pick); setTimeout(() => { const l = $('#line'); if (l) { l.value = 'Closed as no longer needed'; l.dispatchEvent(new Event('input', { bubbles: true })); } }, 60); } return; }
  // filters sheet (phone)
  if (t.hasAttribute('data-openfilters')) { $('#filters').classList.add('is-sheet'); return; }
  if (t.hasAttribute('data-closefilters')) { $('#filters').classList.remove('is-sheet'); return; }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#wc-root')) return;
  if (t.dataset.f) { S.f[t.dataset.f] = t.value; if (t.dataset.f === 'fr' && !t.value) S.f.theirs = false; S.sel.clear(); S.shown = 100; const sheet = !!$('#filters.is-sheet'); render(); if (sheet) $('#filters').classList.add('is-sheet'); return; }
  if (t.hasAttribute('data-theirs')) { S.f.theirs = t.checked; S.sel.clear(); const sheet = !!$('#filters.is-sheet'); render(); if (sheet) $('#filters').classList.add('is-sheet'); return; }
  if (t.dataset.rdate) { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) editRow(t.dataset.rdate, { local: { date: t.value }, server: { contact_date: t.value } }); return; }
});
let qT, taT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#wc-root')) return;
  if (t.id === 'q') { clearTimeout(qT); qT = setTimeout(() => { S.f.q = t.value; S.sel.clear(); render(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 160); return; }
  if (t.dataset.rsum) { editRow(t.dataset.rsum, { local: { sum: t.value }, server: { summary: t.value } }, true); return; }
  if (t.dataset.rask) { editRow(t.dataset.rask, { local: { ask: t.value }, server: { ask_amount: t.value } }, true); return; }
  if (t.dataset.ta) {
    const k = t.dataset.ta; const v = norm(t.value);
    clearTimeout(taT);
    if (v.length < 2) { closePop(); return; }
    taT = setTimeout(async () => {
      let hits = [];
      try { hits = await searchPartners(t.value, S.in.rdd); } catch (_) { /* no list */ }
      openPop(t, hits.length ? hits.map((h) => `<button type="button" data-tapick="${k}" data-cid="${h.cid}">${esc(h.name)}<span>${esc(h.place || 'no city')} · ${esc(h.lookup)}${h.holders.length ? ' · ' + h.holders.map((x) => esc(P(x).n)).join(', ') : ''}</span></button>`).join('') : '<button type="button" disabled>No partner by that name. Add the record in Blackbaud, then find it here.</button>');
    }, 220);
  }
});
document.addEventListener('focusin', (e) => { if (e.target.dataset && e.target.dataset.ta && e.target.value.length > 1) e.target.dispatchEvent(new Event('input', { bubbles: true })); });
document.addEventListener('click', (e) => { if (!e.target.closest('.wc-ta, #wc-pop')) closePop(); }, true);
window.addEventListener('scroll', closePop, true);
setInterval(() => { const c = $('#clock'); if (!c || !S.in.data) return; const dl = Math.max(0, Date.parse(S.in.data.deadline.iso) - Date.now()); c.innerHTML = `${Math.floor(dl / 86400000)}<small>d</small> ${Math.floor(dl % 86400000 / 3600000)}<small>h</small> ${Math.floor(dl % 3600000 / 60000)}<small>m</small>`; }, 15000);

// ------------------------------------------------------------ shared with the edit panel (work-edit.js)
window.WC = {
  api, post, S, esc, ic, I, fd, plural, money, addDays, dayn, lateClass, P, live, gone, cur, render, runJob, driveBatch, toast, refreshBoard, loadRecent,
  closeLayer, dialog, reqId, selIds, dlgComplete, dlgReassign, dlgReschedule, sorted, clearSel, bar, undoBatch, guardTab, matches, isOpenNow, refreshSel, meterHTML, CAT_IC,
  get ACTS() { return ACTS; }, get BYID() { return BYID; }, get DATA() { return DATA; }, mayAssign, get TODAY() { return TODAY; }, AS,
};

// ------------------------------------------------------------ start
async function init() {
  document.documentElement.classList.add('wc-page');
  // The bar, the toast and the dialogs are fixed on screen, so they live on the body, outside the frame's blurred sheet.
  ['bar', 'toast', 'layer'].forEach((id) => { const el = document.getElementById(id); if (el && el.parentElement !== document.body) document.body.appendChild(el); });
  const bar0 = $('#bar'); new MutationObserver(() => document.body.classList.toggle('has-bar', bar0.classList.contains('is-on'))).observe(bar0, { attributes: true, attributeFilter: ['class'] });
  skeleton();
  try { S.gate = await api('/api/work/gate'); } catch (e) { errorScreen(e.message); return; }
  if (!S.gate.open) { gateScreen(S.gate); return; }
  try {
    const [b, rc] = await Promise.all([api('/api/work/board?limit=3000'), api('/api/work/recent')]);
    takeBoard(b); S.batches = rc.batches; S.loaded = true;
    const v = QS.get('view'); if (v && ['open', 'intake', 'ty', 'stale', 'recent', 'opps', ...extraTabs().map((t) => t.k)].includes(v)) S.view = v;
    if (window.WCEdit) await window.WCEdit.start();
    if (S.view === 'intake') { S.in.loading = true; render(); await loadEntry(); readSheet(S.in.rdd); }
    render();
    // A batch sent from a window that closed picks up here.
    const stuck = S.batches.find((x) => x.run_when === 'now' && (x.state === 'running' || x.state === 'queued') && !x.undone);
    if (stuck && stuck.queued) { const ids = stuck.items.filter((i) => i.state === 'saving').map((i) => i.id); bar('Finishing what was sent…'); driveBatch(stuck.id, ids.length ? ids : ['x'], { keep: true }).then(async () => { await loadRecent(); refreshBoard(); }); }
  } catch (e) { errorScreen(e.status === 403 ? e.message : 'The hub could not read Blackbaud\'s copy right now. ' + e.message); }
}
init();
})();
