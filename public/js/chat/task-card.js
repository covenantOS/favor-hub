/* The request board's card in Favor Chat: what was sent (title, the note), where it stands (status, owner, due date) and Open.
   chat-ui.js calls FavorTaskCard.html for an attachment of type task; functions/_lib/chat/tasks.ts fills the fields in. A reply in
   the card's thread is also a comment on the request. */
(function () {
  'use strict';
  function day(d) {
    return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '';
  }
  function html(a, u) {
    var esc = u.esc;
    var kick = a.kind === 'mention' ? 'Named on a request' : a.kind === 'made' ? 'Made a request' : 'Sent a request';
    var meta = [a.status_label, a.owner ? 'Owner ' + a.owner : '', a.due_date ? 'Due ' + day(a.due_date) : ''].filter(Boolean).join(' · ');
    var note = a.note ? String(a.note).replace(/<@([^>\s]+)>/g, function (_, id) { return '@' + id.split('@')[0]; }) : '';
    // A press opens the request over the chat (chat-request.js); the address is the board's, for a new tab.
    return '<a class="ch-card rt-tcard" href="' + esc(a.url) + '" data-status="' + esc(a.status) + '" data-act="task-open" data-rid="' + esc(a.id) + '">' +
      '<span class="rt-tcard__k"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>' + esc(kick) + '</span>' +
      '<span class="ch-card__t">' + esc(a.title) + '</span>' +
      (note ? '<span class="rt-tcard__note">' + esc(note) + '</span>' : '') +
      '<span class="rt-tcard__row"><span class="ch-card__m">' + esc(meta) + '</span><span class="ch-btn ch-btn--sm">Open</span></span></a>';
  }
  window.FavorTaskCard = { html: html };
})();
