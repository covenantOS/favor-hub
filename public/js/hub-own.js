/* Page ownership. Inlined in the head of every hub page by src/layouts/App.astro, before any other script runs.
   A page's scripts leave timers, listeners, observers and nodes on the body behind. When hub-swap.js changes pages in place, that
   debris used to pile up (about 280 detached nodes and 5 listeners per page change). This file notes what page code created, so
   hub-swap.js can remove it before the next page arrives. The hub's own scripts (the shell list below) are never touched.
   The creator is read from the call stack: the nearest frame is a page script when its file is under /js/ and not in the shell
   list, or when it comes from code hub-swap.js evaluated (named hub-page-N.js). */
(function () {
  if (window.__hubOwn) return;
  var SHELL = /\/js\/(app-update|sheets|drill|thank|prep|partner|records|add-partner|ux-pass|hub-own|hub-shell|hub-nav|hub-swap|clips-launch|wc-bell|sticky-col)\.js|\/_astro\//;
  var own = { iv: [], to: [], ls: [], ob: [], ws: [] };
  var st = { sync: false, held: [] };
  var oSI = window.setInterval, oCI = window.clearInterval, oST = window.setTimeout, oCT = window.clearTimeout;
  var oAdd = EventTarget.prototype.addEventListener, oRem = EventTarget.prototype.removeEventListener;

  function caller() {
    var s = ''; try { s = new Error().stack || ''; } catch (e) { return ''; }
    var L = s.split('\n');
    if (L[0] && L[0].indexOf('@') < 0 && L[0].indexOf(' at ') < 0) L.shift();
    return L[3] || '';
  }
  function pageFrame(f) {
    if (!f) return false;
    if (f.indexOf('hub-page-') >= 0) return true;
    var m = f.match(/\/js\/[^\s):@]+\.js/);
    return m ? !SHELL.test(m[0]) : false;
  }
  function owned() { return st.sync || pageFrame(caller()); }

  window.setInterval = function (f, t) {
    var id = oSI.apply(this, arguments);
    if (owned()) own.iv.push(id);
    return id;
  };
  window.setTimeout = function (f, t) {
    var id = oST.apply(this, arguments);
    if (t >= 2000 && owned()) own.to.push(id);
    return id;
  };
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if ((this === document || this === window) && fn) {
      if (st.sync && (type === 'DOMContentLoaded' || type === 'load')) { st.held.push([type, fn]); return; }
      if (owned()) own.ls.push([this, type, fn, opts]);
    }
    return oAdd.call(this, type, fn, opts);
  };
  ['MutationObserver', 'IntersectionObserver', 'ResizeObserver'].forEach(function (n) {
    var C = window[n];
    if (!C || !C.prototype.observe) return;
    var o = C.prototype.observe;
    C.prototype.observe = function () { if (owned()) own.ob.push(this); return o.apply(this, arguments); };
  });
  // A page's open connections close with the page.
  ['WebSocket', 'EventSource'].forEach(function (n) {
    var C = window[n];
    if (!C) return;
    var W = function () {
      var o = arguments.length > 1 ? new C(arguments[0], arguments[1]) : new C(arguments[0]);
      if (owned()) own.ws.push(o);
      return o;
    };
    W.prototype = C.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { if (k in C) W[k] = C[k]; });
    window[n] = W;
  });
  function tag(n) { if (n && n.nodeType === 1) n.setAttribute('data-hub-own', '1'); }
  var oAppend = Node.prototype.appendChild, oInsert = Node.prototype.insertBefore;
  Node.prototype.appendChild = function (n) { if (this === document.body && owned()) tag(n); return oAppend.call(this, n); };
  Node.prototype.insertBefore = function (n) { if (this === document.body && owned()) tag(n); return oInsert.apply(this, arguments); };
  ['append', 'prepend'].forEach(function (k) {
    var o = Element.prototype[k];
    Element.prototype[k] = function () { if (this === document.body && owned()) Array.prototype.forEach.call(arguments, tag); return o.apply(this, arguments); };
  });

  var CLASSES = { html: ['wc-page', 'pp-locked', 'wg-locked', 'wg-printing', 'req-drawer-open'], body: ['has-bar', 'is-dragging-card', 'wc-dragging', 'wcd-printing'] };
  window.__hubOwn = {
    state: st,
    counts: function () { return { iv: own.iv.length, to: own.to.length, ls: own.ls.length, ob: own.ob.length }; },
    /** Remove everything page code made since the last cleanup. */
    cleanup: function () {
      own.iv.splice(0).forEach(function (id) { oCI.call(window, id); });
      own.to.splice(0).forEach(function (id) { oCT.call(window, id); });
      own.ls.splice(0).forEach(function (a) { try { oRem.call(a[0], a[1], a[2], a[3]); } catch (e) { /* gone */ } });
      own.ob.splice(0).forEach(function (o) { try { o.disconnect(); } catch (e) { /* gone */ } });
      own.ws.splice(0).forEach(function (o) { try { o.close(); } catch (e) { /* gone */ } });
      Array.prototype.slice.call(document.body.children).forEach(function (n) { if (n.getAttribute && n.getAttribute('data-hub-own')) n.remove(); });
      CLASSES.html.forEach(function (c) { document.documentElement.classList.remove(c); });
      CLASSES.body.forEach(function (c) { document.body.classList.remove(c); });
    },
  };
})();
