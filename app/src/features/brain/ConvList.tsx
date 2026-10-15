// Your Favor Brain chats, the same list on the Brain page's rail and in the dock: grouped Pinned, Today, Yesterday, Previous 7
// days, Older. A row: a chat mark, the title, one line of the last answer and the time; pin, rename and delete on hover (always
// on a phone). The same one-question chat asked again shows once with a count (/api/brain/history sends the others' ids in
// `same`, and delete removes them all). Times and days are Eastern, so the server and the browser draw the same list.
import { useEffect, useRef, useState } from 'react';
import type { BrainEngine } from './engine';
import type { ConvRow } from './types';

const TZ = 'America/New_York';
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const I = {
  chat: (
    <svg viewBox="0 0 16 16" {...P}>
      <path d="M2.75 4.25a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.25v-2.25h-.25a1.5 1.5 0 0 1-1-1.5z" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 16 16" {...P}>
      <path d="M6 2.5h4l-.5 4 2 2v1H4.5v-1l2-2zM8 9.5v4" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 16 16" {...P}>
      <path d="M10.5 2.75 13.25 5.5 6 12.75H3.25V10z" />
    </svg>
  ),
  del: (
    <svg viewBox="0 0 16 16" {...P}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  ),
};
const DAY = 864e5;
const etDay = (d: Date | number) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const dayNum = (ymd: string) => Date.parse(ymd + 'T00:00:00Z') / DAY;
function group(c: ConvRow) {
  if (c.pinned) return 'Pinned';
  const diff = dayNum(etDay(Date.now())) - dayNum(etDay(new Date(c.changed_at)));
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7) return 'Previous 7 days';
  return 'Older';
}
function when(c: ConvRow) {
  const d = new Date(c.changed_at);
  const diff = dayNum(etDay(Date.now())) - dayNum(etDay(d));
  if (diff <= 0) return d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  return d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
}
/** A title the Brain has not reworded yet is the question as typed: shown with a capital and without the question mark. */
const title = (t: string) => {
  t = String(t || '').trim().replace(/[?]+$/, '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'New chat';
};
const ORDER = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Older'];

function Rename({ c, e }: { c: ConvRow; e: BrainEngine }) {
  const el = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    el.current?.focus();
    el.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    void e.rename(c, el.current?.value || '', save);
  };
  return (
    <div className="cvr is-edit" role="listitem">
      <span className="cvr__ic" aria-hidden="true">
        {I.chat}
      </span>
      <input
        ref={el}
        defaultValue={c.title}
        aria-label="Rename the chat"
        maxLength={80}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            finish(ev.key === 'Enter');
          }
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

function Row({ c, e, on, work, onOpen }: { c: ConvRow; e: BrainEngine; on: boolean; work: boolean; onOpen: (id: string) => void }) {
  const [sure, setSure] = useState(false);
  const [gone, setGone] = useState(false);
  const n = (c.same || []).length;
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(t);
  }, [sure]);
  return (
    <div className={'cvr' + (on ? ' is-on' : '') + (c.pinned ? ' is-pin' : '') + (gone ? ' is-gone' : '')} role="listitem">
      <button type="button" className="cvr__go" aria-current={on ? 'true' : undefined} onClick={() => onOpen(c.id)}>
        <span className="cvr__ic" aria-hidden="true">
          {work ? <i className="cvr__work" /> : c.pinned ? I.pin : I.chat}
        </span>
        <span className="cvr__tx">
          <span className="cvr__top">
            <span className="cvr__t">{title(c.title)}</span>
            {n > 0 && (
              <span className="cvr__n" title={'Asked ' + (n + 1) + ' times'}>
                {n + 1}&times;
              </span>
            )}
            <span className="cvr__tm">{when(c)}</span>
          </span>
          <span className="cvr__p">{work ? 'Answering...' : c.preview || ((c.turns || 0) > 1 ? c.turns + ' questions' : '')}</span>
        </span>
      </button>
      <span className="cvr__acts">
        <button type="button" className="cvr__a" aria-label={(c.pinned ? 'Unpin ' : 'Pin ') + c.title} title={c.pinned ? 'Unpin' : 'Pin'} aria-pressed={c.pinned ? true : undefined} onClick={() => void e.pin(c)}>
          {I.pin}
        </button>
        <button type="button" className="cvr__a" aria-label={'Rename ' + c.title} title="Rename" onClick={() => e.startRename(c.id)}>
          {I.edit}
        </button>
        <button
          type="button"
          className={'cvr__a cvr__a--del' + (sure ? ' is-sure' : '')}
          aria-label={sure ? 'Press again to delete' : 'Delete ' + c.title}
          title={sure ? 'Press again to delete' : 'Delete'}
          onClick={() => {
            if (!sure) return setSure(true);
            setGone(true);
            setTimeout(() => void e.remove(c), 200);
          }}
        >
          {I.del}
        </button>
      </span>
    </div>
  );
}

export function ConvList({ e, list, cur, working, q, found, renaming, empty, onOpen }: { e: BrainEngine; list: ConvRow[]; cur?: string | null; working?: string | null; q?: string; found?: Set<string> | null; renaming?: string | null; empty?: string; onOpen: (id: string) => void }) {
  const words = String(q || '').trim().toLowerCase();
  const rows = words ? list.filter((c) => (c.title || '').toLowerCase().includes(words) || (c.preview || '').toLowerCase().includes(words) || (found && found.has(c.id))) : list;
  const groups: Record<string, ConvRow[]> = {};
  rows.forEach((c) => (groups[group(c)] = groups[group(c)] || []).push(c));
  if (!rows.length) return <div className="cvr-none">{words ? 'No chats match.' : empty || 'Your chats show here for 30 days.'}</div>;
  return (
    <>
      {ORDER.filter((g) => groups[g]).map((g) => (
        <div key={g} style={{ display: 'contents' }}>
          <div className="cvr-grp" role="presentation">
            {g}
          </div>
          {groups[g].map((c) => (renaming === c.id ? <Rename key={c.id} c={c} e={e} /> : <Row key={c.id} c={c} e={e} on={cur === c.id} work={!!c.pending || working === c.id} onOpen={onOpen} />))}
        </div>
      ))}
    </>
  );
}
