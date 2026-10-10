/* The weekly report draft: plain text a director copies into WhatsApp or an email. No recipient anywhere. Written from the payload of
   GET /api/work/week, so ticking Giving, Asks, Number of Referrals or Next redraws it without a round trip. Loaded in the browser by
   work-week.js and in node by tests/work-week.test.mjs. Exposes WCWeekReport = { text, whatsapp, subject, money, short }. */
(function (root) {
  'use strict';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fd = (ymd, yr) => { const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number); return MON[m - 1] + ' ' + d + (yr ? ', ' + y : ''); };
  const fdw = (ymd) => DAY[new Date(String(ymd).slice(0, 10) + 'T12:00:00Z').getUTCDay()] + ', ' + fd(ymd);
  const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const short = (v) => { v = Number(v) || 0; return v >= 1e6 ? '$' + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 && v < 1e5 ? 1 : 0) + 'K' : money(v); };
  const HEADS = ['Goals', 'What happened', 'Asks', 'Number of Referrals', 'Gifts on my partners', 'Giving to goal', 'Next', 'On the calendar', 'Partners I plan to reach this week', 'Open asks I am following'];
  const ROLE = 'Regional Development Director';
  const cut = (t, n) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t; };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function givingLine(g) {
    if (!g || !g.goal) return '';
    return money(g.ytd) + ' of ' + money(g.goal) + ' credited this year' + (g.behind > 0 ? ', ' + money(g.behind) + ' behind pace' : ', on pace');
  }

  // d is the week payload, name the director's name. kind is 'goals' or 'update'. opts: { give, asks, refs, next }.
  function text(d, name, kind, opts) {
    opts = opts || {};
    const w = d.week, c = d.counts, g = d.goals, L = [];
    if (kind === 'goals') {
      L.push('Goals for the week of ' + w.range, name + ', ' + ROLE, '');
      L.push('Goals', 'Connect with ' + g.conn + ' partners or prospects', 'Attend ' + g.mtg + ' meetings', 'Schedule ' + g.ev + ' Favor event', 'Hold ' + g.oo + ' one-on-one appointments');
      if (opts.give && givingLine(d.giving)) L.push('', 'Giving to goal', givingLine(d.giving));
      if (opts.next && d.calendar.length) { L.push('', 'On the calendar'); d.calendar.forEach((x) => L.push(fdw(x.date) + ' · ' + x.how + ' · ' + x.text)); }
      if (d.quiet.length) { L.push('', 'Partners I plan to reach this week'); d.quiet.forEach((p) => L.push(p.name + ', ' + (p.last ? 'last contact ' + fd(p.last, true) : 'no contact on record'))); }
      if (opts.asks && d.asks.length) { L.push('', 'Open asks I am following'); d.asks.slice(0, 3).forEach((a) => L.push(a.name + ', ' + money(a.amount) + ', asked ' + fd(a.date))); }
      return L.join('\n');
    }
    L.push('Weekly update, ' + w.range, name + ', ' + ROLE, '');
    L.push('Goals', 'Connections ' + c.conn + ' of ' + g.conn, 'Meetings attended or hosted ' + c.mtg + ' of ' + g.mtg, 'Event scheduled ' + c.ev + ' of ' + g.ev, 'One-on-ones ' + c.oo + ' of ' + g.oo);
    const shown = d.rows.slice(0, 12);
    L.push('', 'What happened');
    if (!shown.length) L.push('Nothing completed yet.');
    shown.forEach((r) => L.push(fd(r.date) + ' · ' + r.how + ' · ' + r.name + (r.said ? ': ' + cut(r.said, 160) : '')));
    const rest = d.rows.length + (d.moreRows || 0) - shown.length;
    if (rest > 0) L.push('Plus ' + plural(rest, 'more action', 'more actions'));
    if (opts.asks) { const a = d.rows.filter((r) => r.ask > 0); if (a.length) { L.push('', 'Asks'); a.forEach((r) => L.push(r.name + ', ' + money(r.ask) + ', ' + fd(r.date))); } }
    if (opts.refs) { const r2 = d.rows.filter((r) => r.refs > 0); if (r2.length) { L.push('', 'Number of Referrals'); r2.forEach((r) => L.push(r.name + ': ' + plural(r.refs, 'referral', 'referrals') + ', ' + fd(r.date))); } }
    if (opts.give) {
      L.push('', 'Gifts on my partners', plural(d.gifts.n, 'gift', 'gifts') + (d.gifts.n ? ', ' + money(d.gifts.total) : '') + ' this week.');
      if (givingLine(d.giving)) L.push('Credited to me: ' + givingLine(d.giving) + '.');
    }
    if (opts.next && d.next.length) { L.push('', 'Next'); d.next.forEach((x) => L.push(fdw(x.date) + ' · ' + x.how + ' · ' + x.text)); }
    return L.join('\n');
  }

  const whatsapp = (t) => t.split('\n').map((l) => (HEADS.indexOf(l) >= 0 ? '*' + l + '*' : l)).join('\n');
  const subject = (d, name, kind) => (kind === 'goals' ? 'Goals for the week of ' + d.week.range : 'Weekly update, ' + d.week.range) + ', ' + name;

  root.WCWeekReport = { text, whatsapp, subject, money, short, fd, fdw, givingLine };
})(typeof window !== 'undefined' ? window : globalThis);
