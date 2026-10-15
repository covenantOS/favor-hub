/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { MI } from './util';
import { Sheet } from './Sheet';

/** What GET threads/:id says about moving this conversation to Chat. The server decides; the page only shows it. */
export interface TeamState {
  ok: boolean;
  people: Array<{ email: string; name: string }>;
  state: '' | 'moved' | 'dismissed';
  channel: string;
  link: string;
}

export const teamOf = (d: any): TeamState | null => (d && d.teamChat && d.teamChat.ok ? (d.teamChat as TeamState) : null);

interface Props {
  team: TeamState | null;
  threadId: string;
  me: string;
  api: () => any;
  say: (msg: string) => void;
  failed: (e: any, what?: string) => void;
  onChange: (t: TeamState | null) => void;
}

/** One quiet line in the assist area: "This is a team conversation. Continue in Chat?" with Move to Chat and a dismiss X. */
export function TeamChatLine({ team, threadId, me, api, say, failed, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { link: string }>(null);
  const [note, setNote] = useState(false);
  const [sending, setSending] = useState(false);
  if (!team || !team.ok || team.state === 'dismissed') return null;
  const others = team.people.filter((p) => p.email !== me).map((p) => p.name || p.email);

  const move = () => {
    if (busy) return;
    setBusy(true);
    api()
      .moveToChat(threadId, false)
      .then((d: any) => {
        onChange({ ...team, state: 'moved', link: d.link, channel: d.channel });
        setNote(false);
        setDone({ link: d.link });
      })
      .catch((e: any) => {
        if (e && e.code === 'not_team') onChange(null);
        say(e && e.message ? e.message : 'That did not work. Try again.');
      })
      .finally(() => setBusy(false));
  };
  const dismiss = () => {
    onChange({ ...team, state: 'dismissed' });
    void api().chatDismiss(threadId).catch(() => undefined);
  };
  const finish = (then: () => void) => {
    if (!note || sending) return then();
    setSending(true);
    api()
      .chatNote(threadId)
      .then(() => say('Note posted in the email thread'))
      .catch((e: any) => failed(e, 'send'))
      .finally(() => {
        setSending(false);
        then();
      });
  };

  return (
    <>
      <div className="ml-team">
        <span className="ml-team__t">
          <MI n="chat" />
          <span>{team.state === 'moved' ? 'This conversation moved to Chat.' : 'This is a team conversation. Continue in Chat?'}</span>
        </span>
        {team.state === 'moved' ? (
          <a className="ml-btn" href={team.link}>
            Open in Chat
          </a>
        ) : (
          <>
            <button type="button" className="ml-btn" onClick={move} disabled={busy}>
              {busy ? 'Moving' : 'Move to Chat'}
            </button>
            <button type="button" className="ml-iconbtn" onClick={dismiss} aria-label="Hide this suggestion" title="Hide this suggestion">
              <MI n="x" />
            </button>
          </>
        )}
      </div>
      {done && (
        <Sheet title="Moved to Chat" onClose={() => finish(() => setDone(null))}>
          <p className="ml-p">The email history is posted and pinned in Chat with {others.join(', ')}.</p>
          <label className="ml-menu__i ml-check ml-check--wrap">
            <input type="checkbox" checked={note} onChange={(e) => setNote(e.target.checked)} />
            <span>Post a note in the email thread that this moved to Chat</span>
          </label>
          <div className="ml-sheet__acts">
            <button type="button" className="ml-btn" onClick={() => finish(() => setDone(null))} disabled={sending}>
              Done
            </button>
            <a
              className="ml-btn ml-btn--primary"
              href={done.link}
              onClick={(e) => {
                e.preventDefault();
                const href = done.link;
                finish(() => {
                  window.location.href = href;
                });
              }}
            >
              Open in Chat
            </a>
          </div>
        </Sheet>
      )}
    </>
  );
}
