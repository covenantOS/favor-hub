// The live connection. The browser opens one WebSocket here; this checks the person may use Chat, then hands the socket to the
// ChatRoom Durable Object in the favor-chat Worker, which keeps it open and sends events to the people each one is for.
import { errorJson, handleError } from '../../_lib/http';
import { chatUser } from '../../_lib/chat/gate';
import { room, type LiveEnv } from '../../_lib/chat/live';
import { hubUserOf } from '../../_lib/session';

export const onRequestGet: PagesFunction<LiveEnv> = async ({ request, env }) => {
  try {
    if (request.headers.get('Upgrade') !== 'websocket') return errorJson('upgrade', 'This address is for a WebSocket.', 426);
    const user = await chatUser(env, hubUserOf(request));
    const stub = room(env);
    if (!stub) return errorJson('not_set_up', 'Live chat is not connected yet.', 503);
    const headers = new Headers(request.headers);
    headers.set('X-Chat-User', user.email.toLowerCase());
    return await stub.fetch(new Request('https://chat-room/ws', { headers }));
  } catch (err) {
    return handleError(err);
  }
};
