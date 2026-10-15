// What the task drawer shows for a card that came in as a request (task.request_id): who asked, where the request stands, the question
// if one is open, the owner's three actions (Accept, Ask a question, Decline), the conversation and the history. The drawer renders
// <IntakeSlot task={task} ctx={ctx} /> between the fields and the description and it draws nothing for any other task.
// A person who may not read the request (the card was accepted into a project they work in, and they do not triage that team) sees
// nothing here: the server answers 404 and the card's own description already carries the words.
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskCtx } from '../lib/store';
import type { Task } from '../types';
import { ago, shortDate } from '../lib/dates';
import { Avatar } from '../kit/Avatar';
import { CommentText, CommentComposer } from '../kit/mention';
import { toast } from '../kit/toast';
import { openDrawer } from '../drawer/state';
import { useStaff } from '../lib/staff';
import { openFocus } from './Focus';
import { STOPS, type IntakeDetail, type IntakeItem } from '@shared/intake-model';
import { intakeApi, intakeKeys } from './api';
import './intake.css';

type Panel = null | 'accept' | 'ask' | 'decline';

export function IntakeSlot({ task, ctx }: { task: Task; ctx: TaskCtx | null }) {
  if (!task.request_id) return null;
  return <Slot key={task.request_id} requestId={task.request_id} task={task} ctx={ctx} />;
}

function Slot({ requestId, task, ctx }: { requestId: string; task: Task; ctx: TaskCtx | null }) {
  const qc = useQueryClient();
  const staff = useStaff();
  const q = useQuery({ queryKey: intakeKeys.request(requestId), queryFn: () => intakeApi.request(requestId), retry: false, staleTime: 5_000 });
  const [panel, setPanel] = useState<Panel>(null);
  const d = q.data as ({ ok: true } & IntakeDetail) | undefined;
  if (q.isPending) return <section className="pj-dr__sec ik-slot" aria-busy="true"><div className="ik-skel" /></section>;
  if (!d) return null;
  const it = d.item;
  const open = it.status === 'inbox' || it.status === 'approved' || it.status === 'in_progress';

  // After a change the list, the board and the drawer all read the new place of the card.
  const changed = async (msg: string) => {
    setPanel(null);
    await qc.invalidateQueries({ queryKey: intakeKeys.all });
    await ctx?.reloadTasks().catch(() => undefined);
    void openDrawer(ctx, task.id);
    toast(msg);
  };
  const fail = (e: unknown) => toast((e as Error).message || 'That did not work. Try again.', { error: true });

  return (
    <section className="pj-dr__sec ik-slot" data-intake="">
      <h3 className="rt-h">Request</h3>
      <div className="ik-head">
        <span className={`ik-word ik-word--${it.status}`}>{it.word}</span>
        {it.submitter ? (
          <span className="ik-from">
            <Avatar p={it.submitter} size="sm" />
            <span>
              From {it.submitter.name}
              <time dateTime={it.created_at}> {ago(it.created_at)}</time>
            </span>
          </span>
        ) : null}
      </div>
      <Steps item={it} />
      <div className="ik-chips" aria-label="How it was sorted">
        <Chip label="Goes to" value={it.team_name} />
        <Chip label="Kind" value={KIND[it.kind] || it.kind} />
        <Chip label="Where" value={it.place_label} />
        {it.audience ? <Chip label="Who sees it" value={it.audience} /> : null}
        {it.due_date ? <Chip label="Needed by" value={shortDate(it.due_date)} /> : null}
        {it.assignee_hint ? <Chip label="Asked for" value={it.assignee_hint.name} /> : null}
      </div>
      {it.question ? (
        <div className="ik-q" role="note">
          <b>Question for {it.submitter?.name || 'the person who asked'}</b>
          <p>{it.question.body}</p>
          <span>
            {it.question.by.name}, {ago(it.question.at)}
          </span>
        </div>
      ) : null}
      {it.declined_reason ? (
        <div className="ik-q ik-q--no" role="note">
          <b>Declined</b>
          <p>{it.declined_reason}</p>
        </div>
      ) : null}
      {d.standing.triage && open ? <TriageBar item={it} open={panel} setOpen={setPanel} /> : null}
      {open && task.owner_email && task.owner_email.toLowerCase() === staff.me.toLowerCase() ? (
        <div className="ik-bar">
          <button type="button" className="pj-btn" title="Put a busy block on your own calendar, with no guests, to work on this request" onClick={() => openFocus(requestId)}>
            Hold focus time
          </button>
        </div>
      ) : null}
      {panel === 'accept' ? <AcceptPanel item={it} onDone={changed} onError={fail} onCancel={() => setPanel(null)} /> : null}
      {panel === 'ask' ? <AskPanel item={it} onDone={changed} onError={fail} onCancel={() => setPanel(null)} /> : null}
      {panel === 'decline' ? <DeclinePanel item={it} onDone={changed} onError={fail} onCancel={() => setPanel(null)} /> : null}
      {d.attachments.length ? (
        <ul className="ik-files">
          {d.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.filename}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <Conversation d={d} requestId={requestId} onSent={() => qc.invalidateQueries({ queryKey: intakeKeys.request(requestId) })} />
      {it.moves.length ? (
        <ul className="ik-moves" aria-label="History">
          {it.moves.map((m, i) => (
            <li key={i}>
              {m.text}
              <time> {ago(m.at)}</time>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const KIND: Record<string, string> = { change: 'Change or fix', add: 'Something new', other: 'Something else' };

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="ik-chip">
      <i>{label}</i>
      {value}
    </span>
  );
}

/** Sent, Approved, In progress, Done with the one the request is at marked. */
function Steps({ item }: { item: IntakeItem }) {
  if (item.status === 'declined') return null;
  return (
    <ol className="ik-steps" aria-label="Where it stands">
      {item.steps.map((s, i) => (
        <li key={s.key} className={`is-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
          <b>{STOPS[i]}</b>
          {s.at ? <time dateTime={s.at}>{shortDate(s.at.slice(0, 10))}</time> : null}
        </li>
      ))}
    </ol>
  );
}

function TriageBar({ item, open, setOpen }: { item: IntakeItem; open: Panel; setOpen: (p: Panel) => void }) {
  const inbox = item.status === 'inbox';
  const TIPS: Record<string, string> = { accept: 'Put this request in a project with an owner and a due date', ask: 'Send a question to the person who asked. The card stays in Intake until they answer', decline: 'Close this request with a reason the person who asked will read' };
  const btn = (id: Exclude<Panel, null>, label: string, primary = false) => (
    <button type="button" title={TIPS[id]} className={'pj-btn' + (primary ? ' pj-btn--primary' : '') + (open === id ? ' is-on' : '')} aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
      {label}
    </button>
  );
  return (
    <div className="ik-bar" role="group" aria-label="Triage">
      {btn('accept', inbox ? 'Accept' : 'Move or change', inbox)}
      {inbox ? btn('ask', 'Ask a question') : null}
      {btn('decline', 'Decline')}
    </div>
  );
}

type PanelProps = { item: IntakeItem; onDone: (msg: string) => Promise<void>; onError: (e: unknown) => void; onCancel: () => void };

function AcceptPanel({ item, onDone, onError, onCancel }: PanelProps) {
  const staff = useStaff();
  const opts = useQuery({ queryKey: intakeKeys.options(item.id), queryFn: () => intakeApi.options(item.id), staleTime: 30_000 });
  const projects = opts.data?.projects || [];
  const people = opts.data?.people || [];
  const [project, setProject] = useState<string>('');
  const [section, setSection] = useState<string | null>(null);
  const [owner, setOwner] = useState<string>(item.owner?.email || item.assignee_hint?.email || staff.me);
  const [due, setDue] = useState<string>(item.due_date || '');
  const [note, setNote] = useState('');
  const target = projects.find((p) => p.id === (project || item.project?.id)) || projects[0];
  const sectionId = section ?? (target?.pipeline ? target.sections.find((s) => s.name === 'Triage')?.id || '' : '');
  const go = useMutation({
    mutationFn: () => intakeApi.accept(item.id, { project_id: target?.id, section_id: sectionId || undefined, owner_email: owner || undefined, due_date: due || null, note: note.trim() || undefined }),
    onSuccess: (r) => onDone(`Accepted. ${r.request.owner ? r.request.owner.name + ' has it.' : ''}`.trim()),
    onError,
  });
  return (
    <form className="ik-panel" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
      <label className="pj-label" htmlFor="ik-proj">Project</label>
      <select id="ik-proj" className="pj-field" value={target?.id || ''} onChange={(e) => { setProject(e.target.value); setSection(null); }}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {target?.synced ? <p className="ik-fact">This project is linked to Asana, so the task goes there too.</p> : null}
      <label className="pj-label" htmlFor="ik-stage">Stage</label>
      <select id="ik-stage" className="pj-field" value={sectionId} onChange={(e) => setSection(e.target.value)}>
        {target?.pipeline ? null : <option value="">No stage</option>}
        {(target?.sections || []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <label className="pj-label" htmlFor="ik-owner">Owner</label>
      <select id="ik-owner" className="pj-field" value={owner} onChange={(e) => setOwner(e.target.value)}>
        <option value={staff.me}>Me</option>
        {people.filter((p) => p.email.toLowerCase() !== staff.me.toLowerCase()).map((p) => (
          <option key={p.email} value={p.email}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="pj-label" htmlFor="ik-due">Due</label>
      <input id="ik-due" className="pj-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <label className="pj-label" htmlFor="ik-note">Note to {item.submitter?.name || 'the person who asked'} (optional)</label>
      <input id="ik-note" className="pj-field" value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} />
      <Actions busy={go.isPending} label="Accept" onCancel={onCancel} />
    </form>
  );
}

function AskPanel({ item, onDone, onError, onCancel }: PanelProps) {
  const [text, setText] = useState('');
  const go = useMutation({ mutationFn: () => intakeApi.ask(item.id, text), onSuccess: () => onDone('Question sent.'), onError });
  return (
    <form className="ik-panel" onSubmit={(e) => { e.preventDefault(); if (text.trim()) go.mutate(); }}>
      <label className="pj-label" htmlFor="ik-ask">Your question for {item.submitter?.name || 'the person who asked'}</label>
      <textarea id="ik-ask" className="pj-field" rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
      <Actions busy={go.isPending} label="Send question" disabled={!text.trim()} onCancel={onCancel} />
    </form>
  );
}

function DeclinePanel({ item, onDone, onError, onCancel }: PanelProps) {
  const [text, setText] = useState('');
  const go = useMutation({ mutationFn: () => intakeApi.decline(item.id, text), onSuccess: () => onDone('Declined.'), onError });
  return (
    <form className="ik-panel" onSubmit={(e) => { e.preventDefault(); if (text.trim().length > 1) go.mutate(); }}>
      <label className="pj-label" htmlFor="ik-no">Why. {item.submitter?.name || 'The person who asked'} reads this.</label>
      <textarea id="ik-no" className="pj-field" rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} />
      <Actions busy={go.isPending} label="Decline" danger disabled={text.trim().length < 2} onCancel={onCancel} />
    </form>
  );
}

function Actions({ busy, label, disabled, danger, onCancel }: { busy: boolean; label: string; disabled?: boolean; danger?: boolean; onCancel: () => void }): ReactNode {
  return (
    <div className="ik-actions">
      <button type="submit" className={'pj-btn ' + (danger ? 'pj-btn--danger' : 'pj-btn--primary')} disabled={busy || disabled}>
        {busy ? 'Working' : label}
      </button>
      <button type="button" className="pj-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Conversation({ d, requestId, onSent }: { d: { item: IntakeItem; comments: IntakeDetail['comments']; standing: IntakeDetail['standing'] }; requestId: string; onSent: () => void }) {
  const mine = d.standing.submitter;
  const closed = d.item.status === 'done' || d.item.status === 'declined';
  return (
    <div className="ik-talk">
      {d.comments.length ? (
        <ul className="ik-comments">
          {d.comments.map((c) => (
            <li key={c.id} className={c.mine ? 'is-mine' : ''}>
              <Avatar p={{ email: c.by.email, name: c.by.name }} size="sm" />
              <div>
                <b>{c.by.name}</b>
                <time> {ago(c.at)}</time>
                <CommentText body={c.body} me={''} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {closed ? null : (
        <CommentComposer
          placeholder={mine ? 'Reply' : 'Add a note'}
          onSend={async (text) => {
            await intakeApi.reply(requestId, text);
            onSent();
          }}
        />
      )}
    </div>
  );
}
