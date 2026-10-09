// The help search index, built with the site: every article's title, summary, headings and text,
// and every video's title, summary and spoken words. help.js loads it the first time someone types.
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { TOPICS, VIDEO_TOPICS } from '../../data/help-topics';
import videos from '../../data/videos.json';

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_|]/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const GET: APIRoute = async () => {
  const docs = await getCollection('help');
  const items = [
    ...docs.map((d) => ({
      kind: 'doc',
      url: `/help/${d.id}/`,
      title: d.data.title,
      summary: d.data.summary,
      topic: TOPICS.find((t) => t.id === d.data.topic)?.label || '',
      for: d.data.for,
      heads: (d.body || '').match(/^##+ .+$/gm)?.map((h) => h.replace(/^#+ /, '')) || [],
      text: plain(d.body || ''),
    })),
    ...videos.map((v) => ({
      kind: 'video',
      url: `/help/videos/${v.slug}/`,
      title: v.title,
      summary: v.summary,
      topic: `Video · ${VIDEO_TOPICS[v.topic] || v.topic}`,
      for: v.roles,
      heads: [] as string[],
      text: v.transcript,
    })),
  ];
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
};
