// Ctrl K's local list (pages, tools, links, help) as JSON, for the React app. The classic palette inlines the same list (src/data/palette.ts).
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { buildPaletteItems } from '../data/palette';

export const GET: APIRoute = async () => {
  const docs = (await getCollection('help')).sort((a, b) => a.data.order - b.data.order);
  const items = buildPaletteItems(
    docs.map((d) => ({ title: d.data.title, summary: d.data.summary, id: d.id, topic: d.data.topic, body: d.body || '' }))
  );
  return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
};
