import { describe, expect, it } from 'vitest';
import { AREAS } from '@hub/data/areas';
import { barCount, buildNav, pageVisible, tabRowHeld } from '@/shell/model';
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

  it('the phone bar holds four areas, lowest rank first, and More adds up the rest', () => {
    const v = view();
    expect(v.bar).toHaveLength(4);
    const ranks = v.bar.map((a) => a.area.barRank);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
    const off = v.main.filter((a) => !a.inBar).reduce((n, a) => n + a.sum, 0);
    expect(v.more).toBe(off);
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
        const access: Record<string, unknown> = p.need ? { [p.need]: true } : {};
        expect(rowHides(area.id, p.id, access), `${area.id}/${p.id}`).toBe(false);
      }
    }
  });
});
