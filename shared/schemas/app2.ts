import { z } from 'zod';

/** GET /api/hub/app2: whether the new front end is open to this person and which routes it serves for them. */
export const app2Response = z.object({
  ok: z.literal(true),
  eligible: z.boolean(),
  optedIn: z.boolean(),
  routes: z.array(z.string()),
  audience: z.enum(['admin', 'all']),
});
export type App2Response = z.infer<typeof app2Response>;
