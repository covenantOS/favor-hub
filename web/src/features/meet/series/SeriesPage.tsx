// Meetings > Series (/meet/series/?id=<series id>): one repeating series. The rule, the people, the upcoming meetings (move or cancel with a
// scope) and the past ones. Port of src/pages/meet/series.astro and public/js/meet/series.js: the same markup, stylesheets and calls.
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';
import '@hub/styles/break-ui.css';
import '@hub/styles/meet-series.css';
import { NavLink } from '@/shell/NavLink';
import { BodyPortal } from '@/shell/BodyPortal';
import { Boundary } from '../../partners/record/Boundary';
import { ConfirmHost, MeetToast, Wait, confirmCard, meetApi, toast, useHydrated } from '../ui';
import { seriesQuery } from '../queries';

const TZ = 'America/New_York';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCOPES: [string, string][] = [
  ['this', 'This meeting'],
  ['following', 'This and following meetings'],
  ['all', 'All meetings'],
];
const RULE_FREQ = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];

export interface SeriesMeeting {
  id: string;
  title?: string;
  startsAt: string;
  status?: string;
  agenda?: string;
  detached?: boolean;
  notesStatus?: string;
  actions?: { n: number; open: number };
  canRead?: boolean;
  summary?: string;
}
interface Rule {
  freq: string;
  interval?: number;
  byDay?: number[];
  monthBy?: string;
  end?: { kind: string; count?: number; until?: string };
}
export interface SeriesData {
  series: { title: string; describe: string; mine: boolean; hostName: string; durationMin: number; tz?: string; invitees?: { name?: string; email?: string }[]; rule?: Rule; agenda?: string };
  upcoming: SeriesMeeting[];
  past: SeriesMeeting[];
  cancelled?: { startsAt: string }[];
}

const etFmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...o });
const dayET = (iso: string) => etFmt(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeET = (iso: string) => etFmt(iso, { hour: 'numeric', minute: '2-digit' });
const zoneName = (z: string) => new Date().toLocaleString('en-US', { timeZone: z, timeZoneName: 'short' }).split(' ').pop();
// The "for you" line shows only when the browser's zone differs from Eastern, so it is drawn after the page is live.
const localLine = (iso: string) => {
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zoneName(local) === zoneName(TZ)) return '';
    return `${new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} for you`;
  } catch {
    return '';
  }
};
const etParts = (iso: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
// Eastern wall time to an instant, correct across daylight saving changes.
const etToIso = (date: string, time: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let g = wall;
  for (let i = 0; i < 3; i++) {
    const q = etParts(new Date(g).toISOString());
    const [qy, qm, qd] = q.date.split('-').map(Number);
    const [qh, qmi] = q.time.split(':').map(Number);
    g += wall - Date.UTC(qy, qm - 1, qd, qh, qmi);
  }
  return new Date(g).toISOString();
};
const people = (list?: { name?: string; email?: string }[]) => {
  const n = (list || []).map((p) => p.name || p.email);
  return n.length ? n.join(', ') : 'Just the host';
};
const clipText = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '...' : t);

/* ---------------------------------------------------------------- sheet */
// A sheet over the page. read(el) returns the values or throws a message to show. onDone gets null when dismissed.
interface SheetSpec {
  title: string;
  lead?: string;
  ok: string;
  danger?: boolean;
  body: ReactNode;
  read: (el: HTMLElement) => Record<string, any>;
  onDone: (v: Record<string, any> | null) => void;
}
function Sheet({ s }: { s: SheetSpec }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = wrap.current;
    (el?.querySelector<HTMLElement>('input,select,textarea,[data-ok]') ?? null)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        s.onDone(null);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      try {
        prev?.focus();
      } catch {
        // gone
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="sr-scrim"
      ref={wrap}
      onClick={(e) => {
        if (e.target === wrap.current) s.onDone(null);
      }}
    >
      <div className="sr-sheet" role="dialog" aria-modal="true" aria-label={s.title}>
        <h3>{s.title}</h3>
        {s.lead ? <p>{s.lead}</p> : null}
        <div>{s.body}</div>
        <p className="sr-err" role="alert" hidden={!err}>
          {err}
        </p>
        <div className="sr-foot">
          <button type="button" className="h-btn h-btn--ghost" data-no onClick={() => s.onDone(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={'h-btn ' + (s.danger ? 'h-btn--danger' : 'h-btn--primary')}
            data-ok
            onClick={() => {
              try {
                const v = s.read(wrap.current as HTMLElement);
                s.onDone(v);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            {s.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
const ScopeOpts = ({ def, only }: { def: string; only?: string[] }) => (
  <>
    {SCOPES.filter((s) => !only || only.includes(s[0])).map((s) => (
      <label className="sr-opt" key={s[0]}>
        <input type="radio" name="scope" value={s[0]} defaultChecked={s[0] === def} />
        {s[1]}
      </label>
    ))}
  </>
);
const scopeOf = (el: HTMLElement) => (el.querySelector('input[name=scope]:checked') as HTMLInputElement).value;
const q = <T extends HTMLElement>(el: HTMLElement, sel: string) => el.querySelector(sel) as T;

function useSheet() {
  const [spec, setSpec] = useState<SheetSpec | null>(null);
  const open = (s: Omit<SheetSpec, 'onDone'>) =>
    new Promise<Record<string, any> | null>((resolve) => {
      setSpec({
        ...s,
        onDone: (v) => {
          setSpec(null);
          resolve(v);
        },
      });
    });
  return { open, node: spec ? BodyPortal(<Sheet s={spec} />) : null };
}

/* ---------------------------------------------------------------- page */
function SeriesBody({ sid }: { sid: string }) {
  const { data } = useSuspenseQuery(seriesQuery(sid));
  const qc = useQueryClient();
  const nav = useNavigate();
  const hydrated = useHydrated();
  const sheet = useSheet();
  const { series: s, upcoming, past, cancelled } = data as SeriesData;
  const live = upcoming.filter((m) => m.status !== 'cancelled');
  const rows = [...live.map((m) => ({ ...m, kind: 'up' as const })), ...(cancelled || []).map((c) => ({ ...c, id: '', kind: 'x' as const }))].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)
  );
  const host = s.mine;

  const load = () => qc.invalidateQueries({ queryKey: ['meet', 'series', sid] });
  async function send(id: string, body: Record<string, unknown>, done: string) {
    try {
      const r = await meetApi<{ seriesId?: string }>('meetings/' + id + '/update', { method: 'POST', body });
      toast(done);
      if (r.seriesId && r.seriesId !== sid) {
        void nav({ to: '/meet/series/', search: { id: r.seriesId }, replace: true });
        return;
      }
      void load();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function moveOne(m: SeriesMeeting) {
    const p = etParts(m.startsAt);
    const v = await sheet.open({
      title: 'Move a meeting',
      lead: `${m.title}, ${dayET(m.startsAt)} at ${timeET(m.startsAt)} ET.`,
      ok: 'Move',
      body: (
        <>
          <ScopeOpts def="this" />
          <div className="sr-2">
            <label className="sr-f">
              Date
              <input type="date" data-d defaultValue={p.date} />
            </label>
            <label className="sr-f">
              Start (ET)
              <input type="time" step={300} data-t defaultValue={p.time} />
            </label>
          </div>
          <NavLink className="sr-mk" href={`/meet/book/?edit=${m.id}`}>
            More options
          </NavLink>
        </>
      ),
      read: (el) => {
        const d = q<HTMLInputElement>(el, '[data-d]').value;
        const t = q<HTMLInputElement>(el, '[data-t]').value;
        if (!d || !t) throw new Error('Pick a date and a time.');
        return { scope: scopeOf(el), startsAt: etToIso(d, t) };
      },
    });
    if (v) void send(m.id, { scope: v.scope, startsAt: v.startsAt }, 'Moved');
  }

  async function cancelOne(m: SeriesMeeting) {
    const v = await sheet.open({
      title: 'Cancel a meeting',
      lead: `${m.title}, ${dayET(m.startsAt)} at ${timeET(m.startsAt)} ET.`,
      ok: 'Continue',
      body: <ScopeOpts def="this" />,
      read: (el) => ({ scope: scopeOf(el) }),
    });
    if (!v) return;
    const word = v.scope === 'this' ? 'this meeting' : v.scope === 'all' ? 'every meeting in the series' : 'this meeting and the ones after it';
    const yes = await confirmCard({ title: 'Cancel ' + word + '?', body: 'Invitees get a cancellation.', ok: 'Cancel', cancel: 'Keep', danger: true });
    if (yes === true) void send(m.id, { scope: v.scope, status: 'cancelled' }, 'Cancelled');
  }

  async function editSeries(next: SeriesMeeting) {
    const r: Rule = s.rule || { freq: 'weekly', interval: 1, end: { kind: 'never' } };
    const end = r.end || { kind: 'never' };
    const v = await sheet.open({
      title: 'Edit the series',
      lead: 'The change applies from the next meeting on.',
      ok: 'Save',
      body: (
        <>
          <ScopeOpts def="all" only={['following', 'all']} />
          <label className="sr-f">
            Title
            <input data-title maxLength={140} defaultValue={s.title} />
          </label>
          <label className="sr-f">
            Agenda
            <textarea data-agenda maxLength={2000} defaultValue={s.agenda || ''} />
          </label>
          <label className="sr-f">
            Length in minutes
            <input data-len type="number" min={10} max={480} step={5} defaultValue={s.durationMin} />
          </label>
          <div className="sr-2">
            <label className="sr-f">
              Repeats
              <select data-freq defaultValue={r.freq}>
                {RULE_FREQ.map((f) => (
                  <option key={f} value={f}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sr-f">
              Every
              <input data-int type="number" min={1} max={52} defaultValue={r.interval || 1} />
            </label>
          </div>
          <div className="sr-days" data-days>
            {DAYS.map((d, i) => (
              <label key={d}>
                <input type="checkbox" value={i} defaultChecked={(r.byDay || []).includes(i)} />
                {d}
              </label>
            ))}
          </div>
          <div className="sr-2">
            <label className="sr-f">
              Ends
              <select data-end defaultValue={end.kind}>
                <option value="never">Never</option>
                <option value="count">After a number of meetings</option>
                <option value="until">On a date</option>
              </select>
            </label>
            <label className="sr-f">
              Number or date
              <input data-endv type="text" defaultValue={String(end.kind === 'until' ? end.until || '' : end.count || '')} placeholder="10 or 2026-12-31" />
            </label>
          </div>
        </>
      ),
      read: (el) => {
        const freq = q<HTMLSelectElement>(el, '[data-freq]').value;
        const kind = q<HTMLSelectElement>(el, '[data-end]').value;
        const ev = q<HTMLInputElement>(el, '[data-endv]').value.trim();
        const title = q<HTMLInputElement>(el, '[data-title]').value.trim();
        if (!title) throw new Error('Give the series a title.');
        const rule: Rule = { freq, interval: Math.max(1, Math.min(52, +q<HTMLInputElement>(el, '[data-int]').value || 1)), end: { kind: 'never' } };
        if (freq === 'weekly') {
          rule.byDay = Array.from(el.querySelectorAll<HTMLInputElement>('[data-days] input:checked')).map((x) => +x.value);
          if (!rule.byDay.length) throw new Error('Pick at least one day.');
        }
        if (freq === 'monthly') rule.monthBy = r.monthBy || 'date';
        if (kind === 'count') {
          if (!(+ev > 0)) throw new Error('Enter how many meetings.');
          rule.end = { kind: 'count', count: Math.round(+ev) };
        }
        if (kind === 'until') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ev)) throw new Error('Enter the last date as YYYY-MM-DD.');
          rule.end = { kind: 'until', until: ev };
        }
        return { scope: scopeOf(el), title, agenda: q<HTMLTextAreaElement>(el, '[data-agenda]').value.trim(), durationMin: Math.max(10, +q<HTMLInputElement>(el, '[data-len]').value || s.durationMin), recur: rule };
      },
    });
    if (v) void send(next.id, v, 'Series saved');
  }

  const byId = new Map(live.map((m) => [m.id, m]));
  return (
    <>
      <section className="h-card sr-head">
        <h2>{s.title}</h2>
        <p className="sr-rule">{s.describe}</p>
        <dl className="sr-kv">
          <div>
            <dt>Host</dt>
            <dd>{s.hostName}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{s.durationMin} minutes</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{s.tz || TZ}</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>{people(s.invitees)}</dd>
          </div>
        </dl>
        {host && live.length ? (
          <div className="sr-edit">
            <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-edit onClick={() => void editSeries(live[0])}>
              Edit the series
            </button>
          </div>
        ) : null}
      </section>
      <section className="h-card sr-sec">
        <div className="h-label">Upcoming meetings</div>
        {rows.length ? (
          rows.map((m, i) => {
            if (m.kind === 'x')
              return (
                <div className="sr-row is-cancelled" key={'x' + i}>
                  <div>
                    <b>{dayET(m.startsAt)}</b>
                    <span>Cancelled</span>
                  </div>
                </div>
              );
            const up = m as SeriesMeeting;
            const loc = hydrated ? localLine(up.startsAt) : '';
            return (
              <div className="sr-row" key={up.id}>
                <div>
                  <b>
                    {dayET(up.startsAt)} at {timeET(up.startsAt)} ET{up.detached ? <i className="sr-tag">Moved</i> : null}
                  </b>
                  {loc ? <span>{loc}</span> : null}
                  {up.agenda ? <p>{clipText(up.agenda, 140)}</p> : null}
                </div>
                <div className="sr-acts">
                  <a className="h-btn h-btn--ghost h-btn--sm" href={`/meet/room/?m=${up.id}`}>
                    Open
                  </a>
                  {host ? (
                    <>
                      <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-move={up.id} onClick={() => void moveOne(byId.get(up.id) as SeriesMeeting)}>
                        Move
                      </button>
                      <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-cancel={up.id} onClick={() => void cancelOne(byId.get(up.id) as SeriesMeeting)}>
                        Cancel
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="sr-none">No upcoming meetings. This series has ended or every date is cancelled.</p>
        )}
      </section>
      <section className="h-card sr-sec">
        <div className="h-label">Past meetings</div>
        {past.length ? (
          past.map((m) => (
            <div className="sr-row" key={m.id}>
              <div>
                <b>{dayET(m.startsAt)}</b>
                <span>
                  {m.notesStatus && m.notesStatus !== 'none' ? 'Notes ' + m.notesStatus : 'No notes'}
                  {m.actions && m.actions.n ? `, ${m.actions.n} action ${m.actions.n === 1 ? 'item' : 'items'} (${m.actions.open} open)` : ''}
                </span>
                {m.canRead && m.summary ? <p>{clipText(m.summary, 180)}</p> : null}
              </div>
              <div className="sr-acts">
                {m.canRead ? (
                  <NavLink className="h-btn h-btn--ghost h-btn--sm" href={`/meet/notes/?m=${m.id}`}>
                    Notes
                  </NavLink>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <p className="sr-none">No past meetings yet.</p>
        )}
      </section>
      {sheet.node}
    </>
  );
}

export function SeriesPage({ id }: { id: string }) {
  return (
    <div id="sr-root">
      {id ? (
        <Boundary
          key={id}
          fallback={(e) => (
            <div className="h-card mt-card">
              <p>{e.message}</p>
            </div>
          )}
        >
          <Suspense fallback={<Wait />}>
            <SeriesBody sid={id} />
          </Suspense>
        </Boundary>
      ) : (
        <div className="h-card mt-card">
          <p>No series chosen. Open one from the meeting list.</p>
        </div>
      )}
      <MeetToast />
      <ConfirmHost />
    </div>
  );
}
