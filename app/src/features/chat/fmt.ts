// Chat's text and time helpers: the same rules as public/js/chat/chat-ui.js, so a message reads the same on both screens.
// fmtBody returns escaped HTML (the message body is markdown-ish text with mention, channel and partner tokens).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type J = Record<string, any>;

const TZ = 'America/New_York';
export const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];

const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtDayLong = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
export const fmtShort = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
const dayKeys: Record<string, string> = {};
export function dayKey(iso: string): string {
  return dayKeys[iso] || (dayKeys[iso] = fmtDayKey.format(new Date(iso)));
}
export function dayLabel(iso: string): string {
  const k = dayKey(iso);
  const now = new Date();
  if (k === dayKey(now.toISOString())) return 'Today';
  if (k === dayKey(new Date(now.getTime() - 864e5).toISOString())) return 'Yesterday';
  return fmtDayLong.format(new Date(iso));
}
export const timeOf = (iso: string) => fmtTime.format(new Date(iso));
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (dayKey(iso) === dayKey(new Date().toISOString())) return 'today at ' + timeOf(iso);
  return fmtShort.format(new Date(iso));
}
export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
export function initials(n: string): string {
  const w = String(n || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x && !/^(mr|mrs|ms|dr|rev|and)$/i.test(x));
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
}
export const plural = (n: number, a: string, b?: string) => Number(n).toLocaleString('en-US') + ' ' + (n === 1 ? a : b || a + 's');
export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
export function sizeOf(n: unknown): string {
  const v = Number(n) || 0;
  return v >= 1048576 ? (v / 1048576).toFixed(1) + ' MB' : v >= 1024 ? Math.round(v / 1024) + ' KB' : v + (v === 1 ? ' byte' : ' bytes');
}
export function fmtSecs(s: number): string {
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}
export function hudDur(t: number): string {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const m = Math.floor(s / 60);
  return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

export function fileKind(a: J): string {
  const t = (a.mime || '') + ' ' + (a.name || '');
  if (/^image\//.test(a.mime || '')) return 'image';
  if (/^video\//.test(a.mime || '')) return 'video';
  if (/^audio\//.test(a.mime || '')) return 'audio';
  if (/pdf/i.test(t)) return 'pdf';
  if (/wordprocessingml|\.docx$/i.test(t)) return 'docx';
  if (/spreadsheetml|\.xlsx$|text\/csv|\.csv$/i.test(t)) return 'xlsx';
  if (/msword|\.doc$/i.test(t)) return 'doc';
  if (/excel|\.xls$/i.test(t)) return 'sheet';
  return 'file';
}
export const LAB: Record<string, string> = { pdf: 'PDF', docx: 'DOC', doc: 'DOC', xlsx: 'XLS', sheet: 'XLS', slides: 'PPT', photo: 'IMG', file: 'FILE', audio: 'AUDIO' };

const FE_PATH: Record<string, string> = {
  partner: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c.8-3.5 3.2-5.5 6-5.5s5.2 2 6 5.5"/>',
  fund: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1.1 1.5-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7"/>',
};
/** A partner or fund named in a message: the app's entity chip markup (features/entity). The page opens its card on hover or press. */
export function chipHtml(kind: 'partner' | 'fund', id: string, name: string): string {
  const href = kind === 'partner' ? '/work/partner/' + encodeURIComponent(id) : '';
  const inner = '<span class="fe-chip__i"><svg class="fe-i" viewBox="0 0 24 24" aria-hidden="true">' + FE_PATH[kind] + '</svg></span><span class="fe-chip__t">' + esc(name) + '</span>';
  const at = ' class="fe-chip fe-chip--' + kind + '" data-fe-react="' + kind + ':' + esc(id) + '" data-fe-off="1" data-chip="' + kind + ':' + esc(id) + '" data-label="' + esc(name) + '"';
  return href ? '<a' + at + ' href="' + href + '">' + inner + '</a>' : '<button type="button"' + at + '>' + inner + '</button>';
}

/** Lines that start a quote ("> "), a bulleted list ("- ") or a numbered list ("1. ") become those blocks; the rest stays text. */
function lineBlocks(t: string): string {
  const lines = t.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;
  let m: RegExpMatchArray | null;
  const flush = () => {
    if (para.length) {
      out.push(para.join('\n'));
      para = [];
    }
  };
  while (i < lines.length) {
    const L = lines[i];
    if (/^&gt; ?/.test(L)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^&gt; ?/.test(lines[i])) q.push(lines[i++].replace(/^&gt; ?/, ''));
      out.push('<blockquote>' + q.join('\n') + '</blockquote>');
    } else if (/^[-•] \S/.test(L)) {
      flush();
      const u: string[] = [];
      while (i < lines.length && /^[-•] \S/.test(lines[i])) u.push('<li>' + lines[i++].slice(2) + '</li>');
      out.push('<ul>' + u.join('') + '</ul>');
    } else if ((m = L.match(/^(\d{1,3})[.)] \S/))) {
      flush();
      const o: string[] = [];
      const start = m[1];
      while (i < lines.length && /^\d{1,3}[.)] \S/.test(lines[i])) o.push('<li>' + lines[i++].replace(/^\d{1,3}[.)] /, '') + '</li>');
      out.push('<ol start="' + start + '">' + o.join('') + '</ol>');
    } else {
      para.push(L);
      i++;
    }
  }
  flush();
  return out.join('');
}

export interface Names {
  me: string;
  user: (id: string) => J;
  chan: (id: string) => J | undefined;
}

export function fmtBody(body: string, N: Names): string {
  let t = esc(body || '');
  const blocks: string[] = [];
  t = t.replace(/```([\s\S]*?)```/g, (_m, c: string) => {
    blocks.push(c.replace(/^\n/, '').replace(/\n$/, ''));
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });
  const codes: string[] = [];
  t = t.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    codes.push(c);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });
  t = t.replace(/&lt;@([^&\s]+?)&gt;/g, (_m, id: string) => {
    if (id === 'brain') return '<span class="ch-at ch-at--brain">@Favor Brain</span>';
    if (id === 'all' || id === 'channel') return '<span class="ch-at ch-at--me">@channel</span>';
    return '<span class="ch-at' + (id === N.me ? ' ch-at--me' : '') + '" data-entity="person:' + esc(id) + '" data-label="' + esc(N.user(id).name) + '" tabindex="0">@' + esc(N.user(id).name) + '</span>';
  });
  t = t.replace(/&lt;~([pf]):(\d{1,12})\|(.{1,160}?)&gt;/g, (_m, k: string, id: string, name: string) => {
    const un = (x: string) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return chipHtml(k === 'f' ? 'fund' : 'partner', id, un(name));
  });
  t = t.replace(/&lt;#([^&\s]+?)&gt;/g, (_m, id: string) => {
    const c = N.chan(id);
    return '<span class="ch-chan"># ' + esc(c ? c.name : 'channel') + '</span>';
  });
  const links: string[] = [];
  t = t.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
    links.push('<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>');
    return '\u0000L' + (links.length - 1) + '\u0000';
  });
  t = t.replace(/https?:\/\/[^\s<\u0000]+/g, (u0: string) => {
    let u = u0;
    let tail = '';
    while (u.length > 8) {
      const ch = u[u.length - 1];
      if (/[.,;:!?]/.test(ch) || (ch === ')' && u.split(')').length > u.split('(').length)) {
        tail = ch + tail;
        u = u.slice(0, -1);
      } else break;
    }
    return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>' + tail;
  });
  t = t
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  t = lineBlocks(t);
  t = t.replace(/\u0000L(\d+)\u0000/g, (_m, i: string) => links[+i]);
  t = t.replace(/\u0000C(\d+)\u0000/g, (_m, i: string) => '<code>' + codes[+i] + '</code>');
  t = t.replace(/\u0000B(\d+)\u0000/g, (_m, i: string) => '<pre>' + blocks[+i] + '</pre>');
  return t;
}

/** The message as plain words (for a quote, a notice, a draft row, a search hit). */
export function plain(body: string, N: Names): string {
  return String(body || '')
    .replace(/<~[pf]:\d+\|([^>]+)>/g, '$1')
    .replace(/<@([^>]+)>/g, (_m, id: string) => '@' + (id === 'brain' ? 'Favor Brain' : id === 'channel' || id === 'all' ? 'channel' : N.user(id).name))
    .replace(/<#([^>]+)>/g, (_m, id: string) => {
      const c = N.chan(id);
      return '#' + (c ? c.name : 'channel');
    });
}

export function mentionsMe(m: J, me: string): boolean {
  const b = m.body || '';
  return b.indexOf('<@' + me + '>') >= 0 || b.indexOf('<@channel>') >= 0 || b.indexOf('<@all>') >= 0;
}

export function threadRef(m: J): J | null {
  return (m.attachments || []).filter((a: J) => a.type === 'threadref')[0] || null;
}
export function threadIdOf(m: J): number {
  const r = threadRef(m);
  return r ? r.root : m.thread_id || m.id;
}

export function brainLine(m: J): string {
  const bl = (m.brain && m.brain.blocks) || [];
  for (const x of bl) {
    if (x.type === 'tiles' && x.tiles && x.tiles[0]) return x.tiles[0].label + ': ' + (typeof x.tiles[0].value === 'number' ? x.tiles[0].value.toLocaleString('en-US') : x.tiles[0].value);
    if (x.type === 'table') return (x.title || 'A list') + ', ' + (Number(x.count) || (x.rows || []).length).toLocaleString('en-US') + ' rows';
    if (x.type === 'team') return x.team + ' ' + x.year;
    if (x.type === 'partner') return x.name;
    if ((x.type === 'text' || x.md) && x.md) return String(x.md).replace(/[*_#|>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
  }
  return 'An answer';
}

export function excerptOf(m: J, N: Names): string {
  const t = plain(m.body, N).trim();
  if (t) return t;
  const a = (m.attachments || []).filter((x: J) => x.type !== 'threadref' && x.type !== 'sent')[0];
  if (a)
    return a.type === 'file'
      ? (a.voice ? 'Voice note' : (/^image\//.test(a.mime || '') ? 'Picture: ' : 'File: ') + (a.name || ''))
      : a.type === 'clip'
        ? 'Clip: ' + (a.title || '')
        : a.type === 'task'
          ? 'Request: ' + (a.title || '')
          : a.type === 'meeting'
            ? a.title || 'Meeting'
            : a.name || a.title || 'Attachment';
  return m.user_id === 'brain' ? 'An answer from Favor Brain' : '';
}

/** A ref that sets a box's first value once. Preact re-applies defaultValue on every render, which wipes what was typed. */
export function initValue<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(v: string, r?: { current: T | null }) {
  return (el: T | null) => {
    if (r) r.current = el;
    if (el && el.dataset.v0 !== '1') {
      el.value = v;
      el.dataset.v0 = '1';
    }
  };
}

export function driveId(u: string): string {
  const m = String(u || '').match(/\/d\/([A-Za-z0-9_-]{10,})/) || String(u || '').match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : '';
}
