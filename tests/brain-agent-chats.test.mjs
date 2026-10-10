// Run with: npm test
//
// Favor Brain: a chat the agent key or a script session starts is filed as 'agent' and never listed in the
// person's sidebar, search included. A chat the person starts in the browser is listed as before. Made-up questions only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let chat;
let env;
const sql = readFileSync(new URL('../db/chat.sql', import.meta.url), 'utf8');
const who = 'ada@favorintl.org';

before(async () => {
  const d1 = memoryD1();
  d1.exec(sql);
  env = { DB: d1 };
  chat = await import('../functions/_lib/hub/chat.ts');
});

describe('agent chats stay out of the sidebar', () => {
  it('lists only the person chats, and search does not find agent chats', async () => {
    await chat.startTurn(env, who, 'c_agent001', 'How is Favor doing this year', 'agent');
    await chat.startTurn(env, who, 'c_person01', 'Tell me about a partner', 'person');
    const listed = await chat.listThreads(env, who);
    assert.deepEqual(listed.map((t) => t.id), ['c_person01']);
    const found = await chat.listThreads(env, who, 'Favor doing');
    assert.equal(found.length, 0, 'an agent chat is not found by search');
  });

  it('a default start is a person chat', async () => {
    await chat.startTurn(env, who, 'c_person02', 'What can you do');
    const ids = (await chat.listThreads(env, who)).map((t) => t.id).sort();
    assert.deepEqual(ids, ['c_person01', 'c_person02']);
  });
});
