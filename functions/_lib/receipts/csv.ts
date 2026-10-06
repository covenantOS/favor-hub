// Reader for the CSV a Raiser's Edge query job returns. A quoted field may
// hold commas, doubled quotes and line breaks (an address with two lines).

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const head = rows.shift() ?? [];
  const out: Record<string, string>[] = [];
  for (const r of rows) {
    if (r.length === 1 && r[0] === '') continue;
    const rec: Record<string, string> = {};
    head.forEach((h, k) => {
      rec[h] = r[k] ?? '';
    });
    out.push(rec);
  }
  return out;
}
