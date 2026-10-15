import { describe, expect, it } from 'vitest';
import { AREAS } from '@hub/data/areas';
import { NO_HINT, barCount, buildNav, pageVisible, tabRowDrawn, tabRowHeld, tabRowHeldFor } from '@/shell/model';
import { nav, staffNav } from '../../e2e/fixtures';

const view = (n = nav, navId = 'home', tours = 0) => buildNav({ access: n.access, kpiTeams: n.kpiTeams, counts: n.counts, navId, tours });

describe('the menu for one person', () => {
  it('an admin sees gated pages, staff do not', () => {
    const a = view();
    const s = view(staffNav);
    const pages = (v: ReturnType<typeof view>, area: string) => v.areas.find((x) => x.area.id === area)!.pages.map((p) => p.page.id);
    expect(pages(a, 'partners')).toContain('work');
    expect(pages(s, 'partners')).not.toContain('work');
    expect(s.areas.find((x) => x.area.id === 'chat')!.visible).toBe(false);
    expect(a.areas.find((x) => x.area.id === 'chat')!.visible).toBe(true);
  });

  it('KPI team pages need the team', () => {
    const a = view({ ...nav, kpiTeams: ['pc'] });
    const ids = a.areas.find((x) => x.area.id === 'kpi')!.pages.map((p) => p.page.id);
    expect(ids).toContain('kpi-pc');
    expect(ids).not.toContain('kpi-rdds');
  });

  it('an area shows the sum of its pages and the receipts count is a warning', () => {
    const gifts = view().areas.find((x) => x.area.id === 'gifts')!;
    expect(gifts.sum).toBe(4);
    expect(gifts.warn).toBe(true);
    const projects = view().areas.find((x) => x.area.id === 'projects')!;
    expect(projects.sum).toBe(1);
  });

  it('marks the current area and page', () => {
    const v = view(nav, 'work');
    expect(v.curArea).toBe('partners');
    expect(v.areas.find((x) => x.area.id === 'partners')!.pages.find((p) => p.page.id === 'work')!.on).toBe(true);
  });

  it('the rail lists every area the person can open in one order, with no More', () => {
    const order = ['today', 'partners', 'gifts', 'projects', 'ask', 'kpi', 'staff', 'meet', 'chat', 'mail'];
    for (const n of [nav, staffNav]) {
      const ids = view(n).main.filter((a) => a.visible).map((a) => a.area.id);
      expect(ids).toEqual(order.filter((id) => ids.includes(id)));
    }
    expect(view().main.map((a) => a.area.id)).toEqual(order);
  });

  it('the phone bar holds every area the person can open, in rank order, with no More', () => {
    const v = view();
    expect(v.bar.map((x) => x.area.id)).toEqual(v.main.filter((x) => x.visible).map((x) => x.area.id));
    expect(v.bar.length).toBeGreaterThan(4);
    const ranks = v.bar.map((x) => x.area.barRank);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    expect('more' in v).toBe(false);
  });

  it('99+ on the phone bar, the whole number in the rail', () => {
    expect(barCount(120)).toBe('99+');
    expect(barCount(5)).toBe('5');
  });
});

describe('the tab row the web app holds space for', () => {
  // TabRow hides itself when fewer than two pages show, or one that is the open page.
  const rowHides = (areaId: string, navId: string, access: Record<string, unknown>) => {
    const area = AREAS.find((a) => a.id === areaId)!;
    const pages = area.pages.filter((p) => !p.ext && p.menu !== false);
    const visible = pages.filter((p) => pageVisible(p, access as never, []));
    return visible.length === 0 || (visible.length === 1 && visible[0].id === navId) || pages.length < 2;
  };

  it('holds space on the gift pages and on no page of a one-page area', () => {
    expect(tabRowHeld('gifts-home')).toBe(true);
    expect(tabRowHeld('online-gifts')).toBe(true);
    expect(tabRowHeld('recurring')).toBe(true);
    expect(tabRowHeld('projects')).toBe(false);
    expect(tabRowHeld('not-a-page')).toBe(false);
  });

  it('never holds space for a row that this person would not get', () => {
    // Someone who may open a page has that page's access and nothing else. Wherever the frame holds space, the row still shows.
    for (const area of AREAS) {
      for (const p of area.pages) {
        if (!tabRowHeld(p.id)) continue;
        const access: Record<string, unknown> = { ...(p.need ? { [p.need]: true } : {}), ...(p.early ? { early: true } : {}) };
        expect(rowHides(area.id, p.id, access), `${area.id}/${p.id}`).toBe(false);
      }
    }
  });

  it('holds the row for an admin wherever the area has two pages, and for anyone where the last visit drew one', () => {
    expect(tabRowHeldFor('expenses', NO_HINT)).toBe(false);
    expect(tabRowHeldFor('expenses', { admin: true, rows: {} })).toBe(true);
    expect(tabRowHeldFor('expenses', { admin: false, rows: { staff: 1 } })).toBe(true);
    expect(tabRowHeldFor('expenses', { admin: true, rows: { staff: 0 } })).toBe(false);
    expect(tabRowHeldFor('projects', { admin: true, rows: {} })).toBe(true); // Projects now has the two request pages beside it
    expect(tabRowHeldFor('home', { admin: true, rows: {} })).toBe(false);
    expect(tabRowHeldFor('expense', { admin: true, rows: { staff: 1 } })).toBe(false); // a page that is not in the menu holds nothing
    expect(tabRowHeldFor('not-a-page', { admin: true, rows: {} })).toBe(false);
  });

  it('works out whether the row is drawn the way TabRow does', () => {
    expect(tabRowDrawn('statements', {}, [])).toBe(false);
    expect(tabRowDrawn('statements', { giftEntry: true }, [])).toBe(true);
    expect(tabRowDrawn('projects', { projects: true }, [])).toBe(true);
    expect(tabRowDrawn('not-a-page', {}, [])).toBe(false);
  });
});

describe('what staff see (not early, not admin)', () => {
  // Every gate a staff person could hold is on, so only Early access keeps these pages away.
  const access = { admin: false, early: false, kpi: false, clips: true, clipsRecord: true, bell: true, giftEntry: true, otherGifts: true, moves: true, workCenter: true, chat: true, mail: true, meetings: true, projects: true, projectsNav: true, learn: false, hr: false };
  const v = buildNav({ access, kpiTeams: [], counts: {}, navId: 'home' });
  const ids = v.areas.flatMap((a) => a.pages.map((p) => p.page.id));

  it('gets none of the Alpha and Beta pages', () => {
    for (const id of ['chat', 'mail', 'learn', 'learn-catalog', 'meet', 'meet-book', 'meet-booking', 'meet-notes', 'online-gifts', 'statements', 'other-gifts', 'partners-churches', 'foundations', 'welcome', 'reporting']) {
      expect(ids, id).not.toContain(id);
    }
  });

  it('keeps gift entry and receipts for people with gift entry, and Clips as its own rail item', () => {
    expect(ids).toContain('gift-entry');
    expect(ids).toContain('receipts');
    const clips = v.areas.find((a) => a.pages.some((p) => p.page.id === 'clips'))!;
    expect(clips.area.id).not.toBe('meet');
    expect(v.areas.find((a) => a.area.id === 'meet')!.visible).toBe(false);
    expect(v.areas.find((a) => a.area.id === 'chat')!.visible).toBe(false);
    expect(v.areas.find((a) => a.area.id === 'mail')!.visible).toBe(false);
  });

  it('has no More item on the phone bar', () => {
    expect('more' in v).toBe(false);
    expect(v.bar.map((a) => a.area.id)).toEqual(v.main.filter((a) => a.visible).map((a) => a.area.id));
  });

  it('an early person gets the pages back', () => {
    const e = buildNav({ access: { ...access, early: true }, kpiTeams: [], counts: {}, navId: 'home' });
    const eids = e.areas.flatMap((a) => a.pages.map((p) => p.page.id));
    for (const id of ['meet', 'chat', 'mail', 'online-gifts', 'statements', 'other-gifts', 'partners-churches', 'foundations', 'welcome']) expect(eids, id).toContain(id);
  });
});
