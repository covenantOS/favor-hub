// What this person may change on a partner's record tabs. The server checks again on every write (authorizeBatch); the page only hides
// what the server would refuse. Contact rows and flags follow the contact-details rule (any role that edits partners, and a partner
// another team holds is that team's to change, Support may change any). Codes, solicit codes and the deceased or inactive mark belong
// to admins and the Support Team.
import { can } from './role';
import { partnerContext } from './edit';
import type { Ctx } from './service';

export async function recordRights(ctx: Ctx, cid: string): Promise<{ contact: boolean; codes: boolean }> {
  const s = ctx.scope;
  if (!s || s.all) return { contact: true, codes: true };
  const codes = s.role === 'support';
  let contact = can(s, 'partner_edit');
  if (contact && s.role !== 'support') {
    const holders = (await partnerContext(ctx, cid).catch(() => ({ holders: [] as { fid: string }[] }))).holders.map((h) => h.fid);
    contact = !holders.length || holders.some((h) => s.fids.has(h));
  }
  return { contact, codes };
}
