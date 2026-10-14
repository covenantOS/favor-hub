/* Gifts > Thank-you letters and Gifts > Declines run the Work Center's HQTY and Declines tabs (work-hqty.js, work-declines.js) on their own
   page. Those tabs expect the Work Center around them: window.WC (api, refresh, render, S.view), window.WCTabs.registerTab and
   window.WCSkel. This file stands in for the three, so the same code and the same reads serve both places. The page names its tab in
   #view's data-wc-tab. Runs again on every visit (the page swaps in place); the tab's own script registers again and is mounted again. */
(function () {
  'use strict';
  var view = document.getElementById('view');
  if (!view) return;
  var want = view.getAttribute('data-wc-tab');
  var tab = null;
  function mount() {
    var el = document.getElementById('view');
    if (!el || el.getAttribute('data-wc-tab') !== want || !tab) return;
    try { tab.mount(); } catch (e) { el.innerHTML = '<section class="h-card wc-sheet"><p class="wc-empty">This page did not load. Reload to try again.</p></section>'; }
  }
  // The real Work Center (work.js) owns window.WC when it is on the page; this page never loads it.
  window.WC = {
    S: { view: want, loaded: true },
    api: function (p, o) { return window.FavorWG.api(p, o); },
    refresh: function () { mount(); },
    render: function () { mount(); },
    standIn: true,
  };
  window.WCSkel = function (rows, id) {
    var h = '';
    for (var i = 0; i < (rows || 5); i++) h += '<div class="wc-skelrow"><i class="a"></i><i class="b"></i><i class="c"></i></div>';
    return '<section class="h-card wc-sheet wc-skelrows" aria-busy="true"' + (id ? ' id="' + id + '"' : '') + '><div class="wc-skelbar"><i></i><i></i><i></i></div>' + h + '</section>';
  };
  window.WCTabs = {
    standIn: true,
    registerTab: function (t) {
      if (!t || t.id !== want) return;
      tab = t;
      if (typeof t.warm === 'function') { try { t.warm(); } catch (e) { /* the mount shows the error */ } }
      mount();
    },
  };
})();
