// Run with: npm test
//
// Favor Brain chat history (functions/_lib/hub/chat.ts and the routes on top of it): each person sees
// only their own chats, newest first with pinned on top, search reads titles and the questions inside,
// rename and pin and delete work, a chat 30 days past its last turn is gone, and a table that is not
// there yet reads as an empty list instead of an error. Made-up questions only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let chat;
let history;
let thread;
let d1;
let env;

const sql = readFileSync(new URL('../db/chat.sql', import.meta.url), 'utf8');
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const addThread = (id, email, title, at, pinned = 0) => d1.db.prepare('INSERT INTO brain_threads (id, email, title, pinned, made_at, changed_at) VALUES (?,?,?,?,?,?)').run(id, email, title, pinned, at, at);
const addTurn = (id, n, q, answer = { blocks: [{ type: 'text', md: 'ok' }] }) => d1.db.prepare('INSERT INTO brain_turns (thread_id, n, question, answer_json, at, ref) VALUES (?,?,?,?,?,?)').run(id, n, q, JSON.stringify(answer), new Date().toISOString(), 'r' + n);
const req = (url, init = {}, email = 'ada@favorintl.org') => new Request('https://hub.test' + url, { ...init, headers: { 'X-Hub-Email': email, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google', 'Content-Type': 'application/json', ...(init.headers || {}) } });

before(async () => {
  d1 = memoryD1();
  d1.exec(sql);
  env = { DB: d1 };
  chat = await import('../functions/_lib/hub/chat.ts');
  history = await import('../functions/api/brain/history.ts');
  thread = await import('../functions/api/brain/thread/[id].ts');
  addThread('c_aaaa1111', 'ada@favorintl.org', 'Giving this year', ago(0.1));
  addTurn('c_aaaa1111', 1, 'How is giving this year?');
  addThread('c_bbbb2222', 'ada@favorintl.org', 'Lapsed partners in Ohio', ago(2), 1);
  addTurn('c_bbbb2222', 1, 'List lapsed major partners in Ohio');
  addTurn('c_bbbb2222', 2, 'only the ones held by Region 4');
  addThread('c_cccc3333', 'ben@favorintl.org', 'Ben private chat', ago(1));
  addTurn('c_cccc3333', 1, 'Something only Ben asked');
  addThread('c_dddd4444', 'ada@favorintl.org', 'Old chat', ago(31));
  addTurn('c_dddd4444', 1, 'An old question');
});

describe('chat history', () => {
  it('lists only the signed-in person, pinned first and then newest', async () => {
    const r = await (await history.onRequestGet({ request: req('/api/brain/history'), env })).json();
    assert.equal(r.ok, true);
    assert.deepEqual(r.threads.map((t) => t.id), ['c_bbbb2222', 'c_aaaa1111']);
    assert.equal(r.threads[0].pinned, 1);
  });

  it('deletes a chat 30 days after its last turn, turns included', () => {
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_threads WHERE id = 'c_dddd4444'").get().n, 0);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_turns WHERE thread_id = 'c_dddd4444'").get().n, 0);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_threads WHERE id = 'c_cccc3333'").get().n, 1, 'a newer chat of someone else stays');
  });

  it('searches titles and the questions inside each chat', async () => {
    const byQuestion = await (await history.onRequestGet({ request: req('/api/brain/history?q=region%204'), env })).json();
    assert.deepEqual(byQuestion.threads.map((t) => t.id), ['c_bbbb2222']);
    const byTitle = await (await history.onRequestGet({ request: req('/api/brain/history?q=giving'), env })).json();
    assert.deepEqual(byTitle.threads.map((t) => t.id), ['c_aaaa1111']);
    const none = await (await history.onRequestGet({ request: req("/api/brain/history?q=100%25_%5C"), env })).json();
    assert.deepEqual(none.threads, [], 'search characters are plain text');
  });

  it('does not list or open another person\'s chat', async () => {
    const own = await thread.onRequestGet({ request: req('/api/brain/thread/c_cccc3333'), env, params: { id: 'c_cccc3333' } });
    assert.equal(own.status, 404);
    const ben = await thread.onRequestGet({ request: req('/api/brain/thread/c_cccc3333', {}, 'ben@favorintl.org'), env, params: { id: 'c_cccc3333' } });
    assert.equal(ben.status, 200);
  });

  it('opens a chat with its turns in order and the answer as an object', async () => {
    const r = await (await thread.onRequestGet({ request: req('/api/brain/thread/c_bbbb2222'), env, params: { id: 'c_bbbb2222' } })).json();
    assert.deepEqual(r.turns.map((t) => t.n), [1, 2]);
    assert.equal(r.turns[0].answer.blocks[0].type, 'text');
    assert.equal(r.thread.title, 'Lapsed partners in Ohio');
  });

  it('renames and pins, only for the owner', async () => {
    const patch = (body, email) => thread.onRequestPatch({ request: req('/api/brain/thread/c_aaaa1111', { method: 'PATCH', body: JSON.stringify(body) }, email), env, params: { id: 'c_aaaa1111' } });
    assert.equal((await patch({ title: '  Giving, 2026  ', pinned: true })).status, 200);
    const row = d1.db.prepare("SELECT title, pinned FROM brain_threads WHERE id = 'c_aaaa1111'").get();
    assert.equal(row.title, 'Giving, 2026');
    assert.equal(row.pinned, 1);
    assert.equal((await patch({ title: 'Hijacked' }, 'ben@favorintl.org')).status, 404);
    assert.equal(d1.db.prepare("SELECT title FROM brain_threads WHERE id = 'c_aaaa1111'").get().title, 'Giving, 2026');
    assert.equal((await patch({ title: '   ' })).status, 404, 'an empty title changes nothing');
    await patch({ title: 'x'.repeat(200) });
    assert.equal(d1.db.prepare("SELECT title FROM brain_threads WHERE id = 'c_aaaa1111'").get().title.length, 80);
  });

  it('deletes a chat and its turns, only for the owner', async () => {
    const del = (id, email) => thread.onRequestDelete({ request: req('/api/brain/thread/' + id, { method: 'DELETE' }, email), env, params: { id } });
    assert.equal((await del('c_bbbb2222', 'ben@favorintl.org')).status, 404);
    assert.equal((await del('c_bbbb2222')).status, 200);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_turns WHERE thread_id = 'c_bbbb2222'").get().n, 0);
    assert.equal((await del('not-an-id')).status, 404);
  });

  it('asks a person without a session to sign in', async () => {
    const res = await history.onRequestGet({ request: new Request('https://hub.test/api/brain/history'), env });
    assert.equal(res.status, 401);
  });

  it('reads as an empty list before the tables exist', async () => {
    const empty = memoryD1();
    const res = await history.onRequestGet({ request: req('/api/brain/history'), env: { DB: empty } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).threads, []);
  });

  it('keeps chats for 30 days', () => {
    assert.equal(chat.KEEP_DAYS, 30);
  });
});
