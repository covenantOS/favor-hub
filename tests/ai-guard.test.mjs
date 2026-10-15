// Run with: npm test
//
// The daily AI budget guard (functions/_lib/ai/guard.ts): estimates err high, the cap holds by tier, features that are off by
// default stay off, the kill flag and the tester's closed switch stop every call, the reconciler writes Cloudflare's total over the
// estimate, and the month's extra test units open only for test runs. Stand-in model, D1 and KV; no live call is possible here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let G;
let d1;
let kv;
let calls;
const DAY = '2026-10-12';
const memKv = () => {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => void m.set(k, String(v)) };
};
const model = (reply = { response: 'ok', usage: { prompt_tokens: 100, completion_tokens: 10 } }) => ({
  run: async (m, i) => {
    calls.push(m);
    return reply;
  },
});
const store = () => ({ db: d1, kv });
const dayRow = async () => d1.prepare('SELECT * FROM ai_budget_day WHERE day = ?').bind(DAY).first();

before(async () => {
  G = await import('../functions/_lib/ai/guard.ts');
});

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/ai-budget.sql', import.meta.url), 'utf8'));
  kv = memKv();
  calls = [];
  G.resetGuardCache();
});

describe('estimates', () => {
  it('match the account totals for Clef and the embeddings, and err high', () => {
    // 3,437 tokens a Clef flash call on 2026-10-12 cost 11.9 neurons; 8,600 characters of input is about that call.
    const clef = G.estimateNeurons('@cf/cloudflare/clef-flash', { state: 'x'.repeat(8000), questions: { kind: { type: 'choice', instructions: 'y'.repeat(600) } } });
    assert.ok(clef >= 12 && clef < 20, `clef ${clef}`);
    const emb = G.estimateNeurons('@cf/baai/bge-base-en-v1.5', { text: ['a'.repeat(3000)] });
    assert.ok(emb >= 7 && emb < 10, `embed ${emb}`);
    const oss = G.estimateNeurons('@cf/openai/gpt-oss-120b', { messages: [{ role: 'user', content: 'a'.repeat(3000) }] });
    assert.ok(oss > 140, `gpt-oss ${oss}`);
    assert.ok(G.estimateNeurons('@cf/some/new-model', { prompt: 'hello' }) > G.estimateNeurons('@cf/meta/llama-3.1-8b-instruct-fast', { prompt: 'hello' }));
    assert.ok(G.estimateNeurons('@cf/openai/whisper-large-v3-turbo', { audio: 'A'.repeat(400_000) }) >= 3);
    assert.ok(G.estimateNeurons('@cf/meta/llama-4-scout-17b-16e-instruct', { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }] }) > 50);
  });
  it('read the token counts a model reports, ten percent over', () => {
    const n = G.actualNeurons('@cf/openai/gpt-oss-120b', { usage: { prompt_tokens: 10_000, completion_tokens: 1_000 } });
    assert.equal(n, Math.ceil(((10_000 * 31_818 + 1_000 * 68_182) / 1e6) * 1.1) + 1);
    assert.equal(G.actualNeurons('@cf/cloudflare/clef', { answers: {} }), null);
  });
});

describe('the cap', () => {
  it('runs a call, records it, and mirrors the total to KV', async () => {
    const out = await G.guardedRun(store(), model().run, { feature: 'translate', day: DAY }, '@cf/meta/m2m100-1.2b', { text: 'Bonjour', source_lang: 'fr', target_lang: 'en' });
    assert.equal(out.response, 'ok');
    const row = await dayRow();
    assert.ok(row.est > 0);
    assert.equal(kv.m.get(`ai:budget:${DAY}`), String(Math.ceil(row.est)));
    const use = await d1.prepare('SELECT * FROM ai_budget_use WHERE day = ?').bind(DAY).first();
    assert.equal(use.feature, 'translate');
    assert.equal(use.calls, 1);
  });
  it('holds a call past its tier and lets a higher tier through', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 6600)`);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'brief', day: DAY }, '@cf/meta/llama-3.1-8b-instruct-fast', { prompt: 'x' }), (e) => G.isAiPaused(e) && e.why === 'budget');
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' }), (e) => e.why === 'budget');
    await G.guardedRun(store(), model({ answers: {} }).run, { feature: 'clef-understand', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' });
    assert.deepEqual(calls, ['@cf/cloudflare/clef-flash']);
    const held = await d1.prepare('SELECT SUM(refused) AS n FROM ai_budget_use WHERE day = ?').bind(DAY).first();
    assert.equal(held.n, 2);
  });
  it('never passes 8,000 for any feature', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 7995)`);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x'.repeat(5000) }), (e) => e.why === 'budget');
    assert.equal(calls.length, 0);
  });
  it('counts Cloudflare\'s total when it is above the estimate', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est, truth) VALUES ('${DAY}', 10, 7999)`);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' }), (e) => e.why === 'budget');
  });
  it('reads the KV total as a floor', async () => {
    kv.m.set(`ai:budget:${DAY}`, '7999');
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x'.repeat(100) }), (e) => e.why === 'budget');
  });
  it('fails closed when the database is down', async () => {
    const broken = { db: { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('down'); }, first: async () => { throw new Error('down'); }, all: async () => ({ results: [] }) }) }) }, kv };
    await assert.rejects(G.guardedRun(broken, model().run, { feature: 'request-route', day: DAY }, '@cf/meta/m2m100-1.2b', { text: 'x' }), (e) => e.why === 'unavailable');
    assert.equal(calls.length, 0);
  });
  it('corrects the reservation from the reported tokens', async () => {
    await G.guardedRun(store(), model({ response: 'ok', usage: { prompt_tokens: 100, completion_tokens: 5 } }).run, { feature: 'brief', day: DAY }, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', { prompt: 'x'.repeat(300), max_tokens: 900 });
    const row = await dayRow();
    assert.equal(row.est, G.actualNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { usage: { prompt_tokens: 100, completion_tokens: 5 } }));
  });
});

describe('switches', () => {
  it('keeps the query writer and check reading off until an admin turns them on', async () => {
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'brain-writer', day: DAY }, '@cf/openai/gpt-oss-120b', { messages: [] }), (e) => e.why === 'off');
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'check-reading', day: DAY }, '@cf/meta/llama-4-scout-17b-16e-instruct', { messages: [] }), (e) => e.why === 'off');
    kv.m.set('ai:settings', JSON.stringify({ allow: { 'brain-writer': true }, extra: {} }));
    G.resetGuardCache();
    await G.guardedRun(store(), model().run, { feature: 'brain-writer', day: DAY }, '@cf/openai/gpt-oss-120b', { messages: [] });
    assert.deepEqual(calls, ['@cf/openai/gpt-oss-120b']);
  });
  it('stops every call on the kill flag and on the tester\'s closed switch', async () => {
    kv.m.set(`ai:off:${DAY}`, '1');
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' }), (e) => e.why === 'kill');
    kv.m.delete(`ai:off:${DAY}`);
    G.resetGuardCache();
    const ai = G.guardBinding(store(), model(), { closedFor: () => true, day: DAY });
    await assert.rejects(G.aiFor(ai, 'translate').run('@cf/meta/m2m100-1.2b', { text: 'x' }), (e) => e.why === 'closed');
    assert.equal(calls.length, 0);
  });
  it('names the feature through aiFor, and leaves a plain stand-in alone', async () => {
    const ai = G.guardBinding(store(), model(), { day: DAY });
    await G.aiFor(ai, 'mail-sort').run('@cf/cloudflare/clef-flash', { state: 'x' });
    const use = await d1.prepare('SELECT feature FROM ai_budget_use').first();
    assert.equal(use.feature, 'mail-sort');
    const plain = model();
    assert.equal(G.aiFor(plain, 'x'), plain);
    assert.equal(G.aiFor(undefined, 'x'), undefined);
  });
  it('opens the month\'s extra units to test runs only', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 7999)`);
    kv.m.set('ai:settings', JSON.stringify({ allow: {}, extra: { '2026-10': 500 } }));
    G.resetGuardCache();
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x'.repeat(200) }), (e) => e.why === 'budget');
    await G.guardedRun(store(), model({ answers: {} }).run, { feature: 'request-route', day: DAY, test: true }, '@cf/cloudflare/clef-flash', { state: 'x'.repeat(200) });
    const row = await dayRow();
    assert.ok(row.test_over > 0 && row.test_over <= 500, `test_over ${row.test_over}`);
    d1.exec(`UPDATE ai_budget_day SET test_over = 500 WHERE day = '${DAY}'`);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY, test: true }, '@cf/cloudflare/clef-flash', { state: 'x'.repeat(200) }), (e) => e.why === 'budget');
  });
});

describe('the reconciler', () => {
  it('writes Cloudflare\'s total over the estimate and sets the kill flag past 9,000', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 4000)`);
    const fake = async (url, init) => {
      const body = JSON.parse(init.body);
      assert.match(body.query, /aiInferenceAdaptiveGroups/);
      assert.equal(body.variables.a, 'acct');
      return new Response(JSON.stringify({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: 5000.4 }, dimensions: { date: DAY } }, { sum: { totalNeurons: 1200 }, dimensions: { date: '2026-10-11' } }] }] } } }), { status: 200 });
    };
    const totals = await G.trueTotals({ account: 'acct', email: 'e', key: 'k' }, '2026-10-06', DAY, fake);
    let r = await G.reconcile(store(), totals, DAY);
    assert.equal(r.truth, 5000.4);
    assert.equal(r.used, 5001);
    assert.equal(r.off, false);
    assert.equal(kv.m.get(`ai:budget:${DAY}`), '5001');
    assert.equal((await d1.prepare("SELECT truth FROM ai_budget_day WHERE day = '2026-10-11'").first()).truth, 1200);
    r = await G.reconcile(store(), { [DAY]: 9100 }, DAY);
    assert.equal(r.off, true);
    assert.equal(kv.m.get(`ai:off:${DAY}`), '1');
    assert.equal((await dayRow()).off, 1);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' }), (e) => G.isAiPaused(e));
  });
});

describe('a held call nobody caught', () => {
  it('answers 503 paused in plain words', async () => {
    const { handleError } = await import('../functions/_lib/http.ts');
    const res = handleError(new G.AiPaused('budget', 'clip-text'));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'paused');
    assert.doesNotMatch(body.message, /\bAI\b|model|neuron|\$/);
  });
});

describe('meetings and the overnight index (2026-10-13)', () => {
  it('meeting captions and notes are tier 1; the Drive index runs only overnight Eastern', async () => {
    assert.equal(G.FEATURES['meet-notes'].tier, 1);
    assert.equal(G.nightNow(new Date('2026-10-13T18:30:00Z')), false); // 2:30 PM Eastern
    assert.equal(G.nightNow(new Date('2026-10-14T03:00:00Z')), true); // 11 PM Eastern
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'drive-index', day: DAY, now: new Date('2026-10-13T18:30:00Z') }, '@cf/baai/bge-m3', { text: ['x'] }), (e) => G.isAiPaused(e) && e.why === 'off');
    await G.guardedRun(store(), model().run, { feature: 'drive-index', day: DAY, now: new Date('2026-10-14T03:00:00Z') }, '@cf/baai/bge-m3', { text: ['x'] });
  });
  it('the reconciler brings a high estimate back to the true total plus the slack', async () => {
    await d1.prepare('INSERT OR IGNORE INTO ai_budget_day (day) VALUES (?)').bind(DAY).run();
    await d1.prepare('UPDATE ai_budget_day SET est = 5044 WHERE day = ?').bind(DAY).run();
    const r = await G.reconcile(store(), { [DAY]: 3354 }, DAY);
    assert.equal(r.est, 3354 + G.RECONCILE_SLACK);
    assert.equal(kv.m.get(`ai:budget:${DAY}`), String(3354 + G.RECONCILE_SLACK));
  });
});

describe('speech is charged by its length (2026-10-13)', () => {
  const W = '@cf/openai/whisper-large-v3-turbo';
  it('a ten-second meeting slice reserves its length, not its bytes, and settles on the length Whisper heard', async () => {
    const audio = 'A'.repeat(76_000); // a 57 KB slice as base64: bytes / 2,000 read it as 29 seconds
    assert.ok(G.estimateNeurons(W, { audio }) >= 23);
    assert.equal(G.estimateNeurons(W, { audio }, { audioSec: 10 }), Math.ceil((10 / 60) * 46.63 * 1.05) + 1);
    assert.equal(G.actualNeurons(W, { text: 'hi', transcription_info: { duration: 9.6 } }), Math.ceil((9.6 / 60) * 46.63 * 1.05) + 1);
    assert.equal(G.actualNeurons(W, { text: 'hi' }), null);
    const ai = G.guardBinding(store(), model({ text: 'hello', transcription_info: { duration: 10 } }), { day: DAY });
    await G.aiFor(ai, 'meet-notes').run(W, { audio }, { audioSec: 10 });
    assert.equal(Math.round((await dayRow()).est), Math.ceil((10 / 60) * 46.63 * 1.05) + 1);
  });
  it('a one-hour meeting (360 slices, live notes every 40 seconds, final notes) fits under the tier 1 cap beside a normal day', async () => {
    await d1.prepare('INSERT OR IGNORE INTO ai_budget_day (day) VALUES (?)').bind(DAY).run();
    // Today's use outside meetings and the overnight index, from ai_budget_use on 2026-10-13: about 1,500.
    await d1.prepare('UPDATE ai_budget_day SET est = 1500 WHERE day = ?').bind(DAY).run();
    const speech = G.guardBinding(store(), model({ text: 'words', transcription_info: { duration: 10 } }), { day: DAY });
    const text = G.guardBinding(store(), model({ response: '{"items":[]}', usage: { prompt_tokens: 2_400, completion_tokens: 150 } }), { day: DAY });
    let refused = 0;
    const tryRun = async (p) => { try { await p; } catch (e) { if (G.isAiPaused(e)) refused++; else throw e; } };
    for (let i = 0; i < 360; i++) {
      await tryRun(G.aiFor(speech, 'meet-notes').run(W, { audio: 'A'.repeat(76_000) }, { audioSec: 10 }));
      if (i % 4 === 3) await tryRun(G.aiFor(text, 'meet-notes').run('@cf/meta/llama-3.1-8b-instruct-fast', { messages: [{ role: 'user', content: 'x'.repeat(7_000) }], max_tokens: 700 }));
    }
    const notes = G.guardBinding(store(), model({ response: '{}', usage: { prompt_tokens: 9_500, completion_tokens: 1_200 } }), { day: DAY });
    await tryRun(G.aiFor(notes, 'meet-notes').run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages: [{ role: 'user', content: 'x'.repeat(28_000) }], max_tokens: 1_800 }));
    const est = (await dayRow()).est;
    assert.equal(refused, 0);
    assert.ok(est < G.TIER_CAP[1], `estimate after the hour ${est}`);
    // Measured: about 3,600 for the sound, 1,600 for live notes, 550 for the final notes.
    assert.ok(est - 1500 < 6_000, `the meeting alone ${est - 1500}`);
  });
});

describe('the meeting notes ceiling (2026-10-14)', () => {
  const small = { messages: [{ role: 'user', content: 'x' }], max_tokens: 10 };
  const M = '@cf/meta/llama-3.1-8b-instruct-fast';
  it('derives 100,000 from $1 a day at $0.011 per 1,000 neurons', () => {
    assert.equal(G.MEET_PAID_NEURONS, 90_909);
    assert.equal(G.MEET_CEILING, 100_000);
    assert.equal(G.TIER_CAP[1], 8_000);
  });
  it('lets meeting notes run at 50,000 and past the kill flag, and holds them at 100,001', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est, off) VALUES ('${DAY}', 50000, 1)`);
    kv.m.set(`ai:off:${DAY}`, '1');
    await G.guardedRun(store(), model().run, { feature: 'meet-notes', day: DAY }, M, small);
    assert.deepEqual(calls, [M]);
    d1.exec(`UPDATE ai_budget_day SET est = 100000 WHERE day = '${DAY}'`);
    G.resetGuardCache();
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'meet-notes', day: DAY }, M, small), (e) => G.isAiPaused(e) && e.why === 'budget');
    assert.equal(calls.length, 1);
  });
  it('still holds every other tier once the total passes its cap, and the kill flag still stops them', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 9500)`);
    for (const feature of ['brief', 'request-route', 'clip-text']) {
      await assert.rejects(G.guardedRun(store(), model().run, { feature, day: DAY, now: new Date('2026-10-14T03:00:00Z') }, M, small), (e) => G.isAiPaused(e) && e.why === 'budget', feature);
    }
    // The Drive index has its own 50,000 (2026-10-14) and runs past the day total and the kill flag.
    await G.guardedRun(store(), model().run, { feature: 'drive-index', day: DAY, now: new Date('2026-10-14T03:00:00Z') }, M, small);
    calls.length = 0;
    d1.exec(`UPDATE ai_budget_day SET est = 50000, off = 1 WHERE day = '${DAY}'`);
    kv.m.set(`ai:off:${DAY}`, '1');
    G.resetGuardCache();
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'request-route', day: DAY }, M, small), (e) => e.why === 'kill');
    assert.equal(calls.length, 0);
  });
});

describe('the Favor Brain ceiling (2026-10-14)', () => {
  const small = { messages: [{ role: 'user', content: 'x' }], max_tokens: 10 };
  const M = '@cf/meta/llama-3.1-8b-instruct-fast';
  const brain = ['clef-understand', 'clef-pick', 'brain-understand', 'brain-search', 'brain-howto', 'brain-writer', 'brain-title', 'brain-drive-answer'];
  it('derives 919,000 from $10 a day at $0.011 per 1,000 neurons and leaves meeting notes at 100,000', () => {
    assert.equal(G.BRAIN_PAID_NEURONS, 909_090);
    assert.equal(G.BRAIN_CEILING, 919_000);
    assert.equal(G.MEET_CEILING, 100_000);
  });
  it('runs every Brain feature at 500,000, past the kill flag, and refuses above the ceiling', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est, off) VALUES ('${DAY}', 500000, 1)`);
    kv.m.set(`ai:off:${DAY}`, '1');
    G.resetGuardCache();
    for (const feature of brain) await G.guardedRun(store(), model().run, { feature, day: DAY }, M, small).catch((e) => { if (!(G.isAiPaused(e) && e.why === 'off')) throw e; });
    d1.exec(`UPDATE ai_budget_day SET est = 919000 WHERE day = '${DAY}'`);
    G.resetGuardCache();
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'brain-howto', day: DAY }, M, small), (e) => G.isAiPaused(e) && e.why === 'budget');
  });
  it('still refuses a non-Brain tier 3 feature at 9,500', async () => {
    d1.exec(`INSERT INTO ai_budget_day (day, est) VALUES ('${DAY}', 9500)`);
    await assert.rejects(G.guardedRun(store(), model().run, { feature: 'clip-text', day: DAY }, M, small), (e) => G.isAiPaused(e) && e.why === 'budget');
  });
});

describe('the mail sorting and translation ceilings (2026-10-15)', () => {
  const small = { messages: [{ role: 'user', content: 'x' }], max_tokens: 10 };
  const M = '@cf/meta/llama-3.1-8b-instruct-fast';
  for (const feature of ['mail-sort', 'translate']) {
    it(`${feature} runs past the day total and the kill flag, up to 50,000 of its own`, async () => {
      d1.exec(`INSERT INTO ai_budget_day (day, est, truth, off) VALUES ('${DAY}', 500000, 500000, 1)`);
      kv.m.set(`ai:off:${DAY}`, '1');
      G.resetGuardCache();
      await G.guardedRun(store(), model().run, { feature, day: DAY }, M, small);
      assert.equal(calls.length, 1);
      d1.exec(`UPDATE ai_budget_use SET neurons = 49999 WHERE day = '${DAY}' AND feature = '${feature}'`);
      await assert.rejects(G.guardedRun(store(), model().run, { feature, day: DAY }, M, small), (e) => G.isAiPaused(e) && e.why === 'budget');
      assert.equal(calls.length, 1);
    });
  }
  it('usage under them leaves the 9,000 kill alone', async () => {
    d1.exec(`INSERT INTO ai_budget_use (day, feature, model, calls, neurons, refused) VALUES ('${DAY}', 'mail-sort', 'm', 5, 30000, 0)`);
    assert.equal(await G.ceilingedUsed(store(), DAY), 30000);
  });
});

describe('a call that throws after the reservation (2026-10-15)', () => {
  it('books the reserved neurons under its feature, so Cloudflare\'s count has a row to match', async () => {
    const boom = async () => { throw new Error('model timed out'); };
    await assert.rejects(G.guardedRun(store(), boom, { feature: 'mail-sort', day: DAY }, '@cf/cloudflare/clef-flash', { state: 'x' }), /timed out/);
    const use = await d1.prepare('SELECT calls, neurons FROM ai_budget_use WHERE day = ? AND feature = ?').bind(DAY, 'mail-sort').first();
    assert.equal(use.calls, 1);
    assert.ok(use.neurons > 0);
    assert.equal(Math.round(use.neurons), Math.round((await dayRow()).est));
  });
});
