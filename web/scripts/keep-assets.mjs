// Keeps the web app's earlier built files reachable after a new deploy. A page drawn by the previous build asks for its own hashed
// /_w/ files for a while (a tab left open, a stream still arriving, a deploy landing mid-load); without them its scripts 404 and the page
// breaks. Before every Worker deploy the ship scripts run this: it copies the new build's /_w/ files into an archive on Q:, then puts
// every archived file from the last three days that the new build lacks back into the build, so the deploy carries both.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = fileURLToPath(new URL('../dist/client/_w', import.meta.url));
const archive = 'Q:/work/favor-hub/w-assets';
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
if (!existsSync(build)) throw new Error('keep-assets: no build at ' + build);
mkdirSync(archive, { recursive: true });

const now = Date.now();
let saved = 0;
for (const f of readdirSync(build)) {
  const to = join(archive, f);
  if (!existsSync(to)) { copyFileSync(join(build, f), to); saved++; }
  utimesSync(to, now / 1000, now / 1000);
}
let restored = 0;
let pruned = 0;
for (const f of readdirSync(archive)) {
  const from = join(archive, f);
  if (now - statSync(from).mtimeMs > KEEP_MS) { unlinkSync(from); pruned++; continue; }
  const to = join(build, f);
  if (!existsSync(to)) { copyFileSync(from, to); restored++; }
}
console.log(`keep-assets: ${saved} new files archived, ${restored} earlier files carried into this deploy, ${pruned} older than three days dropped`);
