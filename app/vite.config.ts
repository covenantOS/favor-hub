import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// Preact's React-compatible layer: the same React API in about a fifth of the bytes (React and react-dom were 69 KB gzipped, this is 10).
// Types stay @types/react. Unit tests run on real React (testing-library needs it); the Playwright run covers the built Preact bundle.
const PREACT = {
  'react-dom/client': 'preact/compat/client',
  'react-dom/test-utils': 'preact/test-utils',
  'react/jsx-runtime': 'preact/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/jsx-runtime',
  'react-dom': 'preact/compat',
  react: 'preact/compat',
};

const here = fileURLToPath(new URL('.', import.meta.url));

// The React front end. Built into dist/_app after the Astro build (npm run build runs both), served by the Pages middleware
// for the routes an admin enabled (functions/_lib/app2.ts). Fonts and images stay at their root addresses (/fonts, /images).
export default defineConfig({
  root: here,
  base: '/_app/',
  define: { __BUILD__: JSON.stringify(String(Date.now())) },
  publicDir: false,
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }),
    react(),
  ],
  resolve: { alias: {
    ...(process.env.VITEST ? {} : PREACT), '@': fileURLToPath(new URL('./src', import.meta.url)), '@shared': fileURLToPath(new URL('../shared', import.meta.url)), '@hub': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: {
    outDir: '../dist/_app',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
    cssMinify: 'lightningcss',
    rollupOptions: {
      // The app, and the islands: React pieces that classic pages load by a fixed address (/_app/islands/<name>.js).
      input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), 'hl-cards': fileURLToPath(new URL('./src/islands/highlights.tsx', import.meta.url)) },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'hl-cards' ? 'islands/[name].js' : 'assets/[name]-[hash].js'),
        // Vendor code in its own long-lived files, so a release of our own code does not refetch React.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|preact)\//.test(id)) return 'react';
          if (id.includes('@tanstack/react-router') || id.includes('@tanstack/router-core') || id.includes('@tanstack/history')) return 'router';
          if (id.includes('@tanstack/') ) return 'query';
          if (id.includes('/zod/')) return 'zod';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5180,
    // npm run app:dev against the live site's API: pass HUB_ORIGIN and COOKIE in the environment (see docs/porting-to-react.md).
    proxy: process.env.HUB_ORIGIN ? { '/api': { target: process.env.HUB_ORIGIN, changeOrigin: true, headers: process.env.HUB_COOKIE ? { cookie: process.env.HUB_COOKIE } : {} } } : undefined,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts'],
    css: false,
  },
});
