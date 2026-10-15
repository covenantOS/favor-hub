// Two shell defects fixed together (2026-10-15): the phone header jumped when the tab row streamed in after the first paint, and a page
// returned to with Back kept a hidden second copy of its streamed parts. Both fixes live in small files; these checks keep them there.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('the top bar before the menu answer', () => {
  const shell = read('web/src/shell/WebShell.tsx');
  const wait = read('web/src/shell/TopWait.tsx');

  it('the web frame draws the same shape as the top bar, not a title alone', () => {
    assert.match(shell, /fallback=\{<TopWait navId=\{navId\} title=\{title\} \/>\}/);
    assert.doesNotMatch(shell, /h-top--wait/);
  });

  it('holds the tab row space without showing a page name or anything to tap', () => {
    assert.match(wait, /className="h-top__tabs"/);
    assert.match(wait, /tabRowHeldFor\(navId, hint\)/);
    assert.match(wait, /aria-hidden="true" inert/);
    const row = wait.slice(wait.indexOf('<nav'), wait.indexOf('</nav>'));
    assert.doesNotMatch(wait, /TabRow|NavLink|href=/);
    assert.doesNotMatch(row, /label|\{[^}]*page/);
    assert.match(read('src/styles/settle.css'), /\.h-tabs--wait \{ visibility: hidden/);
  });
});

describe('streamed parts after a stalled frame or a Back', () => {
  const root = read('web/src/routes/__root.tsx');

  it('presets $RT so React reveals streamed parts on a timer, not on an animation frame', () => {
    assert.match(root, /const BOOT = `window\.\$RT=-1e4;/);
  });

  it('still matches the reveal script of the React that ships', { skip: !existsSync(new URL('../web/node_modules/react-dom/package.json', import.meta.url)) && 'web packages not installed' }, () => {
    // React's inline $RC picks requestAnimationFrame unless $RT is a number. A React upgrade that changes this needs a new look.
    const fizz = read('web/node_modules/react-dom/cjs/react-dom-server.browser.production.js');
    assert.ok(fizz.includes('"number"!==typeof $RT'), 'react-dom no longer reads $RT in its reveal script');
    assert.ok(fizz.includes('requestAnimationFrame($RV.bind(null,$RB))'), 'react-dom changed how it schedules the reveal');
  });

  it('is checked live by live-back.mjs after every ship', () => {
    assert.match(read('scripts/live-back.mjs'), /S:/);
    assert.match(read('scripts/ship-train.mjs'), /live-back\.mjs/);
    assert.match(read('scripts/ship-hub.mjs'), /live-back\.mjs/);
  });
});
