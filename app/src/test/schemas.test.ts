import { describe, expect, it } from 'vitest';
import { app2Response, dayResponse, kpiResponse, navResponse, todayResponse } from '@shared/schemas';
import { day, kpi, nav, staffNav, today } from '../../e2e/fixtures';

describe('shared schemas accept what the API sends', () => {
  it('nav, today, day and kpi fixtures parse', () => {
    expect(navResponse.parse(nav).user.email).toBe('test.admin@favorintl.org');
    expect(navResponse.parse(staffNav).access.admin).toBe(false);
    expect(todayResponse.parse(today).cards).toHaveLength(3);
    expect(dayResponse.parse(day).google.events).toHaveLength(2);
    expect(kpiResponse.parse(kpi).summary.teams[2].measure).toBe('awarded');
  });

  it('a card missing its optional fields still parses with defaults', () => {
    const r = todayResponse.parse({ ...today, cards: [{ id: 'x', label: 'X', n: 1, what: 'w', href: '/x/' }] });
    expect(r.cards[0]).toMatchObject({ note: '', warn: false });
  });

  it('a renamed field fails: this is how a server change is caught', () => {
    const bad = { ...today, cards: [{ id: 'x', label: 'X', count: 1, what: 'w', href: '/x/' }] };
    expect(todayResponse.safeParse(bad).success).toBe(false);
  });

  it('an access flag the server adds later passes through', () => {
    const r = navResponse.parse({ ...nav, access: { ...nav.access, someNewFlag: true } });
    expect((r.access as Record<string, unknown>).someNewFlag).toBe(true);
  });

  it('the app2 answer is checked', () => {
    expect(app2Response.parse({ ok: true, eligible: true, optedIn: false, routes: ['/'], audience: 'admin' }).routes).toEqual(['/']);
    expect(app2Response.safeParse({ ok: true, eligible: 'yes' }).success).toBe(false);
  });
});
