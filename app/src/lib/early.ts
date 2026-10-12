// The first answers are asked for by a script in app/index.html, before any JavaScript bundle has arrived, so the network and the bundle load
// in parallel instead of one after the other. api() takes the early answer for a path once, if it is still fresh, and otherwise fetches as usual.
type Early = Record<string, { at: number; p: Promise<unknown> } | undefined>;

const early = () => (window as unknown as { __early?: Early }).__early;

export function takeEarly(path: string): Promise<unknown> | null {
  const e = early();
  const hit = e && e[path];
  if (!hit) return null;
  delete e[path];
  return Date.now() - hit.at < 15_000 ? hit.p : null;
}
