// Builds the RFC 5322 message Gmail sends: From, To, Cc, Bcc, Subject, the reply headers that keep a thread together, an HTML
// body with a plain text copy, and attached files. Header words outside ASCII are encoded (RFC 2047) and every body is base64.
import type { Addr } from './gmail';

export interface OutFile { name: string; mime: string; data: Uint8Array }
export interface OutMail {
  from: Addr;
  to: Addr[];
  cc: Addr[];
  bcc: Addr[];
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  files?: OutFile[];
}

const enc = new TextEncoder();

export function bytesToB64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const b64ToBytes = (s: string): Uint8Array => Uint8Array.from(atob(String(s || '').replace(/\s/g, '')), (c) => c.charCodeAt(0));
export const toB64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const wrap = (b64: string) => b64.replace(/.{76}/g, '$&\r\n');
const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** A header word, encoded when it holds anything outside printable ASCII. */
export function word(s: string): string {
  const clean = String(s || '').replace(/[\r\n]+/g, ' ');
  return ascii(clean) ? clean : `=?UTF-8?B?${bytesToB64(enc.encode(clean))}?=`;
}

const cleanEmail = (e: string) => String(e || '').trim().replace(/[\r\n<>",;\s]/g, '');
export function addr(a: Addr): string {
  const email = cleanEmail(a.email);
  const name = String(a.name || '').replace(/[\r\n]+/g, ' ').trim();
  if (!name) return email;
  return ascii(name) ? `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>` : `${word(name)} <${email}>`;
}
export const addrList = (l: Addr[]) => l.filter((a) => cleanEmail(a.email)).map(addr).join(', ');

export const validEmail = (e: string) => /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(String(e || '').trim());

/** HTML to readable plain text, for the text copy of the message. */
export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => (t.replace(/<[^>]+>/g, '').trim() === h ? h : `${t} (${h})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const boundary = () => 'fos_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The whole message as text, ready for base64url and Gmail's send or draft call. */
export function buildMime(m: OutMail): string {
  const lines: string[] = [];
  const H = (k: string, v: string) => {
    if (v) lines.push(`${k}: ${v}`);
  };
  H('From', addr(m.from));
  H('To', addrList(m.to));
  H('Cc', addrList(m.cc));
  H('Bcc', addrList(m.bcc));
  H('Subject', word(m.subject || ''));
  if (m.inReplyTo) H('In-Reply-To', m.inReplyTo.replace(/[\r\n]/g, ''));
  if (m.references) H('References', m.references.replace(/[\r\n]+/g, ' '));
  H('MIME-Version', '1.0');
  const alt = boundary();
  const altBody = [
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(bytesToB64(enc.encode(htmlToText(m.html)))),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(bytesToB64(enc.encode(m.html || ''))),
    `--${alt}--`,
  ].join('\r\n');
  const files = m.files || [];
  if (!files.length) {
    H('Content-Type', `multipart/alternative; boundary="${alt}"`);
    return lines.join('\r\n') + '\r\n\r\n' + altBody + '\r\n';
  }
  const mix = boundary();
  H('Content-Type', `multipart/mixed; boundary="${mix}"`);
  const parts = [`--${mix}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', altBody];
  for (const f of files) {
    const name = String(f.name || 'file').replace(/[\r\n"\\]/g, '_');
    const type = /^[\w.+-]+\/[\w.+-]+$/.test(f.mime) ? f.mime : 'application/octet-stream';
    const fn = ascii(name) ? `"${name}"` : `"${word(name)}"`;
    parts.push(`--${mix}`, `Content-Type: ${type}; name=${fn}`, `Content-Disposition: attachment; filename=${fn}`, 'Content-Transfer-Encoding: base64', '', wrap(bytesToB64(f.data)));
  }
  parts.push(`--${mix}--`, '');
  return lines.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
}

/** base64url of the whole message, the form Gmail's raw field takes. */
export const rawOf = (m: OutMail) => toB64url(bytesToB64(enc.encode(buildMime(m))));
