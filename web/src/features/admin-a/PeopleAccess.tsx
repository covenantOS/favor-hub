// The two cards above the People list: sign-in domains with the field Favor Brain switch (public/js/admin-people-access.js), and the Favor Brain
// access rules (public/js/admin-people-brain.js). A card whose read fails stays empty, as on the classic page; the list below it does not wait for it.
import { useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { hubSend } from '../../lib/write';
import { msgClass, type Msg } from './Frame';
import { brainAccessQuery, peopleSettingsQuery, type BrainRule, type PeopleSetting } from './people.api';

/* ------------------------------------------------------------------ sign-in domains and the field Brain switch */

function SettingRow({ s, onSaved, setMsg, busy, setBusy }: { s: PeopleSetting; onSaved: (next: PeopleSetting) => void; setMsg: (m: Msg | null) => void; busy: string; setBusy: (id: string) => void }) {
  const [draft, setDraft] = useState(s.value);
  const [seen, setSeen] = useState(s.value);
  // The saved value is the starting point again after a save, as the classic card redrew itself.
  if (seen !== s.value) {
    setSeen(s.value);
    setDraft(s.value);
  }
  const save = () => {
    setBusy(s.id);
    setMsg({ ok: true, text: 'Saving' });
    hubSend('/api/admin/settings', 'POST', { id: s.id, value: draft }, (d) => (d as { setting: PeopleSetting }).setting)
      .then((next) => {
        onSaved(next);
        setMsg({ ok: true, text: 'Saved.' });
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }))
      .finally(() => setBusy(''));
  };
  const domains = s.id === 'signin.domains';
  return (
    <div className="ad-set ad-set--rep">
      <div>
        <div className="ad-set__name">{s.label}</div>
        <div className="ad-set__hint">{s.hint}</div>
      </div>
      <div>
        {domains ? (
          <input className="ad-field" id="pa-domains" value={draft} placeholder="favourafrica.org" aria-label={s.label} autoComplete="off" spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <select className="ad-field" id="pa-brain" aria-label={s.label} value={draft} onChange={(e) => setDraft(e.target.value)}>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="ad-acts">
        <button type="button" className="ad-btn ad-btn--primary" id={domains ? 'pa-save' : 'pa-brain-save'} disabled={busy === s.id} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

export function SignInCard() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(peopleSettingsQuery);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState('');
  const by: Record<string, PeopleSetting> = {};
  data.settings.forEach((s) => (by[s.id] = s));
  const d = by['signin.domains'];
  const b = by['field.brain'];
  if (!d || !b) return <section className="ad-card" id="pp-access" aria-label="Sign-in for field staff" />;
  const saved = (next: PeopleSetting) => qc.setQueryData(peopleSettingsQuery.queryKey, (old: { settings: PeopleSetting[] } | undefined) => (old ? { ...old, settings: old.settings.map((x) => (x.id === next.id ? next : x)) } : old));
  return (
    <section className="ad-card" id="pp-access" aria-label="Sign-in for field staff">
      <SettingRow s={d} onSaved={saved} setMsg={setMsg} busy={busy} setBusy={setBusy} />
      <SettingRow s={b} onSaved={saved} setMsg={setMsg} busy={busy} setBusy={setBusy} />
      <p className={msgClass(msg)} id="pa-msg" role="status">
        {msg ? msg.text : ''}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ Favor Brain access rules */

const KIND: Record<string, string> = { everyone: 'Everyone', role: 'Role', team: 'Team', lead: 'Team leads', person: 'Person' };

const who = (r: BrainRule) => {
  if (r.kind === 'everyone') return 'Everyone';
  if (r.kind === 'lead') return r.key ? 'Leads of ' + r.key : 'Every team lead';
  if (r.kind === 'role') return 'Role: ' + r.key;
  return r.key;
};

export function BrainCard() {
  const qc = useQueryClient();
  const { data: D } = useSuspenseQuery(brainAccessQuery);
  const [kind, setKind] = useState('everyone');
  const [team, setTeam] = useState((D.teams || [])[0] || '');
  const [role, setRole] = useState('staff');
  const [person, setPerson] = useState('');
  const [pkg, setPkg] = useState((D.packages || [])[0]?.key || '');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState('');
  const label = (k: string) => (D.packages || []).find((x) => x.key === k)?.label || k;
  const change = (body: Record<string, unknown>, id: string) => {
    setBusy(id);
    setMsg({ ok: true, text: 'Saving' });
    hubSend('/api/admin/brain-access', 'POST', body, (d) => d)
      .then(() => qc.fetchQuery({ ...brainAccessQuery, staleTime: 0 }))
      .then(() => setMsg({ ok: true, text: 'Saved. The Brain uses it within 30 seconds.' }))
      .catch((e: Error) => setMsg({ ok: false, text: e.message }))
      .finally(() => setBusy(''));
  };
  const add = () => {
    const key = kind === 'team' || kind === 'lead' ? team : kind === 'role' ? role : kind === 'person' ? person : '';
    change({ op: 'add', kind, key, package: pkg }, 'add');
  };
  const rules = D.rules || [];
  const people = D.people || [];
  return (
    <section className="ad-card" id="pp-brain" aria-label="Favor Brain access">
      <div className="ad-sub">
        <div>
          <div className="ad-set__name">Favor Brain access</div>
          <div className="ad-set__hint">
            Each rule gives one Brain package to everyone, a FavorOS role, a team in the staff directory, team leads or one person. Grants on the Brain page still add or take away a package for one person. Contact details cover phone numbers, email and street
            addresses.
          </div>
        </div>
      </div>
      <div className="ad-scroll">
        <table className="ad-table sc-table">
          <thead>
            <tr>
              <th>Applies to</th>
              <th>Who</th>
              <th>Package</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.length ? (
              rules.map((r) => {
                const id = JSON.stringify({ kind: r.kind, key: r.key, package: r.package });
                return (
                  <tr key={id}>
                    <td>{KIND[r.kind] || r.kind}</td>
                    <td>{who(r)}</td>
                    <td>{label(r.package)}</td>
                    <td className="ad-acts">
                      <button type="button" className="ad-btn" data-rm={id} disabled={busy === id} onClick={() => change({ kind: r.kind, key: r.key, package: r.package, op: 'remove' }, id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="mute">
                  No rules. The Brain uses its built-in list until a rule is added.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ad-set ad-set--rep">
        <div>
          <div className="ad-set__name">Add a rule</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="ad-field" id="pb-kind" aria-label="Applies to" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.keys(KIND).map((k) => (
              <option key={k} value={k}>
                {KIND[k]}
              </option>
            ))}
          </select>
          <select className="ad-field" id="pb-team" aria-label="Team" style={{ width: 'auto' }} hidden={!(kind === 'team' || kind === 'lead')} value={team} onChange={(e) => setTeam(e.target.value)}>
            {(D.teams || []).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select className="ad-field" id="pb-role" aria-label="Role" style={{ width: 'auto' }} hidden={kind !== 'role'} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="staff">staff</option>
            <option value="admin">admin</option>
          </select>
          <input className="ad-field" id="pb-person" placeholder="name@favorintl.org" aria-label="Person" autoComplete="off" spellCheck={false} hidden={kind !== 'person'} style={{ width: 220 }} value={person} onChange={(e) => setPerson(e.target.value)} />
          <select className="ad-field" id="pb-pkg" aria-label="Package" style={{ width: 'auto' }} value={pkg} onChange={(e) => setPkg(e.target.value)}>
            {(D.packages || []).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ad-acts">
          <button type="button" className="ad-btn ad-btn--primary" id="pb-add" disabled={busy === 'add'} onClick={add}>
            Add
          </button>
        </div>
      </div>
      <p className={msgClass(msg)} id="pb-msg" role="status">
        {msg ? msg.text : ''}
      </p>
      <details>
        <summary>What each person has now ({people.length})</summary>
        <div className="ad-scroll">
          <table className="ad-table sc-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Team</th>
                <th>Brain packages</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.email}>
                  <td>
                    {p.name}
                    <div className="mute">{p.email}</div>
                  </td>
                  <td>{p.team || ''}</td>
                  <td>
                    {p.packages.length ? p.packages.map(label).join(', ') : <span className="mute">Basics only</span>}
                    {p.fromGrants.length ? <span className="mute"> ({p.fromGrants.map(label).join(', ')} by grant)</span> : null}
                    {p.removedByGrant.length ? <span className="mute"> ({p.removedByGrant.map(label).join(', ')} taken away by grant)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
