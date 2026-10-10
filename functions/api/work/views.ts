import { work, body } from '../../_lib/work/route';
import { deleteView, listViews, saveView } from '../../_lib/work/edit';

// Saved views, one list per person: a name, the tab, filters, sort and columns, and which one opens first.
export const onRequestGet = work(async ({ ctx }) => ({ views: await listViews(ctx.env, ctx.email) }));
export const onRequestPost = work(async ({ ctx, request }) => ({ views: await saveView(ctx.env, ctx.email, (await body(request)) as any) }));
export const onRequestDelete = work(async ({ ctx, url }) => ({ views: await deleteView(ctx.env, ctx.email, String(url.searchParams.get('id') || '')) }));
