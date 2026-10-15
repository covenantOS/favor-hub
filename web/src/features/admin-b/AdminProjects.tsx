// Admin > Projects (/admin/projects/): who can use Projects, the Asana token, the Asana import (dry run, then import, with progress and a log), the
// projects FavorOS holds with archive and restore, and the two-way Asana sync. Port of public/js/admin-projects.js and admin-asana-sync.js with the
// same markup, classes, words and calls. Everything goes through /api/admin/projects (and /api/asana/admin for the sync); the token is typed here
// once and never comes back to the page.
import { Suspense, useEffect, useRef, useState } from 'react';
import { QueryErrorResetBoundary, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/admin.css';
import '@hub/styles/admin-projects.css';
import { hubGet } from '../../lib/hub';
import { hubSend } from '../../lib/write';
import { Boundary } from '../partners/record/Boundary';
import {
  adminProjectsQuery,
  asanaAdminQuery,
  type AdminProjectsSettings,
  type HubProject,
  type RunRow,
} from './api';
import { AdminPage, msgClass, type Msg } from './AdminPage';
import { Ago, Full, When } from './Time';
import { Mail } from './Mail';
import { num } from './format';
import {
  DEFAULT_OPTIONS,
  dryTasks,
  importReady,
  isLive,
  pickedKey,
  projectsUrl,
  reportTotals,
  runBody,
  type ImportOptions,
  type ReportProject,
} from './projects';

interface LogLine {
  id: number;
  level: string;
  at: string;
  text: string;
}
interface RunView {
  run: { id: string; status: string; mode: string; calls: number; error?: string; resume_at?: string };
  progress?: { read: number; total: number };
  report?: {
    projects: Record<string, ReportProject>;
    people: { unmatched: Record<string, { name?: string; email?: string; reason: string; assigned: number; asked: number; comments: number }> };
    files: { problems: Array<{ name: string; size?: number; task: string; reason: string }> };
    deps: { linked?: number; cycles?: number; outside?: number };
    warnings?: string[];
  };
  log: LogLine[];
}
interface AsanaProject {
  gid: string;
  name: string;
  team?: string;
  owner?: string;
  tasks?: number | null;
  archived?: boolean;
  imported?: boolean;
}

const call = <T,>(path: string, body?: unknown): Promise<T> =>
  body === undefined ? (hubGet(projectsUrl(path)) as Promise<T>) : hubSend(projectsUrl(path), 'POST', body, (d) => d as T);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function Opt({ v, label }: { v: string; label: string }) {
  return <option value={v}>{label}</option>;
}

/* ------------------------------------------------------------------------------------------------------ who and requests */
function Access({ settings, projects, onSettings, say, msgs }: { settings: AdminProjectsSettings; projects: HubProject[]; onSettings: (s: AdminProjectsSettings) => void; say: (id: string, t: string, bad?: boolean) => void; msgs: Record<string, Msg> }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [mkt, setMkt] = useState((settings.marketing_project || '').toUpperCase());
  const live = projects.filter((p) => p.status !== 'archived');
  const save = (id: string, body: Record<string, unknown>) => {
    say(id, 'Saving');
    call<{ settings: AdminProjectsSettings }>('/settings', body)
      .then((d) => {
        onSettings(d.settings);
        say(id, 'Saved');
      })
      .catch((x: Error) => say(id, x.message, true));
  };
  return (
    <section className="ad-card ad-group">
      <h3>Who can use Projects</h3>
      <div className="ad-set">
        <div>
          <label className="ad-set__name" htmlFor="ap-enabled">
            Who can open Projects
          </label>
          <div className="ad-set__hint">Admins only, every signed-in staff member, or nobody.</div>
        </div>
        <div>
          <select className="ad-field" id="ap-enabled" value={enabled} onChange={(e) => setEnabled(e.target.value)}>
            <Opt v="admins" label="Admins only" />
            <Opt v="staff" label="Every staff member" />
            <Opt v="off" label="Nobody" />
          </select>
        </div>
        <div className="ad-acts">
          <button type="button" className="ad-btn ad-btn--primary" data-act="save-enabled" onClick={() => save('enabled', { enabled })}>
            Save
          </button>
          <p className={msgClass(msgs.enabled)} data-msg="enabled" role="status">
            {msgs.enabled ? msgs.enabled.text : ''}
          </p>
        </div>
      </div>
      <div className="ad-set">
        <div>
          <label className="ad-set__name" htmlFor="ap-mkt">
            Marketing requests
          </label>
          <div className="ad-set__hint">Where a Marketing request from Make a request goes. The Asana form is the default.</div>
        </div>
        <div>
          <select className="ad-field" id="ap-mkt" value={mkt} onChange={(e) => setMkt(e.target.value)}>
            <Opt v="" label="The Asana form" />
            {live.map((p) => (
              <Opt key={p.key} v={p.key} label={p.name + ' (' + p.key + ')'} />
            ))}
          </select>
        </div>
        <div className="ad-acts">
          <button type="button" className="ad-btn ad-btn--primary" data-act="save-mkt" onClick={() => save('mkt', { marketing_project: mkt })}>
            Save
          </button>
          <p className={msgClass(msgs.mkt)} data-msg="mkt" role="status">
            {msgs.mkt ? msgs.mkt.text : ''}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------------------- the token */
function Token({ settings, onSettings, onRemoved, redraw, say, msgs }: { settings: AdminProjectsSettings; onSettings: (s: AdminProjectsSettings) => void; onRemoved: () => void; redraw: () => void; say: (id: string, t: string, bad?: boolean) => void; msgs: Record<string, Msg> }) {
  const [token, setToken] = useState('');
  const t = settings.token;
  const w = t.who;
  return (
    <section className="ad-card">
      <h2>Asana</h2>
      <p className="ad-card__meta">
        {!t.saved ? (
          'No token saved.'
        ) : w ? (
          <>
            Connected as {w.name} (<Mail text={w.email} />), {(w.workspaces || []).map((x) => x.name).join(', ')}. Tested <Ago iso={w.at} />.
          </>
        ) : (
          'A token is saved and has not been tested.'
        )}
        {t.saved && t.by ? (
          <>
            {' '}
            Saved by <Mail text={t.by} />.
          </>
        ) : null}
      </p>
      {settings.sealing ? null : <p className="ad-msg ad-msg--bad">This copy of FavorOS has no key to seal a token with, so it cannot keep one.</p>}
      <div className="ap-row">
        <label className="ap-grow">
          <span className="ap-lab">Personal access token</span>
          <input
            className="ad-field"
            id="ap-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t.saved ? 'Saved. Paste a new one to replace it.' : 'Paste the token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <div className="ad-acts ap-left">
        <button
          type="button"
          className="ad-btn ad-btn--primary"
          data-act="save-token"
          onClick={() => {
            say('token', 'Saving');
            call<{ settings: AdminProjectsSettings }>('/token', { token })
              .then((d) => {
                onSettings(d.settings);
                setToken('');
                return call<{ settings: AdminProjectsSettings; who: { name: string } }>('/test', {});
              })
              .then((d) => {
                onSettings(d.settings);
                redraw();
                say('token', 'Saved. Connected as ' + d.who.name + '.');
              })
              .catch((x: Error) => say('token', x.message, true));
          }}
        >
          Save token
        </button>
        <button
          type="button"
          className="ad-btn"
          data-act="test"
          disabled={!t.saved}
          onClick={() => {
            say('token', 'Testing');
            call<{ settings: AdminProjectsSettings; who: { name: string } }>('/test', {})
              .then((d) => {
                onSettings(d.settings);
                redraw();
                say('token', 'Connected as ' + d.who.name + '.');
              })
              .catch((x: Error) => say('token', x.message, true));
          }}
        >
          Connect and test
        </button>
        {t.saved ? (
          <button
            type="button"
            className="ad-btn"
            data-act="remove-token"
            onClick={() => {
              call<{ settings: AdminProjectsSettings }>('/token', { remove: true })
                .then((d) => {
                  onSettings(d.settings);
                  onRemoved();
                })
                .catch((x: Error) => say('token', x.message, true));
            }}
          >
            Remove token
          </button>
        ) : null}
        <p className={msgClass(msgs.token)} data-msg="token" role="status">
          {msgs.token ? msgs.token.text : ''}
        </p>
      </div>
      <p className="ad-card__meta">The import only reads from Asana. The Asana sync below writes to the projects it syncs.</p>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------------------- the report */
function Report({ rep, run }: { rep?: RunView['report']; run: RunView['run'] }) {
  if (!rep) return null;
  const ps = Object.keys(rep.projects).map((k) => rep.projects[k]);
  if (!ps.length) return null;
  const un = Object.keys(rep.people.unmatched).map((k) => rep.people.unmatched[k]);
  const dry = run.mode === 'dry';
  const tot = reportTotals(ps);
  const fp = rep.files.problems;
  return (
    <>
      <h3 className="ap-h3">{dry ? 'What an import would do' : 'What the import did'}</h3>
      <div className="ad-scroll">
        <table className="ad-table ap-table">
          <thead>
            <tr>
              <th>Project</th>
              <th className="num">{dry ? 'New' : 'Made'}</th>
              <th className="num">Updated</th>
              <th className="num">Unchanged</th>
              <th className="num">Subtasks</th>
              <th className="num">Sections</th>
              <th className="num">Comments</th>
              <th className="num">Files</th>
              <th className="num">{dry ? 'Asana says' : 'Asana says / hub has'}</th>
            </tr>
          </thead>
          <tbody>
            {ps.map((p, i) => (
              <tr key={i}>
                <td>
                  {p.name}
                  {p.key ? (
                    <>
                      <br />
                      <span className="mute">{p.key}</span>
                    </>
                  ) : null}
                </td>
                <td className="num">{num(p.tasks.create)}</td>
                <td className="num">{num(p.tasks.update)}</td>
                <td className="num">{num(p.tasks.same + p.tasks.kept)}</td>
                <td className="num">{num(p.tasks.subtasks)}</td>
                <td className="num">{num(p.sections.create + p.sections.update + p.sections.same)}</td>
                <td className="num">{num(p.comments.create + p.comments.update + p.comments.same)}</td>
                <td className="num">{num(p.files.copy + p.files.link + p.files.same)}</td>
                <td className="num">
                  {p.expected != null ? num(p.expected) : ''}
                  {!dry && p.hubCount != null ? ' / ' + num(p.hubCount) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ad-card__meta">
        Tags {num(tot.tags)}, custom fields {num(tot.fields)}, dependencies seen {num(tot.deps)}
        {rep.deps.linked ? ', linked ' + num(rep.deps.linked) : ''}
        {rep.deps.cycles ? ', skipped as loops ' + num(rep.deps.cycles) : ''}
        {rep.deps.outside ? ', pointing outside the import ' + num(rep.deps.outside) : ''}
        {tot.kept ? '. ' + num(tot.kept) + ' tasks kept because they were edited in FavorOS' : ''}
        {tot.also ? '. ' + num(tot.also) + ' tasks sit in more than one Asana project and were made once' : ''}
        {tot.err ? '. ' + num(tot.err) + ' tasks could not be read (see the log)' : ''}.
      </p>
      <h3 className="ap-h3">People not matched ({un.length})</h3>
      {un.length ? (
        <>
          <div className="ad-scroll">
            <table className="ad-table ap-table">
              <thead>
                <tr>
                  <th>Person in Asana</th>
                  <th>Why</th>
                  <th className="num">Tasks</th>
                  <th className="num">Comments</th>
                </tr>
              </thead>
              <tbody>
                {un.map((u, i) => (
                  <tr key={i}>
                    <td>
                      {u.name || <Mail text={u.email || ''} />}
                      {u.name && u.email ? (
                        <>
                          <br />
                          <span className="mute">
                            <Mail text={u.email} />
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td>{u.reason}</td>
                    <td className="num">{num(u.assigned + u.asked)}</td>
                    <td className="num">{num(u.comments)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ad-card__meta">Their tasks come in unassigned with their name in the description. Their comments keep their name in the words.</p>
        </>
      ) : (
        <p className="ad-empty">Everyone matched a hub person.</p>
      )}
      <h3 className="ap-h3">Files not copied ({fp.length})</h3>
      {fp.length ? (
        <>
          <div className="ad-scroll">
            <table className="ad-table ap-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Task</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {fp.map((f, i) => (
                  <tr key={i}>
                    <td>
                      {f.name}
                      {f.size ? (
                        <>
                          <br />
                          <span className="mute">{num(Math.round(f.size / 1024))} KB</span>
                        </>
                      ) : null}
                    </td>
                    <td>{f.task}</td>
                    <td>{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ad-card__meta">These stay as links to Asana. They stop working when the Asana workspace closes, so download them first.</p>
        </>
      ) : (
        <p className="ad-empty">Every file was copied or is a link to another service.</p>
      )}
      {rep.warnings && rep.warnings.length ? (
        <ul className="ad-list">
          {rep.warnings.slice(0, 20).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const RUN_LABEL: Record<string, string> = { running: 'Running', waiting: 'Paused by Asana', done: 'Finished', failed: 'Stopped', cancelled: 'Cancelled' };

function RunCard({ view, log, loopOn, onCancel, onContinue }: { view: RunView; log: LogLine[]; loopOn: boolean; onCancel: () => void; onContinue: () => void }) {
  const run = view.run;
  const p = view.progress || { read: 0, total: 0 };
  const pct = p.total ? Math.min(100, Math.round((p.read / p.total) * 100)) : run.status === 'done' ? 100 : 0;
  const label = RUN_LABEL[run.status] || run.status;
  const what = run.mode === 'dry' ? 'Dry run' : 'Import';
  const ol = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ol.current) ol.current.scrollTop = ol.current.scrollHeight;
  }, [log.length]);
  return (
    <section className="ad-card" id="ap-run">
      <h2>
        {what}: {label}
      </h2>
      <div className="ad-meter" role="img" aria-label={pct + ' percent'}>
        <i style={{ width: pct + '%' }} />
      </div>
      <div className="ad-meter__note">
        <span>
          {num(p.read)} of about {num(p.total)} tasks read
        </span>
        <span>{num(run.calls)} calls to Asana</span>
      </div>
      {run.error ? <p className="ad-msg ad-msg--bad">{run.error}</p> : null}
      {run.status === 'waiting' && run.resume_at ? (
        <p className="ad-card__meta">
          {' '}
          Carries on at <When iso={run.resume_at} />.
        </p>
      ) : null}
      {isLive(run.status) ? (
        <div className="ad-acts ap-left">
          <button type="button" className="ad-btn" data-act="cancel" onClick={onCancel}>
            Cancel
          </button>
          {loopOn ? null : (
            <button type="button" className="ad-btn ad-btn--primary" data-act="continue" onClick={onContinue}>
              Continue
            </button>
          )}
        </div>
      ) : null}
      <Report rep={view.report} run={run} />
      <h3 className="ap-h3">Log</h3>
      <ol className="ap-log" id="ap-log" aria-label="Run log" ref={ol}>
        {log.map((l) => (
          <li key={l.id} className={'ap-log--' + l.level}>
            <span className="mute">
              <When iso={l.at} />
            </span>{' '}
            {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------------------------------------------------ the page */
function ProjectsAdmin() {
  const { data: first } = useSuspenseQuery(adminProjectsQuery);
  const [settings, setSettings] = useState(first.settings);
  const [projects, setProjects] = useState<HubProject[]>(first.projects);
  const [runs, setRuns] = useState<RunRow[]>(first.runs);
  const [source, setSource] = useState('api');
  const [asana, setAsana] = useState<AsanaProject[]>([]);
  const [archived, setArchived] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [upload, setUpload] = useState('');
  const [exportName, setExportName] = useState('');
  const [opt, setOpt] = useState<ImportOptions>(DEFAULT_OPTIONS);
  const [run, setRun] = useState<RunView | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [lastDry, setLastDry] = useState<{ id: string; key: string } | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Record<string, Msg>>({});

  const runRef = useRef<RunView | null>(null);
  const logAfter = useRef(0);
  const loopRef = useRef(0);
  const epoch = useRef(0);
  const cur = useRef({ picked, source, upload });
  cur.current = { picked, source, upload };
  const scrollRun = useRef(false);

  const say = (id: string, text: string, bad = false) => setMsgs((m) => ({ ...m, [id]: { ok: !bad, text } }));
  // The classic page redraws its cards after some answers, which also drops every message under them; the cards that hold a draft start again from what is saved.
  const [drawKey, setDrawKey] = useState(0);
  const redraw = () => {
    setMsgs({});
    setDrawKey((n) => n + 1);
  };
  const refreshRun = (v: RunView) => {
    runRef.current = v;
    setRun(v);
  };
  const addLog = (lines: LogLine[]) => {
    if (!lines || !lines.length) return;
    lines.forEach((l) => {
      logAfter.current = Math.max(logAfter.current, l.id);
    });
    setLog((old) => old.concat(lines));
  };
  const reloadHub = () =>
    call<{ settings: AdminProjectsSettings; projects: HubProject[]; runs: RunRow[] }>('').then((d) => {
      setProjects(d.projects);
      setSettings(d.settings);
      setRuns(d.runs);
    });

  const finished = () => {
    const r = runRef.current && runRef.current.run;
    if (!r) return;
    if (r.mode === 'dry' && r.status === 'done') setLastDry({ id: r.id, key: pickedKey(cur.current.picked, cur.current.source, cur.current.upload) });
    call<{ projects: HubProject[]; runs: RunRow[] }>('')
      .then((d) => {
        setProjects(d.projects);
        setRuns(d.runs);
      })
      .catch(() => {});
  };

  const loop = () => {
    if (loopRef.current) return;
    const my = ++epoch.current;
    loopRef.current = my;
    setLoopOn(true);
    const stop = () => {
      if (loopRef.current === my) {
        loopRef.current = 0;
        setLoopOn(false);
      }
    };
    const tick = () => {
      if (loopRef.current !== my) return;
      const r = runRef.current && runRef.current.run;
      if (!r || !isLive(r.status)) {
        stop();
        finished();
        return;
      }
      let wait = 0;
      if (r.status === 'waiting' && r.resume_at) wait = Math.max(0, Date.parse(r.resume_at) - Date.now()) + 300;
      sleep(Math.min(wait, 60000))
        .then(() => {
          if (loopRef.current !== my) return;
          return call<RunView>('/runs/' + r.id + '/step', { after: logAfter.current }).then((v) => {
            addLog(v.log);
            refreshRun(v);
            tick();
          });
        })
        .catch((e: Error) => {
          stop();
          say('run', e.message, true);
        });
    };
    tick();
  };

  // A run that was going when the page opened carries on; leaving the page stops this page's loop (the server keeps the run).
  useEffect(() => {
    const live = first.runs.filter((r) => isLive(r.status))[0];
    if (live)
      call<RunView>('/runs/' + live.id).then((v) => {
        addLog(v.log);
        refreshRun(v);
        loop();
      });
    return () => {
      loopRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (scrollRun.current && run) {
      scrollRun.current = false;
      document.getElementById('ap-run')?.scrollIntoView({ block: 'start' });
    }
  }, [run]);

  const start = (body: unknown) => {
    setLog([]);
    logAfter.current = 0;
    say('run', 'Starting');
    return call<RunView>('/runs', body)
      .then((v) => {
        say('run', '');
        addLog(v.log);
        refreshRun(v);
        loop();
      })
      .catch((e: Error) => say('run', e.message, true));
  };

  const n = Object.keys(picked).length;
  const liveRun = !!run && isLive(run.run.status);
  const key = pickedKey(picked, source, upload);
  const ready = importReady(lastDry, key, liveRun);
  const list = asana;
  const find = q.toLowerCase();
  const hub = projects.filter((p) => !find || (p.name + ' ' + p.key + ' ' + (p.team || '')).toLowerCase().indexOf(find) >= 0);

  const switchSource = (id: string) => {
    redraw();
    setSource(id);
    setAsana([]);
    setPicked({});
    setUpload('');
    setExportName('');
  };
  const readFile = (f: File) => {
    say('file', 'Reading ' + f.name);
    f.text()
      .then((text) => call<{ upload: string; projects: Array<{ ref: string; name: string; archived?: boolean; tasks?: number }> }>('/export', { name: f.name, text }))
      .then((d) => {
        setUpload(d.upload);
        setExportName(f.name);
        const all: Record<string, string> = {};
        d.projects.forEach((p) => {
          all[p.ref] = p.name;
        });
        setPicked(all);
        setAsana(d.projects.map((p) => ({ gid: p.ref, name: p.name, archived: p.archived, tasks: p.tasks, team: '', owner: '' })));
        redraw();
      })
      .catch((x: Error) => say('file', x.message, true));
  };

  return (
    <div className="ad" id="ap-root">
      <Access key={'a' + drawKey} settings={settings} projects={projects} onSettings={setSettings} say={say} msgs={msgs} />
      <Token
        key={'t' + drawKey}
        settings={settings}
        onSettings={setSettings}
        onRemoved={() => {
          setAsana([]);
          redraw();
        }}
        redraw={redraw}
        say={say}
        msgs={msgs}
      />
      <section className="ad-card">
        <h2>Import projects</h2>
        <div className="ap-tabs" role="group" aria-label="Where to import from">
          {[
            ['api', 'From Asana'],
            ['export', 'From an export file'],
          ].map(([id, label]) => (
            <button key={id} type="button" className={'ap-tab' + (source === id ? ' is-on' : '')} data-act="source" data-id={id} aria-pressed={source === id} onClick={() => switchSource(id)}>
              {label}
            </button>
          ))}
        </div>
        {source === 'api' ? (
          <div className="ad-acts ap-left">
            <button
              type="button"
              className="ad-btn"
              data-act="load"
              disabled={!settings.token.saved}
              onClick={() => {
                say('load', 'Loading');
                call<{ projects: AsanaProject[] }>('/asana?archived=' + (archived ? '1' : '0'))
                  .then((d) => {
                    setAsana(d.projects);
                    setPicked({});
                    redraw();
                  })
                  .catch((x: Error) => say('load', x.message, true));
              }}
            >
              Load projects from Asana
            </button>
            <label className="ap-check">
              <input type="checkbox" id="ap-arch" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived projects
            </label>
            <p className={msgClass(msgs.load)} data-msg="load" role="status">
              {msgs.load ? msgs.load.text : ''}
            </p>
          </div>
        ) : (
          <>
            <div className="ap-row">
              <label className="ap-grow">
                <span className="ap-lab">Asana export file (CSV or JSON)</span>
                <input
                  className="ad-field"
                  id="ap-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(e) => {
                    const f = e.target.files && e.target.files[0];
                    if (f) readFile(f);
                  }}
                />
              </label>
            </div>
            <p className={msgClass(msgs.file)} data-msg="file" role="status">
              {msgs.file ? msgs.file.text : exportName ? exportName + ' is uploaded.' : ''}
            </p>
            <p className="ad-card__meta">An export carries tasks, sections, assignees, dates, tags and custom fields. A CSV export has no comments or files; the API import has both.</p>
          </>
        )}
        {list.length ? (
          <>
            <div className="ap-list">
              {list.map((p) => (
                <label className="ap-item" key={p.gid}>
                  <input
                    type="checkbox"
                    data-pick={p.gid}
                    data-name={p.name}
                    checked={!!picked[p.gid]}
                    onChange={(e) =>
                      setPicked((cur) => {
                        const next = { ...cur };
                        if (e.target.checked) next[p.gid] = p.name;
                        else delete next[p.gid];
                        return next;
                      })
                    }
                  />
                  <span className="ap-item__main">
                    <b>{p.name}</b>
                    <span className="mute">{[p.team, p.owner, p.tasks != null ? num(p.tasks) + ' tasks' : ''].filter(Boolean).join(', ')}</span>
                  </span>
                  {p.archived ? <span className="ad-chip">Archived</span> : null}
                  {p.imported ? <span className="ad-chip ad-chip--admin">Imported before</span> : null}
                </label>
              ))}
            </div>
            <div className="ad-acts ap-left">
              <button
                type="button"
                className="ad-btn"
                data-act="all"
                onClick={() => {
                  const all: Record<string, string> = {};
                  asana.forEach((p) => {
                    all[p.gid] = p.name;
                  });
                  setPicked(all);
                }}
              >
                Select all
              </button>
              <button type="button" className="ad-btn" data-act="none" onClick={() => setPicked({})}>
                Select none
              </button>
              <span className="ad-card__meta" id="ap-count">
                {n} selected
              </span>
            </div>
          </>
        ) : null}
        <details className="ap-more">
          <summary>Options</summary>
          <div className="ad-form">
            <label>
              Team label on each project
              <input className="ad-field" id="ap-team" value={opt.team} placeholder="Marketing" maxLength={60} onChange={(e) => setOpt({ ...opt, team: e.target.value })} />
            </label>
            <label>
              Who can see the projects
              <select className="ad-field" id="ap-vis" value={opt.visibility} onChange={(e) => setOpt({ ...opt, visibility: e.target.value })}>
                <Opt v="staff" label="Every staff member" />
                <Opt v="members" label="Members only" />
              </select>
            </label>
            <label className="ad-check">
              <input type="checkbox" id="ap-copy" checked={opt.copyFiles} onChange={(e) => setOpt({ ...opt, copyFiles: e.target.checked })} /> Copy Asana files into FavorOS
            </label>
            <label className="ad-check">
              <input type="checkbox" id="ap-over" checked={opt.overwrite} onChange={(e) => setOpt({ ...opt, overwrite: e.target.checked })} /> Replace tasks edited in FavorOS since the last import
            </label>
            <label>
              Asana address = hub address, one per line
              <textarea className="ad-field" id="ap-map" rows={3} placeholder="name@gmail.com = name@favorintl.org" value={opt.map} onChange={(e) => setOpt({ ...opt, map: e.target.value })} />
            </label>
          </div>
        </details>
        <div className="ad-acts ap-left">
          <button type="button" className="ad-btn ad-btn--primary" data-act="dry" id="ap-dry" disabled={!n || liveRun} onClick={() => void start(runBody(source, 'dry', picked, opt, upload))}>
            Dry run
          </button>
          <button type="button" className="ad-btn ad-btn--warn" data-act="import" id="ap-import" disabled={!ready} title={ready ? '' : 'Run a dry run on these projects first'} onClick={() => setConfirmOpen(true)}>
            Import
          </button>
          <p className={msgClass(msgs.run)} data-msg="run" role="status">
            {msgs.run ? msgs.run.text : ''}
          </p>
        </div>
        <div id="ap-confirm">
          {confirmOpen ? (
            <div className="ad-confirm">
              <p>
                Import {n} project{n === 1 ? '' : 's'} into FavorOS? The dry run found {num(dryTasks(run && run.report ? run.report.projects : undefined))} tasks to make or update. Nobody is notified. Running it again later updates and never
                duplicates.
              </p>
              <div className="ad-acts" style={{ justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  className="ad-btn ad-btn--primary"
                  data-act="import-yes"
                  autoFocus
                  onClick={() => {
                    setConfirmOpen(false);
                    const body = runBody(source, 'import', picked, opt, upload);
                    body.confirm = true;
                    body.from_dry_run = lastDry && lastDry.id;
                    void start(body);
                  }}
                >
                  Yes, import
                </button>
                <button type="button" className="ad-btn" data-act="import-no" onClick={() => setConfirmOpen(false)}>
                  Not yet
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <div id="ap-slot-run">
        {run ? (
          <RunCard
            view={run}
            log={log}
            loopOn={loopOn}
            onCancel={() => {
              loopRef.current = 0;
              setLoopOn(false);
              call<RunView>('/runs/' + run.run.id + '/cancel', { after: logAfter.current })
                .then((v) => {
                  addLog(v.log);
                  refreshRun(v);
                  finished();
                })
                .catch((x: Error) => say('run', x.message, true));
            }}
            onContinue={loop}
          />
        ) : null}
      </div>
      <section className="ad-card">
        <h2>Projects in FavorOS</h2>
        <div className="ap-row">
          <label className="ap-grow">
            <span className="ap-lab">Find</span>
            <input className="ad-field ad-find" id="ap-find" type="search" value={q} placeholder="Name, key or team" onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {hub.length ? (
          <div className="ap-list">
            {hub.map((p) => (
              <div className="ap-item ap-item--hub" key={p.id}>
                <span className="ap-item__main">
                  <b>{p.name}</b>
                  <span className="mute">
                    {p.key}
                    {p.team ? ', ' + p.team : ''}, lead <Mail text={p.lead_email} />, {num(p.open)} open, {num(p.done)} done
                  </span>
                </span>
                {p.from_asana ? <span className="ad-chip">From Asana</span> : null}
                {p.status !== 'active' ? <span className="ad-chip">{p.status}</span> : null}
                <button
                  type="button"
                  className="ad-btn"
                  data-act={p.status === 'archived' ? 'restore' : 'archive'}
                  data-id={p.id}
                  onClick={() => {
                    const action = p.status === 'archived' ? 'restore' : 'archive';
                    call('/hub/' + p.id, { action })
                      .then(() => reloadHub())
                      .then(() => redraw())
                      .catch((x: Error) => say('hub', x.message, true));
                  }}
                >
                  {p.status === 'archived' ? 'Restore' : 'Archive'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="ad-empty">{projects.length ? 'No project matches.' : 'No projects yet.'}</p>
        )}
        <p className={msgClass(msgs.hub)} data-msg="hub" role="status">
          {msgs.hub ? msgs.hub.text : ''}
        </p>
      </section>
      <div id="ap-slot-runs">
        {runs.length ? (
          <section className="ad-card">
            <h2>Recent runs</h2>
            <div className="ad-scroll">
              <table className="ad-table ap-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Kind</th>
                    <th>Projects</th>
                    <th>Status</th>
                    <th className="num">Calls</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="ad-nw">
                        <Full iso={r.created_at} />
                      </td>
                      <td>{r.mode === 'dry' ? 'Dry run' : 'Import'}</td>
                      <td>{r.selection.join(', ')}</td>
                      <td>{r.status}</td>
                      <td className="num">{num(r.calls)}</td>
                      <td>
                        <button
                          type="button"
                          className="ad-btn"
                          data-act="open-run"
                          data-id={r.id}
                          onClick={() => {
                            setLog([]);
                            logAfter.current = 0;
                            call<RunView>('/runs/' + r.id)
                              .then((v) => {
                                addLog(v.log);
                                scrollRun.current = true;
                                refreshRun(v);
                                if (isLive(v.run.status)) loop();
                              })
                              .catch((x: Error) => say('hub', x.message, true));
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------- Asana sync */
const asanaSend = (path: string, body: unknown) => hubSend(path, 'POST', body, (d) => d);

function AsanaSyncBody() {
  const qc = useQueryClient();
  const { data: S } = useSuspenseQuery(asanaAdminQuery);
  const r = S.require || { on: false, people: [], extra: [], skip: [] };
  const [extra, setExtra] = useState((r.extra || []).join(', '));
  const [skip, setSkip] = useState((r.skip || []).join(', '));
  const [msg, setMsg] = useState<Msg | null>(null);
  const when = (iso?: string) => (iso ? <When iso={iso} /> : 'Never');
  const post = (path: string, body: unknown) => {
    setMsg({ ok: true, text: 'Saving' });
    return asanaSend(path, body)
      .then(() => qc.refetchQueries({ queryKey: asanaAdminQuery.queryKey }))
      .then(() => setMsg(null))
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  };
  const sync = S.sync === 'on';
  return (
    <>
      <section className="ad-card">
        <h2>Asana sync</h2>
        <p className="ad-card__meta">
          Sync is {sync ? 'on' : 'off'}. Waiting to go to Asana: {S.queue.outbox}. Failed: {S.queue.outbox_failed}. Waiting to come in: {S.queue.inbox}. People connected: {S.connected}.
          {S.waiting_until ? (
            <>
              {' '}
              Asana asked FavorOS to wait until <When iso={S.waiting_until} />.
            </>
          ) : null}
        </p>
        <div className="ad-acts ap-left">
          <button type="button" className={'ad-btn' + (sync ? '' : ' ad-btn--primary')} data-act="sync" data-on={sync ? 'off' : 'on'} onClick={() => void post('/api/asana/admin', { sync: sync ? 'off' : 'on' })}>
            {sync ? 'Turn sync off' : 'Turn sync on'}
          </button>
          <p className={msgClass(msg)} data-msg role="status">
            {msg ? msg.text : ''}
          </p>
        </div>
        <div className="ad-scroll">
          <table className="ad-table ap-table">
            <thead>
              <tr>
                <th>Asana project</th>
                <th>Last changed in Asana</th>
                <th>Sync</th>
                <th>Last full read</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {S.projects.map((p) => (
                <tr key={p.gid}>
                  <td>
                    {p.name}
                    {p.team ? <div className="ad-card__meta">{p.team}</div> : null}
                  </td>
                  <td>{when(p.modified_at)}</td>
                  <td>{p.enabled ? (p.webhook ? 'Syncing' : 'Syncing, webhook not set') : 'Off'}</td>
                  <td>{p.enabled ? when(p.last_reconcile) : ''}</td>
                  <td>
                    <button
                      type="button"
                      className={'ad-btn' + (p.enabled ? '' : ' ad-btn--primary')}
                      data-act="proj"
                      data-gid={p.gid}
                      data-on={p.enabled ? '0' : '1'}
                      onClick={() => void post('/api/asana/admin/project', { gid: p.gid, enabled: !p.enabled })}
                    >
                      {p.enabled ? 'Stop syncing' : 'Sync'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ad-card">
        <h2>Connect Asana before Projects</h2>
        <p className="ad-card__meta">
          {r.on ? 'On' : 'Off'}. Applies to everyone in the Asana workspace and on synced projects, and the Marketing team, plus the added list, less the skipped list. {r.people.length} people.
        </p>
        <div className="ad-acts ap-left">
          <button type="button" className={'ad-btn' + (r.on ? '' : ' ad-btn--primary')} data-act="require" data-on={r.on ? 'off' : 'on'} onClick={() => void post('/api/asana/admin', { require: r.on ? 'off' : 'on' })}>
            {r.on ? 'Turn off' : 'Turn on'}
          </button>
        </div>
        <div className="ap-row">
          <label className="ap-grow">
            <span className="ap-lab">Also these people</span>
            <input className="ad-field" id="as-extra" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
        </div>
        <div className="ap-row">
          <label className="ap-grow">
            <span className="ap-lab">Never these people</span>
            <input className="ad-field" id="as-skip" value={skip} onChange={(e) => setSkip(e.target.value)} />
          </label>
        </div>
        <div className="ad-acts ap-left">
          <button type="button" className="ad-btn ad-btn--primary" data-act="lists" onClick={() => void post('/api/asana/admin', { extra, skip })}>
            Save lists
          </button>
        </div>
        {r.people.length ? (
          <details>
            <summary>Who this applies to</summary>
            <ul className="ad-list">
              {r.people.map((p) => (
                <li key={p.email}>
                  <Mail text={p.email} />
                  {p.connected ? ' (connected)' : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      <section className="ad-card">
        <h2>Sync log</h2>
        <div className="ad-scroll">
          <table className="ad-table ap-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Way</th>
                <th>What</th>
              </tr>
            </thead>
            <tbody>
              {(S.log || []).map((l, i) => (
                <tr key={i}>
                  <td>
                    <When iso={l.at} />
                  </td>
                  <td>{l.dir}</td>
                  <td>{l.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** A failed sync read shows its words in the Asana card and leaves the rest of the page alone, as the classic page does. */
function AsanaSync() {
  return (
    <div className="ad" id="as-root">
      <QueryErrorResetBoundary>
        {() => (
          <Boundary
            fallback={(e) => (
              <section className="ad-card">
                <h2>Asana sync</h2>
                <p className="ad-msg ad-msg--bad">{e.message}</p>
              </section>
            )}
          >
            <Suspense fallback={<div className="ad-tile h-skel" style={{ minHeight: 200 }} />}>
              <AsanaSyncBody />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
    </div>
  );
}

const Wait = () => (
  <div className="ad" id="ap-root" aria-busy="true">
    <div className="ad-tile h-skel" style={{ minHeight: 140 }} />
  </div>
);

export function AdminProjectsPage() {
  return (
    <AdminPage on="projects" title="Projects" wait={<Wait />}>
      <ProjectsAdmin />
      <AsanaSync />
    </AdminPage>
  );
}
