// A hand-off link: /h/<id>, sent in the Chat message or email that tells a teammate something was handed to them.
// The receiver lands on Today with the hand-off open (its note, its context and the button to the thing itself). Anyone else lands
// on Today with nothing open: Today asks the server, which shows a hand-off only to its giver and its receiver.
export const onRequestGet: PagesFunction = async ({ params, request }) => {
  const id = String(params.id || '');
  const to = /^ho_[a-z0-9]{6,20}$/.test(id) ? `/?handoff=${id}` : '/';
  return new Response(null, { status: 302, headers: { Location: new URL(to, request.url).toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
};
