/* Numbers that change roll to their new value (2026-10-14), the way Number Flow does it: only the digits that changed move, up
   when the number grows and down when it shrinks, in a quarter of a second. A number drawn for the first time does not move.

   It watches, with no change to the scripts that write the numbers:
   - the counts beside the menu, the tab row and the phone bar (.h-nav__count) and the reminders bell;
   - anything marked data-flow. A block that is redrawn whole (innerHTML) gives its number a name, data-flow="lists-count",
     so the new copy rolls from the old one's value.
   The element's text stays the plain number the whole time (other scripts add the menu counts up from it). */
(function () {
  if (window.hubFlow) return;
  var SEL = '[data-flow], .h-nav__count, #wm-bell em';
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var last = new WeakMap(); // element -> text last seen
  var named = new Map();    // data-flow name -> text last seen
  var busy = new WeakSet();

  function num(t) {
    var s = String(t || '').trim();
    if (!/\d/.test(s) || !/^[^\d]{0,2}[\d,.]+[^\d]{0,2}$/.test(s)) return null;
    var n = Number(s.replace(/[^\d.]/g, ''));
    return isFinite(n) ? n : null;
  }

  function roll(el, from, to) {
    var a = num(from), b = num(to);
    if (a == null || b == null || a === b || reduce.matches || !el.isConnected) return;
    var up = b > a;
    // Line the two up from the right, so 99 to 100 rolls every place and 1,204 to 1,205 rolls only the last digit.
    var pad = Math.max(0, to.length - from.length);
    var old = new Array(pad + 1).join(' ') + from.slice(Math.max(0, from.length - to.length));
    var html = '';
    for (var i = 0; i < to.length; i++) {
      var c = to[i], o = old[i];
      var esc = c === '<' ? '&lt;' : c === '&' ? '&amp;' : c;
      if (c !== o && /\d/.test(c)) html += '<span class="hf-d"><span class="hf-i ' + (up ? 'hf-up' : 'hf-dn') + '" data-was="' + (o && /\d/.test(o) ? o : '') + '">' + esc + '</span></span>';
      else html += esc;
    }
    busy.add(el);
    el.classList.add('hf');
    el.innerHTML = html;
    clearTimeout(el.__hfT);
    el.__hfT = setTimeout(function () {
      if (el.textContent === to) { busy.add(el); el.textContent = to; }
      el.classList.remove('hf');
    }, 420);
  }

  function seen(el) {
    if (busy.has(el)) { busy.delete(el); return; }
    var t = el.textContent;
    var name = el.getAttribute('data-flow');
    var prev = name ? named.get(name) : last.get(el);
    if (name) named.set(name, t); else last.set(el, t);
    if (prev != null && prev !== t && !el.hidden) roll(el, prev, t);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(SEL)) seen(root);
    var l = root.querySelectorAll(SEL);
    for (var i = 0; i < l.length; i++) seen(l[i]);
  }

  var mo = new MutationObserver(function (recs) {
    var hit = new Set();
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      var el = t && t.closest ? t.closest(SEL) : null;
      if (el) hit.add(el);
      for (var j = 0; j < r.addedNodes.length; j++) {
        var n = r.addedNodes[j];
        if (n.nodeType !== 1) continue;
        if (n.matches(SEL)) hit.add(n);
        if (n.firstElementChild) { var l = n.querySelectorAll(SEL); for (var k = 0; k < l.length; k++) hit.add(l[k]); }
      }
    }
    hit.forEach(seen);
  });

  function start() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  window.hubFlow = { roll: roll };
})();
