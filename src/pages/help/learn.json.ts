// The "?" button's index: each help article with its videos, and which hub page (nav id) opens which article.
// The article list comes from the same areas registry as the menu, so a page's Learn link and its ? button agree.
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { mins } from '../../data/help-topics';
import { AREAS } from '../../data/areas';
import videos from '../../data/videos.json';

export const GET: APIRoute = async () => {
  const docs = await getCollection('help');
  const articles: Record<string, { title: string; summary: string; href: string; videos: { slug: string; title: string; length: string; src: string; poster: string; track: string }[] }> = {};
  for (const d of docs) {
    const vids = d.data.videos
      .map((s) => videos.find((v) => v.slug === s))
      .filter(Boolean)
      .map((v: any) => {
        const q = v.cut ? `?v=${v.cut}` : '';
        return {
          slug: v.slug,
          title: v.title,
          length: mins(v.seconds),
          src: `/api/videos/${v.slug}.mp4${q}`,
          poster: `/api/videos/${v.slug}.jpg${q}`,
          track: `/api/videos/${v.slug}.vtt${q}`,
        };
      });
    articles[d.id] = { title: d.data.title, summary: d.data.summary, href: `/help/${d.id}/`, videos: vids };
  }
  const pages: Record<string, string> = {};
  for (const area of AREAS) {
    for (const p of area.pages) {
      if (!p.learn) continue;
      pages[p.id] = p.learn;
      for (const alt of p.also || []) pages[alt] = p.learn;
    }
  }
  return new Response(JSON.stringify({ articles, pages }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
};
