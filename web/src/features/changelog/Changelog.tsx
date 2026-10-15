// What's new: every change to FavorOS, newest first, grouped by day, from src/content/changelog (one file per day, read at build time).
// Search and the area and kind filters run in the page. Internal-only work shows as one collapsed "Behind the scenes" line per day.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import days, { type ChangeEntry } from 'virtual:changelog';
import { AREA_LABEL, AREA_SHOT, TYPE_LABEL, dayLabel, timeLabel } from '@hub/data/changelog';
import '@hub/styles/changelog.css';

const KEY = 'favor.changelog.seen';

interface Row {
  e: ChangeEntry;
  stamp: string;
  shot: { desk: string; phone?: string } | undefined;
  now: boolean;
  auto: boolean;
  text: string;
}

const used = new Set(days.flatMap((d) => d.entries.map((e) => e.area)));
const areas = Object.entries(AREA_LABEL)
  .filter(([k]) => used.has(k))
  .sort((a, b) => a[1].localeCompare(b[1]));
const total = days.reduce((n, d) => n + d.entries.length, 0);
const top = days.find((d) => d.entries.length);
const latest = top ? `${top.date}T${top.entries[0].time}` : '';
const first = days.length ? days[days.length - 1].date : '';

// One picture per area per day shows by itself (the rest wait for a tap). It is drawn at its final size from the start and read lazily,
// so nothing below it moves when it arrives. Desktop shots are 1200 by 736, phone shots 600 by 1200.
const built = days.map((d) => {
  const seenArea = new Set<string>();
  return {
    ...d,
    rows: d.entries.map((e): Row => {
      const shot = e.image ? { desk: e.image, phone: e.phone } : AREA_SHOT[e.area];
      const auto = !!shot && !seenArea.has(e.area);
      if (shot) seenArea.add(e.area);
      return { e, stamp: `${d.date}T${e.time}`, shot, now: !e.image || !!e.now, auto, text: `${timeLabel(e.time)} ${TYPE_LABEL[e.type]} ${AREA_LABEL[e.area]} ${e.text}`.toLowerCase() };
    }),
  };
});

const EntryRow = memo(function EntryRow({ r, hidden, unseen, lite }: { r: Row; hidden: boolean; unseen: boolean; lite: boolean }) {
  const [picture, setPicture] = useState<'' | 'phone' | 'desk'>('');
  const { e, shot } = r;
  return (
    <li className={'cl-e' + (unseen ? ' is-unseen' : '')} data-area={e.area} data-type={e.type} data-stamp={r.stamp} hidden={hidden}>
      <time dateTime={r.stamp}>{timeLabel(e.time)}</time>
      <div className="cl-e__body">
        <div className="cl-e__tags">
          <span className={`cl-t cl-t--${e.type}`}>{TYPE_LABEL[e.type]}</span>
          <span className="cl-a">{AREA_LABEL[e.area]}</span>
        </div>
        <p>{e.text}</p>
        {shot && r.auto && !lite && (
          <figure className="cl-fig cl-fig--auto">
            <picture>
              {shot.phone && <source media="(max-width: 720px)" srcSet={shot.phone} width={600} height={1200} />}
              <img src={shot.desk} width={1200} height={736} alt="" loading="lazy" decoding="async" />
            </picture>
            {r.now && <figcaption>{"Today's view"}</figcaption>}
          </figure>
        )}
        {shot && picture === '' && (
          <button
            type="button"
            className={`cl-shot${r.auto ? ' cl-shot--auto' : ''}`}
            data-src={shot.desk}
            data-phone={shot.phone || undefined}
            data-now={r.now ? '1' : undefined}
            onClick={() => setPicture(shot.phone && matchMedia('(max-width: 720px)').matches ? 'phone' : 'desk')}
          >
            Show picture{r.now ? " (today's view)" : ''}
          </button>
        )}
        {shot && picture !== '' && (
          <figure className="cl-fig">
            <img src={picture === 'phone' ? shot.phone : shot.desk} width={picture === 'phone' ? 600 : 1200} height={picture === 'phone' ? 1200 : 750} alt="" decoding="async" />
            {r.now && <figcaption>{"Today's view"}</figcaption>}
          </figure>
        )}
      </div>
    </li>
  );
});

export function Changelog({ initialQ, initialArea }: { initialQ: string; initialArea: string }) {
  const [q, setQ] = useState(initialQ);
  const [term, setTerm] = useState(initialQ);
  const [area, setArea] = useState(areas.some(([k]) => k === initialArea) ? initialArea : '');
  const [type, setType] = useState('');
  const [seen, setSeen] = useState('');
  const [lite, setLite] = useState(false);
  const timer = useRef(0);

  // Changes since the last visit get a small mark; this visit then counts as seen. Lite mode keeps the pictures as buttons.
  useEffect(() => {
    let prev = '';
    try {
      prev = localStorage.getItem(KEY) || '';
    } catch {
      prev = '';
    }
    setSeen(prev);
    try {
      if (latest) localStorage.setItem(KEY, latest);
    } catch {
      // private mode
    }
    document.documentElement.classList.remove('has-cl-new');
    setLite(!!(window as unknown as { FavorLite?: { on?: boolean } }).FavorLite?.on);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const ws = useMemo(() => term.toLowerCase().trim().split(/\s+/).filter(Boolean), [term]);
  const filtering = !!(ws.length || area || type);
  const match = (r: Row) => (!area || r.e.area === area) && (!type || r.e.type === type) && ws.every((w) => r.text.indexOf(w) >= 0);
  const count = useMemo(() => built.reduce((n, d) => n + d.rows.filter(match).length, 0), [ws, area, type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cl" data-latest={latest} data-ready="1">
      <header className="cl-head">
        <h1>What's new</h1>
        <p>Every change to FavorOS since {first ? dayLabel(first) : 'the start'}, newest first. Times are Eastern.</p>
        <div className="cl-tools">
          <label className="cl-find">
            <span className="sr-only">Search changes</span>
            <input
              type="search"
              id="cl-q"
              placeholder="Search changes"
              autoComplete="off"
              value={q}
              onChange={(e) => {
                const v = e.target.value;
                setQ(v);
                clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setTerm(v), 120);
              }}
            />
          </label>
          <label className="cl-sel">
            <span className="sr-only">Area</span>
            <select id="cl-area" value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">All areas</option>
              {areas.map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="cl-sel">
            <span className="sr-only">Kind of change</span>
            <select id="cl-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Every kind</option>
              <option value="new">New</option>
              <option value="improved">Improved</option>
              <option value="fixed">Fixed</option>
            </select>
          </label>
        </div>
        <p className="cl-count" id="cl-count" aria-live="polite">
          {(filtering ? count : total).toLocaleString('en-US')} {(filtering ? count : total) === 1 ? 'change' : 'changes'}
        </p>
      </header>

      {built.map((d) => {
        const anyShown = !filtering || d.rows.some(match);
        return (
          <section className="cl-day" data-day={d.date} key={d.date} hidden={!anyShown}>
            <h2>{dayLabel(d.date)}</h2>
            {d.rows.length > 0 && (
              <ol className="cl-list">
                {d.rows.map((r, i) => (
                  <EntryRow key={`${r.stamp}-${i}`} r={r} hidden={filtering && !match(r)} unseen={!!seen && r.stamp > seen} lite={lite} />
                ))}
              </ol>
            )}
            {d.behind > 0 && (
              <details className="cl-behind" hidden={filtering}>
                <summary>
                  Behind the scenes: {d.behind} {d.behind === 1 ? 'update' : 'updates'}
                </summary>
                <p>Tests, speed and upkeep work with nothing new to see.</p>
              </details>
            )}
          </section>
        );
      })}
      <p className="cl-none" id="cl-none" hidden={(filtering ? count : total) > 0}>
        No changes match.
      </p>
    </div>
  );
}
