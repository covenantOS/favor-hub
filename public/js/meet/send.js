// Meetings: the Send the link sheet. Opens from a meeting on the Meetings page, from the pre-join screen and from inside the room.
// A host picks everyone or chosen people, email and text, with an optional line above the Join button, and can add a person by
// name, email or phone. Anyone else sends the link to themselves (Send to my phone). Server: GET and POST meetings/:id/send.
(function () {
  if (window.FavorSend) return;
  var CSS = '' +
    '.sl-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(20,24,18,.42);opacity:0;transition:opacity .16s}' +
    '.sl-wrap.is-in{opacity:1}' +
    '.sl{width:min(560px,calc(100vw - 32px));max-height:min(760px,calc(100dvh - 40px));display:flex;flex-direction:column;background:#fffdf8;color:#1d211b;border-radius:22px;box-shadow:0 24px 60px rgba(20,24,18,.28);font:400 14px/1.45 var(--h-font,system-ui,sans-serif);transform:translateY(8px);transition:transform .18s}' +
    '.sl-wrap.is-in .sl{transform:none}' +
    '.sl-h{display:flex;gap:12px;align-items:flex-start;padding:18px 20px 12px;border-bottom:1px solid #e7e0cf}' +
    '.sl-h h2{margin:0;font:400 21px/1.2 var(--h-serif,Georgia,serif)}.sl-h p{margin:3px 0 0;color:#57534a;font-size:13px}' +
    '.sl-h .sl-live{display:inline-block;margin-right:6px;padding:2px 8px;border-radius:99px;background:#f7dcd5;color:#b3412b;font-weight:700;font-size:11.5px}' +
    '.sl-x{margin-left:auto;flex:none;width:36px;height:36px;border:0;border-radius:12px;background:transparent;cursor:pointer;color:#57534a}.sl-x:hover{background:#f4efe0}' +
    '.sl-x svg,.sl-i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.sl-b{overflow:auto;padding:14px 20px;display:grid;gap:14px}' +
    '.sl-lab{font:700 11px/1 var(--h-font,sans-serif);letter-spacing:1.2px;text-transform:uppercase;color:#8a8578;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}' +
    '.sl-lab button{font:600 12.5px var(--h-font,sans-serif);letter-spacing:0;text-transform:none;border:0;background:none;color:#2b4d24;cursor:pointer;padding:4px 2px}' +
    '.sl-in{width:100%;box-sizing:border-box;height:42px;border:1px solid #e7e0cf;border-radius:12px;padding:0 12px;font:inherit;background:#fff;color:inherit}' +
    '.sl-in:focus{outline:2px solid #2b4d24;outline-offset:1px;border-color:transparent}' +
    '.sl-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.sl-chip{border:1px solid #e7e0cf;background:#fff;border-radius:99px;padding:6px 11px;font:500 12.5px var(--h-font,sans-serif);color:#57534a;cursor:pointer}.sl-chip:hover{border-color:#2b4d24;color:#2b4d24}' +
    '.sl-chip.is-on{background:#e6efdc;border-color:#2b4d24;color:#2b4d24}' +
    '.sl-via{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.sl-tog{display:flex;align-items:center;gap:10px;border:1px solid #e7e0cf;border-radius:14px;padding:10px 12px;background:#fff;cursor:pointer;font:inherit;color:inherit;text-align:left}' +
    '.sl-tog b{display:block;font-weight:600}.sl-tog small{display:block;color:#8a8578;font-size:12px}' +
    '.sl-tog.is-on{border-color:#2b4d24;background:#e6efdc}.sl-tog[disabled]{opacity:.55;cursor:not-allowed}' +
    '.sl-box{flex:none;width:20px;height:20px;border-radius:6px;border:1.5px solid #b9b2a0;display:grid;place-items:center;background:#fff}' +
    '.is-on>.sl-box,.sl-p.is-on .sl-box{background:#2b4d24;border-color:#2b4d24;color:#fff}.sl-box svg{width:13px;height:13px;stroke-width:3}' +
    '.sl-ppl{display:grid;gap:2px;max-height:300px;overflow:auto;margin:0 -6px;padding:0 6px}' +
    '.sl-p{display:flex;align-items:center;gap:10px;padding:8px 6px;border-radius:12px;cursor:pointer;user-select:none}.sl-p:hover{background:#f4efe0}' +
    '.sl-p[aria-disabled="true"]{cursor:default;opacity:.6}' +
    '.sl-av{flex:none;width:34px;height:34px;border-radius:99px;display:grid;place-items:center;font:700 12px var(--h-font,sans-serif);background:#e6efdc;color:#2b4d24}' +
    '.sl-p .sl-t{min-width:0;flex:1}.sl-p .sl-t b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sl-p .sl-t small{display:block;color:#8a8578;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.sl-tag{flex:none;font:600 11px var(--h-font,sans-serif);padding:3px 8px;border-radius:99px;background:#f4efe0;color:#57534a}.sl-tag--here{background:#e6efdc;color:#2b4d24}' +
    '.sl-ph{flex:none;border:0;background:none;color:#2b4d24;font:600 12px var(--h-font,sans-serif);cursor:pointer;padding:6px 4px}' +
    '.sl-add{display:flex;gap:8px}.sl-add .sl-in{flex:1}' +
    '.sl-btn{height:42px;border-radius:12px;padding:0 16px;border:1px solid #e7e0cf;background:#fff;color:#1d211b;font:600 14px var(--h-font,sans-serif);cursor:pointer;display:inline-flex;align-items:center;gap:8px;justify-content:center;white-space:nowrap}' +
    '.sl-btn--go{background:#2b4d24;border-color:#2b4d24;color:#fff}.sl-btn[disabled]{opacity:.5;cursor:not-allowed}' +
    '.sl-f{display:flex;gap:8px;align-items:center;padding:12px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #e7e0cf}.sl-f .sl-msg{flex:1;color:#57534a;font-size:13px}' +
    '.sl-res{display:grid;gap:4px;font-size:13px}.sl-res div{display:flex;gap:8px;justify-content:space-between}.sl-res .ok{color:#2b4d24;font-weight:600}.sl-res .bad{color:#b3412b;font-weight:600}.sl-res .skip{color:#8a8578}' +
    '.sl-note{font-size:12.5px;color:#8a8578;margin:6px 0 0}' +
    '.sl-match{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '@media (max-width:640px){.sl-wrap{align-items:flex-end}.sl{width:100%;max-height:calc(100dvh - 24px);border-radius:22px 22px 0 0}.sl-via{grid-template-columns:1fr}.sl-ppl{max-height:none}.sl-btn{height:46px}.sl-f .sl-btn--go{flex:1}.sl-f{flex-wrap:wrap}.sl-f .sl-msg{flex-basis:100%}}';
  var ICON = { x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="m5 12 5 5L20 7"/>', send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>' };
  function ic(n, c) { return '<svg class="' + (c || 'sl-i') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { return String(n || '?').trim().split(/[\s@]+/).filter(Boolean).slice(0, 2).map(function (x) { return x[0].toUpperCase(); }).join('') || '?'; }
  function ago(t) { var s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + ' min ago'; var h = Math.round(m / 60); return h < 24 ? h + ' hr ago' : Math.round(h / 24) + ' days ago'; }
  function api(path, body) {
    return fetch('/api/meet/' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.message || 'Something went wrong. Try again.'); e.code = j.error; throw e; } return j; });
    });
  }
  function whenLine(st) {
    if (st.status === 'live') return '<span class="sl-live">Live now</span>' + esc(st.title);
    if (!st.startsAt) return esc(st.title);
    var d = new Date(st.startsAt);
    return esc(st.title) + ', ' + esc(d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' ET';
  }
  var NOTES_SOON = ['Starting now', 'Running 5 minutes late', 'Here is the link for today'];
  var NOTES_LIVE = ['We are live, join here', 'Running 5 minutes late', 'Use this link to get back in'];

  var S = null;
  function open(o) {
    if (S) close();
    if (!document.getElementById('sl-css')) { var st = document.createElement('style'); st.id = 'sl-css'; st.textContent = CSS; document.head.appendChild(st); }
    var wrap = document.createElement('div');
    wrap.className = 'sl-wrap';
    wrap.innerHTML = '<div class="sl" role="dialog" aria-modal="true" aria-labelledby="sl-title"><header class="sl-h"><div><h2 id="sl-title">Send the link</h2><p>Loading</p></div><button type="button" class="sl-x" data-a="close" aria-label="Close">' + ic('x') + '</button></header><div class="sl-b"></div></div>';
    document.body.appendChild(wrap);
    S = { id: o.id, el: wrap, back: document.activeElement, pick: new Set(), via: { email: true, text: false }, note: '', st: null, res: null, busy: false, phoneFor: '', matches: null, self: !!o.self };
    wrap.addEventListener('click', onClick);
    wrap.addEventListener('keydown', onKey);
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });
    load(true);
  }
  function close() {
    if (!S) return;
    var s = S; S = null;
    s.el.classList.remove('is-in');
    setTimeout(function () { s.el.remove(); }, 180);
    if (s.back && s.back.focus) try { s.back.focus(); } catch (e) { /* gone */ }
  }
  function load(first) {
    var s = S;
    return api('meetings/' + s.id + '/send').then(function (st) {
      if (S !== s) return;
      // From the pre-join screen a person sends the link to themselves, host or not.
      if (s.self) { st.mayAll = false; st.people = st.people.filter(function (p) { return p.you; }); }
      s.st = st;
      if (first) {
        // Everyone not in the room yet starts ticked; a person sends to themselves.
        st.people.forEach(function (p) { if (st.mayAll ? !p.you && !p.here && !p.why : p.you) s.pick.add(p.key); });
        s.via.text = st.texts && !st.mayAll && !!st.myPhone;
        if (s.self) s.via.email = !s.via.text;
      }
      paint();
      if (first) setTimeout(function () { var f = s.el.querySelector('.sl-b button, .sl-b input'); if (f) f.focus(); }, 40);
    }).catch(function (e) { if (S === s) { s.el.querySelector('.sl-b').innerHTML = '<p>' + esc(e.message) + '</p>'; s.el.querySelector('.sl-h p').textContent = ''; } });
  }
  function personSub(p, st) {
    var bits = [];
    if (p.email) bits.push(p.email);
    if (p.hasPhone) bits.push('mobile ' + p.phone.slice(-4));
    if (p.why) bits.push(p.why);
    else if (p.last && (p.last.email || p.last.text)) bits.push('sent ' + ago(Math.max(p.last.email || 0, p.last.text || 0)));
    return bits.join(' · ');
  }
  function personRow(p, st) {
    var on = S.pick.has(p.key), dis = !!p.why;
    var tag = p.here ? '<span class="sl-tag sl-tag--here">Here now</span>' : p.host ? '<span class="sl-tag">Host</span>' : p.guest ? '<span class="sl-tag">Guest</span>' : '';
    var phone = st.mayAll && st.texts && !p.guest && p.email ? '<button type="button" class="sl-ph" data-a="phone" data-k="' + esc(p.key) + '">' + (p.hasPhone ? 'Change mobile' : 'Add mobile') + '</button>' : '';
    var row = '<div class="sl-p' + (on ? ' is-on' : '') + '" role="checkbox" tabindex="0" aria-checked="' + on + '"' + (dis ? ' aria-disabled="true"' : '') + ' data-a="pick" data-k="' + esc(p.key) + '"><span class="sl-box">' + (on ? ic('check') : '') + '</span><span class="sl-av">' + esc(initials(p.name)) + '</span><span class="sl-t"><b>' + esc(p.name) + (p.you ? ' (you)' : '') + '</b><small>' + esc(personSub(p, st)) + '</small></span>' + tag + phone + '</div>';
    if (S.phoneFor === p.key) row += '<div class="sl-add" style="padding:0 6px 8px 50px"><input class="sl-in" id="sl-phone-in" type="tel" inputmode="tel" autocomplete="off" placeholder="Mobile for ' + esc(p.name.split(' ')[0]) + '" aria-label="Mobile number"><button type="button" class="sl-btn" data-a="phone-save" data-k="' + esc(p.key) + '">Save</button></div>';
    return row;
  }
  function paint() {
    var s = S, st = s.st, live = st.status === 'live';
    s.el.querySelector('.sl-h p').innerHTML = whenLine(st);
    s.el.querySelector('#sl-title').textContent = st.mayAll ? 'Send the link' : 'Send me the link';
    var people = st.people, pickable = people.filter(function (p) { return !p.why; });
    var n = people.filter(function (p) { return s.pick.has(p.key); }).length;
    var b = '';
    if (st.mayAll) {
      var notHere = pickable.filter(function (p) { return !p.here && !p.you; });
      b += '<section><div class="sl-lab"><span>Who</span><span>' +
        '<button type="button" data-a="all">Everyone</button>' + (live ? ' <button type="button" data-a="nothere">Not here yet (' + notHere.length + ')</button>' : '') + ' <button type="button" data-a="none">Clear</button></span></div>' +
        '<div class="sl-ppl">' + people.map(function (p) { return personRow(p, st); }).join('') + '</div>' +
        '<div class="sl-add" style="margin-top:8px"><input class="sl-in" id="sl-add-in" autocomplete="off" autocapitalize="off" enterkeyhint="done" placeholder="Add a person: name, email or phone" aria-label="Add a person by name, email or phone" maxlength="200"><button type="button" class="sl-btn" data-a="add">Add</button></div>' +
        (s.matches ? '<div class="sl-match">' + s.matches.map(function (m) { return '<button type="button" class="sl-chip" data-a="addpick" data-v="' + esc(m.email) + '">' + esc(m.name) + '</button>'; }).join('') + '</div>' : '') +
        '</section>';
    } else {
      b += '<section><div class="sl-lab"><span>Your mobile</span></div><div class="sl-add"><input class="sl-in" id="sl-my-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="' + (st.myPhone ? esc(st.myPhone) : 'Mobile number') + '" aria-label="Your mobile number"><button type="button" class="sl-btn" data-a="myphone">Save</button></div>' +
        '<p class="sl-note">' + (st.texts ? 'Saved for meeting texts. Hosts never see the full number.' : 'Meeting texts are off. The link comes by email.') + '</p></section>';
    }
    b += '<section><div class="sl-lab"><span>Send by</span></div><div class="sl-via">' +
      '<button type="button" class="sl-tog' + (s.via.email ? ' is-on' : '') + '" data-a="via" data-v="email" aria-pressed="' + s.via.email + '"><span class="sl-box">' + (s.via.email ? ic('check') : '') + '</span><span><b>Email</b><small>Join button, time in Eastern, Kampala and Juba</small></span></button>' +
      '<button type="button" class="sl-tog' + (s.via.text ? ' is-on' : '') + '" data-a="via" data-v="text" aria-pressed="' + s.via.text + '"' + (st.texts ? '' : ' disabled') + '><span class="sl-box">' + (s.via.text ? ic('check') : '') + '</span><span><b>Text</b><small>' + (st.texts ? 'To people with a mobile number' : 'Off. An admin turns texts on in Admin, Meetings.') + '</small></span></button></div></section>';
    if (st.mayAll) {
      var chips = live ? NOTES_LIVE : NOTES_SOON;
      b += '<section><div class="sl-lab"><span>Add a line (optional)</span></div><input class="sl-in" id="sl-note" maxlength="200" placeholder="Shown above the Join button" value="' + esc(s.note) + '" aria-label="A line shown above the Join button"><div class="sl-chips">' + chips.map(function (c) { return '<button type="button" class="sl-chip' + (s.note === c ? ' is-on' : '') + '" data-a="note" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></section>';
    }
    if (s.res) b += '<section aria-live="polite"><div class="sl-lab"><span>Result</span></div><div class="sl-res">' + s.res.map(function (r) { return '<div><span>' + esc(r.name) + ', ' + r.channel + '</span><span class="' + (r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'bad' : 'skip') + '">' + esc(r.status === 'sent' ? 'Sent' : r.detail) + '</span></div>'; }).join('') + '</div></section>';
    var bodyEl = s.el.querySelector('.sl-b');
    var keep = document.activeElement && document.activeElement.id, val = keep && document.getElementById(keep) ? document.getElementById(keep).value : null;
    var scroll = bodyEl.scrollTop;
    bodyEl.innerHTML = b;
    bodyEl.scrollTop = scroll;
    if (keep && document.getElementById(keep) && val != null) { var k = document.getElementById(keep); k.value = val; k.focus(); }
    var foot = s.el.querySelector('.sl-f');
    if (!foot) { foot = document.createElement('footer'); foot.className = 'sl-f'; s.el.querySelector('.sl').appendChild(foot); }
    var ch = (s.via.email ? 1 : 0) + (s.via.text ? 1 : 0);
    var label = !st.mayAll ? (s.via.text && s.via.email ? 'Email and text me' : s.via.text ? 'Text me' : 'Email me') : 'Send to ' + n + (n === 1 ? ' person' : ' people');
    foot.innerHTML = '<span class="sl-msg">' + (st.mayAll && live ? 'People already in the room are left off unless you tick them.' : '') + '</span><button type="button" class="sl-btn" data-a="close">Done</button><button type="button" class="sl-btn sl-btn--go" data-a="send"' + (!n || !ch || s.busy ? ' disabled' : '') + '>' + ic('send') + esc(s.busy ? 'Sending' : label) + '</button>';
  }
  function send() {
    var s = S; if (!s || s.busy) return;
    var via = []; if (s.via.email) via.push('email'); if (s.via.text) via.push('text');
    s.busy = true; paint();
    api('meetings/' + s.id + '/send', { to: Array.from(s.pick), via: via, note: s.st.mayAll ? s.note : '' }).then(function (r) {
      if (S !== s) return;
      s.busy = false; s.res = r.results;
      return load(false).then(function () {
        var t = window.hubToast || window.toast;
        if (typeof t === 'function') t(r.sent ? 'Sent ' + r.sent + (r.sent === 1 ? ' message' : ' messages') : 'Nothing sent');
      });
    }).catch(function (e) { if (S !== s) return; s.busy = false; s.res = [{ name: 'Not sent', channel: '', status: 'failed', detail: e.message }]; paint(); });
  }
  function add(v) {
    var s = S, val = v || (document.getElementById('sl-add-in') || {}).value || '';
    if (!val.trim()) return;
    s.busy = true;
    var via = []; if (s.via.email) via.push('email'); if (s.via.text) via.push('text');
    // Adding sends nothing by itself: the person is put on the meeting and ticked, the host presses Send.
    api('meetings/' + s.id + '/send', { add: { to: val.trim() }, to: [], via: via.length ? via : ['email'], dry: true }).then(function (r) {
      s.busy = false;
      if (r.matches) { s.matches = r.matches; paint(); return; }
      s.matches = null;
      (r.results || []).forEach(function (x) { s.pick.add(x.key); });
      var inp = document.getElementById('sl-add-in'); if (inp) inp.value = '';
      return load(false);
    }).catch(function (e) { s.busy = false; s.res = [{ name: val, channel: 'add', status: 'failed', detail: e.message }]; paint(); });
  }
  function savePhone(forKey) {
    var s = S, inp = document.getElementById('sl-phone-in'); if (!inp || !inp.value.trim()) return;
    api('meetings/' + s.id + '/send', { add: { to: inp.value.trim(), for: forKey }, to: [], via: ['text'], dry: true }).then(function () { s.phoneFor = ''; return load(false); })
      .catch(function (e) { s.res = [{ name: 'Mobile', channel: '', status: 'failed', detail: e.message }]; paint(); });
  }
  function saveMine() {
    var s = S, inp = document.getElementById('sl-my-phone'); if (!inp) return;
    api('meetings/myphone', { phone: inp.value.trim() }).then(function (r) { s.st.myPhone = r.phone; if (r.phone && s.st.texts) s.via.text = true; inp.value = ''; return load(false); })
      .catch(function (e) { s.res = [{ name: 'Mobile', channel: '', status: 'failed', detail: e.message }]; paint(); });
  }
  function onClick(e) {
    if (e.target === S.el) return close();
    var t = e.target.closest('[data-a]'); if (!t || t.disabled) return;
    var a = t.getAttribute('data-a'), k = t.getAttribute('data-k'), st = S.st;
    if (a === 'close') return close();
    if (a === 'pick') { if (t.getAttribute('aria-disabled') === 'true' || !st.mayAll) return; if (S.pick.has(k)) S.pick.delete(k); else S.pick.add(k); return paint(); }
    if (a === 'all') { st.people.forEach(function (p) { if (!p.why && !p.you) S.pick.add(p.key); }); return paint(); }
    if (a === 'nothere') { S.pick.clear(); st.people.forEach(function (p) { if (!p.why && !p.you && !p.here) S.pick.add(p.key); }); return paint(); }
    if (a === 'none') { S.pick.clear(); return paint(); }
    if (a === 'via') { var v = t.getAttribute('data-v'); S.via[v] = !S.via[v]; return paint(); }
    if (a === 'note') { var n = t.getAttribute('data-v'); S.note = S.note === n ? '' : n; paint(); var ni = document.getElementById('sl-note'); if (ni) ni.value = S.note; return; }
    if (a === 'phone') { e.stopPropagation(); S.phoneFor = S.phoneFor === k ? '' : k; paint(); var pi = document.getElementById('sl-phone-in'); if (pi) pi.focus(); return; }
    if (a === 'phone-save') return savePhone(k);
    if (a === 'add') return add();
    if (a === 'addpick') return add(t.getAttribute('data-v'));
    if (a === 'myphone') return saveMine();
    if (a === 'send') return send();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); return close(); }
    var t = e.target;
    if (t.id === 'sl-note') setTimeout(function () { if (S) S.note = t.value; }, 0);
    if (e.key === 'Enter') {
      if (t.id === 'sl-add-in') { e.preventDefault(); return add(); }
      if (t.id === 'sl-phone-in') { e.preventDefault(); return savePhone(S.phoneFor); }
      if (t.id === 'sl-my-phone') { e.preventDefault(); return saveMine(); }
    }
    if ((e.key === ' ' || e.key === 'Enter') && t.getAttribute && t.getAttribute('data-a') === 'pick') { e.preventDefault(); t.click(); }
    if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(S.el.querySelectorAll('button:not([disabled]), input, [tabindex="0"]'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  }
  // Any page can carry a button with data-favor-send="<meeting id>" (and data-favor-self for Send me the link).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-favor-send]');
    if (!b) return;
    e.preventDefault();
    open({ id: b.getAttribute('data-favor-send'), self: b.hasAttribute('data-favor-self') });
  });
  window.FavorSend = { open: open, close: close, isOpen: function () { return !!S; } };
})();
