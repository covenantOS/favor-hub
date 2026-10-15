// The phone app's start page (/m/) inside the web app: who is signed in, the Chat, Meetings and Favor Brain tiles, notifications, Data
// saver, the offline outbox and Sign out. The same behavior as public/js/m/start.js; the device logic (push, Data saver, the outbox)
// stays in public/js/phone-core.js, which this page loads and calls. Who and the tiles come from the menu answer the frame already has.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadScript } from '@/lib/legacy';
import { navQuery } from '../../lib/queries';
import './phone-start.css';

interface Outbox {
  list: () => Promise<Array<{ failed?: boolean }>>;
  flush: () => void;
}
interface Phone {
  createOutbox: (store: unknown, transport: unknown, onChange: () => void) => Outbox;
  idbStore: () => unknown;
  chatTransport: () => unknown;
  registerWorker: () => Promise<unknown>;
  pushState: () => Promise<string>;
  enablePush: () => Promise<unknown>;
  disablePush: () => Promise<unknown>;
  sendTestPush: () => Promise<{ sent?: boolean }>;
  lowDataSetting: () => string;
  setLowData: (v: string) => void;
  isLowData: () => boolean;
}

const NOTE: Record<string, string> = {
  'needs-home-screen': 'On an iPhone, add FavorOS to the Home Screen first (Share, then Add to Home Screen), open it from there and turn notifications on.',
  unsupported: 'This browser cannot show notifications.',
  blocked: 'Notifications are blocked for FavorOS. Turn them on in the phone settings.',
};

export function PhoneStart() {
  const nav = useQuery(navQuery);
  // The first browser draw is the server's draw; the menu answer fills in who and the tiles right after it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const d = mounted ? nav.data : undefined;
  const access = (d?.access ?? {}) as Record<string, unknown>;
  const who = d?.user ? (d.user.name || '') + (d.user.email ? ' (' + d.user.email + ')' : '') : '';

  const phone = useRef<Phone | null>(null);
  const box = useRef<Outbox | null>(null);
  const [push, setPush] = useState<string>('checking');
  const [pushMsg, setPushMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState('auto');
  const [saving, setSaving] = useState<boolean | null>(null);
  const [queue, setQueue] = useState({ wait: 0, bad: 0 });

  const paintQueue = useCallback(() => {
    box.current
      ?.list()
      .then((l) => {
        const wait = l.filter((x) => !x.failed).length;
        setQueue({ wait, bad: l.length - wait });
      })
      .catch(() => undefined);
  }, []);
  const paintNotes = useCallback(() => {
    void phone.current?.pushState().then(setPush);
  }, []);
  const paintData = useCallback(() => {
    const P = phone.current;
    if (!P) return;
    setData(P.lowDataSetting());
    setSaving(P.isLowData());
  }, []);

  useEffect(() => {
    let gone = false;
    const onOnline = () => box.current?.flush();
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.type === 'flush-outbox') box.current?.flush();
    };
    void loadScript('/js/phone-core.js?v=2').then(() => {
      if (gone) return;
      const P = (window as unknown as { FavorPhone: Phone }).FavorPhone;
      phone.current = P;
      box.current = P.createOutbox(P.idbStore(), P.chatTransport(), paintQueue);
      void P.registerWorker();
      paintNotes();
      paintData();
      paintQueue();
      box.current.flush();
      window.addEventListener('online', onOnline);
      navigator.serviceWorker?.addEventListener('message', onMsg);
    });
    return () => {
      gone = true;
      window.removeEventListener('online', onOnline);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
    };
  }, [paintNotes, paintData, paintQueue]);

  const toggle = () => {
    const P = phone.current;
    if (!P) return;
    setBusy(true);
    setPushMsg('');
    (push === 'on' ? P.disablePush() : P.enablePush())
      .then(paintNotes)
      .catch((e: Error) => {
        setPushMsg(e.message);
        paintNotes();
      })
      .finally(() => setBusy(false));
  };
  const test = () => {
    setPushMsg('Sending');
    void phone.current?.sendTestPush().then((r) => setPushMsg(r.sent ? 'Sent. It arrives in a moment.' : 'Nothing was sent. Turn notifications off and on again.'));
  };
  const signOut = () => {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).finally(() => location.replace('/login/?signedout=1'));
  };

  const on = push === 'on';
  const off = push === 'off';
  const noteLabel = push === 'checking' ? 'Checking' : on ? 'Turn notifications off' : off ? 'Turn notifications on' : 'Not available';
  const brainShown = access.brain === undefined ? true : !!access.brain;
  return (
    <div className="pa-page">
      <main className="pa-main">
        <header className="pa-head">
          <img src="/images/favor-logo-color.png" alt="Favor International" className="pa-logo" height={34} />
          <p className="pa-who" id="pa-who" aria-live="polite">
            {who}
          </p>
        </header>

        <nav className="pa-tiles" aria-label="FavorOS">
          <a className="pa-tile" href="/chat/" id="pa-chat" hidden={access.chat === false}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16v11H9l-5 4z" />
            </svg>
            <span>
              <b>Chat</b>
              <small>Direct messages and channels</small>
            </span>
          </a>
          <a className="pa-tile" href="/meet/" id="pa-meet" hidden={access.meetings === false}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="3" />
              <path d="m16 10.5 5-3v9l-5-3z" />
            </svg>
            <span>
              <b>Meetings</b>
              <small>Join or start a call</small>
            </span>
          </a>
          <a className="pa-tile" href="/brain/" id="pa-brain" hidden={!d || !brainShown}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M9 10h6M9 14h4" />
            </svg>
            <span>
              <b>Favor Brain</b>
              <small>Ask about the manuals and programs</small>
            </span>
          </a>
        </nav>

        <section className="pa-card" aria-labelledby="pa-h-note">
          <h2 id="pa-h-note">Notifications</h2>
          <p id="pa-note-text">A direct message or a mention reaches this phone when FavorOS is closed.</p>
          <div className="pa-row">
            <button type="button" className={'pa-btn' + (push === 'checking' || off ? ' pa-btn--on' : '')} id="pa-note" disabled={busy || !(on || off)} onClick={toggle}>
              {noteLabel}
            </button>
            <button type="button" className="pa-btn" id="pa-test" hidden={!on} onClick={test}>
              Send me a test
            </button>
          </div>
          <p className="pa-msg" id="pa-note-msg" role="status">
            {pushMsg || NOTE[push] || ''}
          </p>
        </section>

        <section className="pa-card" aria-labelledby="pa-h-data">
          <div className="pa-cardh">
            <h2 id="pa-h-data">Data saver</h2>
            <select
              id="pa-data"
              className="pa-pick"
              aria-labelledby="pa-h-data"
              value={data}
              onChange={(e) => {
                phone.current?.setLowData(e.target.value);
                paintData();
              }}
            >
              <option value="auto">Automatic</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <p>Pictures upload smaller, calls open audio only and messages written offline wait until the connection returns.</p>
          <p className="pa-msg" id="pa-data-state" role="status">
            {saving === null ? '' : saving ? 'Saving data now.' : 'Not saving data now.'}
          </p>
        </section>

        <section className="pa-card" id="pa-queue" hidden={queue.wait + queue.bad === 0} aria-labelledby="pa-h-queue">
          <h2 id="pa-h-queue">Waiting to send</h2>
          <p id="pa-queue-text">
            {queue.wait ? queue.wait + (queue.wait === 1 ? ' message is' : ' messages are') + ' waiting for a connection. ' : ''}
            {queue.bad ? queue.bad + ' could not be sent.' : ''}
          </p>
          <button type="button" className="pa-btn" id="pa-send-now" onClick={() => box.current?.flush()}>
            Send now
          </button>
        </section>

        <p className="pa-foot">
          <button type="button" className="pa-link" id="pa-out" onClick={signOut}>
            Sign out
          </button>
        </p>
      </main>
    </div>
  );
}
