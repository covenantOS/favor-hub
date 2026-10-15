// Where the Requests fold plugs into the Projects home: extra tabs (Intake for the people who triage, My requests for everyone) and
// the Make a request button. STUB until the Intake UI lane replaces it. Keep these exports.
import type { StaffDir } from '../lib/staff';

export interface ExtraTab {
  id: string;
  label: string;
  count?: number;
}

/** The tabs to add after Team workload for this person. */
export function homeTabsExtra(staff: StaffDir): ExtraTab[] {
  void staff;
  return [];
}

function MakeRequest() {
  return null;
}
function Tab({ id }: { id: string }) {
  void id;
  return null;
}

export const HomeIntake = { MakeRequest, Tab };
