/* Light taps on a phone (2026-10-14). Framework-free: hubHaptic('light' | 'select' | 'success' | 'warn' | 'heavy' | 'ring').
   Android phones vibrate (navigator.vibrate). iPhones have no vibrate call; Safari 18 and later give the system tick when a
   switch-style checkbox flips, so one hidden switch is flipped for each pulse (the method the ios-haptics package uses).
   Computers and anything with a mouse get nothing. Settings > Sounds holds the switch (favor.hub.haptic, on by default).
   What taps, and where it is wired: a switch flipped (here), a task marked done (here), a toast flicked away (hub-toast.js),
   a phone sheet pulled closed (hub-sheet.js), a drag picked up and dropped (projects/ui-dnd.js), a press-and-hold menu (hub-ctx.js),
   pull to refresh passing its mark (hub-pull.js), a ringing call (ring.js). */
(function () {
  if (window.hubHaptic) return;
  var KEY = 'favor.hub.haptic';
  var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  var ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var canVibrate = typeof navigator.vibrate === 'function' && !ios;
  var PAT = { select: [6], light: [10], success: [10, 70, 14], warn: [18, 50, 18], heavy: [22], ring: [250, 150, 250] };
  var IOS_PULSES = { select: 1, light: 1, success: 2, warn: 2, heavy: 1, ring: 3 };
  var sw = null;

  function on() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setOn(v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) { /* private window */ } }
  function supported() { return touch && (canVibrate || ios); }

  function iosTick() {
    if (!sw) {
      sw = document.createElement('label');
      sw.setAttribute('aria-hidden', 'true');
      sw.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      var i = document.createElement('input');
      i.type = 'checkbox'; i.setAttribute('switch', ''); i.tabIndex = -1;
      sw.appendChild(i);
      document.body.appendChild(sw);
    }
    try { sw.click(); } catch (e) { /* no tick */ }
  }

  function hubHaptic(kind) {
    if (!supported() || !on() || document.hidden) return false;
    var k = PAT[kind] ? kind : 'light';
    if (canVibrate) { try { return navigator.vibrate(PAT[k]); } catch (e) { return false; } }
    var n = IOS_PULSES[k] || 1;
    for (var j = 0; j < n; j++) setTimeout(iosTick, j * (k === 'ring' ? 400 : 80));
    return true;
  }
  hubHaptic.on = on;
  hubHaptic.setOn = setOn;
  hubHaptic.supported = supported;
  window.hubHaptic = hubHaptic;

  // Switches and done checks across every page, without each page wiring them.
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('input[type="checkbox"].wm-switch, input[type="checkbox"][switch], input[role="switch"]')) hubHaptic('select');
  }, true);
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[role="switch"], [role="checkbox"][data-act="done"], [data-done-sound]');
    if (!t) return;
    var done = t.matches('[data-act="done"], [data-done-sound]') && t.getAttribute('aria-checked') !== 'true';
    hubHaptic(done ? 'success' : 'select');
  }, true);
})();
