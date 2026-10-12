// An email's HTML, made safe to show. The page draws it in a sandboxed frame with scripts off and a strict content policy, so this
// is the second fence: scripts, frames, forms, event handlers and javascript: links go, and pictures sent inside the message
// (cid:) point at the attachment route instead.

const DROP_WITH_BODY = /<(script|iframe|object|embed|applet|noscript|template|frameset|frame|title)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_TAG = /<\/?(script|iframe|object|embed|applet|form|input|button|select|textarea|meta|link|base|frameset|frame|svg:script|noscript|template|title)\b[^>]*>/gi;

export function sanitizeHtml(html: string, cidUrl: (cid: string) => string | null = () => null): string {
  let s = String(html || '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(DROP_WITH_BODY, '');
  s = s.replace(DROP_TAG, '');
  // Attributes: no event handlers, no script or data-html links, no srcdoc.
  s = s.replace(/<([a-z][\w:-]*)(\s[^<>]*?)?(\/?)>/gi, (_all, tag: string, attrs: string | undefined, close: string) => {
    if (!attrs) return `<${tag}${close}>`;
    const kept: string[] = [];
    const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(attrs))) {
      const name = m[1].toLowerCase();
      let val = m[2] ?? m[3] ?? m[4] ?? '';
      if (/^on/.test(name) || name === 'srcdoc' || name === 'formaction' || name === 'xmlns:xlink') continue;
      if (/^(href|src|action|background|poster|xlink:href|lowsrc|dynsrc)$/.test(name)) {
        const v = val.replace(/[\u0000- ]/g, '').toLowerCase();
        if (v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !/^data:image\/(png|jpe?g|gif|webp);/.test(v))) continue;
        if (v.startsWith('cid:')) {
          const u = cidUrl(val.trim().slice(4).replace(/^<|>$/g, ''));
          if (!u) continue;
          val = u;
        }
      }
      if (name === 'style') val = val.replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding/gi, '');
      kept.push(m[2] === undefined && m[3] === undefined && m[4] === undefined ? name : `${name}="${val.replace(/"/g, '&quot;')}"`);
    }
    return `<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${close}>`;
  });
  // CSS inside <style> blocks: no imports of scripts, no old IE expressions.
  s = s.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_a, at: string, css: string) => `<style${at}>${css.replace(/expression\s*\(|javascript:|behavior\s*:|-moz-binding|@import[^;]*;?/gi, '')}</style>`);
  return s;
}

/** Plain text mail as HTML: escaped, links made clickable, quoted lines (">") kept as a quote. */
export function textToHtml(text: string): string {
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const linked = (x: string) => esc(x).replace(/\bhttps?:\/\/[^\s<>"]+/g, (u) => `<a href="${u}">${u}</a>`);
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (quote.length) out.push(`<blockquote class="gmail_quote">${quote.map(linked).join('<br>')}</blockquote>`);
    quote = [];
  };
  for (const l of lines) {
    if (/^>/.test(l)) quote.push(l.replace(/^>\s?/, ''));
    else {
      flush();
      out.push(linked(l));
    }
  }
  flush();
  return `<div style="white-space:pre-wrap">${out.join('<br>').replace(/(<\/blockquote>)<br>/g, '$1')}</div>`;
}
