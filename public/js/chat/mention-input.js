/* The mention composer: one text box where a picked @mention becomes a solid token, the way Slack's does. Shared by the request
   board's comment box and Favor Chat. Self-contained: it brings its own styles and needs nothing else on the page.

   A mention is an element in the box, not text. It carries the person's id (their email), deletes as one unit with Backspace
   or Delete, cannot be edited from the inside, and is never re-read from the words around it. value() gives the stored form
   Chat and the request board already use: plain text with <@email> tokens.

   API
     const box = FavorMention.attach(host, {
       people,          // () => [{ id, name, sub?, picture? }]  or  (query) => the same, already filtered. id is the email.
       me,              // my id; left out of the suggestions
       placeholder,     // string
       label,           // aria-label; the placeholder when missing
       enterSends,      // () => boolean. Default: true on a keyboard, false on a phone (Enter adds a line there).
       onInput(box),    // after every change
       onSubmit(box),   // Enter (when enterSends) or Ctrl/Cmd Enter
       extra,           // [{ id, name, sub?, html? }] rows shown first in the suggestions, e.g. Chat's brain and channel
       max,             // most characters, default 4000
     });
     box.value()                 the text with <@id> tokens
     box.setValue(text, names)   fill from stored text; names is { id: name } or (id) => name
     box.isEmpty()   box.clear()   box.focus()
     box.insertMention({ id, name })   put a token at the caret (the @ button)
     box.insertText(text)        put text at the caret (emoji)
     box.el                      the editable element
     box.destroy()

     FavorMention.render(text, names, me)   safe HTML for a posted message: the same tokens, links and **bold**
     FavorMention.plain(text, names)        the text with each token written as @Name (notices, previews)

   Chat (chat-ui.js) adopts it in three steps: draw <div data-mi="main"></div> where the textarea was, call
   FavorMention.attach on it with people: () => Object.values(S.users) mapped to { id, name, sub: title, picture } and
   extra: the brain and channel rows, and read box.value() where it read the textarea and its mention map. */
(function () {
  'use strict';
  if (window.FavorMention) return;
  var ZW = '​';
  var COLORS = ['#f7ecd2', '#e1edf5', '#e1efdc', '#e9e5f4', '#f8e5dc', '#dcefee', '#e6e9ec'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var hash = function (s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  var initials = function (n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); };
  var nameFrom = function (names, id) {
    var n = typeof names === 'function' ? names(id) : names && names[id];
    return n || String(id || '').split('@')[0];
  };

  var CSS =
    '.mi{display:block;min-height:24px;max-height:180px;overflow-y:auto;outline:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:400 15px/1.5 Inter,system-ui,sans-serif;color:var(--r-ink,#1d211b);cursor:text;-webkit-user-select:text;user-select:text}' +
    '.mi:empty::before{content:attr(data-placeholder);color:var(--r-ink-3,#666b60);pointer-events:none}' +
    '.mi-chip{display:inline-block;padding:0 6px;margin:0 1px;border-radius:6px;background:var(--tc-sky-tint,#e1edf5);color:var(--tc-sky-ink,#1f5f8b);font-weight:600;line-height:1.45;white-space:nowrap;-webkit-user-select:all;user-select:all;cursor:default}' +
    '.mi .mi-chip.is-sel{box-shadow:0 0 0 2px var(--tc-sky-ink,#1f5f8b)}' +
    '.mi-chip--me{background:var(--tc-sun-tint,#f7ecd2);color:#7a5000;box-shadow:inset 0 0 0 1px #ecd493}' +
    '.mi-pop{position:absolute;z-index:60;left:0;bottom:calc(100% + 6px);min-width:260px;max-width:min(360px,100%);max-height:300px;overflow-y:auto;padding:6px;background:#fff;border:1px solid var(--r-line-2,#d3cdbd);border-radius:12px;box-shadow:0 14px 36px -10px rgba(29,33,27,.35);font:400 14px/1.3 Inter,system-ui,sans-serif;color:var(--r-ink,#1d211b)}' +
    '.mi-pop__h{padding:6px 10px 4px;font:700 11px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--r-ink-3,#666b60)}' +
    '.mi-pop__i{width:100%;display:flex;align-items:center;gap:10px;min-height:44px;padding:4px 10px 4px 6px;border:0;border-radius:9px;background:none;text-align:left;font:inherit;color:inherit;cursor:pointer}' +
    '.mi-pop__i.is-on,.mi-pop__i:hover{background:var(--r-hover,#f7f5ef)}' +
    '.mi-pop__i b{display:block;font-weight:600;font-size:14px}.mi-pop__i small{display:block;font-size:12px;color:var(--r-ink-3,#666b60);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.mi-pop__t{min-width:0;flex:1}' +
    '.mi-av{flex:none;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;overflow:hidden;font:700 11px/1 Inter,system-ui,sans-serif;color:#3f4852}' +
    '.mi-av img{width:100%;height:100%;object-fit:cover;display:block}' +
    '@media (max-width:860px){.mi{font-size:16px}}';
  function styles() {
    if (document.getElementById('mi-css')) return;
    var st = document.createElement('style');
    st.id = 'mi-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function avatarHtml(p) {
    if (p.html) return p.html;
    var inner = p.picture ? '<img src="' + esc(p.picture) + '" alt="" referrerpolicy="no-referrer" />' : esc(initials(p.name));
    return '<span class="mi-av" style="background:' + COLORS[hash(String(p.id)) % 7] + '">' + inner + '</span>';
  }

  /* ------------------------------------------------------------------ reading and writing the stored form */
  var TOKEN = /<@([^>\s]+)>/g;
  function chipEl(id, name) {
    var s = document.createElement('span');
    s.className = 'mi-chip';
    s.contentEditable = 'false';
    s.setAttribute('data-mi-id', id);
    s.textContent = '@' + name;
    return s;
  }
  function fill(el, text, names) {
    el.textContent = '';
    var t = String(text || '');
    var last = 0;
    var m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(t))) {
      if (m.index > last) el.appendChild(document.createTextNode(t.slice(last, m.index)));
      el.appendChild(chipEl(m[1].toLowerCase(), nameFrom(names, m[1].toLowerCase())));
      last = m.index + m[0].length;
    }
    if (last < t.length) el.appendChild(document.createTextNode(t.slice(last)));
  }
  function read(node) {
    var out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) out += n.nodeValue.replace(/​/g, '').replace(/ /g, ' ');
      else if (n.nodeType !== 1) return;
      else if (n.hasAttribute('data-mi-id')) out += '<@' + n.getAttribute('data-mi-id') + '>';
      else if (n.tagName === 'BR') out += '\n';
      else {
        // A block the browser added for a new line.
        var inner = read(n);
        out += (out && !/\n$/.test(out) ? '\n' : '') + inner;
      }
    });
    return out;
  }

  function render(text, names, me) {
    styles();
    var t = esc(text || '');
    t = t.replace(/&lt;@([^&\s]+?)&gt;/g, function (_, id) {
      id = id.toLowerCase();
      return '<span class="mi-chip' + (me && id === me ? ' mi-chip--me' : '') + '" data-mi-id="' + esc(id) + '">@' + esc(nameFrom(names, id)) + '</span>';
    });
    t = t.replace(/(https?:\/\/[^\s<]+[^\s<).,;:!?])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return t;
  }
  function plain(text, names) {
    return String(text || '').replace(TOKEN, function (_, id) { return '@' + nameFrom(names, id.toLowerCase()); });
  }

  /* ------------------------------------------------------------------ the box */
  function attach(host, opts) {
    opts = opts || {};
    styles();
    var max = opts.max || 4000;
    var phone = function () { return matchMedia('(max-width: 860px)').matches; };
    var enterSends = opts.enterSends || function () { return !phone(); };
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var el = document.createElement('div');
    el.className = 'mi';
    el.contentEditable = 'true';
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-multiline', 'true');
    el.setAttribute('aria-label', opts.label || opts.placeholder || 'Message');
    el.setAttribute('data-placeholder', opts.placeholder || '');
    el.setAttribute('enterkeyhint', 'send');
    el.spellcheck = true;
    host.appendChild(el);

    var pop = null;
    var st = null; // { node, start, end, list, i }
    var changed = function () {
      // An emptied box must be truly empty, or the placeholder stays hidden behind a stray line break.
      if (!read(el).trim() && !el.querySelector('[data-mi-id]')) el.textContent = '';
      if (opts.onInput) opts.onInput(api);
    };
    var closePop = function () { if (pop) { pop.remove(); pop = null; } st = null; el.removeAttribute('aria-activedescendant'); };

    function candidates(q) {
      var list = typeof opts.people === 'function' ? opts.people(q) || [] : [];
      var words = q.toLowerCase().split(/\s+/).filter(Boolean);
      var first = words[0] || '';
      var rank = function (p) { var n = String(p.name).toLowerCase(); return !first ? 0 : n.indexOf(first) === 0 ? 0 : n.split(/\s+/).some(function (w) { return w.indexOf(first) === 0; }) ? 1 : 2; };
      var ok = function (p) { var hay = (p.name + ' ' + (p.sub || '')).toLowerCase(); return words.every(function (w) { return hay.indexOf(w) >= 0; }); };
      var extra = (opts.extra || []).filter(ok);
      var people = list.filter(function (p) { return p.id !== opts.me && ok(p); }).map(function (p, i) { return { p: p, i: i, r: rank(p) }; }).sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.p; });
      return extra.concat(people).slice(0, 7);
    }

    function caret() {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      var r = sel.getRangeAt(0);
      if (!el.contains(r.startContainer)) return null;
      return r;
    }

    function suggest() {
      var r = caret();
      if (!r || r.startContainer.nodeType !== 3) { closePop(); return; }
      var before = r.startContainer.nodeValue.slice(0, r.startOffset);
      var m = before.match(/(^|[\s​(])@([\w.'-]*(?: [\w.'-]*)?)$/);
      if (!m || m[2].length > 24) { closePop(); return; }
      var list = candidates(m[2]);
      if (!list.length) { closePop(); return; }
      st = { node: r.startContainer, start: r.startOffset - m[2].length - 1, end: r.startOffset, list: list, i: 0 };
      if (!pop) {
        pop = document.createElement('div');
        pop.className = 'mi-pop';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', 'People');
        host.appendChild(pop);
        // Pressing a row must not take the caret out of the box.
        pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
        pop.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b && st) pick(st.list[+b.getAttribute('data-i')]); });
      }
      pop.innerHTML = '<div class="mi-pop__h">People</div>' + list.map(function (p, i) {
        return '<button type="button" class="mi-pop__i' + (i === 0 ? ' is-on' : '') + '" role="option" id="mi-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === 0) + '">' + avatarHtml(p) + '<span class="mi-pop__t"><b>' + esc(p.name) + '</b>' + (p.sub ? '<small>' + esc(p.sub) + '</small>' : '') + '</span></button>';
      }).join('');
    }

    function placeAfter(node) {
      var sel = window.getSelection();
      var r = document.createRange();
      r.setStartAfter(node);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    /** Puts a token where the typed @name was, or at the caret, followed by a space to keep typing in. */
    function pick(p) {
      var range;
      if (st && st.node.parentNode) {
        range = document.createRange();
        range.setStart(st.node, st.start);
        range.setEnd(st.node, Math.min(st.end, st.node.nodeValue.length));
      } else {
        el.focus();
        range = caret();
        if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
      }
      range.deleteContents();
      var chip = chipEl(p.id, p.name);
      var space = document.createTextNode(' ');
      range.insertNode(space);
      range.insertNode(chip);
      // A token needs text on its left to put a caret there; a zero-width mark does it when the token starts the box or follows another.
      var prev = chip.previousSibling;
      if (!prev || (prev.nodeType === 1 && prev.hasAttribute('data-mi-id'))) chip.parentNode.insertBefore(document.createTextNode(ZW), chip);
      placeAfter(space);
      closePop();
      changed();
    }

    /** The token next to a collapsed caret, on the side given (-1 before it, 1 after it). */
    function chipBeside(dir) {
      var r = caret();
      if (!r) return null;
      var c = r.startContainer;
      var o = r.startOffset;
      var node;
      if (c.nodeType === 3) {
        var v = c.nodeValue;
        if (dir < 0 && v.slice(0, o).replace(/​/g, '') !== '') return null;
        if (dir > 0 && v.slice(o).replace(/​/g, '') !== '') return null;
        node = dir < 0 ? c.previousSibling : c.nextSibling;
      } else {
        node = dir < 0 ? c.childNodes[o - 1] : c.childNodes[o];
      }
      // Step over an empty or zero-width text node.
      while (node && node.nodeType === 3 && node.nodeValue.replace(/​/g, '') === '') node = dir < 0 ? node.previousSibling : node.nextSibling;
      return node && node.nodeType === 1 && node.hasAttribute('data-mi-id') ? node : null;
    }

    el.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (st && pop) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          st.i = (st.i + (e.key === 'ArrowDown' ? 1 : st.list.length - 1)) % st.list.length;
          pop.querySelectorAll('.mi-pop__i').forEach(function (b, i) { b.classList.toggle('is-on', i === st.i); b.setAttribute('aria-selected', String(i === st.i)); if (i === st.i) b.scrollIntoView({ block: 'nearest' }); });
          el.setAttribute('aria-activedescendant', 'mi-opt-' + st.i);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(st.list[st.i]); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        var chip = chipBeside(e.key === 'Backspace' ? -1 : 1);
        if (chip) {
          e.preventDefault();
          var mark = chip.previousSibling;
          if (mark && mark.nodeType === 3 && mark.nodeValue === ZW) mark.remove();
          chip.remove();
          changed();
          return;
        }
      }
      if (e.key === 'Enter') {
        if ((e.metaKey || e.ctrlKey) || (!e.shiftKey && enterSends())) {
          e.preventDefault();
          if (opts.onSubmit && !api.isEmpty()) opts.onSubmit(api);
          return;
        }
        // A new line is a line break, never a new block.
        e.preventDefault();
        document.execCommand('insertLineBreak');
        changed();
      }
    });
    el.addEventListener('input', function () {
      if (read(el).length > max) { fill(el, read(el).slice(0, max), function (id) { var c = el.querySelector('[data-mi-id="' + id + '"]'); return c ? c.textContent.slice(1) : id.split('@')[0]; }); }
      changed();
      suggest();
    });
    el.addEventListener('keyup', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') suggest(); });
    el.addEventListener('click', suggest);
    el.addEventListener('blur', function () { setTimeout(closePop, 150); });
    // Pasted and dropped content comes in as plain text: no fonts, no pictures, no foreign tokens.
    el.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n'));
    });
    el.addEventListener('drop', function (e) { e.preventDefault(); });

    var api = {
      el: el,
      value: function () { return read(el).replace(/\n{3,}/g, '\n\n').trim(); },
      setValue: function (text, names) { fill(el, text, names); changed(); },
      isEmpty: function () { return !read(el).trim(); },
      clear: function () { el.textContent = ''; closePop(); changed(); },
      focus: function () {
        el.focus();
        var r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      },
      insertMention: function (p) {
        if (document.activeElement !== el) api.focus();
        st = null;
        pick(p);
      },
      insertText: function (text) {
        if (document.activeElement !== el) api.focus();
        document.execCommand('insertText', false, String(text));
        changed();
      },
      mentions: function () { return Array.prototype.map.call(el.querySelectorAll('[data-mi-id]'), function (c) { return c.getAttribute('data-mi-id'); }); },
      destroy: function () { closePop(); el.remove(); },
    };
    return api;
  }

  window.FavorMention = { attach: attach, render: render, plain: plain, styles: styles };
})();
