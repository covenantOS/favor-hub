import { findPartners } from '../../_lib/statements/data';
import { route } from '../../_lib/statements/route';
import { mirrorSql } from '../../_lib/statements/service';

// Find a partner by Blackbaud ID or by name.
export const onRequestGet = route(async ({ env, url }) => {
  const q = url.searchParams.get('q') || '';
  return { partners: await findPartners(mirrorSql(env), q) };
});
