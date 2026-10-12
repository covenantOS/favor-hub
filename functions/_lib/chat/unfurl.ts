// Link cards for a pasted address. Hub clips and meetings become their own cards (see hydrate.ts); other pages become a title and
// a line of description read from the page's own tags. Only public https pages, a few seconds, a small slice of the page.
import type { Attachment } from './db';

const BLOCKED_HOSTS = /(^|\.)((localhost|local|internal|lan)$)|^(\d{1,3}\.){3}\d{1,3}$|^\[/i;

export function mayFetch(raw: string, ownHosts: string[]): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.test(h) || ownHosts.includes(h)) return false;
  // Google Docs and Drive links need a login the fetch does not have; they get a plain card in the message.
  return true;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();

export function readMeta(html: string): { title: string; desc: string; site: string; image: string } {
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? decode(m[1]) : '';
  };
  const og = (prop: string) =>
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  const title = og('og:title') || pick(/<title[^>]*>([^<]*)<\/title>/i);
  const desc = og('og:description') || og('description');
  // The page's own picture, when it names one at a full https address; the card shows it small beside the title.
  const img = og('og:image:secure_url') || og('og:image');
  const image = /^https:\/\/[^\s"'<>]{4,500}$/.test(img) ? img : '';
  return { title: title.slice(0, 160), desc: desc.slice(0, 220), site: og('og:site_name').slice(0, 60), image };
}

export async function unfurl(raw: string, ownHosts: string[], fetcher: typeof fetch = fetch): Promise<Attachment | null> {
  if (!mayFetch(raw, ownHosts)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetcher(raw, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': 'FavorHubLinkPreview/1.0', Accept: 'text/html' } });
    if (!res.ok || !/text\/html/i.test(res.headers.get('Content-Type') || '')) return null;
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      const dec = new TextDecoder();
      while (html.length < 80_000) {
        const { value, done } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      await reader.cancel().catch(() => undefined);
    } else html = (await res.text()).slice(0, 80_000);
    const { title, desc, site, image } = readMeta(html);
    if (!title) return null;
    return { type: 'link', url: raw, host: new URL(raw).hostname.replace(/^www\./, ''), title, desc, ...(site ? { site } : {}), ...(image ? { image } : {}) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
