import { describe, expect, it } from 'vitest';
import { filterLocal, mergeHits, typedRows, type Hit } from '@/shell/paletteSources';

const h = (title: string, group: string, extra: Partial<Hit> = {}): Hit => ({ title, desc: '', href: '/' + title, external: false, group, ...extra });

describe('Ctrl K', () => {
  const items = [h('Today', 'Today', { tags: 'home start' }), h('Work Center', 'Work', { need: 'workCenter', tags: 'bulk' }), h('Help docs', 'Help', { searchOnly: true })];
  const open = () => true;

  it('the opening list leaves out search-only rows', () => {
    expect(filterLocal(items, '', open).map((i) => i.title)).toEqual(['Today', 'Work Center']);
  });
  it('a title match beats a tag match and gated rows drop out', () => {
    expect(filterLocal(items, 'work', open)[0].title).toBe('Work Center');
    expect(filterLocal(items, 'bulk', (i) => !i.need)).toEqual([]);
  });
  it('typed rows: Mail only for people with Mail, Ask Brain always last', () => {
    const rows = typedRows('gift report', true);
    expect(rows.map((r) => r.group)).toEqual(['Mail', 'Ask Brain']);
    expect(rows[1].href).toBe('/brain/?ask=gift%20report');
    expect(typedRows('gift report', false).map((r) => r.group)).toEqual(['Ask Brain']);
    expect(typedRows('g', true)).toEqual([]);
    const merged = mergeHits([h('a', 'Help')], [...typedRows('gift', true), h('Ada', 'People'), h('Fund X', 'Funds'), h('Doc', 'Drive')]);
    expect(merged.map((r) => r.group)).toEqual(['People', 'Funds', 'Help', 'Drive', 'Mail', 'Ask Brain']);
  });
});
