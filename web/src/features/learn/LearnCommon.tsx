// Pieces every learner page shares: the page frame, links that move inside the app, the course and path cards, the failure panel.
import '@hub/styles/learn.css';
import '@hub/styles/lint-fix.css';
import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { NavLink } from '@/shell/NavLink';
import { hubOv } from '@/lib/hubOv';
import { LnIcon } from './shared/Icons';
import { failureTitle } from './shared/api';
import { courseHref, lessonSub, progLine, sizeLine, type Card, type Lesson } from './logic';
import { mins } from './shared/format';

/** The page body. data-view is what learn.css keys on (the player is wider). */
export function Ln({ view, busy, children }: { view: string; busy?: boolean; children: ReactNode }) {
  return (
    <div className="ln" id="ln" data-view={view} aria-busy={busy ? true : undefined}>
      {children}
    </div>
  );
}

/** What stands in for a page while its read is on the way: the title (when it is known) and two card-height blocks. */
export function Skeleton({ title }: { title?: string }) {
  return (
    <>
      <div className="ln-head">
        <div>{title ? <h1>{title}</h1> : null}</div>
      </div>
      <div className="ln-list">
        <div className="ln-card ln-skel h-skel" />
        <div className="ln-card ln-skel h-skel" />
      </div>
    </>
  );
}

/** A link that moves between Learn pages without a reload (a plain link while the web app does not serve the route). */
export function LnLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <NavLink href={href} className={className} {...rest}>
      {children}
    </NavLink>
  );
}

/** Go to a Learn address from code (after finishing a lesson), the way a link does: open overlays unwind first. */
export function useGo(): (href: string) => void {
  const router = useRouter();
  return (href: string) => {
    hubOv.unwind(() => {
      router.history.push(href);
    });
  };
}

/** Reads that failed on the server (a slow relay) are asked for once more in the browser before the failure panel stays. */
export function useRetryOnce(failed: boolean, refetch: () => unknown): void {
  const tried = useRef(false);
  useEffect(() => {
    if (failed && !tried.current) {
      tried.current = true;
      void refetch();
    }
  }, [failed, refetch]);
}

export function Failure({ status, message, onRetry }: { status: number; message: string; onRetry: () => void }) {
  return (
    <div className="ln-empty" role="alert">
      <b>{failureTitle(status)}</b>
      <p>{message || 'Try again.'}</p>
      <div className="ln-chips">
        <button type="button" className="h-btn h-btn--primary" onClick={onRetry}>
          Try again
        </button>
        <LnLink className="h-btn h-btn--ghost" href="/learn/">
          My learning
        </LnLink>
      </div>
    </div>
  );
}

export function Tile({ kind, sm }: { kind: string; sm?: boolean }) {
  return (
    <span className={'ln-tile' + (sm ? ' ln-tile--sm' : '')}>
      <LnIcon name={kind === 'path' ? 'path' : 'course'} />
    </span>
  );
}

export const Bar = ({ pct, lg }: { pct: number; lg?: boolean }) => (
  <span className={'ln-bar' + (lg ? ' ln-bar--lg' : '')}>
    <i style={{ width: `${pct}%` }} />
  </span>
);

export function KindChip({ kind }: { kind: string }) {
  return <span className="ln-chip ln-chip--c">{kind === 'path' ? 'Learning path' : 'Course'}</span>;
}

export function CourseCard({ c }: { c: Card }) {
  return (
    <LnLink className={`ln-card ln-cc ln-c--${c.color}`} href={c.href}>
      <span className="ln-cc__top">
        <Tile kind={c.kind} />
        <span className="ln-cc__t">
          <b>{c.title}</b>
          {c.summary ? <span>{c.summary}</span> : null}
        </span>
      </span>
      <span className="ln-cc__foot">
        {c.state === 'new' ? null : <Bar pct={c.pct} />}
        <span className="ln-cc__meta">
          <span>{sizeLine(c)}</span>
          {c.state === 'new' ? null : <span>{progLine(c)}</span>}
        </span>
        <span className="ln-chips">
          <KindChip kind={c.kind} />
          {c.audience ? <span className="ln-chip">{c.audience}</span> : null}
          {c.state === 'done' ? (
            <span className="ln-chip ln-chip--ok">
              <LnIcon name="check" />
              Done
            </span>
          ) : null}
        </span>
      </span>
    </LnLink>
  );
}

/** Moves to the top of the page and the heading after a view changes, as the Astro pages did on each draw. */
export function useFocusHeading(key: string): void {
  useEffect(() => {
    window.scrollTo(0, 0);
    const h = document.querySelector<HTMLElement>('#ln h1');
    if (h) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [key]);
}

/** Set when the last lesson of a course was just finished: the next course page opens with the completion panel. */
let celebrateSlug = '';
export const celebrateNext = (slug: string) => {
  celebrateSlug = slug;
};
export const celebrating = (slug: string) => celebrateSlug === slug;
export const clearCelebrate = (slug: string) => {
  if (celebrateSlug === slug) celebrateSlug = '';
};

export function LessonRow({ l, i, slug, current }: { l: Lesson; i: number; slug: string; current: boolean }) {
  return (
    <LnLink className={`ln-lr is-${l.state}${current ? ' is-cur' : ''}`} href={courseHref(slug, l.id)}>
      <span className="ln-lr__n">{l.state === 'done' ? <LnIcon name="check" /> : String(i + 1)}</span>
      <span className="ln-tile ln-tile--sm" style={{ background: 'var(--r-sunk)', color: 'var(--r-ink-2)' }}>
        <LnIcon name={l.kind} />
      </span>
      <span className="ln-lr__t">
        <b>{l.title}</b>
        <span>{lessonSub(l)}</span>
      </span>
      <span className="ln-lr__m">{l.minutes ? mins(l.minutes) : ''}</span>
    </LnLink>
  );
}

