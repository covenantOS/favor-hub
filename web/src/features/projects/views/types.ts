// What every Projects view (Calendar, Timeline, Workload) is given by the project page.
import type { Member, Project, Section } from '../types';
import type { QuickAddDefaults } from '../lib/page';
import type { TaskCtx } from '../lib/store';

export interface ViewProps {
  ctx: TaskCtx;
  project: Project;
  sections: Section[];
  members: Member[];
  /** Open a task (id or code) in the drawer. */
  openTask: (ref: string) => void;
  /** Open the quick add box. */
  quickAdd: (d?: QuickAddDefaults) => void;
}
