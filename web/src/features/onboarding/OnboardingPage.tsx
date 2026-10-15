// Staff > Onboarding: new hires and exits in progress, the start sheet, the checklist template and who owns each duty. Same markup, class
// names and stylesheet as src/pages/onboarding/index.astro and public/js/onboard/index.js, drawn by React. The page is for hub admins and
// people an admin marked HR; step owners and supervisors see the runs they are part of (the server decides, /api/onboarding).
import '@hub/styles/onboard.css';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import { StartSheet, type Pre } from './StartSheet';
import {
  anyEdited,
  dateWord,
  dayLabel,
  dutyWord,
  hue,
  initials,
  kindWord,
  lede,
  listTabs,
  pct,
  dayWord,
  startRequest,
  stepsOfGroup,
  tabFromHash,
  tabHash,
  templateValue,
  withEdit,
  type Kind,
  type ListTab,
  type RunSummary,
  type Template,
} from './logic';
import { doneQuery, listQuery, sendJson, templateQuery, type ListOk } from './queries';
import { Ic, PersonField, Sheet, toast } from './ui';

const Skeleton = () => (
  <>
    <div className="ob-skel" />
    <div className="ob-skel" />
  </>
);

export function OnboardingPage() {
  return (
    <ErrorBoundary label="Onboarding did not load. Refresh the page to try again." className="ob-empty">
      <Suspense
        fallback={
          <div className="ob" id="ob-root" aria-busy="true">
            <Skeleton />
          </div>
        }
      >
        <Loaded />
      </Suspense>
    </ErrorBoundary>
  );
}

function Loaded() {
  const { data } = useSuspenseQuery(listQuery);
  if (data.state === 'error') {
    return (
      <div className="ob" id="ob-root">
        <div className="ob-empty">
          <p>{data.message}</p>
        </div>
      </div>
    );
  }
  return <ListView data={data} />;
}

/* ------------------------------------------------------------------ the list */
function RunCard({ r }: { r: RunSummary }) {
  const late = r.late ? <span className="ob-chip ob-chip--red">{r.late} late</span> : null;
  const state = r.status === 'done' ? <span className="ob-chip ob-chip--leaf">Finished</span> : r.status === 'cancelled' ? <span className="ob-chip">Cancelled</span> : null;
  const p = pct(r.done, r.steps);
  return (
    <NavLink className="ob-run" href={'/onboarding/run/?id=' + encodeURIComponent(r.id)}>
      <span className="rq-av" data-c={hue(r.email)}>
        {initials(r.name)}
      </span>
      <span className="ob-run__main">
        <b>{r.name}</b>
        <span>{[r.title, r.team].filter(Boolean).join(' · ') || r.email}</span>
        {r.status === 'active' && r.next ? (
          <small className="ob-run__next">
            Next: {r.next.title}
            {r.next.due ? ', ' + dayWord(r.next.due) : ''}
          </small>
        ) : null}
      </span>
      <span className="ob-run__meta">
        <span className={'ob-chip ob-chip--' + (r.kind === 'offboard' ? 'sun' : 'sky')}>{kindWord(r.kind)}</span>
        <span className="ob-chip">{dateWord(r)}</span>
        {late}
        {state}
      </span>
      <span className="ob-run__prog">
        <span className="ob-bar" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: p + '%' }} />
        </span>
        <small>
          {r.done} of {r.steps} done
        </small>
      </span>
    </NavLink>
  );
}

function RunList({ runs, empty, startButton, onStart }: { runs: RunSummary[]; empty: string; startButton: boolean; onStart: (k: Kind) => void }) {
  if (!runs.length) {
    return (
      <div className="ob-empty">
        <p>{empty}</p>
        {startButton ? (
          <button type="button" className="h-btn h-btn--primary" onClick={() => onStart('onboard')}>
            Start onboarding
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="ob-runs">
      {runs.map((r) => (
        <RunCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function ListView({ data }: { data: ListOk }) {
  const [tab, setTab] = useState<ListTab>('active');
  const [start, setStart] = useState<{ kind: Kind; pre: Pre } | null>(null);
  const opened = useRef(false);

  // A link such as /onboarding/#done opens that tab, and Admin > People links here with ?start=onboard|offboard&email=&name=.
  useEffect(() => {
    setTab(tabFromHash(window.location.hash, data.manage));
    const want = startRequest(Object.fromEntries(new URLSearchParams(window.location.search)));
    if (want && data.manage && !opened.current) {
      opened.current = true;
      setStart({ kind: want.kind, pre: { email: want.email, name: want.name } });
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [data.manage]);

  const pick = (t: ListTab) => {
    setTab(t);
    window.history.replaceState(window.history.state, '', t === 'active' ? window.location.pathname : tabHash(t));
  };

  const tabs = listTabs(data.manage, data.runs.length);
  let panel: ReactNode;
  if (tab === 'active') panel = <RunList runs={data.runs} empty="No onboarding or offboarding in progress." startButton={data.manage} onStart={(k) => setStart({ kind: k, pre: {} })} />;
  else if (tab === 'done') panel = <DonePanel />;
  else if (tab === 'checklist') panel = <ChecklistPanel />;
  else panel = <OwnersPanel data={data} />;

  return (
    <div className="ob" id="ob-root">
      <header className="ob-head">
        <div>
          <h1>Onboarding</h1>
          <p className="h-lede">{lede(data.runs)}</p>
        </div>
        {data.manage ? (
          <div className="ob-head__acts">
            <button type="button" className="h-btn h-btn--primary" id="ob-start" onClick={() => setStart({ kind: 'onboard', pre: {} })}>
              <Ic name="plus" />
              Start onboarding
            </button>
            <button type="button" className="h-btn h-btn--ghost" onClick={() => setStart({ kind: 'offboard', pre: {} })}>
              <Ic name="door" />
              Start offboarding
            </button>
          </div>
        ) : null}
      </header>
      <div className="ob-tabs" role="tablist" aria-label="Onboarding">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-on' : ''} onClick={() => pick(t.key)}>
            {t.label}
            {t.count !== undefined ? <span>{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div id="ob-panel" aria-live="polite">
        {panel}
      </div>
      {start ? <StartSheet kind={start.kind} pre={start.pre} onClose={() => setStart(null)} /> : null}
    </div>
  );
}

function DonePanel() {
  const { data, error } = useQuery(doneQuery);
  useEffect(() => {
    if (error) toast((error as Error).message, true);
  }, [error]);
  return <RunList runs={data || []} empty={data ? 'Nothing finished yet.' : 'Loading.'} startButton={false} onStart={() => undefined} />;
}

/* ------------------------------------------------------------------ the checklist */

/** An input, textarea or select that saves when the browser's own change event fires: on leaving a text box, at once for a select or box. */
function useChange<E extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(handler: (el: E) => void) {
  const ref = useRef<E>(null);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => latest.current(el);
    el.addEventListener('change', f);
    return () => el.removeEventListener('change', f);
  }, []);
  return ref;
}

function TemplateRow({ t, s, save }: { t: Template; s: Template['steps'][number]; save: (key: string, field: string, value: string | number | boolean) => void }) {
  const kind = t.kind;
  const title = useChange<HTMLInputElement>((el) => save(s.key, 'title', el.value));
  const detail = useChange<HTMLTextAreaElement>((el) => save(s.key, 'detail', el.value));
  const duty = useChange<HTMLSelectElement>((el) => save(s.key, 'duty', el.value));
  const offset = useChange<HTMLInputElement>((el) => save(s.key, 'offset_days', templateValue('number', el.value, false)));
  const grp = useChange<HTMLSelectElement>((el) => save(s.key, 'grp', el.value));
  const active = useChange<HTMLInputElement>((el) => save(s.key, 'active', templateValue('checkbox', el.value, el.checked)));
  return (
    <div className={'ob-trow' + (s.active ? '' : ' is-off')} data-key={s.key}>
      <input ref={title} className="ob-in ob-trow__title" defaultValue={s.title} maxLength={160} aria-label="Step title" />
      <textarea ref={detail} className="ob-in ob-trow__detail" rows={2} maxLength={800} aria-label="Step detail" defaultValue={s.detail} />
      <div className="ob-trow__meta">
        <label>
          Owner
          <select ref={duty} className="ob-in" defaultValue={s.duty}>
            {t.duties.map((d) => (
              <option key={d.key} value={d.key}>
                {dutyWord(d)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Days from {dayLabel(kind)}
          <input ref={offset} className="ob-in" type="number" min={-120} max={365} defaultValue={s.offset_days} />
        </label>
        <label>
          Phase
          <select ref={grp} className="ob-in" defaultValue={s.grp}>
            {t.groups.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ob-check">
          <input ref={active} type="checkbox" defaultChecked={s.active} /> Include
        </label>
      </div>
    </div>
  );
}

function ChecklistPanel() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('onboard');
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [ver, setVer] = useState(0);
  const savedT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const q = templateQuery(kind);
  const { data: t, error } = useQuery(q);
  useEffect(() => {
    if (error) toast((error as Error).message, true);
  }, [error]);
  useEffect(() => () => clearTimeout(savedT.current), []);

  const save = async (key: string, field: string, value: string | number | boolean) => {
    try {
      await sendJson('template', 'PUT', { kind, key, [field]: value });
      qc.setQueryData<Template>(q.queryKey, (cur) => (cur ? withEdit(cur, key, field, value) : cur));
      setSaved(true);
      clearTimeout(savedT.current);
      savedT.current = setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (!t) {
    return (
      <div className="ob-empty">
        <p>Loading the checklist.</p>
      </div>
    );
  }
  return (
    <>
      <div className="ob-tplbar">
        <div className="ob-seg" role="tablist" aria-label="Checklist">
          {(['onboard', 'offboard'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>
              {kindWord(k)}
            </button>
          ))}
        </div>
        <span className="ob-saved" id="ob-saved" role="status">
          {saved ? 'Saved' : ''}
        </span>
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => setAdding(true)}>
          <Ic name="plus" />
          Add a step
        </button>
        <button type="button" className="rt-btn rt-btn--sm rt-btn--ghost" disabled={!anyEdited(t)} onClick={() => setResetting(true)}>
          Back to the built-in list
        </button>
      </div>
      {t.groups.map((g) => (
        <section className="ob-tgrp" key={g.key}>
          <h3>{g.label}</h3>
          {stepsOfGroup(t, g.key).map((s) => (
            <TemplateRow key={kind + ':' + ver + ':' + s.key} t={t} s={s} save={save} />
          ))}
        </section>
      ))}
      {adding ? <AddTemplateStep t={t} onClose={() => setAdding(false)} /> : null}
      {resetting ? <ResetSheet kind={kind} onClose={() => setResetting(false)} onDone={() => setVer((v) => v + 1)} /> : null}
    </>
  );
}

function AddTemplateStep({ t, onClose }: { t: Template; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [duty, setDuty] = useState(t.duties[0]?.key || '');
  const [offset, setOffset] = useState('0');
  const [grp, setGrp] = useState(t.groups[0]?.key || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setErr('');
    try {
      const out = await sendJson('template', 'PUT', { kind: t.kind, title, detail, duty, offset_days: Number(offset) || 0, grp });
      qc.setQueryData<Template>(templateQuery(t.kind).queryKey, (cur) => (cur ? { ...cur, steps: out.steps as Template['steps'] } : cur));
      onClose();
      toast('Step added');
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet
      title="Add a step"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="rt-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rt-btn rt-btn--primary" disabled={busy} onClick={add}>
            Add the step
          </button>
        </>
      }
    >
      <form className="ob-form" noValidate onSubmit={(e) => e.preventDefault()}>
        <p className="ob-err" role="alert" hidden={!err}>
          {err}
        </p>
        <label className="ob-lab">
          Step
          <input className="ob-in" name="title" maxLength={160} required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="ob-lab">
          Detail
          <textarea className="ob-in" name="detail" rows={3} maxLength={800} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <div className="ob-2">
          <label className="ob-lab">
            Owner
            <select className="ob-in" name="duty" value={duty} onChange={(e) => setDuty(e.target.value)}>
              {t.duties.map((d) => (
                <option key={d.key} value={d.key}>
                  {dutyWord(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="ob-lab">
            Days from {dayLabel(t.kind)}
            <input className="ob-in" name="offset_days" type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
          </label>
        </div>
        <label className="ob-lab">
          Phase
          <select className="ob-in" name="grp" value={grp} onChange={(e) => setGrp(e.target.value)}>
            {t.groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Sheet>
  );
}

function ResetSheet({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    try {
      const out = await sendJson('template/reset', 'POST', { kind });
      qc.setQueryData<Template>(templateQuery(kind).queryKey, (cur) => (cur ? { ...cur, steps: out.steps as Template['steps'] } : cur));
      onDone();
      onClose();
      toast('Reset');
    } catch (e) {
      setBusy(false);
      toast((e as Error).message, true);
    }
  };
  return (
    <Sheet
      title="Back to the built-in list"
      onClose={onClose}
      foot={
        <>
          <button type="button" className="rt-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rt-btn rt-btn--primary" disabled={busy} onClick={reset}>
            Reset the list
          </button>
        </>
      }
    >
      <p className="ob-p">Your changes to this checklist are removed. Runs already started keep their steps.</p>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ owners */
function OwnersPanel({ data }: { data: ListOk }) {
  const qc = useQueryClient();
  const setOwner = async (duty: string, email: string) => {
    const was = data.owners[duty] || '';
    const put = (v: string) => qc.setQueryData(listQuery.queryKey, (cur) => (cur && cur.state === 'ok' ? { ...cur, owners: { ...cur.owners, [duty]: v } } : cur));
    put(email);
    try {
      await sendJson('owners', 'PUT', { duty, email });
      toast('Saved');
    } catch (e) {
      put(was);
      toast((e as Error).message, true);
    }
  };
  return (
    <div className="ob-owners">
      {data.duties.map((d) => (
        <div className="ob-orow" key={d.key}>
          <div>
            <b>{d.label}</b>
            <small>{d.hint}</small>
          </div>
          <div>
            <PersonField value={data.owners[d.key] || ''} label={d.key} placeholder="Nobody yet" onChange={(email) => setOwner(d.key, email)} />
          </div>
        </div>
      ))}
      <p className="ob-note">A duty with no owner sends its steps to whoever starts the run.</p>
    </div>
  );
}
