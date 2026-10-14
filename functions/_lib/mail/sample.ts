// The sample mailbox for the FavorOS test users (functions/_lib/testuser.ts). Mail's routes run for real against this stand-in
// for Gmail: the same calls, answered from invented messages kept in D1 (hub_sample_mail), so reading, searching, labels,
// archive, trash, snooze, drafts and sending all work and nothing leaves FavorOS. Every name, address and message here is made up.
import type { Env } from '../http';
import { nowIso } from '../http';
import { b64ToBytes } from './mime';

type Fetcher = typeof fetch;

export const SAMPLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/contacts.readonly',
].join(' ');
export const SAMPLE_TOKEN = { token: 'sample-mailbox', scopes: SAMPLE_SCOPES };

const b64u = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => {
  try {
    const std = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    return new TextDecoder().decode(b64ToBytes(std + '='.repeat((4 - (std.length % 4)) % 4)));
  } catch {
    return '';
  }
};

interface P {
  name: string;
  email: string;
}
const people: P[] = [
  { name: 'Maya Okafor', email: 'maya.okafor@example.org' },
  { name: 'Tom Whitfield', email: 'tom@whitfieldfamily.example' },
  { name: 'Grace Lin', email: 'grace@favorintl.org' },
  { name: 'Riverbend Church', email: 'office@riverbend.example' },
  { name: 'Daniel Ortiz', email: 'dortiz@example.com' },
  { name: 'Hope Foundation Grants', email: 'grants@hopefoundation.example' },
  { name: 'Priya Nair', email: 'priya@favorintl.org' },
  { name: 'Blue Heron Printing', email: 'orders@blueheron.example' },
  { name: 'Calendar', email: 'calendar@example.com' },
  { name: 'Lena Brooks', email: 'lena.brooks@example.net' },
];
export const SAMPLE_PARTNER_EMAILS = [people[0].email, people[1].email, people[4].email];

const tinyPdf = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9GCg==';
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface MsgDef {
  from: P;
  to: P[];
  cc?: P[];
  hours: number;
  html: string;
  labels?: string[];
  files?: Array<'pdf' | 'png'>;
  unread?: boolean;
  starred?: boolean;
}
interface ThreadDef {
  id: string;
  subject: string;
  msgs: MsgDef[];
  labels?: string[];
}

const ME: P = { name: 'FavorOS Tester', email: 'tester@favorintl.org' };
const SIG_IMG = 'https://dash.favorintl.org/images/favor-icon.png';
const sigBlock = (name: string, title: string, phone: string, email: string) =>
  `<div class="gmail_signature"><table cellpadding="0" cellspacing="0" style="font-family:Georgia,serif"><tr><td style="padding-right:14px;vertical-align:top"><img src="${SIG_IMG}" width="88" height="88" alt="Favor International" style="display:block"></td><td style="border-left:3px solid #1a9c3e;padding-left:12px;vertical-align:top"><div style="font-size:22px">${name}</div><div style="font-size:13px;margin-top:6px">Favor International | <i>${title}</i></div><div style="font-size:13px;margin-top:6px">P: ${phone}</div><div style="font-size:13px;margin-top:4px">E: <a href="mailto:${email}">${email}</a></div></td></tr></table></div>`;
const SIG_TESTER = sigBlock('FavorOS Tester', 'Test Account', '(555) 010-0101', 'tester@favorintl.org');
const SIG_PRIYA = sigBlock('Priya Nair', 'Program Associate', '(555) 010-0144', 'priya@favorintl.org');
const LONG_REPORT = [
  'I went through the church plant numbers with the field team. The 22 churches listed under the first and second levels are not in our totals because they are daughter and granddaughter churches.',
  'Their note: "Churches Dedicated gives the right number for this quarter\'s church plants, while the total number of churches is the all-time total. Each church is asked to plant a daughter church after three years, so the first and second levels are daughter and granddaughter churches. The church plant category counts only our own plants, so the daughter and granddaughter churches are separate."',
  'For <b>Primary Schools</b>, I added the totals for Number Boarding and Number Day School, which come to 1,090 (I first entered 1,092). That differs from the combined boys and girls total of 1,104. In <b>Secondary Schools</b> the totals match. I will follow up with the school office about the primary school difference.',
  'For <b>Women Empowerment</b>, I will change the line to read "Women Beginning Businesses" so it matches the program name in the field report.',
  'For <b>Water</b>, the borehole count is 14 for the quarter. Two of those were repairs, not new wells, so the new-well number is 12. I listed both in the notes column so the board can see the difference.',
  'For <b>Health</b>, the clinic visits came in late. The number I have is 3,412 visits, but the clinic said a final count arrives Friday. I left a placeholder in the sheet and marked it in yellow.',
  'For <b>Discipleship</b>, the seven lines from the footnote add to 2,960. That matches what we published last quarter in method, so the comparison holds.',
  'Last item: the photos for the report are in the shared folder under Quarter Report, Photos. I picked twelve; tell me if you want a different cover.',
  'Thanks for checking these before it goes out.',
].map((p) => `<p>${p}</p>`).join('');

const q = (who: string, text: string) => `<div class="gmail_quote"><div>On Thu, ${who} wrote:</div><blockquote class="gmail_quote">${text}</blockquote></div>`;

function base(): ThreadDef[] {
  const t: ThreadDef[] = [
    {
      id: 'smp001', subject: 'Visiting in March',
      msgs: [
        { from: people[0], to: [ME], hours: 30, html: '<p>Hi,</p><p>Our family would love to visit the school in March. Is the second week still open?</p><p>Maya</p>' },
        { from: ME, to: [people[0]], hours: 26, html: '<p>Hi Maya, yes, the second week is open. I will send the itinerary.</p>' + q('Maya Okafor', 'Our family would love to visit the school in March.'), labels: ['SENT'] },
        { from: people[0], to: [ME], hours: 1.2, html: '<p>Wonderful. Here is the draft itinerary we talked about.</p><p>Could you confirm the dates by Friday? Our last gift went to appeal N26A-EMW2, for the Clean Water Fund.</p><p>Maya</p>' + q('Tester', 'Yes, the second week is open.'), unread: true, files: ['pdf', 'png'] },
      ],
    },
    { id: 'smp002', subject: 'Thank you for the update letter', msgs: [{ from: people[1], to: [ME], hours: 3, html: '<p>The update letter arrived yesterday. We read it at dinner and the kids had questions about the new well.</p><p>We would like to help with the next one. What does one cost?</p><p>Tom</p>', unread: true }] },
    { id: 'smp003', subject: 'Sunday missions moment', msgs: [{ from: people[3], to: [ME, people[2]], cc: [people[6]], hours: 6, html: '<p>Good morning. We have five minutes for a missions moment on the 19th. Could someone from Favor share?</p><p>Riverbend Church office</p>', unread: true }] },
    { id: 'smp004', subject: 'Grant report due November 1', msgs: [{ from: people[5], to: [ME], hours: 9, html: '<p>This is a reminder that the interim report for the education grant is due November 1. Please upload it in the portal.</p>', starred: true }] },
    {
      id: 'smp005', subject: 'Lunch Thursday?',
      msgs: [
        { from: people[2], to: [ME], hours: 12, html: '<p>Are you free Thursday at noon? I want to go over the newsletter plan.</p>' },
        { from: ME, to: [people[2]], hours: 11, html: '<p>Thursday works.</p>', labels: ['SENT'] },
        { from: people[2], to: [ME], hours: 10.5, html: '<p>Great, see you then.</p>' },
      ],
    },
    { id: 'smp006', subject: 'Proof ready: fall mailer', labels: ['CATEGORY_PROMOTIONS'], msgs: [{ from: people[7], to: [ME], hours: 20, html: '<table width="600" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;border:1px solid #ddd"><tr><td style="background:#235578;color:#fff;padding:18px 24px;font-size:20px">Blue Heron Printing</td></tr><tr><td style="padding:24px"><p>Your proof for the fall mailer is ready to review.</p><p>Order 20418, 2,400 pieces, 6 x 9 postcard.</p></td></tr></table>' }] },
    { id: 'smp007', subject: 'Receipt question', msgs: [{ from: people[4], to: [ME], hours: 27, html: '<p>Hello, I gave in September and have not seen a receipt. Could you check?</p><p>Daniel</p>' }] },
    { id: 'smp008', subject: 'Invitation: Team prayer, Monday 9:00 AM', labels: ['CATEGORY_UPDATES'], msgs: [{ from: people[8], to: [ME], hours: 31, html: '<p>Team prayer, Monday 9:00 AM, conference room.</p>' }] },
    { id: 'smp009', subject: 'Photos from the banquet', msgs: [{ from: people[9], to: [ME], hours: 50, html: '<p>What a night. A few photos attached.</p>', files: ['png'] }] },
    { id: 'smp010', subject: 'Re: Matching gift form', msgs: [{ from: people[1], to: [ME], hours: 75, html: '<p>Signed and attached. Thanks for sending it.</p>', files: ['pdf'] }] },
    { id: 'smp011', subject: 'Newsletter draft for review', msgs: [{ from: people[6], to: [ME], hours: 98, html: '<p>Draft is in the shared folder. Edits by Wednesday, please.</p>' }] },
    { id: 'smp012', subject: 'Welcome packet address', msgs: [{ from: people[9], to: [ME], hours: 120, html: '<p>We moved in August. New address is 14 Larkspur Lane.</p>' }] },
    // A long staff thread with an image signature: the reading pane, the inline reply and the quoted text are checked against it.
    {
      id: 'smpQ01', subject: 'Quarter report numbers',
      msgs: [
        { from: ME, to: [people[6]], hours: 8, html: '<p>Priya, can you check the school and church numbers before the report goes out?</p>' + SIG_TESTER, labels: ['SENT'] },
        { from: people[6], to: [ME], hours: 2, html: LONG_REPORT + SIG_PRIYA + q('Tester', 'Priya, can you check the school and church numbers before the report goes out?'), unread: true },
      ],
    },
    { id: 'smp090', subject: 'Itinerary sent', labels: ['SENT'], msgs: [{ from: ME, to: [people[1]], hours: 40, html: '<p>The itinerary is attached.</p>', labels: ['SENT'], files: ['pdf'] }] },
  ];
  const subjects = ['Volunteer schedule', 'Prayer request', 'Board packet', 'Trip deposit', 'Sponsor a student', 'Chapel visit', 'Year-end letter'];
  for (let i = 0; i < 14; i++) t.push({ id: 'smp1' + String(i).padStart(2, '0'), subject: subjects[i % 7] + ' ' + (i + 1), msgs: [{ from: people[(i * 3) % people.length], to: [ME], hours: 140 + i * 9, html: '<p>Following up on this. Let me know what you think.</p>' }] });
  return t;
}

export interface SampleState {
  mods: Record<string, { add: string[]; remove: string[] }>;
  extra: ThreadDef[];
  labels: Array<{ id: string; name: string }>;
  seq: number;
}
const fresh = (): SampleState => ({ mods: {}, extra: [], labels: [{ id: 'Label_1', name: 'Partners' }, { id: 'Label_2', name: 'Trips' }, { id: 'Label_3', name: 'Receipts to check' }], seq: 0 });

async function load(env: Pick<Env, 'DB'>, owner: string): Promise<SampleState> {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS hub_sample_mail (owner TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)').run().catch(() => undefined);
  const row = await env.DB.prepare('SELECT data FROM hub_sample_mail WHERE owner = ?').bind(owner).first<{ data: string }>().catch(() => null);
  if (!row) return fresh();
  try {
    return { ...fresh(), ...(JSON.parse(row.data) as SampleState) };
  } catch {
    return fresh();
  }
}
async function save(env: Pick<Env, 'DB'>, owner: string, s: SampleState): Promise<void> {
  await env.DB.prepare('INSERT INTO hub_sample_mail (owner, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(owner, JSON.stringify(s), nowIso()).run();
}
/** Puts the sample mailbox back as it was first made. */
export async function resetSample(env: Pick<Env, 'DB'>, owner: string): Promise<void> {
  await env.DB.prepare('DELETE FROM hub_sample_mail WHERE owner = ?').bind(owner).run().catch(() => undefined);
}

const hdr = (name: string, value: string) => ({ name, value });
const addr = (p: P) => `${p.name} <${p.email}>`;

function build(owner: string, s: SampleState): any[] {
  const now = Date.now();
  const defs = [...base(), ...s.extra];
  return defs.map((d) => {
    const mod = s.mods[d.id] || { add: [], remove: [] };
    const messages = d.msgs.map((m, i) => {
      let labels = new Set<string>(m.labels || ['INBOX']);
      if (!m.labels && d.labels) for (const l of d.labels) labels.add(l);
      if (m.unread) labels.add('UNREAD');
      if (m.starred) labels.add('STARRED');
      if (m.labels?.includes('SENT') && !m.labels.includes('INBOX')) labels.delete('INBOX');
      if (m.labels?.includes('DRAFT')) labels = new Set(['DRAFT']);
      for (const l of mod.add) labels.add(l);
      for (const l of mod.remove) labels.delete(l);
      const id = `${d.id}m${i + 1}`;
      const parts: any[] = [{ mimeType: 'text/html', body: { data: b64u(m.html) } }];
      for (const f of m.files || []) parts.push({ mimeType: f === 'pdf' ? 'application/pdf' : 'image/png', filename: f === 'pdf' ? 'Spring trip itinerary.pdf' : 'Village well.png', headers: [hdr('Content-Disposition', 'attachment')], body: { attachmentId: 'ATT' + f + id, size: 4096 } });
      return {
        id, threadId: d.id, labelIds: [...labels], snippet: m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140),
        internalDate: String(Math.round(now - m.hours * 3600e3)),
        payload: { mimeType: parts.length > 1 ? 'multipart/mixed' : 'text/html', headers: [hdr('From', addr(m.from)), hdr('To', m.to.map(addr).join(', ')), ...(m.cc ? [hdr('Cc', m.cc.map(addr).join(', '))] : []), hdr('Subject', i === 0 ? d.subject : 'Re: ' + d.subject), hdr('Date', new Date(now - m.hours * 3600e3).toUTCString()), hdr('Message-ID', `<${id}@sample.favor>`)], parts: parts.length > 1 ? parts : undefined, body: parts.length > 1 ? {} : parts[0].body },
      };
    });
    return { id: d.id, historyId: String(1000 + Object.keys(s.mods).length + s.seq), messages, owner };
  });
}

const last = (t: any) => Math.max(...t.messages.map((m: any) => Number(m.internalDate)));
const labelsOf = (t: any) => new Set<string>(t.messages.flatMap((m: any) => m.labelIds));

function matches(t: any, query: string): boolean {
  const labels = labelsOf(t);
  const text = (t.messages as any[]).map((m) => m.payload.headers.map((h: any) => h.value).join(' ') + ' ' + m.snippet).join(' ').toLowerCase();
  const from = (t.messages as any[]).map((m) => String(m.payload.headers.find((h: any) => h.name === 'From')?.value || '').toLowerCase()).join(' ');
  const to = (t.messages as any[]).map((m) => String(m.payload.headers.find((h: any) => h.name === 'To')?.value || '').toLowerCase()).join(' ');
  const subject = String(t.messages[0].payload.headers.find((h: any) => h.name === 'Subject')?.value || '').toLowerCase();
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const [k, ...rest] = raw.split(':');
    const v = rest.join(':');
    if (!v) { if (!text.includes(raw)) return false; continue; }
    if (k === 'in' && v === 'inbox') { if (!labels.has('INBOX')) return false; continue; }
    if (k === 'is' && v === 'unread') { if (!labels.has('UNREAD')) return false; continue; }
    if (k === 'is' && v === 'starred') { if (!labels.has('STARRED')) return false; continue; }
    if (k === 'has' && v === 'attachment') { if (!(t.messages as any[]).some((m) => (m.payload.parts || []).some((p: any) => p.filename))) return false; continue; }
    if (k === 'category') { if (v === 'primary') { if ([...labels].some((l) => l.startsWith('CATEGORY_'))) return false; } else if (!labels.has('CATEGORY_' + v.toUpperCase())) return false; continue; }
    if (k === 'from') { if (!from.includes(v)) return false; continue; }
    if (k === 'to') { if (!to.includes(v)) return false; continue; }
    if (k === 'subject') { if (!subject.includes(v)) return false; continue; }
    if (k === 'label') { if (![...labels].some((l) => l.toLowerCase() === v)) return false; continue; }
    if (k === 'newer_than' || k === 'older_than' || k === 'after' || k === 'before') continue;
    if (!text.includes(raw)) return false;
  }
  return true;
}

/** A Gmail stand-in for one test user. Changes are saved to D1 at the end of each call. */
export function sampleFetcher(env: Pick<Env, 'DB'>, owner: string): Fetcher {
  return (async (input: any, init: any = {}) => {
    const u = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body && typeof init.body === 'string' && init.body[0] === '{' ? JSON.parse(init.body) : null;
    const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.hostname === 'people.googleapis.com') return J({ results: people.map((p) => ({ person: { names: [{ displayName: p.name }], emailAddresses: [{ value: p.email }] } })) });
    if (u.hostname !== 'gmail.googleapis.com') return J({ error: { code: 404, message: 'not the sample mailbox' } }, 404);
    if (u.pathname.startsWith('/batch/')) return J({ error: { code: 400, message: 'batch not offered' } }, 400);
    const p = u.pathname.replace('/gmail/v1/users/me', '');
    const s = await load(env, owner);
    const threads = build(owner, s);
    const by = new Map(threads.map((t) => [t.id, t]));
    const systemLabels = ['INBOX', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD'];
    if (p === '/profile') return J({ emailAddress: owner, historyId: String(1000 + s.seq) });
    if (p === '/history') return J({ error: { code: 404, message: 'start over' } }, 404);
    if (p === '/settings/sendAs') return J({ sendAs: [{ sendAsEmail: owner, displayName: owner === 'tester2@favorintl.org' ? 'FavorOS Tester Two' : 'FavorOS Tester', isDefault: true, signature: SIG_TESTER }] });
    if (p === '/labels' && method === 'GET') return J({ labels: [...systemLabels.filter((l) => l !== 'UNREAD').map((id) => ({ id, name: id, type: 'system' })), ...s.labels.map((l) => ({ id: l.id, name: l.name, type: 'user' }))] });
    if (p === '/labels' && method === 'POST') {
      const id = 'Label_' + (s.labels.length + 4 + s.seq);
      s.labels.push({ id, name: String(body?.name || 'Label') });
      s.seq++;
      await save(env, owner, s);
      return J({ id, name: body?.name });
    }
    const lab = p.match(/^\/labels\/([^/]+)$/);
    if (lab) {
      const id = decodeURIComponent(lab[1]);
      const inL = threads.filter((t) => (id === 'ALL' ? true : labelsOf(t).has(id)));
      return J({ id, threadsTotal: inL.length, threadsUnread: inL.filter((t) => labelsOf(t).has('UNREAD')).length });
    }
    if (p === '/threads' && method === 'GET') {
      const label = u.searchParams.get('labelIds') || '';
      const query = u.searchParams.get('q') || '';
      const spam = u.searchParams.get('includeSpamTrash') === 'true';
      let list = threads.filter((t) => {
        const l = labelsOf(t);
        if (!spam && (l.has('TRASH') || l.has('SPAM'))) return false;
        if (label && !l.has(label)) return false;
        return matches(t, query);
      });
      list.sort((a, b) => last(b) - last(a));
      const from = Number((u.searchParams.get('pageToken') || 'n:0').replace('n:', '')) || 0;
      const max = Number(u.searchParams.get('maxResults')) || 20;
      const page = list.slice(from, from + max);
      return J({ threads: page.map((t) => ({ id: t.id, historyId: t.historyId, snippet: t.messages[t.messages.length - 1].snippet })), nextPageToken: from + max < list.length ? 'n:' + (from + max) : undefined, resultSizeEstimate: list.length });
    }
    const tm = p.match(/^\/threads\/([^/]+)(?:\/(modify|trash|untrash))?$/);
    if (tm) {
      const t = by.get(tm[1]);
      if (!t) return J({ error: { code: 404, message: 'Not found' } }, 404);
      if (tm[2]) {
        const cur = s.mods[t.id] || { add: [], remove: [] };
        const add = tm[2] === 'modify' ? (body?.addLabelIds as string[]) || [] : tm[2] === 'trash' ? ['TRASH'] : [];
        const rem = tm[2] === 'modify' ? (body?.removeLabelIds as string[]) || [] : tm[2] === 'trash' ? ['INBOX'] : ['TRASH'];
        for (const l of add) { cur.remove = cur.remove.filter((x) => x !== l); if (!cur.add.includes(l)) cur.add.push(l); }
        for (const l of rem) { cur.add = cur.add.filter((x) => x !== l); if (!cur.remove.includes(l)) cur.remove.push(l); }
        s.mods[t.id] = cur;
        s.seq++;
        await save(env, owner, s);
        return J(build(owner, s).find((x) => x.id === t.id));
      }
      const fmt = u.searchParams.get('format') || 'full';
      if (fmt === 'metadata') return J({ ...t, messages: t.messages.map((m: any) => ({ ...m, payload: { mimeType: m.payload.mimeType, headers: m.payload.headers } })) });
      if (fmt === 'minimal') return J({ ...t, messages: t.messages.map((m: any) => ({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.snippet, internalDate: m.internalDate })) });
      return J(t);
    }
    const att = p.match(/^\/messages\/([^/]+)\/attachments\/(.+)$/);
    if (att) return J({ size: 400, data: att[2].includes('png') ? tinyPng.replace(/\+/g, '-').replace(/\//g, '_') : tinyPdf.replace(/\+/g, '-').replace(/\//g, '_') });
    const mm = p.match(/^\/messages\/([^/]+)$/);
    if (mm && method === 'GET') {
      const m = threads.flatMap((t) => t.messages).find((x: any) => x.id === mm[1]);
      return m ? J(m) : J({ error: { code: 404, message: 'gone' } }, 404);
    }
    if (p === '/messages/send' && method === 'POST') {
      const raw = fromB64u(String(body?.raw || ''));
      const head = (n: string) => new RegExp('^' + n + ':\\s*(.*)$', 'im').exec(raw)?.[1]?.trim() || '';
      const text = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n');
      s.seq++;
      const tid = body?.threadId && by.has(body.threadId) ? String(body.threadId) : 'smpS' + String(s.seq).padStart(3, '0');
      const msg: MsgDef = { from: { name: owner === 'tester2@favorintl.org' ? 'FavorOS Tester Two' : 'FavorOS Tester', email: owner }, to: [{ name: head('To'), email: head('To') }], hours: 0, html: '<p>' + text.replace(/<[^>]+>/g, '').slice(0, 2000).replace(/\n/g, '<br>') + '</p>', labels: ['SENT'] };
      const existing = s.extra.find((x) => x.id === tid);
      if (existing) existing.msgs.push(msg);
      else if (by.has(tid)) s.extra.push({ id: tid, subject: head('Subject'), msgs: [msg] });
      else s.extra.push({ id: tid, subject: head('Subject') || '(no subject)', msgs: [msg], labels: ['SENT'] });
      await save(env, owner, s);
      return J({ id: tid + 'sent', threadId: tid });
    }
    if (p === '/drafts' && method === 'GET') return J({ drafts: [] });
    if (p === '/drafts' && method === 'POST') { s.seq++; await save(env, owner, s); return J({ id: 'r-sample' + s.seq, message: { id: 'smpD' + s.seq, threadId: 'smpD' + s.seq } }); }
    if (p.startsWith('/drafts/') && method === 'PUT') return J({ id: p.split('/')[2], message: { id: 'smpD0', threadId: 'smpD0' } });
    if (p.startsWith('/drafts/') && method === 'DELETE') return new Response(null, { status: 204 });
    return J({ error: { code: 404, message: 'no sample route ' + p } }, 404);
  }) as Fetcher;
}

/** Real partners for the sample senders: the first three in the Blackbaud copy that have an email address. Cached with the mailbox. */
export async function samplePartners(env: Env, emails: string[]): Promise<Record<string, { id: string; name: string }>> {
  const want = emails.filter((e) => SAMPLE_PARTNER_EMAILS.includes(e));
  if (!want.length) return {};
  try {
    const { mirror } = await import('../foundations/blackbaud');
    const rows = await mirror<any>(env, `SELECT c.id AS id, trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS name FROM constituents c WHERE c.last_name IS NOT NULL AND c.last_name <> '' AND c.id IN (SELECT constituent_record_id FROM gifts GROUP BY constituent_record_id HAVING SUM(gift_amount) > 5000) ORDER BY c.id LIMIT 3`, []);
    const out: Record<string, { id: string; name: string }> = {};
    want.forEach((e, i) => { const r = rows[i]; if (r) out[e] = { id: String(r.id), name: String(r.name) }; });
    return out;
  } catch {
    return {};
  }
}

/** The unread inbox mail of a test user for Today's card, read from the sample mailbox the same way Mail reads it. */
export async function sampleUnread(env: Env, owner: string): Promise<Array<{ id: string; threadId: string; from: string; fromEmail: string; subject: string; date: string; link: string }>> {
  const { gmail, shapeThreadRow } = await import('./gmail');
  const gm = gmail(SAMPLE_TOKEN.token, sampleFetcher(env, owner));
  const l = await gm.get('/threads', { labelIds: 'INBOX', q: 'is:unread', maxResults: '15' });
  const out = [];
  for (const t of (l.threads || []).slice(0, 15)) {
    const full = await gm.get('/threads/' + t.id, { format: 'metadata' }).catch(() => null);
    if (!full) continue;
    const r = shapeThreadRow(full, owner);
    if (!r.unread) continue;
    out.push({ id: r.lastId || r.id, threadId: r.id, from: r.from?.name || r.from?.email || '', fromEmail: r.from?.email || '', subject: r.subject || '(No subject)', date: r.date, link: `/mail/#/INBOX/${r.id}` });
  }
  return out;
}
