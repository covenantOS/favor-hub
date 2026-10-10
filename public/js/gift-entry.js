/* Gift entry, the mail day. Admins only. Reads /api/gift-entry/*.
   Steps: set up the deposit with the tape, photograph each check, review every gift against the tape, create the batch in Blackbaud,
   watch it until Jennifer approves it there, then the photos for the rule gifts copy over. The hub never approves anything. */
(() => {
'use strict';
const root = document.getElementById('ge-root');
if (!root) return;
document.documentElement.classList.add('ge-page');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const moneyS = (c) => (c < 0 ? '-' : '') + money(Math.abs(c));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fd = (iso) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + ', ' + y; };
const fdShort = (iso) => { if (!iso) return ''; const [, m, d] = iso.slice(0, 10).split('-').map(Number); return m + '/' + d; };
const et = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ic = (p) => `<svg class="h-i" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const I = { check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14"/><path d="M5 12h14"/>', cam: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>', back: '<path d="M15 5 8 12l7 7"/>', x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>', send: '<path d="M4 12 20 4l-4 16-4-6z"/>', ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>' };

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

let toastT = 0;
function toast(msg) { const t = $('#ge-toast'); t.textContent = msg; t.classList.add('is-on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('is-on'), 3200); }

// ---------------------------------------------------------------- state
const S = { stage: 1, list: null, lane: null, today: '', view: null, id: new URLSearchParams(location.search).get('d') || '', filter: 'all', drawer: '', catalog: null, queue: [], poll: 0, busy: false, form: { kind: 'regular' } };

function setUrl(id) { S.id = id || ''; history.replaceState(null, '', id ? '/gift-entry/?d=' + encodeURIComponent(id) : '/gift-entry/'); }

// ---------------------------------------------------------------- lane
function meter() {
  const l = (S.view && S.view.lane) || S.lane || { calls: 0, cap: 400 };
  const pct = Math.min(100, Math.round((l.calls / l.cap) * 100));
  return `<span class="ge-pill ge-meter${l.calls >= (l.warnAt || 300) ? ' is-high' : ''}" title="Gift entry has its own lane of ${l.cap} Blackbaud calls a day. It never uses the website's share or the Work Center's."><span>Blackbaud calls today <b>${l.calls} of ${l.cap}</b></span><i style="--p:${pct}%"></i></span>`;
}

// ---------------------------------------------------------------- home
async function home() {
  stopPoll();
  const d = await api('/api/gift-entry');
  S.list = d.deposits; S.lane = d.lane; S.stage = d.stage || 1; S.today = d.today; S.view = null;
  const rows = d.deposits.map((x) => `<a class="ge-dep" href="/gift-entry/?d=${esc(x.id)}" data-open="${esc(x.id)}">
      <div class="t"><b>${esc(x.name)}</b><span>${x.gifts} of ${x.tape_count} photographed, tape ${money(x.tape_cents)}. Started by ${esc(x.created_by)}</span></div>
      ${statusBadge(x.status)}<span class="amt">${money(x.cents)}</span></a>`).join('');
  root.innerHTML = `<div class="ge-top"><p>Photograph each check from the mail, check every gift against the tape, and the hub creates the batch in Blackbaud. Jennifer approves it in Blackbaud the way she does now.</p><div>${meter()}</div></div>
    <section class="h-card"><div class="ge-cap"><b>Mail deposits</b><span class="sp"></span><button class="h-btn h-btn--primary" data-new>${ic(I.plus)}New mail deposit</button></div>
    <div class="ge-list">${rows || '<div class="ge-empty">No deposits yet. Press New mail deposit when the tape is ready.</div>'}</div></section>`;
}

function statusBadge(s) {
  const m = { open: ['Taking photos', 'gold'], sending: ['Sending to Blackbaud', 'gold'], created: ['Waiting for approval in Blackbaud', 'plain'], committed: ['Approved in Blackbaud', ''], needs_person: ['Needs a person', 'red'] };
  const [t, c] = m[s] || [s, 'plain'];
  return `<span class="ge-badge${c ? ' ge-badge--' + c : ''}">${esc(t)}</span>`;
}

// ---------------------------------------------------------------- step 1: set up
function setup() {
  stopPoll();
  const f = S.form;
  root.innerHTML = `<div class="ge-top"><div><a class="h-btn h-btn--ghost h-btn--sm" href="/gift-entry/" data-home>${ic(I.back)}Gift entry</a></div><div>${meter()}</div></div>
    <ol class="ge-steps"><li class="is-on"><b>1</b>Set up</li><li><b>2</b>Photos</li><li><b>3</b>Review</li><li><b>4</b>Blackbaud</li></ol>
    <section class="h-card"><form class="ge-form" id="ge-setup">
      <div><div class="ge-hint" style="margin-bottom:6px">Which mail is it?</div><div class="ge-seg" role="group" aria-label="Kind of mail">
        ${[['regular', 'Regular'], ['acquisition', 'Acquisition'], ['grant', 'Grant']].map(([k, l]) => `<button type="button" data-kind="${k}" class="${f.kind === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
        <div class="ge-hint" style="margin-top:6px">Regular and acquisition mail are separate deposits and separate batches.</div></div>
      <label>Deposit date<input type="date" name="date" value="${esc(f.date || S.today)}" max="${esc(S.today)}" required></label>
      <div class="ge-row2">
        <label>Tape total in dollars<input name="tapeTotal" inputmode="decimal" placeholder="11,335.00" value="${esc(f.tapeTotal || '')}" required></label>
        <label>Items on the tape<input name="tapeCount" inputmode="numeric" placeholder="14" value="${esc(f.tapeCount || '')}" required></label>
      </div>
      <div class="ge-hint">Add up the checks and cash on the adding machine first. The page will not send the batch until the gifts you photograph match this total and count. Cash goes in as its own row.</div>
      <div id="ge-err" class="ge-note ge-note--red" hidden></div>
      <div><button class="h-btn h-btn--primary" type="submit">Start photographing</button></div>
    </form></section>`;
}

// ---------------------------------------------------------------- the deposit page
async function load(id) {
  const v = await api('/api/gift-entry/deposits/' + encodeURIComponent(id));
  S.view = v;
  return v;
}

function stepsBar(st) {
  const idx = st === 'open' ? 2 : 4;
  const names = ['Set up', 'Photos and review', 'Blackbaud'];
  const now = st === 'open' ? 1 : 2;
  return `<ol class="ge-steps">${names.map((n, i) => `<li class="${i < now ? 'is-done' : i === now ? 'is-on' : ''}"><b>${i < now ? ic(I.check) : i + 1}</b>${n}</li>`).join('')}</ol>`;
}

function tapeBar(v) {
  const t = v.tape;
  const diff = t.diffCents;
  const dcls = diff === 0 && t.diffCount === 0 ? 'good' : 'bad';
  return `<section class="h-card ge-tape"><div><span class="n">${money(t.tapeCents)}</span><span class="l">Tape total, ${t.tapeCount} items</span></div>
    <div><span class="n">${money(t.cents)}</span><span class="l">Photographed, ${t.count} items</span></div>
    <div class="${dcls}"><span class="n">${diff === 0 && t.diffCount === 0 ? 'Matches' : moneyS(diff)}</span><span class="l">${diff === 0 && t.diffCount === 0 ? 'Total and count equal the tape' : t.diffCount !== 0 ? Math.abs(t.diffCount) + (t.diffCount < 0 ? ' short' : ' over') + ' on the count' : 'Against the tape'}</span></div>
    <span class="sp"></span>
    <div class="acts">${t.needLook ? `<span class="ge-badge ge-badge--gold">${t.needLook} need a look</span>` : ''}
      ${v.deposit.status === 'open' ? `<button class="h-btn" data-confirm-clean>Looks right for clean rows</button><button class="h-btn h-btn--primary" data-send ${v.canSend.ok && (S.stage || 1) >= 2 ? '' : 'disabled'}>${ic(I.send)}Create batch in Blackbaud</button>` : ''}</div></section>`;
}

function pills(r) {
  const out = [];
  if (r.status === 'reading') out.push('<span class="ge-badge ge-badge--gold">Reading</span>');
  if (r.card) out.push('<span class="ge-badge ge-badge--red">Card number, use Phone gift</span>');
  if (r.dup && r.dup.decision === null) out.push('<span class="ge-badge ge-badge--red">Possible duplicate</span>');
  if (r.dup && r.dup.decision === 'keep') out.push('<span class="ge-badge ge-badge--plain">Duplicate kept</span>');
  if (r.status === 'by_hand') out.push('<span class="ge-badge ge-badge--plain">Enter by hand in Blackbaud</span>');
  if (r.status === 'failed') out.push('<span class="ge-badge ge-badge--red">Needs a person</span>');
  if (r.status === 'sent') out.push('<span class="ge-badge">In the batch</span>');
  if (!r.partner && r.status !== 'by_hand' && !r.card) out.push(`<span class="ge-badge ge-badge--gold">${r.candidates.length > 1 ? 'Pick the partner' : 'No partner found'}</span>`);
  if (r.flags.length && !r.confirmed) out.push(`<span class="ge-badge ge-badge--gold">Check ${esc(r.flags.map((f) => ({ amount: 'amount', number: 'check number', date: 'date', payer: 'name', memo: 'memo' }[f])).join(', '))}</span>`);
  if (r.ruleLabel) out.push(`<span class="ge-badge ge-badge--plain">Photo goes to Blackbaud: ${esc(r.ruleLabel)}</span>`);
  if (r.prayer) out.push('<span class="ge-badge ge-badge--gold">Prayer request</span>');
  if (r.status === 'review' && !r.confirmed && !out.length) out.push('<span class="ge-badge ge-badge--plain">Needs a glance</span>');
  if (r.confirmed && r.status !== 'by_hand' && !r.blockers.length) out.push('<span class="ge-badge">Looks right</span>');
  else if (r.confirmed && r.blockers.length) out.push('<span class="ge-badge ge-badge--gold">Changed, look again</span>');
  return out.join('');
}

function gridRow(r) {
  const hl = (name, txt) => (r.flags.includes(name) && !r.confirmed ? `<span class="ge-hl" title="${esc(r.why[name] || '')}">${txt}</span>` : txt);
  const look = r.blockers.length && r.status !== 'sent' ? ' is-look' : '';
  const dup = r.dup && r.dup.decision === null ? ' is-dup' : '';
  const img = r.images[0] ? `style="background-image:url(/api/gift-entry/images/${esc(r.images[0].id)})"` : '';
  return `<tr class="ge-r${look}${dup}" data-row="${esc(r.id)}" tabindex="0">
    <td class="c-photo"><span class="ge-thumb" ${img}></span></td>
    <td class="c-payer"><b>${hl('payer', esc(r.payer || 'Unread'))}</b><small>${r.kind === 'cash' ? 'Cash' : 'Check ' + hl('number', esc(r.checkNumber || '?'))}${r.checkDate ? ', dated ' + hl('date', fdShort(r.checkDate)) : r.kind === 'check' ? ', ' + hl('date', 'no date') : ''}</small></td>
    <td class="num c-amt">${hl('amount', r.amountCents != null ? money(r.amountCents) : '?')}</td>
    <td class="c-partner">${r.partner ? `<b>${esc(r.partner.name)}</b><small>${esc(r.partner.place || '')}${r.defaults && r.defaults.lastGift ? '' : ''}</small>` : '<span class="ge-sub">Not matched yet</span>'}</td>
    <td class="c-left"><div class="ge-tags">${pills(r)}</div></td></tr>`;
}

function grid(v) {
  const f = S.filter;
  const rows = v.rows.filter((r) => f === 'all' || (f === 'look' && r.blockers.length) || (f === 'big' && (r.amountCents || 0) >= 100000));
  const look = v.rows.filter((r) => r.blockers.length).length;
  const big = v.rows.filter((r) => (r.amountCents || 0) >= 100000).length;
  return `<section class="h-card ge-sheet"><div class="ge-sheet__head"><div><h2>${esc(v.deposit.name)}</h2><p>Entered by ${esc(v.deposit.createdBy)}. Every row needs a glance. A gold mark means the two readers disagree or a rule says look again. Jennifer approves the batch in Blackbaud.</p></div><span class="sp"></span>
    <div class="ge-filter"><button data-f="all" class="${f === 'all' ? 'is-on' : ''}">All ${v.rows.length}</button><button data-f="look" class="${f === 'look' ? 'is-on' : ''}">Need a look ${look}</button><button data-f="big" class="${f === 'big' ? 'is-on' : ''}">$1,000 and up ${big}</button></div></div>
    ${rows.length ? `<table class="ge-grid"><thead><tr><th>Photo</th><th>Payer</th><th style="text-align:right">Amount</th><th>Partner</th><th>What is left</th></tr></thead><tbody>${rows.map(gridRow).join('')}</tbody></table>` : '<div class="ge-empty">No photos yet. Press Take a photo, one check or slip at a time.</div>'}</section>`;
}

function captureBar(v) {
  const q = S.queue.filter((x) => x.state !== 'done');
  return `<section class="h-card"><div class="ge-cap"><button class="h-btn h-btn--primary" data-cam>${ic(I.cam)}Take photos</button>
      <label class="h-btn" style="cursor:pointer">${ic(I.img)}Choose photos<input type="file" accept="image/*" multiple hidden data-pick></label>
      <label class="h-btn" style="cursor:pointer">${ic(I.cam)}Camera app<input type="file" accept="image/*" capture="environment" hidden data-pick></label>
      <button class="h-btn" data-addcash>${ic(I.plus)}Add cash row</button>
      <span class="sp"></span><span class="ge-hint">One check or slip per photo. Lay it flat in good light. A card number is never kept.</span></div>
    <div class="ge-queue" id="ge-queue">${q.map((x) => `<span class="${x.state === 'error' ? 'err' : ''}">${esc(x.label)}: ${x.state === 'error' ? esc(x.err) + ' (tap to retry)' : x.state === 'sending' ? 'reading' : 'waiting'}</span>`).join('')}</div></section>`;
}

async function deposit() {
  const v = S.view;
  if (!v) return;
  const st = v.deposit.status;
  if (st !== 'open') return status();
  stopPoll();
  root.innerHTML = `<div class="ge-top"><div><a class="h-btn h-btn--ghost h-btn--sm" href="/gift-entry/" data-home>${ic(I.back)}Gift entry</a></div><div>${meter()}</div></div>
    ${stepsBar(st)}${tapeBar(v)}${(S.stage || 1) < 2 ? '<div class="ge-note" style="margin-bottom:14px">Creating the batch in Blackbaud opens in the next stage. Until then, review the photos here and keep entering the gifts in Blackbaud.</div>' : ''}${v.canSend.ok || !v.rows.length ? '' : `<div class="ge-note" style="margin-bottom:14px">${esc(v.canSend.why.join(' '))}</div>`}
    ${captureBar(v)}<div style="height:14px"></div>${grid(v)}
    <div style="margin-top:16px"><button class="h-btn h-btn--ghost h-btn--sm" data-discard>Throw away this deposit</button></div>`;
  if (S.drawer) drawer(S.drawer);
}

// ---------------------------------------------------------------- status view
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
  try {
    const v = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/run' + (quiet ? '' : '?force=1'));
    S.view = v;
    status();
  } catch (e) { if (!quiet) toast(e.message); } finally { S.busy = false; }
}

function status() {
  const v = S.view;
  const d = v.deposit;
  const gifts = v.rows.filter((r) => r.status !== 'by_hand');
  const steps = (v.steps && v.steps.steps) || [];
  const batchStep = steps.find((s) => s.op === 'batch');
  const giftSteps = steps.filter((s) => s.op.startsWith('gifts:'));
  const failed = v.rows.filter((r) => r.status === 'failed');
  const waitStep = steps.find((s) => s.status === 'waiting');
  const retrying = steps.find((s) => s.status === 'queued' && s.attempts > 0);
  const sentAll = giftSteps.length && giftSteps.every((s) => s.status === 'done');
  const created = ['created', 'committed'].includes(d.status);
  const committed = d.status === 'committed';
  const a = v.attachments;
  const tl = [
    { t: 'Photos read and checked', s: `${v.rows.length} gifts, ${money(v.tape.cents)}, equal to the tape. Entered by ${esc(d.createdBy)}.`, k: 'done' },
    { t: d.batchNumber ? 'Batch ' + esc(d.batchNumber) + ' made in Blackbaud' : d.batchId ? 'Batch made in Blackbaud' : 'Making the batch in Blackbaud', s: batchStep && batchStep.status === 'done' ? 'Created unapproved.' : waitStep ? 'Waiting for the daily limit to reset.' : retrying ? 'Trying again at ' + esc(et(retrying.next_try_at)) + '. ' + esc(retrying.error || '') : 'One moment.', k: batchStep && batchStep.status === 'done' ? 'done' : d.status === 'needs_person' ? 'bad' : 'now' },
    { t: 'Gifts added to the batch', s: sentAll ? `${v.rows.filter((r) => r.status === 'sent').length} of ${gifts.length} gifts are in. ${failed.length ? failed.length + ' need a person.' : 'Blackbaud took every one.'}` : 'Sending.', k: sentAll && !failed.length ? 'done' : failed.length ? 'bad' : batchStep && batchStep.status === 'done' ? 'now' : '' },
    { t: committed ? 'Approved in Blackbaud' : 'Waiting for approval in Blackbaud', s: committed ? 'Approved ' + esc(et(d.committedAt)) + '. The hub saw the batch turn approved when it checked.' : created ? 'The batch reads as unapproved. Jennifer approves it in Blackbaud, in Gifts, Gift batch entry. The hub checks about once a minute while this page is open' + (d.lastPolledAt ? ' (last check ' + esc(et(d.lastPolledAt)) + ')' : '') + '.' : 'Starts after the gifts are in.', k: committed ? 'done' : created ? 'now' : '' },
    { t: 'Photos copied to the gifts', s: a.planned ? `${a.done} of ${a.planned} photos copied${a.failed ? ', ' + a.failed + ' failed' : ''}. Only designated gifts, $5,000 and up, and giving funds get a copy. Every photo stays in Favor storage.` : 'No gift in this deposit needs a copy in Blackbaud. Every photo stays in Favor storage.', k: committed && a.done === a.planned ? 'done' : committed && a.planned ? 'now' : '' },
  ];
  const wm = v.watch && v.watch.mismatch;
  root.innerHTML = `<div class="ge-top"><div><a class="h-btn h-btn--ghost h-btn--sm" href="/gift-entry/" data-home>${ic(I.back)}Gift entry</a></div><div>${meter()}</div></div>
    ${stepsBar(d.status)}
    <section class="h-card ge-tape"><div><span class="n">${esc(d.name)}</span><span class="l">${money(d.tapeCents)}, ${d.tapeCount} items</span></div><span class="sp"></span><div class="acts">${statusBadge(d.status)}
      ${d.status === 'needs_person' ? '<button class="h-btn h-btn--primary" data-retry>Try again</button>' : ''}<button class="h-btn" data-refresh>Check now</button></div></section>
    ${d.note ? `<div class="ge-note ge-note--red" style="margin-bottom:14px">${esc(d.note)}</div>` : ''}${wm ? `<div class="ge-note" style="margin-bottom:14px">${esc(wm)}</div>` : ''}
    ${v.lane && v.lane.calls >= v.lane.warnAt ? `<div class="ge-note" style="margin-bottom:14px">Gift entry has used ${v.lane.calls} of ${v.lane.cap} Blackbaud calls today. At ${v.lane.cap} it waits for the reset and sends after.</div>` : ''}
    <section class="h-card"><div class="ge-timeline">${tl.map((x, i) => `<div class="ge-tl is-${x.k}"><span class="dot">${x.k === 'done' ? ic(I.check) : i + 1}</span><div><b>${x.t}</b><span>${x.s}</span></div></div>`).join('')}</div></section>
    <div style="height:14px"></div>
    <section class="h-card ge-sheet"><div class="ge-sheet__head"><div><h2>Gifts in this deposit</h2><p>${created && !committed ? 'These are in an unapproved batch. Nothing counts as received in Blackbaud until it is approved.' : ''}</p></div></div>
    <table class="ge-grid"><thead><tr><th>Photo</th><th>Payer</th><th style="text-align:right">Amount</th><th>Partner</th><th>State</th></tr></thead><tbody>${v.rows.map(gridRow).join('')}</tbody></table></section>`;
  if (['sending', 'created', 'committed'].includes(d.status)) startPoll(); else stopPoll();
  if (S.drawer) drawer(S.drawer);
}

// ---------------------------------------------------------------- the drawer (one gift)
async function catalog() { if (!S.catalog) S.catalog = await api('/api/gift-entry/catalog'); return S.catalog; }

function fieldFlag(r, n) { return r.flags.includes(n) ? ' is-flag' : ''; }
function why(r, n) { return r.flags.includes(n) && r.why[n] ? `<div class="ge-why">${esc(r.why[n])}</div>` : ''; }

function drawer(id) {
  const v = S.view;
  const r = v && v.rows.find((x) => x.id === id);
  if (!r) { closeDrawer(); return; }
  S.drawer = id;
  const open = v.deposit.status === 'open';
  const dis = open ? '' : 'disabled';
  const cat = S.catalog;
  const layer = $('#ge-layer');
  const cands = r.candidates.filter((c) => !(r.partner && r.partner.id === c.cid)).map((c) => `<button class="ge-cand${r.partner && r.partner.id === c.cid ? ' is-on' : ''}" data-pick="${esc(c.cid)}" data-n="${esc(c.name)}" data-p="${esc(c.place)}" data-l="${esc(c.lookup)}" ${dis}>${esc(c.name)}<small>${esc(c.place || '')}${c.exact ? ' - same name as the check' : ''}</small></button>`).join('');
  const fundOpts = cat ? cat.funds.map((f) => `<option value="${esc(f.id)}"${r.fund && r.fund.id === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('') : `<option value="${esc((r.fund && r.fund.id) || '')}">${esc((r.fund && r.fund.name) || 'Loading')}</option>`;
  const readers = r.readers.map((x) => `<div><b>${esc(x.reader === 'scout' ? 'Reader A' : 'Reader B')}</b><span>${x.fields ? esc([x.fields.payer, x.fields.amountCents != null ? money(x.fields.amountCents) : null, x.fields.checkNumber && 'no. ' + x.fields.checkNumber, x.fields.checkDate, x.fields.memo && 'memo: ' + x.fields.memo].filter(Boolean).join(' / ') || 'nothing read') : esc(x.error || 'no answer')}</span></div>`).join('');
  layer.innerHTML = `<div class="ge-back" data-close></div><aside class="ge-drawer" role="dialog" aria-label="One gift">
    <div class="ge-drawer__head"><h3>${esc(r.payer || 'Gift ' + r.seq)}</h3><button class="h-btn h-btn--ghost h-btn--sm" data-close aria-label="Close">${ic(I.x)}</button></div>
    <div class="ge-drawer__body">
      ${r.images[0] ? `<img class="ge-photo" data-zoom src="/api/gift-entry/images/${esc(r.images[0].id)}" alt="Photo of the check">` : '<div class="ge-note">This row has no photo (a cash row).</div>'}
      ${r.card ? '<div class="ge-note ge-note--red">A card number showed in the photo, so the photo was not kept. Use Phone gift for this one, and remove this row.</div>' : ''}
      ${r.dup ? `<div class="ge-note ge-note--red"><b>${esc(r.dup.message)}</b><div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${r.dup.decision === null && open ? '<button class="h-btn h-btn--sm" data-dup="dup_remove">Remove this row</button><button class="h-btn h-btn--sm" data-dup="dup_keep">Keep it, it is a different gift</button>' : r.dup.decision === 'keep' ? 'Kept as a different gift.' : ''}</div></div>` : ''}
      ${r.error ? `<div class="ge-note ge-note--red">${esc(r.error)}</div>` : ''}
      ${r.status === 'failed' ? `<div class="ge-note">Blackbaud stored this gift with the error above, or turned it down. Fix it in Blackbaud's batch grid and press Entered by hand, or send the deposit again after you correct the row.<div style="margin-top:8px"><button class="h-btn h-btn--sm" data-act="by_hand">Entered by hand in Blackbaud</button></div></div>` : ''}
      <div class="ge-field"><label>Partner</label>
        ${r.partner ? `<div class="ge-cand is-on" style="cursor:default">${esc(r.partner.name)}<small>${r.partner.place ? esc(r.partner.place) + ', ' : ''}lookup ${esc(r.partner.lookup || '')}</small></div>` : '<div class="ge-note ge-note--red">No partner matched. Pick one or search.</div>'}
        <div class="ge-cands">${cands}</div>
        <div class="ge-search"><input id="ge-ps" placeholder="Search by name, street, phone or email" autocomplete="off" ${dis}></div><div class="ge-opts" id="ge-pr" hidden></div>
        <div class="ge-hint">The hub reads Blackbaud's copy of partner records, which can be up to 12 hours old. It checks the record live again before it posts.</div></div>
      <div class="ge-row2">
        <div class="ge-field${fieldFlag(r, 'amount')}"><label for="gf-amount">Amount</label><input id="gf-amount" inputmode="decimal" value="${r.amountCents != null ? (r.amountCents / 100).toFixed(2) : ''}" ${dis}>${why(r, 'amount')}</div>
        <div class="ge-field"><label>Kind</label><div class="ge-seg"><button type="button" data-kind="check" class="${r.kind === 'check' ? 'is-on' : ''}" ${dis}>Check</button><button type="button" data-kind="cash" class="${r.kind === 'cash' ? 'is-on' : ''}" ${dis}>Cash</button></div></div>
      </div>
      ${r.kind === 'check' ? `<div class="ge-row2">
        <div class="ge-field${fieldFlag(r, 'number')}"><label for="gf-number">Check number</label><input id="gf-number" value="${esc(r.checkNumber || '')}" ${dis}>${why(r, 'number')}</div>
        <div class="ge-field${fieldFlag(r, 'date')}"><label for="gf-cdate">Check date</label><input id="gf-cdate" type="date" value="${esc(r.checkDate || '')}" ${dis}>${why(r, 'date')}</div></div>` : ''}
      <div class="ge-row2">
        <div class="ge-field${fieldFlag(r, 'payer')}"><label for="gf-payer">Name on the check</label><input id="gf-payer" value="${esc(r.payer || '')}" ${dis}>${why(r, 'payer')}</div>
        <div class="ge-field"><label for="gf-gdate">Gift date</label><input id="gf-gdate" type="date" value="${esc(r.giftDate || '')}" ${dis}></div></div>
      <div class="ge-row2">
        <div class="ge-field"><label for="gf-fund">Fund</label><select id="gf-fund" ${dis}>${fundOpts}</select>${r.fund && r.fund.id !== '79' ? '<div class="ge-hint">A designated fund needs the partner\'s written direction at or before the gift. The photo goes to Blackbaud with the gift.</div>' : ''}</div>
        <div class="ge-field"><label for="gf-appeal">Appeal</label><input id="gf-appeal" value="${esc(r.appeal ? r.appeal.name : '')}" placeholder="Search appeals" autocomplete="off" ${dis}>${r.defaults && r.defaults.lastGift ? '<div class="ge-hint">From the partner\'s last gift, the SOP\'s fallback.</div>' : r.defaults && r.defaults.slip ? '<div class="ge-hint">From the reply slip.</div>' : ''}<div class="ge-opts" id="ge-ar" hidden></div></div></div>
      <div class="ge-field${fieldFlag(r, 'memo')}"><label for="gf-memo">Memo or note</label><textarea id="gf-memo" ${dis}>${esc(r.memo || '')}</textarea>${why(r, 'memo')}${r.prayer ? '<div class="ge-hint">This reads like a prayer request. Partner Care will see it.</div>' : ''}</div>
      ${r.rule === 'giving_fund' || r.soft ? `<div class="ge-field"><label>Who recommended this gift (soft credit)</label>${r.soft ? `<div class="ge-cand is-on" style="cursor:default">${esc(r.soft.name)}</div>` : '<div class="ge-note">This looks like a giving fund or foundation. Name the partner who recommended it, or choose No partner named.</div>'}
        <div class="ge-search"><input id="ge-sp" placeholder="Search for the recommending partner" autocomplete="off" ${dis}></div><div class="ge-opts" id="ge-sr" hidden></div>
        <div><button class="h-btn h-btn--sm" data-nosoft ${dis}>No partner named</button></div></div>` : ''}
      <details><summary class="ge-hint" style="cursor:pointer">What each reader saw</summary><div class="ge-readers" style="margin-top:8px">${readers || '<span class="ge-hint">Nothing was read.</span>'}</div>
        ${open && r.images[0] ? '<div style="margin-top:8px"><button class="h-btn h-btn--sm" data-reread>Read the photo again</button></div>' : ''}</details>
    </div>
    <div class="ge-drawer__foot">${open ? `<button class="h-btn h-btn--primary" data-act="confirm">${ic(I.check)}Looks right</button>${r.blockers.filter((b) => !/Looks right/.test(b)).length ? `<span class="ge-hint" style="align-self:center">${esc(r.blockers.filter((b) => !/Looks right/.test(b))[0])}</span>` : ''}<span style="flex:1"></span><button class="h-btn" data-act="by_hand">Enter by hand in Blackbaud</button><button class="h-btn h-btn--warn" data-remove>Remove</button>` : '<span class="ge-hint">This deposit was sent.</span>'}</div></aside>`;
  if (!cat) catalog().then(() => { if (S.drawer === id) drawer(id); }).catch(() => {});
}
function closeDrawer() { S.drawer = ''; $('#ge-layer').innerHTML = ''; }

async function save(id, set, action) {
  try {
    const out = await patch('/api/gift-entry/gifts/' + encodeURIComponent(id), { set, action });
    S.view = Object.assign({}, S.view, out.view);
    S.view.lane = S.view.lane || S.lane;
    deposit();
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- camera and the upload queue
async function sharp(canvas) {
  // Variance of a simple Laplacian on a small copy: low means blur.
  const w = 160, h = Math.max(1, Math.round((canvas.height / canvas.width) * 160));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(canvas, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2];
  let s = 0, s2 = 0, n = 0;
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const v = 4 * g[j * w + i] - g[j * w + i - 1] - g[j * w + i + 1] - g[(j - 1) * w + i] - g[(j + 1) * w + i]; s += v; s2 += v * v; n++; }
  const mean = s / n; return s2 / n - mean * mean;
}
async function toJpeg(source, w, h) {
  const max = 1600; const k = Math.min(1, max / Math.max(w, h));
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
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser has no live camera. Use Camera app or Choose photos.'); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false }); }
  catch (e) { toast('The camera did not open. Use Camera app or Choose photos.'); return; }
  const layer = $('#ge-layer');
  layer.innerHTML = `<div class="ge-cam"><div class="ge-cam__top"><button data-camclose>Done</button><span id="ge-camcount"></span><span style="width:60px"></span></div>
    <div class="ge-cam__view"><video autoplay playsinline muted></video><div class="ge-cam__guide"></div><div class="ge-cam__msg" id="ge-cammsg">Fill the frame with one check. Hold still.</div></div>
    <div class="ge-cam__bar"><div class="ge-cam__strip" id="ge-camstrip"></div><button class="ge-shutter" data-shutter aria-label="Take the photo"></button><span style="width:60px"></span></div></div>`;
  const v = $('video', layer); v.srcObject = stream; await v.play().catch(() => {});
  camCount();
}
function camCount() { const n = (S.view ? S.view.rows.length : 0) + S.queue.filter((x) => x.state !== 'done').length; const el = $('#ge-camcount'); if (el) el.textContent = n + ' of ' + (S.view ? S.view.deposit.tapeCount : '') + ' photographed'; }
function closeCamera() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('#ge-layer').innerHTML = ''; if (S.drawer) drawer(S.drawer); else deposit(); }
async function shutter() {
  const v = $('.ge-cam video'); if (!v || !v.videoWidth) return;
  const shot = await toJpeg(v, v.videoWidth, v.videoHeight);
  if (shot.blur < 25) { const m = $('#ge-cammsg'); m.textContent = 'That one is blurry. Hold still and take it again.'; return; }
  const strip = $('#ge-camstrip'); const im = document.createElement('img'); im.src = shot.url; strip.appendChild(im); strip.scrollLeft = strip.scrollWidth;
  enqueue(shot.blob, 'Photo ' + ((S.view ? S.view.rows.length : 0) + S.queue.length + 1));
  $('#ge-cammsg').textContent = 'Saved. Next check.';
}

function enqueue(blob, label, kind) { S.queue.push({ blob, label, state: 'waiting', tries: 0, kind: kind || 'check_front' }); pump(); camCount(); }
let pumping = 0;
async function pump() {
  if (pumping >= 2) return;
  const item = S.queue.find((x) => x.state === 'waiting');
  if (!item) { if (!pumping) await refresh(); return; }
  item.state = 'sending'; pumping++; paintQueue();
  try {
    await api('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/photos?kind=' + item.kind, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: item.blob });
    item.state = 'done';
  } catch (e) {
    item.tries++;
    if (item.tries < 3 && (e.status == null || e.status >= 500 || e.name === 'TypeError')) { item.state = 'waiting'; await new Promise((r) => setTimeout(r, 1500 * item.tries)); }
    else { item.state = 'error'; item.err = e.message; }
  } finally { pumping--; }
  S.queue = S.queue.filter((x) => x.state !== 'done' || Date.now() - 1 < 0);
  paintQueue(); await refresh();
  pump();
}
function paintQueue() { const q = $('#ge-queue'); if (!q) return; const items = S.queue.filter((x) => x.state !== 'done'); q.innerHTML = items.map((x, i) => `<span class="${x.state === 'error' ? 'err' : ''}" data-retryq="${i}">${esc(x.label)}: ${x.state === 'error' ? esc(x.err) + ' (tap to retry)' : x.state === 'sending' ? 'reading' : 'waiting'}</span>`).join(''); }
async function refresh() { if (!S.id) return; try { await load(S.id); if (!$('.ge-cam')) { if (S.view.deposit.status === 'open') deposit(); else status(); } else camCount(); } catch (e) { /* keep what is on screen */ } }

// ---------------------------------------------------------------- events
root.addEventListener('click', async (e) => {
  const t = e.target.closest('button,a,[data-row],[data-retryq]');
  if (!t) return;
  if (t.matches('[data-home]')) { e.preventDefault(); setUrl(''); S.id = ''; await home(); return; }
  if (t.matches('[data-open]')) { e.preventDefault(); setUrl(t.dataset.open); await openDeposit(); return; }
  if (t.matches('[data-new]')) { setUrl(''); setup(); return; }
  if (t.matches('#ge-setup [data-kind]')) { S.form.kind = t.dataset.kind; $$('#ge-setup [data-kind]').forEach((b) => b.classList.toggle('is-on', b === t)); return; }
  if (t.matches('[data-f]')) { S.filter = t.dataset.f; deposit(); return; }
  if (t.matches('[data-row]')) { await catalog().catch(() => {}); drawer(t.dataset.row); return; }
  if (t.matches('[data-cam]')) { openCamera(); return; }
  if (t.matches('[data-retryq]')) { const items = S.queue.filter((x) => x.state !== 'done'); const it = items[Number(t.dataset.retryq)]; if (it) { it.state = 'waiting'; it.tries = 0; pump(); } return; }
  if (t.matches('[data-addcash]')) { e.preventDefault(); const v = prompt('Cash amount in dollars'); if (v) await addCash(v); return; }
  if (t.matches('[data-confirm-clean]')) { await confirmClean(); return; }
  if (t.matches('[data-send]')) { await sendDeposit(); return; }
  if (t.matches('[data-discard]')) { if (confirm('Throw away this deposit and its rows?')) { await api('/api/gift-entry/deposits/' + encodeURIComponent(S.id), { method: 'DELETE' }); setUrl(''); await home(); } return; }
  if (t.matches('[data-retry]')) { try { await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/retry'); await run(); } catch (er) { toast(er.message); } return; }
  if (t.matches('[data-refresh]')) { await run(); return; }
});
root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-row]')) e.target.click(); });
root.addEventListener('change', async (e) => {
  if (e.target.matches('[data-pick]')) {
    const files = Array.from(e.target.files || []); e.target.value = '';
    for (const f of files) { try { const j = await fileToJpeg(f); enqueue(j.blob, f.name.slice(0, 18) || 'Photo'); } catch (er) { toast('Could not open ' + f.name); } }
  }
});
root.addEventListener('submit', async (e) => {
  if (!e.target.matches('#ge-setup')) return;
  e.preventDefault();
  const f = new FormData(e.target); const err = $('#ge-err');
  S.form = { kind: S.form.kind, date: f.get('date'), tapeTotal: f.get('tapeTotal'), tapeCount: f.get('tapeCount') };
  try {
    const out = await post('/api/gift-entry', { kind: S.form.kind, date: S.form.date, tapeTotal: String(S.form.tapeTotal).replace(/[$,\s]/g, ''), tapeCount: S.form.tapeCount });
    if (out.sameDayExists && !confirm('A ' + S.form.kind + ' deposit for that date already exists. Start another one anyway?')) { return; }
    setUrl(out.deposit.id); S.form = { kind: S.form.kind }; await openDeposit();
  } catch (er) { err.hidden = false; err.textContent = er.message; }
});

const layer = $('#ge-layer');
layer.addEventListener('click', async (e) => {
  const t = e.target.closest('button,[data-zoom],[data-close]'); if (!t) return;
  if (t.matches('[data-zoom]')) { t.classList.toggle('is-big'); return; }
  if (t.matches('[data-close]')) { closeDrawer(); return; }
  if (t.matches('[data-camclose]')) { closeCamera(); return; }
  if (t.matches('[data-shutter]')) { shutter(); return; }
  const id = S.drawer; if (!id) return;
  if (t.matches('[data-pick]')) { save(id, { partner_id: t.dataset.pick, partner_name: t.dataset.n, partner_place: t.dataset.p, partner_lookup: t.dataset.l }); const last = await api('/api/gift-entry/partners?coding=' + t.dataset.pick).catch(() => null); const r = S.view.rows.find((x) => x.id === id); if (last && last.last && r && !r.appeal) save(id, { appeal_id: last.last.appealId }); return; }
  if (t.matches('[data-kind]')) { save(id, { kind: t.dataset.kind }); return; }
  if (t.matches('[data-dup]')) { save(id, null, t.dataset.dup); closeDrawer(); return; }
  if (t.matches('[data-act]')) { await save(id, null, t.dataset.act); if (t.dataset.act === 'confirm') closeDrawer(); return; }
  if (t.matches('[data-nosoft]')) { save(id, { soft_partner_id: null, soft_partner_name: 'No partner named' }); return; }
  if (t.matches('[data-reread]')) { toast('Reading the photo again'); try { const out = await post('/api/gift-entry/gifts/' + encodeURIComponent(id) + '/reread'); S.view = Object.assign({}, S.view, out.view); deposit(); } catch (er) { toast(er.message); } return; }
  if (t.matches('[data-remove]')) { if (confirm('Remove this row from the deposit? It will no longer count toward the tape.')) { try { const out = await api('/api/gift-entry/gifts/' + encodeURIComponent(id), { method: 'DELETE' }); S.view = Object.assign({}, S.view, out.view); closeDrawer(); deposit(); } catch (er) { toast(er.message); } } return; }
  if (t.matches('[data-pickp]')) { save(id, { partner_id: t.dataset.pickp, partner_name: t.dataset.n, partner_place: t.dataset.p, partner_lookup: t.dataset.l }); return; }
  if (t.matches('[data-picks]')) { save(id, { soft_partner_id: t.dataset.picks, soft_partner_name: t.dataset.n }); return; }
  if (t.matches('[data-picka]')) { save(id, { appeal_id: t.dataset.picka, appeal_name: t.dataset.n }); return; }
});
layer.addEventListener('change', (e) => {
  const id = S.drawer; if (!id) return; const t = e.target;
  const num = (v) => Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);
  if (t.id === 'gf-amount') save(id, { amount_cents: num(t.value) });
  else if (t.id === 'gf-number') save(id, { check_number: t.value.trim() });
  else if (t.id === 'gf-cdate') save(id, { check_date: t.value });
  else if (t.id === 'gf-gdate') save(id, { gift_date: t.value });
  else if (t.id === 'gf-payer') save(id, { payer: t.value.trim() });
  else if (t.id === 'gf-memo') save(id, { memo: t.value.trim() });
  else if (t.id === 'gf-fund') { const o = t.options[t.selectedIndex]; save(id, { fund_id: t.value, fund_name: o ? o.textContent : '' }); }
});
let typeT = 0;
layer.addEventListener('input', (e) => {
  const t = e.target; clearTimeout(typeT);
  if (t.id === 'ge-ps' || t.id === 'ge-sp') {
    typeT = setTimeout(async () => {
      const box = t.id === 'ge-ps' ? $('#ge-pr') : $('#ge-sr'); const q = t.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      try { const d = await api('/api/gift-entry/partners?q=' + encodeURIComponent(q)); box.hidden = false; const k = t.id === 'ge-ps' ? 'pickp' : 'picks';
        box.innerHTML = d.hits.length ? d.hits.map((h) => `<button data-${k}="${esc(h.cid)}" data-n="${esc(h.name)}" data-p="${esc(h.place)}" data-l="${esc(h.lookup)}">${esc(h.name)}<small style="display:block;color:#8a857c">${esc(h.place)}, lookup ${esc(h.lookup)}</small></button>`).join('') : '<button disabled>No partner found</button>'; } catch (er) { toast(er.message); }
    }, 250);
  } else if (t.id === 'gf-appeal') {
    const box = $('#ge-ar'); const q = t.value.trim().toLowerCase();
    if (q.length < 2 || !S.catalog) { box.hidden = true; return; }
    const hits = S.catalog.appeals.filter((a) => (a.code + ' ' + a.name).toLowerCase().includes(q)).slice(0, 25);
    box.hidden = false; box.innerHTML = hits.map((a) => `<button data-picka="${esc(a.id)}" data-n="${esc(a.code + ' ' + a.name)}">${esc(a.code)}<small style="display:block;color:#8a857c">${esc(a.name)}</small></button>`).join('') || '<button disabled>No appeal found</button>';
  }
});

async function addCash(v) {
  const cents = Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100);
  if (!cents || cents < 1) { toast('Enter the cash amount in dollars.'); return; }
  // A cash row has no photo; it is added through the photos route as a tiny placeholder row is not allowed, so it posts a blank gift row.
  try { await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/cash', { amountCents: cents }); await refresh(); toast('Cash row added. Pick the partner.'); } catch (e) { toast(e.message); }
}
async function confirmClean() {
  const ids = S.view.rows.filter((r) => !r.flags.length && r.blockers.length === 1 && /Looks right/.test(r.blockers[0])).map((r) => r.id);
  if (!ids.length) { toast('No clean rows are waiting for a glance.'); return; }
  if (!confirm('Mark ' + ids.length + ' rows with no highlights as looking right? Open any row to check it first.')) return;
  for (const id of ids) { try { const out = await patch('/api/gift-entry/gifts/' + encodeURIComponent(id), { action: 'confirm' }); S.view = Object.assign({}, S.view, out.view); } catch (er) { /* the row keeps its reason */ } }
  deposit(); toast(ids.length + ' rows confirmed.');
}
async function sendDeposit() {
  const v = S.view; if (!v.canSend.ok) return;
  if (!confirm('Create the unapproved batch in Blackbaud with ' + v.tape.count + ' gifts and ' + money(v.tape.cents) + '? Jennifer approves it there.')) return;
  try { await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/send'); await load(S.id); S.view = await post('/api/gift-entry/deposits/' + encodeURIComponent(S.id) + '/run'); status(); } catch (e) { toast(e.message); }
}

async function openDeposit() {
  try { await load(S.id); } catch (e) { toast(e.message); setUrl(''); return home(); }
  S.filter = 'all'; S.drawer = '';
  if (S.view.deposit.status === 'open') deposit(); else { status(); run(true); }
}

window.addEventListener('pagehide', () => { if (stream) stream.getTracks().forEach((t) => t.stop()); });
(async () => {
  try {
    if (S.id) { const d = await api('/api/gift-entry'); S.lane = d.lane; S.today = d.today; S.stage = d.stage || 1; await openDeposit(); } else await home();
  } catch (e) {
    root.innerHTML = `<div class="h-card" style="padding:28px"><b>${esc(e.status === 403 ? 'Gift entry is open to admins for now.' : e.message)}</b></div>`;
  }
})();
})();
