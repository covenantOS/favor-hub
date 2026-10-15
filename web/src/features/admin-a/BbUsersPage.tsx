// Admin > Blackbaud users (/admin/blackbaud-users/): who has a Blackbaud login and what it opens, and the requests to add a user, change access or
// deactivate one. SKY has no user endpoint, so a request is saved here and the desktop automation runs it in Blackbaud (through the web view); the
// Requests list shows its status. Port of src/pages/admin/blackbaud-users/index.astro and public/js/admin-bbusers.js, same markup, classes, calls and
// wording. Admins only. Nothing on this page touches Blackbaud: a request only reaches the queue.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import { hubSend } from '../../lib/write';
import { Frame, msgClass, type Msg } from './Frame';
import { bbJobsQuery, bbUsersQuery, type BbAccess, type BbJob, type BbJobs, type BbUser } from './bbusers.api';
import { Full, When } from './Time';

const OTHER: Record<string, string> = { bbms: 'Merchant Services', apps: 'Blackbaud apps', marketplace: 'Marketplace', paymentsapi: 'Payments API' };
const KIND: Record<string, string> = { add: 'Add user', access: 'Change access', deactivate: 'Deactivate' };

const Chip = ({ text, cls }: { text: string; cls?: string }) => <span className={'bu-chip' + (cls ? ' ' + cls : '')}>{text}</span>;

function hoursAgo(iso: string) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 3600000);
  return h < 1 ? 'under an hour ago' : h < 48 ? h + (h === 1 ? ' hour ago' : ' hours ago') : Math.floor(h / 24) + ' days ago';
}

function accessLine(a: BbAccess | null, J: BbJobs | null) {
  if (!a) return '';
  const bits: string[] = [];
  if (a.solutionAdmin) bits.push('Solution admin');
  Object.keys(a.roles || {}).forEach((k) => bits.push(((J && J.form.roles[k]) || { label: k }).label + ' ' + (a.roles as Record<string, string>)[k]));
  if ((a.groups || []).length) bits.push('Groups: ' + (a.groups as string[]).join(', '));
  return bits.join('; ');
}

/* ------------------------------------------------------------------ the request form */

type Open = { kind: 'add' | 'access' | 'deactivate'; email: string } | null;

function RequestPanel({ open, users, J, onClose, onSaved }: { open: NonNullable<Open>; users: BbUser[]; J: BbJobs; onClose: () => void; onSaved: () => void }) {
  const u = open.email ? users.find((x) => x.email.toLowerCase() === open.email.toLowerCase()) : undefined;
  const root = useRef<HTMLElement>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [preset, setPreset] = useState('normal');
  const normal = J.form.presets.normal;
  const [roles, setRoles] = useState<Record<string, string>>(normal ? { ...normal.roles } : {});
  const [groups, setGroups] = useState<string[]>(normal ? normal.groups.slice() : []);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = root.current;
    el?.scrollIntoView({ block: 'nearest' });
    (el?.querySelector<HTMLElement>('input, select') || el?.querySelector<HTMLElement>('#bu-go'))?.focus();
  }, []);
  const choose = (name: string) => {
    setPreset(name);
    const p = J.form.presets[name];
    if (name !== 'custom' && p) {
      setRoles({ ...p.roles });
      setGroups(p.groups.slice());
    }
  };
  const submit = () => {
    const body: Record<string, unknown> = { kind: open.kind, email: open.email };
    if (open.kind === 'add') {
      body.first = first;
      body.last = last;
      body.email = email;
    }
    if (open.kind !== 'deactivate') {
      if (preset !== 'custom') body.preset = preset;
      else {
        const chosen: Record<string, string> = {};
        Object.keys(roles).forEach((k) => {
          if (roles[k]) chosen[k] = roles[k];
        });
        body.access = { solutionAdmin: false, roles: chosen, groups: J.form.groups.filter((g) => groups.indexOf(g) >= 0) };
      }
    }
    setBusy(true);
    setMsg({ ok: true, text: 'Saving' });
    hubSend('/api/work/bbusers/jobs', 'POST', body, (d) => d)
      .then(onSaved)
      .catch((e: Error) => {
        setBusy(false);
        setMsg({ ok: false, text: e.message });
      });
  };
  return (
    <section className="ad-card" id="bu-panel" aria-label="Request" ref={root} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h2>
        {KIND[open.kind]}
        {u ? ': ' + u.name : ''}
      </h2>
      {u ? <p className="ad-card__meta">{u.email}</p> : null}
      {open.kind === 'add' ? (
        <div className="bu-grid">
          <label className="bu-f">
            <span>First name</span>
            <input className="ad-field" id="bu-first" autoComplete="off" value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label className="bu-f">
            <span>Last name</span>
            <input className="ad-field" id="bu-last" autoComplete="off" value={last} onChange={(e) => setLast(e.target.value)} />
          </label>
          <label className="bu-f">
            <span>Email</span>
            <input className="ad-field" id="bu-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>
      ) : null}
      {open.kind !== 'deactivate' ? (
        <>
          <label className="bu-f">
            <span>Access</span>
            <select className="ad-field" id="bu-preset" value={preset} onChange={(e) => choose(e.target.value)}>
              <option value="normal">Normal user</option>
              <option value="solution_admin">Solution admin</option>
              <option value="custom">Choose roles and groups</option>
            </select>
          </label>
          <div id="bu-custom" hidden={preset !== 'custom'}>
            <div className="bu-grid">
              {Object.keys(J.form.roles).map((k) => (
                <label className="bu-f" key={k}>
                  <span>{J.form.roles[k].label}</span>
                  <select className="ad-field" data-role={k} value={roles[k] || ''} onChange={(e) => setRoles({ ...roles, [k]: e.target.value })}>
                    <option value="">No role</option>
                    {J.form.roles[k].levels.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <fieldset className="bu-groups">
              <legend>Database view groups</legend>
              {J.form.groups.map((g) => (
                <label className="bu-check" key={g}>
                  <input type="checkbox" data-group={g} checked={groups.indexOf(g) >= 0} onChange={(e) => setGroups(e.target.checked ? groups.concat(g) : groups.filter((x) => x !== g))} /> {g}
                </label>
              ))}
            </fieldset>
          </div>
        </>
      ) : (
        <p>The login becomes inactive in Blackbaud.</p>
      )}
      <p className={msgClass(msg)} id="bu-msg" role="status">
        {msg ? msg.text : ''}
      </p>
      <div className="bu-row">
        {open.kind === 'deactivate' ? (
          <button type="button" className="ad-btn ad-btn--warn" id="bu-go" disabled={busy} onClick={submit}>
            Deactivate
          </button>
        ) : (
          <button type="button" className="ad-btn ad-btn--primary" id="bu-go" disabled={busy} onClick={submit}>
            {open.kind === 'add' ? 'Add user' : 'Save access'}
          </button>
        )}
        <button type="button" className="ad-btn" id="bu-close" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the page */

function Body() {
  const qc = useQueryClient();
  const { data: D } = useSuspenseQuery(bbUsersQuery);
  const { data: fresh } = useSuspenseQuery(bbJobsQuery);
  // A request list that stops answering leaves the last one on the page.
  const kept = useRef<BbJobs | null>(null);
  if (fresh) kept.current = fresh;
  const J = fresh || kept.current;
  const [find, setFind] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [open, setOpen] = useState<Open>(null);
  const [cancelling, setCancelling] = useState('');
  const reloadJobs = () => qc.invalidateQueries({ queryKey: bbJobsQuery.queryKey });

  const q = find.trim().toLowerCase();
  const list = D.users.filter((u) => {
    if (status === 'active' && !u.active) return false;
    if (status === 'inactive' && u.active) return false;
    return !q || (u.name + ' ' + u.email).toLowerCase().indexOf(q) >= 0;
  });
  const waiting: Record<string, string> = {};
  ((J && J.jobs) || []).forEach((j) => {
    if (j.state === 'queued' || j.state === 'running' || j.state === 'checked') waiting[j.email + '|' + j.kind] = j.status;
  });
  const s = D.summary;
  const stale = !!D.at && Date.now() - Date.parse(D.at) > 36 * 3600000;
  const cancel = (j: BbJob) => {
    setCancelling(j.id);
    hubSend('/api/work/bbusers/jobs/cancel', 'POST', { id: j.id }, (d) => d)
      .then(reloadJobs)
      .catch((er: Error) => window.alert(er.message))
      .finally(() => setCancelling(''));
  };
  return (
    <>
      {open && J ? (
        <RequestPanel
          key={open.kind + '|' + open.email}
          open={open}
          users={D.users}
          J={J}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            void reloadJobs();
          }}
        />
      ) : (
        <section className="ad-card" id="bu-panel" hidden aria-label="Request" />
      )}
      <section className="ad-card">
        <div className="ad-sub bu-tools">
          <input id="bu-find" className="ad-field ad-find" type="search" placeholder="Find a name or email" aria-label="Find a name or email" value={find} onChange={(e) => setFind(e.target.value)} />
          <div className="bu-seg" role="group" aria-label="Status" id="bu-status">
            {(['active', 'inactive', 'all'] as const).map((k) => (
              <button key={k} type="button" className={status === k ? 'is-on' : ''} data-s={k} onClick={() => setStatus(k)}>
                {k === 'active' ? 'Active' : k === 'inactive' ? 'Inactive' : 'All'}
              </button>
            ))}
          </div>
          <button type="button" className="ad-btn ad-btn--primary" id="bu-add" disabled={!J} onClick={() => setOpen({ kind: 'add', email: '' })}>
            Add user
          </button>
          <span className="bu-asof" id="bu-asof" suppressHydrationWarning>
            {D.at ? (
              <span className={stale ? 'is-late' : ''} suppressHydrationWarning>
                As of <Full iso={D.at} /> ({hoursAgo(D.at)})
              </span>
            ) : null}
          </span>
        </div>
        <div className="bu-tiles" id="bu-tiles">
          {s
            ? (
                [
                  ['Users', s.total],
                  ['Active', s.active],
                  ['Inactive', s.inactive],
                  ["Raiser's Edge NXT admins", s.renxtAdmins],
                  ["Raiser's Edge NXT users", s.renxtUsers],
                ] as Array<[string, number]>
              ).map((t) => (
                <div className="bu-tile" key={t[0]}>
                  <b>{t[1]}</b>
                  <span>{t[0]}</span>
                </div>
              ))
            : null}
        </div>
        <div className="ad-scroll">
          <table className="ad-table sc-table" id="bu-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Raiser's Edge NXT</th>
                <th>Other products</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="bu-body">
              {list.length ? (
                list.map((u) => {
                  const em = u.email.toLowerCase();
                  const others = Object.keys(OTHER).filter((k) => u.access[k]);
                  const org = u.admin.filter((a) => a === 'Organization');
                  return (
                    <tr key={u.email}>
                      <td data-label="User">
                        <b>{u.name}</b>
                        <br />
                        <span className="bu-mail">{u.email}</span>
                      </td>
                      <td data-label="Raiser's Edge NXT">{u.access.renxt ? <Chip text={u.access.renxt} cls={u.access.renxt === 'Admin' ? 'bu-chip--gold' : ''} /> : <span className="bu-none">None</span>}</td>
                      <td data-label="Other products">
                        {others.length || org.length ? (
                          <>
                            {others.map((k) => (
                              <Chip key={k} text={OTHER[k] + ' ' + u.access[k]} />
                            ))}
                            {org.map((_, i) => (
                              <Chip key={'o' + i} text="Organization admin" cls="bu-chip--gold" />
                            ))}
                          </>
                        ) : (
                          <span className="bu-none">None</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <Chip text={u.active ? 'Active' : 'Inactive'} cls={u.active ? 'bu-chip--ok' : ''} />
                      </td>
                      <td data-label="Actions" className="bu-acts">
                        {!u.active ? null : (
                          <>
                            {waiting[em + '|access'] ? (
                              <Chip text={waiting[em + '|access']} />
                            ) : (
                              <button type="button" className="ad-btn" data-act="access" data-email={u.email} onClick={() => setOpen({ kind: 'access', email: u.email })}>
                                Change access
                              </button>
                            )}
                            {waiting[em + '|deactivate'] ? (
                              <Chip text={waiting[em + '|deactivate']} />
                            ) : (
                              <button type="button" className="ad-btn" data-act="deactivate" data-email={u.email} onClick={() => setOpen({ kind: 'deactivate', email: u.email })}>
                                Deactivate
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="au-empty">
                    {D.users.length ? 'No user matches.' : 'The users page has not been read yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ad-card">
        <h2>Requests</h2>
        <div id="bu-jobs">
          {!J ? null : !J.jobs.length ? (
            <p className="bu-none">No requests yet.</p>
          ) : (
            <div className="ad-scroll">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Asked</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {J.jobs.map((j) => {
                    const cls = j.state === 'done' ? 'bu-chip--ok' : j.state === 'failed' ? 'bu-chip--bad' : j.state === 'running' ? 'bu-chip--gold' : '';
                    return (
                      <tr key={j.id}>
                        <td data-label="Request">
                          <b>{KIND[j.kind] || j.kind}</b> {j.name || j.email}
                          <br />
                          <span className="bu-mail">
                            {j.email}
                            {j.access ? ' · ' + accessLine(j.access, J) : ''}
                          </span>
                        </td>
                        <td data-label="Status">
                          <Chip text={j.status} cls={cls} />
                        </td>
                        <td data-label="Asked">
                          <When iso={j.at} />
                          <br />
                          <span className="bu-mail">{j.by}</span>
                        </td>
                        <td data-label="Result">{j.result || ''}</td>
                        <td data-label="">
                          {j.state === 'queued' || j.state === 'checked' ? (
                            <button type="button" className="ad-btn" data-cancel={j.id} disabled={cancelling === j.id} onClick={() => cancel(j)}>
                              Cancel
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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

export function BbUsersPage() {
  return (
    <Frame on="bbusers" title="Blackbaud users" wait={<Wait />}>
      <Body />
    </Frame>
  );
}
