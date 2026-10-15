// Feedback: everyone sees the notes they sent and the answers. The hub admin sees every note, marks each one, and writes the answer the
// sender reads here and by email. Same classes, calls and wording as the classic page (public/js/feedback-page.js).
import { Suspense, startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { queryOptions, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { navQuery } from '../../lib/queries';
import { hubGet } from '../../lib/hub';
import { SheetsButton, sheetScreen, useSheetSource } from '../partners/work/lists/legacy';
import '@hub/styles/crit-reportadmin.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
import '@hub/styles/today2.css'; // today2: outline for the note Today opened
// Worst-case data fixes (scripts/break-ui).
import '@hub/styles/break-ui.css';

interface Note {
  id: string | number;
  rating?: string;
  source?: string;
  status?: string;
  at?: string;
  handled_at?: string;
  question?: string;
  reading?: string;
  comment?: string;
  reply?: string;
  page?: string;
  ref?: string;
  name?: string;
  email?: string;
  unread?: boolean;
  has_shot?: boolean;
}
interface Mine {
  items: Note[];
}
interface All {
  items: Note[];
  counts?: Record<string, number>;
}

const SOURCE: Record<string, string> = { hub: 'FavorOS', brain: 'Favor Brain', 'hub-brain': 'Favor Brain', help: 'Help docs', tour: 'The tour', video: 'A video' };
const RATING: Record<string, [string, string]> = {
  problem: ["Something's wrong", 'bad'],
  wrong: ['Answer was wrong', 'bad'],
  'not-helpful': ['Not helpful', 'bad'],
  confusing: ['Confusing', 'warn'],
  missing: ['Something missing', 'warn'],
  idea: ['Idea', 'idea'],
  right: ['Answer was right', 'good'],
  praise: ['Works well', 'good'],
  helpful: ['Helpful', 'good'],
};
const STATUS: Record<string, [string, string]> = { new: ['Waiting', 'wait'], seen: ['Read', 'seen'], fixed: ['Fixed', 'done'], 'not-now': ['Not now', 'off'] };
const TABS: Array<[string, string]> = [
  ['new', 'New'],
  ['seen', 'Seen'],
  ['fixed', 'Fixed'],
  ['not-now', 'Not now'],
  ['', 'All'],
];

const et = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', ...o });
// A stamp that is not a date shows nothing, never "Invalid Date".
const when = (iso?: string) => (iso && !isNaN(new Date(iso).getTime()) ? et(iso, { month: 'short', day: 'numeric' }) + ', ' + et(iso, { hour: 'numeric', minute: '2-digit' }) : '');
// The page a note came from is typed by the sender's browser. Only a hub path or an https address becomes a link.
const safeHref = (p?: string) => {
  const u = String(p || '').split(' ')[0];
  return /^\/(?!\/)/.test(u) || /^https:\/\//i.test(u) ? u : '';
};
const initials = (n?: string) => {
  const w = String(n || '').split('@')[0].replace(/[^\p{L}\p{N}\s.]/gu, ' ').split(/[\s.]+/).filter(Boolean);
  const p = w.length > 1 ? [w[0], w[w.length - 1]] : w;
  return p.map((x) => Array.from(x)[0]).join('').toUpperCase() || '?';
};

const mineQuery = queryOptions({
  queryKey: ['feedback', 'mine'],
  queryFn: async (): Promise<Mine> => ({ items: ((await hubGet('/api/feedback/mine')) as Mine).items || [] }),
  staleTime: 0,
});
const allQuery = (status: string) =>
  queryOptions({
    queryKey: ['feedback', 'all', status],
    queryFn: async (): Promise<All> => {
      const d = (await hubGet('/api/feedback/all?status=' + encodeURIComponent(status))) as All;
      return { items: d.items || [], counts: d.counts || {} };
    },
    staleTime: 0,
  });

const cue = (n: string) => document.dispatchEvent(new CustomEvent('favor:cue', { detail: n }));

function Chip({ r }: { r?: string }) {
  return r && RATING[r] ? <span className={`fbp-chip fbp-chip--${RATING[r][1]}`}>{RATING[r][0]}</span> : null;
}
function Pill({ s }: { s?: string }) {
  const [label, cls] = STATUS[s || ''] || STATUS.new;
  return <span className={`fbp-status fbp-status--${cls}`}>{label}</span>;
}
// The picture the sender attached, from the private route (the sender and the hub admin only). It is dropped when it does not load.
function Shot({ f }: { f: Note }) {
  const [gone, setGone] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const i = img.current;
    if (i && i.complete && i.naturalWidth === 0) setGone(true);
  }, []);
  if (!f.has_shot || gone) return null;
  return (
    <a className="fbp-shotlink" href={`/api/feedback/${f.id}/shot`} target="_blank" rel="noopener">
      <img ref={img} className="fbp-shot" loading="lazy" src={`/api/feedback/${f.id}/shot`} alt="Picture of the page this note was sent from" onError={() => setGone(true)} />
    </a>
  );
}

function MineItem({ f, focus }: { f: Note; focus: boolean }) {
  return (
    <li className={`h-card fbp-item${f.unread ? ' is-unread' : ''}${focus ? ' is-focus' : ''}`} data-id={f.id}>
      <div className="fbp-meta">
        <Chip r={f.rating} />
        <span className="fbp-src">{SOURCE[f.source || ''] || f.source}</span>
        <time>{when(f.at)}</time>
        <Pill s={f.status} />
      </div>
      {f.question && (
        <p className="fbp-q">
          <span>Your question</span>
          {f.question}
        </p>
      )}
      {f.comment && <p className="fbp-text">{f.comment}</p>}
      <Shot f={f} />
      {f.reply && (
        <div className="fbp-reply">
          <b>
            Will's answer{f.unread && <> <em className="h-new">New</em></>}
          </b>
          <p>{f.reply}</p>
          <time>{when(f.handled_at)}</time>
        </div>
      )}
    </li>
  );
}

function AllItem({ f, focus, onSaved }: { f: Note; focus: boolean; onSaved: () => void }) {
  const [reply, setReply] = useState(f.reply || '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const page = safeHref(f.page);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const set = ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null)?.dataset.set ?? '';
    setBusy(true);
    setMsg('Saving...');
    try {
      let text = reply;
      if (set === 'updated' && !text.trim()) {
        text = 'Updated.';
        setReply(text);
      }
      const res = await fetch('/api/feedback/' + f.id + (set === 'updated' ? '/updated' : ''), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(set === 'updated' ? { reply: text } : { status: set || undefined, reply: text }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; mail?: { sent?: boolean; failed?: boolean } };
      if (!res.ok || d.ok === false) throw new Error(d.message || 'Did not save.');
      cue(set === 'fixed' || set === 'updated' ? 'success' : 'droplet');
      setMsg(
        set === 'updated'
          ? d.mail && d.mail.sent
            ? 'Saved and emailed.'
            : d.mail && d.mail.failed
              ? 'Saved. The email did not go out; it will try again.'
              : 'Saved. Already emailed.'
          : set === 'fixed' && text.trim()
            ? 'Saved. The answer is emailed.'
            : 'Saved.',
      );
      setTimeout(onSaved, 500);
    } catch (err) {
      setMsg((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className={`h-card fbp-item${focus ? ' is-focus' : ''}`} data-id={f.id}>
      <div className="fbp-who">
        <span className="fbp-av" aria-hidden="true">
          {initials(f.name || f.email)}
        </span>
        <div>
          <b>{f.name || f.email}</b>
          <span>{f.email}</span>
        </div>
        <div className="fbp-meta">
          <Chip r={f.rating} />
          <span className="fbp-src">{SOURCE[f.source || ''] || f.source}</span>
          <time>{when(f.at)}</time>
          <Pill s={f.status} />
        </div>
      </div>
      {f.question && (
        <p className="fbp-q">
          <span>Question{f.ref ? ` · ref ${f.ref}` : ''}</span>
          {f.question}
        </p>
      )}
      {f.reading && (
        <p className="fbp-q fbp-q--read">
          <span>How it read the question</span>
          {f.reading}
        </p>
      )}
      {f.comment ? <p className="fbp-text">{f.comment}</p> : <p className="fbp-text fbp-text--none">No words, only the rating.</p>}
      <Shot f={f} />
      {f.page && (
        <p className="fbp-page">
          From {page ? <a href={page}>{f.page}</a> : <span>{f.page}</span>}
        </p>
      )}
      <form className="fbp-act" data-act={f.id} onSubmit={submit}>
        <label className="h-label" htmlFor={`fb-r-${f.id}`}>
          Your answer
        </label>
        <textarea id={`fb-r-${f.id}`} rows={2} maxLength={2000} placeholder="Write an answer" value={reply} onChange={(e) => setReply(e.target.value)} />
        <div className="fbp-act__go">
          <button type="submit" className="h-btn h-btn--ghost h-btn--sm" data-set="seen" disabled={busy}>
            Mark read
          </button>
          <button type="submit" className="h-btn h-btn--primary h-btn--sm" data-set="updated" disabled={busy} title="Marks it fixed and emails the answer (Updated. when the box is empty)">
            Mark updated
          </button>
          <button type="submit" className="h-btn h-btn--ghost h-btn--sm" data-set="fixed" disabled={busy}>
            Fixed
          </button>
          <button type="submit" className="h-btn h-btn--ghost h-btn--sm" data-set="not-now" disabled={busy}>
            Not now
          </button>
          <button type="submit" className="h-btn h-btn--ghost h-btn--sm" data-set="" disabled={busy}>
            Save the answer
          </button>
          <span className="fbp-msg" role="status">
            {msg}
          </span>
        </div>
      </form>
    </li>
  );
}

function useFocusOnce(want: string, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!want || !ready || done.current) return;
    const el = document.querySelector(`#fb-list [data-id="${want.replace(/[^0-9A-Za-z_-]/g, '')}"]`);
    if (!el) return;
    done.current = true;
    el.scrollIntoView({ block: 'center' });
  }, [want, ready]);
}

const Skeleton = () => (
  <ul className="fbp-list" id="fb-list" aria-busy="true" aria-live="polite">
    <li className="h-card h-skel" style={{ minHeight: 120 }} />
  </ul>
);

function MineList({ want }: { want: string }) {
  const { data } = useSuspenseQuery(mineQuery);
  const items = data.items;
  useSheetSource('feedback', () => sheetRequest(items, false, ''));
  useFocusOnce(want, items.length > 0);
  useRefreshOnSent();
  const clean = want.replace(/[^0-9A-Za-z_-]/g, '');
  return (
    <ul className="fbp-list" id="fb-list" aria-live="polite">
      {items.length === 0 ? (
        <li className="h-card fbp-empty">
          <b>No notes yet.</b>
          <span>
            When something in FavorOS or Favor Brain is wrong, confusing, or could be better, press <b>Feedback</b> at the top of any page.
          </span>
        </li>
      ) : (
        items.map((f) => <MineItem key={f.id} f={f} focus={!!clean && String(f.id) === clean} />)
      )}
    </ul>
  );
}

function AllList({ want }: { want: string }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('new');
  const { data } = useSuspenseQuery(allQuery(status));
  const items = data.items;
  const counts = data.counts || {};
  useSheetSource('feedback', () => sheetRequest(items, true, status));
  useFocusOnce(want, items.length > 0);
  useRefreshOnSent();
  const clean = want.replace(/[^0-9A-Za-z_-]/g, '');
  return (
    <>
      <div className="fbp-tabs" id="fb-tabs" role="tablist" aria-label="Which notes">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            data-status={key}
            aria-selected={status === key}
            className={status === key ? 'is-on' : undefined}
            onClick={() => startTransition(() => setStatus(key))}
          >
            {label} {key && <span data-n={key}>{counts[key] ? Number(counts[key]).toLocaleString('en-US') : ''}</span>}
          </button>
        ))}
      </div>
      <ul className="fbp-list" id="fb-list" aria-live="polite">
        {items.length === 0 ? (
          <li className="h-card fbp-empty">
            <b>{status === 'new' ? 'Nothing new.' : 'No notes here.'}</b>
            <span>Notes from the Feedback button, Favor Brain answers, the help docs and the tour land here.</span>
          </li>
        ) : (
          items.map((f) => <AllItem key={f.id} f={f} focus={!!clean && String(f.id) === clean} onSaved={() => void qc.invalidateQueries({ queryKey: ['feedback'] })} />)
        )}
      </ul>
    </>
  );
}

// A note sent from the Feedback button shows up here a moment later.
function useRefreshOnSent() {
  const qc = useQueryClient();
  useEffect(() => {
    let t = 0;
    const on = () => {
      clearTimeout(t);
      t = window.setTimeout(() => void qc.invalidateQueries({ queryKey: ['feedback'] }), 300);
    };
    document.addEventListener('favor:feedback-sent', on);
    return () => {
      document.removeEventListener('favor:feedback-sent', on);
      clearTimeout(t);
    };
  }, [qc]);
}

// Open in Google Sheets: the notes on this page (a person's own, or every note for the admin, in the tab chosen).
function sheetRequest(shown: Note[], admin: boolean, status: string) {
  const base = [
    { key: 'at', label: 'Sent', type: 'datetime' },
    { key: 'source', label: 'From', type: 'text' },
    { key: 'rating', label: 'Kind of note', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'question', label: 'Question', type: 'text' },
    { key: 'comment', label: 'Note', type: 'text' },
    { key: 'reply', label: 'Answer', type: 'text' },
  ];
  const cols = admin ? [{ key: 'name', label: 'Name', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, ...base, { key: 'page', label: 'Page', type: 'text' }, { key: 'ref', label: 'Answer ref', type: 'text' }] : base;
  const rows = shown.map((f) => ({
    name: f.name || '',
    email: f.email || '',
    at: f.at,
    source: SOURCE[f.source || ''] || f.source,
    rating: (RATING[f.rating || ''] || [f.rating || ''])[0],
    status: (STATUS[f.status || ''] || STATUS.new)[0],
    question: f.question || '',
    comment: f.comment || '',
    reply: f.reply || '',
    page: f.page || '',
    ref: f.ref || '',
  }));
  const tab = admin && status ? `Tab: ${(STATUS[status] || [status])[0]}` : '';
  return sheetScreen('Feedback notes', [{ name: 'Notes', columns: cols, rows }], { filters: tab, classes: admin ? ['staff'] : [] });
}

function Notes({ want }: { want: string }) {
  const { data } = useSuspenseQuery(navQuery);
  const admin = !!(data.access as { admin?: boolean } | undefined)?.admin;
  return admin ? (
    <Suspense fallback={<Skeleton />}>
      <AllList want={want} />
    </Suspense>
  ) : (
    <Suspense fallback={<Skeleton />}>
      <MineList want={want} />
    </Suspense>
  );
}

export function FeedbackPage({ item }: { item: string }) {
  return (
    <div className="fbp">
      <section className="fbp-head">
        <div>
          <h1 className="sr-only">Feedback</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <SheetsButton name="feedback" />
          <button type="button" className="h-btn h-btn--primary" data-feedback="hub">
            Send feedback
          </button>
        </div>
      </section>
      <Suspense fallback={<Skeleton />}>
        <Notes want={item} />
      </Suspense>
    </div>
  );
}
