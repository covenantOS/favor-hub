// Loaded on every hub page. The camera button at the top right (admins only, shown by hub-shell.js) opens the pop-up
// recorder. The recorder itself loads on the first press, so other pages pay for a button and nothing more.
(function () {
  var btn = document.getElementById('clip-cam');
  if (!btn) return;
  var mod = null;
  function load() {
    if (!mod) mod = import('/js/clips/launcher.js?v=1');
    return mod;
  }
  btn.addEventListener('click', function () {
    load().then(function (m) { m.openLauncher(btn); });
  });
  btn.addEventListener('pointerenter', load, { once: true });
  // A recording whose tab closed is finished the next time an admin opens any hub page.
  var checked = false;
  function whenShown() {
    if (checked || btn.hidden) return;
    checked = true;
    setTimeout(function () { load().then(function (m) { m.resumeUnfinished(); }); }, 4000);
  }
  new MutationObserver(whenShown).observe(btn, { attributes: true, attributeFilter: ['hidden'] });
  whenShown();
})();
