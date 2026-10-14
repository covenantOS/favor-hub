/* Gifts > Overview: the gift day on one screen. Six steps across the top (the mail, online gifts, gifts waiting for a second look, what
   is in Blackbaud this month, receipts, thank-you letters), the gifts Blackbaud took in by day, the month's mail deposits, and the online
   gifts and letters waiting. Reads GET /api/gifts/overview and GET /api/gift-entry/month together; each part draws when its read
   answers, in a card that already has its final size. */
(function () {
  'use strict';
  var root = document.getElementById('gh-root');
  if (!root || root.dataset.on) return;
  root.dataset.on = '1';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (c, whole) { if (c == null) return ''; var d = c / 100; return '$' + d.toLocaleString('en-US', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var short = function (ymd) { if (!ymd) return ''; var p = String(ymd).slice(0, 10).split('-').map(Number); return MON[p[1] - 1] + ' ' + p[2]; };
  var dow = function (ymd) { return DOW[new Date(String(ymd).slice(0, 10) + 'T12:00:00Z').getUTCDay()]; };
  var when = function (iso) { return iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : ''; };
  var KIND = { Regular: 'Regular Mail', Acquisition: 'Acquisition Mail', Grant: 'Grant Mail' };
  function api(p) {
    return fetch(p, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || d.ok === false) { var e = new Error(d.message || 'That did not load.'); e.status = r.status; throw e; } return d; });
    });
  }
  function fail(el, msg) { if (el) el.innerHTML = '<p class="gh-fail">' + esc(msg || 'This part did not load. Reload the page to try again.') + '</p>'; }

  function steps(ov, m) {
    var t = function (n, k, l, big, sub, href, link) {
      return '<a class="gh-step" href="' + href + '"><span class="gh-step__k"><i class="gh-n' + (n < 4 ? ' is-warm' : n === 4 ? ' is-ok' : ' is-gold') + '">' + n + '</i>' + esc(k) + '</span><b class="gh-step__v">' + esc(big) + '</b><span class="gh-step__s">' + esc(sub) + '</span><span class="gh-step__a">' + esc(link) + ' <span aria-hidden="true">&rarr;</span></span></a>';
    };
    var mail = ov && ov.mail, on = ov && ov.online, rv = ov && ov.review, bb = (ov && ov.blackbaud) || (m && { deposits: m.totals.deposits, cents: m.totals.totalCents }), rc = ov && ov.receipts, lt = ov && ov.letters;
    var pick = ov && ov.pickupDay ? 'started on a pickup day' : 'started today';
    return t(1, 'Mail', '', mail ? String(mail.startedToday) : '0', 'deposits ' + pick, '/gift-entry/?start=1', 'Start a deposit') +
      t(2, 'Online', '', on ? String(on.toApprove) : '0', on ? 'to approve, ' + money(on.cents) : 'to approve', '/online-gifts/', 'Online gifts') +
      t(3, 'Review', '', rv ? String(rv.waiting) : '0', 'gifts waiting for a second look', '/gift-entry/', 'Gift entry') +
      t(4, 'In Blackbaud', '', bb ? String(bb.deposits) : '0', bb ? 'deposits this month, ' + money(bb.cents, true) : 'deposits this month', '/gift-entry/', 'Deposits') +
      t(5, 'Receipts', '', rc ? String(rc.lastFile ? rc.lastFile.marked : rc.left) : '0', rc && rc.lastFile ? 'marked thanked ' + when(rc.lastFile.at) : 'receipts waiting to print', '/receipts/', 'Receipts') +
      t(6, 'Letters', '', lt ? String(lt.month) : '0', 'gifts of $5,000 and up in ' + MON[new Date().getMonth()], '/gifts/letters/', 'Thank-you letters');
  }

  function chart(c) {
    if (!c || !c.days || !c.days.length) return '<p class="gh-fail">No gifts in the copy for the last week yet.</p>';
    var cap = c.capCents || 2500000;
    var tot = function (d) { return Math.min(cap, d.checksCents) + Math.min(cap, d.cardCents) + Math.min(cap, d.otherCents); };
    var max = Math.max.apply(null, c.days.map(tot).concat([1]));
    var capped = c.days.some(function (d) { return d.checksCents > cap || d.cardCents > cap || d.otherCents > cap; });
    var bars = c.days.map(function (d) {
      var h = function (v) { return (Math.min(cap, v) / max * 100).toFixed(1) + '%'; };
      var tip = dow(d.date) + ' ' + short(d.date) + ': checks and cash ' + money(d.checksCents, true) + ', card and online ' + money(d.cardCents, true) + ', other ' + money(d.otherCents, true);
      return '<div class="gh-bar" title="' + esc(tip) + '"><div class="gh-bar__stack"><i class="o" style="height:' + h(d.otherCents) + '"></i><i class="c" style="height:' + h(d.cardCents) + '"></i><i class="k" style="height:' + h(d.checksCents) + '"></i></div><span>' + dow(d.date) + ' ' + short(d.date).split(' ')[1] + '</span></div>';
    }).join('');
    return '<div class="gh-chart" role="img" aria-label="Gifts added to Blackbaud by day">' + bars + '</div><div class="gh-legend"><span><i class="k"></i>Checks and cash</span><span><i class="c"></i>Card and online</span><span><i class="o"></i>Other</span>' + (capped ? '<span class="gh-cap">Stock and DAF gifts capped at ' + money(cap, true) + ' on the chart</span>' : '') + '</div>';
  }

  function deposits(m) {
    if (!m) return '<p class="gh-fail">The deposits did not load. Reload the page to try again.</p>';
    if (!m.deposits.length) return '<p class="gh-empty">No mail deposits this month yet.</p>';
    return '<div class="gh-tbl"><div class="gh-tr gh-th"><span>Deposit</span><span>Gift date</span><span class="r">Items</span><span class="r">Total</span><span>Entered</span><span>Status</span></div>' +
      m.deposits.slice(0, 8).map(function (x) {
        var inBb = x.source === 'blackbaud' || x.status === 'committed';
        return '<a class="gh-tr" href="' + (x.favorosId ? '/gift-entry/?d=' + encodeURIComponent(x.favorosId) : '/gift-entry/') + '"><span><b>' + esc(KIND[x.kind] || 'Regular Mail') + '</b> <small>' + esc(x.batch || 'Not sent yet') + '</small></span><span>' + esc(short(x.giftDate)) + '</span><span class="r">' + x.items + (x.cash ? ' <small>(' + x.cash + ' cash)</small>' : '') + '</span><span class="r gh-amt">' + money(x.totalCents) + '</span><span><em class="gh-tag' + (x.source === 'favoros' ? ' is-fos' : '') + '">' + (x.source === 'favoros' ? 'FavorOS' : 'Typed in Blackbaud') + '</em> <small>' + esc(short(x.addedDate)) + '</small></span><span><em class="gh-pill' + (inBb ? ' is-ok' : '') + '">' + (inBb ? 'In Blackbaud' : 'In FavorOS') + '</em></span></a>';
      }).join('') + '</div>';
  }

  function online(on) {
    if (!on) return '<p class="gh-fail">Online gifts did not load.</p>';
    if (!on.rows || !on.rows.length) return '<p class="gh-empty">Nothing waiting. Every online gift is approved.</p>';
    return on.rows.map(function (r) { return '<a class="gh-li" href="/online-gifts/"><b>' + esc(r.name) + '</b><span>' + money(r.cents) + ' · ' + esc(short(r.date)) + (r.kind ? ' · ' + esc(r.kind) : '') + '</span></a>'; }).join('');
  }
  function letters(lt) {
    if (!lt) return '<p class="gh-fail">Thank-you letters did not load.</p>';
    if (!lt.rows || !lt.rows.length) return '<p class="gh-empty">No gifts of $5,000 and up this month yet.</p>';
    return lt.rows.map(function (r) { return '<a class="gh-li" href="/gifts/letters/"><b>' + esc(r.name) + '</b><span>' + money(r.cents) + (r.fund ? ' · ' + esc(r.fund) : '') + ' · ' + esc(short(r.date)) + '</span></a>'; }).join('');
  }

  var ovP = api('/api/gifts/overview').catch(function (e) { return { error: e }; });
  var mP = api('/api/gift-entry/month').catch(function (e) { return { error: e }; });
  Promise.all([ovP, mP]).then(function (res) {
    var ov = res[0].error ? null : res[0], m = res[1].error ? null : res[1];
    if (res[0].error && res[0].error.status === 403) { root.innerHTML = '<section class="h-card gh-card"><p class="gh-empty">Gifts is for the admin desk, Partner Care and the Support Team. Ask an admin for gift entry access.</p></section>'; return; }
    $('#gh-steps').innerHTML = steps(ov, m);
    $('#gh-chart').innerHTML = ov ? chart(ov.chart) : '<p class="gh-fail">The chart did not load.</p>';
    if (ov && ov.chart && ov.chart.days && ov.chart.days.length) $('#gh-chart-sub').textContent = short(ov.chart.days[0].date) + ' to ' + short(ov.chart.days[ov.chart.days.length - 1].date) + ', by day';
    $('#gh-deps').innerHTML = deposits(m);
    if (m) $('#gh-deps-sub').textContent = m.totals.deposits + ' this month · ' + m.totals.items + ' gifts · ' + money(m.totals.totalCents);
    $('#gh-online').innerHTML = online(ov && ov.online);
    if (ov && ov.online) $('#gh-online-n').textContent = ov.online.toApprove || '';
    $('#gh-letters').innerHTML = letters(ov && ov.letters);
    root.removeAttribute('aria-busy');
  });
})();
