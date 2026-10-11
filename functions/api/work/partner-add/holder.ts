import { work } from '../../../_lib/work/route';
import { holderForState, mayAddPartner } from '../../../_lib/work/addpartner';
import { HttpError } from '../../../_lib/http';

// The holder a new partner gets from the state on the address: the regional director from the territory table, or Partner Care when the
// state is blank or no region lists it. Reads the hub's copy of the table; no Blackbaud call.
export const onRequestGet = work(async ({ ctx, env, url }) => {
  if (!mayAddPartner(ctx)) throw new HttpError(403, 'not_yours', 'Support adds partners.');
  return (await holderForState(env, (url.searchParams.get('state') || '').slice(0, 30))) as any;
});
