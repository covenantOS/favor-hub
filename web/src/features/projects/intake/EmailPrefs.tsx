// "Request email": how a person hears about requests by email. Immediately (one email for each thing sent to them, each mention and
// each comment), Daily summary (one email each weekday morning, grouped by request) or None (Today, the bell and Chat only). The
// choice lives in request_email_prefs; /api/requests/prefs reads and saves it, and the sending code (functions/_lib/requests/mail.ts)
// reads it for every notice. Opened by the Request email button on the Projects home and by /projects/?notices=1, the link at the
// foot of every request email.
import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { openSheet } from '../kit/overlays';
import { toast } from '../kit/toast';
import './intake.css';

export type MailMode = 'now' | 'daily' | 'off';

export interface Prefs {
  mode: MailMode;
  chat_email: boolean;
  email: string;
  email_on: boolean;
  notices_on: boolean;
}

export const MAIL_CHOICES: Array<{ value: MailMode; label: string; line: string; toast: string }> = [
  { value: 'now', label: 'Immediately', line: 'One email for each thing sent to you, each mention and each comment', toast: 'Request email: immediately' },
  { value: 'daily', label: 'Daily summary', line: 'One email each weekday morning, grouped by request', toast: 'Request email: a daily summary' },
  { value: 'off', label: 'None', line: 'Today, the bell and Chat only', toast: 'Request email: none' },
];

/** The line under the choices: whose address it goes to, or why nothing is sent right now. */
export function prefsNote(p: Pick<Prefs, 'email' | 'email_on' | 'notices_on'>): string {
  if (!p.notices_on) return 'Request notices are off for you right now. Your choice is kept for when they are on.';
  if (!p.email_on) return 'Request email is switched off for everyone right now.';
  return `Email goes to ${p.email}.`;
}

const read = () => call<Prefs & { ok: true }>('GET', '/api/requests/prefs');
const save = (body: { mode?: MailMode; chat_email?: boolean }) => call<Prefs & { ok: true }>('PUT', '/api/requests/prefs', body);

function Body({ close }: { close: () => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    read()
      .then((d) => live && setP(d))
      .catch((e: Error) => live && setErr(e.message || 'Your email choices did not load.'));
    return () => {
      live = false;
    };
  }, []);

  if (err) return <p className="pj-err">{err}</p>;
  if (!p)
    return (
      <div className="pj-skel" aria-busy="true">
        <i />
        <i />
        <i />
      </div>
    );

  const pick = async (m: (typeof MAIL_CHOICES)[number]) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await save({ mode: m.value });
      setP(d);
      toast(m.toast);
      close();
    } catch (e) {
      toast((e as Error).message, { error: true });
      setBusy(false);
    }
  };
  const chat = async () => {
    if (busy) return;
    const on = !p.chat_email;
    setBusy(true);
    try {
      setP(await save({ chat_email: on }));
      toast(on ? 'Email about chat: on' : 'Email about chat: off');
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
    setBusy(false);
  };

  return (
    <div className="ik-prefs">
      <div role="radiogroup" aria-label="Request email">
        {MAIL_CHOICES.map((m) => (
          <button key={m.value} type="button" role="radio" className={'ik-pref' + (p.mode === m.value ? ' is-on' : '')} aria-checked={p.mode === m.value} disabled={busy} onClick={() => void pick(m)}>
            <span className="ik-pref__dot" />
            <span>
              <b>{m.label}</b>
              <small>{m.line}</small>
            </span>
          </button>
        ))}
      </div>
      <button type="button" role="switch" className={'ik-pref ik-pref--chat' + (p.chat_email ? ' is-on' : '')} aria-checked={p.chat_email} disabled={busy} onClick={() => void chat()}>
        <span className="ik-pref__dot" />
        <span>
          <b>Email me about chat</b>
          <small>Messages and mentions still unread after 10 minutes</small>
        </span>
      </button>
      <p className="ik-prefs__note">{prefsNote(p)}</p>
      <p className="ik-prefs__note">The email that says a request you sent is done always comes, whichever you pick.</p>
    </div>
  );
}

let openNow = false;

/** Opens the Request email sheet. A second call while it is open does nothing. */
export function openEmailPrefs(): void {
  if (openNow) return;
  openNow = true;
  openSheet({
    title: 'Request email',
    cls: 'ik-prefs-sheet',
    render: (s) => <Body close={() => s.close()} />,
    onClose: () => {
      openNow = false;
    },
  });
}

export function EmailPrefsButton() {
  return (
    <button type="button" className="pj-btn" data-h="request-email" title="Choose how you hear about requests: Immediately, Daily summary or None" onClick={() => openEmailPrefs()}>
      Request email
    </button>
  );
}
