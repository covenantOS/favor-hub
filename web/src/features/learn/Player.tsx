// The lesson player: video, article, document, clip, written page, link and quiz lessons, with progress saved as a person goes (the
// lesson opened, how far into a video, each lesson finished). A draft course previews for its authors and records nothing.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { hubOv } from '@/lib/hubOv';
import { LessonRow, LnLink, celebrateNext, useFocusHeading, useGo } from './LearnCommon';
import { LnIcon } from './shared/Icons';
import { Markdown } from './shared/Markdown';
import { sendJson } from './shared/api';
import { toast } from './shared/toast';
import { mins } from './shared/format';
import { Quiz } from './Quiz';
import { applyAnswer, courseHref, driveInfo, KIND, mediaSrc, resumeAt, safeUrl, type Course, type CourseAnswer, type Lesson, type LearnState } from './logic';
import { learnKeys, refreshLearn, type Read } from './queries';

const saveProgress = (lessonId: string, state: 'started' | 'done', position: number, keep = false) =>
  sendJson('/api/learn/progress', 'POST', { lesson_id: lessonId, state, position: Math.round(position || 0) }, keep) as Promise<CourseAnswer & Record<string, unknown>>;

/** Applies a saved answer to the course copy in the cache, and marks the other Learn reads stale. */
function useApply(course: Course) {
  const qc = useQueryClient();
  return (res: CourseAnswer, lessonId: string, state: LearnState | null) => {
    if (res.preview) return;
    qc.setQueryData<Read<Course>>(learnKeys.course(course.slug), (old) => (old && old.state === 'ok' ? { ...old, data: applyAnswer(old.data, res, lessonId, state) } : old));
    refreshLearn(qc, course.slug);
  };
}

export function Player({ course, lesson: l, preview }: { course: Course; lesson: Lesson; preview: boolean }) {
  const go = useGo();
  const apply = useApply(course);
  const [outline, setOutline] = useState(false);
  const list = course.lesson_list;
  const i = list.findIndex((x) => x.id === l.id);
  const prev = list[i - 1];
  const next = list[i + 1];
  const done = l.state === 'done';
  const colorCls = `ln-c--${course.color}`;
  useFocusHeading('lesson:' + l.id);
  useEffect(() => setOutline(false), [l.id]);

  // Opening a lesson that is not finished records that it was started (and where a video stopped).
  const startPos = useRef(l.position || 0);
  useEffect(() => {
    if (!done && l.kind !== 'quiz' && !preview) {
      saveProgress(l.id, 'started', startPos.current)
        .then((r) => apply(r, l.id, 'started'))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.id]);

  const complete = async (fromVideo = false, btn?: HTMLButtonElement | null) => {
    if (preview) {
      toast('Draft preview. Nothing is recorded.');
      go(next ? courseHref(course.slug, next.id) : courseHref(course.slug));
      return;
    }
    if (btn) btn.disabled = true;
    try {
      let res: (CourseAnswer & Record<string, unknown>) | null = null;
      if (l.state !== 'done') {
        res = await saveProgress(l.id, 'done', 0);
        apply(res, l.id, 'done');
      }
      if (res && res.just_completed) {
        celebrateNext(course.slug);
        go(courseHref(course.slug));
        return;
      }
      go(next ? courseHref(course.slug, next.id) : courseHref(course.slug));
    } catch (e) {
      if (btn) btn.disabled = false;
      if (!fromVideo) toast((e as Error).message || 'That did not save. Try again.');
      else toast((e as Error).message || 'That did not save. Try again.');
    }
  };

  const left = prev ? (
    <LnLink href={courseHref(course.slug, prev.id)} className="h-btn h-btn--ghost">
      Previous
    </LnLink>
  ) : (
    <LnLink href={courseHref(course.slug)} className="h-btn h-btn--ghost">
      Course page
    </LnLink>
  );

  return (
    <>
      <nav className="ln-crumb" aria-label="Where you are">
        <LnLink href="/learn/">My learning</LnLink>
        <i>/</i>
        <LnLink href={courseHref(course.slug)}>{course.title}</LnLink>
      </nav>
      {preview ? <div className="ln-banner">Draft preview. Nothing you do here is recorded.</div> : null}
      <div className={`ln-play ${colorCls}`}>
        <div className="ln-main">
          <div className="ln-lh">
            <div>
              <h1>{l.title}</h1>
              <div className="ln-chips">
                <span className="ln-chip ln-chip--c">{KIND[l.kind] || l.kind}</span>
                <span className="ln-chip">
                  Lesson {i + 1} of {list.length}
                </span>
                {l.minutes ? <span className="ln-chip">{mins(l.minutes)}</span> : null}
                {done ? (
                  <span className="ln-chip ln-chip--ok">
                    <LnIcon name="check" />
                    Done
                  </span>
                ) : null}
              </div>
            </div>
            <button type="button" className="h-btn h-btn--ghost ln-lessons-btn" id="ln-outline-btn" onClick={() => setOutline(true)}>
              <LnIcon name="list" className="h-i" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }} /> Lessons
            </button>
          </div>
          <div id="ln-body" className="ln-lesson ln-card">
            <LessonBody l={l} preview={preview} onEnded={() => void complete(true)} course={course} next={next} apply={apply} />
          </div>
          <div className="ln-acts" id="ln-acts">
            {l.kind === 'quiz' ? (
              <>
                <div>{left}</div>
                <div className="ln-acts__r">
                  {done ? (
                    <span className="ln-done-note">
                      <LnIcon name="check" />
                      Passed
                    </span>
                  ) : null}
                  {next ? (
                    <LnLink href={courseHref(course.slug, next.id)} className={'h-btn ' + (done ? 'h-btn--primary' : 'h-btn--ghost')}>
                      Next lesson
                    </LnLink>
                  ) : done ? (
                    <LnLink href={courseHref(course.slug)} className="h-btn h-btn--primary">
                      Back to the course
                    </LnLink>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div>{left}</div>
                <div className="ln-acts__r">
                  {done ? (
                    <span className="ln-done-note">
                      <LnIcon name="check" />
                      Done
                    </span>
                  ) : null}
                  <button type="button" className="h-btn h-btn--primary h-btn--lg" id="ln-finish" onClick={(e) => void complete(false, e.currentTarget)}>
                    {done ? (next ? 'Next lesson' : 'Finish course') : next ? 'Mark complete and continue' : 'Mark complete and finish'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <aside className={`ln-card ln-side ${colorCls}`} aria-label="Lessons in this course">
          <h2>{course.title}</h2>
          <div className="ln-lessons" style={{ padding: 0 }}>
            {list.map((x, k) => (
              <LessonRow key={x.id} l={x} i={k} slug={course.slug} current={x.id === l.id} />
            ))}
          </div>
        </aside>
      </div>
      {outline ? BodyPortal(<OutlineSheet course={course} currentId={l.id} colorCls={colorCls} onClose={() => setOutline(false)} />) : null}
    </>
  );
}

/** The phone's lesson list: a sheet over the page that the back gesture and Escape close. */
function OutlineSheet({ course, currentId, colorCls, onClose }: { course: Course; currentId: string; colorCls: string; onClose: () => void }) {
  const xRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const ret = document.activeElement as HTMLElement | null;
    const tok = hubOv.on(onClose);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    xRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', key, true);
      hubOv.off(tok);
      try {
        ret?.focus({ preventScroll: true });
      } catch {
        // the page is gone
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <div className="ln-sheet-scrim" onClick={onClose} />
      <div className="ln-sheet" role="dialog" aria-modal="true" aria-label={course.title}>
        <div className="ln-sheet__bar">
          <b>{course.title}</b>
          <button type="button" className="ln-sheet__x" aria-label="Close" ref={xRef} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={`ln-card ln-lessons ${colorCls}`}>
          {course.lesson_list.map((x, k) => (
            <LessonRow key={x.id} l={x} i={k} slug={course.slug} current={x.id === currentId} />
          ))}
        </div>
      </div>
    </>
  );
}

function LessonBody({ l, preview, onEnded, course, next, apply }: { l: Lesson; preview: boolean; onEnded: () => void; course: Course; next: Lesson | undefined; apply: (r: CourseAnswer, id: string, s: LearnState | null) => void }) {
  switch (l.kind) {
    case 'video':
      return (
        <>
          <MediaLesson
            l={l}
            preview={preview}
            onEnded={onEnded}
            
            video={
              <video id="ln-video" controls playsInline preload="metadata" poster={mediaSrc(l.ref, 'jpg', l.cut)}>
                <source src={mediaSrc(l.ref, 'mp4', l.cut)} type="video/mp4" />
                <track kind="captions" src={mediaSrc(l.ref, 'vtt', l.cut)} srcLang="en" label="English" default />
              </video>
            }
          />
          <div className="ln-chips">
            <LnLink href={'/help/videos/' + encodeURIComponent(l.ref) + '/'} className="ln-chip" target="_blank" rel="noopener">
              Captions and transcript
            </LnLink>
          </div>
        </>
      );
    case 'clip':
      return (
        <>
          <MediaLesson
            l={l}
            preview={preview}
            onEnded={onEnded}
            
            video={<video id="ln-video" controls playsInline preload="metadata" poster={`/api/clips/${encodeURIComponent(l.ref)}/media?poster=1`} src={`/api/clips/${encodeURIComponent(l.ref)}/media`} />}
          />
          <div className="ln-chips">
            <LnLink href={'/c/' + encodeURIComponent(l.ref)} className="ln-chip" target="_blank" rel="noopener">
              Open the clip page
            </LnLink>
          </div>
        </>
      );
    case 'article':
      return <Article l={l} />;
    case 'doc': {
      const info = driveInfo(l.ref);
      return (
        <>
          {info ? <iframe className="ln-frame" title={l.title} src={info.preview} loading="lazy" referrerPolicy="no-referrer" /> : null}
          <div className="ln-open">
            <b>{l.title}</b>
            <span>{l.ref}</span>
            <a className="h-btn h-btn--ghost" href={safeUrl(l.ref)} target="_blank" rel="noopener noreferrer">
              Open in Google Drive
            </a>
          </div>
        </>
      );
    }
    case 'page':
      return (
        <div className="ln-page">
          <Markdown src={l.body} />
        </div>
      );
    case 'link':
      return (
        <div className="ln-open">
          <b>{l.title}</b>
          <span>{l.ref}</span>
          <a className="h-btn h-btn--primary" href={safeUrl(l.ref)} target="_blank" rel="noopener noreferrer">
            Open the link
          </a>
        </div>
      );
    case 'quiz':
      return <Quiz l={l} course={course} next={next} apply={apply} />;
    default:
      return null;
  }
}

/** A video or clip: resumes where the person stopped, saves how far they got, and finishes the lesson when it ends. */
function MediaLesson({ l, preview, onEnded, video }: { l: Lesson; preview: boolean; onEnded: () => void; video: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  useEffect(() => {
    const v = box.current?.querySelector('video');
    if (!v) return;
    let last = 0;
    let sent = 0;
    let doneSent = l.state === 'done';
    const at = l.state === 'done' ? 0 : l.position || 0;
    const onMeta = () => {
      const t = resumeAt({ state: l.state, position: at }, v.duration);
      if (t) {
        try {
          v.currentTime = t;
        } catch {
          // the player decides
        }
      }
    };
    if (v.readyState >= 1) onMeta();
    else v.addEventListener('loadedmetadata', onMeta, { once: true });
    const save = (keep: boolean) => {
      if (preview || doneSent || !v.currentTime) return;
      const t = Math.floor(v.currentTime);
      if (!keep && Math.abs(t - sent) < 8) return;
      sent = t;
      saveProgress(l.id, 'started', t, keep).catch(() => undefined);
    };
    const onTime = () => {
      const n = Date.now();
      if (n - last > 10000) {
        last = n;
        save(false);
      }
    };
    const onPause = () => save(true);
    const onEnd = () => {
      if (doneSent) return;
      doneSent = true;
      endedRef.current();
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') save(true);
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnd);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      // Leaving the lesson saves where it stopped.
      save(true);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnd);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      try {
        v.pause();
      } catch {
        // gone
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.id]);
  return (
    <div className="ln-vid" ref={box}>
      {video}
    </div>
  );
}

/** Takes scripts, frames, event handlers and script links out of a help article before it is placed in the page. */
function cleanArticle(root: ParentNode): void {
  root.querySelectorAll('script, style, iframe, object, embed, link, meta, form, base').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/^on/i.test(a.name) || ((a.name === 'href' || a.name === 'src' || a.name === 'poster') && /^\s*(javascript|data):/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
}

/** A help article: its videos and body, read from the article's own page. A page that cannot be read gives a link to open it. */
function Article({ l }: { l: Lesson }) {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading');
  const html = useRef<HTMLDivElement>(null);
  const parts = useRef<{ figs: string; body: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/help/' + encodeURIComponent(l.ref) + '/', { credentials: 'same-origin' });
        if (!res.ok) throw new Error('missing');
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const art = doc.querySelector('.hd-article');
        if (!art) throw new Error('missing');
        cleanArticle(art);
        const figs = Array.from(art.querySelectorAll('figure.hd-video')).map((f) => f.outerHTML).join('');
        const body = art.querySelector('.hd-body');
        parts.current = { figs, body: body ? body.innerHTML : '' };
        if (alive) setState('ok');
      } catch {
        if (alive) setState('fail');
      }
    })();
    return () => {
      alive = false;
    };
  }, [l.ref]);
  // The article's markup comes from the hub's own help pages (cleaned above), so it is placed as parsed elements, once, after it draws.
  useEffect(() => {
    const el = html.current;
    if (state !== 'ok' || !el || !parts.current) return;
    el.innerHTML = `${parts.current.figs}<div class="hd-body">${parts.current.body}</div>`;
    el.querySelectorAll<HTMLVideoElement>('video[data-video]').forEach((v) => {
      v.preload = 'none';
    });
  }, [state]);
  return (
    <div className="ln-art" id="ln-art">
      {state === 'loading' ? <div className="ln-card ln-skel h-skel" style={{ minHeight: 200 }} /> : null}
      {state === 'ok' ? (
        <>
          <div ref={html} style={{ display: 'contents' }} />
          <p style={{ margin: '16px 0 0' }}>
            <a className="ln-chip" href={'/help/' + encodeURIComponent(l.ref) + '/'} target="_blank" rel="noopener">
              Open the full article
            </a>
          </p>
        </>
      ) : null}
      {state === 'fail' ? (
        <div className="ln-open">
          <b>{l.title}</b>
          <a className="h-btn h-btn--ghost" href={'/help/' + encodeURIComponent(l.ref) + '/'} target="_blank" rel="noopener">
            Open the article
          </a>
        </div>
      ) : null}
    </div>
  );
}
