// Learn reminders by email, in the same card design as the request board's email (functions/_lib/requests/email.ts): one card, the
// person who assigned it, the course, where it stands as chips, one Open button. One item reads as a notice; several read as one
// summary. Pure functions: nothing here reads a database or sends anything, so tests and the preview render them directly.

export type LearnKind = 'assigned' | 'due_soon' | 'due_today' | 'overdue';

export interface LearnItem {
  kind: LearnKind;
  title: string;
  /** Path or course, for the chip. */
  what: 'course' | 'path';
  due_date: string | null;
  minutes: number;
  lessons: number;
  href: string;
  note: string;
  actor: string;
  at: string;
}

const ORIGIN = 'https://dash.favorintl.org';
const LOGO = `${ORIGIN}/images/favor-icon.png`;
const C = { bg: '#f4efe0', card: '#fffdf8', ink: '#1d211b', ink2: '#57534a', ink3: '#8a8578', line: '#e7e0cf', green: '#2b4d24', leaf: '#e6efdc', sun: '#fbe9c6', red: '#b3412b' };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || 'there';
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '...' : s);
const dayWord = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const abs = (href: string) => (/^https?:/.test(href) ? href : ORIGIN + href);

const PILL: Record<LearnKind, string> = { assigned: 'Assigned to you', due_soon: 'Due soon', due_today: 'Due today', overdue: 'Past due' };
const LINE: Record<LearnKind, (i: LearnItem) => string> = {
  assigned: (i) => (i.actor ? `<b>${esc(i.actor)}</b> gave you a ${i.what} to finish` : `A ${i.what} was given to you`),
  due_soon: (i) => `Your ${i.what} is due <b>${esc(i.due_date ? dayWord(i.due_date) : 'soon')}</b>`,
  due_today: () => 'Your learning is due <b>today</b>',
  overdue: (i) => `Your ${i.what} was due <b>${esc(i.due_date ? dayWord(i.due_date) : 'earlier')}</b>`,
};
const plainLine = (i: LearnItem) => LINE[i.kind](i).replace(/<[^>]+>/g, '');

const DARK = `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
  .fv-bg{background:#171a15!important}.fv-card{background:#20241d!important;border-color:#343a2f!important}
  .fv-ink{color:#f1eee4!important}.fv-ink2{color:#c9c5b8!important}.fv-ink3{color:#9c988b!important}
  .fv-note{background:#2a3024!important;color:#f1eee4!important}.fv-chip{background:#20241d!important;border-color:#454b3f!important;color:#f1eee4!important}
  .fv-leaf{background:#2f4427!important;color:#cfe3c4!important}.fv-sun{background:#4a3c17!important;color:#f3dca0!important}.fv-red{background:#4a241c!important;color:#f3b6a8!important}
  .fv-line{border-color:#343a2f!important}.fv-btn{background:#3f7a35!important;color:#ffffff!important}.fv-link{color:#a9d39b!important}
}
@media (max-width:480px){.fv-pad{padding-left:20px!important;padding-right:20px!important}.fv-title{font-size:21px!important}}
</style>`;

function shell(inner: string, preheader: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">${DARK}</head>` +
    `<body class="fv-bg" style="margin:0;padding:0;background:${C.bg}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-bg" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fv-card" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:24px;border-collapse:separate">${inner}</table>` +
    `</td></tr></table></body></html>`
  );
}

const brandRow = (pill: string, warn = false) =>
  `<tr><td class="fv-pad" style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="fv-ink3" style="font:600 13px/1 Arial,sans-serif;color:${C.ink3}"><img src="${LOGO}" alt="" width="28" height="24" style="vertical-align:middle;border:0" />&nbsp; FavorOS Learn</td>` +
  `<td align="right"><span class="${warn ? 'fv-sun' : 'fv-leaf'}" style="display:inline-block;padding:6px 12px;border-radius:999px;background:${warn ? C.sun : C.leaf};color:${warn ? '#7a5410' : C.green};font:700 12px/1 Arial,sans-serif">${esc(pill)}</span></td></tr></table></td></tr>`;

const footRow = (text: string) =>
  `<tr><td class="fv-pad" style="padding:20px 28px 24px"><div class="fv-line fv-ink3" style="border-top:1px solid ${C.line};padding-top:14px;font:400 12.5px/1.6 Arial,sans-serif;color:${C.ink3}">${text} <a class="fv-link" href="${ORIGIN}/requests/?notices=1" style="color:${C.green}">Change how often</a></div></td></tr>`;

function chips(i: LearnItem, todayYmd: string): string {
  const chip = (label: string, value: string, bg: string, fg: string, cls: string) =>
    `<span class="${cls}" style="display:inline-block;white-space:nowrap;margin:0 6px 6px 0;padding:6px 11px;border-radius:999px;border:1px solid ${cls === 'fv-chip' ? C.line : bg};background:${cls === 'fv-chip' ? C.card : bg};font:400 13px/1.2 Arial,sans-serif;color:${fg}">${label ? `${esc(label)}&nbsp; ` : ''}<b>${esc(value)}</b></span>`;
  const out: string[] = [chip('', i.what === 'path' ? 'Learning path' : 'Course', C.leaf, C.green, 'fv-leaf')];
  if (i.due_date) {
    const late = i.due_date < todayYmd;
    out.push(chip(late ? 'Late' : 'Due', dayWord(i.due_date), late ? '#f7dcd5' : C.bg, late ? C.red : C.ink, late ? 'fv-red' : 'fv-chip'));
  }
  if (i.lessons) out.push(chip('', `${i.lessons} ${i.lessons === 1 ? 'lesson' : 'lessons'}`, C.bg, C.ink, 'fv-chip'));
  if (i.minutes) out.push(chip('', `about ${i.minutes} min`, C.bg, C.ink, 'fv-chip'));
  return out.join('');
}

export interface LearnMail {
  to: { name: string; email: string };
  items: LearnItem[];
  now?: Date;
}

/** One email: a notice for one item, a summary for several. */
export function buildLearnMail(m: LearnMail): { subject: string; html: string; text: string } {
  const todayYmd = (m.now || new Date()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const items = m.items;
  if (!items.length) throw new Error('nothing to send');
  const warn = items.some((i) => i.kind === 'overdue' || i.kind === 'due_today' || i.kind === 'due_soon');
  if (items.length === 1) {
    const i = items[0]!;
    const href = abs(i.href);
    const inner =
      brandRow(PILL[i.kind], i.kind !== 'assigned') +
      `<tr><td class="fv-pad" style="padding:22px 28px 0"><div class="fv-ink2" style="font:400 15px/1.4 Arial,sans-serif;color:${C.ink2}">${LINE[i.kind](i).replace(/<b>/g, `<b class="fv-ink" style="color:${C.ink}">`)}</div></td></tr>` +
      `<tr><td class="fv-pad" style="padding:12px 28px 0"><a href="${esc(href)}" class="fv-ink fv-title" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(i.title)}</a></td></tr>` +
      `<tr><td class="fv-pad" style="padding:14px 28px 0;font-size:0">${chips(i, todayYmd)}</td></tr>` +
      (i.note.trim() ? `<tr><td class="fv-pad" style="padding:10px 28px 0"><div class="fv-note" style="background:${C.bg};border-radius:14px;padding:14px 16px;font:400 15px/1.55 Arial,sans-serif;color:${C.ink};white-space:pre-line">${esc(clip(i.note.trim(), 600))}</div></td></tr>` : '') +
      `<tr><td class="fv-pad" style="padding:18px 28px 0"><a href="${esc(href)}" class="fv-btn" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">${i.kind === 'assigned' ? 'Start learning' : 'Keep going'} &rarr;</a></td></tr>` +
      footRow(`Sent to ${esc(m.to.name || m.to.email)} because learning was assigned to you.`);
    const text = [plainLine(i), i.title, [i.what === 'path' ? 'Learning path' : 'Course', i.due_date ? `Due ${dayWord(i.due_date)}` : '', i.minutes ? `about ${i.minutes} min` : ''].filter(Boolean).join(' · '), ...(i.note.trim() ? ['', i.note.trim()] : []), '', `Open it: ${href}`, '', `Change how often: ${ORIGIN}/requests/?notices=1`].join('\n');
    const subject = i.kind === 'assigned' ? `${i.actor ? i.actor + ' assigned you' : 'Assigned to you'}: ${i.title}` : `${PILL[i.kind]}: ${i.title}`;
    return { subject: clip(subject, 140), html: shell(inner, i.note.trim() ? clip(i.note.trim(), 110) : i.title), text };
  }
  const n = items.length;
  const group = (i: LearnItem) =>
    `<tr><td class="fv-pad" style="padding:14px 28px 0"><div class="fv-note" style="background:${C.bg};border-radius:16px;padding:16px 16px 8px">` +
    `<a href="${esc(abs(i.href))}" class="fv-ink" style="font:400 19px/1.3 Georgia,'Times New Roman',serif;color:${C.ink};text-decoration:none">${esc(i.title)}</a>` +
    `<div class="fv-ink2" style="padding:6px 0 0;font:400 13.5px/1.4 Arial,sans-serif;color:${C.ink2}">${LINE[i.kind](i).replace(/<b>/g, `<b class="fv-ink" style="color:${C.ink}">`)}</div>` +
    `<div style="padding:10px 0 4px;font-size:0">${chips(i, todayYmd)}</div></div></td></tr>`;
  const inner =
    brandRow(warn ? 'Learning reminders' : 'Assigned to you', warn) +
    `<tr><td class="fv-pad" style="padding:22px 28px 0"><div class="fv-ink fv-title" style="font:400 24px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">Good morning, ${esc(first(m.to.name))}</div>` +
    `<div class="fv-ink2" style="padding-top:6px;font:400 14px/1.45 Arial,sans-serif;color:${C.ink2}">${n} things to finish in Learn.</div></td></tr>` +
    items.map(group).join('') +
    `<tr><td class="fv-pad" style="padding:18px 28px 0"><a href="${ORIGIN}/learn/" class="fv-btn" style="display:block;text-align:center;padding:16px 20px;border-radius:16px;background:${C.green};color:#ffffff;font:700 16px/1 Arial,sans-serif;text-decoration:none">Open My learning &rarr;</a></td></tr>` +
    footRow(`Sent to ${esc(m.to.name || m.to.email)} because learning was assigned to you.`);
  const text = [`Good morning, ${first(m.to.name)}. ${n} things to finish in Learn.`, ...items.flatMap((i) => ['', i.title, `  ${plainLine(i)}`, `  Open: ${abs(i.href)}`]), '', `My learning: ${ORIGIN}/learn/`, '', `Change how often: ${ORIGIN}/requests/?notices=1`].join('\n');
  return { subject: `Learn: ${n} things to finish`, html: shell(inner, `${n} things to finish in Learn`), text };
}
