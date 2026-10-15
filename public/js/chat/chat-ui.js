/* Favor Chat client. One module draws the whole screen (channel list, channel, thread, details, search, pickers) and talks to an
   injected `api` object, so the page, the tests and the design prototype all run the same code.
   api: boot, history, thread, send, edit, del, react, read, typing, search, createChannel, openDm, browse, join, leave, setTopic,
        addMembers, driveSearch, clips, startMeeting, upload, recordClip, onEvent, threads, activity, unread, pins, pin, addBookmark,
        removeBookmark, makeRequest. See chat.js for the real one. */
(function () {
  'use strict';
  var TZ = 'America/New_York';
  var EMOJI = ['👍', '❤️', '🙏', '🎉', '😂', '👀', '✅', '🔥', '🙌', '💯', '🤔', '😮'];
  var COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
  var ICON = {
    hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    clip: '<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7"/>',
    drive: '<path d="M8 3h8l6 10-4 7H6l-4-7z"/><path d="M8 3l6 10M16 3 10 13M2 13h12"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/>',
    headset: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
    rec: '<rect x="3" y="8" width="14" height="11" rx="2"/><path d="M7 5h12a2 2 0 0 1 2 2v9"/><path d="m8.5 11.5 4 2-4 2z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    back: '<path d="m15 5-7 7 7 7"/>',
    reply: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    spark: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    out: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    dl: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    wave: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    threads: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 9.5h8M8 13h5"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z"/><path d="M12 15v6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    mark: '<path d="M4 7a2 2 0 0 1 2-2h8"/><path d="M20 11v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l8 6 3-2.2"/><circle cx="19" cy="6" r="2.4" fill="currentColor" stroke="none"/>',
    task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
    full: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    side: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M14 5v14"/>',
    down: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    caret: '<path d="m6 9 6 6 6-6"/>',
    mark2: '<path d="M6 4h12v16l-6-4-6 4z"/>',
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
    italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
    strike: '<path d="M4 12h16"/><path d="M16 7.5C15.5 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.2.7 2 2 2.6M8 16.5c.5 1.5 2 2.5 4 2.5 2.5 0 4-1.3 4-3 0-.6-.2-1.2-.5-1.6"/>',
    code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4"/>',
    block: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 10-2 2 2 2M15 10l2 2-2 2"/>',
    ul: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.5" cy="7" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17" r="1" fill="currentColor"/>',
    ol: '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4 5.5 5.5 5v4M4 14.5c0-1 2.5-1 2.5.3 0 .9-2.5 1.7-2.5 3.2h2.7" stroke-width="1.4"/>',
    quote: '<path d="M5 5v14"/><path d="M10 8h9M10 12h9M10 16h6"/>',
    slash: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m10 16 4-8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>'
  };
  function ic(n, cls) { return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + (ICON[n] || '') + '</svg>'; }
  // Favor Brain's mark, the ring of light (styles in src/styles/round2.css, .fbr; same markup as src/data/icons.ts brainMark).
  function ring(state) { return '<span class="fbr" data-state="' + state + '" aria-hidden="true"><i class="fbr__halo"></i><i class="fbr__in"><i class="fbr__lit"></i><i class="fbr__rg"></i><i class="fbr__cm"></i></i></span>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  var fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  var fmtDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var fmtDayLong = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  var fmtShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  var dayKeys = {};
  function dayKey(iso) { return dayKeys[iso] || (dayKeys[iso] = fmtDayKey.format(new Date(iso))); }
  function dayLabel(iso) {
    var k = dayKey(iso), now = new Date();
    if (k === dayKey(now.toISOString())) return 'Today';
    if (k === dayKey(new Date(now.getTime() - 864e5).toISOString())) return 'Yesterday';
    return fmtDayLong.format(new Date(iso));
  }
  function timeOf(iso) { return fmtTime.format(new Date(iso)).replace(' AM', ' AM').replace(' PM', ' PM'); }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (dayKey(iso) === dayKey(new Date().toISOString())) return 'today at ' + timeOf(iso);
    return fmtShort.format(new Date(iso));
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  var initials = function (n) { var w = String(n || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(function (x) { return x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x); }); var p = w.length > 1 ? [w[0], w[w.length - 1]] : w; return p.map(function (x) { return Array.from(x)[0]; }).join('').toUpperCase() || '?'; };
  function plural(n, a, b) { return Number(n).toLocaleString('en-US') + ' ' + (n === 1 ? a : b || a + 's'); }

  /* What this browser remembers between visits: drafts, which list sections are folded, the thread panel's width. */
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } }
  var FMT = [['bold', 'Bold', 'Ctrl B'], ['italic', 'Italic', 'Ctrl I'], ['strike', 'Strikethrough', 'Ctrl Shift X'], ['link', 'Link', 'Ctrl Shift U'], ['ol', 'Numbered list', 'Ctrl Shift 7'], ['ul', 'Bulleted list', 'Ctrl Shift 8'], ['quote', 'Quote', 'Ctrl Shift 9'], ['code', 'Code', 'Ctrl Shift C'], ['block', 'Code block', 'Ctrl Alt Shift C']];
  function fmtRow(scope) {
    return '<div class="ch-fmt" role="toolbar" aria-label="Formatting">' + FMT.map(function (f, i) {
      // Each button names itself in a tooltip that shows on hover and keyboard focus (role tooltip, linked by aria-describedby).
      var tid = 'ch-tip-' + scope + '-' + f[0];
      return (i === 3 || i === 4 || i === 6 || i === 7 ? '<i class="ch-fmt__sep" aria-hidden="true"></i>' : '') + '<button type="button" class="ch-tipped" data-act="fmt" data-f="' + f[0] + '" data-scope="' + scope + '" aria-label="' + f[1] + '" aria-describedby="' + tid + '">' + ic(f[0] === 'link' ? 'link' : f[0]) + '<span class="ch-tip" role="tooltip" id="' + tid + '">' + f[1] + ' <kbd>' + f[2] + '</kbd></span></button>';
    }).join('') + '</div>';
  }
  function composerHtml(scope, placeholder) {
    return '<form class="ch-comp" data-scope="' + scope + '" autocomplete="off">' + (scope === 'rt' ? '' : '<button type="button" class="ch-latest" data-act="latest" data-scope="' + scope + '" hidden>' + ic('down') + '<span>Latest</span></button>') +
      '<div class="ch-comp__box">' + (scope === 'rt' ? '' : fmtRow(scope)) + '<div class="ch-pend" data-pend="' + scope + '" hidden></div>' +
      '<textarea rows="1" data-ta="' + scope + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" enterkeyhint="send"></textarea>' +
      '<div class="ch-comp__bar"><button type="button" class="ch-iconbtn" data-act="plus" data-scope="' + scope + '" aria-label="Add to the message" title="Add a file, Drive file, clip or meeting">' + ic('plus') + '</button>' +
      '<button type="button" class="ch-iconbtn" data-act="at" data-scope="' + scope + '" aria-label="Mention someone" title="Mention someone">' + ic('at') + '</button>' +
      '<button type="button" class="ch-iconbtn" data-act="emoji" data-scope="' + scope + '" aria-label="Emoji" title="Emoji">' + ic('smile') + '</button>' +
      '<button type="button" class="ch-iconbtn" data-act="ask-brain" data-scope="' + scope + '" aria-label="Ask Favor Brain" title="Ask Favor Brain">' + ic('spark') + '</button>' +
      (scope === 'rt' ? '' : '<button type="button" class="ch-iconbtn" data-act="sm-mic" data-scope="' + scope + '" aria-label="Record a voice note" title="Record a voice note">' + ic('mic') + '</button>') +
      '<span class="ch-comp__sp"></span><button type="submit" class="ch-send" data-send="' + scope + '" disabled aria-label="Send">' + ic('send') + '<span>Send</span></button></div></div>' +
      (scope === 'thread' ? '<label class="ch-also"><input type="checkbox" data-also /><span data-also-label>Also send to the channel</span></label>' : '') + '</form>';
  }
  // The three rows above the channels: every thread the person is in, where they were named or reacted to, and what they left unsent.
  function navRows(o) {
    o = o || {};
    var row = function (page, icon, label, n, live) {
      return '<button type="button" class="ch-row ch-nav' + (o.page === page ? ' is-on' : '') + (n && live ? ' is-unread' : '') + '" data-act="page" data-page="' + page + '"' + (o.boot ? ' tabindex="-1"' : '') + (o.page === page ? ' aria-current="true"' : '') + '><span class="ch-row__ic">' + ic(icon) + '</span><span class="ch-row__n">' + label + '</span>' + (n ? '<span class="ch-badge' + (live ? '' : ' ch-badge--quiet') + '">' + n + '</span>' : '') + '</button>';
    };
    return '<div class="ch-navs">' + row('threads', 'threads', 'Threads', o.threads || 0, true) + row('activity', 'at', 'Mentions and reactions', 0, false) + row('drafts', 'pen', 'Drafts', o.drafts || 0, false) + '</div>';
  }
  var BONE = function (w, h) { return '<i class="ch-bone" style="width:' + w + ';height:' + h + '"></i>'; };
  function skelRows(ws) { return ws.map(function (w, i) { return '<div class="ch-row ch-row--skel" aria-hidden="true"><span class="ch-row__ic">' + BONE('14px', '14px') + '</span><span class="ch-row__n">' + BONE(w, '12px') + '</span></div>'; }).join(''); }
  // The screen as it looks before the channels arrive. src/pages/chat/index.astro carries this same markup so the first paint is already
  // the right screen (tests/chat-boot.test.mjs keeps the two in step).
  function bootSide() {
    return '<div class="ch-pnav"><button type="button" class="ch-pn" tabindex="-1" aria-label="FavorOS menu"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 8h10"/><path d="M5 16h14"/></svg></button>' +
      '<div class="ch-seg"><button type="button" tabindex="-1" aria-pressed="true">Channels</button><button type="button" tabindex="-1" aria-pressed="false">Messages</button></div>' +
      '<button type="button" class="ch-pn" tabindex="-1" aria-label="New message">' + ic('pen') + '</button></div>' +
      '<div class="ch-side__head"><button type="button" class="ch-jump" tabindex="-1">' + ic('search') + '<span>Jump to or search</span><kbd>Ctrl K</kbd></button><button type="button" class="ch-iconbtn" data-act="new-dm" tabindex="-1" aria-label="New message">' + ic('pen') + '</button></div>' +
      '<div class="ch-list" data-seg="channels">' + navRows({ boot: true }) + '<div class="ch-sec" data-sec="channels"><div class="ch-sec__h"><button type="button" class="ch-sec__t" tabindex="-1">' + ic('caret') + '<b>Channels</b></button><button type="button" class="ch-iconbtn" tabindex="-1" aria-label="New channel">' + ic('plus') + '</button></div>' + skelRows(['46%', '62%', '38%', '54%']) + '</div>' +
      '<div class="ch-sec" data-sec="messages"><div class="ch-sec__h"><button type="button" class="ch-sec__t" tabindex="-1">' + ic('caret') + '<b>Direct messages</b></button><button type="button" class="ch-iconbtn" tabindex="-1" aria-label="New message">' + ic('plus') + '</button></div>' + skelRows(['50%', '40%']) + '</div></div>';
  }
  function bootHtml() {
    return '<aside class="ch-side" aria-label="Channels">' + bootSide() + '</aside>' +
      '<section class="ch-main" aria-label="Channel"><header class="ch-head"><div class="ch-head__t">' + BONE('150px', '16px') + '</div></header><div class="ch-msgs" tabindex="0" aria-live="polite"><div class="ch-msgs__in"><div class="ch-skel"><i style="width:30%"></i><i style="width:80%"></i><i style="width:55%"></i><i style="width:70%"></i></div></div></div><div class="ch-typing" aria-live="polite"></div>' + composerHtml('main', 'Message') + '</section>' +
      '<aside class="ch-right" hidden></aside>';
  }

  /* Redraws a list of top-level blocks without touching the ones that did not change, so images, the scroll position and
     anything being typed stay put and nothing flickers when a reaction, a presence dot or a new message arrives. */
  // Keyed blocks ({k, h}): a block whose source did not change is reused as is, without parsing it again; a changed one is patched.
  function morphItems(box, items) {
    var old = {}, kids = Array.prototype.slice.call(box.children), used = new Set(), cur = box.firstElementChild;
    kids.forEach(function (e) { if (e._k != null) old[e._k] = e; });
    var parse = function (h) { var t = document.createElement('template'); t.innerHTML = h; return t.content.firstElementChild; };
    items.forEach(function (it) {
      var o = old[it.k], n;
      if (o && !used.has(o)) {
        var wasCur = o === cur;
        if (o._src !== it.h) { n = parse(it.h); if (n) { if (n.nodeName !== o.nodeName || n.className !== o.className && /ch-(day|new|intro)/.test(n.className + o.className)) { n._k = it.k; o.parentNode.replaceChild(n, o); o = n; } else patchNode(o, n); } o._src = it.h; }
        used.add(o); if (wasCur) cur = o.nextElementSibling; else box.insertBefore(o, cur);
      } else {
        n = parse(it.h); if (!n) return;
        n._k = it.k; n._src = it.h; used.add(n); box.insertBefore(n, cur);
      }
    });
    kids.forEach(function (e) { if (!used.has(e) && e.parentNode === box) box.removeChild(e); });
  }
  function morph(box, html) {
    if (Array.isArray(html)) return morphItems(box, html);
    var parts = null;
    var t = document.createElement('template'); t.innerHTML = html;
    var news = Array.prototype.slice.call(t.content.children);
    var keyOf = function (e) { return e.getAttribute('data-mid') ? 'm' + e.getAttribute('data-mid') : e.id ? '#' + e.id : e.className === 'ch-day' ? 'd' + e.textContent : e.tagName + '.' + e.className; };
    var old = {}, kids = Array.prototype.slice.call(box.children);
    kids.forEach(function (e) { if (e._src != null) old[keyOf(e)] = e; });
    var used = [], cur = box.firstElementChild;
    news.forEach(function (n, i) {
      var src = parts ? parts[i] : n.outerHTML, o = old[keyOf(n)];
      if (o && used.indexOf(o) < 0) {
        // The same message with a change (a reaction, an edit, a reply count) is patched in place, so a playing video,
        // a drawn preview and the picture underneath stay as they are.
        if (o._src !== src) { patchNode(o, n); o._src = src; }
        used.push(o); if (o === cur) cur = cur.nextElementSibling; else box.insertBefore(o, cur);
      }
      else { n._src = src; box.insertBefore(n, cur); }
    });
    kids.forEach(function (e) { if (used.indexOf(e) < 0 && e.parentNode === box) box.removeChild(e); });
  }
  // A small in-place DOM patch: same tag keeps the element and updates what differs. Players keep playing, a focused box keeps its text.
  function patchNode(o, n) {
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) { o.parentNode.replaceChild(n, o); return; }
    if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
    if (o.hasAttribute('data-vsrc') && o.classList.contains('is-playing') && o.getAttribute('data-vsrc') === n.getAttribute('data-vsrc')) return;
    if (/^(VIDEO|AUDIO|IFRAME)$/.test(o.nodeName)) { if (o.getAttribute('src') !== n.getAttribute('src')) o.parentNode.replaceChild(n, o); return; }
    if (o.classList.contains('is-drawn') && o.getAttribute('data-thumb') === n.getAttribute('data-thumb')) return;
    // A Favor Brain answer keeps what the person did to it (a sorted table, a drawn chart) while the message around it changes.
    if (o.hasAttribute('data-brain') && o.getAttribute('data-brain') === n.getAttribute('data-brain') && o.getAttribute('data-rev') === n.getAttribute('data-rev')) return;
    if (o.nodeName === 'TEXTAREA' || (o.nodeName === 'INPUT' && o === document.activeElement)) return;
    var oa = o.attributes;
    for (var i = oa.length - 1; i >= 0; i--) if (!n.hasAttribute(oa[i].name)) o.removeAttribute(oa[i].name);
    var na = n.attributes;
    for (var j = 0; j < na.length; j++) if (o.getAttribute(na[j].name) !== na[j].value) o.setAttribute(na[j].name, na[j].value);
    patchKids(o, n);
  }
  function patchKids(o, n) {
    var oc = Array.prototype.slice.call(o.childNodes), nc = Array.prototype.slice.call(n.childNodes);
    for (var i = 0; i < nc.length; i++) {
      if (i < oc.length) patchNode(oc[i], nc[i]);
      else o.appendChild(nc[i]);
    }
    for (var k = oc.length - 1; k >= nc.length; k--) if (oc[k].parentNode === o) o.removeChild(oc[k]);
  }
  function setHtml(el, html) { if (el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
  // Like setHtml, but keeps the elements that did not change, so rows, avatars and the header never blink.
  function patchHtml(el, html) {
    if (el._h === html) return false;
    var t = document.createElement('template'); t.innerHTML = html;
    if (el._h == null && !el.firstChild) el.appendChild(t.content); else patchKids(el, t.content);
    el._h = html; return true;
  }

  function mount(root, api, opts) {
    opts = opts || {};
    var S = {
      me: null, users: {}, channels: {}, active: null, right: 'none', threadRoot: null, tab: 'about',
      msgs: {}, threads: {}, typing: {}, search: null, view: 'list', lastRead: {}, memberPick: null, editing: null, pending: { main: [], thread: [] },
      mentionMap: { main: {}, thread: {} }, hasMore: {}, loaded: {}, warm: {}, connected: true,
      // page: what the middle column shows (a channel, or the Threads, Mentions and reactions or Drafts list).
      page: 'channel', threadFull: false, threadsUnread: 0, threadList: null, activity: null, features: { pins: false }, keepUnread: null,
      threadNew: {}, threadTyping: {}, newBelow: { main: 0, thread: 0 }, pins: {},
      drafts: lsGet('favor.chat.drafts.v1', {}), folded: lsGet('favor.chat.folded.v1', {}),
      lang: '', langs: [], tr: {}, trOrig: {}
    };
    var pop = null, popAnchor = null, modal = null, typingSent = 0, toastT = 0, pinned = true;
    var isPhone = function () { return matchMedia('(max-width: 860px)').matches; };

    /* ------------------------------------------------------------------ helpers */
    function user(id) {
      if (id === 'brain') return { id: 'brain', name: 'Favor Brain', brain: true };
      if (id === 'meetings') return { id: 'meetings', name: 'Favor Meetings', sys: 'video' };
      if (id === 'gifts') return { id: 'gifts', name: 'Favor Gifts', sys: 'spark' };
      return S.users[id] || { id: id, name: String(id || '').split('@')[0] || 'Someone', color: COLORS[hash(String(id)) % 7] };
    }
    function avatar(u, size, dot) {
      if (u.sys) return '<span class="ch-av" data-c="teal' + '"' + (size ? ' data-s="' + size + '"' : '') + '>' + ic(u.sys) + '</span>';
      if (u.brain) return '<span class="ch-av ch-av--brain' + (size ? ' ch-av--' + size : '') + '">' + ring('still') + '</span>';
      var c = u.color || COLORS[hash(u.id || u.name || '') % 7];
      var inner = u.picture && !broken[u.picture] ? '<img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer" data-ini="' + esc(initials(u.name)) + '" />' : esc(initials(u.name));
      return '<span class="ch-av' + (size ? ' ch-av--' + size : '') + '"' + (String(u.id || '').indexOf('@') > 0 ? ' data-entity="person:' + esc(u.id) + '" data-label="' + esc(u.name) + '"' : '') + ' data-c="' + c + '">' + inner + (dot ? '<i class="ch-dot" data-p="' + esc(u.presence || 'off') + '"></i>' : '') + '</span>';
    }
    function chan(id) { return S.channels[id]; }
    function chName(c) {
      if (!c) return '';
      if (c.kind === 'dm') { var o = (c.members || []).filter(function (m) { return m !== S.me.id; })[0] || S.me.id; return user(o).name; }
      if (c.kind === 'group') return (c.members || []).filter(function (m) { return m !== S.me.id; }).map(function (m) { return user(m).name.split(' ')[0]; }).join(', ');
      return c.name;
    }
    function sortedChannels() {
      var all = Object.keys(S.channels).map(function (k) { return S.channels[k]; }).filter(function (c) { return c.joined !== false; });
      return {
        chans: all.filter(function (c) { return c.kind === 'public' || c.kind === 'private'; }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
        dms: all.filter(function (c) { return c.kind === 'dm' || c.kind === 'group'; }).sort(function (a, b) { return String(b.last_at || '').localeCompare(String(a.last_at || '')); })
      };
    }
    // The notice sits on the page itself, so it shows over the large viewer too. link: { href, label }.
    function toast(t, link) {
      if (window.hubToast) { window.hubToast(t, { link: link && link.href ? { href: link.href, label: link.label, external: true } : null }); return; }
      var el = $('.ch-toast');
      if (!el) { el = document.createElement('div'); el.className = 'ch-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
      el.innerHTML = esc(t) + (link && link.href ? ' <a href="' + esc(link.href) + '" target="_blank" rel="noopener">' + esc(link.label || 'Open') + '</a>' : '');
      el.hidden = false; clearTimeout(toastT);
      toastT = setTimeout(function () { el.hidden = true; }, link ? 6000 : 2600);
    }
    function guard(p) { return Promise.resolve(p).catch(function (e) { toast((e && e.message) || 'That did not work. Try again.'); throw e; }); }

    /* ------------------------------------------------------------------ message text */
    // Lines that start a quote ("> "), a bulleted list ("- ") or a numbered list ("1. ") become those blocks; the rest stays text.
    function lineBlocks(t) {
      var lines = t.split('\n'), out = [], para = [], i = 0, m;
      var flush = function () { if (para.length) { out.push(para.join('\n')); para = []; } };
      while (i < lines.length) {
        var L = lines[i];
        if (/^&gt; ?/.test(L)) { flush(); var q = []; while (i < lines.length && /^&gt; ?/.test(lines[i])) q.push(lines[i++].replace(/^&gt; ?/, '')); out.push('<blockquote>' + q.join('\n') + '</blockquote>'); }
        else if (/^[-\u2022] \S/.test(L)) { flush(); var u = []; while (i < lines.length && /^[-\u2022] \S/.test(lines[i])) u.push('<li>' + lines[i++].slice(2) + '</li>'); out.push('<ul>' + u.join('') + '</ul>'); }
        else if ((m = L.match(/^(\d{1,3})[.)] \S/))) { flush(); var o = [], start = m[1]; while (i < lines.length && /^\d{1,3}[.)] \S/.test(lines[i])) o.push('<li>' + lines[i++].replace(/^\d{1,3}[.)] /, '') + '</li>'); out.push('<ol start="' + start + '">' + o.join('') + '</ol>'); }
        else { para.push(L); i++; }
      }
      flush();
      return out.join('');
    }
    function fmtBody(body, mentions) {
      var t = esc(body || '');
      var blocks = [];
      t = t.replace(/```([\s\S]*?)```/g, function (_, c) { blocks.push(c.replace(/^\n/, '').replace(/\n$/, '')); return '\u0000B' + (blocks.length - 1) + '\u0000'; });
      var codes = [];
      t = t.replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000'; });
      t = t.replace(/&lt;@([^&\s]+?)&gt;/g, function (_, id) {
        if (id === 'brain') return '<span class="ch-at ch-at--brain">@Favor Brain</span>';
        if (id === 'all' || id === 'channel') return '<span class="ch-at ch-at--me">@channel</span>';
    if (id === 'here') return '<span class="ch-at ch-at--me">@here</span>';
        return '<span class="ch-at' + (id === S.me.id ? ' ch-at--me' : '') + '" data-entity="person:' + esc(id) + '" data-label="' + esc(user(id).name) + '" tabindex="0">@' + esc(user(id).name) + '</span>';
      });
      t = t.replace(/&lt;~([pf]):(\d{1,12})\|(.{1,160}?)&gt;/g, function (_, k, id, name) {
        // The shared entity layer (favor-entity.js) draws the chip and opens its card; the plain span is only for a page without it.
        var un = function (x) { return x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); };
        return window.FavorEntity ? window.FavorEntity.chip(k === 'f' ? 'fund' : 'partner', id, un(name)) : '<span class="ch-ent ch-ent--' + k + '">' + name + '</span>';
      });
      t = t.replace(/&lt;#([^&\s]+?)&gt;/g, function (_, id) { var c = chan(id); return '<span class="ch-chan"># ' + esc(c ? c.name : 'channel') + '</span>'; });
      // [words](address) is a link that reads as the words; a bare address is a link that reads as itself.
      var links = [];
      t = t.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) { links.push('<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'); return '\u0000L' + (links.length - 1) + '\u0000'; });
      // A link keeps a closing bracket that pairs with one inside it (a Wikipedia address), and drops the sentence's own punctuation.
      t = t.replace(/https?:\/\/[^\s<\u0000]+/g, function (u) {
        var tail = '';
        while (u.length > 8) {
          var ch = u[u.length - 1];
          if (/[.,;:!?]/.test(ch) || (ch === ')' && u.split(')').length > u.split('(').length)) { tail = ch + tail; u = u.slice(0, -1); } else break;
        }
        return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>' + tail;
      });
      t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, '$1<em>$2</em>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
      t = lineBlocks(t);
      t = t.replace(/\u0000L(\d+)\u0000/g, function (_, i) { return links[+i]; });
      t = t.replace(/\u0000C(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
      t = t.replace(/\u0000B(\d+)\u0000/g, function (_, i) { return '<pre>' + blocks[+i] + '</pre>'; });
      return t;
    }
    function mentionsMe(m) {
      var b = m.body || '';
      return b.indexOf('<@' + S.me.id + '>') >= 0 || b.indexOf('<@channel>') >= 0 || b.indexOf('<@all>') >= 0;
    }

    /* ------------------------------------------------------------------ cards */
    // Every card plays or previews where it was posted. A clip or a video plays in the message; a picture, a PDF, a Word or Excel
    // file and a Drive file open in the viewer on top of the chat (chat-view.js). Opening the file's own page is a small link.
    // Lite mode (public/js/lite.js): pictures wait for a tap, posters and link pictures are left out, photos shrink before upload.
    function liteOn() { return !!(window.FavorLite && window.FavorLite.on); }
    function vidHtml(src, poster, label, dur, ratio) {
      if (liteOn()) poster = '';
      var box = ratio ? ' style="aspect-ratio:' + ratio + '"' : '';
      return '<span class="ch-vid"' + box + ' data-vsrc="' + esc(src) + '">' + (poster && !broken[poster] ? '<img class="ch-vid__poster" src="' + esc(poster) + '" alt="" loading="lazy" decoding="async" />' : '<span class="ch-clip__scr"><i></i><i></i><i></i><i></i></span>') +
        '<button type="button" class="ch-vid__play" data-act="play" aria-label="Play ' + esc(label) + '">' + ic('play') + '</button>' + (dur ? '<span class="ch-vid__dur">' + esc(dur) + '</span>' : '') + '</span>';
    }
    function fileKind(a) {
      var t = (a.mime || '') + ' ' + (a.name || '');
      if (/^image\//.test(a.mime || '')) return 'image';
      if (/^video\//.test(a.mime || '')) return 'video';
      if (/^audio\//.test(a.mime || '')) return 'audio';
      if (/pdf/i.test(t)) return 'pdf';
      if (/wordprocessingml|\.docx$/i.test(t)) return 'docx';
      if (/spreadsheetml|\.xlsx$|text\/csv|\.csv$/i.test(t)) return 'xlsx';
      if (/msword|\.doc$/i.test(t)) return 'doc';
      if (/excel|\.xls$/i.test(t)) return 'sheet';
      return 'file';
    }
    var LAB = { pdf: 'PDF', docx: 'DOC', doc: 'DOC', xlsx: 'XLS', sheet: 'XLS', slides: 'PPT', photo: 'IMG', file: 'FILE', audio: 'AUDIO' };
    function thumbBox(key, src, k, lab) {
      var V = window.FavorChatView, have = V && V.thumb(key);
      return '<span class="ch-prev__pic' + (have ? ' is-drawn' : '') + '" data-thumb="' + esc(key) + '"' + (have || !src ? '' : ' data-src="' + esc(src) + '" data-k="' + esc(k) + '"') + '>' + (have || '<span class="ch-file__ic" data-k="' + esc(k) + '">' + lab + '</span>') + '</span>';
    }
    function cardHtml(a, m, i) {
      var at = m ? ' data-cm="' + m.id + '" data-ai="' + i + '"' : '';
      if (a.type === 'clip') {
        return '<div class="ch-card ch-clip"' + at + '>' + vidHtml('/api/clips/' + esc(a.id) + '/media', a.thumb, a.title, a.duration, '16 / 9') +
          '<span class="ch-clip__info"><span class="ch-kicker">' + ic('rec') + 'Clip</span><span class="ch-card__t">' + esc(a.title) + '</span><span class="ch-card__m">' + esc(a.by || '') + (a.when ? ' · ' + esc(a.when) : '') + '</span>' + (a.summary ? '<span class="ch-card__s">' + esc(a.summary) + '</span>' : '') + (a.level === 'private' ? '<span class="ch-card__s">Private. Only the person who shared it can open it.</span>' : '') +
          '<a class="ch-clip__open" href="' + esc(a.url) + '" target="_blank" rel="noopener">Open in Clips' + ic('ext') + '</a></span></div>';
      }
      if (a.type === 'drive') {
        var k = a.kind || 'file', lab = LAB[k] || 'FILE';
        var pic = m && !broken['/api/chat/drive-file/' + m.id + '/' + i + '/thumb'] ? '<span class="ch-prev__pic" data-thumb="d' + m.id + '-' + i + '"><img src="/api/chat/drive-file/' + m.id + '/' + i + '/thumb" alt="" loading="lazy" decoding="async" data-fallback="' + lab + '" data-k="' + esc(k) + '" /></span>' : '<span class="ch-prev__pic"><span class="ch-file__ic" data-k="' + esc(k) + '">' + lab + '</span></span>';
        return '<div class="ch-card ch-prev ch-prev--drive"' + at + '><button type="button" class="ch-prev__open" data-act="view"' + at + ' aria-label="Preview ' + esc(a.name) + '">' + pic +
          '<span class="ch-prev__t"><span class="ch-kicker" style="color:var(--tc-sky-ink)">' + ic('drive') + 'Drive</span><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(a.path || '') + (a.indexed ? ' · Indexed ' + esc(a.indexed) : '') + '</span></span></button>' +
          '<a class="ch-prev__ext" href="' + esc(a.url) + '" target="_blank" rel="noopener" aria-label="Open in Google Drive" title="Open in Google Drive">' + ic('ext') + '</a></div>';
      }
      if (a.type === 'meeting') {
        // A huddle card reads who is in the room from the channel's live huddle state when the page has it, so it changes the
        // moment people join or leave instead of keeping the count from when the message loaded.
        if (a.status === 'scheduled') {
          // Booked for later with Find a time: the day and time, and Join from ten minutes before it starts.
          var soon = a.starts_at && Date.parse(a.starts_at) - Date.now() < 10 * 60000;
          var whenTxt = a.starts_at ? new Date(a.starts_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
          return '<a class="ch-card ch-meet ch-meet--later" href="' + esc(soon && a.room_url ? a.room_url : a.url) + '" target="_blank" rel="noopener"><span class="ch-meet__ic">' + ic('video') + '</span><span class="ch-meet__t"><span class="ch-kicker">' + ic('video') + 'Meeting</span><span class="ch-card__t">' + esc(a.title) + '</span><span class="ch-card__m">' + esc(whenTxt) + '</span></span><span class="ch-btn">' + (soon && a.room_url ? 'Join' : 'Open') + '</span></a>';
        }
        var hs = huddleFor(a.id);
        if (hs !== undefined) a = Object.assign({}, a, hs ? { status: 'live', count: hs.people.length } : a.status === 'ended' ? {} : { status: 'ended', count: 0 });
        var live = a.status !== 'ended';
        var inner = '<span class="ch-meet__ic">' + ic('video') + '</span><span class="ch-meet__t"><span class="ch-kicker">' + ic('video') + 'Meeting</span><span class="ch-card__t">' + esc(a.title) + '</span>' +
          (live ? '<span class="ch-meet__live"><i></i>Live now' + (a.count ? ' · ' + plural(a.count, 'person', 'people') + ' in the room' : '') + '</span>' : '<span class="ch-card__m">Ended' + (a.duration ? ' · ' + esc(a.duration) : '') + (a.notes ? ' · Notes ready' : '') + '</span>') + '</span>';
        var btn = live ? '<span class="ch-btn">Join</span>' : (a.notes ? '<span class="ch-btn">Open notes</span>' : '');
        return '<a class="ch-card ch-meet' + (live ? '' : ' ch-meet--ended') + '" href="' + esc(live ? a.url : (a.notes_url || a.url)) + '"' + (live ? ' data-act="huddle" data-mid="' + esc(a.id) + '"' : ' target="_blank" rel="noopener"') + '>' + inner + btn + '</a>';
      }
      if (a.type === 'file') {
        var fk = fileKind(a);
        if (fk === 'image') {
          // The picture's own shape is reserved before it arrives, so nothing below it moves when it loads.
          var w = Number(a.w) || 0, h = Number(a.h) || 0;
          var ratio = w && h ? Math.max(1 / 3, Math.min(3, w / h)) : 0;
          var shape = ratio ? ' style="aspect-ratio:' + ratio.toFixed(4) + ';width:min(100%,' + Math.round(Math.min(360, 280 * ratio)) + 'px)"' : '';
          var hold = liteOn() && !window.FavorLite.shown[a.url];
          return '<button type="button" class="ch-media ch-photo" data-act="view"' + at + shape + (hold ? ' data-lite-box="Photo' + (a.size ? ', ' + esc(window.FavorLite.kb(a.size)) : '') + '. Tap to load"' : '') + ' aria-label="View ' + esc(a.name || 'picture') + '"><img class="ch-img" ' + (hold ? 'data-lite-src' : 'src') + '="' + esc(a.url) + '" alt="' + esc(a.name || 'Picture') + '"' + (w && h ? ' width="' + w + '" height="' + h + '"' : '') + ' loading="lazy" decoding="async" /></button>';
        }
        if (fk === 'video') return '<div class="ch-card ch-clip ch-clip--file"' + at + '>' + vidHtml(a.url + '#t=0.1', '', a.name, '', '16 / 9') + '<span class="ch-clip__info"><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(sizeOf(a.size)) + '</span><a class="ch-clip__open" href="' + esc(a.url) + '" download>Download' + ic('dl') + '</a></span></div>';
        if (fk === 'audio' && a.voice) return voiceHtml(a, m);
        if (fk === 'audio') return '<div class="ch-card ch-audio"' + at + '><span class="ch-file__ic" data-k="audio">' + ic('wave') + '</span><span class="ch-audio__t"><span class="ch-card__t">' + esc(a.name) + '</span><audio controls preload="none" src="' + esc(a.url) + '"></audio></span><a class="ch-prev__ext" href="' + esc(a.url) + '" download aria-label="Download ' + esc(a.name) + '" title="Download">' + ic('dl') + '</a></div>';
        var canView = fk === 'pdf' || fk === 'docx' || fk === 'xlsx';
        var lab2 = LAB[fk] || 'FILE';
        var picf = canView && a.id ? thumbBox('f' + a.id, a.url, fk, lab2) : '<span class="ch-prev__pic"><span class="ch-file__ic" data-k="' + fk + '">' + lab2 + '</span></span>';
        var inner = picf + '<span class="ch-prev__t"><span class="ch-card__t" title="' + esc(a.name || '') + '">' + midName(a.name || 'Untitled file') + '</span><span class="ch-card__m">' + esc(sizeOf(a.size)) + '</span></span>';
        return '<div class="ch-card ch-prev' + (canView ? '' : ' ch-prev--plain') + '"' + at + '>' + (canView ? '<button type="button" class="ch-prev__open" data-act="view"' + at + ' aria-label="Preview ' + esc(a.name) + '">' + inner + '</button>' : '<a class="ch-prev__open" href="' + esc(a.url) + '" download>' + inner + '</a>') +
          '<a class="ch-prev__ext" href="' + esc(a.url) + '" download aria-label="Download ' + esc(a.name) + '" title="Download">' + ic('dl') + '</a></div>';
      }
      // q3-tasks hook: a request board card (title, note, status, Open) is drawn by task-card.js.
      if (a.type === 'task') return window.FavorTaskCard ? window.FavorTaskCard.html(a, { esc: esc, ic: ic }) : '';
      // The shared layer: a colleague, partner, fund, task, course or page sent from Send to (public/js/favor-entity.js).
      if (a.type === 'entity') return window.FavorEntity ? window.FavorEntity.cardHtml(a, { esc: esc }) : '';
      // projects hook: a project task card is drawn by projects/links (public/js/chat/project-card.js).
      if (a.type === 'ptask') return window.FavorProjectCard ? window.FavorProjectCard.html(a, { esc: esc, ic: ic }) : '';
      if (a.type === 'link') {
        var pic = a.image && !broken[a.image] && !liteOn() ? '<span class="ch-link__pic"><img src="' + esc(a.image) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>' : '';
        return '<a class="ch-card ch-link' + (pic ? ' ch-link--pic' : '') + '" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-link__t"><span class="ch-card__m">' + esc(a.site || a.host || '') + '</span><span class="ch-card__t">' + esc(a.title || a.url) + '</span>' + (a.desc ? '<span class="ch-card__s">' + esc(a.desc) + '</span>' : '') + '</span>' + pic + '</a>';
      }
      return '';
    }
    /* ------------------------------------------------------------------ playing and previewing in place */
    var viewPop = false, viewBack = false, broken = {};
    function playIn(box) {
      if (!box || box.querySelector('video')) return;
      root.querySelectorAll('.ch-vid video').forEach(function (v) { try { v.pause(); } catch (e) { /* none */ } });
      var v = document.createElement('video');
      v.className = 'ch-vid__v'; v.controls = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto';
      var p = box.querySelector('.ch-vid__poster'); if (p && p.complete && p.naturalWidth) v.poster = p.src;
      v.src = box.getAttribute('data-vsrc');
      // The poster stays up with a spinner until the first frame plays, so a slow start never shows a black box.
      box.classList.add('is-loading');
      var ready = function () { box.classList.remove('is-loading'); };
      v.addEventListener('playing', ready); v.addEventListener('pause', ready); v.addEventListener('error', ready);
      box.appendChild(v); box.classList.add('is-playing');
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () { /* the controls are there to press */ });
    }
    function driveId(u) { var m = String(u || '').match(/\/d\/([A-Za-z0-9_-]{10,})/) || String(u || '').match(/[?&]id=([A-Za-z0-9_-]{10,})/); return m ? m[1] : ''; }
    function openViewer(mid, i) {
      var m = findMsg(mid), V = window.FavorChatView;
      var a = m && m.attachments && m.attachments[i];
      if (!a) return;
      if (!V) { window.open(a.url, '_blank', 'noopener'); return; }
      var item;
      if (a.type === 'file' && fileKind(a) === 'image') {
        // Every picture in this conversation, oldest first, so a swipe goes to the next one.
        var list = [], at = 0;
        (S.msgs[m.channel_id] || []).concat(m.thread_id && S.threads[m.thread_id] ? S.threads[m.thread_id].replies : []).forEach(function (x) {
          (x.attachments || []).forEach(function (y) { if (y.type === 'file' && fileKind(y) === 'image') { if (y === a) at = list.length; list.push({ kind: 'image', url: y.url, name: y.name, download: y.url, sub: user(x.user_id).name }); } });
        });
        if (!list.length) list.push({ kind: 'image', url: a.url, name: a.name, download: a.url });
        item = list[at]; V.open(item, list);
      } else if (a.type === 'drive') {
        var id = driveId(a.url);
        V.open({ kind: 'drive', url: '/api/chat/drive-file/' + m.id + '/' + i + '/content', name: a.name, sub: a.path || 'Google Drive', external: a.url, externalShort: 'Drive', externalLabel: 'Open in Google Drive', page: '/api/chat/drive-file/' + m.id + '/' + i + '/thumb?s=1600', embed: id ? 'https://drive.google.com/file/d/' + id + '/preview' : '' });
      } else {
        var k = fileKind(a);
        V.open({ kind: k, url: a.url, name: a.name, sub: sizeOf(a.size), download: a.url, external: k === 'pdf' ? a.url : '', externalShort: 'Open', externalLabel: 'Open in a new tab' });
      }
      pushNav({ chview: 1 });
    }
    // Anything shown large over the chat (a table from a Brain answer, a request) opens in the same sheet as files, and
    // closes the same ways: X, Escape, Back.
    function openSheet(item, html, cls) {
      var V = window.FavorChatView;
      if (!V || !V.sheet) return null;
      var had = V.isOpen() && history.state && history.state.chview;
      var el = V.sheet(item, html, cls);
      if (!had) pushNav({ chview: 1 });
      return el;
    }
    if (window.FavorChatView) window.FavorChatView.onClose = function () {
      if (viewBack) return;
      if (history.state && history.state.chview && ownsTop()) history.back();
    };

    // A long file name keeps its end (version and extension) and gives up its middle.
    function midName(n) { var c = Array.from(String(n)); if (c.length < 30) return esc(n); return '<span class="ch-mid"><span class="ch-mid__a">' + esc(c.slice(0, c.length - 12).join('')) + '</span><span class="ch-mid__b">' + esc(c.slice(-12).join('')) + '</span></span>'; }
    function sizeOf(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + (n === 1 ? ' byte' : ' bytes'); }

    /* A Favor Brain answer only its asker can read: a label, and Share to channel / Dismiss once the answer is in. */
    function privateHtml(m) {
      var b = m.brain || {};
      var ready = b.status === 'done';
      if (m.user_id !== 'brain') return '<div class="ch-private"><span class="ch-private__tag">' + ic('lock') + 'Only visible to you</span></div>';
      return '<div class="ch-private" data-private="' + m.id + '"><span class="ch-private__tag">' + ic('lock') + 'Only visible to you</span>' +
        (b.status === 'thinking' ? '' : '<span class="ch-private__acts">' + (ready ? '<button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-act="share-answer" data-id="' + m.id + '">Share to channel</button>' : '') + '<button type="button" class="ch-btn ch-btn--sm" data-act="dismiss-answer" data-id="' + m.id + '">Dismiss</button></span>') + '</div>';
    }
    function brainHtml(m) {
      var b = m.brain || {};
      if (b.status === 'thinking') return '<div class="ch-ans"><span class="ch-ans__live">' + ring('thinking') + 'Reading the records</span></div>';
      if (!(b.blocks && b.blocks.length)) return '';
      if (opts.renderBlocks) { var h = opts.renderBlocks(b.blocks, m); if (h) return '<div class="ch-ans">' + h + '</div>'; }
      return '<div class="ch-ans">' + b.blocks.map(function (x) {
        if (x.type === 'tiles') return '<div class="ch-ans__tiles">' + x.items.map(function (t) { return '<div class="ch-ans__tile"><small>' + esc(t.label) + '</small><b>' + esc(t.value) + '</b>' + (t.note ? '<span>' + esc(t.note) + '</span>' : '') + '</div>'; }).join('') + '</div>';
        if (x.type === 'table') return '<table class="ch-ans__table"><thead><tr>' + x.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' + x.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
        if (x.type === 'chips') return '<div class="ch-ans__chips">' + x.items.map(function (c) { return '<button type="button" class="ch-chip" data-act="chip" data-q="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div>';
        if (x.type === 'text') return '<div class="ch-msg__text">' + fmtBody(x.text) + '</div>';
        return '';
      }).join('') + '</div>';
    }

    /* ------------------------------------------------------------------ message row */
    function rxHtml(m) {
      var rs = (m.reactions || []).filter(function (r) { return r.users && r.users.length; });
      if (!rs.length) return '';
      return '<div class="ch-react">' + rs.map(function (r) {
        var mine = r.users.indexOf(S.me.id) >= 0;
        return '<button type="button" class="ch-rx' + (mine ? ' is-mine' : '') + '" data-act="react" data-id="' + m.id + '" data-e="' + esc(r.emoji) + '" title="' + esc(r.users.slice(0, 20).map(function (u) { return user(u).name; }).join(', ') + (r.users.length > 20 ? ' and ' + (r.users.length - 20).toLocaleString('en-US') + ' more' : '')) + '" aria-pressed="' + mine + '"><span>' + esc(r.emoji) + '</span>' + r.users.length.toLocaleString('en-US') + '</button>';
      }).join('') + '<button type="button" class="ch-rx ch-rx--add" data-act="react-pick" data-id="' + m.id + '" aria-label="Add a reaction">' + ic('smile') + '</button></div>';
    }
    // The thread a message belongs to: its own, or the thread a channel copy of a reply came from.
    function threadRef(m) { return (m.attachments || []).filter(function (a) { return a.type === 'threadref'; })[0] || null; }
    function threadIdOf(m) { var r = threadRef(m); return r ? r.root : m.thread_id || m.id; }
    // Translation: the reader's language, set once. A message in another language shows translated with its original a tap away.
    function langName(code) { var l = S.langs.filter(function (x) { return x.code === code; })[0]; return l ? l.name : code; }
    function trFor(m) { var t = S.lang && S.tr[m.id]; return t && t.text && t.body === m.body && !S.trOrig[m.id] && m.user_id !== S.me.id ? t : null; }
    function trNote(m, tx) {
      var t = S.lang && S.tr[m.id];
      if (t && t.paused && t.body === m.body && m.user_id !== S.me.id) return '<div class="ch-tr"><span>Translation is paused for today</span></div>';
      if (!t || !t.text || t.body !== m.body || m.user_id === S.me.id) return '';
      return '<div class="ch-tr"><span>' + (tx ? 'Translated from ' + esc(langName(t.src)) : 'Original, ' + esc(langName(t.src))) + '</span><button type="button" data-act="sm-orig" data-id="' + m.id + '">' + (tx ? 'Show original' : 'Show translation') + '</button></div>';
    }
    function voiceHtml(a, m) {
      var t = S.lang && m && S.tr[m.id] && S.tr[m.id].voice && S.tr[m.id].voice[a.id];
      var words = a.transcript_status === 'ready' ? (a.transcript ? '<div class="ch-voice__w">' + esc(a.transcript) + '</div>' : '<div class="ch-voice__s">No speech heard</div>') : a.transcript_status === 'failed' ? '<div class="ch-voice__s">Transcript not available</div>' : a.transcript_status === 'paused' ? '<div class="ch-voice__s">Transcripts are paused for today</div>' : '<div class="ch-voice__s">Writing the transcript</div>';
      var tr = t && !S.trOrig[m.id] && a.transcript ? '<div class="ch-voice__w ch-voice__w--tr">' + esc(t.text) + '</div><div class="ch-tr"><span>Translated from ' + esc(langName(t.src)) + '</span><button type="button" data-act="sm-orig" data-id="' + m.id + '">Show original</button></div>' : '';
      return '<div class="ch-card ch-voice" data-cm="' + (m ? m.id : '') + '"><div class="ch-voice__row"><span class="ch-file__ic" data-k="audio">' + ic('mic') + '</span><audio controls preload="none" src="' + esc(a.url) + '"></audio></div>' + (tr || words) + '</div>';
    }
    function msgHtml(m, o) {
      o = o || {};
      var u = user(m.user_id), mine = m.user_id === S.me.id, brain = m.user_id === 'brain';
      var cls = 'ch-msg' + (o.cont ? ' ch-msg--cont' : '') + (brain ? ' ch-msg--brain' : '') + (mentionsMe(m) && !mine ? ' is-mention' : '') + (m.pinned && !m.deleted ? ' is-pinned' : '');
      var gut = o.cont ? '<span class="ch-msg__time">' + esc(timeOf(m.created_at).replace(/ (AM|PM)/, '')) + '</span>' : avatar(u, '', false);
      var meta = o.cont ? '' : '<div class="ch-msg__meta"><span class="ch-msg__name">' + esc(u.name) + '</span>' + (brain ? '<span class="ch-tag">Brain</span>' + (m.brain && m.brain.shared_by ? '<span class="ch-shared">Shared by ' + esc(user(m.brain.shared_by).name) + '</span>' : '') : m.user_id === 'meetings' ? '<span class="ch-tag" style="background:var(--tc-teal-tint);color:var(--tc-teal-ink)">Meeting</span>' : '') + '<span class="ch-msg__time">' + esc(timeOf(m.created_at)) + '</span></div>';
      var text;
      if (m.deleted) text = '<div class="ch-msg__text ch-msg__deleted">This message was deleted.</div>';
      else if (S.editing === m.id) text = '<div class="ch-edit"><textarea class="ch-input" data-edit="' + m.id + '" rows="2" style="height:auto;padding:8px 12px">' + esc(S.editDraft != null && S.editDraftId === m.id ? S.editDraft : m.body) + '</textarea><div style="display:flex;gap:8px;margin-top:6px"><button class="ch-btn ch-btn--sm ch-btn--primary" data-act="edit-save" data-id="' + m.id + '">Save</button><button class="ch-btn ch-btn--sm" data-act="edit-cancel">Cancel</button></div></div>';
      else { var tx = trFor(m); text = (m.body ? '<div class="ch-msg__text">' + fmtBody(tx ? tx.text : m.body) + (m.edited_at ? '<span class="ch-msg__edited">(edited)</span>' : '') + '</div>' + trNote(m, tx) : ''); }
      var cards = '';
      if (!m.deleted && m.attachments && m.attachments.length) { cards = m.attachments.map(function (a, i) { return cardHtml(a, m, i); }).join(''); if (cards) cards = '<div class="ch-cards">' + cards + '</div>'; }
      var ref = m.deleted ? null : threadRef(m);
      var refLine = ref ? '<button type="button" class="ch-tref" data-act="thread" data-id="' + ref.root + '">' + ic('reply') + '<span>Replied to a thread' + (ref.text ? ': <b>' + esc(ref.text) + '</b>' : '') + '</span></button>' : '';
      var pinLine = m.pinned && !m.deleted ? '<div class="ch-pinline">' + ic('pin') + 'Pinned</div>' : '';
      var br = !m.deleted && brain ? brainHtml(m) : '';
      var own = !m.deleted && m.visible_to ? privateHtml(m) : '';
      var rx = m.deleted ? '' : rxHtml(m);
      var rep = '';
      if (!o.inThread && m.reply_count) {
        // Replies the person has not read show beside the count, so a thread with something new stands out in the channel.
        rep = '<button type="button" class="ch-replies' + (m.thread_unread ? ' has-new' : '') + '" data-act="thread" data-id="' + m.id + '"><span class="ch-stack">' + (m.reply_users || []).slice(0, 3).map(function (id) { return avatar(user(id), 'xs'); }).join('') + '</span>' + plural(m.reply_count, 'reply', 'replies') +
          (m.thread_unread ? '<span class="ch-replies__new">' + m.thread_unread + ' new</span>' : '') + '<small>Last reply ' + esc(ago(m.last_reply_at)) + '</small></button>';
      }
      var bar = '';
      if (!m.deleted && !o.bare && (!m.visible_to || mine)) {
        bar = '<div class="ch-bar" role="toolbar" aria-label="Message actions">' + (m.visible_to ? '' : '<button type="button" data-act="react-pick" data-id="' + m.id + '" aria-label="React" title="React">' + ic('smile') + '</button>' +
          (o.inThread ? '' : '<button type="button" data-act="thread" data-id="' + threadIdOf(m) + '" aria-label="Reply in thread" title="Reply in thread">' + ic('reply') + '</button>')) +
          '<button type="button" data-act="more" data-id="' + m.id + '" aria-label="More actions" title="More actions" aria-haspopup="menu">' + ic('more') + '</button></div>';
      }
      if (o.bare) rx = rx.replace(/<button type="button" class="ch-rx ch-rx--add"[^>]*>.*?<\/button>/, '');
      return '<article class="' + cls + '" data-mid="' + m.id + '"><div class="ch-msg__gut">' + gut + '</div><div class="ch-msg__body">' + pinLine + meta + refLine + text + cards + br + own + rx + (o.bare ? '' : rep) + '</div>' + bar + '</article>';
    }
    // One string per top-level block (day line, New line, message), so a redraw compares each block's source without reading the DOM.
    function listParts(list, o) {
      o = o || {};
      var out = [], prev = null, newShown = false, lr = o.lastRead;
      list.forEach(function (m) {
        var dk = dayKey(m.created_at);
        if (!prev || dayKey(prev.created_at) !== dk) out.push({ k: 'd' + dk, h: '<div class="ch-day"><span>' + esc(dayLabel(m.created_at)) + '</span></div>' });
        // A conversation never read before (a new member) has no New line: everything in it is new.
        if (!newShown && lr != null && Number(lr) > 0 && Number(m.id) > Number(lr) && m.user_id !== S.me.id) { out.push({ k: 'new', h: '<div class="ch-new"' + (o.inThread ? '' : ' id="ch-new"') + ' data-new>New</div>' }); newShown = true; }
        var cont = prev && prev.user_id === m.user_id && dayKey(prev.created_at) === dk && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000 && !m.deleted && !prev.deleted && !(prev.reply_count && !o.inThread) && !m.pinned && !threadRef(m) && !m.visible_to && !prev.visible_to;
        out.push({ k: 'm' + m.id, h: msgHtml(m, { cont: cont, inThread: o.inThread, bare: o.bare }) });
        prev = m;
      });
      return out;
    }
    function listHtml(list, o) { return listParts(list, o).map(function (x) { return x.h; }).join(''); }
    function channelParts(c) {
      return [{ k: 'top', h: S.hasMore[c.id] ? '<div style="text-align:center;padding:10px"><button type="button" class="ch-btn ch-btn--sm" data-act="older">Load earlier messages</button></div>' : introHtml(c) }].concat(listParts(S.msgs[c.id] || [], { lastRead: S.lastRead[c.id] }));
    }
    // Channels read ahead are drawn ahead too, off screen, when the page is idle; opening one moves the finished blocks in.
    var built = {};
    function prebuild(id) {
      var c = chan(id);
      if (!c || !S.msgs[id] || built[id] || (id === S.active && S.view !== 'list')) return;
      var box = document.createElement('div');
      morph(box, channelParts(c));
      built[id] = box;
    }

    /* ------------------------------------------------------------------ chrome */
    function frameHtml() { return bootHtml(); }

    /* Desktop notices for direct messages, mentions and thread replies. Asked once, from a line the person presses; never on load. */
    function canAsk() { return typeof Notification !== 'undefined' && Notification.permission === 'default' && !lsGet('favor.chat.notify.asked', 0); }
    function askHtml() {
      if (!canAsk() || !S.me) return '';
      return '<div class="ch-ask"><b>Notices for messages and mentions</b><span>Shown when Chat is not in front</span><div class="ch-ask__acts"><button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-act="notify-on">Turn on</button><button type="button" class="ch-btn ch-btn--sm" data-act="notify-no">Not now</button></div></div>';
    }
    function hasDraft(key) { var d = S.drafts[key]; return !!(d && d.text && d.text.trim()); }
    function draftCount() { return Object.keys(S.drafts).filter(hasDraft).length; }
    function renderSide() {
      var s = sortedChannels(), side = $('.ch-side', root), phone = isPhone();
      var open = function (c) { return c.id === S.active && S.page === 'channel'; };
      var row = function (c) {
        var unread = c.unread > 0, on = open(c);
        var icon, n = chName(c);
        // A conversation with an unsent message shows a pencil where its mark would be.
        if (!on && hasDraft(c.id)) icon = '<span class="ch-row__ic ch-row__ic--draft" title="Draft">' + ic('pen') + '</span>';
        else if (c.kind === 'public') icon = '<span class="ch-row__ic">#</span>';
        else if (c.kind === 'private') icon = '<span class="ch-row__ic">' + ic('lock') + '</span>';
        else if (c.kind === 'dm') { var o = (c.members || []).filter(function (m) { return m !== S.me.id; })[0] || S.me.id; icon = '<span class="ch-row__ic">' + avatar(user(o), 'xs', true) + '</span>'; }
        else icon = '<span class="ch-row__ic">' + ic('users') + '</span>';
        var self = c.kind === 'dm' && (c.members || []).every(function (m) { return m === S.me.id; });
        return '<button type="button" class="ch-row' + (on ? ' is-on' : '') + (unread && !c.muted ? ' is-unread' : '') + (c.muted ? ' is-muted' : '') + '" data-act="open" data-id="' + c.id + '"' + (on ? ' aria-current="true"' : '') + '>' + icon + '<span class="ch-row__n">' + esc(n) + (self ? ' (you)' : '') + '</span>' + (c.mentions > 0 ? '<span class="ch-badge" aria-label="' + plural(c.mentions, 'mention') + '">' + (c.mentions > 99 ? '99+' : c.mentions) + '</span>' : '') + '</button>';
      };
      // A folded section still shows what needs the person: unread conversations and the one that is open. Phones show whole sections.
      var sec = function (key, title, act, label, rows, extra) {
        var folded = !phone && !!S.folded[key];
        var list = folded ? rows.filter(function (c) { return (c.unread > 0 && !c.muted) || c.mentions > 0 || open(c); }) : rows;
        return '<div class="ch-sec' + (folded ? ' is-folded' : '') + '" data-sec="' + key + '"><div class="ch-sec__h"><button type="button" class="ch-sec__t" data-act="fold" data-sec="' + key + '" aria-expanded="' + !folded + '">' + ic('caret') + '<b>' + title + '</b></button>' +
          '<button type="button" class="ch-iconbtn" data-act="' + act + '" aria-label="' + label + '" title="' + label + '">' + ic('plus') + '</button></div>' + list.map(row).join('') + (folded ? '' : extra) + '</div>';
      };
      var dmNew = s.dms.filter(function (c) { return c.unread > 0 && !c.muted; }).length;
      var html = '<div class="ch-pnav"><button type="button" class="ch-pn" data-act="hub-menu" aria-label="FavorOS menu"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 8h10"/><path d="M5 16h14"/></svg></button>' +
        '<div class="ch-seg"><button type="button" data-act="seg" data-seg="channels" aria-pressed="' + (S.seg !== 'messages') + '">Channels</button><button type="button" data-act="seg" data-seg="messages" aria-pressed="' + (S.seg === 'messages') + '">Messages' + (dmNew ? '<i class="ch-seg__dot" aria-label="' + dmNew + ' unread"></i>' : '') + '</button></div>' +
        '<button type="button" class="ch-pn" data-act="new-dm" aria-label="New message">' + ic('pen') + '</button></div>' +
        '<div class="ch-side__head"><button type="button" class="ch-jump" data-act="switcher">' + ic('search') + '<span>Jump to or search</span><kbd>Ctrl K</kbd></button><button type="button" class="ch-iconbtn" data-act="new-dm" aria-label="New message" title="New message">' + ic('pen') + '</button></div>' +
        '<div class="ch-list" data-seg="' + (S.seg === 'messages' ? 'messages' : 'channels') + '">' + navRows({ page: S.page, threads: S.threadsUnread, drafts: draftCount() }) +
        sec('channels', 'Channels', 'new-channel', 'New channel', s.chans, '<button type="button" class="ch-row ch-more" data-act="browse"><span class="ch-row__ic">' + ic('search') + '</span><span class="ch-row__n">Browse channels</span></button>') +
        sec('messages', 'Direct messages', 'new-dm', 'New message', s.dms, s.dms.length ? '' : '<button type="button" class="ch-row ch-more" data-act="new-dm"><span class="ch-row__ic">' + ic('pen') + '</span><span class="ch-row__n">Message someone</span></button>') + '</div>' + askHtml();
      patchHtml(side, html);
    }
    var PAGES = { threads: 'Threads', activity: 'Mentions and reactions', drafts: 'Drafts' };
    function renderHead() {
      var c = chan(S.active), h = $('.ch-head', root);
      if (S.page !== 'channel') {
        patchHtml(h, '<button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to channels">' + ic('back') + '</button>' +
          '<div class="ch-head__t"><div class="ch-head__name"><span style="color:var(--r-ink);font-weight:700">' + PAGES[S.page] + '</span></div></div><div class="ch-head__acts"></div>');
        return;
      }
      if (!c) return;
      var name = chName(c), ms = (c.members || []).slice(0, 4);
      var lead = c.kind === 'public' ? '<span>#</span>' : c.kind === 'private' ? ic('lock') : '';
      patchHtml(h, '<button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to channels">' + ic('back') + '</button>' +
        '<div class="ch-head__t"><div class="ch-head__name">' + lead + '<span style="color:var(--r-ink);font-weight:700">' + esc(name) + '</span></div>' + (c.topic ? '<div class="ch-head__topic">' + esc(c.topic) + '</div>' : '') + '</div>' +
        '<div class="ch-head__acts"><button type="button" class="ch-members" data-act="details" aria-label="Members"><span class="ch-stack">' + ms.map(function (id) { return avatar(user(id), 'sm'); }).join('') + '</span>' + (c.members || []).length + '</button>' +
        '<button type="button" class="ch-btn ch-btn--meet' + (S.huddle && S.huddle[c.id] ? ' is-live' : '') + '" data-act="huddle" aria-label="' + (S.huddle && S.huddle[c.id] ? 'Join huddle' : (c.kind === 'dm' || c.kind === 'group') ? 'Huddle: ring ' + esc(chName(c)) : 'Start a huddle') + '" title="' + (S.huddle && S.huddle[c.id] ? 'Join the huddle' : (c.kind === 'dm' || c.kind === 'group') ? 'Ring them into a huddle' : 'Start a huddle here') + '">' + ic('headset') + '<span>' + (S.huddle && S.huddle[c.id] ? 'Join huddle' : 'Huddle') + '</span></button>' +
        '<button type="button" class="ch-iconbtn" data-act="sm-catch" aria-label="Catch me up" title="Catch me up">' + ic('spark') + '</button>' +
        '<button type="button" class="ch-iconbtn' + (S.lang ? ' is-on' : '') + '" data-act="sm-lang" aria-label="Language" title="' + (S.lang ? 'Reading in ' + esc(langName(S.lang)) : 'Choose the language you read in') + '">' + ic('globe') + '</button>' +
        '<button type="button" class="ch-iconbtn ch-hide-m" data-act="search" aria-label="Search messages" title="Search messages">' + ic('search') + '</button>' +
        '<button type="button" class="ch-iconbtn' + (S.right === 'details' ? ' is-on' : '') + '" data-act="details" aria-label="Channel details" title="Channel details">' + ic('info') + '</button></div>');
      $('[data-ta="main"]', root).placeholder = c.kind === 'dm' || c.kind === 'group' ? 'Message ' + name : 'Message ' + (c.kind === 'public' ? '#' : '') + name;
    }
    // Pinned messages and bookmarks sit in one row under the channel name. The row shows only when the channel has either.
    function renderBar() {
      var head = $('.ch-head', root); if (!head) return;
      var bar = $('.ch-pinbar', root);
      if (!bar) { bar = document.createElement('div'); bar.className = 'ch-pinbar'; bar.hidden = true; ($('.ch-hud', root) || head).insertAdjacentElement('afterend', bar); }
      var c = chan(S.active);
      var marks = (c && c.bookmarks) || [];
      if (S.page !== 'channel' || !c || !S.features.pins || !((c.pins || 0) > 0 || marks.length)) { bar.hidden = true; setHtml(bar, ''); return; }
      bar.hidden = false;
      setHtml(bar, (c.pins ? '<button type="button" class="ch-pinbar__i" data-act="pins">' + ic('pin') + '<span>' + c.pins + ' pinned</span></button>' : '') +
        marks.map(function (b) { var here = b.url.charAt(0) === '/'; return '<a class="ch-pinbar__i" href="' + esc(b.url) + '"' + (here ? '' : ' target="_blank" rel="noopener"') + ' title="' + esc(b.url) + '">' + ic(here ? 'mark2' : 'link') + '<span>' + esc(b.title) + '</span></a>'; }).join('') +
        '<button type="button" class="ch-pinbar__add" data-act="bm-add" aria-label="Add a bookmark" title="Add a bookmark">' + ic('plus') + '</button>');
    }
    function plain(body) {
      return String(body || '').replace(/<~[pf]:\d+\|([^>]+)>/g, '$1').replace(/<@([^>]+)>/g, function (_, id) { return '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' ? 'channel' : id === 'here' ? 'here' : user(id).name); }).replace(/<#([^>]+)>/g, function (_, id) { var c = chan(id); return '#' + (c ? c.name : 'channel'); });
    }
    function excerptOf(m) {
      var t = plain(m.body).trim();
      if (t) return t;
      var a = (m.attachments || []).filter(function (x) { return x.type !== 'threadref' && x.type !== 'sent'; })[0];
      if (a) return a.type === 'file' ? (/^image\//.test(a.mime || '') ? 'Picture: ' : 'File: ') + (a.name || '') : a.type === 'clip' ? 'Clip: ' + (a.title || '') : a.type === 'task' ? 'Request: ' + (a.title || '') : a.type === 'meeting' ? (a.title || 'Meeting') : a.name || a.title || 'Attachment';
      return m.user_id === 'brain' ? 'An answer from Favor Brain' : '';
    }
    function whereOf(id) { var c = chan(id); return c ? (c.kind === 'public' ? '#' : '') + chName(c) : 'a conversation'; }
    var SKEL = '<div class="ch-skel"><i style="width:30%"></i><i style="width:80%"></i><i style="width:55%"></i><i style="width:70%"></i></div>';
    // In the Threads list a Favor Brain answer shows as one line (what it found); the thread shows the whole answer.
    function brainLine(m) {
      var bl = (m.brain && m.brain.blocks) || [];
      for (var i = 0; i < bl.length; i++) {
        var x = bl[i];
        if (x.type === 'tiles' && x.tiles && x.tiles[0]) return x.tiles[0].label + ': ' + (typeof x.tiles[0].value === 'number' ? x.tiles[0].value.toLocaleString('en-US') : x.tiles[0].value);
        if (x.type === 'table') return (x.title || 'A list') + ', ' + (Number(x.count) || (x.rows || []).length).toLocaleString('en-US') + ' rows';
        if (x.type === 'team') return x.team + ' ' + x.year;
        if (x.type === 'partner') return x.name;
        if ((x.type === 'text' || x.md) && x.md) return String(x.md).replace(/[*_#|>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
      }
      return 'An answer';
    }
    function lite(m) { return m.user_id === 'brain' && m.brain && m.brain.blocks ? Object.assign({}, m, { brain: null, body: brainLine(m) }) : m; }
    function pageHtml() {
      if (S.page === 'threads') {
        var l = S.threadList;
        if (!l) return SKEL;
        if (!l.length) return '<div class="ch-empty ch-empty--page"><b>No threads yet</b></div>';
        return '<div class="ch-pagelist">' + l.map(function (t) {
          var at = ' data-ch="' + esc(t.channel_id) + '" data-id="' + t.root.id + '"';
          var more = (t.root.reply_count || 0) - t.latest.length;
          return '<section class="ch-th' + (t.unread ? ' has-new' : '') + '"><header class="ch-th__h"><button type="button" class="ch-th__ch" data-act="open-thread"' + at + '>' + esc(whereOf(t.channel_id)) + '</button>' + (t.unread ? '<span class="ch-badge">' + (t.unread > 99 ? '99+' : t.unread) + ' new</span>' : '') + '<span class="ch-th__when">' + esc(ago(t.last_reply_at || t.root.created_at)) + '</span></header>' +
            msgHtml(lite(t.root), { inThread: true, bare: true }) + (more > 0 ? '<button type="button" class="ch-th__more" data-act="open-thread"' + at + '>' + plural(more, 'earlier reply', 'earlier replies') + '</button>' : '') +
            t.latest.map(function (m) { return msgHtml(lite(m), { inThread: true, bare: true }); }).join('') +
            '<div class="ch-th__f"><button type="button" class="ch-btn ch-btn--sm" data-act="open-thread"' + at + '>' + ic('reply') + 'Reply</button></div></section>';
        }).join('') + '</div>';
      }
      if (S.page === 'activity') {
        var a = S.activity;
        if (!a) return SKEL;
        if (!a.length) return '<div class="ch-empty ch-empty--page"><b>Nothing yet</b></div>';
        var VERB = { mention: 'mentioned you in', reply: 'replied in a thread in', reaction: 'reacted to your message in' };
        return '<div class="ch-pagelist">' + a.map(function (i, k) {
          return '<button type="button" class="ch-actv' + (i.unread ? ' is-unread' : '') + '" data-act="actv" data-i="' + k + '">' + avatar(user(i.by)) + '<span class="ch-actv__t"><span class="ch-actv__m"><b>' + esc(user(i.by).name) + '</b> ' + VERB[i.kind] + ' <b>' + esc(whereOf(i.channel_id)) + '</b><time>' + esc(ago(i.at)) + '</time></span><span class="ch-actv__x">' + esc(excerptOf(i.message)) + '</span></span>' + (i.kind === 'reaction' ? '<span class="ch-actv__e">' + i.emoji + '</span>' : '') + '</button>';
        }).join('') + '</div>';
      }
      var keys = Object.keys(S.drafts).filter(hasDraft).sort(function (x, y) { return (S.drafts[y].at || 0) - (S.drafts[x].at || 0); });
      if (!keys.length) return '<div class="ch-empty ch-empty--page"><b>No drafts</b></div>';
      return '<div class="ch-pagelist">' + keys.map(function (k) {
        var d = S.drafts[k], parts = k.split('|');
        return '<div class="ch-draft"><button type="button" class="ch-draft__open" data-act="draft-open" data-k="' + esc(k) + '"><span class="ch-draft__w"><b>' + esc(whereOf(parts[0])) + '</b>' + (parts[1] ? '<span class="ch-tag">Thread</span>' : '') + '<time>' + esc(ago(new Date(d.at || Date.now()).toISOString())) + '</time></span><span class="ch-draft__x">' + esc(d.text) + '</span></button>' +
          '<button type="button" class="ch-iconbtn" data-act="draft-del" data-k="' + esc(k) + '" aria-label="Delete the draft" title="Delete the draft">' + ic('trash') + '</button></div>';
      }).join('') + '</div>';
    }
    function renderPage() {
      var box = $('.ch-msgs', root), inner = $('.ch-msgs__in', box) || box, key = '~' + S.page;
      var fresh = inner._ch !== key;
      if (fresh) {
        if (inner._ch && inner._ch.charAt(0) !== '~') { var keep = document.createElement('div'); while (inner.firstChild) keep.appendChild(inner.firstChild); built[inner._ch] = keep; }
        else inner.innerHTML = '';
        inner._ch = key; inner._h = null;
      }
      setHtml(inner, pageHtml());
      if (fresh) box.scrollTop = 0;
      if (window.FavorChatBrain) window.FavorChatBrain.draw(inner);
      if (window.FavorChatView) window.FavorChatView.watch(inner);
      syncLatestSoon();
    }
    function introHtml(c) {
      var n = chName(c);
      if (c.kind === 'dm') return '<div class="ch-intro"><h2>' + esc(n) + '</h2><p>This is the start of your conversation with ' + esc(n) + '.</p></div>';
      if (c.kind === 'group') return '<div class="ch-intro"><h2>' + esc(n) + '</h2><p>This is the start of the group conversation.</p></div>';
      // A private channel shows its lock here too, as in the header and the channel list.
      return '<div class="ch-intro"><h2>' + (c.kind === 'private' ? '<span class="ch-intro__lock">' + ic('lock') + '</span>' : '# ') + esc(n) + '</h2><p>' + esc(c.topic || 'The start of the channel.') + '</p></div>';
    }
    function renderMsgs(forceBottom) {
      var box = $('.ch-msgs', root), c = chan(S.active);
      if (S.page !== 'channel') return renderPage();
      if (!c) return;
      var inner = $('.ch-msgs__in', box) || box;
      var list = S.msgs[c.id];
      var near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
      // Switching channels keeps the old channel's blocks aside for a quick return and brings in this one's, built or kept.
      if (inner._ch !== c.id) {
        if (inner._ch && inner._ch.charAt(0) !== '~') { var keep = document.createElement('div'); while (inner.firstChild) keep.appendChild(inner.firstChild); built[inner._ch] = keep; }
        else inner.innerHTML = '';
        inner._ch = null; inner._h = null;
        if (list && built[c.id]) { var got = built[c.id]; delete built[c.id]; while (got.firstChild) inner.appendChild(got.firstChild); }
      }
      if (!list) { setHtml(inner, '<div class="ch-skel"><i style="width:30%"></i><i style="width:80%"></i><i style="width:55%"></i><i style="width:70%"></i></div>'); return; }
      if (inner._h != null) inner.innerHTML = '';
      inner._ch = c.id; inner._h = null;
      morph(inner, channelParts(c));
      if (forceBottom || near) {
        var nw = forceBottom === 'unread' ? $('#ch-new', box) : null;
        if (nw) { box.scrollTop = Math.max(0, nw.offsetTop - 60); pinned = box.scrollHeight - box.scrollTop - box.clientHeight < 60; }
        else { box.scrollTop = box.scrollHeight; pinned = true; }
      }
      if (window.FavorChatView) window.FavorChatView.watch(inner);
      if (window.FavorChatBrain) window.FavorChatBrain.draw(inner);
      syncLatestSoon();
    }
    function typingLine(t) {
      var now = Date.now();
      var names = Object.keys(t || {}).filter(function (id) { return id !== S.me.id && now - t[id] < 5000; }).map(function (id) { return user(id).name.split(' ')[0]; });
      return names.length ? '<i></i><i></i><i></i><span>' + esc(names.length === 1 ? names[0] + ' is typing' : names.length === 2 ? names.join(' and ') + ' are typing' : 'Several people are typing') + '</span>' : '';
    }
    // Typing in the channel shows above the message box; typing in a thread shows above that thread's reply box.
    function renderTyping() {
      var el = $('.ch-main .ch-typing', root);
      if (el) setHtml(el, S.page === 'channel' ? typingLine(S.typing[S.active]) : '');
      var tl = $('.ch-right .ch-typing', root);
      if (tl) setHtml(tl, S.right === 'thread' && S.threadRoot ? typingLine(S.threadTyping[S.threadRoot]) : '');
    }
    function renderRight() {
      var el = $('.ch-right', root), c = chan(S.active);
      root.dataset.right = S.right;
      if (S.right === 'none' || !c) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      var oldTb = $('.ch-thread__body', el);
      S.threadScroll = oldTb ? { top: oldTb.scrollTop, bottom: oldTb.scrollHeight - oldTb.scrollTop - oldTb.clientHeight < 80 } : null;
      if (S.threadFull && S.right === 'thread' && !isPhone()) root.dataset.tfull = '1'; else delete root.dataset.tfull;
      if (S.right === 'thread') {
        var t = S.threads[S.threadRoot];
        var cname = (c.kind === 'public' ? '# ' : '') + chName(c);
        var full = S.threadFull && !isPhone();
        // Full width: the thread takes the channel's place, and the channel's name on the left is the way back to it.
        var head = (full ? '<button type="button" class="ch-crumb" data-act="thread-exit" aria-label="Back to ' + esc(cname) + '">' + ic('back') + '<span>' + esc(cname) + '</span></button>' : '<button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel">' + ic('back') + '</button>') +
          '<div><b>Thread</b>' + (full ? '' : '<small>' + esc(cname) + '</small>') + '</div>' +
          '<button type="button" class="ch-iconbtn ch-desk" data-act="thread-full" aria-pressed="' + full + '" aria-label="' + (full ? 'Show the thread beside the channel' : 'Open the thread full width') + '" title="' + (full ? 'Show beside the channel' : 'Open full width') + '">' + ic(full ? 'side' : 'full') + '</button>' +
          '<button type="button" class="ch-iconbtn" data-act="close-right" aria-label="Close the thread">' + ic('x') + '</button>';
        var body = !t ? '<div class="ch-skel"><i style="width:60%"></i><i style="width:85%"></i></div>' :
          msgHtml(t.root, { inThread: true }) + (t.replies.length ? '<div class="ch-thread__n">' + plural(t.replies.length, 'reply', 'replies') + '</div>' : '') + listHtml(t.replies, { inThread: true, lastRead: S.threadNew[S.threadRoot] });
        var keep = el.dataset.mode === 'thread' && el.dataset.root === String(S.threadRoot) && $('.ch-comp', el);
        if (keep) { var tbx = $('.ch-thread__body', el); if (tbx.querySelector('.ch-skel')) tbx.innerHTML = ''; morph(tbx, body); }
        else {
          el.innerHTML = '<div class="ch-rz" data-rz role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of the thread panel"></div><div class="ch-right__head"></div><div class="ch-thread__body">' + body + '</div><div class="ch-typing" aria-live="polite"></div>' + composerHtml('thread', 'Reply');
          el.dataset.mode = 'thread'; el.dataset.root = String(S.threadRoot);
          S.threadPlaced = null;
        }
        patchHtml($('.ch-right__head', el), head);
        var lab = $('[data-also-label]', el);
        if (lab) lab.textContent = 'Also send to ' + (c.kind === 'public' ? '#' + c.name : c.kind === 'private' ? c.name : c.kind === 'dm' ? chName(c) : 'the group');
        var tb = $('.ch-thread__body', el);
        // The first time a thread's replies are on screen it opens at what is new, or at the newest reply. After that it stays where it was.
        if (t && t.loaded && S.threadPlaced !== S.threadRoot) {
          var nl = $('[data-new]', tb);
          tb.scrollTop = nl ? Math.max(0, nl.offsetTop - tb.offsetTop - 48) : tb.scrollHeight;
          S.threadPlaced = S.threadRoot;
        } else if (S.threadSeen === S.threadRoot && S.threadScroll != null) tb.scrollTop = S.threadScroll.bottom ? tb.scrollHeight : S.threadScroll.top;
        else if (!t || !t.loaded) tb.scrollTop = 0;
        S.threadSeen = S.threadRoot;
        syncSend('thread'); if (!keep) { renderPending('thread'); restoreDraft('thread'); }
        if (window.FavorChatBrain) window.FavorChatBrain.draw(tb);
        if (window.FavorChatView) window.FavorChatView.watch(tb);
        renderTyping(); syncLatestSoon();
      } else if (S.right === 'pins') {
        el.dataset.mode = 'pins'; el.dataset.root = '';
        var P = S.pins[c.id];
        var pinsHtml = !P ? '<div class="ch-skel"><i style="width:60%"></i><i style="width:85%"></i></div>' :
          '<h4>Pinned messages</h4>' + (P.pins.length ? P.pins.map(function (m) {
            return '<div class="ch-pinned">' + msgHtml(m, { inThread: true, bare: true }) + '<div class="ch-pinned__f"><span>Pinned by ' + esc(user(m.pinned_by).name) + '</span><button type="button" class="ch-btn ch-btn--sm" data-act="jump-msg" data-id="' + m.id + '"' + (m.thread_id ? ' data-t="' + m.thread_id + '"' : '') + '>Go to message</button><button type="button" class="ch-btn ch-btn--sm" data-act="pin" data-id="' + m.id + '" data-on="0">Unpin</button></div></div>';
          }).join('') : '<p class="ch-det__none">No pinned messages</p>') +
          '<h4>Bookmarks</h4>' + (P.bookmarks.length ? P.bookmarks.map(function (b) {
            var here = b.url.charAt(0) === '/';
            return '<div class="ch-bm"><a href="' + esc(b.url) + '"' + (here ? '' : ' target="_blank" rel="noopener"') + '>' + ic(here ? 'mark2' : 'link') + '<span><b>' + esc(b.title) + '</b><small>' + esc(b.url) + '</small></span></a><button type="button" class="ch-iconbtn" data-act="bm-del" data-id="' + esc(b.id) + '" aria-label="Remove the bookmark ' + esc(b.title) + '" title="Remove">' + ic('x') + '</button></div>';
          }).join('') : '<p class="ch-det__none">No bookmarks</p>') +
          '<button type="button" class="ch-btn ch-btn--sm" data-act="bm-add" style="margin-top:10px">' + ic('plus') + 'Add a bookmark</button>';
        el.innerHTML = '<div class="ch-right__head"><button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel">' + ic('back') + '</button><div><b>Pinned</b><small>' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</small></div><button type="button" class="ch-iconbtn" data-act="close-right" aria-label="Close">' + ic('x') + '</button></div><div class="ch-det ch-det--pins">' + pinsHtml + '</div>';
        if (window.FavorChatView) window.FavorChatView.watch(el);
      } else {
        el.dataset.mode = 'details'; el.dataset.root = '';
        var members = (c.members || []).map(function (id) { return user(id); });
        var tabs = '<div class="ch-tabs" role="tablist">' + [['about', 'About'], ['members', 'Members ' + members.length], ['files', 'Files']].map(function (x) { return '<button type="button" role="tab" data-act="tab" data-tab="' + x[0] + '" class="' + (S.tab === x[0] ? 'is-on' : '') + '" aria-selected="' + (S.tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
        var det = '';
        var canEdit = c.kind === 'public' || c.kind === 'private';
        if (S.tab === 'about') {
          det = '<h4>Topic</h4>' + (canEdit ? '<input class="ch-input" data-topic value="' + esc(c.topic || '') + '" placeholder="Add a topic" maxlength="200" aria-label="Topic" />' : '<p>' + esc(c.topic || 'None') + '</p>') +
            '<h4>Created</h4><p>' + esc(fmtShort.format(new Date(c.created_at || Date.now()))) + (c.created_by ? ' by ' + esc(user(c.created_by).name) : '') + '</p>' +
            (canEdit ? '<h4>Visibility</h4><p>' + (c.kind === 'private' ? 'Private. Only the members below can read it.' : 'Public. Anyone on staff can find and join it.') + '</p>' : '') +
            '<div class="ch-det__acts">' + (c.kind !== 'dm' ? '<button type="button" class="ch-btn ch-btn--danger" data-act="leave">' + ic('out') + 'Leave ' + (c.kind === 'group' ? 'conversation' : 'channel') + '</button>' : '') + '<button type="button" class="ch-btn" data-act="mute">' + ic('bell') + (c.muted ? 'Unmute' : 'Mute') + '</button></div>';
        } else if (S.tab === 'members') {
          det = (c.kind === 'dm' ? '' : '<button type="button" class="ch-btn ch-btn--sm" data-act="add-members" style="margin-bottom:8px">' + ic('plus') + 'Add people</button>') + members.map(function (u) {
            return '<div class="ch-person">' + avatar(u, '', true) + '<span><b>' + esc(u.name) + (u.id === S.me.id ? ' (you)' : '') + '</b><small>' + esc(u.title || (u.presence === 'online' ? 'Active now' : u.presence === 'away' ? 'Away' : 'Offline')) + '</small></span>' + (c.created_by === u.id ? '<span class="ch-person__r">Created it</span>' : '') + (u.id !== S.me.id && window.FavorRing ? '<button type="button" class="ch-btn ch-btn--sm" data-act="ring-person" data-id="' + esc(u.id) + '" aria-label="Huddle with ' + esc(u.name) + '" title="Ring ' + esc(u.name) + '">' + ic('headset') + '</button>' : '') + '</div>';
          }).join('');
        } else {
          var files = []; (S.msgs[c.id] || []).forEach(function (m) { (m.attachments || []).forEach(function (a, i) { if (a.type !== 'link') files.push({ a: a, m: m, i: i }); }); });
          det = files.length ? files.reverse().map(function (f) { return '<div style="margin-bottom:8px">' + cardHtml(f.a, f.m, f.i) + '<div class="ch-card__m" style="margin:2px 2px 0">' + esc(user(f.m.user_id).name) + ' · ' + esc(ago(f.m.created_at)) + '</div></div>'; }).join('') : '<div class="ch-empty">No files shared yet</div>';
        }
        el.innerHTML = '<div class="ch-right__head"><button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel">' + ic('back') + '</button><div><b>' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</b><small>Details</small></div><button type="button" class="ch-iconbtn" data-act="close-right" aria-label="Close details">' + ic('x') + '</button></div>' + tabs + '<div class="ch-det">' + det + '</div>';
      }
    }
    function setView(v) {
      S.view = v; root.dataset.view = v;
      document.body.classList.toggle('ch-deep', v !== 'list');
      // Measured in the next frame, before it paints, so a tap never waits on a forced layout of the whole page.
      measureSoon();
    }
    function measure() {
      // iOS keyboard: the visual viewport shrinks and Safari scrolls the page under it. While it is open, the chat fits the
      // visible area above the keyboard and the hub tab bar steps aside, so the channel header and the composer both show.
      var vv = window.visualViewport;
      // body.kb-open comes from focus (app-update.js): a home screen app shrinks the whole page with the keyboard, so a height gap never shows there.
      var kb = isPhone() && !!vv && document.body.classList.contains('kb-open');
      document.body.classList.toggle('ch-kb', kb);
      if (kb) {
        root.style.setProperty('--ch-top', Math.round(vv.offsetTop) + 'px');
        root.style.setProperty('--ch-bot', Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) + 'px');
        return;
      }
      var top = $('.h-top'), bar = $('.h-navbar');
      var t = 0, b = 0;
      if (top && getComputedStyle(top).display !== 'none') t = Math.round(top.getBoundingClientRect().bottom);
      if (bar && getComputedStyle(bar).display !== 'none') b = Math.round(window.innerHeight - bar.getBoundingClientRect().top);
      if (isPhone()) { root.style.setProperty('--ch-top', t + 'px'); root.style.setProperty('--ch-bot', b + 'px'); }
    }
    function renderAll(bottom) { root.dataset.page = S.page; renderSide(); renderHead(); renderHud(); renderBar(); renderMsgs(bottom); renderTyping(); renderRight(); syncSend('main'); }

    /* ------------------------------------------------------------------ actions */
    /* ------------------------------------------------------------------ where the person is, and the browser's Back
       Each screen the page adds to the browser's history carries what was open (nav.pos counts them). Back and Forward put
       that screen back; an X or a back arrow on the page takes the same step, so the two never disagree. FavorOS's own
       overlays (help, search, the huddle sheet) keep their own steps on top of these and are left to FavorOS. */
    var nav = { pos: (history.state && history.state.chn) || 0, after: null };
    function ownsTop() { return !!(history.state && history.state.chn && history.state.chn === nav.pos); }
    function pushNav(extra) {
      nav.pos += 1; nav.view = !!(extra && extra.chview);
      var st = Object.assign({ chn: nav.pos, chv: S.view, ch: S.active, t: S.threadRoot, full: S.threadFull, right: S.right, page: S.page }, extra || {});
      try { history.pushState(st, ''); } catch (e) { nav.pos -= 1; }
    }
    function applyNav(st) {
      var phone = isPhone();
      if (!st.chn) {
        // The page as it first opened: the list on a phone, the channel with no full-width thread on a desktop.
        S.threadFull = false;
        if (phone) { saveDraft('thread'); S.right = 'none'; S.threadRoot = null; S.threadSeen = null; setView('list'); renderRight(); renderSide(); }
        else renderRight();
        return;
      }
      var page = st.page || 'channel';
      if (page !== 'channel') { if (S.page !== page || S.right !== 'none') openPage(page, { pop: true }); else setView('channel'); return; }
      if (st.ch && chan(st.ch) && (st.ch !== S.active || S.page !== 'channel')) openChannel(st.ch, { pop: true });
      if (st.chv === 'thread' && st.t) {
        if (S.threadRoot !== st.t || S.right !== 'thread') openThread(st.t, { pop: true, full: !!st.full });
        else { S.threadFull = !!st.full; setView('thread'); renderRight(); }
        return;
      }
      if (st.chv === 'details') { S.right = st.right === 'pins' ? 'pins' : 'details'; S.threadRoot = null; S.threadFull = false; setView('details'); renderRight(); renderHead(); return; }
      S.threadFull = false;
      if (phone) { saveDraft('thread'); S.right = 'none'; S.threadRoot = null; S.threadSeen = null; }
      setView('channel'); renderRight(); renderHead();
    }

    /* ------------------------------------------------------------------ drafts: what was typed and not sent, kept per conversation and per thread */
    function draftKey(scope) { return scope === 'thread' ? (S.threadRoot && S.right === 'thread' ? S.active + '|' + S.threadRoot : null) : S.page === 'channel' ? S.active : null; }
    function saveDraft(scope) {
      var key = draftKey(scope), ta = $('[data-ta="' + scope + '"]', root);
      if (!key || !ta) return;
      var had = hasDraft(key);
      if (ta.value.trim()) S.drafts[key] = { text: ta.value, map: S.mentionMap[scope], at: Date.now() };
      else delete S.drafts[key];
      lsSet('favor.chat.drafts.v1', S.drafts);
      if (had !== hasDraft(key)) renderSide();
    }
    function restoreDraft(scope) {
      var ta = $('[data-ta="' + scope + '"]', root), key = draftKey(scope);
      if (!ta) return;
      var d = key ? S.drafts[key] : null;
      ta.value = d && d.text ? d.text : '';
      S.mentionMap[scope] = d && d.map ? Object.assign({}, d.map) : {};
      grow(ta); syncSend(scope);
    }
    function clearDraft(scope) {
      var key = draftKey(scope);
      if (!key || !S.drafts[key]) return;
      delete S.drafts[key]; lsSet('favor.chat.drafts.v1', S.drafts); renderSide();
    }
    var draftT = 0;
    function saveDraftSoon(scope) { clearTimeout(draftT); draftT = setTimeout(function () { saveDraft(scope); }, 350); }

    function openChannel(id, o) {
      o = o || {};
      if (!chan(id)) return;
      clearTimeout(draftT); saveDraft('main'); if (S.right === 'thread') saveDraft('thread');
      var changed = S.active !== id || S.page !== 'channel';
      S.active = id; S.page = 'channel'; try { localStorage.setItem('favor.chat.last', id); } catch (e) { /* private mode */ }
      if (changed) { S.right = S.right === 'details' ? 'details' : 'none'; if (S.threadRoot) delete S.threadNew[S.threadRoot]; S.threadRoot = null; S.threadFull = false; S.editing = null; S.newBelow.main = 0; }
      // Opening a conversation reads it. One the person marked unread stays that way until they open it again.
      S.keepUnread = null;
      if (opts.onOpen) opts.onOpen(id);
      var c = chan(id);
      S.lastRead[id] = c.last_read != null ? c.last_read : S.lastRead[id];
      setView('channel');
      if (isPhone() && !o.pop) pushNav();
      renderAll('unread');
      restoreDraft('main');
      if (!S.msgs[id]) {
        guard(api.history(id)).then(function (r) {
          S.msgs[id] = r.messages; S.hasMore[id] = !!r.more;
          if (S.active === id && S.page === 'channel') { renderMsgs('unread'); markRead(); }
        });
      } else {
        markRead();
        // A channel read ahead of time opens finished; a quiet refresh catches anything that arrived since.
        if (S.warm[id]) { S.warm[id] = false; api.history(id).then(function (r) { S.msgs[id] = r.messages; S.hasMore[id] = !!r.more; if (S.active === id && S.page === 'channel') renderMsgs(false); }).catch(function () {}); }
      }
      loadHuddle(id);
      if (!isPhone()) setTimeout(function () { var ta = $('[data-ta="main"]', root); if (ta) ta.focus(); }, 0);
    }
    // The three lists above the channels take the channel's place in the middle column.
    function openPage(page, o) {
      o = o || {};
      if (!PAGES[page]) return;
      clearTimeout(draftT); saveDraft('main'); if (S.right === 'thread') saveDraft('thread');
      if (S.threadRoot) delete S.threadNew[S.threadRoot];
      S.page = page; S.right = 'none'; S.threadRoot = null; S.threadFull = false; S.editing = null;
      setView('channel');
      if (isPhone() && !o.pop) pushNav();
      renderAll();
      loadPage(page);
    }
    function loadPage(page) {
      if (page === 'threads' && api.threads) return guard(api.threads()).then(function (r) { takeThreads(r); if (S.page === 'threads') renderMsgs(false); });
      if (page === 'activity' && api.activity) return guard(api.activity()).then(function (r) { S.activity = r.items || []; if (S.page === 'activity') renderMsgs(false); });
    }
    // The Threads list is the record of what is unread in threads: the number beside Threads and the mark on each parent message come from it.
    function takeThreads(r) {
      S.threadList = r.threads || []; S.threadsUnread = r.unread || 0;
      var by = {}; S.threadList.forEach(function (t) { by[t.root.id] = t.unread; });
      Object.keys(S.msgs).forEach(function (k) { (S.msgs[k] || []).forEach(function (m) { if (m.reply_count && by[m.id] != null && !(S.right === 'thread' && m.id === S.threadRoot)) m.thread_unread = by[m.id]; }); });
      renderSide(); if (opts.onUnread) opts.onUnread(totalUnread());
    }
    var threadsT = 0;
    function refreshThreads() {
      if (!api.threads) return;
      clearTimeout(threadsT);
      threadsT = setTimeout(function () { api.threads().then(function (r) { takeThreads(r); if (S.page === 'threads' || S.page === 'channel') renderMsgs(false); }).catch(function () {}); }, 500);
    }
    // Quietly loads the messages of the channels a person is most likely to open next (unread first, then the most recent), one at a time,
    // so tapping a channel shows its messages in the same frame as the slide instead of a skeleton.
    function readAhead() {
      if (liteOn()) return; // Lite mode: a channel loads when it is opened.
      var ids = Object.keys(S.channels).map(function (k) { return S.channels[k]; }).filter(function (c) { return c.joined !== false && (c.id !== S.active || S.view === 'list') && !S.msgs[c.id]; })
        .sort(function (a, b) { return (b.unread > 0) - (a.unread > 0) || String(b.last_at || '').localeCompare(String(a.last_at || '')); }).slice(0, 6).map(function (c) { return c.id; });
      var next = function () {
        var id = ids.shift(); if (!id) return;
        if (S.msgs[id]) return next();
        Promise.resolve(api.history(id)).then(function (r) { if (!S.msgs[id]) { S.msgs[id] = r.messages; S.hasMore[id] = !!r.more; S.warm[id] = true; warmPictures(r.messages); (window.requestIdleCallback || function (f) { setTimeout(f, 50); })(function () {
          // On the phone list, the channel the header already names is drawn into its (hidden) screen, so tapping it only slides.
          if (id === S.active && S.view === 'list') renderMsgs('unread'); else prebuild(id);
        }); } }, function () {}).then(function () { setTimeout(next, 250); });
      };
      setTimeout(next, 0);
    }
    // The newest pictures and clip posters of a channel read ahead are fetched too, so they are in place when the channel slides in.
    function warmPictures(list) {
      if (liteOn()) return;
      var urls = [];
      (list || []).slice(-15).forEach(function (m) { (m.attachments || []).forEach(function (a) { if (a.type === 'clip' && a.thumb) urls.push(a.thumb); else if (a.type === 'file' && /^image\//.test(a.mime || '')) urls.push(a.url); }); });
      urls.slice(-6).forEach(function (u) { var im = new Image(); im.decoding = 'async'; im.src = u; });
    }
    function markRead() {
      var c = chan(S.active), list = S.msgs[S.active];
      if (!c || !list || !list.length || document.hidden || S.page !== 'channel' || S.keepUnread === S.active) return;
      var last = list[list.length - 1].id;
      if (c.unread || c.mentions || Number(c.last_read || 0) < Number(last)) {
        c.unread = 0; c.mentions = 0; c.last_read = last;
        api.read(S.active, last); renderSide(); if (opts.onUnread) opts.onUnread(totalUnread());
      }
    }
    // The hub's badge counts what is addressed to the person: mentions and direct messages, plus unread replies in their threads.
    function totalUnread() { var n = 0, m = 0; Object.keys(S.channels).forEach(function (k) { var c = S.channels[k]; if (c.joined === false || c.muted) return; n += c.unread > 0 ? 1 : 0; m += c.mentions || 0; }); return { channels: n, mentions: m + (S.threadsUnread || 0) }; }
    function openThread(id, o) {
      o = o || {};
      id = Number(id);
      var was = S.right === 'thread' && S.threadRoot === id;
      if (S.right === 'thread' && S.threadRoot && !was) { saveDraft('thread'); delete S.threadNew[S.threadRoot]; }
      S.right = 'thread'; S.threadRoot = id; S.editing = null; S.newBelow.thread = 0;
      if (o.full != null) S.threadFull = !!o.full && !isPhone();
      var found = (S.msgs[S.active] || []).filter(function (m) { return String(m.id) === String(id); })[0];
      if (found && !S.threads[id]) S.threads[id] = { root: found, replies: [] };
      setView('thread');
      if (!o.pop && !was && (isPhone() || S.threadFull)) pushNav();
      renderRight(); renderHead();
      guard(api.thread(id)).then(function (t) {
        t.loaded = true;
        // What was new to the person when the thread opened keeps a New line above it for as long as the thread stays open.
        if (t.unread > 0) { var k = t.replies.length - t.unread; S.threadNew[id] = k > 0 ? t.replies[k - 1].id : t.root.id; }
        S.threads[id] = t;
        threadRead(id, t.threads_unread);
        if (S.threadRoot === id) renderRight();
      });
      if (!isPhone()) setTimeout(function () { var ta = $('[data-ta="thread"]', root); if (ta) ta.focus(); }, 0);
    }
    // A thread from anywhere (the Threads list, a search hit, a link): its conversation opens first, then the thread.
    function openThreadIn(channelId, id, o) {
      if (!chan(channelId)) return;
      // From one of the lists the thread is one step: Back goes straight back to the list, as in Slack.
      if (S.active !== channelId || S.page !== 'channel') openChannel(channelId, { pop: S.page !== 'channel' });
      openThread(id, o);
    }
    // Opening a thread reads it: the mark on its parent message goes, and the number beside Threads drops.
    function threadRead(id, total) {
      var m = findMsg(id), had = m && m.thread_unread;
      if (m) m.thread_unread = 0;
      (S.threadList || []).forEach(function (t) { if (t.root.id === id) t.unread = 0; });
      if (total != null) S.threadsUnread = total;
      if (had && S.page === 'channel') renderMsgs(false);
      renderSide(); if (opts.onUnread) opts.onUnread(totalUnread());
    }
    // A reply that arrives while its thread is open and in view is read at once.
    var touchT = 0;
    function touchThread(id) {
      clearTimeout(touchT);
      touchT = setTimeout(function () {
        if (S.threadRoot !== id || S.right !== 'thread' || document.hidden) return;
        api.thread(id).then(function (t) { t.loaded = true; if (S.threadRoot !== id) return; S.threads[id] = t; threadRead(id, t.threads_unread); renderRight(); }).catch(function () {});
      }, 900);
    }
    function closeRight() {
      var done = function () {
        if (S.right === 'thread') { saveDraft('thread'); if (S.threadRoot) delete S.threadNew[S.threadRoot]; }
        S.right = 'none'; S.threadRoot = null; S.threadSeen = null; S.threadFull = false;
        setView('channel'); renderRight(); renderHead();
        if (window.FavorChatBrain) window.FavorChatBrain.draw($('.ch-msgs', root));
        if (!isPhone()) { var ta = $('[data-ta="main"]', root); if (ta && S.page === 'channel') ta.focus(); }
      };
      // A screen that added a step to the browser's history (any phone screen, the full-width thread) gives the step back first.
      if (ownsTop() && S.right !== 'none' && (isPhone() || S.threadFull)) { nav.after = done; history.back(); } else done();
    }
    function setFull(on) {
      if (isPhone() || S.right !== 'thread' || on === S.threadFull) return;
      if (on) { S.threadFull = true; pushNav(); renderRight(); }
      else if (ownsTop() && history.state.full) history.back();
      else { S.threadFull = false; renderRight(); }
      if (window.FavorChatBrain) setTimeout(function () { window.FavorChatBrain.draw(root); }, 0);
      var ta = $('[data-ta="thread"]', root); if (ta) ta.focus();
    }
    function openDetails(tab) {
      if (S.right === 'details' && !isPhone() && !tab) return closeRight();
      if (S.right === 'thread') { saveDraft('thread'); if (S.threadRoot) delete S.threadNew[S.threadRoot]; }
      S.right = 'details'; S.threadRoot = null; S.threadFull = false; S.tab = tab || 'about'; setView('details');
      if (isPhone()) pushNav();
      renderRight(); renderHead();
    }
    function loadPins(id) {
      if (!api.pins) return Promise.resolve();
      return guard(api.pins(id)).then(function (r) {
        S.pins[id] = { pins: r.pins || [], bookmarks: r.bookmarks || [] };
        var c = chan(id); if (c) { c.pins = S.pins[id].pins.length; c.bookmarks = S.pins[id].bookmarks; }
        if (S.active === id) { renderBar(); if (S.right === 'pins') renderRight(); }
      });
    }
    function openPins() {
      if (S.right === 'pins' && !isPhone()) return closeRight();
      if (S.right === 'thread') { saveDraft('thread'); if (S.threadRoot) delete S.threadNew[S.threadRoot]; }
      S.right = 'pins'; S.threadRoot = null; S.threadFull = false; setView('details');
      if (isPhone()) pushNav();
      renderRight(); renderHead();
      loadPins(S.active);
    }
    function back() {
      if (ownsTop()) return history.back();
      if (S.view === 'thread' || S.view === 'details') return closeRight();
      if (!isPhone()) { if (S.page !== 'channel' && S.active) openChannel(S.active); return; }
      setView('list');
    }

    /* ------------------------------------------------------------------ the thread panel's width, dragged and remembered */
    var RIGHT_KEY = 'favor.chat.rightw';
    function clampRight(w) {
      var total = root.getBoundingClientRect().width || window.innerWidth, side = ($('.ch-side', root) || {}).offsetWidth || 272;
      return Math.round(Math.max(320, Math.min(w, 760, total - side - 380)));
    }
    function applyRightWidth() {
      var w = Number(lsGet(RIGHT_KEY, 0)) || 0;
      if (w && !isPhone()) root.style.setProperty('--ch-right', clampRight(w) + 'px'); else root.style.removeProperty('--ch-right');
    }
    (function () {
      var drag = null;
      root.addEventListener('pointerdown', function (e) {
        var h = e.target.closest && e.target.closest('[data-rz]');
        if (!h || isPhone() || e.button) return;
        e.preventDefault();
        drag = { h: h, w: $('.ch-right', root).getBoundingClientRect().width };
        try { h.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
        root.classList.add('is-resizing');
      });
      root.addEventListener('pointermove', function (e) {
        if (!drag) return;
        drag.w = clampRight(root.getBoundingClientRect().right - e.clientX);
        root.style.setProperty('--ch-right', drag.w + 'px');
      });
      var end = function () {
        if (!drag) return;
        lsSet(RIGHT_KEY, drag.w); drag = null; root.classList.remove('is-resizing');
        if (window.FavorChatBrain) window.FavorChatBrain.draw(root);
      };
      root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
      root.addEventListener('dblclick', function (e) { if (e.target.closest && e.target.closest('[data-rz]')) { lsSet(RIGHT_KEY, 0); applyRightWidth(); } });
      root.addEventListener('keydown', function (e) {
        var h = e.target.closest && e.target.closest('[data-rz]');
        if (!h || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        var w = clampRight($('.ch-right', root).getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 24 : -24));
        lsSet(RIGHT_KEY, w); applyRightWidth();
      });
      window.addEventListener('resize', applyRightWidth);
    })();

    /* ------------------------------------------------------------------ Latest: the way back down after reading further up */
    // Read after the browser has laid the new content out, never in the same task that drew it (a forced layout on a phone).
    var latestSoonQ = 0;
    function syncLatestSoon() { if (latestSoonQ) return; latestSoonQ = requestAnimationFrame(function () { latestSoonQ = 0; syncLatest('main'); syncLatest('thread'); }); }
    function syncLatest(scope) {
      var box = scope === 'thread' ? $('.ch-right .ch-thread__body', root) : $('.ch-msgs', root);
      var b = $('.ch-latest[data-scope="' + scope + '"]', root);
      if (!box || !b) return;
      var far = box.scrollHeight - box.scrollTop - box.clientHeight > 260 && (scope === 'thread' || S.page === 'channel');
      if (!far) S.newBelow[scope] = 0;
      var n = S.newBelow[scope], label = n ? plural(n, 'new message') : 'Latest', sp = b.querySelector('span');
      if (b.hidden === far) b.hidden = !far;
      if (sp.textContent !== label) sp.textContent = label;
      b.classList.toggle('has-new', !!n);
    }
    var latestQ = 0;
    root.addEventListener('scroll', function (e) {
      var t = e.target;
      if (!t || !t.classList || !(t.classList.contains('ch-msgs') || t.classList.contains('ch-thread__body'))) return;
      if (latestQ) return;
      latestQ = requestAnimationFrame(function () { latestQ = 0; syncLatest('main'); syncLatest('thread'); });
    }, true);

    function composerText(scope) { return ($('[data-ta="' + scope + '"]', root) || {}).value || ''; }
    function tokenize(scope, text) {
      var map = S.mentionMap[scope];
      Object.keys(map).sort(function (a, b) { return b.length - a.length; }).forEach(function (label) {
        var re = new RegExp('(^|[^\\w])' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w])', 'g');
        text = text.replace(re, function (_, pre) { return pre + map[label]; });
      });
      return text;
    }
    function syncSend(scope) {
      var b = $('[data-send="' + scope + '"]', root); if (!b) return;
      b.disabled = !(composerText(scope).trim() || S.pending[scope].length);
    }
    function grow(ta) { ta.style.height = '0px'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px'; }
    function renderPending(scope) {
      var el = $('[data-pend="' + scope + '"]', root); if (!el) return;
      var p = S.pending[scope]; el.hidden = !p.length;
      el.innerHTML = p.map(function (a, i) {
        var label = a.type === 'drive' ? a.name : a.type === 'clip' ? a.title : a.type === 'file' ? a.name : a.title || a.type;
        var iconName = a.type === 'drive' ? 'drive' : a.type === 'clip' ? 'rec' : 'file';
        return '<span class="ch-pend__i' + (a.preview ? ' ch-pend__i--pic' : '') + '">' + (a.preview ? '<img src="' + esc(a.preview) + '" alt="" />' : ic(iconName)) + '<span>' + esc(label) + (a.uploading ? ' (uploading)' : '') + '</span><button type="button" data-act="unpend" data-scope="' + scope + '" data-i="' + i + '" aria-label="Remove">' + ic('x') + '</button></span>';
      }).join('');
      syncSend(scope);
    }
    /* The hub's own things from the message box: a line that starts with one of these runs it instead of posting. */
    var SLASH = [
      { cmd: 'brain', args: 'question', sub: 'Ask Favor Brain', icon: 'spark' },
      { cmd: 'request', args: 'summary', sub: 'Make a request board card', icon: 'task' },
      { cmd: 'huddle', args: '', sub: 'Ring this conversation into a huddle, or join the one going', icon: 'headset' },
      { cmd: 'clip', args: '', sub: 'Record a clip and post it here', icon: 'rec' }
    ];
    function runSlash(scope, raw) {
      var m = String(raw || '').match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
      if (!m) return false;
      var cmd = m[1].toLowerCase(), rest = (m[2] || '').trim();
      if (!SLASH.some(function (c) { return c.cmd === cmd; })) return false;
      var ta = $('[data-ta="' + scope + '"]', root);
      var clear = function () { ta.value = ''; grow(ta); syncSend(scope); clearDraft(scope); closePop(); slashState = null; };
      var thread = scope === 'thread' ? S.threadRoot : null;
      if (cmd === 'brain') { if (!rest) { toast('Type a question after /brain'); return true; } clear(); askBrain(rest, { thread: thread }); }
      else if (cmd === 'request') { clear(); requestDialog({ title: rest, thread: thread }); }
      else if (cmd === 'huddle') { clear(); openHuddle(S.active); }
      else if (cmd === 'clip') { clear(); if (opts.recordClip) opts.recordClip(S.active, function (att) { S.pending[scope].push(att); renderPending(scope); }); else toast('Recording is not available here'); }
      return true;
    }
    var slashState = null;
    function updateSlash(ta) {
      var m = ta.value.match(/^\/([a-z]*)$/i);
      if (!m) { if (slashState) { closePop(); slashState = null; } return false; }
      var q = m[1].toLowerCase(), list = SLASH.filter(function (c) { return c.cmd.indexOf(q) === 0; });
      if (!list.length) { if (slashState) { closePop(); slashState = null; } return false; }
      slashState = { scope: ta.dataset.ta, list: list, i: 0 };
      openPop('<div class="ch-pop__h">Commands</div>' + list.map(function (c, i) {
        return '<button type="button" class="ch-pop__i' + (i === 0 ? ' is-on' : '') + '" role="option" data-act="slash-pick" data-i="' + i + '"><b style="background:var(--r-sunk);color:var(--r-ink-2)">' + ic(c.icon) + '</b><span>/' + c.cmd + (c.args ? ' <em>' + c.args + '</em>' : '') + '<small>' + c.sub + '</small></span></button>';
      }).join(''), ta.closest('.ch-comp__box'), 'ch-pop--mention ch-pop--slash');
      popAnchor = ta;
      return true;
    }
    function pickSlash(i) {
      var st = slashState; if (!st) return;
      var c = st.list[i], ta = $('[data-ta="' + st.scope + '"]', root);
      slashState = null; closePop();
      if (!c.args) { ta.value = '/' + c.cmd; send(st.scope); return; }
      ta.value = '/' + c.cmd + ' '; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); grow(ta); syncSend(st.scope);
    }
    // A question for Favor Brain, posted as the person's own message. opts: thread, channel, hidden (the question and its
    // answer are the asker's alone), intent (what a pressed option or name asks for).
    function askBrain(q, o) {
      o = o || {};
      var ch = o.channel && chan(o.channel) ? o.channel : S.active;
      q = String(q || '').trim();
      if (!q || !chan(ch)) return Promise.resolve();
      return guard(api.send(ch, { body: '<@brain> ' + q, thread_id: o.thread || null, private: o.hidden ? true : undefined, intent: o.intent || undefined })).then(function (m) { S.toBottom = true; addMessage(m, true); });
    }
    function send(scope) {
      var c = chan(S.active); if (!c) return;
      var ta = $('[data-ta="' + scope + '"]', root), raw = ta.value;
      if (S.pending[scope].some(function (a) { return a.uploading; })) { toast('Wait for the upload to finish'); return; }
      if (!S.pending[scope].length && runSlash(scope, raw.trim())) return;
      var body = tokenize(scope, raw).trim();
      var att = S.pending[scope].filter(function (a) { return !a.uploading; });
      if (!body && !att.length) return;
      var map = S.mentionMap[scope];
      var thread = scope === 'thread' ? S.threadRoot : null;
      var alsoBox = thread ? $('[data-also]', root) : null, also = !!(alsoBox && alsoBox.checked);
      ta.value = ''; grow(ta); S.pending[scope] = []; S.mentionMap[scope] = {}; renderPending(scope); closePop(); clearTimeout(draftT); clearDraft(scope);
      var payload = { body: body, thread_id: thread, attachments: att, also: also || undefined };
      // Lite mode sends through the phone's outbox: a message written without signal waits there and goes when the signal returns.
      var sending = liteOn() ? guard(window.FavorLite.chatSend(S.active, payload)).then(function (r) {
        if (r.queued) { toast('No signal. Your message is saved and sends when the phone is back online.'); return null; }
        return r.message;
      }) : guard(api.send(S.active, payload));
      sending.then(function (m) {
        if (alsoBox) alsoBox.checked = false;
        if (m) { S.toBottom = true; addMessage(m, true); if (window.hubSound) window.hubSound.play('sent'); }
      }).catch(function () { if (!ta.value) { ta.value = raw; S.mentionMap[scope] = map; grow(ta); syncSend(scope); saveDraft(scope); } });
    }
    function addMessage(m, mine) {
      var ch = chan(m.channel_id); if (!ch) { resync(); return; }
      ch.last_at = m.created_at;
      if (m.thread_id) {
        var par = (S.msgs[m.channel_id] || []).filter(function (x) { return String(x.id) === String(m.thread_id); })[0];
        var isNew = !hasMsg(S.threads[m.thread_id], m.id);
        if (par && !m.visible_to && isNew) { par.reply_count = (par.reply_count || 0) + 1; par.last_reply_at = m.created_at; par.reply_users = (par.reply_users || []).filter(function (u) { return u !== m.user_id; }).concat([m.user_id]).slice(-3); }
        var t = S.threads[m.thread_id];
        if (t && isNew) t.replies.push(m);
        if (S.threadTyping[m.thread_id]) delete S.threadTyping[m.thread_id][m.user_id];
        var open = S.active === m.channel_id && S.right === 'thread' && S.threadRoot === m.thread_id;
        if (open && !mine && isNew) { var tb = $('.ch-right .ch-thread__body', root); if (tb && tb.scrollHeight - tb.scrollTop - tb.clientHeight > 260) S.newBelow.thread += 1; }
        if (S.active === m.channel_id && S.page === 'channel') { renderMsgs(false); if (open) renderRight(); }
        if (open && mine) { var tb2 = $('.ch-right .ch-thread__body', root); if (tb2) tb2.scrollTop = tb2.scrollHeight; }
        // Someone else's reply: read at once when its thread is open and in view, counted on Threads when it is not.
        if (!mine && !m.visible_to) { if (open && !document.hidden) touchThread(m.thread_id); else refreshThreads(); }
        if (!m.visible_to) notifyIfNeeded(m, ch);
        return;
      }
      if (S.typing[m.channel_id] && S.typing[m.channel_id][m.user_id]) { delete S.typing[m.channel_id][m.user_id]; if (S.active === m.channel_id) renderTyping(); }
      var list = S.msgs[m.channel_id];
      if (list) { if (list.some(function (x) { return String(x.id) === String(m.id); })) return; list.push(m); }
      var here = S.active === m.channel_id && S.page === 'channel';
      if (here && !document.hidden) {
        if (!mine && !pinned) S.newBelow.main += 1;
        renderMsgs(mine ? true : false);
        if (!mine) markRead(); else if (!m.visible_to) { ch.last_read = m.id; api.read(m.channel_id, m.id); }
        renderSide();
      }
      else { renderSide(); }
      if (!m.visible_to) notifyIfNeeded(m, ch);
    }
    function hasMsg(t, id) { return !!t && (t.replies || []).some(function (x) { return String(x.id) === String(id); }); }
    function notifyIfNeeded(m, ch) {
      if (m.user_id === S.me.id) return;
      var viewing = S.active === m.channel_id && S.page === 'channel' && !document.hidden && S.keepUnread !== m.channel_id;
      if (!viewing && !m.thread_id) { ch.unread = (ch.unread || 0) + 1; if (mentionsMe(m) || ch.kind === 'dm' || ch.kind === 'group') ch.mentions = (ch.mentions || 0) + 1; renderSide(); if (opts.onUnread) opts.onUnread(totalUnread()); }
      if (!viewing && !ch.muted && (mentionsMe(m) || ch.kind === 'dm' || ch.kind === 'group') && opts.onNotify) opts.onNotify(m, ch);
    }

    /* ------------------------------------------------------------------ popovers and modals */
    function closePop() { if (pop) { pop.remove(); pop = null; popAnchor = null; } }
    function openPop(html, anchor, cls, o) {
      closePop();
      pop = document.createElement('div'); pop.className = 'ch-pop ' + (cls || ''); pop.innerHTML = html; pop.setAttribute('role', 'menu');
      root.appendChild(pop); popAnchor = anchor;
      var rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), pr = pop.getBoundingClientRect();
      var left = Math.min(Math.max(8, ar.left - rr.left), rr.width - pr.width - 8);
      var top = (o && o.below) ? ar.bottom - rr.top + 6 : ar.top - rr.top - pr.height - 8;
      if (top < 8) top = ar.bottom - rr.top + 6;
      if (top + pr.height > rr.height - 8) top = Math.max(8, rr.height - pr.height - 8);
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      return pop;
    }
    function closeModal() { if (modal) { modal.remove(); modal = null; } }
    function openModal(title, bodyHtml, footHtml) {
      closeModal(); closePop();
      modal = document.createElement('div'); modal.className = 'ch-scrim';
      modal.innerHTML = '<div class="ch-dlg" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="ch-dlg__h"><h3>' + esc(title) + '</h3><button type="button" class="ch-iconbtn" data-act="modal-x" aria-label="Close">' + ic('x') + '</button></div><div class="ch-dlg__b">' + bodyHtml + '</div>' + (footHtml ? '<div class="ch-dlg__f">' + footHtml + '</div>' : '') + '</div>';
      root.appendChild(modal);
      var f = $('input,textarea', modal); if (f && !isPhone()) f.focus();
      return modal;
    }

    /* ------------------------------------------------------------------ what can be done with one message */
    function linkTo(m) { return location.origin + '/chat/?c=' + encodeURIComponent(m.channel_id) + (m.thread_id ? '&t=' + m.thread_id : '') + '&m=' + m.id; }
    function msgActions(m) {
      var mine = m.user_id === S.me.id, out = [];
      if (m.visible_to) { if (mine) out.push(['del', 'trash', 'Delete', true]); return out; }
      if (mine && S.editing !== m.id) out.push(['edit', 'edit', 'Edit']);
      if (m.body) out.push(['copy', 'file', 'Copy text']);
      out.push(['copy-link', 'link', 'Copy link']);
      if (S.features.pins) out.push(['pin', 'pin', m.pinned ? 'Unpin' : 'Pin', false, m.pinned ? '0' : '1']);
      out.push(['mark-unread', 'mark', 'Mark unread from here']);
      out.push(['make-request', 'task', 'Create a request from this message']);
      out.push(['sm-turn', 'bell', 'Turn into a task, reminder or action']);
      if (window.FavorIx && window.FavorIx.clipReply) out.push(['clip-reply', 'play', 'Reply with a clip']);
      if (S.lang && !mine && (m.body || (m.attachments || []).some(function (a) { return a.voice; }))) out.push(['sm-orig', 'globe', S.trOrig[m.id] ? 'Show translation' : 'Show original']);
      if (m.body) out.push(['sm-ask', 'spark', 'Ask Favor Brain about this']);
      if (mine) out.push(['del', 'trash', 'Delete', true]);
      return out;
    }
    function moreMenu(mid, anchor) {
      var m = findMsg(mid); if (!m || m.deleted) return;
      openPop(msgActions(m).map(function (a) {
        return '<button type="button" class="ch-pop__i ch-pop__i--line' + (a[3] ? ' is-danger' : '') + '" role="menuitem" data-act="' + a[0] + '" data-id="' + m.id + '"' + (a[4] != null ? ' data-on="' + a[4] + '"' : '') + '>' + ic(a[1]) + '<span>' + a[2] + '</span></button>';
      }).join(''), anchor, 'ch-pop--menu ch-pop--more', { below: true });
      var first = pop && pop.querySelector('button'); if (first) first.focus();
    }
    // The message actions on a phone: quick reactions, then every action as a full-width row.
    function msgSheet(mid) {
      var m = findMsg(mid); if (!m || m.deleted) return;
      if (m.visible_to && m.user_id !== S.me.id) return;
      var row = function (a) { return '<button type="button" class="ch-msheet__row' + (a[3] ? ' is-danger' : '') + '" data-act="' + a[0] + '" data-id="' + m.id + '"' + (a[4] != null ? ' data-on="' + a[4] + '"' : '') + '>' + ic(a[1]) + '<span>' + a[2] + '</span></button>'; };
      var quick = (window.FavorChatEmoji ? window.FavorChatEmoji.quick.map(window.FavorChatEmoji.toned) : EMOJI).slice(0, 11);
      openModal(user(m.user_id).name + ', ' + timeOf(m.created_at),
        '<div class="ch-msheet">' + (m.visible_to ? '' : '<div class="ch-msheet__rx">' + quick.map(function (q) { return '<button type="button" data-act="react" data-id="' + m.id + '" data-e="' + q + '" aria-label="React ' + q + '">' + q + '</button>'; }).join('') +
          '<button type="button" data-act="react-more" data-id="' + m.id + '" aria-label="More emoji">' + ic('smile') + '</button></div>' +
          (m.thread_id ? '' : row(['thread', 'reply', 'Reply in thread']))) + msgActions(m).map(row).join('') + '</div>', '');
    }
    function react(id, em) {
      return guard(api.react(id, em)).then(function (r) { var m = findMsg(id); if (m && r && r.reactions) { m.reactions = r.reactions; patchMessage(m); } });
    }
    function requestDialog(o) {
      o = o || {};
      var from = o.from ? findMsg(o.from) : null;
      var m = openModal('New request',
        (from ? '<div class="ch-quote"><b>' + esc(user(from.user_id).name) + '</b><span>' + esc(excerptOf(from)) + '</span></div>' : '') +
        '<label class="ch-field"><span>Summary</span><input class="ch-input" data-rq-title maxlength="160" placeholder="One line" value="' + esc(o.title || (from ? plain(from.body).replace(/\s+/g, ' ').trim().slice(0, 90) : '')) + '" /></label>' +
        '<label class="ch-field"><span>Details</span><textarea class="ch-input ch-input--area" data-rq-body rows="4" maxlength="8000" placeholder="What is needed, and by when"></textarea></label>' +
        '<label class="ch-field"><span>About</span><select class="ch-input" data-rq-surface><option value="website">Website</option><option value="portal">Portal</option><option value="dashboard">Hub</option><option value="app">App</option></select></label>',
        '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="rq-create">Create request</button>');
      m._rq = { from: from ? from.id : null, thread: o.thread || null, channel: S.active };
    }
    function bookmarkDialog() {
      openModal('Add a bookmark', '<label class="ch-field"><span>Link</span><input class="ch-input" data-bm-url placeholder="https:// or a FavorOS page such as /reports/" maxlength="600" inputmode="url" /></label><label class="ch-field"><span>Name</span><input class="ch-input" data-bm-title placeholder="Shown in the bar" maxlength="60" /></label>',
        '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="bm-save">Add</button>');
    }

    /* ------------------------------------------------------------------ the formatting row and its keys */
    function applyFmt(scope, f) {
      var ta = $('[data-ta="' + scope + '"]', root); if (!ta) return;
      var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value, sel = v.slice(a, b);
      var wrap = function (l, r, ph) {
        // Pressed again on the same words, the marks come off.
        if (v.slice(a - l.length, a) === l && v.slice(b, b + r.length) === r) { ta.value = v.slice(0, a - l.length) + sel + v.slice(b + r.length); ta.setSelectionRange(a - l.length, b - l.length); return; }
        var inner = sel || ph;
        ta.value = v.slice(0, a) + l + inner + r + v.slice(b);
        ta.setSelectionRange(a + l.length, a + l.length + inner.length);
      };
      var lines = function (prefix, test) {
        var s0 = v.lastIndexOf('\n', a - 1) + 1, e0 = v.indexOf('\n', b); if (e0 < 0) e0 = v.length;
        var block = v.slice(s0, e0).split('\n');
        var on = block.every(function (l) { return test.test(l); });
        var out = block.map(function (l, i) { return on ? l.replace(test, '') : (typeof prefix === 'function' ? prefix(i) : prefix) + l.replace(/^(- |\d{1,3}[.)] |> )/, ''); }).join('\n');
        ta.value = v.slice(0, s0) + out + v.slice(e0);
        ta.setSelectionRange(s0 + out.length, s0 + out.length);
      };
      if (f === 'bold') wrap('**', '**', 'bold');
      else if (f === 'italic') wrap('_', '_', 'italic');
      else if (f === 'strike') wrap('~~', '~~', 'text');
      else if (f === 'code') wrap('`', '`', 'code');
      else if (f === 'block') wrap('```\n', '\n```', 'code');
      else if (f === 'link') {
        if (/^https?:\/\/\S+$/.test(sel)) { ta.value = v.slice(0, a) + '[link](' + sel + ')' + v.slice(b); ta.setSelectionRange(a + 1, a + 5); }
        else { var words = sel || 'link'; ta.value = v.slice(0, a) + '[' + words + '](https://)' + v.slice(b); var u = a + words.length + 3; ta.setSelectionRange(u, u + 8); }
      }
      else if (f === 'ul') lines('- ', /^- /);
      else if (f === 'ol') lines(function (i) { return (i + 1) + '. '; }, /^\d{1,3}[.)] /);
      else if (f === 'quote') lines('> ', /^> /);
      ta.focus(); grow(ta); syncSend(scope); saveDraftSoon(scope);
    }
    var FMT_KEYS = { KeyX: 'strike', KeyC: 'code', Digit7: 'ol', Digit8: 'ul', Digit9: 'quote', KeyU: 'link' };
    // A new line inside a list or a quote starts the next item; on an empty item it ends the list instead.
    function continueList(ta) {
      var a = ta.selectionStart, v = ta.value;
      if (a !== ta.selectionEnd) return false;
      var s0 = v.lastIndexOf('\n', a - 1) + 1, line = v.slice(s0, a);
      var m = line.match(/^(- |> |(\d{1,3})([.)]) )(.*)$/);
      if (!m) return false;
      if (!m[4].trim()) { ta.value = v.slice(0, s0) + v.slice(a); ta.setSelectionRange(s0, s0); return true; }
      var next = m[2] ? (Number(m[2]) + 1) + m[3] + ' ' : m[1];
      ta.value = v.slice(0, a) + '\n' + next + v.slice(a);
      ta.setSelectionRange(a + 1 + next.length, a + 1 + next.length);
      return true;
    }

    /* ------------------------------------------------------------------ Ctrl K: jump to a channel or a person */
    var sw = null;
    function openSwitcher() {
      closePop(); closeModal(); closeSearch();
      var box = document.createElement('div'); box.className = 'ch-search ch-sw';
      box.innerHTML = '<div class="ch-search__box" role="dialog" aria-label="Jump to a conversation"><div class="ch-search__in"><button type="button" class="ch-iconbtn ch-back" data-act="search-x" aria-label="Close">' + ic('back') + '</button>' + ic('search') + '<input data-swq placeholder="Jump to a channel or a person" aria-label="Jump to a channel or a person" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="ch-sw-list" /><button type="button" class="ch-iconbtn" data-act="search-x" aria-label="Close">' + ic('x') + '</button></div>' +
        '<div class="ch-search__res" id="ch-sw-list" data-swres role="listbox"></div><div class="ch-search__foot"><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
      root.appendChild(box);
      sw = { items: [], i: 0, all: null };
      var q = $('[data-swq]', box), res = $('[data-swres]', box);
      var draw = function () {
        var v = q.value.trim().toLowerCase(), s = sortedChannels(), items = [];
        var hit = function (name) { return !v || name.toLowerCase().indexOf(v) >= 0; };
        var mineCh = s.chans.concat(s.dms).filter(function (c) { return hit(chName(c)); });
        // With nothing typed: what is unread first, then the most recent. With a word typed: names that start with it first.
        mineCh.sort(function (a, b) {
          if (v) { var x = chName(a).toLowerCase().indexOf(v) === 0 ? 0 : 1, y = chName(b).toLowerCase().indexOf(v) === 0 ? 0 : 1; if (x !== y) return x - y; }
          return ((b.unread > 0) - (a.unread > 0)) || String(b.last_at || '').localeCompare(String(a.last_at || ''));
        });
        mineCh.slice(0, v ? 8 : 10).forEach(function (c) { items.push({ t: 'ch', c: c }); });
        if (v) {
          var inDm = {}; s.dms.forEach(function (c) { if (c.kind === 'dm') (c.members || []).forEach(function (m) { inDm[m] = 1; }); });
          Object.keys(S.users).filter(function (id) { return id !== S.me.id && !inDm[id] && hit(S.users[id].name); }).slice(0, 6).forEach(function (id) { items.push({ t: 'user', u: S.users[id] }); });
          (sw.all || []).filter(function (c) { return !(chan(c.id) && chan(c.id).joined !== false) && hit(c.name); }).slice(0, 4).forEach(function (c) { items.push({ t: 'join', c: c }); });
          if (v.length >= 2) items.push({ t: 'search', q: q.value.trim() });
        }
        sw.items = items; sw.i = Math.min(sw.i, Math.max(0, items.length - 1));
        res.innerHTML = items.length ? items.map(function (it, i) {
          var on = i === sw.i ? ' is-on' : '', at = ' role="option" data-act="sw-pick" data-i="' + i + '"';
          if (it.t === 'ch') {
            var c = it.c, icon;
            if (c.kind === 'public') icon = '<span class="ch-row__ic">#</span>'; else if (c.kind === 'private') icon = '<span class="ch-row__ic">' + ic('lock') + '</span>';
            else if (c.kind === 'dm') { var o = (c.members || []).filter(function (m) { return m !== S.me.id; })[0] || S.me.id; icon = avatar(user(o), 'sm', true); } else icon = '<span class="ch-row__ic">' + ic('users') + '</span>';
            return '<button type="button" class="ch-sw__i' + on + (c.unread > 0 ? ' is-unread' : '') + '"' + at + '>' + icon + '<span class="ch-sw__n">' + esc(chName(c)) + '</span>' + (c.mentions > 0 ? '<span class="ch-badge">' + c.mentions + '</span>' : '') + (hasDraft(c.id) ? '<span class="ch-sw__m">Draft</span>' : '') + '</button>';
          }
          if (it.t === 'user') return '<button type="button" class="ch-sw__i' + on + '"' + at + '>' + avatar(it.u, 'sm', true) + '<span class="ch-sw__n">' + esc(it.u.name) + '</span><span class="ch-sw__m">' + esc(it.u.title || 'New message') + '</span></button>';
          if (it.t === 'join') return '<button type="button" class="ch-sw__i' + on + '"' + at + '><span class="ch-row__ic">#</span><span class="ch-sw__n">' + esc(it.c.name) + '</span><span class="ch-sw__m">Join</span></button>';
          return '<button type="button" class="ch-sw__i ch-sw__i--search' + on + '"' + at + '><span class="ch-row__ic">' + ic('search') + '</span><span class="ch-sw__n">Search messages for “' + esc(it.q) + '”</span></button>';
        }).join('') : '<div class="ch-empty">No channel or person matches</div>';
      };
      q.addEventListener('input', function () { sw.i = 0; draw(); });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sw.i = Math.max(0, Math.min(sw.items.length - 1, sw.i + (e.key === 'ArrowDown' ? 1 : -1))); draw(); var cur = res.children[sw.i]; if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter' && sw.items[sw.i]) { e.preventDefault(); pickSwitch(sw.i); }
      });
      box.addEventListener('click', function (e) { if (e.target === box) closeSearch(); });
      draw();
      // Focus inside the tap itself: iOS raises the keyboard only then.
      q.focus();
      // Public channels the person has not joined can be found here too.
      if (api.browse) Promise.resolve(api.browse()).then(function (r) { if (sw) { sw.all = r.channels || []; draw(); } }).catch(function () {});
    }
    function pickSwitch(i) {
      var it = sw && sw.items[i]; if (!it) return;
      if (it.t === 'search') { openSearch(it.q); return; }
      closeSearch();
      if (it.t === 'ch') openChannel(it.c.id);
      else if (it.t === 'user') guard(api.openDm([it.u.id])).then(function (c) { S.channels[c.id] = Object.assign(S.channels[c.id] || {}, c, { joined: true }); openChannel(c.id); });
      else if (it.t === 'join') guard(api.join(it.c.id)).then(function (c) { S.channels[c.id] = Object.assign(S.channels[c.id] || {}, c, { joined: true }); openChannel(c.id); });
    }

    function plusMenu(scope, anchor) {
      var it = function (act, icon, tint, ink, t, sub) { return '<button type="button" class="ch-pop__i" role="menuitem" data-act="' + act + '" data-scope="' + scope + '"><b style="background:' + tint + ';color:' + ink + '">' + ic(icon) + '</b><span>' + t + '<small>' + sub + '</small></span></button>'; };
      openPop(it('upload', 'clip', 'var(--tc-slate-tint)', 'var(--tc-slate-ink)', 'Upload a file', 'From your files') +
        it('drive-pick', 'drive', 'var(--tc-sky-tint)', 'var(--tc-sky-ink)', 'Share from Drive', 'Search the Drive library') +
        it('clip-pick', 'rec', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Share a clip', 'Pick from your clips') +
        it('clip-rec', 'play', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Record a clip', 'Posts here when you finish') +
        it('meeting', 'video', 'var(--tc-teal-tint)', 'var(--tc-teal-ink)', 'Huddle', 'Rings a direct message, or starts one here') +
        (window.FavorIx ? it('find-time', 'video', 'var(--tc-sky-tint)', 'var(--tc-sky-ink)', 'Find a time', 'Book a meeting with everyone here') : '') +
        it('request-new', 'task', 'var(--tc-leaf-tint)', 'var(--tc-leaf-ink)', 'Make a request', 'Adds a card to the request board'), anchor, 'ch-pop--menu');
    }
    // Search, groups and a skin tone that is remembered (chat-emoji.js). A phone gets it as a sheet from the bottom.
    function emojiPicker(anchor, cb) {
      var E = window.FavorChatEmoji;
      if (!E) {
        var p0 = openPop(EMOJI.map(function (e) { return '<button type="button" data-e="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join(''), anchor, 'ch-pop--emoji');
        p0.addEventListener('click', function (ev) { var b = ev.target.closest('button[data-e]'); if (b) { cb(b.dataset.e); closePop(); } });
        return;
      }
      if (isPhone()) { var m = openModal('Emoji', E.html(), ''); m.classList.add('ch-scrim--emo'); E.bind($('.ch-emo', m), function (e) { closeModal(); cb(e); }, { noFocus: true }); return; }
      var p = openPop(E.html(), anchor, 'ch-pop--emo');
      E.bind($('.ch-emo', p), function (e, ev) { cb(e); if (!(ev && ev.shiftKey)) closePop(); });
    }
    function mentionCandidates(q, c) {
      q = q.toLowerCase();
      var ids = (c.kind === 'public' ? Object.keys(S.users) : (c.members || [])).filter(function (id) { return id !== S.me.id; });
      var out = [{ id: 'brain', name: 'Favor Brain', sub: 'Ask a question about Favor records', brain: true }];
      if (c.kind === 'public' || c.kind === 'private' || c.kind === 'group') out.push({ id: 'channel', name: 'channel', sub: 'Notify everyone here', special: true });
      if ((c.kind === 'public' || c.kind === 'private' || c.kind === 'group') && S.me && S.me.admin) out.push({ id: 'here', name: 'here', sub: 'Urgent: everyone, even in quiet hours', special: true });
      ids.forEach(function (id) { var u = user(id); out.push({ id: id, name: u.name, sub: u.title || '', u: u }); });
      var people = out.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 7);
      return people.concat((window.FavorChatSmart && window.FavorChatSmart.hits(q)) || []);
    }
    var mentionState = null;
    function updateMention(ta) {
      var scope = ta.dataset.ta, pos = ta.selectionStart, before = ta.value.slice(0, pos);
      var m = before.match(/(^|\s)([@~])([\w .'-]{0,24})$/);
      if (!m) { if (mentionState) { closePop(); mentionState = null; } return; }
      var onlyEnt = m[2] === '~';
      m = [m[0], m[1], m[3]];
      var c = chan(S.active), cands = onlyEnt ? ((window.FavorChatSmart && window.FavorChatSmart.hits(m[2])) || []) : mentionCandidates(m[2], c);
      // Partners and funds arrive a moment after the typing; the list opens (or fills in) when they do.
      if (window.FavorChatSmart && m[2].length >= 3) window.FavorChatSmart.find(m[2], function () { if (document.activeElement === ta && ta.value.slice(0, ta.selectionStart).match(/(^|\s)[@~][\w .'-]{0,24}$/)) updateMention(ta); });
      if (!cands.length) { closePop(); mentionState = null; return; }
      mentionState = { scope: scope, start: pos - m[2].length - 1, end: pos, cands: cands, i: 0 };
      var p = openPop('<div class="ch-pop__h">People</div>' + cands.map(function (o, i) { return '<button type="button" class="ch-pop__i' + (i === 0 ? ' is-on' : '') + '" role="option" data-act="mention-pick" data-i="' + i + '"><b style="background:transparent">' + (o.ent ? '<span class="ch-av ch-av--sm" data-c="' + (o.kind === 'f' ? 'leaf' : 'sky') + '">' + (o.kind === 'f' ? 'F' : 'P') + '</span>' : o.brain ? '<span class="ch-av ch-av--sm ch-av--brain">' + ring('still') + '</span>' : o.special ? '<span class="ch-av ch-av--sm" data-c="sun">@</span>' : avatar(o.u, 'sm')) + '</b><span>' + esc(o.name) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span></button>'; }).join(''), ta.closest('.ch-comp__box'), 'ch-pop--mention');
      popAnchor = ta;
    }
    function pickMention(i) {
      var st = mentionState; if (!st) return;
      var o = st.cands[i], ta = $('[data-ta="' + st.scope + '"]', root);
      var label = (o.ent ? '' : '@') + o.name;
      S.mentionMap[st.scope][label] = o.ent ? '<~' + o.kind + ':' + o.id + '|' + String(o.name).replace(/[<>|\n]+/g, ' ').trim() + '>' : '<@' + o.id + '>';
      ta.value = ta.value.slice(0, st.start) + label + ' ' + ta.value.slice(st.end);
      var p = st.start + label.length + 1; ta.setSelectionRange(p, p); ta.focus();
      mentionState = null; closePop(); grow(ta); syncSend(st.scope);
    }
    function insertAtCaret(scope, text) {
      var ta = $('[data-ta="' + scope + '"]', root), s = ta.selectionStart || ta.value.length;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(ta.selectionEnd || s); ta.focus(); ta.setSelectionRange(s + text.length, s + text.length); grow(ta); syncSend(scope);
    }

    function driveModal(scope) {
      var m = openModal('Share from Drive', '<input class="ch-input" data-drive-q placeholder="Search the Drive library" aria-label="Search the Drive library" /><div class="ch-pick" data-drive-res><div class="ch-empty">Type to search</div></div>', '');
      var t = 0, q = $('[data-drive-q]', m), res = $('[data-drive-res]', m);
      var run = function () {
        var v = q.value.trim(); if (v.length < 2) { res.innerHTML = '<div class="ch-empty">Type to search</div>'; return; }
        res.innerHTML = '<div class="ch-skel"><i style="width:70%"></i><i style="width:50%"></i></div>';
        guard(api.driveSearch(v)).then(function (r) {
          if (q.value.trim() !== v) return;
          m._items = r.files || [];
          res.innerHTML = m._items.length ? m._items.map(function (f, i) {
            var lab = { doc: 'DOC', sheet: 'XLS', pdf: 'PDF', slides: 'PPT', photo: 'IMG', file: 'FILE' }[f.kind] || 'FILE';
            return '<button type="button" class="ch-pick__i" data-act="drive-choose" data-i="' + i + '"><span class="ch-file__ic" data-k="' + esc(f.kind || 'file') + '" style="width:36px;height:36px;font-size:13px">' + lab + '</span><span><b>' + esc(f.name) + '</b><small>' + esc(f.path || '') + (f.indexed ? ' · Indexed ' + esc(f.indexed) : '') + '</small></span></button>';
          }).join('') : '<div class="ch-empty">No files match</div>';
        });
      };
      q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(run, 220); });
      m._scope = scope;
    }
    function clipModal(scope) {
      var m = openModal('Share a clip', '<div class="ch-pick" data-clip-res><div class="ch-skel"><i style="width:70%"></i><i style="width:50%"></i></div></div>', '');
      m._scope = scope;
      guard(api.clips()).then(function (r) {
        m._items = r.clips || [];
        $('[data-clip-res]', m).innerHTML = m._items.length ? m._items.map(function (c, i) { return '<button type="button" class="ch-pick__i" data-act="clip-choose" data-i="' + i + '"><span class="ch-file__ic" data-k="pdf" style="width:36px;height:36px">' + ic('play') + '</span><span><b>' + esc(c.title) + '</b><small>' + esc(c.duration || '') + (c.when ? ' · ' + esc(c.when) : '') + '</small></span></button>'; }).join('') : '<div class="ch-empty">No clips yet. Record one from the camera button.</div>';
      });
    }
    function personPicker(title, multi, exclude, cb) {
      var m = openModal(title, '<input class="ch-input" data-pp-q placeholder="Search people" aria-label="Search people" /><div class="ch-chosen" data-pp-chosen></div><div class="ch-pick" data-pp-res></div>', '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button>' + (multi ? '<button type="button" class="ch-btn ch-btn--primary" data-act="pp-done" disabled>Done</button>' : ''));
      var chosen = [], q = $('[data-pp-q]', m), res = $('[data-pp-res]', m), done = $('[data-act="pp-done"]', m), ch = $('[data-pp-chosen]', m);
      var draw = function () {
        var v = q.value.toLowerCase();
        var list = Object.keys(S.users).filter(function (id) { return id !== S.me.id && (exclude || []).indexOf(id) < 0 && S.users[id].name.toLowerCase().indexOf(v) >= 0; }).sort(function (a, b) { return S.users[a].name.localeCompare(S.users[b].name); });
        res.innerHTML = list.map(function (id) { var u = S.users[id]; return '<button type="button" class="ch-pick__i' + (chosen.indexOf(id) >= 0 ? ' is-on' : '') + '" data-pp="' + esc(id) + '">' + avatar(u, '', true) + '<span><b>' + esc(u.name) + '</b><small>' + esc(u.title || '') + '</small></span>' + (chosen.indexOf(id) >= 0 ? ic('check') : '') + '</button>'; }).join('') || '<div class="ch-empty">No one matches</div>';
        ch.innerHTML = chosen.map(function (id) { return '<button type="button" data-pp-rm="' + esc(id) + '">' + esc(user(id).name) + ic('x') + '</button>'; }).join('');
        if (done) done.disabled = !chosen.length;
      };
      q.addEventListener('input', draw);
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pp]'), r = e.target.closest('[data-pp-rm]');
        if (b) { var id = b.dataset.pp; if (!multi) { closeModal(); cb([id]); return; } var i = chosen.indexOf(id); if (i >= 0) chosen.splice(i, 1); else chosen.push(id); draw(); }
        if (r) { chosen.splice(chosen.indexOf(r.dataset.ppRm), 1); draw(); }
        if (e.target.closest('[data-act="pp-done"]')) { closeModal(); cb(chosen); }
      });
      draw();
    }
    function newChannelModal() {
      var m = openModal('New channel', '<label class="ch-field"><span>Name</span><input class="ch-input" data-nc-name placeholder="grants-team" maxlength="40" /></label><label class="ch-field"><span>Topic</span><input class="ch-input" data-nc-topic placeholder="What it is for" maxlength="200" /></label><label class="ch-switch"><input type="checkbox" data-nc-priv /> Make it private</label>', '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="nc-create">Create channel</button>');
    }
    function browseModal() {
      var m = openModal('Browse channels', '<div class="ch-pick" data-br><div class="ch-skel"><i style="width:60%"></i><i style="width:80%"></i></div></div>', '');
      guard(api.browse()).then(function (r) {
        m._items = r.channels || [];
        $('[data-br]', m).innerHTML = m._items.length ? m._items.map(function (c, i) { return '<button type="button" class="ch-pick__i" data-act="browse-open" data-i="' + i + '"><span class="ch-row__ic" style="font-size:20px">#</span><span><b>' + esc(c.name) + '</b>' + (c.topic ? '<small>' + esc(c.topic) + '</small>' : '') + '<small>' + plural(c.member_count || 0, 'member') + '</small></span>' + (chan(c.id) && chan(c.id).joined !== false ? '<span class="ch-badge">Joined</span>' : '<span class="ch-btn ch-btn--sm">Join</span>') + '</button>'; }).join('') : '<div class="ch-empty">No other channels</div>';
      });
    }

    /* ------------------------------------------------------------------ search */
    function openSearch(q0) {
      closePop(); closeModal();
      var box = $('.ch-search', root); if (box) box.remove();
      sw = null;
      box = document.createElement('div'); box.className = 'ch-search';
      box.innerHTML = '<div class="ch-search__box" role="dialog" aria-label="Search messages"><div class="ch-search__in"><button type="button" class="ch-iconbtn ch-back" data-act="search-x" aria-label="Close search">' + ic('back') + '</button>' + ic('search') + '<input data-sq placeholder="Search messages and files" aria-label="Search messages" autocomplete="off" /><button type="button" class="ch-iconbtn" data-act="search-x" aria-label="Close search">' + ic('x') + '</button></div>' +
        '<div class="ch-search__f"><button type="button" class="is-on" data-sf="all">Everywhere</button><button type="button" data-sf="here">In this conversation</button><button type="button" data-sf="files">With files</button><button type="button" data-sf="mine">Mentions of me</button><button type="button" data-sfrom>From anyone</button></div>' +
        '<div class="ch-search__res" data-sres><div class="ch-empty">Search every conversation you are in</div></div><div class="ch-search__foot"><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
      root.appendChild(box);
      S.search = { filter: 'all', items: [], i: 0, from: '' };
      var q = $('[data-sq]', box); q.focus();
      var t = 0;
      var run = function () {
        var v = q.value.trim(), res = $('[data-sres]', box);
        if (v.length < 2) { res.innerHTML = '<div class="ch-empty">Search every conversation you are in</div>'; S.search.items = []; return; }
        guard(api.search(v, { filter: S.search.filter, channel: S.active, from: S.search.from })).then(function (r) {
          if (q.value.trim() !== v || !S.search) return;
          S.search.items = r.results || []; S.search.i = 0;
          var rx = new RegExp('(' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
          res.innerHTML = S.search.items.length ? S.search.items.map(function (h, i) {
            var cname = chan(h.channel_id) ? chName(chan(h.channel_id)) : h.channel_name || '';
            var kind = chan(h.channel_id) ? chan(h.channel_id).kind : 'public';
            var files = (h.attachments || []).map(function (a) { return a.name || a.title || ''; }).filter(Boolean);
            var plain = String(h.body || '').replace(/<@([^>]+)>/g, function (_, id) { return '@' + (id === 'brain' ? 'Favor Brain' : user(id).name); }).replace(/<#[^>]+>/g, '');
            var hitText = plain.trim() ? esc(plain).replace(rx, '<mark>$1</mark>') : esc((h.attachments || []).some(function (a) { return /^image\//.test(a.mime || ''); }) ? 'Shared an image' + (files[0] ? ': ' : '') : 'Shared a file' + (files[0] ? ': ' : '')) + esc(files.join(', ')).replace(rx, '<mark>$1</mark>');
            return '<button type="button" class="ch-hit' + (i === 0 ? ' is-on' : '') + '" data-act="hit" data-i="' + i + '">' + avatar(user(h.user_id)) + '<span><span class="ch-hit__m"><b>' + esc(user(h.user_id).name) + '</b><span>' + (kind === 'public' ? '#' : '') + esc(cname) + ' · ' + esc(fmtShort.format(new Date(h.created_at))) + ', ' + esc(timeOf(h.created_at)) + '</span></span><span class="ch-hit__t">' + hitText + '</span></span></button>';
          }).join('') : '<div class="ch-empty">Nothing found for “' + esc(v) + '”</div>';
        });
      };
      q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(run, 200); });
      box.addEventListener('click', function (e) {
        var f = e.target.closest('[data-sf]');
        if (f) { S.search.filter = f.dataset.sf; box.querySelectorAll('[data-sf]').forEach(function (b) { b.classList.toggle('is-on', b === f); }); run(); }
        var fr = e.target.closest('[data-sfrom]');
        if (fr) {
          // From: a short list of people under the button; the first row clears it.
          var ids = Object.keys(S.users).sort(function (a, b) { return S.users[a].name.localeCompare(S.users[b].name); });
          var p = openPop('<button type="button" class="ch-pop__i" data-from="">' + '<span>Anyone</span></button>' + ids.map(function (id) { return '<button type="button" class="ch-pop__i" data-from="' + esc(id) + '"><b style="background:transparent">' + avatar(S.users[id], 'sm') + '</b><span>' + esc(S.users[id].name) + (id === S.me.id ? ' (you)' : '') + '</span></button>'; }).join(''), fr, 'ch-pop--mention ch-pop--from', { below: true });
          p.addEventListener('click', function (ev) { var b = ev.target.closest('[data-from]'); if (!b) return; S.search.from = b.dataset.from; fr.textContent = b.dataset.from ? 'From ' + user(b.dataset.from).name.split(' ')[0] : 'From anyone'; fr.classList.toggle('is-on', !!b.dataset.from); closePop(); run(); });
        }
        if (e.target === box) closeSearch();
      });
      if (q0) { q.value = q0; run(); }
      q.addEventListener('keydown', function (e) {
        var hits = box.querySelectorAll('.ch-hit');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.search.i = Math.max(0, Math.min(hits.length - 1, S.search.i + (e.key === 'ArrowDown' ? 1 : -1))); hits.forEach(function (h, i) { h.classList.toggle('is-on', i === S.search.i); }); if (hits[S.search.i]) hits[S.search.i].scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter' && S.search.items[S.search.i]) { e.preventDefault(); jumpTo(S.search.items[S.search.i]); }
      });
    }
    function closeSearch() { var b = $('.ch-search', root); if (b) b.remove(); S.search = null; sw = null; closePop(); }
    function jumpTo(h) {
      closeSearch();
      var go = function () {
        var list = S.msgs[h.channel_id] || [];
        if (h.thread_id) { openThread(h.thread_id); focusMessage(h.id, true); }
        else {
          var el = root.querySelector('.ch-msgs [data-mid="' + h.id + '"]');
          if (el) { el.scrollIntoView({ block: 'center' }); el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash'); }
          else if (list.length) toast('That message is further back');
        }
      };
      if (S.active !== h.channel_id || S.page !== 'channel') { openChannel(h.channel_id); var w = setInterval(function () { if (S.msgs[h.channel_id]) { clearInterval(w); go(); } }, 60); setTimeout(function () { clearInterval(w); }, 4000); }
      else go();
    }

    /* ------------------------------------------------------------------ huddles
       S.huddle[channel] is the channel's live huddle ({ id, title, startedAt, people, live }) or null. It comes from
       GET channels/:id/huddle when a channel opens, from 'huddle' events when someone joins or leaves, and from a check every
       5 seconds while a huddle shows, which is what notices a person whose tab closed or phone locked without Leave. */
    function huddleGet(id) {
      if (api.huddle) return Promise.resolve(api.huddle(id));
      return fetch('/api/chat/channels/' + encodeURIComponent(id) + '/huddle', { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
        .then(function (r) { return r.json(); }).then(function (d) { if (!d || d.ok === false) throw new Error((d && d.message) || 'Huddle check failed'); return d.huddle || null; });
    }
    // The live state for a meeting card in the open channel: the huddle, null when it is over, undefined when the page does not know.
    function huddleFor(mid) {
      if (!S.huddle || !S.active || !Object.prototype.hasOwnProperty.call(S.huddle, S.active)) return undefined;
      var h = S.huddle[S.active];
      if (h && h.id === mid) return h;
      return null;
    }
    function loadHuddle(id) {
      return huddleGet(id).then(function (h) { setHuddle(id, h); }).catch(function () { /* the bar keeps its last state */ });
    }
    function setHuddle(id, h) {
      S.huddle = S.huddle || {}; S.huddleEnded = S.huddleEnded || {};
      var prev = S.huddle[id];
      if (prev && (!h || h.id !== prev.id)) S.huddleEnded[prev.id] = true;
      S.huddle[id] = h && h.live !== false ? h : null;
      S.huddleKnown = true;
      if (id !== S.active) return;
      var sig = id + JSON.stringify(S.huddle[id]);
      if (sig === S.hudSig) return;
      S.hudSig = sig;
      renderHead(); renderHud();
      if (S.msgs[id]) renderMsgs(false);
    }
    function renderHud() {
      var head = $('.ch-head', root); if (!head) return;
      var bar = $('.ch-hud', root);
      if (!bar) { bar = document.createElement('div'); bar.className = 'ch-hud'; bar.hidden = true; head.insertAdjacentElement('afterend', bar); }
      var h = S.huddle && S.active ? S.huddle[S.active] : null;
      if (!h) { bar.hidden = true; setHtml(bar, ''); return; }
      var ppl = h.people || [];
      bar.hidden = false;
      setHtml(bar, '<span class="ch-hud__dot" aria-hidden="true"></span><span class="ch-stack">' + ppl.slice(0, 4).map(function (p) { return avatar(user(p.email), 'sm'); }).join('') + '</span>' +
        '<span class="ch-hud__t"><b>Huddle</b><span><span data-hud-dur>' + (h.startedAt > 1e11 ? hudDur(h.startedAt) : 'Starting') + '</span>' + (ppl.length ? ' · ' + esc(ppl.length === 1 ? user(ppl[0].email).name.split(' ')[0] : plural(ppl.length, 'person', 'people')) : '') + '</span></span>' +
        '<button type="button" class="ch-hud__join" data-act="huddle">Join</button>');
    }
    function hudDur(t) { var s = Math.max(0, Math.floor((Date.now() - t) / 1000)), m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); }
    // Huddle (meetings pass 2026-10-14): in a direct message or a group it rings the others, like a call in Slack. Joining a huddle
    // already going, or a channel's huddle, goes straight into the room with the microphone on and the camera off. The pre-join
    // sheet is gone: the room itself has the camera, microphone and speaker settings.
    function openHuddle(channelId) {
      var c = chan(channelId); if (!c) return;
      var live = S.huddle && S.huddle[channelId];
      if ((c.kind === 'dm' || c.kind === 'group') && !live && window.FavorRing) { window.FavorRing.call({ channel: channelId }); return; }
      guard(api.startMeeting(channelId)).then(function (r) {
        if (!r || !r.url) return;
        var mid = r.id || (r.message && r.message.attachments && r.message.attachments[0] && r.message.attachments[0].id);
        try { sessionStorage.setItem('meet.prejoin', JSON.stringify({ mid: mid, at: Date.now(), mic: true, cam: false })); } catch (e) { /* the room shows its lobby */ }
        location.href = r.url + '&pj=1&back=' + encodeURIComponent(location.pathname + location.search);
      });
    }
    setInterval(function () {
      if (document.hidden || !S.active || !S.huddle || !S.huddle[S.active]) return;
      var d = $('[data-hud-dur]', root), h = S.huddle[S.active];
      if (d && h.startedAt > 1e11) d.textContent = hudDur(h.startedAt);
    }, 1000);
    setInterval(function () {
      if (document.hidden || !S.active || !S.huddle || !S.huddle[S.active]) return;
      loadHuddle(S.active);
    }, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && S.active && S.me) loadHuddle(S.active); });

    /* ------------------------------------------------------------------ events from the server */
    function onEvent(ev) {
      if (ev.type === 'message') addMessage(ev.message, ev.message.user_id === S.me.id);
      else if (ev.type === 'edit') patchMessage(ev.message);
      else if (ev.type === 'delete' && ev.purge) { purgeMessage(ev.id); }
      else if (ev.type === 'delete') { patchMessage(Object.assign({}, findMsg(ev.id) || { id: ev.id }, { deleted: true, body: '', attachments: [] })); }
      else if (ev.type === 'reaction') { var m = findMsg(ev.id); if (m) { m.reactions = ev.reactions; patchMessage(m); } }
      else if (ev.type === 'typing') {
        // Typing in a thread shows in that thread, not in the channel above it.
        if (ev.thread_id) (S.threadTyping[ev.thread_id] = S.threadTyping[ev.thread_id] || {})[ev.user_id] = Date.now();
        else (S.typing[ev.channel_id] = S.typing[ev.channel_id] || {})[ev.user_id] = Date.now();
        if (S.active === ev.channel_id) typingTick();
      }
      else if (ev.type === 'pin') {
        var pm = findMsg(ev.id), pc = chan(ev.channel_id);
        if (pm) pm.pinned = !!ev.on;
        if (pc) pc.pins = ev.pins;
        if (S.active === ev.channel_id) { renderBar(); renderMsgs(false); if (S.right === 'pins') loadPins(ev.channel_id); else if (S.right === 'thread') renderRight(); }
        delete S.pins[ev.channel_id];
      }
      else if (ev.type === 'bar') {
        var bc0 = chan(ev.channel_id);
        if (bc0) bc0.bookmarks = ev.bookmarks || [];
        if (S.pins[ev.channel_id]) S.pins[ev.channel_id].bookmarks = ev.bookmarks || [];
        if (S.active === ev.channel_id) { renderBar(); if (S.right === 'pins') renderRight(); }
      }
      else if (ev.type === 'presence') { if (S.users[ev.user_id]) { S.users[ev.user_id].presence = ev.presence; renderSide(); if (S.right === 'details') renderRight(); } }
      else if (ev.type === 'channel') { var prev = S.channels[ev.channel.id]; S.channels[ev.channel.id] = Object.assign(prev || {}, ev.channel); renderSide(); if (S.active === ev.channel.id) { renderHead(); if (S.right === 'details') renderRight(); } }
      else if (ev.type === 'users') { Object.assign(S.users, ev.users); renderSide(); }
      else if (ev.type === 'conn') { setConn(ev.ok); }
      else if (ev.type === 'resync') { resync(); }
      else if (ev.type === 'huddle') setHuddle(ev.channel_id, ev.huddle);
    }
    function resync() {
      if (S.resyncing) return;
      S.resyncing = true;
      api.boot().then(function (b) {
        S.users = Object.assign(S.users, b.users || {});
        (b.channels || []).forEach(function (c) { var prev = S.channels[c.id]; var keep = prev && c.id === S.active && S.page === 'channel' && S.keepUnread !== c.id ? { unread: 0, mentions: 0 } : {}; S.channels[c.id] = Object.assign(prev || {}, c, keep); });
        S.features = b.features || S.features; if (b.threads_unread != null) S.threadsUnread = b.threads_unread;
        renderSide(); renderHead(); renderBar();
        var id = S.active;
        if (id) api.history(id).then(function (r) { if (S.active !== id) return; S.msgs[id] = r.messages; S.hasMore[id] = !!r.more; if (S.page === 'channel') { renderMsgs(false); markRead(); } });
        if (id) loadHuddle(id);
        if (S.page !== 'channel') loadPage(S.page);
        var tr = S.threadRoot;
        if (S.right === 'thread' && tr) api.thread(tr).then(function (t) { t.loaded = true; if (S.threadRoot !== tr) return; S.threads[tr] = t; threadRead(tr, t.threads_unread); renderRight(); });
        if (opts.onUnread) opts.onUnread(totalUnread());
      }).catch(function () {}).then(function () { S.resyncing = false; });
    }
    // A Favor Brain answer arrives as one live update. A phone that dropped its connection for a moment misses it and the message
    // would read "Reading the records" for good, so while one is still thinking the page re-reads the channel every few seconds.
    setInterval(function () {
      if (document.hidden || S.resyncing) return;
      var lists = [S.msgs[S.active] || []];
      if (S.page !== 'channel') return;
      if (S.right === 'thread' && S.threadRoot && S.threads[S.threadRoot]) lists.push(S.threads[S.threadRoot].replies || S.threads[S.threadRoot].messages || []);
      var now = Date.now();
      var waiting = lists.some(function (l) { return l.some(function (m) { return m && m.brain && m.brain.status === 'thinking' && now - Date.parse(m.created_at || 0) > 4000 && now - Date.parse(m.created_at || 0) < 600000; }); });
      if (waiting) resync();
    }, 4000);
    // The hub menu opened from the phone list sits over the chat: a tap outside it closes it and goes no further.
    document.addEventListener('click', function (e) {
      var shell = document.querySelector('.h-app');
      if (!isPhone() || !shell || !shell.classList.contains('is-nav')) return;
      if (e.target.closest('.h-side') || e.target.closest('[data-act="hub-menu"]')) return;
      e.preventDefault(); e.stopPropagation();
      shell.classList.remove('is-nav');
      ['h-bar-more', 'h-menu'].forEach(function (id) { var b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', 'false'); });
    }, true);
    // A socket that drops and comes back within a few seconds (a phone waking up) shows nothing; a longer gap shows the line.
    var connT = 0;
    function setConn(ok) {
      S.connected = ok; clearTimeout(connT);
      var el = $('.ch-conn', root);
      if (ok) { if (el) el.remove(); return; }
      connT = setTimeout(function () {
        if (S.connected || $('.ch-conn', root)) return;
        var d = document.createElement('div'); d.className = 'ch-conn'; d.setAttribute('role', 'status'); d.textContent = navigator.onLine === false ? 'Offline' : 'Reconnecting'; root.appendChild(d);
      }, 3000);
    }
    function findMsg(id) {
      var hit = null;
      Object.keys(S.msgs).forEach(function (k) { (S.msgs[k] || []).forEach(function (m) { if (String(m.id) === String(id)) hit = m; }); });
      if (!hit) Object.keys(S.threads).forEach(function (k) { var t = S.threads[k]; if (String(t.root.id) === String(id)) hit = t.root; (t.replies || []).forEach(function (m) { if (String(m.id) === String(id)) hit = m; }); });
      return hit;
    }
    function purgeMessage(id) {
      var gone = false;
      var drop = function (arr) { for (var i = arr.length - 1; i >= 0; i--) if (String(arr[i].id) === String(id)) { arr.splice(i, 1); gone = true; } };
      Object.keys(S.msgs).forEach(function (k) { drop(S.msgs[k] || []); });
      Object.keys(S.threads).forEach(function (k) { drop(S.threads[k].replies || []); });
      if (gone) { renderMsgs(false); if (S.right === 'thread') { renderRight(); } }
    }
    function redraw() { renderMsgs(false); if (S.right !== 'none') renderRight(); }
    function patchMessage(nm) {
      var done = false;
      var swap = function (arr) { for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(nm.id)) { arr[i] = Object.assign(arr[i], nm); done = true; } };
      Object.keys(S.msgs).forEach(function (k) { swap(S.msgs[k] || []); });
      Object.keys(S.threads).forEach(function (k) { var t = S.threads[k]; if (String(t.root.id) === String(nm.id)) { Object.assign(t.root, nm); done = true; } swap(t.replies || []); });
      if (done) { renderMsgs(false); if (S.right === 'thread') { var tb = $('.ch-thread__body', root), st = tb ? tb.scrollTop : 0; renderRight(); var tb2 = $('.ch-thread__body', root); if (tb2) tb2.scrollTop = st; } }
    }

    /* ------------------------------------------------------------------ uploads */
    function addFiles(scope, files) {
      Array.prototype.forEach.call(files, function (f) {
        var item = { type: 'file', name: f.name || 'Pasted picture', size: f.size, mime: f.type, uploading: true };
        if (/^image\//.test(f.type || '') && window.URL && URL.createObjectURL) {
          // The picture's width and height go with it, so the message holds its space before the picture arrives.
          item.preview = URL.createObjectURL(f);
          var im = new Image(); im.onload = function () { item.w = im.naturalWidth; item.h = im.naturalHeight; }; im.src = item.preview;
        }
        S.pending[scope].push(item); renderPending(scope);
        var ready = liteOn() && /^image\//.test(f.type || '') ? window.FavorLite.compressPhoto(f) : Promise.resolve(f);
        guard(ready.then(function (g) { item.size = g.size; return api.upload(g); })).then(function (r) { Object.assign(item, r, { uploading: false }); renderPending(scope); }).catch(function () { S.pending[scope] = S.pending[scope].filter(function (x) { return x !== item; }); renderPending(scope); });
      });
    }

    /* ------------------------------------------------------------------ DOM events */
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (modal && e.target === modal) { closeModal(); return; }
      if (!el) {
        // On a phone a tap on a message opens its actions as a sheet from the bottom. With the keyboard up, the tap only lowers it.
        var mm = e.target.closest('.ch-msg');
        // In the Threads list a tap on a thread opens it.
        var card = e.target.closest('.ch-th');
        if (card && !e.target.closest('a,button,video,audio,.ch-vid,.ch-ans')) { var ob = card.querySelector('[data-act="open-thread"]'); if (ob) openThreadIn(ob.dataset.ch, ob.dataset.id); return; }
        if (mm && isPhone() && !e.target.closest('a,button,textarea,input,video,audio,.ch-vid,.ch-ans,.ch-pinned')) {
          if (document.body.classList.contains('kb-open') && document.activeElement && document.activeElement.blur) { document.activeElement.blur(); return; }
          msgSheet(mm.getAttribute('data-mid'));
        }
        return;
      }
      var act = el.dataset.act, id = el.dataset.id, scope = el.dataset.scope;
      if (modal && el.closest('.ch-msheet')) closeModal();
      if (act === 'play') { playIn(el.closest('.ch-vid')); return; }
      if (act === 'view') { openViewer(el.dataset.cm, Number(el.dataset.ai) || 0); return; }
      if (act === 'page') { openPage(el.dataset.page); return; }
      if (act === 'notify-on' || act === 'notify-no') {
        lsSet('favor.chat.notify.asked', Date.now());
        if (act === 'notify-on' && typeof Notification !== 'undefined') Promise.resolve(Notification.requestPermission()).then(function (r) { toast(r === 'granted' ? 'Notices are on' : 'Notices are off. The browser settings can turn them on.'); renderSide(); });
        else renderSide();
        return;
      }
      if (act === 'fold') { if (isPhone()) return; S.folded[el.dataset.sec] = !S.folded[el.dataset.sec]; lsSet('favor.chat.folded.v1', S.folded); renderSide(); return; }
      if (act === 'more') { moreMenu(id, el); return; }
      if (act === 'react-more') { emojiPicker(el, function (em) { react(id, em); }); return; }
      if (act === 'copy-link') { closePop(); var lm = findMsg(id); if (lm && navigator.clipboard) navigator.clipboard.writeText(linkTo(lm)).then(function () { toast('Link copied'); }, function () { toast('Copy did not work'); }); return; }
      if (act === 'pin') {
        closePop();
        var pinOn = el.dataset.on !== '0';
        guard(api.pin(id, pinOn)).then(function (r) {
          var pm = findMsg(id), pc = chan(r.channel_id);
          if (pm) pm.pinned = pinOn;
          if (pc) pc.pins = r.pins;
          delete S.pins[r.channel_id];
          renderBar(); redraw();
          if (S.right === 'pins') loadPins(r.channel_id);
          toast(pinOn ? 'Pinned' : 'Unpinned');
        });
        return;
      }
      if (act === 'pins') { openPins(); return; }
      if (act === 'bm-add') { closePop(); bookmarkDialog(); return; }
      if (act === 'bm-save') {
        var bu = $('[data-bm-url]', modal).value.trim();
        if (!bu) { toast('Paste a link first'); return; }
        el.disabled = true;
        guard(api.addBookmark(S.active, { url: bu, title: $('[data-bm-title]', modal).value.trim() })).then(function (r) {
          closeModal();
          var bc1 = chan(S.active); bc1.bookmarks = r.bookmarks; if (S.pins[bc1.id]) S.pins[bc1.id].bookmarks = r.bookmarks;
          renderBar(); if (S.right === 'pins') renderRight();
        }).catch(function () { el.disabled = false; });
        return;
      }
      if (act === 'bm-del') {
        guard(api.removeBookmark(S.active, id)).then(function (r) {
          var bc2 = chan(S.active); bc2.bookmarks = r.bookmarks; if (S.pins[bc2.id]) S.pins[bc2.id].bookmarks = r.bookmarks;
          renderBar(); if (S.right === 'pins') renderRight();
        });
        return;
      }
      if (act === 'mark-unread') {
        closePop();
        var um = findMsg(id); if (!um) return;
        guard(api.unread(um.channel_id, id)).then(function (r) {
          var uc = chan(um.channel_id);
          uc.last_read = r.last_read; uc.unread = r.unread; uc.mentions = r.mentions; S.lastRead[uc.id] = r.last_read; S.keepUnread = uc.id;
          renderSide(); if (S.active === uc.id && S.page === 'channel') renderMsgs(false);
          if (opts.onUnread) opts.onUnread(totalUnread());
          toast('Marked unread');
        });
        return;
      }
      if (act === 'make-request') { closePop(); requestDialog({ from: id }); return; }
      if (act === 'clip-reply') {
        // Recorded in place, posted in this message's thread (integrations.js); a root message starts the thread.
        closePop();
        var inList = (S.msgs[S.active] || []).some(function (x) { return String(x.id) === String(id); });
        if (window.FavorIx && window.FavorIx.clipReply) window.FavorIx.clipReply({ kind: 'chat', ref: S.active, thread: inList ? Number(id) : S.threadRoot });
        return;
      }
      if (act === 'request-new') { closePop(); requestDialog({ thread: scope === 'thread' ? S.threadRoot : null }); return; }
      if (act === 'rq-create') {
        var rq = modal._rq || {}, rt = $('[data-rq-title]', modal).value.trim();
        if (!rt) { toast('Give the request a one-line summary'); return; }
        el.disabled = true;
        guard(api.makeRequest(rq.channel || S.active, { title: rt, body: $('[data-rq-body]', modal).value.trim(), surface: $('[data-rq-surface]', modal).value, from_message: rq.from || undefined, thread_id: rq.thread || undefined })).then(function (r) {
          closeModal();
          if (r.message) { S.toBottom = true; addMessage(r.message, true); }
          toast('Request made');
        }).catch(function () { el.disabled = false; });
        return;
      }
      if (act === 'thread-full') { setFull(!S.threadFull); return; }
      if (act === 'thread-exit') { closeRight(); return; }
      if (act === 'latest') {
        var lb = scope === 'thread' ? $('.ch-right .ch-thread__body', root) : $('.ch-msgs', root);
        if (lb) { lb.scrollTop = lb.scrollHeight; S.newBelow[scope] = 0; if (scope !== 'thread') pinned = true; syncLatest(scope); }
        return;
      }
      if (act === 'open-thread') { openThreadIn(el.dataset.ch, id); return; }
      if (act === 'actv') { var ai = S.activity && S.activity[+el.dataset.i]; if (ai) jumpTo({ channel_id: ai.channel_id, id: ai.message.id, thread_id: ai.message.thread_id }); return; }
      if (act === 'draft-open') { var dk = el.dataset.k.split('|'); if (dk[1]) openThreadIn(dk[0], Number(dk[1])); else openChannel(dk[0]); return; }
      if (act === 'draft-del') { delete S.drafts[el.dataset.k]; lsSet('favor.chat.drafts.v1', S.drafts); renderSide(); if (S.page === 'drafts') renderMsgs(false); return; }
      if (act === 'jump-msg') {
        var jm = { channel_id: S.active, id: Number(id), thread_id: el.dataset.t ? Number(el.dataset.t) : null };
        if (isPhone()) { closeRight(); setTimeout(function () { jumpTo(jm); }, 360); } else jumpTo(jm);
        return;
      }
      if (act === 'fmt') { applyFmt(scope, el.dataset.f); return; }
      if (act === 'slash-pick') { pickSlash(+el.dataset.i); return; }
      if (act === 'sw-pick') { pickSwitch(+el.dataset.i); return; }
      if (act === 'switcher') { openSwitcher(); return; }
      if (act === 'copy') { closePop(); var cm = findMsg(id); var txt = cm ? String(cm.body || '').replace(/<@([^>]+)>/g, function (_, u) { return '@' + (u === 'brain' ? 'Favor Brain' : user(u).name); }).replace(/<#[^>]+>/g, '') : ''; if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Copied'); }, function () { toast('Copy did not work'); }); return; }
      if (act === 'open') { closeSearch(); openChannel(id); }
      else if (act === 'back') back();
      else if (act === 'thread') openThread(id);
      else if (act === 'close-right') closeRight();
      else if (act === 'details') openDetails();
      else if (act === 'tab') { S.tab = el.dataset.tab; renderRight(); }
      else if (act === 'search') openSearch();
      else if (act === 'hub-menu') { e.stopPropagation(); var shell = document.querySelector('.h-app'); if (shell) { var open = !shell.classList.contains('is-nav'); shell.classList.toggle('is-nav', open); ['h-bar-more', 'h-menu'].forEach(function (id) { var b = document.getElementById(id); if (b) b.setAttribute('aria-expanded', String(open)); }); } }
      else if (act === 'seg') { S.seg = el.dataset.seg === 'messages' ? 'messages' : 'channels'; renderSide(); }
      else if (act === 'search-x') closeSearch();
      else if (act === 'hit') jumpTo(S.search.items[+el.dataset.i]);
      else if (act === 'react') react(id, el.dataset.e);
      else if (act === 'react-pick') emojiPicker(el, function (em) { react(id, em); });
      else if (act === 'edit') {
        var inR = !!el.closest('.ch-right') || (pop && popAnchor && popAnchor.closest && !!popAnchor.closest('.ch-right'));
        closePop();
        S.editing = Number(id) || id; S.editDraft = null; renderMsgs(false); if (S.right === 'thread') renderRight();
        var ed = $((inR ? '.ch-right ' : '.ch-msgs ') + '[data-edit="' + id + '"]', root) || $('[data-edit]', root);
        if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
      }
      else if (act === 'edit-cancel') { S.editing = null; renderMsgs(false); if (S.right === 'thread') renderRight(); }
      else if (act === 'edit-save') { var ta2 = el.closest('.ch-edit') ? $('[data-edit]', el.closest('.ch-edit')) : $('[data-edit="' + id + '"]', root); var v = tokenize('main', ta2.value).trim(); if (!v) return; S.editing = null; guard(api.edit(id, v)).then(function (m) { patchMessage(m); }).catch(function () { redraw(); }); }
      else if (act === 'del') {
        closePop();
        var m0 = openModal('Delete message', '<p style="margin:4px 0 8px">This removes the message for everyone in the conversation.</p>', '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="del-yes" data-id="' + id + '">Delete</button>');
      }
      else if (act === 'del-yes') {
        closeModal();
        guard(api.del(id)).then(function (r) {
          var m = findMsg(id);
          // A message only its author could see leaves no trace; any other shows as deleted. A reply also sent to the channel goes from both places.
          if (m && m.visible_to) purgeMessage(id); else patchMessage(Object.assign({}, m, { deleted: true, body: '', attachments: [], pinned: false }));
          if (r && r.also) { var tw = findMsg(r.also); if (tw) patchMessage(Object.assign({}, tw, { deleted: true, body: '', attachments: [], pinned: false })); }
        });
      }
      else if (act === 'share-answer' || act === 'share-summary') {
        // An answer with partner records goes only where everyone has partner access in the Brain; elsewhere the server refuses
        // and the person may share the summary without partner details instead.
        el.disabled = true;
        var summary = act === 'share-summary';
        api.shareAnswer(id, { summary: summary }).then(function (r) { purgeMessage(id); if (r && r.message) addMessage(r.message, true); toast(summary ? 'Shared the summary' : 'Shared to the channel'); }).catch(function (e) {
          el.disabled = false;
          var code = (e && e.code) || '';
          if (code === 'partner_audience' || code === 'partner_audience_no_summary') {
            var box = el.closest('.ch-private');
            var old = box && box.querySelector('.ch-private__warn');
            if (old) old.remove();
            if (box) box.insertAdjacentHTML('beforeend', '<div class="ch-private__warn" role="status">' + esc(e.message) + (code === 'partner_audience' ? ' <button type="button" class="ch-btn ch-btn--sm" data-act="share-summary" data-id="' + id + '">Share the summary only</button>' : '') + '</div>');
            if (!box) toast(e.message);
          } else toast((e && e.message) || 'That did not work. Try again.');
        });
      }
      else if (act === 'dismiss-answer') { el.disabled = true; guard(api.dismissAnswer(id)).then(function () { purgeMessage(id); }).catch(function () { el.disabled = false; }); }
      else if (act === 'plus') plusMenu(scope, el);
      else if (act === 'at') { insertAtCaret(scope, '@'); updateMention($('[data-ta="' + scope + '"]', root)); }
      else if (act === 'emoji') emojiPicker(el, function (em) { insertAtCaret(scope, em); });
      else if (act === 'ask-brain') { var ta3 = $('[data-ta="' + scope + '"]', root); S.mentionMap[scope]['@Favor Brain'] = '<@brain>'; if (ta3.value.indexOf('@Favor Brain') < 0) ta3.value = '@Favor Brain ' + ta3.value; ta3.focus(); grow(ta3); syncSend(scope); }
      else if (act === 'upload') { closePop(); var inp = $('[data-file]', root); inp.dataset.scope = scope; inp.click(); }
      else if (act === 'drive-pick') driveModal(scope);
      else if (act === 'clip-pick') clipModal(scope);
      else if (act === 'clip-rec') { closePop(); if (opts.recordClip) opts.recordClip(S.active, function (att) { S.pending[scope].push(att); renderPending(scope); }); else toast('Recording is not available here'); }
      else if (act === 'ring-person') { e.preventDefault(); if (window.FavorRing) window.FavorRing.call({ to: [el.dataset.id] }); }
      else if (act === 'find-time') { closePop(); if (window.FavorIx) window.FavorIx.findTime({ kind: 'chat', ref: S.active, thread: scope === 'thread' ? S.threadRoot : null }); }
      else if (act === 'meeting' || act === 'huddle') { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); closePop(); openHuddle(S.active); }
      else if (act === 'drive-choose') { var it = modal._items[+el.dataset.i], sc = modal._scope; closeModal(); S.pending[sc].push(Object.assign({ type: 'drive' }, it)); renderPending(sc); var tt = $('[data-ta="' + sc + '"]', root); if (tt) tt.focus(); }
      else if (act === 'clip-choose') { var cl = modal._items[+el.dataset.i], sc2 = modal._scope; closeModal(); S.pending[sc2].push(Object.assign({ type: 'clip' }, cl)); renderPending(sc2); if (cl.level === 'private') toast('This clip is Private. People in this conversation cannot open it until you change who can watch in the Share window of the clip.'); else if (cl.level === 'people') toast('People in this conversation will be able to watch this clip. They count as specific people.'); }
      else if (act === 'unpend') { S.pending[scope].splice(+el.dataset.i, 1); renderPending(scope); }
      else if (act === 'mention-pick') pickMention(+el.dataset.i);
      else if (act === 'chip' || act === 'ask') { var ta4 = $('[data-ta="' + (S.right === 'thread' ? 'thread' : 'main') + '"]', root); S.mentionMap[S.right === 'thread' ? 'thread' : 'main']['@Favor Brain'] = '<@brain>'; ta4.value = '@Favor Brain ' + el.dataset.q; grow(ta4); syncSend(S.right === 'thread' ? 'thread' : 'main'); ta4.focus(); }
      else if (act === 'new-channel') newChannelModal();
      else if (act === 'nc-create') {
        var name = $('[data-nc-name]', modal).value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (!name) { toast('Give the channel a name'); return; }
        var pv = $('[data-nc-priv]', modal).checked, tp = $('[data-nc-topic]', modal).value.trim();
        guard(api.createChannel({ name: name, topic: tp, private: pv })).then(function (c) { closeModal(); S.channels[c.id] = c; S.msgs[c.id] = S.msgs[c.id] || []; openChannel(c.id); });
      }
      else if (act === 'new-dm') personPicker('New message', true, [], function (ids) { guard(api.openDm(ids)).then(function (c) { S.channels[c.id] = Object.assign(S.channels[c.id] || {}, c, { joined: true }); openChannel(c.id); }); });
      else if (act === 'browse') browseModal();
      else if (act === 'browse-open') { var bc = modal._items[+el.dataset.i]; closeModal(); guard(api.join(bc.id)).then(function (c) { S.channels[c.id] = Object.assign(S.channels[c.id] || {}, c, { joined: true }); openChannel(c.id); }); }
      else if (act === 'add-members') { var cc = chan(S.active); personPicker('Add people', true, cc.members, function (ids) { guard(api.addMembers(S.active, ids)).then(function (c) { Object.assign(cc, c); renderRight(); renderHead(); renderSide(); }); }); }
      else if (act === 'leave') { var lc = chan(S.active); guard(api.leave(S.active)).then(function () { lc.joined = false; S.right = 'none'; var nx = sortedChannels().chans[0]; renderSide(); if (nx) openChannel(nx.id); else setView('list'); }); }
      else if (act === 'mute') { var mc = chan(S.active); mc.muted = !mc.muted; guard(api.mute ? api.mute(S.active, mc.muted) : Promise.resolve()); renderRight(); renderSide(); }
      else if (act === 'older') { var lst = S.msgs[S.active]; guard(api.history(S.active, { before: lst[0].id })).then(function (r) { var h = $('.ch-msgs', root).scrollHeight; S.msgs[S.active] = r.messages.concat(lst); S.hasMore[S.active] = !!r.more; renderMsgs(false); var b = $('.ch-msgs', root); b.scrollTop = b.scrollHeight - h; }); }
      else if (act === 'modal-x') closeModal();
    });
    // A clip with no poster image shows the drawn placeholder instead of a broken picture.
    // A clip poster or a Drive picture that will not load is remembered, so every later draw shows the placeholder instead.
    root.addEventListener('error', function (e) {
      var im = e.target; if (!im || im.tagName !== 'IMG') return;
      var avBox = im.closest('.ch-av');
      if (avBox) { broken[im.getAttribute('src')] = 1; im.replaceWith(document.createTextNode(im.dataset.ini || '?')); return; }
      // A picture that will not load becomes a plain file row with its name, never a broken-image icon.
      var photo = im.closest('.ch-photo');
      if (photo) { photo.classList.add('is-broken'); photo.removeAttribute('style'); photo.innerHTML = '<span class="ch-file__ic" data-k="image">IMG</span><span class="ch-photo__n">' + esc(im.getAttribute('alt') || 'Picture') + '</span>'; return; }
      if (!im.closest('.ch-vid') && !im.closest('.ch-prev__pic')) return;
      broken[im.getAttribute('src')] = 1;
      im.hidden = true;
      var pic = im.closest('.ch-prev__pic');
      if (pic && im.dataset.fallback) { pic.innerHTML = '<span class="ch-file__ic" data-k="' + esc(im.dataset.k || 'file') + '">' + esc(im.dataset.fallback) + '</span>'; }
    }, true);
    root.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target) && e.target !== popAnchor && !(popAnchor && popAnchor.contains && popAnchor.contains(e.target))) { closePop(); mentionState = null; } });
    root.addEventListener('submit', function (e) { var f = e.target.closest('.ch-comp'); if (f) { e.preventDefault(); send(f.dataset.scope); } });
    root.addEventListener('input', function (e) {
      var ta = e.target.closest('[data-ta]');
      if (ta) {
        grow(ta); syncSend(ta.dataset.ta); if (!updateSlash(ta)) updateMention(ta);
        saveDraftSoon(ta.dataset.ta);
        if (Date.now() - typingSent > 3000 && ta.value && ta.value.charAt(0) !== '/') { typingSent = Date.now(); api.typing(S.active, ta.dataset.ta === 'thread' ? S.threadRoot : null); }
      }
      var ed = e.target.closest('[data-edit]');
      if (ed) { S.editDraft = ed.value; S.editDraftId = Number(ed.dataset.edit); }
      var tp = e.target.closest('[data-topic]');
      if (tp) { clearTimeout(tp._t); tp._t = setTimeout(function () { api.setTopic(S.active, tp.value.trim()).then(function () { chan(S.active).topic = tp.value.trim(); renderHead(); }); }, 700); }
    });
    root.addEventListener('keydown', function (e) {
      var ta = e.target.closest('[data-ta]'), ed = e.target.closest('[data-edit]');
      if (ed && e.key === 'Escape') {
        var inRight = !!e.target.closest('.ch-right');
        S.editing = null; renderMsgs(false); if (S.right === 'thread') renderRight();
        var home = $('[data-ta="' + (inRight ? 'thread' : 'main') + '"]', root); if (home) home.focus();
        return;
      }
      if (ed && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); var sv = $('[data-act="edit-save"][data-id="' + ed.dataset.edit + '"]', root); if (sv) sv.click(); return; }
      if (!ta) {
        // Escape puts away what is on top: a menu, a dialog, search, then the thread or details panel.
        if (e.key === 'Escape' && !ed) {
          if (pop) { closePop(); mentionState = null; slashState = null; }
          else if (modal) closeModal();
          else if (S.search || sw) closeSearch();
          else if (S.right !== 'none' && !e.target.closest('input, select')) closeRight();
        }
        return;
      }
      var scope = ta.dataset.ta;
      if (slashState && pop) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slashState.i = (slashState.i + (e.key === 'ArrowDown' ? 1 : slashState.list.length - 1)) % slashState.list.length; pop.querySelectorAll('.ch-pop__i').forEach(function (b, i) { b.classList.toggle('is-on', i === slashState.i); }); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slashState.i); return; }
        if (e.key === 'Escape') { closePop(); slashState = null; return; }
      }
      if (mentionState && pop) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionState.i = (mentionState.i + (e.key === 'ArrowDown' ? 1 : mentionState.cands.length - 1)) % mentionState.cands.length; pop.querySelectorAll('.ch-pop__i').forEach(function (b, i) { b.classList.toggle('is-on', i === mentionState.i); }); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionState.i); return; }
        if (e.key === 'Escape') { closePop(); mentionState = null; return; }
      }
      if (e.key === 'Escape') {
        if (pop) { closePop(); return; }
        if (scope === 'thread') { e.preventDefault(); closeRight(); }
        return;
      }
      var mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); applyFmt(scope, 'bold'); return; }
      if (mod && !e.altKey && !e.shiftKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); applyFmt(scope, 'italic'); return; }
      if (mod && e.shiftKey && e.altKey && e.code === 'KeyC') { e.preventDefault(); applyFmt(scope, 'block'); return; }
      if (mod && e.shiftKey && !e.altKey && FMT_KEYS[e.code]) { e.preventDefault(); applyFmt(scope, FMT_KEYS[e.code]); return; }
      // Shift Enter (Enter on a phone) adds a line; inside a list or a quote it starts the next item.
      if (e.key === 'Enter' && !e.isComposing && (e.shiftKey || isPhone())) { if (continueList(ta)) { e.preventDefault(); grow(ta); syncSend(scope); saveDraftSoon(scope); } return; }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(scope); return; }
      // Up arrow in an empty box edits the person's last message, in the channel or in the thread.
      if (e.key === 'ArrowUp' && !ta.value) {
        var pool = scope === 'thread' ? ((S.threads[S.threadRoot] || {}).replies || []) : (S.msgs[S.active] || []);
        var mine = pool.filter(function (m) { return m.user_id === S.me.id && !m.deleted && !m.visible_to && (m.body || '').trim(); }).pop();
        if (mine) {
          e.preventDefault();
          S.editing = mine.id; S.editDraft = null; renderMsgs(false); if (S.right === 'thread') renderRight();
          var edb = $((scope === 'thread' ? '.ch-right ' : '.ch-msgs ') + '[data-edit="' + mine.id + '"]', root) || $('[data-edit="' + mine.id + '"]', root);
          if (edb) { edb.focus(); edb.setSelectionRange(edb.value.length, edb.value.length); }
        }
      }
    });
    root.addEventListener('paste', function (e) {
      var ta = e.target.closest('[data-ta]'); if (!ta) return;
      var files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); addFiles(ta.dataset.ta, files); }
    });
    var dragN = 0;
    root.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) { dragN++; var main = $('.ch-main', root); if (!$('.ch-drop', root)) { var d = document.createElement('div'); d.className = 'ch-drop'; d.textContent = 'Drop to attach'; main.appendChild(d); } } });
    root.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault(); });
    root.addEventListener('dragleave', function () { dragN = Math.max(0, dragN - 1); if (!dragN) { var d = $('.ch-drop', root); if (d) d.remove(); } });
    root.addEventListener('drop', function (e) { dragN = 0; var d = $('.ch-drop', root); if (d) d.remove(); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(S.right === 'thread' && e.target.closest('.ch-right') ? 'thread' : 'main', e.dataTransfer.files); } });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && root.isConnected) { e.preventDefault(); e.stopImmediatePropagation(); if (sw) closeSearch(); else openSwitcher(); }
    }, true);
    // Escape from anywhere on the page (nothing focused, or focus outside Chat) still puts away Chat's menu, dialog or search.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !root.isConnected || root.contains(e.target) || (window.FavorChatView && window.FavorChatView.isOpen())) return;
      if (pop) { closePop(); mentionState = null; slashState = null; }
      else if (modal) closeModal();
      else if (S.search || sw) closeSearch();
    });
    // Escape hides a showing tooltip and leaves focus where it is; moving the pointer or the focus brings tooltips back.
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && e.target.closest && e.target.closest('.ch-tipped')) root.classList.add('no-tip'); }, true);
    root.addEventListener('pointermove', function () { root.classList.remove('no-tip'); }, { passive: true });
    root.addEventListener('focusin', function () { root.classList.remove('no-tip'); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) markRead(); });
    window.addEventListener('focus', markRead);
    // iOS sends many viewport events while the keyboard slides; the layout is measured once a frame, not once an event.
    var measureQ = 0;
    function measureSoon() { if (measureQ) return; measureQ = requestAnimationFrame(function () { measureQ = 0; measure(); }); }
    window.addEventListener('resize', measureSoon);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', measureSoon); window.visualViewport.addEventListener('scroll', measureSoon); }
    // The keyboard opening keeps the newest message in view when the list was at the bottom (the pin below does that), and
    // leaves a person reading further up where they were. The thread does the same once, as the keyboard opens.
    var kbWas = false;
    window.addEventListener('hub-kb', function () {
      measureSoon();
      var open = document.body.classList.contains('kb-open');
      if (open && !kbWas) { var tb = $('.ch-right .ch-thread__body', root); if (tb && tb.scrollHeight - tb.scrollTop - tb.clientHeight < 140) requestAnimationFrame(function () { tb.scrollTop = tb.scrollHeight; }); }
      kbWas = open;
    });
    // The newest message stays in view while pictures, previews and link cards arrive above it, and while the keyboard shrinks
    // the list. Scrolling up turns this off until the list is back at the bottom.
    (function () {
      var box = $('.ch-msgs', root), inner = $('.ch-msgs__in', root);
      if (!box) return;
      // Only a scroll upward unpins. The browser moving the list down by itself (content above settling) keeps the pin.
      var lastTop = box.scrollTop;
      box.addEventListener('scroll', function () {
        var gap = box.scrollHeight - box.scrollTop - box.clientHeight;
        pinned = gap < 60 || (pinned && box.scrollTop >= lastTop - 2);
        lastTop = box.scrollTop;
      }, { passive: true });
      if ('ResizeObserver' in window) { var ro = new ResizeObserver(function () { if (pinned && S.view !== 'list') box.scrollTop = box.scrollHeight; }); ro.observe(box); if (inner) ro.observe(inner); }
    })();
    // The hub reloads the page on any step of the browser's history it does not own. Chat's screens own theirs (see pushNav), so
    // this listener runs first (capture, at the window) and keeps the hub out of those. A step that belongs to one of the hub's
    // overlays (help, search, the huddle sheet) leaves Chat's place unchanged and is left to the hub.
    window.addEventListener('popstate', function (e) {
      if (!root.isConnected) return;
      var st = e.state || {};
      if (st.hubov != null) return;
      var to = st.chn || 0;
      if (to === nav.pos) return;
      e.stopImmediatePropagation();
      nav.pos = to;
      var wasView = nav.view, V = window.FavorChatView;
      nav.view = !!st.chview;
      // The viewer's step: Back closes the viewer and the chat under it stays as it was.
      if (wasView && !nav.view) { if (V && V.isOpen()) { viewBack = true; V.close(); viewBack = false; } }
      else if (!nav.view) applyNav(st);
      var f = nav.after; nav.after = null;
      if (f) f();
    }, true);
    // The typing line clears itself; the timer runs only while someone is typing.
    var typingT = 0;
    function typingTick() {
      clearTimeout(typingT); renderTyping();
      var now = Date.now(), live = function (t) { return Object.keys(t || {}).some(function (id) { return id !== S.me.id && now - t[id] < 5000; }); };
      if (live(S.typing[S.active]) || live(S.threadTyping[S.threadRoot])) typingT = setTimeout(typingTick, 1000);
    }

    function focusMessage(id, inThread) {
      var tries = 0;
      var t = setInterval(function () {
        var el = root.querySelector((inThread ? '.ch-right' : '.ch-msgs') + ' [data-mid="' + id + '"]');
        if (!el && ++tries < 50) return;
        clearInterval(t);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('is-flash'); }
      }, 100);
    }
    function focusComposer(scope, prefix) {
      var ta = $('[data-ta="' + scope + '"]', root) || $('[data-ta="main"]', root);
      if (!ta) return;
      if (prefix && ta.value.indexOf(prefix) !== 0) { ta.value = prefix + ta.value; if (/Favor Brain/.test(prefix)) S.mentionMap[ta.dataset.ta]['@Favor Brain'] = '<@brain>'; }
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); grow(ta); syncSend(ta.dataset.ta);
    }

    /* ------------------------------------------------------------------ boot */
    root.classList.add('ch');
    // The page ships the first paint already (same markup as frameHtml); only a bare root needs drawing.
    if (!root.hasAttribute('data-boot')) root.innerHTML = frameHtml();
    root.insertAdjacentHTML('beforeend', '<input type="file" data-file multiple hidden />');
    setView(isPhone() ? 'list' : 'channel');
    $('[data-file]', root).addEventListener('change', function (e) { addFiles(e.target.dataset.scope || 'main', e.target.files); e.target.value = ''; });
    api.onEvent(onEvent);
    // On a screen that opens straight into a channel, its messages are fetched while the channel list loads, so the first thing drawn is the finished channel.
    var wantId = null;
    try { wantId = opts.initial || localStorage.getItem('favor.chat.last'); } catch (e) { wantId = opts.initial || null; }
    var early = wantId && (!isPhone() || opts.initial) ? Promise.resolve(api.history(wantId)).then(function (r) { return { id: wantId, r: r }; }, function () { return null; }) : Promise.resolve(null);
    // The channel list from this tab's last visit draws at once (rows, names, badges), then the fresh list replaces it in place.
    // Kept for this tab only, without any message text.
    var CACHE = 'favor.chat.boot.v1', cachedPaint = false;
    try {
      var cb = JSON.parse(sessionStorage.getItem(CACHE) || 'null');
      if (cb && cb.me && Date.now() - cb.at < 30 * 60000) {
        S.me = cb.me; S.users = cb.users || {}; (cb.channels || []).forEach(function (c) { S.channels[c.id] = c; });
        S.features = cb.features || S.features; S.threadsUnread = cb.threads_unread || 0;
        root.removeAttribute('data-boot'); renderSide(); cachedPaint = true;
      }
    } catch (e) { /* no cache */ }
    return guard(Promise.all([api.boot(), early])).then(function (both) {
      var b = both[0], pre = both[1];
      try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), me: b.me, users: b.users, channels: b.channels, features: b.features, threads_unread: b.threads_unread })); } catch (e) { /* full or private */ }
      S.me = b.me; S.users = b.users || {}; S.users[S.me.id] = Object.assign({}, S.users[S.me.id] || {}, S.me);
      S.features = b.features || { pins: false }; S.threadsUnread = b.threads_unread || 0; S.lang = b.lang || ''; S.langs = b.langs || [];
      applyRightWidth();
      if (cachedPaint) S.channels = {};
      (b.channels || []).forEach(function (c) { S.channels[c.id] = c; });
      var saved = null;
      try { saved = localStorage.getItem('favor.chat.last'); } catch (e) { /* private mode */ }
      var gen = sortedChannels().chans.filter(function (c) { return c.name === 'general'; })[0];
      var first = (opts.initial && chan(opts.initial) && opts.initial) || (saved && chan(saved) && chan(saved).joined !== false && saved) || (gen && gen.id) || (sortedChannels().chans[0] || sortedChannels().dms[0] || {}).id;
      if (pre && pre.id === first && pre.r && pre.r.messages && !S.msgs[first]) { S.msgs[first] = pre.r.messages; S.hasMore[first] = !!pre.r.more; }
      root.removeAttribute('data-boot');
      if (first && isPhone() && !opts.initial) S.active = first;
      renderSide();
      if (first) { if (isPhone() && !opts.initial) { S.active = first; renderHead(); } else openChannel(first, { pop: true }); }
      // A reload keeps the screen the person was on (a channel, a thread, one of the lists): the browser kept that step.
      var st0 = history.state;
      if (st0 && st0.chn && !st0.hubov) { nav.pos = st0.chn; nav.view = !!st0.chview; applyNav(st0); }
      // A phone that opened straight at a conversation (a link, a notice) gets the list under it, so Back goes there
      // and Back from a thread goes to the conversation first.
      else if (isPhone() && opts.initial && first === opts.initial && S.view === 'channel') pushNav();
      if (opts.onUnread) opts.onUnread(totalUnread());
      measure();
      readAhead();
      return {
        open: openChannel, state: S, toast: toast, search: openSearch, switcher: openSwitcher, focus: focusMessage, thread: openThread, threadIn: openThreadIn, details: openDetails, page: openPage,
        view: setView, render: renderAll, redraw: redraw, openPop: closePop, modal: openModal, closeModal: closeModal, pop: openPop, closePop: closePop, find: findMsg, patch: patchMessage, request: requestDialog, toBottom: function () { S.toBottom = true; }, scopeBox: function (sc) { return $('[data-ta="' + sc + '"]', root); }, pend: function (sc, att) { if (att && S.pending[sc].indexOf(att) < 0) S.pending[sc].push(att); renderPending(sc); }, dropPend: function (sc, att) { S.pending[sc] = S.pending[sc].filter(function (x) { return x !== att; }); renderPending(sc); }, icon: ic, grow: grow, sync: syncSend, askBrainIn: function (sc) { var ta = $('[data-ta="' + sc + '"]', root); S.mentionMap[sc]['@Favor Brain'] = '<@brain>'; if (ta.value.indexOf('@Favor Brain') < 0) ta.value = '@Favor Brain ' + ta.value; ta.focus(); grow(ta); syncSend(sc); }, askBrain: askBrain, sheet: openSheet, focusComposer: focusComposer, add: addMessage, user: user, avatar: avatar
      };
    });
  }

  // q3-tasks hook: composerHtml is shared so the request board's comment box is Chat's own.
  window.FavorChat = { mount: mount, bootHtml: bootHtml, util: { esc: esc, fmtBody: null, ic: ic, composerHtml: composerHtml } };
})();
