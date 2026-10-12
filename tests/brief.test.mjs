// Run with: npm test
//
// The briefing's rules: how a partner's giving rhythm, health and next best action are read, which moments are worth a call, how the
// trip planner reads "Dallas on Thursday" and places partners, how the model's text is cleaned, and that the briefing routes turn away
// a request with no sign-in. No network, no real names.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let sig, txt, trip, away;
before(async () => {
  sig = await import('../functions/_lib/brief/signals.ts');
  txt = await import('../functions/_lib/brief/text.ts');
  trip = await import('../functions/_lib/brief/trip.ts');
  away = await import('../functions/_lib/brief/away.ts');
});

const TODAY = '2026-10-12';
const monthly = (n, from = '2026-09-05') => Array.from({ length: n }, (_, i) => ({ d: txt.addDays(from, -30 * i), a: 50 }));

describe('giving rhythm and health', () => {
  it('reads a monthly giver and says when the next gift is expected', () => {
    const r = sig.rhythmOf(monthly(10), TODAY);
    assert.equal(r.cadence, 'monthly');
    assert.equal(r.lastDate, '2026-09-05');
    assert.equal(r.lateDays, 0);
    assert.equal(r.expectedNext, '2026-10-05');
  });
  it('marks a monthly giver who stopped four months ago and was never called as at risk', () => {
    const gifts = monthly(10, '2026-06-01');
    const r = sig.rhythmOf(gifts, TODAY);
    assert.ok(r.lateDays > 30);
    const h = sig.healthOf({ l12: 500, p12: 600, life: 3000, gifts: 40, firstDate: '2022-01-01', quiet: null, rhythm: r }, TODAY);
    assert.equal(h.health, 'atrisk');
  });
  it('marks the same giver lapsing, not at risk, when someone talked to them last month', () => {
    const r = sig.rhythmOf(monthly(10, '2026-06-01'), TODAY);
    const h = sig.healthOf({ l12: 500, p12: 600, life: 3000, gifts: 40, firstDate: '2022-01-01', quiet: 20, rhythm: r }, TODAY);
    assert.equal(h.health, 'lapsing');
  });
  it('reads growing and slipping from the two twelve month totals', () => {
    const r = sig.rhythmOf(monthly(10), TODAY);
    const base = { life: 5000, gifts: 40, firstDate: '2020-01-01', quiet: 10, rhythm: r };
    assert.equal(sig.healthOf({ ...base, l12: 1500, p12: 1000 }, TODAY).health, 'growing');
    assert.equal(sig.healthOf({ ...base, l12: 600, p12: 1000 }, TODAY).health, 'slipping');
    assert.equal(sig.healthOf({ ...base, l12: 1000, p12: 1000 }, TODAY).health, 'steady');
  });
  it('calls a partner with one recent gift new', () => {
    const r = sig.rhythmOf([{ d: '2026-10-08', a: 100 }], TODAY);
    assert.equal(sig.healthOf({ l12: 100, p12: 0, life: 100, gifts: 1, firstDate: '2026-10-08', quiet: null, rhythm: r }, TODAY).health, 'new');
  });
});

describe('next best action', () => {
  const base = { name: 'Ada Partner', health: 'steady', l12: 600, p12: 600, life: 4000, quiet: 20, owed: null, firstGiftDays: null, nextTask: null, hasPhone: true, doNotCall: false, hasEmail: true, doNotEmail: false };
  const f = (o) => ({ ...base, rhythm: { n: 8, lastDate: '2026-09-20', daysSince: 22, medianGap: 30, cadence: 'monthly', expectedNext: '2026-10-20', lateDays: 0 }, ...o });
  it('puts a thank-you first', () => {
    const n = sig.nextAction(f({ owed: { n: 1, total: 250, oldestDays: 4 } }), TODAY);
    assert.equal(n.kind, 'thank');
    assert.equal(n.urgency, 3);
    assert.match(n.label, /^Thank Ada for the \$250 gift$/);
  });
  it('keeps the whole name of an organization with an accent or a French or Spanish word', () => {
    for (const name of ['Église Saint-Jean', 'Eglise Evangelique de Paris', 'Iglesia Bautista Central', 'Fondation Espérance', 'New Life Church']) {
      const n = sig.nextAction(f({ name, quiet: 300 }), TODAY);
      assert.ok(n.label.includes(name), name + ' -> ' + n.label);
    }
    assert.match(sig.nextAction(f({ name: 'Zoë Martin', quiet: 300 }), TODAY).label, /Zoë to /);
  });
  it('welcomes a new partner nobody has contacted', () => {
    const n = sig.nextAction(f({ firstGiftDays: 6, quiet: null }), TODAY);
    assert.equal(n.kind, 'welcome');
  });
  it('asks for a reconnect call when the gift is late and no task is planned', () => {
    const n = sig.nextAction(f({ health: 'lapsing', rhythm: { n: 8, lastDate: '2026-06-01', daysSince: 133, medianGap: 30, cadence: 'monthly', expectedNext: '2026-07-01', lateDays: 80 } }), TODAY);
    assert.equal(n.kind, 'reconnect');
    assert.equal(n.channel, 'call');
  });
  it('keeps the planned task when the partner is healthy', () => {
    const n = sig.nextAction(f({ nextTask: { due: '2026-10-20', summary: 'Call about the banquet' } }), TODAY);
    assert.equal(n.kind, 'planned');
    assert.equal(n.label, 'Call about the banquet');
  });
  it('uses a card when every phone and email is marked do not contact', () => {
    const n = sig.nextAction(f({ quiet: 400, doNotCall: true, doNotEmail: true }), TODAY);
    assert.equal(n.channel, 'card');
  });
  it('says nothing is needed when contact is recent and nothing is owed', () => {
    assert.equal(sig.nextAction(f({}), TODAY).kind, 'none');
  });
});

describe('moments', () => {
  const p = (o) => ({ cid: '1', name: 'Ada Partner', gifts: [], count: 5, firstDate: '2021-10-14', firstAmount: 50, maxBefore: 200, health: 'steady', rhythm: { n: 5, lastDate: '', daysSince: 0, medianGap: 30, cadence: 'monthly', expectedNext: null, lateDays: 0 }, l12: 600, ...o });
  it('finds a largest gift ever', () => {
    const m = sig.momentsFor([p({ gifts: [{ d: '2026-10-09', a: 500 }] })], TODAY);
    assert.ok(m.some((x) => x.kind === 'largest' && x.amount === 500));
  });
  it('finds a first gift', () => {
    const m = sig.momentsFor([p({ count: 1, firstDate: '2026-10-10', firstAmount: 75, maxBefore: 0, gifts: [{ d: '2026-10-10', a: 75 }] })], TODAY);
    assert.ok(m.some((x) => x.kind === 'first'));
  });
  it('finds a giving anniversary inside the week', () => {
    const m = sig.momentsFor([p({})], TODAY);
    const a = m.find((x) => x.kind === 'anniversary');
    assert.ok(a);
    assert.match(a.line, /^5 years since the first gift on Oct 14/);
  });
  it('finds a partner who went quiet', () => {
    const m = sig.momentsFor([p({ health: 'lapsing', firstDate: '2020-01-01', rhythm: { n: 8, lastDate: '2026-06-01', daysSince: 133, medianGap: 30, cadence: 'monthly', expectedNext: null, lateDays: 80 } })], TODAY);
    assert.ok(m.some((x) => x.kind === 'quiet'));
  });
});

describe('text rules', () => {
  it('removes dashes used as breaks and the words staff text never uses', () => {
    const t = txt.scrub('"Ada gave a gift — a donor who simply leverages prayer."');
    assert.equal(t.includes('—'), false);
    assert.match(t, /partner/);
    assert.doesNotMatch(t, /donor|simply|leverage/i);
  });
  it('gives the same signature to the same facts and a different one to different facts', () => {
    assert.equal(txt.sig({ a: 1 }), txt.sig({ a: 1 }));
    assert.notEqual(txt.sig({ a: 1 }), txt.sig({ a: 2 }));
  });
});

describe('trip planner', () => {
  it('reads weekday, tomorrow and written dates', () => {
    assert.equal(trip.dateOf('in Dallas Thursday', TODAY), '2026-10-15');
    assert.equal(trip.dateOf('in Dallas tomorrow', TODAY), '2026-10-13');
    assert.equal(trip.dateOf('Dallas on Oct 20', TODAY), '2026-10-20');
    assert.equal(trip.dateOf('Dallas 3/4', TODAY), '2027-03-04');
  });
  it('reads a city and state out of a sentence when the model is not there', async () => {
    const a = await trip.parseTrip({}, "I'm in Fort Worth, TX Thursday", TODAY);
    assert.deepEqual(a, { city: 'Fort Worth', state: 'TX', date: '2026-10-15' });
  });
  it('maps state names and codes', () => {
    assert.equal(trip.stateCode('Texas'), 'TX');
    assert.equal(trip.stateCode('tx'), 'TX');
    assert.equal(trip.stateCode('Nowhere'), '');
  });
  it('measures distance in miles', () => {
    const d = trip.miles({ lat: 32.78, lon: -96.8 }, { lat: 32.75, lon: -97.33 });
    assert.ok(d > 28 && d < 34);
  });
});

describe('since you were away', () => {
  it('counts a visit as away only after a day off, and not once it is closed', () => {
    const t = (h) => new Date(Date.parse('2026-10-12T14:00:00Z') - h * 3600000).toISOString();
    assert.equal(away.wasAway({ seen_at: t(0), away_from: t(30), session_at: t(0), dismissed_at: null }), true);
    assert.equal(away.wasAway({ seen_at: t(0), away_from: t(10), session_at: t(0), dismissed_at: null }), false);
    assert.equal(away.wasAway({ seen_at: t(0), away_from: t(30), session_at: t(0), dismissed_at: t(1) }), false);
    assert.equal(away.wasAway(null), false);
  });
});

describe('the briefing routes', () => {
  it('turn away a request with no sign-in', async () => {
    for (const f of ['today', 'book']) {
      const m = await import(`../functions/api/brief/${f}.ts`);
      const res = await m.onRequestGet({ request: new Request(`https://hub.test/api/brief/${f}`), env: {} });
      assert.equal(res.status, 401, f);
    }
    const seen = await import('../functions/api/brief/seen.ts');
    assert.equal((await seen.onRequestPost({ request: new Request('https://hub.test/api/brief/seen', { method: 'POST' }), env: {} })).status, 401);
  });
});

describe('model text filter', () => {
  it('rejects padding, zero-item statements and long answers, and accepts a plain two sentence answer', () => {
    assert.equal(txt.acceptable('You have a number of important tasks to tackle today.'), false);
    assert.equal(txt.acceptable('Late actions are none at this time, fortunately.'), false);
    assert.equal(txt.acceptable('There are no late actions.'), false);
    assert.equal(txt.acceptable('One. Two. Three.'), false);
    assert.equal(txt.acceptable('Gave $9,250 in 41 gifts since 2021 to Uganda Schools. Asked for prayer for her mother.'), true);
  });
});

describe('briefing line', () => {
  it('is built from numbers and never states that something is absent', async () => {
    const b = await import('../functions/_lib/brief/briefing.ts');
    assert.equal(typeof b.buildBriefing, 'function');
  });
});

describe('names, stories and trips', () => {
  it('names a person by first name and an organization in full', () => {
    assert.equal(sig.shortName('Mr. John Smith', false), 'John');
    assert.equal(sig.shortName('Ben and Cora Sample', false), 'Ben and Cora');
    assert.equal(sig.shortName('New Life Church', true), 'New Life Church');
  });
  it('rejects a story that contradicts the records', async () => {
    const s = await import('../functions/_lib/brief/story.ts');
    const f = { count: 0, since: '', life: 0, ytd: 0, l12: 0, p12: 0, last: null, largest: null, monthly: null };
    assert.equal(s.agrees('Giving since 2023, no record of any gifts.', { ...f, count: 3, since: '2021' }, TODAY), false);
    assert.equal(s.agrees('Gave $500 since 2021.', { ...f, count: 3, since: '2021', life: 500 }, TODAY), true);
    assert.equal(s.agrees('Gave $900 since 2021.', { ...f, count: 3, since: '2021', life: 500 }, TODAY), false);
  });
  it('places a ZIP from the bundled table', async () => {
    const t = await trip.zipTable();
    const p = t.get('75201');
    assert.ok(p && Math.abs(p.lat - 32.79) < 0.1 && Math.abs(p.lon + 96.8) < 0.2);
    assert.ok(t.size > 40000);
  });
});
