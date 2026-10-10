// Where each Blackbaud query went. A lookup: type a query name, see what replaced it. No mirror read.
import { QUERY_MAP } from '../qmap';
import { noTie } from '../tieout';
import type { ReportDef } from '../types';

const def: ReportDef = {
  id: 'query-map',
  filters: [{ id: 'now', label: 'What replaced it', type: 'select', def: '', options: [['', 'Everything'], ['report', 'A report here'], ['wc', 'Work Center'], ['brain', 'Favor Brain'], ['machine', 'Morning run'], ['oneoff', 'One-off clean-up']] }],
  columns: [
    { key: 'query', label: 'Blackbaud query' },
    { key: 'folder', label: 'Folder' },
    { key: 'owner', label: 'Owner' },
    { key: 'last', label: 'Last run', type: 'date' },
    { key: 'now', label: 'Now' },
    { key: 'report', label: 'Report id' },
  ],
  pageSize: 500,
  async load(_ctx, f) {
    const rows = QUERY_MAP.filter((r) => !f.now || r[4] === f.now).map((r) => ({ query: r[0], folder: r[1], owner: r[2], last: r[3], kind: r[4], now: r[5], report: r[6] }));
    return { rows, asOf: '2026-10-09' };
  },
  totals: () => ({}),
  tiles(rows) {
    const by = (k: string) => rows.filter((r) => r.kind === k).length;
    return [
      { label: 'Queries run in 2026', value: rows.length, kind: 'int' },
      { label: 'A report or a KPI tab', value: by('report'), kind: 'int' },
      { label: 'Work Center or Brain', value: by('wc') + by('brain'), kind: 'int' },
      { label: 'Morning run', value: by('machine'), kind: 'int' },
    ];
  },
  async tie() {
    return noTie('');
  },
};
export default def;
