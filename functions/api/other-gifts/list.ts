import { og } from '../../_lib/other-gifts/route';
import { list } from '../../_lib/other-gifts/read';

const TABS = ['all', 'daf', 'foundation', 'wire', 'stock', 'phone', 'business'];

export const onRequestGet = og(async ({ env, q, repo, url, today, isTest }) => {
  const page = Math.max(1, Math.round(Number(url.searchParams.get('page'))) || 1);
  const size = [15, 30, 50].includes(Number(url.searchParams.get('size'))) ? Number(url.searchParams.get('size')) : 15;
  const tab = url.searchParams.get('tab') || 'all';
  return (await list(env, q, repo, {
    today,
    tab: TABS.includes(tab) ? tab : 'all',
    term: (url.searchParams.get('q') || '').slice(0, 60),
    page,
    size,
    viewerIsTester: isTest,
  })) as unknown as Record<string, unknown>;
});
