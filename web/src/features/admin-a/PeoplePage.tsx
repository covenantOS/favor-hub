// Admin > People and roles (/admin/people/): who can sign in, their role and team, their Blackbaud fundraiser link and Work Center access, and what each
// person sees. Act as opens a preview of one person's FavorOS; it never signs in as them. Port of src/pages/admin/people/index.astro and
// public/js/admin-people.js (with the access, Brain access and onboarding add-ons), same markup, classes, calls and wording. Admins only.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { NavLink } from '@/shell/NavLink';
import { BodyPortal } from '@/shell/BodyPortal';
import { Boundary } from '../partners/record/Boundary';
import { navQuery } from '../../lib/queries';
import { hubSend } from '../../lib/write';
import { Frame, msgClass, type Msg } from './Frame';
import { BrainCard, SignInCard } from './PeopleAccess';
import { FILTERS, peopleQuery, previewQuery, type People, type Person } from './people.api';

function sees(p: Person) {
  if (p.pending) return <span className="mute">Nothing until approved</span>;
  if (p.blocked) return <span className="mute">Nothing</span>;
  if (p.role === 'field') return <>Chat, Meetings, Favor Brain (manuals and programs)</>;
  const s = p.sees;
  const out: string[] = [];
  if (s.admin) out.push('Admin');
  if (s.workCenter) out.push('Work Center');
  if (s.meetings) out.push('Meetings');
  if (s.clips) out.push('Clips');
  if (s.reports) out.push(s.reports + ' reports');
  if (s.expenseLog) out.push('Expense log');
  return <>{out.join(', ') || 'Today, Reporting, Favor Brain'}</>;
}

function RoleCell({ p }: { p: Person }) {
  const chip = p.pending ? (
    <span className="ad-chip ad-chip--admin">Waiting for approval</span>
  ) : p.blocked ? (
    <span className="ad-chip ad-chip--block">Blocked</span>
  ) : p.role === 'field' ? (
    <span className="ad-chip">Field staff</span>
  ) : (
    <span className={'ad-chip' + (p.role === 'admin' ? ' ad-chip--admin' : '')}>{p.role === 'admin' ? 'Admin' : 'Staff'}</span>
  );
  return (
    <>
      {chip}
      {p.hr && !p.blocked ? (
        <>
          {' '}
          <span className="ad-chip">HR</span>
        </>
      ) : null}
      {p.envAdmin ? (
        <>
          <br />
          <span className="mute">Set in Pages</span>
        </>
      ) : null}
    </>
  );
}

/** Save one change from the row, after asking when the change takes something away. A refusal is shown in an alert and the button comes back. */
function Quick({ label, cls = '', ask, body, attr, onDone }: { label: string; cls?: string; ask: string; body: Record<string, unknown>; attr: Record<string, string>; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const go = () => {
    if (ask && !window.confirm(ask)) return;
    setBusy(true);
    hubSend('/api/admin/people', 'POST', body, (d) => d)
      .then(onDone)
      .catch((e: Error) => {
        setBusy(false);
        window.alert(e.message);
      });
  };
  return (
    <button type="button" className={'ad-btn' + (cls ? ' ' + cls : '')} disabled={busy} onClick={go} {...attr}>
      {label}
    </button>
  );
}

function Supervisor({ p, all, onDone }: { p: Person; all: Person[]; onDone: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  if (p.blocked) return <span className="mute">None</span>;
  const others = all.filter((x) => !x.blocked && x.email !== p.email);
  const change = (value: string) => {
    setBusy(true);
    hubSend('/api/admin/people', 'POST', { email: p.email, supervisor: value }, (d) => d)
      .then(onDone)
      .catch((er: Error) => {
        window.alert(er.message);
        return onDone();
      })
      .finally(() => setBusy(false));
  };
  return (
    <select className="ad-field ad-sup" data-sup={p.email} aria-label={'Reports to, ' + p.name} disabled={busy} value={p.supervisor || ''} onChange={(e) => change(e.target.value)}>
      <option value="">Not set</option>
      {others.map((x) => (
        <option key={x.email} value={x.email}>
          {x.name}
        </option>
      ))}
    </select>
  );
}

function Actions({ p, me, name, reload, onEdit, onAs }: { p: Person; me: string; name: string; reload: () => Promise<unknown>; onEdit: () => void; onAs: () => void }) {
  const quick = () => {
    if (p.email === me) return null;
    if (p.pending)
      return (
        <>
          <Quick label="Approve" cls="ad-btn--primary" attr={{ 'data-decide': p.email, 'data-to': 'approve' }} body={{ email: p.email, decide: 'approve' }} ask={'Approve ' + name + '? They get Chat, Meetings and Favor Brain (manuals and programs). No partner records, giving numbers or dashboards.'} onDone={reload} />
          <Quick label="Decline" cls="ad-btn--warn" attr={{ 'data-decide': p.email, 'data-to': 'decline' }} body={{ email: p.email, decide: 'decline' }} ask={'Decline ' + name + '? They cannot sign in.'} onDone={reload} />
        </>
      );
    const toAdmin = p.role !== 'admin';
    return (
      <>
        {!p.blocked && !p.envAdmin ? (
          <Quick
            label={p.role === 'admin' ? 'Make staff' : 'Make admin'}
            attr={{ 'data-role': p.email, 'data-to': toAdmin ? 'admin' : 'staff' }}
            body={{ email: p.email, role: toAdmin ? 'admin' : 'staff' }}
            ask={toAdmin ? 'Make ' + name + ' an admin? Admins can change every setting.' : 'Make ' + name + ' staff? They lose admin access.'}
            onDone={reload}
          />
        ) : null}
        <Quick
          label={p.blocked ? 'Unblock' : 'Block'}
          cls={p.blocked ? '' : 'ad-btn--warn'}
          attr={{ 'data-block': p.email, 'data-to': p.blocked ? '0' : '1' }}
          body={{ email: p.email, blocked: !p.blocked }}
          ask={p.blocked ? '' : 'Block ' + name + '? Their open sessions end now.'}
          onDone={reload}
        />
      </>
    );
  };
  return (
    <div className="ad-acts">
      <button type="button" className="ad-btn" data-edit={p.email} onClick={onEdit}>
        Edit
      </button>
      <button type="button" className="ad-btn" data-as={p.email} onClick={onAs}>
        Act as
      </button>
      {quick()}
    </div>
  );
}

/* ------------------------------------------------------------------ the side panel: editor and preview */

type Panel = { kind: 'edit'; email: string } | { kind: 'as'; email: string } | null;

function Side({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const closer = useRef(onClose);
  closer.current = onClose;
  useEffect(() => {
    const el = panel.current;
    const f = el && el.querySelector<HTMLElement>('input:not([readonly]):not([type=hidden]),select,textarea');
    (f || el?.querySelector<HTMLElement>('button'))?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closer.current();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <div className="ad-sheet" id="pp-sheet" onClick={onClose} />
      <aside className="ad-panel" id="pp-panel" aria-label="Person" ref={panel}>
        <button type="button" className="ad-panel__x" id="pp-x" aria-label="Close" onClick={onClose}>
          &times;
        </button>
        {children}
      </aside>
    </>
  );
}

const BLANK: Person = { email: '', name: '', role: 'staff', blocked: false, note: '', team: '', fundraiser: '', workCenter: false, entryOwner: false, entryType: '', sheetTab: '', active: true, listed: false, pending: false, envAdmin: false, supervisor: '', title: '', department: '', startDate: '', hr: false, sees: { workCenter: false, meetings: false, clips: false, reports: 0, expenseLog: false, admin: false } };

function Editor({ data, email, me, onClose, reload }: { data: People; email: string; me: string; onClose: () => void; reload: () => Promise<unknown> }) {
  const p = data.people.find((x) => x.email === email) || BLANK;
  const isNew = !email;
  const self = !!email && email === me;
  const [f, setF] = useState({
    email: p.email,
    name: p.name,
    role: p.role as string,
    blocked: p.blocked,
    team: p.team,
    fundraiser: p.fundraiser,
    workCenter: p.workCenter,
    entryOwner: p.entryOwner,
    entryType: p.entryType,
    sheetTab: p.sheetTab,
    note: p.note,
    supervisor: p.supervisor,
    title: p.title,
    department: p.department,
    startDate: p.startDate,
    hr: p.hr,
  });
  const [msg, setMsg] = useState<Msg | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const str = (k: 'email' | 'name' | 'fundraiser' | 'sheetTab' | 'note' | 'title' | 'department' | 'startDate') => ({ value: f[k], onChange: (e: { target: { value: string } }) => set(k, e.target.value) });
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const body: Record<string, unknown> = { email: f.email.trim(), name: f.name, note: f.note, supervisor: f.supervisor, title: f.title, department: f.department, startDate: f.startDate, hr: f.hr };
    if (!self) {
      body.role = f.role;
      body.blocked = f.blocked;
    }
    if (f.team) {
      body.team = f.team;
      body.fundraiser = f.fundraiser;
      body.workCenter = f.workCenter;
      body.entryOwner = f.entryOwner;
      body.entryType = f.entryType;
      body.sheetTab = f.sheetTab;
    }
    setMsg({ ok: true, text: 'Saving' });
    hubSend('/api/admin/people', 'POST', body, (d) => d)
      .then(() => {
        onClose();
        return reload();
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };
  const enc = (s: string) => encodeURIComponent(s || '');
  const em = p.email.trim().toLowerCase();
  return (
    <>
      <h2>{isNew ? 'Add a person' : p.name}</h2>
      <form className="ad-form" id="pp-form" autoComplete="off" onSubmit={submit}>
        <label>
          Email
          <input className="ad-field" name="email" placeholder={isNew ? 'name@favorintl.org' : undefined} readOnly={!isNew} required {...str('email')} />
        </label>
        <label>
          Name
          <input className="ad-field" name="name" {...str('name')} />
        </label>
        <label>
          Role
          <select className="ad-field" name="role" disabled={self} value={f.role} onChange={(e) => set('role', e.target.value)}>
            <option value="staff">Staff</option>
            <option value="field">Field staff (Chat, Meetings, Favor Brain)</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {p.envAdmin ? <p className="ad-set__hint">This address is also listed in the HUB_ADMINS Pages variable, so it stays an admin.</p> : null}
        <label className="ad-check">
          <input type="checkbox" name="blocked" checked={f.blocked} disabled={self} onChange={(e) => set('blocked', e.target.checked)} /> Blocked from signing in
        </label>
        <label>
          Team
          <select className="ad-field" name="team" value={f.team} onChange={(e) => set('team', e.target.value)}>
            <option value="">No team</option>
            {data.teams.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Blackbaud fundraiser id
          <input className="ad-field" name="fundraiser" inputMode="numeric" {...str('fundraiser')} />
        </label>
        <label className="ad-check">
          <input type="checkbox" name="workCenter" checked={f.workCenter} onChange={(e) => set('workCenter', e.target.checked)} /> Can open the Work Center
        </label>
        <label className="ad-check">
          <input type="checkbox" name="entryOwner" checked={f.entryOwner} onChange={(e) => set('entryOwner', e.target.checked)} /> Has an Entry chip
        </label>
        <label>
          Entry action type
          <select className="ad-field" name="entryType" value={f.entryType} onChange={(e) => set('entryType', e.target.value)}>
            <option value="">None</option>
            {data.entryTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Tracking sheet tab
          <input className="ad-field" name="sheetTab" {...str('sheetTab')} />
        </label>
        <label>
          Note
          <input className="ad-field" name="note" {...str('note')} />
        </label>
        <h3 className="ad-set__hint" style={{ margin: '10px 0 0', fontWeight: 700 }}>
          Reporting line
        </h3>
        <label>
          Reports to
          <select className="ad-field" name="supervisor" value={f.supervisor} onChange={(e) => set('supervisor', e.target.value)}>
            <option value="">Not set</option>
            {data.people
              .filter((x) => !x.blocked && x.email !== p.email)
              .map((x) => (
                <option key={x.email} value={x.email}>
                  {x.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Job title
          <input className="ad-field" name="title" {...str('title')} />
        </label>
        <label>
          Department
          <input className="ad-field" name="department" {...str('department')} />
        </label>
        <label>
          Start date
          <input className="ad-field" type="date" name="startDate" {...str('startDate')} />
        </label>
        <label className="ad-check">
          <input type="checkbox" name="hr" checked={f.hr} onChange={(e) => set('hr', e.target.checked)} /> HR: runs Evaluations, builds Learn courses and starts Onboarding
        </label>
        <div className="ad-acts" style={{ justifyContent: 'flex-start' }}>
          <button className="ad-btn ad-btn--primary" type="submit">
            Save
          </button>
          <button className="ad-btn" type="button" id="pp-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className={msgClass(msg)} id="pp-msg" role="status">
          {msg ? msg.text : ''}
        </p>
        {em ? (
          <div className="pp-onb" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '14px 0 4px' }}>
            <NavLink className="ad-btn" href={'/onboarding/?start=onboard&email=' + enc(em) + '&name=' + enc(p.name.trim())}>
              Start onboarding
            </NavLink>
            <NavLink className="ad-btn" href={'/onboarding/?start=offboard&email=' + enc(em) + '&name=' + enc(p.name.trim())}>
              Start offboarding
            </NavLink>
          </div>
        ) : null}
      </form>
    </>
  );
}

function Preview({ email, onClose }: { email: string; onClose: () => void }) {
  const q = useQuery(previewQuery(email));
  if (q.isError)
    return (
      <>
        <h2>Preview</h2>
        <p className="ad-msg ad-msg--bad">{(q.error as Error).message}</p>
        <button className="ad-btn" id="pp-done" type="button" onClick={onClose}>
          Close
        </button>
      </>
    );
  const d = q.data;
  if (!d) return <h2>Reading</h2>;
  const by: Record<string, string[]> = {};
  d.pages.forEach((p) => (by[p.area] = (by[p.area] || []).concat(p.label)));
  const h3 = { margin: '8px 0 2px', fontSize: 14 };
  return (
    <>
      <h2>What {d.person.name} sees</h2>
      <p className="ad-set__hint">Preview only. It does not sign in as them or change anything.</p>
      <p>
        {d.person.blocked ? <span className="ad-chip ad-chip--block">Blocked</span> : <span className={'ad-chip' + (d.person.role === 'admin' ? ' ad-chip--admin' : '')}>{d.person.role === 'admin' ? 'Admin' : 'Staff'}</span>} {d.person.team}
      </p>
      {Object.keys(by).map((a) => (
        <div key={a}>
          <h3 style={h3}>{a}</h3>
          <p style={{ margin: 0 }}>{by[a].join(', ')}</p>
        </div>
      ))}
      <h3 style={h3}>Reports ({d.reports.length})</h3>
      <p style={{ margin: 0 }}>{d.reports.join(', ') || 'None'}</p>
      <h3 style={h3}>Can record clips</h3>
      <p style={{ margin: 0 }}>{d.clipsRecord ? 'Yes' : 'No'}</p>
      <p className="ad-set__hint">{d.note}</p>
      <div className="ad-acts" style={{ justifyContent: 'flex-start' }}>
        <button className="ad-btn" id="pp-done" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the page */

function List({ initialFilter }: { initialFilter: string }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(peopleQuery);
  const { data: nav } = useSuspenseQuery(navQuery);
  const me = (nav.user.email || '').toLowerCase();
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [panel, setPanel] = useState<Panel>(null);
  const reload = () => qc.invalidateQueries({ queryKey: peopleQuery.queryKey });
  const close = () => setPanel(null);
  const teamLabel = (v: string) => data.teams.find((t) => t.value === v)?.label || '';
  const q = find.trim().toLowerCase();
  const list = data.people.filter((p) => {
    if (q && (p.name + ' ' + p.email + ' ' + teamLabel(p.team)).toLowerCase().indexOf(q) < 0) return false;
    if (filter === 'admin') return p.role === 'admin' && !p.blocked;
    if (filter === 'blocked') return p.blocked && !p.pending;
    if (filter === 'pending') return p.pending;
    if (filter === 'field') return p.role === 'field' && !p.blocked;
    if (filter === 'wc') return p.workCenter;
    if (filter === 'nolist') return !p.listed && !p.blocked;
    if (filter === 'nosup') return !p.supervisor && !p.blocked;
    if (filter === 'hr') return p.hr && !p.blocked;
    return true;
  });
  return (
    <section className="ad-card">
      <div className="ad-sub">
        <input id="pp-find" className="ad-field ad-find" type="search" placeholder="Find a person" aria-label="Find a person" value={find} onChange={(e) => setFind(e.target.value)} />
        <select id="pp-filter" className="ad-field" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="button" className="ad-btn ad-btn--primary" id="pp-add" onClick={() => setPanel({ kind: 'edit', email: '' })}>
          Add a person
        </button>
        <NavLink className="ad-btn" id="pp-onb" href="/onboarding/">
          Onboarding
        </NavLink>
        <span className="ad-stamp" id="pp-count" role="status">
          {list.length} of {data.people.length}
        </span>
      </div>
      <div className="ad-scroll">
        <table className="ad-table sc-table" id="pp-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Team</th>
              <th>Reports to</th>
              <th>Fundraiser</th>
              <th>Work Center</th>
              <th>Sees</th>
              <th />
            </tr>
          </thead>
          <tbody id="pp-body">
            {list.length ? (
              list.map((p) => (
                <tr key={p.email} data-email={p.email}>
                  <td>
                    <b>{p.name}</b>
                    {p.name === p.email ? null : (
                      <>
                        <br />
                        <span className="mute">{p.email}</span>
                      </>
                    )}
                  </td>
                  <td data-label="Role">
                    <RoleCell p={p} />
                  </td>
                  <td data-label="Team">{teamLabel(p.team)}</td>
                  <td data-label="Reports to">
                    <Supervisor p={p} all={data.people} onDone={reload} />
                  </td>
                  <td className="mute" data-label="Fundraiser">
                    {p.fundraiser}
                  </td>
                  <td data-label="Work Center">{p.workCenter ? <span className="ad-yes">Yes</span> : <span className="ad-no">No</span>}</td>
                  <td data-label="Sees">{sees(p)}</td>
                  <td>
                    <Actions p={p} me={me} name={p.name || p.email} reload={reload} onEdit={() => setPanel({ kind: 'edit', email: p.email })} onAs={() => setPanel({ kind: 'as', email: p.email })} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="mute">
                  Nobody matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {panel
        ? BodyPortal(
            <Side onClose={close}>
              {panel.kind === 'edit' ? <Editor key={panel.email} data={data} email={panel.email} me={me} onClose={close} reload={reload} /> : <Preview email={panel.email} onClose={close} />}
            </Side>
          )
        : null}
    </section>
  );
}

const Wait = () => (
  <div className="ad" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 520 }} />
  </div>
);

export function PeoplePage({ initialFilter = '' }: { initialFilter?: string }) {
  return (
    <Frame on="people" title="People and roles" wait={<Wait />}>
      <Boundary fallback={() => <section className="ad-card" id="pp-access" aria-label="Sign-in for field staff" />}>
        <SignInCard />
      </Boundary>
      <Boundary fallback={() => <section className="ad-card" id="pp-brain" aria-label="Favor Brain access" />}>
        <BrainCard />
      </Boundary>
      <List initialFilter={initialFilter} />
    </Frame>
  );
}
