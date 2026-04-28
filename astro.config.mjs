import { defineConfig } from 'astro/config';

export default defineConfig({
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
