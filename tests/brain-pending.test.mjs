// Run with: npm test
//
// A Favor Brain question is never lost: the proxy saves it as a pending turn the moment it arrives, finishes
// the answer under waitUntil even when the page has gone, stores the answer (or the error) on the same turn,
// removes the Brain's own scratch copy, and lists the chat as answering until it lands. A pending turn older
// than four minutes reads as an error. The connect popup's "seen" mark is kept per person. Made-up data only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let proxy, chat, prefs, d1, env;
const sql = (f) => readFileSync(new URL('../db/' + f, import.meta.url), 'utf8');
const call = (path, body, email = 'ada@favorintl.org') => new Request('https://hub.test/api/brain/' + path, { method: 'POST', body: JSON.stringify(body), headers: { 'X-Hub-Email': email, 'X-Hub-Name': 'Ada', 'X-Hub-Via': 'google', 'Content-Type': 'application/json' } });
const realFetch = globalThis.fetch;
let brain; // what the stand-in Brain does with each /hub/ask

before(async () => {
  d1 = memoryD1();
  d1.exec(sql('chat.sql'));
  d1.exec(sql('prefs.sql'));
  env = { DB: d1, BRAIN_HUB_KEY: 'k', BRAIN_URL: 'https://brain.test' };
  proxy = await import('../functions/api/brain/[[path]].ts');
  chat = await import('../functions/_lib/hub/chat.ts');
  prefs = await import('../functions/api/brain/prefs.ts');
  globalThis.fetch = async (url, init) => brain(String(url), init);
});
process.on('exit', () => {
  globalThis.fetch = realFetch;
});

const answer = (b, scratch) => {
  // The real Brain files its own copy of the turn under the id it was given.
  const now = new Date().toISOString();
  d1.db.prepare('INSERT INTO brain_threads (id,email,title,pinned,made_at,changed_at) VALUES (?,?,?,0,?,?)').run(scratch, 'ada@favorintl.org', b.question, now, now);
  d1.db.prepare('INSERT INTO brain_turns (thread_id,n,question,answer_json,at,ref) VALUES (?,?,?,?,?,?)').run(scratch, 1, b.question, '{}', now, 'r1');
  return new Response(JSON.stringify({ ok: true, ref: 'r1', turn: 1, asked_as: b.question, intent: 'x', outcome: 'ok', blocks: [{ type: 'table', rows: Array.from({ length: 20 }, (_, i) => ({ i })), preview: 8 }], follow: [], lists: [] }), { status: 200 });
};

describe('pending turns', () => {
  it('saves the question before the Brain answers and keeps the answer on the same turn', async () => {
    const jobs = [];
    let seenDuringAnswer = null;
    brain = async (_u, init) => {
      const b = JSON.parse(init.body);
      seenDuringAnswer = d1.db.prepare("SELECT t.question, t.answer_json FROM brain_turns t WHERE t.thread_id = 'c_aaaa1111'").get();
      return answer(b, b.conv);
    };
    const res = await proxy.onRequest({ request: call('ask', { question: 'who gave most?', conv: 'c_aaaa1111', v: 2 }), env, params: { path: ['ask'] }, waitUntil: (p) => jobs.push(p) });
    assert.equal(res.status, 200);
    assert.equal(seenDuringAnswer.question, 'who gave most?', 'the question was stored before the Brain was asked');
    assert.equal(JSON.parse(seenDuringAnswer.answer_json).pending, 1);
    await Promise.all(jobs);
    const turns = d1.db.prepare("SELECT n, question, answer_json, ref FROM brain_turns WHERE thread_id = 'c_aaaa1111'").all();
    assert.equal(turns.length, 1, 'one turn, no duplicate from the Brain');
    const a = JSON.parse(turns[0].answer_json);
    assert.equal(a.pending, undefined);
    assert.equal(a.blocks[0].rows.length, 8, 'rows behind a list are trimmed to the preview');
    assert.equal(turns[0].ref, 'r1');
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_threads WHERE id <> 'c_aaaa1111'").get().n, 0, 'the scratch chat is gone');
    assert.equal(JSON.parse(await res.text()).conv, 'c_aaaa1111');
  });

  it('finishes the answer even when nobody waits for the response', async () => {
    const jobs = [];
    let release;
    const gate = new Promise((r) => (release = r));
    brain = async (_u, init) => {
      await gate;
      const b = JSON.parse(init.body);
      return answer(b, b.conv);
    };
    const waiting = proxy.onRequest({ request: call('ask', { question: 'slow one', conv: 'c_bbbb2222', v: 2 }), env, params: { path: ['ask'] }, waitUntil: (p) => jobs.push(p) });
    await new Promise((r) => setTimeout(r, 20));
    const listed = await chat.listThreads(env, 'ada@favorintl.org');
    assert.equal(listed.find((t) => t.id === 'c_bbbb2222').pending, 1, 'listed as answering');
    const open = await chat.getThread(env, 'ada@favorintl.org', 'c_bbbb2222');
    assert.equal(open.turns[0].answer.pending, 1);
    release();
    void waiting; // the page is gone; the registered job still runs to the end
    await Promise.all(jobs);
    const after = await chat.getThread(env, 'ada@favorintl.org', 'c_bbbb2222');
    assert.equal(after.turns[0].answer.outcome, 'ok');
    assert.equal((await chat.listThreads(env, 'ada@favorintl.org')).find((t) => t.id === 'c_bbbb2222').pending, 0);
  });

  it('stores a Brain error on the turn instead of losing it', async () => {
    const jobs = [];
    brain = async () => new Response(JSON.stringify({ ok: false, error: 'ask', ref: 'r9', message: 'Something went wrong.' }), { status: 500 });
    const res = await proxy.onRequest({ request: call('ask', { question: 'will fail', conv: 'c_cccc3333' }), env, params: { path: ['ask'] }, waitUntil: (p) => jobs.push(p) });
    assert.equal(res.status, 500);
    await Promise.all(jobs);
    const t = await chat.getThread(env, 'ada@favorintl.org', 'c_cccc3333');
    assert.equal(t.turns[0].answer.error, 'Something went wrong.');
  });

  it('does not write into another person chat', async () => {
    const jobs = [];
    brain = async (_u, init) => {
      const b = JSON.parse(init.body);
      return answer(b, 'c_scr' + Math.random().toString(36).slice(2, 6));
    };
    await proxy.onRequest({ request: call('ask', { question: 'mine', conv: 'c_aaaa1111' }, 'ben@favorintl.org'), env, params: { path: ['ask'] }, waitUntil: (p) => jobs.push(p) });
    await Promise.all(jobs);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM brain_turns WHERE thread_id = 'c_aaaa1111' AND question = 'mine'").get().n, 0);
  });

  it('reads a pending turn older than four minutes as an error', async () => {
    const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    d1.db.prepare("INSERT INTO brain_threads (id,email,title,pinned,made_at,changed_at) VALUES ('c_old11111','ada@favorintl.org','t',0,?,?)").run(old, old);
    d1.db.prepare("INSERT INTO brain_turns (thread_id,n,question,answer_json,at,ref) VALUES ('c_old11111',1,'q','{\"pending\":1}',?,NULL)").run(old);
    const t = await chat.getThread(env, 'ada@favorintl.org', 'c_old11111');
    assert.match(t.turns[0].answer.error, /did not finish/);
    assert.equal((await chat.listThreads(env, 'ada@favorintl.org')).find((x) => x.id === 'c_old11111').pending, 0);
  });
});

describe('connect popup memory', () => {
  const get = (email) => prefs.onRequestGet({ request: call('prefs', {}, email), env });
  const post = (key, email) => prefs.onRequestPost({ request: call('prefs', { key }, email), env });
  it('keeps the mark per person', async () => {
    assert.deepEqual((await (await get('ada@favorintl.org')).json()).seen, []);
    assert.equal((await post('connect_seen', 'ada@favorintl.org')).status, 200);
    await post('connect_seen', 'ada@favorintl.org');
    assert.deepEqual((await (await get('ada@favorintl.org')).json()).seen, ['connect_seen']);
    assert.deepEqual((await (await get('ben@favorintl.org')).json()).seen, []);
    assert.equal((await post('something_else', 'ada@favorintl.org')).status, 400);
  });
});
