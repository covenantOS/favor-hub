/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { MI, isPhone, size, when, who } from './util';
import { getApi } from './mailApi';
import { shortDay } from './Assist';

const ET = (iso?: string) => new Date(iso || Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const plainOf = (m: any) => {
  const d = document.createElement('div');
  d.innerHTML = m && m.html ? m.html : '';
  return (d.textContent || (m && m.snippet) || '').trim();
};
const slotLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
const Empty = ({ t }: { t: string }) => (
  <div className="ml-empty">
    <span>{t}</span>
  </div>
);

export interface SmartCtx {
  me: string;
  thread: any;
  partner: any;
  customs: any[];
  ov: any;
  boxes: any[];
  threadBox: string;
  lastHash: string;
  starred: boolean;
  hasWorkCenter: boolean;
  close: () => void;
  say: (m: string, undo?: () => void, ms?: number) => void;
  failed: (e: any, what?: string) => void;
  /** Close the sheet, then run `then` (a sheet opening another sheet). */
  then: (fn: () => void) => void;
  open: (kind: string, data?: any) => void;
  act: (kind: string) => void;
  reply: (kind: 'reply', text: string) => void;
  setCustoms: (c: any[]) => void;
  reloadOverview: () => void;
  markLogged: () => void;
  removeBox: (email: string) => void;
  archiveMany: (ids: string[]) => void;
}

const confirmed = (m: string) => window.confirm(m);

/* ------------------------------------------------------------------ More */
function MoreSheet({ c, anchor }: { c: SmartCtx; anchor?: HTMLElement | null }) {
  const t = c.thread;
  const p = c.partner;
  const us = (((t.messages || []).filter((m: any) => m.unsubscribe && (m.unsubscribe.url || m.unsubscribe.mailto)).slice(-1)[0]) || {}).unsubscribe;
  const items: Array<[string, string, string, string]> = [['task', 'task', 'Make a task', 'Projects'], ['to-chat', 'chat', 'Send to Chat', 'A channel or a person']];
  if (p) items.push(['open-partner', 'person', 'Open partner', p.name || '']);
  if (p && c.hasWorkCenter) items.push(['log-action', 'log', 'Log as an action in Blackbaud', '']);
  if (isPhone()) items.push(['toggle-read', 'unread', 'Mark as unread', ''], ['snooze', 'clock', 'Snooze', ''], ['star', 'star', c.starred ? 'Remove star' : 'Star', '']);
  if (us) items.push(['unsub', 'x', 'Unsubscribe', us.url ? "Opens the sender's page" : 'Sends the sender an email']);
  items.push(['find-time', 'cal', 'Find a time', 'From your calendar'], ['assign', 'person', 'Assign to a teammate', 'Chat notice with a note'], ['mention', 'chat', 'Mention a coworker', 'Chat notice with a note'], ['request', 'task', 'Make a request', 'On the request board'], ['ask-brain', 'q', 'Ask Favor Brain', 'About this email'], ['gmail', 'ext', 'Open in Gmail', '']);
  const pick = (k: string) => {
    if (k === 'gmail') return window.open('https://mail.google.com/mail/?authuser=' + encodeURIComponent(c.me) + '#all/' + encodeURIComponent(t.id), '_blank', 'noopener');
    if (k === 'task' || k === 'to-chat' || k === 'log-action' || k === 'find-time' || k === 'assign' || k === 'mention' || k === 'request') return c.then(() => c.open(k));
    if (k === 'ask-brain') return c.then(() => c.open('ask-brain'));
    if (k === 'unsub') return c.then(() => c.open('unsub'));
    if (k === 'open-partner') return void (location.href = '/work/partner/' + encodeURIComponent(p.id));
    c.close();
    c.act(k);
  };
  return (
    <Sheet title="More" anchor={anchor} onClose={c.close}>
      <div className="ml-menu">
        {items.map((x) => (
          <button type="button" className="ml-menu__i" key={x[0]} onClick={() => pick(x[0])}>
            <MI n={x[1]} />
            <span>{x[2]}</span>
            {x[3] ? <small>{x[3]}</small> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Make a task */
function TaskSheet({ c }: { c: SmartCtx }) {
  const t = c.thread;
  const m = t.messages.filter((x: any) => !x.draft).slice(-1)[0];
  const [title, setTitle] = useState(t.subject || 'Email');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('From ' + who(m && m.from) + ', ' + when(m && m.date, true));
  return (
    <Sheet title="Make a task" onClose={c.close}>
      <form
        className="ml-form"
        onSubmit={(e) => {
          e.preventDefault();
          const b: any = { title: title.trim(), description: note.trim() + '\n\n' + location.origin + '/mail/' + c.lastHash, owner_email: c.me };
          if (due) b.due_date = due;
          getApi()
            .task(b)
            .then((d: any) => {
              c.close();
              c.say('Task made' + (d.task && d.task.code ? ' ' + d.task.code : ''));
            })
            .catch((er: any) => c.say(er.status === 404 || er.status === 403 ? 'Projects is not open to you yet' : er.message));
        }}
      >
        <label>
          Task
          <input className="ml-input" maxLength={200} required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Due
          <input className="ml-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <label>
          Note
          <textarea className="ml-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="ml-sheet__acts">
          <button type="submit" className="ml-btn ml-btn--primary">
            Make task
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Send to Chat */
function ChatSheet({ c }: { c: SmartCtx }) {
  const t = c.thread;
  const m = t.messages.filter((x: any) => !x.draft).slice(-1)[0];
  const [list, setList] = useState<any[] | null>(null);
  const [users, setUsers] = useState<any>({});
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    getApi()
      .chatBoot()
      .then((d: any) => {
        setUsers(d.users || {});
        setList((d.channels || []).slice().sort((a: any, b: any) => String(b.last_at || '').localeCompare(String(a.last_at || ''))));
      })
      .catch((e: any) => setErr(e.status === 403 ? 'Chat is not open to you yet' : e.message));
  }, []);
  const nm = (ch: any) => {
    if (ch.kind === 'public' || ch.kind === 'private') return '#' + ch.name;
    const o = (ch.members || []).filter((e: string) => e !== c.me);
    return o.map((e: string) => (users[e] && users[e].name) || e).join(', ') || 'You';
  };
  return (
    <Sheet title="Send to Chat" onClose={c.close}>
      <div className="ml-pick">
        {err ? <Empty t={err} /> : !list ? <Empty t="Loading conversations" /> : !list.length ? <Empty t="No conversations" /> : list.map((ch) => (
          <button
            type="button"
            className="ml-menu__i"
            key={ch.id}
            onClick={() => {
              const body = (note.trim() ? note.trim() + '\n\n' : '') + '**' + (t.subject || '(no subject)') + '**\nFrom ' + who(m.from) + ', ' + when(m.date, true) + '\n\n' + plainOf(m).slice(0, 1200);
              getApi()
                .chatSend(ch.id, body.slice(0, 3800))
                .then(() => {
                  c.close();
                  c.say('Sent to Chat');
                })
                .catch((e: any) => c.failed(e));
            }}
          >
            <MI n="chat" />
            <span>{nm(ch)}</span>
          </button>
        ))}
      </div>
      <label className="ml-form">
        <span>Note</span>
        <textarea className="ml-input" rows={2} placeholder="Add a note" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Log as an action */
function LogSheet({ c }: { c: SmartCtx }) {
  const t = c.thread;
  const p = c.partner;
  const m = t.messages.filter((x: any) => !x.draft).slice(-1)[0];
  const [owners, setOwners] = useState<any[] | null>(null);
  const [mine, setMine] = useState('');
  const [owner, setOwner] = useState('');
  const [date, setDate] = useState(ET(m && m.date));
  const [how, setHow] = useState('email');
  const [summary, setSummary] = useState(('Email: ' + (t.subject || '')).slice(0, 255));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getApi()
      .owners()
      .then((d: any) => {
        setOwners(d.owners || []);
        setMine(d.mine);
        setOwner(((d.owners || []).find((o: any) => o.fid === d.mine) || (d.owners || [])[0] || {}).fid || '');
      })
      .catch((e: any) => c.failed(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title="Log as an action" onClose={c.close}>
      <form
        className="ml-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!owner) return;
          setBusy(true);
          getApi()
            .logAction({ owner, date, channel: how, summary: summary.trim(), tags: [], constituent_ids: [String(p.id)], req: 'mail-' + t.id + '-' + p.id + '-' + date })
            .then((d: any) => {
              c.close();
              void getApi().logged?.(t.id, p.id)?.catch(() => undefined);
              c.markLogged();
              c.reloadOverview();
              c.say(d.dups && !d.created ? 'Already logged' : 'Logged on ' + (p.name || 'the partner'));
            })
            .catch((er: any) => {
              setBusy(false);
              c.say(er.message);
            });
        }}
      >
        <p className="ml-p">
          <b>{p.name || p.email}</b>
        </p>
        {owners && !owners.length ? <p className="ml-p">Action entry is not open to you.</p> : null}
        {owners && owners.length > 1 ? (
          <label>
            Whose contact
            <select className="ml-input" value={owner} onChange={(e) => setOwner(e.target.value)}>
              {owners.map((o) => (
                <option key={o.fid} value={o.fid}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Date
          <input className="ml-input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          How
          <select className="ml-input" value={how} onChange={(e) => setHow(e.target.value)}>
            <option value="email">Email</option>
            <option value="call">Call</option>
            <option value="meet">Meeting</option>
            <option value="mail">Mail</option>
          </select>
        </label>
        <label>
          What happened
          <input className="ml-input" maxLength={255} required value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className="ml-sheet__acts">
          <button type="submit" className="ml-btn ml-btn--primary" disabled={busy || !owner}>
            {busy ? 'Logging' : 'Log in Blackbaud'}
          </button>
        </div>
      </form>
      {void mine}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Assign, mention, request */
function HandOffSheet({ c, kind }: { c: SmartCtx; kind: 'assign' | 'mention' | 'request' }) {
  const t = c.thread;
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [surface, setSurface] = useState('dashboard');
  const [busy, setBusy] = useState(false);
  const timer = useRef(0);
  const title = kind === 'assign' ? 'Assign to a teammate' : kind === 'mention' ? 'Mention a coworker' : 'Make a request';
  const find = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) return setRes([]);
    timer.current = window.setTimeout(() => {
      getApi()
        .contacts(v.trim())
        .then((d: any) => setRes((d.people || []).filter((x: any) => x.kind === 'staff' && x.email !== c.me).slice(0, 6)))
        .catch(() => setRes([]));
    }, 160);
  };
  return (
    <Sheet title={title} onClose={c.close}>
      <form
        className="ml-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (kind !== 'request' && !chosen.length) return c.say('Pick someone first');
          setBusy(true);
          const a = getApi();
          const job = kind === 'assign' ? a.assign(t.id, chosen[0], note.trim()) : kind === 'mention' ? a.mention(t.id, chosen, note.trim()) : a.makeRequest(t.id, note.trim(), surface);
          job
            .then((d: any) => {
              c.close();
              c.say(kind === 'assign' ? 'Assigned to ' + (d.name || chosen[0]) : kind === 'mention' ? 'Told ' + (d.told || []).length + ((d.told || []).length === 1 ? ' person' : ' people') : 'Request made');
              if (kind === 'request' && d.url) setTimeout(() => c.say('Request on the board: ' + d.url), 0);
            })
            .catch((er: any) => {
              setBusy(false);
              c.say(er.message);
            });
        }}
      >
        {kind === 'request' ? (
          <label>
            Where it lands
            <select className="ml-input" value={surface} onChange={(e) => setSurface(e.target.value)}>
              <option value="dashboard">FavorOS</option>
              <option value="website">Website</option>
              <option value="portal">Portal</option>
              <option value="app">App</option>
            </select>
          </label>
        ) : (
          <>
            <label>
              Who
              <input className="ml-input" autoComplete="off" placeholder="Start typing a name" value={q} onChange={(e) => find(e.target.value)} />
            </label>
            <div className="ml-pick">
              {res.length
                ? res.map((x) => (
                    <button
                      type="button"
                      className="ml-menu__i"
                      key={x.email}
                      onClick={() => {
                        setChosen(kind === 'assign' ? [x.email] : chosen.indexOf(x.email) < 0 ? chosen.concat([x.email]) : chosen);
                        setQ('');
                        setRes([]);
                      }}
                    >
                      <span>{x.name || x.email}</span>
                      <small>{x.title || ''}</small>
                    </button>
                  ))
                : q.trim().length >= 2 ? <Empty t="No one on staff by that name" /> : null}
            </div>
            <p className="ml-p">{chosen.length ? (kind === 'assign' ? 'To ' : 'Telling ') + chosen.join(', ') : ''}</p>
          </>
        )}
        <label>
          Note
          <textarea className="ml-input" rows={3} maxLength={600} placeholder={kind === 'request' ? 'What needs to change' : 'What you need from them'} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="ml-p">{kind === 'request' ? "The request goes on the board as you, with the email's subject, sender and preview." : 'They get a Chat message with the subject, sender, a one line preview and your note. They cannot open your mailbox.'}</p>
        <div className="ml-sheet__acts">
          <button type="submit" className="ml-btn ml-btn--primary" disabled={busy}>
            {kind === 'assign' ? 'Assign' : kind === 'mention' ? 'Tell them' : 'Make the request'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Assigned and scheduled lists */
function AssignedSheet({ c }: { c: SmartCtx }) {
  const [list, setList] = useState<any[] | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    getApi().assigned().then((d: any) => setList(d.assigned || [])).catch((e: any) => c.failed(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title="Assigned to teammates" onClose={c.close}>
      {!list ? <Empty t="Loading" /> : !list.length ? <p className="ml-p">Nothing assigned yet.</p> : (
        <div className="ml-menu">
          {list.map((x) => (
            <div className="ml-menu__i ml-mrow" key={x.id}>
              <span>
                <b>{x.subject || '(no subject)'}</b>
                <br />
                <small>
                  {x.name}
                  {x.note ? ': ' + x.note : ''}, {shortDay(x.at)}
                </small>
              </span>
              {x.state === 'open' && !done[x.id] ? (
                <button type="button" className="ml-btn" onClick={() => getApi().assignedDone(x.id).then(() => setDone({ ...done, [x.id]: true })).catch((e: any) => c.failed(e))}>
                  Done
                </button>
              ) : (
                <small>Done</small>
              )}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function LaterListSheet({ c }: { c: SmartCtx }) {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => {
    getApi().later().then((d: any) => setList(d.later || [])).catch((e: any) => c.failed(e));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet title="Scheduled messages" onClose={c.close}>
      {!list ? <Empty t="Loading" /> : !list.length ? <p className="ml-p">Nothing scheduled.</p> : (
        <div className="ml-menu">
          {list.map((x) => (
            <div className="ml-menu__i ml-mrow" key={x.id}>
              <span>
                <b>{x.subject || '(no subject)'}</b>
                <br />
                <small>
                  To {(x.to || []).map((a: any) => a.email || a).join(', ')}, {new Date(x.sendAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </small>
              </span>
              <button
                type="button"
                className="ml-btn"
                onClick={() =>
                  getApi()
                    .dropLater(x.id)
                    .then(() => {
                      setList((l) => (l || []).filter((y) => y.id !== x.id));
                      c.say('Cancelled');
                    })
                    .catch((e: any) => c.failed(e))
                }
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Find a time */
function TimeSheet({ c }: { c: SmartCtx }) {
  const t = c.thread;
  const guests: string[] = [];
  (t.messages || []).forEach((m: any) => [m.from].concat(m.to || [], m.cc || []).forEach((x: any) => x && /@favorintl\.org$/.test(x.email) && x.email !== c.me && guests.indexOf(x.email) < 0 && guests.push(x.email)));
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  useEffect(() => {
    getApi().times({ guests, minutes: 30, days: 10 }).then(setD).catch((e: any) => setErr(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const slots: string[] = (d && d.slots) || [];
  const chosen = () => slots.filter((_, i) => picked[i]);
  return (
    <Sheet title="Find a time" onClose={c.close}>
      {err ? <p className="ml-p">{err}</p> : !d ? <Empty t="Reading calendars" /> : !slots.length ? <p className="ml-p">No free time found in the next 10 days.</p> : (
        <>
          <p className="ml-p">
            Free for you{(d.guests || []).length ? ' and ' + d.guests.length + ' on staff' : ''}, weekdays 9 to 5 Eastern.{d.note ? ' ' + d.note + '.' : ''}
          </p>
          <div className="ml-menu">
            {slots.map((x, i) => (
              <label className="ml-menu__i ml-check" key={x}>
                <input type="checkbox" checked={!!picked[i]} onChange={(e) => setPicked({ ...picked, [i]: e.target.checked })} />
                <span>{slotLabel(x)}</span>
              </label>
            ))}
          </div>
          <div className="ml-sheet__acts">
            <button
              type="button"
              className="ml-btn ml-btn--primary"
              onClick={() => {
                const p = chosen();
                if (!p.length) return c.say('Check at least one time');
                const text = 'Here are times that work for me (Eastern):\n' + p.map((x) => slotLabel(x).replace(' ET', '')).join('\n') + '\n\nTell me which one suits you.';
                c.then(() => c.reply('reply', text));
              }}
            >
              Put in a reply
            </button>
            <button
              type="button"
              className="ml-btn"
              onClick={() => {
                const p = chosen();
                if (!p.length) return c.say('Check a time');
                if (!guests.length) return c.say('Book needs staff on the email. Put the times in your reply.');
                if (!confirmed('Book a FavorOS meeting "' + (t.subject || 'Meeting') + '" at ' + slotLabel(p[0]) + ' and invite ' + guests.join(', ') + '?')) return;
                getApi()
                  .meetCreate({ title: (t.subject || 'Meeting').slice(0, 140), startsAt: p[0], durationMin: 30, invitees: guests.map((g) => ({ email: g })), access: 'invited' })
                  .then(() => {
                    c.close();
                    c.say('Meeting booked and invited');
                  })
                  .catch((er: any) => c.say(er.message));
              }}
            >
              Book it
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Categories and cleanup */
function CategoriesSheet({ c }: { c: SmartCtx }) {
  const [list, setList] = useState<any[]>(c.customs);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  return (
    <Sheet title="Categories in your words" onClose={c.close}>
      <p className="ml-p">Describe what belongs in a category. Mail reads each new email against your words, and Move to category teaches it by sender.</p>
      <div className="ml-menu">
        {list.length ? (
          list.map((x) => (
            <div className="ml-menu__i ml-mrow" key={x.id}>
              <span>
                <b>{x.name}</b>
                <br />
                <small>{x.description}</small>
              </span>
              <button
                type="button"
                className="ml-btn"
                onClick={() =>
                  getApi()
                    .dropCategory(x.id)
                    .then(() => {
                      const n = list.filter((y) => y.id !== x.id);
                      setList(n);
                      c.setCustoms(n);
                      c.reloadOverview();
                    })
                    .catch((e: any) => c.failed(e))
                }
              >
                Remove
              </button>
            </div>
          ))
        ) : (
          <p className="ml-p">None yet.</p>
        )}
      </div>
      <form
        className="ml-form"
        onSubmit={(e) => {
          e.preventDefault();
          getApi()
            .newCategory(name.trim(), desc.trim())
            .then((d: any) => {
              const n = list.concat([d.category]);
              setList(n);
              c.setCustoms(n);
              setName('');
              setDesc('');
              c.say('Category added. Mail reads your inbox against it now.');
              c.reloadOverview();
            })
            .catch((er: any) => c.say(er.message));
        }}
      >
        <label>
          Name
          <input className="ml-input" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          What belongs in it
          <textarea className="ml-input" required rows={3} maxLength={400} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <div className="ml-sheet__acts">
          <button type="submit" className="ml-btn ml-btn--primary">
            Add category
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function CleanSheet({ c }: { c: SmartCtx }) {
  const cl = c.ov && c.ov.cleanup;
  if (!cl) return null;
  return (
    <Sheet title="Archive unread newsletters and notices" onClose={c.close}>
      <p className="ml-p">{cl.total} conversations from senders where nothing has been opened. They stay in All mail.</p>
      <div className="ml-menu">
        {cl.senders.map((x: any) => (
          <div className="ml-menu__i" key={x.name}>
            <span>{x.name}</span>
            <small>{x.n}</small>
          </div>
        ))}
      </div>
      <div className="ml-sheet__acts">
        <button type="button" className="ml-btn ml-btn--primary" onClick={() => c.archiveMany(cl.ids.slice())}>
          Archive {cl.total}
        </button>
        <button type="button" className="ml-btn" onClick={c.close}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

function MoveSheet({ c, data }: { c: SmartCtx; data: { senders: string[] } }) {
  const cats = [['partners', 'Partners'], ['staff', 'Staff'], ['people', 'People'], ['receipts', 'Receipts and gifts'], ['newsletters', 'Newsletters'], ['notifications', 'Notifications'], ['calendar', 'Calendar']].concat(c.customs.map((x) => [x.id, x.name]));
  return (
    <Sheet title="Move to category" onClose={c.close}>
      <p className="ml-p">Mail files these senders there from now on.</p>
      <div className="ml-menu">
        {cats.map((x) => (
          <button
            type="button"
            className="ml-menu__i"
            key={x[0]}
            onClick={() =>
              getApi()
                .moveCat(data.senders, x[0])
                .then(() => {
                  c.close();
                  c.say('Moved to ' + x[1]);
                  c.reloadOverview();
                })
                .catch((e: any) => c.failed(e))
            }
          >
            <span>{x[1]}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Mailboxes, entity card, media, unsubscribe, Brain */
function BoxesSheet({ c }: { c: SmartCtx }) {
  return (
    <Sheet title="Mailboxes" onClose={c.close}>
      <p className="ml-p">Only you can see a mailbox you add here. Add a Favor account (an accounting or admin inbox, or a second account of yours) and reply from it, or remove it and FavorOS forgets the connection.</p>
      <div className="ml-menu">
        <div className="ml-menu__i ml-mrow">
          <i className="ml-mb" style={{ background: '#7b8a76' }} />
          <span>{c.me}</span>
          <small>Signed in</small>
        </div>
        {c.boxes.map((b) => (
          <div className="ml-menu__i ml-mrow" key={b.email}>
            <i className="ml-mb" style={{ background: b.color || '#7b8a76' }} />
            <span>{b.email}</span>
            <button
              type="button"
              className="ml-btn"
              onClick={() => {
                if (!confirmed('Remove ' + b.email + ' from FavorOS Mail? Nothing is deleted in Gmail.')) return;
                c.removeBox(b.email);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="ml-sheet__acts">
        <a className="ml-btn ml-btn--primary" href={'/api/google/connect?add=mailbox&next=' + encodeURIComponent('/mail/')}>
          Add a mailbox
        </a>
      </div>
    </Sheet>
  );
}

function EntitySheet({ c, data }: { c: SmartCtx; data: any }) {
  return (
    <Sheet title={data.title} onClose={c.close}>
      <div className="ml-ent-side">
        <b>{data.title}</b>
        <span>{data.sub || ''}</span>
        {(data.lines || []).map((l: any) => (
          <div key={l.k}>
            <small>{l.k}</small> {l.v}
          </div>
        ))}
        {data.href ? (
          <div className="ml-sheet__acts">
            <a className="ml-btn ml-btn--primary" href={data.href}>
              Open
            </a>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function MediaSheet({ c, data }: { c: SmartCtx; data: any }) {
  return (
    <Sheet title={data.name} wide onClose={c.close}>
      {data.kind === 'video' ? <video playsInline controls autoPlay src={data.url} className="ml-media" /> : <audio controls autoPlay src={data.url} className="ml-media" />}
      <div className="ml-sheet__acts">
        <a className="ml-btn" href={data.download} download>
          <MI n="dl" />
          Download
        </a>
      </div>
    </Sheet>
  );
}

export function SmartSheets({ kind, data, anchor, c }: { kind: string; data?: any; anchor?: HTMLElement | null; c: SmartCtx }) {
  switch (kind) {
    case 'more':
      return c.thread ? <MoreSheet c={c} anchor={anchor} /> : null;
    case 'task':
      return c.thread ? <TaskSheet c={c} /> : null;
    case 'to-chat':
      return c.thread ? <ChatSheet c={c} /> : null;
    case 'log-action':
      return c.thread && c.partner ? <LogSheet c={c} /> : null;
    case 'assign':
    case 'mention':
    case 'request':
      return c.thread ? <HandOffSheet c={c} kind={kind} /> : null;
    case 'assigned':
      return <AssignedSheet c={c} />;
    case 'later-list':
      return <LaterListSheet c={c} />;
    case 'find-time':
      return c.thread ? <TimeSheet c={c} /> : null;
    case 'cats':
      return <CategoriesSheet c={c} />;
    case 'clean':
      return <CleanSheet c={c} />;
    case 'move':
      return <MoveSheet c={c} data={data} />;
    case 'boxes':
      return <BoxesSheet c={c} />;
    case 'entity':
      return <EntitySheet c={c} data={data} />;
    case 'media':
      return <MediaSheet c={c} data={data} />;
    default:
      return null;
  }
}

export { size };
