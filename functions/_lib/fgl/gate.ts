// Who may use First-gift letters: the Support Team, Partner Care and admins (mayLetters and the Partner Care role). The FavorOS test user works on a
// made-up list and nothing it does reaches Blackbaud.
import { HttpError } from '../http';
import { mayLetters } from '../work/letters-svc';
import { isTester } from '../testuser';
import type { Ctx } from '../work/service';

export function requireFgl(ctx: Ctx): void {
  const s = ctx.scope;
  const ok = mayLetters(s) || (s && s.role === 'partner_care');
  if (!ok) throw new HttpError(403, 'not_yours', 'First-gift letters are for the Support Team, Partner Care and the admin desk.');
}

export const sampleFor = (ctx: Ctx): boolean => isTester(ctx.email);
