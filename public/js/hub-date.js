/* Typed dates (2026-10-14): "fri", "tomorrow", "next tue", "in 2 weeks", "oct 20", "10/20", "end of month", "the 20th".
   Framework-free; the classic pages and the React app call window.hubDate.parse(text, todayYmd) and get
   { ymd: 'YYYY-MM-DD', label: 'Fri, Oct 16' } or null. Dates without a year that already passed this year mean next year
   (a due date is ahead). A weekday name means the next one, today included. "next fri" means Friday of next week.
   The rules match chrono-node's casual parser for these forms, in 3 KB instead of 48 KB; the React app keeps this file. */
(function (root) {
  var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  var MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var SHORT_D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SHORT_M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

  function d0(ymd) { var p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function ymdOf(d) { return d.toISOString().slice(0, 10); }
  function add(d, n) { var x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
  function addMonths(d, n) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  }
  function valid(y, m, day) { var x = new Date(Date.UTC(y, m, day)); return x.getUTCMonth() === m && x.getUTCDate() === day ? x : null; }
  function dayIdx(w) {
    if (!w || w.length < 2) return -1;
    for (var i = 0; i < 7; i++) if (DAYS[i].indexOf(w) === 0 || (w === 'tues' && i === 2) || ((w === 'thur' || w === 'thurs') && i === 4)) return i;
    return -1;
  }
  function monIdx(w) {
    if (!w || w.length < 3) return -1;
    for (var i = 0; i < 12; i++) if (MONTHS[i].indexOf(w) === 0 || (w === 'sept' && i === 8)) return i;
    return -1;
  }
  function num(w) { return /^\d+$/.test(w) ? +w : WORDS[w] || 0; }
  function label(d) { return SHORT_D[d.getUTCDay()] + ', ' + SHORT_M[d.getUTCMonth()] + ' ' + d.getUTCDate(); }

  function parse(text, today) {
    var t = d0(today || ymdOf(new Date(Date.now() - new Date().getTimezoneOffset() * 60000)));
    var s = String(text || '').toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(on|by|due) /, '');
    if (!s) return null;
    var y = t.getUTCFullYear(), out = null, m;
    var ahead = function (mo, day, yr) {
      var x = valid(yr != null ? yr : y, mo, day);
      if (x && yr == null && x < t) x = valid(y + 1, mo, day);
      return x;
    };
    var fullYear = function (v) { return v == null ? null : v < 100 ? 2000 + v : v; };
    if (/^(today|tod|now|tonight)$/.test(s)) out = t;
    else if (/^(tomorrow|tmrw?|tmw|tom)$/.test(s)) out = add(t, 1);
    else if (s === 'yesterday') out = add(t, -1);
    else if (/^(day after tomorrow|overmorrow)$/.test(s)) out = add(t, 2);
    else if (/^(next week|nw)$/.test(s)) out = add(t, ((8 - t.getUTCDay()) % 7) || 7);
    else if (/^(end of (the )?week|eow|this weekend|weekend)$/.test(s)) out = add(t, s.indexOf('weekend') >= 0 ? (6 - t.getUTCDay() + 7) % 7 : (5 - t.getUTCDay() + 7) % 7);
    else if (/^(end of (the )?month|eom)$/.test(s)) out = new Date(Date.UTC(y, t.getUTCMonth() + 1, 0));
    else if (s === 'next month') out = new Date(Date.UTC(y, t.getUTCMonth() + 1, 1));
    else if (/^(end of (the )?year|eoy)$/.test(s)) out = new Date(Date.UTC(y, 11, 31));
    else if ((m = /^(?:in )?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten) ?(d|days?|w|wks?|weeks?|m|mos?|months?)(?: from now)?$/.exec(s)) || (m = /^\+(\d+)(d|w|m)?$/.exec(s))) {
      var n = num(m[1]), u = (m[2] || 'd').charAt(0);
      if (n || m[1] === '0') out = u === 'w' ? add(t, n * 7) : u === 'm' ? addMonths(t, n) : add(t, n);
    } else if ((m = /^(this |next )?([a-z]+)$/.exec(s)) && dayIdx(m[2]) >= 0) {
      var want = dayIdx(m[2]), diff = (want - t.getUTCDay() + 7) % 7;
      if (m[1] === 'next ') {
        // Friday of next week (weeks start Monday).
        var mon = add(t, ((8 - t.getUTCDay()) % 7) || 7);
        out = add(mon, (want + 6) % 7);
      } else out = add(t, diff);
    } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) out = valid(+m[1], +m[2] - 1, +m[3]);
    else if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(s))) out = ahead(+m[1] - 1, +m[2], fullYear(m[3] ? +m[3] : null));
    else if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s)) && monIdx(m[1]) >= 0) out = ahead(monIdx(m[1]), +m[2], m[3] ? +m[3] : null);
    else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?(?: of)? ([a-z]+)(?: (\d{4}))?$/.exec(s)) && monIdx(m[2]) >= 0) out = ahead(monIdx(m[2]), +m[1], m[3] ? +m[3] : null);
    else if ((m = /^(?:the )?(\d{1,2})(st|nd|rd|th)$/.exec(s))) {
      var dd = +m[1], cand = valid(y, t.getUTCMonth(), dd);
      if (!cand || cand < t) cand = valid(y, t.getUTCMonth() + 1, dd) || valid(y, t.getUTCMonth() + 2, dd);
      out = cand;
    }
    return out ? { ymd: ymdOf(out), label: label(out) } : null;
  }

  var api = { parse: parse, label: function (ymd) { return label(d0(ymd)); } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.hubDate = api;
})(typeof window !== 'undefined' ? window : globalThis);
