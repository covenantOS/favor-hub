// Plan a project: describe it in a sentence, get a draft with sections, tasks, owners and dates, edit it, then create it. Nothing is
// saved until Create. openPlanner() resolves to the created project, or null when dismissed. Ported from public/js/projects/plan.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PRIORITY, todayStr } from '../lib/dates';
import { getActiveStaff } from '../lib/staff';
import type { Project } from '../types';
import { Avatar } from '../kit/Avatar';
import { Icon } from '../kit/Icon';
import { debounce, openSheet } from '../kit/overlays';
import { pickOwner } from '../kit/pickers';
import { dropProjectsCache } from './QuickAdd';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const TEMPLATE_HINTS: [string, string][] = [
  ['newsletter', 'Weekly newsletter'],
  ['appeal', 'Monthly appeal letter'],
  ['banquet', 'Banquet or hosted dinner'],
  ['grant', 'Grant application'],
  ['print', 'Print order'],
  ['church-newsletter', 'Church newsletter'],
];

interface PlanTask {
  title: string;
  owner_email: string | null;
  due_date: string | null;
  priority: string;
  description?: string;
}
interface PlanSection {
  name: string;
  tasks: PlanTask[];
}
interface Plan {
  name: string;
  team: string;
  description: string;
  lead_email: string;
  due_date: string | null;
  anchor_label?: string;
  sections: PlanSection[];
  [k: string]: unknown;
}
interface Warning {
  email: string;
  week: string;
  text: string;
}

const weekOf = (d: string | null) => {
  if (!d) return '';
  const t = new Date(d + 'T12:00:00Z');
  return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
};

function PlannerBody({ prompt0, done, close }: { prompt0: string; done: (p: Project) => void; close: () => void }) {
  const staff = getActiveStaff();
  const [step, setStep] = useState<'ask' | 'plan'>('ask');
  const [prompt, setPrompt] = useState(prompt0);
  const [template, setTemplate] = useState('');
  const [date, setDate] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState('');
  const dirty = useRef(false);
  const seq = useRef(0);
  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;
  const bodyRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (step === 'ask') {
      const t = setTimeout(() => (document.getElementById('pl-prompt') as HTMLTextAreaElement | null)?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [step]);

  const edit = (fn: (p: Plan) => void) => {
    dirty.current = true;
    setPlan((p) => {
      if (!p) return p;
      const n = structuredClone(p) as Plan;
      fn(n);
      return n;
    });
  };

  const recheck = useMemo(
    () =>
      debounce(async () => {
        const p = planRef.current;
        if (!p) return;
        try {
          const d = await api.planCheck(p.sections.flatMap((x) => x.tasks));
          setWarnings(d.warnings || []);
        } catch {
          // the warnings are advice; the plan still creates
        }
      }, 350),
    []
  );
  useEffect(() => () => recheck.cancel(), [recheck]);

  /* The draft shows at once from the template. The model reshapes it in the background and the result replaces it only while the person has not edited. */
  const refine = useCallback(async (p: Plan, text: string) => {
    const mine = ++seq.current;
    setRefining('Refining the draft');
    try {
      const r: Any = await api.planRefine({ prompt: text, plan: p });
      if (mine !== seq.current) return;
      if (r.refined && !dirty.current) {
        setPlan(r.plan);
        setWarnings(r.warnings || []);
        setRefining('');
      } else {
        setRefining(r.refined ? 'A refined draft is ready, but you changed this one first.' : '');
        if (!(r.refined && !dirty.current)) setTimeout(() => setRefining(''), 4000);
      }
    } catch {
      setRefining('');
    }
  }, []);

  const draft = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (text.length < 3 && !template) {
      setErr('Describe the project in a sentence, or pick a template.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const d: Any = await api.planDraft({ prompt: text || TEMPLATE_HINTS.find((x) => x[0] === template)![1], template: template || undefined, date: date || undefined });
      dirty.current = false;
      setPlan(d.plan);
      setWarnings(d.warnings || []);
      setStep('plan');
      setBusy(false);
      void refine(d.plan, text);
    } catch (ex) {
      setErr((ex as Error).message || 'The draft did not come back. Try again.');
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = planRef.current;
    if (!p) return;
    if (!p.name.trim()) return setErr('Give the project a name.');
    const sections = p.sections.map((x) => ({ ...x, tasks: x.tasks.filter((t) => t.title.trim()) })).filter((x) => x.tasks.length);
    if (!sections.length) return setErr('Add at least one task.');
    setBusy(true);
    setErr('');
    try {
      const r: Any = await api.planCreate({ ...p, name: p.name.trim(), sections, start_date: null });
      dropProjectsCache();
      done(r.project);
      close();
    } catch (ex) {
      setErr((ex as Error).message || 'That did not save.');
      setBusy(false);
    }
  };

  if (step === 'ask' || !plan) {
    return (
      <form className="pj-pl" autoComplete="off" onSubmit={draft}>
        <label className="pj-label" htmlFor="pl-prompt">
          What is the project?
        </label>
        <textarea id="pl-prompt" className="pj-field" rows={3} maxLength={600} placeholder="Banquet in Houston on December 6 for about 80 partners" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <span className="pj-label">Start from</span>
        <div className="pj-chips" role="group" aria-label="Template">
          <button type="button" className={'pj-fchipbtn' + (template ? '' : ' is-on')} aria-pressed={!template} onClick={() => setTemplate('')}>
            Best match
          </button>
          {TEMPLATE_HINTS.map(([id, label]) => (
            <button key={id} type="button" className={'pj-fchipbtn' + (template === id ? ' is-on' : '')} aria-pressed={template === id} onClick={() => setTemplate(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="pj-label" htmlFor="pl-date">
          Date
        </label>
        <input id="pl-date" className="pj-field pj-pl__date" type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
        {err ? <p className="pj-err">{err}</p> : null}
        <div className="pj-sheet__foot">
          <button type="button" className="pj-btn" data-sheet-x>
            Cancel
          </button>
          <button type="submit" className="pj-btn pj-btn--primary" disabled={busy}>
            {busy ? 'Drafting' : 'Draft plan'}
          </button>
        </div>
      </form>
    );
  }

  const total = plan.sections.reduce((n, x) => n + x.tasks.length, 0);
  const lead = staff.personOf(plan.lead_email);
  return (
    <form className="pj-pl" autoComplete="off" onSubmit={create} ref={bodyRef} onInput={() => { dirty.current = true; }}>
      {refining ? (
        <p className="pj-pl__refine" role="status">
          {refining}
        </p>
      ) : null}
      <label className="pj-label" htmlFor="pp-name">
        Name
      </label>
      <input id="pp-name" className="pj-field" type="text" maxLength={120} value={plan.name} onChange={(e) => edit((p) => { p.name = e.target.value; })} />
      <div className="pj-pf__row">
        <div className="pj-grow">
          <span className="pj-label">Lead</span>
          <button
            type="button"
            className="rt-pchip pj-fbtn"
            onClick={async () => {
              const r = await pickOwner({ title: 'Project lead', current: plan.lead_email, clear: '' });
              if (r && r.email) edit((p) => { p.lead_email = r.email as string; });
            }}
          >
            <Avatar p={lead} />
            <span>{lead ? lead.name : ''}</span>
          </button>
        </div>
        <div className="pj-grow">
          <label className="pj-label" htmlFor="pp-team">
            Team
          </label>
          <input id="pp-team" className="pj-field" type="text" maxLength={40} value={plan.team} onChange={(e) => edit((p) => { p.team = e.target.value; })} />
        </div>
        <div className="pj-grow">
          <label className="pj-label" htmlFor="pp-due">
            {plan.anchor_label || 'Date'}
          </label>
          <input id="pp-due" className="pj-field" type="date" value={plan.due_date || ''} onChange={(e) => edit((p) => { p.due_date = e.target.value; })} />
        </div>
      </div>
      <label className="pj-label" htmlFor="pp-desc">
        Description
      </label>
      <textarea id="pp-desc" className="pj-field" rows={2} maxLength={1000} value={plan.description} onChange={(e) => edit((p) => { p.description = e.target.value; })} />
      <div className="pj-pl__warns">
        {warnings.length ? (
          <div className="pj-pl__warn" role="status">
            <b>
              <Icon name="flag" />
              Heavy weeks
            </b>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {plan.sections.map((sec, si) => (
        <section className="pj-pl__sec" key={si}>
          <div className="pj-pl__sech">
            <input className="pj-field pj-pl__secname" type="text" maxLength={80} value={sec.name} aria-label="Section name" onChange={(e) => edit((p) => { p.sections[si].name = e.target.value; })} />
            <button type="button" className="pj-ib" aria-label="Remove section" onClick={() => { edit((p) => { p.sections.splice(si, 1); }); recheck(); }}>
              <Icon name="trash" />
            </button>
          </div>
          <ul className="pj-pl__list">
            {sec.tasks.map((t, ki) => {
              const o = t.owner_email ? staff.personOf(t.owner_email) : null;
              const warn = warnings.some((w) => w.email === t.owner_email && weekOf(t.due_date) === w.week);
              return (
                <li className={'pj-pl__task' + (warn ? ' is-warn' : '')} key={ki}>
                  <input className="pj-field pj-pl__title" type="text" maxLength={200} value={t.title} aria-label="Task" onChange={(e) => edit((p) => { p.sections[si].tasks[ki].title = e.target.value; })} />
                  <button
                    type="button"
                    className="rt-pchip pj-fbtn pj-pl__own"
                    aria-label="Owner"
                    onClick={async () => {
                      const r = await pickOwner({ title: 'Owner', current: t.owner_email, clear: 'No owner' });
                      if (r === null || r === undefined) return;
                      edit((p) => { p.sections[si].tasks[ki].owner_email = r.email || null; });
                      recheck();
                    }}
                  >
                    <Avatar p={o} size="sm" />
                    <span>{o ? o.name : 'No owner'}</span>
                  </button>
                  <input className="pj-field pj-pl__due" type="date" value={t.due_date || ''} aria-label="Due date" onChange={(e) => { edit((p) => { p.sections[si].tasks[ki].due_date = e.target.value; }); recheck(); }} />
                  <select className="pj-field pj-pl__pri" aria-label="Priority" value={t.priority} onChange={(e) => { edit((p) => { p.sections[si].tasks[ki].priority = e.target.value; }); recheck(); }}>
                    {['high', 'normal', 'low'].map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY[p]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="pj-ib pj-pl__rm" aria-label="Remove task" onClick={() => { edit((p) => { p.sections[si].tasks.splice(ki, 1); }); recheck(); }}>
                    <Icon name="x" />
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="pj-btn pj-pl__add"
            onClick={() => {
              edit((p) => {
                const s = p.sections[si];
                const last = s.tasks[s.tasks.length - 1];
                s.tasks.push({ title: '', owner_email: p.lead_email, due_date: (last && last.due_date) || p.due_date || todayStr(), priority: 'normal', description: '' });
              });
              requestAnimationFrame(() => {
                const rows = bodyRef.current?.querySelectorAll<HTMLInputElement>(`.pj-pl__sec:nth-of-type(${si + 1}) .pj-pl__title`);
                if (rows && rows.length) rows[rows.length - 1].focus();
              });
            }}
          >
            <Icon name="plus" />
            Add task
          </button>
        </section>
      ))}
      <button type="button" className="pj-btn pj-pl__add" onClick={() => edit((p) => { p.sections.push({ name: 'New section', tasks: [] }); })}>
        <Icon name="plus" />
        Add section
      </button>
      {err ? <p className="pj-err">{err}</p> : null}
      <div className="pj-sheet__foot">
        <button
          type="button"
          className="pj-btn"
          onClick={() => {
            seq.current++;
            setStep('ask');
          }}
        >
          Back
        </button>
        <button type="submit" className="pj-btn pj-btn--primary" disabled={busy}>
          {busy ? 'Creating' : `Create project with ${total} ${total === 1 ? 'task' : 'tasks'}`}
        </button>
      </div>
    </form>
  );
}

export function openPlanner({ prompt = '' }: { prompt?: string } = {}): Promise<Project | null> {
  return new Promise((resolve) => {
    let result: Project | null = null;
    openSheet({
      title: 'Plan a project',
      cls: 'pj-sheet--plan',
      render: (s) => (
        <PlannerBody
          prompt0={prompt}
          done={(p) => {
            result = p;
          }}
          close={() => s.close()}
        />
      ),
      onClose: () => resolve(result),
    });
  });
}
