// Chat email in the look Will approved for the first welcome: logo, a dark green banner, the sender's face, name and time, the
// message in a chat bubble, one Open the chat button. Three kinds:
//   welcome  the first email a person ever gets from Chat, sent at once, with the sign-in line
//   start    the first message in a conversation that includes you (people who were welcomed before)
//   unread   what is still unread in one conversation ten minutes after it arrived, up to the last three messages
// Pure functions: nothing here reads a database or sends anything, so tests and the preview render them directly.
import { clip, esc } from '../requests/email';

export type ChatMailKind = 'welcome' | 'start' | 'unread';
export type ChatKind = 'public' | 'private' | 'dm' | 'group';

export interface ChatMailMessage {
  id: number;
  who: { name: string; picture?: string };
  body: string;
  at: string;
  /** Why this message is for the reader: dm, mention, reply or start. */
  why?: string;
}

export interface ChatMailInput {
  kind: ChatMailKind;
  to: { name: string; email: string };
  channel: { id: string; kind: ChatKind; name: string };
  /** The other people in a direct message or group, never the reader. */
  others: string[];
  /** The messages shown, oldest first. */
  messages: ChatMailMessage[];
  /** How many messages are unread in all (more than shown when over three). */
  total?: number;
  origin: string;
  /** The link that turns Chat email off for this person. */
  off: string;
  now?: Date;
}

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const CUT = 600;
const TZ = 'America/New_York';

/** "Rachel Cox", "Rachel Cox and Michael Hinton", "Rachel Cox, Michael Hinton and 2 others". */
export function nameList(names: string[], max = 3): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  if (n.length <= max) return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  return n.slice(0, max - 1).join(', ') + ` and ${n.length - (max - 1)} others`;
}

export const chatLink = (origin: string, channelId: string, messageId?: number) =>
  `${origin.replace(/\/$/, '')}/chat/?c=${encodeURIComponent(channelId)}${messageId ? `&m=${messageId}` : ''}`;

/** "Today at 7:48 AM", "Yesterday at 4:05 PM", "Oct 9 at 9:30 AM", in Eastern time. */
export function whenWord(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  if (day(d) === day(now)) return `Today at ${time}`;
  if (day(d) === day(new Date(now.getTime() - 86400000))) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })} at ${time}`;
}

const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'there';

/** The sentence under the banner headline, and the subject. */
export function sentence(m: ChatMailInput): string {
  const last = m.messages[m.messages.length - 1];
  const sender = last?.who.name || 'Someone';
  const c = m.channel;
  const place = c.kind === 'dm' ? 'a direct message' : c.kind === 'group' ? 'a group chat' : '#' + c.name;
  if (m.kind === 'welcome') {
    const lead = m.messages[0]!;
    const s = lead.who.name;
    const r = m.others.filter((n) => n !== s);
    if (lead.why === 'mention') return `${s} mentioned you in ${place} in FavorOS. Come join the party.`;
    if (lead.why === 'reply') return `${s} added you to a thread in FavorOS. Come join the party.`;
    if (c.kind === 'dm') return `${s} sent you a direct message in FavorOS. Come join the party.`;
    if (c.kind === 'group') return `${s} added you to a group chat${r.length ? ' with ' + nameList(r) : ''} in FavorOS. Come join the party.`;
    return `${s} added you to #${c.name} in FavorOS. Come join the party.`;
  }
  const rest = m.others.filter((n) => n !== sender);
  if (m.kind === 'start') {
    if (c.kind === 'dm') return `${sender} sent you a message in FavorOS`;
    if (c.kind === 'group') return `${sender} started a group chat with you${rest.length ? ' and ' + nameList(rest) : ''} in FavorOS`;
    return `${sender} wrote in #${c.name}, a channel you are in on FavorOS`;
  }
  const total = m.total || m.messages.length;
  const names = [...new Set(m.messages.map((x) => x.who.name))];
  if (total > 1) return `${total} unread messages in FavorOS from ${nameList(names, 2)}`;
  if (last?.why === 'mention') return `${sender} mentioned you in ${place} in FavorOS`;
  if (last?.why === 'reply') return `${sender} replied to you in FavorOS`;
  return `${sender} sent you a message in FavorOS`;
}

function headline(m: ChatMailInput): { title: string; line: string } {
  if (m.kind === 'welcome') return { title: `${first(m.to.name)}, you're in.`, line: sentence(m) };
  const names = [...new Set(m.messages.map((x) => x.who.name))];
  const one = m.messages.length === 1 && (m.total || 1) === 1;
  const where = m.channel.kind === 'dm' ? '' : m.channel.kind === 'group' ? `In a group chat with ${nameList([...names, ...m.others.filter((n) => !names.includes(n))], 3)}` : `In #${m.channel.name}`;
  return { title: `${one ? 'New message' : 'New messages'} from ${nameList(names, 2)}`, line: where || 'Sent to you directly in FavorOS' };
}

const CLIP = /https:\/\/dash\.favorintl\.org\/c\/([0-9a-f]{32})/i;

function linkify(escaped: string): string {
  return escaped.replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1f5a35;text-decoration:underline">$1</a>');
}

function paras(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function bubble(x: ChatMailMessage, m: ChatMailInput, now: Date): string {
  const link = chatLink(m.origin, m.channel.id, x.id);
  const text = x.body || 'Shared an attachment';
  const cut = text.length > CUT;
  const shown = cut ? text.slice(0, CUT).replace(/\s+\S*$/, '') + '...' : text;
  const initials = x.who.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const face =
    x.who.picture && /^https:\/\//.test(x.who.picture)
      ? `<img src="${esc(x.who.picture)}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border-radius:22px;border:0">`
      : `<div style="width:44px;height:44px;border-radius:22px;background:#e6efdc;color:#2b4d24;font:700 16px/44px Arial,sans-serif;text-align:center">${esc(initials)}</div>`;
  const clipId = text.match(CLIP)?.[1];
  const poster = clipId
    ? `<div style="padding-top:14px"><a href="${m.origin}/c/${clipId}" style="display:block;text-decoration:none"><img src="${m.origin}/api/clips/${clipId}/media?poster=1" width="526" alt="Watch the video" style="display:block;width:100%;max-width:526px;height:auto;border-radius:12px;border:0"></a>` +
      `<div style="font-family:${SANS};font-size:13px;color:#7a7f78;padding:10px 2px 0 2px"><a href="${m.origin}/c/${clipId}" style="color:#1f5a35;font-weight:600;text-decoration:none">&#9654;&nbsp; Watch the video</a></div></div>`
    : '';
  return (
    `<tr><td style="background:#fffdf8;padding:24px 36px 0 36px;border-left:1px solid #e3dccd;border-right:1px solid #e3dccd">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding-right:12px">${face}</td>` +
    `<td valign="middle" style="font-family:${SANS}"><div style="font-size:15px;font-weight:600;color:#1d241f">${esc(x.who.name)}</div><div style="font-size:13px;color:#7a7f78">${esc(whenWord(x.at, now))}</div></td></tr></table>` +
    `<div style="margin:14px 0 0 0;padding:18px 20px 8px 20px;background:#f4f0e6;border-radius:4px 16px 16px 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:#2a312c">${paras(shown)}` +
    (cut ? `<p style="margin:0 0 12px 0"><a href="${esc(link)}" style="color:#1f5a35;font-weight:600;text-decoration:none">Read the rest in FavorOS</a></p>` : '') +
    `</div>${poster}</td></tr>`
  );
}

/** One email. */
export function buildChatMail(m: ChatMailInput): { subject: string; html: string; text: string } {
  const now = m.now || new Date();
  const h = headline(m);
  const lead = m.messages[0]!;
  const open = chatLink(m.origin, m.channel.id, m.kind === 'welcome' ? lead.id : m.messages[m.messages.length - 1]?.id);
  const hidden = Math.max(0, (m.total || m.messages.length) - m.messages.length);
  const subject = m.kind === 'welcome' ? sentence(m).replace(/.? Come join the party.$/, '') : sentence(m);
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(m.kind === 'welcome' ? "You're in FavorOS" : 'FavorOS Chat')}</title></head>` +
    `<body style="margin:0;padding:0;background:#efe9dd"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(clip(m.kind === 'welcome' ? sentence(m) : lead.body || subject, 110))}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#efe9dd"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">` +
    `<tr><td style="padding:0 6px 18px 6px"><img src="${m.origin}/images/favor-logo-color.png" width="128" alt="Favor International" style="display:block;border:0;height:auto"></td></tr>` +
    `<tr><td style="background:#173b27;border-radius:18px 18px 0 0;padding:38px 36px 34px 36px"><div style="font-family:${SANS};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#a9c7a4;margin:0 0 14px 0">FavorOS</div>` +
    `<div style="font-family:${SERIF};font-size:${m.kind === 'welcome' ? 36 : 30}px;line-height:1.15;color:#ffffff;margin:0 0 14px 0">${esc(h.title)}</div>` +
    `<div style="font-family:${SANS};font-size:17px;line-height:1.55;color:#dbe7d6">${esc(h.line)}</div></td></tr>` +
    m.messages.map((x) => bubble(x, m, now)).join('') +
    (hidden ? `<tr><td style="background:#fffdf8;padding:14px 36px 0 36px;border-left:1px solid #e3dccd;border-right:1px solid #e3dccd;font-family:${SANS};font-size:13px;color:#7a7f78">${hidden} earlier unread ${hidden === 1 ? 'message' : 'messages'} in the conversation</td></tr>` : '') +
    `<tr><td align="center" style="background:#fffdf8;padding:30px 36px 34px 36px;border-left:1px solid #e3dccd;border-right:1px solid #e3dccd;border-bottom:1px solid #e3dccd;border-radius:0 0 18px 18px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#1f5a35;border-radius:999px"><a href="${esc(open)}" style="display:inline-block;padding:15px 34px;font-family:${SANS};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none">Open the chat</a></td></tr></table>` +
    (m.kind === 'welcome' ? `<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:#7a7f78;margin:16px 0 0 0">Sign in with your Favor Google account, the one that ends in @favorintl.org.</div>` : '') +
    `</td></tr>` +
    `<tr><td align="center" style="padding:22px 10px 0 10px;font-family:${SANS};font-size:12px;line-height:1.6;color:#8d8a80">FavorOS &middot; <a href="https://dash.favorintl.org" style="color:#8d8a80">dash.favorintl.org</a><br>Favor International<br><a href="${esc(m.off)}" style="color:#8d8a80">Turn off email about chat</a></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = [
    h.title,
    h.line,
    '',
    ...m.messages.map((x) => `${x.who.name}, ${whenWord(x.at, now)}: ${clip(x.body || 'Shared an attachment', CUT)}`),
    ...(hidden ? [`${hidden} earlier unread ${hidden === 1 ? 'message' : 'messages'} in the conversation`] : []),
    '',
    `Open the chat: ${open}`,
    ...(m.kind === 'welcome' ? ['Sign in with your Favor Google account, the one that ends in @favorintl.org.'] : []),
    '',
    `Turn off email about chat: ${m.off}`,
  ].join('\n');
  return { subject: clip(subject, 140), html, text };
}

/** The page behind the footer link: a confirmation that stays quiet until the button is pressed, so a mail scanner opening the link changes nothing. */
export function offPage(opts: { state: 'ask' | 'done' | 'bad'; email?: string; action?: string; origin: string }): string {
  const body =
    opts.state === 'ask'
      ? `<h1>Turn off email about chat?</h1><p>${esc(opts.email || '')}</p><form method="post" action="${esc(opts.action || '')}"><button type="submit">Turn off</button></form>`
      : opts.state === 'done'
        ? `<h1>Email about chat is off</h1><p>You can turn it back on under Request email in FavorOS.</p><a class="open" href="${esc(opts.origin)}/chat/">Open FavorOS Chat</a>`
        : `<h1>That link has expired</h1><p>Open FavorOS to change your email settings.</p><a class="open" href="${esc(opts.origin)}/requests/?notices=1">Open FavorOS</a>`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email about chat</title>` +
    `<style>body{margin:0;background:#efe9dd;font:400 15px/1.5 ${SANS};color:#1d241f;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}` +
    `main{background:#fffdf8;border:1px solid #e3dccd;border-radius:18px;padding:28px;max-width:420px;width:100%;box-sizing:border-box}` +
    `h1{font:400 24px/1.25 ${SERIF};margin:0 0 8px}p{margin:0 0 20px;color:#57534a}` +
    `button,.open{display:block;text-align:center;width:100%;box-sizing:border-box;padding:16px 20px;border:0;border-radius:999px;background:#1f5a35;color:#fff;font:600 16px/1 ${SANS};text-decoration:none;cursor:pointer}</style></head>` +
    `<body><main>${body}</main></body></html>`
  );
}
