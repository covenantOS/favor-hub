// The floating dock's Chat tab: the person's conversations, one conversation or thread, Catch me up and translation, drawn with the
// same message list and message box as the Chat page (ConvList, ThreadBody, Composer). Its engine has no socket of its own: the
// dock's socket (shell/dockStore.ts) feeds it, and what it reads clears the dock's count.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { dock } from '@/shell/dockStore';
import { chatAssets } from './assets';
import { ChannelRow, ConvList, PageList, ThreadBody, useEngine } from './ChatPage';
import { Composer } from './Composer';
import { ChatEngine } from './engine';
import { type J } from './fmt';
import { Ic } from './icons';
import { ModalLayer, PopLayer, ToastLayer } from './overlays';
import { TypingLine } from './parts';
import './styles';

let eng: ChatEngine | null = null;
function dockEngine(): ChatEngine {
  if (eng) return eng;
  const e = (eng = new ChatEngine({ dock: true }));
  dock.D.on((ev: J) => {
    if (ev && typeof ev.type === 'string' && ev.type.indexOf('dock:') !== 0) e.onEvent(ev);
  });
  e.onRead = (id: string) => {
    const c = dock.D.ch[id];
    if (c && (c.unread || c.mentions)) {
      c.unread = 0;
      c.mentions = 0;
      dock.D.paint();
    }
  };
  return e;
}

export default function DockChat({ open }: { open: boolean }) {
  const e = useEngine(dockEngine());
  const S = e.S;
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [far, setFar] = useState(false);
  const [farT, setFarT] = useState(false);
  const st = dock.D.state();

  useEffect(() => {
    void chatAssets();
    e.attach();
    void e.boot(null).then(() => {
      if (st.ch && e.chan(st.ch)) {
        e.openChannel(st.ch);
        if (st.th) e.openThread(st.th);
      } else e.toList();
      e.notify();
    });
    return () => e.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Opened from a toast or a notice: go where it points.
  useEffect(() => {
    if (!open || !S.booted) return;
    const s = dock.D.state();
    if (s.ch && e.chan(s.ch) && (s.ch !== S.active || S.view === 'list')) {
      e.openChannel(s.ch);
      if (s.th) e.openThread(s.th);
    } else if (s.ch && s.th && S.threadRoot !== s.th) e.openThread(s.th);
    e.markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, S.booted, st.ch, st.th]);
  // Keep the dock's place (which conversation, which thread) for the next page.
  useEffect(() => {
    if (!S.booted) return;
    const ch = S.view === 'list' || S.page !== 'channel' ? null : S.active;
    const th = S.right === 'thread' ? S.threadRoot : null;
    const s = dock.D.state();
    if ((s.ch || null) !== ch || (s.th || null) !== th) dock.save({ ch, th });
  });

  const c = e.chan(S.active);
  let body: React.ReactNode;
  if (!S.me)
    body = (
      <div className="fd-p__wait">
        <i />
        <i />
        <i />
      </div>
    );
  else if (S.view === 'list') {
    const s = e.sorted();
    const v = q.trim().toLowerCase();
    const f = (l: J[]) =>
      l
        .filter((x) => !v || e.chName(x).toLowerCase().indexOf(v) >= 0)
        .sort((a, b) => Number((b.unread > 0 && !b.muted) || b.mentions > 0) - Number((a.unread > 0 && !a.muted) || a.mentions > 0) || String(b.last_at || '').localeCompare(String(a.last_at || '')));
    const dms = f(s.dms);
    const chans = f(s.chans);
    body = (
      <div className="ch-dock__list">
        <div className="fp-search">
          <input type="search" placeholder="Find a conversation" aria-label="Find a conversation" autoComplete="off" value={q} onInput={(ev) => setQ(ev.currentTarget.value)} />
        </div>
        <div className="ch-list">
          <div className="ch-navs">
            <button type="button" className={'ch-row ch-nav' + (S.threadsUnread ? ' is-unread' : '')} data-act="page" onClick={() => e.openPage('threads')}>
              <span className="ch-row__ic">
                <Ic n="threads" />
              </span>
              <span className="ch-row__n">Threads</span>
              {S.threadsUnread ? <span className="ch-badge">{S.threadsUnread > 99 ? '99+' : S.threadsUnread}</span> : null}
            </button>
          </div>
          <div className="ch-sec">
            <div className="ch-sec__h">
              <span className="ch-sec__t">
                <b>Direct messages</b>
              </span>
              <button type="button" className="ch-iconbtn" aria-label="New message" title="New message" onClick={() => e.setModal({ kind: 'people', mode: 'dm' })}>
                <Ic n="plus" />
              </button>
            </div>
            {dms.length ? dms.map((x) => <ChannelRow key={x.id} e={e} c={x} />) : <div className="fp-none">{v ? 'No match' : 'No conversations yet'}</div>}
          </div>
          <div className="ch-sec">
            <div className="ch-sec__h">
              <span className="ch-sec__t">
                <b>Channels</b>
              </span>
            </div>
            {chans.length ? chans.map((x) => <ChannelRow key={x.id} e={e} c={x} />) : <div className="fp-none">{v ? 'No match' : 'No channels yet'}</div>}
          </div>
        </div>
        <footer className="fp-foot">
          <a href="/chat/">Open Chat</a>
        </footer>
      </div>
    );
  } else if (S.page !== 'channel') {
    body = (
      <>
        <header className="ch-dock__head">
          <button type="button" className="ch-iconbtn" aria-label="Back to conversations" onClick={() => e.back()}>
            <Ic n="back" />
          </button>
          <b className="ch-dock__t">Threads</b>
        </header>
        <PageList e={e} />
      </>
    );
  } else if (S.right === 'thread' && c) {
    body = (
      <>
        <header className="ch-dock__head">
          <button type="button" className="ch-iconbtn" data-act="back" aria-label="Back" onClick={() => e.closeRight()}>
            <Ic n="back" />
          </button>
          <b className="ch-dock__t">
            Thread in {c.kind === 'public' ? '# ' : ''}
            {e.chName(c)}
          </b>
          <a className="ch-iconbtn" href={'/chat/?c=' + encodeURIComponent(c.id) + '&t=' + S.threadRoot} title="Open in Chat" aria-label="Open in Chat">
            <Ic n="ext" />
          </a>
        </header>
        <ThreadBody e={e} onFar={setFarT} />
        <TypingLine text={e.typingNames(S.threadTyping[S.threadRoot])} />
        <Composer e={e} scope="thread" slim placeholder="Reply in thread" latest={{ show: farT, n: S.newBelow.thread, go: () => ((e.toBottom.thread = Date.now()), (S.newBelow.thread = 0), e.notify()) }} />
      </>
    );
  } else if (c) {
    const ph = c.kind === 'public' || c.kind === 'private' ? 'Message ' + (c.kind === 'public' ? '#' : '') + c.name : 'Message ' + e.chName(c);
    body = (
      <>
        <header className="ch-dock__head">
          <button type="button" className="ch-iconbtn" data-act="back" aria-label="Back to conversations" onClick={() => e.back()}>
            <Ic n="back" />
          </button>
          <b className="ch-dock__t">
            {c.kind === 'public' ? '# ' : ''}
            {e.chName(c)}
          </b>
          <button type="button" className="ch-iconbtn" data-act="sm-catch" aria-label="Catch me up" title="Catch me up" onClick={() => e.catchGo(true)}>
            <Ic n="spark" />
          </button>
          <button type="button" className={'ch-iconbtn' + (S.lang ? ' is-on' : '')} data-act="sm-lang" aria-label="Language" title={S.lang ? 'Reading in ' + e.langName(S.lang) : 'Choose the language you read in'} onClick={(ev) => e.setPop({ kind: 'lang', below: true, anchor: ev.currentTarget.getBoundingClientRect() })}>
            <Ic n="globe" />
          </button>
          <a className="ch-iconbtn" href={'/chat/?c=' + encodeURIComponent(c.id)} title="Open in Chat" aria-label="Open in Chat">
            <Ic n="ext" />
          </a>
        </header>
        <ConvList e={e} onFar={setFar} />
        <TypingLine text={e.typingNames(S.typing[S.active])} />
        <Composer e={e} scope="main" slim placeholder={ph} latest={{ show: far, n: S.newBelow.main, go: () => ((e.toBottom.main = Date.now()), (S.newBelow.main = 0), e.notify()) }} />
      </>
    );
  }
  return (
    <div id="dock-chat" className="ch ch--dock" ref={root} data-view={S.view} data-page={S.page}>
      {body}
      <PopLayer e={e} root={root} />
      <ModalLayer e={e} />
      <ToastLayer e={e} />
    </div>
  );
}
