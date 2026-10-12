// Everything that opens over Chat: menus (message actions, emoji, add to a message, language, mentions, commands), dialogs (new
// request, Turn into, reminder, Blackbaud action, bookmark, new channel, browse, people, Drive, clips, delete, the phone's message
// sheet), search and the Ctrl K switcher. Shared by the page and the dock; each draws inside its own Chat root.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { hubOv } from '@/lib/hubOv';
import { chatApi } from './api';
import type { ChatEngine, Pop as PopT } from './engine';
import { esc, fmtShort, initValue, plain, timeOf, type J } from './fmt';
import { Ic, Ring } from './icons';
import { Avatar } from './parts';

const W = window as any;
const EMOJI = ['👍', '❤️', '🙏', '🎉', '😂', '👀', '✅', '🔥', '🙌', '💯', '🤔', '😮'];

/* ------------------------------------------------------------------ what can be done with one message */
export function msgActions(e: ChatEngine, m: J): [string, string, string, boolean?, boolean?][] {
  const S = e.S;
  const mine = m.user_id === S.me.id;
  const out: [string, string, string, boolean?, boolean?][] = [];
  if (m.visible_to) {
    if (mine) out.push(['del', 'trash', 'Delete', true]);
    return out;
  }
  if (mine && S.editing !== m.id) out.push(['edit', 'edit', 'Edit']);
  if (m.body) out.push(['copy', 'file', 'Copy text']);
  out.push(['copy-link', 'link', 'Copy link']);
  if (S.features.pins) out.push(['pin', 'pin', m.pinned ? 'Unpin' : 'Pin', false, !m.pinned]);
  out.push(['mark-unread', 'mark', 'Mark unread from here']);
  out.push(['make-request', 'task', 'Create a request from this message']);
  out.push(['sm-turn', 'bell', 'Turn into a task, reminder or action']);
  if (S.lang && !mine && (m.body || (m.attachments || []).some((a: J) => a.voice))) out.push(['sm-orig', 'globe', S.trOrig[m.id] ? 'Show translation' : 'Show original']);
  if (m.body) out.push(['sm-ask', 'spark', 'Ask Favor Brain about this']);
  if (mine) out.push(['del', 'trash', 'Delete', true]);
  return out;
}
export function runAction(e: ChatEngine, act: string, m: J, on?: boolean) {
  e.setPop(null);
  if (act === 'edit') e.startEdit(m.id);
  else if (act === 'copy') e.copyText(m.id);
  else if (act === 'copy-link') e.copyLink(m.id);
  else if (act === 'pin') e.pin(m.id, !!on);
  else if (act === 'mark-unread') e.markUnread(m.id);
  else if (act === 'make-request') e.setModal({ kind: 'request', from: m.id });
  else if (act === 'sm-turn') e.setModal({ kind: 'turn', id: m.id });
  else if (act === 'sm-orig') e.toggleOrig(m.id);
  else if (act === 'sm-ask') {
    e.setModal(null);
    e.openThread(m.thread_id || m.id);
    e.composerFocus = { scope: 'thread', n: Date.now(), prefix: '@Favor Brain ' };
    e.notify();
  } else if (act === 'del') e.setModal({ kind: 'del', id: m.id });
  else if (act === 'thread') {
    e.setModal(null);
    e.openThread(m.thread_id || m.id);
  }
}

/* ------------------------------------------------------------------ the menu */
export function PopLayer({ e, root }: { e: ChatEngine; root: React.RefObject<HTMLElement | null> }) {
  const p = e.ui.pop;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const r = root.current;
    if (!p || !el || !r) return;
    const rr = r.getBoundingClientRect();
    const ar = p.anchor;
    const pr = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, ar.left - rr.left), rr.width - pr.width - 8);
    let top = p.below ? ar.bottom - rr.top + 6 : ar.top - rr.top - pr.height - 8;
    if (top < 8) top = ar.bottom - rr.top + 6;
    if (top + pr.height > rr.height - 8) top = Math.max(8, rr.height - pr.height - 8);
    setPos((o) => (o && o.left === left && o.top === top ? o : { left, top }));
  });
  useEffect(() => setPos(null), [p && p.kind, p && p.id, p && p.scope]);
  // A press outside the menu closes it.
  useEffect(() => {
    if (!p) return;
    const down = (ev: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(ev.target as Node) && !(ev.target as HTMLElement).closest?.('[data-act="more"],[data-act="react-pick"],[data-act="plus"],[data-act="emoji"],[data-act="sm-lang"],[data-sfrom],textarea[data-ta]')) e.setPop(null);
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [p, e]);
  // Draw the emoji picker from chat-emoji.js once its box is there.
  const emo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const E = W.FavorChatEmoji;
    if (!p || p.kind !== 'emoji' || !E || !emo.current) return;
    emo.current.innerHTML = E.html();
    E.bind(emo.current.querySelector('.ch-emo'), (em: string, ev?: KeyboardEvent) => {
      pickEmoji(e, p, em);
      if (!(ev && ev.shiftKey)) e.setPop(null);
    });
  }, [p, e]);
  if (!p) return null;
  const style: React.CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' };
  const cls = (c: string) => 'ch-pop ' + c;
  if (p.kind === 'more') {
    const m = e.findMsg(p.id);
    if (!m || m.deleted) return null;
    return (
      <div ref={ref} className={cls('ch-pop--menu ch-pop--more')} role="menu" style={style}>
        {msgActions(e, m).map((a) => (
          <button key={a[0]} type="button" className={'ch-pop__i ch-pop__i--line' + (a[3] ? ' is-danger' : '')} role="menuitem" data-act={a[0]} onClick={() => runAction(e, a[0], m, a[4])}>
            <Ic n={a[1]} />
            <span>{a[2]}</span>
          </button>
        ))}
      </div>
    );
  }
  if (p.kind === 'emoji') {
    if (W.FavorChatEmoji) return <div ref={(el) => { ref.current = el; emo.current = el; }} className={cls('ch-pop--emo')} role="menu" style={style} />;
    return (
      <div ref={ref} className={cls('ch-pop--emoji')} role="menu" style={style}>
        {EMOJI.map((em) => (
          <button key={em} type="button" data-e={em} aria-label={em} onClick={() => { pickEmoji(e, p, em); e.setPop(null); }}>
            {em}
          </button>
        ))}
      </div>
    );
  }
  if (p.kind === 'plus') {
    const it = (act: string, icon: string, tint: string, ink: string, t: string, sub: string, fn: () => void) => (
      <button key={act} type="button" className="ch-pop__i" role="menuitem" data-act={act} onClick={() => { e.setPop(null); fn(); }}>
        <b style={{ background: tint, color: ink }}>
          <Ic n={icon} />
        </b>
        <span>
          {t}
          <small>{sub}</small>
        </span>
      </button>
    );
    const sc = p.scope;
    return (
      <div ref={ref} className={cls('ch-pop--menu')} role="menu" style={style}>
        {it('upload', 'clip', 'var(--tc-slate-tint)', 'var(--tc-slate-ink)', 'Upload a file', 'From your files', () => e.boxes[sc]?.file())}
        {it('drive-pick', 'drive', 'var(--tc-sky-tint)', 'var(--tc-sky-ink)', 'Share from Drive', 'Search the Drive library', () => e.setModal({ kind: 'drive', scope: sc }))}
        {it('clip-pick', 'rec', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Share a clip', 'Pick from your clips', () => e.setModal({ kind: 'clips', scope: sc }))}
        {it('clip-rec', 'play', 'var(--tc-terra-tint)', 'var(--tc-terra-ink)', 'Record a clip', 'Posts here when you finish', () => e.recordClip())}
        {it('meeting', 'video', 'var(--tc-teal-tint)', 'var(--tc-teal-ink)', 'Start a meeting', 'Posts a Join card', () => e.openHuddle(e.S.active))}
        {it('request-new', 'task', 'var(--tc-leaf-tint)', 'var(--tc-leaf-ink)', 'Make a request', 'Adds a card to the request board', () => e.setModal({ kind: 'request', thread: sc === 'thread' ? e.S.threadRoot : null }))}
      </div>
    );
  }
  if (p.kind === 'lang') {
    const S = e.S;
    return (
      <div ref={ref} className={cls('ch-pop--menu')} role="menu" style={style}>
        <div className="ch-pop__h">I read Chat in</div>
        <button type="button" className={'ch-pop__i ch-pop__i--line' + (!S.lang ? ' is-on' : '')} data-act="sm-setlang" onClick={() => e.setLang('')}>
          <span>Original, no translation</span>
        </button>
        {(S.langs || []).map((l: J) => (
          <button key={l.code} type="button" className={'ch-pop__i ch-pop__i--line' + (S.lang === l.code ? ' is-on' : '')} data-act="sm-setlang" data-lang={l.code} onClick={() => e.setLang(l.code)}>
            <span>
              {l.native}
              {l.native !== l.name && <small> {l.name}</small>}
            </span>
          </button>
        ))}
      </div>
    );
  }
  if (p.kind === 'mention') {
    return (
      <div ref={ref} className={cls('ch-pop--mention')} role="listbox" style={style}>
        <div className="ch-pop__h">People</div>
        {p.items.map((o: J, i: number) => (
          <button key={(o.kind || '') + o.id} type="button" className={'ch-pop__i' + (i === p.i ? ' is-on' : '')} role="option" data-act="mention-pick" onMouseDown={(ev) => ev.preventDefault()} onClick={() => e.boxes[p.scope]?.pickMention(i)}>
            <b style={{ background: 'transparent' }}>
              {o.ent ? (
                <span className="ch-av ch-av--sm" data-c={o.kind === 'f' ? 'leaf' : 'sky'}>
                  {o.kind === 'f' ? 'F' : 'P'}
                </span>
              ) : o.brain ? (
                <span className="ch-av ch-av--sm ch-av--brain">
                  <Ring state="still" />
                </span>
              ) : o.special ? (
                <span className="ch-av ch-av--sm" data-c="sun">
                  @
                </span>
              ) : (
                <Avatar u={o.u} size="sm" />
              )}
            </b>
            <span>
              {o.name}
              {o.sub && <small>{o.sub}</small>}
            </span>
          </button>
        ))}
      </div>
    );
  }
  if (p.kind === 'slash') {
    return (
      <div ref={ref} className={cls('ch-pop--mention ch-pop--slash')} role="listbox" style={style}>
        <div className="ch-pop__h">Commands</div>
        {p.list.map((c: J, i: number) => (
          <button key={c.cmd} type="button" className={'ch-pop__i' + (i === p.i ? ' is-on' : '')} role="option" data-act="slash-pick" onMouseDown={(ev) => ev.preventDefault()} onClick={() => e.boxes[p.scope]?.pickSlash(i)}>
            <b style={{ background: 'var(--r-sunk)', color: 'var(--r-ink-2)' }}>
              <Ic n={c.icon} />
            </b>
            <span>
              /{c.cmd}
              {c.args && <em> {c.args}</em>}
              <small>{c.sub}</small>
            </span>
          </button>
        ))}
      </div>
    );
  }
  if (p.kind === 'from') {
    const S = e.S;
    const ids = Object.keys(S.users).sort((a, b) => S.users[a].name.localeCompare(S.users[b].name));
    return (
      <div ref={ref} className={cls('ch-pop--mention ch-pop--from')} role="menu" style={style}>
        <button type="button" className="ch-pop__i" onClick={() => p.pick('')}>
          <span>Anyone</span>
        </button>
        {ids.map((id) => (
          <button key={id} type="button" className="ch-pop__i" onClick={() => p.pick(id)}>
            <b style={{ background: 'transparent' }}>
              <Avatar u={S.users[id]} size="sm" />
            </b>
            <span>
              {S.users[id].name}
              {id === S.me.id ? ' (you)' : ''}
            </span>
          </button>
        ))}
      </div>
    );
  }
  return null;
}
function pickEmoji(e: ChatEngine, p: PopT, em: string) {
  if (p.id) void e.react(p.id, em).catch(() => undefined);
  else if (p.scope) e.boxes[p.scope]?.insert(em);
}

/* ------------------------------------------------------------------ dialogs */
function Dlg({ e, title, children, foot, cls }: { e: ChatEngine; title: string; children: ReactNode; foot?: ReactNode; cls?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const f = box.current?.querySelector<HTMLElement>('input:not([type=checkbox]),textarea');
    if (f && !matchMedia('(max-width: 860px)').matches) f.focus();
  }, []);
  return (
    <div className={'ch-scrim' + (cls ? ' ' + cls : '')} onClick={(ev) => ev.target === ev.currentTarget && e.setModal(null)}>
      <div className="ch-dlg ch-modal" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="ch-dlg__h">
          <h3>{title}</h3>
          <button type="button" className="ch-iconbtn" data-act="modal-x" aria-label="Close" onClick={() => e.setModal(null)}>
            <Ic n="x" />
          </button>
        </div>
        <div className="ch-dlg__b">{children}</div>
        {foot && <div className="ch-dlg__f">{foot}</div>}
      </div>
    </div>
  );
}
const Cancel = ({ e }: { e: ChatEngine }) => (
  <button type="button" className="ch-btn" data-act="modal-x" onClick={() => e.setModal(null)}>
    Cancel
  </button>
);
function Quote({ e, m, n = 220 }: { e: ChatEngine; m: J; n?: number }) {
  return (
    <div className="ch-quote">
      <b>{e.user(m.user_id).name}</b>
      <span>{plain(m.body, e.names).replace(/\*\*|~~/g, '').replace(/\s+/g, ' ').trim().slice(0, n) || 'A message with an attachment'}</span>
    </div>
  );
}

export function ModalLayer({ e }: { e: ChatEngine }) {
  const md = e.ui.modal;
  // The back gesture closes a dialog.
  useEffect(() => {
    if (!md || e.dock) return;
    const t = hubOv.on(() => e.setModal(null));
    return () => hubOv.off(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md && md.kind, md && md.id]);
  if (!md) return null;
  const k = md.kind;
  if (k === 'del')
    return (
      <Dlg
        e={e}
        title="Delete message"
        foot={
          <>
            <Cancel e={e} />
            <button type="button" className="ch-btn ch-btn--primary" data-act="del-yes" onClick={() => e.del(md.id)}>
              Delete
            </button>
          </>
        }
      >
        <p style={{ margin: '4px 0 8px' }}>This removes the message for everyone in the conversation.</p>
      </Dlg>
    );
  if (k === 'msheet') return <MsgSheet e={e} id={md.id} />;
  if (k === 'emoji') return <EmojiSheet e={e} md={md} />;
  if (k === 'request') return <RequestDlg e={e} md={md} />;
  if (k === 'turn') return <TurnDlg e={e} id={md.id} />;
  if (k === 'remind') return <RemindDlg e={e} id={md.id} />;
  if (k === 'bb') return <BbDlg e={e} id={md.id} />;
  if (k === 'bookmark') return <BookmarkDlg e={e} />;
  if (k === 'newchannel') return <NewChannelDlg e={e} />;
  if (k === 'browse') return <BrowseDlg e={e} />;
  if (k === 'people') return <PeopleDlg e={e} md={md} />;
  if (k === 'drive') return <DriveDlg e={e} scope={md.scope} />;
  if (k === 'clips') return <ClipsDlg e={e} scope={md.scope} />;
  return null;
}

function MsgSheet({ e, id }: { e: ChatEngine; id: number }) {
  const m = e.findMsg(id);
  if (!m || m.deleted) return null;
  const E = W.FavorChatEmoji;
  const quick: string[] = (E ? E.quick.map(E.toned) : EMOJI).slice(0, 11);
  const row = (a: [string, string, string, boolean?, boolean?]) => (
    <button key={a[0]} type="button" className={'ch-msheet__row' + (a[3] ? ' is-danger' : '')} data-act={a[0]} onClick={() => { e.setModal(null); runAction(e, a[0], m, a[4]); }}>
      <Ic n={a[1]} />
      <span>{a[2]}</span>
    </button>
  );
  return (
    <Dlg e={e} title={e.user(m.user_id).name + ', ' + timeOf(m.created_at)}>
      <div className="ch-msheet">
        {!m.visible_to && (
          <div className="ch-msheet__rx">
            {quick.map((q) => (
              <button key={q} type="button" data-act="react" aria-label={'React ' + q} onClick={() => { e.setModal(null); void e.react(m.id, q).catch(() => undefined); }}>
                {q}
              </button>
            ))}
            <button type="button" data-act="react-more" aria-label="More emoji" onClick={() => e.setModal({ kind: 'emoji', id: m.id })}>
              <Ic n="smile" />
            </button>
          </div>
        )}
        {!m.visible_to && !m.thread_id && row(['thread', 'reply', 'Reply in thread'])}
        {msgActions(e, m).map(row)}
      </div>
    </Dlg>
  );
}
function EmojiSheet({ e, md }: { e: ChatEngine; md: J }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const E = W.FavorChatEmoji;
    if (!E || !ref.current) return;
    ref.current.innerHTML = E.html();
    E.bind(
      ref.current.querySelector('.ch-emo'),
      (em: string) => {
        e.setModal(null);
        if (md.id) void e.react(md.id, em).catch(() => undefined);
        else if (md.scope) e.boxes[md.scope]?.insert(em);
      },
      { noFocus: true }
    );
  }, [e, md]);
  return (
    <Dlg e={e} title="Emoji" cls="ch-scrim--emo">
      <div ref={ref} />
    </Dlg>
  );
}
function RequestDlg({ e, md }: { e: ChatEngine; md: J }) {
  const from = md.from ? e.findMsg(md.from) : null;
  const [busy, setBusy] = useState(false);
  const t = useRef<HTMLInputElement>(null);
  const b = useRef<HTMLTextAreaElement>(null);
  const s = useRef<HTMLSelectElement>(null);
  const go = () => {
    const title = (t.current?.value || '').trim();
    if (!title) return e.toast('Give the request a one-line summary');
    setBusy(true);
    e.makeRequest({ channel: e.S.active, title, body: (b.current?.value || '').trim(), surface: s.current?.value, from_message: from ? from.id : undefined, thread_id: md.thread || undefined }).catch(() => setBusy(false));
  };
  return (
    <Dlg
      e={e}
      title="New request"
      foot={
        <>
          <Cancel e={e} />
          <button type="button" className="ch-btn ch-btn--primary" data-act="rq-create" disabled={busy} onClick={go}>
            Create request
          </button>
        </>
      }
    >
      {from && <Quote e={e} m={from} />}
      <label className="ch-field">
        <span>Summary</span>
        <input ref={initValue(md.title || (from ? plain(from.body, e.names).replace(/\s+/g, ' ').trim().slice(0, 90) : ''), t)} className="ch-input" data-rq-title maxLength={160} placeholder="One line" />
      </label>
      <label className="ch-field">
        <span>Details</span>
        <textarea ref={b} className="ch-input ch-input--area" data-rq-body rows={4} maxLength={8000} placeholder="What is needed, and by when" />
      </label>
      <label className="ch-field">
        <span>About</span>
        <select ref={initValue('website', s)} className="ch-input" data-rq-surface>
          <option value="website">Website</option>
          <option value="portal">Portal</option>
          <option value="dashboard">Hub</option>
          <option value="app">App</option>
        </select>
      </label>
    </Dlg>
  );
}
function TurnDlg({ e, id }: { e: ChatEngine; id: number }) {
  const m = e.findMsg(id);
  if (!m) return null;
  const first = (plain(m.body, e.names).split(/(?<=[.!?])\s/)[0] || plain(m.body, e.names)).replace(/\*\*|~~/g, '').slice(0, 140);
  const row = (act: string, ic: string, t: string, s: string, fn: () => void) => (
    <button key={act} type="button" className="sm-turn__i" data-act={act} onClick={fn}>
      <Ic n={ic} />
      <span>
        <b>{t}</b>
        <small>{s}</small>
      </span>
    </button>
  );
  return (
    <Dlg e={e} title="Turn this message into">
      <Quote e={e} m={m} />
      <div className="sm-turn">
        {W.PJLinks &&
          row('sm-t-task', 'task', 'A task', 'Goes on your Projects list, with a link back here', () => {
            e.setModal(null);
            W.PJLinks.makeTask({ messageId: id, title: first });
          })}
        {row('sm-t-request', 'task', 'A request', 'A card on the request board', () => e.setModal({ kind: 'request', from: id }))}
        {row('sm-t-remind', 'bell', 'A reminder', 'Shows in the bell when it is due', () => e.setModal({ kind: 'remind', id }))}
        {row('sm-t-bb', 'file', 'A Blackbaud action', 'Logged on a partner record after you review it', () => e.setModal({ kind: 'bb', id }))}
      </div>
    </Dlg>
  );
}
function RemindDlg({ e, id }: { e: ChatEngine; id: number }) {
  const m = e.findMsg(id);
  const d = useRef<HTMLInputElement>(null);
  const t = useRef<HTMLInputElement>(null);
  if (!m) return null;
  const opts = [
    ['hour', 'In an hour'],
    ['afternoon', 'This afternoon'],
    ['tomorrow', 'Tomorrow morning'],
    ['nextweek', 'Next Monday'],
  ];
  return (
    <Dlg e={e} title="Remind me about this message">
      <Quote e={e} m={m} n={200} />
      <div className="sm-turn">
        {opts.map((o) => (
          <button key={o[0]} type="button" className="sm-turn__i sm-turn__i--s" data-act="sm-rem-set" data-code={o[0]} onClick={() => e.remind(id, { code: o[0] })}>
            <span>
              <b>{o[1]}</b>
            </span>
          </button>
        ))}
      </div>
      <div className="sm-when">
        <label className="ch-field">
          <span>Or pick a day and time</span>
          <span className="sm-when__r">
            <input className="ch-input" type="date" ref={d} />
            <input className="ch-input" type="time" ref={initValue('09:00', t)} />
          </span>
        </label>
        <button
          type="button"
          className="ch-btn ch-btn--primary"
          data-act="sm-rem-date"
          onClick={() => {
            const dv = d.current?.value;
            if (!dv) return e.toast('Pick a day first');
            e.remind(id, { date: dv, time: t.current?.value || '09:00' });
          }}
        >
          Remind me then
        </button>
      </div>
    </Dlg>
  );
}
const HOW = [
  ['call', 'Phone call'],
  ['email', 'Email'],
  ['meet', 'Meeting'],
  ['text', 'Text'],
  ['vm', 'Voicemail'],
  ['mail', 'Mail'],
];
function BbDlg({ e, id }: { e: ChatEngine; id: number }) {
  const m = e.findMsg(id);
  const chip = String((m && m.body) || '').match(/<~p:(\d{1,12})\|([^>]+)>/);
  const [pick, setPick] = useState<null | { cid: string; name: string }>(chip ? { cid: chip[1], name: chip[2] } : null);
  const [owners, setOwners] = useState<J[] | null>(null);
  const [mine, setMine] = useState('');
  const [err, setErr] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [f, setF] = useState({ owner: '', how: 'call', date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), summary: m ? plain(m.body, e.names).slice(0, 255) : '' });
  const [res, setRes] = useState<J[] | null>(null);
  const [busy, setBusy] = useState(false);
  const qT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    chatApi
      .owners()
      .then((d) => {
        setOwners(d.owners || []);
        setMine(d.mine || (d.owners && d.owners[0] && d.owners[0].fid) || '');
      })
      .catch((x) => setErr(x.message));
  }, []);
  const owner = f.owner || mine;
  const close = <Cancel e={e} />;
  if (owners && !owners.length)
    return (
      <Dlg e={e} title="Log in Blackbaud" foot={<button type="button" className="ch-btn" onClick={() => e.setModal(null)}>Close</button>}>
        <p className="sm-note">Logging in Blackbaud is for people who use the Work Center.</p>
      </Dlg>
    );
  if (!owners)
    return (
      <Dlg e={e} title="Log in Blackbaud">
        {err ? <p className="sm-err">{err}</p> : <p className="sm-note">Loading</p>}
      </Dlg>
    );
  const how = HOW.filter((h) => h[0] === f.how)[0];
  const ow = owners.filter((o) => o.fid === owner)[0];
  if (step === 'review' && pick)
    return (
      <Dlg
        e={e}
        title="Log in Blackbaud"
        foot={
          <>
            <button type="button" className="ch-btn" onClick={() => setStep('form')}>
              Back
            </button>
            <button
              type="button"
              className="ch-btn ch-btn--primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                fetch('/api/work/entry/many', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ owner, date: f.date, channel: f.how, summary: f.summary, tags: [], constituent_ids: [pick.cid], req: 'chat-' + id + '-' + pick.cid + '-' + f.date }) })
                  .then((r) => r.json().then((d) => ({ r, d })))
                  .then(({ r, d }) => {
                    if (!r.ok || d.ok === false) throw new Error(d.message || 'That did not work. Try again.');
                    e.setModal(null);
                    e.toast(d.dups && !d.created ? 'That contact is already on the record' : 'Saved to ' + pick.name + "'s record in Blackbaud");
                  })
                  .catch((x) => {
                    setBusy(false);
                    e.toast(x.message);
                  });
              }}
            >
              {busy ? 'Saving' : 'Save to Blackbaud'}
            </button>
          </>
        }
      >
        <div className="sm-review">
          <p>
            <b>
              A completed {how[1].toLowerCase()} on {pick.name}'s record
            </b>
          </p>
          <dl>
            <div>
              <dt>Partner</dt>
              <dd>{pick.name}</dd>
            </div>
            <div>
              <dt>Whose contact</dt>
              <dd>{ow ? ow.name : ''}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{new Date(f.date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{f.summary}</dd>
            </div>
          </dl>
        </div>
      </Dlg>
    );
  return (
    <Dlg
      e={e}
      title="Log in Blackbaud"
      foot={
        <>
          {close}
          <button
            type="button"
            className="ch-btn ch-btn--primary"
            data-act="sm-bb-review"
            onClick={() => {
              if (!pick) return setErr('Pick the partner first.');
              if (!f.summary.trim()) return setErr('Say what happened in one line.');
              setErr('');
              setStep('review');
            }}
          >
            Review
          </button>
        </>
      }
    >
      {err && <p className="sm-err">{err}</p>}
      <div className="ch-field">
        <span>Partner</span>
        {pick ? (
          <span className="sm-pick">
            <b>{pick.name}</b>
            <button type="button" onClick={() => setPick(null)}>
              Change
            </button>
          </span>
        ) : (
          <div>
            <input
              className="ch-input"
              placeholder="Search by name, email or phone"
              autoComplete="off"
              onInput={(ev) => {
                const term = ev.currentTarget.value.trim();
                clearTimeout(qT.current);
                if (term.length < 2) return setRes(null);
                qT.current = setTimeout(() => {
                  fetch('/api/work/partners?q=' + encodeURIComponent(term), { credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } })
                    .then((r) => r.json())
                    .then((d) => setRes(((d.rows || []) as J[]).filter((x) => !x.deceased).slice(0, 6)))
                    .catch(() => setRes([]));
                }, 250);
              }}
            />
            <div className="sm-res">
              {res && !res.length && <p className="sm-note">No partner found</p>}
              {(res || []).map((x) => (
                <button key={x.cid} type="button" className="sm-res__i" onClick={() => setPick({ cid: x.cid, name: x.name })}>
                  <b>{x.name}</b>
                  <small>{x.place || ''}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <label className="ch-field">
        <span>Whose contact</span>
        <select className="ch-input" value={owner} onChange={(ev) => setF({ ...f, owner: ev.currentTarget.value })}>
          {owners.map((o) => (
            <option key={o.fid} value={o.fid}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <div className="sm-two">
        <label className="ch-field">
          <span>How</span>
          <select className="ch-input" value={f.how} onChange={(ev) => setF({ ...f, how: ev.currentTarget.value })}>
            {HOW.map((h) => (
              <option key={h[0]} value={h[0]}>
                {h[1]}
              </option>
            ))}
          </select>
        </label>
        <label className="ch-field">
          <span>Date</span>
          <input className="ch-input" type="date" value={f.date} onChange={(ev) => setF({ ...f, date: ev.currentTarget.value })} />
        </label>
      </div>
      <label className="ch-field">
        <span>What happened</span>
        <input className="ch-input" maxLength={255} value={f.summary} onInput={(ev) => setF({ ...f, summary: ev.currentTarget.value })} />
      </label>
    </Dlg>
  );
}
function BookmarkDlg({ e }: { e: ChatEngine }) {
  const u = useRef<HTMLInputElement>(null);
  const t = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dlg
      e={e}
      title="Add a bookmark"
      foot={
        <>
          <Cancel e={e} />
          <button
            type="button"
            className="ch-btn ch-btn--primary"
            data-act="bm-save"
            disabled={busy}
            onClick={() => {
              const url = (u.current?.value || '').trim();
              if (!url) return e.toast('Paste a link first');
              setBusy(true);
              e.addBookmark(url, (t.current?.value || '').trim()).catch(() => setBusy(false));
            }}
          >
            Add
          </button>
        </>
      }
    >
      <label className="ch-field">
        <span>Link</span>
        <input ref={u} className="ch-input" placeholder="https:// or a FavorOS page such as /reports/" maxLength={600} inputMode="url" />
      </label>
      <label className="ch-field">
        <span>Name</span>
        <input ref={t} className="ch-input" placeholder="Shown in the bar" maxLength={60} />
      </label>
    </Dlg>
  );
}
function NewChannelDlg({ e }: { e: ChatEngine }) {
  const n = useRef<HTMLInputElement>(null);
  const t = useRef<HTMLInputElement>(null);
  const p = useRef<HTMLInputElement>(null);
  return (
    <Dlg
      e={e}
      title="New channel"
      foot={
        <>
          <Cancel e={e} />
          <button
            type="button"
            className="ch-btn ch-btn--primary"
            data-act="nc-create"
            onClick={() => {
              const name = (n.current?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
              if (!name) return e.toast('Give the channel a name');
              void e.createChannel({ name, topic: (t.current?.value || '').trim(), private: !!p.current?.checked }).catch(() => undefined);
            }}
          >
            Create channel
          </button>
        </>
      }
    >
      <label className="ch-field">
        <span>Name</span>
        <input ref={n} className="ch-input" placeholder="grants-team" maxLength={40} />
      </label>
      <label className="ch-field">
        <span>Topic</span>
        <input ref={t} className="ch-input" placeholder="What it is for" maxLength={200} />
      </label>
      <label className="ch-switch">
        <input type="checkbox" ref={p} /> Make it private
      </label>
    </Dlg>
  );
}
function BrowseDlg({ e }: { e: ChatEngine }) {
  const [items, setItems] = useState<J[] | null>(null);
  useEffect(() => {
    e.guard(chatApi.browse())
      .then((r) => setItems(r.channels || []))
      .catch(() => setItems([]));
  }, [e]);
  return (
    <Dlg e={e} title="Browse channels">
      <div className="ch-pick">
        {!items ? (
          <div className="ch-skel">
            <i style={{ width: '60%' }} />
            <i style={{ width: '80%' }} />
          </div>
        ) : !items.length ? (
          <div className="ch-empty">No other channels</div>
        ) : (
          items.map((c) => {
            const joined = e.chan(c.id) && e.chan(c.id)!.joined !== false;
            return (
              <button key={c.id} type="button" className="ch-pick__i" data-act="browse-open" onClick={() => { e.setModal(null); if (joined) e.openChannel(c.id); else void e.join(c.id).catch(() => undefined); }}>
                <span className="ch-row__ic" style={{ fontSize: 20 }}>
                  #
                </span>
                <span>
                  <b>{c.name}</b>
                  {c.topic && <small>{c.topic}</small>}
                  <small>{(c.member_count || 0).toLocaleString('en-US') + ' ' + (c.member_count === 1 ? 'member' : 'members')}</small>
                </span>
                {joined ? <span className="ch-badge">Joined</span> : <span className="ch-btn ch-btn--sm">Join</span>}
              </button>
            );
          })
        )}
      </div>
    </Dlg>
  );
}
function PeopleDlg({ e, md }: { e: ChatEngine; md: J }) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const S = e.S;
  const ex: string[] = md.exclude || [];
  const list = Object.keys(S.users)
    .filter((id) => id !== S.me.id && ex.indexOf(id) < 0 && S.users[id].name.toLowerCase().indexOf(q.toLowerCase()) >= 0)
    .sort((a, b) => S.users[a].name.localeCompare(S.users[b].name));
  const done = (ids: string[]) => {
    e.setModal(null);
    if (md.mode === 'add') e.addMembers(ids);
    else void e.openDm(ids).catch(() => undefined);
  };
  return (
    <Dlg
      e={e}
      title={md.mode === 'add' ? 'Add people' : 'New message'}
      foot={
        <>
          <Cancel e={e} />
          <button type="button" className="ch-btn ch-btn--primary" data-act="pp-done" disabled={!chosen.length} onClick={() => done(chosen)}>
            Done
          </button>
        </>
      }
    >
      <input className="ch-input" data-pp-q placeholder="Search people" aria-label="Search people" value={q} onInput={(ev) => setQ(ev.currentTarget.value)} />
      <div className="ch-chosen">
        {chosen.map((id) => (
          <button key={id} type="button" onClick={() => setChosen(chosen.filter((x) => x !== id))}>
            {e.user(id).name}
            <Ic n="x" />
          </button>
        ))}
      </div>
      <div className="ch-pick">
        {list.length ? (
          list.map((id) => {
            const u = S.users[id];
            const on = chosen.indexOf(id) >= 0;
            return (
              <button key={id} type="button" className={'ch-pick__i' + (on ? ' is-on' : '')} data-pp={id} onClick={() => setChosen(on ? chosen.filter((x) => x !== id) : chosen.concat([id]))}>
                <Avatar u={u} dot />
                <span>
                  <b>{u.name}</b>
                  <small>{u.title || ''}</small>
                </span>
                {on && <Ic n="check" />}
              </button>
            );
          })
        ) : (
          <div className="ch-empty">No one matches</div>
        )}
      </div>
    </Dlg>
  );
}
function DriveDlg({ e, scope }: { e: ChatEngine; scope: 'main' | 'thread' }) {
  const [items, setItems] = useState<J[] | null>(null);
  const [q, setQ] = useState('');
  const tm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const LABS: Record<string, string> = { doc: 'DOC', sheet: 'XLS', pdf: 'PDF', slides: 'PPT', photo: 'IMG', file: 'FILE' };
  return (
    <Dlg e={e} title="Share from Drive">
      <input
        className="ch-input"
        placeholder="Search the Drive library"
        aria-label="Search the Drive library"
        onInput={(ev) => {
          const v = ev.currentTarget.value.trim();
          setQ(v);
          clearTimeout(tm.current);
          if (v.length < 2) return setItems(null);
          tm.current = setTimeout(() => {
            setItems([]);
            e.guard(chatApi.driveSearch(v))
              .then((r) => setItems(r.files || []))
              .catch(() => setItems([]));
          }, 220);
        }}
      />
      <div className="ch-pick">
        {q.length < 2 || !items ? (
          <div className="ch-empty">Type to search</div>
        ) : !items.length ? (
          <div className="ch-empty">No files match</div>
        ) : (
          items.map((f, i) => (
            <button key={i} type="button" className="ch-pick__i" data-act="drive-choose" onClick={() => { e.setModal(null); e.pend(scope, Object.assign({ type: 'drive' }, f)); }}>
              <span className="ch-file__ic" data-k={f.kind || 'file'} style={{ width: 36, height: 36, fontSize: 13 }}>
                {LABS[f.kind] || 'FILE'}
              </span>
              <span>
                <b>{f.name}</b>
                <small>
                  {f.path || ''}
                  {f.indexed ? ' · Indexed ' + f.indexed : ''}
                </small>
              </span>
            </button>
          ))
        )}
      </div>
    </Dlg>
  );
}
function ClipsDlg({ e, scope }: { e: ChatEngine; scope: 'main' | 'thread' }) {
  const [items, setItems] = useState<J[] | null>(null);
  useEffect(() => {
    e.guard(chatApi.clips())
      .then((r) => setItems(r.clips || []))
      .catch(() => setItems([]));
  }, [e]);
  return (
    <Dlg e={e} title="Share a clip">
      <div className="ch-pick">
        {!items ? (
          <div className="ch-skel">
            <i style={{ width: '70%' }} />
            <i style={{ width: '50%' }} />
          </div>
        ) : !items.length ? (
          <div className="ch-empty">No clips yet</div>
        ) : (
          items.map((c, i) => (
            <button key={i} type="button" className="ch-pick__i" data-act="clip-choose" onClick={() => { e.setModal(null); e.pend(scope, Object.assign({ type: 'clip' }, c)); }}>
              <span className="ch-file__ic" data-k="pdf" style={{ width: 36, height: 36 }}>
                <Ic n="play" />
              </span>
              <span>
                <b>{c.title}</b>
                <small>
                  {c.duration || ''}
                  {c.when ? ' · ' + c.when : ''}
                </small>
              </span>
            </button>
          ))
        )}
      </div>
    </Dlg>
  );
}

/* ------------------------------------------------------------------ Ctrl K and search */
export function SwitcherLayer({ e }: { e: ChatEngine }) {
  const sw = e.ui.switcher;
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [all, setAll] = useState<J[] | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const res = useRef<HTMLDivElement>(null);
  // Enter pressed before the list drew the last letters typed: draw it, then pick (see onKeyDown).
  const enterAfter = useRef(false);
  const pickNow = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    if (!enterAfter.current) return;
    enterAfter.current = false;
    pickNow.current();
  });
  // Set up as soon as the box opens, before any key lands, so nothing typed right after Ctrl K is cleared.
  useLayoutEffect(() => {
    if (!sw) return;
    setQ('');
    setI(0);
    inp.current?.focus();
    chatApi
      .browse()
      .then((r) => setAll(r.channels || []))
      .catch(() => undefined);
    if (e.dock) return;
    const t = hubOv.on(() => {
      e.ui.switcher = null;
      e.notify();
    });
    return () => hubOv.off(t);
  }, [sw, e]);
  if (!sw) return null;
  const S = e.S;
  const v = q.trim().toLowerCase();
  const hit = (name: string) => !v || name.toLowerCase().indexOf(v) >= 0;
  const s = e.sorted();
  const items: J[] = [];
  const mineCh = s.chans.concat(s.dms).filter((c) => hit(e.chName(c)));
  mineCh.sort((a, b) => {
    if (v) {
      const x = e.chName(a).toLowerCase().indexOf(v) === 0 ? 0 : 1;
      const y = e.chName(b).toLowerCase().indexOf(v) === 0 ? 0 : 1;
      if (x !== y) return x - y;
    }
    return Number(b.unread > 0) - Number(a.unread > 0) || String(b.last_at || '').localeCompare(String(a.last_at || ''));
  });
  mineCh.slice(0, v ? 8 : 10).forEach((c) => items.push({ t: 'ch', c }));
  if (v) {
    const inDm: Record<string, 1> = {};
    s.dms.forEach((c) => c.kind === 'dm' && (c.members || []).forEach((m: string) => (inDm[m] = 1)));
    Object.keys(S.users)
      .filter((id) => id !== S.me.id && !inDm[id] && hit(S.users[id].name))
      .slice(0, 6)
      .forEach((id) => items.push({ t: 'user', u: S.users[id] }));
    (all || [])
      .filter((c) => !(e.chan(c.id) && e.chan(c.id)!.joined !== false) && hit(c.name))
      .slice(0, 4)
      .forEach((c) => items.push({ t: 'join', c }));
    if (v.length >= 2) items.push({ t: 'search', q: q.trim() });
  }
  const cur = Math.min(i, Math.max(0, items.length - 1));
  const close = () => {
    e.ui.switcher = null;
    e.notify();
  };
  const pick = (k: number) => {
    const it = items[k];
    if (!it) return;
    if (it.t === 'search') {
      e.ui.switcher = null;
      e.ui.search = { q: it.q, n: Date.now() };
      e.notify();
      return;
    }
    close();
    if (it.t === 'ch') e.openChannel(it.c.id);
    else if (it.t === 'user') void e.openDm([it.u.id]).catch(() => undefined);
    else if (it.t === 'join') void e.join(it.c.id).catch(() => undefined);
  };
  pickNow.current = () => pick(cur);
  return (
    <div className="ch-search ch-sw" onClick={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="ch-search__box" role="dialog" aria-label="Jump to a conversation">
        <div className="ch-search__in">
          <button type="button" className="ch-iconbtn ch-back" aria-label="Close" onClick={close}>
            <Ic n="back" />
          </button>
          <Ic n="search" />
          <input
            ref={inp}
            data-swq=""
            placeholder="Jump to a channel or a person"
            aria-label="Jump to a channel or a person"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="ch-sw-list"
            value={q}
            onInput={(ev) => {
              setQ(ev.currentTarget.value);
              setI(0);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                const n = Math.max(0, Math.min(items.length - 1, cur + (ev.key === 'ArrowDown' ? 1 : -1)));
                setI(n);
                (res.current?.children[n] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
              } else if (ev.key === 'Enter') {
                ev.preventDefault();
                if (ev.currentTarget.value !== q) {
                  enterAfter.current = true;
                  setQ(ev.currentTarget.value);
                  setI(0);
                } else pick(cur);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                close();
              }
            }}
          />
          <button type="button" className="ch-iconbtn" aria-label="Close" onClick={close}>
            <Ic n="x" />
          </button>
        </div>
        <div className="ch-search__res" id="ch-sw-list" role="listbox" ref={res}>
          {items.length ? (
            items.map((it, k) => {
              const on = k === cur ? ' is-on' : '';
              const at = { role: 'option', 'data-act': 'sw-pick', onClick: () => pick(k), type: 'button' as const };
              if (it.t === 'ch') {
                const c = it.c;
                const o = c.kind === 'dm' ? (c.members || []).filter((m: string) => m !== S.me.id)[0] || S.me.id : '';
                return (
                  <button key={k} className={'ch-sw__i' + on + (c.unread > 0 ? ' is-unread' : '')} {...at}>
                    {c.kind === 'public' ? <span className="ch-row__ic">#</span> : c.kind === 'private' ? <span className="ch-row__ic"><Ic n="lock" /></span> : c.kind === 'dm' ? <Avatar u={e.user(o)} size="sm" dot /> : <span className="ch-row__ic"><Ic n="users" /></span>}
                    <span className="ch-sw__n">{e.chName(c)}</span>
                    {c.mentions > 0 && <span className="ch-badge">{c.mentions}</span>}
                    {e.hasDraft(c.id) && <span className="ch-sw__m">Draft</span>}
                  </button>
                );
              }
              if (it.t === 'user')
                return (
                  <button key={k} className={'ch-sw__i' + on} {...at}>
                    <Avatar u={it.u} size="sm" dot />
                    <span className="ch-sw__n">{it.u.name}</span>
                    <span className="ch-sw__m">{it.u.title || 'New message'}</span>
                  </button>
                );
              if (it.t === 'join')
                return (
                  <button key={k} className={'ch-sw__i' + on} {...at}>
                    <span className="ch-row__ic">#</span>
                    <span className="ch-sw__n">{it.c.name}</span>
                    <span className="ch-sw__m">Join</span>
                  </button>
                );
              return (
                <button key={k} className={'ch-sw__i ch-sw__i--search' + on} {...at}>
                  <span className="ch-row__ic">
                    <Ic n="search" />
                  </span>
                  <span className="ch-sw__n">Search messages for “{it.q}”</span>
                </button>
              );
            })
          ) : (
            <div className="ch-empty">No channel or person matches</div>
          )}
        </div>
        <div className="ch-search__foot">
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

export function SearchLayer({ e }: { e: ChatEngine }) {
  const sr = e.ui.search;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [items, setItems] = useState<J[] | null>(null);
  const [i, setI] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  const tm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const run = (v: string, fl = filter, fr = from) => {
    clearTimeout(tm.current);
    if (v.trim().length < 2) {
      setItems(null);
      return;
    }
    tm.current = setTimeout(() => {
      e.guard(chatApi.search(v.trim(), { filter: fl, channel: e.S.active, from: fr }))
        .then((r) => {
          if (inp.current && inp.current.value.trim() !== v.trim()) return;
          setItems(r.results || []);
          setI(0);
        })
        .catch(() => undefined);
    }, 200);
  };
  // Set up as soon as the box opens, before any key lands, so nothing typed right after Ctrl K is cleared.
  useLayoutEffect(() => {
    if (!sr) return;
    setQ(sr.q || '');
    setFilter('all');
    setFrom('');
    setItems(null);
    inp.current?.focus();
    if (sr.q) run(sr.q, 'all', '');
    if (e.dock) return;
    const t = hubOv.on(() => {
      e.ui.search = null;
      e.notify();
    });
    return () => hubOv.off(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sr && sr.n]);
  if (!sr) return null;
  const close = () => {
    e.ui.search = null;
    e.setPop(null);
  };
  const v = q.trim();
  const rx = v ? new RegExp('(' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig') : null;
  return (
    <div className="ch-search" onClick={(ev) => ev.target === ev.currentTarget && close()}>
      <div className="ch-search__box" role="dialog" aria-label="Search messages">
        <div className="ch-search__in">
          <button type="button" className="ch-iconbtn ch-back" aria-label="Close search" onClick={close}>
            <Ic n="back" />
          </button>
          <Ic n="search" />
          <input
            ref={inp}
            data-sq=""
            placeholder="Search messages and files"
            aria-label="Search messages"
            autoComplete="off"
            value={q}
            onInput={(ev) => {
              setQ(ev.currentTarget.value);
              run(ev.currentTarget.value);
            }}
            onKeyDown={(ev) => {
              const n = (items || []).length;
              if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                ev.preventDefault();
                setI(Math.max(0, Math.min(n - 1, i + (ev.key === 'ArrowDown' ? 1 : -1))));
              } else if (ev.key === 'Enter' && items && items[i]) {
                ev.preventDefault();
                e.jumpTo(items[i]);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                close();
              }
            }}
          />
          <button type="button" className="ch-iconbtn" aria-label="Close search" onClick={close}>
            <Ic n="x" />
          </button>
        </div>
        <div className="ch-search__f">
          {[
            ['all', 'Everywhere'],
            ['here', 'In this conversation'],
            ['files', 'With files'],
            ['mine', 'Mentions of me'],
          ].map((f) => (
            <button
              key={f[0]}
              type="button"
              className={filter === f[0] ? 'is-on' : ''}
              data-sf={f[0]}
              onClick={() => {
                setFilter(f[0]);
                run(q, f[0]);
              }}
            >
              {f[1]}
            </button>
          ))}
          <button
            type="button"
            data-sfrom=""
            className={from ? 'is-on' : ''}
            onClick={(ev) =>
              e.setPop({
                kind: 'from',
                below: true,
                anchor: ev.currentTarget.getBoundingClientRect(),
                pick: (id: string) => {
                  setFrom(id);
                  e.setPop(null);
                  run(q, filter, id);
                },
              })
            }
          >
            {from ? 'From ' + e.user(from).name.split(' ')[0] : 'From anyone'}
          </button>
        </div>
        <div className="ch-search__res">
          {!items ? (
            <div className="ch-empty">Search every conversation you are in</div>
          ) : !items.length ? (
            <div className="ch-empty">Nothing found for “{v}”</div>
          ) : (
            items.map((h, k) => {
              const c = e.chan(h.channel_id);
              const cname = c ? e.chName(c) : h.channel_name || '';
              const files = (h.attachments || []).map((a: J) => a.name || a.title || '').filter(Boolean);
              const p = plain(h.body, e.names).replace(/<#[^>]+>/g, '');
              const hl = (s: string) => (rx ? esc(s).replace(rx, '<mark>$1</mark>') : esc(s));
              const text = p.trim() ? hl(p) : esc((h.attachments || []).some((a: J) => /^image\//.test(a.mime || '')) ? 'Shared an image' + (files[0] ? ': ' : '') : 'Shared a file' + (files[0] ? ': ' : '')) + hl(files.join(', '));
              return (
                <button key={h.id} type="button" className={'ch-hit' + (k === i ? ' is-on' : '')} data-act="hit" onClick={() => e.jumpTo(h)}>
                  <Avatar u={e.user(h.user_id)} />
                  <span>
                    <span className="ch-hit__m">
                      <b>{e.user(h.user_id).name}</b>
                      <span>
                        {(c ? c.kind : 'public') === 'public' ? '#' : ''}
                        {cname} · {fmtShort.format(new Date(h.created_at))}, {timeOf(h.created_at)}
                      </span>
                    </span>
                    <span className="ch-hit__t" dangerouslySetInnerHTML={{ __html: text }} />
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="ch-search__foot">
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

export function ToastLayer({ e }: { e: ChatEngine }) {
  const t = e.ui.toast;
  if (!t) return null;
  return (
    <div className="ch-toast" role="status">
      {t.text}
      {t.link && (
        <>
          {' '}
          <a href={t.link.href} target="_blank" rel="noopener">
            {t.link.label || 'Open'}
          </a>
        </>
      )}
    </div>
  );
}
