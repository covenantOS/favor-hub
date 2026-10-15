import { HttpError } from '../../_lib/http';
import { work, body } from '../../_lib/work/route';
import { boardResponse, cardDetail, cardsResponse, saveCard, saveStages } from '../../_lib/moves/service';
import { addRelationship, graphFor } from '../../_lib/moves/relations';
import { mayUseMoves } from '../../_lib/moves/access';

const OFF = 'Moves is not open to you yet.';

// The moves board. GET with no path is the board (stage totals and the first rows of each stage).
//   GET  /               ?owner=&q=&sort=&per=         every stage with its count, dollars asked and first rows
//   GET  /cards          ?stage=&owner=&q=&sort=&offset=&limit=   one stage's rows, paged
//   GET  /card           ?cid=                         one partner: stage, next step, asks, giving, history
//   GET  /relations      ?cid=                         the relationship map of any partner
//   POST /card           {cid, stage?, nextStep?, nextDue?}
//   POST /stages         {stages:[{id?, label, role?}]} admin only
//   POST /relations      {cid, otherCid, type, position?}
export const onRequestGet = work(async ({ ctx, params, url, env, wu }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  // The switch (hub setting moves.board). The map on the partner record reads as empty for someone the switch leaves out.
  if (!(await mayUseMoves(env, wu.user))) {
    if (a === 'relations') return { off: true };
    throw new HttpError(403, 'moves_off', OFF);
  }
  const p = url.searchParams;
  const common = { owner: (p.get('owner') || '').slice(0, 20), q: (p.get('q') || '').slice(0, 100), sort: p.get('sort') || '' };
  if (a === 'cards') return (await cardsResponse(ctx, { ...common, stage: p.get('stage') || '', offset: Number(p.get('offset') || 0), limit: Number(p.get('limit') || 25) })) as any;
  if (a === 'card') return (await cardDetail(ctx, (p.get('cid') || '').slice(0, 14))) as any;
  if (a === 'relations') return (await graphFor(ctx, (p.get('cid') || '').slice(0, 14))) as any;
  if (a) throw new HttpError(404, 'not_found', 'There is nothing at that address.');
  return (await boardResponse(ctx, { ...common, per: Number(p.get('per') || 12) })) as any;
});

export const onRequestPost = work(async ({ ctx, params, request, env, wu }) => {
  const a = String((params.a as string[] | undefined)?.[0] || '');
  if (!(await mayUseMoves(env, wu.user))) throw new HttpError(403, 'moves_off', OFF);
  const b = await body(request);
  if (a === 'card') return (await saveCard(ctx, b)) as any;
  if (a === 'stages') return (await saveStages(ctx, b.stages as any)) as any;
  if (a === 'relations') return (await addRelationship(ctx, b)) as any;
  throw new HttpError(404, 'not_found', 'There is nothing at that address.');
});
