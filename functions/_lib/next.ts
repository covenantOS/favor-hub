// Where a sign-in returns the person to. Only a path on this site: one slash, then a character that is
// neither a slash nor a backslash (browsers read "/\evil.com" as "//evil.com"), and printable ASCII only,
// so no tab or newline (browsers strip those, so "/<tab>/evil.com" would also become "//evil.com").
const NEXT_RE = /^\/(?![\/\\])[\x21-\x7e]*$/;
const MAX_NEXT = 2000;

export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length > MAX_NEXT || !NEXT_RE.test(raw)) return fallback;
  return raw;
}
