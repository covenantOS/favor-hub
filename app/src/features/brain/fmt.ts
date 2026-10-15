// Favor Brain formatting, the same rules the classic page used (public/js/brain-blocks.js): money, short money, counts, dates,
/* eslint-disable @typescript-eslint/no-explicit-any */
// the markdown the Brain writes, table titles said plainly and the figures in a sentence. Pure functions, safe on the server.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const esc = (s: unknown) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const money = (n: unknown) => {
  if (n == null || n === '') return '';
  const v = Number(n);
  return (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
};
export const moneyS = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a).toLocaleString('en-US');
  return n < 0 ? '-' + s : s;
};
export const int = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const dlong = (iso: unknown) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(iso || '');
};
export const dshort = (iso: unknown) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}${+m[1] === new Date().getFullYear() ? '' : ', ' + m[1]}` : '';
};
export type Fmt = 'money' | 'money_short' | 'int' | 'pct' | 'date' | 'text' | string;
export const fmt = (v: unknown, f?: Fmt): string => {
  if (v == null || v === '') return '';
  if (typeof v === 'string' && f !== 'money' && f !== 'money_short' && f !== 'int' && f !== 'pct') return f === 'date' ? dlong(v) : v;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return f === 'money' ? money(n) : f === 'money_short' ? moneyS(n) : f === 'pct' ? n + '%' : f === 'date' ? dlong(v) : int(n);
};
/** A link from an answer opens only as a web address or a page on this site. */
export const safeHref = (u: unknown) => (/^(https?:\/\/|\/(?!\/))/i.test(String(u || '')) ? String(u) : '#');

// ---- Markdown: the text block, and the fallback for any block this page does not know. Escaped first, so the HTML is safe.
const words = (s: string) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<]+[^\s<).,;:])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
export const inline = (s: string) =>
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
function mdTable(rows: string[]) {
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const num = head.map((_, i) => body.length > 0 && body.every((r) => !r[i] || NUM.test(r[i])));
  return `<div class="md-tbl"><table class="sc-table"><thead><tr>${head.map((h, i) => `<th${num[i] ? ' class="is-num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${head.map((_, i) => `<td${num[i] ? ' class="is-num"' : ''}>${/^https?:\/\/\S+$/.test(r[i] || '') ? `<a href="${esc(r[i])}" target="_blank" rel="noopener">Open</a>` : inline(r[i] || '')}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}
export function md(text: unknown): string {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      if (rows.length >= 2) out.push(mdTable(rows));
    } else if (/^\s*[-*] /.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ''));
      i--;
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    } else if (/^\s*\d+\. /.test(line)) {
      flush();
      const items: string[] = [];
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

// ---- Table titles said plainly ---------------------------------------------------------------------------------------
// "How many lapsed (last gift over 24 months ago) partners (households) in Ohio" reads "Lapsed partners in Ohio"; a title cut
// short ("Lapsed, major (a single gift of $1,000 or more") gets its noun back from the table: "Lapsed major partners".
const NOUNS = /\b(partners?|households?|gifts?|actions?|visits?|events?|records?|churches|foundations|individuals|organizations|grants?|opportunities|people|staff|codes?|appeals?|campaigns?|funds?|months?|years?|states?|teams?|rows?)\b/i;
export const nounOf = (b: { [k: string]: any }) =>
  b.noun || (b.cols && b.cols[0] && /^[A-Za-z ]+$/.test(b.cols[0].label || '') ? String(b.cols[0].label).toLowerCase().replace(/y$/, 'ie').replace(/s?$/, 's') : '');
export function shortTitle(t: unknown, noun?: string) {
  let s = String(t || '').replace(/^\s*(how many|list(?: of)?|a list of|show me|which)\s+/i, '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\([^)]*$/, '').replace(/\s+/g, ' ').replace(/[?.,:;]+$/, '').trim();
  if (!s) return String(t || '');
  s = s.replace(/^[A-Za-z]+(?:, [A-Za-z]+)+(?= |$)/, (m) => m.replace(/,/g, ''));
  if (!NOUNS.test(s) && noun) s += ' ' + String(noun).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A band text such as "$50,000 to $250,000" or "$500,000 and up" gets a step from its first amount. */
export const bandStep = (label: unknown) => {
  const m = String(label || '').match(/\$([\d,]+)(K|M)?/);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, ''));
  if (m[2] === 'K') n *= 1e3;
  if (m[2] === 'M') n *= 1e6;
  return n >= 500000 ? 4 : n >= 250000 ? 3 : n >= 50000 ? 2 : 1;
};

/** Partner initials: the first and last word, titles left out. */
export const initialsOf = (n: unknown) => {
  const w = String(n || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
};
export const hueOf = (s: unknown) => {
  let h = 0;
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
/** A time today, Yesterday, or the day. */
export const whenShort = (iso: unknown) => {
  if (!iso) return '';
  const d = new Date(String(iso));
  if (isNaN(+d)) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (+d >= +today) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (+d >= +today - 864e5) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
export const titleOf = (q: string) => {
  const t = q.replace(/[?.!]+$/, '');
  return t.length > 44 ? t.slice(0, 42) + '...' : t.charAt(0).toUpperCase() + t.slice(1);
};
