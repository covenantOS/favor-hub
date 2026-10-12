// The mention composer's stored form: a posted message is drawn from <@email> tokens, never by re-reading names out of the text.
// The typing behavior (pick, delete as one unit, edit beside a token) needs a browser and is checked there.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const ctx = { window: {}, document: { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) }, matchMedia: () => ({ matches: false }) };
createContext(ctx);
runInContext(readFileSync(new URL('../public/js/chat/mention-input.js', import.meta.url), 'utf8'), ctx);
const FM = ctx.window.FavorMention;
const names = { 'vic@favorintl.org': 'Vic Video', 'dan@favorintl.org': 'Dan Design' };

test('render draws each token as a tag with the name of the person, and marks my own', () => {
  const html = FM.render('hi <@vic@favorintl.org> and <@dan@favorintl.org>', names, 'dan@favorintl.org');
  assert.ok(html.includes('<span class="mi-chip" data-mi-id="vic@favorintl.org">@Vic Video</span>'));
  assert.ok(html.includes('<span class="mi-chip mi-chip--me" data-mi-id="dan@favorintl.org">@Dan Design</span>'));
});

test('a name typed as plain text is not a mention, and markup in a message stays text', () => {
  const html = FM.render('@Vic Video said <b>hello</b> <script>x</script>', names);
  assert.ok(!html.includes('mi-chip'));
  assert.ok(html.includes('&lt;b&gt;hello&lt;/b&gt;') && !html.includes('<script>'));
});

test('someone no longer on the list still reads as a name, from the address', () => {
  assert.ok(FM.render('<@lee@favorintl.org> left', names).includes('@lee</span>'));
  assert.equal(FM.plain('<@vic@favorintl.org> and <@lee@favorintl.org>', names), '@Vic Video and @lee');
});

test('names can come from a function, links open in a new tab', () => {
  const html = FM.render('<@vic@favorintl.org> see https://favorintl.org/about.', (id) => id.toUpperCase());
  assert.ok(html.includes('@VIC@FAVORINTL.ORG</span>'));
  assert.ok(html.includes('<a href="https://favorintl.org/about" target="_blank" rel="noopener">https://favorintl.org/about</a>.'));
});
