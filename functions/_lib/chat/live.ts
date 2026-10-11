// The live side: the favor-chat Worker's ChatRoom Durable Object holds the open WebSockets and fans an event out to the
// people it names. It stores nothing. D1 is the record; if the Durable Object cannot be reached the page still works and
// shows new messages the next time it loads or polls.
import type { Env } from '../http';

export interface DurableStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}
export interface DurableNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableStub;
}
export type LiveEnv = Env & { CHAT_ROOM?: DurableNamespace };

/** One room carries every channel: a browser keeps one socket open and the room sends each event to the members it names. */
export const ROOM = 'all';

export function room(env: LiveEnv): DurableStub | null {
  if (!env.CHAT_ROOM) return null;
  return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(ROOM));
}

export type LiveEvent = Record<string, unknown> & { type: string };

/** Sends an event to these people's open sockets. A missing binding or a failed call is not an error for the caller. */
export async function publish(env: LiveEnv, audience: string[], event: LiveEvent): Promise<void> {
  const stub = room(env);
  if (!stub || !audience.length) return;
  try {
    await stub.fetch('https://chat-room/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience, event }) });
  } catch (err) {
    console.warn('[chat] publish', err);
  }
}

/** Who has a socket open right now: { email: 'online' | 'away' }. */
export async function presence(env: LiveEnv): Promise<Record<string, string>> {
  const stub = room(env);
  if (!stub) return {};
  try {
    const res = await stub.fetch('https://chat-room/presence');
    return (await res.json()) as Record<string, string>;
  } catch {
    return {};
  }
}
