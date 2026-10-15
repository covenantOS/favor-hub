// Keys that work on every Actions view (public/js/work-edit.js keyboard): n new action, ? the list of keys, u or z undo the last change,
// e edit the focused row, c complete the selection or the focused row.
import { useEffect } from 'react';
import { openComplete } from './BulkDialogs';
import { openKeys, openNew } from './EditDialogs';
import { openEditPanel } from './EditPanel';
import { recentNow, undoBatch, workNow } from './engine';
import { wcGet } from './store';

export function useWorkKeys() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
      if (typing || (e.ctrlKey && e.key.toLowerCase() !== 'z') || e.metaKey || e.altKey) return;
      if (document.querySelector('.wc-dlg, .wc-drawer, .pt-side.is-on, .wm-dlg')) return;
      const s = wcGet();
      const k = e.key;
      if (k === 'n') {
        e.preventDefault();
        openNew();
        return;
      }
      if (k === '?') {
        e.preventDefault();
        openKeys();
        return;
      }
      if (k === 'u' || k === 'z') {
        // A held key is one press. A change whose Undo was already pressed is skipped, so a second press takes back the change before it.
        if (e.repeat) {
          e.preventDefault();
          return;
        }
        if (s.toast?.bid && !s.undoing.has(s.toast.bid)) {
          e.preventDefault();
          void undoBatch(s.toast.bid);
          return;
        }
        const b = recentNow().find((x) => !x.undone && !x.undoing && !s.undoing.has(x.id) && Date.parse(x.undo_until) > Date.now());
        if (b) {
          e.preventDefault();
          void undoBatch(b.id);
        }
        return;
      }
      const row = (document.activeElement as HTMLElement | null)?.closest?.('tr[data-pt-row]') as HTMLElement | null;
      const id = row?.dataset.id;
      const w = workNow();
      if (!w) return;
      if (k === 'e' && id && w.byId[id]) {
        e.preventDefault();
        openEditPanel(id);
        return;
      }
      if (k === 'c') {
        const sel = [...s.sel].filter((x) => w.byId[x]);
        if (sel.length) {
          e.preventDefault();
          openComplete(sel);
        } else if (id && w.byId[id]) {
          e.preventDefault();
          openComplete([id]);
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
}
