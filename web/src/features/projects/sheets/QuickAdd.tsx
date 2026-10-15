// Quick add: Tab then Q anywhere on a projects page, or the Add task button. Type a title, Enter adds it. Ctrl or Cmd with Enter adds
// it and leaves the box open for the next one. Ported from public/js/projects/quick-add.js.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { dueLabel } from '../lib/dates';
import { getActiveStaff } from '../lib/staff';
import type { TaskCtx } from '../lib/store';
import type { Project } from '../types';
import { goto, projectHref } from '../lib/url';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { choose, openSheet } from '../kit/overlays';
import { CODE_KINDS, pickCode, pickDate, pickOwner, pickSection } from '../kit/pickers';
import { toast } from '../kit/toast';
import type { QuickAddDefaults } from '../lib/page';

let projectsP: Promise<Project[]> | null = null;
const projectsList = (): Promise<Project[]> => {
  if (!projectsP)
    projectsP = api
      .projects()
      .then((d) => d.projects || [])
      .catch(() => {
        projectsP = null;
        return [];
      });
  return projectsP;
};
export const dropProjectsCache = () => {
  projectsP = null;
};

interface State {
  project: Project | null;
  section_id: string | null;
  owner_email: string | null;
  due_date: string | null;
  codes: Record<string, string>;
}

function QuickAddBody({ ctx, list, init, close }: { ctx: TaskCtx | null; list: Project[]; init: State; close: () => void }) {
  const staff = ctx ? ctx.staff : getActiveStaff();
  const [st, setSt] = useState<State>(init);
  const [title, setTitle] = useState('');
  const [bad, setBad] = useState(false);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);
  const sections = ctx && ctx.project && st.project && ctx.project.id === st.project.id ? ctx.sections : [];

  const submit = async (again: boolean) => {
    if (busy.current) return;
    const t = title.trim();
    if (!t) {
      input.current?.focus();
      setBad(true);
      setTimeout(() => setBad(false), 600);
      return;
    }
    busy.current = true;
    const f: Record<string, unknown> = { title: t, owner_email: st.owner_email || undefined, due_date: st.due_date || undefined, ...st.codes };
    if (st.section_id) f.section_id = st.section_id;
    try {
      if (ctx && ctx.kind === 'project' && st.project && ctx.project && ctx.project.id === st.project.id) {
        if (!f.section_id) f.section_id = ctx.sections.length ? ctx.sections[0].id : null;
        void ctx.create({ ...f, section_id: f.section_id as string | null });
        toast('Task added');
      } else if (ctx && ctx.kind === 'mine' && !st.project) {
        void ctx.create({ ...f, owner_email: st.owner_email || staff.me });
        toast('Task added');
      } else {
        const d = await api.createTask({ ...f, project_id: st.project ? st.project.id : undefined });
        const task = d.task;
        const p = st.project;
        toast('Added ' + (task.code || 'task'), p ? { action: { label: 'Open', fn: () => goto(projectHref(p.key, '&t=' + encodeURIComponent(task.code || task.id))) } } : {});
        if (ctx && ctx.kind === 'mine') void ctx.reloadTasks();
      }
      if (again) {
        setTitle('');
        setSt((s) => ({ ...s, codes: {} }));
        input.current?.focus();
      } else close();
    } catch (e) {
      toast((e as Error).message || 'That did not save.', { error: true });
    }
    busy.current = false;
  };

  const owner = st.owner_email ? staff.personOf(st.owner_email) : null;
  return (
    <form
      className="pj-qa"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit(true);
        }
      }}
    >
      <input ref={input} className={'pj-qa__title' + (bad ? ' is-bad' : '')} type="text" maxLength={300} placeholder="What needs doing?" aria-label="Task title" enterKeyHint="done" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="pj-qa__chips">
        <button
          type="button"
          className={'rt-pchip pj-fbtn' + (st.project ? '' : ' is-empty')}
          onClick={async (e) => {
            const items = list.map((p) => ({ value: p.id as string | null, label: p.name, hint: p.key, dot: p.color, on: !!st.project && st.project.id === p.id }));
            items.push({ value: null, label: 'No project (a personal task)', hint: undefined as unknown as string, dot: undefined as unknown as string, on: !st.project });
            const v = await choose<string | null>({ anchor: e.currentTarget, title: 'Project', items, search: list.length > 7, placeholder: 'Search projects' });
            if (v !== undefined) setSt((s) => ({ ...s, project: v ? list.find((p) => p.id === v) || null : null, section_id: null }));
          }}
        >
          {st.project ? (
            <>
              <i className="pj-dot" data-c={st.project.color || 'leaf'} />
              <span>{st.project.name}</span>
            </>
          ) : (
            <>
              <Icon name="list" />
              <span>No project</span>
            </>
          )}
        </button>
        {sections.length ? (
          <button
            type="button"
            className={'rt-pchip pj-fbtn' + (st.section_id ? '' : ' is-empty')}
            onClick={async (e) => {
              const v = await pickSection({ anchor: e.currentTarget, sections, value: st.section_id, none: 'First section' });
              if (v !== undefined) setSt((s) => ({ ...s, section_id: v }));
            }}
          >
            <Icon name="list" />
            <span>{(sections.find((s) => s.id === st.section_id) || { name: 'First section' }).name}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={'rt-pchip pj-fbtn' + (st.owner_email ? '' : ' is-empty')}
          onClick={async () => {
            const r = await pickOwner({ title: 'Assign to', current: st.owner_email });
            if (r) setSt((s) => ({ ...s, owner_email: r.email }));
          }}
        >
          <Avatar p={owner} />
          <span>{owner ? owner.name : 'Unassigned'}</span>
        </button>
        <button
          type="button"
          className={'rt-pchip pj-fbtn' + (st.due_date ? '' : ' is-empty')}
          onClick={async (e) => {
            const v = await pickDate({ anchor: e.currentTarget, value: st.due_date });
            if (v !== undefined) setSt((s) => ({ ...s, due_date: v }));
          }}
        >
          <Icon name="cal" />
          <span>{st.due_date ? dueLabel(st.due_date) : 'No date'}</span>
        </button>
      </div>
      <div className="pj-qa__codes">
        <span className="pj-label">Codes</span>
        {CODE_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={'pj-codebtn' + (st.codes[k.field] ? ' is-set' : '')}
            onClick={async (e) => {
              const v = await pickCode({ anchor: e.currentTarget, kind: k.kind, value: st.codes[k.field] });
              if (v === undefined) return;
              setSt((s) => {
                const codes = { ...s.codes };
                if (v) codes[k.field] = v;
                else delete codes[k.field];
                return { ...s, codes };
              });
            }}
          >
            <small>{k.label}</small>
            <b>{st.codes[k.field] ? st.codes[k.field] : 'Add'}</b>
          </button>
        ))}
      </div>
      <div className="pj-sheet__foot">
        <span className="pj-qa__hint">Ctrl Enter adds another</span>
        <button type="button" className="pj-btn" data-sheet-x>
          Cancel
        </button>
        <button type="submit" className="pj-btn pj-btn--primary">
          Add task
        </button>
      </div>
    </form>
  );
}

/** defaults: { project (a project row or null), section_id, owner_email, due_date }. ctx: the open store (rows appear in it at once). */
export async function openQuickAdd(ctx: TaskCtx | null, defaults: QuickAddDefaults & { project?: Project | null } = {}) {
  const list = await projectsList();
  const staff = ctx ? ctx.staff : getActiveStaff();
  const init: State = {
    project: defaults.project !== undefined ? defaults.project : (ctx && ctx.project) || null,
    section_id: defaults.section_id || null,
    owner_email: defaults.owner_email !== undefined ? defaults.owner_email : staff.me,
    due_date: defaults.due_date || null,
    codes: {},
  };
  return openSheet({ title: 'New task', cls: 'pj-sheet--qa', render: (s) => <QuickAddBody ctx={ctx} list={list} init={init} close={() => s.close()} /> });
}
