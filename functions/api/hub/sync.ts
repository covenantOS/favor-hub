// Lite mode's single sync is answered in functions/_middleware.ts (syncParts), where the signed-in person is known and each part
// can run through its own function. This file only gives the address a route, so Pages sends it to the functions at all.
export const onRequest: PagesFunction = async () =>
  new Response(JSON.stringify({ ok: false, error: 'not_found', message: 'Sign in first.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
