// Workload view of one project: people down the side, weeks across, the number of open tasks due in each week. Click a cell to see its
// tasks. Ported from public/js/projects/workload.js with the same markup and classes (projects-views.css).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTmp } from '../lib/store';
import type { Member, Person, Task } from '../types';
import { colorOf, fmtRange, fmtShort, has, heat, isOpen, isOverdue, span, startOfWeek, taskCount, todayDn } from './common';
import { useFitHeight, useHubOverlay, useIsoLayoutEffect, useLoadPrefs, usePhone, useViewTasks, writePrefs } from './hooks';
import { IChev, IChevL, IX, PjvAvatar } from './parts';
import type { ViewProps } from './types';

export interface WlRow {
  p: Person | null;
  key: string;
  cells: { over: Task[]; none: Task[]; weeks: Task[][] };
  total: number;
}

/** The open tasks of each person: overdue, in each week from `w0`, and without a date. People with no tasks stay in the list. */
export function computeLoad(tasks: Task[], members: Pick<Member, 'email' | 'name' | 'title' | 'picture'>[], w0: number, weeks: number, td: number): { cols: number[]; list: WlRow[] } {
  const cols: number[] = [];
  for (let i = 0; i < weeks; i++) cols.push(w0 + i * 7);
  const blank = () => ({ over: [] as Task[], none: [] as Task[], weeks: cols.map(() => [] as Task[]) });
  const people = new Map<string, WlRow>();
  const add = (p: Person | null | undefined) => {
    if (p && p.email && !people.has(p.email.toLowerCase())) people.set(p.email.toLowerCase(), { p, key: p.email.toLowerCase(), cells: blank(), total: 0 });
  };
  for (const m of members || []) add(m);
  const unassigned: WlRow = { p: null, key: '', cells: blank(), total: 0 };
  for (const t of tasks) {
    if (!isOpen(t)) continue;
    if (t.owner) add(t.owner);
    const row = t.owner && t.owner.email ? people.get(t.owner.email.toLowerCase()) : unassigned;
    if (!row) continue;
    const sp = span(t);
    row.total++;
    if (!has(sp.s)) {
      row.cells.none.push(t);
      continue;
    }
    const due = sp.d;
    if (due < td) {
      row.cells.over.push(t);
      continue;
    }
    if (due < w0) continue;
    const i = Math.floor((due - w0) / 7);
    if (i >= 0 && i < cols.length) row.cells.weeks[i].push(t);
  }
  const list = Array.from(people.values());
  if (unassigned.total) list.push(unassigned);
  list.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : b.total - a.total || (a.p!.name || a.p!.email).localeCompare(b.p!.name || b.p!.email)));
  return { cols, list };
}

const nameOf = (r: WlRow) => (r.p ? r.p.name || r.p.email : 'Unassigned');

export function WorkloadView({ ctx, members, openTask }: ViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const popAnchor = useRef<HTMLElement | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [offset, setOffset] = useState(0);
  const [pop, setPop] = useState<{ ri: number; k: string } | null>(null);
  useLoadPrefs('workload', (p) => {
    if (p.weeks === 4 || p.weeks === 8 || p.weeks === 12) setWeeks(p.weeks);
  });
  const phone = usePhone();
  useFitHeight(rootRef, 420);
  const vt = useViewTasks(ctx, false);

  const td = todayDn();
  const w0 = startOfWeek(td) + offset * 7;
  const model = useMemo(() => computeLoad(vt.tasks, members, w0, weeks, td), [vt.tasks, members, w0, weeks, td]);
  const { cols, list } = model;
  const openCount = useMemo(() => vt.tasks.filter(isOpen).length, [vt.tasks]);

  const closePop = useCallback(() => {
    setPop(null);
    popAnchor.current = null;
  }, []);
  useHubOverlay(!!pop && phone, closePop);
  useEffect(() => {
    if (!pop || phone) return;
    const away = (e: PointerEvent) => {
      const el = popRef.current;
      const tg = e.target as Element;
      if (el && !el.contains(tg) && !tg.closest('.wl-btn')) closePop();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [pop, phone, closePop]);
  const wasPhone = useRef(phone);
  useEffect(() => {
    if (wasPhone.current !== phone) {
      wasPhone.current = phone;
      closePop();
    }
  }, [phone, closePop]);

  const cellTasks = (ri: number, k: string): Task[] => {
    const r = list[ri];
    if (!r) return [];
    return k === 'over' ? r.cells.over : k === 'none' ? r.cells.none : r.cells.weeks[Number(k.slice(1))] || [];
  };
  const popTasks = useMemo(() => (pop ? cellTasks(pop.ri, pop.k).slice().sort((a, b) => (span(a).d || 0) - (span(b).d || 0)) : []), [pop, list]); // eslint-disable-line react-hooks/exhaustive-deps

  useIsoLayoutEffect(() => {
    const el = popRef.current;
    const root = rootRef.current;
    const btn = popAnchor.current;
    if (!pop || !el || !root) return;
    if (!phone && btn && btn.isConnected) {
      const mr = root.getBoundingClientRect();
      const ar = btn.getBoundingClientRect();
      const pw = 340;
      const left = Math.min(Math.max(ar.left - mr.left - 20, 8), Math.max(8, mr.width - pw - 8));
      let top = ar.bottom - mr.top + 6;
      const ph = el.offsetHeight;
      if (top + ph > mr.height - 8) top = Math.max(8, ar.top - mr.top - ph - 6);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    } else {
      el.style.left = '';
      el.style.top = '';
    }
  }, [pop, phone]);

  const step = Math.max(2, Math.floor(weeks / 2));
  const cell = (ri: number, key: string, tasks: Task[], label: string, over: boolean, now?: boolean) => {
    const n = tasks.length;
    const nm = nameOf(list[ri]);
    if (!n)
      return (
        <td key={key} className={'wl-c wl-c--0' + (now ? ' is-now' : '')}>
          <span aria-hidden="true">–</span>
        </td>
      );
    return (
      <td key={key} className={'wl-c' + (now ? ' is-now' : '')}>
        <button
          type="button"
          className={'wl-btn wl-h' + (over ? 4 : heat(n)) + (over ? ' is-over' : '')}
          aria-label={nm + ', ' + label + ': ' + taskCount(n)}
          onClick={(e) => {
            popAnchor.current = e.currentTarget;
            setPop({ ri, k: key });
          }}
        >
          {n}
        </button>
      </td>
    );
  };

  const popWhen = pop ? (pop.k === 'over' ? 'Overdue' : pop.k === 'none' ? 'No date' : fmtRange(cols[Number(pop.k.slice(1))], cols[Number(pop.k.slice(1))] + 6)) : '';
  const popWho = pop && list[pop.ri] ? nameOf(list[pop.ri]) : '';

  return (
    <div ref={rootRef} className={'pjv-root pjv-wl' + (vt.loading ? ' is-loading' : '')} data-pjv="workload" onKeyDown={(e) => e.key === 'Escape' && closePop()}>
      <div className="pjv-bar" role="toolbar" aria-label="Workload">
        <div className="cal-nav">
          <button
            type="button"
            className="pjv-btn pjv-btn--ico"
            aria-label="Earlier weeks"
            disabled={offset <= 0}
            onClick={() => {
              closePop();
              setOffset(Math.max(0, offset - step));
            }}
          >
            <IChevL />
          </button>
          <button
            type="button"
            className="pjv-btn pjv-btn--ico"
            aria-label="Later weeks"
            onClick={() => {
              closePop();
              setOffset(offset + step);
            }}
          >
            <IChev />
          </button>
        </div>
        <button
          type="button"
          className="pjv-btn"
          onClick={() => {
            closePop();
            setOffset(0);
          }}
        >
          This week
        </button>
        <h2 className="pjv-title">{fmtShort(cols[0]) + ' to ' + fmtShort(cols[cols.length - 1] + 6)}</h2>
        <div className="pjv-seg" role="group" aria-label="Weeks shown">
          {[4, 8, 12].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === weeks}
              onClick={() => {
                setWeeks(n);
                writePrefs('workload', { weeks: n });
                closePop();
              }}
            >
              {n} weeks
            </button>
          ))}
        </div>
        <span className="pjv-count">{openCount + (openCount === 1 ? ' open task' : ' open tasks') + ' · ' + list.filter((r) => r.key !== '').length + ' people'}</span>
      </div>
      <div className="wl-scroll pjv-body">
        <table className="wl-table">
          <thead>
            <tr>
              <th className="wl-name wl-corner" scope="col">
                Person
              </th>
              <th scope="col" className="wl-col wl-col--over">
                Overdue
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className={'wl-col' + (td >= c && td <= c + 6 ? ' is-now' : '')}>
                  <span>{fmtShort(c)}</span>
                </th>
              ))}
              <th scope="col" className="wl-col wl-col--none">
                No date
              </th>
              <th scope="col" className="wl-col wl-col--total">
                Open
              </th>
            </tr>
          </thead>
          <tbody>
            {!list.length ? (
              <tr>
                <td className="wl-empty" colSpan={cols.length + 4}>
                  No people
                </td>
              </tr>
            ) : null}
            {list.map((r, ri) => (
              <tr key={r.key || 'none'}>
                <th className="wl-name" scope="row">
                  <span className="wl-who">
                    <PjvAvatar p={r.p} size="sm" />
                    <span className="wl-who__t">
                      <b>{nameOf(r)}</b>
                      {r.p && r.p.title ? <small>{r.p.title}</small> : null}
                    </span>
                  </span>
                </th>
                {cell(ri, 'over', r.cells.over, 'Overdue', true)}
                {r.cells.weeks.map((c, i) => cell(ri, 'w' + i, c, fmtRange(cols[i], cols[i] + 6), false, td >= cols[i] && td <= cols[i] + 6))}
                {cell(ri, 'none', r.cells.none, 'No date', false)}
                <td className="wl-total">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pop ? (
        <>
          <div ref={popRef} className={'cal-pop wl-pop' + (phone ? ' is-sheet' : '')} role="dialog" aria-label={popWho + ', ' + popWhen}>
            <div className="cal-pop__h">
              <span className="wl-pop__t">
                <b>{popWho}</b>
                <small>{popWhen + ' · ' + taskCount(popTasks.length)}</small>
              </span>
              <button type="button" className="cal-pop__x" aria-label="Close" onClick={closePop}>
                <IX />
              </button>
            </div>
            <ul className="cal-pop__list wl-list">
              {popTasks.map((t) => {
                const sp = span(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      data-pc={colorOf(t.project ? t.project.color : 'slate')}
                      onClick={() => {
                        closePop();
                        if (!t.pending && !isTmp(t.id)) openTask(t.code || t.id);
                      }}
                    >
                      <i />
                      <span>{t.title}</span>
                      <em className={isOverdue(t) ? 'is-late' : ''}>{has(sp.s) ? fmtShort(sp.d) : 'No date'}</em>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {phone ? <div className="cal-scrim" onClick={closePop} /> : null}
        </>
      ) : null}
    </div>
  );
}

