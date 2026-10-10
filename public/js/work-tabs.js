/* The Work Center tab registry (Group 0, round 3). Every tab, the six built in and every one a later file adds, registers here and
   work.js draws the tab bar and the start-view panel from this list.

     window.WCTabs.registerTab({
       id: 'cadence',                 // lowercase letters, digits, - and _; also the ?view= value and the saved start tab
       label: 'Cadence',              // text on the tab
       roles: ['partner_care'],       // optional: admin | director | support | partner_care | grants. Admins always see every tab.
       show: (me) => true,            // optional extra test on the gate's `me` (canGifts, canEntry, fid ...)
       after: 'open',                 // optional: sit after this tab id; without it the tab goes last
       count: () => 12,               // optional: number in the badge ('' for none)
       dot: () => false,              // optional: true marks the tab as new
       mount: () => { ... },          // draws the tab into document.getElementById('view')
     });

   Register at any time: when the page has already loaded, the tab bar redraws. Tabs written for the older window.WCX list still work. */
(function () {
  'use strict';
  const T = [];
  const ID = /^[a-z][a-z0-9_-]{1,31}$/;
  function registerTab(t) {
    if (!t || !ID.test(String(t.id || ''))) throw new Error('registerTab needs an id of lowercase letters, digits, - or _');
    if (typeof t.mount !== 'function') throw new Error('registerTab needs a mount function for ' + t.id);
    const at = T.findIndex((x) => x.id === t.id);
    if (at >= 0) T[at] = t; else T.push(t);
    const wc = window.WC;
    if (wc && wc.S && wc.S.loaded) wc.render();
  }
  function all() {
    const legacy = (window.WCX || []).filter((x) => x && x.k && !T.some((t) => t.id === x.k))
      .map((x) => ({ id: x.k, label: x.label, after: x.after, show: x.show, count: x.count, dot: x.dot, mount: x.view }));
    return T.concat(legacy);
  }
  function visible(t, me) {
    me = me || {};
    if (t.roles && t.roles.length && me.role !== 'admin' && !t.roles.includes(me.role)) return false;
    return !t.show || !!t.show(me);
  }
  // The tabs this person sees, in order: the built-in tabs first, the others after the tab they name.
  function list(me) {
    const src = all().filter((t) => visible(t, me));
    const out = src.filter((t) => t.core);
    for (const t of src.filter((x) => !x.core)) {
      const at = out.findIndex((x) => x.id === t.after);
      out.splice(at < 0 ? out.length : at + 1, 0, t);
    }
    return out;
  }
  const get = (id) => all().find((t) => t.id === id) || null;
  window.WCTabs = { registerTab, list, get, has: (id, me) => list(me).some((t) => t.id === id) };
})();
