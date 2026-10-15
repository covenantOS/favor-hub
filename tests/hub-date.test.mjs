// Typed dates (public/js/hub-date.js): the forms people type into a due date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const box = { globalThis: {} };
box.globalThis = box;
vm.runInNewContext(readFileSync(new URL('../public/js/hub-date.js', import.meta.url), 'utf8'), box);
const { parse } = box.hubDate;
const T = '2026-10-14'; // a Wednesday
const p = (s) => (parse(s, T) || {}).ymd || null;

test('words for nearby days', () => {
  assert.equal(p('today'), '2026-10-14');
  assert.equal(p('tomorrow'), '2026-10-15');
  assert.equal(p('tmrw'), '2026-10-15');
  assert.equal(p('next week'), '2026-10-19');
  assert.equal(p('end of week'), '2026-10-16');
  assert.equal(p('weekend'), '2026-10-17');
  assert.equal(p('end of month'), '2026-10-31');
  assert.equal(p('next month'), '2026-11-01');
});

test('weekdays: the next one, today included; next means next week', () => {
  assert.equal(p('fri'), '2026-10-16');
  assert.equal(p('friday'), '2026-10-16');
  assert.equal(p('wed'), '2026-10-14');
  assert.equal(p('mon'), '2026-10-19');
  assert.equal(p('tues'), '2026-10-20');
  assert.equal(p('next fri'), '2026-10-23');
  assert.equal(p('next mon'), '2026-10-19');
  assert.equal(p('this thu'), '2026-10-15');
  assert.equal(p('by fri'), '2026-10-16');
});

test('counts of days, weeks and months', () => {
  assert.equal(p('in 3 days'), '2026-10-17');
  assert.equal(p('in a week'), '2026-10-21');
  assert.equal(p('2 weeks'), '2026-10-28');
  assert.equal(p('3d'), '2026-10-17');
  assert.equal(p('+10'), '2026-10-24');
  assert.equal(p('in 1 month'), '2026-11-14');
  assert.equal(p('in two weeks'), '2026-10-28');
});

test('calendar dates, passed ones mean next year', () => {
  assert.equal(p('oct 20'), '2026-10-20');
  assert.equal(p('October 20th'), '2026-10-20');
  assert.equal(p('20 oct'), '2026-10-20');
  assert.equal(p('10/20'), '2026-10-20');
  assert.equal(p('1/5'), '2027-01-05');
  assert.equal(p('sept 1'), '2027-09-01');
  assert.equal(p('10/20/27'), '2027-10-20');
  assert.equal(p('2026-12-01'), '2026-12-01');
  assert.equal(p('the 20th'), '2026-10-20');
  assert.equal(p('3rd'), '2026-11-03');
});

test('nonsense and impossible dates give nothing', () => {
  assert.equal(p(''), null);
  assert.equal(p('soon'), null);
  assert.equal(p('feb 30'), null);
  assert.equal(p('13/40'), null);
  assert.equal(p('m'), null);
});

test('labels read like the rest of FavorOS', () => {
  assert.equal(parse('fri', T).label, 'Fri, Oct 16');
});
