/* Your Favor Brain chats as a list (2026-10-14), drawn the same way on the Brain page's rail (brain.js) and in the dock's
   Favor Brain tab (dock-panel.js). Grouped Pinned, Today, Yesterday, Previous 7 days, Older. A row: a chat mark, the title, one
   line of the last answer and the time; pin, rename and delete show on hover (always on a phone). The same one-question chat
   asked again shows once with a count (/api/brain/history sends the others' ids in `same`, and delete removes them all).
   Each host handles the presses: data-act="conv" opens, data-act="cvact" with data-v="pin|rename|del"; both carry data-id. Styles: .cvr in src/styles/brain.css. */
(function () {
  if (window.BrainConvs) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var P = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var I = {
    chat: '<svg viewBox="0 0 16 16" ' + P + '><path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.25v-2.25h-.25a1.5 1.5 0 0 1-1-1.5z"/></svg>',
    pin: '<svg viewBox="0 0 16 16" ' + P + '><path d="M6 2.5h4l-.5 4 2 2v1H4.5v-1l2-2zM8 9.5v4"/></svg>',
    edit: '<svg viewBox="0 0 16 16" ' + P + '><path d="M10.5 2.75 13.25 5.5 6 12.75H3.25V10z"/></svg>',
    del: '<svg viewBox="0 0 16 16" ' + P + '><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>'
  };
  var DAY = 864e5;
  var sod = function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  function group(c) {
    if (c.pinned) return 'Pinned';
    var t = new Date(c.changed_at).getTime(), today = sod(Date.now());
    if (t >= today) return 'Today';
    if (t >= today - DAY) return 'Yesterday';
    if (t >= today - 7 * DAY) return 'Previous 7 days';
    return 'Older';
  }
  function when(c) {
    var d = new Date(c.changed_at), g = group(c);
    if (g === 'Today' || (g === 'Pinned' && d.getTime() >= sod(Date.now()))) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (g === 'Yesterday') return 'Yesterday';
    if (Date.now() - d.getTime() < 7 * DAY) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  // A title the Brain has not reworded yet is the question as typed: shown with a capital and without the question mark.
  function title(t) { t = String(t || '').trim().replace(/[?]+$/, ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'New chat'; }
  var ORDER = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Older'];
  /** opt: { cur: open chat id, working: id being answered, q: search words, renaming: id, empty: text } */
  function html(list, opt) {
    opt = opt || {};
    var q = String(opt.q || '').trim().toLowerCase();
    if (q) list = list.filter(function (c) { return (c.title || '').toLowerCase().indexOf(q) >= 0 || (c.preview || '').toLowerCase().indexOf(q) >= 0 || (opt.found && opt.found.has(c.id)); });
    var groups = {};
    list.forEach(function (c) { var g = group(c); (groups[g] = groups[g] || []).push(c); });
    var h = '';
    ORDER.forEach(function (g) {
      if (!groups[g]) return;
      h += '<div class="cvr-grp" role="presentation">' + esc(g) + '</div>';
      h += groups[g].map(function (c) {
        var on = opt.cur === c.id, work = c.pending || opt.working === c.id, n = (c.same || []).length;
        if (opt.renaming === c.id) return '<div class="cvr is-edit" role="listitem"><span class="cvr__ic" aria-hidden="true">' + I.chat + '</span><input data-rename="' + esc(c.id) + '" value="' + esc(c.title) + '" aria-label="Rename the chat" maxlength="80" /></div>';
        return '<div class="cvr' + (on ? ' is-on' : '') + (c.pinned ? ' is-pin' : '') + '" role="listitem">' +
          '<button type="button" class="cvr__go" data-act="conv" data-id="' + esc(c.id) + '"' + (on ? ' aria-current="true"' : '') + '>' +
          '<span class="cvr__ic" aria-hidden="true">' + (work ? '<i class="cvr__work"></i>' : c.pinned ? I.pin : I.chat) + '</span>' +
          '<span class="cvr__tx"><span class="cvr__top"><span class="cvr__t">' + esc(title(c.title)) + '</span>' + (n ? '<span class="cvr__n" title="Asked ' + (n + 1) + ' times">' + (n + 1) + '&times;</span>' : '') + '<span class="cvr__tm">' + esc(when(c)) + '</span></span>' +
          '<span class="cvr__p">' + (work ? 'Answering...' : esc(c.preview || (c.turns > 1 ? c.turns + ' questions' : ''))) + '</span></span></button>' +
          '<span class="cvr__acts"><button type="button" class="cvr__a" data-act="cvact" data-v="pin" data-id="' + esc(c.id) + '" aria-label="' + (c.pinned ? 'Unpin' : 'Pin') + ' ' + esc(c.title) + '" title="' + (c.pinned ? 'Unpin' : 'Pin') + '"' + (c.pinned ? ' aria-pressed="true"' : '') + '>' + I.pin + '</button>' +
          '<button type="button" class="cvr__a" data-act="cvact" data-v="rename" data-id="' + esc(c.id) + '" aria-label="Rename ' + esc(c.title) + '" title="Rename">' + I.edit + '</button>' +
          '<button type="button" class="cvr__a cvr__a--del" data-act="cvact" data-v="del" data-id="' + esc(c.id) + '" aria-label="Delete ' + esc(c.title) + '" title="Delete">' + I.del + '</button></span></div>';
      }).join('');
    });
    return h || '<div class="cvr-none">' + esc(q ? 'No chats match.' : opt.empty || 'Your chats show here for 30 days.') + '</div>';
  }
  window.BrainConvs = { html: html, group: group };
})();
