// Where requests plug into the Projects home: the Make a request button and the extra tabs. Everyone gets My requests; people who
// triage a team (owners of a pipeline, admins) also get Intake, before it. homeTabsExtra reads the two lists the tabs need (it is called
// on every render of the home page, in the same place, so the reads behave as hooks); the screens themselves are in ../intake.
import { Suspense, useEffect } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { StaffDir } from '../lib/staff';
import { openComposer } from '../intake/Composer';
import { IntakeBoard } from '../intake/IntakeBoard';
import { MyRequests } from '../intake/MyRequests';
import { intakeTabs } from '../intake/logic';
import { intakeMineQuery, intakeTeamsQuery } from '../intake/queries';

export interface ExtraTab {
  id: string;
  label: string;
  count?: number;
}

/** The tabs to add after Team workload for this person. */
export function homeTabsExtra(staff: StaffDir): ExtraTab[] {
  void staff;
  /* eslint-disable react-hooks/rules-of-hooks */
  const teams = useSuspenseQuery(intakeTeamsQuery).data;
  const mine = useSuspenseQuery(intakeMineQuery).data;
  /* eslint-enable react-hooks/rules-of-hooks */
  return intakeTabs(teams.teams, mine.items);
}

function MakeRequest() {
  return (
    <button type="button" className="pj-btn pj-btn--primary ik-make" data-tour="make-request" onClick={() => openComposer()}>
      Make a request
    </button>
  );
}

function Skeleton() {
  return (
    <div className="pj-skel" aria-busy="true">
      <i />
      <i />
      <i />
    </div>
  );
}

function Tab({ id }: { id: string }) {
  // On a phone the tab strip scrolls; keep the open tab in view.
  useEffect(() => {
    document.querySelector('.pj-seg .is-on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [id]);
  return <Suspense fallback={<Skeleton />}>{id === 'intake' ? <IntakeBoard /> : <MyRequests />}</Suspense>;
}

export const HomeIntake = { MakeRequest, Tab };
