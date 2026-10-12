/* The phone app's start page: who is signed in, which tiles show, notifications, Data saver and the offline queue. */
(function () {
  'use strict';
  var P = window.FavorPhone, $ = function (id) { return document.getElementById(id); };
  var outbox = P.createOutbox(P.idbStore(), P.chatTransport(), paintQueue);

  function api(path) { return fetch(path, { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(function (r) { return r.json(); }); }

  P.registerWorker();

  api('/api/hub/nav').then(function (d) {
    if (!d || !d.user) return;
    $('pa-who').textContent = (d.user.name || '') + (d.user.email ? ' (' + d.user.email + ')' : '');
    var a = d.access || {};
    $('pa-chat').hidden = a.chat === false;
    $('pa-meet').hidden = a.meetings === false;
    $('pa-brain').hidden = !(a.brain === undefined ? true : a.brain);
  }).catch(function () { /* offline: the tiles stay */ });

  /* notifications */
  var NOTE = {
    'needs-home-screen': 'On an iPhone, add FavorOS to the Home Screen first (Share, then Add to Home Screen), open it from there and turn notifications on.',
    unsupported: 'This browser cannot show notifications.',
    blocked: 'Notifications are blocked for FavorOS. Turn them on in the phone settings.'
  };
  function paintNotes() {
    var b = $('pa-note'), t = $('pa-test');
    P.pushState().then(function (s) {
      b.disabled = false; b.dataset.state = s; t.hidden = s !== 'on';
      if (s === 'on') { b.textContent = 'Turn notifications off'; b.classList.remove('pa-btn--on'); }
      else if (s === 'off') { b.textContent = 'Turn notifications on'; b.classList.add('pa-btn--on'); }
      else { b.textContent = 'Not available'; b.disabled = true; b.classList.remove('pa-btn--on'); }
      $('pa-note-msg').textContent = NOTE[s] || '';
    });
  }
  $('pa-note').addEventListener('click', function () {
    var b = this; b.disabled = true; $('pa-note-msg').textContent = '';
    (b.dataset.state === 'on' ? P.disablePush() : P.enablePush()).then(paintNotes).catch(function (e) { $('pa-note-msg').textContent = e.message; paintNotes(); });
  });
  $('pa-test').addEventListener('click', function () {
    $('pa-note-msg').textContent = 'Sending';
    P.sendTestPush().then(function (d) { $('pa-note-msg').textContent = d.sent ? 'Sent. It arrives in a moment.' : 'Nothing was sent. Turn notifications off and on again.'; });
  });
  paintNotes();

  /* Data saver */
  function paintData() {
    $('pa-data').value = P.lowDataSetting();
    $('pa-data-state').textContent = P.isLowData() ? 'Saving data now.' : 'Not saving data now.';
  }
  $('pa-data').addEventListener('change', function () { P.setLowData(this.value); paintData(); });
  paintData();

  /* messages waiting to send */
  function paintQueue() {
    outbox.list().then(function (l) {
      var wait = l.filter(function (x) { return !x.failed; }).length, bad = l.length - wait;
      $('pa-queue').hidden = !l.length;
      $('pa-queue-text').textContent = (wait ? wait + (wait === 1 ? ' message is' : ' messages are') + ' waiting for a connection. ' : '') + (bad ? bad + ' could not be sent.' : '');
    }).catch(function () {});
  }
  $('pa-send-now').addEventListener('click', function () { outbox.flush(); });
  window.addEventListener('online', function () { outbox.flush(); });
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'flush-outbox') outbox.flush(); });
  paintQueue();
  outbox.flush();

  $('pa-out').addEventListener('click', function () {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).finally(function () { location.replace('/login/?signedout=1'); });
  });
})();
