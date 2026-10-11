// An R2 bucket stand-in held in memory, with the calls the hub's clip code uses: head, get (with a range, as a stream),
// put, delete, list and multipart uploads. `chunk` is how many bytes each read of a body returns.
import { createHash } from 'node:crypto';

const bytesOf = (data) => {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return new Uint8Array(data);
  return new Uint8Array(data);
};

export function memoryR2({ chunk = 4096 } = {}) {
  const objects = new Map();
  const uploads = new Map();
  const log = [];
  let seq = 0;
  const meta = (key) => {
    const b = objects.get(key);
    if (!b) return null;
    const etag = createHash('md5').update(b).digest('hex');
    return { key, size: b.byteLength, etag, httpEtag: `"${etag}"` };
  };
  const bucket = {
    objects,
    uploads,
    /** Every call, as "op key". */
    log,
    async head(key) {
      log.push(`head ${key}`);
      return meta(key);
    },
    async get(key, opts = {}) {
      log.push(`get ${key}`);
      const all = objects.get(key);
      if (!all) return null;
      const offset = opts.range && opts.range.offset ? opts.range.offset : 0;
      const length = opts.range && opts.range.length !== undefined ? opts.range.length : all.byteLength - offset;
      const part = all.subarray(offset, offset + length);
      let at = 0;
      return {
        ...meta(key),
        body: new ReadableStream({
          pull(c) {
            if (at >= part.byteLength) return c.close();
            c.enqueue(new Uint8Array(part.subarray(at, Math.min(at + chunk, part.byteLength))));
            at += chunk;
          },
        }),
        arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength),
        text: async () => new TextDecoder().decode(part),
      };
    },
    async put(key, data) {
      log.push(`put ${key}`);
      objects.set(key, bytesOf(data));
      return meta(key);
    },
    async delete(keys) {
      for (const k of [].concat(keys)) {
        log.push(`delete ${k}`);
        objects.delete(k);
      }
    },
    async list({ prefix = '' } = {}) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: objects.get(key).byteLength })), truncated: false };
    },
    async createMultipartUpload(key) {
      const uploadId = `up${++seq}`;
      uploads.set(uploadId, { key, parts: new Map() });
      return { key, uploadId };
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        async uploadPart(n, data) {
          const up = uploads.get(uploadId);
          if (!up || up.key !== key) throw new Error('no such upload');
          const b = bytesOf(data);
          if (bucket.onPart) bucket.onPart(n, b);
          up.parts.set(n, b);
          log.push(`part ${key} ${n}`);
          return { partNumber: n, etag: `e${n}-${b.byteLength}` };
        },
        async complete(parts) {
          const up = uploads.get(uploadId);
          if (!up) throw new Error('no such upload');
          const list = parts.map((p) => up.parts.get(p.partNumber));
          if (list.some((b) => !b)) throw new Error('missing part');
          // R2's rule: every part but the last is the same size.
          if (list.slice(0, -1).some((b) => b.byteLength !== list[0].byteLength)) throw new Error('parts differ in size');
          objects.set(key, new Uint8Array(Buffer.concat(list)));
          uploads.delete(uploadId);
          return meta(key);
        },
        async abort() {
          uploads.delete(uploadId);
        },
      };
    },
  };
  return bucket;
}
