// The open chat: each question, the steps behind its answer, the answer, follow-ups and the row under it (copy, link, pin,
// Right, Not right, ask again). The Brain page and the dock draw the same thread; the page uses the m-q/m-a classes, the dock
// its fp- ones.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { Answer } from './blocks/registry';
import { BlockView } from './blocks/registry';
import type { BlockCtx } from './blocks/ctx';
import { copyText } from './blocks/table';
import { md } from './fmt';
import { Ic } from './icons';
import { pop } from './pop';
import { TraceDone, TraceLive } from './Trace';
import type { BrainEngine, State } from './engine';
import type { ReadingChip, Turn } from './types';

const DAY = 864e5;
/** Lists last 24 hours; an answer stored longer ago shows its preview rows without the tools. */
const expiredOf = (t: Turn) => !!t.stored && !!t.at && Date.now() - new Date(t.at).getTime() >= DAY;
const mark = (state: string) => (
  <span className="fbr" data-state={state} aria-hidden="true">
    <i className="fbr__halo" />
    <i className="fbr__in">
      <i className="fbr__lit" />
      <i className="fbr__rg" />
      <i className="fbr__cm" />
    </i>
  </span>
);

function Reading({ chips, e, ti }: { chips: ReadingChip[]; e: BrainEngine; ti: number }) {
  if (!chips || !chips.length) return null;
  return (
    <div className="blk-read">
      <span className="lbl">How I read it</span>
      {chips.map((r, k) =>
        r.options && r.options.length ? (
          <button
            key={k}
            type="button"
            className="chip"
            aria-haspopup="menu"
            aria-label={`${r.label}: ${r.value}. Change`}
            onClick={(ev) =>
              pop.open(
                ev.currentTarget,
                r.options!.map((o) => ({ v: o, label: o, on: o === r.value })),
                (v) => {
                  if (v !== r.value) e.rerun(ti, r.key, v);
                },
                r.label,
              )
            }
          >
            {r.label} <b>{r.value}</b>
            <Ic n="caret" />
          </button>
        ) : (
          <span key={k} className="chip is-fixed">
            {r.label} <b>{r.value}</b>
          </span>
        ),
      )}
    </div>
  );
}

export interface ThreadHost {
  where: 'page' | 'dock';
  openTable: (key: string) => void;
  connect?: () => void;
  /** The connect prompts: on, and the person has not connected Claude. */
  prompts?: boolean;
}

function AnswerBody({ t, ti, latest, e, s, host }: { t: Turn; ti: number; latest: boolean; e: BrainEngine; s: State; host: ThreadHost }) {
  const ctx: Omit<BlockCtx, 'bi'> = { engine: e, turn: t, ti, expired: expiredOf(t), where: host.where, ask: (q, intent) => void e.ask(q, { intent }), openTable: host.openTable };
  const steps = !!(t.steps && t.steps.length);
  const ok = !t.error && !t.stopped;
  const r = t.rated;
  const nums = ok && (t.blocks || []).some((b) => ['tiles', 'money', 'int', 'pct', 'score', 'chart', 'team', 'table'].includes(b.type));
  const FAB = typeof window !== 'undefined' ? (window as any).FavorAskBrain : null;
  return (
    <>
      {t.error ? (
        <div className="blk-text">
          <p className="bc-err">{t.error}</p>
        </div>
      ) : t.stopped ? (
        <div className="blk-text">
          <p>Stopped. Ask again when you are ready.</p>
        </div>
      ) : !t.blocks || !t.blocks.length ? (
        <div className="blk-text" dangerouslySetInnerHTML={{ __html: md(t.markdown || 'No answer was kept for this one. Ask again.') }} />
      ) : (
        <>
          {steps && <TraceDone steps={t.steps!} extra={t.reading && t.reading.length ? <Reading chips={t.reading} e={e} ti={ti} /> : null} />}
          <Answer blocks={t.blocks} ctx={ctx} steps={steps} />
        </>
      )}
      {(t.extras || []).map((x, i) => (
        <BlockView key={'x' + i} b={x} ctx={{ ...ctx, bi: -1 }} />
      ))}
      {!(steps && t.blocks && t.blocks.length) && <Reading chips={t.reading} e={e} ti={ti} />}
      {latest && t.follow && t.follow.length > 0 && !t.error && (
        <div className="blk-follow" aria-label="Follow-up questions">
          {t.follow.map((q) => (
            <button key={q} type="button" className="fu" onClick={() => void e.ask(q)}>
              <Ic n="arrow" />
              {q}
            </button>
          ))}
        </div>
      )}
      {t.connectCard && host.prompts && (
        <div className="bc-cardline">
          <Ic n="link" />
          <span>Ask this in Claude next time.</span>
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={host.connect}>
            Connect
          </button>
          <button
            type="button"
            className="ib ib--sm ib--bare x"
            aria-label="Hide this"
            onClick={() => {
              t.connectCard = false;
              e.touch();
            }}
          >
            <Ic n="close" />
          </button>
        </div>
      )}
      {ok && FAB && ((t.blocks && t.blocks.length) || t.markdown) ? <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: FAB.footer() }} /> : null}
      <div className={host.where === 'page' ? 'm-foot' : 'm-foot fp-foot'}>
        <button
          type="button"
          className="ib ib--sm ib--bare tip"
          aria-label="Copy the answer"
          data-tip="Copy"
          onClick={async (ev) => {
            const body = (ev.currentTarget as HTMLElement).closest('[data-abody]') as HTMLElement | null;
            const done = await copyText(t.markdown || (body ? body.innerText : ''));
            e.toast(done ? 'Answer copied' : 'Your browser would not copy.');
          }}
        >
          <Ic n="copy" />
        </button>
        {host.where === 'page' && (
          <button
            type="button"
            className="ib ib--sm ib--bare tip"
            aria-label="Copy link to this chat"
            data-tip="Copy link"
            onClick={async () => {
              if (!s.cur) return;
              const done = await copyText(location.origin + '/brain/?c=' + encodeURIComponent(s.cur.id));
              e.toast(done ? 'Link copied. Only you can open it.' : 'Your browser would not copy.');
            }}
          >
            <Ic n="link" />
          </button>
        )}
        {ok && t.blocks && t.blocks.length > 0 && t.outcome === 'ok' && host.where === 'page' && (
          <button type="button" className="ib ib--sm ib--bare tip" aria-label="Pin to My dashboard" data-tip="Pin to My dashboard" onClick={() => void e.pinAnswer(t)}>
            <Ic n="pin" />
          </button>
        )}
        <button type="button" className={'ib ib--sm ib--bare tip' + (r === 'right' ? ' is-done' : '')} aria-label="Right" data-tip="Right" aria-pressed={r === 'right'} disabled={!t.ref} onClick={() => void e.rateRight(t)}>
          <Ic n="up" />
        </button>
        <button type="button" className={'ib ib--sm ib--bare tip' + (r === 'wrong' ? ' is-done' : '')} data-feedback="hub-brain" data-rating="wrong" data-ref={t.ref || ''} data-question={t.q} aria-label="Not right" data-tip="Not right" aria-pressed={r === 'wrong'} disabled={!t.ref}>
          <Ic n="down" />
        </button>
        <button type="button" className="ib ib--sm ib--bare tip" aria-label="Ask again" data-tip="Ask again" onClick={() => e.again(ti)}>
          <Ic n="redo" />
        </button>
        {nums && <span className="copy-stamp" data-copy-stamp />}
        {r === 'wrong' ? <span className="told">Will has your note</span> : r === 'right' ? <span className="told">Thanks</span> : null}
        {t.ref && host.where === 'page' && <span className="ref">Answer ref {t.ref}</span>}
      </div>
    </>
  );
}

function Question({ t, ti, latest, e, s, where }: { t: Turn; ti: number; latest: boolean; e: BrainEngine; s: State; where: 'page' | 'dock' }) {
  const [editing, setEditing] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing && ta.current) {
      ta.current.focus();
      ta.current.setSelectionRange(ta.current.value.length, ta.current.value.length);
    }
  }, [editing]);
  if (where === 'dock')
    return (
      <div className="fp-q">
        <div className="fp-q__b">{t.q}</div>
      </div>
    );
  if (editing) {
    const save = () => {
      const q = ta.current?.value.trim();
      if (q) e.editAsk(ti, q);
      setEditing(false);
    };
    return (
      <div className="m-q" style={{ width: 'min(80%,620px)' }}>
        <div className="bc-compose" style={{ width: '100%', borderRadius: 20 }}>
          <textarea
            ref={ta}
            defaultValue={t.q}
            aria-label="Edit your question"
            style={{ height: 'auto' }}
            maxLength={600}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                save();
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                setEditing(false);
              }
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="h-btn h-btn--ghost h-btn--xs" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="h-btn h-btn--primary h-btn--xs" onClick={save}>
            Ask
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="m-q">
      <div className="m-q__b">{t.q}</div>
      <div className="m-q__acts">
        <button
          type="button"
          className="ib ib--sm ib--bare tip"
          aria-label="Copy the question"
          data-tip="Copy"
          onClick={async () => {
            const done = await copyText(t.q);
            e.toast(done ? 'Question copied' : 'Your browser would not copy.');
          }}
        >
          <Ic n="copy" />
        </button>
        {latest && !s.busy && (
          <button type="button" className="ib ib--sm ib--bare tip" aria-label="Edit the question" data-tip="Edit" onClick={() => setEditing(true)}>
            <Ic n="edit" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The answer being made: the Brain's mark and the live steps (four rows, their height held from the first frame). */
export function Thinking({ s, where }: { s: State; where: 'page' | 'dock' }) {
  if (where === 'dock')
    return (
      <div className="fp-think fp-think--trace">
        {mark('thinking')}
        <div className="bc-root">
          <TraceLive steps={s.busy ? s.busy.steps : null} />
        </div>
      </div>
    );
  return (
    <div className="m-think m-think--trace">
      <div className="m-a__av m-a__av--bm" aria-hidden="true">
        {mark('thinking')}
      </div>
      <div className="m-think__tr">
        <TraceLive steps={s.busy ? s.busy.steps : null} />
      </div>
    </div>
  );
}

export function Thread({ e, s, host }: { e: BrainEngine; s: State; host: ThreadHost }) {
  const cur = s.cur;
  if (!cur) return null;
  const working = !!(s.busy && s.busy.conv === cur) || cur.turns.some((t) => t.pending);
  return (
    <>
      {cur.turns.map((t, ti) => {
        const latest = ti === cur.turns.length - 1;
        const waiting = (t.pending || (s.busy && s.busy.conv === cur)) && latest && !t.blocks && !t.error && !t.stopped;
        return (
          <div className="turn" style={{ display: 'contents' }} key={ti}>
            <Question t={t} ti={ti} latest={latest} e={e} s={s} where={host.where} />
            {!waiting &&
              (host.where === 'page' ? (
                <div className="m-a">
                  <div className="m-a__av m-a__av--bm" aria-hidden="true">
                    {mark('still')}
                  </div>
                  <div className="m-a__body" data-abody={ti}>
                    <AnswerBody t={t} ti={ti} latest={latest} e={e} s={s} host={host} />
                  </div>
                </div>
              ) : (
                <div className="fp-a bc-root" data-abody={ti}>
                  <AnswerBody t={t} ti={ti} latest={latest} e={e} s={s} host={host} />
                </div>
              ))}
          </div>
        );
      })}
      {working && <Thinking s={s} where={host.where} />}
    </>
  );
}
