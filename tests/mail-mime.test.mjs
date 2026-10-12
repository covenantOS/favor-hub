// The message FavorOS hands Gmail to send, and the cleaning of a received message before the page shows it. Invented text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const { buildMime, addr, word, htmlToText, validEmail } = await import('../functions/_lib/mail/mime.ts');
const { sanitizeHtml, textToHtml } = await import('../functions/_lib/mail/sanitize.ts');
const { parseAddrs, shapeThreadRow } = await import('../functions/_lib/mail/gmail.ts');

const base = { from: { name: 'Ada Admin', email: 'ada@favorintl.org' }, to: [{ name: '', email: 'cy@favorintl.org' }], cc: [], bcc: [], subject: 'Hello', html: '<p>Hi <b>Cy</b></p>' };

test('a plain message is multipart/alternative with a text copy and an HTML copy, both base64', () => {
  const m = buildMime(base);
  assert.match(m, /Content-Type: multipart\/alternative; boundary="fos_/);
  const parts = m.split(/--fos_[0-9a-f]+(?:--)?/).filter((p) => p.includes('Content-Transfer-Encoding'));
  assert.equal(parts.length, 2);
  assert.equal(Buffer.from(parts[0].split('\r\n\r\n')[1], 'base64').toString(), 'Hi Cy');
  assert.equal(Buffer.from(parts[1].split('\r\n\r\n')[1], 'base64').toString(), '<p>Hi <b>Cy</b></p>');
  assert.ok(!/Bcc:/.test(m));
});

test('names and subjects outside ASCII are encoded, and a quote in a name is escaped', () => {
  assert.equal(word('Hello'), 'Hello');
  assert.equal(word('Gr\u00fc\u00dfe'), '=?UTF-8?B?' + Buffer.from('Gr\u00fc\u00dfe').toString('base64') + '?=');
  assert.equal(addr({ name: 'Lee "Bud" Park', email: 'bud@example.org' }), '"Lee \\"Bud\\" Park" <bud@example.org>');
  assert.match(buildMime({ ...base, subject: 'Caf\u00e9 visit' }), /Subject: =\?UTF-8\?B\?/);
});

test('a header cannot be split to smuggle another header in', () => {
  const m = buildMime({ ...base, subject: 'Hi\r\nBcc: thief@example.org', to: [{ name: 'A\r\nBcc: x@example.org', email: 'cy@favorintl.org\r\nBcc: y@example.org' }] });
  const head = m.split('\r\n\r\n')[0];
  assert.equal(head.split('\r\n').filter((l) => /^Bcc:/i.test(l)).length, 0);
});

test('files make it multipart/mixed, in lines of 76 characters', () => {
  const m = buildMime({ ...base, files: [{ name: 'a b.pdf', mime: 'application/pdf', data: new Uint8Array(200).fill(65) }] });
  assert.match(m, /Content-Type: multipart\/mixed/);
  assert.match(m, /Content-Disposition: attachment; filename="a b\.pdf"/);
  assert.ok(m.split('\r\n').every((l) => l.length <= 100));
});

test('the text copy keeps links and line breaks', () => {
  assert.equal(htmlToText('<p>See <a href="https://example.org/x">the page</a></p><ul><li>One</li><li>Two</li></ul>'), 'See the page (https://example.org/x)\n- One\n- Two');
});

test('addresses: valid and not', () => {
  assert.ok(validEmail('a.b+c@example.org'));
  for (const bad of ['', 'a@b', 'a b@example.org', 'a@example.org, b@example.org', '<a@example.org>']) assert.ok(!validEmail(bad), bad);
});

test('an address header splits on commas outside quotes', () => {
  assert.deepEqual(parseAddrs('"Park, Lee" <LEE@example.org>, sam@example.org, Kim <kim@example.org>'), [{ name: 'Park, Lee', email: 'lee@example.org' }, { name: '', email: 'sam@example.org' }, { name: 'Kim', email: 'kim@example.org' }]);
});

test('a received message loses scripts, frames, forms, handlers and script links, and keeps its look', () => {
  const dirty = '<div style="color:red" onmouseover="x()">Hi<script>bad()</script><iframe src="https://x.example"></iframe><form action="/x"><input name="a"></form><a href="JaVaScRiPt:alert(1)">l</a><a href="https://example.org">ok</a><img src="data:text/html;base64,AAAA"><img src="https://example.org/a.png" onerror="x()"><style>@import url(x.css); p{color:blue}</style></div>';
  const clean = sanitizeHtml(dirty);
  assert.ok(!/script|iframe|<form|<input|onmouseover|onerror|javascript:|data:text|@import/i.test(clean), clean);
  assert.match(clean, /style="color:red"/);
  assert.match(clean, /href="https:\/\/example\.org"/);
  assert.match(clean, /src="https:\/\/example\.org\/a\.png"/);
  assert.match(clean, /p\{color:blue\}/);
});

test('an inline picture with no matching file is dropped, not left pointing nowhere', () => {
  assert.equal(sanitizeHtml('<img src="cid:gone" alt="x">', () => null), '<img alt="x">');
  assert.equal(sanitizeHtml('<img src="cid:a1">', (c) => '/api/mail/x/' + c), '<img src="/api/mail/x/a1">');
});

test('plain text mail is escaped, links are made, quoted lines become a quote', () => {
  const h = textToHtml('Hi <b>\nhttps://example.org/a?b=1\n> earlier\n> lines');
  assert.match(h, /Hi &lt;b&gt;/);
  assert.match(h, /<a href="https:\/\/example\.org\/a\?b=1">/);
  assert.match(h, /<blockquote class="gmail_quote">earlier<br>lines<\/blockquote>/);
});

test('sent mail in the list shows who it went to', () => {
  const h = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
  const row = shapeThreadRow({ id: 't1', historyId: '1', messages: [{ id: 'm1', labelIds: ['SENT'], internalDate: '1760000000000', snippet: 's', payload: { mimeType: 'text/plain', headers: h({ From: 'Ada <ada@favorintl.org>', To: 'Cy Writer <cy@favorintl.org>', Subject: 'Plan' }) } }] }, 'ada@favorintl.org');
  assert.deepEqual(row.people, [{ name: 'To: Cy Writer', email: 'cy@favorintl.org' }]);
  assert.equal(row.unread, false);
});
