import { og } from '../../_lib/other-gifts/route';
import { ogMode } from '../../_lib/other-gifts/access';
import { summary } from '../../_lib/other-gifts/read';
import { listBatches } from '../../_lib/other-gifts/store';
import { loadCatalog } from '../../_lib/gifts/match';
import { KIND_LABEL, NEEDS_LETTER, NEEDS_SOFT_DECISION, WHERE_NEEDED_MOST } from '../../_lib/other-gifts/rules';

// The page's first read: who is looking, the five numbers, this person's batches and the fund and appeal lists.
export const onRequestGet = og(async ({ env, q, user, today, canApprove, isTest }) => {
  const [mode, sum, batches, cat] = await Promise.all([ogMode(env), summary(env, q, today), listBatches(env, isTest), loadCatalog(q)]);
  const email = user.email.toLowerCase();
  return {
    me: { name: user.name, email, admin: user.role === 'admin', canApprove },
    mode,
    today,
    summary: sum,
    batches: batches.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      createdBy: b.created_by,
      createdAt: b.created_at,
      approvedBy: b.approved_by || '',
      gifts: b.gifts,
      cents: b.cents,
      mine: b.created_by_email.toLowerCase() === email,
    })),
    funds: cat.funds,
    appeals: cat.appeals,
    kinds: Object.entries(KIND_LABEL).map(([id, label]) => ({ id, label, needsLetter: NEEDS_LETTER.includes(id as never), needsSoft: NEEDS_SOFT_DECISION.includes(id as never) })),
    defaultFund: WHERE_NEEDED_MOST,
  };
});
