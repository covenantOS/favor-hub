/* Admin > People links to Onboarding: a button beside "Add a person", and Start onboarding / Start offboarding in a person's panel.
   Kept in its own file so the People page itself stays as the People lane left it. */
(function () {
  'use strict';
  var add = document.getElementById('pp-add');
  if (add && !document.getElementById('pp-onb')) {
    var a = document.createElement('a');
    a.id = 'pp-onb';
    a.className = 'ad-btn';
    a.href = '/onboarding/';
    a.textContent = 'Onboarding';
    add.parentNode.insertBefore(a, add.nextSibling);
  }
  var panel = document.getElementById('pp-panel');
  if (!panel) return;
  function enc(s) { return encodeURIComponent(s || ''); }
  function inject() {
    if (panel.hidden || panel.querySelector('.pp-onb')) return;
    var email = panel.querySelector('input[name="email"]');
    var name = panel.querySelector('input[name="name"]');
    var e = email && email.value ? email.value.trim().toLowerCase() : '';
    if (!e) return;
    var n = name && name.value ? name.value.trim() : '';
    var box = document.createElement('div');
    box.className = 'pp-onb';
    box.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px';
    box.innerHTML = '<a class="ad-btn" href="/onboarding/?start=onboard&email=' + enc(e) + '&name=' + enc(n) + '">Start onboarding</a>' +
      '<a class="ad-btn" href="/onboarding/?start=offboard&email=' + enc(e) + '&name=' + enc(n) + '">Start offboarding</a>';
    var form = panel.querySelector('form') || panel;
    form.appendChild(box);
  }
  new MutationObserver(inject).observe(panel, { childList: true, attributes: true, attributeFilter: ['hidden'] });
})();
