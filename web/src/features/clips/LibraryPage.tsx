// Clips > My clips (/clips/) and All clips (/clips/all/, admins). A quiet grid of clips with search over titles, summaries and what was
// said, a Shared / Private filter, a sort, and Select for acting on several clips at once. Port of src/pages/clips/index.astro, all.astro
// and public/js/clips/library.js with the same markup and classes (src/styles/clips.css, crit-clips2.css). The Share window is the shared
// one in public/js/clips/sharesheet.js, loaded when someone opens it.
import { Suspense, useDeferredValue, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { QueryErrorResetBoundary, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import '@hub/styles/clips.css';
import '@hub/styles/crit-clips2.css';
import '@hub/styles/q3-desk.css';
import '@hub/styles/lint-fix.css';
// Worst-case data fixes (scripts/break-ui).
import '@hub/styles/break-ui.css';
import './badge.css';
import { api, ask, copyText, et, fmtTime, toast } from '@clips/core.js';
import { NavLink } from '@/shell/NavLink';
import { Boundary } from '../partners/record/Boundary';
import { navQuery } from '../../lib/queries';
import { capPct, countLabel, emptyText, fmtBytes, fmtViews, levelLabel, levelOfClip, PAGE, selectLabel, shownClips, type Filter, type Sort } from './logic';
import { clipsQuery, type ClipRow, type ClipScope, type ClipsAnswer, type ClipPerson, type ClipUsage } from './queries';

const HOVER_SECONDS = 6;
const linkFor = (id: string) => `${location.origin}/c/${id}`;
type Compose = { add?: (item: unknown, o: unknown) => Promise<void>; dragStart?: (e: unknown, item: unknown) => void };
const compose = (): Compose | undefined => (window as unknown as { FavorCompose?: Compose }).FavorCompose;
/** A clip as an item for the email composer (public/js/compose/compose.js): "Send to email" and dragging a card onto a draft. */
const emailItem = (c: ClipRow) => ({ kind: 'clip', title: c.title || 'Clip', url: linkFor(c.id), sub: c.duration_ms ? fmtTime(c.duration_ms / 1000) : '', text: c.summary || '' });

const PublicMark = () => (
  <span className="cs-pub" title="Anyone with the link can watch, signed in or not">
    <svg className="cs-i" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" />
    </svg>
    Public
  </span>
);

/** The picture of a clip: the poster, and after a short hover the first six seconds of the file, muted, in a loop. */
function Thumb({ c }: { c: ClipRow }) {
  const [bad, setBad] = useState(false);
  const [video, setVideo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);
  const vid = useRef<HTMLVideoElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (video && vid.current) vid.current.play().catch(() => undefined);
  }, [video]);
  const start = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVideo(true), 280);
  };
  const stop = () => {
    clearTimeout(timer.current);
    setVideo(false);
    setPlaying(false);
  };
  const level = levelOfClip(c);
  return (
    <a className="cl-thumb" href={`/c/${c.id}`} aria-label={`Open ${c.title || 'clip'}`} data-thumb onPointerEnter={start} onPointerLeave={stop}>
      {video ? (
        <video
          ref={vid}
          className={'cl-prev' + (playing ? ' is-on' : '')}
          muted
          loop
          playsInline
          preload="auto"
          src={`/api/clips/${c.id}/media#t=0,${HOVER_SECONDS}`}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= HOVER_SECONDS) e.currentTarget.currentTime = 0;
          }}
          onPlaying={() => setPlaying(true)}
        />
      ) : null}
      {c.has_poster && !bad ? <img src={`/api/clips/${c.id}/media?poster=1`} alt="" loading="lazy" onError={() => setBad(true)} /> : null}
      {c.duration_ms ? <b>{fmtTime(c.duration_ms / 1000)}</b> : null}
      {c.status === 'processing' ? <span className="cl-badge">Writing the title</span> : null}
      {level === 'public' ? (
        <span className="cl-pubmark">
          <PublicMark />
        </span>
      ) : null}
    </a>
  );
}

interface CardProps {
  c: ClipRow;
  scope: ClipScope;
  mail: boolean;
  picking: boolean;
  picked: boolean;
  onPick: (id: string) => void;
  onShare: (c: ClipRow) => void;
  onRename: (c: ClipRow, title: string) => Promise<void>;
  onDelete: (c: ClipRow) => void;
}

function Card({ c, scope, mail, picking, picked, onPick, onShare, onRename, onDelete }: CardProps) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const level = levelOfClip(c);
  useEffect(() => {
    if (renaming && input.current) {
      input.current.focus();
      input.current.select();
    }
  }, [renaming]);
  const save = async () => {
    const t = title.trim();
    if (!t) return;
    try {
      await onRename(c, t);
      setRenaming(false);
    } catch {
      // the toast already said why; the box stays open
    }
  };
  const dragStart = (e: DragEvent<HTMLElement>) => {
    const fc = compose();
    if (fc && fc.dragStart) fc.dragStart(e, emailItem(c));
    else e.dataTransfer.setData('application/x-favoros-item', JSON.stringify(emailItem(c)));
    e.dataTransfer.setData('text/uri-list', linkFor(c.id));
    e.dataTransfer.setData('text/plain', linkFor(c.id));
    e.dataTransfer.effectAllowed = 'copy';
  };
  // In selection mode a tap on the card, its picture or its title selects it instead of opening it.
  const pickClick = (e: MouseEvent<HTMLElement>) => {
    if (!picking) return;
    const t = e.target as Element;
    if (t.closest('.cl-rename, [data-act=save]')) return;
    if (t.closest('.cl-switch, button[data-act]:not([data-act=pick])')) return;
    e.preventDefault();
    e.stopPropagation();
    onPick(c.id);
  };
  const lesson = async () => {
    setBusy(true);
    try {
      const r = await api(`/api/clips/${c.id}/lesson`, { method: 'POST', json: {} });
      toast('Draft course made. It opens in Learn.');
      setTimeout(() => {
        location.href = r.url;
      }, 700);
    } catch (err) {
      toast((err as Error).message, 'bad');
      setBusy(false);
    }
  };
  return (
    <article className={'h-card cl-card' + (picking ? ' is-picking' : '') + (picked ? ' is-picked' : '')} data-id={c.id} draggable={picking ? undefined : true} onDragStart={dragStart} onClickCapture={pickClick}>
      {picking ? (
        <button type="button" className="cl-pick" data-act="pick" role="checkbox" aria-checked={picked} aria-label={`Select ${c.title || 'clip'}`}>
          <i />
        </button>
      ) : null}
      <Thumb c={c} />
      <div className="cl-body">
        <div className="cl-name">
          {renaming ? (
            <>
              <input
                ref={input}
                className="cl-rename"
                type="text"
                maxLength={120}
                value={title}
                aria-label="Clip title"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <button type="button" className="h-btn h-btn--primary h-btn--sm" data-act="save" onClick={() => void save()}>
                Save
              </button>
            </>
          ) : (
            <a href={`/c/${c.id}`}>{c.title || 'Untitled clip'}</a>
          )}
        </div>
        <div className="cl-meta">
          {scope === 'all' ? (
            <span>
              <b>{c.owner_name}</b>
              {c.owner_team ? ` (${c.owner_team})` : ''}
            </span>
          ) : null}
          <span>{et(c.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <span>{fmtViews(c.views)}</span>
          {c.size_bytes ? <span>{fmtBytes(c.size_bytes)}</span> : null}
        </div>
        {c.summary ? <p className="cl-sum">{c.summary}</p> : null}
        {c.match ? (
          <a className="cl-hit" href={`/c/${c.id}?t=${Math.floor(c.match.at)}`}>
            <span>{fmtTime(c.match.at)}</span>
            <span className="cl-hit__t">{c.match.text}</span>
          </a>
        ) : null}
      </div>
      <div className="cl-acts">
        {c.mine ? (
          <button type="button" className={'cl-lvl cl-lvl--' + level} data-act="share" aria-label={`Who can watch: ${levelLabel(level)}. Change`} title="Change who can watch" onClick={() => onShare(c)}>
            {levelLabel(level)}
          </button>
        ) : (
          <span className={'cl-lvl cl-lvl--' + level}>{levelLabel(level)}</span>
        )}
        <span className="cl-btns">
          {c.status === 'ready' && mail ? (
            <button
              type="button"
              className="h-btn h-btn--ghost h-btn--sm"
              data-act="email"
              title="Add this clip to an email (or drag the card onto one)"
              onClick={async (e) => {
                const fc = compose();
                if (!fc || !fc.add) return;
                await fc.add(emailItem(c), { anchor: e.currentTarget, from: e.currentTarget.closest('.cl-card') });
                if (!c.share) toast('People outside FavorOS need "Anyone with the link" on to watch it');
              }}
            >
              Send to email
            </button>
          ) : null}
          {c.mine ? (
            <>
              <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-act="copy" onClick={async () => toast((await copyText(linkFor(c.id))) ? 'Link copied' : 'Could not copy the link')}>
                Copy link
              </button>
              <button
                type="button"
                className="h-btn h-btn--ghost h-btn--sm"
                data-act="rename"
                onClick={() => {
                  setTitle(c.title);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              {c.status === 'ready' ? (
                <>
                  <a className="h-btn h-btn--ghost h-btn--sm" href={`/c/${c.id}?make=article`} title="Draft a help article from this clip">
                    Help article
                  </a>
                  <button type="button" className="h-btn h-btn--ghost h-btn--sm" data-act="lesson" title="Make a draft Learn course from this clip" disabled={busy} onClick={() => void lesson()}>
                    Learn lesson
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <a className="h-btn h-btn--ghost h-btn--sm" href={`/c/${c.id}`}>
              Open
            </a>
          )}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete" onClick={() => onDelete(c)}>
            Delete
          </button>
        </span>
      </div>
    </article>
  );
}

function Usage({ scope, usage, people, cap, onDeleteOld }: { scope: ClipScope; usage?: ClipUsage; people?: ClipPerson[]; cap?: number; onDeleteOld: (c: ClipUsage['oldestUnwatched'][number]) => void }) {
  if (scope === 'all') {
    const list = people || [];
    const limit = cap || 10 * 1024 ** 3;
    return (
      <section id="cl-usage" aria-label="Storage by person" data-keep-h="usage" hidden={!list.length}>
        {list.length ? (
          <div className="cl-ppl" role="table" aria-label="Storage by person">
            <div className="cl-ppl__h" role="row">
              <span>Person</span>
              <span>Clips</span>
              <span>Storage</span>
              <span>Of {fmtBytes(limit)}</span>
            </div>
            {list.map((p) => (
              <div className="cl-ppl__r" role="row" key={p.email}>
                <span>
                  <b>{p.name || p.email}</b>
                  {p.team ? (
                    <>
                      {' '}
                      <em>{p.team}</em>
                    </>
                  ) : null}
                  {p.blocked ? (
                    <>
                      {' '}
                      <i className="cl-tag">Blocked</i>
                    </>
                  ) : null}
                  <small>{p.email}</small>
                </span>
                <span>{Number(p.clips).toLocaleString('en-US')}</span>
                <span>{fmtBytes(p.bytes)}</span>
                <span>
                  <i className={'cl-meter' + (p.bytes >= limit * 0.8 ? ' is-warn' : '')}>
                    <u style={{ width: capPct(p.bytes, limit) + '%' }} />
                  </i>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    );
  }
  const has = !!(usage && usage.clips);
  return (
    <section id="cl-usage" aria-label="Your storage" data-keep-h="usage" hidden={!has}>
      {has && usage ? (
        <div className={'cl-use' + (usage.warn ? ' is-warn' : '')}>
          <div className="cl-use__t">
            <b>{fmtBytes(usage.used)}</b> of {fmtBytes(usage.cap)} used
          </div>
          <i className={'cl-meter' + (usage.warn ? ' is-warn' : '')} role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage.pct}>
            <u style={{ width: usage.pct + '%' }} />
          </i>
          {usage.warn ? (
            <>
              <p className="cl-use__w">
                {usage.full ? 'Your clips use all of your space, so new recordings wait until you delete some.' : 'You are past 80% of your space.'} These are your oldest clips that nobody has watched.
              </p>
              {usage.oldestUnwatched && usage.oldestUnwatched.length ? (
                <ul className="cl-old">
                  {usage.oldestUnwatched.map((o) => (
                    <li key={o.id} data-id={o.id}>
                      <a href={`/c/${o.id}`}>{o.title || 'Untitled clip'}</a>
                      <span>
                        {et(o.created_at, { month: 'short', day: 'numeric', year: 'numeric' })} · {fmtBytes(o.size_bytes)}
                      </span>
                      <button type="button" className="h-btn h-btn--ghost h-btn--sm cl-danger" data-act="delete-old" onClick={() => onDeleteOld(o)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cl-use__w">Every clip you have was watched. Delete the ones you no longer need.</p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const Skeleton = () => (
  <div id="cl-rows" className="cl-grid" aria-busy="true">
    <div className="h-card h-skel" style={{ minHeight: 220 }} />
    <div className="h-card h-skel" style={{ minHeight: 220 }} />
    <div className="h-card h-skel" style={{ minHeight: 220 }} />
  </div>
);

function SearchBar({ scope, typed, setTyped }: { scope: ClipScope; typed: string; setTyped: (v: string) => void }) {
  return (
    <section className="cl-bar" aria-label="Search">
      <label className="cl-search">
        <span className="cl-sr">{scope === 'all' ? 'Search all clips' : 'Search your clips'}</span>
        <input id="cl-q" type="search" placeholder={scope === 'all' ? 'Search clips and people' : 'Search clips and what was said'} autoComplete="off" defaultValue={typed} onChange={(e) => setTyped(e.target.value)} />
      </label>
    </section>
  );
}

interface ToolsProps {
  scope: ClipScope;
  filter: Filter;
  setFilter: (f: Filter) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
  picking: boolean;
  togglePicking: () => void;
}

const CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'shared', label: 'Shared' },
  { id: 'private', label: 'Private' },
];

function Tools({ scope, filter, setFilter, sort, setSort, picking, togglePicking }: ToolsProps) {
  return (
    <section className="cl-tools" aria-label="Filter and sort">
      {scope === 'mine' ? (
        <div className="cl-chips" role="group" aria-label="Show">
          {CHIPS.map((x) => (
            <button key={x.id} type="button" className={'cl-chip' + (filter === x.id ? ' is-on' : '')} data-f={x.id} aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
      <label className="cl-sort">
        <span className="cl-sr">Sort by</span>
        <select id="cl-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="new">Newest</option>
          <option value="old">Oldest</option>
          <option value="views">Most viewed</option>
          <option value="title">Title A to Z</option>
          <option value="size">Largest</option>
          {scope === 'all' ? <option value="person">Person</option> : null}
        </select>
      </label>
      <button type="button" className="h-btn h-btn--ghost" id="cl-select" aria-pressed={picking} onClick={togglePicking}>
        {picking ? 'Done' : 'Select'}
      </button>
    </section>
  );
}

/** Usage, the search bar and the rows draw together from one read, so nothing above the grid moves when it answers. */
function Library({ scope, q, typed, setTyped }: { scope: ClipScope; q: string; typed: string; setTyped: (v: string) => void }) {
  const qc = useQueryClient();
  const applied = useDeferredValue(q);
  const query = useSuspenseQuery({
    ...clipsQuery(scope, applied),
    // A clip being named is looked at again every four seconds, as the classic page does.
    refetchInterval: (state) => (state.state.data?.clips.some((c) => c.status === 'processing') ? 4000 : false),
  });
  const data = query.data;
  const [limit, setLimit] = useState(PAGE);
  const [mail, setMail] = useState(false);
  const [filter, setFilterRaw] = useState<Filter>('all');
  const [sort, setSortRaw] = useState<Sort>('new');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useEffect(() => setLimit(PAGE), [applied]);
  // The composer is a helper script the page loads after it paints, so its button appears once the helper is there.
  useEffect(() => {
    let n = 0;
    const look = () => setMail(!!compose() && document.documentElement.classList.contains('has-mail'));
    look();
    const t = window.setInterval(() => {
      look();
      if (++n > 12) clearInterval(t);
    }, 600);
    return () => clearInterval(t);
  }, []);
  // A recording that just finished (the recorder window or the pill says so) refreshes the list.
  useEffect(() => {
    const on = () => void qc.invalidateQueries({ queryKey: ['clips', scope] });
    window.addEventListener('clips:changed', on);
    return () => window.removeEventListener('clips:changed', on);
  }, [qc, scope]);
  // Escape leaves selection mode, unless a question box is open (it takes the key first).
  useEffect(() => {
    if (!picking) return;
    const on = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && !ev.defaultPrevented && !document.querySelector('.cl-askback')) {
        setPicking(false);
        setPicked(new Set());
      }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [picking]);

  const rows = data.clips;
  const list = shownClips(rows, filter, sort);
  // Clips that left the list (deleted here or elsewhere) leave the selection.
  const live = new Set(rows.map((c) => c.id));
  const pickedNow = [...picked].filter((id) => live.has(id));
  useEffect(() => {
    if (pickedNow.length !== picked.size) setPicked(new Set(pickedNow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const reload = () => void qc.invalidateQueries({ queryKey: ['clips', scope] });
  const drop = (ids: string[]) => qc.setQueriesData<ClipsAnswer>({ queryKey: ['clips', scope] }, (old) => (old ? { ...old, clips: old.clips.filter((c) => !ids.includes(c.id)) } : old));
  const patch = (id: string, f: (c: ClipRow) => ClipRow) => qc.setQueriesData<ClipsAnswer>({ queryKey: ['clips', scope] }, (old) => (old ? { ...old, clips: old.clips.map((c) => (c.id === id ? f(c) : c)) } : old));
  const setFilter = (f: Filter) => {
    setFilterRaw(f);
    setLimit(PAGE);
  };
  const setSort = (s: Sort) => {
    setSortRaw(s);
    setLimit(PAGE);
  };
  const togglePicking = () => {
    if (picking) setPicked(new Set());
    setPicking(!picking);
  };
  const onPick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const del = async (id: string, title: string, owner: string | null) => {
    const ok = await ask({
      title: owner ? `Delete ${owner}'s clip?` : 'Delete this clip?',
      body: `"${title || 'Untitled clip'}" is removed for good. The link stops working, and its comments go with it.`,
      ok: 'Delete clip',
    });
    if (!ok) return;
    try {
      await api(`/api/clips/${id}`, { method: 'DELETE' });
      drop([id]);
      toast('Clip deleted');
      reload();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const bulk = async (kind: string) => {
    const ids = pickedNow;
    if (!ids.length) return;
    if (kind === 'delete') {
      const n = ids.length;
      const ok = await ask({
        title: n === 1 ? 'Delete this clip?' : `Delete ${n} clips?`,
        body: n === 1 ? 'The clip is removed for good. The link stops working, and its comments go with it.' : `These ${n} clips are removed for good. Their links stop working, and their comments go with them.`,
        ok: n === 1 ? 'Delete clip' : `Delete ${n} clips`,
      });
      if (!ok) return;
    }
    let failed = 0;
    const done: string[] = [];
    for (const id of ids) {
      try {
        if (kind === 'delete') await api(`/api/clips/${id}`, { method: 'DELETE' });
        else await api(`/api/clips/${id}`, { method: 'PATCH', json: { access: kind } });
        done.push(id);
        if (kind !== 'delete') patch(id, (c) => ({ ...c, level: kind, share: 0, staff_link: kind === 'staff' ? 1 : 0 }));
      } catch {
        failed += 1;
      }
    }
    if (kind === 'delete') {
      drop(done);
      const left = new Set(ids.filter((id) => !done.includes(id)));
      setPicked(left);
      if (!left.size) setPicking(false);
    }
    toast(failed ? `${failed} could not be changed` : kind === 'delete' ? (ids.length === 1 ? 'Clip deleted' : `${ids.length} clips deleted`) : `Who can watch is now ${levelLabel(kind)}`, failed ? 'bad' : undefined);
    if (kind === 'delete') reload();
  };
  const share = async (c: ClipRow) => {
    const m = await import('@clips/sharesheet.js');
    void m.openShare(c.id, {
      onChange: ({ level }: { level: string }) => patch(c.id, (x) => ({ ...x, level, share: level === 'public' ? 1 : 0, staff_link: level === 'staff' ? 1 : 0 })),
    });
  };
  const rename = async (c: ClipRow, title: string) => {
    try {
      await api(`/api/clips/${c.id}`, { method: 'PATCH', json: { title } });
      patch(c.id, (x) => ({ ...x, title }));
      toast('Renamed');
    } catch (e) {
      toast((e as Error).message, 'bad');
      throw e;
    }
  };

  const left = list.length - limit;
  const n = pickedNow.length;
  const mineOnly = pickedNow.every((id) => rows.find((c) => c.id === id)?.mine);
  return (
    <>
      <Usage scope={scope} usage={data.usage} people={data.people} cap={data.cap} onDeleteOld={(o) => void del(o.id, o.title, null)} />
      <SearchBar scope={scope} typed={typed} setTyped={setTyped} />
      <Tools scope={scope} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} picking={picking} togglePicking={togglePicking} />
      <section aria-label="Clips">
        <div className="cl-listhead">
          <span id="cl-count-label">{countLabel(list.length)}</span>
        </div>
        {list.length ? (
          <div id="cl-rows" className="cl-grid">
            {list.slice(0, limit).map((c) => (
              <Card
                key={c.id}
                c={c}
                scope={scope}
                mail={mail}
                picking={picking}
                picked={picked.has(c.id)}
                onPick={onPick}
                onShare={(x) => void share(x)}
                onRename={rename}
                onDelete={(x) => void del(x.id, x.title, x.mine ? null : x.owner_name)}
              />
            ))}
            {left > 0 ? (
              <div className="cl-more">
                <button type="button" className="h-btn h-btn--ghost" data-act="more" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, left)} more
                </button>
                <span>{left.toLocaleString('en-US')} not shown</span>
              </div>
            ) : null}
          </div>
        ) : (
          <div id="cl-rows">
            <div className="h-card cl-empty">{rows.length ? `No ${filter} clips.` : emptyText(scope, applied)}</div>
          </div>
        )}
      </section>
      <div className="cl-selbar" id="cl-selbar" hidden={!picking} role="region" aria-label="Selected clips">
        <span className="cl-selcount" id="cl-selcount" role="status">
          {picking ? selectLabel(n) : ''}
        </span>
        <span className="cl-selbtns">
          <button
            type="button"
            className="h-btn h-btn--ghost h-btn--sm"
            data-sel="all"
            onClick={() => setPicked(n >= list.length ? new Set() : new Set(list.map((c) => c.id)))}
          >
            {n && n >= list.length ? 'Select none' : 'Select all'}
          </button>
          {[
            { k: 'private', label: 'Private' },
            { k: 'people', label: 'Specific people' },
            { k: 'staff', label: 'Anyone at Favor' },
          ].map((b) => (
            <button key={b.k} type="button" className="h-btn h-btn--ghost h-btn--sm" data-sel={b.k} data-need-mine disabled={!n || !mineOnly} onClick={() => void bulk(b.k)}>
              {b.label}
            </button>
          ))}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm cl-danger" data-sel="delete" disabled={!n} onClick={() => void bulk('delete')}>
            Delete
          </button>
        </span>
      </div>
    </>
  );
}

const statusOf = (e: Error) => (e.name === 'HubReadError' ? (e as Error & { status?: number }).status || 0 : 0);

function Failed({ e }: { e: Error }) {
  return (
    <section aria-label="Clips">
      <div id="cl-rows">
        <div className="h-card cl-empty">{statusOf(e) === 403 ? 'This view is for FavorOS admins.' : 'Your clips did not load. Refresh the page to try again.'}</div>
      </div>
    </section>
  );
}

const noop = () => undefined;

function Fallback({ scope, typed, setTyped }: { scope: ClipScope; typed: string; setTyped: (v: string) => void }) {
  return (
    <>
      <section id="cl-usage" aria-label={scope === 'all' ? 'Storage by person' : 'Your storage'} data-keep-h="usage" />
      <SearchBar scope={scope} typed={typed} setTyped={setTyped} />
      <Tools scope={scope} filter="all" setFilter={noop} sort="new" setSort={noop} picking={false} togglePicking={noop} />
      <section aria-label="Clips">
        <div className="cl-listhead">
          <span id="cl-count-label" />
        </div>
        <Skeleton />
      </section>
    </>
  );
}

function AdminLink() {
  const nav = useQuery(navQuery);
  // The server draws the link hidden (the menu answer is not in yet), so the browser's first draw is hidden too and the link shows after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const admin = mounted && !!(nav.data?.access as Record<string, unknown> | undefined)?.admin;
  return (
    <NavLink className="cl-adminlink" id="cl-adminlink" href="/clips/all/" hidden={!admin}>
      All clips (admin)
    </NavLink>
  );
}

export function LibraryPage({ scope }: { scope: ClipScope }) {
  // The search waits for a pause in typing (250 ms), as the classic page does.
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const record = () => {
    const b = document.getElementById('clip-cam');
    if (b && !b.hidden) b.click();
    else window.open('/clips/rec/', 'clip-recorder', 'popup,width=440,height=700') || (location.href = '/clips/rec/');
  };
  return (
    <div className="cl" id="cl" data-scope={scope}>
      <section className="cl-head">
        <div>
          <h1>{scope === 'all' ? 'All clips' : 'My clips'}</h1>
          <p className="h-lede cl-lede">{scope === 'all' ? "Every person's clips and storage." : 'Only you see this list.'}</p>
          {scope === 'mine' ? <AdminLink /> : null}
        </div>
        {scope === 'all' ? (
          <NavLink className="h-btn h-btn--ghost" href="/clips/">
            My clips
          </NavLink>
        ) : (
          <button type="button" className="h-btn h-btn--primary" id="cl-new" onClick={record}>
            Record a clip
          </button>
        )}
      </section>
      <QueryErrorResetBoundary>
        {() => (
          <Boundary fallback={(e) => <Failed e={e} />}>
            <Suspense fallback={<Fallback scope={scope} typed={typed} setTyped={setTyped} />}>
              <Library scope={scope} q={q} typed={typed} setTyped={setTyped} />
            </Suspense>
          </Boundary>
        )}
      </QueryErrorResetBoundary>
    </div>
  );
}
