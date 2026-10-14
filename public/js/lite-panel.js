/* Data saver: the panel behind "Data saver" in the account menu. The switch (Auto, On, Off), why Auto chose what it chose, the data
   this browser used for FavorOS today and this month, and a monthly limit. lite.js keeps the setting and the count. */
(function () {
  if (window.FavorLitePanel) return;
  var L = window.FavorLite;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mb(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  var CSS = '.dsv-scrim{position:fixed;inset:0;background:rgba(20,18,12,.45);z-index:9000;display:flex;align-items:flex-end;justify-content:center}' +
    '@media (min-width:640px){.dsv-scrim{align-items:center}}' +
    '.dsv{background:#fffdf7;color:#1f1b14;width:min(100%,440px);max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 18px 22px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-size:15px;line-height:1.4}' +
    '@media (min-width:640px){.dsv{border-radius:16px}}' +
    '.dsv h2{font-size:19px;margin:0 0 4px}.dsv p{margin:0 0 10px;color:#4f4738}' +
    '.dsv-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0 6px}' +
    '.dsv-seg button{min-height:44px;border:1px solid #d9cfb8;background:#fff;border-radius:10px;font:inherit;font-weight:600;color:#1f1b14}' +
    '.dsv-seg button[aria-pressed=true]{background:#1f3a2e;color:#fff;border-color:#1f3a2e}' +
    '.dsv-why{font-size:13px;color:#5b5240;min-height:18px}' +
    '.dsv-nums{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0 8px}' +
    '.dsv-num{background:#f4efe0;border-radius:12px;padding:10px 12px}.dsv-num b{display:block;font-size:22px}.dsv-num span{font-size:13px;color:#5b5240}' +
    '.dsv-bar{height:8px;border-radius:4px;background:#e8dfc9;overflow:hidden;margin:6px 0 4px}.dsv-bar i{display:block;height:100%;background:#1f3a2e}.dsv-bar.is-over i{background:#b3402a}' +
    '.dsv-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}.dsv-row select{min-height:40px;font:inherit;border-radius:8px;border:1px solid #d9cfb8;padding:0 8px;background:#fff}' +
    '.dsv-small{font-size:13px;color:#5b5240}.dsv-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}' +
    '.dsv-acts button{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid #d9cfb8;background:#fff;font:inherit;font-weight:600}';

  var el = null;
  function why() {
    if (L.mode === 'on') return 'On for this phone. Pictures wait for a tap, meetings start as audio calls and the app checks for news less often.';
    if (L.mode === 'off') return 'Off for this phone. Everything loads as usual.';
    return L.on ? 'Auto turned it on because ' + L.why.join(' and ') + '.' : 'Auto is watching the connection. It is off right now because the connection looks good.';
  }
  function paint() {
    if (!el) return;
    var s = L.summary(), over = s.cap && s.month > s.cap;
    var pct = s.cap ? Math.min(100, Math.round(s.month / s.cap * 100)) : 0;
    var caps = [0, 250, 500, 1024, 2048, 5120];
    el.querySelector('.dsv').innerHTML =
      '<h2 id="dsv-t">Data saver</h2>' +
      '<p>For a weak or costly connection. Chat, field reports and meetings keep working and use much less data.</p>' +
      '<div class="dsv-seg" role="group" aria-label="Data saver">' + ['auto', 'on', 'off'].map(function (m) { return '<button type="button" data-dsv-mode="' + m + '" aria-pressed="' + (L.mode === m) + '">' + { auto: 'Auto', on: 'On', off: 'Off' }[m] + '</button>'; }).join('') + '</div>' +
      '<div class="dsv-why" aria-live="polite">' + esc(why()) + '</div>' +
      '<div class="dsv-nums"><div class="dsv-num"><b>' + mb(s.today) + '</b><span>Today</span></div><div class="dsv-num"><b>' + mb(s.month) + '</b><span>This month</span></div></div>' +
      (s.cap ? '<div class="dsv-bar' + (over ? ' is-over' : '') + '"><i style="width:' + pct + '%"></i></div><div class="dsv-small">' + (over ? 'Over the monthly limit of ' + mb(s.cap) + '.' : pct + '% of the ' + mb(s.cap) + ' monthly limit.') + '</div>' : '') +
      '<div class="dsv-row"><label for="dsv-cap">Monthly limit</label><select id="dsv-cap">' + caps.map(function (c) { return '<option value="' + c + '"' + (c === s.capMb ? ' selected' : '') + '>' + (c ? (c >= 1024 ? c / 1024 + ' GB' : c + ' MB') : 'No limit') + '</option>'; }).join('') + '</select></div>' +
      '<div class="dsv-small">Counted on this phone in this browser: pages ' + mb(s.kinds.page) + ', meetings ' + mb(s.kinds.meet) + ' this month. The phone company\'s own count can be a little higher.</div>' +
      '<div class="dsv-acts"><button type="button" data-dsv-close>Done</button></div>';
  }
  function close() { if (el) { el.remove(); el = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function open() {
    if (el) return;
    if (!document.getElementById('dsv-css')) { var st = document.createElement('style'); st.id = 'dsv-css'; st.textContent = CSS; document.head.appendChild(st); }
    el = document.createElement('div');
    el.className = 'dsv-scrim';
    el.innerHTML = '<div class="dsv" role="dialog" aria-modal="true" aria-labelledby="dsv-t"></div>';
    document.body.appendChild(el);
    paint();
    el.addEventListener('click', function (e) {
      if (e.target === el || e.target.closest('[data-dsv-close]')) { close(); return; }
      var b = e.target.closest('[data-dsv-mode]');
      if (b) {
        var changed = L.set(b.getAttribute('data-dsv-mode'));
        paint();
        // Timers, fonts and the meeting room read the switch when a page opens.
        if (changed) { var w = el.querySelector('.dsv-why'); if (w) w.textContent = why() + ' The change applies from the next page you open.'; }
      }
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'dsv-cap') { try { localStorage.setItem('favor.lite.cap', e.target.value); } catch (x) { /* private mode */ } paint(); } });
    document.addEventListener('keydown', onKey);
    var f = el.querySelector('[data-dsv-mode][aria-pressed=true]'); if (f) f.focus();
  }
  window.FavorLitePanel = { open: open, close: close };
})();
