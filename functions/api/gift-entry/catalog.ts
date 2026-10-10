import { gift } from '../../_lib/gifts/route';
import { loadCatalog } from '../../_lib/gifts/match';

export const onRequestGet = gift(async ({ q }) => ({ ...(await loadCatalog(q)) }));
