// FavorOS on TanStack Start, proof of concept (2026-10-14). Runs on Cloudflare Workers; reuses the app2 shell (../app/src),
// the menu registry (../src/data) and the hub stylesheets (../src/styles) in place, so nothing is copied.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { ssrSafePortals } from './src/poc/ssrSafe';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  resolve: {
    // ../app, ../shared and ../src have no node_modules of their own in this worktree: one copy of each package, from here.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'zod'],
    alias: [
      // The app2 rail hook reads matchMedia while it renders; the server has no window, so the POC uses an SSR-safe copy.
      { find: /^@\/shell\/useRail$/, replacement: at('./src/poc/useRail.ts') },
      { find: /^@\//, replacement: at('../app/src/') + '/' },
      { find: /^@shared\//, replacement: at('../shared/') + '/' },
      { find: /^@hub\//, replacement: at('../src/') + '/' },
    ],
  },
  build: { target: 'es2022', cssMinify: 'lightningcss' },
  environments: {
    client: {
      build: {
        rollupOptions: {
          output: {
            // Same vendor split as app2, so a release of our own code does not refetch React, and the sizes can be compared.
            manualChunks(id: string) {
              if (!id.includes('node_modules')) return undefined;
              if (/node_modules[\/](react|react-dom|scheduler|preact)[\/]/.test(id)) return 'react';
              if (/@tanstack[\/](react-start|start-|react-start-client)/.test(id)) return 'start';
              if (/@tanstack[\/](react-router|router-core|history|router-ssr)/.test(id)) return 'router';
              if (id.includes('@tanstack')) return 'query';
              if (/[\/]zod[\/]/.test(id)) return 'zod';
              return 'vendor';
            },
          },
        },
      },
    },
  },
  plugins: [ssrSafePortals(), cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({ srcDirectory: 'src' }), react()],
});
