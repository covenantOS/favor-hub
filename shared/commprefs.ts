// Communication preferences, defined once for the server and the app: what a partner's solicit codes, record flags and phone, email and
// address marks add up to for a call, an email, a mailing and a text. The banner on the record, Call mode, the contact composer and Call
// prep all read the result of channelsOf(), so every screen says the same thing before anyone reaches out.
//
// Solicit codes are the Do Not and approved-contact codes in Raiser's Edge (communication preferences). A code counts while it has no end
// date or an end date in the future.

export type ChannelKey = 'call' | 'email' | 'mail' | 'text';

export interface CommInput {
  /** Solicit codes open today, as Blackbaud names them. */
  codes: string[];
  deceased?: boolean;
  inactive?: boolean;
  requestsNoEmail?: boolean;
  noValidAddress?: boolean;
  /** The preferred address is marked Do not mail. */
  addressDoNotMail?: boolean;
  /** Every phone on the record is marked Do not call (false when there is no phone). */
  allPhonesDoNotCall?: boolean;
  /** Every email on the record is marked Do not email (false when there is no email). */
  allEmailsDoNotEmail?: boolean;
}

export interface Reason {
  /** What staff read: "Do Not Call code", "Every phone is marked Do not call". */
  text: string;
  /** The solicit code behind it, when a code is the cause (the record can end it). */
  code?: string;
  /** requestsNoEmail or noValidAddress, when a record flag is the cause. */
  flag?: 'requestsNoEmail' | 'noValidAddress';
}

export interface Channel {
  key: ChannelKey;
  label: string;
  /** blocked: do not use this channel at all. limited: allowed for some purposes. ok: no mark. */
  state: 'ok' | 'limited' | 'blocked';
  reasons: Reason[];
}

export const CHANNEL_LABEL: Record<ChannelKey, string> = { call: 'Call', email: 'Email', mail: 'Mail', text: 'Text' };

/** The solicit codes that block a channel outright, and the ones that narrow it. */
export const BLOCKS: Record<ChannelKey, string[]> = {
  call: ['Do Not Call', 'Do Not Contact'],
  email: ['Do Not Email', 'Do Not Contact', 'Has no valid email'],
  mail: ['Do Not Mail', 'Do Not Contact'],
  text: ['Do Not Text', 'Do Not Contact'],
};
export const LIMITS: Record<ChannelKey, string[]> = {
  call: ['Do Not Call to Solicit', 'Do Not Call to Thank', 'Call From Approved Person', 'Do Not Solicit'],
  email: ['Do Not Email Newsletter', 'Do Not Email Solicitation', 'Do Not Email Quarterly Report', 'Do Not Solicit'],
  mail: ['Do Not Mail Solicitation', 'Do Not Mail Thank You', 'Do Not Mail Quarterly Report', 'Do Not Solicit'],
  text: ['Do Not Solicit'],
};

/** Plain words for a limiting code. */
export const LIMIT_WORDS: Record<string, string> = {
  'Do Not Call to Solicit': 'No asking by phone',
  'Do Not Call to Thank': 'No thank-you calls',
  'Call From Approved Person': 'Only an approved person may call',
  'Do Not Solicit': 'No asks',
  'Do Not Email Newsletter': 'No newsletter',
  'Do Not Email Solicitation': 'No asking by email',
  'Do Not Email Quarterly Report': 'No quarterly report by email',
  'Do Not Mail Solicitation': 'No asking by mail',
  'Do Not Mail Thank You': 'No thank-you mail',
  'Do Not Mail Quarterly Report': 'No quarterly report by mail',
};

const norm = (s: string) => s.trim().toLowerCase();

export function channelsOf(i: CommInput): Channel[] {
  const open = new Map<string, string>();
  for (const c of i.codes) open.set(norm(c), c);
  const has = (c: string) => open.has(norm(c));
  const out: Channel[] = [];
  for (const key of ['call', 'email', 'mail', 'text'] as ChannelKey[]) {
    const reasons: Reason[] = [];
    if (i.deceased) reasons.push({ text: 'Deceased' });
    for (const c of BLOCKS[key]) if (has(c)) reasons.push({ text: `${c} code`, code: open.get(norm(c)) });
    if (key === 'call' && i.allPhonesDoNotCall) reasons.push({ text: 'Every phone is marked Do not call' });
    if (key === 'email' && i.requestsNoEmail) reasons.push({ text: 'Requests no email', flag: 'requestsNoEmail' });
    if (key === 'email' && i.allEmailsDoNotEmail) reasons.push({ text: 'Every email is marked Do not email' });
    if (key === 'mail' && i.noValidAddress) reasons.push({ text: 'No valid address', flag: 'noValidAddress' });
    if (key === 'mail' && i.addressDoNotMail) reasons.push({ text: 'The address is marked Do not mail' });
    if (reasons.length) {
      out.push({ key, label: CHANNEL_LABEL[key], state: 'blocked', reasons });
      continue;
    }
    const lim: Reason[] = LIMITS[key].filter(has).map((c) => ({ text: LIMIT_WORDS[c] || c, code: open.get(norm(c)) }));
    out.push({ key, label: CHANNEL_LABEL[key], state: lim.length ? 'limited' : 'ok', reasons: lim });
  }
  return out;
}

export interface Banner {
  /** True when any channel carries a mark. */
  show: boolean;
  /** "Do not call. Do not mail." for blocked channels, then the narrowing lines. */
  lines: string[];
  blocked: ChannelKey[];
}

/** The short lines the banner shows. Facts only. */
export function bannerOf(channels: Channel[], i: Pick<CommInput, 'deceased' | 'inactive'> = {}): Banner {
  const blocked = channels.filter((c) => c.state === 'blocked').map((c) => c.key);
  const lines: string[] = [];
  if (i.deceased) lines.push('Deceased');
  else {
    if (blocked.length === 4) lines.push('Do not contact');
    else for (const k of blocked) lines.push(`Do not ${k === 'mail' ? 'mail' : k === 'call' ? 'call' : k === 'email' ? 'email' : 'text'}`);
  }
  const seen = new Set<string>();
  for (const c of channels) if (c.state === 'limited') for (const r of c.reasons) if (!seen.has(r.text)) { seen.add(r.text); lines.push(r.text); }
  if (i.inactive && !i.deceased) lines.push('Inactive');
  return { show: lines.length > 0, lines, blocked };
}

/** Would this kind of contact reach a blocked channel. Used by Log a contact and the Mailing form. */
export const KIND_CHANNEL: Record<string, ChannelKey | undefined> = { 'Phone call': 'call', Email: 'email', Mailing: 'mail' };
