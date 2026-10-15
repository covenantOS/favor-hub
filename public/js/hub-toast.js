/* One place for the short messages at the bottom of the page (2026-10-14). Every page's own toast() hands its message here.

   hubToast('Saved')                                       a plain message, gone after 4 s
   hubToast('Could not save', { tone: 'bad' })             red mark, stays 6 s, read out at once
   hubToast('Marked done', { action: { label: 'Undo', fn } })   a button, stays 8 s
   hubToast('Sheet ready', { link: { href, label, external } })
   var t = hubToast('Sending', { tone: 'busy' }); t.update('Sent', { tone: 'ok' });   a message that changes in place
   hubToast.promise(p, { busy: 'Sending', ok: 'Sent', bad: (e) => e.message })

   How it behaves (numbers from Sonner, the toast library most apps copy):
   - messages stack, the newest in front; the two behind it peek out 14 px higher, each 5% smaller; more than three wait unseen;
   - pointing at the stack (or tabbing into it) spreads it out and stops every timer; so does leaving the tab;
   - a message can be flicked away down or to the right (45 px, or a quick flick);
   - the same message twice within a second restarts the first instead of stacking a copy;
   - Alt+T moves focus to the newest message; Escape inside the stack closes the one in focus. */
(function () {
  if (window.hubToast) return;
  var GAP = 14, PEEK = 14, VISIBLE = 3, KEEP = 6, SWIPE = 45, FLICK = 0.11, EXIT = 200;
  var host = null, list = [], seq = 0, hovering = false, hidden = document.hidden;
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICON = {
    ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9"/><path d="M6 10.4l2.6 2.6L14 7.6"/></svg>',
    bad: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9"/><path d="M10 5.8v5.2M10 14.1v.1"/></svg>',
    busy: '<svg viewBox="0 0 20 20" aria-hidden="true" class="ht__spin"><circle cx="10" cy="10" r="7.5"/></svg>'
  };

  function mount() {
    if (host && host.isConnected) return host;
    host = document.createElement('section');
    host.className = 'ht';
    host.setAttribute('aria-label', 'Messages (Alt+T)');
    host.setAttribute('tabindex', '-1');
    host.innerHTML = '<ol class="ht__list"></ol>';
    document.body.appendChild(host);
    var ol = host.firstChild;
    ol.addEventListener('pointerenter', function () { hovering = true; host.classList.add('is-open'); pauseAll(); layout(); });
    ol.addEventListener('pointerleave', function (e) { if (e.pointerType === 'touch') return; hovering = false; if (!host.contains(document.activeElement)) { host.classList.remove('is-open'); resumeAll(); layout(); } });
    ol.addEventListener('focusin', function () { host.classList.add('is-open'); pauseAll(); layout(); });
    ol.addEventListener('focusout', function (e) { if (host.contains(e.relatedTarget)) return; if (!hovering) { host.classList.remove('is-open'); resumeAll(); layout(); } });
    ol.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var li = e.target.closest && e.target.closest('.ht__t');
      var t = li && find(li.dataset.id);
      if (t) { e.stopPropagation(); dismiss(t); }
    });
    return host;
  }
  function find(id) { for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i]; return null; }

  // Where the stack sits on a phone: above the bottom bar when it shows.
  function barOffset() {
    var bar = document.getElementById('h-bar');
    if (!bar) return 0;
    var cs = getComputedStyle(bar);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    var r = bar.getBoundingClientRect();
    return r.height && r.top < innerHeight ? Math.max(0, innerHeight - r.top) : 0;
  }

  function layout() {
    if (!host) return;
    host.style.setProperty('--ht-bar', barOffset() + 'px');
    var open = host.classList.contains('is-open');
    var live = list.filter(function (t) { return !t.gone; });
    var front = live.length ? live[live.length - 1].h : 0;
    var lift = 0;
    // On a phone the toast spans the screen, so three dark copies behind it read as heavy slabs: one peeks, 8 px, its words hidden.
    var narrow = innerWidth <= 860, peek = narrow ? 8 : PEEK, vis = narrow ? 2 : VISIBLE;
    for (var i = live.length - 1, k = 0; i >= 0; i--, k++) {
      var t = live[i], el = t.el;
      var y, s = 1, o = 1;
      if (open) { y = -lift; lift += t.h + GAP; }
      else {
        y = -k * peek;
        s = 1 - k * (narrow ? 0.04 : 0.05);
        // A taller message behind a short one is drawn at the front one's height, so only its top edge peeks out.
        el.style.height = k && t.h !== front ? front + 'px' : '';
        if (k >= vis) o = 0;
      }
      if (open) el.style.height = '';
      el.style.setProperty('--ht-y', y + 'px');
      el.style.setProperty('--ht-s', s);
      el.style.setProperty('--ht-o', o);
      el.style.zIndex = String(100 - k);
      el.toggleAttribute('inert', !open && k >= vis);
      el.classList.toggle('is-front', k === 0);
    }
    // The open stack catches the pointer across its gaps, so moving between messages does not close it.
    host.style.setProperty('--ht-h', (open ? lift : front + Math.min(live.length - 1, vis - 1) * peek) + 'px');
  }

  function life(t) { return t.opts.ms != null ? t.opts.ms : t.opts.tone === 'busy' ? 0 : t.opts.action ? 8000 : t.opts.tone === 'bad' ? 6000 : t.opts.link ? 6000 : 4000; }
  function arm(t) {
    clearTimeout(t.timer);
    t.left = life(t);
    t.started = Date.now();
    if (t.left && !hovering && !hidden && !(host && host.classList.contains('is-open'))) t.timer = setTimeout(function () { dismiss(t); }, t.left);
  }
  function pauseAll() { list.forEach(function (t) { if (t.timer) { clearTimeout(t.timer); t.timer = 0; t.left = Math.max(800, t.left - (Date.now() - t.started)); } }); }
  function resumeAll() {
    if (hovering || hidden) return;
    list.forEach(function (t) { if (!t.gone && !t.timer && t.left && life(t)) { t.started = Date.now(); t.timer = setTimeout(function () { dismiss(t); }, t.left); } });
  }
  document.addEventListener('visibilitychange', function () { hidden = document.hidden; if (hidden) pauseAll(); else resumeAll(); });

  function body(t) {
    var o = t.opts;
    var tone = o.tone === 'bad' || o.tone === 'ok' || o.tone === 'busy' ? o.tone : '';
    // A message that turns into an error plays the family's error sound once (hub-sound.js; the On and Subtle levels).
    if (tone === 'bad' && t.tone !== 'bad' && window.hubSound && !o.silent) window.hubSound.play('error');
    t.tone = tone;
    var html = (tone ? '<span class="ht__i ht__i--' + tone + '">' + ICON[tone] + '</span>' : '') + '<span class="ht__m">' + esc(t.msg) + '</span>';
    if (o.link && o.link.href) html += '<a class="ht__b" href="' + esc(o.link.href) + '"' + (o.link.external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(o.link.label || 'Open') + '</a>';
    if (o.action && o.action.label) {
      var attrs = '';
      if (o.action.attrs) for (var k in o.action.attrs) attrs += ' ' + k + '="' + esc(o.action.attrs[k]) + '"';
      html += '<button type="button" class="ht__b" data-ht-act' + attrs + '>' + esc(o.action.label) + '</button>';
    }
    t.el.className = 'ht__t' + (tone ? ' ht__t--' + tone : '');
    t.el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
    t.el.setAttribute('aria-live', tone === 'bad' ? 'assertive' : 'polite');
    t.el.innerHTML = '<div class="ht__c">' + html + '</div>';
    var b = t.el.querySelector('[data-ht-act]');
    if (b) b.addEventListener('click', function () { var fn = t.opts.action && t.opts.action.fn; dismiss(t); if (fn) fn(); });
    var a = t.el.querySelector('a.ht__b');
    if (a) a.addEventListener('click', function () { dismiss(t); });
    t.el.style.height = '';
    t.h = t.el.offsetHeight;
  }

  function dismiss(t, how) {
    if (!t || t.gone) return;
    t.gone = true;
    clearTimeout(t.timer);
    t.el.classList.add(how === 'swipe' ? 'is-swiped' : 'is-out');
    layout();
    setTimeout(function () {
      t.el.remove();
      var i = list.indexOf(t); if (i >= 0) list.splice(i, 1);
      if (!list.length && host) { host.classList.remove('is-open'); hovering = false; }
      layout();
    }, reduce.matches ? 0 : EXIT);
    if (t.opts.onClose) try { t.opts.onClose(); } catch (e) { /* the caller's own clean-up */ }
  }

  // Flick away: the toast follows the finger at once; down and right count, other ways only stretch a little.
  function swipe(t) {
    var el = t.el, x0 = 0, y0 = 0, t0 = 0, dx = 0, dy = 0, on = false, pid = null;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || (e.target.closest && e.target.closest('button, a'))) return;
      on = true; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); dx = dy = 0;
      try { el.setPointerCapture(pid); } catch (er) { /* fine without */ }
      el.classList.add('is-drag');
    });
    el.addEventListener('pointermove', function (e) {
      if (!on || e.pointerId !== pid) return;
      var rx = e.clientX - x0, ry = e.clientY - y0;
      var damp = function (d) { return d / (1.5 + Math.abs(d) / 20); };
      dx = rx > 0 ? rx : damp(rx);
      dy = ry > 0 ? ry : damp(ry);
      if (Math.abs(rx) > Math.abs(ry)) dy = 0; else dx = 0;
      el.style.setProperty('--ht-dx', dx + 'px');
      el.style.setProperty('--ht-dy', dy + 'px');
    });
    var end = function (e) {
      if (!on || (e && e.pointerId !== pid)) return;
      on = false;
      el.classList.remove('is-drag');
      var d = Math.max(dx, dy), v = d / Math.max(1, Date.now() - t0);
      if (d >= SWIPE || (d > 8 && v > FLICK)) { if (window.hubHaptic) window.hubHaptic('light'); if (window.hubSound) window.hubSound.play('dismiss'); el.style.setProperty('--ht-dx', (dx > dy ? dx + 120 : 0) + 'px'); el.style.setProperty('--ht-dy', (dy >= dx ? dy + 80 : 0) + 'px'); dismiss(t, 'swipe'); }
      else { el.style.setProperty('--ht-dx', '0px'); el.style.setProperty('--ht-dy', '0px'); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function hubToast(msg, opts) {
    opts = opts || {};
    mount();
    var text = String(msg == null ? '' : msg);
    // The same words again within a second (two scripts reporting one save): the first one starts over.
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o.gone && o.msg === text && now - o.at < 1000 && !opts.action) { arm(o); return o.api; }
    }
    if (opts.id) { var same = find(opts.id); if (same && !same.gone) { same.api.update(text, opts); return same.api; } }
    var t = { id: opts.id || 'ht' + (++seq), msg: text, opts: opts, at: now, h: 56 };
    t.el = document.createElement('li');
    t.el.dataset.id = t.id;
    t.el.tabIndex = 0;
    host.firstChild.appendChild(t.el);
    body(t);
    list.push(t);
    t.el.classList.add('is-new');
    layout();
    // Arrives from below on the next frame, so the move is a transition another message can redirect mid-way.
    requestAnimationFrame(function () { requestAnimationFrame(function () { t.el.classList.remove('is-new'); }); });
    swipe(t);
    arm(t);
    var live = list.filter(function (x) { return !x.gone; });
    if (live.length > KEEP) dismiss(live[0]);
    t.api = {
      id: t.id,
      update: function (m, o2) { if (t.gone) return hubToast(m, o2); t.msg = String(m == null ? '' : m); t.opts = Object.assign({}, t.opts, o2 || {}); if (o2 && o2.tone == null && t.opts.tone === 'busy') t.opts.tone = ''; body(t); layout(); arm(t); return t.api; },
      dismiss: function () { dismiss(t); }
    };
    return t.api;
  }
  hubToast.ok = function (m, o) { return hubToast(m, Object.assign({ tone: 'ok' }, o)); };
  hubToast.bad = function (m, o) { return hubToast(m, Object.assign({ tone: 'bad' }, o)); };
  hubToast.dismiss = function (id) { if (id == null) list.slice().forEach(function (t) { dismiss(t); }); else dismiss(find(id)); };
  hubToast.promise = function (p, m) {
    var t = hubToast(m.busy || 'Working', { tone: 'busy' });
    if (window.hubProgress) window.hubProgress.wrap(p);
    var say = function (x, v) { return typeof x === 'function' ? x(v) : x; };
    Promise.resolve(p).then(function (v) { t.update(say(m.ok, v) || 'Done', { tone: 'ok' }); }, function (e) { t.update(say(m.bad, e) || (e && e.message) || 'That did not work. Try again.', { tone: 'bad' }); });
    return p;
  };
  addEventListener('keydown', function (e) {
    if (!(e.altKey && (e.key === 't' || e.key === 'T' || e.code === 'KeyT'))) return;
    var live = list.filter(function (t) { return !t.gone; });
    if (!live.length) return;
    e.preventDefault();
    live[live.length - 1].el.focus();
  });
  // Ctrl+Z (Cmd+Z on a Mac) presses the Undo of the newest message that offers one, while it shows, as Gmail and Linear do.
  // Inside a text box the keys stay the box's own undo.
  addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key !== 'z' && e.key !== 'Z') || e.defaultPrevented) return;
    var tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    var live = list.filter(function (t) { return !t.gone && t.opts.action && /^undo/i.test(t.opts.action.label || ''); });
    if (!live.length) return;
    e.preventDefault();
    var t = live[live.length - 1], fn = t.opts.action.fn;
    dismiss(t);
    if (fn) fn();
    if (window.hubHaptic) window.hubHaptic('light');
  });
  hubToast.undoable = function () { return list.some(function (t) { return !t.gone && t.opts.action && /^undo/i.test(t.opts.action.label || ''); }); };
  addEventListener('resize', function () { if (list.length) layout(); });
  document.addEventListener('hub-swapped', function () { if (list.length) layout(); });
  window.hubToast = hubToast;
})();
