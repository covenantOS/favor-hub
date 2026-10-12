/* Credit and assignments: proposals waiting for approval, a look-up of one gift or partner, recent changes, and the apply switch for admins.
   Every rule is on the server (functions/_lib/lists/credit.ts). This page shows what the server returns and posts the person's choices. */
(function () {
  'use strict';
  var root = document.getElementById('cr-app');
  if (!root) return;
  var API = root.dataset.api;
  var U = window.FavorUI || {};
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return U.money ? U.money(n) : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var day = function (s) { return U.day ? U.day(String(s).slice(0, 10)) : s; };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var toastEl = document.getElementById('cr-toast'), tt;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove('is-on'); }, 4200); }
  var S = { ov: null, found: null, rid: '', gid: '' };

  function call(path, body, method) {
    var opt = { credentials: 'same-origin' };
    if (body !== undefined) { opt.method = method || 'POST'; opt.headers = { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }; opt.body = JSON.stringify(body); }
    return fetch(API + path, opt).then(function (r) { return r.json().catch(function () { return {}; }); }).catch(function () { return { ok: false, message: 'FavorOS could not be reached. Check the connection and try again.' }; });
  }
  var STATE = { proposed: 'Waiting', approved: 'Approved', queued: 'Queued', applied: 'Applied', failed: 'Failed', rejected: 'Rejected', cancelled: 'Taken back' };
  var who = function (e) { return e === 'scan' ? 'Scan' : String(e || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };

  function line(c) {
    var ch = c.change || {};
    var what = c.kind === 'credit' ? (ch.op === 'add' ? 'Add credit' : 'Remove credit') : (ch.op === 'add' ? 'Add assignment' : 'End assignment');
    var bits = [what, c.fundraiser];
    if (c.kind === 'credit') { bits.push(money(ch.amount)); bits.push('gift ' + c.giftId); if (ch.closedMonth) bits.push('closed month'); }
    else if (ch.type) bits.push(String(ch.type).replace(' (RDD)', ''));
    return bits.filter(Boolean).join(' · ');
  }
  function row(c, act) {
    var meta = [c.reason, who(c.proposedBy) + ', ' + day(c.proposedAt)];
    if (c.decidedBy && c.state !== 'proposed') meta.push(who(c.decidedBy) + ' ' + String(STATE[c.state] || c.state).toLowerCase());
    return '<div class="cr-row" data-id="' + esc(c.id) + '"><div class="cr-main"><b>' + esc(line(c)) + '</b><span>' + esc(meta.filter(Boolean).join(' · ')) + '</span>' + (c.result ? '<span class="cr-res">' + esc(c.result) + '</span>' : '') + '</div>' +
      (act ? '<div class="cr-acts"><button type="button" class="ls-link" data-act="approve">Approve</button><button type="button" class="ls-link cr-no" data-act="reject">Reject</button></div>' : '<span class="ls-st ls-st--' + esc(c.state) + '">' + esc(STATE[c.state] || c.state) + '</span>') + '</div>';
  }

  function draw() {
    var o = S.ov;
    var h = '<div class="ls-top"><div class="rp-seg2"><a class="rp-segl" href="/lists/">Builder</a><a class="rp-segl" href="/lists/reports/">Standard reports</a><button type="button" class="is-on">Credit</button></div></div>';
    h += '<div class="cr-grid"><div class="cr-col"><div class="h-card cr-card"><div class="cr-h"><b>Waiting for approval <small>' + o.waiting.length + '</small></b>' + (o.mayApprove ? '<button type="button" class="ls-quiet" id="cr-scan">Scan the last 45 days</button>' : '') + '</div>' +
      (o.waiting.length ? o.waiting.map(function (c) { return row(c, o.mayApprove && c.proposedBy !== o.me); }).join('') : '<p class="cr-none">Nothing waiting</p>') + '</div>';
    h += '<div class="h-card cr-card"><div class="cr-h"><b>Recent changes</b></div>' + (o.recent.length ? o.recent.slice(0, 15).map(function (c) { return row(c, false); }).join('') : '<p class="cr-none">None yet</p>') + '</div></div>';
    h += '<div class="cr-col"><div class="h-card cr-card"><div class="cr-h"><b>Look up</b></div><form class="cr-find" id="cr-form"><input type="text" id="cr-q" placeholder="Partner name or ID, or gift ID" aria-label="Partner name or ID, or gift ID" autocomplete="off"><button type="submit" class="h-btn h-btn--ghost h-btn--sm">Find</button></form><div id="cr-out"></div></div>';
    if (o.admin) h += '<div class="h-card cr-card"><div class="cr-h"><b>Apply</b><span class="ls-st ls-st--' + (o.apply ? 'applied' : 'rejected') + '">' + (o.apply ? 'On' : 'Off') + '</span></div><div class="cr-set"><label>Only record<input type="text" id="cr-lim" value="' + esc(o.testLimit) + '" placeholder="All records"></label><label>Also may approve<input type="text" id="cr-app" value="' + esc(o.approvers || '') + '" placeholder="email, email"></label><div class="ls-prow"><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="cr-save">Save</button><button type="button" class="ls-quiet" id="cr-flip">Turn apply ' + (o.apply ? 'off' : 'on') + '</button></div></div></div>';
    h += '</div></div>';
    root.innerHTML = h;
    bind();
    if (S.found) drawFound();
  }

  function bind() {
    root.querySelectorAll('.cr-row [data-act]').forEach(function (b) { b.addEventListener('click', function () {
      var id = b.closest('.cr-row').dataset.id, d = b.dataset.act;
      var note = d === 'reject' ? (prompt('Why is it rejected?') || '') : '';
      if (d === 'reject' && !note) return;
      call('/decide', { id: id, decision: d, note: note }).then(function (r) {
        if (r.ok === false) { toast(r.message || 'Not saved.'); return; }
        toast(r.state === 'queued' ? 'Approved and queued' : r.state === 'applied' ? 'Approved and saved in Blackbaud' : r.state === 'rejected' ? 'Rejected' : 'Approved. ' + (r.note || 'Apply is off, so nothing changed in Blackbaud.')); load();
      });
    }); });
    var sc = $('#cr-scan'); if (sc) sc.addEventListener('click', function () { sc.textContent = 'Scanning'; sc.disabled = true; call('/scan', { days: 45 }).then(function (r) { if (r.ok === false) { toast(r.message || 'The scan did not run.'); sc.disabled = false; sc.textContent = 'Scan the last 45 days'; return; } toast(r.added + ' new, ' + r.gifts + ' gifts read'); load(); }); });
    $('#cr-form').addEventListener('submit', function (e) { e.preventDefault(); find($('#cr-q').value.trim()); });
    var sv = $('#cr-save'); if (sv) sv.addEventListener('click', function () { call('/setting', { testLimit: $('#cr-lim').value, approvers: $('#cr-app').value }).then(function (r) { toast(r.ok === false ? r.message : 'Saved'); load(); }); });
    var fl = $('#cr-flip'); if (fl) fl.addEventListener('click', function () {
      if (!S.ov.apply && !confirm('Approved changes will go to Blackbaud' + (S.ov.testLimit ? ' for record ' + S.ov.testLimit + ' only' : ' for every record') + '. Turn apply on?')) return;
      call('/setting', { apply: S.ov.apply ? 'off' : 'on' }).then(function (r) { toast(r.ok === false ? r.message : 'Apply is ' + (r.apply ? 'on' : 'off')); load(); });
    });
  }

  function find(q) {
    if (!q) return;
    var out = $('#cr-out'); out.innerHTML = '<p class="cr-none">Looking</p>';
    if (/^\d{4,}$/.test(q)) {
      // A gift ID and a partner lookup ID are both numbers; try the gift first, then the partner.
      call('/lookup?gift=' + encodeURIComponent(q)).then(function (g) {
        if (g.ok !== false && g.gift) { S.found = { gift: g }; drawFound(); return; }
        search(q);
      });
    } else search(q);
  }
  function search(q) {
    call('/lookup?q=' + encodeURIComponent(q)).then(function (r) {
      var out = $('#cr-out');
      if (r.ok === false) { out.innerHTML = '<p class="cr-none">' + esc(r.message) + '</p>'; return; }
      if (!r.matches.length) { out.innerHTML = '<p class="cr-none">No match</p>'; return; }
      out.innerHTML = r.matches.map(function (m) { return '<button type="button" class="ls-opt" data-rid="' + esc(m.rid) + '"><b>' + esc(m.name) + '</b><small>' + esc(m.lookup || '') + '</small></button>'; }).join('');
      out.querySelectorAll('[data-rid]').forEach(function (b) { b.addEventListener('click', function () { call('/lookup?rid=' + encodeURIComponent(b.dataset.rid)).then(function (p) { if (p.ok === false) { toast(p.message); return; } S.found = { partner: p, rid: b.dataset.rid, name: b.querySelector('b').textContent }; drawFound(); }); }); });
    });
  }
  function drawFound() {
    var f = S.found, out = $('#cr-out'); if (!out || !f) return;
    var h = '';
    if (f.gift) {
      var g = f.gift;
      h += '<div class="cr-fact"><b>Gift ' + esc(g.gift.id) + '</b><span>' + esc(day(g.gift.date)) + ' · ' + esc(money(g.gift.amount)) + ' · ' + esc(g.gift.category || 'No category') + '</span></div>';
      h += '<div class="cr-sub">Credit</div>' + (g.credits.length ? g.credits.map(function (c) { return '<div class="cr-line"><span>' + esc(c.name) + '</span><b>' + esc(money(c.amount)) + '</b></div>'; }).join('') : '<p class="cr-none">No fundraiser credit</p>');
      h += '<div class="cr-sub">Assignments</div>' + assignLines(g.assignments, true);
      if (g.proposals.length) h += '<div class="cr-sub">By the rules</div>' + g.proposals.map(function (p, i) { return '<div class="cr-line"><span>' + esc((p.op === 'add' ? 'Add ' : 'Remove ') + p.name + ' · ' + p.reason) + '</span><button type="button" class="ls-link" data-prop="' + i + '">Propose</button></div>'; }).join('');
      if (g.odd.length) h += '<div class="cr-sub">To look at</div>' + g.odd.map(function (o) { return '<div class="cr-line"><span>' + esc(o.name + ' · ' + o.reason) + '</span></div>'; }).join('');
      h += '<div class="cr-sub">Suggest a change</div><div class="cr-man"><select id="cr-op"><option value="add">Add credit</option><option value="remove">Remove credit</option></select><input type="text" id="cr-fid" placeholder="Fundraiser ID" inputmode="numeric"><input type="text" id="cr-why" placeholder="Reason"><button type="button" class="h-btn h-btn--ghost h-btn--sm" id="cr-go">Propose</button></div>';
    } else {
      var p = f.partner;
      h += '<div class="cr-fact"><b>' + esc(f.name) + '</b></div><div class="cr-sub">Assignments</div>' + assignLines(p.assignments, false);
      h += '<div class="cr-sub">Recent gifts</div>' + (p.gifts.length ? p.gifts.slice(0, 12).map(function (g) { return '<button type="button" class="cr-line cr-gift" data-gid="' + esc(g.id) + '"><span>' + esc(day(g.date) + ' · ' + (g.category || 'No category')) + '</span><b>' + esc(money(g.amount)) + '</b><small>' + esc(g.credits.map(function (c) { return c.name; }).join(', ') || 'No credit') + '</small></button>'; }).join('') : '<p class="cr-none">No gifts</p>');
    }
    out.innerHTML = h;
    out.querySelectorAll('[data-gid]').forEach(function (b) { b.addEventListener('click', function () { find(b.dataset.gid); }); });
    out.querySelectorAll('[data-prop]').forEach(function (b) { b.addEventListener('click', function () {
      var p = f.gift.proposals[Number(b.dataset.prop)];
      call('/propose', { kind: 'credit', giftId: f.gift.gift.id, fundraiserId: p.fundraiserId, op: p.op, amount: p.amount, reason: p.reason }).then(function (r) { toast(r.ok === false ? r.message : 'Proposed'); if (r.ok !== false) load(); });
    }); });
    var go = $('#cr-go'); if (go) go.addEventListener('click', function () {
      call('/propose', { kind: 'credit', giftId: f.gift.gift.id, fundraiserId: $('#cr-fid').value.trim(), op: $('#cr-op').value, reason: $('#cr-why').value }).then(function (r) { toast(r.ok === false ? r.message : 'Proposed'); if (r.ok !== false) load(); });
    });
    out.querySelectorAll('[data-end]').forEach(function (b) { b.addEventListener('click', function () {
      var why = prompt('Why does this assignment end?') || ''; if (!why) return;
      call('/propose', { kind: 'assignment', op: 'end', recordId: b.dataset.rec, assignmentId: b.dataset.end, fundraiserId: b.dataset.fr, reason: why }).then(function (r) { toast(r.ok === false ? r.message : 'Proposed'); if (r.ok !== false) load(); });
    }); });
  }
  function assignLines(list, marks) {
    if (!list.length) return '<p class="cr-none">None</p>';
    return list.map(function (a) {
      return '<div class="cr-line"><span>' + esc(a.name + ' · ' + String(a.type).replace(' (RDD)', '') + ' · ' + day(a.from) + ' to ' + (a.to ? day(a.to) : 'now')) + '</span>' +
        (marks && a.onDate ? '<b class="cr-on">On the gift date</b>' : !a.to && !marks ? '<button type="button" class="ls-link" data-end="' + esc(a.id) + '" data-rec="' + esc(a.cid) + '" data-fr="' + esc(a.fid) + '">End</button>' : '') + '</div>';
    }).join('');
  }

  function load() { call('').then(function (d) { if (d.ok === false) { root.innerHTML = '<div class="h-card ls-pad"><p class="rp-note">' + esc(d.message || 'Credit did not load.') + '</p></div>'; return; } S.ov = d; draw(); }); }
  load();
})();
