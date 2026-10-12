/* Project tasks in Favor Chat (lane LINKS).
   FavorProjectCard.html(a, u)   the card for an attachment of type ptask: title, code, status, owner, due date, Open. chat-ui.js calls it;
                                  functions/_lib/projects/links/chat.ts fills the fields in from the task each time a message is read.
                                  Pressing the card opens the task in place (PJLinks.openTask), never leaving Chat.
   Make a task from this message  a button added to the message actions on desktop and in the phone sheet, which opens the dialog.
   /task                          typed in a message; the server makes the task and posts the card (nothing to draw here).
   This file adds its pieces by watching the Chat screen, so it keeps working when chat-ui.js is redrawn. */
(function () {
  'use strict';
  var PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';

  function html(a, u) {
    var esc = u.esc;
    var metaHtml = [a.code ? esc(a.code) : '', esc(a.status_label || ''), a.owner ? 'Owner ' + esc(a.owner) : '', a.due ? '<span class="' + (a.late ? 'pjl-late' : '') + '">Due ' + esc(a.due) + '</span>' : ''].filter(Boolean).join(' &middot; ');
    var note = a.note ? String(a.note).replace(/<@([^>\s]+)>/g, function (_, id) { return '@' + id.split('@')[0]; }) : '';
    return '<a class="ch-card pjl-tcard" href="' + esc(a.url) + '" data-pjl-open="' + esc(a.code || a.id) + '" data-status="' + esc(a.status) + '">' +
      '<span class="pjl-tcard__k">' + PLUS + esc(a.kick || 'Task') + (a.project ? '<span class="pjl-tcard__proj">' + esc(a.project.name) + '</span>' : '') + '</span>' +
      '<span class="ch-card__t">' + esc(a.title) + '</span>' +
      (note ? '<span class="pjl-tcard__note">' + esc(note) + '</span>' : '') +
      '<span class="pjl-tcard__row"><span class="ch-card__m">' + metaHtml + '</span><span class="ch-btn ch-btn--sm">Open</span></span></a>';
  }
  window.FavorProjectCard = { html: html };

  /* ------------------------------------------------------------------ open in place */
  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('[data-pjl-open]') : null;
    if (!c || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (!window.PJLinks) return; // the link itself still works
    e.preventDefault();
    window.PJLinks.openTask(c.getAttribute('data-pjl-open'));
  }, true);

  /* ------------------------------------------------------------------ Make a task from this message */
  var LABEL = 'Make a task from this message';
  function textOf(id) {
    var m = document.querySelector('.ch-msg[data-mid="' + id + '"] .ch-msg__text');
    if (!m) return '';
    var t = m.textContent.replace(/\(edited\)\s*$/, '').replace(/\s+/g, ' ').trim();
    return (t.split(/(?<=[.!?])\s/)[0] || t).slice(0, 140);
  }
  function addButtons() {
    document.querySelectorAll('.ch-bar:not([data-pjl])').forEach(function (bar) {
      bar.setAttribute('data-pjl', '1');
      var any = bar.querySelector('[data-id]'); if (!any) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'pjl-barbtn'; b.setAttribute('data-act', 'pjl-make'); b.setAttribute('data-id', any.getAttribute('data-id'));
      b.setAttribute('aria-label', LABEL); b.title = LABEL; b.innerHTML = PLUS;
      bar.appendChild(b);
    });
    document.querySelectorAll('.ch-msheet:not([data-pjl])').forEach(function (sheet) {
      sheet.setAttribute('data-pjl', '1');
      var any = sheet.querySelector('.ch-msheet__row[data-id]'); if (!any) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ch-msheet__row'; b.setAttribute('data-act', 'pjl-make'); b.setAttribute('data-id', any.getAttribute('data-id'));
      b.innerHTML = PLUS + '<span>' + LABEL + '</span>';
      sheet.appendChild(b);
    });
  }
  var t0 = 0;
  new MutationObserver(function () { cancelAnimationFrame(t0); t0 = requestAnimationFrame(addButtons); }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act="pjl-make"]') : null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    var id = Number(b.getAttribute('data-id'));
    // The phone sheet closes first so the dialog is not stacked on it.
    var x = document.querySelector('[data-act="modal-x"]'); if (x && b.classList.contains('ch-msheet__row')) x.click();
    if (window.PJLinks) window.PJLinks.makeTask({ messageId: id, title: textOf(id) });
  }, true);
})();
