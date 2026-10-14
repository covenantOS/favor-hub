/* Today's Gift day card, for the people who work the gift day (the admin desk, Partner Care, the Support Team and admins): the six
   numbers from Gifts > Overview, each opening its page. Anyone without gift entry access gets a 403 and the card stays hidden. */
(function () {
  'use strict';
  var card = document.getElementById('tw-giftday');
  if (!card || card.dataset.on) return;
  card.dataset.on = '1';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (c) { return '$' + Math.round((c || 0) / 100).toLocaleString('en-US'); };
  var access = {};
  try { access = ((JSON.parse(localStorage.getItem('favor.hub.nav.v1') || 'null') || {}).access) || {}; } catch (e) { access = {}; }
  if (access.giftEntry === false) return;
  fetch('/api/gifts/overview', { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || d.ok === false) return;
      var cell = function (n, l, href) { return '<a class="tw-gd__c" href="' + href + '"><b>' + esc(n) + '</b><span>' + esc(l) + '</span></a>'; };
      var on = d.online || {}, bb = d.blackbaud || {}, rc = d.receipts || {}, lt = d.letters || {}, rv = d.review || {}, ml = d.mail || {};
      document.getElementById('tw-giftday-sub').textContent = d.pickupDay ? 'a pickup day' : '';
      document.getElementById('tw-giftday-body').innerHTML =
        cell(ml.startedToday || 0, 'deposits started today', '/gift-entry/?start=1') +
        cell(on.toApprove || 0, 'online gifts to approve', '/online-gifts/') +
        cell(rv.waiting || 0, 'gifts for a second look', '/gift-entry/') +
        cell(bb.deposits || 0, 'deposits this month, ' + money(bb.cents), '/gift-entry/') +
        cell(rc.lastFile ? rc.lastFile.marked : rc.left || 0, rc.lastFile ? 'receipts marked thanked' : 'receipts waiting', '/receipts/') +
        cell(lt.month || 0, 'gifts for thank-you letters', '/gifts/letters/');
      card.hidden = false;
      var root = document.getElementById('wh');
      if (root) root.hidden = false;
    })
    .catch(function () { /* the card stays hidden */ });
})();
