/* Admin overview: the health strip, the counts on the settings links and the last few changes. */
(function () {
  'use strict';
  var A = window.Admin, $ = function (id) { return document.getElementById(id); };
  var strip = $('ad-strip');

  function tile(it) {
    var h = '<article class="ad-tile" data-health="' + A.esc(it.id) + '" data-status="' + it.status + '">';
    h += '<div class="ad-tile__top"><span class="ad-tile__label">' + A.esc(it.label) + '</span><span class="ad-pill ad-pill--' + it.status + '">' + A.label[it.status] + '</span></div>';
    h += '<div class="ad-tile__when">' + A.esc(it.dayOnly ? A.day(it.at) : A.when(it.at)) + '</div>';
    if (it.meter) {
      var pct = Math.min(100, (it.meter.used / it.meter.of) * 100);
      h += '<div class="ad-meter" role="img" aria-label="' + it.meter.used + ' of ' + it.meter.of + '"><i style="width:' + Math.max(pct, it.meter.used ? 1.5 : 0) + '%"></i></div>';
      h += '<div class="ad-meter__note"><span>' + it.meter.used.toLocaleString('en-US') + ' of ' + it.meter.of.toLocaleString('en-US') + '</span><span>' + A.esc(it.meter.shareLabel || '') + '</span></div>';
    }
    if (it.parts) {
      h += '<ul class="ad-parts">' + it.parts.map(function (p) { return '<li><span><i class="ad-dot ad-dot--' + p.status + '"></i>' + A.esc(p.label) + '</span><span>' + A.esc(p.at ? A.when(p.at).replace(' ET', '') : 'No run') + '</span></li>'; }).join('') + '</ul>';
    } else {
      h += '<div class="ad-tile__detail">' + A.esc(it.detail || '') + '</div>';
    }
    return h + '</article>';
  }

  function load() {
    $('ad-stamp').textContent = 'Checking';
    return A.api('/api/admin/health').then(function (d) {
      strip.innerHTML = d.items.map(tile).join('');
      strip.removeAttribute('aria-busy');
      var bad = d.items.filter(function (i) { return i.status === 'failed'; }).length, late = d.items.filter(function (i) { return i.status === 'late'; }).length;
      $('ad-stamp').textContent = (bad ? bad + ' failed' : late ? late + ' late' : 'All clear') + ' as of ' + A.when(d.at).replace('Today ', '');
    }).catch(function (e) { A.fail($('ad-root'), e); });
  }

  function counts() {
    fetch('/api/hub/nav', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      var c = (d && d.counts) || {};
      document.querySelectorAll('#ad-go [data-ad-count]').forEach(function (el) {
        var n = Number(c[el.dataset.adCount]) || 0;
        if (n) { el.textContent = n + ' waiting'; el.hidden = false; }
      });
    }).catch(function () {});
  }

  function recent() {
    A.api('/api/admin/audit?limit=5').then(function (d) {
      var box = $('ad-recent');
      if (!d.entries.length) { box.innerHTML = '<p class="ad-empty">No settings have been changed yet.</p>'; return; }
      box.innerHTML = '<ul class="ad-feed">' + d.entries.map(function (e) {
        return '<li><b>' + A.esc(e.label) + '</b><span class="ad-feed__chg"><span class="mute">' + A.esc(e.before == null ? '' : e.before) + '</span> to ' + A.esc(e.after == null ? '' : e.after) + '</span><span class="ad-feed__who">' + A.esc(e.actor) + ', ' + A.esc(A.full(e.at)) + '</span></li>';
      }).join('') + '</ul><p><a href="/admin/audit/">Open the audit log</a></p>';
    }).catch(function () { $('ad-recent').innerHTML = '<p class="ad-empty">The log did not load.</p>'; });
  }

  $('ad-refresh').addEventListener('click', load);
  load(); counts(); recent();
  setInterval(function () { if (!document.hidden) load(); }, 120000);
})();
