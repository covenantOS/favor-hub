// Who may use First-gift letters: the Support Team, Partner Care and admins (mayLetters and the Partner Care role). The FavorOS test user works on a
// made-up list and nothing it does reaches Blackbaud.
import { HttpError } from '../http';
import { isTester } from '../testuser';
import type { Ctx } from '../work/service';

export function requireFgl(ctx: Ctx): void {
  const s = ctx.scope;
  // The Work Center gate falls back to role 'admin' with all: false for a person it lets in who has no team on the staff list. Only a real
  // admin (all: true), the Support Team or Partner Care opens this page; a job run with no scope (the system) passes.
  const ok = !s || s.role === 'support' || s.role === 'partner_care' || (s.role === 'admin' && s.all);
  if (!ok) throw new HttpError(403, 'not_yours', 'First-gift letters are for the Support Team, Partner Care and the admin desk.');
}

export const sampleFor = (ctx: Ctx): boolean => isTester(ctx.email);
