import { describe, expect, it } from 'vitest';
import { barCount, buildNav } from '@/shell/model';
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
