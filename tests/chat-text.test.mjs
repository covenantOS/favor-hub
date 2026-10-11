// Favor Chat text rules: mention tokens, the Favor Brain trigger, link recognition, search patterns. Pure functions, made-up names.
import assert from 'node:assert/strict';
import test from 'node:test';
import './support/resolve-ts.mjs';

const t = await import('../functions/_lib/chat/text.ts');

test('mentions: people, @channel and the Brain are read from tokens', () => {
  const m = t.parseMentions('Hi <@ada@favorintl.org> and <@BO@favorintl.org>, <@channel> please read. <@ada@favorintl.org> again');
  assert.deepEqual(m.people, ['ada@favorintl.org', 'bo@favorintl.org']);
  assert.equal(m.everyone, true);
  assert.equal(m.brain, false);
  assert.deepEqual(t.parseMentions('nothing here').people, []);
  assert.equal(t.parseMentions('<@all>').everyone, true);
});

test('mentions: a bare @ with a name is not a mention token', () => {
  assert.deepEqual(t.parseMentions('email me at ada@favorintl.org or @ada').people, []);
});

test('Brain trigger: the token, the words by hand, and nothing else', () => {
  assert.equal(t.detectBrain('<@brain> how many partners'), true);
  assert.equal(t.detectBrain('hey @Favor Brain how many partners'), true);
  assert.equal(t.detectBrain('@favor-brain, count them'), true);
  assert.equal(t.detectBrain('@brain count them'), true);
  assert.equal(t.detectBrain('the brain is a muscle'), false);
  assert.equal(t.detectBrain('mail brain@favorintl.org'), false);
  assert.equal(t.detectBrain('@brainstorm tomorrow'), false);
  assert.equal(t.parseMentions('@Favor Brain what is up').brain, true);
});

test('Brain question: the address to it comes out, other mentions turn into plain names', () => {
  assert.equal(t.brainQuestion('<@brain> how many gifts came in this week?'), 'how many gifts came in this week?');
  assert.equal(t.brainQuestion('@Favor Brain: list partners near Tampa'), 'list partners near Tampa');
  assert.equal(t.brainQuestion('<@brain> did <@ada@favorintl.org> close it?'), 'did @ada close it?');
  assert.equal(t.brainQuestion('<@brain>'), '');
  assert.ok(t.brainQuestion('<@brain> ' + 'x'.repeat(900)).length <= 600);
});

test('bodies are trimmed, stripped of control characters and capped', () => {
  assert.equal(t.cleanBody('  hello\u0000 world \r\n'), 'hello world');
  assert.equal(t.cleanBody('a\r\nb'), 'a\nb');
  assert.equal(t.cleanBody(null), '');
  assert.equal(t.cleanBody('x'.repeat(5000)).length, t.MAX_BODY);
});

test('links: hub clip and meeting addresses are recognised, others are not', () => {
  const hosts = ['dash.favorintl.org'];
  const clip = 'a'.repeat(32);
  const meet = '0123456789abcdef01234567';
  assert.deepEqual(t.classifyUrl(`https://dash.favorintl.org/c/${clip}`, hosts), { type: 'clip', id: clip });
  assert.deepEqual(t.classifyUrl(`https://dash.favorintl.org/c/${clip}/`, hosts), { type: 'clip', id: clip });
  assert.deepEqual(t.classifyUrl(`https://dash.favorintl.org/meet/room/?m=${meet}`, hosts), { type: 'meeting', id: meet });
  assert.deepEqual(t.classifyUrl(`https://dash.favorintl.org/meet/notes/?m=${meet}`, hosts), { type: 'meeting', id: meet });
  assert.equal(t.classifyUrl(`https://evil.example/c/${clip}`, hosts), null);
  assert.equal(t.classifyUrl('https://dash.favorintl.org/c/short', hosts), null);
  assert.equal(t.classifyUrl('not a url', hosts), null);
  assert.deepEqual(t.urlsIn('see https://a.example/x, and (https://b.example/y). Done.'), ['https://a.example/x', 'https://b.example/y']);
});

test('search patterns drop wildcards and join words', () => {
  assert.equal(t.likePattern('Grant  deadline'), '%grant%deadline%');
  assert.equal(t.likePattern('50%_off\\'), '%50%off%');
});

test('channel names and direct message keys', () => {
  assert.equal(t.channelSlug('  Grants Team!! '), 'grants-team');
  assert.equal(t.channelSlug('***'), '');
  assert.equal(t.channelSlug('a'.repeat(60)).length, 40);
  assert.equal(t.dmKey(['Bo@x.org', 'ada@x.org', 'bo@x.org']), 'ada@x.org,bo@x.org');
});

test('reaction emoji are emoji and nothing else', () => {
  assert.ok(t.EMOJI_OK.test('👍'));
  assert.ok(t.EMOJI_OK.test('❤️'));
  assert.ok(!t.EMOJI_OK.test('<script>'));
  assert.ok(!t.EMOJI_OK.test('abc'));
  assert.ok(!t.EMOJI_OK.test(''));
});

test('bell lines turn tokens into names and cut long text', () => {
  const names = (id) => id.split('@')[0];
  assert.equal(t.plainLine('hi <@ada@favorintl.org> <@brain> <@channel>', names), 'hi @ada @Favor Brain @channel');
  assert.ok(t.plainLine('word '.repeat(80), names, 40).length <= 40);
});
