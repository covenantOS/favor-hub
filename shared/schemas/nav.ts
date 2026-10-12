import { z } from 'zod';
import { access, counts, hubUser } from './common';

/** GET /api/hub/nav: who is signed in, what they may open, and the number beside each menu entry. */
export const navResponse = z.object({
  ok: z.literal(true),
  user: hubUser,
  access,
  counts,
  kpiTeams: z.array(z.string()).default([]),
});
export type NavResponse = z.infer<typeof navResponse>;
