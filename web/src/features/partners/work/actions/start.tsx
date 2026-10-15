// Where the Work Center opens for each person: a tab and what Open actions shows (public/js/work-start.js). The pill in the header opens
// the panel. Reads and writes /api/work/views/default.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { asParam, wcPut } from './api';
import { toast } from './engine';
import { startQuery, type StartPref } from './queries';
import { closeDialog, setFilters } from './store';
import { hasTab, tabLabel, tabsFor } from './tabs';
import { Dialog, Ic } from './ui';
import type { Me } from './types';

export const SCOPES: [string, string][] = [
  ['mine', 'Mine'],
  ['partners', 'On my partners'],
  ['all', 'Everyone'],
];

/** The tab the Work Center opens on: the saved one, else the role's default, else Open actions. */
export function startTab(start: StartPref | undefined, me: Me): string {
  if (start?.pref && hasTab(start.pref.tab, me)) return start.pref.tab;
  if (start && hasTab(start.defaultTab, me)) return start.defaultTab;
  return 'open';
}
/** The scope Open actions starts on: the saved one, else Mine for someone with a fundraiser id, else Everyone. */
export const startScope = (start: StartPref | undefined, me: Me): string => (start?.pref && start.pref.scope) || (me.fid ? 'mine' : 'all');

/** Mine, On my partners or Everyone, laid into the Open actions filters. */
export function applyScope(scope: string, me: Me) {
  const fid = me.fid;
  if (scope === 'mine' && fid) setFilters({ scope: '', fr: fid, theirs: false });
  else if (scope === 'partners' && fid) setFilters({ scope: 'partners', fr: '', theirs: false });
  else if (scope === 'all') setFilters({ scope: '', fr: '', theirs: false });
}

export async function saveStart(qc: ReturnType<typeof useQueryClient>, tab: string, scope: string) {
  const r = await wcPut<{ start: StartPref }>('/api/work/views/default', { tab, scope });
  qc.setQueryData(startQuery(asParam()).queryKey, r.start);
  return r.start;
}

export function StartPanel({ start, me }: { start: StartPref | undefined; me: Me }) {
  const qc = useQueryClient();
  const tabs = tabsFor(me);
  const [tab, setTab] = useState(startTab(start, me));
  const [scope, setScope] = useState(startScope(start, me));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await saveStart(qc, tab, me.fid ? scope : '');
      closeDialog();
      toast('The Work Center opens on ' + tabLabel(tab, me) + '.');
    } catch (e) {
      setBusy(false);
      toast((e as Error).message);
    }
  };
  const reset = async () => {
    setBusy(true);
    try {
      const r = await wcPut<{ start: StartPref }>('/api/work/views/default', { reset: true });
      qc.setQueryData(startQuery(asParam()).queryKey, r.start);
      closeDialog();
      toast('The Work Center opens on ' + tabLabel(startTab(r.start, me), me) + '.');
    } catch (e) {
      setBusy(false);
      toast((e as Error).message);
    }
  };
  return (
    <Dialog label="Where the Work Center opens">
      <div className="wc-dlg__head">
        <div>
          <span className="h-label">Start view</span>
          <h2>Where the Work Center opens</h2>
        </div>
        <button type="button" className="wc-dlg__x" aria-label="Close" onClick={closeDialog}>
          <Ic n="x" />
        </button>
      </div>
      <div className="wc-dlg__body wc-startpanel">
        <fieldset>
          <legend>Open on</legend>
          <div className="wc-startpanel__opts">
            {tabs.map((t) => (
              <label key={t.id} className="wc-startopt">
                <input type="radio" name="tab" value={t.id} checked={tab === t.id} onChange={() => setTab(t.id)} />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {me.fid ? (
          <fieldset>
            <legend>Open actions shows</legend>
            <div className="wc-startpanel__opts">
              {SCOPES.map(([v, l]) => (
                <label key={v} className="wc-startopt">
                  <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} />
                  <span>{l}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>
      <div className="wc-dlg__foot">
        <button type="button" className="h-btn h-btn--ghost" disabled={busy} onClick={() => void reset()}>
          Use the default
        </button>
        <button type="button" className="h-btn h-btn--primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

