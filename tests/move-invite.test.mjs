// Run with: npm test
//
// Move to FavorOS email: the builder (banner, day, time zone, link, replace line, .ics) and who gets it (mover left out, each person once,
// staff get the room link, everyone else the guest link, test users never). Made-up people; the mail hook keeps everything in the process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';
import { memoryD1 } from './support/d1.mjs';

let mi;
let d1;
let env;
let mail;

const base = {
  mover: { name: 'Will Hamilton', email: 'will@favorintl.org' },
  to: { name: 'Katharine Guerrero', email: 'katharine@favorintl.org' },
  title: 'Partner check-in',
  startsAt: '2026-10-13T17:15:00.000Z',
  endsAt: '2026-10-13T18:00:00.000Z',
  people: ['Will Hamilton', 'Katharine Guerrero'],
  source: 'Zoom',
  link: 'https://dash.favorintl.org/meet/room/?m=abc123abc123',
  meetingId: 'abc123abc123',
  origin: 'https://dash.favorintl.org',
};

before(async () => {
  mi = await import('../functions/_lib/moveinvite.ts');
});

beforeEach(() => {
  d1 = memoryD1();
  d1.exec(readFileSync(new URL('../db/move-invite.sql', import.meta.url), 'utf8'));
  d1.exec(`CREATE TABLE hub_users (email TEXT PRIMARY KEY, name TEXT, blocked INTEGER NOT NULL DEFAULT 0)`);
  d1.db.prepare(`INSERT INTO hub_users (email, name) VALUES ('katharine@favorintl.org', 'Katharine'), ('old@favorintl.org', 'Old')`).run();
  d1.db.prepare(`UPDATE hub_users SET blocked = 1 WHERE email = 'old@favorintl.org'`).run();
  mail = [];
  env = { DB: d1, MAIL_HOOK: (m) => (mail.push(m), true) };
});

describe('the email', () => {
  const m = () => mi.buildMoveInvite(base);

  it('names who moved it, the meeting, the day, the time with the zone, the length and the people', () => {
    const { subject, html, text } = m();
    assert.equal(subject, 'Will Hamilton moved your meeting to FavorOS: Partner check-in');
    for (const s of ['Will Hamilton moved your meeting to FavorOS', 'Partner check-in', 'Tuesday, October 13', '1:15 PM to 2:00 PM EDT', '45 minutes', 'Will Hamilton and Katharine Guerrero', 'Join in FavorOS']) {
      assert.ok(html.includes(s), s);
    }
    assert.ok(html.includes('href="https://dash.favorintl.org/meet/room/?m=abc123abc123"'));
    assert.ok(text.includes('Join in FavorOS: https://dash.favorintl.org/meet/room/?m=abc123abc123'));
  });

  it('says it runs in the browser, and which calendar link it replaces', () => {
    const { html } = m();
    assert.ok(html.includes('runs in your browser. There is nothing to install.'));
    assert.ok(html.includes('Use this link instead of the Zoom link on the calendar invite.'));
    assert.ok(mi.buildMoveInvite({ ...base, source: 'phone' }).html.includes('instead of the phone link'));
    assert.ok(!mi.buildMoveInvite({ ...base, source: '' }).html.includes('instead of the'));
  });

  it('has no em dashes and never mentions AI', () => {
    const { html, text } = m();
    assert.ok(!/—|\bAI\b/.test(html + text));
  });

  it('attaches a PUBLISH calendar file with the same times and the join link', () => {
    const { ics } = m();
    assert.ok(ics.includes('METHOD:PUBLISH'));
    assert.ok(ics.includes('DTSTART:20261013T171500Z'));
    assert.ok(ics.includes('DTEND:20261013T180000Z'));
    assert.ok(ics.includes('LOCATION:https://dash.favorintl.org/meet/room/?m=abc123abc123'));
    assert.ok(ics.includes('URL:https://dash.favorintl.org/meet/room/?m=abc123abc123'));
    assert.ok(ics.endsWith('\r\n'));
  });

  it('reads the source from the event', () => {
    const label = (p) => ({ zoom: 'Zoom', meet: 'Google Meet' })[p] || p;
    assert.equal(mi.sourceLabel({}, 'zoom', label), 'Zoom');
    assert.equal(mi.sourceLabel({ location: '+1 (555) 010-2000' }, null, label), 'phone');
    assert.equal(mi.sourceLabel({ location: 'Room 4' }, null, label), '');
    assert.equal(mi.sourceLabel({}, 'favor', label), '');
  });
});

describe('who gets it', () => {
  it('leaves out the mover, repeats and test users', () => {
    const r = mi.recipients(
      [{ email: 'Will@favorintl.org' }, { email: 'katharine@favorintl.org' }, { email: 'KATHARINE@favorintl.org' }, { email: 'tester@favorintl.org' }, { email: 'bo@example.org', name: 'Bo' }, { email: '' }],
      'will@favorintl.org'
    );
    assert.deepEqual(r.map((x) => x.email), ['katharine@favorintl.org', 'bo@example.org']);
  });

  it('staff get the room link, others the guest link, replies go to the mover', async () => {
    const out = await mi.sendMoveInvites(env, {
      ...base,
      invitees: [{ email: 'katharine@favorintl.org', name: 'Katharine Guerrero' }, { email: 'bo@example.org', name: 'Bo' }, { email: 'old@favorintl.org' }],
      guestUrl: async () => 'https://dash.favorintl.org/meet/g/?m=abc123abc123&k=KEY',
    });
    assert.deepEqual(out.sent.sort(), ['bo@example.org', 'katharine@favorintl.org', 'old@favorintl.org']);
    const by = (e) => mail.find((x) => x.to === e);
    assert.ok(by('katharine@favorintl.org').html.includes('/meet/room/?m=abc123abc123'));
    assert.ok(by('bo@example.org').html.includes('/meet/g/?m=abc123abc123&amp;k=KEY'));
    assert.ok(!by('bo@example.org').html.includes('/meet/room/'));
    assert.ok(by('old@favorintl.org').html.includes('/meet/g/?m='), 'a blocked account counts as outside');
    assert.ok(mail.every((x) => x.replyTo === 'will@favorintl.org' && x.to !== 'will@favorintl.org'));
  });

  it('never sends twice for the same meeting, and logs each send', async () => {
    const a = { ...base, invitees: [{ email: 'katharine@favorintl.org' }], guestUrl: async () => null };
    await mi.sendMoveInvites(env, a);
    const again = await mi.sendMoveInvites(env, a);
    assert.equal(mail.length, 1);
    assert.deepEqual(again.skipped, ['katharine@favorintl.org']);
    const row = d1.db.prepare('SELECT * FROM hub_meeting_invite_log').all();
    assert.equal(row.length, 1);
    assert.equal(row[0].meeting_id, 'abc123abc123');
    assert.equal(row[0].state, 'sent');
  });

  it('skips outside people when guest links are off, and frees the row when a send fails', async () => {
    const out = await mi.sendMoveInvites(env, { ...base, invitees: [{ email: 'bo@example.org' }], guestUrl: async () => null });
    assert.deepEqual(out.skipped, ['bo@example.org']);
    env.MAIL_HOOK = () => false;
    const bad = await mi.sendMoveInvites(env, { ...base, invitees: [{ email: 'katharine@favorintl.org' }], guestUrl: async () => null });
    assert.deepEqual(bad.failed, ['katharine@favorintl.org']);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM hub_meeting_invite_log').get().n, 0);
  });
});
