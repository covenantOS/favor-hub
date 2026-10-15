// POC-only Vite plugin: the app2 HelpPanel and Bell call createPortal(..., document.body) while they render, which the server
// cannot do. This rewrites those calls to a portal that mounts after hydration. The real move makes the same edit in the source.
import type { Plugin } from 'vite';

const FILES = /app[\/]src[\/]shell[\/](HelpPanel|Bell)\.tsx$/;
const HELPER = `
import { useEffect as __uE, useState as __uS } from 'react';
function __ClientPortal(props: { node: any }) {
  const [m, setM] = __uS(false);
  __uE(() => setM(true), []);
  return m ? createPortal(props.node, document.body) : null;
}
const __clientPortal = (node: any, _t: unknown) => <__ClientPortal node={node} />;
`;

export function ssrSafePortals(): Plugin {
  return {
    name: 'favor-ssr-safe-portals',
    enforce: 'pre',
    transform(code, id) {
      if (!FILES.test(id.split('?')[0])) return null;
      const body = code.replace(/\{\s*createPortal\(/g, '{__clientPortal(').replace(/&&\s*createPortal\(/g, '&& __clientPortal(').replace(/document\.body(?=\s*\))/g, "(typeof document === 'undefined' ? null : document.body)");
      return { code: body + HELPER, map: null };
    },
  };
}
