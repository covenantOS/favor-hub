// My requests: the person's own requests with the four-stop status, who has it, the due date, the question waiting on them (with an
// inline answer box), the reason for a decline, and Open for the whole conversation. The person who asked cannot open the team's
// card, so Open shows the request itself here: the words, the files, the notes and the history. ?r=<request id> opens one.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Avatar } from '../kit/Avatar';
import { CommentComposer, CommentText } from '../kit/mention';
import { toast } from '../kit/toast';
import { useStaff } from '../lib/staff';
import { useSearchParams, useSetSearch } from '../lib/url';
import type { IntakeItem } from '@shared/intake-model';
import { intakeApi, intakeKeys } from './api';
import { fullDate, isOpen, lastMove, orderMine, standingLine, when } from './logic';
import { ChipRow, Notes, StopBar, Word } from './parts';
import { intakeDetailQuery, intakeMineQuery } from './queries';
import './intake.css';

export function MyRequests() {
  const q = useSuspenseQuery(intakeMineQuery);
  const search = useSearchParams();
  const setSearch = useSetSearch();
  // ?r=<id> (a link to one request) opens it here; Open and Close on a card change it without touching the address, because the
  // address with ?r= means "show me this request" to the home page, which opens a triager's card in the drawer.
  const link = search.get('r') || '';
  const [open, setOpen] = useState(link);
  useEffect(() => {
    if (link) setOpen(link);
  }, [link]);
  const list = orderMine(q.data.items);

  if (q.data.error) {
    return (
      <div className="pj-empty pj-empty--err">
        <p>{q.data.error}</p>
        <button type="button" className="pj-btn" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!list.length) {
    return <div className="ik-fallback">You have not sent a request yet. Press Make a request.</div>;
  }
  return (
    <div className="ik-mine">
      {list.map((r) => (
        <Card
          key={r.id}
          item={r}
          expanded={open === r.id}
          onToggle={() => {
            setOpen(open === r.id ? '' : r.id);
            if (link === r.id) setSearch((p) => p.delete('r'), 'replace');
          }}
        />
      ))}
    </div>
  );
}

function Card({ item, expanded, onToggle }: { item: IntakeItem; expanded: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView({ block: 'nearest' });
    // only when it opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  const asked = !!item.question && isOpen(item.status);
  const move = lastMove(item);
  return (
    <article className="ik-mc" ref={ref} data-request={item.id} aria-label={item.title}>
      <div className="ik-top">
        <h3>{item.title}</h3>
        <Word item={item} />
      </div>
      <StopBar item={item} />
      <Notes item={item} asker />
      {asked ? <Reply item={item} /> : null}
      <div className="ik-meta">
        <span className="ik-meta__who">
          {item.owner && item.status !== 'declined' ? <Avatar p={item.owner} size="sm" /> : null}
          {standingLine(item)}
        </span>
        {item.due_date && isOpen(item.status) ? <span>Due {fullDate(item.due_date)}</span> : null}
        <span className="ik-muted">
          Sent <time dateTime={item.created_at} suppressHydrationWarning>{when(item.created_at)}</time>
        </span>
        {move ? <span className="ik-muted">{move}</span> : null}
        <button type="button" className="ik-open" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Close' : 'Open'}
        </button>
      </div>
      {expanded ? <Detail item={item} /> : null}
    </article>
  );
}

/** The answer box under a question. The owner is told when it is sent. */
function Reply({ item }: { item: IntakeItem }) {
  const qc = useQueryClient();
  const [v, setV] = useState('');
  const who = (item.question?.by.name || '').split(/\s+/)[0];
  const go = useMutation({
    mutationFn: () => intakeApi.reply(item.id, v.trim()),
    onSuccess: async () => {
      setV('');
      await qc.invalidateQueries({ queryKey: intakeKeys.all });
      toast('Sent.' + (who ? ' ' + who + ' is told.' : ''));
    },
    onError: (e) => toast((e as Error).message || 'That did not send. Try again.', { error: true }),
  });
  return (
    <form
      className="ik-reply"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim() && !go.isPending) go.mutate();
      }}
    >
      <input className="pj-field" aria-label="Your answer" placeholder="Your answer" value={v} maxLength={2000} onChange={(e) => setV(e.target.value)} />
      <button type="submit" className="pj-btn pj-btn--primary" disabled={!v.trim() || go.isPending}>
        {go.isPending ? 'Sending' : 'Send'}
      </button>
    </form>
  );
}

/** The request opened: the words, how it was sorted, the files, the conversation and the history. */
function Detail({ item }: { item: IntakeItem }) {
  const staff = useStaff();
  const qc = useQueryClient();
  const q = useQuery(intakeDetailQuery(item.id));
  const d = q.data;
  if (q.isPending) return <div className="ik-skel" aria-busy="true" />;
  if (!d) return <p className="ik-fact">This request did not load. Close it and open it again.</p>;
  const closed = d.item.status === 'done' || d.item.status === 'declined';
  return (
    <div className="ik-detail">
      <div className="ik-words">{d.item.body}</div>
      {d.attachments.length ? (
        <ul className="ik-files" aria-label="Files">
          {d.attachments.map((a) => (
            <li key={a.id}>
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.filename}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <h4 className="ik-h">How it was sorted</h4>
      <ChipRow item={d.item} />
      <h4 className="ik-h">Conversation</h4>
      <div className="ik-talk">
        {d.comments.length ? (
          <ul className="ik-comments">
            {d.comments.map((c) => (
              <li key={c.id} className={c.mine ? 'is-mine' : ''}>
                <Avatar p={{ email: c.by.email, name: c.by.name }} size="sm" />
                <div>
                  <b>{c.by.name}</b> <time dateTime={c.at} suppressHydrationWarning>{when(c.at)}</time>
                  <CommentText body={c.body} me={staff.me} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ik-fact">No messages yet.</p>
        )}
        {closed ? null : (
          <CommentComposer
            placeholder="Add a note"
            onSend={async (text) => {
              await intakeApi.reply(item.id, text);
              await qc.invalidateQueries({ queryKey: intakeKeys.all });
            }}
          />
        )}
      </div>
      {d.item.moves.length ? (
        <>
          <h4 className="ik-h">History</h4>
          <ul className="ik-moves">
            <li>
              Sent {when(d.item.created_at)}
            </li>
            {d.item.moves.map((m, i) => (
              <li key={i}>
                {m.text} <time dateTime={m.at} suppressHydrationWarning>{when(m.at)}</time>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
