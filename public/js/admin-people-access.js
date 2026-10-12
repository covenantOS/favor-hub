/* Admin > People: sign-in domains and the field Brain switch. People who sign in from a listed domain wait in the list below until an
   admin approves them; approved people have Chat, Meetings and Favor Brain only. Both settings are saved through /api/admin/settings. */
(function () {
  'use strict';
  var A = window.Admin, E = A.esc, root = document.getElementById('pp-access');
  if (!root) return;
  var S = {};

  function draw() {
    var d = S['signin.domains'], b = S['field.brain'];
    if (!d || !b) { root.innerHTML = ''; return; }
    root.innerHTML =
      '<div class="ad-set ad-set--rep"><div><div class="ad-set__name">' + E(d.label) + '</div><div class="ad-set__hint">' + E(d.hint) + '</div></div>' +
      '<div><input class="ad-field" id="pa-domains" value="' + E(d.value) + '" placeholder="favourafrica.org" aria-label="' + E(d.label) + '" autocomplete="off" spellcheck="false"></div>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" id="pa-save">Save</button></div></div>' +
      '<div class="ad-set ad-set--rep"><div><div class="ad-set__name">' + E(b.label) + '</div><div class="ad-set__hint">' + E(b.hint) + '</div></div>' +
      '<div><select class="ad-field" id="pa-brain" aria-label="' + E(b.label) + '">' + b.options.map(function (o) { return '<option value="' + E(o.value) + '"' + (o.value === b.value ? ' selected' : '') + '>' + E(o.label) + '</option>'; }).join('') + '</select></div>' +
      '<div class="ad-acts"><button type="button" class="ad-btn ad-btn--primary" id="pa-brain-save">Save</button></div></div>' +
      '<p class="ad-msg" id="pa-msg" role="status"></p>';
    document.getElementById('pa-save').onclick = function () { save('signin.domains', document.getElementById('pa-domains').value, this); };
    document.getElementById('pa-brain-save').onclick = function () { save('field.brain', document.getElementById('pa-brain').value, this); };
  }

  function say(text, bad) {
    var m = document.getElementById('pa-msg');
    if (!m) return;
    m.className = 'ad-msg' + (bad ? ' ad-msg--bad' : '');
    m.textContent = text;
  }

  function save(id, value, btn) {
    btn.disabled = true;
    say('Saving');
    A.api('/api/admin/settings', { id: id, value: value }).then(function (d) {
      S[id] = d.setting;
      draw();
      say('Saved.');
    }).catch(function (e) { btn.disabled = false; say(e.message, true); });
  }

  A.api('/api/admin/settings?area=people').then(function (d) {
    (d.settings || []).forEach(function (s) { S[s.id] = s; });
    draw();
  }).catch(function () { root.innerHTML = ''; });
})();
