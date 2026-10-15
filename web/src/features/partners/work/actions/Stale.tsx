// Stale (public/js/work.js viewStale): open actions that have gone quiet, in six lanes, with one-press bulk fixes for the first ones.
import { useMemo } from 'react';
import { DensitySwitch } from '../../../../ui/table';
import { ActionTable, useActionTable } from './ActionTable';
import { openComplete, openReassign } from './BulkDialogs';
import { plural } from './model';
import type { Work } from './model';
import { clearSel, useWc, wcSet } from './store';
import { Ic } from './ui';
import type { BoardData } from './types';

export function Stale({ w, board }: { w: Work; board: BoardData }) {
  const laneK = useWc((s) => s.stLane);
  const sort = useWc((s) => s.sort);
  const dir = useWc((s) => s.dir);
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const at = useActionTable(w, 'wc-stale');
  const base = useMemo(() => w.acts.filter(w.isOpenNow), [w]);
  const lane = w.LANES.find((l) => l.k === laneK) || w.LANES[0];
  const list = useMemo(() => w.sorted(base.filter(lane.test), sort, dir), [w, base, lane, sort, dir]);
  const big = list.filter((a) => a.gift && a.gift.a >= 1000);
  const pick = () => list.filter((a) => !(a.gift && a.gift.a >= 1000)).filter((a) => !(saving[a.id] === 'saving' || queued[a.id] || w.pendingOf(a) || w.queuedOf(a))).map((a) => a.id);
  return (
    <>
      <div className="wc-lanecards">
        {w.LANES.map((l) => (
          <button key={l.k} type="button" className={'wc-lc' + (l.k === lane.k ? ' is-on' : '')} onClick={() => (wcSet({ stLane: l.k }), clearSel())}>
            <b>{base.filter(l.test).length}</b>
            <span>{l.n}</span>
            <small>{l.hint}</small>
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" id="wc-stale">
        <div className="wc-lanehead">
          <p>
            <b>{lane.n}.</b> {lane.hint}
            {big.length ? ` ${plural(big.length, 'task')} here ${big.length === 1 ? 'is' : 'are'} about a gift of $1,000 or more and ${big.length === 1 ? 'is' : 'are'} left out of Select all; pick ${big.length === 1 ? 'it' : 'them'} by hand.` : ''}
          </p>
          <span className="wc-lanehead__acts">
            <DensitySwitch />
            {lane.k === 'left' ? (
              <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => openReassign(pick())}>
                <Ic n="user" />
                Give all to current holders
              </button>
            ) : ['year', '90', 'none'].includes(lane.k) ? (
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openComplete(pick(), undefined, { line: 'Closed as no longer needed' })}>
                <Ic n="check" />
                Close all as no longer needed
              </button>
            ) : null}
          </span>
        </div>
        <ActionTable
          w={w}
          list={list}
          total={base.length}
          listKey="wc-stale"
          sig={'stale|' + lane.k + '|' + sort + '|' + dir}
          columns={at.columns}
          hidden={at.hidden}
          sort={{ col: sort, dir: dir === 1 ? 'asc' : 'desc' }}
          onSort={(s) => wcSet({ sort: s.col, dir: s.dir === 'asc' ? 1 : -1 })}
          boardTotal={board.total}
          bulkable={(a) => !(a.gift && a.gift.a >= 1000)}
          stale
        />
      </section>
      {at.popEl}
    </>
  );
}
