// One onboarding or offboarding run: the checklist by phase, each step with its owner and due date, the HR file marks, the buttons for
// what FavorOS does itself, and for an exit what the person still owns. Same markup, class names and stylesheet as
// src/pages/onboarding/run/index.astro and public/js/onboard/run.js, drawn by React. The server decides who may open a run
// (HR and admins, the supervisor, the people who own its steps); this page only draws the answer.
import '@hub/styles/onboard.css';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { NavLink } from '@/shell/NavLink';
import {
  CLOSE_LINES,
  autoAction,
  bannerFor,
  canChange,
  canTick,
  dateWord,
  docsGot,
  dueWord,
  etTime,
  eventLine,
  first,
  groupSections,
  hubAddLines,
  hue,
  initials,
  isClosed,
  kindWord,
  moveWord,
  dayWord,
  pct,
  runIdOf,
  type Detail,
  type DoneItem,
  type Owned,
  type Step,
} from './logic';
import { ownedQuery, runQuery, sendJson } from './queries';
import { Avatar, Ic, PersonField, PickSheet, Sheet, toast, takeFresh, useNameOf, usePeople } from './ui';
import { personIn } from './logic';

const Skeleton = () => (
  <div className="ob" id="ob-run" aria-busy="true">
    <div className="ob-skel" />
    <div className="ob-skel" />
  </div>
);

export function RunPage() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const id = runIdOf(search);
  return (
    <ErrorBoundary label="This onboarding did not load. Refresh the page to try again." className="ob-empty">
      <Suspense fallback={<Skeleton />}>
        <Loaded id={id} />
      </Suspense>
    </ErrorBoundary>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="ob" id="ob-run">
      <div className="ob-empty">
        <p>{text}</p>
        <NavLink className="h-btn h-btn--primary" href="/onboarding/">
          Open Onboarding
        </NavLink>
      </div>
    </div>
  );
}

function Loaded({ id }: { id: string }) {
  const { data } = useSuspenseQuery(runQuery(id));
  if (!id) return <Empty text="Pick a run from the Onboarding page." />;
  if (data.state === 'none') return <Empty text="Pick a run from the Onboarding page." />;
  if (data.state === 'error') return <Empty text={data.message} />;
  return <RunView id={id} d={data.d} />;
}

type Banner = { title: string; lines: string[] } | null;

function RunView({ id, d }: { id: string; d: Detail }) {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<Banner>(null);
  const [err, setErr] = useState('');
  const [docsOpen, setDocsOpen] = useState(false);
  const [sheet, setSheet] = useState<React.ReactNode>(null);
  const run = d.run;
  const closed = isClosed(run.status);
  const gate = { manage: d.can.manage, status: run.status };
  const owned = useQuery({ ...ownedQuery(id), enabled: run.kind === 'offboard' && d.can.manage });

  // The note a start leaves behind, and the browser tab's title.
  useEffect(() => {
    const n = takeFresh(id);
    if (n) setBanner(bannerFor(n, d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    document.title = run.name + ' - Onboarding - FavorOS';
  }, [run.name]);

  const put = (out: Record<string, unknown> | null) => {
    if (out && out.run) qc.setQueryData(runQuery(id).queryKey, { state: 'ok', d: out as unknown as Detail });
    if (out && out.owned) qc.setQueryData(ownedQuery(id).queryKey, out.owned as Owned);
  };

  /** Run a change, draw the answer, show the server's words when it refuses. Resolves to the answer or null. */
  const act = async (call: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown> | null> => {
    setErr('');
    try {
      const out = await call();
      put(out);
      return out;
    } catch (e) {
      const m = (e as Error).message;
      setErr(m);
      toast(m, true);
      return null;
    }
  };

  const patch = (s: Step, body: Record<string, unknown>) => act(() => sendJson(`runs/${id}/steps/${s.id}`, 'PATCH', body));

  const ctx: Ctx = { id, d, gate, act, patch, setSheet, setDocsOpen, docsOpen };
  const p = pct(d.progress.done, d.progress.total);
  const state = run.status === 'done' ? <span className="ob-chip ob-chip--leaf">Finished</span> : run.status === 'cancelled' ? <span className="ob-chip">Cancelled</span> : null;

  return (
    <div className="ob" id="ob-run">
      <NavLink className="ob-backlink" href="/onboarding/">
        <Ic name="back" />
        Onboarding
      </NavLink>
      <header className="ob-rhead">
        <span className="rq-av ob-rhead__av" data-c={hue(run.email)}>
          {initials(run.name)}
        </span>
        <div className="ob-rhead__t">
          <h1>{run.name}</h1>
          <p>{[run.title, run.team].filter(Boolean).join(' · ') || run.email}</p>
          <div className="ob-rhead__chips">
            <span className={'ob-chip ob-chip--' + (run.kind === 'offboard' ? 'sun' : 'sky')}>{kindWord(run.kind)}</span>
            <span className="ob-chip">{dateWord(run)}</span>
            {run.stays ? <span className="ob-chip">Stays as a volunteer</span> : null}
            {state}
          </div>
        </div>
        <div className="ob-rhead__p">
          <span className="ob-bar ob-bar--lg" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: p + '%' }} />
          </span>
          <small>
            {d.progress.done} of {d.progress.total} done
          </small>
          {d.can.manage && !closed ? (
            <div className="ob-rhead__acts">
              <button type="button" className="rt-btn rt-btn--sm" onClick={() => setSheet(<AddStepSheet ctx={ctx} />)}>
                <Ic name="plus" />
                Add a step
              </button>
              <button type="button" className="rt-btn rt-btn--sm rt-btn--ghost" onClick={() => setSheet(<CancelSheet ctx={ctx} />)}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {banner ? (
        <div className="ob-banner" role="status">
          <b>{banner.title}</b>
          {banner.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <button type="button" className="ob-x" aria-label="Dismiss" onClick={() => setBanner(null)}>
            <Ic name="x" />
          </button>
        </div>
      ) : null}
      <p className="ob-err ob-err--page" role="alert" hidden={!err}>
        {err}
      </p>
      <div className="ob-cols">
        <div className="ob-main">
          {groupSections(d).map(({ group, steps, done, total }) => (
            <section className="ob-grp" key={group.key}>
              <h2>
                {group.label}{' '}
                <span>
                  {done} of {total}
                </span>
              </h2>
              <ul className="ob-steps">
                {steps.map((s) => (
                  <StepRow key={s.id} s={s} ctx={ctx} />
                ))}
              </ul>
            </section>
          ))}
        </div>
        <Aside ctx={ctx} owned={owned.data || null} />
      </div>
      {sheet}
    </div>
  );
}

interface Ctx {
  id: string;
  d: Detail;
  gate: { manage: boolean; status: string };
  act: (call: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown> | null>;
  patch: (s: Step, body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  setSheet: (n: React.ReactNode) => void;
  setDocsOpen: (v: boolean) => void;
  docsOpen: boolean;
}

/* ------------------------------------------------------------------ one step */
function StepRow({ s, ctx }: { s: Step; ctx: Ctx }) {
  const { d, gate } = ctx;
  const nameOf = useNameOf();
  const closed = isClosed(gate.status);
  const change = canChange(gate);
  const tickTitle = s.status === 'done' ? 'Marked done. Press to reopen' : 'Mark done';
  const auto = autoAction(gate, s);
  const external = /^https?:/.test(s.link_url);
  const close = () => ctx.setSheet(null);

  const pickOwner = () =>
    ctx.setSheet(
      <PickSheet
        title="Who owns this step"
        current={s.owner_email}
        onClose={close}
        onPick={(email) => {
          close();
          void ctx.patch(s, { owner_email: email });
        }}
      />
    );

  return (
    <li className={'ob-step' + (s.status === 'done' ? ' is-done' : '') + (s.status === 'skipped' ? ' is-skip' : '') + (s.overdue ? ' is-late' : '')} data-id={s.id} data-key={s.key}>
      <button type="button" className="ob-tick" aria-pressed={s.status === 'done'} aria-label={`${tickTitle}: ${s.title}`} disabled={!canTick(gate, s)} onClick={() => void ctx.patch(s, { status: s.status === 'done' ? 'open' : 'done' })}>
        <Ic name="check" />
      </button>
      <div className="ob-step__body">
        <div className="ob-step__title">
          <span>{s.title}</span>
          {s.status === 'skipped' ? <span className="ob-chip">Skipped</span> : null}
        </div>
        {s.detail ? <p className="ob-step__detail">{s.detail}</p> : null}
        {s.key === 'file' && d.docs.length ? (
          <details className="ob-docs" open={ctx.docsOpen} onToggle={(e) => ctx.setDocsOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>
              HR file, {docsGot(d.docs)} of {d.docs.length} received
            </summary>
            <ul>
              {d.docs.map((x) => (
                <li key={x.key}>
                  <label className="ob-check">
                    <input
                      type="checkbox"
                      checked={x.got}
                      disabled={!(gate.manage || s.mine)}
                      onChange={(e) => {
                        ctx.setDocsOpen(true);
                        void ctx.act(() => sendJson(`runs/${ctx.id}/docs/${encodeURIComponent(x.key)}`, 'PUT', { got: e.target.checked }));
                      }}
                    />{' '}
                    {x.label}
                  </label>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="ob-step__meta">
          {change ? (
            <button type="button" className="ob-owner" aria-label={`Change the owner, now ${s.owner_name || 'nobody'}`} onClick={pickOwner}>
              <OwnerFace s={s} />
            </button>
          ) : (
            <span className="ob-owner ob-owner--static">
              <OwnerFace s={s} />
            </span>
          )}
          {s.fallback ? (
            <span className="ob-chip ob-chip--sun" title="No owner is set for this duty, so the step went to whoever started the run">
              No owner set
            </span>
          ) : null}
          <DueChip s={s} ctx={ctx} />
          {s.link_url ? (
            <a className="ob-link" href={s.link_url} {...(external ? { target: '_blank', rel: 'noopener' } : {})}>
              <Ic name="link" />
              {s.link_label || 'Open'}
            </a>
          ) : null}
          {auto === 'hubadd' ? (
            <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => ctx.setSheet(<HubAddSheet ctx={ctx} />)}>
              <Ic name="spark" />
              Add to FavorOS
            </button>
          ) : null}
          {auto === 'hubclose' ? (
            <button type="button" className="h-btn h-btn--primary h-btn--sm ob-danger" onClick={() => ctx.setSheet(<HubCloseSheet ctx={ctx} />)}>
              <Ic name="door" />
              Close FavorOS access
            </button>
          ) : null}
          {auto === 'handover' ? (
            <button type="button" className="h-btn h-btn--primary h-btn--sm" onClick={() => ctx.setSheet(<HandOverPick ctx={ctx} />)}>
              <Ic name="user" />
              Hand over open work
            </button>
          ) : null}
          {gate.manage && !closed && s.status === 'open' ? (
            <button type="button" className="ob-ghost" onClick={() => void ctx.patch(s, { status: 'skipped' })}>
              Skip
            </button>
          ) : s.status === 'skipped' && gate.manage && !closed ? (
            <button type="button" className="ob-ghost" onClick={() => void ctx.patch(s, { status: 'open' })}>
              Bring back
            </button>
          ) : null}
        </div>
        {s.done_at && s.status === 'done' ? (
          <small className="ob-step__done">
            Done {etTime(s.done_at)}
            {s.done_by ? ' by ' + nameOf(s.done_by) : ''}
          </small>
        ) : null}
      </div>
    </li>
  );
}

function OwnerFace({ s }: { s: Step }) {
  return s.owner_email ? (
    <>
      <Avatar email={s.owner_email} size="sm" />
      <span>{s.owner_name}</span>
    </>
  ) : (
    <span>Nobody</span>
  );
}

function DueChip({ s, ctx }: { s: Step; ctx: Ctx }) {
  const { gate } = ctx;
  const open = () => ctx.setSheet(<DueSheet s={s} ctx={ctx} />);
  if (!s.due_date) return gate.manage ? (
    <button type="button" className="ob-due" onClick={open}>
      Set a date
    </button>
  ) : null;
  const cls = s.overdue ? ' is-late' : '';
  const word = dueWord(s);
  return canChange(gate) ? (
    <button type="button" className={'ob-due' + cls} aria-label={`${word}, change the date`} onClick={open}>
      {word}
    </button>
  ) : (
    <span className={'ob-due' + cls}>{word}</span>
  );
}

/* ------------------------------------------------------------------ the side column */
function Aside({ ctx, owned }: { ctx: Ctx; owned: Owned | null }) {
  const { d } = ctx;
  const r = d.run;
  const [welcome, setWelcome] = useState(r.welcome);
  useEffect(() => setWelcome(r.welcome), [r.welcome]);
  const person = (e: string, why: string) =>
    e && d.people[e] ? (
      <li key={why}>
        <Avatar email={e} size="sm" />
        <span>
          <b>{d.people[e].name}</b>
          <small>{why}</small>
        </span>
      </li>
    ) : null;
  const edit = d.can.manage && r.status === 'active';
  return (
    <aside className="ob-side">
      <section className="ob-card">
        <h3>People</h3>
        <ul className="ob-people">
          {person(r.email, r.kind === 'onboard' ? 'Starting' : 'Leaving')}
          {person(r.supervisor_email, 'Supervisor')}
          {person(r.created_by, 'Started the run')}
        </ul>
        {r.kind === 'onboard' ? (
          <NavLink className="ob-link" href="/welcome/">
            <Ic name="link" />
            First-day page
          </NavLink>
        ) : null}
      </section>
      {r.kind === 'onboard' ? (
        <section className="ob-card">
          <h3>First-day note</h3>
          {edit ? (
            <>
              <textarea className="ob-in" id="ob-welcome" rows={4} maxLength={1200} aria-label="Note on the first-day page" value={welcome} onChange={(e) => setWelcome(e.target.value)} />
              <button
                type="button"
                className="rt-btn rt-btn--sm"
                onClick={() => {
                  void ctx.act(() => sendJson(`runs/${ctx.id}`, 'PATCH', { welcome })).then((out) => {
                    if (out) toast('Saved');
                  });
                }}
              >
                Save the note
              </button>
            </>
          ) : (
            <p>{r.welcome || 'No note.'}</p>
          )}
        </section>
      ) : null}
      {r.kind === 'offboard' && owned ? <OwnedCard ctx={ctx} o={owned} /> : null}
      <section className="ob-card">
        <h3>History</h3>
        <ul className="ob-log">
          {d.events.slice(0, 12).map((e, i) => (
            <li key={i}>
              <span>{eventLine(e)}</span>
              <small>{etTime(e.at)}</small>
            </li>
          ))}
          {d.events.length ? null : <li className="mute">Nothing yet.</li>}
        </ul>
      </section>
    </aside>
  );
}

function OwnedCard({ ctx, o }: { ctx: Ctx; o: Owned }) {
  const n = (count: number, label: string) => (
    <div className="ob-own__n">
      <b>{count}</b>
      <span>{label}</span>
    </div>
  );
  const more = (len: number) => (len > 6 ? <li className="mute">and {len - 6} more</li> : null);
  return (
    <section className="ob-card">
      <h3>Still theirs</h3>
      <div className="ob-own">
        {n(o.counts.tasks, 'open tasks')}
        {n(o.counts.requests, 'request cards')}
        {n(o.counts.reports, 'direct reports')}
        {n(o.learn, 'in Learn')}
      </div>
      {o.tasks.length ? (
        <>
          <h4>Tasks</h4>
          <ul className="ob-own__list">
            {o.tasks.slice(0, 6).map((t) => (
              <li key={t.id}>
                {t.code ? <span className="ob-chip ob-chip--mono">{t.code}</span> : null} {t.title}
              </li>
            ))}
            {more(o.tasks.length)}
          </ul>
        </>
      ) : null}
      {o.requests.length ? (
        <>
          <h4>Request cards</h4>
          <ul className="ob-own__list">
            {o.requests.slice(0, 6).map((r) => (
              <li key={r.id}>{r.title}</li>
            ))}
            {more(o.requests.length)}
          </ul>
        </>
      ) : null}
      {o.reports.length ? (
        <>
          <h4>Direct reports</h4>
          <ul className="ob-own__list">
            {o.reports.slice(0, 6).map((r) => (
              <li key={r.email}>{r.name}</li>
            ))}
            {more(o.reports.length)}
          </ul>
        </>
      ) : null}
      {canChange(ctx.gate) && (o.counts.tasks || o.counts.requests || o.counts.reports) ? (
        <button type="button" className="rt-btn rt-btn--sm" onClick={() => ctx.setSheet(<HandOverPick ctx={ctx} />)}>
          Hand over
        </button>
      ) : null}
      <p className="ob-note">Blackbaud assignments and partners are a step on the list. Credit for gifts dated in their time stays with them.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ sheets */
function Buttons({ no, yes, onNo, onYes, danger, disabled }: { no: string; yes: string; onNo: () => void; onYes: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <>
      <button type="button" className="rt-btn" onClick={onNo}>
        {no}
      </button>
      <button type="button" className={'rt-btn rt-btn--primary' + (danger ? ' ob-danger' : '')} disabled={disabled} onClick={onYes}>
        {yes}
      </button>
    </>
  );
}

function DueSheet({ s, ctx }: { s: Step; ctx: Ctx }) {
  const [v, setV] = useState(s.due_date || '');
  const close = () => ctx.setSheet(null);
  return (
    <Sheet
      title={s.title}
      onClose={close}
      foot={
        <Buttons
          no="Cancel"
          yes="Save"
          onNo={close}
          onYes={() => {
            close();
            void ctx.patch(s, { due_date: v || null });
          }}
        />
      }
    >
      <label className="ob-lab">
        Due date
        <input className="ob-in" type="date" id="ob-due" value={v} onChange={(e) => setV(e.target.value)} />
      </label>
    </Sheet>
  );
}

function AddStepSheet({ ctx }: { ctx: Ctx }) {
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [grp, setGrp] = useState(ctx.d.groups[0]?.key || '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => ctx.setSheet(null);
  const add = async () => {
    setBusy(true);
    setErr('');
    try {
      const out = await sendJson(`runs/${ctx.id}/steps`, 'POST', { title, detail, owner_email: owner, due_date: due, grp });
      ctx.setSheet(null);
      // The answer is the run with its new step.
      await ctx.act(async () => out);
      toast('Step added');
    } catch (e) {
      setBusy(false);
      setErr((e as Error).message);
    }
  };
  return (
    <Sheet title="Add a step" onClose={close} foot={<Buttons no="Cancel" yes="Add the step" onNo={close} onYes={add} disabled={busy} />}>
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
        <div className="ob-lab">
          Owner
          <div>
            <PersonField value={owner} onChange={setOwner} label="Owner" placeholder="You, if left empty" />
          </div>
        </div>
        <div className="ob-2">
          <label className="ob-lab">
            Due date
            <input className="ob-in" name="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="ob-lab">
            Phase
            <select className="ob-in" name="grp" value={grp} onChange={(e) => setGrp(e.target.value)}>
              {ctx.d.groups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>
    </Sheet>
  );
}

function CancelSheet({ ctx }: { ctx: Ctx }) {
  const close = () => ctx.setSheet(null);
  return (
    <Sheet
      title="Cancel this run"
      onClose={close}
      foot={
        <Buttons
          no="Keep it"
          yes="Cancel the run"
          danger
          onNo={close}
          onYes={() => {
            close();
            void ctx.act(() => sendJson(`runs/${ctx.id}`, 'PATCH', { status: 'cancelled' }));
          }}
        />
      }
    >
      <p className="ob-p">The record stays. Open tasks in Projects are dropped.</p>
    </Sheet>
  );
}

function ResultSheet({ title, items, ctx }: { title: string; items: DoneItem[]; ctx: Ctx }) {
  const close = () => ctx.setSheet(null);
  return (
    <Sheet
      title={title}
      onClose={close}
      foot={
        <button type="button" className="rt-btn rt-btn--primary" onClick={close}>
          Done
        </button>
      }
    >
      <ul className="ob-res">
        {items.map((i, n) => (
          <li key={n} className={'is-' + i.state}>
            <span>{i.state === 'done' ? <Ic name="check" /> : i.state === 'failed' ? <Ic name="x" /> : <Ic name="chev" />}</span>
            <div>
              <b>{i.what}</b>
              {i.note ? <small>{i.note}</small> : null}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function HubAddSheet({ ctx }: { ctx: Ctx }) {
  const r = ctx.d.run;
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const close = () => ctx.setSheet(null);
  const who = first(r.name);
  const go = async () => {
    setBusy(true);
    const out = await ctx.act(() => sendJson(`runs/${ctx.id}/hub`, 'POST', { action: 'add', confirm: true, emailWelcome: mail }));
    const result = out && (out.result as { items: DoneItem[] } | undefined);
    ctx.setSheet(result ? <ResultSheet title={'FavorOS is ready for ' + who} items={result.items} ctx={ctx} /> : null);
  };
  return (
    <Sheet title="Add to FavorOS" onClose={close} foot={<Buttons no="Cancel" yes="Add to FavorOS" onNo={close} onYes={go} disabled={busy} />}>
      <p className="ob-p">
        FavorOS makes these changes for {r.name} ({r.email}).
      </p>
      <ul className="ob-do">
        {hubAddLines(ctx.d).map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <label className="ob-check">
        <input type="checkbox" id="ob-mailhire" checked={mail} onChange={(e) => setMail(e.target.checked)} /> Email {who} the link to the first-day page
      </label>
    </Sheet>
  );
}

function HubCloseSheet({ ctx }: { ctx: Ctx }) {
  const r = ctx.d.run;
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => ctx.setSheet(null);
  const go = async () => {
    setBusy(true);
    const out = await ctx.act(() => sendJson(`runs/${ctx.id}/hub`, 'POST', { action: 'close', confirm: true }));
    const result = out && (out.result as { items: DoneItem[] } | undefined);
    ctx.setSheet(result ? <ResultSheet title="FavorOS access closed" items={result.items} ctx={ctx} /> : null);
  };
  return (
    <Sheet title="Close FavorOS access" onClose={close} foot={<Buttons no="Cancel" yes="Close access" danger onNo={close} onYes={go} disabled={!sure || busy} />}>
      <p className="ob-p">
        Do this on {dayWord(r.date, true)}, {r.name}’s last day.
      </p>
      <ul className="ob-do">
        {CLOSE_LINES.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="ob-p">Their tasks and request cards stay where they are until you hand them over. The Google account, Blackbaud and the other systems are separate steps on the list.</p>
      <label className="ob-check">
        <input type="checkbox" id="ob-sure" checked={sure} onChange={(e) => setSure(e.target.checked)} /> {r.name} is leaving and their FavorOS access should close
      </label>
    </Sheet>
  );
}

/** Step one of a hand over: who takes the work. */
function HandOverPick({ ctx }: { ctx: Ctx }) {
  const r = ctx.d.run;
  return <PickSheet title="Who takes over their work" exclude={[r.email]} onClose={() => ctx.setSheet(null)} onPick={(email) => ctx.setSheet(<HandOverSheet ctx={ctx} to={email} />)} />;
}

function HandOverSheet({ ctx, to }: { ctx: Ctx; to: string }) {
  const people = usePeople();
  const cached = useQuery({ ...ownedQuery(ctx.id), enabled: false }).data;
  const o = cached || { counts: { tasks: 0, requests: 0, reports: 0 } };
  const name = personIn(people, to).name;
  const [w, setW] = useState({ tasks: true, requests: true, reports: true });
  const [busy, setBusy] = useState(false);
  const close = () => ctx.setSheet(null);
  const row = (k: 'tasks' | 'requests' | 'reports', n: number, l: string) => (
    <label className="ob-check">
      <input type="checkbox" checked={w[k]} disabled={!n} onChange={(e) => setW({ ...w, [k]: e.target.checked })} /> {n} {l}
    </label>
  );
  const go = async () => {
    setBusy(true);
    const out = await ctx.act(() => sendJson(`runs/${ctx.id}/handover`, 'POST', { to, ...w }));
    ctx.setSheet(null);
    if (out && out.moved) toast(moveWord(out.moved as { tasks: number; requests: number; reports: number }, name));
  };
  return (
    <Sheet title="Hand over open work" onClose={close} foot={<Buttons no="Cancel" yes="Hand over" onNo={close} onYes={go} disabled={busy} />}>
      <p className="ob-p">Move to {name}. Nothing is deleted.</p>
      {row('tasks', o.counts.tasks, 'open tasks in Projects')}
      {row('requests', o.counts.requests, 'request cards')}
      {row('reports', o.counts.reports, 'people who report to them, so their supervisor changes')}
    </Sheet>
  );
}

