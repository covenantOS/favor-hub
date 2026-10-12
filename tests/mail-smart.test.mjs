// Smart Mail through the router with stand-ins for Gmail, Workers AI (Clef and the text model), the partner copy and the database:
// the rail count as Gmail's Primary tab, filters and oldest-first sorting, categories and the Needs you view, Waiting on reply,
// clean-up suggestions, summaries and suggested replies, the partner card, and changes to many conversations. Every person,
// address and message here is invented.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { handle, mailUnreadCount, forgetCount } = await import('../functions/_lib/mail/route.ts');
const { ruleCat, tidy, parseReplies, freshText, guessAsk } = await import('../functions/_lib/mail/smart.ts');
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
  if (p === '/profile') return J({ historyId: '10' });
  if (p === '/history') return J({ history: (box.changed || []).map((id) => ({ messages: [{ threadId: id }] })), historyId: '11' });
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
  env = { DB: d1, GOOGLE_TOKEN_KEY: 'ab'.repeat(32), GOOGLE_CLIENT_SECRET: 'x', GOOGLE_TOKEN_URL: 'https://oauth.test/token' };
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

describe('the unread count', () => {
  it('counts Gmail Primary tab for the badge and reports every tab beside it', async () => {
    const c = await call(ADMIN, 'GET', 'count');
    assert.equal(c.data.unread, 2);
    assert.equal(c.data.all, 7);
    const q = calls.find((x) => x.path === '/threads').q;
    assert.equal(q.get('q'), 'in:inbox is:unread category:primary');
  });

  it('shows the same number in the Inbox label, with the all-tabs number beside it', async () => {
    const l = (await call(ADMIN, 'GET', 'labels')).data.labels.find((x) => x.id === 'INBOX');
    assert.equal(l.unread, 2);
    assert.equal(l.unreadAll, 7);
  });

  it('drops after a read in Gmail the next time it is asked, never staying at the old number', async () => {
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 2);
    box.primaryIds = ['tpartner1'];
    box.unreadAll = 6;
    forgetCount(ADMIN.email);
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 1);
  });

  it('a change here clears the saved count so the badge follows at once', async () => {
    await mailUnreadCount(env, ADMIN.email, fakeGoogle);
    box.primaryIds = [];
    const r = await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1', 'tperson01'], action: 'read' });
    assert.equal(r.data.unread, 0);
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 0);
  });

  it('a headers-only grant uses the label count, which cannot search', async () => {
    await grant(ADMIN.email, META);
    forgetCount(ADMIN.email);
    assert.equal(await mailUnreadCount(env, ADMIN.email, fakeGoogle), 7);
  });
});

describe('filters and sorting', () => {
  it('turns the chips into Gmail search words', async () => {
    await call(ADMIN, 'GET', 'threads?label=INBOX&f=unread,starred,files');
    const q = calls.find((x) => x.path === '/threads').q.get('q');
    assert.ok(q.includes('is:unread') && q.includes('is:starred') && q.includes('has:attachment'));
  });

  it('lists oldest first by reading the far end of the list, and pages from there', async () => {
    const all = (await call(ADMIN, 'GET', 'threads?label=INBOX')).data;
    const old = (await call(ADMIN, 'GET', 'threads?label=INBOX&sort=old')).data;
    const ids = old.threads.map((t) => t.id);
    assert.equal(ids[0], all.threads.at(-1).id === ids[0] ? ids[0] : all.threads.at(-1).id);
    const dates = old.threads.map((t) => t.date);
    assert.deepEqual([...dates].sort(), dates);
    assert.equal(old.next, '');
  });

  it('From a partner narrows the inbox to partner senders, with the partner named on the row', async () => {
    const r = (await call(ADMIN, 'GET', 'threads?label=INBOX&f=partner')).data;
    assert.ok(r.threads.length >= 2);
    assert.ok(r.threads.every((t) => t.partner && t.partner.id === '27202'));
  });
});

describe('categories', () => {
  const row = (o) => ({ from: { name: '', email: 'x@y.example' }, labelIds: ['INBOX'], bulk: false, subject: '', snippet: '', ...o });
  it('sorts by rules before any model is asked', () => {
    assert.equal(ruleCat(row({ subject: 'Invitation: prayer @ Mon' }), false, false, '').cat, 'calendar');
    assert.equal(ruleCat(row({}), true, false, '').cat, 'partners');
    assert.equal(ruleCat(row({ from: { name: '', email: 'bo@favorintl.org' } }), false, true, '').cat, 'staff');
    assert.equal(ruleCat(row({ from: { name: '', email: 'noreply@pay.example' }, subject: 'Your receipt', labelIds: ['INBOX', 'CATEGORY_UPDATES'] }), false, false, '').cat, 'receipts');
    assert.equal(ruleCat(row({ bulk: true, labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }), false, false, '').cat, 'newsletters');
    assert.equal(ruleCat(row({ labelIds: ['INBOX', 'CATEGORY_UPDATES'] }), false, false, '').cat, 'notifications');
    assert.deepEqual(ruleCat(row({}), false, false, ''), { cat: 'people', sure: false });
  });

  it('a partner who sends a newsletter stays a newsletter, a partner who writes is a partner', () => {
    assert.equal(ruleCat(row({ bulk: true, labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] }), true, false, '').cat, 'newsletters');
  });

  it('counts every category in the overview and keeps the answers so a second look asks no model', async () => {
    const o = (await call(ADMIN, 'GET', 'smart/overview')).data;
    assert.equal(o.counts.partners.n, 2);
    assert.equal(o.counts.staff.n, 1);
    assert.equal(o.counts.newsletters.n, 3);
    assert.equal(o.counts.receipts.n, 1);
    assert.equal(o.counts.calendar.n, 1);
    assert.equal(o.counts.people.n, 2);
    assert.equal(o.counts.notifications.n, 1);
    const first = aiCalls.length;
    assert.ok(first > 0);
    forgetCount(ADMIN.email);
    await call(ADMIN, 'GET', 'smart/overview');
    assert.equal(aiCalls.length, first);
  });

  it('stores answers and summaries only, never a message body', async () => {
    await call(ADMIN, 'GET', 'smart/overview');
    await call(ADMIN, 'GET', 'threads/tlong00001/assist');
    const rows = d1.db.prepare('SELECT * FROM hub_mail_class').all();
    assert.ok(rows.length > 0);
    const dump = JSON.stringify(rows);
    assert.ok(!dump.includes('Wonderful') && !dump.includes('second week is open'));
    assert.deepEqual(Object.keys(rows[0]).sort(), ['ask', 'at', 'email', 'kind', 'last_mid', 'p', 'summary', 'summary_mid', 'thread_id']);
  });

  it('suggests archiving senders whose mail is all unread, three or more', async () => {
    const o = (await call(ADMIN, 'GET', 'smart/overview')).data;
    assert.equal(o.cleanup.total, 3);
    assert.equal(o.cleanup.senders[0].email, 'news@digest.example');
    assert.equal(o.cleanup.ids.length, 3);
  });

  it('Move to category teaches a sender, and the next look obeys', async () => {
    const w = await call(ADMIN, 'POST', 'smart/move', { senders: ['news@digest.example'], cat: 'partners' });
    assert.equal(w.data.moved, 1);
    const o = (await call(ADMIN, 'GET', 'smart/overview')).data;
    assert.equal(o.counts.partners.n, 5);
    assert.equal((await call(ADMIN, 'POST', 'smart/move', { senders: ['a@b.example'], cat: 'nonsense' })).status, 400);
  });
});

describe('Needs you and Waiting on reply', () => {
  it('lists what asks the person something, oldest first, never a newsletter', async () => {
    const r = (await call(ADMIN, 'GET', 'threads?label=INBOX&view=needs')).data;
    const ids = r.threads.map((t) => t.id);
    assert.ok(ids.includes('tpartner1') && ids.includes('tperson01') && ids.includes('tlong00001'));
    assert.ok(!ids.some((i) => i.startsWith('tnews')));
    const dates = r.threads.map((t) => t.date);
    assert.deepEqual([...dates].sort(), dates);
    assert.ok(r.threads.every((t) => t.ask));
  });

  it('a category view lists only that category', async () => {
    const r = (await call(ADMIN, 'GET', 'threads?label=INBOX&view=cat:newsletters')).data;
    assert.equal(r.threads.length, 3);
    assert.ok(r.threads.every((t) => t.cat === 'newsletters'));
  });

  it('Waiting on reply shows sent mail with no answer after three days, oldest first', async () => {
    const r = (await call(ADMIN, 'GET', 'threads?label=INBOX&view=waiting')).data;
    const ids = r.threads.map((t) => t.id);
    assert.ok(ids.includes('tsent0001') && ids.includes('tsent0003'));
    assert.ok(!ids.includes('tsent0002'));
    assert.ok(r.threads.every((t) => t.waitDays >= 3));
    assert.equal(ids[0], 'tsent0003');
    const days7 = (await call(ADMIN, 'GET', 'threads?label=INBOX&view=waiting&days=7')).data;
    assert.ok(!days7.threads.some((t) => t.id === 'tsent0001'));
  });

  it('guesses from plain words until Clef has read, and Clef without a model falls back to the guess', () => {
    assert.equal(guessAsk({ fromMe: false, bulk: false, draft: false, toMe: true, snippet: 'Can you send it?', subject: '' }), true);
    assert.equal(guessAsk({ fromMe: false, bulk: true, draft: false, toMe: true, snippet: 'Can you send it?', subject: '' }), false);
    assert.equal(guessAsk({ fromMe: true, bulk: false, draft: false, toMe: true, snippet: '?', subject: '' }), false);
  });
});

describe('summary and suggested replies', () => {
  it('writes one line and three short replies in the person voice, with dashes and empty adverbs removed', async () => {
    const a = (await call(ADMIN, 'GET', 'threads/tlong00001/assist')).data;
    assert.ok(a.summary.startsWith('Maya wants the March dates'));
    assert.ok(!/[—–]/.test(a.summary) && !/\bjust\b/i.test(a.summary));
    assert.equal(a.replies.length, 3);
    assert.ok(a.replies.every((r) => !/[—–]/.test(r) && r.startsWith('Hi Maya,')));
    assert.equal(a.partner.id, '27202');
    assert.equal(a.ask, true);
  });

  it('sends the model the newest words without the quoted earlier mail', async () => {
    await call(ADMIN, 'GET', 'threads/tlong00001/assist');
    const text = aiCalls.filter((c) => !/clef/.test(c.model)).map((c) => c.input.messages[1].content).join('\n');
    assert.ok(text.includes('confirm the dates by Friday'));
    assert.ok(!text.includes('> Yes, the second week is open.'));
  });

  it('keeps a saved summary for a second look and writes the replies fresh', async () => {
    await call(ADMIN, 'GET', 'threads/tlong00001/assist');
    const before = aiCalls.filter((c) => /summarize/i.test(c.input.messages?.[0]?.content || '')).length;
    const again = (await call(ADMIN, 'GET', 'threads/tlong00001/assist')).data;
    assert.ok(again.summary);
    assert.equal(again.replies.length, 3);
    assert.equal(before, 1);
  });

  it('offers no replies to mail sent by me or to a newsletter', async () => {
    assert.deepEqual((await call(ADMIN, 'GET', 'threads/tsent0001/assist')).data.replies, []);
    assert.deepEqual((await call(ADMIN, 'GET', 'threads/tnews0001/assist')).data.replies, []);
  });

  it('the helpers: tidy, parseReplies and freshText', () => {
    assert.equal(tidy('Yes — simply fine, the donor said so'), 'Yes, fine, the partner said so');
    assert.deepEqual(parseReplies('noise {"replies":["Hi A,\\nok","Hi A,\\nno"]} tail'), ['Hi A,\nok', 'Hi A,\nno']);
    assert.equal(freshText({ text: 'Thanks.\n\nOn Mon, Bo wrote:\n> old', html: '', snippet: '' }), 'Thanks.');
  });
});

describe('the partner card', () => {
  it('gives lifetime giving, the last gift, who holds the partner and the last contact', async () => {
    const p = (await call(ADMIN, 'GET', 'partner/27202')).data.partner;
    assert.equal(p.total, 4300.5);
    assert.equal(p.count, 12);
    assert.deepEqual(p.last, { amount: 100, date: '2026-10-02', fund: 'General' });
    assert.deepEqual(p.holders, [{ name: 'Grace Lin', type: 'Partner Care' }]);
    assert.equal(p.lastContact.category, 'Phone call');
    assert.equal(p.openActions, 2);
  });

  it('refuses an id that is not a Blackbaud system number', async () => {
    assert.equal((await call(ADMIN, 'GET', 'partner/abc')).status, 404);
  });
});

describe('changes to many conversations', () => {
  it('archives, marks read, stars, labels and trashes each conversation, and answers the new count', async () => {
    for (const [action, extra, want] of [
      ['archive', {}, { removeLabelIds: ['INBOX'], addLabelIds: [] }],
      ['read', {}, { removeLabelIds: ['UNREAD'], addLabelIds: [] }],
      ['unread', {}, { addLabelIds: ['UNREAD'], removeLabelIds: [] }],
      ['star', {}, { addLabelIds: ['STARRED'], removeLabelIds: [] }],
      ['label', { add: ['Label_7'], remove: [] }, { addLabelIds: ['Label_7'], removeLabelIds: [] }],
    ]) {
      box.modified = [];
      const r = await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1', 'tperson01', 'tstaff001'], action, ...extra });
      assert.equal(r.status, 200, action);
      assert.equal(r.data.done, 3);
      assert.equal(box.modified.length, 3);
      assert.deepEqual(box.modified[0].body, want, action);
      assert.equal(typeof r.data.unread, 'number');
    }
    box.modified = [];
    await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1', 'tperson01'], action: 'trash' });
    assert.deepEqual(box.modified.map((m) => m.action), ['trash', 'trash']);
  });

  it('snoozes many at once: out of the inbox now, a snooze row for each', async () => {
    const until = new Date(Date.now() + 2 * DAY).toISOString();
    const r = await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1', 'tperson01'], action: 'snooze', until });
    assert.equal(r.data.done, 2);
    assert.deepEqual(box.modified[0].body.removeLabelIds, ['INBOX']);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_mail_snooze WHERE woke_at IS NULL').get().n, 2);
    assert.equal((await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1'], action: 'snooze', until: '2020-01-01' })).status, 400);
  });

  it('refuses nothing selected, a bad id, an unknown action and more than a hundred', async () => {
    assert.equal((await call(ADMIN, 'POST', 'bulk', { ids: [], action: 'archive' })).status, 400);
    assert.equal((await call(ADMIN, 'POST', 'bulk', { ids: ['../x'], action: 'archive' })).status, 400);
    assert.equal((await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1'], action: 'delete-forever' })).status, 400);
    const many = Array.from({ length: 150 }, (_, i) => 'tmany' + String(i).padStart(4, '0'));
    box.modified = [];
    const r = await call(ADMIN, 'POST', 'bulk', { ids: many, action: 'archive' });
    assert.equal(r.status, 200);
    assert.equal(box.modified.length + r.data.failed, 100);
  });

  it('never changes mail for a read-only grant', async () => {
    await grant(ADMIN.email, 'https://www.googleapis.com/auth/gmail.readonly');
    forgetCount(ADMIN.email);
    box.modified = [];
    const r = await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1'], action: 'archive' });
    assert.equal(r.status, 403);
    assert.equal(box.modified.length, 0);
  });
});

describe('the saved list rows', () => {
  it('the first look reads the newest conversations, the next looks read none, and a change comes in through the history list', async () => {
    const metadata = () => calls.filter((c) => /^\/threads\/t/.test(c.path) && c.q.get('format') === 'metadata').length;
    await call(ADMIN, 'GET', 'threads?label=INBOX');
    assert.ok(metadata() >= 10);
    assert.equal(d1.db.prepare('SELECT history_id FROM hub_mail_sync').get().history_id, '10');
    forgetRows();
    calls = [];
    const again = await call(ADMIN, 'GET', 'threads?label=INBOX');
    assert.equal(calls.filter((c) => c.path.startsWith('/threads')).length, 0, 'a fresh saved inbox needs no Gmail call');
    assert.ok(again.data.threads.length >= 10);
    // twenty seconds later Gmail's history names one changed conversation: only that one is read again
    d1.db.prepare("UPDATE hub_mail_sync SET synced_at = '2020-01-01T00:00:00.000Z'").run();
    box.changed = ['tpartner1'];
    box.threads.tpartner1.messages[0].labelIds = ['INBOX', 'CATEGORY_PERSONAL'];
    box.threads.tpartner1.historyId = '2';
    forgetRows();
    calls = [];
    const after = await call(ADMIN, 'GET', 'threads?label=INBOX');
    assert.equal(metadata(), 1);
    assert.equal(after.data.threads.find((t) => t.id === 'tpartner1').unread, false);
    assert.equal(d1.db.prepare('SELECT history_id FROM hub_mail_sync').get().history_id, '11');
  });
  it('serves the saved inbox as it is while the history catches up, and says so', async () => {
    await call(ADMIN, 'GET', 'threads?label=INBOX');
    d1.db.prepare("UPDATE hub_mail_sync SET synced_at = '2020-01-01T00:00:00.000Z'").run();
    calls = [];
    let job;
    const res = await handle({ request: new Request('https://dash.favorintl.org/api/mail/threads?label=INBOX', { headers: { 'X-Hub-Request': '1' } }), env, user: ADMIN, path: ['threads'], fetcher: fakeGoogle, ai, partners: async () => ({}), waitUntil: (p) => { job = p; } });
    const j = await res.json();
    assert.equal(j.stale, true);
    assert.equal(calls.filter((c) => c.path.startsWith('/threads')).length, 0, 'no list call: the saved inbox answered');
    await job;
    assert.equal(calls.filter((c) => c.path === '/history').length, 1);
  });
  it('a change made through Mail edits the saved row at once', async () => {
    await call(ADMIN, 'GET', 'threads?label=INBOX');
    await call(ADMIN, 'POST', 'threads/tpartner1/modify', { remove: ['UNREAD'] });
    const row = JSON.parse(d1.db.prepare("SELECT row_json FROM hub_mail_rows WHERE thread_id = 'tpartner1'").get().row_json);
    assert.equal(row.unread, false);
    await call(ADMIN, 'POST', 'bulk', { ids: ['tpartner1'], action: 'archive' });
    assert.ok(!JSON.parse(d1.db.prepare("SELECT row_json FROM hub_mail_rows WHERE thread_id = 'tpartner1'").get().row_json).labelIds.includes('INBOX'));
  });
  it('removing a mailbox drops its saved rows', async () => {
    d1.db.prepare("INSERT INTO hub_mail_rows (mailbox, thread_id, hid, row_json, at) VALUES ('x@favorintl.org', 't1', '1', '{}', 'x')").run();
    const { removeBox, addBox } = await import('../functions/_lib/mail/boxes.ts');
    d1.exec(read('db/mail-boxes.sql'));
    await addBox(env, ADMIN.email, 'x@favorintl.org', 'X', 'refresh-x', 'scope');
    await removeBox(env, ADMIN.email, 'x@favorintl.org');
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM hub_mail_rows WHERE mailbox = 'x@favorintl.org'").get().n, 0);
  });
});
