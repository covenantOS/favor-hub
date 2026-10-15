// The quick switcher: Ctrl or Cmd + K on a Projects page. Type to jump to a project, or to find a task by title or code.
// Ported from public/js/projects/switcher.js.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { dueLabel } from '../lib/dates';
import { goto, projectHref } from '../lib/url';
import type { Project, Task } from '../types';
import { Icon } from '../kit/Icon';
import { debounce, openSheet, type SheetHandle } from '../kit/overlays';

let listP: Promise<Project[]> | null = null;
/** Every project the person can see, read once per page load. */
export const projectList = (): Promise<Project[]> => {
  if (!listP)
    listP = api
      .projects()
      .then((d) => d.projects || [])
      .catch((e) => {
        listP = null;
        throw e;
      });
  return listP;
};

interface Entry {
  kind: 'project' | 'task';
  label: string;
  sub: string;
  href?: string;
  ref?: string;
  projectKey?: string;
  dot?: string;
  ic?: string;
  done?: boolean;
}

function SwitcherBody({ opts, sheet }: { opts: SwitcherOpts; sheet: SheetHandle }) {
  const [q, setQ] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hi, setHi] = useState(0);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    projectList()
      .then(setProjects)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const search = useMemo(
    () =>
      debounce(async (v: string) => {
        const mine = ++seq.current;
        if (v.length < 2) {
          setTasks([]);
          return;
        }
        try {
          const d = await api.tasks({ q: v, status: 'all', limit: 8 });
          if (mine === seq.current) setTasks(d.tasks || []);
        } catch {
          if (mine === seq.current) setTasks([]);
        }
      }, 180),
    []
  );
  useEffect(() => () => search.cancel(), [search]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const entries: Entry[] = [];
  if (!words.length || 'my tasks'.includes(words.join(' '))) entries.push({ kind: 'project', label: 'My tasks', sub: '', href: '/projects/?tab=mine', ic: 'check' });
  for (const p of projects.filter((p) => p.status === 'active' && words.every((w) => (p.name + ' ' + p.key).toLowerCase().includes(w))).slice(0, 8)) {
    entries.push({ kind: 'project', label: p.name, sub: p.key, href: projectHref(p.key), dot: p.color });
  }
  for (const t of tasks) {
    entries.push({ kind: 'task', label: t.title, sub: [t.code, t.project ? t.project.name : 'Personal', t.due_date ? dueLabel(t.due_date, t.due_time) : ''].filter(Boolean).join(' · '), ref: t.code || t.id, projectKey: t.project ? t.project.key : '', done: t.status === 'done' });
  }
  const cur = Math.min(hi, Math.max(0, entries.length - 1));

  const go = (en: Entry | undefined) => {
    if (!en) return;
    sheet.close();
    if (en.kind === 'project') {
      goto(en.href as string);
      return;
    }
    const same = opts.projectKey && en.projectKey && en.projectKey.toUpperCase() === opts.projectKey.toUpperCase();
    if (same || (!en.projectKey && opts.open)) {
      opts.open?.(en.ref as string);
      return;
    }
    goto(en.projectKey ? projectHref(en.projectKey, '&t=' + encodeURIComponent(en.ref as string)) : '/projects/?t=' + encodeURIComponent(en.ref as string));
  };
  const firstTask = entries.findIndex((x) => x.kind === 'task');
  return (
    <>
      <label className="pj-sw__in">
        <Icon name="search" />
        <input
          ref={input}
          type="text"
          placeholder="Jump to a project or task"
          aria-label="Jump to a project or task"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
            search(e.target.value.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (entries.length) setHi((cur + (e.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(entries[cur]);
            }
          }}
        />
      </label>
      <div className="pj-sw__list" role="listbox">
        {entries.length ? (
          entries.map((en, i) => (
            <Fragment key={i}>
              {i === 0 && en.kind === 'project' ? <div className="pj-sw__h">Projects</div> : null}
              {i === firstTask ? <div className="pj-sw__h">Tasks</div> : null}
              <button
                type="button"
                className={'pj-sw__r' + (i === cur ? ' is-hi' : '')}
                role="option"
                aria-selected={i === cur}
                ref={(el) => {
                  if (el && i === cur) el.scrollIntoView({ block: 'nearest' });
                }}
                onClick={() => go(en)}
              >
                {en.dot ? <i className="pj-dot" data-c={en.dot} /> : <Icon name={en.ic || (en.kind === 'task' ? 'list' : 'board')} />}
                <span className={'pj-sw__t' + (en.done ? ' is-done' : '')}>{en.label}</span>
                <span className="pj-sw__s">{en.sub}</span>
              </button>
            </Fragment>
          ))
        ) : (
          <p className="pj-none">{words.length || loaded ? 'Nothing matches' : 'Loading'}</p>
        )}
      </div>
    </>
  );
}

interface SwitcherOpts {
  projectKey?: string;
  open?: (ref: string) => void;
}
let current: SheetHandle | null = null;
export function openSwitcher(opts: SwitcherOpts = {}) {
  if (current) {
    current.close();
    return;
  }
  current = openSheet({
    hideHead: true,
    cls: 'pj-sheet--switch',
    label: 'Jump to a project or task',
    render: (s) => <SwitcherBody opts={opts} sheet={s} />,
    onClose: () => {
      current = null;
    },
  });
}
