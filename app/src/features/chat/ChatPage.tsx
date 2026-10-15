// Native Chat (/chat/ inside the app). The same screen as the classic page (public/js/chat/chat-ui.js): channel list, conversation,
// one right panel (thread, details or pins); on a phone the list, conversation and thread are full screens with Back.
// State and actions live in engine.ts; the message list and the message box are the components the floating dock draws too.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '@/lib/query';
import { chatAssets } from './assets';
import { Composer } from './Composer';
import { pageEngine, PAGES, type ChatEngine } from './engine';
import { ago, excerptOf, initValue, fmtShort, hudDur, plural, type J } from './fmt';
import { Ic } from './icons';
import { ModalLayer, PopLayer, SearchLayer, SwitcherLayer, ToastLayer } from './overlays';
import { Avatar, cardHtml, CatchStrip, Intro, listClick, listHover, listImgError, Message, msgParts, openSheet, Skel, TypingLine, useStick } from './parts';
import './styles';

const W = window as any;

export function useEngine(e: ChatEngine) {
  useSyncExternalStore(e.subscribe, e.snap, e.snap);
  return e;
}

/** Ties chat-brain.js (Favor Brain answers) to this engine: Share, follow-up questions, the large table view. */
function brainAdapter(e: ChatEngine) {
  return {
    toast: (t: string, link?: { href: string; label: string }) => e.toast(t, link),
    redraw: () => {
      Object.keys(e.S.msgs).forEach((k) => (e.S.msgs[k] = (e.S.msgs[k] || []).map((m: J) => (m.user_id === 'brain' ? { ...m } : m))));
      Object.values(e.S.threads as Record<string, J>).forEach((t) => (t.replies = (t.replies || []).map((m: J) => (m.user_id === 'brain' ? { ...m } : m))));
      e.notify();
    },
    askBrain: (q: string, o: J) => e.askBrain(q, o),
    focusComposer: (scope: 'main' | 'thread', prefix: string) => {
      e.composerFocus = { scope, n: Date.now(), prefix };
      e.notify();
    },
    sheet: openSheet,
  };
}

export function ChatPage() {
  const e = useEngine(pageEngine());
  const S = e.S;
  const root = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const initial = qs.get('c');
    e.attach();
    void chatAssets().then(() => {
      if (W.FavorChatBrain) W.FavorChatBrain.attach(brainAdapter(e));
      // A card or answer drawn before its script arrived draws again now.
      Object.keys(e.S.msgs).forEach((k) => (e.S.msgs[k] = (e.S.msgs[k] || []).map((m: J) => ({ ...m }))));
      e.notify();
    });
    void e.boot(initial).then(() => {
      const t = qs.get('t');
      const mid = qs.get('m');
      if (t && initial)
        setTimeout(() => {
          e.openThread(Number(t));
          if (mid) e.focusMessage(Number(mid), true);
        }, 300);
      else if (mid) e.focusMessage(Number(mid));
    });
    if (S.booted && initial && initial !== S.active) e.openChannel(initial);
    // A clip recorded from this channel is posted here when the recorder saves it.
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('favor-clips');
      bc.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.t === 'saved' && m.id) e.clipSaved(m.id);
      };
    }
    const key = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        e.ui.switcher = e.ui.switcher ? null : { n: Date.now() };
        e.ui.search = null;
        e.notify();
      }
    };
    const esc0 = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || (W.FavorChatView && W.FavorChatView.isOpen())) return;
      const t = ev.target as HTMLElement;
      if (t && t.closest && (t.closest('[data-ta]') || t.closest('[data-edit]') || t.closest('.ch-search'))) return;
      if (e.ui.pop) e.setPop(null);
      else if (e.ui.modal) e.setModal(null);
      else if (e.ui.search || e.ui.switcher) {
        e.ui.search = null;
        e.ui.switcher = null;
        e.notify();
      } else if (S.right !== 'none' && !(t && t.closest && t.closest('input, select'))) e.closeRight();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('keydown', esc0);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('keydown', esc0);
      if (bc) bc.close();
      e.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The rail's Chat count follows what is unread here.
  const unread = S.me ? e.totalUnread().mentions : null;
  useEffect(() => {
    if (unread == null) return;
    qc.setQueryData(keys.nav, (d: any) => (d && d.counts && d.counts.chatMentions !== unread ? { ...d, counts: { ...d.counts, chatMentions: unread } } : d));
  }, [unread, qc]);

  // Phone: the screen sits between the top bar and the tab bar (or above the keyboard), measured, never in viewport units.
  useEffect(() => {
    let q = 0;
    const measure = () => {
      q = 0;
      const r = root.current;
      if (!r) return;
      const phone = matchMedia('(max-width: 860px)').matches;
      const vv = window.visualViewport;
      const kb = phone && !!vv && document.body.classList.contains('kb-open');
      document.body.classList.toggle('ch-kb', kb);
      if (kb && vv) {
        r.style.setProperty('--ch-top', Math.round(vv.offsetTop) + 'px');
        r.style.setProperty('--ch-bot', Math.max(0, Math.round(innerHeight - vv.offsetTop - vv.height)) + 'px');
        return;
      }
      const top = document.querySelector('.h-top');
      const bar = document.querySelector('.h-navbar');
      let t = 0;
      let b = 0;
      if (top && getComputedStyle(top).display !== 'none') t = Math.round(top.getBoundingClientRect().bottom);
      if (bar && getComputedStyle(bar).display !== 'none') b = Math.round(innerHeight - bar.getBoundingClientRect().top);
      if (phone) {
        r.style.setProperty('--ch-top', t + 'px');
        r.style.setProperty('--ch-bot', b + 'px');
      }
    };
    const soon = () => {
      if (!q) q = requestAnimationFrame(measure);
    };
    measure();
    const t1 = setTimeout(measure, 400);
    addEventListener('resize', soon);
    addEventListener('hub-kb', soon);
    window.visualViewport?.addEventListener('resize', soon);
    window.visualViewport?.addEventListener('scroll', soon);
    return () => {
      clearTimeout(t1);
      cancelAnimationFrame(q);
      removeEventListener('resize', soon);
      removeEventListener('hub-kb', soon);
      window.visualViewport?.removeEventListener('resize', soon);
      window.visualViewport?.removeEventListener('scroll', soon);
      document.body.classList.remove('ch-kb');
    };
  }, [S.view]);

  // Files dropped anywhere on Chat attach to the box under them.
  const [drop, setDrop] = useState(0);
  const dragHas = (ev: React.DragEvent) => Array.prototype.indexOf.call(ev.dataTransfer?.types || [], 'Files') >= 0;

  if (S.bootError && !S.me) {
    const gate = S.bootError.status === 403 || S.bootError.status === 401;
    return (
      <div id="chat-root" className="ch">
        <div className="ch-gate">
          <div>
            <h2>{gate ? 'Chat is not open to you yet' : 'Chat did not load'}</h2>
            <p>{S.bootError.message}</p>
          </div>
        </div>
      </div>
    );
  }
  const full = S.threadFull && S.right === 'thread' && !e.phone();
  return (
    <div
      id="chat-root"
      ref={root}
      className="ch"
      data-view={S.view}
      data-right={S.right}
      data-page={S.page}
      data-tfull={full ? '1' : undefined}
      data-native="1"
      onDragEnter={(ev) => dragHas(ev) && setDrop((n) => n + 1)}
      onDragOver={(ev) => dragHas(ev) && ev.preventDefault()}
      onDragLeave={() => setDrop((n) => Math.max(0, n - 1))}
      onDrop={(ev) => {
        setDrop(0);
        if (ev.dataTransfer?.files?.length) {
          ev.preventDefault();
          e.addFiles(S.right === 'thread' && (ev.target as HTMLElement).closest('.ch-right') ? 'thread' : 'main', ev.dataTransfer.files);
        }
      }}
    >
      <Side e={e} />
      <Main e={e} drop={drop > 0} />
      <Right e={e} root={root} />
      {S.conn !== 'ok' && (
        <div className="ch-conn" role="status" data-conn="off">
          {S.conn}
        </div>
      )}
      <PopLayer e={e} root={root} />
      <ModalLayer e={e} />
      <SwitcherLayer e={e} />
      <SearchLayer e={e} />
      <ToastLayer e={e} />
    </div>
  );
}

/* ------------------------------------------------------------------ the channel list */
function SkelRows({ ws }: { ws: string[] }) {
  return (
    <>
      {ws.map((w, i) => (
        <div key={i} className="ch-row ch-row--skel" aria-hidden="true">
          <span className="ch-row__ic">
            <i className="ch-bone" style={{ width: 14, height: 14 }} />
          </span>
          <span className="ch-row__n">
            <i className="ch-bone" style={{ width: w, height: 12 }} />
          </span>
        </div>
      ))}
    </>
  );
}
export function ChannelRow({ e, c, onOpen }: { e: ChatEngine; c: J; onOpen?: (id: string) => void }) {
  const S = e.S;
  const on = c.id === S.active && S.page === 'channel' && !(e.phone() && S.view === 'list');
  const unread = c.unread > 0;
  const self = c.kind === 'dm' && (c.members || []).every((m: string) => m === S.me.id);
  let icon;
  if (!on && e.hasDraft(c.id))
    icon = (
      <span className="ch-row__ic ch-row__ic--draft" title="Draft">
        <Ic n="pen" />
      </span>
    );
  else if (c.kind === 'public') icon = <span className="ch-row__ic">#</span>;
  else if (c.kind === 'private')
    icon = (
      <span className="ch-row__ic">
        <Ic n="lock" />
      </span>
    );
  else if (c.kind === 'dm') {
    const o = (c.members || []).filter((m: string) => m !== S.me.id)[0] || S.me.id;
    icon = (
      <span className="ch-row__ic">
        <Avatar u={e.user(o)} size="xs" dot />
      </span>
    );
  } else
    icon = (
      <span className="ch-row__ic">
        <Ic n="users" />
      </span>
    );
  return (
    <button type="button" className={'ch-row' + (on ? ' is-on' : '') + (unread && !c.muted ? ' is-unread' : '') + (c.muted ? ' is-muted' : '')} data-act="open" data-id={c.id} aria-current={on ? 'true' : undefined} onClick={() => (onOpen ? onOpen(c.id) : e.openChannel(c.id))}>
      {icon}
      <span className="ch-row__n">
        {e.chName(c)}
        {self ? ' (you)' : ''}
      </span>
      {c.mentions > 0 && (
        <span className="ch-badge" aria-label={plural(c.mentions, 'mention')}>
          {c.mentions > 99 ? '99+' : c.mentions}
        </span>
      )}
    </button>
  );
}
function Side({ e }: { e: ChatEngine }) {
  const S = e.S;
  const phone = e.phone();
  if (!S.me)
    return (
      <aside className="ch-side" aria-label="Channels">
        <div className="ch-side__head">
          <button type="button" className="ch-jump" tabIndex={-1}>
            <Ic n="search" />
            <span>Jump to or search</span>
            <kbd>Ctrl K</kbd>
          </button>
        </div>
        <div className="ch-list">
          <div className="ch-sec">
            <SkelRows ws={['46%', '62%', '38%', '54%']} />
          </div>
          <div className="ch-sec">
            <SkelRows ws={['50%', '40%']} />
          </div>
        </div>
      </aside>
    );
  const s = e.sorted();
  const isOpen = (c: J) => c.id === S.active && S.page === 'channel';
  const sec = (key: string, title: string, label: string, onAdd: () => void, rows: J[], extra: React.ReactNode) => {
    const folded = !phone && !!S.folded[key];
    const list = folded ? rows.filter((c) => (c.unread > 0 && !c.muted) || c.mentions > 0 || isOpen(c)) : rows;
    return (
      <div className={'ch-sec' + (folded ? ' is-folded' : '')} data-sec={key}>
        <div className="ch-sec__h">
          <button
            type="button"
            className="ch-sec__t"
            data-act="fold"
            aria-expanded={!folded}
            onClick={() => {
              if (phone) return;
              S.folded[key] = !S.folded[key];
              try {
                localStorage.setItem('favor.chat.folded.v1', JSON.stringify(S.folded));
              } catch {
                // fine
              }
              e.notify();
            }}
          >
            <Ic n="caret" />
            <b>{title}</b>
          </button>
          <button type="button" className="ch-iconbtn" aria-label={label} title={label} onClick={onAdd}>
            <Ic n="plus" />
          </button>
        </div>
        {list.map((c) => (
          <ChannelRow key={c.id} e={e} c={c} />
        ))}
        {!folded && extra}
      </div>
    );
  };
  const newDm = () => e.setModal({ kind: 'people', mode: 'dm' });
  const dmNew = s.dms.filter((c) => c.unread > 0 && !c.muted).length;
  const navRow = (page: string, icon: string, label: string, n: number, live: boolean) => (
    <button key={page} type="button" className={'ch-row ch-nav' + (S.page === page ? ' is-on' : '') + (n && live ? ' is-unread' : '')} data-act="page" data-page={page} aria-current={S.page === page ? 'true' : undefined} onClick={() => e.openPage(page)}>
      <span className="ch-row__ic">
        <Ic n={icon} />
      </span>
      <span className="ch-row__n">{label}</span>
      {n ? <span className={'ch-badge' + (live ? '' : ' ch-badge--quiet')}>{n}</span> : null}
    </button>
  );
  const canAsk = typeof Notification !== 'undefined' && Notification.permission === 'default' && !localStorage.getItem('favor.chat.notify.asked');
  return (
    <aside className="ch-side" aria-label="Channels">
      <div className="ch-pnav">
        <button
          type="button"
          className="ch-pn"
          data-act="hub-menu"
          aria-label="FavorOS menu"
          onClick={(ev) => {
            ev.stopPropagation();
            (document.getElementById('h-bar-more') || document.getElementById('h-menu'))?.click();
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 8h10" />
            <path d="M5 16h14" />
          </svg>
        </button>
        <div className="ch-seg">
          <button type="button" data-act="seg" aria-pressed={S.seg !== 'messages'} onClick={() => ((S.seg = 'channels'), e.notify())}>
            Channels
          </button>
          <button type="button" data-act="seg" aria-pressed={S.seg === 'messages'} onClick={() => ((S.seg = 'messages'), e.notify())}>
            Messages
            {dmNew ? <i className="ch-seg__dot" aria-label={dmNew + ' unread'} /> : null}
          </button>
        </div>
        <button type="button" className="ch-pn" data-act="new-dm" aria-label="New message" onClick={newDm}>
          <Ic n="pen" />
        </button>
      </div>
      <div className="ch-side__head">
        <button type="button" className="ch-jump" data-act="switcher" onClick={() => ((e.ui.switcher = { n: Date.now() }), e.notify())}>
          <Ic n="search" />
          <span>Jump to or search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button type="button" className="ch-iconbtn" data-act="new-dm" aria-label="New message" title="New message" onClick={newDm}>
          <Ic n="pen" />
        </button>
      </div>
      <div className="ch-list" data-seg={S.seg === 'messages' ? 'messages' : 'channels'}>
        <div className="ch-navs">
          {navRow('threads', 'threads', 'Threads', S.threadsUnread || 0, true)}
          {navRow('activity', 'at', 'Mentions and reactions', 0, false)}
          {navRow('drafts', 'pen', 'Drafts', e.draftCount(), false)}
        </div>
        {sec(
          'channels',
          'Channels',
          'New channel',
          () => e.setModal({ kind: 'newchannel' }),
          s.chans,
          <button type="button" className="ch-row ch-more" data-act="browse" onClick={() => e.setModal({ kind: 'browse' })}>
            <span className="ch-row__ic">
              <Ic n="search" />
            </span>
            <span className="ch-row__n">Browse channels</span>
          </button>
        )}
        {sec(
          'messages',
          'Direct messages',
          'New message',
          newDm,
          s.dms,
          s.dms.length ? null : (
            <button type="button" className="ch-row ch-more" onClick={newDm}>
              <span className="ch-row__ic">
                <Ic n="pen" />
              </span>
              <span className="ch-row__n">Message someone</span>
            </button>
          )
        )}
      </div>
      {canAsk && (
        <div className="ch-ask">
          <b>Notices for messages and mentions</b>
          <span>Shown when Chat is not in front</span>
          <div className="ch-ask__acts">
            <button
              type="button"
              className="ch-btn ch-btn--sm ch-btn--primary"
              data-act="notify-on"
              onClick={() => {
                localStorage.setItem('favor.chat.notify.asked', String(Date.now()));
                void Promise.resolve(Notification.requestPermission()).then((r) => e.toast(r === 'granted' ? 'Notices are on' : 'Notices are off. The browser settings can turn them on.'));
              }}
            >
              Turn on
            </button>
            <button
              type="button"
              className="ch-btn ch-btn--sm"
              data-act="notify-no"
              onClick={() => {
                localStorage.setItem('favor.chat.notify.asked', String(Date.now()));
                e.notify();
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ the middle column */
function Head({ e }: { e: ChatEngine }) {
  const S = e.S;
  const c = e.chan(S.active);
  const back = (
    <button type="button" className="ch-iconbtn ch-back" data-act="back" aria-label="Back to channels" onClick={() => e.back()}>
      <Ic n="back" />
    </button>
  );
  if (S.page !== 'channel')
    return (
      <header className="ch-head">
        {back}
        <div className="ch-head__t">
          <div className="ch-head__name">
            <span style={{ color: 'var(--r-ink)', fontWeight: 700 }}>{PAGES[S.page]}</span>
          </div>
        </div>
        <div className="ch-head__acts" />
      </header>
    );
  if (!c)
    return (
      <header className="ch-head">
        <div className="ch-head__t">
          <i className="ch-bone" style={{ width: 150, height: 16 }} />
        </div>
      </header>
    );
  const ms = (c.members || []).slice(0, 4);
  const live = S.huddle[c.id];
  return (
    <header className="ch-head">
      {back}
      <div className="ch-head__t">
        <div className="ch-head__name">
          {c.kind === 'public' ? <span>#</span> : c.kind === 'private' ? <Ic n="lock" /> : null}
          <span style={{ color: 'var(--r-ink)', fontWeight: 700 }}>{e.chName(c)}</span>
        </div>
        {c.topic ? <div className="ch-head__topic">{c.topic}</div> : dmStatus(e, c)}
      </div>
      <div className="ch-head__acts">
        <button type="button" className="ch-members" data-act="details" aria-label="Members" onClick={() => e.openDetails('members')}>
          <span className="ch-stack">
            {ms.map((id: string) => (
              <Avatar key={id} u={e.user(id)} size="sm" />
            ))}
          </span>
          {(c.members || []).length}
        </button>
        <button type="button" className={'ch-btn ch-btn--meet' + (live ? ' is-live' : '')} data-act="huddle" aria-label={live ? 'Join huddle' : 'Huddle'} onClick={() => e.openHuddle(c.id)}>
          <Ic n="headset" />
          <span>{live ? 'Join huddle' : 'Huddle'}</span>
        </button>
        <button type="button" className="ch-iconbtn" data-act="sm-catch" aria-label="Catch me up" title="Catch me up" onClick={() => e.catchGo(true)}>
          <Ic n="spark" />
        </button>
        <button type="button" className={'ch-iconbtn' + (S.lang ? ' is-on' : '')} data-act="sm-lang" aria-label="Language" title={S.lang ? 'Reading in ' + e.langName(S.lang) : 'Choose the language you read in'} onClick={(ev) => e.setPop({ kind: 'lang', below: true, anchor: ev.currentTarget.getBoundingClientRect() })}>
          <Ic n="globe" />
        </button>
        <button type="button" className="ch-iconbtn ch-hide-m" data-act="search" aria-label="Search messages" title="Search messages" onClick={() => ((e.ui.search = { q: '', n: Date.now() }), e.notify())}>
          <Ic n="search" />
        </button>
        <button type="button" className={'ch-iconbtn' + (S.right === 'details' ? ' is-on' : '')} data-act="details" aria-label="Channel details" title="Channel details" onClick={() => e.openDetails()}>
          <Ic n="info" />
        </button>
      </div>
    </header>
  );
}
function Hud({ e }: { e: ChatEngine }) {
  const S = e.S;
  const h = S.active ? S.huddle[S.active] : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!h) return;
    const t = setInterval(() => !document.hidden && tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [h]);
  if (!h || S.page !== 'channel') return null;
  const ppl: J[] = h.people || [];
  return (
    <div className="ch-hud">
      <span className="ch-hud__dot" aria-hidden="true" />
      <span className="ch-stack">
        {ppl.slice(0, 4).map((p) => (
          <Avatar key={p.email} u={e.user(p.email)} size="sm" />
        ))}
      </span>
      <span className="ch-hud__t">
        <b>Huddle</b>
        <span>
          <span data-hud-dur="">{h.startedAt > 1e11 ? hudDur(h.startedAt) : 'Starting'}</span>
          {ppl.length ? ' · ' + (ppl.length === 1 ? e.user(ppl[0].email).name.split(' ')[0] : plural(ppl.length, 'person', 'people')) : ''}
        </span>
      </span>
      <button type="button" className="ch-hud__join" data-act="huddle" onClick={() => e.openHuddle(S.active)}>
        Join
      </button>
    </div>
  );
}
function PinBar({ e }: { e: ChatEngine }) {
  const S = e.S;
  const c = e.chan(S.active);
  const marks: J[] = (c && c.bookmarks) || [];
  if (S.page !== 'channel' || !c || !S.features.pins || !((c.pins || 0) > 0 || marks.length)) return null;
  return (
    <div className="ch-pinbar">
      {c.pins ? (
        <button type="button" className="ch-pinbar__i" data-act="pins" onClick={() => e.openPins()}>
          <Ic n="pin" />
          <span>{c.pins} pinned</span>
        </button>
      ) : null}
      {marks.map((b) => {
        const here = b.url.charAt(0) === '/';
        return (
          <a key={b.id || b.url} className="ch-pinbar__i" href={b.url} target={here ? undefined : '_blank'} rel={here ? undefined : 'noopener'} title={b.url}>
            <Ic n={here ? 'mark2' : 'link'} />
            <span>{b.title}</span>
          </a>
        );
      })}
      <button type="button" className="ch-pinbar__add" data-act="bm-add" aria-label="Add a bookmark" title="Add a bookmark" onClick={() => e.setModal({ kind: 'bookmark' })}>
        <Ic n="plus" />
      </button>
    </div>
  );
}

/** Taps on a message open its actions as a sheet on a phone (with the keyboard up, the tap lowers it). */
function phoneTap(e: ChatEngine, ev: React.MouseEvent<HTMLElement>) {
  const t = ev.target as HTMLElement;
  const mm = t.closest('.ch-msg');
  if (!mm || !matchMedia('(max-width: 860px)').matches || t.closest('a,button,textarea,input,video,audio,.ch-vid,.ch-ans,.ch-pinned')) return;
  if (document.body.classList.contains('kb-open') && document.activeElement && (document.activeElement as HTMLElement).blur) {
    (document.activeElement as HTMLElement).blur();
    return;
  }
  const m = e.findMsg(mm.getAttribute('data-mid') || '');
  if (!m || m.deleted || (m.visible_to && m.user_id !== e.S.me.id)) return;
  e.setModal({ kind: 'msheet', id: m.id });
}
export function onListClick(e: ChatEngine, root: HTMLElement | null) {
  return (ev: React.MouseEvent<HTMLElement>) => {
    if (root && listClick(e, ev, root)) return;
    phoneTap(e, ev);
  };
}

/** The message list of a conversation: scroll box, catch-up strip, intro or Load earlier, the messages. Shared with the dock. */
export function ConvList({ e, onFar }: { e: ChatEngine; onFar: (far: boolean) => void }) {
  const S = e.S;
  const c = e.chan(S.active);
  const box = useRef<HTMLDivElement>(null);
  const list: J[] | undefined = c ? S.msgs[c.id] : undefined;
  const stick = useStick(box, { key: (c ? c.id : '') + (list ? ':l' : ':w'), bottom: e.toBottom.main, keep: S.keepScroll, onFar, atNew: true });
  S.pinned = stick.current.pinned;
  // A message asked for (a link, a search hit, See it in a summary) is scrolled to and flashed.
  const fr = e.focusReq;
  useEffect(() => {
    if (!fr || fr.thread) return;
    let n = 0;
    const t = setInterval(() => {
      const el = box.current?.querySelector<HTMLElement>('[data-mid="' + fr.id + '"]');
      if (!el && ++n < 50) return;
      clearInterval(t);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.remove('is-flash');
        void el.offsetWidth;
        el.classList.add('is-flash');
      }
      if (e.focusReq === fr) e.focusReq = null;
    }, 100);
    return () => clearInterval(t);
  }, [fr, e]);
  return (
    <div className="ch-msgs" tabIndex={0} aria-live="polite" ref={box} onClick={onListClick(e, box.current)} onPointerOver={listHover} onErrorCapture={listImgError}>
      <CatchStrip e={e} />
      <div className="ch-msgs__in" data-stick="">
        {!c || !list ? (
          <Skel />
        ) : (
          <>
            {S.hasMore[c.id] ? (
              <div style={{ textAlign: 'center', padding: 10 }}>
                <button type="button" className="ch-btn ch-btn--sm" data-act="older" onClick={() => e.older()}>
                  Load earlier messages
                </button>
              </div>
            ) : (
              <Intro e={e} c={c} />
            )}
            {msgParts(e, list, { lastRead: S.lastRead[c.id] })}
          </>
        )}
      </div>
    </div>
  );
}

function Main({ e, drop }: { e: ChatEngine; drop: boolean }) {
  const S = e.S;
  const c = e.chan(S.active);
  const [far, setFar] = useState(false);
  const name = c ? e.chName(c) : '';
  const ph = !c ? 'Message' : c.kind === 'dm' || c.kind === 'group' ? 'Message ' + name : 'Message ' + (c.kind === 'public' ? '#' : '') + name;
  if (!far && S.newBelow.main) S.newBelow.main = 0;
  return (
    <section className="ch-main" aria-label="Channel">
      <Head e={e} />
      <Hud e={e} />
      <PinBar e={e} />
      {S.page === 'channel' ? <ConvList e={e} onFar={setFar} /> : <PageList e={e} />}
      <TypingLine text={S.page === 'channel' && S.me ? e.typingNames(S.typing[S.active]) : ''} />
      {S.page === 'channel' && (
        <Composer
          e={e}
          scope="main"
          placeholder={ph}
          latest={{
            show: far,
            n: S.newBelow.main,
            go: () => {
              e.toBottom.main = Date.now();
              S.newBelow.main = 0;
              e.notify();
            },
          }}
        />
      )}
      {drop && <div className="ch-drop">Drop to attach</div>}
    </section>
  );
}

/** Threads, Mentions and reactions, Drafts: the lists that take the channel's place. */
export function PageList({ e }: { e: ChatEngine }) {
  const S = e.S;
  const box = useRef<HTMLDivElement>(null);
  let body: React.ReactNode;
  if (S.page === 'threads') {
    const l: J[] | null = S.threadList;
    if (!l) body = <Skel />;
    else if (!l.length)
      body = (
        <div className="ch-empty ch-empty--page">
          <b>No threads yet</b>
        </div>
      );
    else
      body = (
        <div className="ch-pagelist">
          {l.map((t) => {
            const more = (t.root.reply_count || 0) - t.latest.length;
            const open = () => e.openThreadIn(t.channel_id, t.root.id);
            const lite = (m: J) => (m.user_id === 'brain' && m.brain && m.brain.blocks ? { ...m, brain: null, body: excerptOf(m, e.names) } : m);
            return (
              <section
                key={t.root.id}
                className={'ch-th' + (t.unread ? ' has-new' : '')}
                onClick={(ev) => {
                  if (!(ev.target as HTMLElement).closest('a,button,video,audio,.ch-vid,.ch-ans')) open();
                }}
              >
                <header className="ch-th__h">
                  <button type="button" className="ch-th__ch" data-act="open-thread" onClick={open}>
                    {e.whereOf(t.channel_id)}
                  </button>
                  {t.unread ? <span className="ch-badge">{t.unread > 99 ? '99+' : t.unread} new</span> : null}
                  <span className="ch-th__when">{ago(t.last_reply_at || t.root.created_at)}</span>
                </header>
                <Message e={e} m={lite(t.root)} inThread bare sig="" />
                {more > 0 && (
                  <button type="button" className="ch-th__more" data-act="open-thread" onClick={open}>
                    {plural(more, 'earlier reply', 'earlier replies')}
                  </button>
                )}
                {t.latest.map((m: J) => (
                  <Message key={m.id} e={e} m={lite(m)} inThread bare sig="" />
                ))}
                <div className="ch-th__f">
                  <button type="button" className="ch-btn ch-btn--sm" data-act="open-thread" onClick={open}>
                    <Ic n="reply" />
                    Reply
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      );
  } else if (S.page === 'activity') {
    const a: J[] | null = S.activity;
    const VERB: Record<string, string> = { mention: 'mentioned you in', reply: 'replied in a thread in', reaction: 'reacted to your message in' };
    if (!a) body = <Skel />;
    else if (!a.length)
      body = (
        <div className="ch-empty ch-empty--page">
          <b>Nothing yet</b>
        </div>
      );
    else
      body = (
        <div className="ch-pagelist">
          {a.map((i, k) => (
            <button key={k} type="button" className={'ch-actv' + (i.unread ? ' is-unread' : '')} data-act="actv" onClick={() => e.jumpTo({ channel_id: i.channel_id, id: i.message.id, thread_id: i.message.thread_id })}>
              <Avatar u={e.user(i.by)} />
              <span className="ch-actv__t">
                <span className="ch-actv__m">
                  <b>{e.user(i.by).name}</b> {VERB[i.kind]} <b>{e.whereOf(i.channel_id)}</b>
                  <time>{ago(i.at)}</time>
                </span>
                <span className="ch-actv__x">{excerptOf(i.message, e.names)}</span>
              </span>
              {i.kind === 'reaction' && <span className="ch-actv__e">{i.emoji}</span>}
            </button>
          ))}
        </div>
      );
  } else {
    const ks = Object.keys(S.drafts)
      .filter(e.hasDraft)
      .sort((x, y) => (S.drafts[y].at || 0) - (S.drafts[x].at || 0));
    if (!ks.length)
      body = (
        <div className="ch-empty ch-empty--page">
          <b>No drafts</b>
        </div>
      );
    else
      body = (
        <div className="ch-pagelist">
          {ks.map((k) => {
            const d = S.drafts[k];
            const parts = k.split('|');
            return (
              <div key={k} className="ch-draft">
                <button type="button" className="ch-draft__open" data-act="draft-open" onClick={() => (parts[1] ? e.openThreadIn(parts[0], Number(parts[1])) : e.openChannel(parts[0]))}>
                  <span className="ch-draft__w">
                    <b>{e.whereOf(parts[0])}</b>
                    {parts[1] && <span className="ch-tag">Thread</span>}
                    <time>{ago(new Date(d.at || Date.now()).toISOString())}</time>
                  </span>
                  <span className="ch-draft__x">{d.text}</span>
                </button>
                <button type="button" className="ch-iconbtn" data-act="draft-del" aria-label="Delete the draft" title="Delete the draft" onClick={() => e.dropDraft(k)}>
                  <Ic n="trash" />
                </button>
              </div>
            );
          })}
        </div>
      );
  }
  return (
    <div className="ch-msgs" tabIndex={0} ref={box} onClick={onListClick(e, box.current)} onPointerOver={listHover} onErrorCapture={listImgError}>
      <div className="ch-msgs__in">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ the right panel */
const RIGHT_KEY = 'favor.chat.rightw';
function Right({ e, root }: { e: ChatEngine; root: React.RefObject<HTMLDivElement | null> }) {
  const S = e.S;
  const c = e.chan(S.active);
  // The thread panel's width, dragged and remembered.
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const clamp = (w: number) => {
      const total = r.getBoundingClientRect().width || innerWidth;
      const side = (r.querySelector('.ch-side') as HTMLElement | null)?.offsetWidth || 272;
      return Math.round(Math.max(320, Math.min(w, 760, total - side - 380)));
    };
    const apply = () => {
      const w = Number(localStorage.getItem(RIGHT_KEY) || 0) || 0;
      if (w && !matchMedia('(max-width: 860px)').matches) r.style.setProperty('--ch-right', clamp(w) + 'px');
      else r.style.removeProperty('--ch-right');
    };
    apply();
    let drag: null | { w: number } = null;
    const down = (ev: PointerEvent) => {
      const h = (ev.target as HTMLElement).closest?.('[data-rz]');
      if (!h || matchMedia('(max-width: 860px)').matches || ev.button) return;
      ev.preventDefault();
      drag = { w: (r.querySelector('.ch-right') as HTMLElement).getBoundingClientRect().width };
      try {
        (h as HTMLElement).setPointerCapture(ev.pointerId);
      } catch {
        // fine
      }
      r.classList.add('is-resizing');
    };
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      drag.w = clamp(r.getBoundingClientRect().right - ev.clientX);
      r.style.setProperty('--ch-right', drag.w + 'px');
    };
    const up = () => {
      if (!drag) return;
      localStorage.setItem(RIGHT_KEY, String(drag.w));
      drag = null;
      r.classList.remove('is-resizing');
    };
    const dbl = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest?.('[data-rz]')) {
        localStorage.removeItem(RIGHT_KEY);
        apply();
      }
    };
    r.addEventListener('pointerdown', down);
    r.addEventListener('pointermove', move);
    r.addEventListener('pointerup', up);
    r.addEventListener('pointercancel', up);
    r.addEventListener('dblclick', dbl);
    addEventListener('resize', apply);
    return () => {
      r.removeEventListener('pointerdown', down);
      r.removeEventListener('pointermove', move);
      r.removeEventListener('pointerup', up);
      r.removeEventListener('pointercancel', up);
      r.removeEventListener('dblclick', dbl);
      removeEventListener('resize', apply);
    };
  }, [root]);
  if (S.right === 'none' || !c) return <aside className="ch-right" hidden />;
  const cname = (c.kind === 'public' ? '# ' : '') + e.chName(c);
  const close = (label: string) => (
    <button type="button" className="ch-iconbtn" data-act="close-right" aria-label={label} onClick={() => e.closeRight()}>
      <Ic n="x" />
    </button>
  );
  const back = (
    <button type="button" className="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel" onClick={() => e.closeRight()}>
      <Ic n="back" />
    </button>
  );
  if (S.right === 'thread') return <ThreadPanel e={e} c={c} cname={cname} />;
  if (S.right === 'pins') {
    const P = S.pins[c.id];
    return (
      <aside className="ch-right" data-mode="pins">
        <div className="ch-right__head">
          {back}
          <div>
            <b>Pinned</b>
            <small>{cname}</small>
          </div>
          {close('Close')}
        </div>
        <div className="ch-det ch-det--pins" onClick={onListClick(e, root.current)} onErrorCapture={listImgError}>
          {!P ? (
            <div className="ch-skel">
              <i style={{ width: '60%' }} />
              <i style={{ width: '85%' }} />
            </div>
          ) : (
            <>
              <h4>Pinned messages</h4>
              {P.pins.length ? (
                P.pins.map((m: J) => (
                  <div key={m.id} className="ch-pinned">
                    <Message e={e} m={m} inThread bare sig="" />
                    <div className="ch-pinned__f">
                      <span>Pinned by {e.user(m.pinned_by).name}</span>
                      <button
                        type="button"
                        className="ch-btn ch-btn--sm"
                        data-act="jump-msg"
                        onClick={() => {
                          const jm = { channel_id: S.active, id: Number(m.id), thread_id: m.thread_id ? Number(m.thread_id) : null };
                          if (e.phone()) {
                            e.closeRight();
                            setTimeout(() => e.jumpTo(jm), 360);
                          } else e.jumpTo(jm);
                        }}
                      >
                        Go to message
                      </button>
                      <button type="button" className="ch-btn ch-btn--sm" data-act="pin" onClick={() => e.pin(m.id, false)}>
                        Unpin
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="ch-det__none">No pinned messages</p>
              )}
              <h4>Bookmarks</h4>
              {P.bookmarks.length ? (
                P.bookmarks.map((b: J) => {
                  const here = b.url.charAt(0) === '/';
                  return (
                    <div key={b.id} className="ch-bm">
                      <a href={b.url} target={here ? undefined : '_blank'} rel={here ? undefined : 'noopener'}>
                        <Ic n={here ? 'mark2' : 'link'} />
                        <span>
                          <b>{b.title}</b>
                          <small>{b.url}</small>
                        </span>
                      </a>
                      <button type="button" className="ch-iconbtn" data-act="bm-del" aria-label={'Remove the bookmark ' + b.title} title="Remove" onClick={() => e.removeBookmark(b.id)}>
                        <Ic n="x" />
                      </button>
                    </div>
                  );
                })
              ) : (
                <p className="ch-det__none">No bookmarks</p>
              )}
              <button type="button" className="ch-btn ch-btn--sm" data-act="bm-add" style={{ marginTop: 10 }} onClick={() => e.setModal({ kind: 'bookmark' })}>
                <Ic n="plus" />
                Add a bookmark
              </button>
            </>
          )}
        </div>
      </aside>
    );
  }
  return <Details e={e} c={c} cname={cname} back={back} close={close('Close details')} root={root} />;
}

function Details({ e, c, cname, back, close, root }: { e: ChatEngine; c: J; cname: string; back: React.ReactNode; close: React.ReactNode; root: React.RefObject<HTMLDivElement | null> }) {
  const S = e.S;
  const members = (c.members || []).map((id: string) => e.user(id));
  const canEdit = c.kind === 'public' || c.kind === 'private';
  const topicT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let det: React.ReactNode;
  if (S.tab === 'about')
    det = (
      <>
        <h4>Topic</h4>
        {canEdit ? (
          <input
            className="ch-input"
            data-topic=""
            ref={initValue(c.topic || '')}
            key={c.id}
            placeholder="Add a topic"
            maxLength={200}
            aria-label="Topic"
            onInput={(ev) => {
              const v = ev.currentTarget.value.trim();
              clearTimeout(topicT.current);
              topicT.current = setTimeout(() => e.setTopic(v), 700);
            }}
          />
        ) : (
          <p>{c.topic || 'None'}</p>
        )}
        <h4>Created</h4>
        <p>
          {fmtShort.format(new Date(c.created_at || Date.now()))}
          {c.created_by ? ' by ' + e.user(c.created_by).name : ''}
        </p>
        {canEdit && (
          <>
            <h4>Visibility</h4>
            <p>{c.kind === 'private' ? 'Private. Only the members below can read it.' : 'Public. Anyone on staff can find and join it.'}</p>
          </>
        )}
        <div className="ch-det__acts">
          {c.kind !== 'dm' && (
            <button type="button" className="ch-btn ch-btn--danger" data-act="leave" onClick={() => e.leave()}>
              <Ic n="out" />
              Leave {c.kind === 'group' ? 'conversation' : 'channel'}
            </button>
          )}
          <button type="button" className="ch-btn" data-act="mute" onClick={() => e.mute()}>
            <Ic n="bell" />
            {c.muted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      </>
    );
  else if (S.tab === 'members')
    det = (
      <>
        {c.kind !== 'dm' && (
          <button type="button" className="ch-btn ch-btn--sm" data-act="add-members" style={{ marginBottom: 8 }} onClick={() => e.setModal({ kind: 'people', mode: 'add', exclude: c.members })}>
            <Ic n="plus" />
            Add people
          </button>
        )}
        {members.map((u: J) => (
          <div key={u.id} className="ch-person">
            <Avatar u={u} dot />
            <span>
              <b>
                {u.name}
                {u.id === S.me.id ? ' (you)' : ''}
              </b>
              <small>{u.status && u.status.text ? u.status.text : u.title || (u.presence === 'online' ? 'Active now' : u.presence === 'away' ? 'Away' : 'Offline')}</small>
            </span>
            {c.created_by === u.id && <span className="ch-person__r">Created it</span>}
          </div>
        ))}
      </>
    );
  else {
    const files: J[] = [];
    (S.msgs[c.id] || []).forEach((m: J) => (m.attachments || []).forEach((a: J, i: number) => a.type !== 'link' && a.type !== 'threadref' && a.type !== 'sent' && files.push({ a, m, i })));
    det = files.length ? (
      files.reverse().map((f) => (
        <div key={f.m.id + '-' + f.i} style={{ marginBottom: 8 }}>
          <FileCard e={e} f={f} />
          <div className="ch-card__m" style={{ margin: '2px 2px 0' }}>
            {e.user(f.m.user_id).name} · {ago(f.m.created_at)}
          </div>
        </div>
      ))
    ) : (
      <div className="ch-empty">No files shared yet</div>
    );
  }
  return (
    <aside className="ch-right" data-mode="details">
      <div className="ch-right__head">
        {back}
        <div>
          <b>{cname}</b>
          <small>Details</small>
        </div>
        {close}
      </div>
      <div className="ch-tabs" role="tablist">
        {[
          ['about', 'About'],
          ['members', 'Members ' + members.length],
          ['files', 'Files'],
        ].map((x) => (
          <button key={x[0]} type="button" role="tab" data-act="tab" className={S.tab === x[0] ? 'is-on' : ''} aria-selected={S.tab === x[0]} onClick={() => ((S.tab = x[0]), e.notify())}>
            {x[1]}
          </button>
        ))}
      </div>
      <div className="ch-det" onClick={onListClick(e, root.current)} onErrorCapture={listImgError}>
        {det}
      </div>
    </aside>
  );
}
/** A file in the Files tab, drawn by the same card code as the messages. */
function FileCard({ e, f }: { e: ChatEngine; f: J }) {
  return <div dangerouslySetInnerHTML={{ __html: cardHtml(e, f.a, f.m, f.i) }} />;
}

export function ThreadBody({ e, onFar }: { e: ChatEngine; onFar: (far: boolean) => void }) {
  const S = e.S;
  const t = S.threads[S.threadRoot];
  const box = useRef<HTMLDivElement>(null);
  const stick = useStick(box, { key: String(S.threadRoot) + (t && t.loaded ? ':l' : ':w'), bottom: e.toBottom.thread, onFar, atNew: true });
  S.threadPinned = stick.current.pinned;
  const fr = e.focusReq;
  useEffect(() => {
    if (!fr || !fr.thread) return;
    let n = 0;
    const iv = setInterval(() => {
      const el = box.current?.querySelector<HTMLElement>('[data-mid="' + fr.id + '"]');
      if (!el && ++n < 50) return;
      clearInterval(iv);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('is-flash');
      }
      if (e.focusReq === fr) e.focusReq = null;
    }, 100);
    return () => clearInterval(iv);
  }, [fr, e]);
  return (
    <div className="ch-thread__body" ref={box} onClick={onListClick(e, box.current)} onPointerOver={listHover} onErrorCapture={listImgError}>
      <div data-stick="">
        {!t ? (
          <div className="ch-skel">
            <i style={{ width: '60%' }} />
            <i style={{ width: '85%' }} />
          </div>
        ) : (
          <>
            <Message e={e} m={t.root} inThread sig={''} />
            {t.replies.length ? <div className="ch-thread__n">{plural(t.replies.length, 'reply', 'replies')}</div> : null}
            {msgParts(e, t.replies, { inThread: true, lastRead: S.threadNew[S.threadRoot] })}
          </>
        )}
      </div>
    </div>
  );
}
function ThreadPanel({ e, c, cname }: { e: ChatEngine; c: J; cname: string }) {
  const S = e.S;
  const [far, setFar] = useState(false);
  const full = S.threadFull && !e.phone();
  if (!far && S.newBelow.thread) S.newBelow.thread = 0;
  return (
    <aside className="ch-right" data-mode="thread" data-root={S.threadRoot}>
      <div className="ch-rz" data-rz="" role="separator" aria-orientation="vertical" tabIndex={0} aria-label="Width of the thread panel" />
      <div className="ch-right__head">
        {full ? (
          <button type="button" className="ch-crumb" data-act="thread-exit" aria-label={'Back to ' + cname} onClick={() => e.closeRight()}>
            <Ic n="back" />
            <span>{cname}</span>
          </button>
        ) : (
          <button type="button" className="ch-iconbtn ch-back" data-act="back" aria-label="Back to the channel" onClick={() => e.closeRight()}>
            <Ic n="back" />
          </button>
        )}
        <div>
          <b>Thread</b>
          {!full && <small>{cname}</small>}
        </div>
        <button type="button" className="ch-iconbtn ch-desk" data-act="thread-full" aria-pressed={full} aria-label={full ? 'Show the thread beside the channel' : 'Open the thread full width'} title={full ? 'Show beside the channel' : 'Open full width'} onClick={() => e.setFull(!S.threadFull)}>
          <Ic n={full ? 'side' : 'full'} />
        </button>
        <button type="button" className="ch-iconbtn" data-act="close-right" aria-label="Close the thread" onClick={() => e.closeRight()}>
          <Ic n="x" />
        </button>
      </div>
      <ThreadBody e={e} onFar={setFar} />
      <TypingLine text={e.typingNames(S.threadTyping[S.threadRoot])} />
      <Composer
        e={e}
        scope="thread"
        placeholder="Reply"
        alsoLabel={'Also send to ' + (c.kind === 'public' ? '#' + c.name : c.kind === 'private' ? c.name : c.kind === 'dm' ? e.chName(c) : 'the group')}
        latest={{
          show: far,
          n: S.newBelow.thread,
          go: () => {
            e.toBottom.thread = Date.now();
            S.newBelow.thread = 0;
            e.notify();
          },
        }}
      />
    </aside>
  );
}

/** A direct message's header line: the other person's status (Out of office until Monday, In Uganda). */
function dmStatus(e: ChatEngine, c: J): React.ReactNode {
  if (c.kind !== 'dm') return null;
  const other = (c.members || []).find((m: string) => m !== e.S.me?.id);
  const st = other ? e.user(other).status : null;
  if (!st || (!st.text && !st.away)) return null;
  const until = st.until ? ' until ' + new Date(st.until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const text = st.away ? 'Out of office' + until + (st.text && st.text !== 'Out of office' ? ' · ' + st.text : '') : st.text + until;
  return <div className={'ch-head__topic' + (st.away ? ' ch-head__away' : '')}>{text}</div>;
}
