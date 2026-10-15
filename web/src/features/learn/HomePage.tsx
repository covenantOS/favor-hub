// Learn > My learning. Same markup, class names and stylesheet as the Astro page (src/pages/learn/index.astro + public/js/learn.js).
import { Suspense } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Bar, CourseCard, Failure, KindChip, Ln, LnLink, Skeleton, Tile, useRetryOnce } from './LearnCommon';
import { LnIcon } from './shared/Icons';
import { courseHref, dueChip, pathHref, progLine, sizeLine, type AssignedCard, type Card, type Home } from './logic';
import { homeQuery } from './queries';

export function HomePage() {
  return (
    <Ln view="home">
      <ErrorBoundary label="My learning did not load. Refresh the page to try again." className="ln-empty">
        <Suspense fallback={<Skeleton title="My learning" />}>
          <HomeBody />
        </Suspense>
      </ErrorBoundary>
    </Ln>
  );
}

function HomeBody() {
  const { data, refetch } = useSuspenseQuery(homeQuery);
  useRetryOnce(data.state === 'error', refetch);
  if (data.state === 'error') return <Failure status={data.status} message={data.message} onRetry={() => void refetch()} />;
  return <HomeView d={data.data} />;
}

function HomeView({ d }: { d: Home }) {
  const s = d.stats || ({} as Home['stats']);
  const cont = d.continue && d.assigned.length === 0 ? d.continue : null;
  const none = !d.assigned.length && !d.in_progress.length && !d.completed.length;
  const caughtUp = !d.assigned.length && !d.in_progress.length && d.completed.length > 0;
  return (
    <>
      <div className="ln-head">
        <div>
          <h1>My learning</h1>
        </div>
      </div>
      {s.assigned || s.overdue || s.due_soon || s.completed ? (
        <div className="ln-stats">
          {s.assigned ? (
            <span className="ln-stat">
              <b>{s.assigned}</b>assigned
            </span>
          ) : null}
          {s.overdue ? (
            <span className="ln-stat ln-stat--late">
              <b>{s.overdue}</b>late
            </span>
          ) : null}
          {s.due_soon ? (
            <span className="ln-stat">
              <b>{s.due_soon}</b>due within a week
            </span>
          ) : null}
          {s.completed ? (
            <span className="ln-stat">
              <b>{s.completed}</b>completed
            </span>
          ) : null}
        </div>
      ) : null}
      {cont ? (
        <div className="ln-resume">
          <div className="ln-resume__t">
            <small>Where you left off</small>
            <b>{cont.title}</b>
            <Bar pct={cont.pct} />
          </div>
          <LnLink href={cont.href} className="h-btn h-btn--primary h-btn--lg">
            Continue
          </LnLink>
        </div>
      ) : null}
      {d.assigned.length ? (
        <section className="ln-sec" aria-label="Assigned to you">
          <h2>
            Assigned to you <em>{d.assigned.length}</em>
          </h2>
          <div className="ln-list">
            {d.assigned.map((a) => (
              <Assigned key={a.assignment_id} a={a} />
            ))}
          </div>
        </section>
      ) : null}
      {d.in_progress.length ? (
        <section className="ln-sec" aria-label="In progress">
          <h2>
            In progress <em>{d.in_progress.length}</em>
          </h2>
          <div className="ln-grid">
            {d.in_progress.map((c) => (
              <CourseCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      ) : null}
      {d.completed.length ? (
        <section className="ln-sec" aria-label="Completed">
          <h2>
            Completed <em>{d.completed.length}</em>
          </h2>
          <div className="ln-list">
            {d.completed.map((c) => (
              <DoneRow key={c.id} c={c} />
            ))}
          </div>
        </section>
      ) : null}
      {none ? (
        <div className="ln-empty">
          <b>Nothing assigned to you</b>
          <p>Courses and learning paths that someone assigns show here with their due dates. The catalog lists everything you can take on your own.</p>
          <LnLink href="/learn/catalog/" className="h-btn h-btn--primary">
            Open the catalog
          </LnLink>
        </div>
      ) : caughtUp ? (
        <div className="ln-empty">
          <b>You are all caught up</b>
          <p>Nothing is assigned to you right now.</p>
          <LnLink href="/learn/catalog/" className="h-btn h-btn--ghost">
            Open the catalog
          </LnLink>
        </div>
      ) : null}
    </>
  );
}

function Assigned({ a }: { a: AssignedCard }) {
  const next = a.next;
  const href = a.kind === 'path' ? pathHref(a.slug) : courseHref(a.slug, next && a.state !== 'new' ? next.id : '');
  const due = dueChip(a);
  return (
    <div className={`ln-card ln-ac ln-c--${a.color}${a.overdue ? ' ln-ac--late' : ''}`}>
      <Tile kind={a.kind} />
      <div className="ln-ac__t">
        <b>
          <LnLink href={href}>{a.title}</LnLink>
        </b>
        <div className="ln-chips">
          <KindChip kind={a.kind} />
          {due ? (
            <span className={due.cls}>
              <LnIcon name="clock" />
              {due.text}
            </span>
          ) : null}
          <span className="ln-chip">{sizeLine(a)}</span>
        </div>
        {a.note ? <p>{a.note}</p> : a.assigned_by ? <p>Assigned by {a.assigned_by}</p> : null}
        <div className="ln-ac__prog">
          {a.state === 'new' ? null : (
            <>
              <Bar pct={a.pct} />
              <span>{progLine(a)}</span>
            </>
          )}
        </div>
      </div>
      <div className="ln-ac__go">
        <LnLink href={href} className="h-btn h-btn--primary">
          {a.state === 'new' ? 'Start' : 'Continue'}
        </LnLink>
      </div>
      {a.parts && a.parts.length ? (
        <div className="ln-ac__parts">
          {a.parts.map((p) => (
            <span key={p.slug} className={'ln-chip' + (p.state === 'done' ? ' ln-chip--ok' : '')}>
              {p.state === 'done' ? <LnIcon name="check" /> : null}
              {p.title}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DoneRow({ c }: { c: Card }) {
  return (
    <LnLink className={`ln-card ln-lr ln-c--${c.color}`} href={c.href} style={{ gridTemplateColumns: '36px minmax(0,1fr) auto' }}>
      <span className="ln-tile ln-tile--sm">
        <LnIcon name="check" />
      </span>
      <span className="ln-lr__t">
        <b>{c.title}</b>
        <span>{progLine(c)}</span>
      </span>
      <span className="ln-lr__m">{c.cert ? 'Certificate' : ''}</span>
    </LnLink>
  );
}
