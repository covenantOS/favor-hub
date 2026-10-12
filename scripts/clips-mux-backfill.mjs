// Clips: runs the fast-start job for every clip that still needs it (recorded before the job existed, or left half
// done), through POST /api/clips/mux. One call works on one clip for about 25 seconds; this calls it until none is left.
//
//   HUB_KEY=<hub agent key> node scripts/clips-mux-backfill.mjs [--retry] [--base=https://dash.favorintl.org]
//   HUB_COOKIE="name=value" may stand in for HUB_KEY (a signed-in admin's cookie).
//   --retry also takes clips that failed before.
//
// Safe to stop and start again. It changes no recording: the new file is written beside the first one and checked.
const base = (process.argv.find((a) => a.startsWith('--base=')) || '--base=https://dash.favorintl.org').slice(7).replace(/\/$/, '');
const retry = process.argv.includes('--retry');
const headers = { 'Content-Type': 'application/json' };
if (process.env.HUB_KEY) headers.Authorization = `Bearer ${process.env.HUB_KEY}`;
else if (process.env.HUB_COOKIE) headers.Cookie = process.env.HUB_COOKIE;
else {
  console.error('Set HUB_KEY or HUB_COOKIE.');
  process.exit(2);
}

const call = async (method, body) => {
  const res = await fetch(`${base}/api/clips/mux`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) throw new Error(`${method} /api/clips/mux answered ${res.status}: ${JSON.stringify(data)}`);
  return data;
};

const before = await call('GET');
console.log('before:', before.counts.map((c) => `${c.mux || 'not looked at'} ${c.n}`).join(', ') || 'no clips');
const line = (out) => {
  const info = out.info || {};
  return `${out.id} ${out.state}${info.kind ? ` ${info.kind}` : ''}${info.total ? ` ${(info.total / 1048576).toFixed(1)} MB` : ''}${info.reason ? ` (${info.reason})` : ''}${info.error ? ` error: ${info.error}` : ''}, ${out.left} left`;
};
for (let i = 0; i < 2000; i++) {
  const out = await call('POST', {});
  if (!out.id) break;
  console.log(line(out));
}
if (retry) {
  // Each clip that failed, or stopped after three tries at writing, gets one more go.
  const open = (await call('GET')).open.filter((o) => o.mux === 'error' || (o.mux === 'plan' && o.mux_info && o.mux_info.tries >= 3));
  for (const c of open) {
    for (let i = 0; i < 200; i++) {
      const out = await call('POST', i === 0 ? { id: c.id, retry: true } : { id: c.id });
      console.log(line(out));
      if (out.state !== 'plan' || (out.info && out.info.error)) break;
    }
  }
}
const after = await call('GET');
console.log('after:', after.counts.map((c) => `${c.mux || 'not looked at'} ${c.n}`).join(', '));
for (const c of after.open.filter((o) => o.mux === 'error')) console.log(`failed: ${c.id} ${c.mux_info && c.mux_info.error ? c.mux_info.error : ''}`);
