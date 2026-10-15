// Learn > Certificate: the printable certificate of completion. ?c=course&email= (a supervisor, HR or an admin may open another person's).
import { Suspense } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { Failure, Ln, LnLink, Skeleton, useFocusHeading, useRetryOnce } from './LearnCommon';
import { longDay } from './shared/format';
import { courseHref, slugOf, type Certificate } from './logic';
import { certQuery } from './queries';
import { useEffect } from 'react';

export function CertificatePage() {
  const s = useSearch({ strict: false }) as Record<string, unknown>;
  const slug = slugOf(s.c);
  const email = slugOf(s.email);
  return (
    <Ln view="cert">
      <ErrorBoundary label="The certificate did not load. Refresh the page to try again." className="ln-empty">
        <Suspense fallback={<Skeleton />}>{slug ? <CertBody slug={slug} email={email} /> : <Skeleton />}</Suspense>
      </ErrorBoundary>
    </Ln>
  );
}

function CertBody({ slug, email }: { slug: string; email: string }) {
  const { data, refetch } = useSuspenseQuery(certQuery(slug, email));
  useRetryOnce(data.state === 'error', refetch);
  if (data.state === 'error') return <Failure status={data.status} message={data.message} onRetry={() => void refetch()} />;
  return <CertView c={data.data} slug={slug} />;
}

function CertView({ c, slug }: { c: Certificate; slug: string }) {
  useFocusHeading(slug);
  useEffect(() => {
    document.title = `Certificate - ${c.course} - FavorOS`;
  }, [c.course]);
  return (
    <>
      <nav className="ln-crumb ln-noprint" aria-label="Where you are">
        <LnLink href="/learn/">My learning</LnLink>
        <i>/</i>
        <LnLink href={courseHref(slug)}>{c.course}</LnLink>
      </nav>
      <div className="ln-cert-wrap">
        <article className="ln-cert" aria-label="Certificate of completion">
          <img src="/images/favor-logo-color.png" alt="Favor International" />
          <small>Certificate of completion</small>
          <h1>{c.name}</h1>
          <p>completed</p>
          <h2>{c.course}</h2>
          <div className="ln-cert__foot">
            <div>
              <b>{longDay(c.completed_at)}</b>
              <span>Date completed</span>
            </div>
            <div>
              <b>{c.cert}</b>
              <span>Certificate number</span>
            </div>
          </div>
        </article>
        <div className="ln-chips ln-noprint">
          <button type="button" className="h-btn h-btn--primary h-btn--lg" id="ln-print" onClick={() => window.print()}>
            Print
          </button>
          <LnLink href={courseHref(slug)} className="h-btn h-btn--ghost h-btn--lg">
            Back to the course
          </LnLink>
        </div>
      </div>
    </>
  );
}
