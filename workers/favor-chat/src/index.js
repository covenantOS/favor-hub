import { DurableObject } from 'cloudflare:workers';
import { pickTargets, presenceChanges, presenceOf } from './room.js';

// ChatRoom: every signed-in browser holds one WebSocket here. The hub (a Pages Function) checks who the person is, sets X-Chat-User,
// and forwards the upgrade. Events arrive as POST /event {audience, event} from the hub after it has saved a message to D1.
// WebSocket Hibernation: the object sleeps between events and wakes for each one, so an idle room costs nothing.
export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Browsers send the text "ping" every 30 seconds to keep the socket open; the platform answers without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  sockets(except) {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== 1) continue;
      const a = ws.deserializeAttachment() || {};
      out.push({ ws, email: a.email || '', state: a.state || 'online' });
    }
    return out;
  }

  presence(except) {
    return presenceOf(this.sockets(except));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const email = (request.headers.get('X-Chat-User') || '').toLowerCase();
      if (!email) return new Response('No user', { status: 401 });
      const before = this.presence();
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [email]);
      server.serializeAttachment({ email, state: 'online' });
      this.announce(before, this.presence());
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/event' && request.method === 'POST') {
      const { audience, event } = await request.json();
      const text = JSON.stringify(event);
      for (const s of pickTargets(this.sockets(), audience)) {
        try { s.ws.send(text); } catch (_) { /* a socket that closed under us */ }
      }
      return new Response('ok');
    }
    if (url.pathname === '/presence') return Response.json(this.presence());
    return new Response('Not found', { status: 404 });
  }

  announce(before, after) {
    const changes = presenceChanges(before, after);
    if (!changes.length) return;
    const all = this.sockets();
    for (const c of changes) {
      const text = JSON.stringify({ type: 'presence', ...c });
      for (const s of all) { try { s.ws.send(text); } catch (_) { /* gone */ } }
    }
  }

  // The page tells the room when its tab is hidden or visible again: {"t":"p","s":"away"|"online"}.
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 200) return;
    let m;
    try { m = JSON.parse(message); } catch (_) { return; }
    if (m && m.t === 'p') {
      const a = ws.deserializeAttachment() || {};
      const before = this.presence();
      ws.serializeAttachment({ ...a, state: m.s === 'away' ? 'away' : 'online' });
      this.announce(before, this.presence());
    }
  }

  async webSocketClose(ws) {
    // The platform may still list the closing socket until this handler returns, so presence is computed with and without it.
    const prior = this.priorPresence(ws);
    try { ws.close(1000, 'closed'); } catch (_) { /* already closed */ }
    this.announce(prior, presenceOf(this.sockets(ws)));
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  priorPresence(closing) {
    const list = this.sockets();
    if (!list.some((s) => s.ws === closing)) {
      const a = closing.deserializeAttachment() || {};
      list.push({ ws: closing, email: a.email || '', state: a.state || 'online' });
    }
    return presenceOf(list);
  }
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
