// A quiz lesson: multiple choice and true or false with a pass mark and retakes. The answers stay on the server; the page sends the
// choices and draws what the server says was right.
import { useRef, useState } from 'react';
import { LnLink, celebrateNext, useGo } from './LearnCommon';
import { plural } from './shared/format';
import { sendJson } from './shared/api';
import { toast } from './shared/toast';
import { certHref, courseHref, whyLine, type Course, type CourseAnswer, type Lesson, type LearnState, type QuizResult } from './logic';

export function Quiz({ l, course, next, apply }: { l: Lesson; course: Course; next: Lesson | undefined; apply: (r: CourseAnswer, id: string, s: LearnState | null) => void }) {
  const q = l.quiz!;
  const go = useGo();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [best, setBest] = useState<{ best?: number; attempts?: number }>({ best: l.best, attempts: l.attempts });
  const resultRef = useRef<HTMLDivElement>(null);
  const n = q.questions.length;
  const k = Object.keys(answers).length;
  const byId = new Map((result?.results || []).map((x) => [x.id, x]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || k < n) return;
    setBusy(true);
    try {
      const r = (await sendJson('/api/learn/quiz/' + encodeURIComponent(l.id), 'POST', { answers })) as unknown as QuizResult;
      setResult(r);
      apply(r, l.id, r.passed ? 'done' : null);
      if (r.best != null) setBest({ best: r.best, attempts: r.attempts });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
      if (r.just_completed) {
        setTimeout(() => {
          celebrateNext(course.slug);
          go(courseHref(course.slug));
        }, 2600);
      }
    } catch (err) {
      toast((err as Error).message || 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    setAnswers({});
    setResult(null);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="ln-qz" id="ln-qz">
      <p className="ln-sum">
        {plural(n, 'question')}. Pass mark {q.pass}%. You can retake it as many times as you like.
      </p>
      {best.best != null ? (
        <p className="ln-sum">
          Your best score is {best.best}%{best.attempts ? ' in ' + plural(best.attempts, 'try', 'tries') : ''}.
        </p>
      ) : null}
      <div id="ln-result" ref={resultRef}>
        {result ? (
          <div className={`ln-score ${result.passed ? 'ln-score--pass' : 'ln-score--fail'}`} role="status">
            <span className="ln-score__n">{result.score}%</span>
            <div>
              <b>{result.passed ? 'Passed' : 'Not yet'}</b>
              <p>
                {result.correct} of {result.total} right. Pass mark {result.pass}%.{result.attempts > 1 ? ' Try ' + result.attempts + '.' : ''}
                {result.preview ? ' Draft preview, not recorded.' : ''}
              </p>
            </div>
          </div>
        ) : null}
      </div>
      <form id="ln-qform" className="ln-qz" noValidate onSubmit={submit}>
        {q.questions.map((x, i) => {
          const r = byId.get(x.id);
          const why = result ? whyLine(r, result.passed) : '';
          return (
            <div key={x.id} className={'ln-q' + (r ? (r.correct ? ' is-right' : ' is-wrong') : '')} role="radiogroup" aria-labelledby={`ln-qt-${i}`} data-q={x.id}>
              <p className="ln-q__h" id={`ln-qt-${i}`}>
                <span>{i + 1}</span>
                {x.text}
              </p>
              <div className="ln-opts">
                {x.options.map((o, j) => (
                  <label key={j} className={'ln-opt' + (result && result.passed && r && r.answer === j ? ' is-key' : '')}>
                    <input type="radio" name={x.id} value={j} checked={answers[x.id] === j} disabled={!!result} onChange={() => setAnswers((a) => ({ ...a, [x.id]: j }))} />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
              <p className="ln-why" hidden={!why}>
                {why}
              </p>
            </div>
          );
        })}
        <div className="ln-acts">
          {!result ? (
            <>
              <span className="ln-sum" id="ln-count">
                {k} of {n} answered
              </span>
              <button type="submit" className="h-btn h-btn--primary h-btn--lg" id="ln-submit" disabled={k < n || busy}>
                Submit answers
              </button>
            </>
          ) : result.passed ? (
            <>
              <span />
              <div className="ln-acts__r">
                {next ? (
                  <LnLink href={courseHref(course.slug, next.id)} className="h-btn h-btn--primary h-btn--lg">
                    Next lesson
                  </LnLink>
                ) : result.just_completed ? (
                  <LnLink href={certHref(course.slug)} className="h-btn h-btn--primary h-btn--lg">
                    Open the certificate
                  </LnLink>
                ) : (
                  <LnLink href={courseHref(course.slug)} className="h-btn h-btn--primary h-btn--lg">
                    Back to the course
                  </LnLink>
                )}
              </div>
            </>
          ) : (
            <>
              <span className="ln-sum">Review the marked questions and try again.</span>
              <button type="button" className="h-btn h-btn--primary h-btn--lg" id="ln-retake" onClick={retake}>
                Retake the quiz
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
