// Data care: how likely two records are the same person. Pure functions, no database, so the tests can run every rule.
// A pair starts from a shared email (the only way a pair enters the list). Names and the ZIP code raise or lower the score.

const NICK: string[][] = [
  ['kathleen', 'kathy', 'kathie', 'cathy', 'katie', 'kate', 'katherine', 'catherine'],
  ['william', 'bill', 'billy', 'will', 'willie'],
  ['robert', 'bob', 'bobby', 'rob', 'robbie'],
  ['richard', 'rick', 'rich', 'ricky', 'dick'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['elizabeth', 'liz', 'beth', 'betty', 'lizzie', 'eliza'],
  ['margaret', 'peggy', 'peggie', 'maggie', 'meg'],
  ['michael', 'mike', 'mickey'],
  ['thomas', 'tom', 'tommy'],
  ['christopher', 'chris'],
  ['terry', 'terri', 'teri'],
  ['jennifer', 'jenny', 'jen'],
  ['joseph', 'joe', 'joey'],
  ['anthony', 'tony'],
  ['samuel', 'sam', 'sammy'],
  ['jonathan', 'jon', 'john', 'johnny'],
  ['susan', 'sue', 'suzy', 'susie'],
  ['deborah', 'debra', 'debbie', 'deb'],
  ['patricia', 'pat', 'patty', 'trish'],
  ['daniel', 'dan', 'danny'],
  ['david', 'dave'],
  ['steven', 'stephen', 'steve'],
  ['timothy', 'tim'],
  ['edward', 'ed', 'eddie', 'ted'],
  ['donald', 'don', 'donnie'],
  ['lorraine', 'lorrain', 'lori', 'lorainne'],
  ['gilford', 'gil', 'gilbert'],
];
const NICK_OF = new Map<string, number>();
NICK.forEach((g, i) => g.forEach((n) => NICK_OF.set(n, i)));

export const clean = (s: string | null | undefined): string =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The first word of a given name, the part nicknames and initials compare on. */
const firstWord = (s: string): string => clean(s).split(' ')[0] || '';

export type NameMatch = 'same' | 'nickname' | 'initial' | 'swapped' | 'last' | 'none';

export interface Person {
  first: string;
  last: string;
}

/** How the two names relate. 'swapped' means first and last name are exchanged (Anthony Wakimwai and Wakimwai Anthony). */
export function nameMatch(a: Person, b: Person): NameMatch {
  const af = firstWord(a.first);
  const bf = firstWord(b.first);
  const al = clean(a.last);
  const bl = clean(b.last);
  const aAll = clean(`${a.first} ${a.last}`).split(' ').filter(Boolean).sort().join(' ');
  const bAll = clean(`${b.first} ${b.last}`).split(' ').filter(Boolean).sort().join(' ');
  if (aAll && aAll === bAll) return af === bf && al === bl ? 'same' : 'swapped';
  const lastInitial = !!al && !!bl && (al.length === 1 || bl.length === 1) && al[0] === bl[0];
  const lastSame = !!al && !!bl && (al === bl || al.endsWith(' ' + bl) || bl.endsWith(' ' + al) || lastInitial);
  if (lastSame) {
    if (af && af === bf) return 'same';
    if (af && bf && NICK_OF.has(af) && NICK_OF.get(af) === NICK_OF.get(bf)) return 'nickname';
    if (af && bf && (af.length === 1 || bf.length === 1) && af[0] === bf[0]) return 'initial';
    if (af && bf && (af.startsWith(bf) || bf.startsWith(af)) && Math.min(af.length, bf.length) >= 3) return 'nickname';
    return 'last';
  }
  // A first name that sits inside the other record's last name field (Benedictus Wakimwai against Anthony Wakimwai Benedictus).
  if (af && af === bf && !al && !bl) return 'same';
  const aWords = new Set(clean(`${a.first} ${a.last}`).split(' ').filter(Boolean));
  const bWords = clean(`${b.first} ${b.last}`).split(' ').filter(Boolean);
  if (bWords.length >= 2 && bWords.every((w) => aWords.has(w))) return 'swapped';
  return 'none';
}

export interface PairFacts {
  a: Person;
  b: Person;
  /** How many records share the email. Three or more is a household or an office inbox. */
  group: number;
  sameZip: boolean;
}

export interface Scored {
  score: number;
  why: string;
}

export function scorePair(f: PairFacts): Scored {
  const m = nameMatch(f.a, f.b);
  let score = 30;
  const why = ['Same email'];
  if (m === 'same') {
    score += 40;
    why.push('names match');
  } else if (m === 'swapped') {
    score += 55;
    why.push('first and last name swapped');
  } else if (m === 'nickname') {
    score += 30;
    why.push('names match');
  } else if (m === 'initial') {
    score += 22;
    why.push('same last name, initial');
  } else if (m === 'last') {
    score += 4;
    why.push('same last name, different first names');
  }
  if (f.sameZip) {
    score += 12;
    why.push('same ZIP');
  }
  if (f.group > 2) score -= 8 * (f.group - 2);
  return { score: Math.max(1, Math.min(99, score)), why: why.join(', ') };
}

export const pairId = (x: string, y: string): string => {
  const [a, b] = Number(x) <= Number(y) ? [x, y] : [y, x];
  return `${a}-${b}`;
};

/** Pairs scoring below this stay off the list: a shared email alone, or a shared office inbox, is not enough to ask staff to look. */
export const MIN_SCORE = 45;
