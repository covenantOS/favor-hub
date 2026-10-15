// FavorOS web app: TanStack Start on a Cloudflare Worker (favoros-web). It reuses the app2 shell and hooks (../app/src), the shared
// schemas (../shared), the menu registry and scripts (../src) and the hub stylesheets (../src/styles) in place.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { contentPlugin } from './vite-content';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The Pages build's id (dist/version.json), so web pages carry the same hub-build stamp as classic pages and a home screen app
// reloads when either changes. ship-hub.mjs builds Pages first. Without a Pages build the stamp is empty and nothing reloads.
let hubBuild = '';
try {
  hubBuild = String(JSON.parse(readFileSync(at('../dist/version.json'), 'utf8')).build || '');
} catch {
  hubBuild = '';
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(String(Date.now())), __HUB_BUILD__: JSON.stringify(hubBuild) },
  resolve: {
    // ../app, ../shared and ../src resolve packages from here, one copy of each.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'zod'],
    alias: [
      { find: /^@\//, replacement: at('../app/src/') + '/' },
      { find: /^@shared\//, replacement: at('../shared/') + '/' },
      { find: /^@hub\//, replacement: at('../src/') + '/' },
      // The Clips engine files (recorder, editor math, share window) stay in public/js/clips, where the classic pages load them, and are bundled from there.
      { find: /^@clips\//, replacement: at('../public/js/clips/') + '/' },
    ],
  },
  // The repo root (../public/js, ../src, ../app) is read by the dev server too.
  server: { fs: { allow: [at('..')] } },
  build: { target: 'es2022', cssMinify: 'lightningcss' },
  environments: {
    // The server build resolves stylesheet and image URLs (import x from './x.css?url') too, so it must write the same /_w/ path the
    // client files live under. With the default it named /assets/layout-*.css, which the Worker never serves, and every page drew unstyled.
    ssr: { build: { assetsDir: '_w' } },
    client: {
      build: {
        // Built files live under /_w/ so they never meet the Astro (/_astro/) or app2 (/_app/) files on the same domain.
        assetsDir: '_w',
        rollupOptions: {
          output: {
            // Vendor code in its own long-lived files, so a release of our own code does not refetch React.
            manualChunks(id: string) {
              if (!id.includes('node_modules')) return undefined;
              if (/node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'react';
              if (/@tanstack[\/](react-router|router-core|history|router-ssr|react-start|start-)/.test(id)) return 'router';
              if (id.includes('@tanstack')) return 'query';
              if (/[\/]zod[\/]/.test(id)) return 'zod';
              return 'vendor';
            },
          },
        },
      },
    },
  },
  plugins: [contentPlugin(), cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({
      srcDirectory: 'src',
      // Each route's loader goes in its own chunk too, with the component: a loader that imports from its page's module (prefetchWork
      // from WorkPage) would otherwise pull the whole page into the first-screen chunk every page downloads.
      router: { codeSplittingOptions: { defaultBehavior: [['loader'], ['component'], ['pendingComponent', 'errorComponent', 'notFoundComponent']] } },
    }), react()],
});
