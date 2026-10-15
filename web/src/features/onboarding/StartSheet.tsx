// The sheet that starts an onboarding or an offboarding. Same fields, defaults and request body as public/js/onboard/index.js.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { hubOv } from '@/lib/hubOv';
import { OnboardError } from './api';
import { mondayAfter, offboardBody, onboardBody, personIn, teamsOf, todayET, type Fresh, type Kind } from './logic';
import { obKeys, sendJson } from './queries';
import { PersonField, setFresh, Sheet, usePeople } from './ui';

export interface Pre {
  email?: string;
  name?: string;
}

export function StartSheet({ kind, pre, onClose }: { kind: Kind; pre: Pre; onClose: () => void }) {
  const people = usePeople();
  const qc = useQueryClient();
  const router = useRouter();
  const teams = useMemo(() => teamsOf(people), [people]);
  const [name, setName] = useState(pre.name || '');
  const [email, setEmail] = useState(pre.email || '');
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState('');
  const [welcome, setWelcome] = useState('');
  const [hq, setHq] = useState(true);
  const [stays, setStays] = useState(false);
  const [who, setWho] = useState(kind === 'offboard' ? pre.email || '' : '');
  const [supervisor, setSupervisor] = useState('');
  const [date, setDate] = useState(() => (kind === 'onboard' ? mondayAfter(todayET()) : todayET()));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const errRef = useRef<HTMLParagraphElement>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof matchMedia === 'function' && !matchMedia('(max-width: 860px)').matches) first.current?.focus();
  }, []);

  const go = async () => {
    const body = kind === 'onboard' ? onboardBody({ name, email, title, team, date, hq, welcome, supervisor }) : offboardBody({ who, date, stays, supervisor }, who ? personIn(people, who) : null);
    setBusy(true);
    setErr('');
    try {
      const r = await sendJson('runs', 'POST', body);
      const run = r.run as { id: string };
      const fresh: Fresh = { id: run.id, unset: (r.unset as string[]) || [], steps: ((r.steps as unknown[]) || []).length };
      setFresh(fresh);
      void qc.invalidateQueries({ queryKey: obKeys.all });
      onClose();
      // The sheet's own history entry is removed first, so the move to the run is not undone by it.
      hubOv.unwind(() => router.history.push('/onboarding/run/?id=' + encodeURIComponent(run.id)));
    } catch (e) {
      setBusy(false);
      setErr((e as OnboardError).message || 'Something went wrong. Try again.');
      setTimeout(() => errRef.current?.scrollIntoView({ block: 'nearest' }), 0);
    }
  };

  const label = kind === 'onboard' ? 'Start onboarding' : 'Start offboarding';
  return (
    <Sheet
      title={label}
      onClose={onClose}
      foot={
        <>
          <button type="button" className="rt-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rt-btn rt-btn--primary" disabled={busy} onClick={go}>
            {label}
          </button>
        </>
      }
    >
      <form className="ob-form" noValidate onSubmit={(e) => e.preventDefault()}>
        <p className="ob-err" role="alert" hidden={!err} ref={errRef}>
          {err}
        </p>
        {kind === 'onboard' ? (
          <>
            <label className="ob-lab">
              Name
              <input ref={first} className="ob-in" name="name" autoComplete="off" maxLength={120} required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ob-lab">
              Favor email
              <input className="ob-in" name="email" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" placeholder="name@favorintl.org" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <div className="ob-2">
              <label className="ob-lab">
                Role
                <input className="ob-in" name="title" autoComplete="off" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="ob-lab">
                Team
                <input className="ob-in" name="team" list="ob-teams" autoComplete="off" maxLength={80} value={team} onChange={(e) => setTeam(e.target.value)} />
                <datalist id="ob-teams">
                  {teams.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="ob-lab">
              Supervisor
              <div>
                <PersonField value={supervisor} onChange={setSupervisor} label="supervisor" />
              </div>
            </div>
            <label className="ob-lab">
              Start date
              <input className="ob-in" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="ob-check">
              <input type="checkbox" name="hq" checked={hq} onChange={(e) => setHq(e.target.checked)} /> Works at headquarters (door code, tour, devotions)
            </label>
            <label className="ob-lab">
              Note on the first-day page
              <textarea className="ob-in" name="welcome" rows={3} maxLength={1200} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <div className="ob-lab">
              Person leaving
              <div>
                <PersonField value={who} onChange={setWho} label="who" placeholder="Search by name" />
              </div>
            </div>
            <div className="ob-lab">
              Supervisor
              <div>
                <PersonField value={supervisor} onChange={setSupervisor} label="supervisor" />
              </div>
            </div>
            <label className="ob-lab">
              Last day
              <input className="ob-in" name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="ob-check">
              <input type="checkbox" name="stays" checked={stays} onChange={(e) => setStays(e.target.checked)} /> Stays on as a volunteer, accounts stay open
            </label>
          </>
        )}
      </form>
    </Sheet>
  );
}
