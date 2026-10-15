// The Brain's icon sprite as a script, so the dock's Favor Brain tab (dock-panel.js) can put it on any page the first time the
// tab opens. Without it the answer's icons (copy, download, open large and the rest) drew as empty circles in the dock.
import { SPRITE } from './_icons';

export const prerender = true;
export const GET = () =>
  new Response(`(function(){if(document.getElementById('bci-sprite'))return;var d=document.createElement('div');d.id='bci-sprite';d.innerHTML=${JSON.stringify(SPRITE)};document.body.appendChild(d);})();`, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
