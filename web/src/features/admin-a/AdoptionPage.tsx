// Admin > Adoption (/admin/adoption/): who uses FavorOS and how. Summary tiles, weekly bars, a sortable table by person, a day-by-day log per person,
// the people who never signed in, and the feedback feed. Port of src/pages/admin/adoption/index.astro and public/js/admin-adoption.js, same markup and
// classes. Admins only: the API refuses everyone else.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/admin-tours.css';
import '@hub/styles/admin-adoption.css';
import { Frame } from './Frame';
import { adoptionPersonQuery, adoptionQuery, type Adoption, type AdoptionPerson } from './adoption.api';
import { Ago, Day, Full } from './Time';
import { calDay, day, full, ago } from './format';

type Col = [keyof AdoptionPerson, string];
const COLS: Col[] = [
  ['name', 'Person'],
  ['team', 'Team'],
  ['firstSignin', 'First sign-in'],
  ['lastActive', 'Last active'],
  ['activeDays30', 'Active days in 30'],
  ['areas', 'Top areas'],
  ['brain', 'Brain questions'],
  ['feedback', 'Feedback given'],
  ['tasks', 'Tasks made'],
  ['meetings', 'Meetings joined'],
  ['work', 'Work Center actions'],
  ['gifts', 'Gift entries'],
];
const AREA: Record<string, string> = {
  today: 'Today', work: 'Work Center', brain: 'Favor Brain', meet: 'Meetings', receipts: 'Receipts', tasks: 'Tasks', calendar: 'Calendar', projects: 'Projects', chat: 'Chat', clips: 'Clips', mail: 'Mail', admin: 'Admin', requests: 'Requests', dashboard: 'Dashboard', lists: 'Lists', 'gift-entry': 'Gift entry', learn: 'Learn', expenses: 'Expenses', foundations: 'Foundations', reports: 'Reports', feedback: 'Feedback', help: 'Help', evaluations: 'Evaluations', onboarding: 'Onboarding', statements: 'Statements', 'online-gifts': 'Online gifts', m: 'Phone app',
};
const area = (a: string) => AREA[a] || a.charAt(0).toUpperCase() + a.slice(1).replace(/-/g, ' ');
const plural = (n: number, one: string, many: string) => n + ' ' + (n === 1 ? one : many);
const NUM_KEYS = ['brain', 'feedback', 'tasks', 'meetings', 'work', 'gifts'] as const;

function val(p: AdoptionPerson, k: keyof AdoptionPerson): string | number {
  if (k === 'areas') return p.areas.length ? p.areas[0].n : 0;
  const v = p[k] as string | number;
  return typeof v === 'string' ? v.toLowerCase() : v;
}

const Areas = ({ list, none }: { list: Array<{ area: string; n: number }>; none: string }) =>
  list.length ? (
    <>
      {list.map((a, i) => (
        <span key={i}>
          {area(a.area)} {a.n}
        </span>
      ))}
    </>
  ) : (
    <span className="mute">{none}</span>
  );

function Tiles({ d }: { d: Adoption }) {
  const s = d.summary;
  const t = (n: string | number, label: string) => (
    <div className="tu-tile" key={label}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  );
  return (
    <div className="tu-tiles" id="ao-tiles" aria-live="polite">
      {t(s.withAccount, 'staff with an account')}
      {t(s.signedInEver + ' of ' + s.withAccount, 'have signed in')}
      {t(s.active7, 'active in the last 7 days')}
      {t(s.active30, 'active in the last 30 days')}
    </div>
  );
}

function Person({ email, onClose }: { email: string; onClose: () => void }) {
  const box = useRef<HTMLElement>(null);
  const q = useQuery(adoptionPersonQuery(email));
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'start' });
  }, [email]);
  const d = q.data;
  const name = q.isError ? (q.error as Error).message : d ? d.name + (d.team ? ', ' + d.team : '') + ': the last 90 days' : 'Loading';
  return (
    <section className="ad-card" id="ao-person" ref={box}>
      <div className="ad-sub">
        <h2 id="ao-person-name">{name}</h2>
        <button type="button" className="ad-btn" id="ao-person-close" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="ad-scroll">
        <table className="ad-table sc-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Areas opened</th>
              <th>Sign-ins</th>
              <th>Brain questions</th>
              <th>Feedback</th>
              <th>Tasks made</th>
              <th>Meetings</th>
              <th>Work Center</th>
            </tr>
          </thead>
          <tbody id="ao-person-body">
            {d ? (
              d.days.length ? (
                d.days.map((r) => (
                  <tr key={r.day}>
                    <td data-label="Day">
                      <Day iso={r.day + 'T16:00:00Z'} /> <span className="mute">{r.day}</span>
                    </td>
                    <td data-label="Areas opened" className="ao-areas">
                      <Areas list={r.areas} none="Not counted" />
                    </td>
                    <td data-label="Sign-ins" className="ao-num">
                      {r.signins}
                    </td>
                    <td data-label="Brain questions" className="ao-num">
                      {r.brain}
                    </td>
                    <td data-label="Feedback" className="ao-num">
                      {r.feedback}
                    </td>
                    <td data-label="Tasks made" className="ao-num">
                      {r.tasks}
                    </td>
                    <td data-label="Meetings" className="ao-num">
                      {r.meetings}
                    </td>
                    <td data-label="Work Center" className="ao-num">
                      {r.work}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="mute">
                    Nothing recorded in the last 90 days.
                  </td>
                </tr>
              )
            ) : null}
          </tbody>
        </table>
      </div>
      <div id="ao-person-fb">
        {d && d.feedback.length ? (
          <>
            <h3>Feedback given</h3>
            {d.feedback.map((f, i) => (
              <p className="tu-note" key={i}>
                <b>
                  <Full iso={f.at} />
                </b>{' '}
                {[f.rating, f.question, f.comment].filter(Boolean).join(' / ')} ({f.status})
              </p>
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function Body() {
  const { data } = useSuspenseQuery(adoptionQuery);
  const [find, setFind] = useState('');
  const [team, setTeam] = useState('');
  const [sortKey, setSortKey] = useState<keyof AdoptionPerson>('lastActive');
  const [sortDir, setSortDir] = useState(-1);
  const [who, setWho] = useState('');
  const s = data.summary;
  const max = Math.max(1, ...data.weekly.map((w) => w.people));
  const q = find.trim().toLowerCase();
  const list = data.people
    .filter((p) => (!team || p.team === team) && (!q || (p.name + ' ' + p.email + ' ' + p.team).toLowerCase().indexOf(q) >= 0))
    .sort((a, b) => {
      const x = val(a, sortKey);
      const y = val(b, sortKey);
      if (x === y) return a.name < b.name ? -1 : 1;
      if (typeof x === 'string' && !x) return 1;
      if (typeof y === 'string' && !y) return -1;
      return (x < y ? -1 : 1) * sortDir;
    });
  const sort = (k: keyof AdoptionPerson) => {
    if (k === sortKey) setSortDir(-sortDir);
    else {
      setSortKey(k);
      setSortDir(k === 'name' || k === 'team' ? 1 : -1);
    }
  };
  const since = s.trackingSince
    ? 'Pages opened are counted from ' + day(s.trackingSince + 'T12:00:00Z').replace(/^Today$/, 'today') + '. Sign-ins, Favor Brain, tasks and meetings go back further. Your own row is shown and left out of the totals. Test accounts and blocked accounts are left out.'
    : 'Pages opened are counted from the first visit after this page went live. Sign-ins, Favor Brain, tasks and meetings go back further. Your own row is shown and left out of the totals. Test accounts and blocked accounts are left out.';
  return (
    <>
      <Tiles d={data} />
      <section className="ad-card">
        <h2>Active people each week</h2>
        <div className="ao-weeks" id="ao-weeks" role="img" aria-label="Active people each week">
          {data.weekly.map((w) => (
            <div className="ao-wk" key={w.week}>
              <i className="ao-wk__bar" style={{ height: Math.round((w.people / max) * 100) + '%' }} />
              <b>{w.people}</b>
              <span>Week of {calDay(w.week)}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="ad-card">
        <div className="ad-sub">
          <input id="ao-find" className="ad-field ad-find" type="search" placeholder="Find a person" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
          <span className="tu-selw">
            <select id="ao-team" className="ad-field tu-sel" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Every team</option>
              {data.teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </span>
          <span className="ad-stamp" id="ao-count" role="status">
            {plural(list.length, 'person', 'people')}
          </span>
        </div>
        <div className="ad-scroll">
          <table className="ad-table sc-table" id="ao-table">
            <thead id="ao-head">
              <tr>
                {COLS.map(([k, label]) => {
                  const on = k === sortKey;
                  return (
                    <th key={k} aria-sort={on ? (sortDir > 0 ? 'ascending' : 'descending') : undefined}>
                      <button type="button" className="ao-sort" data-sort={k} onClick={() => sort(k)}>
                        {label}
                        {on ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody id="ao-body">
              {list.length ? (
                list.map((p) => (
                  <tr key={p.email}>
                    <td data-label="Person">
                      <button type="button" className="ao-who" data-person={p.email} onClick={() => setWho(p.email)}>
                        {p.name}
                      </button>
                      {p.you ? <span className="ao-you">You, not in totals</span> : null}
                    </td>
                    <td data-label="Team">{p.team || ''}</td>
                    <td data-label="First sign-in">{p.firstSignin ? <Day iso={p.firstSignin} /> : <span className="mute">Never</span>}</td>
                    <td data-label="Last active" title={full(p.lastActive)}>
                      {p.lastActive ? ago(p.lastActive) ? <Ago iso={p.lastActive} /> : <Day iso={p.lastActive} /> : <span className="mute">Never</span>}
                    </td>
                    <td data-label="Active days in 30" className="ao-num">
                      {p.activeDays30}
                    </td>
                    <td data-label="Top areas" className="ao-areas">
                      <Areas list={p.areas} none="None counted yet" />
                    </td>
                    {NUM_KEYS.map((k, i) => (
                      <td key={k} data-label={COLS[6 + i][1]} className="ao-num">
                        {p[k]}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={12} className="mute">
                    Nobody matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="tu-note" id="ao-since">
          <span suppressHydrationWarning>{since}</span>
        </p>
      </section>
      {who ? <Person email={who} onClose={() => setWho('')} /> : null}
      <section className="ad-card">
        <h2>Never signed in</h2>
        <p className="tu-note" id="ao-never-note">
          {data.never.length ? plural(data.never.length, 'active staff member has', 'active staff members have') + ' no sign-in on record.' : 'Everyone on the staff directory has signed in.'}
        </p>
        <div className="ad-scroll">
          <table className="ad-table sc-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody id="ao-never">
              {data.never.length ? (
                data.never.map((p, i) => (
                  <tr key={i}>
                    <td data-label="Person">{p.name}</td>
                    <td data-label="Team">{p.team || ''}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2} className="mute">
                    Nobody.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ad-card">
        <h2>Feedback</h2>
        <div className="ad-scroll">
          <table className="ad-table sc-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Person</th>
                <th>Question</th>
                <th>Rating</th>
                <th>Comment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody id="ao-fb">
              {data.feedback.length ? (
                data.feedback.map((f) => (
                  <tr key={f.id}>
                    <td data-label="When">
                      <Full iso={f.at} />
                    </td>
                    <td data-label="Person">{f.name || f.email}</td>
                    <td data-label="Question" className="ao-quote">
                      {f.question}
                    </td>
                    <td data-label="Rating">{f.rating}</td>
                    <td data-label="Comment" className="ao-quote">
                      {f.comment}
                    </td>
                    <td data-label="Status">{f.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="mute">
                    No feedback yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const Wait = () => (
  <div className="ad" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 480 }} />
  </div>
);

export function AdoptionPage() {
  return (
    <Frame on="adoption" title="Adoption" cls="ad ao-root" wait={<Wait />}>
      <Body />
    </Frame>
  );
}
