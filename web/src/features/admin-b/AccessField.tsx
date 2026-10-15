// The "who is in" control on Admin > Chat (Chat, Learn and Mail access): chips for the people and teams, and a picker over the staff directory.
// Port of the access group code in public/js/admin-settings.js, same markup and classes. The value is JSON, {"emails":[],"teams":[]}.
import { useState } from 'react';

export interface Directory {
  people: Array<{ email: string; name: string; team: string; title: string }>;
  teams: string[];
}
interface Acc {
  emails: string[];
  teams: string[];
}

export function accParse(v: string): Acc {
  try {
    const o = JSON.parse(v || '{}');
    return { emails: (o.emails || []).slice(), teams: (o.teams || []).slice() };
  } catch {
    return { emails: [], teams: [] };
  }
}
export const accJson = (a: Acc) => JSON.stringify({ emails: a.emails.slice().sort(), teams: a.teams.slice().sort((x, y) => x.localeCompare(y)) });

export function AccessField({ id, draft, set, dir }: { id: string; draft: string; set: (v: string) => void; dir: Directory }) {
  const [q, setQ] = useState('');
  const a = accParse(draft);
  const name = (email: string) => dir.people.filter((x) => x.email === email)[0]?.name || email;
  const change = (next: Acc) => {
    setQ('');
    set(accJson(next));
  };
  const term = q.trim().toLowerCase();
  const teams = term ? dir.teams.filter((t) => a.teams.indexOf(t) < 0 && t.toLowerCase().indexOf(term) >= 0).slice(0, 4) : [];
  const people = term ? dir.people.filter((p) => a.emails.indexOf(p.email) < 0 && (p.name + ' ' + p.email + ' ' + p.team + ' ' + p.title).toLowerCase().indexOf(term) >= 0).slice(0, 8) : [];
  const none = a.teams.length + a.emails.length === 0;
  return (
    <div className="ad-acc" data-acc={id}>
      <div className="ad-acc__chips">
        {a.teams.map((t) => (
          <span className="ad-chip ad-chip--team" key={'t' + t}>
            {t} team
            <button type="button" className="ad-chip__x" aria-label={'Remove the ' + t + ' team'} onClick={() => change({ ...a, teams: a.teams.filter((x) => x !== t) })}>
              x
            </button>
          </span>
        ))}
        {a.emails.map((m) => (
          <span className="ad-chip" key={'p' + m}>
            {name(m)}
            <button type="button" className="ad-chip__x" aria-label={'Remove ' + name(m)} onClick={() => change({ ...a, emails: a.emails.filter((x) => x !== m) })}>
              x
            </button>
          </span>
        ))}
        {none ? <span className="ad-set__who">Nobody yet. Admins always have access.</span> : null}
      </div>
      <input className="ad-field" type="search" autoComplete="off" placeholder="Add a person or a team" aria-label="Add a person or a team" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ad-acc__list" hidden={!term}>
        {teams.map((t) => (
          <button type="button" className="ad-acc__opt" key={'t' + t} onClick={() => change({ ...a, teams: a.teams.concat(t) })}>
            <b>{t}</b> <span className="ad-set__who">the whole team</span>
          </button>
        ))}
        {people.map((p) => (
          <button type="button" className="ad-acc__opt" key={'p' + p.email} onClick={() => change({ ...a, emails: a.emails.concat(p.email) })}>
            <b>{p.name}</b> <span className="ad-set__who">{[p.title, p.team].filter(Boolean).join(', ')}</span>
          </button>
        ))}
        {term && !teams.length && !people.length ? <span className="ad-set__who">No match.</span> : null}
      </div>
    </div>
  );
}
