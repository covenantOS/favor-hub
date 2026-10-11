import test from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { etDate, fname, isDefaultTitle, dedupeLines, notesDocHtml } = await import('../functions/_lib/meetdrive.ts');
const { normPhone, parseTarget, matchPeople, smsText, textInvite } = await import('../functions/_lib/meetinvite.ts');

test('drive file names start with the Eastern date, not the UTC date', () => {
  // 9:23 PM Eastern on Oct 10 is already Oct 11 in UTC.
  assert.equal(etDate('2026-10-11T01:23:30.846Z'), '2026-10-10');
  const m = { title: "Will's meeting", started_at: '2026-10-11T01:23:30.846Z', created_at: '2026-10-11T01:23:28Z' };
  assert.equal(fname(m, 1, 1, 'webm', 'audio'), "2026-10-10 Will's meeting, audio.webm");
  assert.equal(fname(m, 1, 1, 'webm', 'video'), "2026-10-10 Will's meeting, video.webm");
  assert.equal(fname(m, 2, 2, 'webm', 'audio'), "2026-10-10 Will's meeting, audio part 2.webm");
  assert.equal(fname({ ...m, title: 'a/b: c' }, 1, 1, 'webm', 'audio'), '2026-10-10 a b c, audio.webm');
});

test('a placeholder title is replaced by the notes title, a chosen one is kept', () => {
  assert.ok(isDefaultTitle('Meeting'));
  assert.ok(isDefaultTitle("Will's meeting"));
  assert.ok(isDefaultTitle(''));
  assert.ok(!isDefaultTitle('Staff Meeting Prep'));
  assert.ok(!isDefaultTitle('Introduction'));
});

test('the same words inside ten seconds are kept once', () => {
  const l = (t, text, who = '') => ({ t, text, who });
  const out = dedupeLines([l(25, "Okay, so, I'm going to go ahead and do it."), l(21, "Okay, so, I'm going to go ahead and do it."), l(51, 'Hello.')]);
  assert.deepEqual(out.map((x) => x.t), [21, 51]);
  // The same words a minute later are a new line.
  assert.equal(dedupeLines([l(1, 'Yes.'), l(70, 'Yes.')]).length, 2);
  assert.equal(dedupeLines([l(1, 'Yes.'), l(8, 'yes')]).length, 1);
});

test('phone numbers, emails and names are told apart', () => {
  assert.equal(normPhone('(813) 555-0100'), '+18135550100');
  assert.equal(normPhone('1-813-555-0100'), '+18135550100');
  assert.equal(normPhone('+256 700 123456'), '+256700123456');
  assert.equal(normPhone('12345'), '');
  assert.equal(normPhone('ann@x.org'), '');
  assert.deepEqual(parseTarget(' Ann@Example.org '), { kind: 'email', email: 'ann@example.org' });
  assert.deepEqual(parseTarget('813 555 0100'), { kind: 'phone', phone: '+18135550100' });
  assert.deepEqual(parseTarget('Jane Doe'), { kind: 'name', query: 'Jane Doe' });
  assert.equal(parseTarget('not@valid'), null);
  assert.equal(parseTarget(''), null);
});

test('a typed name matches every word, exact name first', () => {
  const dir = [{ name: 'Jane Doe', email: 'jane@favorintl.org' }, { name: 'Jane Doerr', email: 'jd@favorintl.org' }, { name: 'Sam Lee', email: 'sam@favorintl.org' }];
  assert.deepEqual(matchPeople(dir, 'jane').map((p) => p.name), ['Jane Doe', 'Jane Doerr']);
  assert.deepEqual(matchPeople(dir, 'jane doe').map((p) => p.name), ['Jane Doe', 'Jane Doerr']);
  assert.deepEqual(matchPeople(dir, 'sam lee').length, 1);
  assert.equal(matchPeople(dir, 'zed').length, 0);
});

test('the text message carries the host, the title and the link', () => {
  assert.equal(smsText('Will Hamilton', 'Staff call', 'https://x/y'), 'Will Hamilton invited you to Staff call. Join: https://x/y');
});

function stub(replies) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const r = replies.shift() || { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  return { f, calls };
}
const env = { GHL_PIT: 'pit-test', GHL_LOCATION: 'loc1', GHL_URL: 'https://ghl.test' };

test('a dry run only reads and never creates a contact or sends a text', async () => {
  const { f, calls } = stub([{ status: 200, body: { contacts: [] } }]);
  const r = await textInvite(env, '+18135550100', 'Ann', 'hi', true, f);
  assert.equal(r.ok, true);
  assert.equal(r.dry, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Version, '2021-07-28');
  assert.equal(calls[0].headers.Authorization, 'Bearer pit-test');
});

test('a text upserts the contact with the meeting-invite tag, then sends an SMS to that contact', async () => {
  const { f, calls } = stub([{ status: 200, body: { contact: { id: 'c1' } } }, { status: 201, body: { messageId: 'm1' } }]);
  const r = await textInvite(env, '+18135550100', 'Ann', 'Join: https://x', false, f);
  assert.equal(r.ok, true);
  assert.equal(calls[0].url, 'https://ghl.test/contacts/upsert');
  assert.deepEqual(calls[0].body, { locationId: 'loc1', phone: '+18135550100', name: 'Ann', tags: ['meeting-invite'] });
  assert.equal(calls[1].url, 'https://ghl.test/conversations/messages');
  assert.deepEqual(calls[1].body, { type: 'SMS', contactId: 'c1', message: 'Join: https://x' });
});

test('a refused text reports failure and says why', async () => {
  const { f } = stub([{ status: 200, body: { contact: { id: 'c1' } } }, { status: 422, body: {} }]);
  const r = await textInvite(env, '+18135550100', '', 'x', false, f);
  assert.equal(r.ok, false);
  assert.match(r.reason, /422/);
  const none = await textInvite({}, '+18135550100', '', 'x', false, f);
  assert.equal(none.ok, false);
});

test('the notes document escapes text and carries the people, links and speaker names', () => {
  const html = notesDocHtml({
    title: 'Intro <b>', startedAt: '2026-10-11T01:23:30Z', summary: 'We met & agreed.', decisions: [{ t: 5, text: 'Ship it' }], actions: [{ text: 'Send the file', owner: 'Ann', due: 'Friday', t: 9 }],
    chapters: [{ t: 0, title: 'Start' }], transcript: [{ t: 3, who: 'Ann', text: 'Hello <there>' }, { t: 7, text: 'No name' }], people: ['Ann', 'Bo'],
    notesUrl: 'https://dash.favorintl.org/meet/notes/?m=abc', recordingUrls: ['https://drive.google.com/file/d/f1/view'],
  });
  assert.ok(html.includes('Intro &lt;b&gt;'));
  assert.ok(html.includes('We met &amp; agreed.'));
  assert.ok(html.includes('Owner: Ann'));
  assert.ok(html.includes('<b>Ann:</b> Hello &lt;there&gt;'));
  assert.ok(html.includes('href="https://dash.favorintl.org/meet/notes/?m=abc"'));
  assert.ok(html.includes('https://drive.google.com/file/d/f1/view'));
  assert.ok(html.includes('Eastern'));
  assert.ok(!html.includes('—'));
});
