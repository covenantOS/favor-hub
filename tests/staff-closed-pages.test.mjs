// A staff member who opens Brain admin or Partners sees the plain closed page, not the page's chrome or a failed read. Made-up values only.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// A stand-in page for the classic Brain admin script: every element answers like an empty node, and the page records what the script hides.
function runBrainAdmin(status, body) {
  const els = new Map();
  const node = (id) => {
    const n = { id, hidden: false, innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, removeAttribute() {}, setAttribute() {}, querySelector: () => node('q'), querySelectorAll: () => [], click() {}, closest: () => null };
    return n;
  };
  const get = (id) => { if (!els.has(id)) els.set(id, node(id)); return els.get(id); };
  const chrome = [node('stats'), node('panel'), node('tabs')];
  const document = {
    getElementById: get,
    querySelector: () => node('q'),
    querySelectorAll: (sel) => (sel === '.ba-stats, [data-apanel], .b-atabs' ? chrome : []),
    addEventListener() {},
  };
  const fetch = async (url) => (String(url).includes('admin/overview')
    ? { ok: false, status, json: async () => body }
    : { ok: false, status: 503, json: async () => ({ ok: false, error: 'not_set_up', message: 'later' }) });
  const ctx = { document, fetch, location: { hash: '', search: '' }, history: { replaceState() {} }, window: {}, console, setTimeout, clearTimeout, Intl, Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(read('public/js/brain-admin.js'), ctx);
  return new Promise((resolve) => setTimeout(() => resolve({ chrome, denied: get('a-denied') }), 20));
}

test('Brain admin closes for a staff member FavorOS refuses with 403 forbidden', async () => {
  const r = await runBrainAdmin(403, { ok: false, error: 'forbidden', message: 'Only an admin can use that.' });
  assert.equal(r.denied.hidden, false);
  assert.ok(r.chrome.every((n) => n.hidden === true));
});

test('Brain admin closes for an admin the Brain refuses with admin_only', async () => {
  const r = await runBrainAdmin(403, { ok: false, error: 'admin_only', message: 'No.' });
  assert.equal(r.denied.hidden, false);
  assert.ok(r.chrome.every((n) => n.hidden === true));
});

test('Brain admin keeps its chrome when the Brain is only unavailable', async () => {
  const r = await runBrainAdmin(503, { ok: false, error: 'not_set_up', message: 'The Brain is not connected yet.' });
  assert.ok(r.chrome.every((n) => n.hidden === false));
});

test('the Partners page asks the Work Center gate before it draws tabs or lists, and shows the same closed card as /work/', () => {
  const dir = read('web/src/features/partners/directory/Directory.tsx');
  const body = dir.slice(dir.indexOf('export function Directory('));
  assert.ok(body.indexOf('gateQuery()') > -1 && body.indexOf('gateQuery()') < body.indexOf('function DirectoryBody'));
  assert.match(body, /gate\.open \? <DirectoryBody search=\{search\} \/> : <GateScreen reason=\{gate\.reason\} \/>/);
  // The tabs and the failure card live only in the body, so the closed card never carries them.
  const gateFirst = body.slice(body.indexOf('function GateFirst'), body.indexOf('function DirectoryBody'));
  assert.ok(!gateFirst.includes('pd-panes') && !gateFirst.includes('LoadFailed'));
  assert.match(read('web/src/features/partners/work/Actions.tsx'), /import \{ GateScreen \} from '.\/GateScreen'/);
  assert.match(read('web/src/features/partners/work/GateScreen.tsx'), /The Work Center is for the people whose job touches it/);
  assert.match(read('web/src/routes/partners/index.tsx'), /prefetchQuery\(gateQuery\(\)\)/);
});
