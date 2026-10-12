// How a partner is named in a sentence. One place for the server (next-action lines in functions/_lib/brief) and the app, so a name with an
// accent or in French or Spanish is read the same everywhere. JavaScript's \b sees only ASCII letters, so words are compared with the
// accents folded away ("Église" is "eglise") and split on anything that is not a letter or digit.

/** The name without accents, lower case. */
export const fold = (s: string): string => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const ORG_WORDS = new Set([
  'church', 'chapel', 'foundation', 'fund', 'trust', 'inc', 'llc', 'corp', 'company', 'fellowship', 'assembly', 'association', 'society', 'school', 'university', 'college',
  'center', 'centre', 'international', 'engines', 'ministry', 'ministries', 'mission', 'missions', 'cathedral', 'parish', 'synagogue', 'temple', 'club', 'council', 'alliance', 'partners', 'group',
  // French and Spanish names that appear in the partner list.
  'eglise', 'paroisse', 'ministere', 'fondation', 'ecole', 'universite', 'iglesia', 'parroquia', 'ministerio', 'fundacion', 'escuela', 'asociacion', 'sociedad', 'comunidad', 'fraternite', 'communaute',
]);
const ORG_START = new Set(['the', 'a', 'le', 'la', 'les', 'el', 'los', 'las', 'l']);

/** A church, a company, a foundation: a name that has no first name in it. */
export function isOrgName(name: string): boolean {
  const n = fold(name);
  if (/[&\d]/.test(n)) return true;
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length && ORG_START.has(words[0])) return true;
  return words.some((w) => ORG_WORDS.has(w) || /^ministr/.test(w) || /^charit/.test(w));
}

const TITLES = /^(mr|mrs|ms|miss|dr|rev|pastor|fr|sr|prof|hon)\.?$/i;

/** An organization by its full name, a person by first name, a couple as "Ben and Cora". */
export function shortName(name: string, org: boolean): string {
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n) return 'them';
  if (org) return n;
  const w = n.split(' ').filter((x) => !TITLES.test(x));
  if (w.length >= 4 && /^and$|^&$/i.test(w[1])) return `${w[0]} and ${w[2]}`;
  return w[0] || 'them';
}
