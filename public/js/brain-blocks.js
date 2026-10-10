/* Favor Brain page: draws each answer block as a component. The Brain sends blocks (text, choice,
   partner, tiles, team, table, chart, coverage, steps, confirm, note, sheet, consent, files) and the same
   answer as markdown; a block type this file does not know falls back to that markdown.
   Money is a number in dollars and dates are ISO. public/js/brain.js owns the page and the events. */
(() => {
  const B = (window.BrainBlocks = {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ICON = { dollar: 'coin', gift: 'coin', team: 'chart', people: 'users', check: 'check', spark: 'spark', book: 'book', list: 'list', user: 'user', users: 'users', coin: 'coin', chart: 'chart', gauge: 'gauge', info: 'info', lock: 'lock', mail: 'mail', link: 'link', shield: 'shield', play: 'play', redo: 'redo' };
  const ic = (n, c = 'h-i') => `<svg class="${c}" aria-hidden="true"><use href="#bci-${ICON[n] || n}"/></svg>`;
  const money = (n) => (n == null || n === '' ? '' : (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'));
  const moneyS = (n) => {
    const a = Math.abs(n);
    const s = a >= 1e6 ? '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a).toLocaleString('en-US');
    return n < 0 ? '-' + s : s;
  };
  const int = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const dlong = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(iso || '');
  };
  const fmt = (v, f) => {
    if (v == null || v === '') return '';
    if (typeof v === 'string' && f !== 'money' && f !== 'money_short' && f !== 'int' && f !== 'pct') return f === 'date' ? dlong(v) : v;
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return f === 'money' ? money(n) : f === 'money_short' ? moneyS(n) : f === 'pct' ? n + '%' : f === 'date' ? dlong(v) : int(n);
  };
  // A link from an answer opens only as a web address or a page on this site.
  const href = (u) => (/^(https?:\/\/|\/(?!\/))/i.test(String(u || '')) ? String(u) : '#');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  B.esc = esc; B.ic = ic; B.money = money; B.moneyS = moneyS; B.int = int; B.dlong = dlong; B.fmt = fmt;

  // ---- Markdown (the text block, and the fallback for any block this page does not know) ---------
  const words = (s) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(https?:\/\/[^\s<]+[^\s<).,;:])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const inline = (s) =>
    String(s)
      .split(/(\[[^\]]+\]\((?:https?:\/\/|\/)[^)\s]*\))/)
      .map((part) => {
        const m = part.match(/^\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)$/);
        if (!m) return words(part);
        const here = m[2].startsWith('/');
        return `<a href="${esc(m[2])}"${here ? '' : ' target="_blank" rel="noopener"'}>${esc(m[1])}</a>`;
      })
      .join('');
  const NUM = /^-?\$?[\d,]+(\.\d+)?%?$/;
  function mdTable(rows) {
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const body = rows.slice(2).map(cells);
    const num = head.map((_, i) => body.length > 0 && body.every((r) => !r[i] || NUM.test(r[i])));
    return `<div class="md-tbl"><table><thead><tr>${head.map((h, i) => `<th${num[i] ? ' class="is-num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
      .map((r) => `<tr>${head.map((_, i) => `<td${num[i] ? ' class="is-num"' : ''}>${/^https?:\/\/\S+$/.test(r[i] || '') ? `<a href="${esc(r[i])}" target="_blank" rel="noopener">Open</a>` : inline(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function md(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\|/.test(line)) {
        flush();
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        i--;
        if (rows.length >= 2) out.push(mdTable(rows));
      } else if (/^\s*[-*] /.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''));
        i--;
        out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      } else if (/^\s*\d+\. /.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\. /, ''));
        i--;
        out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
      } else if (/^#{1,4} /.test(line)) {
        flush();
        out.push(`<h3>${inline(line.replace(/^#+ /, ''))}</h3>`);
      } else if (!line.trim()) flush();
      else para.push(line.trim());
    }
    flush();
    return out.join('').replace(/^<p><strong>(-?\$?[\d,]+(?:\.\d+)?%?)<\/strong>(\s*)/, '<p><span class="big">$1</span>$2');
  }
  B.md = md;
  B.inline = inline;

  // ---- Small parts ---------------------------------------------------------------------------------
  const scoreHTML = (v, max = 4) => {
    if (v == null) return '<span class="ns">Not rated</span>';
    let h = `<span class="scw"><span class="score${v >= max ? ' hi' : ''}" aria-hidden="true">`;
    for (let k = 1; k <= max; k++) h += `<i class="${k <= v ? 'on' : ''}"></i>`;
    return h + `</span><b class="scn">${esc(v)}</b></span>`;
  };
  // A band text such as "$50,000 to $250,000" or "$500,000 and up" gets a step from its first amount.
  const bandStep = (label) => {
    const m = String(label || '').match(/\$([\d,]+)(K|M)?/);
    if (!m) return 0;
    let n = Number(m[1].replace(/,/g, ''));
    if (m[2] === 'K') n *= 1e3;
    if (m[2] === 'M') n *= 1e6;
    return n >= 500000 ? 4 : n >= 250000 ? 3 : n >= 50000 ? 2 : 1;
  };
  const bandHTML = (label) => (label ? `<span class="band b${bandStep(label)}"><i></i>${esc(label)}</span>` : '<span class="ns">Not stored</span>');
  B.bandStep = bandStep;

  // ---- Tables ---------------------------------------------------------------------------------------
  const TB = (B.TB = {});
  let SEQ = 0;
  const isNum = (c) => ['money', 'score', 'int', 'pct'].includes(c.type);
  const cellValue = (c, x) => x[c.key];
  function cell(c, x) {
    const v = cellValue(c, x);
    switch (c.type) {
      case 'name': {
        const q = x.lookup_id ? `Tell me about lookup ${x.lookup_id}` : `Tell me about ${v}${x.place ? ' in ' + x.place : ''}`;
        return v == null || v === '' ? '<span class="ns">None</span>' : `<a href="#" class="lk" data-act="ask" data-q="${esc(q)}" data-intent="partner_lookup"${x.lookup_id ? ` data-partner-lookup="${esc(x.lookup_id)}"` : ''}>${esc(v)}</a>`;
      }
      case 'money': return v == null || v === '' ? '<span class="ns">&mdash;</span>' : esc(money(v));
      case 'int': return v == null || v === '' ? '<span class="ns">&mdash;</span>' : esc(int(v));
      case 'pct': return v == null || v === '' ? '<span class="ns">&mdash;</span>' : esc(v + '%');
      case 'score': return scoreHTML(v == null || v === '' ? null : Number(v));
      case 'band': return bandHTML(v);
      case 'date': return v ? esc(dlong(v)) : '<span class="ns">None</span>';
      default: return v == null || v === '' ? '' : esc(String(v));
    }
  }
  const sortVal = (c, x) => {
    const v = cellValue(c, x);
    if (c.type === 'band') return bandStep(v);
    return v;
  };
  function tableRows(tb) {
    let rows = tb.rows.slice();
    for (const [k, v] of Object.entries(tb.f)) rows = rows.filter((x) => String(x[k] ?? 'None') === v);
    if (tb.q) {
      const q = tb.q.toLowerCase();
      rows = rows.filter((x) => tb.cols.some((c) => String(x[c.key] ?? '').toLowerCase().includes(q)));
    }
    if (tb.sort) {
      const c = tb.cols.find((c) => c.key === tb.sort);
      if (c) {
        const dir = tb.dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const va = sortVal(c, a), vb = sortVal(c, b);
          if (va == null || va === '') return 1;
          if (vb == null || vb === '') return -1;
          return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
        });
      }
    }
    return rows;
  }
  B.tableRows = tableRows;
  function tableInner(tb, all) {
    const rows = tableRows(tb);
    const show = all ? rows : rows.slice(0, tb.preview || 8);
    const cols = all ? tb.cols : tb.cols.filter((c) => !c.panel_only);
    let h = `<table class="t"><caption class="bc-sr">${esc(tb.title)}, ${rows.length} rows</caption><thead><tr>`;
    cols.forEach((c) => {
      const s = tb.sort === c.key ? ` aria-sort="${tb.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
      h += `<th class="${isNum(c) ? 'num' : ''}"${s}><button type="button" data-act="sort" data-tb="${tb.id}" data-k="${esc(c.key)}">${esc(c.label)}${ic('sort', 'h-i ar')}</button></th>`;
    });
    h += '</tr></thead><tbody>';
    show.forEach((x) => {
      h += '<tr>' + cols.map((c, ci) => `<td class="${isNum(c) ? 'num' : ''}${ci === 0 ? ' nm' : ''}">${cell(c, x)}</td>`).join('') + '</tr>';
    });
    if (!show.length) h += `<tr><td colspan="${cols.length}" class="dim" style="text-align:center;padding:22px">Nothing matches. <button type="button" class="else" data-act="tclear" data-tb="${tb.id}">Clear the filters</button></td></tr>`;
    return h + '</tbody></table>';
  }
  const chipLabel = (tb, k) => (tb.chips.find((c) => c.key === k) || {}).label || k;
  function chipsHTML(tb, attr = '') {
    if (!tb.chips || !tb.chips.length) return '';
    // Only chips whose column carries more than one value in these rows are worth a button.
    const live = tb.chips.filter((c) => tb.f[c.key] || new Set(tb.rows.map((x) => String(x[c.key] ?? 'None'))).size > 1);
    if (!live.length) return '';
    return `<div class="tbl__chips" ${attr}>${live
      .map((c) =>
        tb.f[c.key]
          ? `<button type="button" class="chip is-on chip--x" data-act="fclear" data-tb="${tb.id}" data-k="${esc(c.key)}" aria-label="Remove the ${esc(c.label)} filter">${esc(c.label)}: <b>${esc(tb.f[c.key])}</b>${ic('close')}</button>`
          : `<button type="button" class="chip" data-act="fchip" data-tb="${tb.id}" data-k="${esc(c.key)}" aria-haspopup="menu">${esc(c.label)}${ic('caret')}</button>`
      )
      .join('')}</div>`;
  }
  B.chipValues = (tb, k) => {
    const counts = new Map();
    tb.rows.forEach((x) => {
      const v = String(x[k] ?? 'None');
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const rowLabel = (tb, n) => `${int(n)} ${tb.noun || (n === 1 ? 'row' : 'rows')}`;
  function toolsHTML(tb, inPanel, canSheets) {
    return `<button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="tcopy" data-tb="${tb.id}">${ic('copy')}<span class="lbl-l">Copy</span></button>
    <button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="tcsv" data-tb="${tb.id}">${ic('dl')}<span class="lbl-l">CSV</span></button>
    ${canSheets ? `<button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="tsheet" data-tb="${tb.id}" data-sheetbtn="${tb.id}">${ic('sheet')}<span>Open in Google Sheets</span></button>` : ''}
    ${inPanel ? '' : `<button type="button" class="ib ib--sm" data-act="topen" data-tb="${tb.id}" aria-label="Open large" data-tip="Open large">${ic('expand')}</button>`}`;
  }
  B.toolsHTML = toolsHTML;
  B.tableInner = tableInner;
  B.chipsHTML = chipsHTML;
  function tableHTML(b, ctx) {
    const id = 't' + ++SEQ;
    const tb = (TB[id] = { id, ...b, rows: b.rows || [], cols: b.cols || [], f: {}, q: '', sort: b.sort ? b.sort.key : null, dir: b.sort ? b.sort.dir : 'desc', preview: b.preview || 8, expired: !!(ctx && ctx.expired), canSheets: !!(ctx && ctx.canSheets) });
    // A table kept from an earlier visit holds only its preview rows; the full list is read again by token.
    tb.partial = tb.count > tb.rows.length;
    const n = tb.count || tb.rows.length;
    const shown = Math.min(tb.preview, tableRows(tb).length);
    return `<div class="card blk-table" data-tbwrap="${id}">
      <div class="card__h"><div><div class="card__t">${esc(b.title)}</div><div class="card__s" data-cnt="${id}">${n > shown ? `${int(shown)} of ${rowLabel(tb, n)}` : rowLabel(tb, n)}${b.more ? '+' : ''}</div></div>
        <div class="card__acts">${ctx && ctx.expired ? '' : toolsHTML(tb, false, tb.canSheets)}</div></div>
      ${chipsHTML(tb)}
      <div class="tbl__wrap"><div class="tbl__scroll" data-tbbody="${id}" tabindex="0" role="region" aria-label="${esc(b.title)}, scroll sideways for every column">${tableInner(tb)}</div></div>
      ${ctx && ctx.expired ? `<div class="bc-expired">Expired. Lists last 24 hours.<button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="ask-again" data-turn="${ctx.ti}">Ask again</button></div>` : n > tb.preview || tb.partial ? `<div class="tbl__foot"><span data-cnt2="${id}">Showing ${int(shown)} of ${int(n)}${b.more ? '+' : ''}</span><button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="topen" data-tb="${id}">Show all ${ic('arrow')}</button></div>` : ''}
      ${b.note ? `<div class="tbl__foot"><span>${esc(b.note)}</span></div>` : ''}
    </div>`;
  }
  B.refreshTable = (id) => {
    const tb = TB[id];
    if (!tb) return;
    const n = tb.count || tb.rows.length;
    const f = tableRows(tb).length;
    document.querySelectorAll(`[data-tbbody="${id}"]`).forEach((el) => (el.innerHTML = tableInner(tb, !!el.closest('.bc-panel'))));
    document.querySelectorAll(`[data-tbwrap="${id}"] .tbl__chips`).forEach((el) => (el.outerHTML = chipsHTML(tb)));
    document.querySelectorAll(`[data-pchips="${id}"]`).forEach((el) => (el.outerHTML = chipsHTML(tb, `data-pchips="${id}" style="padding:0"`)));
    const filtered = Object.keys(tb.f).length || tb.q;
    document.querySelectorAll(`[data-cnt="${id}"]`).forEach((el) => (el.textContent = filtered ? `${int(f)} of ${rowLabel(tb, n)} match` : f > tb.preview ? `${int(Math.min(tb.preview, f))} of ${rowLabel(tb, n)}` : rowLabel(tb, n)));
    document.querySelectorAll(`[data-cnt2="${id}"]`).forEach((el) => (el.textContent = `Showing ${int(Math.min(tb.preview, f))} of ${int(f)}`));
    document.querySelectorAll(`[data-pcnt="${id}"]`).forEach((el) => (el.textContent = filtered ? `${int(f)} of ${rowLabel(tb, n)} match` : rowLabel(tb, n)));
  };
  B.tsv = (tb) => {
    const rows = tableRows(tb);
    const val = (c, x) => (x[c.key] == null ? '' : String(x[c.key]).replace(/[\t\r\n]+/g, ' '));
    return [tb.cols.map((c) => c.label).join('\t'), ...rows.map((x) => tb.cols.map((c) => val(c, x)).join('\t'))].join('\n');
  };
  B.csv = (tb) => {
    const q = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // a cell that starts like a formula opens as text
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [tb.cols.map((c) => q(c.label)).join(','), ...tableRows(tb).map((x) => tb.cols.map((c) => q(x[c.key])).join(','))].join('\r\n');
  };
  const SHEET_TYPE = { name: 'text', text: 'text', int: 'int', money: 'money', date: 'date', pct: 'percent', score: 'int', band: 'text' };
  /** The rows the person sees, as a tab for the sheet writer. */
  B.sheetTab = (tb) => ({
    name: String(tb.sheet_title || tb.title || 'List').slice(0, 90),
    columns: tb.cols.map((c) => ({ key: c.key, label: c.label, type: SHEET_TYPE[c.type] || 'text' })),
    rows: tableRows(tb).map((x) => Object.fromEntries(tb.cols.map((c) => [c.key, x[c.key] == null ? null : x[c.key]]))),
    more: !!tb.more,
    note: tb.note || '',
  });

  // ---- Tiles, team ----------------------------------------------------------------------------------
  const delta = (d) => (d ? `<span class="delta ${d.dir === 'up' ? 'up' : d.dir === 'down' ? 'down' : 'flat'}">${d.dir === 'up' ? '&uarr;' : d.dir === 'down' ? '&darr;' : '&rarr;'} ${esc(Math.abs(d.pct))}%</span>` : '');
  function spark(v) {
    if (!v || v.length < 2) return '';
    const mx = Math.max(...v), mn = Math.min(...v);
    const pts = v.map((y, k) => `${(k / (v.length - 1)) * 100},${26 - ((y - mn) / (mx - mn || 1)) * 22}`).join(' ');
    return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--c-a)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function tilesHTML(b) {
    return `<div class="blk-tiles">${(b.tiles || [])
      .map((t) => {
        const num = typeof t.value === 'number' ? `<span data-count="${t.value}" data-f="${esc(t.format || 'int')}">${esc(fmt(t.value, t.format || 'int'))}</span>` : esc(t.value);
        const prog = t.progress != null ? `<div style="height:6px;border-radius:999px;background:#ece7dc;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:${Math.max(Math.min(t.progress, 100), 2)}%;background:var(--c-a);border-radius:999px;transform-origin:left;animation:bc-grow .8s var(--ease) both"></i></div>` : '';
        return `<div class="bc-tile"><div class="bc-tile__l">${esc(t.label)}</div><div class="bc-tile__n${typeof t.value === 'string' ? ' is-txt' : ''}">${num}</div><div class="bc-tile__c">${delta(t.delta)}${t.compare ? `<span>${esc(t.compare)}</span>` : ''}</div>${spark(t.trend)}${prog}</div>`;
      })
      .join('')}</div>`;
  }
  function teamHTML(b) {
    const yr = b.year;
    const mx = Math.max(1, ...b.months.map((m) => Math.max(m.a || 0, m.b || 0)));
    const qmx = Math.max(1, ...b.quarters.map((q) => Math.max(q.a || 0, q.b || 0)));
    const c = b.compare;
    let ch = null;
    if (c && c.value) ch = ((c.this_value - c.value) / c.value) * 100;
    const link = String(b.link || '').match(/\[([^\]]+)\]\(([^)]+)\)/);
    const goalPct = b.goal ? Math.min(100, (b.total / b.goal) * 100) : null;
    return `<div class="card team">
      <div class="team__top"><div><div class="h-label">${esc(b.team)} &middot; ${esc(yr)}</div><div class="team__n" data-count="${b.total}" data-f="money">${esc(money(b.total))}</div></div>
        <div class="bc-tile__c" style="padding-bottom:4px">${ch != null ? `<span class="delta ${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '&uarr;' : '&darr;'} ${Math.abs(ch).toFixed(0)}%</span><span>vs ${esc(money(c.value))} ${esc(String(c.label || '').replace(/^./, (x) => x.toLowerCase()))}</span>` : ''}${b.goal ? `<span>${esc(goalPct.toFixed(1))}% of the ${esc(money(b.goal))} goal</span>` : ''}</div>
        <div class="legend" style="margin-left:auto"><span><s style="background:var(--c-a)"></s>${esc(yr)}</span><span><s style="background:var(--c-b)"></s>${esc(yr - 1)}</span></div></div>
      ${goalPct != null ? `<div style="height:6px;border-radius:999px;background:#ece7dc;margin-top:12px;overflow:hidden" role="img" aria-label="${goalPct.toFixed(1)} percent of the goal"><i style="display:block;height:100%;width:${Math.max(goalPct, 1.5)}%;background:var(--c-a);border-radius:999px;transform-origin:left;animation:bc-grow .8s var(--ease) both"></i></div>` : ''}
      <div class="qs">${b.quarters.map((q) => `<div class="q"><span>Q${q.q}</span><b>${q.a ? esc(moneyS(q.a)) : '&mdash;'}</b><span style="font-weight:500;letter-spacing:0">${q.b != null ? esc(moneyS(q.b)) + ' in ' + (yr - 1) : ''}${q.goal ? ' &middot; goal ' + esc(moneyS(q.goal)) : ''}</span><i><em style="width:${((q.a || 0) / qmx) * 100}%"></em></i></div>`).join('')}</div>
      <div class="months" role="list" aria-label="Giving by month">${b.months.map((m, k) => `<button type="button" class="mo" role="listitem" aria-label="${MONTHS[m.m - 1]}: ${m.a == null ? 'not yet' : money(m.a)} in ${yr}, ${m.b == null ? 'none' : money(m.b)} in ${yr - 1}"><i class="a" style="height:${m.a ? Math.max((m.a / mx) * 100, 1.5) : 0}%;animation-delay:${k * 30}ms"></i><i class="b" style="height:${m.b ? (m.b / mx) * 100 : 0}%;animation-delay:${k * 30 + 60}ms"></i><span class="tipbox"><b>${MONTHS[m.m - 1]}${m.partial ? ' so far' : ''}</b><br><s style="background:var(--c-a)"></s>${yr}: ${m.a == null ? 'not yet' : esc(money(m.a))}<br><s style="background:var(--c-b)"></s>${yr - 1}: ${m.b == null ? 'none' : esc(money(m.b))}</span></button>`).join('')}</div>
      <div class="mlabels" style="grid-template-columns:repeat(${b.months.length},minmax(0,1fr))">${b.months.map((m) => `<span>${MONTHS[m.m - 1]}</span>`).join('')}</div>
      ${link ? `<div style="margin-top:10px"><a class="h-btn h-btn--ghost h-btn--xs" href="${esc(href(link[2]))}">${ic('ext')}${esc(link[1])}</a></div>` : ''}
    </div>`;
  }

  // ---- Chart (bar or line, any number of series, one axis) -------------------------------------------
  const CHARTS = {};
  const SERIES = ['var(--c-a)', 'var(--c-b)', 'var(--c-c, #3b78b0)', 'var(--c-d, #a8573a)']; // checked with the dataviz validator: lightness, chroma, colour-blind separation, contrast
  function chartHTML(b) {
    const id = 'ch' + ++SEQ;
    CHARTS[id] = b;
    return `<div class="card chart"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><div class="card__t">${esc(b.title)}</div>
      <div class="legend" style="margin-left:auto">${(b.series || []).map((s, i) => `<span><s class="${b.kind === 'line' ? 'ln' : ''}" style="background:${SERIES[i % 4]}"></s>${esc(s.label)}</span>`).join('')}</div></div>
      <div class="chart__wrap" data-chart="${id}"></div>${b.note ? `<div style="font-size:12px;color:var(--h-ink-3);margin-top:6px">${esc(b.note)}</div>` : ''}</div>`;
  }
  const niceTicks = (mx) => {
    if (mx <= 0) return { top: 1, step: 1 };
    const raw = mx / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    return { top: Math.ceil(mx / step) * step, step };
  };
  function drawCharts(root) {
    root.querySelectorAll('[data-chart]').forEach((el) => {
      const b = CHARTS[el.dataset.chart];
      if (!b || !el.clientWidth) return;
      const X = b.x || [], S = b.series || [];
      const W = Math.max(el.clientWidth, 260), H = 220, L = 54, R = 10, T = 10, BT = 26;
      const all = S.flatMap((s) => s.values).filter((v) => v != null);
      const { top, step } = niceTicks(Math.max(0, ...all));
      const yf = b.y_format || 'money_short';
      const yl = (v) => (v === 0 ? (yf.startsWith('money') ? '$0' : '0') : fmt(v, yf === 'money' ? 'money_short' : yf));
      const n = Math.max(X.length, 1);
      const x = (k) => (b.kind === 'bar' ? L + ((k + 0.5) / n) * (W - L - R) : L + (n === 1 ? 0.5 : k / (n - 1)) * (W - L - R));
      const y = (v) => T + (1 - v / top) * (H - T - BT);
      let g = '', ax = '';
      for (let t = 0; t <= top + 1e-9; t += step) {
        g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/>`;
        ax += `<text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(yl(t))}</text>`;
      }
      const every = Math.ceil(n / Math.max(2, Math.floor((W - L) / 54)));
      X.forEach((lab, k) => { if (k % every === 0) ax += `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${esc(lab)}</text>`; });
      let marks = '';
      if (b.kind === 'bar') {
        const gw = ((W - L - R) / n) * 0.72, bw = Math.min(26, gw / Math.max(S.length, 1) - 2);
        S.forEach((s, i) => s.values.forEach((v, k) => {
          if (v == null) return;
          const bx = x(k) - (S.length * (bw + 2)) / 2 + i * (bw + 2), by = y(v);
          marks += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(H - BT - by, 1).toFixed(1)}" rx="3" fill="${SERIES[i % 4]}" style="transform-origin:${(bx + bw / 2).toFixed(1)}px ${H - BT}px;animation:bc-growy .7s var(--ease) both;animation-delay:${k * 25}ms"/>`;
        }));
      } else {
        const path = (v) => v.map((p, k) => (p == null ? '' : `${k && v[k - 1] != null ? 'L' : 'M'}${x(k).toFixed(1)},${y(p).toFixed(1)}`)).join('');
        S.slice().reverse().forEach((s, ri) => {
          const i = S.length - 1 - ri;
          marks += `<path class="l draw" d="${path(s.values)}" stroke="${SERIES[i % 4]}" style="animation-delay:${i * 0.15}s"/>`;
        });
        const s0 = S[0] ? S[0].values : [];
        const last = s0.reduce((li, v, k) => (v != null ? k : li), -1);
        if (last >= 0) marks += `<circle cx="${x(last)}" cy="${y(s0[last])}" r="4.5" fill="${SERIES[0]}" stroke="#fff" stroke-width="2"/>`;
        marks += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - BT}"/>` + S.map((_, i) => `<circle class="dot d${i}" r="5" fill="${SERIES[i % 4]}"/>`).join('');
      }
      el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(b.title)}"><g class="grid">${g}</g><g class="ax">${ax}</g>${marks}<rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg><div class="chart__tip tipbox" style="bottom:auto;transform:none"></div>`;
      const svg = el.querySelector('svg'), tip = el.querySelector('.chart__tip');
      svg.addEventListener('pointermove', (ev) => {
        const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
        const k = Math.max(0, Math.min(n - 1, b.kind === 'bar' ? Math.floor(((px - L) / (W - L - R)) * n) : Math.round(((px - L) / (W - L - R)) * (n - 1))));
        el.classList.add('is-hover');
        svg.classList.add('is-hover');
        if (b.kind !== 'bar') {
          const cr = svg.querySelector('.cross');
          cr.setAttribute('x1', x(k)); cr.setAttribute('x2', x(k));
          S.forEach((s, i) => {
            const d = svg.querySelector('.d' + i);
            if (d && s.values[k] != null) { d.setAttribute('cx', x(k)); d.setAttribute('cy', y(s.values[k])); d.style.display = ''; } else if (d) d.style.display = 'none';
          });
        }
        tip.innerHTML = `<b>${esc(X[k])}</b>` + S.map((s, i) => `<br><s style="background:${SERIES[i % 4]}"></s>${esc(s.label)}: ${s.values[k] == null ? 'not yet' : esc(fmt(s.values[k], yf === 'money_short' ? 'money' : yf))}`).join('');
        tip.style.left = Math.min(Math.max((x(k) / W) * r.width - 70, 0), Math.max(r.width - 150, 0)) + 'px';
        tip.style.top = '-6px';
      });
      svg.addEventListener('pointerleave', () => { el.classList.remove('is-hover'); svg.classList.remove('is-hover'); });
    });
  }
  B.drawCharts = drawCharts;
  // A table wider than its card scrolls sideways. The wrapper shows a fade on each edge that has more to see.
  function tableFades() {
    document.querySelectorAll('.tbl__wrap').forEach((w) => {
      const s = w.querySelector('.tbl__scroll');
      if (!s) return;
      const th = s.querySelector('th');
      if (th) w.style.setProperty('--fw', th.offsetWidth + 'px');
      w.classList.toggle('more-r', s.scrollWidth - s.clientWidth - s.scrollLeft > 4);
      w.classList.toggle('more-l', s.scrollLeft > 4);
    });
  }
  B.tableFades = tableFades;
  document.addEventListener('scroll', (e) => { if (e.target && e.target.classList && e.target.classList.contains('tbl__scroll')) tableFades(); }, true);
  addEventListener('resize', tableFades);
  let fadeT = 0;
  new MutationObserver(() => { clearTimeout(fadeT); fadeT = setTimeout(tableFades, 60); }).observe(document.body, { childList: true, subtree: true });

  // ---- Partner card ---------------------------------------------------------------------------------
  const initials = (n) => String(n || '?').replace(/[^A-Za-z\s.]/g, '').split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  function partnerHTML(b, ctx) {
    const ys = b.years || [];
    const mx = Math.max(1, ...ys.map((y) => y.amount));
    const s = b.stats || {};
    const w = b.iwave;
    let iw = '';
    if (w) {
      const rd = w.scored_at;
      const band = w.band;
      const step = band ? bandStep(band.label) : 0;
      iw = `<div class="pc__iw"><div class="pc__sec">iWave ratings ${w.fresh ? `<span class="updated">${ic('check')}Scored just now</span>` : rd ? `<span class="src">Scored ${esc(dlong(rd))}</span>` : ''}</div>
        ${(w.meters || []).map((m) => `<div class="meter${m.value >= m.max ? ' hi' : ''}"><span>${esc(m.label)}</span><div class="meter__bar" style="grid-template-columns:repeat(${m.max},1fr)" role="img" aria-label="${esc(m.label)} ${m.value == null ? 'not rated' : m.value + ' of ' + m.max}">${Array.from({ length: m.max }, (_, k) => `<i class="${m.value != null && k + 1 <= m.value ? 'on' : ''}" style="animation-delay:${(k + 1) * 70}ms"></i>`).join('')}</div><em>${m.value == null ? esc(m.why || 'Not rated') : `<b>${m.value} of ${m.max}</b>${esc(dlong(m.date || rd))}`}</em></div>`).join('')}
        <div class="capband"><div class="capband__top"><span>Capacity band <b>${band ? esc(band.label) : 'Not stored'}</b></span><span>${w.estimate ? `iWave estimate <b>${esc(money(w.estimate.value))}</b>` : '<span class="ns">Estimate fills on the next refresh</span>'}</span></div>
          <div class="capband__bar">${[1, 2, 3, 4].map((k) => `<i class="${k === step ? 'on' : ''}"></i>`).join('')}</div><div class="capband__lab"><span>$0</span><span>$50K</span><span>$250K</span><span>$500K+</span></div></div></div>`;
    } else iw = `<div class="pc__iw"><div class="pc__sec">iWave ratings</div><p style="margin:0;font-size:13px;color:var(--h-ink-3)">Open to leadership and the RDDs.</p></div>`;
    const lg = s.last_gift, lc = s.last_contact;
    const acts = (b.actions || [])
      .map((a) => {
        if (a.href) return `<a class="h-btn h-btn--ghost h-btn--sm" href="${esc(href(a.href))}" target="_blank" rel="noopener">${ic('ext')}${esc(a.label)}</a>`;
        if (a.sheet) return ctx && ctx.canSheets ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="pexport" data-turn="${ctx.ti}" data-bi="${ctx.bi}">${ic('sheet')}Open in Google Sheets</button>` : '';
        return `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="ask" data-q="${esc(a.ask || a.label)}"${a.id === 'gifts' ? '' : ''}>${ic(a.id === 'refresh' ? 'redo' : 'list')}${esc(a.label)}</button>`;
      })
      .join('');
    return `<div class="card pc${w && w.fresh ? ' is-fresh' : ''}">
      <div class="pc__h"><div class="pc__av">${esc(initials(b.name))}</div><div style="min-width:0"><div class="pc__n">${esc(b.name)}</div><div class="pc__s">${esc(b.place || '')}${b.kind ? ' &middot; ' + esc(b.kind) : ''} ${(b.tags || []).map((t) => `<span class="tag g">${esc(t)}</span>`).join(' ')}</div></div>${b.holder ? `<span class="tag l">${ic('user')}Held by ${esc(b.holder.name)}</span>` : ''}</div>
      <div class="pc__stats">
        <div class="pc__stat"><span>Lifetime giving</span><b data-count="${s.lifetime || 0}" data-f="money">${esc(money(s.lifetime || 0))}</b><small>${s.since ? 'since ' + esc(s.since) : ''}</small></div>
        <div class="pc__stat"><span>Last gift</span><b>${lg ? esc(money(lg.amount)) : 'None'}</b><small>${lg ? esc(dlong(lg.date)) : ''}</small></div>
        <div class="pc__stat"><span>Largest gift</span><b>${s.largest ? esc(money(s.largest.amount)) : 'None'}</b><small>${s.largest ? esc(dlong(s.largest.date)) : ''}</small></div>
        <div class="pc__stat"><span>Last contact</span><b>${lc ? esc(lc.kind) : 'None on file'}</b><small>${lc ? esc(dlong(lc.date)) + (lc.by ? ' &middot; ' + esc(lc.by) : '') : ''}</small></div>
      </div>
      <div class="pc__body"><div class="pc__giving"><div class="pc__sec">Giving by year</div>
        ${ys.length ? `<div class="yb" style="grid-template-columns:repeat(${ys.length},minmax(0,1fr))">${ys.map((y, k) => `<button type="button" aria-label="${y.y}: ${money(y.amount)}"><i class="${y.amount ? '' : 'z'}" style="height:${(y.amount / mx) * 100}%;animation-delay:${k * 50}ms"></i><span class="tipbox"><b>${y.y}</b><br>${esc(money(y.amount))}</span></button>`).join('')}</div>
        <div class="yl" style="grid-template-columns:repeat(${ys.length},minmax(0,1fr))">${ys.map((y) => `<span>${y.y}</span>`).join('')}</div>` : '<p style="margin:0;font-size:13px;color:var(--h-ink-3)">No gifts on file.</p>'}</div>${iw}</div>
      ${acts ? `<div class="pc__acts">${acts}</div>` : ''}</div>`;
  }

  // ---- Coverage, steps, note, choice, sheet, consent ----------------------------------------------------
  const TONE = { a: 'var(--c-a)', b: 'var(--c-b)', muted: '#cfc8b8' };
  function coverageHTML(b) {
    const segs = b.segments || [];
    return `<div class="card cov"><div class="card__t">${esc(b.title)}</div><div class="cov__bar" role="img" aria-label="${segs.map((s) => `${s.label} ${s.n}`).join(', ')}">${segs.map((s, k) => `<i style="flex:${Math.max(s.n, b.total * 0.006)};background:${TONE[s.tone] || TONE.muted};animation-delay:${k * 120}ms"></i>`).join('')}</div>
      <div class="cov__lg">${segs.map((s) => `<span><s style="background:${TONE[s.tone] || TONE.muted}"></s><b>${int(s.n)}</b> ${esc(String(s.label).toLowerCase())}${s.note ? ` <span style="color:var(--h-ink-3)">(${esc(s.note)})</span>` : ''}</span>`).join('')}</div></div>`;
  }
  function stepsHTML(b) {
    const src = b.source;
    const acts = `${b.video ? `<a class="h-btn h-btn--ghost h-btn--xs" href="${esc(href(b.video.href))}">${ic('play')}Watch the video</a>` : ''}${src && src.href ? `<a class="h-btn h-btn--ghost h-btn--xs" href="${esc(href(src.href))}" target="_blank" rel="noopener">${ic('ext')}Open in the manual</a>` : ''}`;
    return `<div class="card"><div class="card__h"><div><div class="card__t">${esc(b.title)}</div>${src ? `<div class="card__s">${ic('book')} ${esc(src.manual)}${src.section ? ' &middot; ' + esc(src.section) : ''}</div>` : ''}</div>${acts ? `<div class="card__acts">${acts}</div>` : ''}</div>
      <div class="steps"><ol>${(b.steps || []).map((s) => `<li><div>${inline(s.md)}${s.hint ? `<small>${esc(s.hint)}</small>` : ''}</div></li>`).join('')}</ol></div></div>`;
  }
  // ---- Drive file cards: the file, its owner and dates, Open in Drive, then the passage or the number ----
  // The icon follows the file type; the tool color follows it in brain.css (doc blue, sheet green, slides gold, PDF terracotta, media violet).
  const FILE_ICON = { doc: 'fdoc', pdf: 'fdoc', office: 'fdoc', text: 'fdoc', sheet: 'fgrid', slides: 'fslides', image: 'fimage', video: 'play', audio: 'volume' };
  // The day the index last read a file: "Oct 10", with the year when it is not this one.
  const dshort = (iso) => {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}${+m[1] === new Date().getFullYear() ? '' : ', ' + m[1]}` : '';
  };
  // A sheet cell that holds a number shows large with its column name; a cell that holds words reads as a quote.
  // A column the sheet never named comes through as "col A", which says nothing, so it is left out.
  const NUMBERISH = /^[-(]?\$?\d[\d,]*(\.\d+)?\s?(%|[KMB])?\)?$/i;
  const namedColumn = (h) => (/^col [A-Z]{1,3}$/i.test(String(h || '').trim()) ? '' : String(h || '').trim());
  // The index keeps the markdown marks of converted files (## headings, ** bold, * bullets). A passage reads without them.
  const tidy = (t) =>
    String(t == null ? '' : t)
      .replace(/\*{2,3}([^*]+)\*{2,3}/g, '$1')
      .replace(/\*{2,}/g, '')
      .replace(/(^|\s)#{1,6}(?=\s)/g, '$1')
      .replace(/(^|\s)\*(?=\s)/g, '$1·')
      .replace(/\s{2,}/g, ' ')
      .trim();
  function passageHTML(p) {
    if (!p.cell) return `<blockquote class="fq">${esc(tidy(p.text))}${p.loc ? `<em>${esc(p.loc)}</em>` : ''}</blockquote>`;
    const v = String(p.cell.value == null ? '' : p.cell.value).trim();
    const col = namedColumn(p.cell.header);
    const where = `${p.sheet ? `Sheet ${p.sheet}, cell` : 'Cell'} ${p.cell.ref}`;
    if (NUMBERISH.test(v)) return `<div class="fnum"><b>${esc(v)}</b>${col ? `<span>${esc(col)}</span>` : ''}<em>${esc(where)}</em></div>`;
    return `<blockquote class="fq">${esc(v)}<em>${col ? esc(col) + ' &middot; ' : ''}${esc(where)}</em></blockquote>`;
  }
  function fileRowHTML(f) {
    const kind = FILE_ICON[f.kind] ? f.kind : 'other';
    const meta = [f.owner ? esc(f.owner) : '', f.modified ? esc(dlong(f.modified)) : ''].filter(Boolean).join(' &middot; ');
    const ps = (f.passages || []).map(passageHTML).join('');
    const hint = f.hint ? '<span class="tag">Matched by picture description</span>' : '';
    const idx = f.indexed ? dshort(f.indexed) : '';
    return `<div class="frow frow--${kind}" role="listitem"><span class="ftile">${ic(FILE_ICON[kind] || 'fdoc')}</span>
      <div class="frow__t"><b class="frow__n">${esc(f.title)}</b><div class="frow__m"><span class="tag ftag">${esc(f.kind_label || 'File')}</span>${meta}</div>${f.folder ? `<div class="frow__f">${esc(f.folder)}</div>` : ''}</div>
      <div class="frow__side"><a class="h-btn h-btn--ghost h-btn--xs" href="${esc(href(f.link))}" target="_blank" rel="noopener" aria-label="Open ${esc(f.title)} in Drive">${ic('ext')}Open in Drive</a>${idx ? `<span class="fidx">Indexed <time datetime="${esc(String(f.indexed).slice(0, 10))}">${esc(idx)}</time></span>` : ''}</div>
      ${ps || hint ? `<div class="frow__b">${ps}${hint}</div>` : ''}</div>`;
  }
  // The weaker matches wait behind a quiet "N more matches" line. A native disclosure opens them in place, with no script.
  function filesHTML(b) {
    const more = b.more || [];
    const moreHTML = more.length
      ? `<details class="fmore"><summary>${more.length} more ${more.length === 1 ? 'match' : 'matches'}${ic('caret')}</summary><div class="frows" role="list">${more.map(fileRowHTML).join('')}</div></details>`
      : '';
    return `<div class="card fcards"><div class="card__h"><div><div class="card__t">${esc(b.title)}</div><div class="card__s">${ic('lock')} Only files your Google account can open</div></div></div><div class="frows" role="list">${(b.files || []).map(fileRowHTML).join('')}</div>${moreHTML}</div>`;
  }
  const STATUS = { ready: ['wait', 'Ready'], waiting: ['wait', 'Waiting for Will'], sent: ['wait', 'Sent to Will'], approved: ['ok', 'Approved'], running: ['wait', 'Running'], done: ['ok', 'Done'], declined: ['no', 'Declined'], refused: ['no', 'Not done'] };
  function confirmHTML(b, ctx) {
    const st = STATUS[b.status] || STATUS.ready;
    const busy = b._busy;
    const acts = (b.actions || [])
      .map((a) => {
        if (a.ask) return `<button type="button" class="h-btn h-btn--ghost" data-act="ask" data-q="${esc(a.ask)}">${ic('list')}${esc(a.label)}</button>`;
        const cls = a.tone === 'gold' ? 'h-btn--gold' : a.id === 'approve' ? 'h-btn--primary' : 'h-btn--ghost';
        return `<button type="button" class="h-btn ${cls}" data-act="cf" data-turn="${ctx.ti}" data-bi="${ctx.bi}" data-do="${esc(a.id)}"${a.enabled === false || busy ? ' disabled' : ''}>${busy === a.id ? '<span class="spin d"></span>' : a.id === 'approve' ? ic('coin') : ''}${esc(a.label)}</button>`;
      })
      .join('');
    const pr = b.progress;
    return `<div class="card cf"><div class="cf__h"><div class="cf__i">${ic(b.kind === 'iwave_refresh' ? 'redo' : 'coin')}</div><div><div class="cf__t">${esc(b.title)}</div>${b.sub ? `<div class="cf__s">${esc(b.sub)}</div>` : ''}</div><span class="state ${st[0]}"><i></i>${st[1]}</span></div>
      ${(b.facts || []).length ? `<div class="cf__rows">${b.facts.map((f) => `<div class="kv"><span>${esc(f.label)}</span><b>${esc(typeof f.value === 'number' ? int(f.value) : f.value)}</b>${f.sub ? `<small>${esc(f.sub)}</small>` : ''}</div>`).join('')}</div>` : ''}
      ${(b.notes || []).length ? `<ul class="cf__notes">${b.notes.map((n) => `<li>${ic(n.icon || 'info')}<span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}
      ${pr ? `<div class="prog" role="progressbar" aria-valuenow="${pr.done}" aria-valuemax="${pr.total}"><i style="width:${pr.total ? (pr.done / pr.total) * 100 : 0}%"></i></div>` : ''}
      <div class="cf__acts">${acts}${b.who ? `<span class="who">${ic('shield')}${esc(b.who)}</span>` : ''}</div></div>`;
  }
  function noteHTML(b, ctx) {
    let acts = '';
    if (b.access) acts = b._state === 'asked' ? '<span class="state wait"><i></i>Request sent to Will</span>' : ctx.canRequest && ctx.canRequest(b.access) ? `<button type="button" class="h-btn h-btn--primary h-btn--sm" data-act="access-ask" data-turn="${ctx.ti}" data-bi="${ctx.bi}" data-pkg="${esc(b.access)}">Ask Will for access</button>` : '';
    if (b.asks && b.asks.length) acts += b.asks.map((q) => `<button type="button" class="fu" data-act="ask" data-q="${esc(q)}">${ic('arrow')}${esc(q)}</button>`).join('');
    return `<div class="note"><div class="note__i">${ic(b.tone === 'lock' ? 'lock' : 'info')}</div><b>${esc(b.title)}</b>${b.body ? `<p>${inline(b.body)}</p>` : ''}${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  }
  function choiceHTML(b, ctx) {
    const picked = b._picked;
    return `<div class="blk-choice${picked != null ? ' is-done' : ''}">${b.q ? `<div class="blk-choice__q">${esc(b.q)}</div>` : ''}<div class="blk-choice__opts">${(b.opts || [])
      .map((o, k) => `<button type="button" class="opt${picked === k ? ' is-picked' : ''}" data-act="choose" data-turn="${ctx.ti}" data-bi="${ctx.bi}" data-k="${k}" data-q="${esc(o.ask)}"${o.intent ? ` data-intent="${esc(o.intent)}"` : ''}><span class="opt__i${o.icon === 'spark' ? ' g' : ''}">${ic(o.icon || 'arrow')}</span><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}${ic('arrow')}</button>`)
      .join('')}</div>${b.other ? '<button type="button" class="else" data-act="else">Something else</button>' : ''}</div>`;
  }
  function sheetHTML(b) {
    return `<div class="card sheet"><div class="sheet__i"><svg class="h-i" style="width:26px;height:26px"><use href="#bci-sheet"/></svg></div><div style="min-width:0"><b>${esc(b.title)}</b><small>${int(b.rows)} rows in your Drive. ${b.private ? 'Only you can open it. ' : ''}Keep it inside Favor.</small></div><a class="h-btn h-btn--primary h-btn--sm" href="${esc(href(b.url))}" target="_blank" rel="noopener">${ic('ext')}Open the sheet</a></div>`;
  }
  /** A Sources row: one chip per manual section, opening that section. */
  function sourcesHTML(b) {
    const items = (b.items || []).slice(0, 2);
    if (!items.length) return '';
    return `<div class="srcrow"><span class="srcrow__l">Sources</span>${items.map((i) => (i.href ? `<a class="srcchip" href="${esc(href(i.href))}" target="_blank" rel="noopener">${ic('book')}${esc(i.label)}${ic('ext')}</a>` : `<span class="srcchip">${ic('book')}${esc(i.label)}</span>`)).join('')}</div>`;
  }
  function consentHTML(b, ctx) {
    return `<div class="card consent" data-extra="consent"><b>Allow Favor to make Google Sheets for you</b><p>Google will ask once. Favor can then create sheets in your own Drive and open only the sheets it made. Only you can open them.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="h-btn h-btn--primary" data-act="consent-go" data-turn="${ctx.ti}" data-bi="${ctx.bi}">Allow</button><button type="button" class="h-btn h-btn--ghost" data-act="consent-no" data-turn="${ctx.ti}" data-bi="${ctx.bi}">No thanks</button></div></div>`;
  }

  /** One block as HTML. ctx: { ti, bi, canSheets, canRequest(pkg), expired }. */
  B.render = (b, ctx) => {
    switch (b.type) {
      case 'text': return `<div class="blk-text">${md(b.md)}</div>`;
      case 'tiles': return tilesHTML(b);
      case 'choice': return choiceHTML(b, ctx);
      case 'table': return tableHTML(b, ctx);
      case 'team': return teamHTML(b);
      case 'chart': return chartHTML(b);
      case 'partner': return partnerHTML(b, ctx);
      case 'coverage': return coverageHTML(b);
      case 'steps': return stepsHTML(b);
      case 'confirm': return confirmHTML(b, ctx);
      case 'note': return noteHTML(b, ctx);
      case 'sheet': return sheetHTML(b);
      case 'sources': return sourcesHTML(b);
      case 'consent': return consentHTML(b, ctx);
      case 'files': return filesHTML(b);
      default: return b && b.md ? `<div class="blk-text">${md(b.md)}</div>` : '';
    }
  };
  B.fallback = (markdown) => `<div class="blk-text">${md(markdown)}</div>`;

  /** Reading chips: tap one with options to change it and rerun the answer. */
  B.reading = (chips, ti) => {
    if (!chips || !chips.length) return '';
    return `<div class="blk-read"><span class="lbl">How I read it</span>${chips
      .map((r, k) => (r.options && r.options.length
        ? `<button type="button" class="chip" data-act="rchip" data-turn="${ti}" data-k="${k}" aria-haspopup="menu" aria-label="${esc(r.label)}: ${esc(r.value)}. Change">${esc(r.label)} <b>${esc(r.value)}</b>${ic('caret')}</button>`
        : `<span class="chip is-fixed">${esc(r.label)} <b>${esc(r.value)}</b></span>`))
      .join('')}</div>`;
  };

  B.countUp = (root, noAnim) => {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const n = +el.dataset.count, f = el.dataset.f;
      const fm = (v) => (f === 'money_short' ? moneyS(v) : f === 'money' || f === 'moneyfull' ? money(v) : f === 'pct' ? Math.round(v) + '%' : int(v));
      if (el.dataset.counted) return;
      el.dataset.counted = '1';
      if (noAnim || reduced() || !Number.isFinite(n)) { el.textContent = fm(n); return; }
      const t0 = performance.now(), dur = 700;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fm(n * e);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };
})();
