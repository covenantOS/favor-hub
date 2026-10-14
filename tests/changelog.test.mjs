// The changelog (/changelog) and the release badges: day files are well formed and written for staff, the page builds,
// every picture exists and is small, and the badge map resolves the way the menu, header and help expect.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'src/content/changelog');
const AREAS = ['today', 'partners', 'work-center', 'requests', 'projects', 'expenses', 'receipts', 'gifts', 'statements', 'evaluations', 'learn', 'onboarding', 'staff', 'foundations', 'meetings', 'clips', 'chat', 'mail', 'brain', 'reporting', 'lists', 'admin', 'help', 'phone', 'everywhere'];
const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
const days = files.map((f) => ({ f, d: yaml.load(fs.readFileSync(path.join(DIR, f), 'utf8').split(/^---\s*$/m)[1]) }));
const entries = days.flatMap(({ f, d }) => (d.entries || []).map((e) => ({ f, e })));

test('day files are named by their date and hold valid entries', () => {
  assert.ok(files.length > 10);
  for (const { f, d } of days) {
    assert.equal(String(d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date), f.slice(0, 10), f);
    assert.ok(Number.isInteger(d.behind ?? 0), f);
  }
  for (const { f, e } of entries) {
    assert.match(e.time, /^\d{2}:\d{2}$/, f);
    assert.ok(AREAS.includes(e.area), `${f}: area ${e.area}`);
    assert.ok(['new', 'improved', 'fixed'].includes(e.type), `${f}: type ${e.type}`);
  }
});

test('entries are written for staff', () => {
  const banned = /—|\b(AI|LLM|GPT|OpenAI|Anthropic|Claude|ChatGPT|agents?|models?|Cloudflare|D1|R2|donors?|seamless|powerful|effortless|robust|leverage|streamline|elevate|empower|utilize|facilitate|foster|delve|just|simply|actually)\b|!/i;
  const names = /\b(Will|Rachel|Daniel|Stephanie|Michael|Jordan|Megan|Danny)\b/;
  const bad = entries.filter(({ e }) => banned.test(e.text) || names.test(e.text));
  assert.deepEqual(bad.map(({ f, e }) => `${f} ${e.time}: ${e.text}`), []);
});

test('pictures exist, are WebP and stay under 150 KB', () => {
  const shots = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/changelog-shots.json'), 'utf8'));
  const paths = [...Object.values(shots).flatMap((v) => [v.desk, v.phone]), ...entries.flatMap(({ e }) => [e.image, e.phone])].filter(Boolean);
  for (const p of paths) {
    assert.match(p, /\.webp$/);
    const file = path.join(ROOT, 'public', p);
    assert.ok(fs.existsSync(file), p);
    assert.ok(fs.statSync(file).size < 150 * 1024, p);
  }
  for (const a of AREAS) assert.ok(shots[a] && shots[a].desk, `today's view for ${a}`);
});

test('/changelog builds with every entry', { skip: !fs.existsSync(path.join(ROOT, 'dist/changelog/index.html')) && 'no build (npm run build first)' }, () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist/changelog/index.html'), 'utf8');
  assert.equal((html.match(/class="cl-e"/g) || []).length, entries.length);
  assert.match(html, /id="cl-q"/);
  assert.match(html, /id="cl-area"/);
  const latest = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist/changelog/latest.json'), 'utf8'));
  assert.match(latest.latest, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('release badges: Brain is Beta, Projects Alpha, Requests and Clips none, Reporting none, overrides win', async () => {
  const r = await import('../src/data/release.ts');
  const { AREAS: NAV } = await import('../src/data/areas.ts');
  assert.equal(r.badgeFor('ask'), 'beta');
  assert.equal(r.pageBadge('projects', 'projects'), 'alpha');
  assert.equal(r.pageBadge('clips', 'meet'), null);
  assert.equal(r.pageBadge('meet-book', 'meet'), 'alpha');
  assert.equal(r.pageBadge('board', 'projects'), null);
  assert.equal(r.badgeFor('kpi'), null);
  assert.equal(r.badgeFor('partners'), 'beta');
  assert.equal(r.badgeFor('gifts'), 'beta');
  assert.equal(r.badgeFor('staff'), 'alpha');
  assert.equal(r.helpBadge('ask-favor', NAV), 'beta');
  assert.equal(r.helpBadge('clips', NAV), null);
  assert.equal(r.helpBadge('meetings', NAV), 'alpha');
  const ov = r.parseOverrides('{"projects":"beta","ask":"none","x":"bogus"}');
  assert.deepEqual(ov, { projects: 'beta', ask: 'none' });
  assert.equal(r.pageBadge('projects', 'projects', ov), 'beta');
  assert.equal(r.badgeFor('ask', ov), null);
  assert.deepEqual(r.parseOverrides('not json'), {});
});
