// Meetings > Notes (/meet/notes/?m=<id>): one meeting's notes: summary, decisions, action items, the recording in Drive, chapters, what was
// asked, the privacy tools and the searchable transcript. Port of src/pages/meet/notes.astro and public/js/meet/notes.js: the same markup,
// stylesheets and calls. The recording player is ./Player.tsx. Dates in the browser's zone draw once the page is live.
import { Fragment, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/meet.css';
import '@hub/styles/qa2-meet.css';
import '@hub/styles/crit-meet.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/meet-auto.css';
import '@hub/styles/break-ui.css';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../../partners/record/Boundary';
import { Avatar, ConfirmHost, Day, Icon, MeetToast, Time, Wait, confirmCard, copyText, fmtDay, meetApi, pump, toast, useCrumb, useHydrated } from '../ui';
import { notesQuery } from '../queries';
import { Player } from './Player';

// 75 minutes in reads 1:15:03.
const stamp = (t: number) => {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
};
const secs = (v: string) => {
  const p = String(v || '').trim().split(':').map((x) => Number(x));
  if (!p.length || p.some((x) => !Number.isFinite(x) || x < 0)) return NaN;
  return p.reduce((a, x) => a * 60 + x, 0);
};
const span = (from: number, to: number | null | undefined) => `${stamp(from)} to ${to == null ? 'the end' : stamp(to)}`;
const PSTATE: Record<string, string> = { proposed: 'Waiting for you', sending: 'Logging', logged: 'Logged', failed: 'Did not go through' };

export type NotesData = Record<string, any>;

/** The match is found in the words as spoken, so a search for "amp" never lands inside an entity. */
function Hi({ t, q }: { t: string; q: string }) {
  if (!q) return <>{t}</>;
  const rx = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
  return (
    <>
      {String(t == null ? '' : t)
        .split(rx)
        .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}
const Ts = ({ t, jump }: { t: number; jump: (t: number) => void }) => (
  <a
    className="nt-ts"
    href={`#t=${t}`}
    data-t={t}
    onClick={(e) => {
      e.preventDefault();
      jump(t);
    }}
  >
    {stamp(t)}
  </a>
);

function Notes({ mid }: { mid: string }) {
  const qc = useQueryClient();
  const hydrated = useHydrated();
  const key = ['meet', 'notes', mid];
  const { data: d0 } = useSuspenseQuery(notesQuery(mid));
  const data = d0 as NotesData;
  const m = data.meeting;
  const n = data.notes || {};
  const reload = async () => {
    const r = await meetApi<NotesData>('meetings/' + mid + '/notes');
    qc.setQueryData(key, r);
    return r;
  };
  const patch = (fn: (d: NotesData) => NotesData) => qc.setQueryData(key, (old: NotesData | undefined) => (old ? fn(old) : old));

  const [q, setQ] = useState('');
  const [ask, setAsk] = useState<{ q: string; busy: boolean; answer: any }>({ q: '', busy: false, answer: null });
  const [pt, setPt] = useState({ busy: '', find: '', hits: [] as any[], err: '' });
  const [pv, setPv] = useState({ open: false, mode: 'remove', rows: [{ from: '', to: '' }], cur: 0, rec: 'trim', busy: false, err: '' });
  const [sp, setSp] = useState({ open: false, a: -1, b: -1, who: '', busy: false, err: '' });
  const [prog, setProg] = useState('');
  const [trimProg, setTrimProg] = useState('');
  const [playerRev, setPlayerRev] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const pumped = useRef(false);
  const dayS = (iso: string) => (hydrated && iso ? fmtDay(iso) : '');

  useCrumb('Meetings', String(m.title || '').trim() || 'Meeting');
  useEffect(() => {
    document.title = m.title + ' - FavorOS';
  }, [m.title]);

  // A finished meeting whose notes or recording are still being made is driven to the end from this page (once per visit).
  useEffect(() => {
    if (pumped.current) return;
    if (m.status === 'ended' && (m.notesStatus === 'pending' || m.recState === 'uploading' || m.recState === 'trimming')) {
      pumped.current = true;
      void (async () => {
        await pump(mid, (st) => setProg(st));
        try {
          await reload();
        } catch {
          // the page keeps what it has
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.status, m.notesStatus, m.recState]);

  const jump = (t: number) => {
    const el = document.getElementById('t' + t) || (Array.from(document.querySelectorAll('.nt-l')).find((x) => x.id && Number(x.id.slice(1)) >= t) as HTMLElement | undefined);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.style.background = 'var(--h-leaf-soft)';
      setTimeout(() => (el.style.background = ''), 1800);
    }
  };

  const pending = m.notesStatus === 'pending' || m.recState === 'uploading' || m.status === 'live';
  const failed = m.notesStatus === 'failed';
  const ppl: any[] = data.people || [];
  const files: any[] = data.files || [];
  const mins = m.startedAt && m.endedAt ? Math.max(1, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60000)) : 0;
  const transcript: any[] = data.transcript || [];
  const hasTr = transcript.length > 0;
  const priv = data.privacy;

  /* ------------------------------------------------ transcript lines */
  const marks = q
    ? []
    : [
        ...((priv || {}).paused || []).map((r: any) => ({ t: r.from, mark: `Recording paused, nothing recorded (${span(r.from, r.to)})` })),
        ...((priv || {}).cuts || []).filter((c: any) => c.kind === 'cut').map((c: any) => ({ t: c.from, mark: `Part removed (${span(c.from, c.to)})` })),
      ];
  const qq = sp.open ? '' : q;
  const lines: any[] = [
    ...transcript.map((l, i) => ({ ...l, i })).filter((l) => !qq || ((l.who || '') + ' ' + l.text).toLowerCase().includes(qq.toLowerCase())),
    ...(sp.open ? [] : marks),
  ].sort((a, b) => a.t - b.t || (a.mark ? -1 : 1) || (a.i || 0) - (b.i || 0));
  const canFix = !!(priv && priv.canEdit) && hasTr;
  const sel = (i: number) => sp.open && sp.a >= 0 && i >= Math.min(sp.a, sp.b) && i <= Math.max(sp.a, sp.b);

  /* ------------------------------------------------ header actions */
  const transcriptText = () => {
    const head = `${m.title}\n${m.startedAt ? fmtDay(m.startedAt) + ' ' + new Date(m.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}\n\n`;
    return head + transcript.map((l) => `[${stamp(l.t)}] ${l.who ? l.who + ': ' : ''}${l.text}`).join('\n') + '\n';
  };
  const download = () => {
    if (!transcript.length) return toast('This meeting has no transcript');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([transcriptText()], { type: 'text/plain' }));
    a.download = (m.title || 'meeting').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80) + ' transcript.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const emailItem = () => {
    const li = (t: string) => `<li>${esc(t)}</li>`;
    const html =
      (m.summary ? `<p>${esc(m.summary)}</p>` : '') +
      ((n.decisions || []).length ? `<p><b>Decisions</b></p><ul>${n.decisions.map((x: any) => li(x.text)).join('')}</ul>` : '') +
      ((data.actions || []).length
        ? `<p><b>Action items</b></p><ul>${data.actions
            .map((a: any) => li(a.text + (String(a.owner_name || '').trim() ? ' (' + String(a.owner_name).trim() + (a.due ? ', due ' + a.due : '') + ')' : a.due ? ' (due ' + a.due + ')' : '')))
            .join('')}</ul>`
        : '');
    const to = ppl.filter((p) => p.email && !p.me).map((p) => ({ email: p.email, name: p.name || '' }));
    return {
      kind: 'meeting',
      title: (String(m.title || '').trim() || 'Meeting') + (m.startedAt ? ', ' + fmtDay(m.startedAt) : ''),
      html,
      url: location.origin + '/meet/notes/?m=' + encodeURIComponent(mid),
      to,
      subject: 'Notes: ' + (String(m.title || '').trim() || 'Meeting'),
    };
  };
  const compose = hydrated ? (window as unknown as { FavorCompose?: { add: (i: unknown, o: unknown) => void; dragStart?: (e: unknown, i: unknown) => void } }).FavorCompose : undefined;
  const canEmail = !!compose && hydrated && document.documentElement.classList.contains('has-mail') && !pending;

  /* ------------------------------------------------ partners */
  const partnerClick = async (act: string, cid: string, name?: string) => {
    let busy = '';
    setPt((p) => ({ ...p, err: '' }));
    try {
      if (act === 'find') {
        const typed = (document.getElementById('ptq') as HTMLInputElement | null)?.value || '';
        const hits = typed.trim().length < 2 ? [] : ((await meetApi<{ hits?: any[] }>('meetings/' + mid + '/partners?q=' + encodeURIComponent(typed.trim()))).hits || []);
        setPt((p) => ({ ...p, find: typed, hits }));
        return;
      } else if (act === 'add') {
        const r = await meetApi<{ partners: any[] }>('meetings/' + mid + '/partners', { method: 'POST', body: { action: 'add', cid, name } });
        patch((d) => ({ ...d, partners: r.partners }));
        setPt((p) => ({ ...p, hits: [], find: '' }));
      } else if (act === 'dismiss') {
        const r = await meetApi<{ partners: any[] }>('meetings/' + mid + '/partners', { method: 'POST', body: { action: 'dismiss', cid } });
        patch((d) => ({ ...d, partners: r.partners }));
      } else if (act === 'log') {
        const row = (data.partners || []).find((p: any) => p.cid === cid);
        if (!(await confirmCard({ title: 'Log this meeting in Blackbaud?', body: `One completed Meeting action goes on ${row ? row.name : 'the partner'}'s record, dated ${fmtDay(m.startedAt)}. Nobody is emailed.`, ok: 'Log in Blackbaud' }))) return;
        busy = cid;
        setPt((p) => ({ ...p, busy: cid }));
        const r = await meetApi<{ partners: any[] }>('meetings/' + mid + '/partners', { method: 'POST', body: { action: 'log', cid, confirm: true } });
        patch((d) => ({ ...d, partners: r.partners }));
        toast('Logged on the record');
      }
    } catch (e) {
      setPt((p) => ({ ...p, err: (e as Error).message }));
      try {
        const r = await meetApi<NotesData>('meetings/' + mid + '/notes');
        patch((d) => ({ ...d, partners: r.partners }));
      } catch {
        // keep the list
      }
    }
    void busy;
    setPt((p) => ({ ...p, busy: '' }));
  };

  /* ------------------------------------------------ privacy */
  const privacyClick = async (act: string, i?: number) => {
    const p = priv || {};
    setPv((s) => ({ ...s, err: '' }));
    if (act === 'open') return setPv((s) => ({ ...s, err: '', open: true, mode: 'remove', rows: [{ from: '', to: '' }], cur: 0, rec: 'trim' }));
    if (act === 'cancel') return setPv((s) => ({ ...s, open: false }));
    if (act === 'sug')
      return setPv((s) => ({ ...s, err: '', open: true, mode: 'remove', rows: [{ from: stamp(p.suggestion.from), to: p.suggestion.to == null ? '' : stamp(p.suggestion.to) }], cur: 0, rec: 'trim' }));
    if (act === 'addrow') return setPv((s) => ({ ...s, err: '', rows: [...s.rows, { from: '', to: '' }], cur: s.rows.length }));
    if (act === 'droprow') return setPv((s) => ({ ...s, err: '', rows: s.rows.filter((_, x) => x !== i), cur: Math.min(s.cur, s.rows.length - 2) }));
    if (act === 'delrec') {
      if (!(await confirmCard({ title: 'Delete the recording?', body: 'The recording leaves FavorOS and Google Drive. The transcript and notes stay. This cannot be undone.', ok: 'Delete the recording', danger: true }))) return;
      setPv((s) => ({ ...s, busy: true }));
      try {
        await meetApi('meetings/' + mid + '/privacy', { method: 'POST', body: { op: 'delete-recording' } });
        setPlayerRev((x) => x + 1);
        await reload();
        toast('Recording deleted');
      } catch (e) {
        toast((e as Error).message);
      }
      setPv((s) => ({ ...s, busy: false }));
      return;
    }
    if (act === 'cut') {
      const keep = pv.mode === 'keep';
      const typed = (keep ? pv.rows.slice(0, 1) : pv.rows).map((r) => ({ from: secs(r.from), to: String(r.to).trim() ? secs(r.to) : null })).filter((r, x) => x === 0 || Number.isFinite(r.from));
      for (const r of typed) {
        if (!Number.isFinite(r.from)) return setPv((s) => ({ ...s, err: 'Type the start as minutes and seconds, like 53:37.' }));
        if (r.to != null && (!Number.isFinite(r.to) || r.to <= r.from)) return setPv((s) => ({ ...s, err: 'The end has to come after the start.' }));
      }
      // Keep only one part: what comes before it and after it are the parts removed.
      const ranges = keep ? [...(typed[0].from > 0 ? [{ from: 0, to: typed[0].from }] : []), ...(typed[0].to != null ? [{ from: typed[0].to, to: null }] : [])] : typed;
      if (!ranges.length) return setPv((s) => ({ ...s, err: 'That keeps the whole meeting. Pick where the part starts or ends.' }));
      const rec = files.length ? pv.rec : 'keep';
      const what = keep ? `Keep only ${span(typed[0].from, typed[0].to)}?` : ranges.length > 1 ? `Remove ${ranges.length} parts?` : `Remove ${span(ranges[0].from, ranges[0].to)}?`;
      const recText = rec === 'trim' ? ' The recording in Drive is made again without it, and the old file goes to the Drive trash.' : rec === 'delete' ? ' The recording is deleted.' : '';
      if (
        !(await confirmCard({
          title: what,
          body: `What was said and typed ${keep ? 'outside that part' : 'in ' + (ranges.length > 1 ? 'those parts' : 'that part')} leaves the transcript, the action items from it and their tasks go, the summary and Chat post are written again, and the Google Doc is replaced.${recText} This cannot be undone.`,
          ok: keep ? 'Keep only this part' : 'Remove',
          danger: true,
        }))
      )
        return;
      setPv((s) => ({ ...s, busy: true }));
      try {
        const r = await meetApi<{ recording?: string }>('meetings/' + mid + '/privacy', { method: 'POST', body: { op: 'cut', ranges, recording: rec } });
        if (rec === 'delete') setPlayerRev((x) => x + 1);
        await reload();
        setPv((s) => ({ ...s, open: false, busy: false }));
        if (r.recording === 'trimming') {
          toast('Removed from the notes. Cutting the recording now.');
          await pump(mid, (st) => st && setTrimProg(st));
          setPlayerRev((x) => x + 1);
          const nd = await reload();
          toast(nd.privacy && nd.privacy.trim && nd.privacy.trim.failed ? 'The recording could not be cut' : 'The recording is cut');
        } else toast('Removed');
        return;
      } catch (e) {
        setPv((s) => ({ ...s, err: (e as Error).message }));
      }
      setPv((s) => ({ ...s, busy: false }));
    }
  };

  /* ------------------------------------------------ speaker */
  const speakerNames = () => {
    const out = new Map<string, string>();
    const add = (nm: string) => {
      const v = String(nm || '').trim();
      if (v && !/ or /.test(v) && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), v);
    };
    ppl.forEach((p) => add(p.name));
    transcript.forEach((l) => add(l.who));
    (data.actions || []).forEach((a: any) => add(a.owner_name));
    return [...out.values()].sort((a, b) => a.localeCompare(b));
  };
  const speakerClick = async (act: string) => {
    if (act === 'open') {
      setSp({ open: true, a: -1, b: -1, who: '', busy: false, err: '' });
      setTimeout(() => document.getElementById('sp-bar')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
      return;
    }
    if (act === 'cancel') return setSp((s) => ({ ...s, open: false }));
    if (act !== 'save' || sp.busy) return;
    const who = ((document.getElementById('sp-who') as HTMLInputElement | null)?.value || sp.who).trim();
    if (!who) return setSp((s) => ({ ...s, who, err: 'Type or pick who was speaking.' }));
    const i0 = Math.min(sp.a, sp.b);
    const i1 = Math.max(sp.a, sp.b);
    setSp((s) => ({ ...s, who, busy: true, err: '' }));
    try {
      const r = await meetApi<{ rewritten?: boolean }>('meetings/' + mid + '/privacy', { method: 'POST', body: { op: 'speaker', i0, i1, t0: transcript[i0].t, t1: transcript[i1].t, who } });
      await reload();
      setSp((s) => ({ ...s, open: false }));
      toast(r.rewritten ? 'Speaker changed. The notes were written again.' : 'Speaker changed. The notes could not be written again yet.');
    } catch (e) {
      setSp((s) => ({ ...s, err: (e as Error).message }));
    }
    setSp((s) => ({ ...s, busy: false }));
  };
  const pickLine = (i: number) => setSp((s) => ({ ...s, err: '', ...(s.a < 0 || s.a !== s.b ? { a: i, b: i } : { b: i }) }));

  /* ------------------------------------------------ ask */
  const goAsk = async () => {
    const v = ask.q.trim();
    if (!v || ask.busy) return;
    setAsk({ q: v, busy: true, answer: null });
    let answer: any = null;
    try {
      answer = await meetApi('meetings/' + mid + '/ask', { method: 'POST', body: { q: v } });
    } catch (e) {
      toast((e as Error).message);
    }
    setAsk({ q: v, busy: false, answer });
  };

  /* ------------------------------------------------ render */
  const head = (
    <div className="nt-head">
      <div>
        <div className="h-label" style={{ marginBottom: 6 }}>
          Meeting notes
        </div>
        <h2>{String(m.title || '').trim() || 'Meeting'}</h2>
        <div className="nt-meta">
          <span>
            <Icon n="cal" />
            {m.startedAt ? <Day iso={m.startedAt} /> : null}
          </span>
          {m.startedAt && m.endedAt ? (
            <span>
              <Icon n="clock" />
              <Time iso={m.startedAt} /> to <Time iso={m.endedAt} />
              {mins ? ' (' + mins + ' min)' : ''}
            </span>
          ) : null}
          <span>
            <Icon n="users" />
            {ppl.length} {ppl.length === 1 ? 'person' : 'people'}
          </span>
          <span className="mt-avs">
            {ppl.slice(0, 6).map((p, i) => (
              <Avatar key={i} name={p.name} />
            ))}
            {ppl.length > 6 ? (
              <span className="mt-av mt-av--more" title={ppl.slice(6).map((p) => p.name || p.email).join(', ')}>
                +{(ppl.length - 6).toLocaleString('en-US')}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="h-btn h-btn--ghost h-btn--sm" id="nt-dl" onClick={download}>
          <Icon n="download" />
          Transcript
        </button>
        <button className="h-btn h-btn--ghost h-btn--sm" id="nt-copy" onClick={() => void copyText(location.href)}>
          <Icon n="share" />
          Share
        </button>
        {canEmail ? (
          <button
            className="h-btn h-btn--ghost h-btn--sm"
            id="nt-email"
            draggable
            title="Email the summary, decisions and action items (or drag this into an email)"
            onClick={(e) => compose?.add(emailItem(), { anchor: e.currentTarget, from: e.currentTarget })}
            onDragStart={(e) => {
              const it = emailItem();
              if (compose?.dragStart) compose.dragStart(e.nativeEvent, it);
              else e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(it));
              e.dataTransfer.setData('text/uri-list', it.url);
              e.dataTransfer.setData('text/plain', it.url);
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <Icon n="send" />
            Send to email
          </button>
        ) : null}
        <NavLink className="h-btn h-btn--primary h-btn--sm" href={`/meet/book/?follow=${encodeURIComponent(mid)}`}>
          <Icon n="plus" />
          Book the follow-up
        </NavLink>
      </div>
    </div>
  );

  const partnersList: any[] = data.partners || [];
  const showPartners = partnersList.length || (m.mine && m.status === 'ended');

  return (
    <>
      {head}
      {pending ? (
        <div className="mt-note mt-note--gold" style={{ marginBottom: 14 }}>
          <b>{m.status === 'live' ? 'The meeting is still going.' : 'The notes are being made.'}</b>{' '}
          <span id="nt-prog">{prog || (m.recState === 'uploading' ? 'Saving the recording to Google Drive.' : 'Reading the recording.')}</span>
        </div>
      ) : null}
      {failed ? (
        <div className="mt-note mt-note--gold" style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            <b>The notes failed.</b> The recording is safe in Google Drive.
          </span>
          <button
            className="h-btn h-btn--primary h-btn--sm"
            id="nt-retry"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await meetApi('meetings/' + mid + '/pump', { method: 'POST', body: { retry: true } });
                await reload();
                await pump(mid, (st) => setProg(st));
                await reload();
              } catch (e) {
                toast((e as Error).message);
              }
              setRetrying(false);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      <div className="mt-grid">
        <div className="mt-stack">
          <section className="h-card mt-card">
            <div className="h-label" style={{ marginBottom: 8 }}>
              Summary
            </div>
            {!m.summary && pending && m.status !== 'live' ? (
              <p className="nt-sum nt-wait" role="status">
                <span className="nt-spin" aria-hidden="true" />
                Writing the summary
              </p>
            ) : (
              <p className="nt-sum">{m.summary || (pending ? 'The meeting is still going.' : failed ? 'No summary yet.' : 'No summary.')}</p>
            )}
          </section>
          {(n.decisions || []).length ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 10 }}>
                Decisions
              </div>
              <ul className="nt-list">
                {n.decisions.map((x: any, i: number) => (
                  <li key={i}>
                    <span className="b">
                      <Icon n="check" />
                    </span>
                    <span>
                      {x.text} <Ts t={x.t} jump={jump} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {(data.actions || []).length ? (
            <section className="h-card mt-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div className="h-label">Action items</div>
                <span className="mt-sub">
                  {data.actions.filter((a: any) => a.done).length} of {data.actions.length} done
                </span>
              </div>
              {data.actions.map((a: any) => (
                <label className={'act' + (a.done ? ' is-done' : '')} key={a.idx}>
                  <input
                    type="checkbox"
                    data-idx={a.idx}
                    checked={!!a.done}
                    onChange={async (e) => {
                      const c = e.currentTarget;
                      const done = c.checked;
                      try {
                        await meetApi('meetings/' + mid + '/action', { method: 'POST', body: { idx: Number(a.idx), done } });
                        patch((d) => ({ ...d, actions: d.actions.map((x: any) => (x.idx === Number(a.idx) ? { ...x, done: done ? 1 : 0 } : x)) }));
                      } catch (er) {
                        toast((er as Error).message);
                      }
                    }}
                  />
                  <div>
                    <b>{a.text}</b>
                    <span>
                      {String(a.owner_name || '').trim() ? (
                        <span data-entity={`person:${String(a.owner_name).trim()}`} data-label={String(a.owner_name).trim()}>
                          {String(a.owner_name).trim()}
                        </span>
                      ) : (
                        'No owner named'
                      )}
                      {a.due ? ' · due ' + a.due : ''}
                      {a.t ? (
                        <>
                          {' · '}
                          <Ts t={a.t} jump={jump} />
                        </>
                      ) : null}
                    </span>
                  </div>
                  <span className={'mt-pill ' + (a.done ? 'mt-pill--ok' : '')}>{a.done ? 'Done' : 'Open'}</span>
                </label>
              ))}
              <p className="mt-sub" style={{ margin: '8px 0 0' }}>
                Each person sees their items on Today in FavorOS.
              </p>
            </section>
          ) : null}
          <section className="h-card mt-card">
            <div className="nt-trh">
              <div className="h-label">Transcript</div>
              {canFix && !sp.open ? (
                <button className="h-btn h-btn--ghost h-btn--sm" data-sp="open" onClick={() => void speakerClick('open')}>
                  <Icon n="users" />
                  Fix who spoke
                </button>
              ) : null}
            </div>
            {sp.open ? (
              <SpeakerBar sp={sp} setSp={setSp} tr={transcript} names={speakerNames()} onClick={speakerClick} />
            ) : (
              <div className="nt-search">
                <Icon n="search" />
                <input id="trq" aria-label="Search the transcript" placeholder="Search what was said" value={q} onChange={(e) => setQ(e.target.value.trim())} />
              </div>
            )}
            <div className="nt-tr">
              {lines.length ? (
                lines.map((l, k) =>
                  l.mark ? (
                    <div className="nt-l nt-mark" key={'m' + k}>
                      <time>{stamp(l.t)}</time>
                      <div>{l.mark}</div>
                    </div>
                  ) : (
                    <div
                      className={'nt-l' + (sp.open ? ' sp-on' : '') + (sel(l.i) ? ' is-sel' : '')}
                      id={'t' + l.t}
                      key={'l' + l.i}
                      {...(sp.open
                        ? {
                            'data-li': l.i,
                            role: 'button',
                            tabIndex: 0,
                            'aria-pressed': sel(l.i),
                            onClick: () => pickLine(l.i),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                pickLine(l.i);
                              }
                            },
                          }
                        : {})}
                    >
                      <time
                        {...(pv.open
                          ? {
                              className: 'pv-pick',
                              'data-pick': l.t,
                              role: 'button',
                              tabIndex: 0,
                              title: 'Use this time',
                              onClick: () => pickTime(l.t),
                              onKeyDown: (e: React.KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  pickTime(l.t);
                                }
                              },
                            }
                          : {})}
                      >
                        {stamp(l.t)}
                      </time>
                      <div>
                        {l.who ? (
                          <>
                            <b>
                              <Hi t={l.who} q={q} />
                            </b>{' '}
                          </>
                        ) : null}
                        <Hi t={l.text} q={q} />
                      </div>
                    </div>
                  )
                )
              ) : (
                <p className="mt-sub">{hasTr ? 'Nothing matches.' : pending ? 'The transcript is on its way.' : 'No transcript. Nobody spoke, or this meeting was not recorded.'}</p>
              )}
            </div>
          </section>
        </div>
        <div className="mt-stack">
          {files.length || data.doc ? (
            <section className="h-card mt-card" style={{ display: 'grid', gap: 12 }}>
              {files.map((f, i) => (
                <Player key={f.src + ':' + playerRev} src={f.src} kind={f.kind} label={files.length > 1 ? 'part ' + (i + 1) : ''} mins={mins} />
              ))}
              {files.map((f, i) => (
                <div className="drive" key={'d' + i}>
                  <Icon n="drive" />
                  <div>
                    <b>{files.length > 1 ? f.name : 'Saved in Google Drive'}</b>
                    <span>{files.length > 1 ? 'Google Drive' : f.name}</span>
                  </div>
                  <a className="h-btn h-btn--ghost h-btn--sm" href={f.url} target="_blank" rel="noopener">
                    Open
                  </a>
                </div>
              ))}
              {data.doc ? (
                <div className="drive">
                  <Icon n="doc" />
                  <div>
                    <b>Notes in Google Docs</b>
                    <span>Google Docs</span>
                  </div>
                  <a className="h-btn h-btn--ghost h-btn--sm" href={data.doc.url} target="_blank" rel="noopener">
                    Open
                  </a>
                </div>
              ) : null}
              {files.length ? (
                <p className="mt-sub" style={{ margin: 0 }}>
                  Meetings in US Team Files{files.length > 1 ? ', ' + files.length + ' parts' : ''}
                </p>
              ) : null}
            </section>
          ) : null}
          {priv ? privacyCard() : null}
          {showPartners ? partnersCard() : null}
          {(n.chapters || []).length ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 6 }}>
                Chapters
              </div>
              {n.chapters.map((c: any, i: number) => (
                <a
                  className="chap"
                  href={`#t=${c.t}`}
                  data-t={c.t}
                  key={i}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  onClick={(e) => {
                    e.preventDefault();
                    jump(c.t);
                  }}
                >
                  <em>{stamp(c.t)}</em>
                  <span>{c.title}</span>
                </a>
              ))}
            </section>
          ) : null}
          {(data.asked || []).length ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                Asked during the meeting
              </div>
              <div className="ans">
                <ul>
                  {data.asked.map((a: any, i: number) => (
                    <li key={i}>
                      <Ts t={a.t} jump={jump} />
                      <span>
                        {a.by ? a.by + ' asked ' : ''}&quot;{a.q}&quot;
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
          {hasTr ? (
            <section className="h-card mt-card">
              <div className="h-label" style={{ marginBottom: 8 }}>
                Ask about this meeting
              </div>
              <div className="rm-input" style={{ border: 0, padding: 0 }}>
                <input
                  id="nt-ask"
                  aria-label="Ask about this meeting"
                  placeholder="Who owns the print file?"
                  maxLength={300}
                  value={ask.q}
                  disabled={ask.busy}
                  onChange={(e) => setAsk((s) => ({ ...s, q: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void goAsk();
                    }
                  }}
                />
                <button className="icb send" id="nt-ask-go" aria-label="Ask" disabled={ask.busy} onClick={() => void goAsk()}>
                  <Icon n="send" />
                </button>
              </div>
              {ask.busy ? (
                <p className="mt-sub" style={{ margin: '8px 0 0' }}>
                  Reading the transcript.
                </p>
              ) : ask.answer ? (
                <div className="ans" style={{ marginTop: 8 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 14 }}>{ask.answer.answer}</p>
                  {ask.answer.points.length ? (
                    <ul>
                      {ask.answer.points.map((p: any, i: number) => (
                        <li key={i}>
                          <Ts t={p.t} jump={jump} />
                          <span>{p.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );

  /* The time a tap on the transcript fills into the open privacy form. */
  function pickTime(t: number) {
    if (!pv.open) return;
    setPv((s) => {
      const rows = s.rows.map((r) => ({ ...r }));
      const r = rows[s.cur] || rows[0];
      const v = stamp(t);
      if (!r.from || r.to) {
        r.from = v;
        r.to = '';
      } else r.to = v;
      return { ...s, rows };
    });
    setTimeout(() => document.getElementById('privacy')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  }

  function partnersCard() {
    const list = partnersList;
    return (
      <section className="h-card mt-card" id="partners">
        <div className="h-label" style={{ marginBottom: 4 }}>
          Log on a partner record
        </div>
        <p className="mt-sub" style={{ margin: '0 0 6px' }}>
          {list.some((p) => p.state === 'proposed' || p.state === 'failed')
            ? 'A partner was on the invite. Logging adds one completed Meeting action to their record in Blackbaud, with the date, who was there, the summary, decisions and follow-ups.'
            : 'Add a partner this meeting should be logged on. Nothing goes to Blackbaud until you press Log in Blackbaud.'}
        </p>
        {list.map((p) => (
          <div className="pt-row" key={p.cid}>
            <div>
              <b>
                <NavLink href={p.url}>{p.name || 'Partner ' + p.cid}</NavLink>
              </b>
              <span>
                {PSTATE[p.state] || p.state}
                {p.state === 'logged' ? (p.detail ? ', ' + p.detail : '') : p.detail ? ': ' + p.detail : ''}
                {p.confirmedBy && p.state === 'logged' ? ' by ' + p.confirmedBy : ''}
              </span>
            </div>
            <div className="pt-acts">
              {p.state === 'logged' || p.state === 'sending' ? null : (
                <>
                  <button className="h-btn h-btn--primary h-btn--sm" data-pt="log" data-cid={p.cid} disabled={!!pt.busy} onClick={() => void partnerClick('log', p.cid)}>
                    {pt.busy === p.cid ? 'Logging' : 'Log in Blackbaud'}
                  </button>
                  <button className="h-btn h-btn--ghost h-btn--sm" data-pt="dismiss" data-cid={p.cid} disabled={!!pt.busy} onClick={() => void partnerClick('dismiss', p.cid)}>
                    Not a partner meeting
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {pt.err ? (
          <p className="mt-sub" style={{ color: '#8a3f24', margin: '6px 0 0' }}>
            {pt.err}
          </p>
        ) : null}
        <div className="pt-find">
          <input id="ptq" placeholder="Find a partner by name, email or phone" defaultValue={pt.find} aria-label="Find a partner" />
          <button className="h-btn h-btn--ghost h-btn--sm" data-pt="find" onClick={() => void partnerClick('find', '')}>
            Find
          </button>
        </div>
        {pt.hits.map((h) => (
          <div className="pt-row" key={h.id}>
            <div>
              <b>{h.name}</b>
              <span>{h.place}</span>
            </div>
            <div className="pt-acts">
              <button className="h-btn h-btn--ghost h-btn--sm" data-pt="add" data-cid={h.id} data-name={h.name} onClick={() => void partnerClick('add', h.id, h.name)}>
                Add
              </button>
            </div>
          </div>
        ))}
      </section>
    );
  }

  function privacyCard() {
    const p = priv;
    const show = p.canEdit || (p.paused || []).length || (p.cuts || []).length;
    if (!show) return null;
    const hist = [
      ...(p.paused || []).map((r: any) => ({ t: r.from, text: `Recording paused ${span(r.from, r.to)}. Nothing was recorded.` })),
      ...(p.cuts || []).map((c: any) => ({ t: c.kind === 'cut' ? c.from : 1e9, text: c.kind === 'cut' ? `Removed ${span(c.from, c.to)} on ${dayS(c.at)}.` : `Recording deleted on ${dayS(c.at)}.` })),
    ].sort((a, b) => a.t - b.t);
    const trimming = p.trim && p.trim.running;
    const keep = pv.mode === 'keep';
    const rows = keep ? pv.rows.slice(0, 1) : pv.rows;
    const setRow = (i: number, k: 'from' | 'to', v: string) => setPv((s) => ({ ...s, rows: s.rows.map((r, x) => (x === i ? { ...r, [k]: v } : r)) }));
    return (
      <section className="h-card mt-card" id="privacy">
        <div className="h-label" style={{ marginBottom: 6 }}>
          Privacy
        </div>
        {hist.length ? (
          <ul className="pv-hist">
            {hist.map((x, i) => (
              <li key={i}>{x.text}</li>
            ))}
          </ul>
        ) : p.canEdit ? (
          <p className="mt-sub" style={{ margin: '0 0 8px' }}>
            Remove a private part, such as prayer requests, or keep only the part you need. The recording, transcript, summary, action items, their tasks, the Chat post, the Google Doc and Favor Brain all follow.
          </p>
        ) : null}
        {trimming ? (
          <p className="mt-sub pv-status" role="status">
            {trimProg || 'Cutting the recording in Drive. It plays as it was until the new file is ready.'}
          </p>
        ) : p.trim && p.trim.failed ? (
          <p className="mt-sub pv-warn">The recording could not be cut. The notes are cut. Remove the same part again to try the recording again, or delete the recording.</p>
        ) : null}
        {p.canEdit && p.suggestion && !pv.open ? (
          <div className="pv-sug">
            <div>
              <b>
                {p.suggestion.label} start at {stamp(p.suggestion.from)}.
              </b>
              <span>Remove that part from the recording, transcript, notes and Doc?</span>
            </div>
            <button className="h-btn h-btn--ghost h-btn--sm" data-pv="sug" onClick={() => void privacyClick('sug')}>
              Remove {span(p.suggestion.from, p.suggestion.to)}
            </button>
          </div>
        ) : null}
        {pv.open ? (
          <div className="pv-form">
            <div className="pv-mode" role="radiogroup" aria-label="What to do">
              <label>
                <input type="radio" name="pv-mode" value="remove" checked={!keep} onChange={() => setPv((s) => ({ ...s, mode: 'remove', cur: 0 }))} /> Remove parts
              </label>
              <label>
                <input type="radio" name="pv-mode" value="keep" checked={keep} onChange={() => setPv((s) => ({ ...s, mode: 'keep', cur: 0 }))} /> Keep only one part
              </label>
            </div>
            {rows.map((r, i) => (
              <div className={'pv-row' + (pv.cur === i ? ' is-cur' : '')} data-row={i} key={i}>
                <label>
                  {keep ? 'Keep from' : 'From'}
                  <input
                    className="pv-from"
                    data-i={i}
                    inputMode="numeric"
                    placeholder="53:37"
                    value={r.from}
                    aria-label={(keep ? 'Keep from' : 'From') + ', minutes and seconds'}
                    onChange={(e) => setRow(i, 'from', e.target.value)}
                    onFocus={() => setPv((s) => ({ ...s, cur: i }))}
                  />
                </label>
                <label>
                  To
                  <input
                    className="pv-to"
                    data-i={i}
                    inputMode="numeric"
                    placeholder="The end"
                    value={r.to}
                    aria-label="To, minutes and seconds, empty for the end"
                    onChange={(e) => setRow(i, 'to', e.target.value)}
                    onFocus={() => setPv((s) => ({ ...s, cur: i }))}
                  />
                </label>
                {!keep && pv.rows.length > 1 ? (
                  <button className="icb" data-pv="droprow" data-i={i} aria-label="Take this part off the list" onClick={() => void privacyClick('droprow', i)}>
                    <Icon n="x" />
                  </button>
                ) : null}
              </div>
            ))}
            {keep ? null : (
              <button className="h-btn h-btn--ghost h-btn--sm" data-pv="addrow" disabled={pv.rows.length >= 10} onClick={() => void privacyClick('addrow')}>
                Add another part
              </button>
            )}
            <p className="mt-sub">{keep ? 'Everything before and after this part is removed.' : 'Tap a time in the transcript to fill these in. Leave To empty to remove everything to the end.'}</p>
            {files.length ? (
              <>
                <div className="pv-mode" role="radiogroup" aria-label="The recording">
                  <label>
                    <input type="radio" name="pv-rec" value="trim" checked={pv.rec === 'trim'} onChange={() => setPv((s) => ({ ...s, rec: 'trim' }))} /> Cut {keep ? 'the rest' : 'these parts'} from the recording too
                  </label>
                  <label>
                    <input type="radio" name="pv-rec" value="delete" checked={pv.rec === 'delete'} onChange={() => setPv((s) => ({ ...s, rec: 'delete' }))} /> Delete the whole recording
                  </label>
                </div>
                {pv.rec === 'trim' ? <p className="mt-sub">The recording in Drive is made again without them and the old file goes to the Drive trash. A video cut ends on the next full picture, so up to two more seconds can go.</p> : null}
              </>
            ) : null}
            {pv.err ? <p className="mt-sub pv-warn">{pv.err}</p> : null}
            <div className="pv-acts">
              <button className="h-btn h-btn--ghost h-btn--sm" data-pv="cancel" disabled={pv.busy} onClick={() => void privacyClick('cancel')}>
                Cancel
              </button>
              <button className="h-btn h-btn--danger h-btn--sm" data-pv="cut" disabled={pv.busy || !!trimming} onClick={() => void privacyClick('cut')}>
                {pv.busy ? 'Removing' : keep ? 'Keep only this part' : pv.rows.length > 1 ? 'Remove these parts' : 'Remove this part'}
              </button>
            </div>
          </div>
        ) : null}
        {p.canEdit && !pv.open ? (
          <div className="pv-acts">
            <button className="h-btn h-btn--ghost h-btn--sm" data-pv="open" disabled={!!trimming} onClick={() => void privacyClick('open')}>
              <Icon n="x" />
              Edit the recording and notes
            </button>
            {files.length ? (
              <button className="h-btn h-btn--ghost h-btn--sm" data-pv="delrec" disabled={pv.busy} onClick={() => void privacyClick('delrec')}>
                Delete the recording
              </button>
            ) : null}
          </div>
        ) : null}
        {(p.toTrash || []).length ? (
          <div className="pv-trash">
            <b>Emptied in Drive, waiting for the trash</b>
            <span>FavorOS cannot trash files in US Team Files. A content manager opens each one and moves it to the trash.</span>
            {p.toTrash.map((f: any, i: number) => (
              <a href={f.url} target="_blank" rel="noopener" key={i}>
                {f.kind === 'notes' ? 'Old notes Doc' : 'Old recording'}
              </a>
            ))}
          </div>
        ) : null}
      </section>
    );
  }
}

function SpeakerBar({ sp, setSp, tr, names, onClick }: { sp: { a: number; b: number; who: string; busy: boolean; err: string }; setSp: React.Dispatch<React.SetStateAction<any>>; tr: any[]; names: string[]; onClick: (a: string) => Promise<void> }) {
  const has = sp.a >= 0;
  const i0 = Math.min(sp.a, sp.b);
  const i1 = Math.max(sp.a, sp.b);
  const what = !has
    ? 'Tap the line that has the wrong name. Tap a second line to take every line between them.'
    : i0 === i1
      ? `One line at ${stamp(tr[i0].t)}${tr[i0].who ? ', now ' + tr[i0].who : ''}.`
      : `${i1 - i0 + 1} lines, ${stamp(tr[i0].t)} to ${stamp(tr[i1].t)}.`;
  return (
    <div className="sp-bar" id="sp-bar">
      <p>{what}</p>
      {has ? (
        <>
          <label className="sp-who">
            <span>Who was speaking</span>
            <input
              id="sp-who"
              list="sp-names"
              autoComplete="off"
              maxLength={80}
              placeholder="Type or pick a name"
              value={sp.who}
              onChange={(e) => setSp((s: any) => ({ ...s, who: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void onClick('save');
                }
              }}
            />
          </label>
          <datalist id="sp-names">
            {names.map((nm) => (
              <option value={nm} key={nm} />
            ))}
          </datalist>
        </>
      ) : null}
      {sp.err ? <p className="mt-sub pv-warn">{sp.err}</p> : null}
      <div className="pv-acts">
        <button className="h-btn h-btn--ghost h-btn--sm" data-sp="cancel" disabled={sp.busy} onClick={() => void onClick('cancel')}>
          Cancel
        </button>
        {has ? (
          <button className="h-btn h-btn--primary h-btn--sm" data-sp="save" disabled={sp.busy} onClick={() => void onClick('save')}>
            {sp.busy ? 'Writing the notes again' : 'Change the speaker'}
          </button>
        ) : null}
      </div>
      {has ? (
        <p className="mt-sub" style={{ margin: 0 }}>
          The summary, action items and their tasks are written again with the right names.
        </p>
      ) : null}
    </div>
  );
}

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function NotesPage({ m }: { m: string }) {
  return (
    <div id="mt-notes">
      <Boundary
        key={m}
        fallback={(e) => (
          <div className="h-card mt-card" style={{ maxWidth: 560 }}>
            <h2 className="mt-h2">Notes not available</h2>
            <p className="mt-sub" style={{ fontSize: 14 }}>
              {e.message}
            </p>
            <NavLink className="h-btn h-btn--primary" href="/meet/library/">
              All meeting notes
            </NavLink>
          </div>
        )}
      >
        <Suspense fallback={<Wait />}>
          <Notes mid={m} />
        </Suspense>
      </Boundary>
      <MeetToast />
      <ConfirmHost />
    </div>
  );
}
