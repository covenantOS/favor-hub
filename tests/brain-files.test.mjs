// Run with: npm test
//
// The Drive file cards on the Favor Brain page (public/js/brain-blocks.js, block type "files"): one card per file
// with the owner, the dates, an Open in Drive link and the passage or the sheet number, a short "Indexed" day on
// each file the index has read, no explanatory note, and escaped text. The script is a browser file, so it runs
// here in a sandbox with the few browser globals it touches at load. Made-up files only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/js/brain-blocks.js', import.meta.url), 'utf8');
function load() {
  const win = {};
  const sandbox = {
    window: win,
    document: { addEventListener() {}, body: {}, querySelectorAll: () => [] },
    addEventListener() {},
    MutationObserver: class { observe() {} },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return win.BrainBlocks;
}
const B = load();
const render = (b) => B.render({ type: 'files', ...b }, { ti: 0, bi: 0 });
const file = (over = {}) => ({ id: '1', title: 'Quarterly Budget', kind: 'doc', kind_label: 'Doc', owner: 'Example Team', modified: '2026-07-28', link: 'https://drive.google.com/open?id=1', folder: 'Budgets / 2026', passages: [], ...over });
const thisYear = new Date().getFullYear();

describe('Drive file cards', () => {
  it('draws one row per file with the title, owner, date, folder and an Open in Drive link', () => {
    const html = render({ title: 'I found 2 files', files: [file(), file({ id: '2', title: 'Team Photo.jpeg', kind: 'image', kind_label: 'Image' })] });
    assert.equal((html.match(/class="frow /g) || []).length, 2);
    assert.match(html, /I found 2 files/);
    assert.match(html, /Quarterly Budget/);
    assert.match(html, /Example Team &middot; Jul 28, 2026/);
    assert.match(html, /<div class="frow__f">Budgets \/ 2026<\/div>/);
    assert.equal((html.match(/Open in Drive/g) || []).length, 2);
    assert.match(html, /href="https:\/\/drive\.google\.com\/open\?id=1" target="_blank" rel="noopener"/);
  });

  it('keeps the lock label and drops every explanatory note', () => {
    const html = render({ title: 'I found this file', files: [file()], note: 'The text shown is from the last index run. Open the file to confirm it.' });
    assert.equal((html.match(/Only files your Google account can open/g) || []).length, 1);
    assert.doesNotMatch(html, /last index run|Open the file to confirm|Open it to check|machine description/);
  });

  it('shows the day a file was indexed, with the year only when it is not this one', () => {
    const now = render({ title: 't', files: [file({ indexed: `${thisYear}-03-05` })] });
    assert.match(now, /Indexed <time datetime="\d{4}-03-05">Mar 5<\/time>/);
    const old = render({ title: 't', files: [file({ indexed: `${thisYear - 2}-12-02` })] });
    assert.match(old, new RegExp(`Indexed <time datetime="${thisYear - 2}-12-02">Dec 2, ${thisYear - 2}</time>`));
    assert.doesNotMatch(render({ title: 't', files: [file()] }), /Indexed/);
  });

  it('shows a quote with its page, or the number with its sheet and cell', () => {
    const quote = render({ title: 't', files: [file({ passages: [{ text: 'Volunteers arrive at 7:30.', loc: 'page 4' }] })] });
    assert.match(quote, /<blockquote class="fq">Volunteers arrive at 7:30\.<em>page 4<\/em><\/blockquote>/);
    const number = render({ title: 't', files: [file({ kind: 'sheet', kind_label: 'Sheet', passages: [{ text: '', sheet: 'Totals', cell: { ref: 'C22', header: '2025 awarded', value: '$641,000' } }] })] });
    assert.match(number, /<div class="fnum"><b>\$641,000<\/b><span>2025 awarded<\/span><em>Sheet Totals, cell C22<\/em><\/div>/);
  });

  it('shows a sheet cell with words as a quote, and leaves out a column the sheet never named', () => {
    const cell = (value, header = 'col A') => render({ title: 't', files: [file({ kind: 'sheet', kind_label: 'Sheet', passages: [{ text: '', sheet: 'Summary', cell: { ref: 'A6', header, value } }] })] });
    assert.match(cell('Submissions (proposals and letters)'), /<blockquote class="fq">Submissions \(proposals and letters\)<em>Sheet Summary, cell A6<\/em><\/blockquote>/);
    assert.match(cell('Submissions', 'Program'), /<em>Program &middot; Sheet Summary, cell A6<\/em>/);
    assert.match(cell('$641,000'), /<div class="fnum"><b>\$641,000<\/b><em>Sheet Summary, cell A6<\/em><\/div>/);
    for (const v of ['12', '41%', '$1.2M', '(1,200)', '3.5 K']) assert.match(cell(v), /class="fnum"/, v);
    for (const v of ['12 pastors', 'Q4', 'n/a']) assert.doesNotMatch(cell(v), /class="fnum"/, v);
  });

  it('marks a photo matched by its description with a short label and quotes nothing', () => {
    const html = render({ title: 't', files: [file({ kind: 'image', kind_label: 'Image', hint: true, passages: [] })] });
    assert.match(html, /<span class="tag">Matched by picture description<\/span>/);
    assert.doesNotMatch(html, /fq|fnum/);
  });

  it('takes the type color from a fixed list, so an odd type cannot reach a class name', () => {
    const html = render({ title: 't', files: [file({ kind: 'sheet' }), file({ kind: 'pdf' }), file({ kind: 'slides' }), file({ kind: 'video' }), file({ kind: 'x" onmouseover="alert(1)' })] });
    for (const k of ['sheet', 'pdf', 'slides', 'video', 'other']) assert.match(html, new RegExp(`class="frow frow--${k}"`));
    assert.doesNotMatch(html, /onmouseover/);
  });

  it('escapes text and refuses a link that is not a web address', () => {
    const html = render({ title: '<b>t</b>', files: [file({ title: '<img src=x onerror=alert(1)>', owner: 'A & B', link: 'javascript:alert(1)', passages: [{ text: '<script>x</script>' }] })] });
    assert.doesNotMatch(html, /<img src=x|<script>|<b>t<\/b>/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /A &amp; B/);
    assert.match(html, /href="#"/);
  });

  it('draws a card with no files without breaking', () => {
    const html = render({ title: 'I found 0 files', files: [] });
    assert.match(html, /<div class="frows" role="list"><\/div>/);
  });
});
