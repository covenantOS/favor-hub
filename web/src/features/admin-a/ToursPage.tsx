// Admin > Tours (/admin/tours/): who has finished the tour of FavorOS and each release's walkthroughs, Send again for a person or a team, and
// See a tour as a role. Port of src/pages/admin/tours/index.astro and public/js/admin-tours.js with the same markup and classes. Admins only.
import { useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/admin-tours.css';
import { hubSend } from '../../lib/write';
import { Frame } from './Frame';
import { toursQuery, type TourCore, type TourPerson, type TourRelease, type Tours } from './tours.api';
import { Day } from './Time';

const ROLES: Array<[string, string]> = [
  ['', 'Me'],
  ['staff', 'Any staff member'],
  ['rdd', 'Regional directors'],
  ['partner_care', 'Partner Care'],
  ['church', 'Church Engagement'],
  ['grants', 'Grants'],
  ['support', 'Support Team'],
  ['marketing', 'Marketing'],
  ['exec', 'Leadership'],
  ['admin', 'FavorOS admins'],
];

const times = (n: number) => n + (n === 1 ? ' time' : ' times');

function CoreCell({ c }: { c: TourCore }) {
  if (c.state === 'done')
    return (
      <>
        <span className="tu-pill tu-pill--done">Finished</span>
        <small>
          <Day iso={c.at} />
        </small>
      </>
    );
  if (c.state === 'queued')
    return (
      <>
        <span className="tu-pill tu-pill--sent">Sent again</span>
        <small>
          <Day iso={c.at} />
        </small>
      </>
    );
  if (c.state === 'snoozed')
    return (
      <>
        <span className="tu-pill tu-pill--wait">Skipped {times(c.skips || 0)}</span>
        <small>
          <Day iso={c.at} />
        </small>
      </>
    );
  if (c.state === 'offered') return <span className="tu-pill tu-pill--wait">Shown, not started</span>;
  return <span className="mute">Not shown yet</span>;
}

function RelCell({ r }: { r?: TourRelease }) {
  if (!r || !r.shown) return <span className="mute">Not shown yet</span>;
  const all = r.done === r.shown;
  return (
    <>
      <span className={'tu-pill ' + (all ? 'tu-pill--done' : 'tu-pill--wait')}>
        {r.done} of {r.shown}
      </span>
      {r.skips && !all ? (
        <small>Skipped {times(r.skips)}</small>
      ) : r.at ? (
        <small>
          <Day iso={r.at} />
        </small>
      ) : null}
    </>
  );
}

const finished = (p: TourPerson, d: Tours) =>
  p.core.state === 'done' &&
  d.releases.every((r) => {
    const x = p.releases[r.id];
    return !!x && !!x.shown && x.done === x.shown;
  });
const never = (p: TourPerson, d: Tours) => !p.core.state && d.releases.every((r) => !p.releases[r.id] || !p.releases[r.id]!.shown);

function Body() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(toursQuery);
  const [find, setFind] = useState('');
  const [team, setTeam] = useState('');
  const [show, setShow] = useState('');
  const [armed, setArmed] = useState('');
  const [msg, setMsg] = useState('');
  const [what, setWhat] = useState('core');

  const q = find.trim().toLowerCase();
  const list = data.people.filter((p) => {
    if (q && (p.name + ' ' + p.email + ' ' + p.team).toLowerCase().indexOf(q) < 0) return false;
    if (team && p.team !== team) return false;
    if (show === 'done') return finished(p, data);
    if (show === 'open') return !finished(p, data);
    if (show === 'never') return never(p, data);
    return true;
  });
  const cols = 5 + data.releases.length;
  const core = data.people.filter((p) => p.core.state === 'done').length;

  const send = (body: Record<string, unknown>, label?: string) => {
    setMsg('Sending');
    hubSend('/api/admin/tours', 'POST', body, (d) => d as { sent: number })
      .then((d) => {
        setMsg('Sent again to ' + (label || d.sent + (d.sent === 1 ? ' person' : ' people')) + '. It opens on their next page.');
        return qc.invalidateQueries({ queryKey: toursQuery.queryKey });
      })
      .catch((e: Error) => setMsg(e.message));
  };
  const sendOne = (p: TourPerson) => {
    if (!data.ready) {
      setMsg('Send again works once the tours table is added to the database.');
      return;
    }
    if (armed !== p.email) {
      setArmed(p.email);
      return;
    }
    setArmed('');
    send({ what, emails: [p.email] }, p.name);
  };
  const sendTeam = () => {
    if (!team) return;
    if (armed !== 'team:' + team) {
      setArmed('team:' + team);
      return;
    }
    setArmed('');
    send({ what, team }, team);
  };

  return (
    <>
      <div className="tu-tiles" id="tu-tiles" aria-live="polite">
        {data.ready ? (
          <>
            <div className="tu-tile">
              <b>
                {core} of {data.people.length}
              </b>
              <span>finished the tour of FavorOS</span>
            </div>
            {data.releases.map((r) => {
              const shown = data.people.filter((p) => p.releases[r.id] && p.releases[r.id]!.shown);
              const all = shown.filter((p) => p.releases[r.id]!.done === p.releases[r.id]!.shown).length;
              return (
                <div className="tu-tile" key={r.id}>
                  <b>
                    {all} of {shown.length}
                  </b>
                  <span>shown {r.title} have finished it</span>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
      <section className="ad-card">
        <div className="ad-sub">
          <input
            id="tu-find"
            className="ad-field ad-find"
            type="search"
            placeholder="Find a person"
            aria-label="Find a person"
            value={find}
            onChange={(e) => {
              setArmed('');
              setFind(e.target.value);
            }}
          />
          <span className="tu-selw">
            <select
              id="tu-team"
              className="ad-field tu-sel"
              aria-label="Team"
              value={team}
              onChange={(e) => {
                setArmed('');
                setTeam(e.target.value);
              }}
            >
              <option value="">Every team</option>
              {data.teams.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </span>
          <span className="tu-selw">
            <select
              id="tu-show"
              className="ad-field tu-sel"
              aria-label="Show"
              value={show}
              onChange={(e) => {
                setArmed('');
                setShow(e.target.value);
              }}
            >
              <option value="">Everyone</option>
              <option value="open">Not finished</option>
              <option value="done">Finished everything</option>
              <option value="never">Not shown yet</option>
            </select>
          </span>
          <span className="ad-stamp" id="tu-count" role="status">
            {data.ready ? list.length + (list.length === 1 ? ' person' : ' people') : ''}
          </span>
        </div>
        <div className="ad-sub tu-send">
          <label className="h-label" htmlFor="tu-what">
            Send again
          </label>
          <span className="tu-selw">
            <select id="tu-what" className="ad-field tu-sel" value={what} onChange={(e) => setWhat(e.target.value)}>
              <option value="core">Tour of FavorOS</option>
            </select>
          </span>
          <button type="button" className="ad-btn" id="tu-send-team" disabled={!team || !data.ready} onClick={sendTeam}>
            {armed === 'team:' + team ? 'Press again to send to ' + team : team ? 'Send to ' + team : 'Send to the team'}
          </button>
          <span className="ad-stamp" id="tu-msg" role="status">
            {msg}
          </span>
        </div>
        <p className="tu-note" id="tu-note" hidden={data.ready}>
          This list fills in once the tours table is added to the database. Until then each browser keeps its own progress.
        </p>
        <div className="ad-scroll" id="tu-scroll" hidden={!data.ready}>
          <table className="ad-table sc-table" id="tu-table">
            <thead id="tu-head">
              <tr>
                <th>Person</th>
                <th>Team</th>
                <th>Tour of FavorOS</th>
                {data.releases.map((r) => (
                  <th key={r.id}>{r.title}</th>
                ))}
                <th>Last in FavorOS</th>
                <th />
              </tr>
            </thead>
            <tbody id="tu-body">
              {list.length ? (
                list.map((p) => (
                  <tr key={p.email}>
                    <td data-label="Person">
                      <b>{p.name}</b>
                    </td>
                    <td data-label="Team">{p.team || ''}</td>
                    <td data-label="Tour of FavorOS" className="tu-cell">
                      <CoreCell c={p.core} />
                    </td>
                    {data.releases.map((r) => (
                      <td key={r.id} data-label={r.title} className="tu-cell">
                        <RelCell r={p.releases[r.id]} />
                      </td>
                    ))}
                    <td data-label="Last in FavorOS">{p.lastSeen ? <Day iso={p.lastSeen} /> : <span className="mute">Never</span>}</td>
                    <td className="tu-act">
                      <button type="button" className="ad-btn" data-send={p.email} onClick={() => sendOne(p)}>
                        {armed === p.email ? 'Press again to send' : 'Send again'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={cols} className="mute">
                    {data.ready ? 'Nobody matches.' : 'This list fills in once the tours table is added to the database. Until then each browser keeps its own progress.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ad-card">
        <h2>See a tour as a role</h2>
        <div className="tu-as" id="tu-as">
          {ROLES.map((r) => (
            <div className="tu-as__row" key={r[0] || 'me'}>
              <b>{r[1]}</b>
              <a className="ad-btn" href={'/?tour=core' + (r[0] ? '&as=' + r[0] : '')}>
                Tour of FavorOS
              </a>
              {data.releases.map((x) => (
                <a key={x.id} className="ad-btn" href={'/?tour=new' + (r[0] ? '&as=' + r[0] : '')}>
                  {x.title}
                </a>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const Wait = () => (
  <div className="ad" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 420 }} />
  </div>
);

export function ToursPage() {
  return (
    <Frame on="tours" title="Tours" wait={<Wait />}>
      <Body />
    </Frame>
  );
}
