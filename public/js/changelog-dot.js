/* The What's new mark: a dot on Help > What's new and on the bell's What's new link when FavorOS changed since this person's last visit. */
(function () {
  if (window.__clDot) return;
  window.__clDot = 1;
  var seen = '';
  try { seen = localStorage.getItem('favor.changelog.seen') || ''; } catch (e) { return; }
  fetch('/changelog/latest.json', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d || !d.latest) return;
    // A first visit counts everything as seen, so a new person is not greeted by months of changes.
    if (!seen) { try { localStorage.setItem('favor.changelog.seen', d.latest); } catch (e) { /* storage refused */ } return; }
    if (d.latest > seen && location.pathname.indexOf('/changelog') !== 0) document.documentElement.classList.add('has-cl-new');
  }).catch(function () {});
})();
