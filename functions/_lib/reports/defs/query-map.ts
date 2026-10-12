// Where each Blackbaud query went. A lookup: type a query name, see what replaced it and how it was checked. No mirror read.
import { QUERY_MAP } from '../qmap';
import { noTie } from '../tieout';
import type { ReportDef } from '../types';

/** Days back that count as "staff still run it". */
export const RECENT_DAYS = 120;

const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const def: ReportDef = {
  id: 'query-map',
  filters: [
    { id: 'now', label: 'What replaced it', type: 'select', def: '', options: [['', 'Everything'], ['report', 'A report here'], ['wc', 'Work Center'], ['brain', 'Favor Brain'], ['machine', 'Morning run'], ['oneoff', 'One-off clean-up']] },
    { id: 'recent', label: 'Last run', type: 'seg', def: '', options: [['', 'Any time in 2026'], ['120', 'Last 120 days']] },
  ],
  columns: [
    { key: 'qid', label: 'Query ID', type: 'id' },
    { key: 'query', label: 'Blackbaud query' },
    { key: 'folder', label: 'Folder' },
    { key: 'owner', label: 'Owner' },
    { key: 'last', label: 'Last run', type: 'date' },
    { key: 'now', label: 'Now' },
    { key: 'tie', label: 'Checked against the query' },
    { key: 'report', label: 'Report id' },
  ],
  pageSize: 500,
  async load(ctx, f) {
    const cutoff = addDays(ctx.today, -RECENT_DAYS);
    const rows = QUERY_MAP.filter((r) => (!f.now || r[4] === f.now) && (f.recent !== '120' || r[3] >= cutoff)).map((r) => ({
      qid: r[7],
      query: r[0],
      folder: r[1],
      owner: r[2],
      last: r[3],
      kind: r[4],
      now: r[5],
      report: r[6],
      tie: r[8],
    }));
    return { rows, asOf: '2026-10-11' };
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
