// Calls to /api/evaluations. Everything here runs in the browser: the evaluation screens carry answers and reviewer feedback, so nothing is
// read on the server. The Astro page showed the server's message and kept its error code; these helpers do the same.

export class EvalError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'EvalError';
    this.status = status;
    this.code = code;
  }
}

type Body = { ok?: boolean; message?: string; error?: string } & Record<string, unknown>;

/** One call to /api/evaluations/<path>. Throws EvalError with the server's message and code when the answer is not ok. */
export async function evalCall<T = Body>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T & Body> {
  const res = await fetch('/api/evaluations/' + path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Body;
  if (!res.ok || data.ok === false) throw new EvalError(data.message || data.error || 'That did not work. Try again.', res.status, data.error || '');
  return data as T & Body;
}

export const evalGet = <T = Body>(path: string) => evalCall<T>('GET', path);
