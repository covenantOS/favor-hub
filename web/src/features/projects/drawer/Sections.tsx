// The sections under the fields in the drawer: description, subtasks, dependencies, files, activity (comments and events) and the
// composer. Same markup and class names as the paint functions in public/js/projects/drawer.js.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { CommentComposer, CommentText, mentionsIn } from '../kit/mention';
import { debounce } from '../kit/overlays';
import { DueTag } from '../kit/rows';
import { RqAvatar } from '../kit/pickers';
import { ago, dueLabel, STATUS } from '../lib/dates';
import { isTmp } from '../lib/store';
import type { Task } from '../types';
import {
  addDep,
  addFileLink,
  addSub,
  commitDesc,
  deleteComment,
  openDrawer,
  openSub,
  registerFlush,
  removeDep,
  removeFile,
  S,
  sendComment,
  toggleSub,
  uploadFiles,
  type DComment,
  type DEvent,
  type Dep,
} from './state';

/* ---------------------------------------------------------------- description */
const SRC_SENTENCE = /^From the meeting [^\n]*?:[ \t]*https?:\/\/\S+[ \t]*\n?/i;
function shortLink(u: string): string {
  try {
    const x = new URL(u);
    const h = x.hostname.replace(/^www\./, '');
    return x.pathname.length > 1 ? h + '/…' : h;
  } catch {
    return u;
  }
}
/** Plain text with each web address drawn as a short link. */
function Linkified({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /https?:\/\/[^\s<]+[^\s<.,;:!?)]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={m[0]} target="_blank" rel="noopener noreferrer" title={m[0]}>
        {shortLink(m[0])}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
const autosize = (ta: HTMLTextAreaElement) => {
  ta.style.height = '0px';
  ta.style.height = ta.scrollHeight + 'px';
};

export function Description({ t }: { t: Task | null }) {
  const [editing, setEditing] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editing;
  const save = useMemo(() => debounce(() => commitDesc(ta.current ? ta.current.value : ''), 900), []);
  const id = t ? t.id : '';

  useEffect(() => {
    setEditing(false);
  }, [id]);
  useEffect(
    () =>
      registerFlush(() => {
        save.cancel();
        if (editingRef.current && ta.current) commitDesc(ta.current.value);
      }),
    [save]
  );
  useEffect(() => () => save.cancel(), [save]);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!editing || !el || !t) return;
    el.value = t.description || '';
    autosize(el);
    el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const raw = (t && t.description) || '';
  const shown = (t && t.source ? raw.replace(SRC_SENTENCE, '') : raw).trim();
  const edit = () => {
    if (t) setEditing(true);
  };
  return (
    <section className="pj-dr__sec">
      <h3 className="rt-h">Description</h3>
      <div
        className="pj-dr__descview"
        tabIndex={0}
        role="button"
        aria-label="Edit description"
        hidden={editing}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('a')) edit();
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            edit();
          }
        }}
      >
        {t ? shown ? <Linkified text={shown} /> : <span className="pj-quiet">Add details</span> : null}
      </div>
      <textarea
        ref={ta}
        className="pj-dr__desc"
        rows={3}
        placeholder="Add details"
        aria-label="Description"
        hidden={!editing}
        onInput={(e) => {
          autosize(e.currentTarget);
          save();
        }}
        onBlur={() => {
          save.cancel();
          if (ta.current) commitDesc(ta.current.value);
          setEditing(false);
        }}
      />
    </section>
  );
}

/* ---------------------------------------------------------------- subtasks */
export function Subtasks({ t }: { t: Task }) {
  const [v, setV] = useState('');
  if (t.parent_id) return <section className="pj-dr__sec" />;
  const done = S.subtasks.filter((s) => s.status === 'done').length;
  return (
    <section className="pj-dr__sec">
      <h3 className="rt-h">
        Subtasks
        {S.subtasks.length ? (
          <>
            {' '}
            <span className="pj-h-n">
              {done}/{S.subtasks.length}
            </span>
          </>
        ) : null}
      </h3>
      <div className="pj-subs">
        {S.subtasks.map((s) => {
          const d = s.status === 'done';
          return (
            <div key={s.id} className={'pj-sub' + (d ? ' is-done' : '') + (s.pending ? ' is-pending' : '')} data-sid={s.id}>
              <button
                type="button"
                className={'pj-check' + (d ? ' is-on' : '')}
                data-a="subdone"
                role="checkbox"
                aria-checked={d}
                aria-label={(d ? 'Mark not done' : 'Mark done') + ': ' + s.title}
                onClick={() => void toggleSub(s.id)}
              >
                <Icon name="check" />
              </button>
              <button type="button" className="pj-sub__t" data-a="subopen" onClick={() => void openSub(s.id)}>
                {s.title}
              </button>
              {s.due_date ? <DueTag t={s} /> : null}
              {s.owner ? <Avatar p={s.owner} /> : null}
            </div>
          );
        })}
      </div>
      <form
        className="pj-add pj-add--sub"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          const title = v.trim();
          if (!title) return;
          setV('');
          void addSub(title);
        }}
      >
        <span className="pj-add__plus">
          <Icon name="plus" />
        </span>
        <input className="pj-add__in" type="text" maxLength={300} placeholder="Add a subtask" aria-label="Add a subtask" enterKeyHint="done" value={v} onChange={(e) => setV(e.target.value)} />
      </form>
    </section>
  );
}

/* ---------------------------------------------------------------- dependencies */
function DepRow({ d, removable }: { d: Dep; removable: boolean }) {
  return (
    <div className="pj-dep">
      <span className={'pj-dep__s ' + (d.status === 'done' ? 'is-done' : '')}>
        <Icon name={d.status === 'done' ? 'check' : 'block'} />
      </span>
      <button type="button" className="pj-dep__t" data-a="depopen" data-ref={d.id || d.code || ''} onClick={() => void depOpen(d.id || d.code || '')}>
        {d.code ? <span className="pj-code-id">{d.code}</span> : null}
        {d.title}
      </button>
      {removable ? (
        <button type="button" className="pj-fclear" data-a="depdel" data-id={d.id} aria-label="Remove this dependency" onClick={() => void removeDep(d.id)}>
          <Icon name="x" />
        </button>
      ) : null}
    </div>
  );
}
const depOpen = (ref: string) => openDrawer(S.main, ref);
export function Dependencies() {
  const by = S.deps.blockedBy || [];
  const bl = S.deps.blocks || [];
  return (
    <section className="pj-dr__sec">
      <h3 className="rt-h">Dependencies</h3>
      {by.length ? (
        <>
          <p className="pj-dep__h">Blocked by</p>
          {by.map((d) => (
            <DepRow key={d.id} d={d} removable />
          ))}
        </>
      ) : null}
      {bl.length ? (
        <>
          <p className="pj-dep__h">Blocking</p>
          {bl.map((d) => (
            <DepRow key={d.id} d={d} removable={false} />
          ))}
        </>
      ) : null}
      <button type="button" className="rt-pchip pj-fbtn is-empty" data-a="depadd" onClick={(e) => void addDep(e.currentTarget)}>
        <Icon name="plus" />
        <span>Add a task this waits on</span>
      </button>
    </section>
  );
}

/* ---------------------------------------------------------------- files */
export function Files() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="pj-dr__sec">
      <h3 className="rt-h">Files</h3>
      {S.files.map((f) => (
        <div key={f.id} className="pj-file">
          <span className="pj-file__i">
            <Icon name={f.kind === 'link' ? 'link' : 'file'} />
          </span>
          {f.url ? (
            <a href={f.url} target="_blank" rel="noopener">
              {f.name}
            </a>
          ) : (
            <span>{f.name}</span>
          )}
          <span className="pj-file__k">{f.kind === 'upload' ? 'File' : f.kind === 'drive' ? 'Drive' : f.kind === 'clip' ? 'Clip' : 'Link'}</span>
          <button type="button" className="pj-fclear" data-a="filedel" data-id={f.id} aria-label={'Remove ' + f.name} onClick={() => void removeFile(f.id)}>
            <Icon name="x" />
          </button>
        </div>
      ))}
      <div className="pj-filebar">
        <button type="button" className="rt-pchip pj-fbtn is-empty" data-a="fileup" onClick={() => input.current?.click()}>
          <Icon name="plus" />
          <span>Upload a file</span>
        </button>
        <button type="button" className="rt-pchip pj-fbtn is-empty" data-a="filelink" onClick={() => void addFileLink()}>
          <Icon name="link" />
          <span>Add a link</span>
        </button>
        <input
          ref={input}
          type="file"
          hidden
          data-fileinput=""
          multiple
          onChange={(e) => {
            const el = e.currentTarget;
            const list = el.files ? [...el.files] : [];
            if (list.length) void uploadFiles(list).then(() => { el.value = ''; });
          }}
        />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- activity */
function eventText(e: DEvent): ReactNode {
  let d: Record<string, unknown> = {};
  const raw = e.detail;
  if (typeof raw === 'string') {
    try {
      d = JSON.parse(raw) || {};
    } catch {
      d = {};
    }
  } else if (raw && typeof raw === 'object') d = raw as Record<string, unknown>;
  const who = S.staff.nameOf(e.actor_email) || 'Someone';
  const to = d.to as string | undefined;
  switch (e.kind) {
    case 'created':
      return `${who} made this task`;
    case 'done':
      return `${who} completed this`;
    case 'reopened':
      return `${who} reopened this`;
    case 'status':
      return `${who} set the status to ${STATUS[to || ''] || to || ''}`;
    case 'owner':
      return to ? (
        <>
          {who} assigned it to <b>{S.staff.nameOf(to)}</b>
        </>
      ) : (
        `${who} removed the owner`
      );
    case 'due':
      return to ? `${who} set ${d.field === 'start_date' ? 'the start' : 'the due date'} to ${dueLabel(to)}` : `${who} cleared ${d.field === 'start_date' ? 'the start date' : 'the due date'}`;
    case 'move':
      return `${who} moved it${d.section_id ? '' : ' out of its section'}`;
    case 'file':
      return `${who} attached ${(d.name as string) || 'a file'}`;
    case 'dep':
      return `${who} changed what this waits on`;
    case 'edit': {
      const f = ({ title: 'the title', priority: 'the priority', description: 'the description', appeal_code: 'the appeal code', source_code: 'the source code', fund_code: 'the fund code', campaign_code: 'the campaign code', waiting_on_email: 'who it waits on' } as Record<string, string>)[d.field as string];
      return `${who} changed ${f || 'a detail'}`;
    }
    default:
      return `${who} · ${e.kind}`;
  }
}

type Item = { at: string; c?: DComment; e?: DEvent };

export function Activity() {
  const me = S.staff.me;
  const items: Item[] = [];
  for (const c of S.comments) if (!c.deleted_at) items.push({ at: c.created_at, c });
  for (const e of S.events) if (!['mention', 'comment'].includes(e.kind)) items.push({ at: e.created_at, e });
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.e ? -1 : 1));
  let prev: DComment | null = null;
  const rows = items.map((it, i) => {
    if (it.e) {
      prev = null;
      return (
        <div key={'e' + i} className="rt-event">
          <span>{eventText(it.e)}</span>
          <time>{ago(it.e.created_at)}</time>
        </div>
      );
    }
    const c = it.c as DComment;
    const cont = !!(prev && prev.author_email === c.author_email && Date.parse(c.created_at) - Date.parse(prev.created_at) < 5 * 60000);
    prev = c;
    const tmp = isTmp(c.id);
    const p = S.staff.personOf(c.author_email);
    return (
      <article key={c.id} className={'ch-msg' + (cont ? ' ch-msg--cont' : '') + (tmp ? ' is-pending' : '')} data-cid={c.id}>
        <div className="ch-msg__gut">{cont || !p ? null : <RqAvatar p={p} />}</div>
        <div className="ch-msg__body">
          {cont ? null : (
            <div className="ch-msg__meta">
              <span className="ch-msg__name">{S.staff.nameOf(c.author_email)}</span>
              {c.source === 'chat' ? <span className="ch-tag rt-tag">Chat</span> : null}
              <span className="ch-msg__time">{ago(c.created_at)}</span>
            </div>
          )}
          <div className="ch-msg__text">
            <CommentText body={c.body} me={me} />
          </div>
        </div>
        {c.author_email === me && !tmp ? (
          <div className="ch-bar" role="toolbar" aria-label="Comment actions">
            <button type="button" data-a="cdel" data-id={c.id} aria-label="Delete" onClick={() => void deleteComment(c.id)}>
              <Icon name="trash" />
            </button>
          </div>
        ) : null}
      </article>
    );
  });
  return (
    <section className="pj-dr__sec">
      <h3 className="rt-h">Activity</h3>
      <div className="rt-activity rt-ch" data-activity="" aria-live="polite">
        {rows.length ? <Fragment>{rows}</Fragment> : <p className="pj-quiet">No activity yet.</p>}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- composer */
export function Composer({ scrollDown }: { scrollDown: () => void }) {
  return (
    <CommentComposer
      onSend={(text) => sendComment(text, mentionsIn(text), scrollDown)}
    />
  );
}
