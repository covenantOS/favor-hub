// One help article (/help/<slug>/), rendered from src/content/help. The loader reads the article's own small chunk, so the first
// screen carries only the article that was asked for. An article that is also a page in another area's tab row (Connect an AI app under
// Favor Brain) keeps that area's header and tabs.
import { createFileRoute, notFound } from '@tanstack/react-router';
import loaders from 'virtual:help-loaders';
import { AREAS } from '@hub/data/areas';
import { HelpArticle, type ArticleData } from '../../features/help/HelpArticle';

const slugNav: Record<string, string> = Object.fromEntries(
  AREAS.filter((a) => a.id !== 'help')
    .flatMap((a) => a.pages)
    .filter((pg) => /^\/help\/[^/]+\/?$/.test(pg.href))
    .map((pg) => [pg.href.replace(/^\/help\/|\/$/g, ''), pg.id]),
);

export const Route = createFileRoute('/help/$slug')({
  staticData: { nav: 'docs', title: 'Help docs', layout: 'page' },
  loader: async ({ params }) => {
    const load = Object.prototype.hasOwnProperty.call(loaders, params.slug) ? loaders[params.slug] : null;
    if (!load) throw notFound();
    const data = (await load()).default;
    return { article: data as ArticleData, shell: { nav: slugNav[params.slug] || 'docs', title: data.meta.title } };
  },
  component: Article,
});

function Article() {
  const { article } = Route.useLoaderData();
  return <HelpArticle data={article} />;
}
