// Reads a tribute out of a Blackbaud gift comment. Staff wrote these by hand ("In memory of Luther Tinsley"), so the rules are
// the phrases seen on the comments since 2023. A comment that names nobody returns null.
export interface ParsedTribute {
  kind: 'honor' | 'memorial';
  honoree: string;
}

const clean = (raw: string): string => {
  let s = raw.split(/[#\n]/)[0];
  s = s.split(/\s+-\s+/).pop() || s;
  s = s.replace(/\s+of your staff\b.*$/i, '').replace(/['’]s\s+birthday\b.*$/i, '').replace(/\s+in (?:his|her|their)\b.*$/i, '').replace(/\s+in Jesus.*$/i, '');
  s = s.replace(/^["“]+|["”]+$/g, '').replace(/[\s.!,;:"”]+$/g, '').trim();
  return s.slice(0, 120);
};

export function parseTribute(comment: string | null | undefined): ParsedTribute | null {
  const text = String(comment || '').replace(/\s+/g, ' ');
  if (!text) return null;
  // An online gift keeps the donor's own words after "Donor note:".
  const note = text.match(/Donor note:\s*(.+)$/i);
  const body = note ? note[1] : text;
  const rules: Array<[RegExp, ParsedTribute['kind']]> = [
    [/\bin (?:loving )?memory of\s+(.+)/i, 'memorial'],
    [/\bin memoriam\s+(.+)/i, 'memorial'],
    [/^(.+?)\s+memorial fund\b/i, 'memorial'],
    [/\bin honou?r of\s+(.+)/i, 'honor'],
    [/\btribute to\s+(.+)/i, 'honor'],
    [/\bto honou?r\s+(?!the name\b)(.+)/i, 'honor'],
  ];
  for (const [re, kind] of rules) {
    const m = body.match(re);
    if (!m) continue;
    const honoree = clean(m[1]);
    if (honoree.length >= 2) return { kind, honoree };
  }
  return null;
}
