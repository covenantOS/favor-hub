// The briefing, Today's gift cards and the gift notice follow the one giving rule (shared/giving.ts): a soft-credited gift counts for the
// partner it names, with "through <fund>" beside it, and nothing says "no gift" about a partner who has credited gifts.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

let briefing, sig, story, gifts;
before(async () => {
  briefing = await import('../functions/_lib/brief/briefing.ts');
  sig = await import('../functions/_lib/brief/signals.ts');
  story = await import('../functions/_lib/brief/story.ts');
  gifts = await import('../functions/_lib/chat/gifts.ts');
});

const soft = (cid, amount) => JSON.stringify([{ constituent_id: cid, ...(amount == null ? {} : { amount: { value: amount } }) }]);

describe('who a gift counts for', () => {
  it('credits the giver when there are no soft credits', () => {
    assert.deepEqual(briefing.creditsOf('10', 250, null), [{ cid: '10', amount: 250 }]);
  });
  it('credits the partner a soft credit names, never the record it sits on', () => {
    assert.deepEqual(briefing.creditsOf('99', 5000, soft('10')), [{ cid: '10', amount: 5000 }]);
  });
  it('gives the named amount, nothing for an entry of 0, and never more than the gift', () => {
    assert.deepEqual(briefing.creditsOf('99', 5000, soft('10', 1200)), [{ cid: '10', amount: 1200 }]);
    assert.deepEqual(briefing.creditsOf('99', 5000, soft('10', 0)), []);
    assert.deepEqual(briefing.creditsOf('99', 100, soft('10', 900)), [{ cid: '10', amount: 100 }]);
  });
});

describe('empty wording is true', () => {
  const rhythm = { n: 0, lastDate: '', daysSince: null, medianGap: null, cadence: 'none', expectedNext: null, lateDays: 0 };
  it('says no gifts yet only when nothing is credited or passed on', () => {
    assert.equal(sig.healthOf({ l12: 0, p12: 0, life: 0, gifts: 0, firstDate: '', quiet: null, rhythm }, '2026-10-14').why, 'No gifts yet.');
    const daf = sig.healthOf({ l12: 0, p12: 0, life: 0, gifts: 0, firstDate: '', quiet: null, rhythm, passedOn: 40 }, '2026-10-14');
    assert.match(daf.why, /passes gifts on/);
  });
  it('the plain story for a record that only passes gifts on does not say "No gift yet"', () => {
    const f = { name: 'A DAF', count: 0, passedOn: 40, holders: [] };
    assert.doesNotMatch(story.plainStory(f, '2026-10-14'), /No gift/);
    assert.match(story.plainStory({ ...f, passedOn: 0 }, '2026-10-14'), /No gifts yet/);
  });
});

describe('gift notice', () => {
  it('names the partner and the fund the gift came through', () => {
    const msg = gifts.giftMessage({ id: '1', cid: '10', partner: 'Pat Example', amount: 7500, date: '2026-10-14', funds: ['Where Needed Most'], credit: [], through: 'National Christian Foundation (DAF)' });
    assert.match(msg, /\$7,500\*\* from <~p:10\|Pat Example> through National Christian Foundation \(DAF\)/);
  });
  it('tests $5,000 against the credited amount and posts for the partner named', async () => {
    const q = async (sql) => {
      if (sql.includes('FROM gifts')) return [
        { id: 'a', cid: '99', giver: '99', soft: soft('10'), amount: 7500, gdate: '2026-10-14', splits: '[]', credits: '[]' },
        { id: 'b', cid: '99', giver: '99', soft: soft('10', 1000), amount: 7500, gdate: '2026-10-14', splits: '[]', credits: '[]' },
      ];
      if (sql.includes('constituent_codes')) return [{ cid: '99', code: 'DAF Provider' }];
      if (sql.includes('FROM constituents')) return [{ id: '10', name: 'Pat Example', org: '' }, { id: '99', name: 'National Christian Foundation', org: 'National Christian Foundation' }];
      return [];
    };
    const list = await gifts.newBigGifts(q, new Date('2026-10-14T15:00:00Z'));
    assert.equal(list.length, 1);
    assert.equal(list[0].cid, '10');
    assert.equal(list[0].partner, 'Pat Example');
    assert.match(list[0].through, /National Christian Foundation/);
  });
});
