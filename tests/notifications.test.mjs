// Run with: npm test
//
// The notification center's extra rows come from the same functions as Today's cards and the menu numbers, so the bell can never disagree with a page.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { learnWorld as lw, VIDEO, NOW } from './support/learn-world.mjs';
import './support/resolve-ts.mjs';

const learnWorld = () => { const w = lw(); for (const f of ['receipts', 'expenses']) w.d1.exec(readFileSync(new URL('../db/' + f + '.sql', import.meta.url), 'utf8')); return w; };
let N, T;
before(async () => {
  N = await import('../functions/_lib/hub/notifications.ts');
  T = await import('../functions/_lib/hub/today.ts');
});
const access = { admin: false, meetings: true, mail: false, tasks: false, learn: false, projects: true, chat: true, workCenter: false };

describe('notification center', () => {
  it('lists a meeting that starts soon and counts it once', async () => {
    const w = learnWorld();
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    w.d1.db.prepare("INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, starts_at, created_at) VALUES (?, 'Budget check', ?, 'Vic', '[]', 'invited', 'scheduled', ?, ?)").run('aa'.repeat(12), VIDEO.email, soon, NOW);
    const r = await N.notificationsFor(w.env, VIDEO, access);
    const m = r.items.filter((i) => i.source === 'Meetings');
    assert.equal(m.length, 1);
    assert.equal(m[0].txt, 'Budget check');
    assert.equal(r.count, r.items.reduce((n, i) => n + i.n, 0), 'the badge is the sum of the rows');
  });

  it('a meeting action item is counted as Today counts it', async () => {
    const w = learnWorld();
    w.d1.db.prepare("INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, access, status, created_at) VALUES (?, 'Sync', ?, 'Vic', '[]', 'invited', 'ended', ?)").run('bb'.repeat(12), VIDEO.email, NOW);
    w.d1.db.prepare("INSERT INTO hub_meeting_actions (meeting_id, idx, text, owner_email, done) VALUES (?, 0, 'Send the report', ?, 0)").run('bb'.repeat(12), VIDEO.email);
    const cards = await T.waitingCards(w.env, VIDEO, access);
    const card = cards.find((c) => c.id === 'meetings');
    const r = await N.notificationsFor(w.env, VIDEO, access);
    const row = r.items.find((i) => i.id === 'card:meetings');
    assert.ok(card && row);
    assert.equal(row.n, card.n);
  });

  it('a person with nothing waiting has no rows and no count', async () => {
    const w = learnWorld();
    const r = await N.notificationsFor(w.env, VIDEO, access);
    assert.deepEqual(r.items, []);
    assert.equal(r.count, 0);
  });
});
