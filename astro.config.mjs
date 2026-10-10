import { defineConfig } from 'astro/config';

export default defineConfig({
  // Pages the menu links to are fetched when a finger or pointer lands on the link (data-astro-prefetch).
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
  site: 'https://hub.favorintl.org',
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      assetsInlineLimit: 4096,
    },
  },
});
