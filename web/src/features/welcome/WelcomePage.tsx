// The first-day page: a welcome, the new hire's own steps, the first week, the people to meet and the FavorOS tour.
// Same classes, calls and wording as the classic page (public/js/onboard/welcome.js).
import { Suspense, useState } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { hubGet } from '../../lib/hub';
import { toast } from '../projects/kit/toast';
import { NavLink } from '@/shell/NavLink';
import '@hub/styles/onboard.css';

interface Meet {
  email: string;
  name: string;
  title: string;
  team: string;
  picture: string;
  why: string;
}
interface Step {
  id: string;
  title: string;
  detail: string;
  kind: string;
  due_date: string | null;
  status: string;
  link_url: string;
  link_label: string;
  key: string;
}
interface FwItem {
  kind: string;
  title: string;
  detail?: string;
  href: string;
  done?: boolean;
  lessons?: number;
  lessonsDone?: number;
  minutes?: number;
}
interface Welcome {
  me: { name: string };
  run: { id: string; date: string; title: string; team: string; welcome: string } | null;
  steps: Step[];
  meet: Meet[];
  week: Array<{ label: string; items: Array<{ who: string; title: string; done: boolean }> }>;
  learn: Record<string, boolean>;
  firstWeek: { done: number; total: number; role: { known: boolean; label: string }; days: Array<{ day: number; title: string; items: FwItem[] }> } | null;
}

const welcomeQuery = queryOptions({
  queryKey: ['welcome'],
  queryFn: async (): Promise<Welcome> => (await hubGet('/api/onboarding/welcome')) as Welcome,
  staleTime: 0,
});

// The staff list gives the faces and names. A page without it still draws, with initials.
const peopleQuery = queryOptions({
  queryKey: ['welcome', 'people'],
  queryFn: async (): Promise<Array<{ email: string; name: string; picture?: string }>> => {
    try {
      return ((await hubGet('/api/requests/people')) as { people?: Array<{ email: string; name: string; picture?: string }> }).people || [];
    } catch {
      return [];
    }
  },
  staleTime: 5 * 60_000,
});

const TZ = 'America/New_York';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const dayWord = (d: string) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : '');
const longDay = (d: string) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : '');
const first = (n?: string) => String(n || '').trim().split(/\s+/)[0] || '';

const ICON: Record<string, string> = {
  check: '<path d="m5 12 5 5 9-10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
const Ic = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[n] || '' }} />;
const FW_ICON: Record<string, string> = { course: 'list', practice: 'spark', tour: 'spark', meet: 'user', read: 'link' };
const STEP_KIND: Record<string, string> = { form: 'Do this yourself', learn: 'In Learn', task: '', auto: '' };

const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const initials = (name: string) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

function Face({ p, names }: { p: { email: string; picture?: string }; names: Map<string, { name: string; picture?: string }> }) {
  if (p.picture) {
    return (
      <span className="rq-av wl-face">
        <img src={p.picture} alt="" referrerPolicy="no-referrer" />
      </span>
    );
  }
  const person = names.get(p.email.toLowerCase());
  const name = person?.name || String(p.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className="rq-av" data-entity={`person:${p.email.toLowerCase()}`} data-label={name} data-c={COLORS[hash(String(p.email || '')) % 7]}>
      {person?.picture ? <img src={person.picture} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

function Page() {
  const qc = useQueryClient();
  const { data: D } = useSuspenseQuery(welcomeQuery);
  const people = useSuspenseQuery(peopleQuery).data;
  const names = new Map(people.map((p) => [p.email.toLowerCase(), p]));
  const [over, setOver] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const now = today();

  const r = D.run;
  const sup = D.meet.find((m) => m.why === 'Your supervisor');
  const when = r ? (r.date > now ? `You start ${longDay(r.date)}.` : r.date === now ? 'Your first day is today.' : `You started ${longDay(r.date)}.`) : '';

  async function tick(s: Step, status: string) {
    if (!r) return;
    const next = status === 'done' ? 'open' : 'done';
    setBusy(s.id);
    try {
      const res = await fetch(`/api/onboarding/runs/${r.id}/steps/${s.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'X-Hub-Request': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!res.ok || !d || d.ok === false) throw new Error((d && d.message) || 'Something went wrong. Try again.');
      setOver((o) => ({ ...o, [s.id]: next }));
      void qc.invalidateQueries({ queryKey: ['welcome'], refetchType: 'none' });
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setBusy('');
    }
  }

  const open = D.steps.filter((s) => (over[s.id] ?? s.status) === 'open').length;
  const f = D.firstWeek;
  const pct = f && f.total ? Math.round((f.done / f.total) * 100) : 0;

  return (
    <>
      <header className="wl-hero">
        <div className="wl-hero__t">
          <p className="wl-kicker">FavorOS</p>
          <h1>Welcome to Favor, {first(D.me.name) || 'there'}.</h1>
          <p className="wl-sub">{[when, r && r.title, r && r.team].filter(Boolean).join(' · ')}</p>
          <div className="wl-acts">
            <button type="button" className="h-btn h-btn--primary" data-tour-start="">
              <Ic n="spark" />
              Take the FavorOS tour
            </button>
            <NavLink className="h-btn h-btn--ghost" href="/learn/">
              Open Learn
            </NavLink>
          </div>
        </div>
        {r && r.welcome && (
          <figure className="wl-note">
            {sup && <Face p={sup} names={names} />}
            <blockquote>{r.welcome}</blockquote>
            {sup && (
              <figcaption>
                {sup.name}, {sup.title || 'your supervisor'}
              </figcaption>
            )}
          </figure>
        )}
      </header>
      <div className="wl-body">
        {f && (
          <section className="wl-sec wl-fwk">
            <h2>
              Your first week{f.role.known ? ` as ${f.role.label}` : ''} <span>{f.done} of {f.total} done</span>
            </h2>
            <span className="ob-bar ob-bar--lg" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="First week progress">
              <i style={{ width: `${pct}%` }} />
            </span>
            <ol className="wl-days">
              {f.days.map((d) => (
                <li className="wl-day" key={d.day}>
                  <h3>
                    <span className="wl-day__n">Day {d.day}</span>
                    {d.title}
                  </h3>
                  <ul>
                    {d.items.map((i, k) => (
                      <li className={`wl-fw${i.done ? ' is-done' : ''}`} key={k}>
                        <span className="wl-fw__ic" aria-hidden="true">
                          <Ic n={i.done ? 'check' : FW_ICON[i.kind] || 'list'} />
                        </span>
                        <NavLink href={i.href}>
                          <b>{i.title}</b>
                          {i.detail && <span>{i.detail}</span>}
                          {i.kind === 'course' && i.lessons ? (
                            <small>
                              {i.lessonsDone} of {i.lessons} lessons{i.minutes ? ` · about ${i.minutes} min` : ''}
                            </small>
                          ) : null}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}
        {r && D.steps.length > 0 && (
          <section className="wl-sec">
            <h2>
              Your steps <span>{open} open</span>
            </h2>
            <ul className="ob-steps">
              {D.steps.map((s) => {
                const status = over[s.id] ?? s.status;
                const done = status === 'done' || (s.kind === 'learn' && !!D.learn[s.key]);
                const canTick = s.kind !== 'auto' && s.kind !== 'learn' && status !== 'skipped';
                const late = !done && !!s.due_date && s.due_date < now;
                return (
                  <li className={`ob-step wl-step${done ? ' is-done' : ''}${late ? ' is-late' : ''}`} data-id={s.id} key={s.id}>
                    <button type="button" className="ob-tick" data-tick="" aria-pressed={done} aria-label={`${done ? 'Done. Press to reopen' : 'Mark done'}: ${s.title}`} disabled={!canTick || busy === s.id} onClick={() => void tick(s, status)}>
                      <Ic n="check" />
                    </button>
                    <div className="ob-step__body">
                      <div className="ob-step__title">
                        <span>{s.title}</span>
                        {STEP_KIND[s.kind] ? <span className="ob-chip">{STEP_KIND[s.kind]}</span> : null}
                      </div>
                      {s.detail && <p className="ob-step__detail">{s.detail}</p>}
                      <div className="ob-step__meta">
                        {s.due_date && (
                          <span className={`ob-due${late ? ' is-late' : ''}`}>
                            {late ? 'Late, ' : 'Due '}
                            {dayWord(s.due_date)}
                          </span>
                        )}
                        {s.link_url && s.link_url !== '/welcome/' && (
                          <NavLink className="ob-link" href={s.link_url} {...(/^https?:/.test(s.link_url) ? { target: '_blank', rel: 'noopener' } : {})}>
                            <Ic n="link" />
                            {s.link_label || 'Open'}
                          </NavLink>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {D.week.length > 0 && (
          <section className="wl-sec">
            <h2>Due this week</h2>
            <ol className="wl-week">
              {D.week.map((d, i) => (
                <li key={i}>
                  <h3>{d.label}</h3>
                  <ul>
                    {d.items.map((it, k) => (
                      <li className={it.done ? 'is-done' : ''} key={k}>
                        <span className="wl-who">{it.who}</span>
                        {it.title}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}
        {D.meet.length > 0 && (
          <section className="wl-sec wl-people">
            <h2>People to meet</h2>
            <ul className="wl-grid">
              {D.meet.map((m) => (
                <li className="wl-person" key={m.email}>
                  <Face p={m} names={names} />
                  <div>
                    <b>{m.name}</b>
                    <span>{m.title || m.team}</span>
                    <small>{m.why}</small>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="wl-sec">
          <h2>Find your way around</h2>
          <ul className="wl-links">
            {[
              ['/', 'Today', 'What is waiting on you'],
              ['/requests/', 'Requests', 'Ask for something or see where it stands'],
              ['/meet/', 'Meetings', 'Join, book and read notes'],
              ['/help/', 'Help docs', 'How every tool works, with search'],
            ].map(([h, t, d]) => (
              <li key={h}>
                <NavLink href={h}>
                  <b>{t}</b>
                  <span>{d}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="ob-empty">
      <p>{message}</p>
    </div>
  );
}

export function WelcomePage() {
  return (
    <div className="ob wl" id="wl-root">
      <Suspense
        fallback={
          <>
            <div className="ob-skel" />
            <div className="ob-skel" />
          </>
        }
      >
        <Page />
      </Suspense>
    </div>
  );
}

export { Failed };
