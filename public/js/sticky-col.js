// Sticky first column for wide tables. Styles live in src/styles/sticky-col.css.
// A table with class sc-table gets sc-wide when its scroll box overflows, and sc-scrolled
// once that box has moved sideways. Tables that fit, or that stack into cards on a phone,
// get neither class and keep their normal layout.
(function () {
  'use strict';

  var SEL = 'table.sc-table';
  var boxes = new WeakMap();
  var queued = false;

  // Help articles tag their own tables here; the markdown renderer does not add the class.
  document.querySelectorAll('.hd-body table').forEach(function (t) { t.classList.add('sc-table'); });

  // The element that scrolls sideways: the table itself (help articles), else the nearest
  // ancestor with overflow-x set to auto or scroll.
  function boxOf(table) {
    var own = getComputedStyle(table).overflowX;
    if (own === 'auto' || own === 'scroll') return table;
    for (var el = table.parentElement; el && el !== document.body; el = el.parentElement) {
      var ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return el;
    }
    return null;
  }

  function scan() {
    queued = false;
    document.querySelectorAll(SEL).forEach(function (t) {
      var box = boxOf(t);
      boxes.set(t, box);
      var wide = !!box && box.scrollWidth > box.clientWidth + 1;
      t.classList.toggle('sc-wide', wide);
      t.classList.toggle('sc-scrolled', wide && box.scrollLeft > 0);
    });
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  // Scroll events do not bubble, so listen in the capture phase on the document.
  document.addEventListener('scroll', function (e) {
    var target = e.target;
    if (!target || target.nodeType !== 1) return;
    if (target.matches && target.matches(SEL)) {
      if (boxes.get(target) === target) target.classList.toggle('sc-scrolled', target.scrollLeft > 0);
      return;
    }
    if (!target.querySelectorAll) return;
    target.querySelectorAll(SEL + '.sc-wide').forEach(function (t) {
      if (boxes.get(t) === target) t.classList.toggle('sc-scrolled', target.scrollLeft > 0);
    });
  }, true);

  // Tabs, drawers and live-rendered tables change layout without a resize, so re-check on clicks too.
  document.addEventListener('click', function () { setTimeout(queue, 80); }, true);
  window.addEventListener('resize', queue);
  window.addEventListener('load', queue);
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
})();
