// Pieces shared by the list, the board, My tasks and the drawer: the check, code chips, due and owner buttons. Same markup and class
// names as public/js/projects/ui-rows.js. Buttons carry data-act so a list can answer clicks with one delegated handler, as before.
import { dueLabel, isOverdue, PRIORITY, todayStr } from '../lib/dates';
import type { Person, Task } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { CODE_KINDS } from './pickers';

export const KIND_LABEL: Record<string, string> = Object.fromEntries(CODE_KINDS.map((k) => [k.kind, k.label]));

export function CheckBtn({ t }: { t: Pick<Task, 'status' | 'title'> }) {
  const done = t.status === 'done';
  return (
    <button type="button" className={'pj-check' + (done ? ' is-on' : '')} data-act="done" data-ui-tooltip="pj-tip" role="checkbox" aria-checked={done} aria-label={(done ? 'Mark not done' : 'Mark done') + ': ' + t.title}>
      <Icon name="check" />
    </button>
  );
}

/** The task's codes as small chips. max limits how many show; the rest collapse into +n. */
export function CodeChips({ t, max = 4 }: { t: Task; max?: number }) {
  const list = CODE_KINDS.filter((k) => t[k.field]).map((k) => ({ k, v: t[k.field] as string }));
  if (!list.length) return null;
  return (
    <span className="pj-codes">
      {list.slice(0, max).map((c) => (
        <span key={c.k.kind} className="pj-code" data-k={c.k.kind} title={`${c.k.label} code ${c.v}`}>
          {c.v}
        </span>
      ))}
      {list.length > max ? (
        <span className="pj-code pj-code--more" title={list.slice(max).map((c) => c.k.label + ' ' + c.v).join(', ')}>
          +{list.length - max}
        </span>
      ) : null}
    </span>
  );
}

export function DueTag({ t }: { t: Pick<Task, 'due_date' | 'due_time' | 'status'> }) {
  if (!t.due_date) return null;
  const late = isOverdue(t as { due_date: string; status: string });
  return <span className={'pj-due' + (late ? ' is-late' : '') + (t.due_date === todayStr() && t.status !== 'done' ? ' is-today' : '')}>{dueLabel(t.due_date, t.due_time)}</span>;
}

export function Counts({ t }: { t: Task }) {
  return (
    <>
      {t.subtasks && t.subtasks.total ? (
        <span className="pj-cnt" title={`${t.subtasks.done} of ${t.subtasks.total} subtasks done`}>
          <Icon name="sub" />
          {t.subtasks.done}/{t.subtasks.total}
        </span>
      ) : null}
      {t.comments ? (
        <span className="pj-cnt" title={`${t.comments} comments`}>
          <Icon name="comment" />
          {t.comments}
        </span>
      ) : null}
      {t.files ? (
        <span className="pj-cnt" title={`${t.files} files`}>
          <Icon name="file" />
          {t.files}
        </span>
      ) : null}
    </>
  );
}

export function ProjChip({ t }: { t: Task }) {
  const p = t.project;
  if (!p) return null;
  return (
    <span className="pj-pchip" data-c={p.color || 'leaf'} title={p.name}>
      <i className="pj-dot" data-c={p.color || 'leaf'} />
      {p.key}
    </span>
  );
}

export function StateTag({ t }: { t: Task }) {
  return (
    <>
      {t.blocked ? (
        <span className="pj-tag pj-tag--blocked" title="Waiting on another task">
          <Icon name="block" />
          Blocked
        </span>
      ) : null}
      {t.status === 'waiting' ? (
        <span className="pj-tag pj-tag--wait" title="Waiting">
          <Icon name="hourglass" />
          Waiting
        </span>
      ) : null}
      {t.status === 'doing' ? <span className="pj-tag pj-tag--doing">In progress</span> : null}
    </>
  );
}
export const hasStateTag = (t: Task) => !!(t.blocked || t.status === 'waiting' || t.status === 'doing');

export function PriorityIcon({ t }: { t: Pick<Task, 'priority'> }) {
  if (!t.priority || t.priority === 'normal') return null;
  return (
    <span className={'pj-pri pj-pri--' + t.priority} title={`${PRIORITY[t.priority]} priority`}>
      <Icon name="flag" />
    </span>
  );
}

export function OwnerBtn({ t, size }: { t: Pick<Task, 'owner'>; size?: string }) {
  const o = t.owner as Person | null;
  return (
    <button type="button" className="pj-owner" data-act="owner" data-ui-tooltip="pj-tip" aria-label={o ? 'Owner ' + o.name : 'No owner. Assign'}>
      <Avatar p={o} size={size} />
    </button>
  );
}

// A task made from a meeting's action item names the meeting, and opens its notes.
export function FromMeeting({ t }: { t: Task }) {
  if (!t.meeting) return null;
  return (
    <a className="pj-from" href={'/meet/notes/?m=' + t.meeting.id} title="Made from this meeting">
      <Icon name="cal" />
      {t.meeting.title}
    </a>
  );
}

/** What a row draws from, as one string. A row skips drawing when this has not changed. */
export const taskSig = (t: Task, extra = ''): string =>
  [t.title, t.status, t.due_date, t.due_time, t.priority, t.owner_email || '', t.section_id || '', t.code, t.appeal_code, t.source_code, t.fund_code, t.campaign_code, t.subtasks ? t.subtasks.done + '/' + t.subtasks.total : '', t.comments, t.files, t.blocked, t.overdue, t.pending ? 'p' : '', t.project ? t.project.key : '', t.meeting ? t.meeting.id : '', extra].join('|');
