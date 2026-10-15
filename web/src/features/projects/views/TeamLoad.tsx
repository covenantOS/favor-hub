// The Team workload tab of the Projects home: every person down the side, the next weeks across, tasks due in each week. A cell turns
// amber when a week is heavy for that person and red when it is overloaded, measured against that person's own usual week. Warnings
// list first. Ported from public/js/projects/team-load.js with the same markup and classes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { shortDate } from '../lib/dates';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { toast } from '../kit/toast';
import type { QuickAddDefaults } from '../lib/page';
import { taskCount } from './common';
import { useIsoLayoutEffect, usePhone } from './hooks';

type Level = 'ok' | 'heavy' | 'over';
interface LoadTask {
  code: string | null;
  title: string;
  project_key: string | null;
  due: string | null;
  priority: string;
}
interface LoadWeek {
  start: string;
  count: number;
  weight: number;
  level: Level;
  tasks: LoadTask[];
}
export interface LoadPerson {
  email: string;
  name: string;
  title?: string;
  team?: string;
  picture?: string;
  usual: number;
  history: number;
  overdue: number;
  undated: number;
  open: number;
  behind: boolean;
  level: Level;
  weeks: LoadWeek[];
}
export interface LoadWarning {
  email: string;
  name: string;
  week: string;
  count: number;
  usual: number;
  level: Level | 'behind';
  text: string;
}
export interface LoadData {
  today: string;
  weeks: string[];
  people: LoadPerson[];
  warnings: LoadWarning[];
}

const lvlWord: Record<string, string> = { over: 'Overloaded', heavy: 'Heavy', behind: 'Behind', ok: '' };
const WEEKS = [4, 8, 12];

export function TeamLoad({ openTask }: { openTask: (ref: string) => void; quickAdd?: (d?: QuickAddDefaults) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const popAnchor = useRef<HTMLElement | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [team, setTeam] = useState('');
  const [pop, setPop] = useState<{ p: number; w: number } | null>(null);
  const phone = usePhone(860);

  // everyone, once, for the team chips
  const all = useQuery({ queryKey: ['projects', 'workload', 'all'], queryFn: () => api.workload({ weeks: 2 }) as Promise<LoadData>, staleTime: 5 * 60_000, retry: false });
  const q = useQuery({
    queryKey: ['projects', 'workload', weeks, team],
    queryFn: () => api.workload({ weeks, team }) as Promise<LoadData>,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const d = q.data || null;
  const error = q.error ? (q.error as Error).message || 'The workload did not load.' : '';
  const teams = useMemo(() => [...new Set((all.data?.people || []).map((p) => p.team).filter(Boolean) as string[])].sort(), [all.data]);

  useEffect(() => {
    if (error) toast(error);
  }, [error]);

  const closePop = useCallback(() => {
    setPop(null);
    popAnchor.current = null;
  }, []);
  useEffect(() => {
    if (!pop) return;
    const away = (e: PointerEvent) => {
      const el = popRef.current;
      const tg = e.target as Element;
      if (el && !el.contains(tg) && !tg.closest('.wl-btn')) closePop();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [pop, closePop]);
  // a new reading of the load closes an open cell
  useEffect(() => closePop(), [weeks, team, closePop]);

  useIsoLayoutEffect(() => {
    const el = popRef.current;
    const root = rootRef.current;
    const btn = popAnchor.current;
    if (!pop || !el || !root) return;
    if (phone || !btn || !btn.isConnected) {
      el.style.left = '';
      el.style.top = '';
      return;
    }
    const mr = root.getBoundingClientRect();
    const ar = btn.getBoundingClientRect();
    const left = Math.min(Math.max(ar.left - mr.left - 20, 8), Math.max(8, mr.width - 340 - 8));
    let top = ar.bottom - mr.top + 6;
    if (top + el.offsetHeight > mr.height - 8) top = Math.max(8, ar.top - mr.top - el.offsetHeight - 6);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }, [pop, phone]);

  const warnings = d ? d.warnings : [];
  const person = pop && d ? d.people[pop.p] : null;
  const week = person && pop ? person.weeks[pop.w] : null;

  return (
    <div ref={rootRef} className="pjv-root pj-tl" onKeyDown={(e) => e.key === 'Escape' && closePop()}>
      <div className="pj-tl__warns">
        {!d ? null : !warnings.length ? (
          <p className="pj-tl__ok">No one is over a usual week in the weeks shown.</p>
        ) : (
          <>
            <ul className="pj-tl__list">
              {warnings.slice(0, 8).map((x, i) => (
                <li key={i} className={'is-' + x.level}>
                  <b>{lvlWord[x.level]}</b>
                  <span>{x.text}</span>
                </li>
              ))}
            </ul>
            {warnings.length > 8 ? <p className="pj-tl__more">and {warnings.length - 8} more</p> : null}
          </>
        )}
      </div>
      <div className="pjv-bar" role="toolbar" aria-label="Team workload">
        <div className="pjv-seg" role="group" aria-label="Weeks shown">
          {WEEKS.map((n) => (
            <button key={n} type="button" aria-pressed={n === weeks} onClick={() => setWeeks(n)}>
              {n} weeks
            </button>
          ))}
        </div>
        <div className="pj-chips" role="group" aria-label="Team">
          {d
            ? ['', ...teams].map((t) => (
                <button key={t} type="button" className={'pj-fchipbtn' + (team === t ? ' is-on' : '')} aria-pressed={team === t} onClick={() => setTeam(t)}>
                  {t || 'Everyone'}
                </button>
              ))
            : null}
        </div>
        <span className="pjv-count">{d ? d.people.length + ' ' + (d.people.length === 1 ? 'person' : 'people') : ''}</span>
      </div>
      <div className="wl-scroll pjv-body">
        <table className="wl-table pj-tl__table">
          {error && !d ? (
            <tbody>
              <tr>
                <td className="wl-empty" colSpan={3}>
                  {error}{' '}
                  <button type="button" className="pj-btn" onClick={() => void q.refetch()}>
                    Try again
                  </button>
                </td>
              </tr>
            </tbody>
          ) : !d ? (
            <tbody>
              <tr>
                <td className="wl-empty">Loading</td>
              </tr>
            </tbody>
          ) : (
            <>
              <thead>
                <tr>
                  <th className="wl-name wl-corner" scope="col">
                    Person
                  </th>
                  <th scope="col" className="wl-col wl-col--over">
                    Past due
                  </th>
                  {d.weeks.map((w, i) => (
                    <th key={w} scope="col" className={'wl-col' + (i === 0 ? ' is-now' : '')}>
                      <span>{shortDate(w)}</span>
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
                {!d.people.length ? (
                  <tr>
                    <td className="wl-empty" colSpan={d.weeks.length + 4}>
                      No open tasks with an owner
                    </td>
                  </tr>
                ) : null}
                {d.people.map((p, pi) => (
                  <tr key={p.email}>
                    <th className="wl-name" scope="row">
                      <span className="wl-who">
                        <Avatar p={p} size="sm" />
                        <span className="wl-who__t">
                          <b>{p.name}</b>
                          <small>
                            {p.level !== 'ok' ? (
                              <>
                                <i className={'pj-lvl pj-lvl--' + p.level}>{p.behind && p.level === 'heavy' ? 'Behind' : lvlWord[p.level] || ''}</i>{' '}
                              </>
                            ) : null}
                            {'usual ' + p.usual + '/wk'}
                          </small>
                        </span>
                      </span>
                    </th>
                    <td className="wl-c">
                      {p.overdue ? (
                        <span className={'pj-tl__cell' + (p.behind ? ' lv-over' : ' lv-heavy')} aria-label={p.name + ', past due: ' + p.overdue}>
                          {p.overdue}
                        </span>
                      ) : (
                        <span className="wl-c--0" aria-hidden="true">
                          –
                        </span>
                      )}
                    </td>
                    {p.weeks.map((c, wi) => (
                      <td key={c.start} className={'wl-c' + (wi === 0 ? ' is-now' : '')}>
                        {c.count ? (
                          <button
                            type="button"
                            className={'wl-btn pj-tl__cell lv-' + c.level}
                            aria-label={p.name + ', week of ' + shortDate(c.start) + ': ' + taskCount(c.count) + (c.level !== 'ok' ? ', ' + lvlWord[c.level].toLowerCase() : '')}
                            onClick={(e) => {
                              popAnchor.current = e.currentTarget;
                              setPop({ p: pi, w: wi });
                            }}
                          >
                            {c.count}
                          </button>
                        ) : (
                          <span className="wl-c--0" aria-hidden="true">
                            –
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="wl-c">
                      {p.undated ? (
                        <span className="pj-tl__cell lv-none">{p.undated}</span>
                      ) : (
                        <span className="wl-c--0" aria-hidden="true">
                          –
                        </span>
                      )}
                    </td>
                    <td className="wl-total">{p.open}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>
      {person && week ? (
        <div ref={popRef} className={'cal-pop wl-pop' + (phone ? ' is-sheet' : '')} role="dialog" aria-label={person.name + ', week of ' + shortDate(week.start)}>
          <div className="cal-pop__h">
            <span className="wl-pop__t">
              <b>{person.name}</b>
              <small>{'Week of ' + shortDate(week.start) + ', ' + taskCount(week.count) + ', usual ' + person.usual}</small>
            </span>
            <button type="button" className="cal-pop__x" aria-label="Close" onClick={closePop}>
              <Icon name="x" />
            </button>
          </div>
          <ul className="cal-pop__list wl-list">
            {week.tasks.map((t, i) => (
              <li key={(t.code || '') + i}>
                <button
                  type="button"
                  disabled={!t.code}
                  onClick={() => {
                    if (!t.code) return;
                    closePop();
                    openTask(t.code);
                  }}
                >
                  <i />
                  <span>{t.title}</span>
                  <em>{(t.project_key ? t.project_key + ' · ' : '') + shortDate(t.due)}</em>
                </button>
              </li>
            ))}
            {week.count > week.tasks.length ? <li className="pj-tl__more">and {week.count - week.tasks.length} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
