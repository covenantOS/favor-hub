// Pickers: owner (the staff list), due date, priority, status, section, codes and tasks. Each returns a promise; undefined (or null for
// the people picker) means dismissed. Ported from public/js/projects/ui-pickers.js and the people picker in public/js/request-tasks.js.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { addDays, dueLabel, mondayOf, PRIORITY, STATUS, todayStr } from '../lib/dates';
import { getActiveStaff } from '../lib/staff';
import type { Person, Section, Task } from '../types';
import { Icon } from './Icon';
import { choose, debounce, isPhone, mountOverlay, openSheet, type ChooseItem } from './overlays';

export const CODE_KINDS = [
  { kind: 'appeal', field: 'appeal_code', label: 'Appeal' },
  { kind: 'source', field: 'source_code', label: 'Source' },
  { kind: 'fund', field: 'fund_code', label: 'Fund' },
  { kind: 'campaign', field: 'campaign_code', label: 'Campaign' },
] as const;

/* ---------------------------------------------------------------- the people picker (rt-sheet) */
const COLORS = ['sun', 'sky', 'leaf', 'dusk', 'terra', 'teal', 'slate'];
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const initialsOf = (name: string) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
const subOf = (p: Person) => [p.team, p.title].filter(Boolean).join(' · ');

/** The request-board avatar (rq-av): the picture, or the initials. */
export function RqAvatar({ p, size }: { p: Person; size?: string }) {
  const email = String(p.email || '').toLowerCase();
  return (
    <span className={'rq-av' + (size ? ' rq-av--' + size : '')} data-entity={'person:' + email} data-label={p.name} data-c={COLORS[hash(email) % 7]}>
      {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" /> : initialsOf(p.name)}
    </span>
  );
}

// Every word typed must appear; a first name that starts with it comes first, then any name that does, then the rest.
export function matchPeople(list: Person[], q: string): Person[] {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list.slice();
  const rank = (p: Person) => {
    const n = p.name.toLowerCase();
    if (n.startsWith(words[0])) return 0;
    if (n.split(/\s+/).some((w) => w.startsWith(words[0]))) return 1;
    return 2;
  };
  return list
    .filter((p) => words.every((w) => `${p.name} ${p.email} ${p.team || ''} ${p.title || ''}`.toLowerCase().includes(w)))
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p);
}

export interface PickOpts {
  title?: string;
  current?: string | null;
  exclude?: (string | null | undefined)[];
  note?: boolean;
  noteLabel?: string;
  action?: string;
  clear?: string;
}
export type PickResult = { email: string | null; note?: string } | null;

function PeopleBody({ opts, finish }: { opts: PickOpts; finish: (r: PickResult) => void }) {
  const staff = getActiveStaff();
  const exclude = new Set((opts.exclude || []).filter(Boolean).map((e) => String(e).toLowerCase()));
  const title = opts.title || 'Pick a person';
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [note, setNote] = useState('');
  const shown = matchPeople(staff.list, q).filter((p) => !exclude.has(p.email.toLowerCase()));
  const qRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (picked === null && !isPhone()) {
      const t = setTimeout(() => qRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    if (picked !== null) {
      const t = setTimeout(() => taRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [picked]);
  const chosen = (email: string) => {
    if (opts.note) setPicked(email);
    else finish({ email });
  };
  const hiIdx = Math.min(hi, Math.max(0, shown.length - 1));

  if (picked !== null) {
    const p = staff.personOf(picked)!;
    const sub = subOf(staff.by.get(picked.toLowerCase()) || p);
    return (
      <>
        <div className="rt-sheet__head">
          <button type="button" className="rt-x" onClick={() => setPicked(null)} aria-label="Back to the list">
            <Icon name="back" />
          </button>
          <h2>{title}</h2>
          <button type="button" className="rt-x" onClick={() => finish(null)} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="rt-to">
          <RqAvatar p={p} />
          <span className="rt-person__t">
            <b>{p.name}</b>
            {sub ? <small>{sub}</small> : null}
          </span>
        </div>
        <label className="rt-label" htmlFor="rt-note">
          {opts.noteLabel || 'Context'}
        </label>
        <textarea
          id="rt-note"
          ref={taRef}
          className="rt-note"
          rows={5}
          maxLength={2000}
          placeholder={`What ${p.name.split(' ')[0]} needs to know`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              finish({ email: picked, note: note.trim() });
            }
          }}
        />
        <div className="rt-sheet__foot">
          <button type="button" className="rt-btn" onClick={() => setPicked(null)}>
            Back
          </button>
          <button type="button" className="rt-btn rt-btn--primary" onClick={() => finish({ email: picked, note: note.trim() })}>
            <Icon name="send" />
            {opts.action || 'Send'}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="rt-sheet__head">
        <h2>{title}</h2>
        <button type="button" className="rt-x" onClick={() => finish(null)} aria-label="Close">
          <Icon name="x" />
        </button>
      </div>
      <div className="rt-search">
        <Icon name="search" />
        <input
          ref={qRef}
          type="search"
          placeholder="Search by name or team"
          aria-label="Search by name or team"
          autoComplete="off"
          enterKeyHint="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setHi(Math.max(0, Math.min(shown.length - 1, hiIdx + (e.key === 'ArrowDown' ? 1 : -1))));
            }
            if (e.key === 'Enter' && shown[hiIdx]) {
              e.preventDefault();
              chosen(shown[hiIdx].email);
            }
          }}
        />
      </div>
      <div className="rt-people" role="listbox" aria-label="Staff">
        {shown.length ? (
          shown.map((p, i) => {
            const on = p.email === opts.current;
            return (
              <button key={p.email} type="button" className={'rt-person' + (on ? ' is-on' : '') + (i === hiIdx && !isPhone() ? ' is-hi' : '')} role="option" aria-selected={on} onClick={() => chosen(p.email)}>
                <RqAvatar p={p} size="sm" />
                <span className="rt-person__t">
                  <b>{p.name}</b>
                  {subOf(p) ? <small>{subOf(p)}</small> : null}
                </span>
                {on ? (
                  <span className="rt-person__ok">
                    <Icon name="check" />
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <p className="rt-none">Nobody on the staff list matches.</p>
        )}
      </div>
      {opts.clear ? (
        <div className="rt-sheet__foot">
          <button type="button" className="rt-btn" onClick={() => finish({ email: null })}>
            {opts.clear}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Resolves to {email, note?} (email null clears) or null when dismissed. */
export function pickOwner(o: PickOpts & { clear?: string } = {}): Promise<PickResult> {
  const opts: PickOpts = { title: 'Assign to', clear: 'No owner', ...o };
  return pickPerson(opts);
}

let rtOpen: (() => void) | null = null;
export function pickPerson(opts: PickOpts = {}): Promise<PickResult> {
  rtOpen?.();
  return new Promise((resolve) => {
    let closed = false;
    const ret = document.activeElement as HTMLElement | null;
    let off: () => void = () => undefined;
    const finish = (r: PickResult) => {
      if (closed) return;
      closed = true;
      off();
      rtOpen = null;
      document.documentElement.classList.remove('rt-sheet-open');
      resolve(r);
      if (ret && ret.focus) {
        try {
          ret.focus({ preventScroll: true });
        } catch {
          // gone
        }
      }
    };
    document.documentElement.classList.add('rt-sheet-open');
    off = mountOverlay(() => <PeopleSheet opts={opts} finish={finish} />);
    rtOpen = () => finish(null);
  });
}

function PeopleSheet({ opts, finish }: { opts: PickOpts; finish: (r: PickResult) => void }) {
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    const ov = (window as unknown as { hubOv?: { on: (f: () => void) => unknown; off: (t: unknown) => void } }).hubOv;
    const tok = ov ? ov.on(() => finishRef.current(null)) : null;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        finishRef.current(null);
      }
    };
    document.addEventListener('keydown', key, true);
    const vv = window.visualViewport;
    const fit = () => document.documentElement.style.setProperty('--rt-kb', (vv ? Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) : 0) + 'px');
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    return () => {
      document.removeEventListener('keydown', key, true);
      if (tok && ov) ov.off(tok);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
    };
  }, []);
  return (
    <>
      <div className="rt-scrim" onClick={() => finish(null)} />
      <div className="rt-sheet" role="dialog" aria-modal="true" aria-label={opts.title || 'Pick a person'}>
        <PeopleBody opts={opts} finish={finish} />
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- date, time, priority, status, section */
function DateBody({ title, value, sheet, onSet, type }: { title: string; value: string; sheet: { close: () => void }; onSet: (v: string) => void; type: 'date' | 'time' }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const d = ref.current;
      if (!d) return;
      d.focus();
      if (type === 'date' && d.showPicker && !isPhone()) {
        try {
          d.showPicker();
        } catch {
          // needs a gesture
        }
      }
    }, 30);
    return () => clearTimeout(t);
  }, [type]);
  const set = () => {
    if (v) {
      onSet(v);
      sheet.close();
    }
  };
  return (
    <>
      <input ref={ref} type={type} className="pj-date" aria-label={type === 'time' ? 'Due time, Eastern' : title} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set(); } }} />
      {type === 'time' ? <p className="pj-quiet" style={{ padding: '8px 14px 0' }}>Eastern time.</p> : null}
      <div className="pj-sheet__foot">
        <button type="button" className="pj-btn" data-sheet-x>
          Cancel
        </button>
        <button type="button" className="pj-btn pj-btn--primary" onClick={set}>
          {type === 'time' ? 'Set time' : 'Set date'}
        </button>
      </div>
    </>
  );
}

/** Resolves to a YYYY-MM-DD string, null for "no date", undefined when dismissed. */
export async function pickDate({ anchor, value, title = 'Due date' }: { anchor?: HTMLElement | null; value?: string | null; title?: string }): Promise<string | null | undefined> {
  const t = todayStr();
  const items: ChooseItem<string | null>[] = [
    { value: t, label: 'Today' },
    { value: addDays(t, 1), label: 'Tomorrow' },
    { value: addDays(mondayOf(t), 7), label: 'Next Monday' },
    { value: addDays(t, 7), label: 'In a week' },
    { value: '__pick', label: 'Pick a date' },
  ];
  if (value) items.push({ value: null, label: 'No date' });
  items.forEach((i) => {
    if (i.value === value) i.on = true;
  });
  const v = await choose<string | null>({ anchor, title, items });
  if (v === undefined || v === null || v !== '__pick') return v;
  return new Promise((resolve) => {
    let out: string | undefined;
    openSheet({
      title,
      cls: 'pj-sheet--date',
      render: (s) => <DateBody title={title} value={value || t} sheet={s} type="date" onSet={(x) => { out = x; }} />,
      onClose: () => resolve(out),
    });
  });
}

/** Resolves to HH:MM or undefined when dismissed. */
export function askTime(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out: string | undefined;
    openSheet({
      title: 'Due time',
      cls: 'pj-sheet--date',
      render: (s) => <DateBody title="Due time" value="09:00" sheet={s} type="time" onSet={(x) => { out = x; }} />,
      onClose: () => resolve(out),
    });
  });
}

export const pickPriority = ({ anchor, value }: { anchor?: HTMLElement | null; value?: string }) =>
  choose<string>({
    anchor,
    title: 'Priority',
    items: Object.entries(PRIORITY)
      .reverse()
      .map(([v, l]) => ({ value: v, label: l, on: v === value, icon: v === 'high' ? 'flag' : undefined })),
  });

export const pickStatus = ({ anchor, value }: { anchor?: HTMLElement | null; value?: string }) =>
  choose<string>({ anchor, title: 'Status', items: ['open', 'doing', 'waiting', 'done'].map((v) => ({ value: v, label: STATUS[v], on: v === value })) });

export function pickSection({ anchor, sections, value, none = 'No section' }: { anchor?: HTMLElement | null; sections: Section[]; value?: string | null; none?: string }) {
  const items: ChooseItem<string | null>[] = sections.map((s) => ({ value: s.id, label: s.name, on: s.id === value }));
  items.push({ value: null, label: none, on: !value });
  return choose<string | null>({ anchor, title: 'Section', items });
}

/* ---------------------------------------------------------------- codes and tasks */
const codeCache = new Map<string, Promise<{ code: string; description?: string }[]>>();
export function codesOf(kind: string, q?: string) {
  const key = kind + '|' + (q || '').toLowerCase();
  if (!codeCache.has(key))
    codeCache.set(
      key,
      api.codes(kind, q || '').then((d) => d.codes || []).catch((e) => {
        codeCache.delete(key);
        throw e;
      })
    );
  return codeCache.get(key)!;
}

/** Choose a Blackbaud code of one kind from the searchable list. Resolves to a code, null to remove it, undefined when dismissed. */
export function pickCode({ anchor, kind, value }: { anchor?: HTMLElement | null; kind: string; value?: string | null }) {
  const k = CODE_KINDS.find((x) => x.kind === kind)!;
  const build = (list: { code: string; description?: string }[], q: string) => {
    const items: ChooseItem<string | null>[] = list.map((c) => ({ value: c.code, label: c.code, hint: c.description, on: c.code === value }));
    if (value && !items.some((i) => i.value === value)) items.unshift({ value, label: value, hint: 'Current code', on: true });
    const typed = String(q || '').trim().toUpperCase().slice(0, 40);
    if (typed && !list.some((c) => c.code.toUpperCase() === typed)) items.push({ value: typed, label: 'Use ' + typed, hint: 'Not in the list', icon: 'plus' });
    if (value) items.push({ value: null, label: 'Remove ' + k.label.toLowerCase() + ' code', icon: 'x' });
    return items;
  };
  return choose<string | null>({ anchor, title: k.label + ' code', search: true, placeholder: 'Search ' + k.label.toLowerCase() + ' codes', items: [], source: async (q) => build(await codesOf(kind, q), q) });
}

/** Find a task to link (blockers). Resolves to a task or undefined. */
export function pickTask({ anchor, title = 'Find a task', exclude = [] }: { anchor?: HTMLElement | null; title?: string; exclude?: string[] }): Promise<Task | undefined> {
  const map = new Map<string, Task>();
  return choose<string>({
    anchor,
    title,
    search: true,
    placeholder: 'Search by title or code',
    items: [],
    source: async (q) => {
      const d = await api.tasks({ q, status: 'open', limit: 25 });
      return (d.tasks || [])
        .filter((t) => !exclude.includes(t.id))
        .map((t) => {
          map.set(t.id, t);
          return { value: t.id, label: t.title, hint: t.code || 'Personal task' };
        });
    },
  }).then((id) => (id ? map.get(id) : undefined));
}

export { debounce, dueLabel };
