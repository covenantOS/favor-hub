// The three questionnaires as the Astro page drew them: the editable form with its progress bar, section tabs and submit box, the read-only
// version, and the rows they share. Same class names, ids and markup. Staff write their own answers by hand; nothing here suggests,
// drafts or fills in text.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { Form, Question, Section } from '@hub/data/evaluation-forms';
import { toast } from './toast';
import {
  gapLabel,
  gapsOf,
  hasAnswer,
  longToday,
  merged,
  percent,
  secProgress,
  totalsOf,
  byId,
  type Ans,
  type Answers,
  type CaseView,
  type FormId,
  type FormsPayload,
  type Scale,
} from './logic';

/** Text with its line breaks kept. */
export function Lines({ text }: { text: string }) {
  const parts = String(text || '').split('\n');
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i ? <br /> : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

/** A textarea that grows with its text, up to 520 px. */
function Grow({ value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 2, 520) + 'px';
  }, [value]);
  return <textarea ref={ref} value={value} {...rest} />;
}

export function ScaleHead({ scale }: { scale: Scale[] }) {
  return (
    <div className="ev-scale" role="presentation">
      <span></span>
      {scale.map((s) => (
        <span key={s.value} title={s.label + '. ' + s.text}>
          <b>{s.short}</b>
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function Legend({ forms }: { forms: FormsPayload }) {
  return (
    <details className="ev-legend">
      <summary>What the numbers mean</summary>
      <ul>
        {forms.scale.map((s) => (
          <li key={s.value}>
            <b>
              {s.short} {s.label}.
            </b>{' '}
            {s.text}
          </li>
        ))}
      </ul>
      <p>{forms.exampleNote}</p>
    </details>
  );
}

export interface RowHandlers {
  onRate: (q: Question, value: number) => void;
  onExample: (q: Question, text: string) => void;
  onText: (q: Question, text: string) => void;
  onChoice: (q: Question, text: string) => void;
}

function RatingRow({ q, a, edit, scale, h }: { q: Question; a: Ans | undefined; edit: boolean; scale: Scale[]; h: RowHandlers }) {
  const val = a && a.rating !== null && a.rating !== undefined ? a.rating : null;
  const sc = scale.find((s) => s.value === val);
  return (
    <div className="ev-q ev-q--rate" data-q={q.id}>
      <div className="ev-q__t" id={'l-' + q.id}>
        <span className="ev-q__n">{q.n}</span>
        {q.text}
      </div>
      <div className="ev-dots" role="radiogroup" aria-labelledby={'l-' + q.id}>
        {scale.map((s) => (
          <label className={'ev-dot' + (val === s.value ? ' is-on' : '')} title={s.label} key={s.value}>
            <input type="radio" name={'r-' + q.id} value={s.value} checked={val === s.value} disabled={!edit} onChange={() => h.onRate(q, s.value)} />
            <span>{s.short}</span>
          </label>
        ))}
      </div>
      <div className="ev-picked" aria-live="polite">
        {sc ? sc.short + ' ' + sc.label : ''}
      </div>
      {val === 1 || val === 2 ? (
        <label className="ev-ex">
          <span>
            Example <i>(required for a 1 or 2)</i>
          </span>
          <textarea data-ex={q.id} rows={2} maxLength={8000} readOnly={!edit} value={(a && a.example) || ''} onChange={(e) => h.onExample(q, e.target.value)} />
        </label>
      ) : null}
    </div>
  );
}

function TextRow({ q, a, edit, h }: { q: Question; a: Ans | undefined; edit: boolean; h: RowHandlers }) {
  const tag = q.kind === 'choice' || q.req ? <em className="ev-req">Required</em> : <em className="ev-opt">Optional</em>;
  const label = (
    <label className="ev-q__t" htmlFor={'f-' + q.id}>
      {q.n ? <span className="ev-q__n">{q.n}</span> : null}
      {q.text}
      {tag}
    </label>
  );
  if (q.kind === 'choice') {
    return (
      <div className="ev-q" data-q={q.id}>
        {label}
        <select id={'f-' + q.id} name={q.id} data-choice={q.id} disabled={!edit} value={(a && a.text) || ''} onChange={(e) => h.onChoice(q, e.target.value)}>
          <option value="">Choose</option>
          {(q.options || []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="ev-q" data-q={q.id}>
      {label}
      <Grow id={'f-' + q.id} data-text={q.id} rows={3} maxLength={8000} readOnly={!edit} value={a ? a.text : ''} onChange={(e) => h.onText(q, e.target.value)} />
    </div>
  );
}

/** A line the hub fills in (name, title, department, supervisor, period, date). */
function AutoRow({ q, view, meName }: { q: Question; view: CaseView; meName: string }) {
  const c = view.case;
  let v = '';
  if (q.auto === 'name' || q.auto === 'employee') v = c.employee.name;
  else if (q.auto === 'title') v = c.employee.title;
  else if (q.auto === 'department') v = c.employee.team;
  else if (q.auto === 'supervisor') v = c.supervisor.name;
  else if (q.auto === 'period') v = c.period;
  else if (q.auto === 'date') v = longToday();
  else if (q.auto === 'reviewer') v = meName;
  return (
    <div className="ev-auto">
      <span>{q.text}</span>
      <b>{v || 'Not set'}</b>
    </div>
  );
}

export function SectionBlock({ sec, m, edit, forms, view, meName, h }: { sec: Section; m: Answers; edit: boolean; forms: FormsPayload; view: CaseView; meName: string; h: RowHandlers }) {
  const rate = sec.questions.some((q) => q.kind === 'rating');
  let reflect = false;
  return (
    <section className="ev-section" aria-labelledby={'sec-' + sec.id}>
      <h2 id={'sec-' + sec.id}>{sec.title}</h2>
      {sec.blurb ? <p className="ev-sub">{sec.blurb}</p> : null}
      {rate ? (
        <>
          <ScaleHead scale={forms.scale} />
          <Legend forms={forms} />
        </>
      ) : null}
      {sec.questions.map((q) => {
        if (q.kind === 'auto') return <AutoRow key={q.id} q={q} view={view} meName={meName} />;
        let head: ReactNode = null;
        if (q.kind !== 'rating' && rate && !reflect) {
          reflect = true;
          head = <h3 className="ev-reflect">Reflection</h3>;
        }
        return (
          <Fragment key={q.id}>
            {head}
            {q.kind === 'rating' ? <RatingRow q={q} a={m[q.id]} edit={edit} scale={forms.scale} h={h} /> : <TextRow q={q} a={m[q.id]} edit={edit} h={h} />}
          </Fragment>
        );
      })}
    </section>
  );
}

/** The intro box at the top of a form. */
export function Intro({ form, extra }: { form: Form; extra?: ReactNode }) {
  return (
    <section className="ev-panel ev-intro">
      <h2>{form.title}</h2>
      {form.intro.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <p className="ev-readers">
        <b>Who reads this.</b> {form.readers}
      </p>
      {extra}
    </section>
  );
}

/** Handlers that turn what a person types into queued answers, keeping the example on a rating and the rating on its example. */
export function rowHandlers(formId: FormId, cur: (qid: string) => Ans | undefined, queue: (f: FormId, a: Ans) => void, after?: (q: Question, kind: string, value: number | string) => void): RowHandlers {
  return {
    onRate: (q, value) => {
      const c = cur(q.id);
      queue(formId, { qid: q.id, rating: value, text: '', example: (c && c.example) || '' });
      after?.(q, 'rate', value);
    },
    onExample: (q, text) => {
      const c = cur(q.id);
      queue(formId, { qid: q.id, rating: c ? c.rating : null, text: '', example: text });
    },
    onText: (q, text) => {
      const c = cur(q.id);
      queue(formId, { qid: q.id, rating: null, text, example: (c && c.example) || '' });
    },
    onChoice: (q, text) => queue(formId, { qid: q.id, rating: null, text, example: '' }),
  };
}

const READ_NONE: RowHandlers = { onRate: () => undefined, onExample: () => undefined, onText: () => undefined, onChoice: () => undefined };

/** A form after it is submitted: the intro, a note, and every section with its answers locked. */
export function FormLocked({ formId, form, src, view, forms, meName }: { formId: FormId; form: Form; src: Ans[]; view: CaseView; forms: FormsPayload; meName: string }) {
  const m = byId(src);
  const c = view.case;
  const note = formId === 'A' ? (c.termOpen ? 'Submitted. Your supervisor can reopen it if something needs to change.' : 'This term is closed.') : 'Submitted. Thank you.';
  return (
    <div className="ev-form" data-form={formId}>
      <Intro form={form} />
      <p className="ev-note">{note}</p>
      {form.sections.map((s) => (
        <SectionBlock key={s.id} sec={s} m={m} edit={false} forms={forms} view={view} meName={meName} h={READ_NONE} />
      ))}
    </div>
  );
}

/** Someone else's answers, read only: a title, then each section's questions with the answer under them. */
export function FormRead({ form, answers, label, forms }: { form: Form; answers: Ans[]; label: string; forms: FormsPayload }) {
  const m = byId(answers);
  return (
    <section className="ev-panel ev-read">
      <h2>{label}</h2>
      {form.sections.map((sec) => {
        if (sec.questions.every((q) => q.kind === 'auto')) return null;
        return (
          <Fragment key={sec.id}>
            <h3 className="ev-read__h">{sec.title}</h3>
            {sec.questions.map((q) => {
              if (q.kind === 'auto') return null;
              const a = m[q.id];
              const num = q.n ? <span className="ev-q__n">{q.n}</span> : null;
              if (q.kind === 'rating') {
                const sc = forms.scale.find((s) => a && s.value === a.rating);
                return (
                  <div className="ev-ro" key={q.id}>
                    <p>
                      {num}
                      {q.text}
                    </p>
                    <p className="ev-ro__a">
                      {sc ? (
                        <>
                          <span className={'ev-pill ev-pill--' + sc.value}>{sc.short}</span> {sc.label}
                        </>
                      ) : (
                        <span className="ev-sub">Not rated</span>
                      )}
                      {a && a.example ? (
                        <>
                          <br />
                          <span className="ev-ro__ex">Example: {a.example}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                );
              }
              return (
                <div className="ev-ro" key={q.id}>
                  <p>
                    {num}
                    {q.text}
                  </p>
                  <p className="ev-ro__a">{a && a.text ? <Lines text={a.text} /> : <span className="ev-sub">No answer</span>}</p>
                </div>
              );
            })}
          </Fragment>
        );
      })}
    </section>
  );
}

export interface EditorProps {
  formId: FormId;
  form: Form;
  saved: Ans[];
  edits: Answers;
  saving: string;
  view: CaseView;
  forms: FormsPayload;
  meName: string;
  queue: (f: FormId, a: Ans) => void;
  flush: (f: FormId) => Promise<void>;
  /** Called after the server accepted the form: refresh the case, then move on. */
  onSubmitted: (formId: FormId) => Promise<void>;
  submit: (formId: FormId) => Promise<unknown>;
}

/** A form being written: progress, section tabs, one section at a time, and the submit box on the last one. */
export function FormEditor(p: EditorProps) {
  const { formId, form, saved, edits, saving, view, forms, meName } = p;
  const [si, setSi] = useState(0);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingJump = useRef('');
  const m = merged(saved, edits);
  const cur = si < 0 ? 0 : Math.min(si, form.sections.length - 1);
  const t = totalsOf(form, m);
  const g = gapsOf(form, m);
  const handlers = rowHandlers(formId, (qid) => merged(saved, edits)[qid], p.queue);

  // After the section changes, a jump from the submit box lands on its question.
  useEffect(() => {
    const id = pendingJump.current;
    if (!id) return;
    pendingJump.current = '';
    const el = document.querySelector('[data-q="' + id + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const f = el.querySelector<HTMLElement>('textarea,input,select');
      if (f) f.focus();
    }
  }, [cur]);

  // The "Yes, submit" question stays for 6 seconds.
  useEffect(() => {
    if (!sure) return;
    const id = setTimeout(() => setSure(false), 6000);
    return () => clearTimeout(id);
  }, [sure]);

  // A rating of 1 or 2 opens its example box; the cursor goes there.
  const rated = useRef('');
  useEffect(() => {
    if (!rated.current) return;
    const id = rated.current;
    rated.current = '';
    const ex = document.querySelector('[data-q="' + id + '"] [data-ex]') as HTMLElement | null;
    if (ex) ex.focus();
  });
  const h: RowHandlers = {
    ...handlers,
    onRate: (q, value) => {
      handlers.onRate(q, value);
      if (value === 1 || value === 2) rated.current = q.id;
    },
  };

  const go = (n: number) => {
    setSi(n);
    window.scrollTo({ top: 0 });
  };
  const jump = (n: number, id: string) => {
    pendingJump.current = id;
    if (n === cur) {
      setSi(n);
      // Same section: the effect above does not run, so land now.
      const el = document.querySelector('[data-q="' + id + '"]');
      pendingJump.current = '';
      if (el) {
        el.scrollIntoView({ block: 'center' });
        const f = el.querySelector<HTMLElement>('textarea,input,select');
        if (f) f.focus();
      }
    } else setSi(n);
  };

  const submit = async () => {
    if (!sure) {
      setSure(true);
      return;
    }
    setSure(false);
    setBusy(true);
    try {
      await p.flush(formId);
      await p.submit(formId);
      toast('Submitted.');
      await p.onSubmitted(formId);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  };

  const last = cur === form.sections.length - 1;
  return (
    <div className="ev-form" data-form={formId}>
      {cur === 0 ? <Intro form={form} /> : null}
      <div className="ev-bar-wrap">
        <div className="ev-prog">
          <div className="ev-bar" role="img" aria-label={t.done + ' of ' + t.total + ' required'}>
            <i style={{ width: percent(t.done, t.total) + '%' }} />
          </div>
          <span>
            <b id="ev-done">{t.done}</b> of {t.total} required done
          </span>
          <span id="ev-save" className="ev-save" role="status">
            {saving}
          </span>
        </div>
        <nav className="ev-secs" aria-label="Sections">
          {form.sections.map((s, i) => {
            const pr = secProgress(s, m);
            const ok = pr.total > 0 && pr.done === pr.total;
            return (
              <button type="button" key={s.id} data-sec={i} aria-current={i === cur ? 'step' : undefined} className={ok ? 'is-done' : ''} onClick={() => go(i)}>
                {ok ? <i aria-hidden="true">{'✓'}</i> : null}
                {s.title}
                {pr.total ? (
                  <small>
                    {pr.done}/{pr.total}
                  </small>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
      <SectionBlock sec={form.sections[cur]} m={m} edit forms={forms} view={view} meName={meName} h={h} />
      <div className="ev-pager">
        {cur > 0 ? (
          <button type="button" className="h-btn h-btn--ghost" data-sec={cur - 1} onClick={() => go(cur - 1)}>
            Back
          </button>
        ) : (
          <span></span>
        )}
        {cur < form.sections.length - 1 ? (
          <button type="button" className="h-btn h-btn--primary" data-sec={cur + 1} onClick={() => go(cur + 1)}>
            Next section
          </button>
        ) : null}
      </div>
      {last ? (
        <section className="ev-panel ev-submit">
          <h2>Before you submit</h2>
          {g.length ? (
            <>
              <p>
                {g.length} thing{g.length === 1 ? '' : 's'} left.
              </p>
              <ul className="ev-gaps">
                {g.slice(0, 12).map((x) => (
                  <li key={x.q.id}>
                    <button type="button" className="ev-link" data-jump={x.si + ':' + x.q.id} onClick={() => jump(x.si, x.q.id)}>
                      {gapLabel(x)}
                    </button>
                  </li>
                ))}
                {g.length > 12 ? <li className="ev-sub">and {g.length - 12} more</li> : null}
              </ul>
            </>
          ) : (
            <p>Everything required is answered. After you submit, Form {formId} is locked{formId === 'A' ? '. Next you name the people who give feedback.' : '.'}</p>
          )}
          <div className="ev-acts">
            <button type="button" className="h-btn h-btn--primary" id="ev-submit" data-form={formId} disabled={g.length > 0 || busy} onClick={() => void submit()}>
              {sure ? 'Yes, submit Form ' + formId : 'Submit Form ' + formId}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export { hasAnswer };
