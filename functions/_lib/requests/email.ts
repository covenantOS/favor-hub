// Request board email, in Favor's look (the same bar as the meeting reminder in meetcal.ts): one card, the sender's face and
// name, the request title, where it stands as chips, the note or comment with the last two entries of the thread, one Open
// button and two quiet links (Mark done, Reply) that land in the hub on that request. Built per event:
//   sent      someone sent you the request            mention   someone named you in a comment
//   comment   a comment on a request you follow       waiting   the request is waiting on you
//   due       your request is due today or tomorrow   done      a request you follow was finished
// buildSummary groups a day's notices by request for people who chose the daily summary.
// Pure functions: nothing here reads a database or sends anything, so tests and the preview render them directly.

export type MailKind = 'sent' | 'mention' | 'comment' | 'waiting' | 'due' | 'done';

export interface MailPerson {
  name: string;
  picture?: string;
}

export interface MailRequest {
  id: string;
  title: string;
  status: string;
  owner?: string;
  due_date?: string | null;
  waiting_on?: string;
}

export interface MailEntry {
  who: MailPerson;
  body: string;
  at: string;
}

export interface NoticeMail {
  kind: MailKind;
  to: { name: string; email: string };
  actor: MailPerson;
  request: MailRequest;
  /** The note or comment, with mentions already written as @Name. */
  note: string;
  /** The entries in the thread before this one, oldest first; the last two are shown. */
  thread?: MailEntry[];
  origin: string;
  /** For due: today or tomorrow. */
  dueWord?: string;
  now?: Date;
}

export const LOGO = 'https://dash.favorintl.org/images/favor-icon.png';
export const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24', leaf: '#e6efdc', sun: '#fbe9c6', sky: '#e1edf5', red: '#b3412b' };
const TZ = 'America/New_York';
const STATUS: Record<string, string> = { inbox: 'Inbox', approved: 'Approved', in_progress: 'In motion', done: 'Done', declined: 'Declined' };

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
export const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'Someone';
const initials = (n: string) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const dayWord = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
export const timeWord = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** The links every request email carries. Each opens the hub on that request; a signed-out person signs in and lands there. */
export function linksFor(origin: string, id: string) {
  const base = `${origin.replace(/\/$/, '')}/requests/?r=${encodeURIComponent(id)}`;
  return { open: base, done: `${base}&do=done`, reply: `${base}&reply=1`, prefs: `${origin.replace(/\/$/, '')}/requests/?notices=1` };
}

export function face(p: MailPerson, size = 40): string {
  const r = Math.round(size / 2);
  if (p.picture && /^https:\/\//.test(p.picture)) {
    return `<img src="${esc(p.picture)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border-radius:${r}px;border:0" />`;
  }
  return `<span class="fv-leaf" style="display:inline-block;width:${size}px;height:${size}px;border-radius:${r}px;background:${C.leaf};color:${C.green};font:700 ${Math.round(size * 0.36)}px/${size}px Arial,sans-serif;text-align:center">${esc(initials(p.name))}</span>`;
}

function chips(r: MailRequest, today: string): string {
  const chip = (label: string, value: string, bg: string, fg: string, cls: string) =>
    `<span class="${cls}" style="display:inline-block;white-space:nowrap;margin:0 6px 6px 0;padding:6px 11px;border-radius:999px;border:1px solid ${cls === 'fv-chip' ? C.line : bg};background:${cls === 'fv-chip' ? C.card : bg};font:400 13px/1.2 Arial,sans-serif;color:${fg}">${label ? `${esc(label)}&nbsp; ` : ''}<b>${esc(value)}</b></span>`;
  const out = [chip('', STATUS[r.status] || r.status, r.status === 'done' ? C.leaf : C.sun, r.status === 'done' ? C.green : '#7a5410', r.status === 'done' ? 'fv-leaf' : 'fv-sun')];
  if (r.owner) out.push(chip('Owner', r.owner, C.bg, C.ink, 'fv-chip'));
  if (r.due_date) {
    const late = r.status !== 'done' && r.due_date < today;
    out.push(chip(late ? 'Late' : 'Due', dayWord(r.due_date), late ? '#f7dcd5' : C.bg, late ? C.red : C.ink, late ? 'fv-red' : 'fv-chip'));
  }
  if (r.waiting_on) out.push(chip('Waiting on', r.waiting_on, C.sun, '#7a5410', 'fv-sun'));
  return out.join('');
}

const HEAD: Record<MailKind, (m: NoticeMail) => { subject: string; line: string; pill: string }> = {
  sent: (m) => ({ subject: `${m.actor.name} sent you: ${m.request.title}`, line: `<b>${esc(m.actor.name)}</b> sent you a request`, pill: 'Sent to you' }),
  mention: (m) => ({ subject: `${m.actor.name} mentioned you: ${m.request.title}`, line: `<b>${esc(m.actor.name)}</b> mentioned you`, pill: 'Mention' }),
  comment: (m) => ({ subject: `${m.actor.name} commented: ${m.request.title}`, line: `<b>${esc(m.actor.name)}</b> commented on a request you follow`, pill: 'Comment' }),
  waiting: (m) => ({ subject: `Waiting on you: ${m.request.title}`, line: `<b>${esc(m.actor.name)}</b> marked this request waiting on you`, pill: 'Waiting on you' }),
  due: (m) => ({ subject: `Due ${m.dueWord || 'soon'}: ${m.request.title}`, line: `Your request is due <b>${esc(m.dueWord || 'soon')}</b>`, pill: `Due ${m.dueWord || 'soon'}` }),
  done: (m) => ({ subject: `Done: ${m.request.title}`, line: `<b>${esc(m.actor.name)}</b> marked this request done`, pill: 'Done' }),
};

const DARK = `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .fv-bg{background:#171a15!important}.fv-card{background:#20241d!important;border-color:#343a2f!important}
  .fv-ink{color:#f1eee4!important}.fv-ink2{color:#c9c5b8!important}.fv-ink3{color:#9c988b!important}
  .fv-note{background:#2a3024!important;color:#f1eee4!important}.fv-chip{background:#20241d!important;border-color:#454b3f!important;color:#f1eee4!important}.fv-sun,.fv-leaf,.fv-red{border-color:transparent!important}
  .fv-leaf{background:#2f4427!important;color:#cfe3c4!important}.fv-sun{background:#4a3c17!important;color:#f3dca0!important}
  .fv-red{background:#4a241c!important;color:#f3b6a8!important}.fv-line{border-color:#343a2f!important}
  .fv-btn{background:#3f7a35!important;color:#ffffff!important}.fv-link{color:#a9d39b!important}
}
@media (max-width:480px){.fv-pad{padding-left:20px!important;padding-right:20px!important}.fv-title{font-size:21px!important}}
</style>`;

export function shell(inner: string, preheader: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">${DARK}</head>` +
    `<body class="fv-bg" style="margin:0;padding:0;background:${C.bg}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-bg" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-card" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;border-collapse:separate">${inner}</table>` +
    `</td></tr></table></body></html>`
  );
}

export const brandRow = (pill: string, cls = 'fv-leaf', bg = C.leaf, fg = C.green, label = 'Favor Requests') =>
  `<tr><td class="fv-pad" style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="fv-ink3" style="font:600 13px/1 Arial,sans-serif;color:${C.ink3}"><img src="${LOGO}" alt="" width="28" height="24" style="vertical-align:middle;border:0" />&nbsp; ${esc(label)}</td>` +
  `<td align="right"><span class="${cls}" style="display:inline-block;padding:6px 12px;border-radius:999px;background:${bg};color:${fg};font:700 12px/1 Arial,sans-serif">${esc(pill)}</span></td></tr></table></td></tr>`;

const footRow = (text: string, prefs: string) =>
  `<tr><td class="fv-pad" style="padding:20px 28px 24px"><div class="fv-line fv-ink3" style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">${text} <a class="fv-link" href="${esc(prefs)}" style="color:${C.green}">Change how often</a></div></td></tr>`;

function entryRow(e: MailEntry): string {
  return (
    `<tr><td valign="top" width="28" style="padding:0 10px 10px 0">${face(e.who, 28)}</td><td valign="top" style="padding:0 0 10px">` +
    `<div class="fv-ink2" style="font:400 12.5px/1.3 Arial,sans-serif;color:${C.ink2}"><b class="fv-ink" style="color:${C.ink}">${esc(e.who.name)}</b>&nbsp; ${esc(timeWord(e.at))}</div>` +
    `<div class="fv-ink2" style="font:400 14px/1.5 Arial,sans-serif;color:${C.ink2};white-space:pre-line">${esc(clip(e.body, 280))}</div></td></tr>`
  );
}

/** One email for one event. */
export function buildNotice(m: NoticeMail): { subject: string; html: string; text: string } {
  const h = HEAD[m.kind](m);
  const l = linksFor(m.origin, m.request.id);
  const today = (m.now || new Date()).toLocaleDateString('en-CA', { timeZone: TZ });
  const earlier = (m.thread || []).slice(-2);
  const pillStyle = m.kind === 'waiting' || m.kind === 'due' ? (['fv-sun', C.sun, '#7a5410'] as const) : (['fv-leaf', C.leaf, C.green] as const);
  const note = m.note.trim();
  const open = m.request.status !== 'done' && m.request.status !== 'declined';
  const inner =
    brandRow(h.pill, pillStyle[0], pillStyle[1], pillStyle[2]) +
    `<tr><td class="fv-pad" style="padding:22px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="middle" style="padding:0 12px 0 0">${face(m.actor, 40)}</td>` +
    `<td valign="middle" class="fv-ink2" style="font:400 15px/1.4 Arial,sans-serif;color:${C.ink2}">${h.line.replace(/<b>/g, `<b class="fv-ink" style="color:${C.ink}">`)}</td></tr></table></td></tr>` +
    `<tr><td class="fv-pad" style="padding:14px 28px 0"><a href="${esc(l.open)}" class="fv-ink fv-title" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(m.request.title)}</a></td></tr>` +
    `<tr><td class="fv-pad" style="padding:14px 28px 0;font-size:0">${chips(m.request, today)}</td></tr>` +
    (note
      ? `<tr><td class="fv-pad" style="padding:10px 28px 0"><div class="fv-note" style="background:${C.bg};border-radius:14px;padding:14px 16px;font:400 15px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(clip(note, 1200))}</div></td></tr>`
      : '') +
    (earlier.length
      ? `<tr><td class="fv-pad" style="padding:18px 28px 0"><div class="fv-ink3" style="font:700 11px/1 Arial,sans-serif;letter-spacing:1.4px;color:${C.ink3};text-transform:uppercase;padding-bottom:10px">Earlier in the thread</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${earlier.map(entryRow).join('')}</table></td></tr>`
      : '') +
    `<tr><td class="fv-pad" style="padding:18px 28px 0"><a href="${esc(l.open)}" class="fv-btn" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">Open the request &rarr;</a></td></tr>` +
    `<tr><td class="fv-pad" align="center" style="padding:14px 28px 0;font:600 14px/1 Arial,sans-serif">${open ? `<a class="fv-link" href="${esc(l.done)}" style="color:${C.green};text-decoration:none">Mark done</a><span class="fv-ink3" style="color:${C.ink3}">&nbsp; &middot; &nbsp;</span>` : ''}<a class="fv-link" href="${esc(l.reply)}" style="color:${C.green};text-decoration:none">Reply</a></td></tr>` +
    footRow(`Sent to ${esc(m.to.name || m.to.email)} because you are on this request.`, l.prefs);
  const text = [
    h.line.replace(/<[^>]+>/g, ''),
    m.request.title,
    [STATUS[m.request.status] || m.request.status, m.request.owner ? `Owner ${m.request.owner}` : '', m.request.due_date ? `Due ${dayWord(m.request.due_date)}` : '', m.request.waiting_on ? `Waiting on ${m.request.waiting_on}` : ''].filter(Boolean).join(' · '),
    ...(note ? ['', note] : []),
    ...(earlier.length ? ['', 'Earlier in the thread', ...earlier.map((e) => `${e.who.name}: ${clip(e.body, 280)}`)] : []),
    '',
    `Open the request: ${l.open}`,
    ...(open ? [`Mark done: ${l.done}`] : []),
    `Reply: ${l.reply}`,
    '',
    `Change how often: ${l.prefs}`,
  ].join('\n');
  return { subject: clip(h.subject, 140), html: shell(inner, note ? clip(note, 110) : m.request.title), text };
}

export interface SummaryGroup {
  request: MailRequest;
  items: Array<{ kind: MailKind; actor: MailPerson; note: string; at: string; dueWord?: string }>;
}

const SUMMARY_WORD: Record<MailKind, string> = { sent: 'sent it to you', mention: 'mentioned you', comment: 'commented', waiting: 'marked it waiting on you', due: 'It is due', done: 'marked it done' };

/** The daily summary: everything new since the last one, grouped by request, newest request first. */
export function buildSummary(s: { to: { name: string; email: string }; groups: SummaryGroup[]; origin: string; now?: Date }): { subject: string; html: string; text: string } {
  const today = (s.now || new Date()).toLocaleDateString('en-CA', { timeZone: TZ });
  const n = s.groups.length;
  const items = s.groups.reduce((t, g) => t + g.items.length, 0);
  const subject = n === 1 ? `Requests: ${s.groups[0]!.request.title}` : `Requests: ${n} with news for you`;
  const prefs = linksFor(s.origin, 'x').prefs;
  const group = (g: SummaryGroup) => {
    const l = linksFor(s.origin, g.request.id);
    const lines = g.items
      .map((i) => {
        const what = i.kind === 'due' ? `It is due <b>${esc(i.dueWord || 'soon')}</b>` : `<b class="fv-ink" style="color:${C.ink}">${esc(i.actor.name)}</b> ${SUMMARY_WORD[i.kind]}`;
        return (
          `<tr><td valign="top" width="28" style="padding:0 10px 10px 0">${face(i.actor, 28)}</td><td valign="top" style="padding:0 0 10px">` +
          `<div class="fv-ink2" style="font:400 13.5px/1.4 Arial,sans-serif;color:${C.ink2}">${what}<span class="fv-ink3" style="color:${C.ink3}">&nbsp; ${esc(timeWord(i.at))}</span></div>` +
          (i.note.trim() ? `<div class="fv-ink2" style="font:400 14px/1.5 Arial,sans-serif;color:${C.ink2};white-space:pre-line">${esc(clip(i.note.trim(), 240))}</div>` : '') +
          `</td></tr>`
        );
      })
      .join('');
    return (
      `<tr><td class="fv-pad" style="padding:18px 28px 0"><div class="fv-note" style="background:${C.bg};border-radius:16px;padding:16px 16px 6px">` +
      `<a href="${esc(l.open)}" class="fv-ink" style="font:400 19px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(g.request.title)}</a>` +
      `<div style="padding:10px 0 4px;font-size:0">${chips(g.request, today)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}</table>` +
      `<div style="padding:0 0 10px;font:600 13.5px/1 Arial,sans-serif"><a class="fv-link" href="${esc(l.open)}" style="color:${C.green};text-decoration:none">Open &rarr;</a><span class="fv-ink3" style="color:${C.ink3}">&nbsp; &middot; &nbsp;</span><a class="fv-link" href="${esc(l.reply)}" style="color:${C.green};text-decoration:none">Reply</a></div>` +
      `</div></td></tr>`
    );
  };
  const inner =
    brandRow('Daily summary') +
    `<tr><td class="fv-pad" style="padding:22px 28px 0"><div class="fv-ink fv-title" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">Good morning, ${esc(first(s.to.name))}</div>` +
    `<div class="fv-ink2" style="padding-top:6px;font:400 14px/1.45 Arial,sans-serif;color:${C.ink2}">${items} ${items === 1 ? 'update' : 'updates'} on ${n} ${n === 1 ? 'request' : 'requests'} since your last summary.</div></td></tr>` +
    s.groups.map(group).join('') +
    `<tr><td class="fv-pad" style="padding:18px 28px 0"><a href="${esc(s.origin.replace(/\/$/, ''))}/requests/?view=new" class="fv-btn" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">Open the request board &rarr;</a></td></tr>` +
    footRow(`Sent to ${esc(s.to.name || s.to.email)} each weekday morning there is something new.`, prefs);
  const text = [
    `Good morning, ${first(s.to.name)}. ${items} ${items === 1 ? 'update' : 'updates'} on ${n} ${n === 1 ? 'request' : 'requests'}.`,
    ...s.groups.flatMap((g) => ['', g.request.title, ...g.items.map((i) => `  ${i.kind === 'due' ? `It is due ${i.dueWord || 'soon'}` : `${i.actor.name} ${SUMMARY_WORD[i.kind]}`}${i.note.trim() ? `: ${clip(i.note.trim(), 200)}` : ''}`), `  Open: ${linksFor(s.origin, g.request.id).open}`]),
    '',
    `Change how often: ${prefs}`,
  ].join('\n');
  return { subject: clip(subject, 140), html: shell(inner, `${items} ${items === 1 ? 'update' : 'updates'} on ${n} ${n === 1 ? 'request' : 'requests'}`), text };
}
