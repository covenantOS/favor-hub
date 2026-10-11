// Pure rules for the room, kept apart from the Durable Object so node tests cover them.

/** One person can have several sockets (phone, laptop, two tabs). They are online if any socket is, else away if any is, else gone. */
export function presenceOf(sockets) {
  const out = {};
  for (const s of sockets) {
    if (!s || !s.email) continue;
    const state = s.state === 'away' ? 'away' : 'online';
    if (out[s.email] === 'online') continue;
    out[s.email] = state === 'online' ? 'online' : out[s.email] || 'away';
  }
  return out;
}

/** The emails whose presence differs between two maps, with the new state ('off' when they dropped out). */
export function presenceChanges(before, after) {
  const out = [];
  for (const e of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[e] || 'off';
    const now = after[e] || 'off';
    if (was !== now) out.push({ user_id: e, presence: now });
  }
  return out;
}

/** The sockets an event goes to: the audience's, or everyone's when the audience is the string 'all'. */
export function pickTargets(sockets, audience) {
  if (audience === 'all') return sockets;
  const want = new Set((Array.isArray(audience) ? audience : []).map((e) => String(e).toLowerCase()));
  return sockets.filter((s) => s.email && want.has(s.email));
}

/** A socket is stale when nothing came from it (a ping, a message, the connect itself) for this long: browsers ping every 30 s. */
export const STALE_MS = 75_000;

/** True when the socket's newest sign of life is older than STALE_MS. Times are milliseconds; a missing time counts as never. */
export function isStale(times, now) {
  const last = Math.max(0, ...times.filter((t) => Number.isFinite(t)));
  return now - last > STALE_MS;
}
