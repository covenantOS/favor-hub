// What the Projects home does with the request addresses. Call it once from the home page, with the page's openTask:
//   /projects/?compose=1   opens the composer (and takes the parameter off the address)
//   /projects/?r=<id>      opens that request. A person who triages its team gets its card in the drawer over the Intake view;
//                          the person who asked gets My requests with that request open; anyone else is told it is not available
//   /projects/?tab=intake  for a person who triages no team, shows My requests
import { useEffect, useRef } from 'react';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { toast } from '../kit/toast';
import { useSearchParams, useSetSearch } from '../lib/url';
import { openComposer } from './Composer';
import { intakeDetailQuery, intakeTeamsQuery } from './queries';

// Once per page load for each time the address says compose=1; reset when the address no longer says it.
let composeAsked = false;

export function useIntakeParams(openTask: (ref: string) => void): void {
  const qc = useQueryClient();
  const search = useSearchParams();
  const setSearch = useSetSearch();
  const teams = useSuspenseQuery(intakeTeamsQuery).data;
  // A failed read says nothing about who triages, so it never sends anyone away from the Intake address.
  const triages = teams.teams.length > 0 || !!teams.error;
  const compose = search.get('compose');
  const r = search.get('r') || '';
  const tab = search.get('tab');
  const asked = useRef(false);
  // Set once a card is open for ?r=; the address is tidied when the drawer has put the card's code in it (two address changes at once
  // would restart the page).
  const after = useRef<{ ref: string; team: string } | null>(null);
  const openRef = useRef(openTask);
  openRef.current = openTask;
  const setRef = useRef(setSearch);
  setRef.current = setSearch;

  useEffect(() => {
    if (compose !== '1') {
      asked.current = false;
      composeAsked = false;
      return;
    }
    // A page that draws again while the address still says compose=1 must not open a second composer.
    if (asked.current || composeAsked) return;
    asked.current = true;
    composeAsked = true;
    setSearch((p) => p.delete('compose'), 'replace');
    openComposer();
  }, [compose, setSearch]);

  useEffect(() => {
    if (tab === 'intake' && !triages) setSearch((p) => p.set('tab', 'requests'), 'replace');
  }, [tab, triages, setSearch]);

  useEffect(() => {
    const a = after.current;
    if (!a || !r || search.get('t') !== a.ref) return;
    after.current = null;
    setSearch((p) => {
      p.delete('r');
      p.set('tab', 'intake');
      p.set('team', a.team);
    }, 'replace');
  }, [r, search, setSearch]);

  useEffect(() => {
    if (!r) return;
    let live = true;
    qc.fetchQuery(intakeDetailQuery(r)).then(
      (d) => {
        if (!live) return;
        const ref = d.item.task ? d.item.task.code || d.item.task.id : '';
        if (d.standing.triage && ref) {
          after.current = { ref, team: d.item.team };
          openRef.current(ref);
        } else if (new URLSearchParams(window.location.search).get('tab') !== 'requests') {
          setRef.current((p) => p.set('tab', 'requests'), 'replace');
        }
      },
      () => {
        if (!live) return;
        toast('That request is not available to you.', { error: true });
        setRef.current((p) => p.delete('r'), 'replace');
      }
    );
    return () => {
      live = false;
    };
  }, [r, qc]);
}
