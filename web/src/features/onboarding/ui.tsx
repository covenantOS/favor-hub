// The small pieces both onboarding screens share, with the classic markup and class names (public/js/onboard/common.js and
// request-tasks.js): icons, an avatar, a toast, a sheet that is a dialog on a desktop and a bottom sheet on a phone, a person field that
// sits inside a form, and the person picker sheet. Everything that touches the page (window, document, matchMedia) runs in effects and
// handlers, and the sheets mount after hydration through BodyPortal, so the server and the browser draw the same text.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BodyPortal } from '@/shell/BodyPortal';
import { hue, initials, matchPeople, personIn, personSub, type Fresh, type Person } from './logic';
import { staffQuery } from './queries';

const ICON: Record<string, string> = {
  check: '<path d="m5 12 5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17"/><path d="M3 21h18M12 12h.01"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

/** One of the page's icons. The paths are fixed strings in this file, never data from the server. */
export function Ic({ name }: { name: keyof typeof ICON }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] || '' }} />;
}

/* ---------------------------------------------------------------- the staff list */

const NO_PEOPLE: Person[] = [];

/** The staff list from the shared read (empty until it arrives). */
export function usePeople(): Person[] {
  return useQuery(staffQuery).data?.people ?? NO_PEOPLE;
}

export function Avatar({ email, size }: { email: string; size?: 'sm' }) {
  const people = usePeople();
  const p = personIn(people, email);
  return (
    <span className={'rq-av' + (size ? ' rq-av--' + size : '')} data-entity={'person:' + String(email || '').toLowerCase()} data-label={p.name} data-c={hue(String(email || ''))}>
      {p.picture ? <img src={p.picture} alt="" referrerPolicy="no-referrer" /> : initials(p.name)}
    </span>
  );
}

export function useNameOf(): (email: string | null | undefined) => string {
  const people = usePeople();
  return useCallback((email) => personIn(people, email).name, [people]);
}

/* ---------------------------------------------------------------- a toast */

let toastEl: HTMLDivElement | null = null;
let toastT: ReturnType<typeof setTimeout> | undefined;

/** The hub's stacked toast when it is loaded, otherwise a small one of this page's own. Browser only. */
export function toast(msg: string, bad = false): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { hubToast?: (m: string, o: Record<string, unknown>) => void };
  if (w.hubToast) {
    w.hubToast(msg, { tone: bad ? 'bad' : '' });
    return;
  }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'ob-toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  const el = toastEl;
  el.textContent = msg;
  el.classList.toggle('is-bad', bad);
  el.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('is-on'), bad ? 5200 : 2600);
}

/* ---------------------------------------------------------------- a dialog on a desktop, a sheet on a phone */

const isPhone = (): boolean => typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches;

interface HubOv {
  on: (f: () => void) => unknown;
  off: (t: unknown) => void;
}

function DialogView({ label, cls, onClose, children }: { label: string; cls?: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const ret = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('rt-sheet-open');
    const ov = (window as unknown as { hubOv?: HubOv }).hubOv;
    const tok = ov ? ov.on(() => closeRef.current()) : null;
    // The sheet ends at the top of the on-screen keyboard, never under it.
    const vv = window.visualViewport;
    const fit = () => {
      const bottom = vv ? Math.max(0, Math.round(window.innerHeight - vv.offsetTop - vv.height)) : 0;
      document.documentElement.style.setProperty('--rt-kb', bottom + 'px');
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // An open person list closes first.
      if ((e.target as HTMLElement | null)?.closest?.('[aria-expanded="true"]')) return;
      e.stopPropagation();
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      document.documentElement.classList.remove('rt-sheet-open');
      if (tok && ov) ov.off(tok);
      if (ret && ret.focus && document.contains(ret)) {
        try {
          ret.focus({ preventScroll: true });
        } catch {
          // the control is gone
        }
      }
    };
  }, []);
  return (
    <>
      <div className="rt-scrim" onClick={() => onClose()} />
      <div className={'rt-sheet' + (cls ? ' ' + cls : '')} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>
  );
}

/** The bare dialog (scrim and panel). Mounts after hydration. */
export const Dialog = (p: { label: string; cls?: string; onClose: () => void; children: ReactNode }) =>
  BodyPortal(
    <DialogView label={p.label} cls={p.cls} onClose={p.onClose}>
      {p.children}
    </DialogView>
  );

/** A sheet with a title, a body that scrolls and footer buttons. */
export function Sheet({ title, onClose, foot, children }: { title: string; onClose: () => void; foot: ReactNode; children: ReactNode }) {
  return (
    <Dialog label={title} cls="ob-sheet" onClose={onClose}>
      <div className="rt-sheet__head">
        <h2>{title}</h2>
        <button type="button" className="rt-x" aria-label="Close" onClick={onClose}>
          <Ic name="x" />
        </button>
      </div>
      <div className="ob-sheet__body">{children}</div>
      <div className="rt-sheet__foot">{foot}</div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- a person field inside a form */

/** Type to search the staff list, press a name to choose. `value` is the chosen address ('' for nobody). */
export function PersonField({ value, onChange, label, placeholder, exclude }: { value: string; onChange: (email: string) => void; label: string; placeholder?: string; exclude?: string[] }) {
  const people = usePeople();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const chosen = value ? personIn(people, value) : null;
  const skip = useMemo(() => new Set((exclude || []).map((e) => e.toLowerCase())), [exclude]);
  const shown = useMemo(() => matchPeople(people, q).filter((p) => !skip.has(p.email)).slice(0, 30), [people, q, skip]);

  const choose = (email: string) => {
    setQ('');
    setOpen(false);
    onChange(email);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (!open && e.key === 'ArrowDown') {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, Math.min(shown.length - 1, h + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && shown[hi]) {
      e.preventDefault();
      choose(shown[hi].email);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };
  return (
    <div className="ob-pf">
      <div className="ob-pf__box">
        <span className="ob-pf__face">{chosen ? <Avatar email={chosen.email} size="sm" /> : null}</span>
        <input
          ref={input}
          type="text"
          className="ob-in"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label={label}
          placeholder={placeholder || 'Search by name or team'}
          value={chosen ? chosen.name : q}
          onFocus={() => {
            setHi(0);
            setOpen(true);
          }}
          onChange={(e) => {
            if (value) onChange('');
            setQ(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onKeyDown={keys}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              if (!value) setQ('');
            }, 120)
          }
        />
        <button
          type="button"
          className="ob-pf__x"
          aria-label="Clear"
          hidden={!value}
          onClick={() => {
            setQ('');
            onChange('');
            input.current?.focus();
          }}
        >
          <Ic name="x" />
        </button>
      </div>
      <div className="ob-pf__list" role="listbox" hidden={!open}>
        {shown.length ? (
          shown.map((p, i) => (
            <button key={p.email} type="button" role="option" aria-selected={i === hi} className={'ob-pf__opt' + (i === hi ? ' is-hi' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p.email)}>
              <Avatar email={p.email} size="sm" />
              <span>
                <b>{p.name}</b>
                <small>{personSub(p)}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="ob-pf__none">Nobody on the staff list matches.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the person picker sheet */

/** Who owns this step, who takes over their work: a search box over the staff list. Calls onPick with the address. */
export function PickSheet({ title, current, exclude, onPick, onClose }: { title: string; current?: string; exclude?: string[]; onPick: (email: string) => void; onClose: () => void }) {
  const people = usePeople();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [phone, setPhone] = useState(true);
  const box = useRef<HTMLInputElement>(null);
  const skip = useMemo(() => new Set((exclude || []).map((e) => String(e).toLowerCase())), [exclude]);
  const shown = useMemo(() => matchPeople(people, q).filter((p) => !skip.has(p.email)), [people, q, skip]);
  const at = Math.min(hi, Math.max(0, shown.length - 1));
  useEffect(() => {
    const ph = isPhone();
    setPhone(ph);
    if (!ph) setTimeout(() => box.current?.focus(), 0);
  }, []);
  const list = useRef<HTMLDivElement>(null);
  const move = (to: number) => {
    setHi(to);
    (list.current?.children[to] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  };
  return (
    <Dialog label={title} onClose={onClose}>
      <div className="rt-sheet__head">
        <h2>{title}</h2>
        <button type="button" className="rt-x" aria-label="Close" onClick={onClose}>
          <Ic name="x" />
        </button>
      </div>
      <div className="rt-search">
        <Ic name="search" />
        <input
          ref={box}
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
              move(Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1))));
            }
            if (e.key === 'Enter' && shown[at]) {
              e.preventDefault();
              onPick(shown[at].email);
            }
          }}
        />
      </div>
      <div className="rt-people" role="listbox" aria-label="Staff" ref={list}>
        {shown.length ? (
          shown.map((p, i) => (
            <button key={p.email} type="button" role="option" aria-selected={p.email === current} className={'rt-person' + (p.email === current ? ' is-on' : '') + (!phone && i === at ? ' is-hi' : '')} onClick={() => onPick(p.email)}>
              <Avatar email={p.email} size="sm" />
              <span className="rt-person__t">
                <b>{p.name}</b>
                {personSub(p) ? <small>{personSub(p)}</small> : null}
              </span>
              {p.email === current ? (
                <span className="rt-person__ok">
                  <Ic name="check" />
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <p className="rt-none">Nobody on the staff list matches.</p>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- a run that was just started */

const FRESH_KEY = 'ob-new';

/** Remember a run the browser just started, so its page can say what was set up (it survives a full page load). Browser only. */
export const setFresh = (n: Fresh): void => {
  try {
    sessionStorage.setItem(FRESH_KEY, JSON.stringify(n));
  } catch {
    // no banner
  }
};

/** The note left by setFresh for this run, once. Browser only (call it from an effect). */
export function takeFresh(id: string): Fresh | null {
  try {
    const n = JSON.parse(sessionStorage.getItem(FRESH_KEY) || 'null') as Fresh | null;
    if (n && n.id === id) {
      sessionStorage.removeItem(FRESH_KEY);
      return n;
    }
  } catch {
    // no banner
  }
  return null;
}
