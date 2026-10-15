/* FavorUI: the small helpers every FavorOS page needs, in one place, so a date, a name or an empty state reads the same everywhere.
   Pages written before this file keep their own copies; new code and the shared layer (favor-entity.js, favor-share.js, the bell, Search) use these.
     FavorUI.esc(text)                    safe HTML text
     FavorUI.ini(name)                    two initials, titles skipped ("Dr. Ada Lovelace" is AL)
     FavorUI.person(email, dir?)          "Ada Lovelace" from the staff list, or made from the address
     FavorUI.money(n)                     $1,234 (cents only when the number has them)   FavorUI.short(n)  $1.2M
     FavorUI.day(iso)                     Oct 12, with the year only when it is not this year (the Eastern day)
     FavorUI.time(iso)                    9:44 AM (Eastern)
     FavorUI.when(iso)                    Today 9:44 AM, Yesterday 9:44 AM, Oct 11 9:44 AM
     FavorUI.empty(title, text?)          the one empty state: <div class="h-empty">
     FavorUI.api(method, path, body?)     JSON call with the same-site header; throws an Error with the server's staff-worded message
     FavorUI.toast(text)                  the small message at the bottom of the page
     FavorUI.term(key, label?)            a word with its plain meaning on hover, focus and tap (soft credit, DAF, LYBUNT, household...)
     FavorUI.tip(label, text)             the same for any label and meaning
     FavorUI.whole(n)                     $76,500 (whole dollars, for totals; single gifts use money)
   TERMS is a copy of shared/giving.ts TERMS; tests/giving.test.mjs fails when they differ. */
(function () {
  'use strict';
  if (window.FavorUI) return;
  var ET = 'America/New_York';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ymd = function (d) { return d.toLocaleDateString('en-CA', { timeZone: ET }); };
  var todayEt = function () { return ymd(new Date()); };

  function ini(name) {
    var w = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (x) { return x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x); });
    var p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
    return p.map(function (x) { return Array.from(x)[0].toUpperCase(); }).join('');
  }
  function person(email, dir) {
    var e = String(email || '').toLowerCase();
    if (dir && dir[e] && dir[e].name) return dir[e].name;
    if (e === 'brain') return 'Favor Brain';
    return e.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function money(a) {
    if (a == null || a === '') return '';
    var n = Number(a);
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: Math.round(n) === n ? 0 : 2, maximumFractionDigits: 2 });
  }
  function short(v) {
    var n = Number(v) || 0, a = Math.abs(n), s = n < 0 ? '-' : '', f = function (x) { return String(+x.toFixed(1)); };
    return a >= 999500 ? s + '$' + f(a / 1e6) + 'M' : a >= 1000 ? s + '$' + f(a / 1e3) + 'K' : s + '$' + Math.round(a);
  }
  function parts(iso) {
    var d = iso instanceof Date ? iso : /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(iso + 'T12:00:00Z') : new Date(iso);
    return isNaN(d) ? null : d;
  }
  function day(iso) {
    var d = parts(iso); if (!d) return '';
    var key = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? String(iso) : ymd(d);
    var p = key.split('-').map(Number);
    return MON[p[1] - 1] + ' ' + p[2] + (String(p[0]) !== todayEt().slice(0, 4) ? ', ' + p[0] : '');
  }
  function time(iso) {
    var d = parts(iso); if (!d) return '';
    return d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' });
  }
  function when(iso) {
    var d = parts(iso); if (!d) return '';
    var k = ymd(d), t = todayEt();
    var y = ymd(new Date(Date.parse(t + 'T12:00:00Z') - 864e5));
    return (k === t ? 'Today' : k === y ? 'Yesterday' : day(iso)) + ' ' + time(d);
  }
  function empty(title, text) {
    return '<div class="h-empty"><b>' + esc(title) + '</b>' + (text ? '<span>' + esc(text) + '</span>' : '') + '</div>';
  }
  function api(method, path, body) {
    var init = { method: method, credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) { var e = new Error(data.message || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
        return data;
      });
    });
  }
  var TERMS = {"lifetime": {"label": "Lifetime giving", "tip": "Every gift credited to this partner and their spouse: their own gifts plus gifts sent through a donor-advised fund, foundation or business that name them. A gift counts once, for the partner it names."}, "soft": {"label": "Soft credit", "tip": "Someone else’s record sent the money, usually a donor-advised fund, foundation or business, and named this partner as the giver. FavorOS counts the gift for the partner it names, not for the record that sent it."}, "daf": {"label": "DAF", "tip": "Donor-advised fund. A charity account such as National Christian Foundation or Fidelity Charitable that a partner gives through. The gift is on the fund’s record and soft-credited to the partner."}, "household": {"label": "Household", "tip": "A partner and the spouse linked to them in Blackbaud count as one household. A gift either of them gives counts once for both."}, "active": {"label": "Active", "tip": "Gave in the last 12 months."}, "lybunt": {"label": "LYBUNT", "tip": "Last year but not this year: the last gift was 12 to 24 months ago and nothing has come in the 12 months since."}, "lapsed": {"label": "Lapsed", "tip": "The last gift was more than 24 months ago."}, "major": {"label": "Major partner", "tip": "Has given one gift of $1,000 or more at some point. The same gift moves a partner from Partner Care to a Regional Development Director."}, "passedOn": {"label": "Passed on", "tip": "Gifts this record sent for other partners, such as a donor-advised fund granting for a family. They count for the partners named on them, so they are not this record’s own giving."}, "recurring": {"label": "Recurring", "tip": "A payment on a recurring gift schedule. The schedule itself is not a gift; each payment is."}, "other": {"label": "Other", "tip": "Blackbaud recorded the payment type as Other. Most are donor-advised fund grants, wires and online gifts Blackbaud has no closer name for."}};
  function whole(a) {
    var n = Math.round(Number(a) || 0);
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US');
  }
  function tip(label, text) {
    if (!text) return esc(label);
    return '<span class="h-term" tabindex="0" role="button" aria-label="' + esc(label + '. ' + text) + '" data-term="' + esc(text) + '">' + esc(label) + '</span>';
  }
  function term(key, label) {
    var t = TERMS[key];
    return t ? tip(label || t.label, t.tip) : esc(label || key);
  }
  // One floating box for every [data-term] on the page: hover or focus shows it, a tap shows it, Escape, a scroll or a tap elsewhere hides it.
  var tipBox = null, tipFor = null;
  function showTip(el) {
    if (!tipBox) { tipBox = document.createElement('div'); tipBox.className = 'h-tipbox'; tipBox.setAttribute('role', 'tooltip'); document.body.appendChild(tipBox); }
    tipFor = el;
    tipBox.textContent = el.getAttribute('data-term');
    tipBox.classList.add('is-on');
    var r = el.getBoundingClientRect(), w = Math.min(300, window.innerWidth - 16);
    tipBox.style.maxWidth = w + 'px';
    tipBox.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    var h = tipBox.offsetHeight, below = r.bottom + 6;
    tipBox.style.top = (below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below) + 'px';
  }
  function hideTip() { if (tipBox) tipBox.classList.remove('is-on'); tipFor = null; }
  function tipOf(t) { return t && t.closest ? t.closest('[data-term]') : null; }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mouseover', function (e) { var el = tipOf(e.target); if (el) { if (el !== tipFor) showTip(el); } else if (tipFor) hideTip(); });
    document.addEventListener('focusin', function (e) { var el = tipOf(e.target); if (el) showTip(el); });
    document.addEventListener('focusout', function (e) { if (tipOf(e.target)) hideTip(); });
    // Capture phase so a term inside a link or a row that opens something shows its meaning instead of opening.
    document.addEventListener('click', function (e) { var el = tipOf(e.target); if (el) { e.preventDefault(); e.stopPropagation(); showTip(el); } else hideTip(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
    window.addEventListener('scroll', hideTip, true);
  }
  var toastEl = null, toastT = 0;
  function toast(text, href, label) {
    if (window.hubToast) return window.hubToast(text, { link: href ? { href: href, label: label || 'Open' } : null });
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'fe-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.appendChild(toastEl); }
    toastEl.innerHTML = esc(text) + (href ? ' <a href="' + esc(href) + '">' + esc(label || 'Open') + '</a>' : '');
    toastEl.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, href ? 6000 : 3200);
  }
  window.FavorUI = { esc: esc, ini: ini, person: person, money: money, whole: whole, term: term, tip: tip, TERMS: TERMS, short: short, day: day, time: time, when: when, empty: empty, api: api, toast: toast, todayEt: todayEt };
})();
