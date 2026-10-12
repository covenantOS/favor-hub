# Entities, Send to and notifications

Server: `functions/_lib/hub/entity.ts` (resolve), `functions/api/hub/entity.ts` (route), `functions/_lib/hub/notifications.ts` and `functions/api/hub/notifications.ts`.
Legacy front end: `public/js/favor-entity.js` (chips, hover card, phone sheet), `favor-share.js` (Send to), `favor-ui.js` (helpers), `favor-data.js` (cache).

Mark any element `data-entity="kind:id"` (kinds: person, partner, fund, appeal, task, request, meeting, clip, course) or call `FavorEntity.chip(kind, id, label)`. Links the hub already draws (partner, request, task, meeting, clip, course, mailto a favorintl.org address) get the card on hover with no change. Task codes in Chat messages, request comments and Brain text become chips when they resolve for the reader.

`/brain/?ask=text` starts a new Brain chat with that question.
Chat accepts attachments `{type:'entity', kind, id}` and `{type:'page', url, title}`; the server resolves them as the sender and stores only name, one line and address.
