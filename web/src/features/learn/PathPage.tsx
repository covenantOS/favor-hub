// Learn > Learning path: the courses of one path in order, with where to continue. ?p=slug.
import { Suspense } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Bar, CourseCard, Failure, Ln, LnLink, Skeleton, Tile, useFocusHeading, useRetryOnce } from './LearnCommon';
import { LnIcon } from './shared/Icons';
import { dayWord, mins, plural } from './shared/format';
import { courseHref, slugOf, type LearnPath } from './logic';
import { pathQuery } from './queries';

export function PathPage() {
  const slug = slugOf((useSearch({ strict: false }) as Record<string, unknown>).p);
  return (
    <Ln view="path">
      <ErrorBoundary label="That learning path did not load. Refresh the page to try again." className="ln-empty">
        <Suspense fallback={<Skeleton />}>{slug ? <PathBody slug={slug} /> : <Skeleton />}</Suspense>
      </ErrorBoundary>
    </Ln>
  );
}

function PathBody({ slug }: { slug: string }) {
  const { data, refetch } = useSuspenseQuery(pathQuery(slug));
  useRetryOnce(data.state === 'error', refetch);
  if (data.state === 'error') return <Failure status={data.status} message={data.message} onRetry={() => void refetch()} />;
  return <PathView p={data.data} preview={data.preview} />;
}

function PathView({ p, preview }: { p: LearnPath; preview: boolean }) {
  useFocusHeading(p.slug);
  const nextSlug = p.next_course && p.next_course.slug;
  const a = p.assignment;
  return (
    <>
      <nav className="ln-crumb" aria-label="Where you are">
        <LnLink href="/learn/">My learning</LnLink>
        <i>/</i>
        <LnLink href="/learn/catalog/">Catalog</LnLink>
      </nav>
      {preview ? <div className="ln-banner">Draft. Only admins and HR can open this path.</div> : null}
      <section className={`ln-card ln-hero ln-c--${p.color}`}>
        <div className="ln-hero__top">
          <Tile kind="path" />
          <div>
            <h1>{p.title}</h1>
            {p.summary ? <p>{p.summary}</p> : null}
          </div>
        </div>
        <div className="ln-chips">
          <span className="ln-chip">{plural(p.courses || 0, 'course')}</span>
          {p.minutes ? <span className="ln-chip">about {mins(p.minutes)}</span> : null}
          {p.audience ? <span className="ln-chip">{p.audience}</span> : null}
          {p.state === 'done' ? (
            <span className="ln-chip ln-chip--ok">
              <LnIcon name="check" />
              Completed
            </span>
          ) : null}
        </div>
        {a ? (
          <div className={'ln-banner' + (a.overdue ? ' ln-banner--late' : '')}>
            <LnIcon name="clock" />
            Assigned to you{a.assigned_by ? ' by ' + a.assigned_by : ''}
            {a.due_date ? (a.overdue ? ', was due ' : ', due ') + dayWord(a.due_date) : ''}
            {a.note ? <small>{a.note}</small> : null}
          </div>
        ) : null}
        <div className="ln-hero__row">
          {p.state !== 'new' && p.state !== 'done' ? (
            <div className="ln-hero__prog">
              <Bar pct={p.pct} lg />
              <span>
                {p.done} of {plural(p.total, 'lesson')} done
              </span>
            </div>
          ) : null}
          {nextSlug ? (
            <LnLink href={courseHref(nextSlug)} className="h-btn h-btn--primary h-btn--lg">
              {p.state === 'new' ? 'Start' : 'Continue'}
            </LnLink>
          ) : null}
        </div>
      </section>
      <section className="ln-sec" aria-label="Courses in this path">
        <h2>
          Courses <em>{p.course_list.length}</em>
        </h2>
        <div className="ln-steps">
          {p.course_list.map((c, i) => (
            <div key={c.id} className={`ln-step${c.state === 'done' ? ' is-done' : ''}${c.slug === nextSlug ? ' is-next' : ''} ln-c--${c.color}`}>
              <span className="ln-step__n">{c.state === 'done' ? <LnIcon name="check" /> : i + 1}</span>
              <CourseCard c={c} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
