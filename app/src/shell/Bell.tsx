import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, send } from '@/lib/api';
import { hubOv } from '@/lib/hubOv';
import { useIdleReady } from '@/lib/idle';
import { count as fmtCount } from '@/lib/format';
import { hubNotifications, chatInboxResponse, projectNoticesResponse, remindersResponse, requestNoticesResponse, type Access } from '@shared/schemas';
import { Icon } from './Icon';
import { NavLink } from './NavLink';
import { QuietHours } from './QuietHours';
import { badge, fromChat, fromHub, fromProjects, fromReminders, fromRequests, grouped, type NoticeRow } from './notices';

type A = Partial<Access> & Record<string, unknown>;

const POLL = 90_000;
const opts = { staleTime: 30_000, refetchInterval: POLL, retry: false } as const;

/** Every source the bell reads, behind one list and one number. A source the person has no access to is never asked. */
export function useNotices(access: A) {
  const idle = useIdleReady();
  const on = !!access.bell && idle;
  const hub = useQuery({ queryKey: ['notices', 'hub'], queryFn: () => api('/api/hub/notifications', hubNotifications), enabled: on, ...opts });
  const rem = useQuery({ queryKey: ['notices', 'reminders'], queryFn: () => api('/api/work/reminders', remindersResponse), enabled: on && !!access.workCenter, ...opts });
  const req = useQuery({ queryKey: ['notices', 'requests'], queryFn: () => api('/api/requests/notices', requestNoticesResponse), enabled: on && !!access.tasks, ...opts });
  const prj = useQuery({ queryKey: ['notices', 'projects'], queryFn: () => api('/api/tasks/links/bell', projectNoticesResponse), enabled: on && !!access.projects, ...opts });
  const chat = useQuery({ queryKey: ['notices', 'chat'], queryFn: () => api('/api/chat/inbox', chatInboxResponse), enabled: on && !!access.chat, ...opts });
  const rows = useMemo<NoticeRow[]>(
    () => [
      ...fromHub(hub.data?.items || []),
      ...fromProjects(prj.data?.items || []),
      ...fromRequests(req.data?.items || []),
      ...fromChat(chat.data?.items || []),
      ...fromReminders(rem.data?.rows || []),
    ],
    [hub.data, prj.data, req.data, chat.data, rem.data]
  );
  const total = (hub.data?.count || 0) + (rem.data?.count || 0) + (req.data?.count || 0) + (prj.data?.count || 0) + (chat.data?.count || 0);
  return { rows, total, dueToday: rem.data?.count || 0 };
}

const LATER: Array<[string, string]> = [
  ['hour', 'In 1 hour'],
  ['afternoon', 'This afternoon'],
  ['tomorrow', 'Tomorrow morning'],
  ['nextweek', 'Next week'],
];

/** The bell, with one list of everything waiting on this person. Replaces the reminders bell (public/js/wc-bell.js) inside the app. */
export function Bell({ access }: { access: A }) {
  const qc = useQueryClient();
  const { rows, total, dueToday } = useNotices(access);
  const [open, setOpen] = useState(false);
  const [later, setLater] = useState('');
  const [err, setErr] = useState('');
  const [quiet, setQuiet] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 12, top: 56 });

  const refresh = () => qc.invalidateQueries({ queryKey: ['notices'] });
  const close = () => {
    setOpen(false);
    setLater('');
  };

  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    const w = Math.min(360, innerWidth - 24);
    if (r) setPos({ left: Math.max(12, Math.min(innerWidth - w - 12, r.right - w)), top: Math.min(r.bottom + 10, innerHeight - 120) });
    const tok = hubOv.on(close);
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    void refresh();
    return () => {
      hubOv.off(tok);
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const readOne = (r: NoticeRow) => {
    if (!r.read) return;
    const { kind, id } = r.read;
    const call = kind === 'request' ? send('/api/requests/notices', { id: Number(id) }) : kind === 'project' ? send('/api/tasks/notices/read', { ids: [id] }) : send('/api/chat/inbox/read', { message_id: Number(id) });
    void call.then(refresh).catch(() => undefined);
  };
  const readable = rows.filter((r) => r.read);
  const readAll = () =>
    void act(async () => {
      const jobs: Promise<unknown>[] = [];
      if (readable.some((r) => r.read?.kind === 'request')) jobs.push(send('/api/requests/notices', {}));
      const pj = readable.filter((r) => r.read?.kind === 'project').map((r) => r.read!.id);
      if (pj.length) jobs.push(send('/api/tasks/notices/read', { ids: pj }));
      readable.filter((r) => r.read?.kind === 'chat').forEach((r) => jobs.push(send('/api/chat/inbox/read', { message_id: Number(r.read!.id) })));
      await Promise.allSettled(jobs);
      (window as unknown as { hubNavRefresh?: (f: boolean) => void }).hubNavRefresh?.(true);
    });

  const groups = grouped(rows);
  const text = badge(total);
  return (
    <>
      <button
        type="button"
        className="h-top__cam wm-bell"
        id="wm-bell"
        ref={btn}
        hidden={!access.bell}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={total ? 'Notifications, ' + fmtCount(total) + ' waiting' : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="bell" />
        <em>{text}</em>
      </button>
      {open &&
        createPortal(
          <div className="wm-pop" ref={pop} role="dialog" aria-label="Notifications" style={{ left: pos.left, top: pos.top }}>
            <h4>
              <span>
                Notifications
                {dueToday ? <small>{fmtCount(dueToday)} due today</small> : null}
              </span>
              <button type="button" className="wm-x" aria-label="Close" onClick={close}>
                <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12" /><path d="M18 6 6 18" /></svg>
              </button>
            </h4>
            <div>
              {groups.length === 0 && (
                <div className="wm-empty">
                  <b>Nothing new</b>
                </div>
              )}
              {groups.map(([source, list]) => (
                <div className="wm-chat" key={source}>
                  <div className="wm-chat__h">{source}</div>
                  {list.map((r) =>
                    r.reminder ? (
                      <div className="wm-rem" key={r.key}>
                        <time className={r.warn ? 'is-now' : ''}>{r.when}</time>
                        <div>
                          <b>{r.head}</b>
                          {r.txt && <span>{r.txt}</span>}
                          <div className="wm-remacts">
                            <NavLink className="h-btn h-btn--primary h-btn--sm" href={r.href} onClick={close}>
                              Open
                            </NavLink>
                            <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void act(() => send('/api/work/reminders/' + encodeURIComponent(r.reminder!.id), { action: 'done' }, 'PATCH'))}>
                              Done
                            </button>
                            <button type="button" className="h-btn h-btn--ghost h-btn--sm" aria-haspopup="menu" aria-expanded={later === r.key} onClick={() => setLater(later === r.key ? '' : r.key)}>
                              Later
                            </button>
                          </div>
                          {later === r.key && (
                            <div className="wm-menu wm-menu--float" role="menu">
                              {LATER.map(([code, label]) => (
                                <button
                                  key={code}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setLater('');
                                    void act(() => send('/api/work/reminders/' + encodeURIComponent(r.reminder!.id), { action: 'later', when: { code } }, 'PATCH'));
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <NavLink
                        className="wm-rem wm-rem--chat"
                        key={r.key}
                        href={r.href}
                        onClick={() => {
                          readOne(r);
                          close();
                        }}
                      >
                        <time className={r.warn ? 'is-now' : ''} title={r.when}>
                          {r.when}
                        </time>
                        <div>
                          <b>{r.head}</b>
                          {r.txt && <span>{r.txt}</span>}
                        </div>
                      </NavLink>
                    )
                  )}
                </div>
              ))}
            </div>
            {err && <p className="wm-note" role="alert">{err}</p>}
            {quiet && <QuietHours />}
            <div className="wm-foot">
              {readable.length ? (
                <button type="button" onClick={readAll}>
                  Mark all read
                </button>
              ) : (
                <span />
              )}
              <a className="cl-link" href="/changelog/" onClick={() => setOpen(false)}>
                What&apos;s new
              </a>
              <button type="button" aria-expanded={quiet} onClick={() => setQuiet((v) => !v)}>
                Quiet hours
              </button>
              {(window as unknown as { FavorIx?: { meetSettings?: () => void } }).FavorIx?.meetSettings && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    (window as unknown as { FavorIx: { meetSettings: () => void } }).FavorIx.meetSettings();
                  }}
                >
                  Meeting prep
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
