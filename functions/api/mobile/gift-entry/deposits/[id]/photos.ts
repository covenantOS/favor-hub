// One photo from the phone's offline queue. The app sends a client_id with every photo; a repeat after a lost answer returns the stored
// result instead of filing a second row. Everything else is the same handler the web route used.
import { gift } from '../../../../../_lib/gifts/route';
import { claimWrite, clientIdOf, dropWrite, finishWrite } from '../../../../../_lib/mobile/route';
import { photoHandler } from '../../../../gift-entry/deposits/[id]/photos';

export const onRequestPost = gift(async (a) => {
  const clientId = clientIdOf(a.url.searchParams.get('client_id'));
  const claim = await claimWrite(a.env, a.user.email, clientId, 'gift_photo');
  if ('stored' in claim) return { ...(claim.stored as Record<string, unknown>), repeat: true };
  try {
    const out = await photoHandler(a);
    await finishWrite(a.env, a.user.email, clientId, out);
    return out;
  } catch (e) {
    await dropWrite(a.env, a.user.email, clientId);
    throw e;
  }
});
