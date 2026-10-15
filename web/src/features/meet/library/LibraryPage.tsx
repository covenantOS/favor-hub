// Meetings > Notes (/meet/library/): every meeting the person was invited to, with its notes. Search runs on the server (titles, summaries, hosts
// and what was said). Team chips filter the results in place. Port of src/pages/meet/library.astro and public/js/meet/library.js: the same
// markup, the same stylesheets, the same calls. The search box is drawn once, so typing never repaints it.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSuspenseQueries } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';
import '@hub/styles/break-ui.css';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../../partners/record/Boundary';
import { Day, Icon, Wait, meetApi, pump } from '../ui';
import { libraryActions, libraryDirectory, libraryList } from '../queries';

export interface Meeting {
  id: string;
  title: string;
  summary?: string;
  hostEmail?: string;
  hostName?: string;
  startedAt?: string;
  endedAt?: string;
  notesStatus?: string;
  recState?: string;
  actionCount?: number;
}
export interface Person {
  email: string;
  team?: string;
}
export interface Action {
  meeting_id: string;
  idx: number;
  text: string;
  title: string;
  due?: string;
}
export interface PartnerAsk {
  meetingId: string;
  name?: string;
  title: string;
  date: string;
}
interface Answer {
  answer: string;
  sources: { id: string; t?: number; text: string; title: string; date: string }[];
  searched: number;
}

const clip = (t: string, n = 220) => {
  t = (t || '').trim();
  if (t.length <= n) return t;
  const c = t.slice(0, n);
  const i = c.lastIndexOf(' ');
  return (i > n * 0.6 ? c.slice(0, i) : c) + '...';
};
const mins = (m: Meeting) => {
  if (!m.startedAt || !m.endedAt) return '';
  const n = Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000);
  return n > 0 ? `${n} min` : '';
};
const sd = (iso: string) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const stampOf = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function Card({ m, team }: { m: Meeting; team: string }) {
  // One sentence of the summary; a summary that only says the recording had nothing in it is left off.
  const one = (String(m.summary || '').replace(/\s+/g, ' ').trim().match(/^.*?[.!?](?= |$)/) || [''])[0];
  const empty = /appears to be|is unclear|unclear due|did not cover|does not seem|no specific|farewell message|was brief/i.test(one);
  const body = m.summary ? (empty ? '' : clip(one || m.summary)) : m.notesStatus === 'pending' ? 'Notes are being made.' : 'Notes are not ready yet.';
  const n = m.actionCount || 0;
  return (
    <NavLink className="libc h-card" href={`/meet/notes/?m=${m.id}`} style={{ textDecoration: 'none' }}>
      <div className="ft">
        <span>{team || m.hostName || ''}</span>
        <span>
          {m.endedAt ? <Day iso={m.endedAt} /> : null}
          {mins(m) ? ' · ' + mins(m) : ''}
        </span>
      </div>
      <h4>{m.title}</h4>
      {body ? <p>{body}</p> : null}
      <div className="ft">
        <span>{n ? `${n} action item${n === 1 ? '' : 's'}` : ''}</span>
        {m.recState === 'stored' ? (
          <span>
            <Icon n="drive" />
            Saved in Drive
          </span>
        ) : (
          <span />
        )}
      </div>
    </NavLink>
  );
}

function AskBox() {
  const [aa, setAa] = useState<{ q: string; busy: boolean; out: Answer | null }>({ q: '', busy: false, out: null });
  const input = useRef<HTMLInputElement>(null);
  const go = async () => {
    const v = (input.current?.value || '').trim();
    if (!v || aa.busy) return;
    setAa({ q: v, busy: true, out: null });
    let out: Answer;
    try {
      out = await meetApi<Answer>('meetings/ask', { method: 'POST', body: { q: v } });
    } catch (e) {
      out = { answer: (e as Error).message, sources: [], searched: 0 };
    }
    setAa({ q: v, busy: false, out });
  };
  const o = aa.out;
  return (
    <div className="h-card mt-card" style={{ marginBottom: 14 }}>
      <div className="h-label" style={{ marginBottom: 8 }}>
        Ask your meetings
      </div>
      <div className="rm-input" style={{ border: 0, padding: 0 }}>
        <input
          id="aaq"
          ref={input}
          aria-label="Ask your meetings"
          placeholder="What did we decide about the banquet?"
          maxLength={300}
          defaultValue={aa.q}
          disabled={aa.busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void go();
            }
          }}
        />
        <button className="icb send" id="aago" aria-label="Ask" disabled={aa.busy} onClick={() => void go()}>
          <Icon n="send" />
        </button>
      </div>
      {aa.busy ? (
        <p className="mt-sub" style={{ margin: '8px 0 0' }}>
          Reading your meetings.
        </p>
      ) : o ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px', fontSize: 14 }}>{o.answer}</p>
          {o.sources.map((s, i) => (
            <div className="aa-src" key={i}>
              <NavLink href={`/meet/notes/?m=${s.id}${s.t ? '#t=' + s.t : ''}`}>{s.t ? stampOf(s.t) : 'Notes'}</NavLink>
              <div>
                {s.text}
                <em>
                  {s.title}, {sd(s.date)}
                </em>
              </div>
            </div>
          ))}
          <p className="mt-sub" style={{ margin: '8px 0 0' }}>
            Searched {o.searched.toLocaleString('en-US')} meetings you can read.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Partners({ items }: { items: PartnerAsk[] }) {
  if (!items.length) return null;
  return (
    <div className="h-card mt-card" style={{ marginBottom: 14 }}>
      <div className="h-label" style={{ marginBottom: 4 }}>
        Log on a partner record
      </div>
      <p className="mt-sub" style={{ margin: '0 0 6px' }}>
        These meetings had a partner on the invite. Nothing goes to Blackbaud until you press Log in Blackbaud on the meeting.
      </p>
      {items.map((p, i) => (
        <div className="pt-row" key={i}>
          <div>
            <b>{p.name || 'Partner'}</b>
            <span>
              {p.title}, {sd(p.date)}
            </span>
          </div>
          <div className="pt-acts">
            <NavLink className="h-btn h-btn--primary h-btn--sm" href={`/meet/notes/?m=${p.meetingId}#partners`}>
              Review
            </NavLink>
          </div>
        </div>
      ))}
    </div>
  );
}

function Actions({ acts, onDone }: { acts: Action[]; onDone: (a: Action) => void }) {
  if (!acts.length) return null;
  return (
    <div className="h-card mt-card" style={{ marginBottom: 14 }}>
      <div className="h-label" style={{ marginBottom: 4 }}>
        Your action items
      </div>
      {acts.map((a) => (
        <label className="act" key={a.meeting_id + ':' + a.idx}>
          <input
            type="checkbox"
            data-m={a.meeting_id}
            data-i={a.idx}
            onChange={async (e) => {
              const c = e.currentTarget;
              try {
                await meetApi(`meetings/${a.meeting_id}/action`, { method: 'POST', body: { idx: Number(a.idx), done: c.checked } });
                onDone(a);
              } catch {
                c.checked = !c.checked;
              }
            }}
          />
          <div>
            <b>{a.text}</b>
            <span>
              {a.title}
              {a.due ? ' · due ' + a.due : ''}
            </span>
          </div>
          <NavLink className="h-btn h-btn--ghost h-btn--sm" href={`/meet/notes/?m=${a.meeting_id}`}>
            Notes
          </NavLink>
        </label>
      ))}
    </div>
  );
}

function Library() {
  const [{ data: first }, { data: act0 }, { data: dir }] = useSuspenseQueries({ queries: [libraryList, libraryActions, libraryDirectory] });
  const [list, setList] = useState<Meeting[]>(first.meetings);
  const [acts, setActs] = useState<Action[]>(act0.actions);
  const [team, setTeam] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const people = useRef(new Map((dir.people || []).map((p) => [String(p.email).toLowerCase(), p] as const)));
  const teamOf = (m: Meeting) => people.current.get(String(m.hostEmail || '').toLowerCase())?.team || '';

  useEffect(() => {
    if (list.some((m) => m.notesStatus === 'pending' || m.recState === 'uploading')) void pump(undefined, undefined);
    // Once, on arrival (classic does the same after its first draw).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = useCallback(async (text: string) => {
    const mine = ++seq.current;
    try {
      const r = await meetApi<{ meetings: Meeting[] }>('meetings?scope=notes' + (text ? '&q=' + encodeURIComponent(text) : ''));
      if (mine !== seq.current) return;
      setErr('');
      setList(r.meetings);
    } catch (e) {
      if (mine === seq.current) setErr((e as Error).message);
    }
  }, []);

  const teams = [...new Set(list.map(teamOf).filter(Boolean))].sort();
  const cur = team && !teams.includes(team) ? '' : team;
  const shown = cur ? list.filter((m) => teamOf(m) === cur) : list;
  const partners = act0.partnerConfirms || [];

  return (
    <>
      <div className="mt-intro">
        <div>
          <h2 className="mt-h2">Meeting notes</h2>
        </div>
      </div>
      <div id="libpartners">
        <Partners items={partners} />
      </div>
      <div id="libask">
        <AskBox />
      </div>
      <div id="libacts">
        <Actions acts={acts} onDone={(a) => setActs((cur) => cur.filter((x) => !(x.meeting_id === a.meeting_id && x.idx === a.idx)))} />
      </div>
      <div className="bigsearch">
        <svg className="h-i" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="libq"
          placeholder="Search what was said, titles and summaries"
          defaultValue=""
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value.trim();
            setQ(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void search(v), 250);
          }}
        />
      </div>
      <div className="mt-chips" id="libchips" style={{ marginBottom: 14 }}>
        {teams.length > 1
          ? ['', ...teams].map((t) => (
              <button key={t} className={'mt-chip' + (cur === t ? ' is-on' : '')} data-team={t} onClick={() => setTeam(t)}>
                {t || 'Everything'}
              </button>
            ))
          : null}
      </div>
      <div className="lib" id="liblist">
        {err ? (
          <p className="mt-sub">{err}</p>
        ) : shown.length ? (
          shown.map((m) => <Card key={m.id} m={m} team={teamOf(m)} />)
        ) : (
          <p className="mt-sub">{q ? `Nothing matches "${q}".` : cur ? 'No notes from this team yet.' : 'No notes yet. They appear after a meeting that records.'}</p>
        )}
      </div>
    </>
  );
}

export function LibraryPage() {
  return (
    <div id="mt-lib">
      <Boundary
        fallback={(e) => (
          <div className="h-card mt-card">
            <p>{e.message}</p>
          </div>
        )}
      >
        <Suspense fallback={<Wait />}>
          <Library />
        </Suspense>
      </Boundary>
    </div>
  );
}
