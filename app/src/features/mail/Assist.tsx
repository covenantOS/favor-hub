/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { MI, when } from './util';

const money = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const shortDay = (iso: string) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export interface AssistState {
  id: string;
  summary: string;
  replies: string[];
  ask: boolean;
  card: any;
  loading: boolean;
  gift: any;
  commitments: any[];
  profile: any;
  files: Record<string, any>;
  answer: string;
  major: boolean;
  logged?: boolean;
}

export const KIND_NAME: Record<string, string> = { check: 'Check', receipt: 'Receipt', w9: 'W-9', grant_letter: 'Grant letter', photo: 'Photo', other: '' };

/* ------------------------------------------------------------------ list header cards */
export function BriefCards({ b, wait, ov, today, onOpen, onFresh, onHide, onNudgeHide, onCleanReview, onCleanDismiss, showBrief, showNudge, showClean }: any) {
  void today;
  return (
    <>
      {showBrief &&
        (!b ? (
          wait ? (
            <div className="ml-brief ml-brief--wait" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : null
        ) : (
          <div className="ml-brief">
            <div className="ml-brief__h">
              <MI n="bolt" />
              <b>This morning</b>
              <button type="button" className="ml-iconbtn" onClick={onFresh} aria-label="Refresh the briefing">
                <MI n="refresh" />
              </button>
              <button type="button" className="ml-iconbtn" onClick={onHide} aria-label="Hide until tomorrow">
                <MI n="x" />
              </button>
            </div>
            <p>{b.text}</p>
            {(b.items || []).length > 0 && (
              <div className="ml-brief__l">
                {b.items.map((i: any) => (
                  <button type="button" className="ml-brief__i" key={i.id} onClick={() => onOpen(i.id)}>
                    <b>{i.from}</b>
                    <span>{i.subject}</span>
                    <em>{i.why}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      {showNudge && ov && ov.unlogged ? (
        <div className="ml-clean ml-clean--nudge">
          <MI n="log" />
          <div className="ml-clean__t">
            <b>
              {ov.unlogged} partner email{ov.unlogged === 1 ? '' : 's'} not logged in Blackbaud
            </b>
            <span>This week</span>
          </div>
          <a className="ml-btn" href="#/unlogged">
            Review
          </a>
          <button type="button" className="ml-iconbtn" onClick={onNudgeHide} aria-label="Not this week">
            <MI n="x" />
          </button>
        </div>
      ) : null}
      {showClean && ov && ov.cleanup && ov.cleanup.total ? (
        <div className="ml-clean">
          <MI n="broom" />
          <div className="ml-clean__t">
            <b>
              {ov.cleanup.total} unread from {ov.cleanup.senders.length} senders you never open
            </b>
            <span>Newsletters and notices, including {ov.cleanup.senders.slice(0, 3).map((x: any) => x.name).join(', ')}.</span>
          </div>
          <button type="button" className="ml-btn" onClick={onCleanReview}>
            Archive all
          </button>
          <button type="button" className="ml-iconbtn" onClick={onCleanDismiss} aria-label="Not now">
            <MI n="x" />
          </button>
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ the conversation's assist panel */
function PartnerCard({ c, p, a, onLog, onTimeline, tl }: { c: any; p: any; a: AssistState; onLog: () => void; onTimeline: () => void; tl: null | { open: boolean; items?: any[]; error?: string } }) {
  const holders = (c.holders || []).map((h: any) => h.name + (h.type ? ' (' + h.type + ')' : '')).join(', ');
  const cell = (k: string, v: string) => (v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null);
  return (
    <div className="ml-pcard">
      <div className="ml-pcard__h">
        <span className="ml-pcard__ic">
          <MI n="person" />
        </span>
        <a href={'/work/partner/' + encodeURIComponent(c.id)}>
          <b>{c.name || p.name || 'Partner'}</b>
        </a>
        {c.doNotEmail ? <em className="ml-chip ml-chip--sun">Do not email</em> : null}
        {a.major ? <em className="ml-chip ml-chip--leaf">Major partner</em> : null}
      </div>
      <dl className="ml-pcard__g">
        {cell('Lifetime giving', c.count ? money(c.total) + ' in ' + c.count + (c.count === 1 ? ' gift' : ' gifts') : 'No gifts yet')}
        {cell('Last gift', c.last ? money(c.last.amount) + ' on ' + shortDay(c.last.date) + (c.last.fund ? ', ' + c.last.fund : '') : '')}
        {cell('This year', c.count ? money(c.ytd) : '')}
        {cell('Held by', holders || 'No one assigned')}
        {cell('Last contact', c.lastContact ? shortDay(c.lastContact.date) + (c.lastContact.category ? ', ' + c.lastContact.category : '') : 'None on record')}
        {cell('Open actions', c.openActions ? String(c.openActions) : '')}
      </dl>
      <div className="ml-pcard__acts">
        <a className="ml-btn" href={'/work/partner/' + encodeURIComponent(c.id)}>
          Open partner
        </a>
        <button type="button" className="ml-btn" onClick={onLog}>
          <MI n="log" />
          {a.logged ? 'Logged' : 'Log as an action'}
        </button>
        <button type="button" className="ml-btn" onClick={onTimeline}>
          Timeline
        </button>
      </div>
      <div className="ml-tl" hidden={!tl || !tl.open}>
        {tl && tl.open && !tl.items && !tl.error && (
          <div className="ml-empty">
            <span>Loading the timeline</span>
          </div>
        )}
        {tl && tl.error && (
          <div className="ml-empty">
            <span>{tl.error}</span>
          </div>
        )}
        {tl && tl.items && !tl.items.length && (
          <div className="ml-empty">
            <span>Nothing on record</span>
          </div>
        )}
        {tl && tl.items && tl.items.map((x: any, i: number) => (
          <div className="ml-tl__i" data-k={x.kind} key={i}>
            <time>{shortDay(x.at)}</time>
            <em>{x.kind}</em>
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface AssistProps {
  a: AssistState | null;
  partner: any;
  tl: null | { open: boolean; items?: any[]; error?: string };
  onLog: () => void;
  onTimeline: () => void;
  onGiftNote: () => void;
  onGiftChat: () => void;
  onCommitTask: (i: number) => void;
  onProspect: () => void;
  onAsk: (q: string) => void;
  onFindTime: () => void;
  onAskBrain: (q: string) => void;
}

export function AssistPanel(p: AssistProps) {
  const { a, partner } = p;
  const [q, setQ] = useState('');
  if (!a) return null;
  const hasCard = !!(a.card && partner);
  const pr = a.profile;
  return (
    <div className="ml-assist">
      {(a.ask || a.summary) && (
        <div className="ml-sum">
          {a.ask ? (
            <em className="ml-chip ml-chip--sun">
              <MI n="bolt" />
              Waiting on you
            </em>
          ) : null}
          {a.summary ? (
            <p>
              <b>In short</b> {a.summary}
            </p>
          ) : null}
        </div>
      )}
      {hasCard && <PartnerCard c={a.card} p={partner} a={a} onLog={p.onLog} onTimeline={p.onTimeline} tl={p.tl} />}
      {pr && !(hasCard && pr.kind === 'partner') && (
        <div className="ml-prof">
          <span className="ml-prof__t">
            <b>{pr.name || pr.email}</b>
            <span>
              {pr.role}.{' '}
              {pr.history && pr.history.n
                ? pr.history.n + (pr.history.more ? '+' : '') + ' conversation' + (pr.history.n === 1 ? '' : 's') + (pr.history.lastDate ? ', last ' + shortDay(pr.history.lastDate) : '')
                : 'First email'}
              .
            </span>
          </span>
          {pr.partner ? (
            <a className="ml-btn" href={'/work/partner/' + encodeURIComponent(pr.partner.id)}>
              Open partner
            </a>
          ) : null}
          {pr.canProspect ? (
            <button type="button" className="ml-btn" onClick={p.onProspect}>
              Add as prospect
            </button>
          ) : null}
        </div>
      )}
      {a.gift && partner && (
        <div className="ml-gift">
          <b>
            {partner.name || 'The partner'} mentions a {money(a.gift.amount)} gift
          </b>
          <span>Nothing is saved until you confirm each step.</span>
          <div className="ml-gift__b">
            <button type="button" className="ml-btn" onClick={p.onGiftNote}>
              Note the expected gift in Blackbaud
            </button>
            <button type="button" className="ml-btn" onClick={p.onGiftChat}>
              Tell Partner Care in Chat
            </button>
          </div>
        </div>
      )}
      {a.commitments && a.commitments.length > 0 && (
        <div className="ml-commit">
          <b>You promised</b>
          {a.commitments.map((c: any, i: number) => (
            <div className="ml-commit__i" key={i}>
              <span>
                {c.text}
                {c.due ? <em> {shortDay(c.due)}</em> : null}
              </span>
              <button type="button" className="ml-btn" onClick={() => p.onCommitTask(i)}>
                Make a task
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="ml-askrow"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) p.onAsk(q.trim());
        }}
      >
        <label className="ml-askbox">
          <MI n="q" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about this email" aria-label="Ask about this email" autoComplete="off" maxLength={300} data-ask />
        </label>
        <button type="submit" className="ml-btn">
          Ask
        </button>
        <button type="button" className="ml-btn" onClick={p.onFindTime}>
          <MI n="cal" />
          Find a time
        </button>
        <button type="button" className="ml-btn" onClick={() => p.onAskBrain(q)}>
          <MI n="q" />
          Ask Favor Brain
        </button>
      </form>
      {a.answer ? <div className="ml-answer">{a.answer}</div> : null}
    </div>
  );
}

export function SuggestedReplies({ replies, onPick }: { replies: string[]; onPick: (text: string) => void }) {
  if (!replies.length) return null;
  return (
    <div className="ml-sugg">
      <b>Suggested replies</b>
      <div className="ml-sugg__l">
        {replies.map((r, i) => (
          <button type="button" className="ml-sugg__b" key={i} onClick={() => onPick(r)}>
            {r.split('\n').map((l, k, all) => (
              <span key={k}>
                {l}
                {k < all.length - 1 ? <br /> : null}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

export { when };
