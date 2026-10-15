// Pieces both Projects pages use: the Connect Asana gate and chip, and the keyboard shortcuts (Ctrl or Cmd + K, a slash, Tab then Q).
import { useEffect, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { drawerOpen } from '../drawer';
import { asanaMeQuery } from '../lib/queries';
import { toast } from '../kit/toast';
import { openSwitcher } from '../sheets/Switcher';
import type { QuickAddDefaults } from '../lib/page';

export const AsanaLogo = ({ n }: { n: number }) => (
  <svg className="pj-alogo" width={n} height={n} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <circle cx="16" cy="9" r="6" fill="#F06A6A" />
    <circle cx="8" cy="22" r="6" fill="#F06A6A" />
    <circle cx="24" cy="22" r="6" fill="#F06A6A" />
  </svg>
);

const here = () => (typeof window === 'undefined' ? '/projects/' : window.location.pathname + window.location.search);

/** Asana users connect Asana before Projects opens, so their edits reach Asana under their own name. The link brings them back here. */
export function ConnectGate({ children }: { children: ReactNode }) {
  const { data: me } = useSuspenseQuery(asanaMeQuery);
  if (me && me.required && !me.connected) {
    return (
      <div id="pj-root" className="pj" data-page="connect" data-ready="1">
        <section className="pj-connect">
          <div className="pj-connect__marks">
            <span className="pj-fmark" aria-hidden="true">
              F
            </span>
            <span className="pj-connect__plus">+</span>
            <AsanaLogo n={44} />
          </div>
          <h1>Connect your Asana account</h1>
          <p>Favor uses Asana for projects right now. Connect your Asana account so your changes here sync to Asana under your name. We may move fully into FavorOS later.</p>
          <a className="pj-connect__btn" href={'/api/asana/oauth/connect?back=' + encodeURIComponent(here())}>
            <AsanaLogo n={22} />
            Connect Asana
          </a>
        </section>
      </div>
    );
  }
  return <>{children}</>;
}

/** On a synced project, a person who has not connected gets a link, so their edits reach Asana as them. */
export function AsanaChip() {
  const qc = useQueryClient();
  const { data: me } = useQuery(asanaMeQuery);
  if (!me || me.ok === false) return null;
  if (!me.connected && !me.asana_user) return null;
  return (
    <span className="pj-asana-connect">
      {me.connected ? (
        <>
          <span className="pj-tag pj-tag--asana pj-achip">
            <AsanaLogo n={14} />
            Connected{me.asana_name ? ' as ' + me.asana_name : ''}
          </span>
          <button
            type="button"
            className="pj-asana-off"
            onClick={async () => {
              await fetch('/api/asana/oauth/me', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).catch(() => null);
              await qc.invalidateQueries({ queryKey: asanaMeQuery.queryKey });
              location.reload();
            }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <a className="pj-tag pj-asana-link pj-achip" href={'/api/asana/oauth/connect?back=' + encodeURIComponent(here())}>
          <AsanaLogo n={14} />
          Connect Asana
        </a>
      )}
    </span>
  );
}

/**
 * Ctrl or Cmd + K opens the Projects switcher, ahead of the site search. A slash focuses the task search. Tab, then Q, opens quick add from
 * anywhere that is not a text field; any other key cancels it.
 */
export function useProjectsKeys(o: { projectKey: string; openTask: (ref: string) => void; quickAdd: (d?: QuickAddDefaults) => void }) {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    const typingIn = (a: Element | null) => !!a && ((a as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
    const key1 = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const typing = typingIn(a);
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopImmediatePropagation();
        openSwitcher({ projectKey: ref.current.projectKey, open: (r) => ref.current.openTask(r) });
        return;
      }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !drawerOpen() && !document.querySelector('.pj-sheet')) {
        const q = document.querySelector<HTMLInputElement>('.pj-tools [data-q], [data-mq]');
        if (q) {
          e.preventDefault();
          e.stopImmediatePropagation();
          q.focus();
          q.select();
        }
      }
    };
    let armed = 0;
    const key2 = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = typingIn(el);
      if (e.key === 'Tab' && !e.shiftKey && !typing && !e.ctrlKey && !e.metaKey && !drawerOpen() && !document.querySelector('.pj-sheet')) {
        const cardOrBody = el === document.body || !el || el.classList.contains('pj-row') || el.classList.contains('pj-card');
        if (cardOrBody && !armed) {
          e.preventDefault();
          armed = Date.now();
          toast('Press Q to add a task');
          setTimeout(() => {
            armed = 0;
          }, 1500);
          return;
        }
      }
      if (armed && (e.key === 'q' || e.key === 'Q') && !typing) {
        e.preventDefault();
        armed = 0;
        ref.current.quickAdd({});
        return;
      }
      if (e.key !== 'Tab') armed = 0;
    };
    document.addEventListener('keydown', key1, true);
    document.addEventListener('keydown', key2);
    return () => {
      document.removeEventListener('keydown', key1, true);
      document.removeEventListener('keydown', key2);
    };
  }, []);
}
