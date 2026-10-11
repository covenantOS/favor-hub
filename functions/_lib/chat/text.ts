// Pure text rules for Favor Chat: mention tokens, the Favor Brain trigger, link recognition and search patterns.
// Nothing here reads a database or the network, so node tests cover it directly.

export const MAX_BODY = 4000;
export const BRAIN_ID = 'brain';
export const MEETINGS_ID = 'meetings';
export const SYSTEM_VOICES = new Set([BRAIN_ID, MEETINGS_ID]);

const EMAIL = '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}';
const TOKEN = new RegExp(`<@(${EMAIL}|channel|all|brain)>`, 'gi');

/** Trim, drop control characters except newlines and tabs, cap the length. */
export function cleanBody(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY);
}

export interface Mentions {
  /** Lowercase emails named with <@email>. */
  people: string[];
  /** <@channel> or <@all>: everyone in the channel. */
  everyone: boolean;
  /** <@brain> or the words @Favor Brain. */
  brain: boolean;
}

export function parseMentions(body: string): Mentions {
  const people = new Set<string>();
  let everyone = false;
  let brain = false;
  for (const m of String(body || '').matchAll(TOKEN)) {
    const v = m[1].toLowerCase();
    if (v === 'channel' || v === 'all') everyone = true;
    else if (v === 'brain') brain = true;
    else people.add(v);
  }
  if (!brain && detectBrain(body)) brain = true;
  return { people: [...people], everyone, brain };
}

/** True when the message addresses the Favor Brain: the token the composer inserts, or the words typed by hand. */
export function detectBrain(body: string): boolean {
  const b = String(body || '');
  return /<@brain>/i.test(b) || /(^|[\s(])@favor[\s-]?brain\b/i.test(b) || /(^|\s)@brain\b/i.test(b);
}

/** The question for the Brain: the message with the address to it removed. */
export function brainQuestion(body: string): string {
  return String(body || '')
    .replace(/<@brain>/gi, ' ')
    .replace(/(^|[\s(])@favor[\s-]?brain\b[,:]?/gi, '$1 ')
    .replace(/(^|\s)@brain\b[,:]?/gi, '$1 ')
    .replace(TOKEN, (_all, v: string) => '@' + String(v).split('@')[0])
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi;

export function urlsIn(body: string): string[] {
  const out: string[] = [];
  for (const m of String(body || '').matchAll(URL_RE)) if (!out.includes(m[0])) out.push(m[0]);
  return out.slice(0, 5);
}

export type LinkRef = { type: 'clip'; id: string } | { type: 'meeting'; id: string } | null;

/** A link to a hub clip or meeting on this site becomes a card. Anything else is null. */
export function classifyUrl(raw: string, hosts: string[]): LinkRef {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!hosts.includes(u.hostname.toLowerCase())) return null;
  const clip = u.pathname.match(/^\/c\/([0-9a-f]{32})\/?$/);
  if (clip) return { type: 'clip', id: clip[1] };
  if (/^\/meet\/(room|notes)\/?$/.test(u.pathname)) {
    const m = u.searchParams.get('m') || '';
    if (/^[0-9a-f]{24}$/.test(m)) return { type: 'meeting', id: m };
  }
  return null;
}

/** A LIKE pattern for a typed search, with the wildcard characters taken out of the person's text. */
export function likePattern(q: string): string {
  return '%' + String(q || '').toLowerCase().replace(/[%_\\]/g, ' ').trim().replace(/\s+/g, '%') + '%';
}

/** Channel names: lowercase letters, digits and hyphens, 1 to 40 characters. Empty when nothing usable is left. */
export function channelSlug(raw: unknown): string {
  return String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** The key that finds an existing direct or group conversation again: the members, sorted. */
export function dmKey(emails: string[]): string {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort().join(',');
}

export const EMOJI_OK = /^[\p{Extended_Pictographic}‍️⃣]{1,12}$/u;

/** A short plain-text line for the bell and notices: tokens turned into names, cut at a length. */
export function plainLine(body: string, names: (id: string) => string, max = 140): string {
  const t = String(body || '')
    .replace(TOKEN, (_a, v: string) => '@' + (v.toLowerCase() === 'brain' ? 'Favor Brain' : v.toLowerCase() === 'channel' || v.toLowerCase() === 'all' ? 'channel' : names(v.toLowerCase())))
    .replace(/<#[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
