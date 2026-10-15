// Learn > Manage > Edit course (/learn/admin/course/?c=): details, lessons in order (drag and drop, or the arrows), and a search across the
// help library, your Clips and Drive to add lessons (port of src/pages/learn/admin/course.astro and the editor half of public/js/learn-admin.js).
import { Suspense, useEffect, useRef, useState, type DragEvent } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import '@hub/styles/learn.css';
import '@hub/styles/lint-fix.css';
import { sendJson } from './api';
import {
  COLORS,
  STATUS,
  blankQuestion,
  blankQuiz,
  changeKind,
  cleanQuizForSave,
  cloneQuiz,
  dropOrder,
  helpHits,
  lessonMeta,
  mins,
  plural,
  removeOption,
  reorderLessons,
  swapOrder,
  urlLessonBody,
  type Course,
  type Lesson,
  type Quiz,
} from './logic';
import { clipsQuery, courseQuery, driveQuery, helpQuery, laKeys } from './queries';
import { Dialog, DialogError, FailView, Frame, PageSkeleton, StatusChip, Svg, toast, useConfirm } from './ui';

export function EditorPage({ id }: { id: string }) {
  return (
    <Frame view="editor">
      <Suspense
        fallback={
          <div aria-busy="true" style={{ display: 'contents' }}>
            <PageSkeleton title="Edit course" />
          </div>
        }
      >
        <Loaded id={id} />
      </Suspense>
    </Frame>
  );
}

function Loaded({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(courseQuery(id));
  // The address names no course (or an old link lost it): back to Manage, as the Astro page did.
  useEffect(() => {
    if (!id) void navigate({ to: '/learn/admin/' });
  }, [id, navigate]);
  if (!id) return <PageSkeleton title="Edit course" />;
  if (data.state === 'fail') return <FailView status={data.status} message={data.message} />;
  return <Editor key={data.data.id} initial={data.data} />;
}

type Dlg = { kind: 'page'; lesson: Lesson | null } | { kind: 'quiz'; lesson: Lesson | null } | { kind: 'url' } | { kind: 'edit'; lesson: Lesson } | null;

function Editor({ initial }: { initial: Course }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [course, setCourseState] = useState<Course>(initial);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [adding, setAdding] = useState(false);
  const { confirm, node } = useConfirm();

  // Every answer from the server replaces the course here and in the cache, so Back and a second visit show what was saved.
  const setCourse = (c: Course) => {
    setCourseState(c);
    qc.setQueryData(laKeys.course(c.id), { state: 'ok', data: c });
    qc.setQueryData(laKeys.course(c.slug), { state: 'ok', data: c });
    void qc.invalidateQueries({ queryKey: laKeys.overview });
  };

  useEffect(() => {
    document.title = `${course.title} - Edit course - FavorOS`;
  }, [course.title]);

  const addLesson = async (body: Record<string, unknown>): Promise<Lesson | null> => {
    try {
      const r = await sendJson(`/api/learn/admin/course/${course.id}/lessons`, 'POST', body);
      setCourse(r.course as Course);
      const lesson = r.lesson as Lesson;
      toast('Added ' + lesson.title);
      return lesson;
    } catch (e) {
      toast((e as Error).message);
      return null;
    }
  };

  const remove = async () => {
    const used = course.completions || course.open_assignments;
    if (!(await confirm({ title: used ? 'Archive this course?' : 'Delete this course?', text: used ? 'People have records on it, so it is archived. They keep their certificates.' : 'It has no records, so it is deleted for good.', ok: used ? 'Archive' : 'Delete', danger: true }))) return;
    try {
      await sendJson('/api/learn/admin/course/' + encodeURIComponent(course.id), 'DELETE');
      void qc.invalidateQueries({ queryKey: laKeys.overview });
      qc.removeQueries({ queryKey: laKeys.course(course.id) });
      void navigate({ to: '/learn/admin/' });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <>
      <nav className="ln-crumb" aria-label="Where you are">
        <Link to="/learn/admin/">Manage learning</Link>
        <i>/</i>
        <span>{course.title}</span>
      </nav>
      <div className="ln-head">
        <div>
          <h1>{course.title}</h1>
          <p>
            <StatusChip status={course.status} /> {plural(course.lessons.length, 'lesson')}
            {course.completions ? ' · ' + plural(course.completions, 'completion') : ''}
            {course.open_assignments ? ' · ' + plural(course.open_assignments, 'open assignment') : ''}
          </p>
        </div>
        <div className="ln-head__acts">
          <a className="h-btn h-btn--ghost" href={'/learn/c/?c=' + encodeURIComponent(course.slug)} target="_blank" rel="noopener">
            Preview
          </a>
          <Link className="h-btn h-btn--ghost" to="/learn/admin/" search={{ tab: 'assign', course: course.id }}>
            Assign
          </Link>
        </div>
      </div>
      <Details course={course} onSaved={setCourse} />
      <section className="ln-sec" aria-label="Lessons">
        <h2>
          Lessons <em>{course.lessons.length}</em>
        </h2>
        <Lessons course={course} setCourse={setCourse} onEdit={(l) => setDlg(l.kind === 'page' ? { kind: 'page', lesson: l } : l.kind === 'quiz' ? { kind: 'quiz', lesson: l } : { kind: 'edit', lesson: l })} confirm={confirm} />
        <div>
          <button type="button" className="h-btn h-btn--primary" id="ed-add" onClick={() => setAdding((v) => !v)}>
            <Svg n="plus" className="h-i" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2.2, marginRight: 6 }} />
            Add a lesson
          </button>
        </div>
        <div id="ed-addpanel">
          {adding ? (
            <AddPanel
              course={course}
              addLesson={addLesson}
              onNew={(k) => setDlg(k === 'page' ? { kind: 'page', lesson: null } : k === 'quiz' ? { kind: 'quiz', lesson: null } : { kind: 'url' })}
              onClipAdded={(l) => setDlg({ kind: 'edit', lesson: l })}
            />
          ) : null}
        </div>
      </section>
      <section className="ln-sec">
        <h2>Remove</h2>
        <div>
          <button type="button" className="h-btn h-btn--ghost" id="ed-del" onClick={() => void remove()}>
            {course.completions || course.open_assignments ? 'Archive this course' : 'Delete this course'}
          </button>
        </div>
      </section>
      {dlg && dlg.kind === 'url' ? <UrlDialog course={course} onDone={setCourse} onClose={() => setDlg(null)} /> : null}
      {dlg && dlg.kind === 'page' ? <PageDialog course={course} lesson={dlg.lesson} onDone={setCourse} onClose={() => setDlg(null)} /> : null}
      {dlg && dlg.kind === 'quiz' ? <QuizDialog course={course} lesson={dlg.lesson} onDone={setCourse} onClose={() => setDlg(null)} /> : null}
      {dlg && dlg.kind === 'edit' ? <EditDialog lesson={dlg.lesson} onDone={setCourse} onClose={() => setDlg(null)} /> : null}
      {node}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ details */

function Details({ course, onSaved }: { course: Course; onSaved: (c: Course) => void }) {
  const [f, setF] = useState({ title: course.title, audience: course.audience, summary: course.summary, status: course.status as string, color: course.color });
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean }>({ text: '', err: false });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...p }));
    setDirty(true);
    setMsg({ text: '', err: false });
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await sendJson('/api/learn/admin/course/' + encodeURIComponent(course.id), 'PATCH', { title: f.title, summary: f.summary, audience: f.audience, status: f.status, color: f.color });
      onSaved(r.course as Course);
      setDirty(false);
      setMsg({ text: 'Saved', err: false });
    } catch (e) {
      setMsg({ text: (e as Error).message, err: true });
      setDirty(true);
    }
    setBusy(false);
  };
  return (
    <form
      className="ln-card la-form"
      id="ed-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="la-fields">
        <label className="la-f">
          <span>Name</span>
          <input name="title" maxLength={120} value={f.title} autoComplete="off" onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="la-f">
          <span>Who it is for</span>
          <input name="audience" maxLength={80} value={f.audience} autoComplete="off" onChange={(e) => set({ audience: e.target.value })} />
        </label>
        <label className="la-f wide">
          <span>Summary</span>
          <textarea name="summary" maxLength={400} style={{ minHeight: 84 }} value={f.summary} onChange={(e) => set({ summary: e.target.value })} />
        </label>
        <div className="la-f">
          <span>Color</span>
          <div className="la-colors" id="ed-col">
            {COLORS.map((x) => (
              <button key={x} type="button" className={'ln-c--' + x} data-c={x} aria-label={x} aria-pressed={x === f.color} onClick={() => set({ color: x })}>
                <Svg n="check" />
              </button>
            ))}
          </div>
        </div>
        <label className="la-f">
          <span>Status</span>
          <select name="status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="la-save">
        <button type="submit" className="h-btn h-btn--primary" id="ed-save" disabled={!dirty || busy}>
          Save details
        </button>
        <small id="ed-msg" role="status" className={msg.err ? 'err' : ''}>
          {msg.text}
        </small>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------ lessons */

function Lessons({ course, setCourse, onEdit, confirm }: { course: Course; setCourse: (c: Course) => void; onEdit: (l: Lesson) => void; confirm: ReturnType<typeof useConfirm>['confirm'] }) {
  const ls = course.lessons;
  const [drag, setDrag] = useState(-1);
  const [over, setOver] = useState(-1);
  const focusRef = useRef('');
  const box = useRef<HTMLDivElement>(null);

  // After an arrow press the focus follows the moved lesson's same arrow, as on the Astro page.
  useEffect(() => {
    if (!focusRef.current || !box.current) return;
    const nb = box.current.querySelector<HTMLButtonElement>(focusRef.current);
    focusRef.current = '';
    if (nb && !nb.disabled) nb.focus();
  }, [ls]);

  const saveOrder = async (ids: string[], focus = '') => {
    const before = course;
    // The list moves at once; the server's answer replaces it, and a refusal puts the old order back.
    setCourse({ ...course, lessons: reorderLessons(course.lessons, ids) });
    if (focus) focusRef.current = focus;
    try {
      const r = await sendJson(`/api/learn/admin/course/${course.id}/order`, 'PUT', { ids });
      setCourse(r.course as Course);
    } catch (e) {
      toast((e as Error).message);
      setCourse(before);
    }
  };
  const move = (i: number, j: number) => {
    const ids = swapOrder(
      ls.map((l) => l.id),
      i,
      j
    );
    void saveOrder(ids, `[data-${j < i ? 'up' : 'dn'}="${j}"]`);
  };
  const del = async (l: Lesson) => {
    if (!(await confirm({ title: 'Remove this lesson?', text: `${l.title} comes out of the course. Progress people made on it is removed too.`, ok: 'Remove', danger: true }))) return;
    try {
      setCourse((await sendJson('/api/learn/admin/lesson/' + encodeURIComponent(l.id), 'DELETE')).course as Course);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const end = () => {
    setDrag(-1);
    setOver(-1);
  };
  const onDragStart = (e: DragEvent, i: number, id: string) => {
    setDrag(i);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {
      // Safari needs data
    }
  };
  const onDrop = (e: DragEvent, to: number) => {
    if (drag < 0) return;
    e.preventDefault();
    const ids = dropOrder(
      ls.map((l) => l.id),
      drag,
      to
    );
    end();
    void saveOrder(ids);
  };

  return (
    <div className="ln-card la-less" id="ed-less" ref={box}>
      {ls.length ? (
        ls.map((l, i) => (
          <div
            key={l.id}
            className={'la-l' + (drag === i ? ' is-drag' : '') + (over === i && drag !== i ? ' is-over' : '')}
            draggable
            data-i={i}
            data-id={l.id}
            onDragStart={(e) => onDragStart(e, i, l.id)}
            onDragOver={(e) => {
              if (drag < 0) return;
              e.preventDefault();
              if (over !== i) setOver(i);
            }}
            onDragEnd={end}
            onDrop={(e) => onDrop(e, i)}
          >
            <span className="la-grip" aria-hidden="true">
              <Svg n="grip" />
            </span>
            <span className="ln-tile ln-tile--sm" style={{ background: 'var(--r-sunk)', color: 'var(--r-ink-2)' }}>
              <Svg n={l.kind} />
            </span>
            <span className="la-l__t">
              <b>{l.title}</b>
              <span>{lessonMeta(l)}</span>
            </span>
            <span className="la-l__m">{l.minutes ? mins(l.minutes) : ''}</span>
            <span className="la-mini">
              <button type="button" className="la-ib" data-up={i} aria-label={`Move ${l.title} up`} disabled={!i} onClick={() => move(i, i - 1)}>
                <Svg n="up" />
              </button>
              <button type="button" className="la-ib" data-dn={i} aria-label={`Move ${l.title} down`} disabled={i >= ls.length - 1} onClick={() => move(i, i + 1)}>
                <Svg n="down" />
              </button>
              <button type="button" className="la-ib" data-edit={l.id} aria-label={`Edit ${l.title}`} onClick={() => onEdit(l)}>
                <Svg n="edit" />
              </button>
              <button type="button" className="la-ib la-ib--x" data-del={l.id} aria-label={`Remove ${l.title}`} onClick={() => void del(l)}>
                <Svg n="x" />
              </button>
            </span>
          </div>
        ))
      ) : (
        <p className="ln-sum" style={{ padding: 16, margin: 0 }}>
          No lessons yet. Add a video, an article, a Google Doc, a clip, a written page or a quiz.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ adding a lesson */

interface Hit {
  kind: string;
  ref: string;
  title: string;
  summary?: string;
  sub?: string;
}

function AddPanel({ course, addLesson, onNew, onClipAdded }: { course: Course; addLesson: (b: Record<string, unknown>) => Promise<Lesson | null>; onNew: (k: 'page' | 'quiz' | 'url') => void; onClipAdded: (l: Lesson) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim().toLowerCase()), 280);
    return () => clearTimeout(t);
  }, [text]);

  const help = useQuery(helpQuery);
  const clips = useQuery(clipsQuery(q));
  const drive = useQuery({ ...driveQuery(q), enabled: q.length >= 2 });
  const items = help.data || [];
  const hv = helpHits(items, q, 'video');
  const ha = helpHits(items, q, 'article');
  const inCourse = new Set(course.lessons.map((l) => l.kind + ':' + l.ref));
  const mineLoaded = clips.data !== undefined && (q.length < 2 || drive.data !== undefined);
  const parts: { title: string; hits: Hit[] }[] = [];
  if (hv.length) parts.push({ title: 'Help videos', hits: hv });
  if (ha.length) parts.push({ title: 'Help articles', hits: ha });
  if (clips.data && clips.data.length) parts.push({ title: 'Your clips', hits: clips.data.map((c) => ({ kind: 'clip', ref: c.id, title: c.title || 'Untitled clip', summary: c.summary || '' })) });
  if (q.length >= 2 && drive.data && drive.data.length) parts.push({ title: 'Drive', hits: drive.data.map((f) => ({ kind: 'doc', ref: f.url, title: f.name, sub: f.path || '' })) });

  const add = async (h: Hit) => {
    const key = h.kind + ':' + h.ref;
    const l = await addLesson({ kind: h.kind, ref: h.ref, title: h.title });
    if (l) setAdded((s) => new Set(s).add(key));
  };

  /** Opens the recorder in the page header; the clip becomes a lesson when it saves. */
  const record = () => {
    const cam = document.getElementById('clip-cam');
    if (!cam || cam.hasAttribute('hidden')) {
      toast('The recorder is not available on this page.');
      return;
    }
    toast('Record your clip. It is added to this course when you stop.');
    const once = async (ev: Event) => {
      const id = (ev as CustomEvent).detail && (ev as CustomEvent).detail.id;
      if (!id) return;
      window.removeEventListener('clips:changed', once);
      for (let i = 0; i < 6; i++) {
        const l = await addLesson({ kind: 'clip', ref: id });
        if (l) {
          onClipAdded(l);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    window.addEventListener('clips:changed', once);
    cam.click();
  };

  const hit = (h: Hit) => {
    const was = inCourse.has(h.kind + ':' + h.ref);
    const done = added.has(h.kind + ':' + h.ref) && was;
    return (
      <div key={h.kind + ':' + h.ref} className={'la-hit' + (was && !done ? ' is-in' : was ? ' is-in' : '')}>
        <span className="ln-tile ln-tile--sm" style={{ background: 'var(--r-sunk)', color: 'var(--r-ink-2)' }}>
          <Svg n={h.kind} />
        </span>
        <div>
          <b>{h.title}</b>
          <span>{h.summary || h.sub || ''}</span>
        </div>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => void add(h)}>
          {done ? 'Added' : was ? 'Add again' : 'Add'}
        </button>
      </div>
    );
  };

  return (
    <div className="ln-card la-add">
      <h2>Add a lesson</h2>
      <label className="ln-search" style={{ maxWidth: 'none' }}>
        <Svg n="search" />
        <span className="ln-sr">Search</span>
        <input id="ad-q" ref={input} type="search" placeholder="Search the help library, your Clips and Drive" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="la-kinds">
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-new="page" onClick={() => onNew('page')}>
          Written page
        </button>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-new="quiz" onClick={() => onNew('quiz')}>
          Quiz
        </button>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-new="url" onClick={() => onNew('url')}>
          Google Doc, Drive file or link
        </button>
        <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-new="record" onClick={record}>
          <Svg n="cam" className="h-i" style={{ width: 15, height: 15, stroke: 'currentColor', fill: 'none', strokeWidth: 2, marginRight: 6 }} />
          Record a clip
        </button>
      </div>
      <div className="la-res" id="ad-res" aria-live="polite">
        {parts.map((p) => (
          <div key={p.title} style={{ display: 'contents' }}>
            <h3>{p.title}</h3>
            {p.hits.map(hit)}
          </div>
        ))}
        {!parts.length ? <p className="ln-sum">{help.data === undefined || !mineLoaded ? '' : 'Nothing matches.'}</p> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ dialogs */

function Actions({ ok, onClose }: { ok: string; onClose: () => void }) {
  return (
    <div className="ln-dlg__acts">
      <button type="button" className="h-btn h-btn--ghost" data-no="" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="h-btn h-btn--primary">
        {ok}
      </button>
    </div>
  );
}

function UrlDialog({ course, onDone, onClose }: { course: Course; onDone: (c: Course) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    try {
      const r = await sendJson(`/api/learn/admin/course/${course.id}/lessons`, 'POST', urlLessonBody(url, title));
      onDone(r.course as Course);
      toast('Added ' + (r.lesson as Lesson).title);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog onClose={onClose} label="Google Doc, Drive file or link">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>Google Doc, Drive file or link</h2>
        <label className="la-f">
          <span>Address</span>
          <input id="u-url" type="url" placeholder="https://" required autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus="" />
        </label>
        <label className="la-f">
          <span>Name</span>
          <input id="u-t" maxLength={160} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <DialogError id="u-e" text={err} />
        <Actions ok="Add lesson" onClose={onClose} />
      </form>
    </Dialog>
  );
}

function PageDialog({ course, lesson, onDone, onClose }: { course: Course; lesson: Lesson | null; onDone: (c: Course) => void; onClose: () => void }) {
  const [title, setTitle] = useState(lesson ? lesson.title : '');
  const [body, setBody] = useState(lesson ? lesson.body : '');
  const [err, setErr] = useState('');
  const submit = async () => {
    try {
      const r = lesson ? await sendJson('/api/learn/admin/lesson/' + encodeURIComponent(lesson.id), 'PATCH', { title, body }) : await sendJson(`/api/learn/admin/course/${course.id}/lessons`, 'POST', { kind: 'page', title, body });
      onDone(r.course as Course);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog cls="ln-dlg--wide" onClose={onClose} label={lesson ? 'Edit written page' : 'Written page'}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{lesson ? 'Edit written page' : 'Written page'}</h2>
        <label className="la-f">
          <span>Name</span>
          <input id="p-t" maxLength={160} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} data-autofocus="" />
        </label>
        <label className="la-f">
          <span>Text</span>
          <textarea id="p-b" className="tall" maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} />
          <small>## Heading, - bullet, 1. numbered, **bold**, [text](https://address)</small>
        </label>
        <DialogError id="p-e" text={err} />
        <Actions ok={lesson ? 'Save' : 'Add lesson'} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function EditDialog({ lesson, onDone, onClose }: { lesson: Lesson; onDone: (c: Course) => void; onClose: () => void }) {
  const refEditable = lesson.kind === 'doc' || lesson.kind === 'link';
  const [title, setTitle] = useState(lesson.title);
  const [ref, setRef] = useState(lesson.ref);
  const [minutes, setMinutes] = useState(lesson.minutes ? String(lesson.minutes) : '');
  const [err, setErr] = useState('');
  const submit = async () => {
    const body: Record<string, unknown> = { title, minutes: +minutes || 0 };
    if (refEditable) body.ref = ref;
    try {
      onDone((await sendJson('/api/learn/admin/lesson/' + encodeURIComponent(lesson.id), 'PATCH', body)).course as Course);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Dialog onClose={onClose} label="Edit lesson">
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>Edit lesson</h2>
        <label className="la-f">
          <span>Name</span>
          <input id="e-t" maxLength={160} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} data-autofocus="" />
        </label>
        {refEditable ? (
          <label className="la-f">
            <span>Address</span>
            <input id="e-r" type="url" value={ref} autoComplete="off" onChange={(e) => setRef(e.target.value)} />
          </label>
        ) : null}
        <label className="la-f">
          <span>Minutes</span>
          <input id="e-m" type="number" inputMode="numeric" min={1} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
        <DialogError id="e-e" text={err} />
        <Actions ok="Save" onClose={onClose} />
      </form>
    </Dialog>
  );
}

function QuizDialog({ course, lesson, onDone, onClose }: { course: Course; lesson: Lesson | null; onDone: (c: Course) => void; onClose: () => void }) {
  const [quiz, setQuiz] = useState<Quiz>(() => (lesson && lesson.quiz ? cloneQuiz(lesson.quiz) : blankQuiz()));
  const [title, setTitle] = useState(lesson ? lesson.title : 'Check what you learned');
  const [pass, setPass] = useState(String((lesson && lesson.quiz ? lesson.quiz.pass : 80) || 80));
  const [err, setErr] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!focusLast.current || !list.current) return;
    focusLast.current = false;
    const all = list.current.querySelectorAll<HTMLInputElement>('[data-t]');
    all[all.length - 1]?.focus();
  }, [quiz.questions.length]);

  const setQ = (i: number, p: Partial<Quiz['questions'][number]>) => setQuiz((z) => ({ ...z, questions: z.questions.map((x, k) => (k === i ? { ...x, ...p } : x)) }));
  const submit = async () => {
    const cleaned = cleanQuizForSave(quiz, pass);
    const body = { title, quiz: cleaned };
    try {
      const r = lesson ? await sendJson('/api/learn/admin/lesson/' + encodeURIComponent(lesson.id), 'PATCH', body) : await sendJson(`/api/learn/admin/course/${course.id}/lessons`, 'POST', { kind: 'quiz', ...body });
      onDone(r.course as Course);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const n = quiz.questions.length;
  return (
    <Dialog cls="ln-dlg--wide" onClose={onClose} label={lesson ? 'Edit quiz' : 'Quiz'}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{lesson ? 'Edit quiz' : 'Quiz'}</h2>
        <div className="la-fields">
          <label className="la-f wide">
            <span>Name</span>
            <input id="q-t" maxLength={160} value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} data-autofocus="" />
          </label>
          <label className="la-f">
            <span>Pass mark, percent</span>
            <input id="q-p" type="number" inputMode="numeric" min={1} max={100} value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
        </div>
        <div className="la-qs" id="q-list" ref={list}>
          {quiz.questions.map((x, i) => (
            <fieldset key={i} className="la-q" data-i={i}>
              <div className="la-q__h">
                <b>Question {i + 1}</b>
                <span className="la-mini">
                  <select data-k="" aria-label="Type of question" className="la-in" style={{ width: 'auto', minHeight: 40 }} value={x.kind} onChange={(e) => setQuiz((z) => ({ ...z, questions: z.questions.map((y, k) => (k === i ? changeKind(y, e.target.value as 'choice' | 'tf') : y)) }))}>
                    <option value="choice">Multiple choice</option>
                    <option value="tf">True or false</option>
                  </select>
                  <button type="button" className="la-ib" data-qup={i} aria-label="Move question up" disabled={!i} onClick={() => setQuiz((z) => ({ ...z, questions: swapOrder(z.questions, i, i - 1) }))}>
                    <Svg n="up" />
                  </button>
                  <button type="button" className="la-ib" data-qdn={i} aria-label="Move question down" disabled={i >= n - 1} onClick={() => setQuiz((z) => ({ ...z, questions: swapOrder(z.questions, i, i + 1) }))}>
                    <Svg n="down" />
                  </button>
                  <button type="button" className="la-ib la-ib--x" data-qrm={i} aria-label="Remove question" disabled={n <= 1} onClick={() => setQuiz((z) => ({ ...z, questions: z.questions.filter((_, k) => k !== i) }))}>
                    <Svg n="x" />
                  </button>
                </span>
              </div>
              <input className="la-in" data-t="" placeholder="Question" value={x.text} maxLength={400} aria-label={`Question ${i + 1}`} onChange={(e) => setQ(i, { text: e.target.value })} />
              {(x.kind === 'tf' ? ['True', 'False'] : x.options).map((o, j) => (
                <div className="la-o" key={j}>
                  <input type="radio" name={'ans' + i} value={j} checked={x.answer === j} aria-label={`Right answer ${j + 1}`} onChange={() => setQ(i, { answer: j })} />
                  {x.kind === 'tf' ? (
                    <>
                      <span style={{ padding: '0 4px' }}>{o}</span>
                      <span />
                    </>
                  ) : (
                    <>
                      <input type="text" className="la-in" data-o={j} value={o} placeholder={`Answer ${j + 1}`} maxLength={240} aria-label={`Answer ${j + 1}`} onChange={(e) => setQ(i, { options: x.options.map((v, k) => (k === j ? e.target.value : v)) })} />
                      <button type="button" className="la-ib la-ib--x" data-orm={i + ':' + j} aria-label="Remove answer" disabled={x.options.length <= 2} onClick={() => setQuiz((z) => ({ ...z, questions: z.questions.map((y, k) => (k === i ? removeOption(y, j) : y)) }))}>
                        <Svg n="x" />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {x.kind === 'choice' && x.options.length < 6 ? (
                <div>
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-oadd={i} onClick={() => setQ(i, { options: [...x.options, ''] })}>
                    Add an answer
                  </button>
                </div>
              ) : null}
              <input className="la-in" data-e="" placeholder="Why it is right (shown after an attempt)" value={x.explain} maxLength={500} aria-label={`Explanation ${i + 1}`} onChange={(e) => setQ(i, { explain: e.target.value })} />
            </fieldset>
          ))}
        </div>
        <div>
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            id="q-add"
            onClick={() => {
              focusLast.current = true;
              setQuiz((z) => ({ ...z, questions: [...z.questions, blankQuestion(z.questions.length + 1)] }));
            }}
          >
            Add a question
          </button>
        </div>
        <DialogError id="q-e" text={err} />
        <Actions ok={lesson ? 'Save' : 'Add lesson'} onClose={onClose} />
      </form>
    </Dialog>
  );
}

