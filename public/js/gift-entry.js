/* Gift entry from a photo. Admins and the people an admin gave access. Reads /api/gift-entry/*.
   Photograph the checks and reply slips, review each gift beside its photo, press Approve, Hold or Reject, then send the deposit to
   Blackbaud as an unapproved batch (only for people an admin switched on). Keys in the queue: A approve, H hold, R reject, J and K move, E amount. */
(() => {
'use strict';
const root = document.getElementById('ge-root');
if (!root) return;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const moneyS = (c) => (c < 0 ? '-' : '') + money(Math.abs(c));
const UI = window.FavorUI || {};
const day = (iso) => (UI.day ? UI.day(iso) : iso);
const when = (iso) => (UI.when ? UI.when(iso) : iso);
const ic = (p) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const I = {
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  back: '<path d="M15 5 8 12l7 7"/>', send: '<path d="M4 12 20 4l-4 16-4-6z"/>',
};

async function api(path, opts = {}) {
  const headers = Object.assign({ 'X-Hub-Request': '1' }, opts.headers || {});
  if (opts.body && !(opts.body instanceof Blob) && typeof opts.body !== 'string') { opts.body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'signin') { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Sign in again.'); }
  if (!res.ok || data.ok === false) { const e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}
const post = (p, b) => api(p, { method: 'POST', body: b || {} });
const patch = (p, b) => api(p, { method: 'PATCH', body: b || {} });
const put = (p, b) => api(p, { method: 'PUT', body: b || {} });

let toastT = 0;
function toast(msg) { const t = $('#ge-toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('is-on'), 3200); }

const S = { me: null, second: 0, today: '', list: [], summary: null, dates: [], sumDate: '', view: null, id: new URLSearchParams(location.search).get('d') || '', cur: '', catalog: null, queue: [], poll: 0, busy: false, form: { kind: 'regular' }, ask: '', photo: 0 };

function setUrl(id) { S.id = id || ''; history.replaceState(null, '', id ? '/gift-entry/?d=' + encodeURIComponent(id) : '/gift-entry/'); }
const dep = () => S.view && S.view.deposit;
const open = () => dep() && dep().status === 'open';

// ---------------------------------------------------------------- home
const STATUS = { open: ['Taking photos', 'warn'], sending: ['Sending', 'warn'], created: ['Waiting for approval in Blackbaud', ''], committed: ['Approved in Blackbaud', 'ok'], needs_person: ['Needs a person', 'bad'] };
function pill(s) { const [t, c] = STATUS[s] || [s, '']; return `<span class="ge-pill${c ? ' ge-pill--' + c : ''}">${esc(t)}</span>`; }

async function home() {
  stopPoll(); S.view = null; S.cur = '';
  const d = await api('/api/gift-entry');
  S.list = d.deposits; S.me = d.me; S.second = d.second || 0; S.today = d.today;
  await loadSummary(S.sumDate || '');
  S.needs = (await api('/api/gift-entry/needs-coding').catch(() => ({ items: [] }))).items;
  paintHome();
}
async function loadSummary(date) {
  const d = await api('/api/gift-entry/summary' + (date ? '?date=' + encodeURIComponent(date) : ''));
  S.summary = d.summary; S.dates = d.dates || []; S.sumDate = d.summary.date;
}
function paintHome() {
  const rows = S.list.map((x) => `<a class="ge-dep" href="/gift-entry/?d=${esc(x.id)}" data-open="${esc(x.id)}">
      <b>${esc(x.name)}</b><span class="f">${x.gifts} of ${x.tape_count} photographed · ${esc(money(x.tape_cents))} on the tape · ${esc(x.created_by)}</span>
      <span class="r">${pill(x.status)}<span class="a ge-money">${money(x.cents)}</span></span></a>`).join('');
  root.innerHTML = `<section class="h-card ge-card"><div class="ge-hd"><h2>Mail deposits</h2><span class="sp"></span>
      ${S.me && S.me.admin ? '<button class="ge-link" data-people>People</button>' : ''}<button class="ge-btn ge-btn--primary" data-new>${ic(I.plus)}New deposit</button></div>
      <div>${rows || '<div class="ge-empty">No deposits yet.</div>'}</div></section>
    ${needsCard()}${summaryCard()}`;
}
function needsCard() {
  const n = S.needs || [];
  if (!n.length) return '';
  return `<section class="h-card ge-card"><div class="ge-hd"><h2>Needs coding</h2><span class="sp"></span><span class="ge-muted">${n.length} coded White Mail</span></div>
    ${n.slice(0, 20).map((x) => `<div class="ge-sumrow"><b>${esc(x.partner || 'Gift ' + x.seq)}</b><span class="f">${esc(x.deposit.name)} · ${esc(x.reason)}${x.suggestions.length ? ' · ' + esc(x.suggestions.map((y) => y.code + ' (' + y.reason + ')').join('; ')) : ''}</span><span class="a ge-money">${money(x.amountCents)}</span></div>`).join('')}</section>`;
}
function summaryCard() {
  const s = S.summary;
  if (!s) return '';
  const t = s.totals;
  const dates = Array.from(new Set([s.date].concat(S.dates)));
  const sel = `<select class="ge-select" data-sumdate aria-label="Day">${dates.map((x) => `<option value="${esc(x)}"${x === s.date ? ' selected' : ''}>${esc(day(x))}</option>`).join('')}</select>`;
  if (!s.deposits.length) return `<section class="h-card ge-card"><div class="ge-hd"><h2>Day summary</h2><span class="sp"></span>${sel}</div><div class="ge-empty">No deposits on ${esc(day(s.date))}.</div></section>`;
  const offCents = t.diffCents, offCount = t.diffCount;
  return `<section class="h-card ge-card"><div class="ge-hd"><h2>Day summary</h2>${s.ties ? '<span class="ge-pill ge-pill--ok">Ties to the tape</span>' : '<span class="ge-pill ge-pill--warn">Open items</span>'}<span class="sp"></span>${sel}</div>
    <div class="ge-tiles"><div class="ge-tile"><span class="n ge-money">${money(t.tapeCents)}</span><span class="l">Tape, ${t.tapeCount} items</span></div>
      <div class="ge-tile ${offCents || offCount ? 'is-bad' : 'is-ok'}"><span class="n ge-money">${money(t.enteredCents)}</span><span class="l">Entered, ${t.enteredCount} items${offCents ? ' · ' + moneyS(offCents) : ''}</span></div>
      <div class="ge-tile"><span class="n ge-money">${money(t.approvedCents)}</span><span class="l">Approved, ${t.approvedCount} items</span></div></div>
    ${s.open.length ? `<ul class="ge-open">${s.open.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="ge-sumrows">${s.deposits.map((d) => `<div class="ge-sumrow"><b>${esc(d.name)}</b><span class="f">${d.enteredCount} of ${d.tapeCount} · ${d.approvers.length ? 'approved by ' + esc(d.approvers.map(nameOf).join(', ')) : 'not approved'}${d.heldCount ? ' · ' + d.heldCount + ' held' : ''}${d.rejectedCount ? ' · ' + d.rejectedCount + ' rejected, ' + money(d.rejectedCents) : ''}${d.batch ? ' · batch ' + esc(d.batch) : ''}</span><span class="a ge-money">${money(d.enteredCents)}</span></div>`).join('')}</div></section>`;
}
const nameOf = (email) => (UI.person ? UI.person(email) : String(email).split('@')[0]);

// ---------------------------------------------------------------- set up
function setup() {
  stopPoll();
  const f = S.form;
  root.innerHTML = `<div><button class="ge-link" data-home>${ic(I.back)}Gift entry</button></div>
    <section class="h-card ge-card"><div class="ge-hd"><h2>New deposit</h2></div><form class="ge-form" id="ge-setup">
      <div class="ge-seg" role="group" aria-label="Kind of mail">${[['regular', 'Regular'], ['acquisition', 'Acquisition'], ['grant', 'Grant']].map(([k, l]) => `<button type="button" data-kind="${k}" class="${f.kind === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
      <label>Deposit date<input type="date" name="date" value="${esc(f.date || S.today)}" max="${esc(S.today)}" required></label>
      <div class="ge-row2"><label>Tape total<input name="tapeTotal" inputmode="decimal" placeholder="11,335.00" value="${esc(f.tapeTotal || '')}" required></label>
        <label>Items on the tape<input name="tapeCount" inputmode="numeric" placeholder="14" value="${esc(f.tapeCount || '')}" required></label></div>
      <div id="ge-err" class="ge-err" hidden></div>
      <div><button class="ge-btn ge-btn--primary" type="submit">Start photographing</button></div></form></section>`;
}

// ---------------------------------------------------------------- one deposit
async function load(id) { const v = await api('/api/gift-entry/deposits/' + encodeURIComponent(id)); S.view = v; return v; }
async function catalog() { if (!S.catalog) S.catalog = await api('/api/gift-entry/catalog'); return S.catalog; }
const rows = () => (S.view ? S.view.rows : []);
const cur = () => rows().find((r) => r.id === S.cur) || null;

/* a row's state for the rail: ok (approved), look (needs a look), bad (problem), hold */
function stateOf(r) {
  if (r.status === 'held') return 'hold';
  if (r.status === 'failed' || r.card || (r.dup && r.dup.decision === null)) return 'bad';
  if (r.status === 'sent' || r.status === 'by_hand') return 'ok';
  if (r.confirmed && !r.blockers.length) return 'ok';
  return 'look';
}
const needsLook = (r) => stateOf(r) !== 'ok';

function tapeStrip(v) {
  const t = v.tape, ties = t.matches;
  const off = t.diffCount !== 0 ? Math.abs(t.diffCount) + (t.diffCount < 0 ? ' short' : ' over') : moneyS(t.diffCents);
  return `<section class="h-card ge-card"><div class="ge-tape"><div class="ge-tile"><span class="n ge-money">${money(t.tapeCents)}</span><span class="l">Tape, ${t.tapeCount} items</span></div>
    <div class="ge-tile ${ties ? 'is-ok' : t.count ? 'is-bad' : ''}"><span class="n ge-money">${money(t.cents)}</span><span class="l">Photographed, ${t.count} items</span></div>
    <div class="ge-tile ${ties ? 'is-ok' : ''}"><span class="n">${ties ? 'Matches' : esc(off)}</span><span class="l">${ties ? 'Total and count' : 'Against the tape'}</span></div>
    <span class="sp"></span><div class="acts">${open() ? `<button class="ge-link ge-link--red" data-discard>Throw away</button>` : ''}</div></div></section>`;
}
function captureCard() {
  const q = S.queue.filter((x) => x.state !== 'done');
  return `<section class="h-card ge-card" id="ge-drop"><div class="ge-cap"><button class="ge-btn ge-btn--primary" data-cam>${ic(I.cam)}Take photos</button>
      <label class="ge-btn" style="cursor:pointer">${ic(I.img)}Choose photos<input type="file" accept="image/*" multiple hidden data-pick></label>
      <button class="ge-btn" data-addcash>${ic(I.plus)}Cash row</button><span class="sp"></span><span class="ge-muted">Drop scans here</span></div>
    <div class="ge-queue" id="ge-queue">${queueHtml(q)}</div></section>`;
}
const queueHtml = (q) => q.map((x, i) => `<span class="${x.state === 'error' ? 'err' : ''}" data-retryq="${i}">${esc(x.label)}: ${x.state === 'error' ? esc(x.err) + ' (tap to retry)' : x.state === 'sending' ? 'reading' : 'waiting'}</span>`).join('');

function rail(v) {
  if (!v.rows.length) return '';
  return `<div class="ge-rail" role="tablist" aria-label="Gifts in this deposit">${v.rows.map((r, i) => `<button class="ge-chip is-${stateOf(r)}${r.id === S.cur ? ' is-cur' : ''}" data-row="${esc(r.id)}" role="tab" aria-selected="${r.id === S.cur}" title="${esc((r.payer || 'Gift ' + r.seq) + (r.amountCents != null ? ' ' + money(r.amountCents) : ''))}"><i></i>${i + 1}</button>`).join('')}</div>`;
}
function counts(v) {
  const a = v.rows.filter((r) => stateOf(r) === 'ok').length, h = v.rows.filter((r) => r.status === 'held').length, l = v.rows.length - a - h;
  return `<span class="ge-muted">${a} approved · ${l} to review${h ? ' · ' + h + ' on hold' : ''}</span>`;
}

function dotFor(r, key) {
  const c = r.conf && r.conf[key];
  if (!c) return '';
  if (key === 'appeal' || key === 'designation') return '';
  const t = { high: 'The two readers agree', medium: 'One reader, or no second check', low: 'The readers disagree or nothing was read' }[c];
  return `<i class="ge-dot is-${c}" title="${esc(t)}"></i>`;
}
const flagged = (r, n) => (r.flags.includes(n) && !r.confirmed ? ' is-flag' : '');
const whyOf = (r, n) => (r.flags.includes(n) && !r.confirmed && r.why[n] ? `<span class="ge-why">${esc(r.why[n])}</span>` : '');
function appealReason(r) {
  const c = r.coding || {};
  if (!c.reason) return '';
  const sug = (c.suggestions || []).map((x) => `<button class="ge-cand" data-sug="${esc(x.appealId)}" data-n="${esc(x.name)}" data-why="${esc(x.reason)}" ${open() ? '' : 'disabled'}>${esc(x.code)}<small>${esc(x.reason)}</small></button>`).join('');
  return `<span class="ge-src">${esc(c.reason)}</span>${c.needs && sug ? `<div class="ge-cands" aria-label="Suggestions, not decided">${sug}</div>` : ''}`;
}
const FSRC = { slip: 'Reply slip', letter: 'Letter', expected: 'Expected gift', memo: 'Memo' };

function pane(r, v) {
  const lock = open() ? '' : 'disabled';
  const cands = r.candidates.filter((c) => !(r.partner && r.partner.id === c.cid)).map((c) => `<button class="ge-cand" data-pickp="${esc(c.cid)}" data-n="${esc(c.name)}" data-p="${esc(c.place)}" data-l="${esc(c.lookup)}" ${lock}>${esc(c.name)}<small>${esc(c.place || '')}${c.exact ? ' · same name' : ''}${c.addr ? ' · same address' : ''}</small></button>`).join('');
  const d = r.defaults || {};
  const second = r.needsSecond;
  const fundList = S.catalog ? S.catalog.funds.map((f) => `<option value="${esc(f.name)}"></option>`).join('') : '';
  const appealList = S.catalog ? S.catalog.appeals.map((a) => `<option value="${esc(a.code + ' · ' + a.name)}"></option>`).join('') : '';
  const readers = (r.readers || []).map((x) => `<div><b>${esc(x.reader === 'scout' ? 'Reader A' : 'Reader B')}</b><span>${x.fields ? esc([x.fields.payer, x.fields.amountCents != null ? money(x.fields.amountCents) : null, x.fields.checkNumber && 'no. ' + x.fields.checkNumber, x.fields.checkDate, x.fields.memo && 'memo: ' + x.fields.memo, x.fields.slipAppeal && 'slip: ' + x.fields.slipAppeal].filter(Boolean).join(' · ') || 'nothing read') : esc(x.error || 'no answer')}</span></div>`).join('');
  const tags = [];
  if (r.ruleLabel) tags.push(`<span class="ge-pill">Photo goes to Blackbaud · ${esc(r.ruleLabel)}</span>`);
  if (r.prayer) tags.push('<span class="ge-pill ge-pill--warn">Prayer request</span>');
  if (r.kind === 'cash') tags.push('<span class="ge-pill">Cash</span>');
  const who = r.partner
    ? `<div class="ge-who"><b>${esc(r.partner.name)}</b><span>${esc(r.partner.place || '')}${r.partner.lookup ? ' · ' + esc(r.partner.lookup) : ''}</span></div>`
    : `<div class="ge-note ge-note--red">No partner matched yet.</div>`;
  const approval = r.confirmed
    ? `Approved by ${esc(nameOf(r.confirmedBy))}${r.confirmedAt ? ', ' + esc(when(r.confirmedAt)) : ''}${r.secondDone ? ' · second by ' + esc(nameOf(r.secondBy)) : ''}`
    : '';
  return `<div class="ge-pane" data-pane="${esc(r.id)}">
    ${r.card ? '<div class="ge-note ge-note--red">A card number showed in the photo. The photo was not kept. Use Add gift on the partner record, then reject this row.</div>' : ''}
    ${r.dup ? `<div class="ge-note ge-note--red"><b>${esc(r.dup.message)}</b>${r.dup.decision === null && open() ? '<div class="acts"><button class="ge-btn" data-act="dup_remove">Remove this row</button><button class="ge-btn" data-act="dup_keep">Different gift, keep it</button></div>' : r.dup.decision === 'keep' ? '<span>Kept as a different gift.</span>' : ''}</div>` : ''}
    ${r.error ? `<div class="ge-note ge-note--red">${esc(r.error)}${r.status === 'failed' && open() === false ? '<div class="acts"><button class="ge-btn" data-act="by_hand">Entered by hand in Blackbaud</button></div>' : ''}</div>` : ''}
    ${r.held ? `<div class="ge-note"><b>On hold</b><span>${esc(r.held.reason || '')} · ${esc(r.held.by || '')}</span>${open() ? '<div class="acts"><button class="ge-btn" data-act="release">Take off hold</button></div>' : ''}</div>` : ''}
    <div class="ge-field"><label>Partner ${r.partner ? dotFor(r, 'payer') : ''}</label>${who}
      ${cands ? `<div class="ge-cands">${cands}</div>` : ''}
      <input class="ge-input" id="ge-ps" placeholder="Search by name, street, phone or email" autocomplete="off" ${lock}><div class="ge-opts" id="ge-pr" hidden></div>
      ${r.address ? `<span class="ge-src">Address on the check: ${esc(r.address)}</span>` : ''}</div>
    <div class="ge-row2">
      <div class="ge-field${flagged(r, 'amount')}"><label for="gf-amount">Amount ${dotFor(r, 'amount')}</label><input id="gf-amount" inputmode="decimal" value="${r.amountCents != null ? (r.amountCents / 100).toFixed(2) : ''}" ${lock}>${whyOf(r, 'amount')}</div>
      ${r.kind === 'check' ? `<div class="ge-field${flagged(r, 'number')}"><label for="gf-number">Check number ${dotFor(r, 'number')}</label><input id="gf-number" value="${esc(r.checkNumber || '')}" ${lock}>${whyOf(r, 'number')}</div>` : '<div></div>'}</div>
    <div class="ge-row2">
      ${r.kind === 'check' ? `<div class="ge-field${flagged(r, 'date')}"><label for="gf-cdate">Check date ${dotFor(r, 'date')}</label><input id="gf-cdate" type="date" value="${esc(r.checkDate || '')}" ${lock}>${whyOf(r, 'date')}</div>` : '<div></div>'}
      <div class="ge-field"><label for="gf-gdate">Gift date</label><input id="gf-gdate" type="date" value="${esc(r.giftDate || '')}" ${lock}></div></div>
    ${r.kind === 'check' ? `<div class="ge-field${flagged(r, 'payer')}"><label for="gf-payer">Name on the check ${dotFor(r, 'payer')}</label><input id="gf-payer" value="${esc(r.payer || '')}" ${lock}>${whyOf(r, 'payer')}</div>` : ''}
    <div class="ge-row2 ge-row2--stack">
      <div class="ge-field"><label for="gf-fund">Fund ${dotFor(r, 'designation')}</label><input id="gf-fund" list="ge-funds" value="${esc(r.fund ? r.fund.name : '')}" autocomplete="off" ${lock}><datalist id="ge-funds">${fundList}</datalist>${d.fundSource && FSRC[d.fundSource] ? `<span class="ge-src">From the ${esc(FSRC[d.fundSource].toLowerCase())}</span>` : ''}</div>
      <div class="ge-field"><label for="gf-appeal">Appeal ${dotFor(r, 'appeal')}</label><input id="gf-appeal" list="ge-appeals" value="${esc(r.appeal ? r.appeal.name : '')}" placeholder="Search appeals" autocomplete="off" ${lock}><datalist id="ge-appeals">${appealList}</datalist>${appealReason(r)}</div></div>
    <div class="ge-field${flagged(r, 'memo')}"><label for="gf-memo">Memo ${dotFor(r, 'memo')}</label><textarea id="gf-memo" ${lock}>${esc(r.memo || '')}</textarea>${whyOf(r, 'memo')}</div>
    ${r.rule === 'giving_fund' || r.soft ? `<div class="ge-field"><label>Recommended by (soft credit)</label>${r.soft ? `<div class="ge-who"><b>${esc(r.soft.name)}</b></div>` : '<div class="ge-note">Name who recommended this gift, or choose No partner named.</div>'}
        <input class="ge-input" id="ge-sp" placeholder="Search for the recommending partner" autocomplete="off" ${lock}><div class="ge-opts" id="ge-sr" hidden></div><div><button class="ge-btn" data-nosoft ${lock}>No partner named</button></div></div>` : ''}
    ${tags.length ? `<div class="ge-tags">${tags.join('')}</div>` : ''}
    ${open() ? actionBar(r, second) : ''}
    ${approval ? `<span class="ge-src">${approval}</span>` : ''}
    <details class="ge-details"><summary>What each reader saw</summary><div class="ge-read" style="margin-top:8px">${readers || '<span class="ge-muted">Nothing was read.</span>'}</div>
      <div class="ge-acts">${open() && r.images[0] ? '<button class="ge-btn" data-reread>Read the photo again</button>' : ''}${open() && r.kind === 'check' ? [['slip', 'Reply slip'], ['envelope', 'Reply envelope'], ['letter', 'Letter']].map(([k, l]) => `<label class="ge-btn" style="cursor:pointer">${l}<input type="file" accept="image/*" hidden data-enc="${k}"></label>`).join('') : ''}</div></details>
  </div>`;
}
function actionBar(r, second) {
  if (S.ask === 'hold' || S.ask === 'reject') {
    const hold = S.ask === 'hold';
    return `<div class="ge-reason"><input class="ge-input" id="ge-reason" placeholder="${hold ? 'Why is it on hold' : 'Why is it rejected'}" maxlength="200" autocomplete="off"><button class="ge-btn${hold ? '' : ' ge-btn--red'}" data-reason-go="${S.ask}">${hold ? 'Hold' : 'Reject'}</button><button class="ge-link" data-reason-no>Cancel</button></div>`;
  }
  const me = S.me && S.me.email ? S.me.email.toLowerCase() : '';
  const needs2 = r.confirmed && second && !r.secondDone;
  const blocks = r.blockers.filter((b) => !/Looks right|second person/.test(b));
  let primary;
  if (needs2) primary = r.confirmedBy && r.confirmedBy.toLowerCase() === me ? `<button class="ge-btn ge-btn--primary" disabled>Needs a second person</button>` : `<button class="ge-btn ge-btn--primary" data-act="approve2">${ic(I.check)}Approve as second</button>`;
  else if (r.confirmed && !r.blockers.length) primary = `<button class="ge-btn" data-act="unconfirm">Undo approval</button>`;
  else primary = `<button class="ge-btn ge-btn--primary" data-act="approve" ${blocks.length ? 'disabled' : ''}>${ic(I.check)}Approve</button>`;
  return `<div class="ge-acts">${primary}<button class="ge-btn" data-ask="hold">Hold</button><button class="ge-btn ge-btn--red" data-ask="reject">Reject</button>${blocks.length ? `<span class="ge-why">${esc(blocks[0])}</span>` : ''}</div>`;
}

function postCard(v) {
  const canPost = S.me && S.me.canPost;
  const ok = v.canSend.ok;
  const why = ok ? '' : v.canSend.why.slice(0, 3).join(' ');
  return `<section class="h-card ge-card"><div class="ge-hd"><h2>Send to Blackbaud</h2><span class="sp"></span><span class="ge-muted">${v.tape.count} gifts · ${money(v.tape.cents)}</span></div>
    <div class="ge-post"><button class="ge-btn ge-btn--primary" data-send ${ok && canPost ? '' : 'disabled'}>${ic(I.send)}Send ${v.tape.count} gifts</button>
      ${!canPost ? '<span class="ge-muted">Posting is not switched on</span>' : !ok ? `<span class="ge-muted">${esc(why)}</span>` : ''}</div></section>`;
}

function rejectedLine(v) {
  if (!v.rejected || !v.rejected.length) return '';
  return `<section class="h-card ge-card"><div class="ge-hd"><h2>Rejected</h2><span class="sp"></span><span class="ge-muted">${v.rejected.length} · ${money(v.rejected.reduce((s, x) => s + (x.amountCents || 0), 0))}</span></div>
    ${v.rejected.map((x) => `<div class="ge-sumrow"><b>${esc(x.payer || 'Gift ' + x.seq)}</b><span class="f">${esc(x.reason)} · ${esc(nameOf(x.by || ''))}</span><span class="a ge-money">${x.amountCents != null ? money(x.amountCents) : ''}</span></div>`).join('')}</section>`;
}

async function deposit() {
  const v = S.view;
  if (!v) return;
  if (v.deposit.status !== 'open') return status();
  stopPoll();
  if (!S.catalog) catalog().then(() => { if (S.view === v && cur()) paintReview(); }).catch(() => {});
  if (!cur()) S.cur = (v.rows.find(needsLook) || v.rows[0] || {}).id || '';
  root.innerHTML = `<div><button class="ge-link" data-home>${ic(I.back)}Gift entry</button></div>${tapeStrip(v)}${captureCard()}
    <section class="h-card ge-card" id="ge-review"></section><div id="ge-postcard">${postCard(v)}</div><div id="ge-rejected">${rejectedLine(v)}</div>`;
  paintReview();
}
function paintReview() {
  const el = $('#ge-review'); if (!el) return;
  const v = S.view, r = cur();
  if (!v.rows.length) { el.innerHTML = '<div class="ge-hd"><h2>Review</h2></div><div class="ge-empty">No photos yet.</div>'; return; }
  const idx = v.rows.findIndex((x) => x.id === S.cur) + 1;
  const img = r && r.images[0];
  const thumbs = r && r.images.length > 1 ? `<div class="ge-thumbs">${r.images.map((m, i) => `<img src="/api/gift-entry/images/${esc(m.id)}" alt="Photo ${i + 1}" data-ph="${i}" class="${i === S.photo ? 'is-cur' : ''}">`).join('')}</div>` : '';
  const shown = r && r.images[S.photo] ? r.images[S.photo] : img;
  el.innerHTML = `<div class="ge-hd"><h2>Review ${idx} of ${v.rows.length}</h2>${counts(v)}<span class="sp"></span><span class="ge-keys"><kbd>A</kbd> approve <kbd>H</kbd> hold <kbd>R</kbd> reject <kbd>J</kbd> <kbd>K</kbd> move</span></div>${rail(v)}
    ${r ? `<div class="ge-review"><div>${shown ? `<img class="ge-photo" data-zoom src="/api/gift-entry/images/${esc(shown.id)}" alt="Photo of the item">` : '<div class="ge-photo-empty">No photo for this row</div>'}${thumbs}</div>${pane(r, v)}</div>` : ''}`;
  const rc = $('.ge-chip.is-cur', el); if (rc && rc.scrollIntoView) rc.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (S.ask) { const ri = $('#ge-reason'); if (ri) ri.focus(); }
}
function move(delta) {
  const list = rows(); if (!list.length) return;
  let i = list.findIndex((x) => x.id === S.cur); i = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + delta));
  S.cur = list[i].id; S.ask = ''; S.photo = 0; paintReview();
}
function nextLook(fromId) {
  const list = rows(); const i = list.findIndex((x) => x.id === fromId);
  const after = list.slice(i + 1).find(needsLook) || list.find((x) => x.id !== fromId && needsLook(x));
  return after ? after.id : '';
}

async function save(id, set, action, extra) {
  try {
    const out = await patch('/api/gift-entry/gifts/' + encodeURIComponent(id), Object.assign({ set, action }, extra || {}));
    S.view = Object.assign({}, S.view, out.view);
    return true;
  } catch (e) { toast(e.message); return false; }
}
async function act(id, action, extra) {
  const wasCur = id === S.cur;
  const ok = await save(id, null, action, extra);
  if (!ok) return;
  S.ask = '';
  if (wasCur && (action === 'approve' || action === 'approve2' || action === 'hold' || action === 'reject')) { const n = nextLook(id); if (n) { S.cur = n; S.photo = 0; } else if (action === 'reject') S.cur = (rows()[0] || {}).id || ''; }
  repaint();
}
function repaint() { if (!open()) return status(); const t = $('.ge-tape', root); const card = t && t.closest('section'); if (card) card.outerHTML = tapeStrip(S.view); paintReview(); const pc = $('#ge-postcard'); if (pc) pc.innerHTML = postCard(S.view); const rj = $('#ge-rejected'); if (rj) rj.innerHTML = rejectedLine(S.view); }

// ---------------------------------------------------------------- the batch
function stopPoll() { clearInterval(S.poll); S.poll = 0; }
function startPoll() {
  stopPoll();
  S.poll = setInterval(async () => {
    if (document.hidden || S.busy || !S.view) return;
    const st = S.view.deposit.status;
    if (st === 'open' || st === 'needs_person') return;
    await run(true);
  }, 60000);
}
async function run(quiet) {
  if (S.busy) return;
  S.busy = true;
  try { S.view = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/run' + (quiet ? '' : '?force=1')); status(); }
  catch (e) { if (!quiet) toast(e.message); } finally { S.busy = false; }
}
const ET_TIME = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
function status() {
  const v = S.view, d = v.deposit;
  const gifts = v.rows.filter((r) => r.status !== 'by_hand');
  const steps = (v.steps && v.steps.steps) || [];
  const batchStep = steps.find((s) => s.op === 'batch');
  const giftSteps = steps.filter((s) => s.op.startsWith('gifts:'));
  const failed = v.rows.filter((r) => r.status === 'failed');
  const waitStep = steps.find((s) => s.status === 'waiting');
  const retrying = steps.find((s) => s.status === 'queued' && s.attempts > 0);
  const sentAll = giftSteps.length && giftSteps.every((s) => s.status === 'done');
  const created = ['created', 'committed'].includes(d.status), committed = d.status === 'committed';
  const a = v.attachments;
  const tl = [
    { t: 'Gifts approved', s: `${v.rows.length} gifts · ${money(v.tape.cents)} · entered by ${esc(d.createdBy)}`, k: 'done' },
    { t: d.batchNumber ? 'Batch ' + esc(d.batchNumber) : 'Batch in Blackbaud', s: batchStep && batchStep.status === 'done' ? 'Created unapproved' : waitStep ? 'Waiting for the daily limit to reset' : retrying ? 'Trying again at ' + esc(ET_TIME(retrying.next_try_at)) : 'Creating', k: batchStep && batchStep.status === 'done' ? 'done' : d.status === 'needs_person' ? 'bad' : 'now' },
    { t: 'Gifts in the batch', s: sentAll ? `${v.rows.filter((r) => r.status === 'sent').length} of ${gifts.length}${failed.length ? ' · ' + failed.length + ' need a person' : ''}` : 'Sending', k: sentAll && !failed.length ? 'done' : failed.length ? 'bad' : batchStep && batchStep.status === 'done' ? 'now' : '' },
    { t: committed ? 'Approved in Blackbaud' : 'Approval in Blackbaud', s: committed ? esc(ET_TIME(d.committedAt)) : created ? 'Unapproved' + (d.lastPolledAt ? ' · checked ' + esc(ET_TIME(d.lastPolledAt)) : '') : '', k: committed ? 'done' : created ? 'now' : '' },
    { t: 'Photos on the gifts', s: a.planned ? `${a.done} of ${a.planned}${a.failed ? ' · ' + a.failed + ' failed' : ''}` : 'None needed', k: committed && a.done === a.planned ? 'done' : committed && a.planned ? 'now' : '' },
  ];
  const wm = v.watch && v.watch.mismatch;
  const canUndo = S.me && S.me.canPost && !committed && ['created', 'needs_person', 'sending'].includes(d.status);
  root.innerHTML = `<div><button class="ge-link" data-home>${ic(I.back)}Gift entry</button></div>
    <section class="h-card ge-card"><div class="ge-hd"><h2>${esc(d.name)}</h2>${pill(d.status)}<span class="sp"></span>${d.status === 'needs_person' && S.me.canPost ? '<button class="ge-btn ge-btn--primary" data-retry>Try again</button>' : ''}<button class="ge-link" data-refresh>Check now</button>${canUndo ? '<button class="ge-link ge-link--red" data-undo>Take batch back</button>' : ''}</div>
      <div class="ge-muted ge-money">${money(d.tapeCents)} · ${d.tapeCount} items${d.undoneAt ? ' · taken back ' + esc(ET_TIME(d.undoneAt)) + ' by ' + esc(d.undoneBy) + ': ' + esc(d.undoneReason) : ''}</div>
      ${d.note ? `<div class="ge-note ge-note--red" style="margin-top:12px">${esc(d.note)}</div>` : ''}${wm ? `<div class="ge-note" style="margin-top:12px">${esc(wm)}</div>` : ''}
      <div class="ge-steps" style="margin-top:8px">${tl.map((x, i) => `<div class="ge-step is-${x.k}"><span class="d">${x.k === 'done' ? ic(I.check) : i + 1}</span><div><b>${x.t}</b><span>${x.s}</span></div></div>`).join('')}</div></section>
    <section class="h-card ge-card"><div class="ge-hd"><h2>Gifts</h2><span class="sp"></span><span class="ge-muted">${v.rows.length} · ${money(v.tape.cents)}</span></div>
      ${v.rows.map((r) => `<div class="ge-sumrow"><b>${esc(r.payer || 'Gift ' + r.seq)}</b><span class="f">${esc(r.partner ? r.partner.name : 'No partner')} · ${esc(r.status === 'sent' ? 'In the batch' : r.status === 'failed' ? 'Needs a person' : r.status === 'by_hand' ? 'Enter by hand' : r.status)}${r.confirmedBy ? ' · approved by ' + esc(nameOf(r.confirmedBy)) : ''}${r.error ? ' · ' + esc(r.error) : ''}</span><span class="a ge-money">${money(r.amountCents)}</span></div>`).join('')}</section>
    ${rejectedLine(v)}`;
  if (['sending', 'created', 'committed'].includes(d.status)) startPoll(); else stopPoll();
}

// ---------------------------------------------------------------- camera and the upload queue
async function sharp(canvas) {
  const w = 160, h = Math.max(1, Math.round((canvas.height / canvas.width) * 160));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data; const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  let s = 0, s2 = 0, n = 0;
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const v = 4 * g[j * w + i] - g[j * w + i - 1] - g[j * w + i + 1] - g[(j - 1) * w + i] - g[(j + 1) * w + i]; s += v; s2 += v * v; n++; }
  const mean = s / n; return s2 / n - mean * mean;
}
async function toJpeg(source, w, h) {
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  const blur = await sharp(c);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  return { blob, blur, url: URL.createObjectURL(blob) };
}
async function fileToJpeg(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (bmp) return toJpeg(bmp, bmp.width, bmp.height);
  const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
  return toJpeg(img, img.naturalWidth, img.naturalHeight);
}
let stream = null;
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser has no live camera. Use Choose photos.'); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }); }
  catch (e) { toast('The camera did not open. Use Choose photos.'); return; }
  $('#ge-layer').innerHTML = `<div class="ge-cam"><div class="ge-cam__top"><button data-camclose>Done</button><span id="ge-camcount"></span><span style="width:60px"></span></div>
    <div class="ge-cam__view"><video autoplay playsinline muted></video><div class="ge-cam__guide"></div><div class="ge-cam__msg" id="ge-cammsg">One check or slip in the frame</div></div>
    <div class="ge-cam__bar"><div class="ge-cam__strip" id="ge-camstrip"></div><button class="ge-shutter" data-shutter aria-label="Take the photo"></button><span style="width:60px"></span></div></div>`;
  const v = $('#ge-layer video'); v.srcObject = stream; await v.play().catch(() => {});
  camCount();
}
function camCount() { const n = (S.view ? S.view.tape.count : 0) + S.queue.filter((x) => x.state !== 'done').length; const el = $('#ge-camcount'); if (el) el.textContent = n + ' of ' + (S.view ? S.view.deposit.tapeCount : '') + ' items'; }
function closeCamera() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('#ge-layer').innerHTML = ''; deposit(); }
async function shutter() {
  const v = $('#ge-layer video'); if (!v || !v.videoWidth) return;
  const shot = await toJpeg(v, v.videoWidth, v.videoHeight);
  if (shot.blur < 25) { $('#ge-cammsg').textContent = 'Blurry. Hold still and take it again'; return; }
  const strip = $('#ge-camstrip'); const im = document.createElement('img'); im.src = shot.url; strip.appendChild(im); strip.scrollLeft = strip.scrollWidth;
  enqueue(shot.blob, 'Photo ' + (S.queue.length + 1));
  $('#ge-cammsg').textContent = 'Saved';
}
function enqueue(blob, label, kind, gift) { S.queue.push({ blob, label, state: 'waiting', tries: 0, kind: kind || 'check_front', gift: gift || '' }); pump(); camCount(); }
let pumping = 0;
async function pump() {
  if (pumping >= 2) return;
  const item = S.queue.find((x) => x.state === 'waiting');
  if (!item) { if (!pumping) await refresh(); return; }
  item.state = 'sending'; pumping++; paintQueue();
  try {
    const out = await api('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/photos?kind=' + item.kind + (item.gift ? '&gift=' + encodeURIComponent(item.gift) : ''), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: item.blob });
    item.state = 'done';
    if (out.status === 'skipped') toast('That photo was an envelope and was skipped.'); else if (out.status === 'retake') toast('That photo is unreadable. Take it again.');
  } catch (e) {
    item.tries++;
    if (item.tries < 3 && (e.status == null || e.status >= 500 || e.name === 'TypeError')) { item.state = 'waiting'; await new Promise((r) => setTimeout(r, 1500 * item.tries)); }
    else { item.state = 'error'; item.err = e.message; }
  } finally { pumping--; }
  S.queue = S.queue.filter((x) => x.state !== 'done');
  paintQueue(); await refresh();
  pump();
}
function paintQueue() { const q = $('#ge-queue'); if (q) q.innerHTML = queueHtml(S.queue.filter((x) => x.state !== 'done')); }
async function refresh() {
  if (!S.id) return;
  try {
    const keep = S.cur; await load(S.id); S.cur = keep;
    if ($('#ge-layer .ge-cam')) { camCount(); return; }
    if (S.view.deposit.status === 'open') { if (!$('#ge-review')) deposit(); else repaint(); } else status();
  } catch (e) { /* keep what is on screen */ }
}
async function addFiles(files) {
  for (const f of files) { try { const j = await fileToJpeg(f); enqueue(j.blob, (f.name || 'Photo').slice(0, 18)); } catch (er) { toast('Could not open ' + f.name); } }
}

// ---------------------------------------------------------------- events
async function openDeposit() {
  try { await load(S.id); } catch (e) { toast(e.message); setUrl(''); return home(); }
  S.cur = ''; S.ask = ''; S.photo = 0;
  if (S.view.deposit.status === 'open') deposit(); else { status(); run(true); }
}
root.addEventListener('click', async (e) => {
  const t = e.target.closest('button,a,[data-zoom],[data-ph],[data-retryq]');
  if (!t) return;
  if (t.matches('[data-home]')) { e.preventDefault(); setUrl(''); await home(); return; }
  if (t.matches('[data-open]')) { e.preventDefault(); setUrl(t.dataset.open); await openDeposit(); return; }
  if (t.matches('[data-new]')) { setUrl(''); setup(); return; }
  if (t.matches('#ge-setup [data-kind]')) { S.form.kind = t.dataset.kind; $$('#ge-setup [data-kind]').forEach((b) => b.classList.toggle('is-on', b === t)); return; }
  if (t.matches('[data-people]')) { people(); return; }
  if (t.matches('[data-row]')) { S.cur = t.dataset.row; S.ask = ''; S.photo = 0; paintReview(); return; }
  if (t.matches('[data-ph]')) { S.photo = Number(t.dataset.ph); paintReview(); return; }
  if (t.matches('[data-zoom]')) { t.classList.toggle('is-big'); return; }
  if (t.matches('[data-cam]')) { openCamera(); return; }
  if (t.matches('[data-retryq]')) { const items = S.queue.filter((x) => x.state !== 'done'); const it = items[Number(t.dataset.retryq)]; if (it) { it.state = 'waiting'; it.tries = 0; pump(); } return; }
  if (t.matches('[data-addcash]')) { const v = prompt('Cash amount in dollars'); if (v) await addCash(v); return; }
  if (t.matches('[data-send]')) { await sendDeposit(); return; }
  if (t.matches('[data-discard]')) { if (confirm('Throw away this deposit and its rows?')) { await api('/api/gift-entry/deposits/' + encodeURIComponent(S.id), { method: 'DELETE' }); setUrl(''); await home(); } return; }
  if (t.matches('[data-retry]')) { try { await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/retry'); await run(); } catch (er) { toast(er.message); } return; }
  if (t.matches('[data-refresh]')) { await run(); return; }
  if (t.matches('[data-undo]')) { await undo(); return; }
  const r = cur();
  if (!r) return;
  if (t.matches('[data-act]')) { await act(r.id, t.dataset.act); return; }
  if (t.matches('[data-ask]')) { S.ask = t.dataset.ask; paintReview(); return; }
  if (t.matches('[data-reason-no]')) { S.ask = ''; paintReview(); return; }
  if (t.matches('[data-reason-go]')) { const v = ($('#ge-reason') || {}).value || ''; if (!v.trim()) { toast('Say why first.'); return; } await act(r.id, t.dataset.reasonGo, { reason: v }); return; }
  if (t.matches('[data-sug]')) { await save(r.id, { appeal_id: t.dataset.sug, appeal_name: t.dataset.n }); repaint(); return; }
  if (t.matches('[data-pickp]')) { await pickPartner(r, t.dataset.pickp, t.dataset.n, t.dataset.p, t.dataset.l); return; }
  if (t.matches('[data-nosoft]')) { await save(r.id, { soft_partner_id: null, soft_partner_name: 'No partner named' }); repaint(); return; }
  if (t.matches('[data-reread]')) { toast('Reading the photo again'); try { const out = await post('/api/gift-entry/gifts/' + encodeURIComponent(r.id) + '/reread'); S.view = Object.assign({}, S.view, out.view); repaint(); } catch (er) { toast(er.message); } return; }
});
async function pickPartner(r, cid, name, place, lookup) {
  await save(r.id, { partner_id: cid, partner_name: name, partner_place: place, partner_lookup: lookup });
  const last = await api('/api/gift-entry/partners?coding=' + encodeURIComponent(cid)).catch(() => null);
  const now = cur();
  if (last && last.last && now && !now.appeal) await save(r.id, { appeal_id: last.last.appealId });
  repaint();
}
root.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-pick]')) { const files = Array.from(t.files || []); t.value = ''; await addFiles(files); return; }
  if (t.matches('[data-enc]')) { const r = cur(); const kind = t.dataset.enc; const files = Array.from(t.files || []); t.value = ''; for (const f of files) { if (r) { try { const j = await fileToJpeg(f); enqueue(j.blob, { slip: 'Reply slip', envelope: 'Reply envelope', letter: 'Letter' }[kind], kind, r.id); } catch (er) { toast('Could not open that photo.'); } } } return; }
  if (t.matches('[data-sumdate]')) { await loadSummary(t.value); paintHome(); return; }
  const r = cur(); if (!r || !t.id) return;
  const num = (v) => Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);
  const go = async (set) => { if (await save(r.id, set)) repaint(); };
  if (t.id === 'gf-amount') go({ amount_cents: num(t.value) });
  else if (t.id === 'gf-number') go({ check_number: t.value.trim() });
  else if (t.id === 'gf-cdate') go({ check_date: t.value });
  else if (t.id === 'gf-gdate') go({ gift_date: t.value });
  else if (t.id === 'gf-payer') go({ payer: t.value.trim() });
  else if (t.id === 'gf-memo') go({ memo: t.value.trim() });
  else if (t.id === 'gf-fund') { await catalog(); const f = S.catalog.funds.find((x) => x.name === t.value); if (f) go({ fund_id: f.id, fund_name: f.name }); else toast('Pick a fund from the list.'); }
  else if (t.id === 'gf-appeal') { await catalog(); const a = S.catalog.appeals.find((x) => (x.code + ' · ' + x.name) === t.value || x.name === t.value); if (a) go({ appeal_id: a.id, appeal_name: a.name }); else if (t.value) toast('Pick an appeal from the list.'); }
});
let typeT = 0;
root.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id !== 'ge-ps' && t.id !== 'ge-sp') return;
  clearTimeout(typeT);
  typeT = setTimeout(async () => {
    const box = t.id === 'ge-ps' ? $('#ge-pr') : $('#ge-sr'); const q = t.value.trim();
    if (!box) return;
    if (q.length < 2) { box.hidden = true; return; }
    try {
      const d = await api('/api/gift-entry/partners?q=' + encodeURIComponent(q)); box.hidden = false; const k = t.id === 'ge-ps' ? 'pickp' : 'picks';
      box.innerHTML = d.hits.length ? d.hits.map((h) => `<button data-${k}="${esc(h.cid)}" data-n="${esc(h.name)}" data-p="${esc(h.place)}" data-l="${esc(h.lookup)}">${esc(h.name)}<small>${esc(h.place)} · ${esc(h.lookup)}</small></button>`).join('') : '<button disabled>No partner found</button>';
    } catch (er) { toast(er.message); }
  }, 250);
});
root.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-picks]'); if (!b) return;
  const r = cur(); if (!r) return;
  await save(r.id, { soft_partner_id: b.dataset.picks, soft_partner_name: b.dataset.n }); repaint();
});
root.addEventListener('submit', async (e) => {
  if (!e.target.matches('#ge-setup')) return;
  e.preventDefault();
  const f = new FormData(e.target); const err = $('#ge-err');
  S.form = { kind: S.form.kind, date: f.get('date'), tapeTotal: f.get('tapeTotal'), tapeCount: f.get('tapeCount') };
  try {
    const out = await post('/api/gift-entry', { kind: S.form.kind, date: S.form.date, tapeTotal: String(S.form.tapeTotal).replace(/[$,\s]/g, ''), tapeCount: S.form.tapeCount });
    if (out.sameDayExists && !confirm('A ' + S.form.kind + ' deposit for that date already exists. Start another one anyway?')) return;
    setUrl(out.deposit.id); S.form = { kind: S.form.kind }; await openDeposit();
  } catch (er) { err.hidden = false; err.textContent = er.message; }
});

// drop scans
['dragenter', 'dragover'].forEach((n) => root.addEventListener(n, (e) => { const z = e.target.closest('#ge-drop'); if (z && open()) { e.preventDefault(); $('.ge-cap', z).classList.add('is-drop'); } }));
['dragleave', 'drop'].forEach((n) => root.addEventListener(n, (e) => { const z = e.target.closest('#ge-drop'); if (z) { const c = $('.ge-cap', z); if (c) c.classList.remove('is-drop'); } }));
root.addEventListener('drop', async (e) => { const z = e.target.closest('#ge-drop'); if (!z || !open()) return; e.preventDefault(); await addFiles(Array.from(e.dataTransfer.files || []).filter((f) => /^image\//.test(f.type))); });

// keys in the queue
document.addEventListener('keydown', (e) => {
  if (!open() || !$('#ge-review') || $('#ge-layer .ge-cam') || $('.ge-dlg')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (typing) { if (e.key === 'Escape' && S.ask) { S.ask = ''; paintReview(); } else if (e.key === 'Enter' && e.target.id === 'ge-reason') { const b = $('[data-reason-go]'); if (b) b.click(); } return; }
  const r = cur(); if (!r) return;
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'enter') { const b = $('[data-act="approve"]') || $('[data-act="approve2"]'); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
  else if (k === 'h') { e.preventDefault(); S.ask = 'hold'; paintReview(); }
  else if (k === 'r') { e.preventDefault(); S.ask = 'reject'; paintReview(); }
  else if (k === 'j' || k === 'arrowright' || k === 'arrowdown') { e.preventDefault(); move(1); }
  else if (k === 'k' || k === 'arrowleft' || k === 'arrowup') { e.preventDefault(); move(-1); }
  else if (k === 'e') { const a = $('#gf-amount'); if (a) { e.preventDefault(); a.focus(); a.select(); } }
});

async function addCash(v) {
  const cents = Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);
  if (!cents || cents < 1) { toast('Enter the cash amount in dollars.'); return; }
  try { const out = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/cash', { amountCents: cents }); await refresh(); S.cur = out.giftId; repaint(); } catch (e) { toast(e.message); }
}
async function sendDeposit() {
  const v = S.view; if (!v.canSend.ok) return;
  if (!confirm('Create the unapproved batch in Blackbaud with ' + v.tape.count + ' gifts and ' + money(v.tape.cents) + '?')) return;
  try { await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/send'); S.view = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/run'); status(); } catch (e) { toast(e.message); await load(S.id).catch(() => {}); if (S.view && open()) repaint(); }
}
async function undo() {
  const reason = prompt('Why are you taking the batch back?');
  if (!reason || !reason.trim()) return;
  try { const out = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/undo', { reason }); S.view = out; toast('Batch ' + (out.undone.batch || '') + ' taken back'); await load(S.id); deposit(); } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- people (admins)
async function people() {
  let d;
  try { d = await api('/api/gift-entry/settings'); } catch (e) { toast(e.message); return; }
  const layer = $('#ge-layer');
  const rowsHtml = d.people.map((p) => `<div class="ge-p"><b>${esc(p.name)}</b><span class="f">${p.role === 'admin' ? 'Admin' : 'Access given'}</span>
      <label><input type="checkbox" data-pp="posting" data-email="${esc(p.email)}" ${p.posting ? 'checked' : ''}>Sends to Blackbaud</label>
      ${p.role === 'admin' ? '' : `<label><input type="checkbox" data-pp="access" data-email="${esc(p.email)}" ${p.access ? 'checked' : ''}>Opens</label>`}</div>`).join('');
  layer.innerHTML = `<div class="ge-back" data-x></div><div class="ge-dlg" role="dialog" aria-label="People"><h3>People</h3>
    <div class="ge-ppl">${rowsHtml || '<div class="ge-empty">No one yet.</div>'}</div>
    <div class="ge-row2"><select class="ge-input" id="ge-addp"><option value="">Add a person</option>${d.candidates.map((c) => `<option value="${esc(c.email)}">${esc(c.name)}</option>`).join('')}</select><button class="ge-btn" data-addp>Give access</button></div>
    <div class="ge-row2"><label class="ge-field"><span class="ge-muted">Second approval from, in dollars (0 is off)</span><input class="ge-input" id="ge-sec" inputmode="decimal" value="${d.second ? (d.second / 100).toFixed(2) : '0'}"></label><div style="align-self:end"><button class="ge-btn" data-sec>Save</button></div></div>
    <div><button class="ge-btn" data-x>Done</button></div></div>`;
}
$('#ge-layer').addEventListener('click', async (e) => {
  const t = e.target.closest('button,[data-x]'); if (!t) return;
  if (t.matches('[data-x]')) { $('#ge-layer').innerHTML = ''; return; }
  if (t.matches('[data-camclose]')) { closeCamera(); return; }
  if (t.matches('[data-shutter]')) { shutter(); return; }
  try {
    if (t.matches('[data-addp]')) { const v = $('#ge-addp').value; if (!v) return; await put('/api/gift-entry/settings', { email: v, access: true }); await people(); }
    else if (t.matches('[data-sec]')) { const out = await put('/api/gift-entry/settings', { secondDollars: Number(($('#ge-sec').value || '0').replace(/[$,\s]/g, '')) }); S.second = out.second; toast(out.second ? 'Second approval from ' + money(out.second) : 'Second approval is off'); }
  } catch (er) { toast(er.message); }
});
$('#ge-layer').addEventListener('change', async (e) => {
  const t = e.target; if (!t.matches('[data-pp]')) return;
  try { await put('/api/gift-entry/settings', { email: t.dataset.email, [t.dataset.pp]: t.checked }); await people(); } catch (er) { toast(er.message); await people(); }
});

(async () => {
  try {
    await home();
    if (S.id) await openDeposit();
  } catch (e) { root.innerHTML = '<section class="h-card ge-card"><div class="ge-empty">' + esc(e.message) + '</div></section>'; }
})();
})();
