// Light Markdown for a written page: ## and ### headings, - and 1. lists, **bold**, *italic*, [text](https://...). Parsed to plain data
// here and drawn as React elements (Markdown.tsx), so the page's text is escaped by React and never injected as HTML. The rules match
// the Astro lesson player (public/js/learn.js): a ### line makes a heading and drops the rest of its paragraph, consecutive lists of
// the same kind join, and only https links are links.
export type Inline = { t: 'text'; s: string } | { t: 'b'; c: Inline[] } | { t: 'i'; c: Inline[] } | { t: 'a'; href: string; c: Inline[] };
export type Block = { t: 'h2' | 'h3'; c: Inline[] } | { t: 'ul' | 'ol'; items: Inline[][] } | { t: 'p'; lines: Inline[][] };

const BOLD = /\*\*([^*]+)\*\*/;
const LINK = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/;
const ITALIC = /(^|[^*])\*([^*\s][^*]*)\*/;

/** The earliest of bold, link and italic in s, with where it starts and ends. */
function firstMark(s: string): { at: number; end: number; kind: 'b' | 'a' | 'i'; m: RegExpExecArray } | null {
  let best: { at: number; end: number; kind: 'b' | 'a' | 'i'; m: RegExpExecArray } | null = null;
  const tryRe = (re: RegExp, kind: 'b' | 'a' | 'i') => {
    const m = re.exec(s);
    if (!m) return;
    const at = kind === 'i' ? m.index + m[1].length : m.index;
    if (!best || at < best.at) best = { at, end: m.index + m[0].length, kind, m };
  };
  tryRe(BOLD, 'b');
  tryRe(LINK, 'a');
  tryRe(ITALIC, 'i');
  return best;
}

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let rest = s;
  while (rest) {
    const f = firstMark(rest);
    if (!f) {
      out.push({ t: 'text', s: rest });
      break;
    }
    if (f.at > 0) out.push({ t: 'text', s: rest.slice(0, f.at) });
    if (f.kind === 'b') out.push({ t: 'b', c: inline(f.m[1]) });
    else if (f.kind === 'a') out.push({ t: 'a', href: f.m[2], c: inline(f.m[1]) });
    else out.push({ t: 'i', c: inline(f.m[2]) });
    rest = rest.slice(f.end);
  }
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const out: Block[] = [];
  let list: { t: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flush = () => {
    if (list) {
      out.push(list);
      list = null;
    }
  };
  for (const block of String(src || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const first = lines[0];
    if (/^###\s/.test(first)) {
      flush();
      out.push({ t: 'h3', c: inline(first.replace(/^###\s+/, '')) });
      continue;
    }
    if (/^##?\s/.test(first)) {
      flush();
      out.push({ t: 'h2', c: inline(first.replace(/^##?\s+/, '')) });
      lines.shift();
      if (!lines.length) continue;
    }
    const ul = lines.every((l) => /^[-*]\s+/.test(l));
    const ol = lines.every((l) => /^\d+[.)]\s+/.test(l));
    if (ul || ol) {
      const t = ul ? 'ul' : 'ol';
      if (list && list.t !== t) flush();
      if (!list) list = { t, items: [] };
      for (const l of lines) list.items.push(inline(l.replace(/^([-*]|\d+[.)])\s+/, '')));
      continue;
    }
    flush();
    out.push({ t: 'p', lines: lines.map(inline) });
  }
  flush();
  return out;
}
