// The top of Today: the greeting and status line, the live meeting pill, the tour pill, the mission line, "Since you were away", and the
// first-week card for new hires. The tour pill is shown and hidden by the tour script (src/scripts/tour.ts) through its id, so it is
// rendered once, outside every read, and never given a `hidden` value again.
import { Suspense, useEffect, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { send } from '@/lib/api';
import { clock, dayKey, et, lateCount, n0, needCount, plural, type J } from './rank';
import { briefQ, dayQ, todayQ, welcomeQ } from './queries';
import { useNeeds, useShared } from './state';
import { Ic, useNow } from './ui';
import { todaysEvents } from './Schedule';

const partOf = (now: number) => {
  const h = Number(et(now, { hour: 'numeric', hour12: false })) % 24;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const dateLine = (now: number) => et(now, { weekday: 'long', month: 'long', day: 'numeric' });

function Hello() {
  const now = useNow();
  const { data: t } = useSuspenseQuery(todayQ);
  const f = String((t.user && t.user.name) || '').trim().split(/\s+/)[0];
  const first = f && t.user.via === 'google' ? f : '';
  // Other pages greet by this name before their reads answer.
  useEffect(() => {
    try {
      if (first) localStorage.setItem('favor.hub.first.v1', first);
      else localStorage.removeItem('favor.hub.first.v1');
    } catch {
      // storage refused
    }
  }, [first]);
  return <h1 id="t-hello">{first ? `${partOf(now)}, ${first}` : partOf(now)}</h1>;
}

function HelloFallback() {
  const now = useNow();
  const [name, setName] = useState('');
  useEffect(() => {
    try {
      setName(localStorage.getItem('favor.hub.first.v1') || '');
    } catch {
      // storage refused
    }
  }, []);
  return <h1 id="t-hello">{name ? `${partOf(now)}, ${name}` : partOf(now)}</h1>;
}

function Status() {
  const { items, now } = useNeeds();
  const { data: day } = useSuspenseQuery(dayQ);
  const c = needCount(items);
  const late = lateCount(items);
  const left = day ? todaysEvents(day, dayKey(now)).filter((e) => !e.allDay && Date.parse(e.end) > now) : null;
  return (
    <>
      <span>{dateLine(now)}</span>
      <i aria-hidden="true">·</i>
      {c ? (
        <a href="#t-cards" onClick={(e) => { e.preventDefault(); document.getElementById('td-needs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          {plural(c, 'thing needs you', 'things need you')}{late ? `, ${n0(late)} late` : ''}
        </a>
      ) : (
        <span>Nothing needs you</span>
      )}
      {left ? (
        <>
          <i aria-hidden="true">·</i>
          <span>{left.length ? `${plural(left.length, 'meeting')} left today, next at ${clock(left[0].start)}` : 'No more meetings today'}</span>
        </>
      ) : null}
    </>
  );
}

function DateOnly() {
  const now = useNow();
  return <span id="t-date">{dateLine(now)}</span>;
}

function LivePill() {
  const now = useNow();
  const { data: day } = useSuspenseQuery(dayQ);
  const e = day ? todaysEvents(day, dayKey(now)).find((x) => !x.allDay && now >= Date.parse(x.start) && now < Date.parse(x.end)) : null;
  if (!e) return null;
  const inside = !!e.hub;
  const href = e.hub ? '/meet/room/?m=' + encodeURIComponent(e.hub) : e.meet || (e.phone ? 'tel:' + String(e.phone).replace(/[^0-9+]/g, '') : '');
  return (
    <div className="td-live">
      <span className="td-live__dot" aria-hidden="true" />
      <span className="td-live__t"><b>{e.title}</b><small>{`Live until ${clock(e.end)}`}</small></span>
      {href ? (inside ? <NavLink className="td-btn td-btn--live" href={href}>Join</NavLink> : <a className="td-btn td-btn--live" href={href} target="_blank" rel="noopener">Join</a>) : null}
    </div>
  );
}

function Away() {
  const { owner } = useShared();
  const { data } = useSuspenseQuery(briefQ(owner));
  const [gone, setGone] = useState(false);
  const a = data && data.away;
  const show = !!a && !!a.parts && a.parts.length > 0 && !gone;
  return (
    <p className="td-away" id="td-away" hidden={!show}>
      {show ? (
        <>
          <span className="td-away__l">Since you were away</span>
          {(a.parts as J[]).map((p) => <NavLink key={p.href + p.line} href={p.href}>{p.line}</NavLink>)}
          <button type="button" className="td-x" aria-label="Close" onClick={() => { setGone(true); void send('/api/brief/seen', {}).catch(() => undefined); }}><Ic n="x" /></button>
        </>
      ) : null}
    </p>
  );
}

export function Head() {
  return (
    <header className="td-head">
      <section className="td-hello h-hello">
        <ErrorBoundary label="">
          <Suspense fallback={<><HelloFallback /></>}>
            <Hello />
          </Suspense>
        </ErrorBoundary>
        <p className="td-status" id="td-status">
          <ErrorBoundary label="">
            <Suspense fallback={<DateOnly />}>
              <Status />
            </Suspense>
          </ErrorBoundary>
        </p>
      </section>
      <div className="td-head__r">
        <div id="t-now">
          <ErrorBoundary label="">
            <Suspense fallback={null}>
              <LivePill />
            </Suspense>
          </ErrorBoundary>
        </div>
        <div className="h-welcome td-tour" id="t-welcome" hidden>
          <span className="h-welcome__mark"><Ic n="spark" /></span>
          <b>Tour of FavorOS, 2 minutes</b>
          <div className="h-welcome__acts"><button type="button" className="h-btn h-btn--primary h-btn--sm" data-tour-start="">Show me</button></div>
        </div>
        <p className="td-mission"><b>615,780</b> people have come to Christ since Favor began</p>
      </div>
      <ErrorBoundary label="">
        <Suspense fallback={<p className="td-away" id="td-away" hidden />}>
          <Away />
        </Suspense>
      </ErrorBoundary>
    </header>
  );
}

/* ---------------------------------------------------------------- the first week (new hires) */
const KIND: Record<string, string> = { course: 'Course', practice: 'Practice', tour: 'Tour', meet: 'Check-in', read: 'Read' };
const dayNo = (iso: string) => Math.round(Date.parse(iso + 'T12:00:00Z') / 864e5);
function weekdayOf(start: string | undefined, today: string) {
  if (!start || start > today) return 1;
  let n = 0;
  for (let d = dayNo(start); d <= dayNo(today); d++) {
    const w = new Date(d * 864e5).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return Math.max(1, n);
}

function FirstWeekBody() {
  const now = useNow();
  const { data: d } = useSuspenseQuery(welcomeQ);
  const today = dayKey(now);
  const f = d && d.firstWeek;
  if (!d || !d.run || !f || !f.days || !f.days.length || !f.total) return null;
  // The card stays for three weeks from the start, or until every item is done.
  if (f.done >= f.total || dayNo(today) - dayNo(f.start || d.run.date) > 21) return null;
  const n = Math.min(f.days.length, weekdayOf(f.start || d.run.date, today));
  const hasLeft = (x: J) => x.items.some((i: J) => !i.done);
  const day: J = f.days.slice(n - 1).find(hasLeft) || f.days.find(hasLeft) || f.days[n - 1];
  const pct = Math.round((f.done / f.total) * 100);
  return (
    <section className="h-card fw-card" aria-label="Your first week">
      <div className="fw-head"><h2>Your first week</h2><span className="fw-count">{f.done} of {f.total} done</span><NavLink className="dp-link" href="/welcome/">All {f.days.length} days</NavLink></div>
      <span className="fw-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="First week progress"><i style={{ width: pct + '%' }} /></span>
      <div className="fw-day">Day {day.day} · {day.title}</div>
      <ul className="fw-list">
        {day.items.map((i: J) => {
          const fact = [KIND[i.kind] || '', i.kind === 'course' && i.lessons ? `${i.lessonsDone} of ${i.lessons} lessons` : '', i.kind === 'course' && i.minutes ? `${i.minutes} min` : ''].filter(Boolean).join(' · ');
          return (
            <li className={'fw-row' + (i.done ? ' is-done' : '')} key={i.href + i.title}>
              <div className="fw-main"><NavLink className="fw-t" href={i.href}>{i.title}</NavLink><span className="fw-f">{fact}</span></div>
              {i.done ? <span className="fw-done"><Ic n="arrow" />Done</span> : <NavLink className="h-btn h-btn--ghost h-btn--sm" href={i.href}>{i.kind === 'course' && i.lessonsDone ? 'Continue' : 'Open'}</NavLink>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FirstWeek() {
  return (
    <div id="fw-root">
      <ErrorBoundary label="">
        <Suspense fallback={null}>
          <FirstWeekBody />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
