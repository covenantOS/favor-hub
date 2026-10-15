// Actions > Opportunities: the moves-management list. Port of viewOpps in public/js/work-edit.js. A band of stages (press one to filter),
// a filter bar, the shared table with the classic columns, and the pager. A row opens the opportunity dialog.
import { Suspense, useDeferredValue, useMemo, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { DataTable, DensitySwitch, Pager, pageOf, clampPage, useListControls, useListKeys, type Column, type Sort } from '../../../../ui/table';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { openOpp } from './OppDialog';
import { codesQuery, oppsQuery, type OppRow } from './queries';
// Whole dollars, like the classic list.
const money = (n: unknown) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
import { Ic, Skel } from './ui';
import { useBoard, useWork } from './useWork';
import './opportunities.css';

interface OppF {
  fr: string;
  status: string;
  purpose: string;
  q: string;
  inactive: boolean;
}
const NO_FILTER: OppF = { fr: '', status: '', purpose: '', q: '', inactive: false };

export function Opportunities({ as }: { as?: string }) {
  return (
    <ErrorBoundary label="The opportunities could not load." className="h-card">
      <Suspense fallback={<Skel rows={5} />}>
        <OppList as={as} />
      </Suspense>
    </ErrorBoundary>
  );
}

function OppList({ as }: { as?: string }) {
  const { rows, names } = useSuspenseQuery(oppsQuery(as)).data;
  const codes = useSuspenseQuery(codesQuery(as)).data.codes;
  const wc = useWork(useBoard(as));
  const [f, setF] = useState<OppF>(NO_FILTER);
  const [sort, setSort] = useState<Sort | undefined>(undefined);
  const [q, setQ] = useState('');
  const df = useDeferredValue(f);
  const columns = useMemo<Column<OppRow>[]>(
    () => [
      {
        key: 'name',
        label: 'Opportunity',
        sort: 'name',
        fixed: true,
        cell: (o) => (
          <>
            <b>{o.name || 'No name'}</b>
            {o.purpose ? <small className="pt-sub"> {o.purpose}</small> : null}
          </>
        ),
      },
      { key: 'partner', label: 'Partner', sort: 'partner', phone: true, cell: (o) => names[o.cid] || 'Partner ' + o.cid },
      { key: 'status', label: 'Status', sort: 'status', phone: true, cell: (o) => <i className="ep-ostatus">{o.status || 'No status'}</i> },
      { key: 'ask', label: 'Ask', sort: 'ask', num: true, phone: true, cell: (o) => (o.ask ? money(o.ask) : '') },
      { key: 'expected', label: 'Expected', sort: 'expected', num: true, cell: (o) => (o.expected ? money(o.expected) : '') },
      { key: 'funded', label: 'Funded', sort: 'funded', num: true, cell: (o) => (o.funded ? money(o.funded) : '') },
      { key: 'date', label: 'Next date', sort: 'date', cell: (o) => wc.fd(o.deadline || o.expectedDate || o.askDate || '') },
      { key: 'fr', label: 'Fundraisers', sort: 'fr', cell: (o) => o.fundraisers.map((x) => wc.P(x).n).join(', ') },
    ],
    [names, wc]
  );
  const ctl = useListControls<OppRow>('wc-opps', columns, 50);
  useListKeys('wc-opps', { search: '[data-oq]' });

  const base = useMemo(() => rows.filter((o) => df.inactive || !o.inactive), [rows, df.inactive]);
  const list = useMemo(() => {
    const words = df.q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = rows.filter((o) => {
      if (!df.inactive && o.inactive) return false;
      if (df.fr && !o.fundraisers.includes(df.fr)) return false;
      if (df.status && (o.status || '(none)') !== df.status) return false;
      if (df.purpose && o.purpose !== df.purpose) return false;
      if (words.length) {
        const hay = (o.name + ' ' + (names[o.cid] || '') + ' ' + o.summary).toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    if (!sort) return out;
    const key = (o: OppRow): string | number => {
      switch (sort.col) {
        case 'name':
          return (o.name || '').toLowerCase();
        case 'partner':
          return (names[o.cid] || 'Partner ' + o.cid).toLowerCase();
        case 'status':
          return (o.status || '').toLowerCase();
        case 'ask':
          return o.ask || '';
        case 'expected':
          return o.expected || '';
        case 'funded':
          return o.funded || '';
        case 'date':
          return o.deadline || o.expectedDate || o.askDate || '';
        default:
          return o.fundraisers.map((x) => wc.P(x).n).join(', ').toLowerCase();
      }
    };
    const d = sort.dir === 'asc' ? 1 : -1;
    // A blank date or name sorts last either way.
    return out.slice().sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return 0;
      if (x === '') return 1;
      if (y === '') return -1;
      return (x < y ? -1 : 1) * d;
    });
  }, [rows, names, df, sort, wc]);

  const by: Record<string, { n: number; ask: number }> = {};
  for (const o of base) {
    const k = o.status || '(none)';
    by[k] = by[k] || { n: 0, ask: 0 };
    by[k].n++;
    by[k].ask += o.ask || o.expected || 0;
  }
  const stages = (codes.oppStatuses || []).filter((s) => by[s]).concat(by['(none)'] ? ['(none)'] : []);
  const frs = [...new Set(rows.flatMap((o) => o.fundraisers))].sort((a, b) => wc.P(a).n.localeCompare(wc.P(b).n));
  const purposes = [...new Set(rows.map((o) => o.purpose).filter(Boolean))].sort();

  const change = (p: Partial<OppF>) => {
    setF((x) => ({ ...x, ...p }));
    ctl.setPage(1);
  };
  const size = ctl.size;
  const page = clampPage(ctl.page, list.length, size);
  const label = list.length === base.length ? (base.length === 1 ? 'opportunity' : 'opportunities') : `matching of ${base.length.toLocaleString('en-US')}`;

  return (
    <>
      <div className="h-card wc-band ep-stages">
        {stages.slice(0, 8).map((s) => (
          <button key={s} type="button" className={'wc-stat' + (f.status === s ? ' is-on' : '')} onClick={() => change({ status: f.status === s ? '' : s })}>
            <b>{by[s].n}</b>
            <span>{s === '(none)' ? 'No status' : s}</span>
            {by[s].ask ? <small className="ep-stageamt">{money(by[s].ask)}</small> : null}
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" aria-label="Opportunities">
        <div className="wc-filters">
          <label className="wc-find">
            <Ic n="search" />
            <span className="sr-only">Find an opportunity</span>
            <input
              type="search"
              data-oq=""
              placeholder="Find an opportunity or partner"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                change({ q: e.target.value });
              }}
            />
          </label>
          <select className={'wc-sel' + (f.fr ? ' is-set' : '')} aria-label="Fundraiser" value={f.fr} onChange={(e) => change({ fr: e.target.value })}>
            <option value="">Every fundraiser</option>
            {frs.map((x) => (
              <option key={x} value={x}>
                {wc.P(x).n}
              </option>
            ))}
          </select>
          <select className={'wc-sel' + (f.status ? ' is-set' : '')} aria-label="Status" value={f.status} onChange={(e) => change({ status: e.target.value })}>
            <option value="">Every status</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s === '(none)' ? 'No status' : s}
              </option>
            ))}
          </select>
          <select className={'wc-sel' + (f.purpose ? ' is-set' : '')} aria-label="Purpose" value={f.purpose} onChange={(e) => change({ purpose: e.target.value })}>
            <option value="">Every purpose</option>
            {purposes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="wc-toggle">
            <input type="checkbox" checked={f.inactive} onChange={(e) => change({ inactive: e.target.checked })} />
            Show inactive
          </label>
          <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => openOpp()}>
            <Ic n="plus" />
            New opportunity
          </button>
          <DensitySwitch />
        </div>
        <div className="wc-scroll ep-opps">
          <DataTable<OppRow>
            listKey="wc-opps"
            label="Opportunities"
            columns={columns}
            rows={pageOf(list, page, size)}
            rowKey={(o) => o.id}
            sort={sort}
            onSort={(s) => {
              setSort(s);
              ctl.setPage(1);
            }}
            onOpen={(o) => openOpp(o)}
            rowClassName={(o) => (o.inactive ? 'is-inactive' : '')}
            hidden={ctl.hidden}
            fit={330}
            empty={
              <div className="wc-empty">
                <b>Nothing matches</b>Change a filter.
              </div>
            }
          />
        </div>
        <div className="wc-foot">
          <Pager listKey="wc-opps" total={list.length} page={page} size={size} noun={label} onPage={(p, s) => (s !== size ? (ctl.setSize(s), ctl.setPage(1)) : ctl.setPage(p))} />
        </div>
      </section>
    </>
  );
}
