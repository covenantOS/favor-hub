// The dock's Favor Brain tab: the same chat, answers, steps and chat list as the Brain page (Thread, ConvList, the block
// registry), sized for the floating panel. It keeps the open chat in the dock's own record (bc), so the full page opens the
// same chat. Ask Favor Brain about a selection elsewhere (public/js/ask-brain.js) lands here with the selection above the box.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import { dock } from '@/shell/dockStore';
import { loadScript } from '@/lib/legacy';
import { BrainEngine, useBrain } from './engine';
import { ConvList } from './ConvList';
import { Ic, Sprite } from './icons';
import { PopLayer } from './pop';
import { Thread, Thinking } from './Thread';
import { AskCtxCard, Composer, Toast } from './BrainPage';
import { useAnswerResolver } from './useAnswerResolver';
import './styles';

let eng: BrainEngine | null = null;
function dockEngine() {
  if (eng) return eng;
  const e = (eng = new BrainEngine('dock'));
  e.onConv = (id) => {
    dock.save({ bc: id });
    try {
      if (id) localStorage.setItem('favor.brain.last', JSON.stringify({ id, at: Date.now() }));
    } catch {
      /* not kept */
    }
  };
  void e.loadMe();
  return e;
}

const STARTERS: [string, string][] = [
  ['How is Favor doing this year?', 'Raised, goal and the same date last year'],
  ['How do I enter a check gift?', 'Steps from the Operations Manual'],
  ['What can you do?', 'Everything you can ask about'],
];

export default function DockBrain({ open }: { open: boolean }) {
  const e = useMemo(dockEngine, []);
  const s = useBrain(e);
  useAnswerResolver(e);
  const [view, setView] = useState<'chat' | 'list'>('chat');
  const [find, setFind] = useState('');
  const [ctx, setCtx] = useState<{ text: string; source: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const name = useMemo(() => {
    try {
      return String((JSON.parse(localStorage.getItem('favor.hub.nav.v1') || '{}').user || {}).name || '').split(/\s+/)[0];
    } catch {
      return '';
    }
  }, []);

  // The first time the tab opens: the chat it had open, and the sheets helper. Ask about a selection is wired here.
  useEffect(() => {
    void loadScript('/js/sheets.js?v=2').catch(() => undefined);
    const w = window as any;
    w.FavorDockNativeBrain = {
      askWith(c: { text: string; source?: string }) {
        if (!c || !c.text) return;
        dock.open({ tab: 'brain' });
        e.startNew();
        setView('chat');
        setCtx({ text: String(c.text), source: c.source || 'this page' });
        const FAB = w.FavorAskBrain;
        if (FAB) setTimeout(() => e.rephrase?.(FAB.suggestion(c.text)), 0);
      },
      brainTurn: (i: number) => (e.s.cur ? e.s.cur.turns[i] || null : null),
    };
    return () => {
      if (w.FavorDockNativeBrain && w.FavorDockNativeBrain.brainTurn) delete w.FavorDockNativeBrain;
    };
  }, [e]);
  useEffect(() => {
    if (!open) return;
    void e.loadHistory();
    if (opened.current) return;
    opened.current = true;
    const bc = (dock as any).st && (dock as any).st.bc;
    if (bc && !e.s.cur) void e.openConv(bc);
  }, [open, e]);
  // A new answer: the newest question moves to the top of the panel.
  const n = s.cur ? s.cur.turns.length : 0;
  useEffect(() => {
    const sc = scroll.current;
    if (!sc) return;
    const qs = sc.querySelectorAll('.fp-q');
    const last = qs[qs.length - 1] as HTMLElement | undefined;
    if (last) sc.scrollTop += last.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
  }, [n, s.cur && s.cur.id]);

  const host = { where: 'dock' as const, openTable: () => dock.expand() };
  if (view === 'list')
    return (
      <div className="fp-conv bc-root-dock" data-brain>
        <Sprite />
        <header className="fp-head">
          <button type="button" className="fp-back" aria-label="Back" onClick={() => setView('chat')}>
            <Ic n="arrow" className="h-i fp-flip" />
          </button>
          <b className="fp-head__t">Your chats</b>
          <button
            type="button"
            className="fp-new fp-new--strong"
            onClick={() => {
              e.startNew();
              setView('chat');
            }}
          >
            <Ic n="plus" />
            New chat
          </button>
        </header>
        <div className="fp-cfind">
          <input
            type="search"
            placeholder="Search your chats"
            aria-label="Search your chats"
            autoComplete="off"
            value={find}
            onChange={(ev) => {
              setFind(ev.target.value);
              void e.search(ev.target.value.trim());
            }}
          />
        </div>
        <div className="fp-scroll bc-root" data-bconvs role="list">
          <ConvList
            e={e}
            list={s.convs}
            cur={s.cur && s.cur.id}
            working={s.busy && s.busy.conv ? s.busy.conv.id : null}
            q={find}
            found={s.found}
            renaming={s.renaming}
            onOpen={(id) => {
              void e.openConv(id);
              setView('chat');
            }}
          />
        </div>
        <div className="bc-root">
          <Toast s={s} />
        </div>
        <PopLayer />
      </div>
    );
  return (
    <div className="fp-conv bc-root-dock" data-brain>
      <Sprite />
      <header className="fp-head fp-head--brain">
        <button type="button" className="fp-all" aria-label="All chats" title="All chats" onClick={() => setView('list')}>
          <Ic n="list" />
          <span>All chats</span>
        </button>
        <b className="fp-head__t">{s.cur ? s.cur.title : 'New chat'}</b>
        <button type="button" className="fp-back" aria-label="New chat" title="New chat" disabled={!(s.cur && s.cur.turns.length)} onClick={() => e.startNew()}>
          <Ic n="edit" />
        </button>
      </header>
      <div className="fp-scroll" data-bthread ref={scroll}>
        {s.cur && s.cur.turns.length ? (
          <Thread e={e} s={s} host={host} />
        ) : s.busy ? (
          <Thinking s={s} where="dock" />
        ) : ctx ? (
          <div className="fp-bempty">
            <h3>Ask about what you selected</h3>
            <p className="fp-none">Your question goes to Favor Brain with the selected text.</p>
          </div>
        ) : (
          <div className="fp-bempty">
            <span className="fbr" data-state="idle" aria-hidden="true">
              <i className="fbr__halo" />
              <i className="fbr__in">
                <i className="fbr__lit" />
                <i className="fbr__rg" />
                <i className="fbr__cm" />
              </i>
            </span>
            <h3>{name ? 'Hello, ' + name : 'Hello'}</h3>
            {STARTERS.map(([q, sub]) => (
              <button key={q} type="button" className="fp-start" onClick={() => void e.ask(q)}>
                <b>{q}</b>
                <span>{sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="fp-comp" data-bask>
        {ctx && <AskCtxCard ctx={ctx} />}
        <Composer e={e} s={s} where="dock" ctxCard={ctx ? { ...ctx, clear: () => setCtx(null) } : null} />
      </div>
      <div className="bc-root">
        <Toast s={s} />
      </div>
      <PopLayer />
    </div>
  );
}
