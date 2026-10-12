// Mail knows Favor (round 2), with the same stand-ins as mail-smart.test.mjs.
// Smart Mail through the router with stand-ins for Gmail, Workers AI (Clef and the text model), the partner copy and the database:
// the rail count as Gmail's Primary tab, filters and oldest-first sorting, categories and the Needs you view, Waiting on reply,
// clean-up suggestions, summaries and suggested replies, the partner card, and changes to many conversations. Every person,
// address and message here is invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';
import { memoryR2 } from './support/r2.mjs';

const { handle, mailUnreadCount, forgetCount, sendDue, wakeDue } = await import('../functions/_lib/mail/route.ts');
const know = await import('../functions/_lib/mail/know.ts');
const { forgetRows } = await import('../functions/_lib/mail/rows.ts');
const google = await import('../functions/_lib/hub/google.ts');

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ADMIN = { email: 'ada@favorintl.org', name: 'Ada Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify';
const META = 'https://www.googleapis.com/auth/gmail.metadata';
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const DAY = 864e5;

let d1, env, calls, box, aiCalls, ai;

const hdrs = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
/** One invented conversation: a single message unless `msgs` is given. */
function thread(id, o) {
  const msgs = o.msgs || [o];
  return {
    id,
    historyId: '1',
    messages: msgs.map((m, i) => ({
      id: id.replace('t', 'm') + i,
      threadId: id,
      labelIds: m.labels || o.labels || ['INBOX'],
      internalDate: String(Date.now() - (m.ago ?? o.ago ?? 1) * DAY / 24 - (msgs.length - i) * 1000),
      snippet: m.snippet ?? o.snippet ?? '',
      payload: {
        mimeType: m.files ? 'multipart/mixed' : 'text/plain',
        headers: hdrs({ From: m.from || o.from, To: m.to || o.to || 'Ada Admin <ada@favorintl.org>', Subject: m.subject || o.subject || 'Hello', ...(m.extra || o.extra || {}) }),
        body: { data: b64u(m.body ?? o.body ?? m.snippet ?? o.snippet ?? 'text') },
      },
    })),
  };
}

function mailbox() {
  return {
    threads: {
      tpartner1: thread('tpartner1', { from: 'Maya Okafor <maya@example.org>', subject: 'Visiting in March', snippet: 'Could you confirm the dates by Friday?', labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], ago: 30 }),
      tstaff001: thread('tstaff001', { from: 'Bo Builder <bo@favorintl.org>', subject: 'Lunch plan', snippet: 'Thursday at noon works for me.', labels: ['INBOX', 'CATEGORY_PERSONAL'], ago: 20 }),
      tperson01: thread('tperson01', { from: 'Tom Whitfield <tom@whitfield.example>', subject: 'Question about the trip', snippet: 'Do you have space for two more?', labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], ago: 50 }),
      tnews0001: thread('tnews0001', { from: 'Weekly Digest <news@digest.example>', subject: 'This week in missions', snippet: 'Read the latest.', labels: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], extra: { 'List-Unsubscribe': '<mailto:u@digest.example>' }, ago: 5 }),
      tnews0002: thread('tnews0002', { from: 'Weekly Digest <news@digest.example>', subject: 'Missions roundup', snippet: 'More news.', labels: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], extra: { 'List-Unsubscribe': '<mailto:u@digest.example>' }, ago: 30 }),
      tnews0003: thread('tnews0003', { from: 'Weekly Digest <news@digest.example>', subject: 'Prayer digest', snippet: 'Pray with us.', labels: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'], extra: { 'List-Unsubscribe': '<mailto:u@digest.example>' }, ago: 60 }),
      trcpt0001: thread('trcpt0001', { from: 'Payments <noreply@payments.example>', subject: 'Your receipt from Example LLC', snippet: 'Payment of $100.', labels: ['INBOX', 'CATEGORY_UPDATES'], ago: 70 }),
      tcal00001: thread('tcal00001', { from: 'Google Calendar <calendar-notification@google.com>', subject: 'Invitation: Team prayer @ Mon 9am', snippet: 'You are invited.', labels: ['INBOX', 'CATEGORY_UPDATES'], ago: 40 }),
      tnote0001: thread('tnote0001', { from: 'Daily health <noreply@favorintl.org>', subject: 'Favor daily health: all systems go', snippet: 'All fine.', labels: ['INBOX', 'CATEGORY_UPDATES'], ago: 8 }),
      // sent mail: the newest message is mine, four days old; a second sent three hours ago
      tsent0001: thread('tsent0001', { from: 'Ada Admin <ada@favorintl.org>', to: 'Maya Okafor <maya@example.org>', subject: 'Itinerary', snippet: 'Here it is.', labels: ['SENT'], ago: 96 }),
      tsent0002: thread('tsent0002', { from: 'Ada Admin <ada@favorintl.org>', to: 'Tom Whitfield <tom@whitfield.example>', subject: 'Just now', snippet: 'Hi.', labels: ['SENT'], ago: 3 }),
      tsent0003: thread('tsent0003', {
        subject: 'Re: Matching gift',
        labels: ['INBOX', 'SENT'],
        msgs: [
          { from: 'Tom Whitfield <tom@whitfield.example>', to: 'ada@favorintl.org', snippet: 'Signed form attached.', ago: 200 },
          { from: 'Ada Admin <ada@favorintl.org>', to: 'Tom Whitfield <tom@whitfield.example>', snippet: 'Thank you, received.', labels: ['INBOX', 'SENT'], ago: 150 },
        ],
      }),
      tlong00001: thread('tlong00001', {
        subject: 'Visiting in March',
        labels: ['INBOX'],
        msgs: [
          { from: 'Maya Okafor <maya@example.org>', snippet: 'We would like to visit.', body: 'We would like to visit the school in March. Is the second week open?', ago: 72 },
          { from: 'Ada Admin <ada@favorintl.org>', to: 'Maya Okafor <maya@example.org>', snippet: 'Yes.', body: 'Yes, the second week is open.', labels: ['SENT'], ago: 60 },
          { from: 'Maya Okafor <maya@example.org>', snippet: 'Could you confirm the dates by Friday?', body: 'Wonderful.\nCould you confirm the dates by Friday?\n\nOn Tue, Ada Admin wrote:\n> Yes, the second week is open.', ago: 2 },
        ],
      }),
    },
    unreadAll: 7,
    primaryIds: ['tpartner1', 'tperson01'],
    modified: [],
  };
}

const fakeGoogle = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const p = u.pathname.replace('/gmail/v1/users/me', '');
  calls.push({ method, path: p, q: u.searchParams, body });
  const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
  if (p === '/labels/INBOX') return J({ id: 'INBOX', threadsUnread: box.unreadAll });
  if (p === '/labels' && method === 'GET') return J({ labels: [{ id: 'INBOX', type: 'system' }, { id: 'Label_7', name: 'Trips', type: 'user' }] });
  if (p.startsWith('/labels/')) return J({ id: p.split('/')[2], threadsUnread: 0, threadsTotal: 0 });
  if (p === '/threads' && method === 'GET') {
    const q = u.searchParams.get('q') || '';
    const label = u.searchParams.get('labelIds');
    let list = Object.values(box.threads);
    if (q.includes('category:primary')) list = list.filter((t) => box.primaryIds.includes(t.id));
    else if (q.includes('in:sent')) list = list.filter((t) => t.messages.some((m) => m.labelIds.includes('SENT')));
    else if (label) list = list.filter((t) => t.messages.some((m) => m.labelIds.includes(label)));
    if (q.includes('is:unread') && !q.includes('category:primary')) list = list.filter((t) => t.messages.some((m) => m.labelIds.includes('UNREAD')));
    if (q.includes('has:attachment')) list = list.filter((t) => t.messages.some((m) => /mixed/.test(m.payload.mimeType)));
    list.sort((a, b) => Number(b.messages.at(-1).internalDate) - Number(a.messages.at(-1).internalDate));
    return J({ threads: list.map((t) => ({ id: t.id, historyId: t.historyId })), resultSizeEstimate: list.length });
  }
  const tm = p.match(/^\/threads\/([^/]+)(?:\/(modify|trash|untrash))?$/);
  if (tm) {
    const t = box.threads[tm[1]];
    if (!t) return J({ error: { code: 404, message: 'gone' } }, 404);
    if (tm[2]) {
      box.modified.push({ id: tm[1], action: tm[2], body });
      return J(t);
    }
    return J(t);
  }
  if (p === '/messages/send') { (box.sent = box.sent || []).push(body); return J({ id: 'm9aaaaaa', threadId: 't9aaaaaa' }); }
  return J({ error: { code: 404, message: 'no route ' + p } }, 404);
};

async function grant(email, scopes) {
  await d1.prepare('INSERT OR REPLACE INTO hub_google (email, refresh_enc, scopes, connected_at) VALUES (?, ?, ?, ?)').bind(email, await google.seal(env, 'refresh-' + email), scopes, '2026-10-11T12:00:00.000Z').run();
}

async function call(user, method, path, body, extra = {}) {
  const init = { method, headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' } };
  if (body !== undefined && method !== 'GET') init.body = JSON.stringify(body);
  const res = await handle({
    request: new Request('https://dash.favorintl.org/api/mail/' + path, init),
    env,
    user,
    path: path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent),
    fetcher: fakeGoogle,
    ai,
    giving: async (ids) => Object.fromEntries(ids.map((i) => [i, { max: 2500, total: 9100, last: '2026-10-02', lastAmount: 100 }])),
    mirror: async (sql) => (/FROM appeals/.test(sql) ? [{ code: 'N26A-EMW2', d: 'Newsletter October week 2', cat: 'Digital Newsletter', off: 0, added: '2026-10-05' }] : /FROM funds/.test(sql) ? [{ code: 'GEN', d: 'General Fund', off: 0 }] : /FROM constituents/.test(sql) ? [{ id: '27202', lookup: '8841', name: 'Maya Okafor' }] : /FROM gifts/.test(sql) ? [{ n: 3, total: 300, last: '2026-10-02' }] : []),
    partners: async (emails) => Object.fromEntries(emails.filter((e) => e === 'maya@example.org').map((e) => [e, { id: '27202', name: 'Maya Okafor' }])),
    partnerCard: async (id) => ({ id, name: 'Maya Okafor', lookup: '8841', giving: { total: 4300.5, count: 12, ytd: 600, firstDate: '2019-03-02', last: { amount: 100, date: '2026-10-02', fund: 'General' } }, assignments: [{ name: 'Grace Lin', type: 'Partner Care', current: true }, { name: 'Old Holder', type: 'East', current: false }], lastContact: { date: '2026-09-12', category: 'Phone call' }, actions: { openCount: 2 }, flags: { doNotEmail: false }, ...extra }),
    ...extra,
  });
  return { status: res.status, data: (res.headers.get('Content-Type') || '').includes('json') ? await res.json() : null };
}

beforeEach(async () => {
  d1 = memoryD1();
  d1.exec(read('db/google.sql'));
  d1.exec(read('db/admin-home.sql'));
  d1.exec(read('db/mail.sql'));
  d1.exec(read('db/mail-smart.sql'));
  d1.exec(read('db/mail-cache.sql'));
  env = { UPLOADS: memoryR2(), DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
  calls = [];
  box = mailbox();
  aiCalls = [];
  // Clef says a message asks something when its preview has a question mark; the text model answers by prompt.
  ai = {
    run: async (model, input) => {
      aiCalls.push({ model, input });
      if (/clef/.test(model)) {
        const ask = /\?/.test(input.state) ? 0.93 : 0.04;
        return { answers: { kind: { choice: 'person', probabilities: { person: 0.9, notification: 0.1 } }, ask: { noul: ask } } };
      }
      const sys = input.messages[0].content;
      if (/summarize/i.test(sys)) return { response: 'Maya wants the March dates confirmed by Friday — just that.' };
      return { response: '{"replies":["Hi Maya,\\n\\nYes, the second week works. I will confirm by Friday.","Hi Maya,\\n\\nNot yet. I am checking with the team — back to you Monday.","Hi Maya,\\n\\nWhich dates are you weighing?"]}' };
    },
  };
  forgetCount(ADMIN.email);
  forgetRows();
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://oauth.test/token') return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  await grant(ADMIN.email, MODIFY);
});


const BEN = { email: 'ben@favorintl.org', name: 'Ben Admin', picture: '', role: 'admin', via: 'google', kpi: true };
const run = (path, method = 'GET', body) => call(ADMIN, method, path, body);

describe('who a sender is to Favor', () => {
  it('names a partner with the history between them and the person', async () => {
    const p = (await run('smart/sender?email=maya%40example.org')).data.profile;
    assert.equal(p.kind, 'partner');
    assert.equal(p.partner.id, '27202');
    assert.match(p.role, /Partner in Blackbaud/);
    assert.ok(p.history.n >= 1);
    assert.equal(p.canProspect, false);
  });
  it('says an outside address is not in Blackbaud and offers to add it as a prospect', async () => {
    const p = (await run('smart/sender?email=tom%40whitfield.example')).data.profile;
    assert.equal(p.kind, 'outside');
    assert.equal(p.canProspect, true);
    assert.equal((await run('smart/sender?email=noreply%40x.example')).data.profile.canProspect, false);
    assert.equal((await run('smart/sender?email=bad')).status, 400);
  });
});

describe('what a message mentions', () => {
  it('opens a card for a fund and a Lookup ID, sends appeals to the shared module, and 404s on nothing', async () => {
    assert.equal((await run('entity?kind=appeal&q=n26a-emw2')).status, 404, 'appeals come from the shared module');
    assert.equal((await run('entity?kind=fund&q=General%20Fund')).data.card.title, 'General Fund');
    const l = (await run('entity?kind=lookup&q=8841')).data.card;
    assert.equal(l.id, '27202');
    assert.match(l.lines[0].v, /\$300/);
    assert.equal((await run('entity?kind=appeal&q=nope')).status, 404);
    assert.equal((await run('entity?kind=weird&q=x')).status, 404);
  });
  it('lists active fund names for the page to find in a message', async () => {
    assert.ok(Array.isArray((await run('entity/names')).data.funds));
  });
});

describe('priority and logging', () => {
  it('marks a partner with one gift of $1,000 or more as major and ranks that mail first', async () => {
    const r = (await run('threads?label=INBOX&view=cat:partners&sort=prio')).data.threads;
    assert.ok(r.length && r.every((t) => t.major === true));
    assert.ok(r[0].prio >= 3);
  });
  it('lists partner mail from the last week that was not logged, and drops it once logged', async () => {
    const before = (await run('threads?label=INBOX&view=unlogged')).data.threads;
    assert.ok(before.length >= 1);
    const id = before[0].id;
    await run('smart/logged', 'POST', { threadId: id, partnerId: '27202' });
    const after = (await run('threads?label=INBOX&view=unlogged')).data.threads;
    assert.ok(!after.some((t) => t.id === id));
    const o = (await run('smart/overview')).data;
    assert.equal(typeof o.unlogged, 'number');
    assert.ok(o.major >= 1);
  });
});

describe('categories in words', () => {
  it('makes a category from a name and a sentence, hands it to Clef, and counts what lands in it', async () => {
    const made = (await run('smart/categories', 'POST', { name: 'Trips', description: 'Anything about a mission trip, a visit or travel plans' })).data.category;
    assert.match(made.id, /^c_[a-z0-9]{8}$/);
    ai.run = async (model, input) => {
      if (/clef/.test(model)) {
        assert.ok(input.questions.kind.criteria[made.id].startsWith('Trips:'));
        return { answers: { kind: { choice: /trip/i.test(input.state) ? made.id : 'person', probabilities: { [made.id]: 0.9, person: 0.1 } }, ask: { noul: 0.1 } } };
      }
      return { response: '' };
    };
    forgetCount(ADMIN.email);
    const o = (await run('smart/overview')).data;
    assert.ok(o.counts[made.id], 'the category has a count slot');
    assert.deepEqual(o.customs.map((c) => c.name), ['Trips']);
    assert.equal((await run('smart/categories', 'POST', { name: 'x', description: 'short' })).status, 400);
    assert.equal((await run('smart/categories/' + made.id, 'DELETE')).status, 200);
    assert.equal((await run('smart/categories')).data.categories.length, 0);
  });
});

describe('the morning briefing', () => {
  it('is built from counts: unread, waiting, major partners, and where to start, with no model asked', async () => {
    const n = aiCalls.filter((c) => !/clef/.test(c.model)).length;
    const b = (await run('smart/briefing')).data.briefing;
    assert.ok(b.items.length >= 1);
    assert.ok(b.items[0].why.length > 0);
    assert.match(b.text, /^\d+ unread/);
    assert.match(b.text, /Start with /);
    assert.ok(!/[—–]/.test(b.text) && !/executive|empty/i.test(b.text));
    assert.equal(aiCalls.filter((c) => !/clef/.test(c.model)).length, n, 'no text model is used');
    assert.equal((await run('smart/briefing')).data.briefing.at, b.at, 'kept for the day');
  });
  it('never calls the inbox empty while messages show, and says nothing for a list that is empty', () => {
    assert.equal(know.briefLine({ needs: 0, major: 0, waiting: 0, unread: 0 }, [], 0), '');
    const t = know.briefLine({ needs: 0, major: 0, waiting: 0, unread: 0 }, [], 12);
    assert.ok(!/empty|nothing|none/i.test(t));
    assert.equal(know.briefLine({ needs: 3, major: 1, waiting: 14, unread: 1300 }, [{ from: 'Maya Okafor', subject: 'Visiting in March' }], 20), '1,300 unread, 3 waiting on you, 1 from major partner, 14 sent with no reply. Start with Maya Okafor: Visiting in March.');
  });
});

describe('the words in an email', () => {
  it('finds the gift a partner says they gave', () => {
    assert.equal(know.giftMention('We mailed a check for $1,250.00 yesterday.')?.amount, 1250);
    assert.equal(know.giftMention('The room costs $40 per night.'), null);
  });
  it('finds the promises in a sent message and the day they name', () => {
    const c = know.commitments('Thanks for the call. I will send the itinerary by Friday. Does that work?', '2026-10-12T14:00:00Z');
    assert.equal(c.length, 1);
    assert.match(c[0].text, /send the itinerary/);
    assert.match(c[0].due, /^2026-10-/);
    assert.deepEqual(know.commitments('Sounds good.', ''), []);
  });
  it('returns the gift mention, the promises and the giving facts the replies were grounded in', async () => {
    box.threads.tgift0001 = thread('tgift0001', { msgs: [{ from: 'Ada Admin <ada@favorintl.org>', to: 'Maya Okafor <maya@example.org>', snippet: 'I will call you Tuesday.', body: 'Thank you. I will call you Tuesday.', labels: ['SENT'], ago: 5 }, { from: 'Maya Okafor <maya@example.org>', subject: 'Gift', snippet: 'I mailed a check for $500 today.', body: 'I mailed a check for $500 today.', ago: 3 }] });
    const a = (await run('threads/tgift0001/assist')).data;
    assert.equal(a.gift.amount, 500);
    assert.equal(a.commitments.length, 1);
    assert.match(a.facts, /given \$9,100/);
    const sys = aiCalls.filter((c) => !/clef/.test(c.model)).map((c) => c.input.messages[0].content).join('\n');
    assert.match(sys, /Real giving data/);
  });
});

describe('questions and files', () => {
  it('answers a question about the open conversation', async () => {
    ai.run = async () => ({ response: 'By Friday — she asks for the dates.' });
    const r = (await run('threads/tlong00001/ask', 'POST', { q: 'What does Maya want?' })).data;
    assert.match(r.answer, /By Friday/);
    assert.ok(!/[—–]/.test(r.answer));
  });
  it('says what a file is and what to do next', async () => {
    ai.run = async () => ({ answers: { kind: { choice: 'check', probabilities: { check: 0.95 } } } });
    const r = (await run('messages/mlong000/attachments/ATTcheck12345/read?name=scan.pdf&mime=application%2Fpdf&subject=Gift')).data;
    assert.equal(r.kind, 'check');
    assert.equal(r.next.href, '/gift-entry/');
  });
  it('reads the name when the model is off', async () => {
    ai.run = async () => { throw new Error('off'); };
    const r = (await run('messages/mlong000/attachments/ATTw9xxxxxx1/read?name=W-9.pdf&mime=application%2Fpdf')).data;
    assert.equal(r.kind, 'w9');
  });
});

describe('the writing check before send', () => {
  const check = (o) => run('check', 'POST', { to: ['maya@example.org'], subject: 'Hi', files: 0, html: '<p>Hello</p>', ...o });
  it('is quiet for a clean message', async () => {
    assert.deepEqual((await check({ html: '<p>Hi Maya, thank you.</p>' })).data.warnings, []);
  });
  it('catches the word donor, a greeting for another person, an attachment that is not there, and no subject', async () => {
    const w = (await check({ html: '<p>Hi Sarah, our donor letter is attached.</p>', subject: '' })).data.warnings.map((x) => x.code);
    for (const c of ['donor', 'name', 'attachment', 'subject']) assert.ok(w.includes(c), c);
  });
  it('catches an amount that differs from the earlier mail', () => {
    const w = know.writingCheck({ html: '<p>Your gift of $400 arrived.</p>', subject: 's', files: 0, to: [], partnerName: '', lastGift: 0, quotedAmounts: [500] });
    assert.deepEqual(w.map((x) => x.code), ['amount']);
  });
});

describe('templates with data fields', () => {
  it('fills first name, last gift and the writer, and leaves a field with no data for the person', () => {
    assert.equal(know.fillTemplate('Hi {first_name}, your {last_gift} on {last_gift_date}. {my_name} {total_giving}', { name: 'Maya and Chidi Okafor', lastGift: 100, lastGiftDate: '2026-10-02', me: 'Ada' }), 'Hi Maya, your $100 on October 2, 2026. Ada {total_giving}');
  });
  it('seeds three starting templates once, with the data fields, and does not bring them back after they are deleted', async () => {
    const first = (await run('templates')).data.templates;
    assert.deepEqual(first.map((t) => t.name).sort(), ['Meeting follow-up', 'Receipt question', 'Thank you for a gift']);
    assert.ok(first.find((t) => t.name === 'Thank you for a gift').body.includes('{last_gift}'));
    for (const t of first) await run('templates/' + t.id, 'DELETE');
    assert.equal((await run('templates')).data.templates.length, 0);
  });
  it('saves, lists, fills from the partner on the To line, and removes', async () => {
    await run('templates');
    for (const t of (await run('templates')).data.templates) await run('templates/' + t.id, 'DELETE');
    const id = (await run('templates', 'POST', { name: 'Thanks', body: 'Hi {first_name}, thank you for {last_gift}.' })).data.id;
    assert.equal((await run('templates')).data.templates.length, 1);
    const f = (await run('templates/fill', 'POST', { body: 'Hi {first_name}, thank you for {last_gift}.', to: ['maya@example.org'] })).data.text;
    assert.equal(f, 'Hi Maya, thank you for $100.');
    assert.equal((await call(BEN, 'GET', 'templates')).status, 403);
    await run('templates/' + id, 'DELETE');
    assert.equal((await run('templates')).data.templates.length, 0);
  });
});

describe('send later, and snooze until a reply', () => {
  it('keeps a message until its time, sends it from the mailbox, and clears the saved text', async () => {
    box.sent = [];
    const at = new Date(Date.now() + 120000).toISOString();
    const l = (await run('later', 'POST', { sendAt: at, to: ['maya@example.org'], subject: 'Later', html: '<p>Hi Maya</p>' })).data;
    assert.ok(l.id);
    assert.equal((await run('later')).data.later.length, 1);
    assert.deepEqual(await sendDue(env, fakeGoogle), { sent: 0, failed: 0 });
    d1.db.prepare("UPDATE hub_mail_later SET send_at = '2020-01-01T00:00:00.000Z'").run();
    const out = await sendDue(env, fakeGoogle);
    assert.equal(out.sent, 1);
    assert.equal(box.sent.length, 1);
    assert.equal(d1.db.prepare('SELECT payload FROM hub_mail_later').get().payload, '{}');
    assert.equal((await run('later')).data.later.length, 0);
  });
  it('refuses a past time, no recipient and a message with files', async () => {
    assert.equal((await run('later', 'POST', { sendAt: '2020-01-01', to: ['a@b.org'], html: 'x' })).status, 400);
    const at = new Date(Date.now() + 120000).toISOString();
    assert.equal((await run('later', 'POST', { sendAt: at, to: [], html: 'x' })).status, 400);
    assert.equal((await run('later', 'POST', { sendAt: at, to: ['a@b.org'], html: 'x', files: [{ name: 'a', data: 'AA' }] })).status, 400);
  });
  it('a cancelled message never goes', async () => {
    const at = new Date(Date.now() + 120000).toISOString();
    const id = (await run('later', 'POST', { sendAt: at, to: ['maya@example.org'], subject: 's', html: 'x' })).data.id;
    await run('later/' + id, 'DELETE');
    d1.db.prepare("UPDATE hub_mail_later SET send_at = '2020-01-01T00:00:00.000Z'").run();
    box.sent = [];
    assert.equal((await sendDue(env, fakeGoogle)).sent, 0);
  });
  it('a conversation snoozed until a reply leaves the inbox and returns when someone else writes', async () => {
    const r = (await run('threads/tlong00001/snooze', 'POST', { until: 'reply' })).data;
    assert.equal(r.wait, 'reply');
    const gm = (await import('../functions/_lib/mail/gmail.ts')).gmail('x', fakeGoogle);
    box.modified = [];
    assert.equal(await wakeDue(env, gm, ADMIN.email), 0);
    box.threads.tlong00001.messages.push({ id: 'mnewreply1', threadId: 'tlong00001', labelIds: ['INBOX'], internalDate: String(Date.now()), snippet: 'Friday works', payload: { mimeType: 'text/plain', headers: hdrs({ From: 'Maya Okafor <maya@example.org>', To: 'ada@favorintl.org', Subject: 'Re' }) } });
    assert.equal(await wakeDue(env, gm, ADMIN.email), 1);
    assert.ok(box.modified.some((m) => (m.body.addLabelIds || []).includes('UNREAD')));
  });
});

describe('the partner timeline', () => {
  it('merges gifts, calls, meetings and mail, newest first', async () => {
    const res = await handle({
      request: new Request('https://dash.favorintl.org/api/mail/partner/27202/timeline?email=maya%40example.org', { headers: { 'X-Hub-Request': '1' } }),
      env, user: ADMIN, path: ['partner', '27202', 'timeline'], fetcher: fakeGoogle, partners: async () => ({}),
      partnerCard: async () => ({ id: '27202', giving: { recent: [{ amount: 100, date: '2026-10-02', fund: 'General' }] }, actions: { recent: [{ category: 'Phone call', summary: 'Thanked', done: '2026-09-12' }, { category: 'Meeting', summary: 'Lunch', done: '2026-08-01' }], open: [] } }),
    });
    const j = await res.json();
    const t = j.items;
    const kinds = new Set(t.map((x) => x.kind));
    for (const k of ['gift', 'call', 'meeting', 'mail']) assert.ok(kinds.has(k), k);
    assert.deepEqual(t.map((x) => x.at), [...t.map((x) => x.at)].sort().reverse());
  });
});

describe('unsubscribe', () => {
  it('reads the https and mailto addresses from the List-Unsubscribe header', async () => {
    const { unsub } = await import('../functions/_lib/mail/gmail.ts');
    assert.deepEqual(unsub('<mailto:u@x.org>, <https://x.org/u?id=1>, <http://bad.org>'), { url: 'https://x.org/u?id=1', mailto: 'mailto:u@x.org' });
    assert.deepEqual(unsub(''), { url: '', mailto: '' });
  });
});

describe('finding a time from an email', () => {
  it('offers free weekday times between 9 and 5 Eastern that nobody is busy in, no more than two a day', () => {
    const slots = know.freeSlots([], new Date(), 10, 30, 8);
    assert.ok(slots.length >= 4);
    for (const s of slots) {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(s));
      assert.ok(!['Sat', 'Sun'].includes(p.find((x) => x.type === 'weekday').value));
      const h = Number(p.find((x) => x.type === 'hour').value);
      assert.ok(h >= 9 && h < 17);
    }
    const perDay = {};
    for (const s of slots) { const d = new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); perDay[d] = (perDay[d] || 0) + 1; }
    assert.ok(Object.values(perDay).every((n) => n <= 2));
  });
  it('skips a time someone is busy', () => {
    const first = know.freeSlots([], new Date(), 10, 30, 1)[0];
    const busy = [[{ start: new Date(Date.parse(first) - 60000).toISOString(), end: new Date(Date.parse(first) + 3600000).toISOString() }]];
    const next = know.freeSlots(busy, new Date(), 10, 30, 1)[0];
    assert.ok(Date.parse(next) >= Date.parse(first) + 3600000);
  });
  it('answers through the route with the guests that are staff', async () => {
    const r = await call(ADMIN, 'POST', 'smart/times', { guests: ['bo@favorintl.org', 'pat@example.org'], minutes: 30 }, { freeBusy: async (who) => Object.fromEntries(who.map((e) => [e, { busy: [] }])) });
    assert.deepEqual(r.data.guests, ['bo@favorintl.org']);
    assert.ok(r.data.slots.length >= 3);
  });
});

describe('handing an email to the rest of FavorOS', () => {
  let told, requests;
  const withStandIns = (path, method, body) =>
    handle({
      request: new Request('https://dash.favorintl.org/api/mail/' + path, { method, headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }),
      env, user: ADMIN, path: path.split('?')[0].split('/').filter(Boolean), fetcher: fakeGoogle, ai, partners: async () => ({}),
      chat: async (from, to, text) => { told.push({ from, to, text }); },
      makeRequest: async (r) => { requests.push(r); return { id: 'req_test1' }; },
    }).then(async (res) => ({ status: res.status, data: await res.json() }));
  beforeEach(() => {
    told = [];
    requests = [];
    d1.exec(read('db/mail-cache.sql'));
    d1.exec("CREATE TABLE IF NOT EXISTS meet_directory (email TEXT PRIMARY KEY, name TEXT, title TEXT, team TEXT, active INTEGER)");
    d1.exec("INSERT OR REPLACE INTO meet_directory VALUES ('bo@favorintl.org', 'Bo Builder', 'Partner Care', 'pc', 1)");
  });

  it('assigns a conversation: a Chat notice with the subject, sender, preview and note, and a row the person can follow', async () => {
    const r = await withStandIns('threads/tpartner1/assign', 'POST', { to: 'bo@favorintl.org', note: 'Please call her Friday.' });
    assert.equal(r.status, 200);
    assert.equal(told.length, 1);
    assert.equal(told[0].to, 'bo@favorintl.org');
    assert.equal(told[0].from, ADMIN.email);
    assert.match(told[0].text, /Visiting in March/);
    assert.match(told[0].text, /Please call her Friday/);
    assert.ok(!/dash\.favorintl\.org\/mail/.test(told[0].text), 'a teammate cannot open another person\'s Gmail, so no link goes');
    const list = (await withStandIns('assigned', 'GET')).data.assigned;
    assert.equal(list[0].name, 'Bo Builder');
    assert.equal(list[0].state, 'open');
    assert.equal((await withStandIns('assigned/' + list[0].id + '/done', 'POST')).status, 200);
    assert.equal((await withStandIns('assigned', 'GET')).data.assigned[0].state, 'done');
  });

  it('turns away an address that is not on the staff list, and the person themself', async () => {
    assert.equal((await withStandIns('threads/tpartner1/assign', 'POST', { to: 'pat@example.org' })).status, 400);
    assert.equal((await withStandIns('threads/tpartner1/assign', 'POST', { to: ADMIN.email })).status, 400);
    assert.equal(told.length, 0);
  });

  it('mentions a coworker on an email with the note', async () => {
    const r = await withStandIns('threads/tpartner1/mention', 'POST', { to: ['bo@favorintl.org', 'pat@example.org'], note: 'Thoughts?' });
    assert.deepEqual(r.data.told, ['bo@favorintl.org']);
    assert.match(told[0].text, /want your eyes/);
    assert.equal((await withStandIns('threads/tpartner1/mention', 'POST', { to: ['pat@example.org'] })).status, 400);
  });

  it('makes a request card filed as the person, with the preview and the link back to the email', async () => {
    const r = await withStandIns('threads/tpartner1/request', 'POST', { note: 'Update the trip page.', surface: 'website' });
    assert.equal(r.data.id, 'req_test1');
    assert.match(r.data.url, /^\/requests\/\?r=req_test1$/);
    assert.equal(requests[0].email, ADMIN.email);
    assert.equal(requests[0].title, 'Visiting in March');
    assert.match(requests[0].body, /Update the trip page/);
    assert.match(requests[0].body, /\/mail\/#\/INBOX\/tpartner1/);
  });

  it('refuses all three without read access to the mail', async () => {
    d1.exec("UPDATE hub_google SET scopes = 'https://www.googleapis.com/auth/gmail.metadata' WHERE email = '" + ADMIN.email + "'");
    forgetCount(ADMIN.email);
    assert.equal((await withStandIns('threads/tpartner1/assign', 'POST', { to: 'bo@favorintl.org' })).status, 403);
  });
});

const { releaseDue, releaseHeld } = await import('../functions/_lib/mail/route.ts');
describe('undo send: a message held on the server', () => {
  const hold = (o = {}) => run('hold', 'POST', { to: ['maya@example.org'], subject: 'Dates', html: '<p>Hi Maya, Friday works.</p>', ...o });
  beforeEach(() => { box.sent = []; });

  it('holds a message and sends nothing until it is released', async () => {
    const h = (await hold()).data;
    assert.match(h.id, /^h_/);
    assert.equal(box.sent.length, 0);
    assert.equal(d1.db.prepare('SELECT state FROM hub_mail_held').get().state, 'held');
  });
  it('Undo cancels the held message for good: release then finds it not waiting', async () => {
    const h = (await hold()).data;
    assert.equal((await run('hold/' + h.id, 'DELETE')).data.undone, true);
    assert.equal(d1.db.prepare('SELECT payload FROM hub_mail_held').get().payload, '{}');
    const r = await run('hold/' + h.id + '/release', 'POST');
    assert.equal(r.data.sent, false);
    assert.equal(box.sent.length, 0);
  });
  it('release sends once, even when the page and the server fallback both ask at the same time', async () => {
    const h = (await hold()).data;
    const [a, b] = await Promise.all([releaseHeld(env, ADMIN.email, h.id, fakeGoogle), releaseHeld(env, ADMIN.email, h.id, fakeGoogle)]);
    assert.equal(box.sent.length, 1);
    assert.ok([a, b].some((x) => x.sent));
    assert.equal(d1.db.prepare('SELECT state FROM hub_mail_held').get().state, 'sent');
  });
  it('the server fallback sends a held message a minute old and leaves a fresh one alone', async () => {
    const old = (await hold({ subject: 'Old' })).data;
    await hold({ subject: 'Fresh' });
    d1.db.prepare("UPDATE hub_mail_held SET release_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(old.id);
    assert.equal(await releaseDue(env, ADMIN.email, fakeGoogle), 1);
    assert.equal(box.sent.length, 1);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM hub_mail_held WHERE state = 'held'").get().n, 1);
  });
  it('a held message is the person\'s own: another admin cannot release or undo it', async () => {
    const h = (await hold()).data;
    assert.equal((await call(BEN, 'POST', 'hold/' + h.id + '/release')).status, 403);
  });
  it('holds the files in the uploads bucket, sends them with the message, and deletes them after the send', async () => {
    const data = Buffer.from('%PDF-1.4 hello').toString('base64');
    const h = (await hold({ files: [{ name: 'plan.pdf', mime: 'application/pdf', data }] })).data;
    assert.equal(env.UPLOADS.objects.size, 1);
    assert.ok(![...env.UPLOADS.objects.keys()].some((k) => !k.startsWith('mail-hold/' + h.id + '/')));
    assert.ok(!d1.db.prepare('SELECT payload FROM hub_mail_held').get().payload.includes(data), 'the bytes are not in D1');
    await releaseHeld(env, ADMIN.email, h.id, fakeGoogle);
    assert.equal(box.sent.length, 1);
    assert.match(Buffer.from(box.sent[0].raw, 'base64url').toString(), /plan\.pdf/);
    assert.equal(env.UPLOADS.objects.size, 0);
  });
  it('Undo deletes the held files', async () => {
    const h = (await hold({ files: [{ name: 'a.txt', mime: 'text/plain', data: Buffer.from('hi').toString('base64') }] })).data;
    assert.equal(env.UPLOADS.objects.size, 1);
    await run('hold/' + h.id, 'DELETE');
    assert.equal(env.UPLOADS.objects.size, 0);
  });
  it('refuses no recipient and a bad address', async () => {
    assert.equal((await hold({ to: [] })).status, 400);
    assert.equal((await hold({ to: ['nope'] })).status, 400);
  });
});

describe('the broader check before send', () => {
  const check = (o) => run('check', 'POST', { to: ['maya@example.org'], subject: 'Hi', files: 0, html: '<p>Hi Maya, thank you.</p>', ...o });
  it('flags an empty body, a long reply-all, an outsider on an internal thread and a likely misspelled first name', () => {
    const base = { html: '<p>Hi Maia, thanks.</p>', subject: 's', files: 0, to: [], partnerName: 'Maya Okafor', lastGift: 0, quotedAmounts: [] };
    assert.ok(know.writingCheck({ ...base, html: '<p> </p>' }).some((w) => w.code === 'empty'));
    assert.ok(know.writingCheck({ ...base, recipients: 12 }).some((w) => w.code === 'bulk'));
    assert.ok(know.writingCheck({ ...base, threadInternal: true, external: ['pat@example.org'] }).some((w) => w.code === 'external'));
    const codes = know.writingCheck(base).map((w) => w.code);
    assert.ok(codes.includes('typo') && !codes.includes('name'));
  });
  it('says nothing when nothing is wrong', async () => {
    assert.deepEqual((await check({})).data.warnings, []);
  });
});

describe('the batch of conversations for read-ahead', () => {
  it('parses the multipart answer from Gmail and leaves a failed part to be read the ordinary way', async () => {
    const { parseBatch } = await import('../functions/_lib/mail/gmail.ts');
    const part = (i, status, json) => `--b1
Content-Type: application/http
Content-ID: <response-item${i}>

HTTP/1.1 ${status} X
Content-Type: application/json

${json}
`;
    const text = part(0, 200, '{"id":"t1","messages":[]}') + part(1, 404, '{"error":{}}') + part(2, 200, '{"id":"t3"}') + '--b1--';
    const m = parseBatch(text, 'multipart/mixed; boundary=b1', ['t1', 't2', 't3']);
    assert.deepEqual([...m.keys()], ['t1', 't3']);
  });
  it('answers up to 20 conversations in one call, each built as the conversation route builds it', async () => {
    const r = await run('threads/batch', 'POST', { ids: ['tpartner1', 'tstaff001', 'bad id', 'tlong00001'] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.threads.map((t) => t.id).sort(), ['tlong00001', 'tpartner1', 'tstaff001']);
    assert.ok(r.data.threads[0].thread.messages.length >= 1);
    assert.ok('partners' in r.data.threads[0]);
  });
});

describe('removing the saved copy', () => {
  it('disconnecting Google deletes every saved row, answer and snooze for the person', async () => {
    d1.exec(read('db/mail-cache.sql'));
    await run('smart/overview');
    await run('threads?label=INBOX');
    d1.db.prepare("INSERT INTO hub_mail_snooze (email, thread_id, until, created_at) VALUES (?, 't1', 'x', 'x')").run(ADMIN.email);
    const google = await import('../functions/_lib/hub/google.ts');
    const n = () => ['hub_mail_rows', 'hub_mail_sync', 'hub_mail_class', 'hub_mail_snooze'].map((t) => d1.db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n);
    assert.ok(n().every((x) => x > 0), JSON.stringify(n()));
    await google.revoke(env, ADMIN.email);
    assert.deepEqual(n(), [0, 0, 0, 0]);
  });
});
