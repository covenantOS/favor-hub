// Chat on the web app draws its first paint from a generated copy of the classic page's frame. This fails when chat-ui.js changes the
// frame and the copy was not regenerated (node scripts/chat-boot-html.mjs --write).
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { classicBootHtml, bootFileSource } from '../scripts/chat-boot-html.mjs';

it('the generated first paint is the classic first paint', () => {
  // A Windows checkout may turn the file's line ends into CRLF; the content is what counts.
  const have = readFileSync(new URL('../web/src/features/chat-page/bootHtml.ts', import.meta.url), 'utf8').split('\r\n').join('\n');
  assert.equal(have, bootFileSource(classicBootHtml()));
});
