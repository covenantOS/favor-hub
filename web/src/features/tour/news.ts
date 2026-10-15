// What's new, as a short tour: the changelog entries newer than the person's last visit, one stop per area, only for areas
// they can open. The build (web/vite.tour.config.ts) writes /_tour/news.json from src/content/changelog: the last 45 days of
// new and improved entries, each cut to its first sentence. Nothing here reads a page or the network except news().
import type { Step, Who, Can } from './data';

export type NewsEntry = { stamp: string; area: string; type: 'new' | 'improved'; text: string };
export type News = { latest: string; entries: NewsEntry[] };

const AREA_LABEL: Record<string, string> = {
  today: 'Today', partners: 'Partners', 'work-center': 'Partners', requests: 'Requests', projects: 'Projects', expenses: 'Expenses',
  receipts: 'Receipts', gifts: 'Gifts', statements: 'Statements', evaluations: 'Evaluations', learn: 'Learning', onboarding: 'Onboarding',
  staff: 'Staff', foundations: 'Foundations', meetings: 'Meetings', clips: 'Clips', chat: 'Chat', mail: 'Mail', brain: 'Favor Brain',
  reporting: 'Reporting', lists: 'Lists', admin: 'Admin', help: 'Help', phone: 'Your phone', everywhere: 'FavorOS',
};

type Where = { page?: string; via?: string; at: string[]; need?: keyof Can };
const TITLE = ['.h-top__title'];
const WHERE: Record<string, Where> = {
  today: { page: '/', via: 'home', at: ['#td-needs', ...TITLE] },
  partners: { page: '/work/', via: 'work', at: ['#wc-board', ...TITLE], need: 'work' },
  'work-center': { page: '/work/', via: 'work', at: ['#wc-board', ...TITLE], need: 'work' },
  requests: { page: '/projects/', via: 'projects', at: ['.pj-seg', ...TITLE] },
  projects: { page: '/projects/', via: 'projects', at: ['#pj-root', ...TITLE], need: 'projects' },
  expenses: { page: '/expenses/', via: 'expenses', at: TITLE },
  receipts: { page: '/receipts/', via: 'receipts', at: TITLE, need: 'gifts' },
  gifts: { page: '/gifts/', via: 'gifts-home', at: ['#gh-steps', ...TITLE], need: 'gifts' },
  statements: { page: '/statements/', via: 'statements', at: TITLE, need: 'early' },
  evaluations: { page: '/evaluations/', via: 'evals', at: TITLE, need: 'hr' },
  learn: { page: '/learn/', via: 'learn', at: ['#ln', ...TITLE], need: 'learn' },
  onboarding: { page: '/onboarding/', via: 'onboarding', at: TITLE, need: 'hr' },
  foundations: { page: '/foundations/', via: 'foundations', at: ['#fnd-q', ...TITLE] },
  meetings: { page: '/meet/', via: 'meet', at: ['.dv-bar', ...TITLE], need: 'meetings' },
  clips: { page: '/clips/', via: 'clips', at: TITLE, need: 'early' },
  chat: { page: '/chat/', via: 'chat', at: ['.ch-side', ...TITLE], need: 'chat' },
  mail: { page: '/mail/', via: 'mail', at: ['.ml-compose', ...TITLE], need: 'mail' },
  brain: { page: '/brain/', via: 'brain', at: ['.bc-compose', '#bc-compose', ...TITLE] },
  reporting: { page: '/highlights/', via: 'reporting', at: TITLE, need: 'kpi' },
  lists: { page: '/lists/', via: 'lists', at: TITLE, need: 'early' },
  admin: { page: '/admin/', via: 'admin-home', at: ['#ad-strip', ...TITLE], need: 'admin' },
  help: { page: '/help/', via: 'docs', at: TITLE },
  phone: { at: [] },
  everywhere: { at: [] },
};

/** Most stops a What's new tour has. */
export const MAX_NEWS = 5;

/**
 * The start of a changelog entry, cut to what a card holds. It takes the first sentence, adds the next one when the first is a
 * short heading ("Data care, under Partners."), and cuts a long one at its last comma or colon so it still reads whole.
 */
export function firstSentence(text: string, max = 150): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [clean];
  let out = parts[0].trim();
  if (out.length < 40 && parts[1] && (out + ' ' + parts[1].trim()).length <= max) out = `${out} ${parts[1].trim()}`;
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  const mark = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(': '), cut.lastIndexOf(' and '), cut.lastIndexOf(' or '));
  if (mark >= 60) return cut.slice(0, mark).replace(/[,;:\s]+$/, '') + '.';
  const at = cut.lastIndexOf(' ');
  return (at > 60 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '') + '.';
}

/** Entries newer than the stamp (YYYY-MM-DDTHH:MM, Eastern) that this person can open, newest area first, one per area. */
export function newsSince(w: Who, news: News | null | undefined, since: string): NewsEntry[] {
  if (!news || !since) return [];
  const fresh = news.entries.filter((e) => e.stamp > since);
  const byArea = new Map<string, NewsEntry[]>();
  for (const e of fresh) {
    const where = WHERE[e.area];
    if (!where) continue;
    if (where.need && !w.can[where.need]) continue;
    byArea.set(e.area, [...(byArea.get(e.area) || []), e]);
  }
  // Within an area the biggest change leads (new before improved), then the newest.
  const lead = [...byArea.values()].map((list) => [...list].sort((a, b) => (a.type === b.type ? b.stamp.localeCompare(a.stamp) : a.type === 'new' ? -1 : 1))[0]);
  return lead.sort((a, b) => (a.type === b.type ? b.stamp.localeCompare(a.stamp) : a.type === 'new' ? -1 : 1)).slice(0, MAX_NEWS);
}

/** How many changes the person has not seen, for the invitation. */
export function newsCount(w: Who, news: News | null | undefined, since: string): number {
  if (!news || !since) return 0;
  return news.entries.filter((e) => e.stamp > since && (!WHERE[e.area]?.need || w.can[WHERE[e.area].need!])).length;
}

export function newsSteps(w: Who, news: News | null | undefined, since: string): Step[] {
  return newsSince(w, news, since).map((e, i) => {
    const where = WHERE[e.area];
    return {
      id: `news-${i}-${e.area}`,
      page: where.page,
      via: where.via,
      at: where.at,
      title: `New in ${AREA_LABEL[e.area] || 'FavorOS'}`,
      body: firstSentence(e.text),
      side: 'bottom' as const,
    };
  });
}

export async function loadNews(build = ''): Promise<News | null> {
  try {
    const r = await fetch(`/_tour/news.json${build ? `?b=${encodeURIComponent(build)}` : ''}`, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const d = (await r.json()) as News;
    return d && Array.isArray(d.entries) ? d : null;
  } catch {
    return null;
  }
}
