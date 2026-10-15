// The table of actions Open actions and Stale share: the shared DataTable with the classic cells (due, partner, type, summary, fundraiser,
// added), the pager, the selection banner and the bar at the foot with Mark complete, Reassign, Reschedule, Edit and Delete.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Pager, DataTable, clampPage, pageOf, useHiddenColumns, usePageSize, useListKeys, type Column, type Sort } from '../../../../ui/table';
import { openBulk, openDelete } from './EditDialogs';
import { openEditPanel } from './EditPanel';
import { openComplete, openReassign, openReschedule } from './BulkDialogs';
import { InlinePop, type PopState } from './InlinePops';
import { ini, money, type Work } from './model';
import { useRowSelection } from './selection';
import { clearSel, useWc } from './store';
import { ActionBar, CAT_IC, Ic } from './ui';
import type { Act } from './types';

/** The columns and the pop-over state of an action list. Render `pop` beside the table. */
export function useActionTable(w: Work, listKey: string, theirsFr = '') {
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const back = useWc((s) => s.back);
  const [pop, setPop] = useState<PopState | null>(null);
  const [hidden, setHidden] = useHiddenColumns(listKey, []);
  const onPop = (kind: PopState['kind'], id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPop((p) => (p && p.kind === kind && p.id === id ? null : { kind, id, rect: { left: r.left, top: r.top, bottom: r.bottom } }));
  };
  const columns = useMemo<Column<Act>[]>(() => {
    const tagsOf = (a: Act) => {
      const sv = saving[a.id] || w.pendingOf(a);
      const q = queued[a.id] || w.queuedOf(a);
      const bk = back[a.id] || a.reopened;
      const out: ReactNode[] = [];
      if (sv === 'saving') out.push(<span key="sv" className="wc-tag wc-tag--saving">Saving</span>);
      if (sv === 'failed') out.push(<span key="fl" className="wc-tag wc-tag--warn">Blackbaud did not answer. Select it and try again.</span>);
      if (q)
        out.push(
          <span key="q" className="wc-tag wc-tag--queued">
            <Ic n="clock" />
            {q}
          </span>
        );
      if (bk)
        out.push(
          <span key="bk" className="wc-tag wc-tag--maybe" title="Someone opened this action again in Blackbaud after it was closed.">
            Reopened
          </span>
        );
      if (a.gift && (a.ty || a.ctg))
        out.push(
          <span key="gf" className="wc-tag wc-tag--gift" title="The gift this task is about">
            {money(a.gift.a)} on {w.fd(a.gift.d)}
          </span>
        );
      if (a.ty && a.later)
        out.push(
          a.later.k === 's' ? (
            <span key="ld" className="wc-tag wc-tag--done" title={a.later.s}>
              Thanked {w.fd(a.later.d)}
            </span>
          ) : (
            <span key="ld" className="wc-tag wc-tag--maybe" title={a.later.s}>
              Contact {w.fd(a.later.d)}, maybe done
            </span>
          )
        );
      if (a.grp)
        out.push(
          <span key="gp" className="wc-tag" title="Another open task is about the same gift">
            {a.grp.length} tasks, one gift
          </span>
        );
      const tg = a.tg || [];
      tg.slice(0, 3).forEach((t, i) =>
        out.push(
          <span key={'t' + i} className="wc-tag wc-tag--tag" title={t}>
            {t}
          </span>
        )
      );
      if (tg.length > 3)
        out.push(
          <span key="tm" className="wc-tag wc-tag--tag" title={tg.slice(3).join(', ')}>
            +{tg.length - 3}
          </span>
        );
      if (a.dec)
        out.push(
          <span key="dc" className="wc-tag wc-tag--warn">
            Deceased
          </span>
        );
      return out;
    };
    return [
      {
        key: 'due',
        label: 'Due',
        sort: 'due',
        firstDir: 'desc',
        fixed: true,
        thClassName: 'c-due',
        cell: (a) => {
          const c = w.cur(a);
          const [lc, ll] = w.lateClass(c.due);
          return (
            <div className="wc-due">
              <button type="button" className="wc-inl" data-inl="due" title="Change the date" onClick={(e) => onPop('due', a.id, e.currentTarget)}>
                <b>{w.fd(c.due)}</b>
                <span className={'wc-late ' + (lc ? 'wc-late--' + lc : '')}>{ll}</span>
              </button>
            </div>
          );
        },
      },
      {
        key: 'partner',
        label: 'Partner',
        sort: 'partner',
        firstDir: 'asc',
        fixed: true,
        thClassName: 'c-partner',
        cell: (a) => (
          <div className="wc-partner">
            <Link className="wc-plink" to="/work/partner/$id/" params={{ id: a.cid }}>
              {a.p}
            </Link>
            <span className="wc-sub">
              {a.loc || 'No city on file'}
              {a.lk ? ' · ID ' + a.lk : ''}
            </span>
          </div>
        ),
      },
      {
        key: 'type',
        label: 'Type',
        thClassName: 'c-type',
        phone: false,
        cell: (a) => {
          const c = w.cur(a);
          return (
            <div className="wc-type">
              <b>{c.type}</b>
              <span className="wc-cat">
                <Ic n={CAT_IC[c.cat] || 'task'} />
                {c.cat}
                <button type="button" className="wc-inl wc-st" data-inl="status" title="Change the status" onClick={(e) => onPop('status', a.id, e.currentTarget)}>
                  Open
                </button>
              </span>
            </div>
          );
        },
      },
      {
        key: 'what',
        label: 'Summary',
        thClassName: 'c-what',
        phone: true,
        cell: (a) => {
          const c = w.cur(a);
          const tags = tagsOf(a);
          return (
            <div className="wc-what">
              <button type="button" className={'wc-open' + (c.sum ? '' : ' is-empty')} title={a.desc} onClick={() => openEditPanel(a.id)}>
                {c.sum || (a.desc ? a.desc.slice(0, 80) : 'No summary')}
              </button>
              {tags.length ? <div className="wc-tags">{tags}</div> : null}
            </div>
          );
        },
      },
      {
        key: 'who',
        label: 'Fundraiser',
        sort: 'fr',
        firstDir: 'asc',
        thClassName: 'c-who',
        phone: false,
        cell: (a) => {
          const c = w.cur(a);
          const theirs = !!theirsFr && !c.f.includes(theirsFr) && a.hold.includes(theirsFr);
          const label = c.f.length ? c.f.map((x) => w.P(x).n).join(', ') : 'No one';
          return (
            <div className="wc-who">
              <button type="button" className="wc-inl wc-inl--who" data-inl="who" title="Change who it belongs to" aria-label={`Owner: ${label}. Change who it belongs to`} onClick={(e) => onPop('who', a.id, e.currentTarget)}>
                {c.f.length ? (
                  c.f.map((x) => (
                    <span key={x} className={w.live(x) ? '' : 'left'} title={`${w.P(x).n}: ${w.live(x) ? w.P(x).team : 'Left Favor or not set up as a fundraiser'}`}>
                      <i className="wc-whoini" aria-hidden="true">
                        {ini(w.P(x).n)}
                      </i>
                      <span className="wc-whon">
                        {w.P(x).n}
                        {w.goneTag(x)}
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="none" title="No one holds this action">
                    <i className="wc-whoini wc-whoini--none" aria-hidden="true">
                      &ndash;
                    </i>
                    <span className="wc-whon">No one</span>
                  </span>
                )}
              </button>
              {theirs ? <span className="wc-sub">On {w.first(theirsFr)}&apos;s partner</span> : null}
            </div>
          );
        },
      },
      {
        key: 'added',
        label: 'Added',
        sort: 'added',
        firstDir: 'desc',
        thClassName: 'c-added',
        phone: false,
        cell: (a) => <div className="wc-added">{w.fd(a.add)}</div>,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, theirsFr, saving, queued, back]);
  const popEl = pop ? <InlinePop pop={pop} w={w} onClose={() => setPop(null)} /> : null;
  return { columns, hidden, setHidden, popEl };
}


/** The list box ends at the foot of the window, so the header row and the pager stay in view and the rows scroll inside it. */
function useFit(host: React.RefObject<HTMLElement | null>) {
  const [fit, setFit] = useState(330);
  useEffect(() => {
    const calc = () => {
      const box = host.current?.querySelector<HTMLElement>('.pt-wrap');
      if (!box || window.innerWidth <= 860) return;
      let below = 0;
      for (let n = box.nextElementSibling; n; n = n.nextElementSibling) below += n.getBoundingClientRect().height;
      const top = box.getBoundingClientRect().top + window.scrollY;
      const sheet = box.closest('section, .h-card') || box;
      const tail = Math.max(0, document.documentElement.scrollHeight - (sheet.getBoundingClientRect().bottom + window.scrollY));
      const next = Math.floor(top + below + Math.min(tail, 120) + 6);
      setFit((f) => (Math.abs(f - next) > 1 ? next : f));
    };
    calc();
    const soon = () => requestAnimationFrame(calc);
    window.addEventListener('resize', soon);
    document.addEventListener('pt:density', soon);
    const t = setTimeout(calc, 250);
    return () => {
      window.removeEventListener('resize', soon);
      document.removeEventListener('pt:density', soon);
      clearTimeout(t);
    };
  });
  return fit;
}

export function ActionTable(p: {
  w: Work;
  list: Act[];
  total: number;
  listKey: string;
  /** Changes when the filters, lane or sort change: the pager goes back to page 1. */
  sig: string;
  columns: Column<Act>[];
  hidden: ReadonlySet<string>;
  sort: Sort;
  onSort: (s: Sort) => void;
  bulkable?: (a: Act) => boolean;
  /** A big total in Blackbaud than the board holds. */
  boardTotal?: number;
  focusId?: string;
  empty?: ReactNode;
  stale?: boolean;
}) {
  const { w, list } = p;
  const [size, setSize] = usePageSize(p.listKey, 50);
  const [st, setSt] = useState({ sig: p.sig, page: 1 });
  const rawPage = st.sig === p.sig ? st.page : 1;
  const page = clampPage(rawPage, list.length, size);
  const rows = pageOf(list, page, size);
  const saving = useWc((s) => s.saving);
  const queued = useWc((s) => s.queued);
  const back = useWc((s) => s.back);
  const leaving = useWc((s) => s.leaving);
  const host = useRef<HTMLDivElement>(null);
  const fit = useFit(host);
  useListKeys(p.listKey, { search: '#q' });
  const ids = useMemo(() => list.map((a) => a.id), [list]);
  const pageIds = useMemo(() => rows.map((a) => a.id), [rows]);
  const selectable = (id: string) => {
    const a = w.byId[id];
    if (!a) return false;
    return !(saving[id] === 'saving' || queued[id] || w.pendingOf(a) || w.queuedOf(a));
  };
  const sel = useRowSelection({ ids, page: pageIds, selectable, bulkable: p.bulkable ? (id) => !!w.byId[id] && p.bulkable!(w.byId[id]) : undefined });

  // /work/?action=<id>: the page opens on the page holding that action and flashes its row.
  const focused = useRef('');
  useEffect(() => {
    if (!p.focusId || focused.current === p.focusId) return;
    const at = list.findIndex((a) => a.id === p.focusId);
    if (at < 0) return;
    focused.current = p.focusId;
    setSt({ sig: p.sig, page: Math.floor(at / size) + 1 });
    setTimeout(() => {
      const r = host.current?.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(p.focusId!)}"]`);
      if (!r) return;
      r.scrollIntoView({ block: 'center' });
      r.classList.add('is-flash');
      setTimeout(() => r.classList.remove('is-flash'), 2400);
    }, 80);
  });

  // Esc clears the selection; Ctrl A selects every row that matches; Shift with an arrow key extends the selection.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.wc-dlg, .wc-drawer, .pt-side.is-on, .ep-pop') && sel.selected.size) sel.clear();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/input|textarea/i.test(t.tagName)) {
      e.preventDefault();
      sel.allMatching();
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !/input|textarea|select/i.test(t.tagName)) {
      const row = t.closest<HTMLElement>('tr[data-pt-row]');
      if (!row) return;
      e.preventDefault();
      const n = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
      if (n && n.dataset.id) {
        n.focus();
        if (selectable(n.dataset.id)) sel.select.onToggle(n.dataset.id, true, false);
      }
    }
  };

  const selIds = [...sel.selected].filter((id) => w.byId[id] && selectable(id));
  const tyN = selIds.filter((id) => w.byId[id].ty).length;
  const label = (list.length === p.total ? (p.total === 1 ? 'open action' : 'open actions') : `matching of ${p.total.toLocaleString('en-US')} open`) + (p.boardTotal && p.boardTotal > w.acts.length ? ` · the newest ${w.acts.length.toLocaleString('en-US')} of ${p.boardTotal.toLocaleString('en-US')} in Blackbaud` : '');
  return (
    <>
      <div className={'wc-selbanner' + (sel.banner ? ' is-on' : '')} id={p.stale ? 's-banner' : 'o-banner'}>
        {sel.banner?.kind === 'page' ? (
          <>
            All {sel.banner.shown} on this page are selected.{' '}
            <button type="button" onClick={sel.allMatching}>
              Select all {sel.banner.total} that match
            </button>
          </>
        ) : sel.banner?.kind === 'all' ? (
          <>
            All {sel.banner.total} that match are selected, including {sel.banner.total - sel.banner.shown} on other pages.{' '}
            <button type="button" onClick={sel.clear}>
              Clear
            </button>
          </>
        ) : null}
      </div>
      <div ref={host} style={{ display: 'contents' }} onKeyDown={onKeyDown}>
        <DataTable
          listKey={p.listKey}
          label={p.stale ? 'Stale actions' : 'Open actions'}
          className="wc-grid wc-at"
          columns={p.columns}
          hidden={p.hidden}
          rows={rows}
          rowKey={(a) => a.id}
          sort={p.sort}
          onSort={p.onSort}
          select={sel.select}
          onOpen={(a) => openEditPanel(a.id)}
          onRowClick={(a, e) => sel.rowClick(a.id, e)}
          rowClassName={(a) => [(saving[a.id] || w.pendingOf(a)) === 'saving' ? 'is-saving' : '', back[a.id] || a.reopened ? 'is-back' : '', leaving[a.id] ? 'is-leaving' : ''].filter(Boolean).join(' ')}
          empty={p.empty ?? <div className="pt-empty"><b>Nothing matches</b>Change a filter or clear them all.</div>}
          fit={fit}
        />
      </div>
      <div className="wc-foot">
        <Pager
          listKey={p.listKey}
          total={list.length}
          page={page}
          size={size}
          noun={label}
          onPage={(pg, sz) => {
            if (sz !== size) setSize(sz);
            setSt({ sig: p.sig, page: pg });
            host.current?.querySelector('.pt-wrap')?.scrollTo?.({ top: 0 });
          }}
        />
        <span className="wc-keys">
          <span>
            <kbd>Shift</kbd>click a range
          </span>
          <span>
            <kbd>Space</kbd>select
          </span>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>A</kbd>all that match
          </span>
          <span>
            <kbd>Esc</kbd>clear
          </span>
        </span>
      </div>
      <ActionBar>
        {selIds.length ? (
          <>
            <span className="wc-bar__n">{selIds.length}</span>
            <span className="wc-bar__l">selected{tyN ? ` · ${tyN} thank-you` : ''}</span>
            <span className="wc-bar__acts">
              <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => openComplete(selIds)}>
                <Ic n="check" />
                Mark complete
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openReassign(selIds)}>
                <Ic n="user" />
                Reassign
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => openReschedule(selIds)}>
                <Ic n="cal" />
                Reschedule
              </button>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" title="Change any field on every selected action" onClick={() => openBulk(selIds)}>
                <Ic n="filter" />
                Edit
              </button>
              {w.me.canDelete ? (
                <button type="button" className="h-btn h-btn--ghost h-btn--sm wc-bar__del" title="Delete the selected actions" onClick={() => openDelete(selIds)}>
                  <Ic n="x" />
                  Delete
                </button>
              ) : null}
            </span>
            <button type="button" className="wc-bar__x" aria-label="Clear the selection" title="Clear (Esc)" onClick={clearSel}>
              <Ic n="x" />
            </button>
          </>
        ) : null}
      </ActionBar>
    </>
  );
}
