import { requireAgent } from '../../_lib/auth';
import { attachmentsFor, listRequests, publicShape } from '../../_lib/db';
import { handleError, json, type Env } from '../../_lib/http';

function toMarkdown(items: ReturnType<typeof publicShape>[]): string {
  const lines = [
    '# Favor request queue',
    '',
    'Approved and in-progress software/website tasks. Claim one, work it in the matching repo, then PATCH the card to done.',
    '',
  ];
  if (!items.length) {
    lines.push('Nothing approved right now.');
    return lines.join('\n');
  }
  for (const item of items) {
    lines.push(`## ${item.title}`);
    lines.push('');
    lines.push(`- id: \`${item.id}\``);
    lines.push(`- status: ${item.status}`);
    lines.push(`- surface: ${item.surface}`);
    lines.push(`- repo: ${item.repo} (${item.branch})`);
    lines.push(`- from: ${item.submitter_name}`);
    if (item.page_url) lines.push(`- page: ${item.page_url}`);
    lines.push('');
    lines.push(item.body);
    lines.push('');
    if (item.attachments.length) {
      lines.push('Pictures:');
      for (const a of item.attachments) lines.push(`- ${a.filename}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const denied = requireAgent(env, request);
    if (denied) return denied;
    const rows = await listRequests(env, false);
    const queue = rows.filter((r) => r.status === 'approved' || r.status === 'in_progress');
    const atts = await attachmentsFor(env, queue.map((r) => r.id));
    const items = queue.map((r) => publicShape(r, atts.get(r.id) || [], [], true));
    const url = new URL(request.url);
    if (url.searchParams.get('format') === 'md' || request.headers.get('Accept')?.includes('text/markdown')) {
      return new Response(toMarkdown(items), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return json({ ok: true, count: items.length, requests: items });
  } catch (err) {
    return handleError(err);
  }
};
