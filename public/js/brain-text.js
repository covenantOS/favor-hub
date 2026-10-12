(function () {
  var $ = function (id) { return document.getElementById(id); };
  var card = $('bt-card'), err = $('bt-err'), pill = $('bt-pill');
  var phone = '';

  function show(which) {
    ['bt-send', 'bt-code', 'bt-done'].forEach(function (id) { $(id).hidden = id !== which; });
    err.hidden = true;
  }
  function fail(msg) { err.textContent = msg; err.hidden = false; }
  function api(path, body) {
    return fetch('/api/brain/text/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return { ok: false, message: 'Something went wrong. Try again.' }; }); });
  }
  function day(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : 'Since ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function draw(s) {
    card.setAttribute('aria-busy', 'false');
    pill.hidden = false;
    pill.textContent = s.live ? (s.registered ? 'Registered' : 'Not registered') : 'Not open yet';
    pill.className = 'bt-pill' + (s.live && s.registered ? ' is-on' : '');
    if (s.registered) {
      $('bt-num').textContent = s.phone || '';
      $('bt-since').textContent = day(s.since);
      show('bt-done');
    } else show('bt-send');
  }
  function load() {
    api('status').then(function (s) {
      if (!s || s.ok === false) { card.setAttribute('aria-busy', 'false'); fail((s && s.message) || 'This could not load. Reload the page.'); return; }
      draw(s);
    });
  }

  $('bt-send').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('bt-phone').value.trim();
    if (!v) return fail('Enter your mobile number.');
    var b = $('bt-send-go'); b.disabled = true;
    api('register', { phone: v }).then(function (r) {
      b.disabled = false;
      if (!r.ok) return fail(r.message || 'The code could not be sent.');
      phone = v;
      $('bt-to').textContent = v;
      $('bt-c').value = '';
      show('bt-code');
      $('bt-c').focus();
    });
  });
  $('bt-code').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = $('bt-c').value.trim();
    if (!/^\d{6}$/.test(c)) return fail('The code is 6 digits.');
    var b = $('bt-code-go'); b.disabled = true;
    api('confirm', { code: c }).then(function (r) {
      b.disabled = false;
      if (!r.ok) return fail(r.message || 'That code did not work.');
      load();
    });
  });
  $('bt-back-num').addEventListener('click', function () { show('bt-send'); $('bt-phone').focus(); });
  $('bt-change').addEventListener('click', function () { $('bt-phone').value = ''; show('bt-send'); $('bt-phone').focus(); });
  $('bt-remove').addEventListener('click', function () {
    if (!window.confirm('Remove this number? Texts from it will stop getting answers.')) return;
    api('remove', {}).then(function () { load(); });
  });
  load();
})();
