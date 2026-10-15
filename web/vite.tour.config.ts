// The tour as an island for the classic Astro pages: one script (tour.js) and one stylesheet (tour.css) in dist/_tour, plus
// news.json, the changelog's recent entries for the What's new tour. The island runs the same component the web app mounts
// (src/features/tour), on Preact through its React layer so the script stays small. Build: npm --prefix web run tour.
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { firstSentence } from './src/features/tour/news';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

type Entry = { time: string; area: string; type: string; text: string };

/** Writes /_tour/news.json from src/content/changelog: the last 21 days of new and improved entries (at most 3 for each area), cut to a sentence each. */
function newsFile() {
  return {
    name: 'favor-tour-news',
    generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
      const dir = at('../src/content/changelog/');
      const days: Array<{ date: string; entries: Entry[] }> = [];
      for (const f of readdirSync(dir)) {
        if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) continue;
        const raw = readFileSync(dir + f, 'utf8').replace(/^﻿/, '');
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
        if (!m) continue;
        const data = parse(m[1]) as { date?: string | Date; entries?: Entry[] };
        const date = data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date || f.slice(0, 10));
        days.push({ date, entries: Array.isArray(data.entries) ? data.entries : [] });
      }
      days.sort((a, b) => b.date.localeCompare(a.date));
      const stamps = days.flatMap((d) => d.entries.map((e) => `${d.date}T${e.time}`));
      const latest = stamps.sort().at(-1) || '';
      const from = days[0] ? new Date(`${days[0].date}T12:00:00Z`) : new Date();
      from.setUTCDate(from.getUTCDate() - 21);
      const floor = from.toISOString().slice(0, 10);
      const entries = days
        .filter((d) => d.date >= floor)
        .flatMap((d) => d.entries.filter((e) => e.type === 'new' || e.type === 'improved').map((e) => ({ stamp: `${d.date}T${e.time}`, area: e.area, type: e.type, text: firstSentence(e.text) })))
        .sort((a, b) => (a.type === b.type ? b.stamp.localeCompare(a.stamp) : a.type === 'new' ? -1 : 1))
        .filter((e, _i, all) => all.filter((x) => x.area === e.area && (x.type === e.type ? x.stamp > e.stamp : e.type === 'improved' && x.type === 'new')).length < 3)
        .sort((a, b) => b.stamp.localeCompare(a.stamp));
      this.emitFile({ type: 'asset', fileName: 'news.json', source: JSON.stringify({ latest, entries }) });
    },
  };
}

export default {
  root: at('.'),
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react$/, replacement: 'preact/compat' },
      { find: /^@hub\//, replacement: at('../src/') },
    ],
  },
  plugins: [newsFile()],
  build: {
    outDir: at('../dist/_tour'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    cssMinify: 'lightningcss',
    lib: { entry: at('./src/features/tour/island.tsx'), name: 'FavorTour', formats: ['iife'], fileName: () => 'tour.js', cssFileName: 'tour' },
  },
};
