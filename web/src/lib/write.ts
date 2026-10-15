// A write from the browser to the hub's own /api (same origin, X-Hub-Request header like app2's send()), checked by the parse function (a zod schema's parse).
export class WriteError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WriteError';
    this.status = status;
  }
}

export async function hubSend<T>(path: string, method: 'POST' | 'PUT', body: unknown, parse: (data: unknown) => T): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Hub-Request': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
  if (!res.ok || !data || data.ok === false) throw new WriteError((data && data.message) || 'Something went wrong. Try again.', res.status);
  return parse(data);
}
