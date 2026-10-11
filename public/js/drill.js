/* Click a number to see what is behind it: its Favor definition, the rows that make it up, and Google Sheets or CSV.

   Mark a number on any page:
     data-drill="year"            the year raised, every gift dated this year (asks /api/drill)
     data-drill="slice:rdds"      one revenue line, optionally slice:<key>:<YYYY-MM> for one month
     data-drill="def"             definition only, when there are no rows behind the number
   plus data-drill-label (the panel title), data-drill-value (the number on the page, so the panel can tie to it),
   data-drill-def (Favor definition sections to show, separated by |, e.g. "Which gifts count|Team revenue").

   A page with rows of its own opens the panel with FavorDrill.open({ ... }) and never asks the server for numbers
   (spec.defs names the Favor definition sections to load). FavorDrill.openAsync(spec, fetchRows) opens it while a route
   answers with the rows.
   Numbers are never recomputed here: the server answer or the page's own rows are shown as they came. */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (Number(n) < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const count = (n) => Number(n || 0).toLocaleString('en-US');
  const dshort = (s) => (/^\d{4}-\d{2}-\d{2}/.test(s || '') ? new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : s || '');
  const PAGE = 200;

  const style = document.createElement('style');
  style.textContent = `
.dr-num{cursor:pointer;text-decoration:none;border-radius:6px;transition:background .15s}.dr-num:hover{background:rgba(29,33,27,.06);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em}
.dr-num:focus-visible{outline:2px solid var(--h-brand,#2b4d24);outline-offset:3px}
.dr-scrim{position:fixed;inset:0;background:rgba(18,22,26,.32);z-index:220}
.dr-panel{position:fixed;top:0;right:0;bottom:0;width:min(560px,100vw);background:var(--h-surface,#fff);color:var(--h-ink,#12161a);box-shadow:var(--h-shadow-2);z-index:221;overflow:auto;padding:20px 22px 28px;font:14px/1.45 Inter,system-ui,sans-serif;-webkit-overflow-scrolling:touch}
.dr-panel[hidden],.dr-scrim[hidden]{display:none}
.dr-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
.dr-eyebrow{margin:0 0 4px;font-size:12px;color:var(--h-ink-2,#48505a);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.dr-title{margin:0;font-size:19px;line-height:1.25;font-weight:700}
.dr-x{flex:none;border:1px solid var(--h-line,#e4e7eb);background:var(--h-surface,#fff);border-radius:8px;width:34px;height:34px;font-size:18px;line-height:1;cursor:pointer;color:var(--h-ink,#12161a)}
.dr-x:focus-visible,.dr-panel .h-btn:focus-visible{outline:2px solid var(--h-brand,#2b4d24);outline-offset:2px}
.dr-shown{margin:16px 0 0;padding:14px 16px;border:1px solid var(--h-line,#e4e7eb);border-radius:10px;background:var(--h-surface-2,#f8f9fa)}
.dr-shown b{font-size:22px;font-weight:700;display:block}
.dr-shown span{color:var(--h-ink-2,#48505a);font-size:13px}
.dr-tie{margin:8px 0 0;font-size:13px;color:var(--h-ink-2,#48505a)}
.dr-tie.is-off{color:var(--h-red,#b4432a)}
.dr-def{margin:18px 0 0}
.dr-def h3,.dr-rows h3{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--h-ink-2,#48505a)}
.dr-def h4{margin:12px 0 4px;font-size:14px}
.dr-def p{margin:0 0 8px}
.dr-def ul{margin:0 0 8px;padding-left:18px}
.dr-def li{margin:0 0 4px}
.dr-rows{margin:20px 0 0}
.dr-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.dr-tbl th,.dr-tbl td{text-align:left;padding:6px 6px 6px 0;border-bottom:1px solid var(--h-line,#e4e7eb);vertical-align:top}
.dr-tbl th{font-size:11.5px;color:var(--h-ink-2,#48505a);font-weight:600}
.dr-tbl .r{text-align:right;white-space:nowrap}
.dr-tbl td:first-child{white-space:nowrap}
.dr-note{margin:8px 0 0;font-size:12.5px;color:var(--h-ink-2,#48505a)}
.dr-acts{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0}
.dr-msg{margin:12px 0 0;padding:12px 14px;border-radius:10px;background:var(--h-gold-soft,#fbf1dc);color:var(--h-ink,#12161a)}
.dr-load{margin:18px 0 0;color:var(--h-ink-2,#48505a)}
@media (max-width:600px){.dr-panel{padding:16px 16px 24px}.dr-tbl{font-size:12px}}
@media (prefers-reduced-motion:no-preference){.dr-panel{animation:dr-in .18s ease-out}}
@keyframes dr-in{from{transform:translateX(16px);opacity:.6}to{transform:none;opacity:1}}`;
  document.head.appendChild(style);

  let panel = null;
  let scrim = null;
  let lastFocus = null;
  let state = null;

  function build() {
    scrim = document.createElement('div');
    scrim.className = 'dr-scrim';
    scrim.hidden = true;
    panel = document.createElement('aside');
    panel.className = 'dr-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'dr-title');
    panel.hidden = true;
    panel.innerHTML = '<div class="dr-head"><div><p class="dr-eyebrow">What is behind this number</p><h2 class="dr-title" id="dr-title"></h2></div><button type="button" class="dr-x" aria-label="Close">&times;</button></div><div id="dr-body"></div>';
    document.body.append(scrim, panel);
    scrim.addEventListener('click', close);
    panel.querySelector('.dr-x').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel && !panel.hidden) close();
    });
  }

  function close() {
    if (!panel) return;
    panel.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  /** Favor definitions come as markdown from the Brain: headings, bullets, bold, paragraphs. Escaped first. */
  function md(src) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const out = [];
    let list = null;
    for (const raw of String(src || '').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('- ')) {
        if (!list) list = [];
        list.push(`<li>${inline(line.slice(2))}</li>`);
        continue;
      }
      if (list) {
        out.push(`<ul>${list.join('')}</ul>`);
        list = null;
      }
      if (!line) continue;
      if (line.startsWith('## ')) out.push(`<h4>${inline(line.slice(3))}</h4>`);
      else out.push(`<p>${inline(line)}</p>`);
    }
    if (list) out.push(`<ul>${list.join('')}</ul>`);
    return out.join('');
  }

  function cell(col, v) {
    if (v == null || v === '') return '';
    if (col.type === 'money') return money(v);
    if (col.type === 'int') return count(v);
    return esc(v);
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function download() {
    if (!state || !state.rows.length) return;
    const head = state.columns.map((c) => csvCell(c.label)).join(',');
    const lines = state.rows.map((r) => state.columns.map((c) => csvCell(c.type === 'money' ? Number(r[c.key] || 0).toFixed(2) : r[c.key])).join(','));
    const blob = new Blob([[head, ...lines].join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(state.title || 'favor-numbers').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function tieLine(s) {
    if (s.shown == null || s.total == null) return '';
    if (s.shownType === 'int') {
      const gap = Math.round(s.total - s.shown);
      return gap === 0
        ? `<p class="dr-tie">The rows count ${count(s.total)}, the same as the number on the page.</p>`
        : `<p class="dr-tie is-off">The rows count ${count(s.total)}. The number on the page is ${count(s.shown)}, ${count(Math.abs(gap))} apart.</p>`;
    }
    const gap = Math.round((Number(s.total) - Number(s.shown)) * 100) / 100;
    return Math.abs(gap) < 0.01
      ? `<p class="dr-tie">The gifts total ${money(s.total)}, the same as the number on the page.</p>`
      : `<p class="dr-tie is-off">The gifts total ${money(s.total)}. The number on the page is ${money(s.shown)}, ${money(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than the gifts.</p>`;
  }

  function render() {
    if (!panel || !state) return;
    panel.querySelector('.dr-title').textContent = state.title || '';
    const s = state;
    const shownBlock = s.shown != null
      ? `<div class="dr-shown"><b>${s.shownType === 'int' ? count(s.shown) : money(s.shown)}</b><span>${esc(s.shownLabel || 'On the page')}${s.asOf ? `, as of ${esc(dshort(s.asOf))}` : ''}</span></div>`
      : '';
    const totalLine = s.total != null && s.shown == null ? `<div class="dr-shown"><b>${s.shownType === 'int' ? count(s.total) : money(s.total)}</b><span>${esc(s.totalLabel || 'In the rows below')}</span></div>` : '';
    const def = s.definition ? `<section class="dr-def"><h3>Favor definition</h3>${md(s.definition)}</section>` : '';
    let rows = '';
    if (s.columns && s.columns.length) {
      const shown = s.rows.slice(0, PAGE);
      const head = s.columns.map((c) => `<th class="${c.type === 'money' || c.type === 'int' ? 'r' : ''}">${esc(c.label)}</th>`).join('');
      const body = shown.map((r) => `<tr>${s.columns.map((c) => `<td class="${c.type === 'money' || c.type === 'int' ? 'r' : ''}">${cell(c, r[c.key])}</td>`).join('')}</tr>`).join('');
      const more = s.rows.length > PAGE ? `<p class="dr-note">Showing ${count(PAGE)} of ${count(s.rows.length)} rows. The sheet and the CSV have every row.</p>` : '';
      const trunc = s.truncated ? `<p class="dr-note">${esc(s.truncated)}</p>` : '';
      rows = `<section class="dr-rows"><h3>${esc(s.rowsLabel || 'Rows behind it')} <span>${count(s.rows.length)}</span></h3>${s.rows.length ? `<div style="overflow-x:auto"><table class="dr-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}` : '<p class="dr-note">No rows.</p>'}${trunc}</section>`;
    }
    const acts = `<div class="dr-acts">${s.rows && s.rows.length ? '<button type="button" class="h-btn h-btn--primary h-btn--sm" data-sheets="drill">Open in Google Sheets</button><button type="button" class="h-btn h-btn--ghost h-btn--sm" data-dr-csv>Download CSV</button>' : ''}</div>`;
    const err = s.error ? `<div class="dr-msg" role="status">${esc(s.error)}</div>` : '';
    panel.querySelector('#dr-body').innerHTML = `${shownBlock}${totalLine}${s.loading ? '<p class="dr-load" role="status">Opening the rows</p>' : ''}${err}${tieLine(s)}${def}${rows}${acts}`;
    const csv = panel.querySelector('[data-dr-csv]');
    if (csv) csv.addEventListener('click', download);
  }

  function show(state0) {
    if (!panel) build();
    if (panel.hidden) lastFocus = document.activeElement;
    state = state0;
    render();
    scrim.hidden = false;
    panel.hidden = false;
    panel.scrollTop = 0;
    const x = panel.querySelector('.dr-x');
    if (x) x.focus();
  }

  const post = (body) =>
    fetch('/api/drill', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json().catch(() => ({})).then((d) => Object.assign(d, { _status: r.status })))
      .catch(() => ({ ok: false, message: 'The hub could not be reached. Check the connection and try again.' }));

  /** Opens from a marked element: definition first, then the rows, both from the Brain. */
  async function fromElement(el) {
    const kind = el.dataset.drill || '';
    const defs = (el.dataset.drillDef || '').split('|').map((x) => x.trim()).filter(Boolean);
    const value = el.dataset.drillValue;
    const shown = value === undefined || value === '' ? null : Number(value);
    const base = { title: el.dataset.drillLabel || el.textContent.trim(), shown, shownType: el.dataset.drillType === 'int' ? 'int' : 'money', shownLabel: el.dataset.drillShownLabel || 'On the page' };
    show({ ...base, loading: kind !== 'def', definition: '', columns: null, rows: [], total: null });
    const wantRows = kind === 'year' || kind.startsWith('slice:');
    const [def, num] = await Promise.all([
      defs.length ? post({ kind: 'definition', sections: defs }) : Promise.resolve(null),
      wantRows ? post(rowsRequest(kind)) : Promise.resolve(null),
    ]);
    if (!state || state.title !== base.title) return;
    const next = { ...base, loading: false, definition: def && def.ok ? def.definition : '', columns: null, rows: [], total: null };
    if (def && !def.ok) next.error = def.message || 'The definition did not load.';
    if (num) {
      if (!num.ok) next.error = num.message || 'The rows did not load. Try again in a minute.';
      else {
        next.asOf = num.asOf;
        next.total = num.total;
        next.rows = num.rows || [];
        next.columns = [
          { key: 'date', label: 'Date', type: 'text' },
          { key: 'partner', label: 'Partner', type: 'text' },
          { key: 'appeal_code', label: 'Appeal', type: 'text' },
          { key: 'amount', label: 'In this number', type: 'money' },
          { key: 'gift_amount', label: 'Gift', type: 'money' },
          { key: 'reason', label: 'Why it counts', type: 'text' },
        ];
        next.sheetTitle = `${base.title} rows`;
        next.totalLabel = `Gifts behind it, ${count(num.count)}`;
        if (num.label && kind.startsWith('slice:')) next.rowsLabel = `${num.label}, gifts`;
      }
    }
    show(next);
  }

  function rowsRequest(kind) {
    if (kind === 'year') return { kind: 'year' };
    const [, slice, month] = kind.split(':');
    return { kind: 'slice', slice, ...(month ? { month } : {}) };
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-drill]');
    if (!el) return;
    e.preventDefault();
    fromElement(el);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest && e.target.closest('[data-drill]');
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'A') return;
    e.preventDefault();
    fromElement(el);
  });

  // Each marked number is keyboard reachable.
  const mark = (root) => root.querySelectorAll('[data-drill]:not([tabindex])').forEach((el) => {
    if (el.tagName !== 'BUTTON' && el.tagName !== 'A') {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
    }
    el.classList.add('dr-num');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mark(document));
  else mark(document);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) mark(n); }))).observe(document.body, { childList: true, subtree: true });

  /** Pages with rows of their own: { title, shown, shownType, shownLabel, definition, columns, rows, total, totalLabel, sheetTitle, asOf, truncated, rowsLabel }. */
  window.FavorDrill = {
    open(spec) {
      show({ ...spec, rows: spec.rows || [], loading: false });
      const defs = spec.defs || [];
      if (!defs.length || spec.definition) return;
      post({ kind: 'definition', sections: defs }).then((def) => {
        if (!state || state.title !== spec.title) return;
        show({ ...state, definition: def && def.ok ? def.definition : '' });
      });
    },
    /** Rows that a route returns: open with the page's count and the server's rows. fetchRows resolves to { rows, total, columns } or { message }. */
    async openAsync(spec, fetchRows) {
      show({ ...spec, rows: [], loading: true });
      const defs = spec.defs || [];
      const [def, res] = await Promise.all([defs.length ? post({ kind: 'definition', sections: defs }) : null, fetchRows ? fetchRows() : null]);
      if (!state || state.title !== spec.title) return;
      const next = { ...spec, loading: false, definition: def && def.ok ? def.definition : '', rows: [], total: null };
      if (res) {
        if (res.message) next.error = res.message;
        else { next.rows = res.rows || []; next.total = res.total; next.columns = res.columns || next.columns; }
      }
      show(next);
    },
    close,
  };

  if (window.FavorSheets) {
    window.FavorSheets.register('drill', () => {
      if (!state || !state.rows || !state.rows.length || !state.columns) throw new Error('There are no rows to put in a sheet.');
      return {
        mode: 'rows',
        title: state.sheetTitle || state.title || 'Favor numbers',
        tabs: [{ name: (state.sheetTitle || state.title || 'Rows').slice(0, 90), columns: state.columns.map((c) => ({ key: c.key, label: c.label, type: c.type === 'money' || c.type === 'int' ? c.type : 'text' })), rows: state.rows, more: false }],
        provenance: { kind: 'screen', page: location.pathname, filters: state.title || '', dataAsOf: state.asOf || '' },
        classes: [],
      };
    });
  }
})();
