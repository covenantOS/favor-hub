/* Tooltips (2026-10-14). The browser's own title tip waits a second and a half and looks like the operating system; this one
   shows after 400 ms, and once one has shown, the next button's tip shows at once (Vercel's and Emil Kowalski's rule), so
   running the mouse along the header reads each icon's name without waiting at each.

   Any button or link with a title gets it: the title moves into the tip while the pointer is on it and is put back after, so
   scripts reading .title see it as before. Keyboard focus shows the tip too. A touch never does (a long press is not a hover).
   [data-tip] works the same way for elements that draw nothing of their own. */
(function () {
  if (window.hubTip) return;
  var SEL = 'button[title], a[title], [role="button"][title], [role="tab"][title], [data-hub-tip]';
  // Elements that draw their own tip.
  var OWN = '.h-side__tog, .bc-root .tip';
  var tip = null, cur = null, timer = 0, lastHide = 0, onKey = false;
  function el() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'h-tip';
    tip.id = 'h-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }
  function textOf(t) { return t.getAttribute('data-hub-tip') || t.getAttribute('title') || t.__tipTitle || ''; }
  function place(t) {
    var r = t.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight, gap = 8;
    var below = r.bottom + gap + h < innerHeight - 4;
    var y = below ? r.bottom + gap : r.top - gap - h;
    var x = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
    tip.dataset.side = below ? 'bottom' : 'top';
    // The tip grows out of the control it names.
    tip.style.transformOrigin = Math.round(r.left + r.width / 2 - x) + 'px ' + (below ? '0' : '100%');
  }
  function show(t, instant) {
    var text = textOf(t);
    if (!text || !t.isConnected) return;
    el();
    if (t.hasAttribute('title')) { t.__tipTitle = t.getAttribute('title'); t.removeAttribute('title'); }
    cur = t;
    tip.textContent = text;
    tip.classList.toggle('is-instant', !!instant);
    tip.classList.remove('is-on');
    place(t);
    // Read out as the control's description while it shows.
    t.setAttribute('aria-describedby', 'h-tip');
    void tip.offsetWidth;
    tip.classList.add('is-on');
  }
  function hide() {
    clearTimeout(timer);
    if (!cur) return;
    if (cur.__tipTitle != null && !cur.hasAttribute('title')) cur.setAttribute('title', cur.__tipTitle);
    if (cur.getAttribute('aria-describedby') === 'h-tip') cur.removeAttribute('aria-describedby');
    cur = null;
    lastHide = Date.now();
    if (tip) tip.classList.remove('is-on');
  }
  function target(e) {
    var t = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!t || t.closest(OWN) || t.disabled) return null;
    return t;
  }
  document.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;
    var t = target(e);
    if (t === cur) return;
    if (!t) { if (cur && !cur.contains(e.target)) hide(); return; }
    hide();
    // Keep the browser's own tip from showing on top of this one.
    if (t.hasAttribute('title')) { t.__tipTitle = t.getAttribute('title'); t.removeAttribute('title'); }
    cur = t;
    var warm = Date.now() - lastHide < 400;
    timer = setTimeout(function () { if (cur === t) show(t, warm); }, warm ? 0 : 400);
  }, true);
  document.addEventListener('pointerout', function (e) {
    if (!cur) return;
    if (e.relatedTarget && cur.contains(e.relatedTarget)) return;
    if (cur.contains(e.target)) hide();
  }, true);
  document.addEventListener('focusin', function (e) {
    if (!document.documentElement.classList.contains('kbd')) return;
    var t = target(e);
    if (!t) return;
    hide();
    onKey = true;
    show(t, true);
  });
  document.addEventListener('focusout', function () { if (onKey) { onKey = false; hide(); } });
  ['pointerdown', 'scroll', 'wheel'].forEach(function (k) { addEventListener(k, function () { if (cur) hide(); }, { capture: true, passive: true }); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur) hide(); }, true);
  document.addEventListener('hub-swapped', hide);
  window.hubTip = { hide: hide };
})();
