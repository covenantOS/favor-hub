// Run with: npm test
//
// Undo under "Your recent changes" on Today (web/src/features/today/undo.ts), checked against a stand-in for the server and the browser:
//   the calls go in the classic order (undo, run until nothing is left, read Recent) with the X-Hub-Request header
//   a change is undone once, and a second press while the first runs does nothing
//   an "already undone" answer keeps the button off and still says Undone
//   a failure puts the button back and the toast says why
//   a toast goes through window.hubToast when it is there
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import './support/resolve-ts.mjs';

const calls = [];
let script;
const toasts = [];
const events = [];
const invalidated = [];

globalThis.window = globalThis;
globalThis.document = { dispatchEvent: (e) => events.push(e.type) };
globalThis.CustomEvent = class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } };
globalThis.hubToast = (msg, o) => { const t = { msg, o }; toasts.push(t); return { update: (m, o2) => toasts.push({ msg: m, o: o2 }) }; };
globalThis.fetch = async (path, init = {}) => {
  const method = init.method || 'GET';
  calls.push({ method, path, hub: init.headers && init.headers['X-Hub-Request'] });
  const r = script(method, path);
  return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
};
const qc = { invalidateQueries: ({ queryKey }) => invalidated.push(queryKey.join('/')) };

const { undoChange } = await import('../web/src/features/today/undo.ts');

beforeEach(() => { calls.length = 0; toasts.length = 0; events.length = 0; invalidated.length = 0; globalThis.favorUndoing = new Set(); });

describe('Today Undo', () => {
  it('undoes, sends the reversal, reads Recent and says Undone', async () => {
    script = (m, p) => p.endsWith('/undo') ? { body: { ok: true, batch: { id: 'u1' } } } : p.endsWith('/run') ? { body: { ok: true, left: 0 } } : { body: { ok: true, batches: [{ id: 'b1', undone: true }] } };
    await undoChange('b1', qc);
    assert.deepEqual(calls.map((c) => c.method + ' ' + c.path), ['POST /api/work/batches/b1/undo', 'POST /api/work/batches/u1/run', 'GET /api/work/recent']);
    assert.ok(calls.every((c) => c.hub === '1'));
    assert.equal(toasts[0].msg, 'Undoing…');
    assert.equal(toasts.at(-1).msg, 'Undone.');
    assert.ok(events.includes('favor:thanked-undone'));
    assert.ok(invalidated.includes('today/home'));
    assert.ok(window.favorUndoing.has('b1'), 'an undone change keeps its button off');
  });
  it('presses once', async () => {
    script = (m, p) => p.endsWith('/undo') ? { body: { ok: true } } : { body: { ok: true, batches: [{ id: 'b2', undone: true }] } };
    await Promise.all([undoChange('b2', qc), undoChange('b2', qc)]);
    assert.equal(calls.filter((c) => c.path.endsWith('/undo')).length, 1);
  });
  it('treats already_undone as done', async () => {
    script = (m, p) => p.endsWith('/undo') ? { status: 409, body: { ok: false, error: 'already_undone', message: 'x' } } : { body: { ok: true, batches: [{ id: 'b3', undone: true }] } };
    await undoChange('b3', qc);
    assert.equal(toasts.at(-1).msg, 'Undone.');
    assert.ok(window.favorUndoing.has('b3'));
  });
  it('puts the button back and says why when the undo fails', async () => {
    script = () => ({ status: 500, body: { ok: false, message: 'Blackbaud said no.' } });
    await undoChange('b4', qc);
    assert.equal(toasts.at(-1).msg, 'Blackbaud said no.');
    assert.equal(toasts.at(-1).o.tone, 'bad');
    assert.ok(!window.favorUndoing.has('b4'));
  });
  it('shows Undo again when Recent says some rows did not go back', async () => {
    script = (m, p) => p.endsWith('/undo') ? { body: { ok: true } } : { body: { ok: true, batches: [{ id: 'b5', undone: false, undoing: false }] } };
    await undoChange('b5', qc);
    assert.ok(!window.favorUndoing.has('b5'));
  });
});
