// New project and project details: one form. Members are added and removed here too. Ported from public/js/projects/ui-projform.js.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { COLOR_NAMES } from '../lib/dates';
import { getActiveStaff } from '../lib/staff';
import type { Member, Project } from '../types';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { choose, openSheet } from '../kit/overlays';
import { pickOwner } from '../kit/pickers';
import { toast } from '../kit/toast';
import { dropProjectsCache } from './QuickAdd';

const STATUSES: Record<string, string> = { active: 'Active', paused: 'Paused', done: 'Done', archived: 'Archived' };
const autoKey = (name: string) =>
  String(name || '')
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, _i, a) => (a.length > 1 ? w[0] : w.slice(0, 3)))
    .join('')
    .toUpperCase()
    .slice(0, 5);

interface Form {
  name: string;
  key: string;
  keyTouched: boolean;
  team: string;
  description: string;
  lead: string;
  visibility: string;
  color: string;
  status: string;
  start: string;
  due: string;
  members: string[];
}

function FormBody({ project, members, done }: { project: Project | null; members: Member[]; done: (p: Project | null) => void }) {
  const staff = getActiveStaff();
  const edit = !!project;
  const orig = useRef(new Set(members.map((m) => m.email)));
  const [f, setF] = useState<Form>({
    name: project ? project.name : '',
    key: project ? project.key : '',
    keyTouched: edit,
    team: project ? project.team : '',
    description: project ? project.description : '',
    lead: project ? project.lead_email : staff.me,
    visibility: project ? project.visibility : 'staff',
    color: project ? project.color : 'leaf',
    status: project ? project.status : 'active',
    start: project ? project.start_date || '' : '',
    due: project ? project.due_date || '' : '',
    members: members.map((m) => m.email),
  });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!edit) {
      const t = setTimeout(() => nameRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [edit]);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const lead = staff.personOf(f.lead);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Give the project a name.');
    if (!edit && !/^[A-Z]{2,5}$/.test(f.key)) return setErr('The key is 2 to 5 capital letters.');
    setSaving(true);
    setErr('');
    try {
      const body: Record<string, unknown> = { name: f.name.trim(), team: f.team.trim(), description: f.description.trim(), lead_email: f.lead, visibility: f.visibility, color: f.color, start_date: f.start || null, due_date: f.due || null };
      let p: Project;
      if (project) {
        body.status = f.status;
        p = (await api.patchProject(project.id, body)).project;
        const add = f.members.filter((m) => !orig.current.has(m));
        const remove = [...orig.current].filter((m) => !f.members.includes(m));
        if (add.length || remove.length) await api.members(project.id, { add, remove });
      } else {
        p = (await api.createProject({ ...body, key: f.key, members: f.members.filter((m) => m !== f.lead) })).project;
      }
      dropProjectsCache();
      done(p);
    } catch (ex) {
      setErr((ex as Error).message || 'That did not save.');
      setSaving(false);
    }
  };

  return (
    <form className="pj-pf" autoComplete="off" onSubmit={submit}>
      <label className="pj-label" htmlFor="pf-name">
        Name
      </label>
      <input
        id="pf-name"
        ref={nameRef}
        className="pj-field"
        type="text"
        maxLength={80}
        value={f.name}
        placeholder="Fall newsletter"
        onChange={(e) => set({ name: e.target.value, ...(f.keyTouched ? {} : { key: autoKey(e.target.value) }) })}
      />
      <div className="pj-pf__row">
        <div>
          <label className="pj-label" htmlFor="pf-key">
            Key
          </label>
          <input id="pf-key" className="pj-field pj-field--key" type="text" maxLength={5} value={f.key} placeholder="FNL" disabled={edit} onChange={(e) => set({ key: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase(), keyTouched: true })} />
        </div>
        <div className="pj-grow">
          <label className="pj-label" htmlFor="pf-team">
            Team
          </label>
          <input id="pf-team" className="pj-field" type="text" maxLength={40} value={f.team} placeholder="Marketing" onChange={(e) => set({ team: e.target.value })} />
        </div>
      </div>
      <label className="pj-label" htmlFor="pf-desc">
        Description
      </label>
      <textarea id="pf-desc" className="pj-field" rows={3} maxLength={1000} value={f.description} onChange={(e) => set({ description: e.target.value })} />
      <div className="pj-pf__row">
        <div className="pj-grow">
          <span className="pj-label">Lead</span>
          <button
            type="button"
            className="rt-pchip pj-fbtn"
            onClick={async () => {
              const r = await pickOwner({ title: 'Project lead', current: f.lead, clear: '' });
              if (r && r.email) setF((x) => ({ ...x, lead: r.email as string, members: x.members.includes(r.email as string) ? x.members : [...x.members, r.email as string] }));
            }}
          >
            <Avatar p={lead} />
            <span>{lead ? lead.name : ''}</span>
          </button>
        </div>
        <div className="pj-grow">
          <span className="pj-label">Who can see it</span>
          <button
            type="button"
            className="rt-pchip pj-fbtn"
            onClick={async (e) => {
              const v = await choose<string>({ anchor: e.currentTarget, title: 'Who can see it', items: [{ value: 'staff', label: 'All staff', hint: 'Anyone signed in to FavorOS can open it', on: f.visibility === 'staff' }, { value: 'members', label: 'Members only', hint: 'Only the people listed here', on: f.visibility === 'members' }] });
              if (v) set({ visibility: v });
            }}
          >
            <Icon name="lock" />
            <span>{f.visibility === 'members' ? 'Members only' : 'All staff'}</span>
          </button>
        </div>
      </div>
      <div className="pj-pf__row">
        <div className="pj-grow">
          <label className="pj-label" htmlFor="pf-start">
            Start
          </label>
          <input id="pf-start" className="pj-field" type="date" value={f.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div className="pj-grow">
          <label className="pj-label" htmlFor="pf-due">
            Due
          </label>
          <input id="pf-due" className="pj-field" type="date" value={f.due} onChange={(e) => set({ due: e.target.value })} />
        </div>
      </div>
      <span className="pj-label">Color</span>
      <div className="pj-swatches" role="radiogroup" aria-label="Color">
        {COLOR_NAMES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={f.color === c} className={'pj-swatch' + (f.color === c ? ' is-on' : '')} data-c={c} aria-label={c} onClick={() => set({ color: c })} />
        ))}
      </div>
      {edit ? (
        <>
          <span className="pj-label">Status</span>
          <button
            type="button"
            className="rt-pchip pj-fbtn"
            onClick={async (e) => {
              const v = await choose<string>({ anchor: e.currentTarget, title: 'Status', items: Object.entries(STATUSES).map(([value, label]) => ({ value, label, on: f.status === value })) });
              if (v) set({ status: v });
            }}
          >
            <span>{STATUSES[f.status] || f.status}</span>
          </button>
        </>
      ) : null}
      <span className="pj-label">Members</span>
      <div className="pj-members">
        {f.members.map((e) => {
          const p = staff.personOf(e)!;
          return (
            <span className="pj-fchip" key={e}>
              <Avatar p={p} />
              <span>{p.name.split(' ')[0]}</span>
              <button
                type="button"
                aria-label={'Remove ' + p.name}
                onClick={() => {
                  if (e === f.lead) {
                    toast('The lead stays a member.');
                    return;
                  }
                  set({ members: f.members.filter((x) => x !== e) });
                }}
              >
                <Icon name="x" />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          className="rt-pchip pj-fbtn is-empty"
          onClick={async () => {
            const r = await pickOwner({ title: 'Add a member', clear: '', exclude: f.members });
            if (r && r.email) setF((x) => ({ ...x, members: [...x.members, r.email as string] }));
          }}
        >
          <Icon name="plus" />
          <span>Add people</span>
        </button>
      </div>
      {err ? <p className="pj-err">{err}</p> : null}
      <div className="pj-sheet__foot">
        <button type="button" className="pj-btn" data-sheet-x>
          Cancel
        </button>
        <button type="submit" className="pj-btn pj-btn--primary" disabled={saving}>
          {edit ? 'Save' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

/** project: an existing project row to edit, or null for a new one. members: the current people when editing. Resolves to the saved project or null. */
export function openProjectForm({ project = null, members = [] }: { project?: Project | null; members?: Member[] } = {}): Promise<Project | null> {
  return new Promise((resolve) => {
    let result: Project | null = null;
    openSheet({
      title: project ? 'Project details' : 'New project',
      cls: 'pj-sheet--form',
      render: (s) => (
        <FormBody
          project={project}
          members={members}
          done={(p) => {
            result = p;
            s.close();
          }}
        />
      ),
      onClose: () => resolve(result),
    });
  });
}
