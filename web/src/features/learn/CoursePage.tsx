// Learn > Course: the course page with its lessons, and (with ?l=lessonId) the lesson player. ?c=slug&l=lessonId.
import { Suspense, useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Bar, Failure, Ln, LnLink, LessonRow, Skeleton, Tile, useFocusHeading, useRetryOnce, celebrating, clearCelebrate } from './LearnCommon';
import { Player } from './Player';
import { LnIcon } from './shared/Icons';
import { dayWord, mins, plural } from './shared/format';
import { certHref, courseHref, courseStart, minutesLeft, pathHref, slugOf, type Course } from './logic';
import { courseQuery } from './queries';

export function CoursePage() {
  const s = useSearch({ strict: false }) as Record<string, unknown>;
  const slug = slugOf(s.c);
  const lessonId = slugOf(s.l);
  return (
    <Ln view="course">
      <ErrorBoundary label="That course did not load. Refresh the page to try again." className="ln-empty">
        <Suspense fallback={<Skeleton />}>{slug ? <CourseBody slug={slug} lessonId={lessonId} /> : <Skeleton />}</Suspense>
      </ErrorBoundary>
    </Ln>
  );
}

function CourseBody({ slug, lessonId }: { slug: string; lessonId: string }) {
  const q = useSuspenseQuery(courseQuery(slug));
  const { data, refetch } = q;
  useRetryOnce(data.state === 'error', refetch);
  const course = data.state === 'ok' ? data.data : null;
  const lesson = course && lessonId ? course.lesson_list.find((l) => l.id === lessonId) || null : null;
  // The view attribute the stylesheet widens the player with.
  useEffect(() => {
    const el = document.getElementById('ln');
    if (el) el.dataset.view = lesson ? 'player' : 'course';
  }, [lesson]);
  useEffect(() => {
    if (!course) return;
    document.title = (lesson ? `${lesson.title} - ${course.title}` : course.title) + ' - FavorOS';
  }, [course, lesson]);
  if (data.state === 'error') return <Failure status={data.status} message={data.message} onRetry={() => void refetch()} />;
  if (!course) return null;
  if (lesson) return <Player key={lesson.id} course={course} lesson={lesson} preview={data.preview} />;
  return <Overview course={course} preview={data.preview} />;
}

function Overview({ course: c, preview }: { course: Course; preview: boolean }) {
  const qc = useQueryClient();
  const justDone = celebrating(c.slug);
  useEffect(() => {
    clearCelebrate(c.slug);
  }, [c.slug]);
  // Coming back from a lesson draws from the copy in hand, then the server's copy replaces it (where to continue may have moved).
  useEffect(() => {
    const st = qc.getQueryState(['learn', 'course', c.slug]);
    if (st && Date.now() - st.dataUpdatedAt > 3000) void qc.invalidateQueries({ queryKey: ['learn', 'course', c.slug] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.slug]);
  useFocusHeading('course:' + c.slug);
  const total = c.lesson_list.length;
  const started = c.state !== 'new';
  const { cta, startId } = courseStart(c);
  const left = minutesLeft(c);
  const a = c.assignment;
  const cur = c.next_id;
  return (
    <>
      <nav className="ln-crumb" aria-label="Where you are">
        <LnLink href="/learn/">My learning</LnLink>
        <i>/</i>
        <LnLink href="/learn/catalog/">Catalog</LnLink>
      </nav>
      {preview ? <div className="ln-banner">Draft. Only admins and HR can open this course, and nothing you do here is recorded.</div> : null}
      {justDone ? <Completion c={c} /> : null}
      <section className={`ln-card ln-hero ln-c--${c.color}`}>
        <div className="ln-hero__top">
          <Tile kind="course" />
          <div>
            <h1>{c.title}</h1>
            {c.summary ? <p>{c.summary}</p> : null}
          </div>
        </div>
        <div className="ln-chips">
          <span className="ln-chip">{plural(total, 'lesson')}</span>
          {c.minutes ? <span className="ln-chip">about {mins(c.minutes)}</span> : null}
          {c.audience ? <span className="ln-chip">{c.audience}</span> : null}
          {c.state === 'done' ? (
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
          {started && c.state !== 'done' ? (
            <div className="ln-hero__prog">
              <Bar pct={c.pct} lg />
              <span>
                {c.done} of {total} done{left ? ', about ' + mins(left) + ' left' : ''}
              </span>
            </div>
          ) : null}
          {startId ? (
            <LnLink href={courseHref(c.slug, startId)} className="h-btn h-btn--primary h-btn--lg">
              {cta}
            </LnLink>
          ) : null}
          {c.state === 'done' && c.completed ? (
            <LnLink href={certHref(c.slug)} className="h-btn h-btn--ghost h-btn--lg">
              <LnIcon name="cert" /> Certificate
            </LnLink>
          ) : null}
        </div>
        {c.paths && c.paths.length ? (
          <div className="ln-chips">
            {c.paths.map((p) => (
              <LnLink key={p.slug} href={pathHref(p.slug)} className="ln-chip ln-chip--c">
                <LnIcon name="path" />
                {p.title}
              </LnLink>
            ))}
          </div>
        ) : null}
      </section>
      <section className={`ln-sec ln-c--${c.color}`} aria-label="Lessons">
        <h2>
          Lessons <em>{total}</em>
        </h2>
        <div className="ln-card ln-lessons">
          {total ? c.lesson_list.map((l, i) => <LessonRow key={l.id} l={l} i={i} slug={c.slug} current={l.id === cur && started} />) : <p style={{ padding: 16, margin: 0 }}>This course has no lessons yet.</p>}
        </div>
      </section>
    </>
  );
}

function Completion({ c }: { c: Course }) {
  const p = c.paths && c.paths[0];
  return (
    <section className="ln-done" aria-label="Course complete">
      <h2>Course complete</h2>
      <p>{c.title} is on your record. The certificate is ready to print.</p>
      <div className="ln-chips">
        <LnLink href={certHref(c.slug)} className="h-btn h-btn--primary">
          <LnIcon name="cert" /> Open the certificate
        </LnLink>
        {p ? (
          <LnLink href={pathHref(p.slug)} className="h-btn h-btn--ghost">
            Back to {p.title}
          </LnLink>
        ) : null}
        <LnLink href="/learn/" className="h-btn h-btn--ghost">
          My learning
        </LnLink>
      </div>
    </section>
  );
}
