import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { dock, type DockToast } from './dockStore';

// The Chat tab draws with native Chat's own message list and message box (features/chat), loaded the first time the tab opens.
const DockChat = lazy(() => import('@/features/chat/DockChat'));

/** The floating dock for people who have Chat: a circle at the bottom right with a count, toasts with Reply, and a panel with Chat and Favor Brain tabs. */
export function Dock({ chat, page }: { chat: boolean; page: string }) {
  const s = useSyncExternalStore(dock.subscribe, dock.getSnapshot);
  useEffect(() => {
    dock.bind();
  }, []);
  useEffect(() => {
    dock.setEligible(chat, page);
  }, [chat, page]);
  // The page may finish drawing its buttons after this runs.
  useEffect(() => {
    dock.dodge();
  }, [page, s.show]);

  if (!s.live) return null;
  return (
    <>
      <div className={'fd' + (s.n ? ' has-n' : '') + (!s.show ? ' is-off' : '')} id="fd" style={{ ['--fd-lift' as string]: s.lift + 'px' }}>
        <button
          type="button"
          className="fd__btn"
          aria-haspopup="dialog"
          aria-expanded={s.open}
          aria-label={'Chat and Favor Brain' + (s.n ? ', ' + s.n + ' to read' : '')}
          title="Chat and Favor Brain (Ctrl .)"
          onClick={() => dock.toggle()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
          </svg>
          <b className="fd__n" hidden={!s.n}>
            {s.n > 99 ? '99+' : s.n}
          </b>
        </button>
        <div className="fd__tray" aria-live="polite">
          {s.toasts.map((t) => (
            <Toast key={t.id} t={t} />
          ))}
        </div>
      </div>
      <Panel s={s} />
    </>
  );
}

function Toast({ t }: { t: DockToast }) {
  const [form, setForm] = useState(false);
  const [out, setOut] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const kill = () => {
    clearTimeout(timer.current);
    setOut(true);
    setTimeout(() => dock.dismissToast(t.id), 160);
  };
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(kill, 9000);
  };
  useEffect(() => {
    arm();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ini = String(t.who).split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = (new FormData(e.currentTarget).get('reply') as string).trim();
    if (!v) return;
    setBusy(true);
    try {
      await dock.reply(t, v);
      setNote('Sent');
      setForm(false);
      setTimeout(kill, 1200);
    } catch (err) {
      setBusy(false);
      setNote((err as Error).message);
    }
  };
  return (
    <div className={'fd-t' + (out ? ' is-out' : '')} role="status" onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={() => { if (!form) arm(); }}>
      <div className="fd-t__top">
        <span className="fd-t__av">{t.picture ? <img alt="" src={t.picture} referrerPolicy="no-referrer" /> : ini}</span>
        <span className="fd-t__w">
          <b>{t.who}</b>
          {t.where}
        </span>
        <button type="button" className="fd-t__x" aria-label="Dismiss" onClick={kill}>
          &times;
        </button>
      </div>
      <p className="fd-t__b">{note || (t.text.length > 160 ? t.text.slice(0, 157) + '...' : t.text)}</p>
      <div className="fd-t__a" hidden={form || note === 'Sent'}>
        <button type="button" onClick={() => { setForm(true); clearTimeout(timer.current); }}>
          Reply
        </button>
        <button type="button" onClick={() => { kill(); dock.openFromToast(t); }}>
          Open
        </button>
      </div>
      <form className="fd-t__f" hidden={!form} onSubmit={submit}>
        <input name="reply" type="text" maxLength={4000} aria-label={'Reply to ' + t.who} placeholder="Reply" autoComplete="off" disabled={busy} autoFocus={form} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

function Panel({ s }: { s: ReturnType<typeof dock.getSnapshot> }) {
  const body = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  const el = useRef<HTMLElement>(null);
  const [chatSeen, setChatSeen] = useState(false);
  const chatOn = s.open && s.tab === 'chat';
  useEffect(() => {
    if (chatOn) setChatSeen(true);
  }, [chatOn]);

  // The Favor Brain tab belongs to public/js/dock-panel.js after first open: React renders the frame and leaves that body alone.
  useEffect(() => {
    if (body.current && !body.current.firstChild) body.current.innerHTML = '<div class="fd-p__wait"><i></i><i></i><i></i></div>';
  }, []);
  useEffect(() => {
    dock.D.on((ev: { type: string; message?: string }) => {
      if (ev.type === 'dock:error') setErr(ev.message || 'The panel did not load.');
    });
  }, []);
  useEffect(() => {
    if (!s.open) return;
    setErr('');
    el.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus({ preventScroll: true });
  }, [s.open]);

  const grip = (e: React.PointerEvent) => {
    e.preventDefault();
    const p = el.current;
    if (!p) return;
    const r = p.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const w0 = r.width;
    const h0 = r.height;
    p.classList.add('is-sizing');
    p.classList.remove('is-big');
    const mv = (m: PointerEvent) => {
      const w = Math.max(340, Math.min(Math.round(w0 + (x0 - m.clientX)), innerWidth - 40, 900));
      const h = Math.max(380, Math.min(Math.round(h0 + (y0 - m.clientY)), innerHeight - 110));
      p.style.setProperty('--fd-w', w + 'px');
      p.style.setProperty('--fd-h', h + 'px');
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      p.classList.remove('is-sizing');
      const r2 = p.getBoundingClientRect();
      dock.size({ w: Math.round(r2.width), h: Math.round(r2.height), x: false });
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  return (
    <section
      ref={el}
      className={'fd-p' + (s.big ? ' is-big' : '')}
      id="fd-p"
      role="dialog"
      aria-label="Chat and Favor Brain"
      aria-modal="false"
      hidden={!s.open}
      style={{ ['--fd-w' as string]: s.w + 'px', ['--fd-h' as string]: s.h + 'px' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as Element).closest('[data-pop]')) {
          e.stopPropagation();
          dock.close(true);
        }
      }}
    >
      <div className="fd-p__grip" data-grip title="Drag to resize" onPointerDown={grip} />
      <header className="fd-p__h">
        <div className="fd-p__tabs" role="tablist">
          {(['chat', 'brain'] as const).map((t) => (
            <button key={t} type="button" role="tab" data-tab={t} aria-selected={s.tab === t} tabIndex={s.tab === t ? 0 : -1} onClick={() => dock.tab(t)}>
              {t === 'chat' ? 'Chat' : 'Favor Brain'}
              {t === 'chat' && <b className="fd-p__n" hidden />}
            </button>
          ))}
        </div>
        <button type="button" className="fd-p__ib" data-big aria-label={s.tab === 'brain' ? 'Open Favor Brain as a full page' : 'Open Chat as a full page'} title="Open as a full page" onClick={() => dock.expand()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </button>
        <button type="button" className="fd-p__ib" data-x aria-label="Close the panel" title="Close (Esc)" onClick={() => dock.close(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="fd-p__body" data-body ref={body} hidden={s.tab === 'chat'} />
      {chatSeen && (
        <div className="fd-p__body fd-p__body--chat" hidden={s.tab !== 'chat'}>
          <Suspense
            fallback={
              <div className="fd-p__wait">
                <i />
                <i />
                <i />
              </div>
            }
          >
            <DockChat open={chatOn} />
          </Suspense>
        </div>
      )}
      {err && (
        <div className="fd-p__err">
          {err}{' '}
          <button type="button" onClick={() => { setErr(''); dock.retryPanel(); }}>
            Try again
          </button>
        </div>
      )}
    </section>
  );
}
