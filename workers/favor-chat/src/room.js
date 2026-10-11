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
