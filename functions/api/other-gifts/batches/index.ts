import { og } from '../../../_lib/other-gifts/route';
import { listBatches } from '../../../_lib/other-gifts/store';

export const onRequestGet = og(async ({ env, user, isTest }) => {
  const email = user.email.toLowerCase();
  const rows = await listBatches(env, isTest, 40);
  return {
    batches: rows.map((b) => ({
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
  };
});
