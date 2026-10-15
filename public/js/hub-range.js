/* Shift-click a range of checkboxes (2026-10-14), as Gmail and every file manager do: tick one box, hold Shift, tick another, and
   every box between them takes the same state. Works on any list of three or more like checkboxes (Receipts, My partners,
   Evaluations, Projects admin, Lists); each box that changes fires its own change event, so the page counts it as a click.
   Switches are left alone. Framework-free; the React app keeps this file or uses the same rule in its table rows. */
(function () {
  if (window.__hubRange) return;
  window.__hubRange = true;
  var last = null;
  var BOX = 'input[type="checkbox"]:not([switch]):not(.wm-switch):not([role="switch"]):not(:disabled)';

  // Boxes are alike when they share a name or the same data- attribute names (data-pick, data-wm-pick, ...).
  function kind(b) {
    if (b.name) return 'n:' + b.name;
    var ks = [];
    for (var i = 0; i < b.attributes.length; i++) { var n = b.attributes[i].name; if (n.indexOf('data-') === 0) ks.push(n); }
    return ks.length ? 'd:' + ks.sort().join(',') : '';
  }
  function group(b) {
    var k = kind(b);
    if (!k) return null;
    var box = b.closest('tbody, table, [role="list"], [role="listbox"], ul, ol, form, section, .h-card') || document.body;
    var all = Array.prototype.filter.call(box.querySelectorAll(BOX), function (x) { return kind(x) === k && x.offsetParent !== null; });
    return all.length >= 3 ? all : null;
  }
  // Holding Shift while pressing a box would also select the page text between the two; stop that.
  document.addEventListener('mousedown', function (e) { if (e.shiftKey && last && e.target.closest && e.target.closest('label, ' + BOX)) e.preventDefault(); }, true);
  document.addEventListener('click', function (e) {
    var b = e.target;
    if (!b || !b.matches || !b.matches(BOX)) return;
    if (e.shiftKey && last && last !== b && last.isConnected) {
      var all = group(b);
      if (all) {
        var i = all.indexOf(last), j = all.indexOf(b);
        if (i >= 0 && j >= 0) {
          var on = b.checked, lo = Math.min(i, j), hi = Math.max(i, j);
          for (var n = lo; n <= hi; n++) {
            var x = all[n];
            if (x === b || x.checked === on) continue;
            x.checked = on;
            x.dispatchEvent(new Event('input', { bubbles: true }));
            x.dispatchEvent(new Event('change', { bubbles: true }));
          }
          var sel = window.getSelection && window.getSelection(); if (sel && sel.removeAllRanges) sel.removeAllRanges();
        }
      }
    }
    last = b;
  });
})();
