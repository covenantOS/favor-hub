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
    const number = render({ title: 't', files: [file({ kind: 'sheet', kind_label: 'Sheet', passages: [{ text: '', sheet: 'Totals', cell: { ref: 'C22', header: 'Annual budget', value: '$125,000' } }] })] });
    assert.match(number, /<div class="fnum"><b>\$125,000<\/b><span>Annual budget<\/span><em>Sheet Totals, cell C22<\/em><\/div>/);
  });

  it('reads a converted passage without its markdown marks and keeps a hash or star that belongs to the text', () => {
    const marked = render({ title: 't', files: [file({ passages: [{ text: '## Contents ### Page 1 BUDGET **Total** raised * first item * second item' }] })] });
    assert.match(marked, /<blockquote class="fq">Contents Page 1 BUDGET Total raised &middot; first item &middot; second item<\/blockquote>|<blockquote class="fq">Contents Page 1 BUDGET Total raised · first item · second item<\/blockquote>/);
    const cut = render({ title: 't', files: [file({ passages: [{ text: 'A template titled **"The Program: and more...' }] })] });
    assert.match(cut, /<blockquote class="fq">A template titled &quot;The Program: and more\.\.\.<\/blockquote>/);
    const kept = render({ title: 't', files: [file({ passages: [{ text: 'Item #5 in C# costs 5* more' }] })] });
    assert.match(kept, /Item #5 in C# costs 5\* more/);
  });

  it('shows a sheet cell with words as a quote, and leaves out a column the sheet never named', () => {
    const cell = (value, header = 'col A') => render({ title: 't', files: [file({ kind: 'sheet', kind_label: 'Sheet', passages: [{ text: '', sheet: 'Summary', cell: { ref: 'A6', header, value } }] })] });
    assert.match(cell('Submissions (proposals and letters)'), /<blockquote class="fq">Submissions \(proposals and letters\)<em>Sheet Summary, cell A6<\/em><\/blockquote>/);
    assert.match(cell('Submissions', 'Program'), /<em>Program &middot; Sheet Summary, cell A6<\/em>/);
    assert.match(cell('$125,000'), /<div class="fnum"><b>\$125,000<\/b><em>Sheet Summary, cell A6<\/em><\/div>/);
    for (const v of ['12', '41%', '$1.2M', '(1,200)', '3.5 K']) assert.match(cell(v), /class="fnum"/, v);
    for (const v of ['12 pastors', 'Q4', 'n/a']) assert.doesNotMatch(cell(v), /class="fnum"/, v);
  });

  it('shows a photo answer as a justified grid of pictures that mark themselves loaded', () => {
    const html = render({ title: 't', files: [file({ id: 'abcdefghij12', kind: 'image', kind_label: 'Photo', hint: true, passages: [], description: 'A man at a radio microphone.', like: 'More photos like x [like:abcdefghij12]', image: { width: 4628, height: 6934, bytes: 22020096, grade: 'high' } })] });
    assert.match(html, /class="card fcards fcards--media"/);
    assert.match(html, /<div class="mg" role="list" data-mgrid>/);
    assert.match(html, /class="mg__t is-hq" role="listitem" data-act="media" data-mid="abcdefghij12" style="--r:0\.667"/);
    assert.match(html, /aria-label="Quarterly Budget, High quality, 4628 × 6934, 21 MB\. Open large"/);
    assert.match(html, /<img src="\/api\/brain\/drive\/thumb\?id=abcdefghij12&amp;s=400" alt="" loading="lazy" decoding="async" onload="this\.parentNode\.classList\.add\('is-ready'\)" onerror="this\.parentNode\.classList\.add\('is-broken'\)">/);
    assert.match(html, /draggable="true"/);
    assert.doesNotMatch(html, /\$\d/);
    // An old answer with no media data has no filters and no Show more.
    assert.doesNotMatch(html, /class="mf"|data-act="mmore"/);
  });

  it('adds filters, the count and Show more when the answer carries its media query', () => {
    const files = Array.from({ length: 24 }, (_, i) => file({ id: 'abcdefghij' + String(i).padStart(2, '0'), kind: 'image', image: { width: 1200, height: 800, bytes: 300000, grade: 'low' } }));
    const media = { kind: 'image', total: 1423, exact: true, next: 24, query: { q: 'photos of Chad', kind: 'image', place: 'chad' }, facets: { place: [{ value: 'chad', label: 'Chad', n: 1423 }], year: [{ value: '2024', label: '2024', n: 900 }], grade: [], folder: [{ value: 'Baptisms', label: 'Baptisms', n: 210 }] } };
    const html = render({ title: 'I found 1,423 photos', files, media });
    assert.match(html, /<select data-mk="m\d+" data-key="place" onchange="window\.BrainBlocks&amp;&amp;window\.BrainBlocks\.mfilter\(this\)">|<select data-mk="m\d+" data-key="place" onchange="window\.BrainBlocks&&window\.BrainBlocks\.mfilter\(this\)">/);
    assert.match(html, /<option value="chad" selected>Chad \(1,423\)<\/option>/);
    assert.match(html, /data-key="grade"/);
    assert.match(html, /data-act="mmore" data-mk="m\d+">Show more<\/button><span>Showing 24 of 1,423<\/span>/);
    assert.equal((html.match(/class="mg__t/g) || []).length, 24);
  });

  it('shows a video with its thumbnail, length and the matched moment as one line, the raw text behind Details', () => {
    const v = file({ id: 'videoid00001', title: 'Carole Ward - Session 2.mp4', kind: 'video', kind_label: 'Video', modified: '2022-03-08', passages: [{ text: 'The image shows a woman standing on a stage.', loc: '15:21-15:30' }], like: 'More videos like x [like:videoid00001]', video: { duration: 1834, at: 921, line: 'Carole standing on a stage with a microphone' } });
    const html = render({ title: 'I found 1 video', files: [v] });
    assert.match(html, /<div class="vg" role="list" data-mgrid>/);
    assert.match(html, /aria-label="Play Carole Ward - Session 2\.mp4 from 15:21"/);
    assert.match(html, /<span class="vg__dur">30:34<\/span>/);
    assert.match(html, /Carole standing on a stage with a microphone, <time>15:21<\/time>/);
    assert.match(html, /<details class="vg__d"><summary>Details<\/summary><p>The image shows a woman standing on a stage\.<\/p><\/details>/);
    assert.match(html, /src="\/api\/brain\/drive\/thumb\?id=videoid00001&amp;s=400"/);
    assert.match(html, /data-q="More videos like x \[like:videoid00001\]"/);
  });

  it('reads the time and a short line from a video answer stored before the grid', () => {
    const v = file({ id: 'videoid00002', title: 'Old.mp4', kind: 'video', kind_label: 'Video', passages: [{ text: '[Scene at 15:21] The image shows a woman standing on a stage with a microphone in her hand. She is wearing a green sweater.', loc: '15:21-15:30' }] });
    const html = render({ title: 'I found 1 video', files: [v] });
    assert.match(html, /A woman standing on a stage with a microphone, <time>15:21<\/time>/);
    assert.doesNotMatch(html, /\[Scene at/);
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

  it('keeps the weaker matches behind a quiet N more matches line that opens in place', () => {
    const more = [file({ id: '2', title: 'Awarded Grants' }), file({ id: '3', title: 'Grant Tracker', kind: 'sheet', kind_label: 'Sheet' })];
    const html = render({ title: 'I found this file', files: [file({ title: 'Grants Comparison' })], more });
    assert.match(html, /<details class="fmore"><summary>2 more matches<svg/);
    assert.equal((html.match(/class="frow /g) || []).length, 3);
    // The extra rows sit inside the disclosure, after the file that shows at once.
    const open = html.indexOf('<details class="fmore">');
    assert.ok(html.indexOf('Grants Comparison') < open);
    assert.ok(html.indexOf('Awarded Grants') > open && html.indexOf('Grant Tracker') > open);
    assert.equal((html.match(/Open in Drive/g) || []).length, 3);
  });

  it('reads one more match in the singular and draws no control when nothing waits', () => {
    assert.match(render({ title: 't', files: [file()], more: [file({ id: '2' })] }), /<summary>1 more match<svg/);
    assert.doesNotMatch(render({ title: 't', files: [file()] }), /fmore|more match/);
    assert.doesNotMatch(render({ title: 't', files: [file()], more: [] }), /fmore|more match/);
  });

  it('escapes the files behind the control the same way', () => {
    const html = render({ title: 't', files: [file()], more: [file({ id: '2', title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)' })] });
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /href="#"/);
  });

  it('draws a card with no files without breaking', () => {
    const html = render({ title: 'I found 0 files', files: [] });
    assert.match(html, /<div class="frows" role="list"><\/div>/);
  });
});
