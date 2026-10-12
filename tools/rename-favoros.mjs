// Renames the product copy from "Favor Hub" / "the hub" to "FavorOS".
// Idempotent: run it again on a newer main and it only touches what is new.
// Usage: node tools/rename-favoros.mjs [--dry]
// Scope: user-visible strings in src, public, functions, workers, and the tests that assert them. Skips comment-only lines in code
// files, node_modules, CSS, and the narrated transcript lines in src/data/videos.json (they match audio).
// Domains, routes, header names, CSS classes, D1 keys and file names are never touched.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DRY = process.argv.includes('--dry');
const DIRS = ['src', 'public', 'functions', 'workers', 'tests'];
const EXT = new Set(['.ts', '.js', '.mjs', '.astro', '.md', '.json', '.html', '.webmanifest', '.txt']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.astro', '.wrangler']);
const NARRATED = /^\s*"transcript"/; // spoken text in videos.json stays as recorded
const NOUNS = 'sign-in|search|menu|pages?|copy|links?|screens?|admins?|tab|bar|header|nav|search|account|record|log|front|tools?';

// Exact, file-specific replacements (first), then generic rules.
const EXACT = [
  ['functions/_lib/expenses/email.ts', 'is kept in FavorOS expense log', 'is kept in the FavorOS expense log'],
  ['functions/_lib/expenses/email.ts', 'letter-spacing:.14em;text-transform:uppercase;color:#8b957b', 'letter-spacing:.14em;color:#8b957b'],
  ['tests/records.test.mjs', 'Hub copy', 'FavorOS copy'],
  ['src/components/CommandPalette.astro', 'aria-label="Hub search"', 'aria-label="FavorOS search"'],
  ['src/layouts/App.astro', 'aria-label="Hub">', 'aria-label="FavorOS">'],
  ['src/layouts/App.astro', "description = 'Favor International staff hub.'", "description = 'FavorOS, the Favor International staff workspace.'"],
  ['src/pages/brain/index.astro', 'aria-label="Hub menu"', 'aria-label="FavorOS menu"'],
  ['public/js/chat/chat-ui.js', 'aria-label="Hub menu"', 'aria-label="FavorOS menu"'],
  ['src/pages/admin/index.astro', 'description="Hub health and settings for admins."', 'description="FavorOS health and settings for admins."'],
  ['src/pages/index.astro', '<b>Welcome to the new hub</b>', '<b>Welcome to FavorOS</b>'],
  ['src/pages/requests/new.astro', '<span>This hub</span>', '<span>FavorOS</span>'],
  ['public/js/requests-compose.js', "dashboard: 'This hub'", "dashboard: 'FavorOS'"],
  ['public/js/requests-compose.js', "label: 'Hub screen (optional)'", "label: 'FavorOS screen (optional)'"],
  ['public/js/request-drawer.js', "dashboard: 'Hub'", "dashboard: 'FavorOS'"],
  ['public/js/requests-board.js', "dashboard: 'Hub'", "dashboard: 'FavorOS'"],
  ['public/js/request-router.js', 'Website, portal, hub, dashboard and', 'Website, portal, FavorOS, dashboard and'],
  ['functions/_lib/work/deceased.ts', "mirror: 'Hub copy'", "mirror: 'FavorOS copy'"],
  ['functions/api/requests/route.ts', 'the staff hub and its tools', 'FavorOS and its tools'],
  ['src/content/help/whats-new.md', 'searches the whole hub.', 'searches all of FavorOS.'],
  ['src/layouts/App.astro', '<span>Hub</span></a>', '<span>OS</span></a>'],
  ['src/pages/login.astro', '<p class="si-kicker">Staff hub</p>', '<p class="si-kicker">FavorOS</p>'],
  ['src/data/help-topics.ts', "hub: 'The hub',", "hub: 'FavorOS',"],
];
const RULES = [
  [/\b([Tt]he) Favor [Hh]ub (expense|clip|home|admin|page|link|menu)\b/g, '$1 FavorOS $2'],
  [/\b(?:[Tt]he )?(?:new )?Favor [Hh]ub\b/g, 'FavorOS'],
  [new RegExp(String.raw`\b([Tt]he) hub (${NOUNS})\b`, 'g'), '$1 FavorOS $2'],
  [new RegExp(String.raw`\b(a|any|every|this|another|your|A|Any|Every|This|Another|Your) hub (${NOUNS})\b`, 'g'), '$1 FavorOS $2'],
  [/\b[Hh]ub admin(s?)\b/g, 'FavorOS admin$1'],
  [/\b[Tt]he hub\b/g, 'FavorOS'],
];
const COMMENT = /^\s*(\/\/|\*|\/\*|<!--|#!)/;

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    if (SKIP_DIR.has(n)) continue;
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXT.has(extname(n))) out.push(p);
  }
  return out;
}

// One What's new line, inserted once under the newest heading.
const NEWS = 'src/content/help/whats-new.md';
const NEWS_LINE = "- **The new name is FavorOS.** The address, the sign-in and the tools stay the same. The name changes in the header, the tab title, the home screen icon and the emails.";
const NEWS_MARK = '**The new name is FavorOS.**';

let changed = 0;
const log = [];
for (const dir of DIRS) {
  let files;
  try { files = walk(join(ROOT, dir)); } catch { continue; }
  for (const f of files) {
    const rel = relative(ROOT, f).split(sep).join('/');
    if (rel === 'tests/favoros-name.test.mjs') continue;
    let text = readFileSync(f, 'utf8');
    const before = text;
    for (const [file, a, b] of EXACT) if (file === rel && text.includes(a)) text = text.split(a).join(b);
    {
      const isCode = !['.md', '.json', '.webmanifest', '.txt'].includes(extname(f));
      text = text.split('\n').map((line) => {
        if ((isCode && COMMENT.test(line)) || NARRATED.test(line)) return line;
        let l = line;
        for (const [re, to] of RULES) l = l.replace(re, to);
        return l;
      }).join('\n');
    }
    if (text !== before) {
      changed++;
      log.push(rel);
      if (!DRY) writeFileSync(f, text);
    }
  }
}
{
  const f = join(ROOT, NEWS);
  const txt = readFileSync(f, 'utf8');
  if (!txt.includes(NEWS_MARK)) {
    const m = txt.match(/^## .*\r?\n\r?\n/m);
    if (m) {
      changed++;
      if (!DRY) writeFileSync(f, txt.replace(m[0], m[0] + NEWS_LINE + '\n'));
    }
  }
}
console.log(`${DRY ? 'would change' : 'changed'} ${changed} files`);
if (DRY) console.log(log.join('\n'));
