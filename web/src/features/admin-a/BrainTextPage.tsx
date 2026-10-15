// Text Favor Brain (/brain/text/): a person registers the mobile number they will text from. The number is confirmed with a 6 digit code texted to it.
// Only registered numbers get answers; the Brain checks the number on every message. Port of src/pages/brain/text/index.astro and
// public/js/brain-text.js with the same markup, classes, calls and wording.
import { Suspense, useState, type FormEvent } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/design-pass.css';
import '@hub/styles/brain-text.css';
import { NavLink } from '@/shell/NavLink';
import { hubSend } from '../../lib/write';
import { textStatusQuery, type TextStatus } from './brain-text.api';

const since = (iso?: string) => {
  const d = new Date(iso || '');
  return isNaN(d.getTime()) ? '' : 'Since ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

type View = 'send' | 'code' | 'done';

function Card() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(textStatusQuery);
  const s: TextStatus | null = 'status' in data ? data.status : null;
  const registered = !!(s && s.registered);
  // After "Change number" or "Use another number" the person is back at the number form, whatever the status says.
  const [view, setView] = useState<View | null>(null);
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('error' in data ? data.error : '');
  const [busy, setBusy] = useState(false);
  const shown: View | null = view || (s ? (registered ? 'done' : 'send') : null);
  const reload = () => qc.invalidateQueries({ queryKey: textStatusQuery.queryKey });

  const send = (e: FormEvent) => {
    e.preventDefault();
    const v = phone.trim();
    if (!v) return setErr('Enter your mobile number.');
    setBusy(true);
    hubSend('/api/brain/text/register', 'POST', { phone: v }, (d) => d)
      .then(() => {
        setBusy(false);
        setErr('');
        setSentTo(v);
        setCode('');
        setView('code');
      })
      .catch((x: Error) => {
        setBusy(false);
        setErr(x.message || 'The code could not be sent.');
      });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!/^\d{6}$/.test(c)) return setErr('The code is 6 digits.');
    setBusy(true);
    hubSend('/api/brain/text/confirm', 'POST', { code: c }, (d) => d)
      .then(() => {
        setBusy(false);
        setErr('');
        setView(null);
        return reload();
      })
      .catch((x: Error) => {
        setBusy(false);
        setErr(x.message || 'That code did not work.');
      });
  };
  const remove = () => {
    if (!window.confirm('Remove this number? Texts from it will stop getting answers.')) return;
    hubSend('/api/brain/text/remove', 'POST', {}, (d) => d)
      .then(() => {
        setView(null);
        return reload();
      })
      .catch(() => undefined);
  };
  return (
    <section className="h-card bt-card" id="bt-card" aria-busy="false">
      <header className="bt-head">
        <h2>Your number</h2>
        {s ? (
          <span className={'bt-pill' + (s.live && registered ? ' is-on' : '')} id="bt-pill">
            {s.live ? (registered ? 'Registered' : 'Not registered') : 'Not open yet'}
          </span>
        ) : (
          <span className="bt-pill" id="bt-pill" hidden />
        )}
      </header>
      <p className="bt-fact" id="bt-fact">
        Ask from your phone. Answers come back in the same thread.
      </p>

      <form className="bt-form" id="bt-send" hidden={shown !== 'send'} onSubmit={send}>
        <label htmlFor="bt-phone">Mobile number</label>
        <input id="bt-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(813) 555-0142" maxLength={24} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="submit" className="h-btn h-btn--primary" id="bt-send-go" disabled={busy}>
          Send code
        </button>
      </form>

      <form className="bt-form" id="bt-code" hidden={shown !== 'code'} onSubmit={confirm}>
        <label htmlFor="bt-c">
          Code sent to <b id="bt-to">{sentTo}</b>
        </label>
        <input id="bt-c" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit" className="h-btn h-btn--primary" id="bt-code-go" disabled={busy}>
          Confirm
        </button>
        <button
          type="button"
          className="dp-link"
          id="bt-back-num"
          onClick={() => {
            setErr('');
            setView('send');
          }}
        >
          Use another number
        </button>
      </form>

      <div className="bt-done" id="bt-done" hidden={shown !== 'done'}>
        <div className="bt-row">
          <span className="bt-num" id="bt-num">
            {(s && s.phone) || ''}
          </span>
          <span className="bt-sub" id="bt-since">
            {since(s ? s.since : undefined)}
          </span>
        </div>
        <div className="bt-acts">
          <button
            type="button"
            className="dp-link"
            id="bt-change"
            onClick={() => {
              setPhone('');
              setErr('');
              setView('send');
            }}
          >
            Change number
          </button>
          <button type="button" className="bt-del" id="bt-remove" onClick={remove}>
            Remove
          </button>
        </div>
      </div>
      <p className="bt-err" id="bt-err" role="alert" hidden={!err}>
        {err}
      </p>
    </section>
  );
}

const Wait = () => (
  <section className="h-card bt-card" id="bt-card" aria-busy="true">
    <header className="bt-head">
      <h2>Your number</h2>
      <span className="bt-pill" id="bt-pill" hidden />
    </header>
    <p className="bt-fact" id="bt-fact">
      Ask from your phone. Answers come back in the same thread.
    </p>
    <div className="h-skel" style={{ height: 96 }} />
  </section>
);

export function BrainTextPage() {
  return (
    <div className="bt">
      <NavLink className="bt-back" href="/brain/">
        Favor Brain
      </NavLink>
      <h1 className="bt-h">Text Favor Brain</h1>
      <Suspense fallback={<Wait />}>
        <Card />
      </Suspense>
    </div>
  );
}
