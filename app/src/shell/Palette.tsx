import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import type { Access } from '@shared/schemas';
import { hubOv } from '@/lib/hubOv';
import { isInApp, useServedRoutes } from './NavLink';
import { filterLocal, mergeHits, runSource, TIERS, typedRows, type Hit, type SourceKind } from './paletteSources';
import { entityStore } from '@/features/entity/store';

interface Props {
  access: Partial<Access> & Record<string, unknown>;
  kpiTeams: string[];
}

const REMOTE_ORDER: SourceKind[] = ['find', 'partners', 'requests', 'projects', 'reports', 'chats', 'meetings', 'messages', 'clips', 'learn', 'drive'];

/** Ctrl K search. Tier 1 is local (pages, tools, help) and redraws on every keystroke; tiers 2 and 3 ask the server after a short pause. */
export function Palette({ access, kpiTeams }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [remote, setRemote] = useState<Partial<Record<SourceKind, Hit[]>>>({});
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seq = useRef(0);
  const router = useRouter();
  const served = useServedRoutes();

  const items = useQuery({
    queryKey: ['palette'],
    enabled: open,
    staleTime: 60 * 60_000,
    queryFn: async () => ((await (await fetch('/palette.json', { credentials: 'same-origin' })).json()) as { items: Hit[] }).items,
  });

  const allowed = useCallback(
    (i: Hit) => {
      if (i.early && !access.early) return false;
      if (!i.need && !i.team && !i.early) return true;
      if (i.need && !access[i.need]) return false;
      if (i.team && !kpiTeams.includes(i.team)) return false;
      return true;
    },
    [access, kpiTeams]
  );

  const shown = useMemo(() => {
    const local = filterLocal(items.data || [], text, allowed);
    const extra = REMOTE_ORDER.flatMap((k) => remote[k] || []);
    return mergeHits(local, [...extra, ...typedRows(text, !!access.mail)]);
  }, [items.data, text, remote, allowed, access.mail]);

  const close = useCallback(() => setOpen(false), []);

  // Open from any button marked data-cmdk-open, and from the keyboard.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('[data-cmdk-open]')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const k = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const active = document.activeElement as HTMLElement | null;
      const slash = e.key === '/' && !open && !(active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) && !(active && active.isContentEditable);
      if (k) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (slash) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    // Clear on close, not on open: typing can land between the open and this effect.
    if (!open) {
      setText('');
      setRemote({});
      setSel(0);
      return;
    }
    requestAnimationFrame(() => input.current?.focus());
    document.body.style.overflow = 'hidden';
    const tok = hubOv.on(close);
    return () => {
      document.body.style.overflow = '';
      hubOv.off(tok);
    };
  }, [open, close]);

  // The server tiers, after a short pause. A late answer applies only when nothing was typed since.
  useEffect(() => {
    const t = text.trim();
    const mine = ++seq.current;
    setRemote({});
    if (!open || t.length < 2) return;
    const timer = setTimeout(async () => {
      const hasChat = !!access.chat;
      for (const tier of TIERS) {
        await Promise.all(
          tier.filter((kind) => kind !== 'meetings' || !!access.meetings).map((kind) =>
            runSource(kind, t, hasChat)
              .then((hits) => {
                if (mine === seq.current) setRemote((r) => ({ ...r, [kind]: hits }));
              })
              .catch(() => undefined)
          )
        );
        if (mine !== seq.current) return;
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [text, open, access.chat]);

  useEffect(() => setSel(0), [text]);
  useEffect(() => {
    list.current?.querySelector('li.is-sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel, shown]);

  const go = (item: Hit | undefined) => {
    if (!item) return;
    if (item.href === '#nav-toggle') {
      close();
      window.dispatchEvent(new Event('hub-nav-toggle'));
      return;
    }
    if (item.href.startsWith('#entity:')) {
      const [, kind, ...rest] = item.href.split(':');
      close();
      entityStore.openCard(kind, rest.join(':'), item.title);
      return;
    }
    if (item.external) {
      window.open(item.href, '_blank', 'noopener');
      close();
      return;
    }
    const rq = /^\/requests\/\?r=/.test(item.href) && (window as unknown as { FavorRequest?: { open(id: string): void } }).FavorRequest ? new URL(item.href, location.href).searchParams.get('r') : '';
    const run = () => {
      const w = window as unknown as { FavorRequest?: { open(id: string): void } };
      if (rq && w.FavorRequest) w.FavorRequest.open(rq);
      else if (isInApp(item.href, served)) router.history.push(item.href);
      else window.location.href = item.href;
      close();
    };
    if (hubOv.depth()) hubOv.unwind(run);
    else run();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go(shown[sel]);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  let last: string | null = null;
  return (
    <div className="cmdk" id="cmdk" hidden={!open} role="dialog" aria-modal="true" aria-label="FavorOS search">
      <div className="cmdk__overlay" data-cmdk-close onClick={(e) => { e.preventDefault(); close(); }} />
      <div className="cmdk__panel">
        <div className="cmdk__head">
          <svg className="cmdk__search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input ref={input} type="text" id="cmdk-input" placeholder="Jump to anything…" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Search" value={text} onChange={(e) => setText(e.target.value)} />
          <kbd className="cmdk__esc" data-cmdk-close onClick={(e) => { e.preventDefault(); close(); }}>esc</kbd>
        </div>
        <ul className="cmdk__list" id="cmdk-list" role="listbox" aria-label="Search results" ref={list}>
          {shown.map((item, idx) => {
            const head = item.group !== last;
            last = item.group;
            return (
              <FragmentRow key={idx + item.href} head={head ? item.group : null}>
                <li role="option" aria-selected={idx === sel} className={idx === sel ? 'is-sel' : undefined} data-idx={idx} data-href={item.href} data-ext={String(!!item.external)} onClick={() => go(item)}>
                  <span className="cmdk__row-title">{item.title}</span>
                  <span className="cmdk__row-desc">{item.desc}</span>
                  <span className="cmdk__row-arrow" aria-hidden="true">↵</span>
                </li>
              </FragmentRow>
            );
          })}
        </ul>
        <div className="cmdk__empty" id="cmdk-empty" hidden={shown.length > 0}>
          No matches. Try another search.
        </div>
        <div className="cmdk__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>&nbsp;navigate
          </span>
          <span>
            <kbd>↵</kbd>&nbsp;open
          </span>
          <span>
            <kbd>esc</kbd>&nbsp;close
          </span>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ head, children }: { head: string | null; children: React.ReactNode }) {
  return (
    <>
      {head && (
        <li className="cmdk__group" aria-hidden="true">
          {head}
        </li>
      )}
      {children}
    </>
  );
}
