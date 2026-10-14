/* Keeps a page still while it fills in. Inlined in App.astro's head: it watches the page as the browser reads it, so a held
   container is held from the frame it first appears in (a call placed after the page body ran after the first paint), and it
   runs again for every page hub-swap.js puts in place.

   1. Held space. A container marked data-keep-h="<name>" opens at the height it had the last time this person saw this page
      (per page, name and phone or desktop width), with a quiet placeholder while it is empty, so what arrives later does not push the page down.
      Once the container has its content and has been still for a moment, its height is saved and the hold is let go.
      A container that was empty last time (saved 0) starts collapsed instead of showing a placeholder that would vanish.
   2. Arrivals. Content a script puts in place of a skeleton fades in where the skeleton was (.m-in, motion.css), on opacity
      only. Content that changes without a skeleton (a count ticking, a list refreshing) is left alone.

   Use: <div id="x" data-keep-h="x">...skeleton...</div>. Nothing else is needed. */
(function () {
  if (window.hubMotion) return;
  var KEY = 'favor.hub.keep.v1';
  var SKEL = '[class*="skel"], [class*="--wait"], [class*="__wait"], [aria-busy="true"]';
  var store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
  var saveT = 0;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage full or refused */ } }, 300);
  }
  // data-keep-h with no name is numbered in page order (fine for a page whose blocks do not move around).
  var autoN = 0;
  function keyOf(el) {
    var n = el.getAttribute('data-keep-h');
    if (!n) { if (el.__khN == null) el.__khN = autoN++; n = '#' + el.__khN; }
    return location.pathname + '|' + n + '|' + (innerWidth < 861 ? 'p' : 'd');
  }
  // Requests the page has in flight: a held block is not let go while the page is still reading (for up to 4 s), since most
  // blocks are filled from a request's answer.
  var reading = 0;
  if (window.fetch) {
    var f0 = window.fetch;
    window.fetch = function () {
      reading++;
      var p = f0.apply(this, arguments);
      var end = function () { reading = Math.max(0, reading - 1); };
      p.then(end, end);
      return p;
    };
  }
  function isSkel(n) { return n.nodeType === 1 && (n.matches(SKEL) || !!n.querySelector(SKEL)); }
  // Settled: it has content (or was hidden on purpose), nothing in it is still a skeleton, and it does not say it is busy. An empty
  // container is still waiting for its script; one that stays empty is let go after 10 s and remembered as empty.
  function settled(el) { return (el.hidden || !!el.firstElementChild || !!el.textContent.trim()) && !el.matches('[aria-busy="true"]') && !el.querySelector(SKEL); }

  var held = [];
  function hold(el) {
    if (el.__kh) return;
    var h = store[keyOf(el)];
    el.__kh = { at: Date.now(), quiet: 0, busy: el.getAttribute('aria-busy') === 'true' };
    held.push(el);
    if (h == null) return;
    if (h === 0) { el.setAttribute('data-kh-zero', ''); return; }
    el.style.minHeight = h + 'px';
    // While it is empty it shows a quiet placeholder (motion.css, [data-kh]:empty::before).
    el.setAttribute('data-kh', '');
  }
  function letGo(el) {
    el.style.minHeight = '';
    el.removeAttribute('data-kh-zero');
    el.removeAttribute('data-kh');
    var cs = getComputedStyle(el);
    store[keyOf(el)] = el.hidden || cs.display === 'none' ? 0 : Math.round(el.getBoundingClientRect().height);
    save();
    el.__kh = null;
    held.splice(held.indexOf(el), 1);
  }
  // Checked a few times a second while anything is held: a container is let go once it has been settled for 450 ms, or after 10 s.
  var tick = 0;
  function watch() {
    if (tick) return;
    tick = setInterval(function () {
      held.slice().forEach(function (el) {
        if (!el.isConnected) { held.splice(held.indexOf(el), 1); return; }
        var k = el.__kh;
        if (!k) return;
        if (Date.now() - k.at > 10000) { letGo(el); return; }
        // On a page loading whole, the page's own scripts (deferred) start their reads late: nothing counts as quiet before the load event.
        if (!settled(el) || document.readyState !== 'complete' || (reading && Date.now() - k.at < 4000)) { k.quiet = 0; return; }
        if (!k.quiet) { k.quiet = Date.now(); return; }
        if (Date.now() - k.quiet >= 450) letGo(el);
      });
      if (!held.length) { clearInterval(tick); tick = 0; }
    }, 150);
  }
  function scan(root) {
    var list = (root || document).querySelectorAll('[data-keep-h]');
    for (var i = 0; i < list.length; i++) hold(list[i]);
    if (held.length) watch();
  }

  // A held container restarts its quiet time whenever its content changes; content that replaces a skeleton fades in.
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function fadeIn(n) {
    if (n.nodeType !== 1 || n.matches('script, style, link, template, dialog') || n.classList.contains('m-in') || isSkel(n)) return;
    n.classList.add('m-in');
    n.addEventListener('animationend', function done(e) { if (e.target === n) { n.classList.remove('m-in'); n.removeEventListener('animationend', done); } });
  }
  function holdIn(n) {
    if (n.nodeType !== 1) return;
    if (n.hasAttribute('data-keep-h')) hold(n);
    if (n.firstElementChild) { var l = n.querySelectorAll('[data-keep-h]'); for (var i = 0; i < l.length; i++) hold(l[i]); }
  }
  var mo = new MutationObserver(function (recs) {
    var any = false;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var t = r.target;
      for (var a = 0; a < r.addedNodes.length; a++) { var c = r.addedNodes[a]; if (c.nodeType === 1 && (c.hasAttribute('data-keep-h') || (c.firstElementChild && c.querySelector('[data-keep-h]')))) { holdIn(c); any = true; } }
      if (t.nodeType === 1 && t.closest) {
        var h = t.closest('[data-keep-h]');
        if (h && h.__kh) {
          h.__kh.quiet = 0;
          // A container that says when it is done (aria-busy) is let go the moment it is, before the next frame.
          if (r.type === 'attributes' ? t === h : h.__kh.busy) { h.__kh.busy = true; if (settled(h)) letGo(h); }
        }
      }
      if (r.type === 'attributes') continue;
      if (reduce.matches || !r.addedNodes.length || !r.removedNodes.length) continue;
      // The page swap empties #h-content and refills it; that has its own fade (motion.css).
      if (t.id === 'h-content') continue;
      var had = false;
      for (var j = 0; j < r.removedNodes.length && !had; j++) had = isSkel(r.removedNodes[j]);
      if (!had) continue;
      for (var k = 0; k < r.addedNodes.length; k++) fadeIn(r.addedNodes[k]);
    }
    if (any) watch();
  });
  // From the head: the document element exists, the body does not yet.
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  document.addEventListener('hub-swapped', function () { autoN = 0; scan(document.getElementById('h-content')); });
  // A swapped page waits behind one placeholder until its first reads have drawn (hub-swap.js settle). When it shows, every block
  // that has its content lets go at once (a hold outliving the reveal would shrink in view), and the page fades in where it is.
  document.addEventListener('hub-settled', function () {
    var main = document.getElementById('h-content');
    if (!main) return;
    held.slice().forEach(function (el) { if (main.contains(el) && settled(el)) letGo(el); });
    if (reduce.matches) return;
    Array.prototype.forEach.call(main.children, fadeIn);
  });

  // 3. The phone's More sheet. Its rows are laid out by rules that need .h-app.is-nav, so the moment a script closed it, the sheet
  //    slid away drawn as the desktop rail (icons stacked over labels, full height). A still copy, drawn as it was, slides away
  //    instead while the real sheet is hidden.
  var phone = window.matchMedia ? matchMedia('(max-width: 860px)') : { matches: false };
  function ghost(app) {
    var side = app.querySelector('.h-side');
    if (!side) return;
    var inner = side.querySelector('.h-side__in');
    var top = inner ? inner.scrollTop : 0;
    var wrap = document.createElement('div');
    wrap.className = 'h-app is-nav m-ghost';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;min-height:0;overflow:visible;z-index:96;pointer-events:none;display:block';
    var copy = side.cloneNode(true);
    copy.removeAttribute('id');
    Array.prototype.forEach.call(copy.querySelectorAll('[id]'), function (n) { n.removeAttribute('id'); });
    copy.style.transition = 'none';
    wrap.appendChild(copy);
    document.body.appendChild(wrap);
    var ci = copy.querySelector('.h-side__in');
    if (ci) ci.scrollTop = top;
    side.classList.add('m-nav-gone');
    var done = function () { wrap.remove(); side.classList.remove('m-nav-gone'); };
    try {
      var an = copy.animate([{ transform: 'none' }, { transform: 'translateY(104%)' }], { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
      try { wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'linear', pseudoElement: '::after' }); } catch (e) { /* the scrim simply goes */ }
      an.onfinish = done; an.oncancel = done;
    } catch (e) { done(); }
  }
  function watchSheet() {
    var app = document.getElementById('h-app');
    if (!app) return;
    var was = app.classList.contains('is-nav');
    new MutationObserver(function () {
      var on = app.classList.contains('is-nav');
      if (was && !on && phone.matches && !reduce.matches) ghost(app);
      was = on;
    }).observe(app, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSheet); else watchSheet();

  window.hubMotion = { scan: scan, letGo: letGo };
})();
