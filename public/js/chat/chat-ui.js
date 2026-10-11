/* Favor Chat client. One module draws the whole screen (channel list, channel, thread, details, search, pickers) and talks to an
   injected `api` object, so the page, the tests and the design prototype all run the same code.
   api: boot, history, thread, send, edit, del, react, read, typing, search, createChannel, openDm, browse, join, leave, setTopic,
        addMembers, driveSearch, clips, startMeeting, upload, recordClip, onEvent. See chat.js for the real one. */
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
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>'
  };
  function ic(n, cls) { return '<svg viewBox="0 0 24 24" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + (ICON[n] || '') + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }

  var fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  var fmtDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var fmtDayLong = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  var fmtShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  function dayKey(iso) { return fmtDayKey.format(new Date(iso)); }
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
  function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : b || a + 's'); }

  function mount(root, api, opts) {
    opts = opts || {};
    var S = {
      me: null, users: {}, channels: {}, active: null, right: 'none', threadRoot: null, tab: 'about',
      msgs: {}, threads: {}, typing: {}, search: null, view: 'list', lastRead: {}, memberPick: null, editing: null, pending: { main: [], thread: [] },
      mentionMap: { main: {}, thread: {} }, hasMore: {}, loaded: {}, connected: true
    };
    var pop = null, popAnchor = null, modal = null, typingSent = 0, toastT = 0;
    var isPhone = function () { return matchMedia('(max-width: 860px)').matches; };

    /* ------------------------------------------------------------------ helpers */
    function user(id) {
      if (id === 'brain') return { id: 'brain', name: 'Favor Brain', brain: true };
      if (id === 'meetings') return { id: 'meetings', name: 'Favor Meetings', sys: 'video' };
      return S.users[id] || { id: id, name: String(id || '').split('@')[0] || 'Someone', color: COLORS[hash(String(id)) % 7] };
    }
    function avatar(u, size, dot) {
      if (u.sys) return '<span class="ch-av" data-c="teal' + '"' + (size ? ' data-s="' + size + '"' : '') + '>' + ic(u.sys) + '</span>';
      if (u.brain) return '<span class="ch-av ch-av--brain' + (size ? ' ch-av--' + size : '') + '">' + ic('spark') + '</span>';
      var c = u.color || COLORS[hash(u.id || u.name || '') % 7];
      var inner = u.picture ? '<img src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(u.name));
      return '<span class="ch-av' + (size ? ' ch-av--' + size : '') + '" data-c="' + c + '">' + inner + (dot ? '<i class="ch-dot" data-p="' + esc(u.presence || 'off') + '"></i>' : '') + '</span>';
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
    function toast(t) {
      var el = $('.ch-toast', root);
      if (!el) { el = document.createElement('div'); el.className = 'ch-toast'; el.setAttribute('role', 'status'); root.appendChild(el); }
      el.textContent = t; el.hidden = false; clearTimeout(toastT);
      toastT = setTimeout(function () { el.hidden = true; }, 2600);
    }
    function guard(p) { return Promise.resolve(p).catch(function (e) { toast((e && e.message) || 'That did not work. Try again.'); throw e; }); }

    /* ------------------------------------------------------------------ message text */
    function fmtBody(body, mentions) {
      var t = esc(body || '');
      var blocks = [];
      t = t.replace(/```([\s\S]*?)```/g, function (_, c) { blocks.push(c.replace(/^\n/, '')); return '\u0000B' + (blocks.length - 1) + '\u0000'; });
      var codes = [];
      t = t.replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000'; });
      t = t.replace(/&lt;@([^&\s]+?)&gt;/g, function (_, id) {
        if (id === 'brain') return '<span class="ch-at ch-at--brain">@Favor Brain</span>';
        if (id === 'all' || id === 'channel') return '<span class="ch-at ch-at--me">@channel</span>';
        return '<span class="ch-at' + (id === S.me.id ? ' ch-at--me' : '') + '">@' + esc(user(id).name) + '</span>';
      });
      t = t.replace(/&lt;#([^&\s]+?)&gt;/g, function (_, id) { var c = chan(id); return '<span class="ch-chan"># ' + esc(c ? c.name : 'channel') + '</span>'; });
      t = t.replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
      t = t.replace(/\u0000C(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
      t = t.replace(/\u0000B(\d+)\u0000/g, function (_, i) { return '<pre>' + blocks[+i] + '</pre>'; });
      return t;
    }
    function mentionsMe(m) {
      var b = m.body || '';
      return b.indexOf('<@' + S.me.id + '>') >= 0 || b.indexOf('<@channel>') >= 0 || b.indexOf('<@all>') >= 0;
    }

    /* ------------------------------------------------------------------ cards */
    function cardHtml(a) {
      if (a.type === 'clip') {
        var thumb = a.thumb ? '<img src="' + esc(a.thumb) + '" alt="" loading="lazy" />' : '<span class="ch-clip__scr"><i></i><i></i><i></i><i></i></span>';
        return '<a class="ch-card ch-clip" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-clip__thumb">' + thumb + '<span class="ch-clip__play">' + ic('play') + '</span>' + (a.duration ? '<span class="ch-clip__dur">' + esc(a.duration) + '</span>' : '') + '</span>' +
          '<span class="ch-clip__info"><span class="ch-kicker">' + ic('rec') + 'Clip</span><span class="ch-card__t">' + esc(a.title) + '</span><span class="ch-card__m">' + esc(a.by || '') + (a.when ? ' · ' + esc(a.when) : '') + '</span>' + (a.summary ? '<span class="ch-card__s">' + esc(a.summary) + '</span>' : '') + '</span></a>';
      }
      if (a.type === 'drive') {
        var k = a.kind || 'file', lab = { doc: 'DOC', sheet: 'XLS', pdf: 'PDF', slides: 'PPT', photo: 'IMG', file: 'FILE' }[k] || 'FILE';
        return '<a class="ch-card ch-file" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-file__ic" data-k="' + esc(k) + '">' + lab + '</span><span class="ch-file__t"><span class="ch-kicker" style="color:var(--tc-sky-ink)">' + ic('drive') + 'Drive</span><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(a.path || '') + (a.indexed ? ' · Indexed ' + esc(a.indexed) : '') + '</span></span><span class="ch-btn ch-btn--sm">Open</span></a>';
      }
      if (a.type === 'meeting') {
        var live = a.status !== 'ended';
        var inner = '<span class="ch-meet__ic">' + ic('video') + '</span><span class="ch-meet__t"><span class="ch-kicker">' + ic('video') + 'Meeting</span><span class="ch-card__t">' + esc(a.title) + '</span>' +
          (live ? '<span class="ch-meet__live"><i></i>Live now' + (a.count ? ' · ' + plural(a.count, 'person', 'people') + ' in the room' : '') + '</span>' : '<span class="ch-card__m">Ended' + (a.duration ? ' · ' + esc(a.duration) : '') + (a.notes ? ' · Notes ready' : '') + '</span>') + '</span>';
        var btn = live ? '<span class="ch-btn">Join</span>' : (a.notes ? '<span class="ch-btn">Open notes</span>' : '');
        return '<a class="ch-card ch-meet' + (live ? '' : ' ch-meet--ended') + '" href="' + esc(live ? a.url : (a.notes_url || a.url)) + '" target="_blank" rel="noopener">' + inner + btn + '</a>';
      }
      if (a.type === 'file') {
        if (/^image\//.test(a.mime || '')) return '<a href="' + esc(a.url) + '" target="_blank" rel="noopener"><img class="ch-img" src="' + esc(a.url) + '" alt="' + esc(a.name) + '" loading="lazy" /></a>';
        var kk = /pdf/.test(a.mime || '') ? 'pdf' : /sheet|excel|csv/.test(a.mime || '') ? 'sheet' : /word|document/.test(a.mime || '') ? 'doc' : 'file';
        return '<a class="ch-card ch-file" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-file__ic" data-k="' + kk + '">' + ({ pdf: 'PDF', sheet: 'XLS', doc: 'DOC', file: 'FILE' }[kk]) + '</span><span class="ch-file__t"><span class="ch-card__t">' + esc(a.name) + '</span><span class="ch-card__m">' + esc(sizeOf(a.size)) + '</span></span><span class="ch-btn ch-btn--sm">Download</span></a>';
      }
      if (a.type === 'link') {
        return '<a class="ch-card ch-link" href="' + esc(a.url) + '" target="_blank" rel="noopener"><span class="ch-card__m">' + esc(a.host || '') + '</span><span class="ch-card__t">' + esc(a.title || a.url) + '</span>' + (a.desc ? '<span class="ch-card__s">' + esc(a.desc) + '</span>' : '') + '</a>';
      }
      return '';
    }
    function sizeOf(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

    /* A Favor Brain answer only its asker can read: a label, and Share to channel / Dismiss once the answer is in. */
    function privateHtml(m) {
      var b = m.brain || {};
      var ready = b.status === 'done';
      return '<div class="ch-private" data-private="' + m.id + '"><span class="ch-private__tag">' + ic('lock') + 'Only visible to you</span>' +
        (b.status === 'thinking' ? '' : '<span class="ch-private__acts">' + (ready ? '<button type="button" class="ch-btn ch-btn--sm ch-btn--primary" data-act="share-answer" data-id="' + m.id + '">Share to channel</button>' : '') + '<button type="button" class="ch-btn ch-btn--sm" data-act="dismiss-answer" data-id="' + m.id + '">Dismiss</button></span>') + '</div>';
    }
    function brainHtml(m) {
      var b = m.brain || {};
      if (b.status === 'thinking') return '<div class="ch-ans"><span class="ch-ans__live"><i></i><i></i><i></i>Reading the records</span></div>';
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
        return '<button type="button" class="ch-rx' + (mine ? ' is-mine' : '') + '" data-act="react" data-id="' + m.id + '" data-e="' + esc(r.emoji) + '" title="' + esc(r.users.map(function (u) { return user(u).name; }).join(', ')) + '" aria-pressed="' + mine + '"><span>' + r.emoji + '</span>' + r.users.length + '</button>';
      }).join('') + '<button type="button" class="ch-rx ch-rx--add" data-act="react-pick" data-id="' + m.id + '" aria-label="Add a reaction">' + ic('smile') + '</button></div>';
    }
    function msgHtml(m, o) {
      o = o || {};
      var u = user(m.user_id), mine = m.user_id === S.me.id, brain = m.user_id === 'brain';
      var cls = 'ch-msg' + (o.cont ? ' ch-msg--cont' : '') + (brain ? ' ch-msg--brain' : '') + (mentionsMe(m) && !mine ? ' is-mention' : '');
      var gut = o.cont ? '<span class="ch-msg__time">' + esc(timeOf(m.created_at).replace(/ (AM|PM)/, '')) + '</span>' : avatar(u, '', false);
      var meta = o.cont ? '' : '<div class="ch-msg__meta"><span class="ch-msg__name">' + esc(u.name) + '</span>' + (brain ? '<span class="ch-tag">Brain</span>' + (m.brain && m.brain.shared_by ? '<span class="ch-shared">Shared by ' + esc(user(m.brain.shared_by).name) + '</span>' : '') : m.user_id === 'meetings' ? '<span class="ch-tag" style="background:var(--tc-teal-tint);color:var(--tc-teal-ink)">Meeting</span>' : '') + '<span class="ch-msg__time">' + esc(timeOf(m.created_at)) + '</span></div>';
      var text;
      if (m.deleted) text = '<div class="ch-msg__text ch-msg__deleted">This message was deleted.</div>';
      else if (S.editing === m.id) text = '<div class="ch-edit"><textarea class="ch-input" data-edit="' + m.id + '" rows="2" style="height:auto;padding:8px 12px">' + esc(S.editDraft != null && S.editDraftId === m.id ? S.editDraft : m.body) + '</textarea><div style="display:flex;gap:8px;margin-top:6px"><button class="ch-btn ch-btn--sm ch-btn--primary" data-act="edit-save" data-id="' + m.id + '">Save</button><button class="ch-btn ch-btn--sm" data-act="edit-cancel">Cancel</button></div></div>';
      else text = (m.body ? '<div class="ch-msg__text">' + fmtBody(m.body) + (m.edited_at ? '<span class="ch-msg__edited">(edited)</span>' : '') + '</div>' : '');
      var cards = '';
      if (!m.deleted && m.attachments && m.attachments.length) cards = '<div class="ch-cards">' + m.attachments.map(cardHtml).join('') + '</div>';
      var br = !m.deleted && brain ? brainHtml(m) : '';
      var own = !m.deleted && m.visible_to ? privateHtml(m) : '';
      var rx = m.deleted ? '' : rxHtml(m);
      var rep = '';
      if (!o.inThread && m.reply_count) {
        rep = '<button type="button" class="ch-replies" data-act="thread" data-id="' + m.id + '"><span class="ch-stack">' + (m.reply_users || []).slice(0, 3).map(function (id) { return avatar(user(id), 'xs'); }).join('') + '</span>' + plural(m.reply_count, 'reply', 'replies') + '<small>Last reply ' + esc(ago(m.last_reply_at)) + '</small></button>';
      }
      var bar = '';
      if (!m.deleted && !m.visible_to) {
        bar = '<div class="ch-bar" role="toolbar" aria-label="Message actions"><button type="button" data-act="react-pick" data-id="' + m.id + '" aria-label="React" title="React">' + ic('smile') + '</button>' +
          (o.inThread ? '' : '<button type="button" data-act="thread" data-id="' + m.id + '" aria-label="Reply in thread" title="Reply in thread">' + ic('reply') + '</button>') +
          (mine ? '<button type="button" data-act="edit" data-id="' + m.id + '" aria-label="Edit" title="Edit">' + ic('edit') + '</button><button type="button" data-act="del" data-id="' + m.id + '" aria-label="Delete" title="Delete">' + ic('trash') + '</button>' : '') + '</div>';
      }
      return '<article class="' + cls + '" data-mid="' + m.id + '"><div class="ch-msg__gut">' + gut + '</div><div class="ch-msg__body">' + meta + text + cards + br + own + rx + rep + '</div>' + bar + '</article>';
    }
    function listHtml(list, o) {
      o = o || {};
      var out = '', prev = null, newShown = false, lr = o.lastRead;
      list.forEach(function (m) {
        var dk = dayKey(m.created_at);
        if (!prev || dayKey(prev.created_at) !== dk) out += '<div class="ch-day"><span>' + esc(dayLabel(m.created_at)) + '</span></div>';
        if (!newShown && lr != null && Number(m.id) > Number(lr) && m.user_id !== S.me.id) { out += '<div class="ch-new" id="ch-new">New</div>'; newShown = true; }
        var cont = prev && prev.user_id === m.user_id && dayKey(prev.created_at) === dk && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60000 && !m.deleted && !prev.deleted && !(prev.reply_count && !o.inThread);
        out += msgHtml(m, { cont: cont, inThread: o.inThread });
        prev = m;
      });
      return out;
    }

    /* ------------------------------------------------------------------ chrome */
    function composerHtml(scope, placeholder) {
      return '<form class="ch-comp" data-scope="' + scope + '" autocomplete="off"><div class="ch-comp__box"><div class="ch-pend" data-pend="' + scope + '" hidden></div>' +
        '<textarea rows="1" data-ta="' + scope + '" placeholder="' + esc(placeholder) + '" aria-label="' + esc(placeholder) + '" enterkeyhint="send"></textarea>' +
        '<div class="ch-comp__bar"><button type="button" class="ch-iconbtn" data-act="plus" data-scope="' + scope + '" aria-label="Add to the message" title="Add a file, Drive file, clip or meeting">' + ic('plus') + '</button>' +
        '<button type="button" class="ch-iconbtn" data-act="at" data-scope="' + scope + '" aria-label="Mention someone" title="Mention someone">' + ic('at') + '</button>' +
        '<button type="button" class="ch-iconbtn" data-act="emoji" data-scope="' + scope + '" aria-label="Emoji" title="Emoji">' + ic('smile') + '</button>' +
        '<button type="button" class="ch-iconbtn" data-act="ask-brain" data-scope="' + scope + '" aria-label="Ask Favor Brain" title="Ask Favor Brain">' + ic('spark') + '</button>' +
        '<span class="ch-comp__sp"></span><button type="submit" class="ch-send" data-send="' + scope + '" disabled aria-label="Send">' + ic('send') + '<span>Send</span></button></div></div></form>';
    }
    function frameHtml() {
      return '<aside class="ch-side" aria-label="Channels"></aside>' +
        '<section class="ch-main" aria-label="Channel"><header class="ch-head"></header><div class="ch-msgs" tabindex="0" aria-live="polite"></div><div class="ch-typing" aria-live="polite"></div>' + composerHtml('main', 'Message') + '</section>' +
        '<aside class="ch-right" hidden></aside>';
    }

    function renderSide() {
      var s = sortedChannels(), side = $('.ch-side', root);
      var row = function (c) {
        var unread = c.unread > 0, on = c.id === S.active;
        var icon, n = chName(c);
        if (c.kind === 'public') icon = '<span class="ch-row__ic">#</span>';
        else if (c.kind === 'private') icon = '<span class="ch-row__ic">' + ic('lock') + '</span>';
        else if (c.kind === 'dm') { var o = (c.members || []).filter(function (m) { return m !== S.me.id; })[0] || S.me.id; icon = '<span class="ch-row__ic">' + avatar(user(o), 'xs', true) + '</span>'; }
        else icon = '<span class="ch-row__ic">' + ic('users') + '</span>';
        var self = c.kind === 'dm' && (c.members || []).every(function (m) { return m === S.me.id; });
        return '<button type="button" class="ch-row' + (on ? ' is-on' : '') + (unread && !c.muted ? ' is-unread' : '') + (c.muted ? ' is-muted' : '') + '" data-act="open" data-id="' + c.id + '"' + (on ? ' aria-current="true"' : '') + '>' + icon + '<span class="ch-row__n">' + esc(n) + (self ? ' (you)' : '') + '</span>' + (c.mentions > 0 ? '<span class="ch-badge" aria-label="' + plural(c.mentions, 'mention') + '">' + c.mentions + '</span>' : '') + '</button>';
      };
      side.innerHTML = '<div class="ch-side__head"><button type="button" class="ch-jump" data-act="search">' + ic('search') + '<span>Search</span><kbd>Ctrl K</kbd></button><button type="button" class="ch-iconbtn" data-act="new-dm" aria-label="New message" title="New message">' + ic('pen') + '</button></div>' +
        '<div class="ch-list"><div class="ch-sec"><div class="ch-sec__h"><b>Channels</b><button type="button" class="ch-iconbtn" data-act="new-channel" aria-label="New channel" title="New channel">' + ic('plus') + '</button></div>' +
        s.chans.map(row).join('') + '<button type="button" class="ch-row ch-more" data-act="browse"><span class="ch-row__ic">' + ic('search') + '</span><span class="ch-row__n">Browse channels</span></button></div>' +
        '<div class="ch-sec"><div class="ch-sec__h"><b>Direct messages</b><button type="button" class="ch-iconbtn" data-act="new-dm" aria-label="New message" title="New message">' + ic('plus') + '</button></div>' + (s.dms.length ? s.dms.map(row).join('') : '<div class="ch-empty" style="padding:8px">No messages yet</div>') + '</div></div>';
    }
    function renderHead() {
      var c = chan(S.active), h = $('.ch-head', root);
      if (!c) { h.innerHTML = ''; return; }
      var name = chName(c), ms = (c.members || []).slice(0, 4);
      var lead = c.kind === 'public' ? '<span>#</span>' : c.kind === 'private' ? ic('lock') : '';
      h.innerHTML = '<button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to channels">' + ic('back') + '</button>' +
        '<div class="ch-head__t"><div class="ch-head__name">' + lead + '<span style="color:var(--r-ink);font-weight:700">' + esc(name) + '</span></div>' + (c.topic ? '<div class="ch-head__topic">' + esc(c.topic) + '</div>' : '') + '</div>' +
        '<div class="ch-head__acts"><button type="button" class="ch-members" data-act="details" aria-label="Members"><span class="ch-stack">' + ms.map(function (id) { return avatar(user(id), 'sm'); }).join('') + '</span>' + (c.members || []).length + '</button>' +
        '<button type="button" class="ch-btn ch-btn--meet" data-act="meeting">' + ic('video') + '<span>Start a meeting</span></button>' +
        '<button type="button" class="ch-iconbtn ch-hide-m" data-act="search" aria-label="Search" title="Search">' + ic('search') + '</button>' +
        '<button type="button" class="ch-iconbtn' + (S.right === 'details' ? ' is-on' : '') + '" data-act="details" aria-label="Channel details" title="Channel details">' + ic('info') + '</button></div>';
      $('[data-ta="main"]', root).placeholder = c.kind === 'dm' || c.kind === 'group' ? 'Message ' + name : 'Message ' + (c.kind === 'public' ? '#' : '') + name;
    }
    function introHtml(c) {
      var n = chName(c);
      if (c.kind === 'dm') return '<div class="ch-intro"><h2>' + esc(n) + '</h2><p>This is the start of your conversation with ' + esc(n) + '.</p></div>';
      if (c.kind === 'group') return '<div class="ch-intro"><h2>' + esc(n) + '</h2><p>This is the start of the group conversation.</p></div>';
      return '<div class="ch-intro"><h2># ' + esc(n) + '</h2><p>' + esc(c.topic || 'The start of the channel.') + '</p></div>';
    }
    function renderMsgs(forceBottom) {
      var box = $('.ch-msgs', root), c = chan(S.active);
      if (!c) return;
      var list = S.msgs[c.id];
      var near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
      if (!list) { box.innerHTML = '<div class="ch-skel"><i style="width:30%"></i><i style="width:80%"></i><i style="width:55%"></i><i style="width:70%"></i></div>'; return; }
      box.innerHTML = (S.hasMore[c.id] ? '<div style="text-align:center;padding:10px"><button type="button" class="ch-btn ch-btn--sm" data-act="older">Load earlier messages</button></div>' : introHtml(c)) + listHtml(list, { lastRead: S.lastRead[c.id] });
      if (forceBottom || near) {
        var nw = forceBottom === 'unread' ? $('#ch-new', box) : null;
        if (nw) box.scrollTop = Math.max(0, nw.offsetTop - 60); else box.scrollTop = box.scrollHeight;
      }
    }
    function renderTyping() {
      var el = $('.ch-typing', root), t = S.typing[S.active] || {}, now = Date.now();
      var names = Object.keys(t).filter(function (id) { return id !== S.me.id && now - t[id] < 5000; }).map(function (id) { return user(id).name.split(' ')[0]; });
      el.innerHTML = names.length ? '<i></i><i></i><i></i><span>' + esc(names.length === 1 ? names[0] + ' is typing' : names.length === 2 ? names.join(' and ') + ' are typing' : 'Several people are typing') + '</span>' : '';
    }
    function renderRight() {
      var el = $('.ch-right', root), c = chan(S.active);
      root.dataset.right = S.right;
      if (S.right === 'none' || !c) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      var oldTb = $('.ch-thread__body', el);
      S.threadScroll = oldTb ? { top: oldTb.scrollTop, bottom: oldTb.scrollHeight - oldTb.scrollTop - oldTb.clientHeight < 80 } : null;
      if (S.right === 'thread') {
        var t = S.threads[S.threadRoot];
        var head = '<div class="ch-right__head"><button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel">' + ic('back') + '</button><div><b>Thread</b><small>' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</small></div><button type="button" class="ch-iconbtn" data-act="close-right" aria-label="Close the thread">' + ic('x') + '</button></div>';
        var body = !t ? '<div class="ch-skel"><i style="width:60%"></i><i style="width:85%"></i></div>' :
          msgHtml(t.root, { inThread: true }) + (t.replies.length ? '<div class="ch-thread__n">' + plural(t.replies.length, 'reply', 'replies') + '</div>' : '') + listHtml(t.replies, { inThread: true });
        var keep = el.dataset.mode === 'thread' && el.dataset.root === String(S.threadRoot) && $('.ch-comp', el);
        if (keep) { $('.ch-thread__body', el).innerHTML = body; }
        else { el.innerHTML = head + '<div class="ch-thread__body">' + body + '</div><div class="ch-typing"></div>' + composerHtml('thread', 'Reply'); el.dataset.mode = 'thread'; el.dataset.root = String(S.threadRoot); }
        var tb = $('.ch-thread__body', el);
        if (S.threadSeen === S.threadRoot && S.threadScroll != null) tb.scrollTop = S.threadScroll.bottom ? tb.scrollHeight : S.threadScroll.top; else tb.scrollTop = 0;
        S.threadSeen = S.threadRoot;
        syncSend('thread'); if (!keep) renderPending('thread');
      } else {
        el.dataset.mode = 'details'; el.dataset.root = '';
        var members = (c.members || []).map(function (id) { return user(id); });
        var tabs = '<div class="ch-tabs" role="tablist">' + [['about', 'About'], ['members', 'Members ' + members.length], ['files', 'Files']].map(function (x) { return '<button type="button" role="tab" data-act="tab" data-tab="' + x[0] + '" class="' + (S.tab === x[0] ? 'is-on' : '') + '" aria-selected="' + (S.tab === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
        var det = '';
        var canEdit = c.kind === 'public' || c.kind === 'private';
        if (S.tab === 'about') {
          det = '<h4>Topic</h4>' + (canEdit ? '<input class="ch-input" data-topic value="' + esc(c.topic || '') + '" placeholder="Add a topic" maxlength="200" aria-label="Topic" />' : '<p>' + esc(c.topic || 'None') + '</p>') +
            '<h4>Created</h4><p>' + esc(fmtShort.format(new Date(c.created_at || Date.now()))) + (c.created_by ? ' by ' + esc(user(c.created_by).name) : '') + '</p>' +
            (canEdit ? '<h4>Visibility</h4><p>' + (c.kind === 'private' ? 'Private. Only the members below can read it.' : 'Public. Any admin can find and join it.') + '</p>' : '') +
            '<div class="ch-det__acts">' + (c.kind !== 'dm' ? '<button type="button" class="ch-btn ch-btn--danger" data-act="leave">' + ic('out') + 'Leave ' + (c.kind === 'group' ? 'conversation' : 'channel') + '</button>' : '') + '<button type="button" class="ch-btn" data-act="mute">' + ic('bell') + (c.muted ? 'Unmute' : 'Mute') + '</button></div>';
        } else if (S.tab === 'members') {
          det = (c.kind === 'dm' ? '' : '<button type="button" class="ch-btn ch-btn--sm" data-act="add-members" style="margin-bottom:8px">' + ic('plus') + 'Add people</button>') + members.map(function (u) {
            return '<div class="ch-person">' + avatar(u, '', true) + '<span><b>' + esc(u.name) + (u.id === S.me.id ? ' (you)' : '') + '</b><small>' + esc(u.title || (u.presence === 'online' ? 'Active now' : u.presence === 'away' ? 'Away' : 'Offline')) + '</small></span>' + (c.created_by === u.id ? '<span class="ch-person__r">Created it</span>' : '') + '</div>';
          }).join('');
        } else {
          var files = []; (S.msgs[c.id] || []).forEach(function (m) { (m.attachments || []).forEach(function (a) { if (a.type !== 'link') files.push({ a: a, m: m }); }); });
          det = files.length ? files.reverse().map(function (f) { return '<div style="margin-bottom:8px">' + cardHtml(f.a).replace('class="ch-card', 'class="ch-card') + '<div class="ch-card__m" style="margin:2px 2px 0">' + esc(user(f.m.user_id).name) + ' · ' + esc(ago(f.m.created_at)) + '</div></div>'; }).join('') : '<div class="ch-empty">No files shared yet</div>';
        }
        el.innerHTML = '<div class="ch-right__head"><button type="button" class="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel">' + ic('back') + '</button><div><b>' + (c.kind === 'public' ? '# ' : '') + esc(chName(c)) + '</b><small>Details</small></div><button type="button" class="ch-iconbtn" data-act="close-right" aria-label="Close details">' + ic('x') + '</button></div>' + tabs + '<div class="ch-det">' + det + '</div>';
      }
    }
    function setView(v) {
      S.view = v; root.dataset.view = v;
      document.body.classList.toggle('ch-deep', v !== 'list');
      measure();
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
    function renderAll(bottom) { renderSide(); renderHead(); renderMsgs(bottom); renderTyping(); renderRight(); syncSend('main'); }

    /* ------------------------------------------------------------------ actions */
    function openChannel(id, o) {
      o = o || {};
      if (!chan(id)) return;
      var changed = S.active !== id;
      S.active = id; try { localStorage.setItem('favor.chat.last', id); } catch (e) { /* private mode */ }
      if (changed) { S.right = S.right === 'details' ? 'details' : 'none'; S.threadRoot = null; S.editing = null; }
      if (opts.onOpen) opts.onOpen(id);
      var c = chan(id);
      S.lastRead[id] = c.last_read != null ? c.last_read : S.lastRead[id];
      setView('channel');
      if (isPhone() && !o.pop) history.pushState({ chv: 'channel' }, '');
      renderAll('unread');
      if (!S.msgs[id]) {
        guard(api.history(id)).then(function (r) {
          S.msgs[id] = r.messages; S.hasMore[id] = !!r.more;
          if (S.active === id) { renderMsgs('unread'); markRead(); }
        });
      } else markRead();
      if (!isPhone()) setTimeout(function () { var ta = $('[data-ta="main"]', root); if (ta) ta.focus(); }, 0);
    }
    function markRead() {
      var c = chan(S.active), list = S.msgs[S.active];
      if (!c || !list || !list.length || document.hidden) return;
      var last = list[list.length - 1].id;
      if (c.unread || c.mentions || Number(c.last_read || 0) < Number(last)) {
        c.unread = 0; c.mentions = 0; c.last_read = last;
        api.read(S.active, last); renderSide(); if (opts.onUnread) opts.onUnread(totalUnread());
      }
    }
    function totalUnread() { var n = 0, m = 0; Object.keys(S.channels).forEach(function (k) { var c = S.channels[k]; if (c.joined === false || c.muted) return; n += c.unread > 0 ? 1 : 0; m += c.mentions || 0; }); return { channels: n, mentions: m }; }
    function openThread(id) {
      id = Number(id);
      S.right = 'thread'; S.threadRoot = id; S.editing = null;
      var found = (S.msgs[S.active] || []).filter(function (m) { return String(m.id) === String(id); })[0];
      if (found && !S.threads[id]) S.threads[id] = { root: found, replies: [] };
      setView('thread');
      if (isPhone()) history.pushState({ chv: 'thread' }, '');
      renderRight();
      guard(api.thread(id)).then(function (t) { S.threads[id] = t; if (S.threadRoot === id) { renderRight(); } });
      if (!isPhone()) setTimeout(function () { var ta = $('[data-ta="thread"]', root); if (ta) ta.focus(); }, 0);
    }
    function closeRight() { S.right = 'none'; S.threadRoot = null; S.threadSeen = null; setView('channel'); renderRight(); renderHead(); }
    function openDetails(tab) {
      if (S.right === 'details' && !isPhone() && !tab) return closeRight();
      S.right = 'details'; S.tab = tab || 'about'; setView('details');
      if (isPhone()) history.pushState({ chv: 'details' }, '');
      renderRight(); renderHead();
    }
    function back() {
      if (isPhone() && history.state && history.state.chv) return history.back();
      if (S.view === 'thread' || S.view === 'details') return closeRight();
      setView('list');
    }

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
        return '<span class="ch-pend__i">' + ic(iconName) + '<span>' + esc(label) + (a.uploading ? ' (uploading)' : '') + '</span><button type="button" data-act="unpend" data-scope="' + scope + '" data-i="' + i + '" aria-label="Remove">' + ic('x') + '</button></span>';
      }).join('');
      syncSend(scope);
    }
    function send(scope) {
      var c = chan(S.active); if (!c) return;
      var ta = $('[data-ta="' + scope + '"]', root), raw = ta.value, body = tokenize(scope, raw).trim();
      var att = S.pending[scope].filter(function (a) { return !a.uploading; });
      if (S.pending[scope].some(function (a) { return a.uploading; })) { toast('Wait for the upload to finish'); return; }
      if (!body && !att.length) return;
      ta.value = ''; grow(ta); S.pending[scope] = []; S.mentionMap[scope] = {}; renderPending(scope); closePop();
      var thread = scope === 'thread' ? S.threadRoot : null;
      guard(api.send(S.active, { body: body, thread_id: thread, attachments: att })).then(function (m) { addMessage(m, true); }).catch(function () { ta.value = raw; grow(ta); syncSend(scope); });
    }
    function addMessage(m, mine) {
      var ch = chan(m.channel_id); if (!ch) { resync(); return; }
      ch.last_at = m.created_at;
      if (m.thread_id) {
        var root = (S.msgs[m.channel_id] || []).filter(function (x) { return String(x.id) === String(m.thread_id); })[0];
        if (root && !m.visible_to) { root.reply_count = (root.reply_count || 0) + (hasMsg(S.threads[m.thread_id], m.id) ? 0 : 1); root.last_reply_at = m.created_at; root.reply_users = (root.reply_users || []).filter(function (u) { return u !== m.user_id; }).concat([m.user_id]).slice(-3); }
        var t = S.threads[m.thread_id];
        if (t && !hasMsg(t, m.id)) t.replies.push(m);
        if (S.active === m.channel_id) { renderMsgs(false); if (S.threadRoot === m.thread_id) { renderRight(); } }
        if (!m.visible_to) notifyIfNeeded(m, ch);
        return;
      }
      var list = S.msgs[m.channel_id];
      if (list) { if (list.some(function (x) { return String(x.id) === String(m.id); })) return; list.push(m); }
      if (S.active === m.channel_id && !document.hidden) { renderMsgs(mine ? true : false); if (!mine) markRead(); else { ch.last_read = m.id; api.read(m.channel_id, m.id); } renderSide(); }
      else { renderSide(); }
      if (!m.visible_to) notifyIfNeeded(m, ch);
    }
    function hasMsg(t, id) { return !!t && (t.replies || []).some(function (x) { return String(x.id) === String(id); }); }
    function notifyIfNeeded(m, ch) {
      if (m.user_id === S.me.id) return;
      var viewing = S.active === m.channel_id && !document.hidden;
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

    function plusMenu(scope, anchor) {
      var it = function (act, icon, tint, ink, t, sub) { return '<button type="button" class="ch-pop__i" role="menuitem" data-act="' + act + '" data-scope="' + scope + '"><b style="background:' + tint + ';color:' + ink + '">' + ic(icon) + '</b><span>' + t + '<small>' + sub + '</small></span></button>'; };
      openPop(it('upload', 'clip', 'var(--tc-slate-tint)', 'var(--tc-slate-ink)', 'Upload a file', 'From this computer') +
        it('drive-pick', 'drive', 'var(--tc-sky-tint)', 'var(--tc-sky-ink)', 'Share from Drive', 'Search the Drive library') +
        it('clip-pick', 'rec', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Share a clip', 'Pick from your clips') +
        it('clip-rec', 'play', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Record a clip', 'Posts here when you finish') +
        it('meeting', 'video', 'var(--tc-teal-tint)', 'var(--tc-teal-ink)', 'Start a meeting', 'Posts a Join card'), anchor, 'ch-pop--menu');
    }
    function emojiPicker(anchor, cb) {
      var p = openPop(EMOJI.map(function (e) { return '<button type="button" data-e="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join(''), anchor, 'ch-pop--emoji');
      p.addEventListener('click', function (ev) { var b = ev.target.closest('button[data-e]'); if (b) { cb(b.dataset.e); closePop(); } });
    }
    function mentionCandidates(q, c) {
      q = q.toLowerCase();
      var ids = (c.kind === 'public' ? Object.keys(S.users) : (c.members || [])).filter(function (id) { return id !== S.me.id; });
      var out = [{ id: 'brain', name: 'Favor Brain', sub: 'Ask a question about Favor records', brain: true }];
      if (c.kind === 'public' || c.kind === 'private' || c.kind === 'group') out.push({ id: 'channel', name: 'channel', sub: 'Notify everyone here', special: true });
      ids.forEach(function (id) { var u = user(id); out.push({ id: id, name: u.name, sub: u.title || '', u: u }); });
      return out.filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 7);
    }
    var mentionState = null;
    function updateMention(ta) {
      var scope = ta.dataset.ta, pos = ta.selectionStart, before = ta.value.slice(0, pos);
      var m = before.match(/(^|\s)@([\w .'-]{0,24})$/);
      if (!m) { if (mentionState) { closePop(); mentionState = null; } return; }
      var c = chan(S.active), cands = mentionCandidates(m[2], c);
      if (!cands.length) { closePop(); mentionState = null; return; }
      mentionState = { scope: scope, start: pos - m[2].length - 1, end: pos, cands: cands, i: 0 };
      var p = openPop('<div class="ch-pop__h">People</div>' + cands.map(function (o, i) { return '<button type="button" class="ch-pop__i' + (i === 0 ? ' is-on' : '') + '" role="option" data-act="mention-pick" data-i="' + i + '"><b style="background:transparent">' + (o.brain ? '<span class="ch-av ch-av--sm ch-av--brain">' + ic('spark') + '</span>' : o.special ? '<span class="ch-av ch-av--sm" data-c="sun">@</span>' : avatar(o.u, 'sm')) + '</b><span>' + esc(o.name) + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</span></button>'; }).join(''), ta.closest('.ch-comp__box'), 'ch-pop--mention');
      popAnchor = ta;
    }
    function pickMention(i) {
      var st = mentionState; if (!st) return;
      var o = st.cands[i], ta = $('[data-ta="' + st.scope + '"]', root);
      var label = '@' + o.name;
      S.mentionMap[st.scope][label] = '<@' + o.id + '>';
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
            return '<button type="button" class="ch-pick__i" data-act="drive-choose" data-i="' + i + '"><span class="ch-file__ic" data-k="' + esc(f.kind || 'file') + '" style="width:36px;height:36px;font-size:10px">' + lab + '</span><span><b>' + esc(f.name) + '</b><small>' + esc(f.path || '') + (f.indexed ? ' · Indexed ' + esc(f.indexed) : '') + '</small></span></button>';
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
        $('[data-br]', m).innerHTML = m._items.length ? m._items.map(function (c, i) { return '<button type="button" class="ch-pick__i" data-act="browse-open" data-i="' + i + '"><span class="ch-row__ic" style="font-size:20px">#</span><span><b>' + esc(c.name) + '</b><small>' + esc(c.topic || '') + ' ' + plural(c.member_count || 0, 'member') + '</small></span>' + (chan(c.id) && chan(c.id).joined !== false ? '<span class="ch-badge">Joined</span>' : '<span class="ch-btn ch-btn--sm">Join</span>') + '</button>'; }).join('') : '<div class="ch-empty">No other channels</div>';
      });
    }

    /* ------------------------------------------------------------------ search */
    function openSearch() {
      closePop(); closeModal();
      var box = $('.ch-search', root); if (box) box.remove();
      box = document.createElement('div'); box.className = 'ch-search';
      box.innerHTML = '<div class="ch-search__box" role="dialog" aria-label="Search messages"><div class="ch-search__in"><button type="button" class="ch-iconbtn ch-back" data-act="search-x" aria-label="Close search">' + ic('back') + '</button>' + ic('search') + '<input data-sq placeholder="Search messages and files" aria-label="Search messages" autocomplete="off" /><button type="button" class="ch-iconbtn" data-act="search-x" aria-label="Close search">' + ic('x') + '</button></div>' +
        '<div class="ch-search__f"><button type="button" class="is-on" data-sf="all">Everywhere</button><button type="button" data-sf="here">In this conversation</button><button type="button" data-sf="files">With files</button><button type="button" data-sf="mine">Mentions of me</button></div>' +
        '<div class="ch-search__res" data-sres><div class="ch-empty">Search every conversation you are in</div></div><div class="ch-search__foot"><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div>';
      root.appendChild(box);
      S.search = { filter: 'all', items: [], i: 0 };
      var q = $('[data-sq]', box); q.focus();
      var t = 0;
      var run = function () {
        var v = q.value.trim(), res = $('[data-sres]', box);
        if (v.length < 2) { res.innerHTML = '<div class="ch-empty">Search every conversation you are in</div>'; S.search.items = []; return; }
        guard(api.search(v, { filter: S.search.filter, channel: S.active })).then(function (r) {
          if (q.value.trim() !== v) return;
          S.search.items = r.results || []; S.search.i = 0;
          var rx = new RegExp('(' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
          res.innerHTML = S.search.items.length ? S.search.items.map(function (h, i) {
            var cname = chan(h.channel_id) ? chName(chan(h.channel_id)) : h.channel_name || '';
            var kind = chan(h.channel_id) ? chan(h.channel_id).kind : 'public';
            var plain = String(h.body || '').replace(/<@([^>]+)>/g, function (_, id) { return '@' + (id === 'brain' ? 'Favor Brain' : user(id).name); }).replace(/<#[^>]+>/g, '');
            return '<button type="button" class="ch-hit' + (i === 0 ? ' is-on' : '') + '" data-act="hit" data-i="' + i + '">' + avatar(user(h.user_id)) + '<span><span class="ch-hit__m"><b>' + esc(user(h.user_id).name) + '</b><span>' + (kind === 'public' ? '#' : '') + esc(cname) + ' · ' + esc(fmtShort.format(new Date(h.created_at))) + ', ' + esc(timeOf(h.created_at)) + '</span></span><span class="ch-hit__t">' + esc(plain).replace(rx, '<mark>$1</mark>') + '</span></span></button>';
          }).join('') : '<div class="ch-empty">Nothing found for “' + esc(v) + '”</div>';
        });
      };
      q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(run, 200); });
      box.addEventListener('click', function (e) {
        var f = e.target.closest('[data-sf]');
        if (f) { S.search.filter = f.dataset.sf; box.querySelectorAll('[data-sf]').forEach(function (b) { b.classList.toggle('is-on', b === f); }); run(); }
        if (e.target === box) closeSearch();
      });
      q.addEventListener('keydown', function (e) {
        var hits = box.querySelectorAll('.ch-hit');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.search.i = Math.max(0, Math.min(hits.length - 1, S.search.i + (e.key === 'ArrowDown' ? 1 : -1))); hits.forEach(function (h, i) { h.classList.toggle('is-on', i === S.search.i); }); if (hits[S.search.i]) hits[S.search.i].scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter' && S.search.items[S.search.i]) { e.preventDefault(); jumpTo(S.search.items[S.search.i]); }
      });
    }
    function closeSearch() { var b = $('.ch-search', root); if (b) b.remove(); S.search = null; }
    function jumpTo(h) {
      closeSearch();
      var go = function () {
        var list = S.msgs[h.channel_id] || [];
        var target = h.thread_id || h.id;
        if (h.thread_id) openThread(h.thread_id);
        else {
          var el = root.querySelector('.ch-msgs [data-mid="' + h.id + '"]');
          if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('is-flash'); }
          else if (list.length) toast('That message is further back');
        }
      };
      if (S.active !== h.channel_id) { openChannel(h.channel_id); var w = setInterval(function () { if (S.msgs[h.channel_id]) { clearInterval(w); go(); } }, 60); setTimeout(function () { clearInterval(w); }, 4000); }
      else go();
    }

    /* ------------------------------------------------------------------ events from the server */
    function onEvent(ev) {
      if (ev.type === 'message') addMessage(ev.message, ev.message.user_id === S.me.id);
      else if (ev.type === 'edit') patchMessage(ev.message);
      else if (ev.type === 'delete' && ev.purge) { purgeMessage(ev.id); }
      else if (ev.type === 'delete') { patchMessage(Object.assign({}, findMsg(ev.id) || { id: ev.id }, { deleted: true, body: '', attachments: [] })); }
      else if (ev.type === 'reaction') { var m = findMsg(ev.id); if (m) { m.reactions = ev.reactions; patchMessage(m); } }
      else if (ev.type === 'typing') { (S.typing[ev.channel_id] = S.typing[ev.channel_id] || {})[ev.user_id] = Date.now(); if (S.active === ev.channel_id) { renderTyping(); setTimeout(renderTyping, 5200); } }
      else if (ev.type === 'presence') { if (S.users[ev.user_id]) { S.users[ev.user_id].presence = ev.presence; renderSide(); if (S.right === 'details') renderRight(); } }
      else if (ev.type === 'channel') { var prev = S.channels[ev.channel.id]; S.channels[ev.channel.id] = Object.assign(prev || {}, ev.channel); renderSide(); if (S.active === ev.channel.id) { renderHead(); if (S.right === 'details') renderRight(); } }
      else if (ev.type === 'users') { Object.assign(S.users, ev.users); renderSide(); }
      else if (ev.type === 'conn') { setConn(ev.ok); }
      else if (ev.type === 'resync') { resync(); }
    }
    function resync() {
      if (S.resyncing) return;
      S.resyncing = true;
      api.boot().then(function (b) {
        S.users = Object.assign(S.users, b.users || {});
        (b.channels || []).forEach(function (c) { var prev = S.channels[c.id]; var keep = prev && c.id === S.active ? { unread: 0, mentions: 0 } : {}; S.channels[c.id] = Object.assign(prev || {}, c, keep); });
        renderSide(); renderHead();
        var id = S.active;
        if (id) api.history(id).then(function (r) { if (S.active !== id) return; S.msgs[id] = r.messages; S.hasMore[id] = !!r.more; renderMsgs(false); markRead(); });
        if (S.right === 'thread' && S.threadRoot) api.thread(S.threadRoot).then(function (t) { S.threads[S.threadRoot] = t; renderRight(); });
        if (opts.onUnread) opts.onUnread(totalUnread());
      }).catch(function () {}).then(function () { S.resyncing = false; });
    }
    function setConn(ok) {
      S.connected = ok; var el = $('.ch-conn', root);
      if (ok) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('div'); el.className = 'ch-conn'; el.textContent = 'Reconnecting'; root.appendChild(el); }
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
        var item = { type: 'file', name: f.name, size: f.size, mime: f.type, uploading: true };
        S.pending[scope].push(item); renderPending(scope);
        guard(api.upload(f)).then(function (r) { Object.assign(item, r, { uploading: false }); renderPending(scope); }).catch(function () { S.pending[scope] = S.pending[scope].filter(function (x) { return x !== item; }); renderPending(scope); });
      });
    }

    /* ------------------------------------------------------------------ DOM events */
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el) { if (e.target.closest('.ch-msg') && isPhone() && !e.target.closest('a,button,textarea')) { var mm = e.target.closest('.ch-msg'); var was = mm.classList.contains('is-actions'); root.querySelectorAll('.ch-msg.is-actions').forEach(function (x) { x.classList.remove('is-actions'); }); if (!was) mm.classList.add('is-actions'); } return; }
      var act = el.dataset.act, id = el.dataset.id, scope = el.dataset.scope;
      if (act === 'open') { closeSearch(); openChannel(id); }
      else if (act === 'back') back();
      else if (act === 'thread') openThread(id);
      else if (act === 'close-right') { if (isPhone() && history.state && history.state.chv) history.back(); else closeRight(); }
      else if (act === 'details') openDetails();
      else if (act === 'tab') { S.tab = el.dataset.tab; renderRight(); }
      else if (act === 'search') openSearch();
      else if (act === 'search-x') closeSearch();
      else if (act === 'hit') jumpTo(S.search.items[+el.dataset.i]);
      else if (act === 'react') { guard(api.react(id, el.dataset.e)).then(function (r) { var m = findMsg(id); if (m && r && r.reactions) { m.reactions = r.reactions; patchMessage(m); } }); }
      else if (act === 'react-pick') { emojiPicker(el, function (em) { guard(api.react(id, em)).then(function (r) { var m = findMsg(id); if (m && r && r.reactions) { m.reactions = r.reactions; patchMessage(m); } }); }); }
      else if (act === 'edit') { S.editing = Number(id) || id; S.editDraft = null; renderMsgs(false); if (S.right === 'thread') renderRight(); var ed = $('[data-edit]', root); if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); } }
      else if (act === 'edit-cancel') { S.editing = null; renderMsgs(false); if (S.right === 'thread') renderRight(); }
      else if (act === 'edit-save') { var ta2 = $('[data-edit="' + id + '"]', root); var v = tokenize('main', ta2.value).trim(); if (!v) return; S.editing = null; guard(api.edit(id, v)).then(function (m) { patchMessage(m); }); }
      else if (act === 'del') {
        var m0 = openModal('Delete message', '<p style="margin:4px 0 8px">This removes the message for everyone in the conversation.</p>', '<button type="button" class="ch-btn" data-act="modal-x">Cancel</button><button type="button" class="ch-btn ch-btn--primary" data-act="del-yes" data-id="' + id + '">Delete</button>');
      }
      else if (act === 'del-yes') { closeModal(); guard(api.del(id)).then(function () { var m = findMsg(id); patchMessage(Object.assign({}, m, { deleted: true, body: '', attachments: [] })); }); }
      else if (act === 'share-answer') { el.disabled = true; guard(api.shareAnswer(id)).then(function (r) { purgeMessage(id); if (r && r.message) addMessage(r.message, true); toast('Shared to the channel'); }).catch(function () { el.disabled = false; }); }
      else if (act === 'dismiss-answer') { el.disabled = true; guard(api.dismissAnswer(id)).then(function () { purgeMessage(id); }).catch(function () { el.disabled = false; }); }
      else if (act === 'plus') plusMenu(scope, el);
      else if (act === 'at') { insertAtCaret(scope, '@'); updateMention($('[data-ta="' + scope + '"]', root)); }
      else if (act === 'emoji') emojiPicker(el, function (em) { insertAtCaret(scope, em); });
      else if (act === 'ask-brain') { var ta3 = $('[data-ta="' + scope + '"]', root); S.mentionMap[scope]['@Favor Brain'] = '<@brain>'; if (ta3.value.indexOf('@Favor Brain') < 0) ta3.value = '@Favor Brain ' + ta3.value; ta3.focus(); grow(ta3); syncSend(scope); }
      else if (act === 'upload') { closePop(); var inp = $('[data-file]', root); inp.dataset.scope = scope; inp.click(); }
      else if (act === 'drive-pick') driveModal(scope);
      else if (act === 'clip-pick') clipModal(scope);
      else if (act === 'clip-rec') { closePop(); if (opts.recordClip) opts.recordClip(S.active, function (att) { S.pending[scope].push(att); renderPending(scope); }); else toast('Recording is not available here'); }
      else if (act === 'meeting') { closePop(); guard(api.startMeeting(S.active)).then(function (r) { if (r && r.message) addMessage(r.message, true); if (r && r.url) { toast(r.joined ? 'Joining the meeting' : 'Starting the meeting'); location.href = r.url; } }); }
      else if (act === 'drive-choose') { var it = modal._items[+el.dataset.i], sc = modal._scope; closeModal(); S.pending[sc].push(Object.assign({ type: 'drive' }, it)); renderPending(sc); var tt = $('[data-ta="' + sc + '"]', root); if (tt) tt.focus(); }
      else if (act === 'clip-choose') { var cl = modal._items[+el.dataset.i], sc2 = modal._scope; closeModal(); S.pending[sc2].push(Object.assign({ type: 'clip' }, cl)); renderPending(sc2); }
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
    root.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target) && e.target !== popAnchor && !(popAnchor && popAnchor.contains && popAnchor.contains(e.target))) { closePop(); mentionState = null; } });
    root.addEventListener('submit', function (e) { var f = e.target.closest('.ch-comp'); if (f) { e.preventDefault(); send(f.dataset.scope); } });
    root.addEventListener('input', function (e) {
      var ta = e.target.closest('[data-ta]');
      if (ta) {
        grow(ta); syncSend(ta.dataset.ta); updateMention(ta);
        if (Date.now() - typingSent > 3000 && ta.value) { typingSent = Date.now(); api.typing(S.active); }
      }
      var ed = e.target.closest('[data-edit]');
      if (ed) { S.editDraft = ed.value; S.editDraftId = Number(ed.dataset.edit); }
      var tp = e.target.closest('[data-topic]');
      if (tp) { clearTimeout(tp._t); tp._t = setTimeout(function () { api.setTopic(S.active, tp.value.trim()).then(function () { chan(S.active).topic = tp.value.trim(); renderHead(); }); }, 700); }
    });
    root.addEventListener('keydown', function (e) {
      var ta = e.target.closest('[data-ta]');
      if (e.target.closest('[data-edit]') && e.key === 'Escape') { S.editing = null; renderMsgs(false); return; }
      if (e.target.closest('[data-edit]') && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('[data-act="edit-save"]', root).click(); return; }
      if (!ta) { if (e.key === 'Escape') { if (modal) closeModal(); else if (S.search) closeSearch(); else if (pop) closePop(); } return; }
      var scope = ta.dataset.ta;
      if (mentionState && pop) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionState.i = (mentionState.i + (e.key === 'ArrowDown' ? 1 : mentionState.cands.length - 1)) % mentionState.cands.length; pop.querySelectorAll('.ch-pop__i').forEach(function (b, i) { b.classList.toggle('is-on', i === mentionState.i); }); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionState.i); return; }
        if (e.key === 'Escape') { closePop(); mentionState = null; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isPhone()) { e.preventDefault(); send(scope); return; }
      if (e.key === 'ArrowUp' && !ta.value && scope === 'main') {
        var mine = (S.msgs[S.active] || []).filter(function (m) { return m.user_id === S.me.id && !m.deleted; }).pop();
        if (mine) { e.preventDefault(); S.editing = mine.id; renderMsgs(false); var ed = $('[data-edit]', root); if (ed) ed.focus(); }
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && root.isConnected) { e.preventDefault(); e.stopImmediatePropagation(); openSearch(); }
    }, true);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) markRead(); });
    window.addEventListener('focus', markRead);
    window.addEventListener('resize', measure);
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', measure); window.visualViewport.addEventListener('scroll', measure); }
    // Typing in the composer means writing the next message: while the keyboard is open the newest messages stay in view.
    window.addEventListener('hub-kb', function () {
      measure();
      if (!document.body.classList.contains('kb-open')) return;
      requestAnimationFrame(function () { [$('.ch-msgs', root), $('.ch-right .ch-thread__body', root)].forEach(function (b) { if (b) b.scrollTop = b.scrollHeight; }); });
    });
    // The hub reloads the page on any popstate it does not own. Chat's screens (list, channel, thread) own theirs, so this listener
    // runs first (capture, at the window) and keeps the hub out of it while a channel or thread is open.
    window.addEventListener('popstate', function (e) {
      if (!root.isConnected || S.view === 'list') return;
      e.stopImmediatePropagation();
      var v = e.state && e.state.chv;
      if (v === 'thread' && S.threadRoot) { setView('thread'); return; }
      if (v === 'channel') { S.right = 'none'; S.threadRoot = null; S.threadSeen = null; setView('channel'); renderRight(); renderHead(); return; }
      S.right = 'none'; S.threadRoot = null; S.threadSeen = null; setView('list'); renderRight();
    }, true);
    setInterval(function () { if (root.isConnected) renderTyping(); }, 2000);

    function focusMessage(id) {
      var tries = 0;
      var t = setInterval(function () {
        if (!S.msgs[S.active] && ++tries < 50) return;
        clearInterval(t);
        var el = root.querySelector('.ch-msgs [data-mid="' + id + '"]');
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('is-flash'); }
      }, 100);
    }

    /* ------------------------------------------------------------------ boot */
    root.classList.add('ch');
    root.innerHTML = frameHtml() + '<input type="file" data-file multiple hidden />';
    $('[data-file]', root).addEventListener('change', function (e) { addFiles(e.target.dataset.scope || 'main', e.target.files); e.target.value = ''; });
    api.onEvent(onEvent);
    return guard(api.boot()).then(function (b) {
      S.me = b.me; S.users = b.users || {}; S.users[S.me.id] = Object.assign({}, S.users[S.me.id] || {}, S.me);
      (b.channels || []).forEach(function (c) { S.channels[c.id] = c; });
      renderSide();
      var saved = null;
      try { saved = localStorage.getItem('favor.chat.last'); } catch (e) { /* private mode */ }
      var gen = sortedChannels().chans.filter(function (c) { return c.name === 'general'; })[0];
      var first = (opts.initial && chan(opts.initial) && opts.initial) || (saved && chan(saved) && chan(saved).joined !== false && saved) || (gen && gen.id) || (sortedChannels().chans[0] || sortedChannels().dms[0] || {}).id;
      setView(isPhone() ? 'list' : 'channel');
      if (first) { if (isPhone() && !opts.initial) { S.active = first; renderHead(); } else openChannel(first, { pop: true }); }
      if (opts.onUnread) opts.onUnread(totalUnread());
      measure();
      return { open: openChannel, state: S, toast: toast, search: openSearch, focus: focusMessage, thread: openThread, details: openDetails, view: setView, render: renderAll, openPop: closePop };
    });
  }

  window.FavorChat = { mount: mount, util: { esc: esc, fmtBody: null, ic: ic } };
})();
