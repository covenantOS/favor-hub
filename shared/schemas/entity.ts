import { z } from 'zod';

export const ENTITY_KINDS = ['person', 'partner', 'fund', 'appeal', 'task', 'request', 'meeting', 'clip', 'file', 'course'] as const;
export const entityKind = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof entityKind>;

/** One thing FavorOS knows by name (functions/_lib/hub/entity.ts). `restricted` means the reader may not see its facts. */
export const entityOut = z.object({
  kind: entityKind,
  id: z.string(),
  title: z.string(),
  sub: z.string().default(''),
  url: z.string().default(''),
  facts: z.array(z.object({ k: z.string(), v: z.string(), tip: z.string().optional() })).default([]),
  acts: z.array(z.string()).default([]),
  pic: z.string().optional(),
  restricted: z.boolean().optional(),
});
export type EntityOut = z.infer<typeof entityOut>;

/** GET /api/hub/entity?kind=&id= */
export const entityResponse = z.object({ ok: z.literal(true), item: entityOut.nullable() });

/** GET /api/hub/find?q= : Ctrl K's people, funds and appeal codes. */
export const findHit = z.object({ kind: entityKind, id: z.string(), title: z.string(), sub: z.string().default('') });
export const findResponse = z.object({ ok: z.literal(true), people: z.array(findHit), funds: z.array(findHit), appeals: z.array(findHit) });
export type FindHit = z.infer<typeof findHit>;
