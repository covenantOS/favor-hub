// The newest change on /changelog, for the What's new dot (public/js/changelog-dot.js).
import { getCollection } from 'astro:content';

export async function GET() {
  let latest = '';
  for (const d of await getCollection('changelog')) {
    for (const e of d.data.entries) {
      const s = `${d.data.date}T${e.time}`;
      if (s > latest) latest = s;
    }
  }
  return new Response(JSON.stringify({ latest }), { headers: { 'content-type': 'application/json' } });
}
