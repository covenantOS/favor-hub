/* What's new (/changelog): search, area and kind filters, pictures (on tap in Lite mode), and the last-visit mark. */
(function () {
  var root = document.querySelector('.cl');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  var q = document.getElementById('cl-q'), area = document.getElementById('cl-area'), type = document.getElementById('cl-type');
  var count = document.getElementById('cl-count'), none = document.getElementById('cl-none');
  var rows = Array.prototype.slice.call(root.querySelectorAll('.cl-e'));
  var KEY = 'favor.changelog.seen';
  var seen = '';
  try { seen = localStorage.getItem(KEY) || ''; } catch (e) { seen = ''; }
  // Changes since the last visit get a small mark; this visit then counts as seen.
  if (seen) rows.forEach(function (r) { if (r.dataset.stamp > seen) r.classList.add('is-unseen'); });
  try { if (root.dataset.latest) localStorage.setItem(KEY, root.dataset.latest); } catch (e) { /* private mode */ }
  document.documentElement.classList.remove('has-cl-new');

  var url = new URL(location.href);
  if (url.searchParams.get('area')) area.value = url.searchParams.get('area');
  if (url.searchParams.get('q')) q.value = url.searchParams.get('q');

  function run() {
    var words = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean), a = area.value, t = type.value, n = 0;
    var filtering = !!(words.length || a || t);
    rows.forEach(function (r) {
      var txt = r.textContent.toLowerCase();
      var ok = (!a || r.dataset.area === a) && (!t || r.dataset.type === t) && words.every(function (w) { return txt.indexOf(w) >= 0; });
      r.hidden = !ok;
      if (ok) n++;
    });
    root.querySelectorAll('.cl-day').forEach(function (d) {
      d.hidden = filtering && !d.querySelector('.cl-e:not([hidden])');
      var b = d.querySelector('.cl-behind');
      if (b) b.hidden = filtering;
    });
    count.textContent = n.toLocaleString('en-US') + (n === 1 ? ' change' : ' changes');
    none.hidden = n > 0;
  }
  var tm;
  q.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(run, 120); });
  area.addEventListener('change', run);
  type.addEventListener('change', run);
  run();

  // Pictures load as they scroll near, or on a tap in Lite mode. A current screenshot of an older change says Today's view.
  var lite = !!(window.FavorLite && window.FavorLite.on);
  function show(b) {
    var fig = document.createElement('figure');
    fig.className = 'cl-fig';
    var img = document.createElement('img');
    var phone = matchMedia('(max-width: 720px)').matches && b.dataset.phone;
    img.src = phone || b.dataset.src;
    img.alt = '';
    img.decoding = 'async';
    // The pictures are 1200 by 750 (desktop) and 600 by 1200 (phone); the space is held before they arrive, so nothing below moves.
    if (phone) { img.width = 600; img.height = 1200; } else { img.width = 1200; img.height = 750; }
    fig.appendChild(img);
    if (b.dataset.now) { var c = document.createElement('figcaption'); c.textContent = "Today's view"; fig.appendChild(c); }
    b.replaceWith(fig);
  }
  root.addEventListener('click', function (e) { var b = e.target.closest('.cl-shot'); if (b) show(b); });
  if (!lite && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { io.unobserve(x.target); show(x.target); } }); }, { rootMargin: '300px' });
    // One picture per area per day loads by itself; the rest wait for a tap, so a busy day is not a wall of the same screen.
    root.querySelectorAll('.cl-day').forEach(function (d) {
      var seenArea = {};
      d.querySelectorAll('.cl-e').forEach(function (r) { var b = r.querySelector('.cl-shot'); if (!b || seenArea[r.dataset.area]) return; seenArea[r.dataset.area] = 1; io.observe(b); });
    });
  }
})();
