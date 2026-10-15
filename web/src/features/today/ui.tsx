// Small parts shared across Today: icons, the type chip, the clock, the ids that hold space, and what the browser's classic helpers offer.
import { useEffect, useState, type ReactNode } from 'react';
import { TYPE } from './rank';

export const P: Record<string, string> = {
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  chat: '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7.2L7 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 4.5-5.5"/>',
  request: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  meeting: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  handoff: '<path d="M4 12h12"/><path d="m12 6 6 6-6 6"/><path d="M20 5v14"/>',
  expense: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6"/><path d="M9 11h6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  leaf: '<path d="M12 4c3 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16"/><path d="M9 3v4"/><path d="M15 3v4"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  note: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8"/><path d="M8 12h5"/>',
  learn: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7"/><path d="M8 11h5"/>',
  spark: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m5.6 18.4 2.1-2.1"/><path d="m16.3 7.7 2.1-2.1"/>',
  teams: '<path d="M6 8h12"/><path d="M12 8v9"/>',
  ring: '<circle cx="12" cy="12" r="5"/>',
  arrow: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};

export function Ic({ n, cls }: { n: string; cls?: string }) {
  return <svg className={'h-i' + (cls ? ' ' + cls : '')} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[n] || P.flag }} />;
}

export function TypeChip({ t }: { t: string }) {
  const d = TYPE[t] || TYPE.task;
  return (
    <span className="td-type" data-tone={d.tone}>
      <Ic n={d.icon} />
      <span>{d.label}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- the clock */
// The time a render uses. The server's answer is the moment it renders (never a value kept from when the Worker started), and the browser
// takes its first value from the same page load and then moves once a minute, so "5m" and "Due in 2 h" tick together.
// A repeat visit is drawn from the page the service worker kept (public/sw.js), which can be hours old. The worker says when the server drew it
// (window.__hubNow) so the first browser render prints the same times the page already holds and hydration matches; the clock then moves to
// the real time at once, and the value is dropped so a later visit to Today inside the app starts from the real time.
declare global {
  interface Window {
    __hubNow?: number;
  }
}
export const renderNow = () => (typeof window !== 'undefined' && window.__hubNow) || Date.now();
export function useNow(): number {
  const [now, setNow] = useState(renderNow);
  useEffect(() => {
    setNow(Date.now());
    delete window.__hubNow;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** A row that holds space: the box a card shows until its read answers. */
export const Skel = ({ n, cls = 'td-skel' }: { n: number; cls?: string }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <li key={i} className={cls} aria-hidden="true">
        <i />
        <i />
      </li>
    ))}
  </>
);

/** Classic helpers the shell loads after the first paint (thank-you pop, snooze, hand-off, drill-down, entity cards). */
export interface Helpers {
  FavorWG?: { pop: (el: Element, g: Record<string, unknown>, o?: Record<string, unknown>) => void };
  FavorTodayInbox?: {
    toast: (msg: string, undo?: (() => void) | null) => void;
    openHandoff: (id: string) => void;
    nudge: (it: unknown, done: () => void) => void;
    clear: (id: string) => Promise<unknown>;
    unclear: (id: string) => Promise<unknown>;
    stop: (id: string) => Promise<unknown>;
    unstop: (id: string) => Promise<unknown>;
  };
  FavorChatView?: { open: (item: Record<string, unknown>) => void; close: () => void; onClose: (() => void) | null };
  FavorCall?: { open: (cid: string) => void };
  FavorDrill?: { open: (spec: Record<string, unknown>) => void; openAsync: (spec: Record<string, unknown>, load: () => Promise<unknown>) => Promise<unknown> };
  FavorPartner?: { search: (el: Element, o: Record<string, unknown>) => HTMLInputElement | null; openCompose: (cid: string, kind: string) => void };
  FavorUI?: { short: (v: number) => string };
  hubSnoozeButton?: (kind: string, id: string, label: string, extra?: string) => string;
  hubMotion?: { letGo?: (el: Element) => void };
  hubOv?: { on: (close: () => void) => unknown; off: (t: unknown) => void };
  copyStamps?: () => void;
}
export const helpers = (): Helpers => (typeof window === 'undefined' ? {} : (window as unknown as Helpers));

/** A card's title row. */
export const CardHead = ({ id, title, children }: { id: string; title: string; children?: ReactNode }) => (
  <header className="td-ch">
    <h2 id={id}>{title}</h2>
    {children}
  </header>
);
