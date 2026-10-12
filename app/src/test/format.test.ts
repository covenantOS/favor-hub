import { describe, expect, it } from 'vitest';
import { compact, dateLong, dayLabel, dayShort, initials, money0, money2, nameFromEmail, oneLine, plainMentions } from '@/lib/format';

describe('the shared format module', () => {
  it('money', () => {
    expect(money0(1234567.6)).toBe('$1,234,568');
    expect(money0(-5)).toBe('-$5');
    expect(money2(12)).toBe('$12.00');
    expect(compact(4_120_000)).toBe('$4.12M');
    expect(compact(52_400)).toBe('$52K');
    expect(compact(999_600)).toBe('$1.00M');
  });
  it('dates', () => {
    expect(dayShort('2026-10-12')).toBe('Oct 12');
    expect(dayLabel('2026-10-12')).toBe('Mon, Oct 12');
    expect(dateLong('2026-10-12')).toBe('Oct 12, 2026');
  });
  it('names', () => {
    expect(nameFromEmail('ada.lovelace@favorintl.org')).toBe('Ada Lovelace');
    expect(initials('Mrs. Ada B. Lovelace')).toBe('AL');
    expect(initials('')).toBe('?');
    expect(plainMentions('hi <@brain> and <@a.b@favorintl.org>')).toBe('hi @Favor Brain and @A B');
    expect(oneLine('a\n\n b', 3)).toBe('a b');
  });
});
