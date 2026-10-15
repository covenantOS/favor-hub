// Hold focus time for a request: the owner of an open request picks how long and one of three open times on their own calendar. Google
// puts a busy block there and invites nobody. Routes: GET and POST /api/requests/:id/focus (functions/_lib/requests/route.ts).
import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { openSheet, type SheetHandle } from '../kit/overlays';
import { toast } from '../kit/toast';
import { Icon } from '../kit/Icon';
import './intake.css';

const MINUTES = [30, 60, 90, 120];
const word = (m: number) => (m < 60 ? m + ' min' : m === 60 ? '1 hour' : m / 60 + ' hours');
const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const whenOf = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

interface Slot {
  start: string;
  end: string;
  label: string;
}

function FocusBody({ requestId, sheet }: { requestId: string; sheet: SheetHandle }) {
  const [minutes, setMinutes] = useState(60);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [err, setErr] = useState('');
  const [consent, setConsent] = useState(false);
  const [holding, setHolding] = useState('');

  useEffect(() => {
    let live = true;
    setSlots(null);
    setErr('');
    call<{ slots: Slot[] }>('GET', `/api/requests/${encodeURIComponent(requestId)}/focus?minutes=${minutes}`)
      .then((r) => live && setSlots(r.slots))
      .catch((e: Error & { code?: string }) => {
        if (!live) return;
        setErr(e.message);
        setConsent(e.code === 'consent');
      });
    return () => {
      live = false;
    };
  }, [requestId, minutes]);

  const hold = async (s: Slot) => {
    setHolding(s.start);
    try {
      const r = await call<{ hold: { start: string } }>('POST', `/api/requests/${encodeURIComponent(requestId)}/focus`, { start: s.start, minutes });
      toast('Focus time held: ' + whenOf(r.hold.start) + '.');
      sheet.close();
    } catch (e) {
      setHolding('');
      toast((e as Error).message, { error: true });
    }
  };

  return (
    <>
      <div className="ik-seg" role="group" aria-label="How long">
        {MINUTES.map((m) => (
          <button key={m} type="button" className={'ik-seg__b' + (m === minutes ? ' is-on' : '')} aria-pressed={m === minutes} onClick={() => setMinutes(m)}>
            {word(m)}
          </button>
        ))}
      </div>
      {consent ? (
        <>
          <p className="ik-fact">{err}</p>
          <a className="pj-btn pj-btn--primary" href={`/api/google/connect?add=meetings&next=${encodeURIComponent(window.location.pathname + window.location.search)}`}>
            Connect Google Calendar
          </a>
        </>
      ) : err ? (
        <p className="ik-fact">{err}</p>
      ) : !slots ? (
        <div className="ik-skel" aria-busy="true" />
      ) : slots.length ? (
        <>
          <p className="ik-fact">Open on your calendar. Google adds a busy block with no guests.</p>
          <div className="ik-slots">
            {slots.map((s) => (
              <button key={s.start} type="button" className="ik-hold" disabled={!!holding} onClick={() => void hold(s)}>
                <Icon name="clock" />
                <span>
                  <b>{s.label}</b>
                  <small>to {timeOnly(s.end)}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="ik-fact">No open stretch that long in the next week of your working hours. Try a shorter one.</p>
      )}
      <div className="pj-sheet__foot">
        <button type="button" className="pj-btn" data-sheet-x>
          Close
        </button>
      </div>
    </>
  );
}

export function openFocus(requestId: string): SheetHandle {
  return openSheet({ title: 'Hold focus time', cls: 'pj-sheet--focus', render: (s) => <FocusBody requestId={requestId} sheet={s} /> });
}
