// Thank-yous (public/js/work.js viewTy): the open thank-you tasks grouped by gift, in three lanes (thanked already, probably done, owed),
// one person at a time or everyone. Closing a row closes every open task Blackbaud holds for that gift.
import { useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { DataTable, DensitySwitch, Pager, clampPage, pageOf, usePageSize, useListKeys, type Column } from '../../../../ui/table';
import { openComplete, openReassign, openReschedule } from './BulkDialogs';
import { ActionBar, Ic } from './ui';
import { ini, money, plural } from './model';
import type { Work, TyGroup } from './model';
import { useRowSelection } from './selection';
import { clearSel, useWc, wcSet } from './store';

const LANE: Record<string, [string, string]> = {
  s: ['Thanked already', 'Thank-you logged after the task'],
  l: ['Probably done', 'Contact logged after the task'],
  o: ['Owed', 'No contact since the task'],
};
const CONTACT: Record<string, string> = { 'Phone call': 'Call', Email: 'Email', Mailing: 'Mailing', Meeting: 'Meeting' };

export function ThankYous({ w }: { w: Work }) {
  const ownerSel = useWc((s) => s.tyOwner);
  const laneSel = useWc((s) => s.tyLane);
  const saving = useWc((s) => s.saving);
  const [size, setSize] = usePageSize('wc-ty', 50);
  const [st, setSt] = useState({ sig: '', page: 1 });
  const host = useRef<HTMLDivElement>(null);
  useListKeys('wc-ty');

  const owners = useMemo(() => {
    const m: Record<string, number> = {};
    w.acts.filter((a) => a.ty && w.isOpenNow(a)).forEach((a) => w.cur(a).f.forEach((x) => (m[x] = (m[x] || 0) + 1)));
    return m;
  }, [w]);
  const ownList = Object.keys(owners).filter(w.live).sort((a, b) => owners[b] - owners[a]);
  const owner = ownerSel && owners[ownerSel] ? ownerSel : '';
  const gs = useMemo(() => w.tyGroups(owner), [w, owner]);
  const sec = { s: gs.filter((g) => g.later && g.later.k === 's'), l: gs.filter((g) => g.later && g.later.k === 'l'), o: gs.filter((g) => !g.later) };
  const lane = (!laneSel || (!sec[laneSel as 's'].length && gs.length) ? (sec.s.length ? 's' : sec.l.length ? 'l' : 'o') : laneSel) as 's' | 'l' | 'o';
  const L = sec[lane];
  const map = useMemo(() => Object.fromEntries(gs.map((g) => [g.key, g])), [gs]);
  const sig = 'ty|' + owner + '|' + lane;
  const page = clampPage(st.sig === sig ? st.page : 1, L.length, size);
  const rows = pageOf(L, page, size);
  const tyIds = (keys: string[]) => ([] as string[]).concat(...keys.map((k) => (map[k] ? map[k].ids : [k]))).filter((id) => w.byId[id] && w.isOpenNow(w.byId[id]));
  const grpSaving = (g: TyGroup) => g.ids.some((id) => saving[id] === 'saving' || w.pendingOf(w.byId[id]));
  const sel = useRowSelection({ ids: L.map((g) => g.key), page: rows.map((g) => g.key), selectable: (k) => !!map[k] && !grpSaving(map[k]) });
  const ks = [...sel.selected].filter((k) => map[k]);
  const mode = ks.length && ks.every((k) => map[k].later) ? 'close' : 'mark';
  const n = tyIds(ks).length;

  const columns: Column<TyGroup>[] = [
    {
      key: 'partner',
      label: 'Partner',
      fixed: true,
      cell: (g) => (
        <div className="wc-partner">
          <Link className="wc-plink" to="/work/partner/$id/" params={{ id: g.a.cid }}>
            {g.a.p}
          </Link>
          <span className="wc-sub">
            {g.a.loc || 'No city on file'} · {w.cur(g.a).f.map((x) => w.P(x).n).join(', ')}
          </span>
        </div>
      ),
    },
    {
      key: 'task',
      label: 'Task',
      fixed: true,
      cell: (g) => {
        const a = g.a;
        const failed = g.ids.some((id) => saving[id] === 'failed');
        return (
          <div className="wc-what wc-task">
            <b>{a.sum || a.type}</b>
            <div className="wc-tags">
              {a.gift ? (
                <span className="wc-tag wc-tag--gift">
                  {money(a.gift.a)} on {w.fd(a.gift.d)}
                  {a.gift.fund ? ' · ' + a.gift.fund : ''}
                </span>
              ) : (
                <span className="wc-tag">Gift not named in the task</span>
              )}
              {g.ids.length > 1 ? (
                <span className="wc-tag" title={`Blackbaud holds ${g.ids.length} open tasks for this one gift. Closing the row closes all of them.`}>
                  {g.ids.length} tasks, one gift
                </span>
              ) : null}
              {grpSaving(g) ? <span className="wc-tag wc-tag--saving">Saving</span> : null}
              {failed ? <span className="wc-tag wc-tag--warn">Did not go through. Try again.</span> : null}
            </div>
          </div>
        );
      },
    },
    {
      key: 'evid',
      label: lane === 'o' ? 'Owed' : 'Logged after the task',
      fixed: true,
      cell: (g) => {
        const age = -w.dayn(g.a.add);
        return (
          <div className="wc-evid">
            {g.later ? (
              <>
                <b>{g.later.s || '(no summary)'}</b>
                <span>
                  {g.later.k === 's' ? 'Thanked' : CONTACT[g.later.cat] || 'Contact'} {w.fd(g.later.d)} · {g.later.by.map((x) => w.P(x).n).join(', ') || 'no fundraiser'}
                </span>
              </>
            ) : (
              <>
                <b>{age <= 0 ? 'Owed since today' : 'Owed ' + plural(age, 'day')}</b>
                <span>No contact logged on this partner since the task was made</span>
              </>
            )}
          </div>
        );
      },
    },
    {
      key: 'btn',
      label: '',
      fixed: true,
      cell: (g) => (
        <div className="wc-rowbtn">
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openComplete(tyIds([g.key]), lane === 's' ? 'close' : undefined)}>
            {lane === 's' ? 'Close' : lane === 'l' ? 'That was it' : 'Thanked'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="wc-owners" role="tablist" aria-label="Whose thank-yous">
        <button type="button" className={'wc-owner' + (!owner ? ' is-on' : '')} onClick={() => (wcSet({ tyOwner: '', tyLane: '' }), clearSel())}>
          <span className="wc-ini">All</span>Everyone<em>{w.tyGroups('').length}</em>
        </button>
        {ownList.map((x) => (
          <button key={x} type="button" className={'wc-owner' + (owner === x ? ' is-on' : '')} onClick={() => (wcSet({ tyOwner: x, tyLane: '' }), clearSel())}>
            <span className="wc-ini">{ini(w.P(x).n)}</span>
            {w.P(x).n}
            <em>{w.tyGroups(x).length}</em>
          </button>
        ))}
      </div>
      <section className="h-card wc-sheet" id="wc-ty" aria-label="Thank-yous">
        <div className="wc-filters">
          <div className="wc-lanes" role="tablist">
            {(['s', 'l', 'o'] as const).map((k) => (
              <button key={k} type="button" className={'wc-lane' + (lane === k ? ' is-on' : '')} onClick={() => (wcSet({ tyLane: k }), clearSel())}>
                {LANE[k][0]}
                <span>{sec[k].length}</span>
              </button>
            ))}
          </div>
          <div className="wc-tools">
            <DensitySwitch />
            <button type="button" className="h-btn h-btn--ghost h-btn--sm wc-phonly" onClick={() => host.current?.querySelector<HTMLInputElement>('thead .pt-cb input')?.click()}>
              Select all
            </button>
            {lane === 's' && L.length ? (
              <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => openComplete(tyIds(L.filter((g) => g.later && g.later.k === 's').map((g) => g.key)), 'close')}>
                <Ic n="check" />
                Close all {L.length}
              </button>
            ) : null}
          </div>
        </div>
        <div ref={host} style={{ display: 'contents' }}>
          <DataTable
            listKey="wc-ty"
            label="Thank-yous"
            className="wc-grid wc-tg wc-at"
            columns={columns}
            rows={rows}
            rowKey={(g) => g.key}
            select={sel.select}
            onRowClick={(g, e) => sel.rowClick(g.key, e)}
            rowClassName={(g) => (grpSaving(g) ? 'is-saving' : '')}
            empty={
              <div className="pt-empty">
                <b>Nothing here</b>
                {gs.length ? 'Pick another lane above.' : 'Every thank-you task for this person is closed.'}
              </div>
            }
            fit={330}
          />
        </div>
        <div className="wc-foot">
          <Pager
            listKey="wc-ty"
            total={L.length}
            page={page}
            size={size}
            noun={`rows, ${plural(L.reduce((c, g) => c + g.ids.length, 0), 'open task')} in Blackbaud`}
            onPage={(pg, sz) => {
              if (sz !== size) setSize(sz);
              setSt({ sig, page: pg });
            }}
          />
          <span className="wc-keys">
            <span>
              <kbd>Shift</kbd>click a range
            </span>
            <span>
              <kbd>Esc</kbd>clear
            </span>
          </span>
        </div>
      </section>
      <ActionBar>
        {ks.length ? (
          <>
            <span className="wc-bar__n">{ks.length}</span>
            <span className="wc-bar__l">selected{n !== ks.length ? ` · ${n} tasks` : ''}</span>
            <span className="wc-bar__acts">
              <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => openComplete(tyIds(ks), mode === 'close' ? 'close' : undefined)}>
                <Ic n="check" />
                {mode === 'close' ? 'Close as thanked' : 'Mark thanked'}
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openReassign(tyIds(ks))}>
                <Ic n="user" />
                Reassign
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openReschedule(tyIds(ks))}>
                <Ic n="cal" />
                Reschedule
              </button>
            </span>
            <button type="button" className="wc-bar__x" aria-label="Clear the selection" onClick={clearSel}>
              <Ic n="x" />
            </button>
          </>
        ) : null}
      </ActionBar>
    </>
  );
}
