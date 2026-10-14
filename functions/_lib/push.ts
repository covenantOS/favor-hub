// Web push for the phone app and the browser: a direct message or a mention reaches a person whose phone is locked.
// Messages are encrypted for the browser's own key (RFC 8291, aes128gcm) and the request is signed with the hub's VAPID key
// (RFC 8292), so the push service (Apple, Google, Mozilla) carries bytes it cannot read.
//
// The VAPID key pair lives in the Pages secret VAPID_JWK (a private P-256 JWK). The public key is derived from it, never stored apart.
// iPhone delivers web push only to an app added to the Home Screen (iOS 16.4 and later).
import { keepAllowed } from './access';
import { nowIso, type Env } from './http';
import { hold, quietNow } from './quiet';
import { blockedSet } from './blocked';

export type PushEnv = Env & { VAPID_JWK?: string; VAPID_SUBJECT?: string };

export interface PushSub {
  endpoint: string;
  email: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap opens, a path on this site. */
  url: string;
  /** A newer notice with the same tag replaces the older one. */
  tag?: string;
  channelId?: string;
  /** A huddle ring (chat/ring.ts): the notice gets Join and Decline and stays until answered (public/sw.js). */
  ring?: string;
  /** The ring is over; the notice with the same tag becomes this ("missed"). */
  ringEnd?: string;
}

const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts a payload for one subscription. `fixed` lets a test pin the sender key and salt. */
export async function encryptPayload(
  p256dh: string,
  auth: string,
  plain: Uint8Array,
  fixed?: { keys?: CryptoKeyPair; salt?: Uint8Array }
): Promise<Uint8Array> {
  if (plain.length > 3800) throw new Error('push payload too large');
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const sender = fixed?.keys || ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed?.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** The public key the browser needs to subscribe (uncompressed point, base64url), or '' when push is not set up. */
export function vapidPublicKey(env: PushEnv): string {
  try {
    const jwk = JSON.parse(env.VAPID_JWK || '') as { x: string; y: string };
    return b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
  } catch {
    return '';
  }
}

async function vapidHeader(env: PushEnv, endpoint: string): Promise<string> {
  const jwk = JSON.parse(env.VAPID_JWK as string) as JsonWebKey;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:tech@favorintl.org' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapidPublicKey(env)}`;
}

/** The browser push services: Chrome and Edge (FCM), Safari (Apple), Firefox (Mozilla), Windows (WNS). */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/;

/** Only https browser push services, never another host. */
export function validEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.test(u.hostname) && endpoint.length < 1200;
  } catch {
    return false;
  }
}

export interface SendResult {
  status: number;
  gone: boolean;
}

export async function sendPush(env: PushEnv, sub: PushSub, payload: PushPayload, fetcher: typeof fetch = fetch): Promise<SendResult> {
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(payload)));
  const res = await fetcher(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', ...(payload.tag ? { Topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}) },
    body,
  });
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}

/** Sends to every device the people turned on. A dead subscription is removed; a few failures in a row remove it too. */
/** opts.now: quiet hours are checked at this time. opts.loud: sends during quiet hours (an admin's @here, the morning summary, a device test). */
export async function pushToPeople(env: PushEnv, emails: string[], payload: PushPayload, fetcher: typeof fetch = fetch, opts: { loud?: boolean; messageId?: number | null; now?: Date } = {}): Promise<number> {
  let list = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 40);
  if (!list.length || !env.VAPID_JWK) return 0;
  // A push that opens Chat, Mail or Learn goes only to people who may use that feature (access groups, functions/_lib/access.ts).
  const feature = /^\/chat(\/|\?|$)/.test(payload.url || '') ? 'chat' : /^\/mail(\/|\?|$)/.test(payload.url || '') ? 'mail' : /^\/learn(\/|\?|$)/.test(payload.url || '') ? 'learn' : null;
  if (feature) {
    list = await keepAllowed(env, feature, list);
    if (!list.length) return 0;
  }
  // A blocked or offboarded person gets no push, even from a phone that is still subscribed.
  const blocked = await blockedSet(env, list);
  if (blocked.size) list = list.filter((e) => !blocked.has(e));
  if (!list.length) return 0;
  if (!opts.loud) {
    // Quiet hours (quiet.ts): the push waits for the morning summary instead.
    const now = opts.now || new Date();
    const quiet = await quietNow(env, list, now).catch(() => new Set<string>());
    for (const e of quiet) await hold(env, e, { kind: 'push', title: payload.title, body: payload.body, url: payload.url, messageId: opts.messageId ?? null }, now).catch(() => undefined);
    list = list.filter((e) => !quiet.has(e));
    if (!list.length) return 0;
  }
  let sent = 0;
  try {
    const rows = await env.DB.prepare(`SELECT endpoint, email, p256dh, auth FROM push_subs WHERE email IN (${list.map(() => '?').join(',')}) LIMIT 120`).bind(...list).all<PushSub>();
    await Promise.all(
      (rows.results || []).map(async (sub) => {
        try {
          const r = await sendPush(env, sub, payload, fetcher);
          if (r.status >= 200 && r.status < 300) {
            sent += 1;
            await env.DB.prepare('UPDATE push_subs SET last_ok = ?, fails = 0 WHERE endpoint = ?').bind(nowIso(), sub.endpoint).run();
          } else if (r.gone) {
            await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
          } else {
            await env.DB.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(sub.endpoint).run();
            await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND fails >= 8').bind(sub.endpoint).run();
          }
        } catch (err) {
          console.warn('[push] send', err);
        }
      })
    );
  } catch (err) {
    console.warn('[push] lookup', err);
  }
  return sent;
}

export interface Notice {
  email: string;
  kind: 'mention' | 'dm' | 'reply';
}

/** A direct message or a mention becomes a push for the people it names. Replies and muted conversations do not (Chat already left them out of `notify`). */
export async function pushForPost(
  env: PushEnv,
  input: { notify: Notice[]; channel: { id: string; kind: string; name: string }; senderName: string; text: string; messageId: number; threadId: number | null; urgent?: boolean },
  fetcher: typeof fetch = fetch
): Promise<number> {
  const opts = { loud: !!input.urgent, messageId: input.messageId };
  const dm = input.notify.filter((n) => n.kind === 'dm').map((n) => n.email);
  const mention = input.notify.filter((n) => n.kind === 'mention').map((n) => n.email);
  const where = input.channel.kind === 'public' || input.channel.kind === 'private' ? ` in #${input.channel.name}` : '';
  const snippet = input.text.replace(/\s+/g, ' ').trim().slice(0, 140) || 'Sent an attachment';
  const url = `/chat/?c=${encodeURIComponent(input.channel.id)}${input.threadId ? `&t=${input.threadId}` : ''}&m=${input.messageId}`;
  const base = { url, channelId: input.channel.id, tag: `chat-${input.channel.id}` };
  let sent = 0;
  if (dm.length) sent += await pushToPeople(env, dm, { ...base, title: input.senderName, body: snippet }, fetcher, opts);
  if (mention.length) sent += await pushToPeople(env, mention, { ...base, title: `${input.senderName} mentioned you${where}`, body: snippet }, fetcher, opts);
  return sent;
}
