/* UX pass 2026-10-10: edge fades on scrolling pill rows, and text that Blackbaud stored with a wrong character encoding. */
(function () {
  'use strict';
  var ROWS = '.wc-tabs, .wc-lanes, .wc-owners, .wc-scope, .req-tabs';
  function fade(el) {
    var over = el.scrollWidth > el.clientWidth + 2;
    el.classList.toggle('ux-fade-l', over && el.scrollLeft > 4);
    el.classList.toggle('ux-fade-r', over && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
  function wire(el) {
    if (!el.__ux) { el.__ux = 1; el.addEventListener('scroll', function () { fade(el); }, { passive: true }); }
    fade(el);
    var on = el.querySelector('.is-on, [aria-selected="true"]');
    if (on && el.scrollWidth > el.clientWidth + 2) {
      var want = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
      el.scrollLeft = Math.max(0, want);
      fade(el);
    }
  }
  // "Ã‰glise" is "Église" read through the wrong code page. Undo it only when every character maps back to a byte.
  var CP = { 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 };
  var BAD = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–-›€™]/;
  function unmoji(s) {
    if (!BAD.test(s)) return s;
    try {
      var b = []; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); var v = c < 256 ? c : CP[c]; if (v === undefined) return s; b.push(v); }
      return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(b));
    } catch (e) { return s; }
  }
  function walk(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); var n;
    while ((n = w.nextNode())) { var t = n.nodeValue; if (t && BAD.test(t)) { var u = unmoji(t); if (u !== t) n.nodeValue = u; } }
  }
  var timer = 0;
  function pass() {
    timer = 0;
    var root = document.body;
    document.querySelectorAll(ROWS).forEach(wire);
    walk(root);
  }
  function later() { if (!timer) timer = setTimeout(pass, 120); }
  var start = function () {
    var root = document.body;
    new MutationObserver(later).observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', later);
    pass();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
