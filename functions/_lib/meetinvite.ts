// Meetings: inviting a person from inside a call. The host types a Favor name, an email or a phone number.
// Staff get the room link by email, outside emails get the guest link by email, and a phone number gets the guest link
// by text through the GoHighLevel number. The keys live in Pages secrets (GHL_PIT, GHL_LOCATION), never in this repo.

export interface InviteEnv {
  GHL_PIT?: string;
  GHL_LOCATION?: string;
  /** Local tests only: a stand-in for the GoHighLevel API. Never set on the live site. */
  GHL_URL?: string;
}

export type Target =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string }
  | { kind: 'name'; query: string };

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** +1XXXXXXXXXX for US numbers typed any common way, or the digits with a plus for a full international number. Empty when it is not a phone number. */
export function normPhone(raw: string): string {
  const s = String(raw || '').trim();
  if (/[a-z@]/i.test(s)) return '';
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

export function parseTarget(raw: string): Target | null {
  const s = String(raw || '').trim().slice(0, 200);
  if (!s) return null;
  if (s.includes('@')) return EMAIL.test(s) ? { kind: 'email', email: s.toLowerCase() } : null;
  const phone = normPhone(s);
  if (phone) return { kind: 'phone', phone };
  return s.length >= 2 ? { kind: 'name', query: s } : null;
}

/** People from the directory whose name or email matches every word typed, best matches first. */
export function matchPeople<T extends { name: string; email: string }>(people: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hit = people.filter((p) => words.every((w) => `${p.name} ${p.email}`.toLowerCase().includes(w)));
  const q = query.toLowerCase();
  return hit.sort((a, b) => Number(b.name.toLowerCase() === q) - Number(a.name.toLowerCase() === q) || a.name.localeCompare(b.name));
}

export const smsText = (host: string, title: string, link: string): string => `${host} invited you to ${title}. Join: ${link}`;

export interface SmsResult { ok: boolean; dry?: boolean; reason?: string; contactId?: string; text: string }

/** Upsert the contact by phone, tag it, and send the text. With dry set nothing is created or sent; the call only checks that the key works. */
export async function textInvite(env: InviteEnv, phone: string, name: string, text: string, dry = false, f: typeof fetch = fetch): Promise<SmsResult> {
  const pit = env.GHL_PIT, loc = env.GHL_LOCATION;
  if (!pit || !loc) return { ok: false, reason: 'Texting is not set up.', text };
  const base = env.GHL_URL || 'https://services.leadconnectorhq.com';
  const head = { Authorization: `Bearer ${pit}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' };
  if (dry) {
    const r = await f(`${base}/contacts/?locationId=${encodeURIComponent(loc)}&limit=1`, { headers: head });
    return { ok: r.ok, dry: true, reason: r.ok ? '' : `GoHighLevel answered ${r.status}.`, text };
  }
  const up = await f(`${base}/contacts/upsert`, { method: 'POST', headers: head, body: JSON.stringify({ locationId: loc, phone, name: name || phone, tags: ['meeting-invite'] }) });
  const uj = (await up.json().catch(() => ({}))) as { contact?: { id?: string }; id?: string };
  const contactId = uj.contact?.id || uj.id || '';
  if (!up.ok || !contactId) return { ok: false, reason: `GoHighLevel did not take the contact (${up.status}).`, text };
  const sent = await f(`${base}/conversations/messages`, { method: 'POST', headers: head, body: JSON.stringify({ type: 'SMS', contactId, message: text }) });
  if (!sent.ok) return { ok: false, reason: `The text was refused (${sent.status}).`, contactId, text };
  return { ok: true, contactId, text };
}
