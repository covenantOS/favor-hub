// The Links section of a task: the pieces that tie it to Chat, Drive, Clips, the expense request, Google Calendar and the meeting it came
// from. Ported from the task panel in public/js/projects/links.js (mountLinks, prefs). Calls go to /api/tasks/links/*. A person without
// access sees nothing (the server answers 404 and the section stays empty).
//
// The classic stylesheet, /css/projects-links.css, is added to the page the first time a panel opens, as links.js did.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '../lib/api';
import { mountOverlay } from '../kit/overlays';
import { toast } from '../kit/toast';

const L = '/api/tasks/links/';
const INTENT = 'pjl.clipIntent';

export function ensureLinksCss(): void {
  if (typeof document === 'undefined' || document.querySelector('link[href^="/css/projects-links.css"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/projects-links.css?v=1';
  document.head.appendChild(l);
}

const say = (msg: string, href?: string) => {
  if (href) toast(msg, { action: { label: 'Open', fn: () => location.assign(href) } });
  else toast(msg);
};

/* ---------------------------------------------------------------- shapes */
interface Shared {
  name: string;
  url: string;
}
interface ClipRow {
  name: string;
  url: string;
}
interface ExpenseRow {
  id?: string;
  doc_number: string;
  total: string;
  reason: string;
  status: string;
  status_label: string;
  signed?: boolean;
  approver: string;
  decided_at?: string;
  decline_note?: string;
  url: string;
}
interface LinksData {
  can?: { edit?: boolean };
  chat: { shared_in: Shared[] };
  project: { name: string; key: string; drive_folder_id: string | null; drive_url: string | null } | null;
  meeting: { title: string; stamp?: string; url: string } | null;
  expense: ExpenseRow | null;
  calendar: { label: string };
  clips: ClipRow[];
}
interface DriveFile {
  name: string;
  url: string;
  path?: string;
  indexed?: string;
}
interface MyClip {
  id: string;
  title: string;
  duration?: string;
  when?: string;
}
type Pick = null | 'drive' | 'folder' | 'clips' | 'expense';

/** Panels on screen, so a clip recorded for a task can refresh them. */
const reloaders = new Set<() => void>();

/* ---------------------------------------------------------------- the panel */
function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pjl-sec">
      <div className="pjl-sec__h">
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function TaskLinks({ taskRef }: { taskRef: string }) {
  const [d, setD] = useState<LinksData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<unknown[]>([]);
  const [msg, setMsg] = useState('');
  const chosenClip = useRef<MyClip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const base = L + 'task/' + encodeURIComponent(taskRef) + '/';

  const load = () =>
    call<LinksData>('GET', base + 'links').then(
      (r) => {
        if (!alive.current) return;
        setD(r);
        setLoadErr(null);
      },
      (e: Error & { status?: number }) => {
        if (alive.current) setLoadErr(e.status === 404 ? '' : e.message);
      }
    );
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    ensureLinksCss();
    alive.current = true;
    const r = () => void loadRef.current();
    reloaders.add(r);
    r();
    return () => {
      alive.current = false;
      reloaders.delete(r);
      clearTimeout(timer.current);
    };
  }, [taskRef]);

  const tell = (m: string) => setMsg(m);
  const fail = (er: Error) => setMsg('!' + er.message);
  const post = (path: string, body: unknown, method = 'POST') => call(method, base + path, body);

  if (loadErr !== null) return <div className="pjl-links"><p className="pjl-muted">{loadErr}</p></div>;
  if (!d) return <div className="pjl-links"><p className="pjl-muted">Loading links.</p></div>;

  const can = !!(d.can && d.can.edit);
  const list = items as never[];

  const onSearch = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (pick === 'drive') {
        if (v.trim().length < 2) {
          setItems([]);
          return;
        }
        call<{ files?: DriveFile[] }>('GET', L + 'drive?q=' + encodeURIComponent(v.trim())).then(
          (r) => setItems(r.files || []),
          () => setItems([])
        );
      }
    }, 250);
  };

  const share = () =>
    post('chat', {}).then(
      (r: { url?: string }) => {
        tell('Shared in the project channel.');
        say('Shared in the project channel.', r.url);
        void load();
      },
      (er) => fail(er)
    );
  const record = (as: string) => {
    try {
      sessionStorage.setItem(INTENT, JSON.stringify({ task: taskRef, as, at: Date.now() }));
    } catch {
      // no storage
    }
    const cam = document.getElementById('clip-cam');
    if (cam) {
      cam.click();
      tell('Record the clip. It is added to this task as the ' + (as === 'proof' ? 'proof' : 'brief') + ' when it is saved.');
    } else tell('!The recorder is not available on this page.');
  };
  const toggleClips = () => {
    const on = pick === 'clips' ? null : 'clips';
    setPick(on);
    setItems([]);
    chosenClip.current = null;
    if (on) call<{ clips?: MyClip[] }>('GET', L + 'clips').then((r) => setItems(r.clips || []));
  };
  const clipAs = (as: string) => {
    if (!chosenClip.current) {
      tell('!Pick a clip first.');
      return;
    }
    post('clip', { clip_id: chosenClip.current.id, as }).then(
      () => {
        setPick(null);
        tell('Clip added.');
        void load();
      },
      (er) => fail(er)
    );
  };
  const openDrive = (folder: boolean) => {
    setPick(folder ? 'folder' : 'drive');
    setQ('');
    setItems([]);
    if (folder && d.project) call<{ files?: DriveFile[] }>('GET', L + 'project/' + encodeURIComponent(d.project.key) + '/files').then((r) => setItems(r.files || []), (er) => fail(er));
  };
  const driveAdd = (f: DriveFile) =>
    call('POST', '/api/tasks/' + encodeURIComponent(taskRef) + '/files', { kind: 'drive', name: f.name, url: f.url }).then(
      () => {
        setPick(null);
        tell('Attached ' + f.name + '.');
        void load();
      },
      (er) => fail(er)
    );
  const makeFolder = () =>
    d.project &&
    call('POST', L + 'project/' + encodeURIComponent(d.project.key) + '/folder', {}).then(
      () => {
        tell('Project folder made in US Team Files.');
        void load();
      },
      (er) => fail(er)
    );
  const expPick = () => {
    setPick('expense');
    setItems([]);
    call<{ expenses?: ExpenseRow[] }>('GET', L + 'expense/mine').then((r) => setItems(r.expenses || []));
  };
  const expAdd = (x: ExpenseRow) =>
    post('expense', { expense_id: x.id }, 'PUT').then(
      () => {
        setPick(null);
        tell('Expense request linked.');
        void load();
      },
      (er) => fail(er)
    );
  const expUnlink = () =>
    post('expense', { expense_id: null }, 'PUT').then(
      () => {
        tell('Unlinked.');
        void load();
      },
      (er) => fail(er)
    );

  const x = d.expense;
  const drivePicker = (
    <>
      <div className="pjl-field">
        <input className="pjl-input" data-q="" placeholder="Search Drive by name" value={q} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <div className="pjl-pick">
        {list.length ? (
          (list as DriveFile[]).map((f, i) => (
            <button key={i} type="button" onClick={() => void driveAdd(f)}>
              <b>{f.name}</b>
              <small>{[f.path, f.indexed].filter(Boolean).join(' · ')}</small>
            </button>
          ))
        ) : (
          <p className="pjl-muted">{q.length < 2 && pick === 'drive' ? 'Type two letters to search.' : 'No files found.'}</p>
        )}
      </div>
    </>
  );

  return (
    <div className="pjl-links">
      <Sec title="Chat">
        {d.chat.shared_in.length ? (
          d.chat.shared_in.map((c, i) => (
            <div key={i} className="pjl-item">
              <span className="t">Shared in {c.name}</span>
              <a className="pjl-btn pjl-btn--quiet" href={c.url}>
                Open
              </a>
            </div>
          ))
        ) : (
          <p className="pjl-muted">Not shared in Chat yet.</p>
        )}
        <div className="pjl-row">
          {d.project ? (
            <button type="button" className="pjl-btn" onClick={() => void share()}>
              Share in {d.project.name} channel
            </button>
          ) : null}
        </div>
      </Sec>
      {d.meeting ? (
        <Sec title="Meeting">
          <div className="pjl-item">
            <span className="t">
              {d.meeting.title}
              {d.meeting.stamp ? (
                <>
                  {' '}
                  <small>at {d.meeting.stamp} in the transcript</small>
                </>
              ) : null}
            </span>
            <a className="pjl-btn pjl-btn--quiet" href={d.meeting.url}>
              Open notes
            </a>
          </div>
        </Sec>
      ) : null}
      <Sec title="Clips">
        {d.clips.length ? (
          d.clips.map((c, i) => (
            <div key={i} className="pjl-item">
              <span className="t">{c.name}</span>
              <a className="pjl-btn pjl-btn--quiet" href={c.url}>
                Watch
              </a>
            </div>
          ))
        ) : (
          <p className="pjl-muted">No clip on this task.</p>
        )}
        {can ? (
          <div className="pjl-row">
            <button type="button" className="pjl-btn" onClick={() => record('brief')}>
              Record the brief
            </button>
            <button type="button" className="pjl-btn" onClick={() => record('proof')}>
              Record proof
            </button>
            <button type="button" className="pjl-btn pjl-btn--quiet" onClick={toggleClips}>
              Attach a clip
            </button>
          </div>
        ) : null}
      </Sec>
      <Sec title="Drive">
        <div className="pjl-row">
          <button type="button" className="pjl-btn" onClick={() => openDrive(false)}>
            Attach from Drive
          </button>
          {d.project ? (
            d.project.drive_folder_id ? (
              <>
                <button type="button" className="pjl-btn pjl-btn--quiet" onClick={() => openDrive(true)}>
                  Project folder files
                </button>
                <a className="pjl-btn pjl-btn--quiet" target="_blank" rel="noopener" href={d.project.drive_url || undefined}>
                  Open folder
                </a>
              </>
            ) : can ? (
              <button type="button" className="pjl-btn pjl-btn--quiet" onClick={() => void makeFolder()}>
                Make the project folder
              </button>
            ) : null
          ) : null}
        </div>
        {pick === 'drive' || pick === 'folder' ? drivePicker : null}
      </Sec>
      <Sec title="Expense request">
        {x ? (
          <>
            <div className="pjl-item">
              <span className="t">
                <b>{x.doc_number}</b> {x.total}
                <br />
                <small>{x.reason}</small>
              </span>
              <span className={'pjl-chip ' + (x.signed ? 'pjl-chip--ok' : x.status === 'declined' ? 'pjl-chip--bad' : 'pjl-chip--warn')}>{x.status_label}</span>
            </div>
            {x.signed && x.decided_at ? (
              <p className="pjl-muted">
                Signed by {x.approver} on {new Date(x.decided_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </p>
            ) : x.status === 'declined' && x.decline_note ? (
              <p className="pjl-muted">{x.decline_note}</p>
            ) : (
              <p className="pjl-muted">Waiting for {x.approver}.</p>
            )}
            <div className="pjl-row">
              <a className="pjl-btn pjl-btn--quiet" href={x.url}>
                Open expenses
              </a>
              {can ? (
                <button type="button" className="pjl-btn pjl-btn--quiet" onClick={() => void expUnlink()}>
                  Unlink
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p className="pjl-muted">No expense request on this task.</p>
            {can ? (
              <div className="pjl-row">
                <button type="button" className="pjl-btn" onClick={expPick}>
                  Link one of mine
                </button>
                <a className="pjl-btn pjl-btn--quiet" target="_blank" rel="noopener" href="/expenses/new">
                  Start a new one
                </a>
              </div>
            ) : null}
            {pick === 'expense' ? (
              <div className="pjl-pick">
                {list.length ? (
                  (list as ExpenseRow[]).map((e, i) => (
                    <button key={i} type="button" onClick={() => void expAdd(e)}>
                      <b>
                        {e.doc_number} {e.total}
                      </b>
                      <small>{e.status_label + ' · ' + e.reason}</small>
                    </button>
                  ))
                ) : (
                  <p className="pjl-muted">You have no expense requests yet.</p>
                )}
              </div>
            ) : null}
          </>
        )}
      </Sec>
      <Sec title="Calendar">
        <p className="pjl-muted">{d.calendar.label}</p>
        <div className="pjl-row">
          <button type="button" className="pjl-btn pjl-btn--quiet" onClick={openPrefs}>
            My notice choices
          </button>
        </div>
      </Sec>
      {pick === 'clips' ? (
        <Sec title="Pick a clip">
          <div className="pjl-pick">
            {list.length ? (
              (list as MyClip[]).map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    chosenClip.current = c;
                    tell('Picked "' + c.title + '". Choose how to add it.');
                  }}
                >
                  <b>{c.title}</b>
                  <small>{[c.duration, c.when].filter(Boolean).join(' · ')}</small>
                </button>
              ))
            ) : (
              <p className="pjl-muted">No clips yet. Record one with the camera button.</p>
            )}
          </div>
          <div className="pjl-row">
            <button type="button" className="pjl-btn" onClick={() => clipAs('brief')}>
              As the brief
            </button>
            <button type="button" className="pjl-btn" onClick={() => clipAs('proof')}>
              As proof
            </button>
          </div>
        </Sec>
      ) : null}
      {msg ? <p className={msg.charAt(0) === '!' ? 'pjl-err' : 'pjl-muted'}>{msg.replace(/^!/, '')}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- a clip recorded for a task */
/** Listens for a saved recording and adds it to the task named in the intent the panel stored. Install once per page. */
export function installClipIntent(): () => void {
  const onClips = (e: Event) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    let raw: { task: string; as: string; at: number } | null = null;
    try {
      raw = JSON.parse(sessionStorage.getItem(INTENT) || 'null');
    } catch {
      raw = null;
    }
    if (!id || !raw || Date.now() - raw.at > 45 * 60 * 1000) return;
    try {
      sessionStorage.removeItem(INTENT);
    } catch {
      // no storage
    }
    const as = raw.as;
    call('POST', L + 'task/' + encodeURIComponent(raw.task) + '/clip', { clip_id: id, as }).then(
      () => {
        toast('Clip added to the task as the ' + (as === 'proof' ? 'proof' : 'brief') + '.');
        reloaders.forEach((f) => f());
      },
      (er: Error) => toast(er.message)
    );
  };
  window.addEventListener('clips:changed', onClips);
  return () => window.removeEventListener('clips:changed', onClips);
}

/* ---------------------------------------------------------------- project email and calendar choices */
interface Prefs {
  mail_mode: string;
  calendar: boolean;
  google: { connected: boolean; calendar: boolean };
  connect_url: string;
}
const MAIL: [string, string, string][] = [
  ['now', 'Each notice', 'One email when a task is given to you, you are mentioned or someone comments.'],
  ['daily', 'Daily summary', 'One email each weekday morning with what is new.'],
  ['off', 'No email', 'Notices stay in the bell and on Today.'],
];

const XS = '<path d="M6 6l12 12M18 6L6 18"/>';

function PrefsDialog({ close }: { close: (fromBack?: boolean) => void }) {
  const [p, setP] = useState<Prefs | null>(null);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    ensureLinksCss();
    call<Prefs>('GET', L + 'prefs').then(setP, (e: Error) => setLoadErr(e.message));
  }, []);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const ov = (window as unknown as { hubOv?: { on: (f: () => void) => unknown; off: (t: unknown) => void } }).hubOv;
    let fromBack = false;
    const tok = ov ? ov.on(() => { fromBack = true; closeRef.current(true); }) : null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', key, true);
    ref.current?.querySelector<HTMLElement>('.pjl-x')?.focus();
    return () => {
      document.removeEventListener('keydown', key, true);
      if (tok && ov && !fromBack) ov.off(tok);
      if (prevFocus && prevFocus.focus) {
        try {
          prevFocus.focus();
        } catch {
          // gone
        }
      }
    };
  }, []);

  const change = (body: Record<string, unknown>) => call<Prefs>('PUT', L + 'prefs', body).then(setP, (e: Error) => setErr(e.message));

  return (
    <div ref={ref} className="pjl-ov pjl-ov--dlg">
      <div className="pjl-ov__bg" onClick={() => close()} />
      <div className="pjl-sheet" role="dialog" aria-modal="true" aria-label="Project notices">
        <div className="pjl-sheet__h">
          <h3>Project notices</h3>
          <button type="button" className="pjl-x" aria-label="Close" onClick={() => close()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: XS }} />
          </button>
        </div>
        <div className="pjl-sheet__b">
          {loadErr ? <p className="pjl-err">{loadErr}</p> : null}
          {!p && !loadErr ? <p className="pjl-muted">Loading.</p> : null}
          {p ? (
            <>
              <div className="pjl-seg" role="radiogroup" aria-label="Project email">
                {MAIL.map((o) => (
                  <label key={o[0]} className="pjl-opt">
                    <input type="radio" name="pjl-mail" value={o[0]} checked={p.mail_mode === o[0]} onChange={() => void change({ mail_mode: o[0] })} />
                    <span>
                      <b>{o[1]}</b>
                      <small>{o[2]}</small>
                    </span>
                  </label>
                ))}
              </div>
              <label className="pjl-opt">
                <input type="checkbox" data-cal="" checked={!!p.calendar} onChange={(e) => void change({ calendar: e.target.checked })} />
                <span>
                  <b>Due dates on my Google Calendar</b>
                  <small>
                    {!p.google.connected
                      ? 'Connect Google first, from the sign-in step.'
                      : !p.google.calendar
                        ? 'Google needs your permission once to add events to your calendar.'
                        : 'Tasks you own appear on your calendar on their due date.'}
                  </small>
                </span>
              </label>
              {p.google.connected && !p.google.calendar && p.calendar ? (
                <a className="pjl-btn" href={p.connect_url}>
                  Allow calendar events
                </a>
              ) : null}
              {err ? <p className="pjl-err">{err}</p> : null}
            </>
          ) : null}
        </div>
        <div className="pjl-sheet__f">
          <button type="button" className="pjl-btn" onClick={() => close()}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** The project email and calendar choices dialog. */
export function openPrefs(): void {
  ensureLinksCss();
  let off: () => void = () => undefined;
  off = mountOverlay(() => <PrefsDialog close={() => off()} />);
}
