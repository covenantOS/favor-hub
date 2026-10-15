/* The keyboard sheet (2026-10-14): press ? anywhere outside a text box to see every shortcut FavorOS has, for the whole app and
   for the page you are on, as Linear, GitHub and Gmail do. Framework-free: window.hubKeys.add(group, rows) adds a page's own keys
   (rows are [keys, what it does], keys written as "Ctrl K" or "G then T"); hubKeys.open() shows the sheet.
   Mail and Favor Brain keep their own lists (their ? opens those). The Go to rows are read from the rail, so they match each person. */
(function () {
  if (window.hubKeys) return;
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var MOD = mac ? 'Cmd' : 'Ctrl';
  var extra = [];
  // Pages that keep keys in their own scripts: listed here so the sheet is complete without touching those files.
  var PAGES = [
    [/^projects/, 'Projects', [['J or Down', 'Next task'], ['K or Up', 'Previous task'], ['Enter or O', 'Open the task'], ['Space', 'Mark done or reopen'], ['N', 'Add a task'], ['X', 'Select the task'], [MOD + ' A', 'Select every task'], ['D', 'Set the due date (type fri, oct 20, in 2 weeks)'], ['A', 'Assign'], ['F2', 'Rename'], ['Alt Up or Down', 'Move the task'], ['Delete', 'Delete the selected tasks'], ['/', 'Search tasks'], ['Tab then Q', 'Quick add'], [MOD + ' K', 'Go to a project']]],
    [/^chat/, 'Chat', [['Enter', 'Send'], ['Shift Enter', 'New line'], [MOD + ' B', 'Bold'], [MOD + ' I', 'Italic'], [MOD + ' K', 'Jump to a conversation']]],
  ];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kbd(k) {
    return String(k).split(' ').map(function (p) { return p === 'then' || p === 'or' ? '<span class="hk-or">' + p + '</span>' : '<kbd>' + esc(p) + '</kbd>'; }).join('');
  }
  function goRows() {
    var rows = [];
    document.querySelectorAll('.h-side .h-area[data-key]:not([hidden])').forEach(function (a) {
      var k = a.getAttribute('data-key'), l = a.querySelector('.h-area__link');
      var name = l && window.hubCtx ? window.hubCtx.linkName(l) : l && (l.textContent || '').trim();
      if (k && name && !rows.some(function (r) { return r[0] === 'G then ' + k.toUpperCase(); })) rows.push(['G then ' + k.toUpperCase(), name]);
    });
    return rows;
  }
  function groups() {
    var nav = (document.body && document.body.dataset.nav) || '';
    var out = [];
    PAGES.forEach(function (p) { if (p[0].test(nav)) out.push([p[1], p[2]]); });
    extra.forEach(function (g) { out.push(g); });
    out.push(['Everywhere', [[MOD + ' K', 'Search FavorOS'], ['?', 'This list'], [MOD + ' Z', 'Undo the last change that offers Undo'], ['Alt T', 'Go to the latest message at the bottom'], ['[ or ]', 'Previous or next tab'], ['\\', 'Narrow or widen the menu'], ['Esc', 'Close a menu or sheet']]]);
    var g = goRows();
    if (g.length) out.push(['Go to', g]);
    return out;
  }
  function open() {
    var d = document.getElementById('hk-dlg');
    if (!d) {
      d = document.createElement('dialog');
      d.id = 'hk-dlg'; d.className = 'hs-dlg hk-dlg'; d.setAttribute('aria-labelledby', 'hk-h'); d.setAttribute('data-sheet-drag', '');
      document.body.appendChild(d);
      d.addEventListener('click', function (e) { if (e.target === d || (e.target.closest && e.target.closest('[data-hk-close]'))) d.close(); });
    }
    d.innerHTML = '<div class="hs-in"><header class="hs-head"><h2 id="hk-h">Keyboard shortcuts</h2><button type="button" class="hs-x" data-hk-close data-sheet-close aria-label="Close"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></header>' +
      groups().map(function (g) { return '<section class="hk-g"><h3 class="hs-sub">' + esc(g[0]) + '</h3><dl class="hk-list">' + g[1].map(function (r) { return '<div class="hk-row"><dt>' + kbd(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl></section>'; }).join('') + '</div>';
    if (!d.open) d.showModal();
  }
  addEventListener('keydown', function (e) {
    if (e.key !== '?' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var nav = (document.body && document.body.dataset.nav) || '';
    if (/^(mail|brain)/.test(nav)) return;
    if (document.querySelector('dialog[open]:not(#hk-dlg), #cmdk:not([hidden])')) return;
    e.preventDefault();
    open();
  });
  window.hubKeys = { add: function (group, rows) { extra.push([group, rows]); }, open: open };
})();
