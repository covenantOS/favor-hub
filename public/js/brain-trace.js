/* The steps behind a Favor Brain answer (2026-10-14), after shadcn's Trace component (MIT): one line per step with an icon, a
   title and a quiet count or time at the end; a step can open to show what it did in plain words. While the answer is being
   made the lines fill in as the Brain sends them (/api/brain/ask with Accept: application/x-ndjson); once it lands they close
   to one line ("Read your question, looked up 2,106 partners, checked in 3.2 s") above the answer.
   Staff see steps and plain summaries only: never a query, a model or reasoning text.
   Used by the Brain page (brain.js) and the dock's Favor Brain tab (dock-panel.js). Styles: .btr in src/styles/brain.css. */
(function () {
  if (window.BrainTrace) return;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var P = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var ICON = {
    read: '<svg viewBox="0 0 16 16" ' + P + '><path d="M3.5 2.5h6l3 3v8h-9z"/><path d="M9.5 2.5v3h3M5.75 8.5h4.5M5.75 11h3"/></svg>',
    lookup: '<svg viewBox="0 0 16 16" ' + P + '><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/></svg>',
    check: '<svg viewBox="0 0 16 16" ' + P + '><path d="M8 1.75 13 3.6v4.1c0 3-2.1 5.4-5 6.55-2.9-1.15-5-3.55-5-6.55V3.6z"/><path d="m5.75 8 1.6 1.6 2.9-3.1"/></svg>',
    answer: '<svg viewBox="0 0 16 16" ' + P + '><path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.25v-2.25h-.25a1.5 1.5 0 0 1-1-1.5z"/></svg>',
    done: '<svg viewBox="0 0 16 16" ' + P + '><circle cx="8" cy="8" r="6.25"/><path d="m5.5 8.1 1.75 1.75L10.6 6.4"/></svg>',
    held: '<svg viewBox="0 0 16 16" ' + P + '><circle cx="8" cy="8" r="6.25"/><path d="M5.5 8h5"/></svg>',
    run: '<svg viewBox="0 0 16 16" class="btr-spin" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6.25" opacity=".25"/><path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25"/></svg>',
    chev: '<svg viewBox="0 0 16 16" ' + P + '><path d="m6 4 4 4-4 4"/></svg>'
  };
  var ORDER = ['read', 'lookup', 'check', 'answer'];
  var WAIT = { read: 'Reading your question', lookup: 'Looking up the records', check: 'Checking the numbers', answer: 'Answer' };
  var secs = function (ms) { return ms == null ? '' : ms < 950 ? '<1 s' : (ms / 1000).toFixed(ms < 9950 ? 1 : 0) + ' s'; };

  /** The four rows while an answer is being made: the ones the Brain has sent, the rest waiting in grey. Height never changes. */
  function liveSteps(steps) {
    var got = {}; (steps || []).forEach(function (s) { got[s.id] = s; });
    var first = true;
    return ORDER.map(function (id) {
      if (got[id]) return got[id];
      var s = { id: id, label: WAIT[id], status: first && !(steps || []).some(function (x) { return x.status === 'running'; }) ? 'running' : 'pending' };
      if (s.status === 'running') first = false;
      return s;
    });
  }
  function rowHTML(s, live) {
    var st = s.status || 'done';
    var ic = st === 'running' ? ICON.run : ICON[s.id] || ICON.done;
    var end = s.count ? esc(s.count) : s.id !== 'answer' && (st === 'done' || st === 'withheld') ? secs(s.ms) : '';
    var detail = !live && s.detail;
    var line = '<span class="btr-line" data-status="' + st + '"><span class="btr-ic" aria-hidden="true">' + ic + '</span><span class="btr-t">' + esc(s.label) + '</span>' + (end ? '<span class="btr-d">' + end + '</span>' : '') + (detail ? '<span class="btr-ic btr-chev" aria-hidden="true">' + ICON.chev + '</span>' : '') + '</span>';
    if (!detail) return '<div class="btr-row" data-id="' + esc(s.id) + '">' + line + '</div>';
    return '<div class="btr-row" data-id="' + esc(s.id) + '"><button type="button" class="btr-trig" data-btr-toggle aria-expanded="false">' + line + '</button><div class="btr-body"><div class="btr-in"><p>' + esc(s.detail) + '</p></div></div></div>';
  }

  /** One line for the finished list. */
  function summary(steps) {
    var by = {}; steps.forEach(function (s) { by[s.id] = s; });
    var held = steps.some(function (s) { return s.status === 'withheld'; });
    var total = steps.reduce(function (m, s) { return Math.max(m, (s.at || 0) + (s.ms || 0)); }, 0);
    var parts = ['Read your question'];
    if (by.lookup) parts.push(by.lookup.count ? by.lookup.label.replace(/^Looked up /, 'found ' + by.lookup.count + ' ') : by.lookup.label.replace(/^Looked/, 'looked'));
    if (held) return { text: parts.join(', ') + ', held the answer back after ' + secs(total), held: true };
    if (by.check && by.check.status === 'done') parts.push((by.lookup ? 'checked' : by.check.label.replace(/^Checked/, 'checked')) + ' in ' + secs(total));
    else parts[parts.length - 1] += ' in ' + secs(total);
    return { text: parts.join(', '), held: false };
  }

  /** The list above a finished answer: one line, open to see each step. */
  function done(steps) {
    steps = (steps || []).filter(function (s) { return s && s.id && s.label; });
    if (!steps.length) return '';
    var sm = summary(steps);
    return '<div class="btr btr--done" data-btr><button type="button" class="btr-trig btr-sum" data-btr-toggle aria-expanded="false"><span class="btr-line" data-status="' + (sm.held ? 'withheld' : 'done') + '"><span class="btr-ic" aria-hidden="true">' + (sm.held ? ICON.held : ICON.done) + '</span><span class="btr-t">' + esc(sm.text) + '</span><span class="btr-ic btr-chev" aria-hidden="true">' + ICON.chev + '</span></span></button><div class="btr-body"><div class="btr-in btr-list">' + steps.map(function (s) { return rowHTML(s, false); }).join('') + '</div></div></div>';
  }
  /** The live list in place of the old "thinking" skeleton. */
  function live(steps) {
    return '<div class="btr btr--live" data-btr-live role="status" aria-live="polite" aria-label="' + esc(current(steps)) + '"><div class="btr-list">' + liveSteps(steps).map(function (s) { return rowHTML(s, true); }).join('') + '</div></div>';
  }
  function current(steps) { var r = liveSteps(steps).filter(function (s) { return s.status === 'running'; })[0]; return r ? r.label : 'Reading your question'; }
  /** Updates a live list in place, row by row, so a step finishing never redraws the others. */
  function update(root, steps) {
    var el = root && (root.matches && root.matches('[data-btr-live]') ? root : root.querySelector('[data-btr-live]'));
    if (!el) return;
    liveSteps(steps).forEach(function (s) {
      var row = el.querySelector('.btr-row[data-id="' + s.id + '"]');
      var html = rowHTML(s, true);
      if (row && row.outerHTML === html) return;
      var tmp = document.createElement('div'); tmp.innerHTML = html;
      var next = tmp.firstChild;
      if (row) {
        var was = row.querySelector('.btr-line').getAttribute('data-status');
        if (was !== s.status) next.classList.add('is-turn');
        row.replaceWith(next);
      }
    });
    el.setAttribute('aria-label', current(steps));
  }

  /** Opening and closing a row: the body's height eases on a grid row (no measuring, no jump). */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-btr-toggle]');
    if (!b) return;
    var open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
  });

  /**
   * Asks with the steps streamed. onSteps(steps) runs on every change; resolves to the answer JSON like the plain call, and throws
   * the same errors. A server that answers with plain JSON still works (no steps until the answer).
   */
  async function ask(body, opt) {
    opt = opt || {};
    var res = await fetch('/api/brain/ask', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body), signal: opt.signal });
    var type = res.headers.get('Content-Type') || '';
    var d = null, status = res.status;
    if (type.indexOf('ndjson') >= 0 && res.body && res.body.getReader) {
      var rd = res.body.getReader(), dec = new TextDecoder(), buf = '';
      var take = function (ln) {
        if (!ln.trim()) return;
        var o; try { o = JSON.parse(ln); } catch (e) { return; }
        if (o.steps && opt.onSteps) opt.onSteps(o.steps);
        if (o.final) { d = o.final; status = o.status || status; }
      };
      for (;;) {
        var r = await rd.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      take(buf);
    } else d = await res.json().catch(function () { return {}; });
    d = d || {};
    if (status >= 400 || d.ok === false) {
      var err = new Error(d.message || d.error || 'The Brain did not answer (' + status + ').');
      err.ref = d.ref; err.status = status;
      throw err;
    }
    return d;
  }

  window.BrainTrace = { live: live, update: update, done: done, ask: ask, summary: summary };
})();
