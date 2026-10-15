// Work > Evaluations > Terms: open a term, pick the people, see who is behind, change a supervisor
// to. Same markup, class names and stylesheet as src/pages/evaluations/admin/index.astro and public/js/evaluations-admin.js.
import '@hub/styles/evaluations.css';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { NavLink } from '@/shell/NavLink';
import { evalCall } from './api';
import { evKeys, peopleQuery, pickQuery, termQuery, termsQuery, type TermDetail, type TermsState } from './queries';
import { ToastHost, toast } from './toast';
import { dateWord, firstPicked, groupOf, pickedCount, plural, rangeSelect, timeWord, todayEt, visiblePeople, type AdminSearch, type PickPerson } from './logic';

const fail = (e: unknown) => toast((e as Error).message, true);

export function AdminPage({ search }: { search: AdminSearch }) {
  return (
    <>
      <div className="ev-page">
        <div className="container">{search.t ? <TermRoute id={search.t} /> : <TermsRoute />}</div>
      </div>
      <ToastHost />
    </>
  );
}

const Opening = () => (
  <p className="ev-loading" id="ev-loading">
    Opening
  </p>
);

function Failed({ message }: { message: string }) {
  return (
    <div id="eva-root">
      <section className="ev-empty">
        <h2>This did not open</h2>
        <p>{message}</p>
        <p>
          <NavLink href="/evaluations/">Back to Evaluations</NavLink>
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------- the list */

function TermsRoute() {
  const q = useQuery(termsQuery);
  if (q.error) return <Failed message={(q.error as Error).message} />;
  if (!q.data) return <Opening />;
  return <Terms d={q.data} />;
}

function Terms({ d }: { d: TermsState }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [nudging, setNudging] = useState(false);
  const g = d.gaps;
  return (
    <div id="eva-root">
      <header className="ev-head">
        <div>
          <p className="ev-kicker">Evaluations</p>
          <h1>Terms</h1>
        </div>
        <div className="ev-acts" style={{ margin: 0 }}>
          <NavLink className="h-btn h-btn--ghost" href="/evaluations/">
            My evaluations
          </NavLink>
          <button type="button" className="h-btn h-btn--primary" id="eva-new" onClick={() => setSetup(true)}>
            Open a term
          </button>
        </div>
      </header>
      {g && g.missing.length ? (
        <section className="ev-gap" role="alert">
          <b>
            {g.missing.length} of {g.total} people have no supervisor set
          </b>
          <span>
            {g.missing
              .slice(0, 6)
              .map((p) => p.name)
              .join(', ')}
            {g.missing.length > 6 ? ' and ' + (g.missing.length - 6) + ' more' : ''}
          </span>
          <NavLink className="h-btn h-btn--primary h-btn--sm" href="/admin/people/?filter=nosup">
            Set Reports to
          </NavLink>
        </section>
      ) : null}
      {setup ? (
        <Setup
          onCancel={() => setSetup(false)}
          onOpened={(id) => {
            setSetup(false);
            void qc.invalidateQueries({ queryKey: evKeys.pick });
            router.history.push('/evaluations/admin/?t=' + encodeURIComponent(id));
          }}
        />
      ) : null}
      {!d.terms.length && !setup ? (
        <section className="ev-empty">
          <h2>No term yet</h2>
          <p>A term is one semiannual round. Pick the people, set the date week 1 starts, and everyone is told at once to complete their self-evaluation. People who started January to June go first.</p>
          <p>
            <button type="button" className="h-btn h-btn--primary" id="eva-new2" onClick={() => setSetup(true)}>
              Open the first term
            </button>
          </p>
        </section>
      ) : null}
      {d.terms.length ? (
        <ul className="ev-list">
          {d.terms.map((t) => (
            <li className="ev-row" key={t.id}>
              <div className="ev-row__main">
                <b>{t.name}</b>
                <span className="ev-sub">
                  Week 1 starts {dateWord(t.startsOn)} {'·'} {t.people} {plural(t.people, 'person', 'people')} {'·'} {t.done} done
                </span>
              </div>
              <span className={'ev-chip ' + (t.status === 'open' ? '' : 'ev-chip--quiet')}>{t.status === 'open' ? 'Open' : 'Closed'}</span>
              <NavLink className="h-btn h-btn--ghost h-btn--sm" href={'/evaluations/admin/?t=' + encodeURIComponent(t.id)}>
                Open
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
      <section className="ev-panel">
        <h2>Reminders</h2>
        <p className="ev-sub">Reminders go out two days before each due date and the day after, once each, to the person who owes the step. They follow the same switch as every other notice.</p>
        <div className="ev-acts">
          <button
            type="button"
            className="h-btn h-btn--ghost"
            id="eva-nudge"
            disabled={nudging}
            onClick={() => {
              setNudging(true);
              evalCall<{ sent: number }>('POST', 'admin/nudge', {})
                .then((r) => toast(r.sent + ' reminder' + (r.sent === 1 ? '' : 's') + ' sent.'))
                .catch(fail)
                .then(() => setNudging(false));
            }}
          >
            Send today's reminders now
          </button>
        </div>
      </section>
    </div>
  );
}

function Setup({ onCancel, onOpened }: { onCancel: () => void; onOpened: (termId: string) => void }) {
  const pq = useQuery(pickQuery);
  const people = pq.data;
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [start, setStart] = useState('');
  const [name, setName] = useState('');
  const [w1, setW1] = useState('7');
  const [w2, setW2] = useState('7');
  const [q, setQ] = useState('');
  const [b, setB] = useState(false);
  const last = useRef('');
  const seeded = useRef(false);
  // The January to June starters are picked to start with, the way Rachel described the first term. The date is today in Eastern time.
  useEffect(() => {
    setStart((s) => s || todayEt());
  }, []);
  useEffect(() => {
    if (people && !seeded.current) {
      seeded.current = true;
      setSel(firstPicked(people));
    }
  }, [people]);
  useEffect(() => {
    if (pq.error) {
      toast((pq.error as Error).message, true);
      onCancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pq.error]);
  if (!people) return <p className="ev-loading">Opening</p>;
  const P = people;
  const shown = visiblePeople(P, q);
  const order = shown.flatMap((x) => x[2]);
  const n = pickedCount(sel);
  const nosup = P.filter((p) => sel[p.email] && !p.hasSupervisor).length;
  const onBox = (p: PickPerson, shift: boolean, on: boolean) => {
    setSel((s) => (shift && last.current && last.current !== p.email ? rangeSelect(order, last.current, p.email, on, s) : { ...s, [p.email]: on }));
    last.current = p.email;
  };
  return (
    <section className="ev-panel">
      <h2>Open a term</h2>
      <div className="ev-two">
        <label className="ev-field">
          <span>Week 1 starts</span>
          <input type="date" id="eva-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="ev-field">
          <span>Term name</span>
          <input id="eva-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="January to June 2027 evaluations" />
        </label>
      </div>
      <div className="ev-two">
        <label className="ev-field">
          <span>Week 1, days to collect feedback</span>
          <input type="number" id="eva-w1" min={3} max={21} value={w1} onChange={(e) => setW1(e.target.value)} />
        </label>
        <label className="ev-field">
          <span>Week 2, days for review meetings</span>
          <input type="number" id="eva-w2" min={3} max={21} value={w2} onChange={(e) => setW2(e.target.value)} />
        </label>
      </div>
      <p className="ev-sub">Week 1: everyone completes the self-evaluation and names 2 or 3 reviewers, the supervisor included, who give feedback. Week 2: the review meetings you schedule on each person's page, then the final evaluation.</p>
      <label className="ev-field">
        <span>Find a person</span>
        <input type="search" id="eva-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or team" autoComplete="off" />
      </label>
      <div className="ev-people">
        {shown.length ? (
          shown.map(([g, label, list]) => {
            const all = list.every((p) => sel[p.email]);
            return (
              <div key={g}>
                <div className="ev-pg">
                  <span>
                    {label} ({list.length})
                  </span>
                  <button
                    type="button"
                    className="h-btn h-btn--ghost h-btn--sm"
                    data-all={g}
                    onClick={() => {
                      const pool = P.filter((p) => groupOf(p) === g && !p.open);
                      const every = pool.every((p) => sel[p.email]);
                      setSel((s) => {
                        const o = { ...s };
                        pool.forEach((p) => (o[p.email] = !every));
                        return o;
                      });
                    }}
                  >
                    {all ? 'Clear these' : 'Pick all'}
                  </button>
                </div>
                {list.map((p) => (
                  <label className={'ev-pp' + (p.open ? ' is-off' : '')} key={p.email}>
                    <input
                      type="checkbox"
                      data-pick={p.email}
                      checked={!!sel[p.email]}
                      disabled={p.open}
                      onChange={() => undefined}
                      onClick={(e) => onBox(p, e.shiftKey, e.currentTarget.checked)}
                    />
                    <span className="ev-pp__t">
                      <b>{p.name}</b>
                      <span>
                        {[p.title, p.team].filter(Boolean).join(' · ')}
                        {p.startDate ? ' · Started ' + dateWord(p.startDate) : ''}
                        {p.hasSupervisor ? '' : ' · No supervisor set'}
                        {p.open ? ' · Evaluation already open' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            );
          })
        ) : (
          <p className="ev-sub" style={{ padding: 14 }}>
            Nobody matches.
          </p>
        )}
      </div>
      {nosup ? (
        <p className="ev-warn">
          {nosup} picked {nosup === 1 ? 'person has' : 'people have'} no supervisor. Set Reports to under Admin, People and roles first, or choose one by drop-down after the term opens.
        </p>
      ) : null}
      <div className="ev-acts">
        <button
          type="button"
          className="h-btn h-btn--primary"
          id="eva-open"
          disabled={!n || b}
          onClick={() => {
            setB(true);
            const emails = Object.keys(sel).filter((k) => sel[k]);
            evalCall<{ opened: number; noSupervisor: string[]; termId: string }>('POST', 'admin/terms', { startsOn: start, name, emails, w1Days: Number(w1) || 7, w2Days: Number(w2) || 7 })
              .then((d) => {
                toast('Opened for ' + d.opened + ' ' + (d.opened === 1 ? 'person' : 'people') + '.' + (d.noSupervisor.length ? ' ' + d.noSupervisor.length + ' have no supervisor yet.' : ''));
                onOpened(d.termId);
              })
              .catch((er) => {
                setB(false);
                fail(er);
              });
          }}
        >
          Open the term for {n} {plural(n, 'person', 'people')}
        </button>
        <button type="button" className="h-btn h-btn--ghost" id="eva-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------- one term */

function TermRoute({ id }: { id: string }) {
  const tq = useQuery(termQuery(id));
  const pq = useQuery(peopleQuery);
  const err = tq.error || pq.error;
  if (err) return <Failed message={(err as Error).message} />;
  if (!tq.data || !pq.data) return <Opening />;
  return <Term d={tq.data} staff={pq.data} id={id} />;
}

function SupSelect({ caseId, name, email, staff, own, disabled, onDone }: { caseId: string; name: string; email: string; staff: Array<{ email: string; name: string }>; own: string; disabled: boolean; onDone: () => void }) {
  const [val, setVal] = useState(email);
  useEffect(() => setVal(email), [email]);
  return (
    <select
      data-sup={caseId}
      aria-label={'Supervisor for ' + name}
      disabled={disabled}
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
        evalCall('POST', 'case/' + encodeURIComponent(caseId) + '/supervisor', { email: e.target.value })
          .then(() => toast('Supervisor saved.'))
          .catch(fail)
          .then(onDone);
      }}
    >
      <option value="">Not assigned</option>
      {staff
        .filter((p) => p.email !== own)
        .map((p) => (
          <option key={p.email} value={p.email}>
            {p.name}
          </option>
        ))}
    </select>
  );
}

function Term({ d, staff, id }: { d: TermDetail; staff: Array<{ email: string; name: string }>; id: string }) {
  const qc = useQueryClient();
  const t = d.term;
  const behind = d.cases.flatMap((c) => c.behind);
  const again = () => qc.refetchQueries({ queryKey: evKeys.term(id), exact: true });
  const mark = (on: boolean) => (on ? <span className="ev-ok">{'✓'}</span> : <span className="ev-no">{'–'}</span>);
  return (
    <div id="eva-root">
      <NavLink className="ev-back" href="/evaluations/admin/">
        All terms
      </NavLink>
      <header className="ev-head">
        <div>
          <p className="ev-kicker">{t.periodLabel}</p>
          <h1>{t.name}</h1>
          <p className="ev-sub">Week 1 starts {dateWord(t.startsOn)}</p>
        </div>
        {t.status === 'open' ? (
          <button
            type="button"
            className="h-btn h-btn--ghost"
            id="eva-close"
            onClick={() => {
              if (!window.confirm('Close this term? Nobody can change answers after it closes.')) return;
              evalCall('POST', 'admin/term/' + encodeURIComponent(t.id) + '/close', {})
                .then(() => {
                  toast('Closed.');
                  return again();
                })
                .catch(fail);
            }}
          >
            Close the term
          </button>
        ) : (
          <span className="ev-chip ev-chip--quiet">Closed</span>
        )}
      </header>
      <section className="ev-panel">
        <h2>Who is behind</h2>
        {behind.length ? (
          <ul className="ev-behind">
            {behind.map((b, i) => (
              <li key={i}>
                <b>{b.who}</b>
                <span>
                  {b.what}
                  {b.due ? (
                    <>
                      {' '}
                      <span className="ev-sub">due {dateWord(b.due)}</span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ev-sub">Nobody is past a due date.</p>
        )}
      </section>
      <section className="ev-panel ev-cases">
        <h2>Everyone in this term</h2>
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Supervisor</th>
              <th>Where</th>
              <th>Self</th>
              <th>Feedback</th>
              <th>Meeting</th>
              <th>Final evaluation</th>
              <th>Signed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {d.cases.map((c) => (
              <tr key={c.id}>
                <td data-l="Employee">
                  <b>{c.employee.name}</b>
                </td>
                <td data-l="Supervisor">
                  <SupSelect caseId={c.id} name={c.employee.name} email={c.supervisor.email} staff={staff} own={c.employee.email} disabled={t.status !== 'open'} onDone={() => void again()} />
                </td>
                <td data-l="Where">{c.stageWord}</td>
                <td data-l="Self">{mark(c.self)}</td>
                <td data-l="Feedback">
                  {c.reviewersDone} of {c.reviewers}
                </td>
                <td data-l="Meeting">{c.meetingOn ? dateWord(c.meetingOn) + (c.meetingTime ? ' ' + timeWord(c.meetingTime) : '') : 'Not set'}</td>
                <td data-l="Final evaluation">{mark(c.summary)}</td>
                <td data-l="Signed">{mark(c.signed)}</td>
                <td>
                  <NavLink className="h-btn h-btn--ghost h-btn--sm" href={'/evaluations/?c=' + encodeURIComponent(c.id)}>
                    Open
                  </NavLink>
                  <NavLink className="h-btn h-btn--ghost h-btn--sm" href={'/evaluations/?c=' + encodeURIComponent(c.id) + '&v=final'}>
                    {c.meetingOn ? 'Meeting' : 'Schedule'}
                  </NavLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="ev-panel">
        <h2>Reviewers</h2>
        <p className="ev-sub">Open a person's evaluation, then Reviewers, to set a reviewer aside or add one. Employees choose their own 2 or 3 reviewers in week 1, and the supervisor is always one. A reviewer can decline and the employee picks a replacement.</p>
      </section>
    </div>
  );
}
