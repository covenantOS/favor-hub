import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { api, ApiError, onApiWrite, send } from '@/lib/api';

const reply = (status: number, body: unknown) => vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('the typed API client', () => {
  it('returns the parsed answer and sends the hub header', async () => {
    const f = reply(200, { ok: true, n: 2 });
    vi.stubGlobal('fetch', f);
    const r = await api('/api/x', z.object({ ok: z.literal(true), n: z.number() }));
    expect(r.n).toBe(2);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-Hub-Request': '1' });
  });
  it('an answer that does not match its schema is an error that names the route', async () => {
    vi.stubGlobal('fetch', reply(200, { ok: true, n: 'two' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(api('/api/x', z.object({ ok: z.literal(true), n: z.number() }))).rejects.toMatchObject({ code: 'shape', message: expect.stringContaining('/api/x') });
  });
  it('the server message comes through on a failure', async () => {
    vi.stubGlobal('fetch', reply(403, { ok: false, error: 'not_allowed', message: 'Only leadership.' }));
    const e = (await api('/api/x', z.any()).catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, code: 'not_allowed', message: 'Only leadership.' });
  });
  it('a write tells listeners so the menu counts can refresh; a read does not', async () => {
    vi.stubGlobal('fetch', reply(200, { ok: true }));
    const seen = vi.fn();
    const off = onApiWrite(seen);
    await api('/api/x', z.any());
    expect(seen).not.toHaveBeenCalled();
    await send('/api/x', { a: 1 });
    expect(seen).toHaveBeenCalledOnce();
    off();
  });
});
