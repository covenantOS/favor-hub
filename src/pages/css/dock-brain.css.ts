// The Brain page's own answer styles (src/styles/brain.css), served as a plain file so the floating dock can load them the first time
// its Favor Brain tab opens. Its rules sit under .h-body .bc-root, so they reach nothing outside an answer.
import brain from '../../styles/brain.css?raw';

export const prerender = true;
export const GET = () => new Response(brain, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
