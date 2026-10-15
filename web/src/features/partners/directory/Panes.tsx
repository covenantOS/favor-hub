// The All partners page's other list: the partners you opened lately (on any device). Possible duplicates and merge requests are
// one queue, in Data care (a link on the tab row).
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { queryOptions } from '@tanstack/react-query';
import { hubGet } from '../../../lib/hub';
import { DataTable, type Column } from '../../../ui/table';
import { fd, KIND, money, recentQuery, short, todayEt, type Card } from '../api';

const waitingQuery = queryOptions({
  queryKey: ['partners', 'merge-count'],
  queryFn: async () => Number(((await hubGet('/api/partners/merges')) as { waiting?: number }).waiting) || 0,
  staleTime: 60_000,
});

/** The pairs waiting in the duplicates queue, for the count on the tab. Read after the page draws. */
export function useMergeCount(): number {
  const q = useQuery(waitingQuery);
  return q.data || 0;
}

export function RecentPane() {
  const { data } = useSuspenseQuery(recentQuery);
  const today = todayEt();
  const cols: Column<Card>[] = [
    { key: 'name', label: 'Name', fixed: true, cell: (r) => <><a className="pt-name" href={`/work/partner/${r.id}`} data-partner-id={r.id} data-pt-open="">{r.name || 'Record ' + r.id}</a>{r.lookup ? <span className="pt-sub"> {r.lookup}</span> : null}</> },
    { key: 'kind', label: 'Kind', cell: (r) => KIND[r.kind] || '' },
    { key: 'place', label: 'City and state', cell: (r) => [r.city, r.state].filter(Boolean).join(', ') },
    { key: 'holder', label: 'Holder', cell: (r) => r.holder_names || '' },
    { key: 'lifetime', label: 'Lifetime', num: true, phone: true, cell: (r) => (r.lifetime > 0 ? short(r.lifetime) : '') },
    { key: 'last', label: 'Last gift', num: true, cell: (r) => (r.last_gift ? <>{money(r.last_amt)} <span className="pt-sub">{fd(r.last_gift, today)}</span></> : '') },
  ];
  return (
    <section className="h-card pd-sheet">
      <div className="pd-panehead">
        <b>Recently opened</b>
        <span>The last partner records you opened, on any device.</span>
      </div>
      <DataTable<Card> listKey="pd-recent" label="Recently opened" columns={cols} rows={data} rowKey={(r) => String(r.id)} noFit empty={<div className="pt-empty"><b>Partners you open show here.</b></div>} />
    </section>
  );
}
