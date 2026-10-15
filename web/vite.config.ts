// FavorOS web app: TanStack Start on a Cloudflare Worker (favoros-web). It reuses the app2 shell and hooks (../app/src), the shared
// schemas (../shared), the menu registry and scripts (../src) and the hub stylesheets (../src/styles) in place.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  resolve: {
    // ../app, ../shared and ../src resolve packages from here, one copy of each.
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router', 'zod'],
    alias: [
      { find: /^@\//, replacement: at('../app/src/') + '/' },
      { find: /^@shared\//, replacement: at('../shared/') + '/' },
      { find: /^@hub\//, replacement: at('../src/') + '/' },
    ],
  },
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
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart({ srcDirectory: 'src' }), react()],
});
