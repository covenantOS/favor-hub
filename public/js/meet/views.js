// Meetings view math: Eastern days, Sunday weeks, month grids, stepping. Pure functions, no page access, so the tests run them in Node.
(function (root) {
  var TZ = 'America/New_York';
  var fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function parts(ms) { var o = {}; fmtParts.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = +p.value; }); return o; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function key(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  /** The Eastern calendar day of an instant, as YYYY-MM-DD. */
  function etKey(ms) { var p = parts(ms); return key(p.year, p.month, p.day); }
  /** Eastern hour (0 to 23) and minute of an instant. */
  function etHM(ms) { var p = parts(ms); return { h: p.hour % 24, m: p.minute }; }
  function split(k) { var a = k.split('-'); return [+a[0], +a[1], +a[2]]; }
  function utc(k) { var a = split(k); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
  function fromUtc(d) { return key(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function addDays(k, n) { var d = utc(k); d.setUTCDate(d.getUTCDate() + n); return fromUtc(d); }
  /** The instant of 12:00 AM Eastern on a day. */
  function etStart(k) {
    var a = split(k);
    for (var off = 4; off <= 5; off++) { var t = Date.UTC(a[0], a[1] - 1, a[2], off); var p = parts(t); if (key(p.year, p.month, p.day) === k && p.hour % 24 === 0) return t; }
    return Date.UTC(a[0], a[1] - 1, a[2], 5);
  }
  function dow(k) { return utc(k).getUTCDay(); }
  /** The Sunday that starts the week holding the day. */
  function weekStart(k) { return addDays(k, -dow(k)); }
  function weekDays(k) { var s = weekStart(k), out = []; for (var i = 0; i < 7; i++) out.push(addDays(s, i)); return out; }
  /** Weeks (Sunday first) that cover the month holding the day; 4 to 6 rows of 7 days. */
  function monthGrid(k) {
    var a = split(k), first = key(a[0], a[1], 1), last = fromUtc(new Date(Date.UTC(a[0], a[1], 0)));
    var s = weekStart(first), rows = [];
    while (s <= last) { var row = []; for (var i = 0; i < 7; i++) { var d = addDays(s, i); row.push({ key: d, inMonth: d.slice(0, 7) === first.slice(0, 7) }); } rows.push(row); s = addDays(s, 7); }
    return rows;
  }
  function addMonths(k, n) {
    var a = split(k), t = a[0] * 12 + (a[1] - 1) + n, y = Math.floor(t / 12), m = t % 12 + 1;
    var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return key(y, m, Math.min(a[2], dim));
  }
  /** One arrow press: a day, a week or a month. */
  function step(view, k, dir) { return view === 'month' ? addMonths(k, dir) : addDays(k, view === 'week' ? 7 * dir : dir); }
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var short = function (s) { return s.slice(0, 3); };
  function dayName(k, full) { var n = DAY[dow(k)]; return full === false ? short(n) : n; }
  function monthName(k, full) { var n = MON[split(k)[1] - 1]; return full === false ? short(n) : n; }
  /** The header: "Monday, October 12", "Oct 11 to 17", "October 2026". */
  function title(view, k) {
    var a = split(k);
    if (view === 'month') return monthName(k) + ' ' + a[0];
    if (view === 'week') {
      var d = weekDays(k), s = split(d[0]), e = split(d[6]);
      return s[1] === e[1] ? short(MON[s[1] - 1]) + ' ' + s[2] + ' to ' + e[2] : short(MON[s[1] - 1]) + ' ' + s[2] + ' to ' + short(MON[e[1] - 1]) + ' ' + e[2];
    }
    return dayName(k) + ', ' + monthName(k) + ' ' + a[2];
  }
  /** Meetings by Eastern start day. */
  function bucket(evs) { var o = {}; evs.forEach(function (e) { var k = etKey(e.start); (o[k] = o[k] || []).push(e); }); return o; }
  /** At most `max` chips for a month cell and how many are left over. */
  function chips(list, max) { return list.length > max ? { shown: list.slice(0, max - 1), more: list.length - (max - 1) } : { shown: list, more: 0 }; }
  /** Every day key a view shows, first to last. */
  function range(view, k) {
    if (view === 'day') return [k];
    if (view === 'week') return weekDays(k);
    var g = monthGrid(k), out = []; g.forEach(function (r) { r.forEach(function (c) { out.push(c.key); }); }); return out;
  }
  var api = { TZ: TZ, etKey: etKey, etHM: etHM, etStart: etStart, addDays: addDays, addMonths: addMonths, weekStart: weekStart, weekDays: weekDays, monthGrid: monthGrid, step: step, title: title, bucket: bucket, chips: chips, range: range, dayName: dayName, monthName: monthName, dow: dow, dayNum: function (k) { return split(k)[2]; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MeetViews = api;
})(typeof window !== 'undefined' ? window : globalThis);
