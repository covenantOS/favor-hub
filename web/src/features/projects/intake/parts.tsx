// Small pieces the request screens share: the four stops, the status word, the question and decline notes, read-only chips and the
// request's files. Class names are the ik-* ones in intake.css (the drawer panel in slot.tsx uses the same).
import { STOPS, type IntakeItem } from '@shared/intake-model';
import { kindLabel } from '@shared/request-parse';
import { ago, shortDate } from '../lib/dates';
import { fullDate } from './logic';

export function Word({ item }: { item: Pick<IntakeItem, 'status' | 'word'> }) {
  return <span className={`ik-word ik-word--${item.status}`}>{item.word}</span>;
}

/** Sent, Approved, In progress, Done with the one the request is at marked. A declined request has none. */
export function StopBar({ item }: { item: Pick<IntakeItem, 'status' | 'steps'> }) {
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

export function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="ik-chip">
      <i>{label}</i>
      {value}
    </span>
  );
}

/** The six answers a request was sent with, as read-only chips. */
export function ChipRow({ item }: { item: IntakeItem }) {
  return (
    <div className="ik-chips" aria-label="How it was sorted">
      <Chip label="Goes to" value={item.team_name} />
      <Chip label="Kind" value={kindLabel(item.kind)} />
      <Chip label="Where" value={item.place_label} />
      {item.audience ? <Chip label="Who sees it" value={item.audience} /> : null}
      {item.due_date ? <Chip label="Needed by" value={fullDate(item.due_date)} /> : null}
      {item.assignee_hint ? <Chip label="Asked for" value={item.assignee_hint.name} /> : null}
    </div>
  );
}

/** The question for the person who asked, and the reason a request was declined. */
export function Notes({ item, asker }: { item: IntakeItem; asker?: boolean }) {
  const first = (item.submitter?.name || '').split(/\s+/)[0];
  return (
    <>
      {item.declined_reason ? (
        <div className="ik-q ik-q--no" role="note">
          <b>Declined</b>
          <p>{item.declined_reason}</p>
        </div>
      ) : null}
      {item.question && item.status !== 'declined' ? (
        <div className="ik-q" role="note">
          <b>Question for {asker ? 'you' : first || 'the person who asked'}</b>
          <p>{item.question.body}</p>
          <span>
            {item.question.by.name}, <time dateTime={item.question.at} suppressHydrationWarning>{ago(item.question.at)}</time>
          </span>
        </div>
      ) : null}
    </>
  );
}
