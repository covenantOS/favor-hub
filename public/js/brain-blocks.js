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
    return `<div class="md-tbl"><table class="sc-table"><thead><tr>${head.map((h, i) => `<th${num[i] ? ' class="is-num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
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
        return v == null || v === '' ? '<span class="ns">None</span>' : `<a href="#" class="lk" data-act="ask" data-q="${esc(q)}" data-intent="partner_lookup"${x.lookup_id ? ` data-entity="partner:L${esc(x.lookup_id)}" data-label="${esc(v)}"` : ''}${x.lookup_id ? ` data-partner-lookup="${esc(x.lookup_id)}"` : ''} title="${esc(v)}">${esc(v)}</a>`;
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
    let h = `<table class="t sc-table"><caption class="bc-sr">${esc(tb.title)}, ${int(rows.length)} ${rows.length === 1 ? 'row' : 'rows'}</caption><thead><tr>`;
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
  // The Brain names the rows in the plural ("partners"); one row reads "1 partner".
  const rowLabel = (tb, n) => `${int(n)} ${tb.noun ? (Number(n) === 1 ? String(tb.noun).replace(/s$/, '') : tb.noun) : Number(n) === 1 ? 'row' : 'rows'}`;
  function toolsHTML(tb, inPanel, canSheets) {
    return `<button type="button" class="h-btn h-btn--ghost h-btn--xs tb-ic" data-act="tcopy" data-tb="${tb.id}" aria-label="Copy the table" data-tip="Copy">${ic('copy')}<span class="lbl-l">Copy</span></button>
    <button type="button" class="h-btn h-btn--ghost h-btn--xs tb-ic" data-act="tcsv" data-tb="${tb.id}" aria-label="Download a CSV" data-tip="Download CSV">${ic('dl')}<span class="lbl-l">CSV</span></button>
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
      <div class="card__h"><div><div class="card__t" title="${esc(b.title)}">${esc(shortTitle(b.title, nounOf(b)))}</div><div class="card__s" data-cnt="${id}">${n > shown ? `${int(shown)} of ${rowLabel(tb, n)}` : rowLabel(tb, n)}${b.more ? '+' : ''}</div></div>
        <div class="card__acts">${ctx && ctx.expired ? '' : toolsHTML(tb, false, tb.canSheets)}</div></div>
      ${chipsHTML(tb)}
      ${miniHTML(tb, n)}
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
    document.querySelectorAll(`[data-tbbody="${id}"]`).forEach((el) => (el.innerHTML = tableInner(tb, !!(el.hasAttribute('data-tbfull') || el.closest('.bc-panel')))));
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
  const delta = (d) => (d ? `<span class="delta ${d.dir === 'up' ? 'up' : d.dir === 'down' ? 'down' : 'flat'}">${d.dir === 'up' ? '&uarr;' : d.dir === 'down' ? '&darr;' : '&rarr;'} ${esc(Math.abs(Number(d.pct) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 }))}%</span>` : '');
  // A table's title said plainly: "How many lapsed (last gift over 24 months ago) partners (households) in Ohio" reads
  // "Lapsed partners in Ohio". The full wording stays in the title attribute and in the steps above the answer.
  // A title cut short by the Brain ("Lapsed, major (a single gift of $1,000 or more") gets its noun back from the table:
  // "Lapsed major partners". Commas between single describing words go ("lapsed, major" reads "lapsed major").
  const NOUNS = /\b(partners?|households?|gifts?|actions?|visits?|events?|records?|churches|foundations|individuals|organizations|grants?|opportunities|people|staff|codes?|appeals?|campaigns?|funds?|months?|years?|states?|teams?|rows?)\b/i;
  // The table's noun, else its first column read as a plural ("Partner" gives "partners").
  const nounOf = (b) => b.noun || (b.cols && b.cols[0] && /^[A-Za-z ]+$/.test(b.cols[0].label || '') ? String(b.cols[0].label).toLowerCase().replace(/y$/, 'ie').replace(/s?$/, 's') : '');
  function shortTitle(t, noun) {
    let s = String(t || '').replace(/^\s*(how many|list(?: of)?|a list of|show me|which)\s+/i, '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\([^)]*$/, '').replace(/\s+/g, ' ').replace(/[?.,:;]+$/, '').trim();
    if (!s) return String(t || '');
    s = s.replace(/^[A-Za-z]+(?:, [A-Za-z]+)+(?= |$)/, (m) => m.replace(/,/g, ''));
    if (!NOUNS.test(s) && noun) s += ' ' + String(noun).toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  B.shortTitle = shortTitle;
  // The table in a narrow answer (the dock, a phone, a narrow window; container query in brain.css): up to five rows, each the
  // name and one key field, and Open full table.
  function miniHTML(tb, n) {
    const rows = tableRows(tb).slice(0, 5);
    if (!rows.length || !tb.cols.length) return '';
    const name = tb.cols[0];
    const key = tb.cols.slice(1).find((c) => !c.panel_only && ['money', 'date', 'int'].includes(c.type)) || tb.cols.slice(1).find((c) => !c.panel_only);
    return `<ul class="tbl__mini" aria-label="${esc(shortTitle(tb.title, nounOf(tb)))}, first ${rows.length}">${rows.map((x) => `<li><span class="mn">${cell(name, x)}</span>${key ? `<span class="mk">${cell(key, x)}</span>` : ''}</li>`).join('')}</ul>
      <div class="tbl__minifoot"><button type="button" class="h-btn h-btn--ghost h-btn--xs" data-act="topen" data-tb="${tb.id}">Open full table${n > rows.length ? ` (${int(n)})` : ''} ${ic('arrow')}</button></div>`;
  }
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
        return `<div class="bc-tile"><div class="bc-tile__l">${esc(t.label)}</div><div class="bc-tile__n${typeof t.value === 'string' ? ' is-txt' : fmt(t.value, t.format || 'int').length > 10 ? ' is-long' : ''}">${num}</div><div class="bc-tile__c">${delta(t.delta)}${t.compare ? `<span>${esc(t.compare)}</span>` : ''}</div>${spark(t.trend)}${prog}</div>`;
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
      <div class="chart__wrap" data-chart="${id}"></div>${b.note ? `<div style="font-size:13px;color:var(--h-ink-3);margin-top:6px">${esc(b.note)}</div>` : ''}</div>`;
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // 2026-03 reads as Mar; the year shows on the first label and on every January.
  const monthLab = (lab, k, every) => { const m = /^(\d{4})-(\d{2})$/.exec(String(lab)); if (!m) return lab; const mo = MON[+m[2] - 1]; return mo ? (k === 0 || m[2] === '01' ? mo + ' ' + m[1].slice(2) : mo) : lab; };
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
      // A chart already drawn at this width stays as it is, so a redraw of the page around it never restarts its animation.
      if (el._cw === el.clientWidth && el.firstChild) return;
      el._cw = el.clientWidth;
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
      X.forEach((lab, k) => { if (k % every === 0) ax += `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${esc(monthLab(lab, k, every))}</text>`; });
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
  const initials = (n) => { const w = String(n || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x)); const p = w.length > 1 ? [w[0], w[w.length - 1]] : w; return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?'; };
  // A status or kind tag the server sends: the standard terms get their plain meaning on hover, tap and focus; LYBUNT is spelled as the term is.
  const TAGTERM = { active: 'active', lybunt: 'lybunt', lapsed: 'lapsed', 'major partner': 'major', major: 'major', daf: 'daf', 'soft credit': 'soft', household: 'household', other: 'other' };
  function tagHTML(t) {
    const key = TAGTERM[String(t).trim().toLowerCase()];
    const label = key === 'lybunt' ? 'LYBUNT' : String(t);
    return `<span class="tag g">${window.FavorUI && FavorUI.term && key ? FavorUI.term(key, label) : esc(label)}</span>`;
  }
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
      <div class="pc__h"><div class="pc__av">${esc(initials(b.name))}</div><div style="min-width:0"><div class="pc__n">${esc(b.name)}</div><div class="pc__s">${esc(b.place || '')}${b.kind ? ' &middot; ' + esc(b.kind) : ''} ${(b.tags || []).map(tagHTML).join(' ')}</div></div>${b.holder ? `<span class="tag l">${ic('user')}Held by ${esc(b.holder.name)}</span>` : ''}</div>
      <div class="pc__stats">
        <div class="pc__stat"><span>Lifetime giving</span><b data-count="${s.lifetime || 0}" data-f="money">${esc(money(s.lifetime || 0))}</b><small>${s.since ? 'since ' + esc(s.since) : ''}</small></div>
        <div class="pc__stat"><span>Last gift</span><b>${lg ? esc(money(lg.credited != null ? lg.credited : lg.amount)) : 'None'}</b><small>${lg ? esc(dlong(lg.date)) + (lg.through ? ' through ' + esc(lg.through) : '') : ''}</small></div>
        <div class="pc__stat"><span>Largest gift</span><b>${s.largest ? esc(money(s.largest.credited != null ? s.largest.credited : s.largest.amount)) : 'None'}</b><small>${s.largest ? esc(dlong(s.largest.date)) : ''}</small></div>
        <div class="pc__stat"><span>Last contact</span><b>${lc ? esc(lc.kind) : 'None on file'}</b><small>${lc ? esc(dlong(lc.date)) + (lc.by ? ' &middot; ' + esc(lc.by) : '') : ''}</small></div>
      </div>
      <div class="pc__body"><div class="pc__giving"><div class="pc__sec">Giving by year</div>
        ${ys.length ? `<div class="yb" style="grid-template-columns:repeat(${ys.length},minmax(0,1fr))">${ys.map((y, k) => `<button type="button" aria-label="${y.y}: ${money(y.amount)}"><i class="${y.amount ? '' : 'z'}" style="height:${(y.amount / mx) * 100}%;animation-delay:${k * 50}ms"></i><span class="tipbox"><b>${y.y}</b><br>${esc(money(y.amount))}</span></button>`).join('')}</div>
        <div class="yl" style="grid-template-columns:repeat(${ys.length},minmax(0,1fr))">${ys.map((y, k) => `<span>${ys.length <= 10 || k % Math.ceil(ys.length / 8) === 0 ? y.y : ''}</span>`).join('')}</div>` : `<p style="margin:0;font-size:13px;color:var(--h-ink-3)">${s.lifetime ? 'No yearly breakdown came with this record.' : 'No gifts yet.'}</p>`}</div>${iw}</div>
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
  // ---- Photos and videos: a dense grid, a large view, a player ----
  // Pictures come through /api/brain/drive/thumb and video through /api/brain/drive/stream. The Brain serves either only after
  // the person's own Google account opens the file. A photo answer is a justified grid (rows of equal height, each picture at
  // its own shape); a video answer is a grid of 16:9 tiles with the length and the matched moment. "Show more" and the
  // filters ask /api/brain/drive/media for the same question again with an offset or a filter.
  const THUMB = (id, s) => `/api/brain/drive/thumb?id=${encodeURIComponent(id)}&s=${s}`;
  const STREAM = (id) => `/api/brain/drive/stream?id=${encodeURIComponent(id)}`;
  const mb = (b) => (b >= 10485760 ? Math.round(b / 1048576) + ' MB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const GRADE = { high: 'High quality', medium: 'Medium quality', low: 'Low quality' };
  B.photoDetail = (im) => {
    if (!im) return '';
    const parts = [];
    if (im.width && im.height) parts.push(`${im.width} × ${im.height}`);
    if (im.bytes) parts.push(mb(im.bytes));
    return parts.join(', ');
  };
  const dlUrl = (id) => `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  const clock = (s) => {
    const t = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const secs = (c) => String(c || '').split(':').reduce((a, x) => a * 60 + (Number(x) || 0), 0);
  const ratioOf = (f) => (f.image && f.image.width && f.image.height ? Math.min(2.6, Math.max(0.45, f.image.width / f.image.height)) : 1.4);
  // A video answer stored before the grid carries only the raw scene text: the time and a short line are read from it here.
  const SCENE = /^\s*\[Scene at ([\d:]+)\]\s*/i;
  function videoOf(f) {
    if (f.video) return f.video;
    const p = (f.passages || [])[0];
    const m = p && String(p.text || '').match(SCENE);
    if (!m) return {};
    let s = String(p.text).replace(SCENE, '').replace(/^(the|this) (image|photo|picture|frame) (shows|is|depicts|features)\s+/i, '');
    s = (s.split(/(?<=[.!?])\s+/)[0] || s).replace(/[.!?]+$/, '').replace(/\s+(?:in|with) (?:his|her|their) hands?\b/i, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (s.length > 72) s = s.slice(0, 72).replace(/\s+\S*$/, '') + '...';
    return { at: secs(m[1]), line: s };
  }
  // Each picture says when it has loaded. The handlers sit on the element itself, so they work wherever the answer is drawn
  // (the Brain page, the side dock, after moving between pages) with no page-wide listener to lose.
  const IMG_ON = `onload="this.parentNode.classList.add('is-ready')" onerror="this.parentNode.classList.add('is-broken')"`;
  const DRAG_ON = `draggable="true" ondragstart="window.BrainBlocks&&window.BrainBlocks.mdrag(event,this)"`;

  // The media answers on screen, by key, so the grid's buttons and filters find their block (kept on the turn, so a redraw
  // keeps every page already shown).
  const MEDIA = {};
  let mseq = 0;
  const mediaKey = (b) => b._mk || Object.defineProperty(b, '_mk', { value: 'm' + ++mseq, enumerable: false })._mk;

  function photoTile(f) {
    const r = ratioOf(f);
    const g = f.image && f.image.grade;
    const meta = [g ? GRADE[g] : '', B.photoDetail(f.image)].filter(Boolean).join(', ');
    return `<button type="button" class="mg__t${g === 'high' ? ' is-hq' : ''}" role="listitem" data-act="media" data-mid="${esc(f.id)}" style="--r:${r.toFixed(3)}" aria-label="${esc(f.title)}${meta ? ', ' + esc(meta) : ''}. Open large" ${DRAG_ON}><img src="${esc(THUMB(f.id, 400))}" alt="" loading="lazy" decoding="async" ${IMG_ON}><span class="mg__ov"><b>${esc(f.title)}</b>${f.folder ? `<em>${esc(f.folder)}</em>` : ''}</span>${g === 'high' ? '<span class="mg__q">HQ</span>' : ''}</button>`;
  }
  function videoTile(f) {
    const v = videoOf(f);
    const at = v.line && v.at != null ? clock(v.at) : '';
    const det = (f.passages || []).map((p) => String(p.text || '').replace(SCENE, '')).filter(Boolean).join(' ');
    return `<div class="vg__c" role="listitem">
      <button type="button" class="vg__t" data-act="media" data-mid="${esc(f.id)}" aria-label="Play ${esc(f.title)}${at ? ' from ' + at : ''}" ${DRAG_ON}><img src="${esc(THUMB(f.id, 400))}" alt="" loading="lazy" decoding="async" ${IMG_ON}><span class="vg__play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor"/></svg></span>${v.duration ? `<span class="vg__dur">${clock(v.duration)}</span>` : ''}</button>
      <div class="vg__b"><b class="vg__n" title="${esc(f.title)}">${esc(f.title)}</b>
        ${v.line ? `<button type="button" class="vg__l" data-act="media" data-mid="${esc(f.id)}">${esc(v.line)}${at ? `, <time>${at}</time>` : ''}</button>` : ''}
        <div class="vg__m">${[f.modified ? dlong(f.modified) : '', f.folder || ''].filter(Boolean).map(esc).join(' &middot; ')}</div>
        <div class="vg__a">${f.like ? `<button type="button" class="vg__x" data-act="ask" data-q="${esc(f.like)}" data-intent="find_file">More like this</button>` : ''}${det ? `<details class="vg__d"><summary>Details</summary><p>${esc(det)}</p></details>` : ''}</div>
      </div></div>`;
  }
  const skeletons = (kind, n) => Array.from({ length: n }, (_, i) => (kind === 'video' ? '<div class="vg__c is-sk" aria-hidden="true"><span class="vg__t"></span><div class="vg__b"><i></i><i></i></div></div>' : `<span class="mg__t is-sk" aria-hidden="true" style="--r:${[1.5, 0.75, 1.33, 1.5, 1, 1.78][i % 6]}"></span>`)).join('');

  function filterBar(b, k) {
    const m = b.media, q = m.query || {}, fc = m.facets || {};
    const sel = (key, label, opts) => (opts.length ? `<label class="mf__s"><span>${label}</span><select data-mk="${k}" data-key="${key}" onchange="window.BrainBlocks&&window.BrainBlocks.mfilter(this)"><option value="">${key === 'sort' ? 'Best match' : 'Any'}</option>${opts.map((o) => `<option value="${esc(o.value)}"${String(q[key] || '') === o.value ? ' selected' : ''}>${esc(o.label)}${o.n != null ? ` (${int(o.n)})` : ''}</option>`).join('')}</select></label>` : '');
    const keep = (key, list) => (q[key] && !(list || []).some((o) => o.value === q[key]) ? [{ value: q[key], label: q[key] }].concat(list || []) : list || []);
    return `<div class="mf" role="group" aria-label="Filter">${sel('place', 'Place', keep('place', fc.place))}${sel('year', 'Year', keep('year', fc.year))}${m.kind === 'image' ? sel('grade', 'Quality', [{ value: 'high', label: 'High quality' }, { value: 'medium', label: 'Medium or better' }]) : ''}${sel('folder', 'Folder', keep('folder', fc.folder))}${sel('sort', 'Order', m.kind === 'image' ? [{ value: 'newest', label: 'Newest' }, { value: 'largest', label: 'Largest' }] : [{ value: 'newest', label: 'Newest' }])}</div>`;
  }
  const countLine = (b) => {
    const m = b.media, shown = (b.files || []).length;
    return m ? `Showing ${int(shown)} of ${int(Math.max(m.total, shown))}${m.exact ? '' : '+'}` : '';
  };
  function moreBtn(b, k) {
    const m = b.media;
    return m && m.next != null ? `<div class="mmore"><button type="button" class="h-btn h-btn--ghost" data-act="mmore" data-mk="${k}">Show more</button><span>${countLine(b)}</span></div>` : m && (b.files || []).length > 12 ? `<div class="mmore"><span>${countLine(b)}</span></div>` : '';
  }
  function mediaHTML(b, ctx) {
    const k = mediaKey(b);
    MEDIA[k] = b;
    const files = (b.files || []).concat(b.more || []);
    const kind = (b.media && b.media.kind) || (files.every((f) => f.kind === 'image') ? 'image' : 'video');
    const tiles = kind === 'image' ? files.map(photoTile).join('') : files.map(videoTile).join('');
    const empty = !files.length ? `<p class="mempty">Nothing here with these filters. Clear one to see more.</p>` : '';
    return `<div class="card fcards fcards--media" data-mk="${k}"${ctx && ctx.ti != null ? ` data-turn="${ctx.ti}"` : ''}><div class="card__h"><div><div class="card__t" data-mtitle>${esc(b.title)}</div><div class="card__s">${ic('lock')} Only files your Google account can open</div></div></div>${b.media ? filterBar(b, k) : ''}<div class="${kind === 'image' ? 'mg' : 'vg'}" role="list" data-mgrid>${tiles}</div>${empty}${moreBtn(b, k)}</div>`;
  }
  const NOUN_M = { image: ['photo', 'photos'], video: ['video', 'videos'] };
  const mediaTitle = (m) => (m.total === 1 ? `I found this ${NOUN_M[m.kind][0]}` : `I found ${int(m.total)}${m.exact ? '' : '+'} ${NOUN_M[m.kind][1]}`);
  async function mediaFetch(query, offset) {
    const res = await fetch('/api/brain/drive/media', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, offset }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) throw new Error(d.message || 'That did not load. Try again.');
    return d;
  }
  const rootOf = (k) => document.querySelector(`.fcards--media[data-mk="${k}"]`);
  /** Draws a media answer again in place (a filter changed): the card keeps its place and the page does not jump. */
  function redrawMedia(k) {
    const b = MEDIA[k], el = rootOf(k);
    if (!b || !el) return;
    const ti = el.dataset.turn;
    el.outerHTML = mediaHTML(b, ti != null ? { ti } : null);
  }
  B.mfilter = async (sel) => {
    const k = sel.dataset.mk, b = MEDIA[k];
    if (!b || !b.media) return;
    const query = { ...b.media.query, [sel.dataset.key]: sel.value || undefined };
    const el = rootOf(k);
    const grid = el && el.querySelector('[data-mgrid]');
    if (grid) { grid.innerHTML = skeletons(b.media.kind, Math.min(12, Math.max(6, (b.files || []).length))); grid.setAttribute('aria-busy', 'true'); }
    el && el.querySelectorAll('select').forEach((s) => (s.disabled = true));
    try {
      const d = await mediaFetch(query, 0);
      b.files = d.files || [];
      b.more = [];
      b.media = { ...b.media, total: d.total, exact: d.exact, next: d.next, query: d.query || query, facets: d.facets || b.media.facets };
      b.title = mediaTitle(b.media);
    } catch (err) {
      b.media = { ...b.media };
      toastMsg(err.message);
    }
    redrawMedia(k);
  };
  function toastMsg(m) {
    if (window.hubToast) window.hubToast(m);
  }
  async function mediaMore(el, host) {
    const k = el.dataset.mk, b = MEDIA[k];
    if (!b || !b.media || b.media.next == null) return;
    const root = rootOf(k), grid = root && root.querySelector('[data-mgrid]');
    el.disabled = true;
    el.textContent = 'Loading';
    if (grid) grid.insertAdjacentHTML('beforeend', `<span class="msk" data-msk style="display:contents">${skeletons(b.media.kind, 12)}</span>`);
    try {
      const d = await mediaFetch(b.media.query, b.media.next);
      const add = (d.files || []).filter((f) => !(b.files || []).some((x) => x.id === f.id));
      b.files = (b.files || []).concat(add);
      b.media = { ...b.media, total: d.total, exact: d.exact, next: d.next };
      b.title = mediaTitle(b.media);
      if (grid) {
        grid.querySelectorAll('[data-msk]').forEach((x) => x.remove());
        grid.insertAdjacentHTML('beforeend', add.map(b.media.kind === 'image' ? photoTile : videoTile).join(''));
      }
      const t = root && root.querySelector('[data-mtitle]');
      if (t) t.textContent = b.title;
      const mm = root && root.querySelector('.mmore');
      if (mm) mm.outerHTML = moreBtn(b, k) || '';
    } catch (err) {
      if (grid) grid.querySelectorAll('[data-msk]').forEach((x) => x.remove());
      el.disabled = false;
      el.textContent = 'Show more';
      (host && host.toast ? host.toast : toastMsg)(err.message);
    }
  }

  // ---- Drag a photo or video into what you are writing, or send it to an email ----
  const fileOf = (k, id) => { const b = MEDIA[k]; return b ? (b.files || []).concat(b.more || []).find((f) => f.id === id) : null; };
  const itemOf = (f) => {
    const v = f.kind === 'video' ? videoOf(f) : null;
    const sub = f.kind === 'video' ? ['Video', v && v.duration ? clock(v.duration) : '', f.folder || ''].filter(Boolean).join(', ') : ['Photo', B.photoDetail(f.image), f.folder || ''].filter(Boolean).join(', ');
    return { kind: 'drive', title: f.title, url: f.link, sub };
  };
  function sendToEmail(f) {
    if (!window.FavorCompose || !window.FavorCompose.add) { toastMsg('Open Mail to write an email first.'); return; }
    window.FavorCompose.add(itemOf(f));
  }

  // ---- The large view: one photo or video over the page, arrows for the others in the same answer, Esc closes ----
  let LB = null;
  function lbClose() {
    if (!LB) return;
    const v = LB.querySelector('video');
    if (v) { try { v.pause(); } catch (e) { /* gone */ } v.removeAttribute('src'); v.load(); }
    LB.classList.remove('is-open');
    document.documentElement.classList.remove('plb-on');
    if (LB._from && LB._from.isConnected) LB._from.focus();
  }
  const ico = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const I_DL = ico('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>'), I_MAIL = ico('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'), I_DRAG = ico('<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>');
  function lbShow(i) {
    const list = LB._all;
    if (!list.length) return;
    LB._k = (i + list.length) % list.length;
    const f = list[LB._k];
    const pic = LB.querySelector('.plb__pic');
    const old = pic.querySelector('video');
    if (old) { try { old.pause(); } catch (e) { /* gone */ } }
    pic.classList.remove('is-ready');
    const vid = f.kind === 'video';
    const v = vid ? videoOf(f) : null;
    if (vid) {
      const at = v && v.at ? Math.max(0, v.at) : 0;
      pic.innerHTML = `<span class="spin"></span><video controls playsinline preload="metadata" poster="${esc(THUMB(f.id, 1600))}" src="${esc(STREAM(f.id))}${at ? '#t=' + at : ''}"></video>`;
      const el = pic.querySelector('video');
      el.addEventListener('loadedmetadata', () => { if (at && Math.abs(el.currentTime - at) > 1.5) { try { el.currentTime = at; } catch (e) { /* seek later */ } } pic.classList.add('is-ready'); el.play().catch(() => undefined); }, { once: true });
      el.addEventListener('error', () => { pic.classList.add('is-ready'); pic.insertAdjacentHTML('beforeend', `<p class="plb__err">This video will not play here. <a href="${esc(href(f.link))}" target="_blank" rel="noopener">Open it in Drive</a></p>`); }, { once: true });
    } else {
      pic.innerHTML = `<span class="spin"></span><img alt="${esc(f.description || f.title)}">`;
      const img = pic.querySelector('img');
      img.onload = () => pic.classList.add('is-ready');
      img.onerror = () => { pic.classList.add('is-ready'); pic.insertAdjacentHTML('beforeend', `<p class="plb__err">This picture will not load. <a href="${esc(href(f.link))}" target="_blank" rel="noopener">Open it in Drive</a></p>`); };
      img.src = THUMB(f.id, 1600);
    }
    LB.querySelector('.plb__t').textContent = f.title;
    LB.querySelector('.plb__m').textContent = vid ? [v && v.duration ? clock(v.duration) : '', f.modified ? dlong(f.modified) : ''].filter(Boolean).join(' · ') : [f.image && f.image.grade ? GRADE[f.image.grade] : '', B.photoDetail(f.image)].filter(Boolean).join(' · ');
    LB.querySelector('.plb__f').textContent = f.folder || '';
    const d = LB.querySelector('.plb__d');
    if (vid) {
      const raw = (f.passages || []).map((p) => String(p.text || '').replace(SCENE, '')).filter(Boolean).join(' ');
      d.innerHTML = v && v.line ? `<button type="button" class="plb__jump" data-lb="jump" data-at="${v.at || 0}">${ic('play')}${esc(v.line)}, ${clock(v.at || 0)}</button>${raw ? `<details class="plb__det"><summary>Details</summary><p>${esc(raw)}</p></details>` : ''}` : '';
    } else d.textContent = f.description || 'No description yet';
    LB.querySelector('.plb__a').innerHTML = `<a class="h-btn h-btn--primary h-btn--sm" href="${esc(dlUrl(f.id))}" target="_blank" rel="noopener">${I_DL}Download original</a><a class="h-btn h-btn--ghost h-btn--sm" href="${esc(href(f.link))}" target="_blank" rel="noopener">${ic('ext')}Open in Drive</a>${window.FavorCompose && window.FavorCompose.add ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-lb="email">${I_MAIL}Send to email</button>` : ''}<span class="h-btn h-btn--ghost h-btn--sm plb__drag" data-mid="${esc(f.id)}" ${DRAG_ON} title="Drag into a message, a task or an email">${I_DRAG}Drag</span>${f.like ? `<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-lb="like" data-q="${esc(f.like)}">More like this</button>` : ''}`;
    LB.querySelector('.plb__n').textContent = list.length > 1 ? `${LB._k + 1} of ${list.length}` : '';
    LB.querySelectorAll('.plb__nav').forEach((n) => (n.hidden = list.length < 2));
    LB.classList.toggle('is-video', vid);
  }
  function lightbox(btn, host) {
    const root = btn.closest('[data-mk]');
    const k = root && root.dataset.mk;
    const b = k && MEDIA[k];
    const all = b ? (b.files || []).concat(b.more || []) : [];
    if (!all.length) return;
    // The view is rebuilt when a page change took it off the page.
    if (!LB || !LB.isConnected) {
      LB = document.createElement('div');
      LB.className = 'plb';
      LB.setAttribute('role', 'dialog');
      LB.setAttribute('aria-modal', 'true');
      LB.setAttribute('aria-label', 'Photo or video');
      LB.innerHTML = `<div class="plb__bg" data-lb="close"></div><div class="plb__box"><div class="plb__pic"></div><div class="plb__side"><button type="button" class="plb__x" data-lb="close" aria-label="Close">×</button><span class="plb__n"></span><b class="plb__t"></b><div class="plb__m"></div><div class="plb__f"></div><div class="plb__d"></div><div class="plb__a"></div></div><button type="button" class="plb__nav plb__nav--p" data-lb="prev" aria-label="Previous">‹</button><button type="button" class="plb__nav plb__nav--n" data-lb="next" aria-label="Next">›</button></div>`;
      document.body.appendChild(LB);
      LB.addEventListener('click', (e) => {
        const a = e.target.closest('[data-lb]');
        if (!a) return;
        const w = a.dataset.lb;
        if (w === 'close') lbClose();
        else if (w === 'prev') lbShow(LB._k - 1);
        else if (w === 'next') lbShow(LB._k + 1);
        else if (w === 'email') sendToEmail(LB._all[LB._k]);
        else if (w === 'jump') { const v = LB.querySelector('video'); if (v) { try { v.currentTime = Number(a.dataset.at) || 0; v.play().catch(() => undefined); } catch (err) { /* not ready */ } } }
        else if (w === 'like') { const q = a.dataset.q; const h = LB._host; lbClose(); if (h && q) h.ask(q, { intent: 'find_file' }); }
      });
      LB.addEventListener('keydown', (e) => {
        if (!LB.classList.contains('is-open')) return;
        if (e.target && /^(VIDEO|INPUT|TEXTAREA)$/.test(e.target.tagName) && e.key !== 'Escape') return;
        if (e.key === 'Escape') lbClose();
        else if (e.key === 'ArrowLeft') lbShow(LB._k - 1);
        else if (e.key === 'ArrowRight') lbShow(LB._k + 1);
      });
      // A swipe on a phone moves to the next or the previous one.
      let sx = null;
      LB.addEventListener('touchstart', (e) => { sx = e.touches.length === 1 && !e.target.closest('video, .plb__side') ? e.touches[0].clientX : null; }, { passive: true });
      LB.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) lbShow(LB._k + (dx < 0 ? 1 : -1)); });
    }
    LB._all = all;
    LB._mk = k;
    LB._host = host;
    LB._from = btn;
    LB.classList.add('is-open');
    document.documentElement.classList.add('plb-on');
    lbShow(Math.max(0, all.findIndex((f) => f.id === btn.dataset.mid)));
    LB.querySelector('.plb__x').focus();
  }
  B.lightbox = lightbox;
  /** A tile or the large view's Drag handle: the file goes into a message, a task or an email as a Drive link. */
  B.mdrag = (e, el) => {
    const inLb = el.closest('.plb');
    const root = el.closest('[data-mk]');
    const f = inLb ? (LB && LB._all ? LB._all.find((x) => x.id === el.dataset.mid) : null) : fileOf(root && root.dataset.mk, el.dataset.mid);
    if (!f || !e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', f.title + ' ' + f.link);
    e.dataTransfer.setData('text/uri-list', f.link);
    try { e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(itemOf(f))); } catch (err) { /* text only */ }
  };
  // The weaker matches wait behind a quiet "N more matches" line. A native disclosure opens them in place, with no script.
  function filesHTML(b, ctx) {
    const more = b.more || [];
    const all = (b.files || []).concat(more);
    if (b.media || (all.length && (all.every((f) => f.kind === 'image') || all.every((f) => f.kind === 'video')))) return mediaHTML(b, ctx);
    const moreHTML = more.length
      ? `<details class="fmore"><summary>${more.length} more ${more.length === 1 ? 'match' : 'matches'}${ic('caret')}</summary><div class="frows" role="list">${more.map(fileRowHTML).join('')}</div></details>`
      : '';
    return `<div class="card fcards"><div class="card__h"><div><div class="card__t">${esc(b.title)}</div><div class="card__s">${ic('lock')} Only files your Google account can open</div></div></div><div class="frows" role="list">${(b.files || []).map(fileRowHTML).join('')}</div>${moreHTML}</div>`;
  }
  const STATUS = { ready: ['wait', 'Ready'], waiting: ['wait', 'Waiting for Will'], sent: ['wait', 'Sent to Will'], approved: ['ok', 'Approved'], running: ['wait', 'Running'], done: ['ok', 'Done'], declined: ['no', 'Declined'], refused: ['no', 'Not done'] };
  function confirmHTML(b, ctx) {
    const st = STATUS[b.status] || STATUS.ready;
    const busy = b._busy;
    const task = b.kind === 'task_create';
    // A made task ends its line with the task's address; show it as a link.
    const wm = String(b.who || '').match(/^(.*?)\s*Open it: (https:\/\/\S+)$/);
    const who = wm ? `${esc(wm[1])} <a href="${esc(wm[2])}">Open the task</a>` : esc(b.who || '');
    const acts = (b.actions || [])
      .map((a) => {
        if (a.ask) return `<button type="button" class="h-btn h-btn--ghost" data-act="ask" data-q="${esc(a.ask)}">${ic('list')}${esc(a.label)}</button>`;
        const cls = a.tone === 'gold' ? 'h-btn--gold' : a.id === 'approve' ? 'h-btn--primary' : 'h-btn--ghost';
        return `<button type="button" class="h-btn ${cls}" data-act="cf" data-turn="${ctx.ti}" data-bi="${ctx.bi}" data-do="${esc(a.id)}"${a.enabled === false || busy ? ' disabled' : ''}>${busy === a.id ? '<span class="spin d"></span>' : a.id === 'approve' ? ic(task ? 'check' : 'coin') : ''}${esc(a.label)}</button>`;
      })
      .join('');
    const pr = b.progress;
    return `<div class="card cf"><div class="cf__h"><div class="cf__i">${ic(b.kind === 'iwave_refresh' ? 'redo' : task ? 'check' : 'coin')}</div><div><div class="cf__t">${esc(b.title)}</div>${b.sub ? `<div class="cf__s">${esc(b.sub)}</div>` : ''}</div><span class="state ${st[0]}"><i></i>${st[1]}</span></div>
      ${(b.facts || []).length ? `<div class="cf__rows">${b.facts.map((f) => `<div class="kv"><span>${esc(f.label)}</span><b>${esc(typeof f.value === 'number' ? int(f.value) : f.value)}</b>${f.sub && !/^\d{4}-\d\d-\d\d$/.test(f.sub) ? `<small>${esc(f.sub)}</small>` : ''}</div>`).join('')}</div>` : ''}
      ${(b.notes || []).length ? `<ul class="cf__notes">${b.notes.map((n) => `<li>${ic(n.icon || 'info')}<span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}
      ${pr ? `<div class="prog" role="progressbar" aria-valuenow="${pr.done}" aria-valuemax="${pr.total}"><i style="width:${pr.total ? (pr.done / pr.total) * 100 : 0}%"></i></div>` : ''}
      <div class="cf__acts">${acts}${b.who ? `<span class="who">${ic(task ? 'info' : 'shield')}${who}</span>` : ''}</div></div>`;
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
    return `<div class="card sheet"><div class="sheet__i"><svg class="h-i" style="width:26px;height:26px"><use href="#bci-sheet"/></svg></div><div style="min-width:0"><b>${esc(b.title)}</b><small>${int(b.rows)} ${Number(b.rows) === 1 ? 'row' : 'rows'} in your Drive. ${b.private ? 'Only you can open it. ' : ''}Keep it inside Favor.</small></div><a class="h-btn h-btn--primary h-btn--sm" href="${esc(href(b.url))}" target="_blank" rel="noopener">${ic('ext')}Open the sheet</a></div>`;
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
  // ---- Typed blocks for the asker's day and work (2026-10-14): each part looks like what it is. A small header with its icon
  // and an Open link, then rows: meetings with a time column, provider badge, faces and Join; mail with the sender's face,
  // subject, snippet and an unread dot; files with a type icon, who changed it and tbWhen (a thumbnail for pictures); tasks with
  // a checkbox, the project and the due date. Narrow answers (dock, phone) keep the same rows, tighter (brain.css).
  const tbInitials = (n) => String(n || '?').replace(/[^A-Za-z@ ]/g, ' ').trim().split(/[\s@]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const tbHue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const tbFace = (name, email, cls = 'tb-av') => `<span class="${cls}" style="--av-h:${tbHue(email || name)}" title="${esc(name || email)}" aria-hidden="true">${esc(tbInitials(name || email))}</span>`;
  const tbWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (d >= today) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (d >= today - 864e5) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  const tbHead = (icon, title, note, link, linkLabel, n) => `<div class="tb-h"><span class="tb-h__ic" aria-hidden="true">${ic(icon)}</span><b>${esc(title)}</b>${n != null ? `<span class="tb-h__n">${int(n)}</span>` : ''}${note ? `<span class="tb-h__s">${esc(note)}</span>` : ''}${link ? `<a class="tb-h__go" href="${esc(href(link))}"${/^https?:/.test(link) ? ' target="_blank" rel="noopener"' : ''}>${esc(linkLabel)}${ic('arrow')}</a>` : ''}</div>`;
  const PROVIDER = { 'FavorOS': 'favoros', 'Google Meet': 'gmeet', 'Zoom': 'zoom' };
  function calendarHTML(b) {
    const items = b.items || [];
    const rows = items.map((e) => {
      const ppl = e.people || [];
      const faces = ppl.slice(0, 4).map((p) => tbFace(p.name, p.email)).join('') + (ppl.length > 4 ? `<span class="tb-av tb-av--more">+${ppl.length - 4}</span>` : '');
      const names = ppl.slice(0, 3).map((p) => p.name || String(p.email || '').split('@')[0]).join(', ') + (ppl.length > 3 ? ` and ${ppl.length - 3} more` : '');
      return `<li class="tb-row tb-cal"><span class="tb-cal__t">${esc(e.time || '')}</span><span class="tb-cal__ic" aria-hidden="true">${ic('cal')}</span>
        <span class="tb-main"><span class="tb-title">${esc(e.title || 'Meeting')}</span><span class="tb-sub">${e.provider ? `<span class="tb-badge tb-badge--${PROVIDER[e.provider] || 'other'}">${esc(e.provider)}</span>` : ''}${names ? `<span class="tb-who">${esc(names)}</span>` : ''}</span></span>
        <span class="tb-side">${faces ? `<span class="tb-faces">${faces}</span>` : ''}${e.join ? `<a class="h-btn h-btn--primary h-btn--xs" href="${esc(href(e.join))}" target="_blank" rel="noopener" aria-label="Join ${esc(e.title || 'the meeting')}">Join</a>` : ''}</span></li>`;
    }).join('');
    return `<div class="card tb tb--cal">${tbHead('cal', b.title || "Today's meetings", b.note, 'https://calendar.google.com/calendar/u/0/r/day', 'Open in Calendar', items.length)}${items.length ? `<ul class="tb-list">${rows}</ul>` : '<p class="tb-none">No meetings today.</p>'}</div>`;
  }
  function mailHTML(b) {
    const items = b.items || [];
    const rows = items.map((m) => {
      const go = m.thread ? `/mail/#/INBOX/${encodeURIComponent(m.thread)}` : m.link || '';
      return `<li class="tb-row tb-mail${m.unread ? ' is-unread' : ''}"><a class="tb-rowlink" href="${esc(href(go))}">${tbFace(m.from, m.email)}
        <span class="tb-main"><span class="tb-top"><span class="tb-from">${esc(m.from || m.email || 'Unknown sender')}</span><span class="tb-when">${esc(tbWhen(m.at) || m.received || '')}</span></span>
        <span class="tb-title">${m.unread ? '<i class="tb-dot" aria-label="Unread"></i>' : ''}${esc(m.subject || '(No subject)')}</span>${m.snippet ? `<span class="tb-snip">${esc(m.snippet)}</span>` : ''}</span></a></li>`;
    }).join('');
    return `<div class="card tb tb--mail">${tbHead('mail', b.title || 'Unread mail', b.note, '/mail/', 'Open in Mail', items.length)}${items.length ? `<ul class="tb-list">${rows}</ul>` : '<p class="tb-none">No unread mail.</p>'}</div>`;
  }
  const FKIND = (f) => { const k = String(f.kind || '').toLowerCase(), m = String(f.mime || ''); return /image/.test(m) || k === 'image' ? 'image' : k === 'sheet' || /spreadsheet/.test(m) ? 'sheet' : k === 'slides' || /presentation/.test(m) ? 'slides' : /pdf/.test(m) || k === 'pdf' ? 'pdf' : /video/.test(m) ? 'video' : 'doc'; };
  const FK_ICON = { doc: 'fdoc', pdf: 'fdoc', sheet: 'fgrid', slides: 'fslides', image: 'fimage', video: 'play' };
  const FK_LABEL = { doc: 'Doc', pdf: 'PDF', sheet: 'Sheet', slides: 'Slides', image: 'Picture', video: 'Video' };
  function filelistHTML(b) {
    const items = b.items || [];
    const rows = items.map((f) => {
      const k = FKIND(f);
      const tile = k === 'image' && f.id ? `<span class="tb-ftile tb-ftile--pic"><img src="${esc(THUMB(f.id, 400))}" alt="" loading="lazy" onerror="this.remove()"></span>` : `<span class="tb-ftile tb-ftile--${k}" aria-hidden="true">${ic(FK_ICON[k])}</span>`;
      const meta = [FK_LABEL[k], f.by ? 'changed by ' + f.by : '', tbWhen(f.at) || (f.modified ? dlong(f.modified) : '')].filter(Boolean).join(' · ');
      return `<li class="tb-row tb-file"><a class="tb-rowlink" href="${esc(href(f.link))}" target="_blank" rel="noopener">${tile}<span class="tb-main"><span class="tb-title">${esc(f.name || 'File')}</span><span class="tb-sub">${esc(meta)}</span></span></a></li>`;
    }).join('');
    return `<div class="card tb tb--files">${tbHead('fdoc', b.title || 'Files', b.note, 'https://drive.google.com/drive/shared-with-me', 'Open in Drive', items.length)}${items.length ? `<ul class="tb-list">${rows}</ul>` : '<p class="tb-none">No files changed this week.</p>'}</div>`;
  }
  function tasksHTML(b) {
    const items = b.items || [];
    const rows = items.map((t) => {
      const due = t.due ? new Date(String(t.due).length === 10 ? t.due + 'T12:00:00' : t.due) : null;
      const late = due && !t.done && due < new Date(new Date().toDateString());
      return `<li class="tb-row tb-task${t.done ? ' is-done' : ''}"><span class="tb-check" role="img" aria-label="${t.done ? 'Done' : 'Open'}">${t.done ? ic('check') : ''}</span>
        <a class="tb-main" href="${esc(href(t.link || '/projects/'))}"><span class="tb-title">${esc(t.title || 'Task')}</span><span class="tb-sub">${t.project ? `<span class="tb-chip">${esc(t.project)}</span>` : ''}${due ? `<span class="tb-due${late ? ' is-late' : ''}">${late ? 'Overdue, ' : 'Due '}${esc(due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span>` : ''}</span></a></li>`;
    }).join('');
    return `<div class="card tb tb--tasks">${tbHead('check', b.title || 'Your tasks', b.note, '/projects/', 'Open in Projects', items.length)}${items.length ? `<ul class="tb-list">${rows}</ul>` : '<p class="tb-none">No open tasks.</p>'}</div>`;
  }
  B.render = (b, ctx) => { try { return draw(b, ctx); } catch (e) { return ''; } };
  const draw = (b, ctx) => {
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
      case 'files': return filesHTML(b, ctx);
      case 'calendar': return calendarHTML(b);
      case 'mail': return mailHTML(b);
      case 'filelist': return filelistHTML(b);
      case 'tasks': return tasksHTML(b);
      default: return b && b.md ? `<div class="blk-text">${md(b.md)}</div>` : '';
    }
  };
  /**
   * Draws an answer's blocks with each number said once. A lone figure tile followed by a short sentence that repeats it ("121
   * partners (households).") becomes one headline line: the figure and a short label ("121 lapsed partners in Ohio").
   */
  B.renderAll = (blocks, ctx) => {
    let bs = (blocks || []).slice();
    // An answer the check held back is handed to Claude with a friendly card (Will, 2026-10-14: "more of an encouragement").
    const held = bs.findIndex((b) => b && b.type === 'note' && /can.t answer this one reliably/i.test(b.title || ''));
    if (held >= 0) {
      const src = bs.find((b) => b && b.type === 'sources' && (b.items || []).some((i) => /Continue in Claude/i.test(i.label || '')));
      const link = src ? (src.items.find((i) => /Continue in Claude/i.test(i.label || '')) || {}).href : '';
      const m = /Here is how I read it:\s*(.*?)\s*That may not be/i.exec(bs[held].body || '');
      const read = m && m[1] && m[1].length < 110 && !/^searched/i.test(m[1]) ? m[1].replace(/\.$/, '') : '';
      return `<div class="blk-handoff"><div class="blk-handoff__ic" aria-hidden="true">${ic('spark')}</div><div class="blk-handoff__tx"><b>Let's take this one to Claude</b><p>I'm sharper in Claude for questions like this. Your question and what I found so far are ready to go.</p>${read ? `<p class="blk-handoff__rd">I read it as: ${esc(read)}.</p>` : ''}<div class="blk-handoff__acts">${link ? `<a class="h-btn h-btn--primary h-btn--sm" href="${esc(href(link))}" target="_blank" rel="noopener">Continue in Claude ${ic('ext')}</a>` : ''}<button type="button" class="h-btn h-btn--ghost h-btn--sm" data-act="rephrase">Rephrase</button></div></div></div>`;
    }
    // With the steps above the answer, "How I read it" lives in them; its line is not said again under the answer.
    if (ctx && ctx.steps) bs = bs.map((b) => (b && b.type === 'text' && /How I read it/i.test(b.md || '') ? { ...b, md: String(b.md).split(/\n/).filter((l) => !/^\s*_?How I read it/i.test(l)).join('\n').trim() } : b)).filter((b) => !(b && b.type === 'text' && !b.md));
    const ti = bs.findIndex((b) => b && b.type === 'tiles' && (b.tiles || []).length === 1 && typeof b.tiles[0].value === 'number' && !b.tiles[0].delta && !b.tiles[0].trend && b.tiles[0].progress == null && !b.tiles[0].compare);
    let head = '';
    if (ti >= 0) {
      const tile = bs[ti].tiles[0];
      const shown = fmt(tile.value, tile.format || 'int');
      // Only a short sentence whose one figure is this number ("121 partners (households).") is folded in; a sentence with
      // more in it ("$4,291,689.40 so far, $5,000,000 goal") stays as written.
      // The figures in a sentence, years left out ("2026 so far" is a period, not a figure).
      const FIG = /\$?\d[\d,]*(?:\.\d+)?%?/g;
      const figs = (t) => (t.match(FIG) || []).filter((x) => !/^(19|20)\d\d$/.test(x));
      const val = (x) => Number(x.replace(/[$,%]/g, ''));
      let tok = '';
      const xi = bs.findIndex((b, k) => {
        if (k <= ti || k > ti + 2 || !b || b.type !== 'text') return false;
        const t = String(b.md || '').replace(/[*_]/g, '').replace(/\s*\([^)]*\)/g, '').trim();
        const f = figs(t);
        if (t.length >= 120 || f.length !== 1 || Math.round(val(f[0])) !== Math.round(tile.value)) return false;
        tok = f[0];
        return true;
      });
      if (xi >= 0) {
        const tb = bs.find((b) => b && b.type === 'table' && b.title);
        const said = String(bs[xi].md).replace(/[*_]/g, '').replace(/\s*\([^)]*\)/g, '').trim();
        const rest = tb ? shortTitle(tb.title, nounOf(tb)).replace(/^\w/, (c) => c.toLowerCase()) : said.replace(tok, '').replace(/^[\s:,-]+/, '').replace(/[\s:,.-]+$/, '');
        head = `<div class="blk-head"><b data-count="${tile.value}" data-f="${esc(tile.format || 'int')}">${esc(shown)}</b> <span>${esc(rest || tile.label)}</span></div>`;
        bs.splice(xi, 1);
        bs.splice(ti, 1);
      }
    }
    return head + bs.map((b, bi) => B.render(b, typeof ctx === 'function' ? ctx(bi) : { ...ctx, bi })).join('');
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
      // Numbers appear at their final value; a count-up shows wrong figures for 700 ms and reads as a glitch.
      if (true || noAnim || reduced() || !Number.isFinite(n)) { el.textContent = fm(n); return; }
      const t0 = performance.now(), dur = 700;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fm(n * e);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };

  // ---- What the blocks do when pressed ---------------------------------------------------------------
  // One implementation for every page that shows answer blocks (the Brain page and Favor Chat). The page passes a host:
  //   toast(msg, link?)            a short notice, with an optional { href, label } link
  //   ask(q, { intent, el })       ask the Brain a question
  //   turn(el)                     the answer the pressed element belongs to: { q, asked_as, blocks, extras, lists, follow }
  //   rerender(turn, el)           draw that answer again after its blocks changed
  //   api(path, { body })          a call to /api/brain/<path>, as the signed-in person
  //   confirm(turn, block, action) optional; presses a confirm card and resolves to { blocks } (default: api('confirm'))
  //   openTable(id) closeTable()   show one table large, and put it away
  //   page                         the page address written into a sheet's source note
  //   focusInput() cue(name) sheetMade(r, turn) accessAsked(pkg)   optional
  const copyText = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
  B.copyText = copyText;

  // A small menu under a button (filter values, reading options). Shared so a page needs no popover of its own.
  let popEl = null;
  B.popEl = () => popEl;
  B.closePop = (refocus) => {
    if (!popEl) return false;
    const a = popEl._anchor;
    if (a) a.setAttribute('aria-expanded', 'false');
    popEl.remove();
    popEl = null;
    if (refocus && a && a.focus) a.focus();
    return true;
  };
  B.pop = (anchor, html, onPick) => {
    B.closePop();
    let portal = document.getElementById('bc-portal');
    if (!portal) {
      portal = document.createElement('div');
      portal.id = 'bc-portal';
      portal.className = 'bc-root bc-portal--page';
      document.body.appendChild(portal);
    }
    popEl = document.createElement('div');
    popEl.className = 'pop';
    popEl.setAttribute('role', 'menu');
    popEl.innerHTML = html;
    portal.appendChild(popEl);
    const r = anchor.getBoundingClientRect(), pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    const x = Math.min(r.left, innerWidth - pw - 10);
    let y = r.bottom + 6;
    if (y + ph > innerHeight - 10) y = r.top - ph - 6 >= 10 ? r.top - ph - 6 : Math.max(10, innerHeight - ph - 10);
    popEl.style.left = Math.max(10, x) + 'px';
    popEl.style.top = Math.max(10, y) + 'px';
    popEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      const v = b.dataset.v;
      B.closePop();
      onPick(v, b);
    });
    popEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const bs = [...popEl.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus();
    });
    const first = popEl.querySelector('button.is-on') || popEl.querySelector('button');
    if (first) first.focus();
    popEl._anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
  };

  /** One table shown large: the filter box, Copy, CSV and Sheets, the filter chips and every row and column. */
  B.tablePanel = (tb, opt = {}) => {
    const id = tb.id;
    const head = opt.head === false ? '' : `<div class="bc-panel__h"><div style="min-width:0;flex:1"><div class="t">${esc(tb.title)}</div><div class="s" data-pcnt="${id}"></div></div><button type="button" class="ib" data-act="pclose" aria-label="Close the panel">${ic('close')}</button></div>`;
    return `${head}
        <div class="bc-panel__tools"><div class="tbl__find">${ic('search')}<input type="search" placeholder="Filter these rows" data-tfind="${id}" aria-label="Filter these rows" value="${esc(tb.q)}" /></div>${tb.expired ? '' : toolsHTML(tb, true, tb.canSheets)}</div>
        ${tb.chips && tb.chips.length ? `<div style="padding:10px 18px 0">${chipsHTML(tb, `data-pchips="${id}" style="padding:0"`)}</div>` : ''}
        <div class="bc-panel__body" style="margin-top:10px;border-top:1px solid var(--h-line)"><div class="tbl__scroll" data-tbbody="${id}" data-tbfull tabindex="0" role="region" aria-label="${esc(tb.title)}">${tableInner(tb, true)}</div></div>`;
  };

  /** A table kept with only its preview rows reads the whole list again by its token (lists last 24 hours). */
  B.loadRows = async (tb, host) => {
    if (!tb || !tb.partial || !tb.token || tb.expired || tb.loaded || tb.loading) return;
    tb.loading = true;
    const el = document.querySelector(`[data-tbfull][data-tbbody="${tb.id}"]`);
    if (el) el.insertAdjacentHTML('afterbegin', '<div class="bc-empty-note" data-loading>Loading the full list...</div>');
    try {
      const d = await host.api('list/read', { body: { tokens: [tb.token] } });
      const l = (d.lists || [])[0];
      if (l && l.rows) {
        tb.rows = l.rows.map((r) => (r.place || !(r.city || r.state) ? r : { ...r, place: [r.city, r.state].filter(Boolean).join(', ') }));
        tb.count = tb.rows.length;
        tb.more = !!l.more;
        tb.partial = false;
        tb.loaded = true;
        B.refreshTable(tb.id);
      }
    } catch (e) {
      tb.expired = true;
      host.toast(e.status === 410 ? 'That list expired. Ask again.' : e.message);
    }
    tb.loading = false;
    document.querySelectorAll('[data-loading]').forEach((n) => n.remove());
  };

  const sheetBtns = (id) => document.querySelectorAll(`[data-sheetbtn="${id}"]`);
  const consentCard = (turn, r, spec) => {
    turn.extras = (turn.extras || []).filter((x) => x.type !== 'consent');
    turn.extras.push({ type: 'consent', consent_url: r.consentUrl || r.connectUrl, _spec: spec });
  };
  /** Open in Google Sheets for one table: the whole list by its token, or the rows on screen when it is filtered. */
  B.makeSheet = async (id, host, el) => {
    const tb = TB[id];
    if (!tb || !window.FavorSheets) return;
    sheetBtns(id).forEach((b) => { b.disabled = true; b.innerHTML = '<span class="spin d"></span><span>Creating the sheet</span>'; });
    const filtered = Object.keys(tb.f).length || tb.q;
    const turn = host.turn(el, id);
    const page = host.page || location.pathname;
    const spec = tb.token && !filtered && !tb.expired
      ? { mode: 'brain', tokens: [tb.token], dedupe: 'brain:' + tb.token, title: tb.sheet_title || tb.title, provenance: { kind: 'brain', page, asked: turn ? turn.q : '' } }
      : { mode: 'rows', tabs: [B.sheetTab(tb)], title: tb.sheet_title || tb.title, provenance: { kind: 'screen', page, asked: turn ? turn.q : '', filters: filtered ? 'Filtered: ' + Object.entries(tb.f).map(([k, v]) => k + ' ' + v).concat(tb.q ? ['search ' + tb.q] : []).join(', ') : '' } };
    const r = await window.FavorSheets.run(spec, { navigate: false });
    const restore = () => sheetBtns(id).forEach((b) => { b.disabled = false; b.innerHTML = `${ic('sheet')}<span>Open in Google Sheets</span>`; });
    if (r.ok) {
      restore();
      sheetBtns(id).forEach((b) => { const a = document.createElement('a'); a.className = 'h-btn h-btn--primary h-btn--xs'; a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.innerHTML = ic('ext') + '<span>Open the sheet</span>'; b.replaceWith(a); });
      if (turn) {
        turn.extras = (turn.extras || []).filter((x) => x.type !== 'consent');
        turn.extras.push({ type: 'sheet', title: r.title, url: r.url, rows: (r.tabs || []).reduce((n, t) => n + t.rows, 0), private: r.private !== false });
        host.rerender(turn, el);
      }
      if (host.sheetMade) host.sheetMade(r, turn);
      host.toast('Your sheet is ready in Google Drive', { href: r.url, label: 'Open it' });
      if (host.cue) host.cue('success');
      return;
    }
    restore();
    if (r.error === 'consent' || r.error === 'not_connected') {
      if (turn) {
        consentCard(turn, r, spec);
        if (host.closeTable) host.closeTable();
        host.rerender(turn, el);
        if (host.consentShown) host.consentShown(turn);
      }
      return;
    }
    host.toast(r.message || 'The sheet did not build. The CSV still works.');
  };

  /**
   * A press on anything inside an answer block. Returns true when the press was one of the blocks' own actions, so the page
   * handles only what is left (its own buttons).
   */
  B.handle = (e, el, host) => {
    const act = el && el.dataset ? el.dataset.act : '';
    const run = ACTIONS[act];
    if (!run) return false;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    Promise.resolve(run(el, host, e)).catch((err) => host.toast((err && err.message) || 'That did not work. Try again.'));
    return true;
  };
  const blockOf = (turn, el) => (turn && turn.blocks ? turn.blocks[+el.dataset.bi] : null);
  const ACTIONS = {
    ask: (el, host) => host.ask(el.dataset.q, { intent: el.dataset.intent || undefined, el }),
    // Rephrase on a handed-off answer: the question goes back in the ask box, ready to edit.
    rephrase: (el, host) => {
      const t = host.turn(el);
      const box = document.getElementById('bc-input') || (el.closest('[data-brain]') || document).querySelector('[data-bask] textarea');
      if (!box) return;
      box.value = (t && t.q) || '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    },
    photo: (el, host) => lightbox(el, host),
    media: (el, host) => lightbox(el, host),
    mmore: (el, host) => mediaMore(el, host),
    'ask-again': (el, host) => { const t = host.turn(el); if (t) host.ask(t.asked_as || t.q, { again: true, el }); },
    choose: (el, host) => {
      const t = host.turn(el), b = blockOf(t, el);
      if (b) b._picked = +el.dataset.k;
      if (t) host.rerender(t, el);
      host.ask(el.dataset.q, { intent: el.dataset.intent || undefined, el });
    },
    else: (el, host) => { if (host.focusInput) host.focusInput(el); },
    sort: (el) => {
      const tb = TB[el.dataset.tb], k = el.dataset.k;
      if (!tb) return;
      const full = !!el.closest('[data-tbfull]');
      if (tb.sort === k) tb.dir = tb.dir === 'asc' ? 'desc' : 'asc';
      else { tb.sort = k; const c = tb.cols.find((c) => c.key === k); tb.dir = c && ['name', 'text'].includes(c.type) ? 'asc' : 'desc'; }
      B.refreshTable(tb.id);
      // The header button was drawn again; the keyboard stays on the same column, in the view that was pressed.
      const sel = `[data-act="sort"][data-tb="${tb.id}"][data-k="${k}"]`;
      const nb = (full && document.querySelector(`[data-tbfull] ${sel}`)) || document.querySelector(`.bc-panel ${sel}`) || document.querySelector(sel);
      if (nb) nb.focus({ preventScroll: true });
    },
    fchip: (el) => {
      const tb = TB[el.dataset.tb], k = el.dataset.k;
      if (!tb) return;
      const label = (tb.chips.find((c) => c.key === k) || {}).label || k;
      B.pop(el, `<div class="pop__h">${esc(label)}</div>` + B.chipValues(tb, k).slice(0, 40).map(([v, n]) => `<button type="button" role="menuitem" data-v="${esc(v)}">${esc(v)}<span style="margin-left:auto;color:var(--h-ink-3);font-size:13px">${n}</span></button>`).join(''), (v) => { tb.f[k] = v; B.refreshTable(tb.id); });
    },
    fclear: (el) => { const tb = TB[el.dataset.tb]; if (!tb) return; delete tb.f[el.dataset.k]; B.refreshTable(tb.id); },
    tclear: (el) => { const tb = TB[el.dataset.tb]; if (!tb) return; tb.f = {}; tb.q = ''; document.querySelectorAll(`[data-tfind="${tb.id}"]`).forEach((i) => (i.value = '')); B.refreshTable(tb.id); },
    tcopy: async (el, host) => { const tb = TB[el.dataset.tb]; if (!tb) return; const ok = await copyText(B.tsv(tb)); host.toast(ok ? `Copied ${tableRows(tb).length} rows. Paste into any sheet.` : 'Your browser would not copy. Use CSV.'); },
    tcsv: (el, host) => {
      const tb = TB[el.dataset.tb];
      if (!tb) return;
      if (tb.csv && tb.partial && !Object.keys(tb.f).length && !tb.q) { const a = document.createElement('a'); a.href = tb.csv; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); host.toast('Downloading the CSV. The link works for 24 hours.'); return; }
      const url = URL.createObjectURL(new Blob(['﻿' + B.csv(tb)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = String(tb.sheet_title || tb.title || 'list').replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      host.toast('Downloading the rows you see.');
    },
    tsheet: (el, host) => B.makeSheet(el.dataset.tb, host, el),
    topen: (el, host) => { if (TB[el.dataset.tb]) host.openTable(el.dataset.tb, el); },
    pclose: (el, host) => { if (host.closeTable) host.closeTable(); },
    pexport: async (el, host) => {
      const t = host.turn(el), b = blockOf(t, el);
      if (!b || !window.FavorSheets) return;
      el.disabled = true;
      const s = b.stats || {};
      const rows = [{ partner: b.name, place: b.place || '', holder: b.holder ? b.holder.name : '', lifetime: s.lifetime || 0, last_gift: s.last_gift ? s.last_gift.amount : null, last_gift_date: s.last_gift ? s.last_gift.date : null, largest_gift: s.largest ? s.largest.amount : null }];
      const spec = { mode: 'rows', title: 'Partner ' + b.name, tabs: [{ name: 'Partner', columns: [{ key: 'partner', label: 'Partner', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'holder', label: 'Held by', type: 'text' }, { key: 'lifetime', label: 'Lifetime giving', type: 'money' }, { key: 'last_gift', label: 'Last gift', type: 'money' }, { key: 'last_gift_date', label: 'Last gift date', type: 'date' }, { key: 'largest_gift', label: 'Largest gift', type: 'money' }].concat((b.years || []).map((y) => ({ key: 'y' + y.y, label: 'Given in ' + y.y, type: 'money' }))), rows: rows.map((r) => Object.assign(r, Object.fromEntries((b.years || []).map((y) => ['y' + y.y, y.amount])))) }], provenance: { kind: 'screen', page: host.page || location.pathname, asked: t.q } };
      const r = await window.FavorSheets.run(spec, { navigate: false });
      el.disabled = false;
      if (r.ok) { host.toast('Partner exported to a sheet in your Drive', { href: r.url, label: 'Open it' }); if (host.sheetMade) host.sheetMade(r, null); }
      else if (r.error === 'consent' || r.error === 'not_connected') { consentCard(t, r, spec); host.rerender(t, el); }
      else host.toast(r.message || 'The sheet did not build.');
    },
    'consent-go': (el, host) => {
      const t = host.turn(el);
      if (!t) return;
      const x = (t.extras || []).find((x) => x.type === 'consent') || (t.blocks || [])[+el.dataset.bi];
      if (!x) return;
      el.disabled = true;
      el.innerHTML = '<span class="spin"></span>Opening Google';
      const toks = (t.lists || []).map((l) => l.token).filter(Boolean).slice(0, 3);
      window.FavorSheets.consent(x._spec || (toks.length ? { mode: 'brain', tokens: toks, dedupe: 'brain:' + toks.join(','), title: 'Favor Brain list', provenance: { kind: 'brain', page: host.page || location.pathname, asked: t.q } } : null), x.consent_url);
    },
    'consent-no': (el, host) => {
      const t = host.turn(el);
      if (!t) return;
      t.extras = (t.extras || []).filter((x) => x.type !== 'consent');
      const bi = +el.dataset.bi;
      if (bi >= 0 && t.blocks[bi] && t.blocks[bi].type === 'consent') t.blocks.splice(bi, 1);
      host.rerender(t, el);
      host.toast('No sheet made. The CSV still works.');
    },
    cf: async (el, host) => {
      const t = host.turn(el), b = blockOf(t, el);
      if (!b || b._busy) return;
      const bi = +el.dataset.bi, action = el.dataset.do;
      b._busy = action;
      host.rerender(t, el);
      try {
        const d = host.confirm ? await host.confirm(t, b, action, bi) : await host.api('confirm', { body: { id: b.id, action } });
        const was = b.kind;
        t.blocks.splice(bi, 1, ...(d.blocks || []));
        if (was === 'iwave_refresh' && (d.blocks || []).some((x) => x.type === 'confirm' && x.status === 'done')) {
          const p = t.blocks.find((x) => x.type === 'partner');
          t.follow = p ? ['Show the new rating for ' + p.name] : t.follow;
          if (p && p.lookup) t.follow = ['Tell me about lookup ' + p.lookup];
        }
        if (host.cue) host.cue(action === 'approve' ? 'success' : 'droplet');
      } catch (err) {
        b._busy = null;
        host.toast(err.message);
      }
      host.rerender(t, el);
    },
    'access-ask': async (el, host) => {
      const t = host.turn(el), b = blockOf(t, el);
      el.disabled = true;
      try {
        await host.api('request', { body: { package: el.dataset.pkg, reason: 'Asked from an answer: ' + String(t ? t.q : '').slice(0, 200), days: 30 } });
        if (b) b._state = 'asked';
        if (host.accessAsked) host.accessAsked(el.dataset.pkg);
        host.toast('Sent to Will');
        if (host.cue) host.cue('success');
      } catch (err) { host.toast(err.message); }
      if (t) host.rerender(t, el);
    },
  };
  B.actions = Object.keys(ACTIONS);

  // The filter box above a large table narrows its rows as the person types, on any page.
  document.addEventListener('input', (e) => {
    const f = e.target.closest && e.target.closest('[data-tfind]');
    if (f && TB[f.dataset.tfind]) { TB[f.dataset.tfind].q = f.value; B.refreshTable(f.dataset.tfind); }
  });
  // A press anywhere else puts the small menu away.
  document.addEventListener('click', (e) => {
    if (popEl && !e.target.closest('.pop') && !(popEl._anchor && popEl._anchor.contains(e.target))) B.closePop();
  }, true);
})();
