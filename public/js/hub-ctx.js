/* Right-click menus (2026-10-14), on the model of Radix and Base UI's ContextMenu: right-click a task, a message or a menu link
   and the actions for that thing open where the pointer is. On a phone, press and hold does the same (with a light tap).
   The Menu key or Shift+F10 opens it from the keyboard. Shift with a right-click, or a right-click inside a text box or on
   selected text, keeps the browser's own menu.

   hubCtx.add(selector, build, { touch: true })   build(el) returns the rows, or { click: button } to press the thing's own
                                                  "More" button instead (Chat messages), or nothing for the browser's menu
   A row: { label, run, icon, kbd, danger, disabled } or { sep: true }.
   hubCtx.buttons(el, [[label, selector, kbd], ...])  rows that press the buttons already inside el (they keep their own logic)

   Framework-free. The React app keeps the same rows and renders them with its menu component. */
(function () {
  if (window.hubCtx) return;
  var regs = [], menu = null, lastFocus = null, suppressUntil = 0, press = null;
  var I = {
    open: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    tab: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    pin: '<path d="M9 4h6l-1 6 4 3H6l4-3z"/><path d="M12 13v7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', sel: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>'
  };
  function icon(n) { return I[n] ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + I[n] + '</svg>' : '<span class="hc__sp"></span>'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function typing(t) { return t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'); }
  function find(t) {
    if (!t || !t.closest) return null;
    for (var i = 0; i < regs.length; i++) { var el = t.closest(regs[i].sel); if (el) return { reg: regs[i], el: el }; }
    return null;
  }
  function selectedInside(el) {
    var s = window.getSelection && window.getSelection();
    return !!(s && !s.isCollapsed && String(s).trim() && el.contains(s.anchorNode));
  }

  function close(refocus) {
    if (!menu) return;
    var m = menu; menu = null;
    m.classList.add('is-out');
    setTimeout(function () { m.remove(); }, 120);
    removeEventListener('scroll', onScroll, true);
    if (refocus && lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
  }
  function onScroll(e) { if (menu && !menu.contains(e.target)) close(false); }

  function open(hit, x, y, how) {
    var rows = hit.reg.build(hit.el);
    if (!rows) return false;
    if (rows.click) { rows.click.click(); return true; }
    if (!rows.length) return false;
    close(false);
    lastFocus = document.activeElement;
    var m = document.createElement('div');
    m.className = 'hc' + (how === 'touch' ? ' hc--touch' : '');
    m.setAttribute('role', 'menu');
    m.tabIndex = -1;
    var items = [];
    m.innerHTML = rows.map(function (r) {
      if (r.sep) return '<div class="hc__sep" role="separator"></div>';
      items.push(r);
      return '<button type="button" role="menuitem" class="hc__i' + (r.danger ? ' is-danger' : '') + '" data-i="' + (items.length - 1) + '"' + (r.disabled ? ' aria-disabled="true"' : '') + '>' + icon(r.icon) + '<span>' + esc(r.label) + '</span>' + (r.kbd ? '<kbd>' + esc(r.kbd) + '</kbd>' : '') + '</button>';
    }).join('');
    document.body.appendChild(m);
    menu = m;
    var w = m.offsetWidth, h = m.offsetHeight, vw = innerWidth, vh = innerHeight;
    var left = x + w + 8 > vw ? Math.max(8, x - w) : x, top = y + h + 8 > vh ? Math.max(8, y - h) : y;
    m.style.left = left + 'px'; m.style.top = top + 'px';
    m.style.transformOrigin = (left < x ? 'right' : 'left') + ' ' + (top < y ? 'bottom' : 'top');
    var btns = Array.prototype.slice.call(m.querySelectorAll('.hc__i'));
    var focusAt = function (i) { if (btns.length) btns[(i + btns.length) % btns.length].focus(); };
    if (how === 'key') focusAt(0); else m.focus({ preventScroll: true });
    m.addEventListener('click', function (e) {
      var b = e.target.closest('.hc__i'); if (!b || b.getAttribute('aria-disabled')) return;
      var r = items[+b.dataset.i];
      close(true);
      try { r.run(hit.el); } catch (er) { console.error(er); }
    });
    m.addEventListener('keydown', function (e) {
      var i = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i < 0 ? -1 : i - 1); }
      else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
      else if (e.key === 'End') { e.preventDefault(); focusAt(-1); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        var k = e.key.toLowerCase();
        for (var j = 1; j <= btns.length; j++) { var b = btns[(Math.max(i, -1) + j) % btns.length]; if (b.textContent.trim().toLowerCase().indexOf(k) === 0) { b.focus(); break; } }
      }
    });
    addEventListener('scroll', onScroll, true);
    if (window.hubHaptic && how === 'touch') window.hubHaptic('heavy');
    return true;
  }

  document.addEventListener('contextmenu', function (e) {
    if (Date.now() < suppressUntil) { e.preventDefault(); return; }
    if (e.shiftKey || typing(e.target)) return;
    var hit = find(e.target);
    if (!hit || selectedInside(hit.el)) return;
    if (press) { clearTimeout(press.t); press = null; }
    if (open(hit, e.clientX, e.clientY, e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) ? 'touch' : 'mouse')) e.preventDefault();
  });
  document.addEventListener('pointerdown', function (e) {
    if (menu && !menu.contains(e.target)) close(false);
    if (e.pointerType !== 'touch' || typing(e.target)) return;
    var hit = find(e.target);
    if (!hit || hit.reg.opts.touch === false) return;
    press = { x: e.clientX, y: e.clientY, hit: hit, t: setTimeout(function () {
      var p = press; press = null;
      if (p && open(p.hit, p.x, p.y, 'touch')) suppressUntil = Date.now() + 700;
    }, 480) };
  }, true);
  document.addEventListener('pointermove', function (e) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; } }, true);
  ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, function () { if (press) { clearTimeout(press.t); press = null; } }, true); });
  // The tap that ends a press-and-hold does not also open the thing under the finger.
  // On the window, so it runs before any page's own link handling.
  addEventListener('click', function (e) { if (Date.now() < suppressUntil && !(menu && menu.contains(e.target))) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  document.addEventListener('keydown', function (e) {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    var t = document.activeElement; if (typing(t)) return;
    var hit = find(t); if (!hit) return;
    var r = hit.el.getBoundingClientRect();
    if (open(hit, r.left + 16, r.top + Math.min(r.height, 40), 'key')) e.preventDefault();
  });
  addEventListener('resize', function () { close(false); });
  addEventListener('blur', function () { close(false); });
  document.addEventListener('hub-swapped', function () { close(false); });

  function copy(text, what) {
    var ok = function () { if (window.hubToast) window.hubToast((what || 'Link') + ' copied', { tone: 'ok' }); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () {});
  }
  function buttons(el, list) {
    var rows = [];
    list.forEach(function (r) {
      if (r === '-') { if (rows.length && !rows[rows.length - 1].sep) rows.push({ sep: true }); return; }
      var b = el.querySelector(r[1]);
      if (b && !b.disabled && !b.hidden) rows.push({ label: typeof r[0] === 'function' ? r[0](b) : r[0], icon: r[3], kbd: r[2], run: function () { b.click(); } });
    });
    if (rows.length && rows[rows.length - 1].sep) rows.pop();
    return rows;
  }
  // A menu link's name without its count or its Beta or Alpha mark.
  function linkName(a) {
    if (a.getAttribute('aria-label')) return a.getAttribute('aria-label').trim();
    var c = a.cloneNode(true);
    c.querySelectorAll('.h-rel, .h-nav__count, [class*="__count"], [class*="badge"], [aria-hidden="true"]').forEach(function (x) { x.remove(); });
    c.querySelectorAll('*').forEach(function (x) { if (x.isConnected && /^\s*\d+\+?\s*$/.test(x.textContent)) x.remove(); });
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function add(sel, build, opts) { regs.push({ sel: sel, build: build, opts: opts || {} }); }
  window.hubCtx = { add: add, buttons: buttons, copy: copy, close: close, linkName: linkName };

  /* ------------------------------------------------------------ what has a menu today */
  // Links in the menu rail, the tab row and the phone bar: open, open in a new tab, copy the link, pin.
  add('.h-side a.h-area__link, .h-side a.h-pg__a, #h-tabs a.h-tab, #h-bar a.h-bar__a', function (a) {
    var href = a.href, name = linkName(a);
    if (!href || a.closest('.h-area--pop') && a.classList.contains('h-area__link') && a.closest('.h-area--more')) return null;
    var rows = [
      { label: 'Open ' + name, icon: 'open', run: function () { a.click(); } },
      { label: 'Open in a new tab', icon: 'tab', run: function () { window.open(href, '_blank', 'noopener'); } },
      { label: 'Copy link', icon: 'link', run: function () { copy(href); } }
    ];
    var row = a.closest('.h-pg, .h-area');
    var pin = row && row.querySelector(':scope > .h-pin, .h-pin');
    if (pin && row.contains(pin)) rows.push({ sep: true }, { label: pin.getAttribute('aria-label') || pin.title || 'Pin', icon: 'pin', run: function () { pin.click(); } });
    return rows;
  });
  // A Chat message: its own More menu (React, Reply, Copy link, Pin, Edit, Delete), opened beside the message.
  add('.ch-msg[data-mid]', function (el) { var b = el.querySelector('[data-act="more"]'); return b ? { click: b } : null; });
  // A Projects task in a list or on the board. On a phone, press and hold drags the task, so the menu is right-click only.
  add('.pj-row[data-id], .pj-card[data-id]', function (el) {
    return buttons(el, [
      ['Open', '[data-act="open"]', 'Enter', 'open'],
      [function (b) { return b.getAttribute('aria-checked') === 'true' ? 'Reopen' : 'Mark done'; }, '[data-act="done"]', 'Space', 'check'],
      '-',
      ['Due date', '[data-act="due"]', 'D', 'cal'],
      ['Assign', '[data-act="owner"]', 'A', 'user'],
      ['Priority', '[data-act="pri"]', '', 'flag'],
      ['Rename', '[data-act="rename"]', 'F2', 'edit'],
      '-',
      ['Select', '[data-act="sel"]', 'X', 'sel']
    ]);
  }, { touch: false });
})();
