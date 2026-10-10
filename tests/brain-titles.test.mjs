// Run with: npm test
//
// Favor Brain chat titles: the model titles a chat after its first answer and every third turn, a title the person
// typed is never overwritten, and an admin backfill titles chats made before the column. Made-up questions only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let chat;
let titles;
let backfill;
let d1;
let env;
const ai = (reply) => ({ run: async () => ({ response: reply }) });
const ADA = 'ada@favorintl.org';

before(async () => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/chat.sql', import.meta.url), 'utf8'));
  d1.exec(readFileSync(new URL('../db/chat-titles.sql', import.meta.url), 'utf8'));
  env = { DB: d1, AI: ai('2026 giving by team') };
  chat = await import('../functions/_lib/hub/chat.ts');
  titles = await import('../functions/_lib/hub/chat-title.ts');
  backfill = await import('../functions/api/brain/titles-backfill.ts');
});

const now = () => new Date().toISOString();
async function addChat(id, first, extra = []) {
  await d1.db.prepare('INSERT INTO brain_threads (id, email, title, pinned, made_at, changed_at) VALUES (?,?,?,0,?,?)').run(id, ADA, chat.titleOf(first), now(), now());
  let n = 1;
  for (const q of [first, ...extra]) {
    await d1.db.prepare('INSERT INTO brain_turns (thread_id, n, question, answer_json, at, ref) VALUES (?,?,?,?,?,?)').run(id, n++, q, '{"blocks":[]}', now(), 'r');
  }
}
const titleOfChat = async (id) => ({ ...d1.db.prepare('SELECT title, title_by FROM brain_threads WHERE id = ?').get(id) });

describe('title rules', () => {
  it('titles on turn 1, then on turns 4, 7 and 10', () => {
    const yes = [1, 4, 7, 10].map((n) => titles.shouldTitle(n));
    const no = [2, 3, 5, 6, 8].map((n) => titles.shouldTitle(n));
    assert.deepEqual(yes, [true, true, true, true]);
    assert.deepEqual(no, [false, false, false, false, false]);
  });

  it('keeps 2 to 5 word titles and drops KEEP, dashes and quotes', () => {
    assert.equal(titles.cleanTitle('"2026 giving by team."'), '2026 giving by team');
    assert.equal(titles.cleanTitle('Lookup 15032, Twila Adams'), 'Lookup 15032, Twila Adams');
    assert.equal(titles.cleanTitle('KEEP'), null);
    assert.equal(titles.cleanTitle('Giving \u2014 this year'), null);
    assert.equal(titles.cleanTitle('Giving'), null);
    assert.equal(titles.cleanTitle('one two three four five six'), null);
    assert.equal(titles.cleanTitle('Giving ' + 'x'.repeat(60)), null);
  });

  it('treats a title as editable only when the Brain set it or it is still the default', () => {
    assert.equal(titles.editable({ title: 'Anything', title_by: 'hand' }, 'Anything'), false);
    assert.equal(titles.editable({ title: 'Model title', title_by: 'auto' }, 'x'), true);
    assert.equal(titles.editable({ title: 'How is giving this year', title_by: null }, 'How is giving this year?'), true);
    assert.equal(titles.editable({ title: 'My own name', title_by: null }, 'How is giving this year?'), false);
  });
});

describe('retitling', () => {
  it('writes a model title after the first answer and marks it auto', async () => {
    await addChat('c_titl0001', 'How is giving this year?');
    await titles.retitle(env, ADA, 'c_titl0001', 1);
    assert.deepEqual(await titleOfChat('c_titl0001'), { title: '2026 giving by team', title_by: 'auto' });
  });

  it('never overwrites a title the person typed', async () => {
    await addChat('c_hand0002', 'Who gave in March?');
    await chat.patchThread(env, ADA, 'c_hand0002', { title: 'March donors list' });
    await titles.retitle(env, ADA, 'c_hand0002', 1);
    assert.deepEqual(await titleOfChat('c_hand0002'), { title: 'March donors list', title_by: 'hand' });
  });

  it('keeps the title when the model says KEEP', async () => {
    env.AI = ai('KEEP');
    await addChat('c_keep0003', 'How is giving this year?', ['and by team?', 'and last year?']);
    await d1.db.prepare("UPDATE brain_threads SET title = 'Giving this year', title_by = 'auto' WHERE id = 'c_keep0003'").run();
    await titles.retitle(env, ADA, 'c_keep0003', 4);
    assert.equal((await titleOfChat('c_keep0003')).title, 'Giving this year');
    env.AI = ai('2026 giving by team');
  });

  it('a model that does not answer leaves the default title alone', async () => {
    await addChat('c_none0004', 'Lookup 15032');
    env.AI = { run: async () => { throw new Error('down'); } };
    await titles.retitle(env, ADA, 'c_none0004', 1);
    assert.deepEqual(await titleOfChat('c_none0004'), { title: 'Lookup 15032', title_by: null });
    env.AI = ai('2026 giving by team');
  });
});

describe('backfill', () => {
  it('titles default chats, marks typed titles hand, and only admins may run it', async () => {
    await addChat('c_back0005', 'Giving by team in 2026?');
    await addChat('c_back0006', 'Partner list for Ohio');
    await d1.db.prepare("UPDATE brain_threads SET title = 'Ohio list for Maria' WHERE id = 'c_back0006'").run();
    const req = (role) => new Request('https://hub.test/api/brain/titles-backfill', { method: 'POST', headers: { 'X-Hub-Email': ADA, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google', 'X-Hub-Role': role } });
    const denied = await backfill.onRequestPost({ request: req('staff'), env: { ...env, HUB_ADMINS: 'will@favorintl.org' } });
    assert.equal(denied.status, 403);
    const res = await backfill.onRequestPost({ request: req('admin'), env });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal((await titleOfChat('c_back0005')).title_by, 'auto');
    assert.deepEqual(await titleOfChat('c_back0006'), { title: 'Ohio list for Maria', title_by: 'hand' });
  });
});
