// Learn > Catalog: every published course and path with this person's progress, a search box and a state filter.
import { Suspense, useMemo, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { CourseCard, Failure, Ln, Skeleton, useRetryOnce } from './LearnCommon';
import { LnIcon } from './shared/Icons';
import { plural } from './shared/format';
import { catalogHit } from './logic';
import { catalogQuery, type CatalogData } from './queries';

export function CatalogPage() {
  return (
    <Ln view="catalog">
      <ErrorBoundary label="The catalog did not load. Refresh the page to try again." className="ln-empty">
        <Suspense fallback={<Skeleton title="Catalog" />}>
          <CatalogBody />
        </Suspense>
      </ErrorBoundary>
    </Ln>
  );
}

function CatalogBody() {
  const { data, refetch } = useSuspenseQuery(catalogQuery);
  useRetryOnce(data.state === 'error', refetch);
  if (data.state === 'error') return <Failure status={data.status} message={data.message} onRetry={() => void refetch()} />;
  return <CatalogView d={data.data} />;
}

const FILTERS: Array<[string, string]> = [
  ['all', 'All'],
  ['new', 'Not started'],
  ['started', 'In progress'],
  ['done', 'Completed'],
];

function CatalogView({ d }: { d: CatalogData }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const total = d.paths.length + d.courses.length;
  const paths = useMemo(() => d.paths.filter((c) => catalogHit(c, f, q)), [d.paths, f, q]);
  const courses = useMemo(() => d.courses.filter((c) => catalogHit(c, f, q)), [d.courses, f, q]);
  return (
    <>
      <div className="ln-head">
        <div>
          <h1>Catalog</h1>
          <p>
            {plural(d.paths.length, 'learning path')} and {plural(d.courses.length, 'course')}
          </p>
        </div>
      </div>
      <div className="ln-tools">
        <label className="ln-search">
          <LnIcon name="search" />
          <span className="ln-sr">Search courses</span>
          <input id="ln-q" type="search" placeholder="Search courses and paths" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="ln-seg" role="group" aria-label="Show">
          {FILTERS.map(([v, label]) => (
            <button key={v} type="button" data-f={v} aria-pressed={f === v} onClick={() => setF(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div id="ln-res">
        {!paths.length && !courses.length ? (
          <div className="ln-empty">
            <b>{total ? 'Nothing matches' : 'No courses yet'}</b>
            <p>{total ? 'Try a different word or filter.' : 'Published courses show here.'}</p>
          </div>
        ) : (
          <>
            {paths.length ? (
              <section className="ln-sec">
                <h2>
                  Learning paths <em>{paths.length}</em>
                </h2>
                <div className="ln-grid">
                  {paths.map((c) => (
                    <CourseCard key={c.id} c={c} />
                  ))}
                </div>
              </section>
            ) : null}
            {courses.length ? (
              <section className="ln-sec" style={{ marginTop: 20 }}>
                <h2>
                  Courses <em>{courses.length}</em>
                </h2>
                <div className="ln-grid">
                  {courses.map((c) => (
                    <CourseCard key={c.id} c={c} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
