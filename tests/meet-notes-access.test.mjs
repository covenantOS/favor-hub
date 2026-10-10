// Run with: npm test
//
// Who may read a meeting's notes, checked on the server through the real routes on an in-memory D1.
// The rule: the host, a made host, an invited person and a hub admin; everyone on staff when the meeting was open to all staff;
// and the leader of a team that has someone on the meeting's roster. Everyone else gets a 404. Made-up people only: the repository is public.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

const { route } = await import('../functions/_lib/meetroute.ts');
const { ledPeople, mayReadNotes } = await import('../functions/_lib/meet.ts');

const schema = readFileSync(new URL('../db/meetings.sql', import.meta.url), 'utf8');
const id = (n) => String(n).padStart(24, '0');
const CREATED = '2026-10-09T15:00:00.000Z';

const ADMIN = { email: 'will@favorintl.org', role: 'admin' };
const PEOPLE = ['ann', 'bob', 'cat', 'lead', 'sup', 'solo', 'gone', 'nolead', 'zed', 'someone-new'].map((n) => `${n}@favorintl.org`);

async function world({ withLeadColumn = true } = {}) {
  const d1 = memoryD1();
  d1.exec(schema);
  if (!withLeadColumn) d1.exec('ALTER TABLE meet_directory DROP COLUMN lead');
  const person = (email, team, lead = 0, active = 1) =>
    withLeadColumn
      ? d1.prepare('INSERT INTO meet_directory (email, name, title, team, active, lead) VALUES (?, ?, ?, ?, ?, ?)').bind(email, email.split('@')[0], '', team, active, lead).run()
      : d1.prepare('INSERT INTO meet_directory (email, name, title, team, active) VALUES (?, ?, ?, ?, ?)').bind(email, email.split('@')[0], '', team, active).run();
  const meeting = (n, over) => {
    const m = { host: 'zed@favorintl.org', cohosts: [], invitees: [], access: 'invited', status: 'ended', ...over };
    const invitees = m.invitees.map((e) => (typeof e === 'string' ? { email: e, name: e } : e));
    return d1
      .prepare(
        `INSERT INTO hub_meetings (id, title, host_email, host_name, cohosts, access, invitees, status, rec_mode, notes_status, summary, created_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'notes', 'ready', ?, ?, ?)`
      )
      .bind(id(n), `Meeting ${n}`, m.host, m.host, JSON.stringify(m.cohosts), m.access, JSON.stringify(invitees), m.status, `Summary ${n}`, CREATED, `2026-10-09T15:${String(10 + n).padStart(2, '0')}:00.000Z`)
      .run();
  };
  await Promise.all([
    // Marketing is led by lead, Support by sup, Partner Care by solo (alone on it). gone leads Marketing but is inactive. Grants has no leader.
    person('lead@favorintl.org', 'Marketing', 1),
    person('ann@favorintl.org', 'Marketing'),
    person('bob@favorintl.org', 'Marketing'),
    person('sup@favorintl.org', 'Support Team', 1),
    person('cat@favorintl.org', 'Support Team'),
    person('solo@favorintl.org', 'Partner Care', 1),
    person('gone@favorintl.org', 'Marketing', 1, 0),
    person('nolead@favorintl.org', 'Grants'),
    // 1 two Marketing people. 2 a Support host with a Marketing invitee. 3 open to all staff. 4 only the host, who has no team.
    // 5 cancelled. 6 a Support person made host on a meeting hosted by someone with no team. 7 a Marketing invitee and an outside guest.
    // 8 invites joann@, whose address ends with ann@.
    meeting(1, { host: 'ann@favorintl.org', invitees: ['bob@favorintl.org'] }),
    meeting(2, { host: 'cat@favorintl.org', invitees: ['ann@favorintl.org'] }),
    meeting(3, { access: 'staff' }),
    meeting(4, {}),
    meeting(5, { host: 'ann@favorintl.org', status: 'cancelled' }),
    meeting(6, { cohosts: ['cat@favorintl.org'] }),
    meeting(7, { invitees: [{ email: 'ann@favorintl.org', name: 'Ann' }, { email: 'visitor@example.org', name: 'Visitor', guest: true }] }),
    meeting(8, { invitees: ['joann@favorintl.org'] }),
  ]);
  return { DB: d1, MEET_RELEASE: 'staff', MEET_FAKE_SFU: '1' };
}

async function call(env, who, path, { method = 'GET', query = '' } = {}) {
  const user = typeof who === 'string' ? { email: who, role: 'staff' } : who;
  const request = new Request(`https://hub.test/api/meet/${path.join('/')}${query}`, { method, headers: { 'X-Hub-Email': user.email, 'X-Hub-Name': user.email.split('@')[0], 'X-Hub-Role': user.role } });
  const res = await route({ request, env, params: { path } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const notes = (env, who, n) => call(env, who, ['meetings', id(n), 'notes']);
const library = async (env, who) => (await call(env, who, ['meetings'], { query: '?scope=notes' })).body.meetings.map((m) => Number(m.id)).sort((a, b) => a - b);

describe('the notes page', () => {
  it('opens for the host, a made host, an invited person and an admin', async () => {
    const env = await world();
    assert.equal((await notes(env, 'ann@favorintl.org', 1)).status, 200, 'host');
    assert.equal((await notes(env, 'bob@favorintl.org', 1)).status, 200, 'invited');
    assert.equal((await notes(env, 'cat@favorintl.org', 6)).status, 200, 'made host');
    assert.equal((await notes(env, ADMIN, 4)).status, 200, 'admin');
  });

  it('opens for every signed-in person when the meeting was open to all staff', async () => {
    const env = await world();
    for (const who of PEOPLE) assert.equal((await notes(env, who, 3)).status, 200, who);
  });

  it('opens for the leader of a team that has the host, a made host or an invited person on the roster', async () => {
    const env = await world();
    assert.equal((await notes(env, 'lead@favorintl.org', 1)).status, 200, 'Marketing leader: a Marketing host and invitee');
    assert.equal((await notes(env, 'lead@favorintl.org', 2)).status, 200, 'Marketing leader: one Marketing invitee on a Support meeting');
    assert.equal((await notes(env, 'sup@favorintl.org', 2)).status, 200, 'Support leader: a Support host');
    assert.equal((await notes(env, 'sup@favorintl.org', 6)).status, 200, 'Support leader: a Support person made host');
    assert.equal((await notes(env, 'lead@favorintl.org', 7)).status, 200, 'an outside guest on the roster changes nothing');
  });

  it('stays closed to everyone else with the same 404 as a meeting that does not exist', async () => {
    const env = await world();
    const missing = await notes(env, 'cat@favorintl.org', 99);
    assert.equal(missing.status, 404);
    for (const [who, n, why] of [
      ['cat@favorintl.org', 1, 'a Support person who was not invited'],
      ['sup@favorintl.org', 1, 'the Support leader, nobody from Support on it'],
      ['solo@favorintl.org', 2, 'the leader of a team nobody from is on it'],
      ['nolead@favorintl.org', 1, 'a Grants person who leads nothing'],
      ['lead@favorintl.org', 4, 'the Marketing leader, a meeting with no Marketing person'],
      ['sup@favorintl.org', 4, 'the Support leader, a meeting with no Support person'],
      ['zed@favorintl.org', 1, 'a person with no team'],
      ['gone@favorintl.org', 1, 'a leader marked inactive'],
      ['lead@favorintl.org', 5, 'a cancelled meeting, even for a leader'],
      ['ann@favorintl.org', 8, 'ann@ against a meeting that invited joann@'],
    ]) {
      const r = await notes(env, who, n);
      assert.equal(r.status, 404, `${who} on meeting ${n}: ${why}`);
      assert.deepEqual(r.body, missing.body, why);
    }
  });

  it('gives a leader the notes and nothing else about the room', async () => {
    const env = await world();
    assert.equal((await call(env, 'lead@favorintl.org', ['meetings', id(1)])).status, 404, 'the meeting itself');
    assert.equal((await call(env, 'lead@favorintl.org', ['meetings', id(1), 'join'], { method: 'POST' })).status, 404, 'joining it');
    assert.equal((await call(env, 'lead@favorintl.org', ['meetings', id(1), 'action'], { method: 'POST' })).status, 404, 'ticking an action');
  });
});

describe('the notes library', () => {
  it('lists what each person may read', async () => {
    const env = await world();
    assert.deepEqual(await library(env, 'ann@favorintl.org'), [1, 2, 3, 7], 'hosting 1, invited to 2 and 7, and 3 is open (5 is cancelled, 8 invited joann@)');
    assert.deepEqual(await library(env, 'lead@favorintl.org'), [1, 2, 3, 7], 'Marketing leader: every meeting with a Marketing person on the roster, plus the open one');
    assert.deepEqual(await library(env, 'sup@favorintl.org'), [2, 3, 6], 'Support leader');
    assert.deepEqual(await library(env, 'cat@favorintl.org'), [2, 3, 6], 'hosting 2, made host on 6');
    assert.deepEqual(await library(env, 'solo@favorintl.org'), [3], 'a leader of a team with nobody on any meeting');
    assert.deepEqual(await library(env, 'nolead@favorintl.org'), [3]);
    assert.deepEqual(await library(env, 'zed@favorintl.org'), [3, 4, 6, 7, 8], 'the host of five');
  });

  it('holds a meeting exactly when the notes page opens for that person', async () => {
    const env = await world();
    for (const who of ['ann@favorintl.org', 'lead@favorintl.org', 'sup@favorintl.org', 'solo@favorintl.org', 'cat@favorintl.org', 'zed@favorintl.org', 'gone@favorintl.org']) {
      const listed = new Set(await library(env, who));
      for (let n = 1; n <= 8; n++) assert.equal((await notes(env, who, n)).status === 200, listed.has(n), `${who} on meeting ${n}`);
    }
  });

  it('a leader\'s list is cut at 100 like everyone else\'s', async () => {
    const env = await world();
    for (let n = 100; n < 230; n++) {
      await env.DB.prepare(
        `INSERT INTO hub_meetings (id, title, host_email, host_name, invitees, status, rec_mode, notes_status, summary, created_at, ended_at) VALUES (?, 'Bulk', 'ann@favorintl.org', 'Ann', '[]', 'ended', 'notes', 'ready', '', ?, ?)`
      ).bind(id(n), CREATED, `2026-10-08T10:${String(n % 60).padStart(2, '0')}:00.000Z`).run();
    }
    assert.equal((await library(env, 'lead@favorintl.org')).length, 100);
    assert.equal((await library(env, 'ann@favorintl.org')).length, 100);
  });
});

describe('when the leader column is missing or a lookup fails', () => {
  it('a leader gets nothing more, and the people who may join are not affected', async () => {
    const env = await world({ withLeadColumn: false });
    const logged = console.error;
    console.error = () => {}; // the failed lookup is logged on purpose
    try {
      assert.equal((await notes(env, 'lead@favorintl.org', 1)).status, 404);
      assert.equal((await notes(env, 'ann@favorintl.org', 1)).status, 200);
      assert.deepEqual(await library(env, 'lead@favorintl.org'), [3]);
      assert.deepEqual(await library(env, 'ann@favorintl.org'), [1, 2, 3, 7]);
    } finally {
      console.error = logged;
    }
  });
});

describe('ledPeople and mayReadNotes', () => {
  it('ledPeople returns the active members of the teams a person leads, and nobody for a person who leads none', async () => {
    const env = await world();
    assert.deepEqual([...(await ledPeople(env, 'LEAD@favorintl.org'))].sort(), ['ann@favorintl.org', 'bob@favorintl.org', 'lead@favorintl.org']);
    assert.deepEqual([...(await ledPeople(env, 'solo@favorintl.org'))], ['solo@favorintl.org']);
    assert.equal((await ledPeople(env, 'ann@favorintl.org')).size, 0);
    assert.equal((await ledPeople(env, 'gone@favorintl.org')).size, 0);
  });

  it('mayReadNotes adds the leader to whoever may join and never reopens a cancelled meeting', () => {
    const m = (over = {}) => ({ id: id(1), status: 'ended', access: 'invited', host_email: 'Host@favorintl.org', cohosts: '[]', invitees: '[{"email":"Ann@favorintl.org"}]', ...over });
    const led = new Set(['ann@favorintl.org']);
    const u = (email, role = 'staff') => ({ email, role });
    assert.ok(mayReadNotes(m(), u('lead@favorintl.org'), led));
    assert.ok(!mayReadNotes(m(), u('lead@favorintl.org'), new Set()));
    assert.ok(!mayReadNotes(m({ invitees: '[]' }), u('lead@favorintl.org'), led));
    assert.ok(!mayReadNotes(m({ status: 'cancelled' }), u('lead@favorintl.org'), led));
    assert.ok(mayReadNotes(m({ host_email: 'ann@favorintl.org', invitees: '[]' }), u('lead@favorintl.org'), led), 'the host counts');
    assert.ok(mayReadNotes(m({ access: 'staff' }), u('anyone@favorintl.org'), new Set()), 'open to all staff');
  });
});
