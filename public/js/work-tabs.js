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
    if (wc && wc.S && wc.S.loaded) (wc.refresh ? wc.refresh('_tabs') : wc.render());
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
  // A grey card shaped like the rows it stands for, so a tab never opens on a blank box. Styles: src/styles/crit-work2.css.
  function skel(rows, id) {
    let h = '';
    for (let i = 0; i < (rows || 5); i++) h += '<div class="wc-skelrow"><i class="a"></i><i class="b"></i><i class="c"></i></div>';
    return '<section class="h-card wc-sheet wc-skelrows" aria-busy="true"' + (id ? ' id="' + id + '"' : '') + '><div class="wc-skelbar"><i></i><i></i><i></i></div>' + h + '</section>';
  }
  window.WCSkel = skel;

  // Tabs sit in groups, the way a person thinks about the work: the group row is always short, and the second row shows only the tabs of
  // the group you are in. A tab registers into a group with `group: 'mine'` (or one of the ids below); a tab that names none lands in More.
  const GROUPS = [['mine', 'My work'], ['gifts', 'Gifts'], ['grants', 'Grants'], ['letters', 'Reports'], ['review', 'Review'], ['more', 'More']];
  const GROUP_OF = { open: 'mine', gifts: 'mine', mine: 'mine', asks: 'mine', cadence: 'mine', intake: 'gifts', ty: 'gifts', giftimages: 'gifts', declines: 'gifts',
    grants: 'grants', opps: 'grants', week: 'letters', hqty: 'letters', stale: 'review', recent: 'review' };
  const ORDER = ['open', 'gifts', 'mine', 'asks', 'cadence', 'intake', 'ty', 'giftimages', 'declines', 'grants', 'opps', 'week', 'hqty', 'stale', 'recent'];
  const groupOf = (t) => (t.group && GROUPS.some((g) => g[0] === t.group) ? t.group : GROUP_OF[t.id] || 'more');
  // [{ id, label, tabs }] for the groups this person has at least one tab in, in order.
  function groups(me) {
    const src = list(me);
    const rank = (t) => { const i = ORDER.indexOf(t.id); return i < 0 ? 99 : i; };
    return GROUPS.map(([id, label]) => ({ id, label, tabs: src.filter((t) => groupOf(t) === id).map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]) })).filter((g) => g.tabs.length);
  }
  const memo = (() => { try { return JSON.parse(localStorage.getItem('wc.lastg') || '{}') || {}; } catch (_) { return {}; } })();
  function remember(id) {
    const t = get(id); if (!t) return;
    memo._last = id; memo[groupOf(t)] = id;
    try { localStorage.setItem('wc.lastg', JSON.stringify(memo)); } catch (_) { /* private mode */ }
  }
  // The tab a group opens on: the one you used last in it, else its first.
  function entry(groupId, me) {
    const g = groups(me).find((x) => x.id === groupId); if (!g) return null;
    const m = memo[groupId]; return g.tabs.some((t) => t.id === m) ? m : g.tabs[0].id;
  }
  const last = (me) => (memo._last && list(me).some((t) => t.id === memo._last) ? memo._last : '');
  const get = (id) => all().find((t) => t.id === id) || null;
  window.WCTabs = { registerTab, list, get, groups, groupOf: (id) => { const t = get(id); return t ? groupOf(t) : 'mine'; }, remember, entry, last, has: (id, me) => list(me).some((t) => t.id === id) };
})();
