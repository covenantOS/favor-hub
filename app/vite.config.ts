import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

const here = fileURLToPath(new URL('.', import.meta.url));

// The React front end. Built into dist/_app after the Astro build (npm run build runs both), served by the Pages middleware
// for the routes an admin enabled (functions/_lib/app2.ts). Fonts and images stay at their root addresses (/fonts, /images).
export default defineConfig({
  root: here,
  base: '/_app/',
  publicDir: false,
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }),
    react(),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)), '@shared': fileURLToPath(new URL('../shared', import.meta.url)), '@hub': fileURLToPath(new URL('../src', import.meta.url)) } },
  build: { outDir: '../dist/_app', emptyOutDir: true, target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 400 },
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
