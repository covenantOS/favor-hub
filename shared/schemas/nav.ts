import { z } from 'zod';
import { access, counts, hubUser } from './common';

/** GET /api/hub/nav: who is signed in, what they may open, and the number beside each menu entry. */
export const navResponse = z.object({
  ok: z.literal(true),
  user: hubUser,
  access,
  counts,
  kpiTeams: z.array(z.string()).default([]),
  /** Whose work this person does (functions/_lib/hub/jobs.ts): which areas sit in the rail and which tabs come first. Never a gate. */
  jobs: z.array(z.string()).optional(),
  /** Release badge for each area, page, help article and Data saver key (src/data/release.ts with the admin's saved changes). */
  release: z.record(z.string(), z.enum(['alpha', 'beta', 'new'])).optional(),
});
export type NavResponse = z.infer<typeof navResponse>;
