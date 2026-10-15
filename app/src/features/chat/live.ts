// Chat's live events for the helper scripts that listen to them (public/js/ring.js: huddle rings arrive on the Chat page's own socket).
// The classic page sets window.FavorChatLive in chat.js; this is the same two-word interface for the React page. It is installed when
// this file loads, which the Chat route does with its first code, so a helper that asks for it in its first seconds finds it.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Fn = (ev: Record<string, any>) => void;
const fns: Fn[] = [];

export function emitLive(ev: Record<string, any>) {
  fns.slice().forEach((f) => {
    try {
      f(ev);
    } catch {
      // a listener's own failure never stops Chat
    }
  });
}

if (typeof window !== 'undefined') (window as any).FavorChatLive = { on: (f: Fn) => void fns.push(f) };
