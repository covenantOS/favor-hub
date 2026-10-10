import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { askOf, channelOf, entryBody, entryTags, etInstant, findDuplicate, householdHints, nameKeys, parseSheetText, pasteRef, resolvePartner, shortSummary, tagsOf, toIso, weekOf, weekWindow } from '../../functions/_lib/actions/intake.ts';

const TAB = (...c) => c.join('\t');

describe('reading pasted rows', () => {
  it('reads rows with and without the tick box column, and skips headers and blank lines', () => {
    const text = [
      TAB('Name', 'New?', 'Date', 'Phone', 'Email', 'Address', 'Ask', 'Action', 'Notes'),
      TAB('FALSE', 'Example, Ada', 'Y', '10/7', '813-555-0100', 'ADA@example.org', '1 Main St', '', 'call', 'Thanked her for the September gift.'),
      '',
      TAB('Bo Sample', '', '10/8/26', '', '', '', '$10k', 'text', 'Asked for $10k'),
    ].join('\n');
    const { rows } = parseSheetText(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Example, Ada');
    assert.equal(rows[0].email, 'ada@example.org');
    assert.equal(rows[0].act, 'call');
    assert.equal(rows[1].name, 'Bo Sample');
    assert.equal(rows[1].ask, '$10k');
  });
  it('dates read with the year from today when the cell has none, and bad dates come back empty', () => {
    assert.equal(toIso('10/7', '2026-10-09'), '2026-10-07');
    assert.equal(toIso('10/7/26', '2026-10-09'), '2026-10-07');
    assert.equal(toIso('2/30', '2026-10-09'), '');
    assert.equal(toIso('soon', '2026-10-09'), '');
  });
  it('how it went out comes from the Action cell, then the notes', () => {
    assert.equal(channelOf('VM', ''), 'vm');
    assert.equal(channelOf('Texted', ''), 'text');
    assert.equal(channelOf('e-mail', ''), 'email');
    assert.equal(channelOf('Letter', ''), 'mail');
    assert.equal(channelOf('Lunch', ''), 'meet');
    assert.equal(channelOf('phone call', ''), 'call');
    assert.equal(channelOf('', 'sent a TY card'), 'mail');
    assert.equal(channelOf('', 'hello'), '');
  });
  it('summary and tags come from the notes', () => {
    assert.equal(shortSummary('Thanked her. Wants a visit.', 'call'), 'Thanked her.');
    assert.equal(shortSummary('', 'vm'), 'Left a voicemail');
    assert.deepEqual(tagsOf('TY for the gift, wants to schedule a visit', '', 'text'), ['thanked', 'texted', 'scheduling']);
    assert.equal(askOf('', 'asked for $10k'), 10000);
    assert.equal(askOf('$1,500', ''), 1500);
    assert.equal(askOf('', 'nothing'), null);
  });
  it('a pasted row has a stable reference so pasting twice adds it once', () => {
    const r = { name: 'Example, Ada', notes: 'Thanked her.' };
    assert.equal(pasteRef('31', r, '2026-10-07'), pasteRef('31', { name: 'example ada', notes: ' thanked her ' }, '2026-10-07'));
    assert.notEqual(pasteRef('31', r, '2026-10-07'), pasteRef('31', r, '2026-10-08'));
    assert.notEqual(pasteRef('31', r, '2026-10-07'), pasteRef('32', r, '2026-10-07'));
  });
});

describe('matching a row to a partner', () => {
  const maps = () => ({
    byEmail: new Map([['ada@example.org', ['100']], ['shared@example.org', ['100', '101']]]),
    byPhone: new Map([['8135550100', ['100']]]),
    byName: new Map([['ada example', ['100']], ['bo sample', ['200', '201']], ['cy test', ['300']]]),
    holders: new Map([['200', ['31']], ['201', ['99']]]),
    present: new Set(['100', '101', '200', '201', '300']),
  });
  it('email first, then phone, then name', () => {
    assert.deepEqual(resolvePartner({ email: 'ADA@example.org', phone: '', name: 'Someone Else' }, '31', maps()), { how: 'email', hits: ['100'] });
    assert.deepEqual(resolvePartner({ email: '', phone: '(813) 555-0100', name: 'Someone Else' }, '31', maps()), { how: 'phone', hits: ['100'] });
    assert.deepEqual(resolvePartner({ email: '', phone: '', name: 'Example, Ada' }, '31', maps()), { how: 'name', hits: ['100'] });
    assert.deepEqual(resolvePartner({ email: '', phone: '', name: 'Cy Test - Acme Inc' }, '31', maps()), { how: 'name', hits: ['300'] });
  });
  it('two records on one email ask a person to pick', () => {
    assert.deepEqual(resolvePartner({ email: 'shared@example.org', phone: '', name: 'x' }, '31', maps()), { how: 'many', hits: ['100', '101'] });
  });
  it("two records with one name: the one in the owner's portfolio wins, else a person picks", () => {
    assert.deepEqual(resolvePartner({ email: '', phone: '', name: 'Bo Sample' }, '31', maps()), { how: 'name_portfolio', hits: ['200'] });
    assert.deepEqual(resolvePartner({ email: '', phone: '', name: 'Bo Sample' }, '55', maps()), { how: 'many', hits: ['200', '201'] });
  });
  it('no match is none', () => {
    assert.deepEqual(resolvePartner({ email: '', phone: '', name: 'Nobody Here' }, '31', maps()), { how: 'none', hits: [] });
  });
  it('a record that is not active in the mirror is never matched by email', () => {
    const m = maps();
    m.present.delete('100');
    assert.equal(resolvePartner({ email: 'ada@example.org', phone: '', name: 'Zed' }, '31', m).how, 'none');
  });
  it('name keys flip Last, First and drop the organization', () => {
    assert.deepEqual(nameKeys('Example, Ada - Acme'), { keys: ['ada example', 'example ada'], org: 'Acme' });
  });
});

describe('duplicates', () => {
  const done = [{ id: '5', cid: '100', due: '2026-10-07T00:00:00', fundraisers: ['31'], category: 'Phone call' }];
  it('the same owner, partner and a date within a day is already in Blackbaud', () => {
    assert.equal(findDuplicate('100', '31', '2026-10-07', done).id, '5');
    assert.equal(findDuplicate('100', '31', '2026-10-08', done).id, '5');
    assert.equal(findDuplicate('100', '31', '2026-10-09', done), null);
    assert.equal(findDuplicate('100', '32', '2026-10-07', done), null);
    assert.equal(findDuplicate('101', '31', '2026-10-07', done), null);
  });
  it('two picked records with one last name and city are flagged as a household', () => {
    const picked = [{ cid: '1', name: 'Jan Sample', place: 'Tampa, FL' }];
    const pool = [{ cid: '2', name: 'Jim Sample', place: 'Tampa, FL' }, { cid: '3', name: 'Al Other', place: 'Tampa, FL' }];
    assert.deepEqual(householdHints(picked, pool), [{ a: '1', b: '2', as: 'Jan Sample', bs: 'Jim Sample' }]);
  });
});

describe('the week and the deadline', () => {
  it('Friday Oct 9 2026 is in the week of Oct 5 to 11, due Monday Oct 12 at 3:00 PM Eastern', () => {
    const w = weekWindow(new Date('2026-10-09T18:00:00Z'));
    assert.deepEqual([w.thisStart, w.thisEnd, w.lastStart, w.lastEnd], ['2026-10-05', '2026-10-11', '2026-09-28', '2026-10-04']);
    assert.equal(w.deadline, '2026-10-12T19:00:00.000Z');
  });
  it('winter uses the standard time offset', () => {
    assert.equal(etInstant('2026-12-14', 15).toISOString(), '2026-12-14T20:00:00.000Z');
    assert.equal(etInstant('2026-10-12', 15).toISOString(), '2026-10-12T19:00:00.000Z');
  });
  it('on Monday before 3:00 PM the week that just ended is still being collected, after 3:00 PM the new week starts', () => {
    assert.equal(weekWindow(new Date('2026-10-12T17:00:00Z')).thisStart, '2026-10-05');
    assert.equal(weekWindow(new Date('2026-10-12T20:30:00Z')).thisStart, '2026-10-12');
  });
  it('a contact belongs to this week, last week or late', () => {
    const w = weekWindow(new Date('2026-10-09T18:00:00Z'));
    assert.equal(weekOf('2026-10-07', w), 'this');
    assert.equal(weekOf('2026-10-02', w), 'last');
    assert.equal(weekOf('2026-09-01', w), 'late');
  });
});

describe('what an entry row writes', () => {
  it('one completed contact of the owner\'s type with the owner as fundraiser', () => {
    const b = entryBody({ cid: '100', date: '2026-10-07', channel: 'call', summary: 'Thanked her', owner: '31', ownerType: 'RDD Action' });
    assert.equal(b.category, 'Phone call');
    assert.equal(b.type, 'RDD Action');
    assert.equal(b.completed, true);
    assert.equal(b.completed_date, '2026-10-07T00:00:00');
    assert.deepEqual(b.fundraisers, ['31']);
    assert.equal(b.direction, 'Outbound');
  });
  it('a meeting is not outbound and the summary is cut at 255', () => {
    const b = entryBody({ cid: '1', date: '2026-10-07', channel: 'meet', summary: 'x'.repeat(300), owner: '31', ownerType: 'RDD Action' });
    assert.equal(b.direction, undefined);
    assert.equal(String(b.summary).length, 255);
  });
  it('a text adds the Texted tag on its own', () => {
    assert.deepEqual(entryTags('text', ['thanked']).sort(), ['texted', 'thanked']);
    assert.deepEqual(entryTags('call', ['bogus', 'scheduling']), ['scheduling']);
  });
});
