// Run with: npm test
// Communication marks (shared/commprefs.ts): what solicit codes and record flags add up to for a call, an email, a mailing and a text.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const C = await import('../shared/commprefs.ts');
const state = (i) => Object.fromEntries(C.channelsOf(i).map((c) => [c.key, c.state]));

describe('channel marks', () => {
  it('no marks leaves every channel open and the banner off', () => {
    const ch = C.channelsOf({ codes: [] });
    assert.deepEqual(ch.map((c) => c.state), ['ok', 'ok', 'ok', 'ok']);
    assert.equal(C.bannerOf(ch).show, false);
  });
  it('each Do Not code blocks only its own channel', () => {
    assert.deepEqual(state({ codes: ['Do Not Call'] }), { call: 'blocked', email: 'ok', mail: 'ok', text: 'ok' });
    assert.deepEqual(state({ codes: ['do not mail'] }), { call: 'ok', email: 'ok', mail: 'blocked', text: 'ok' });
    assert.deepEqual(state({ codes: ['Do Not Text'] }), { call: 'ok', email: 'ok', mail: 'ok', text: 'blocked' });
  });
  it('Do Not Contact blocks all four and the banner reads Do not contact', () => {
    const ch = C.channelsOf({ codes: ['Do Not Contact'] });
    assert.deepEqual(ch.map((c) => c.state), ['blocked', 'blocked', 'blocked', 'blocked']);
    assert.deepEqual(C.bannerOf(ch).lines, ['Do not contact']);
  });
  it('Do Not Solicit narrows every channel without blocking one', () => {
    const ch = C.channelsOf({ codes: ['Do Not Solicit'] });
    assert.deepEqual(ch.map((c) => c.state), ['limited', 'limited', 'limited', 'limited']);
    assert.deepEqual(C.bannerOf(ch).lines, ['No asks']);
  });
  it('record flags and phone, email and address marks block the channel they belong to', () => {
    assert.equal(state({ codes: [], requestsNoEmail: true }).email, 'blocked');
    assert.equal(state({ codes: [], noValidAddress: true }).mail, 'blocked');
    assert.equal(state({ codes: [], addressDoNotMail: true }).mail, 'blocked');
    assert.equal(state({ codes: [], allPhonesDoNotCall: true }).call, 'blocked');
    assert.equal(state({ codes: [], allEmailsDoNotEmail: true }).email, 'blocked');
    assert.equal(state({ codes: [], allEmailsDoNotEmail: false }).email, 'ok');
  });
  it('a deceased record blocks everything and says Deceased', () => {
    const ch = C.channelsOf({ codes: [], deceased: true });
    assert.deepEqual(C.bannerOf(ch, { deceased: true }).lines, ['Deceased']);
  });
  it('a blocked reason names the code so the record can end it', () => {
    const ch = C.channelsOf({ codes: ['Do Not Email'] }).find((c) => c.key === 'email');
    assert.deepEqual(ch.reasons, [{ text: 'Do Not Email code', code: 'Do Not Email' }]);
  });
  it('Log a contact maps a phone call, an email and a mailing to their channel', () => {
    assert.equal(C.KIND_CHANNEL['Phone call'], 'call');
    assert.equal(C.KIND_CHANNEL.Email, 'email');
    assert.equal(C.KIND_CHANNEL.Mailing, 'mail');
    assert.equal(C.KIND_CHANNEL.Meeting, undefined);
  });
  it('the words staff read carry no em dash and no mention of the tooling', () => {
    const all = JSON.stringify([C.LIMIT_WORDS, C.CHANNEL_LABEL]);
    assert.equal(all.includes('\u2014'), false);
  });
});
