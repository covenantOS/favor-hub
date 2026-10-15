// Help articles and the What's new days, read from src/content (the same Markdown files the Astro pages read) at build time and
// handed to the web app as virtual modules, so no Markdown renderer ships to the browser:
//   virtual:help-meta             every article's frontmatter, sorted by order
//   virtual:help-loaders          { slug: () => import(article) }, one chunk per article
//   virtual:help-article/<slug>   { html, toc } for one article, rendered by the processor Astro uses
//   virtual:changelog             the day files, newest first, entries newest first
// A topic or area the pages do not know fails the build, so a new one is added to the pages first.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { parse } from 'yaml';
import type { Plugin } from 'vite';
import { TOPICS } from '../src/data/help-topics';
import { AREA_LABEL } from '../src/data/changelog';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const HELP = at('../src/content/help');
const CHANGELOG = at('../src/content/changelog');
const PREFIX = '\0';

interface Raw {
  data: Record<string, unknown>;
  body: string;
}

function split(file: string, text: string): Raw {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  try {
    return { data: (parse(m[1]) as Record<string, unknown>) || {}, body: m[2] };
  } catch (e) {
    throw new Error(`content: ${file} has frontmatter that does not parse: ${(e as Error).message}`);
  }
}

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));

function readDir(dir: string, skip?: RegExp): Array<{ id: string; raw: Raw }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !(skip && skip.test(f)))
    .sort()
    .map((f) => ({ id: f.replace(/\.md$/, ''), raw: split(f, readFileSync(`${dir}/${f}`, 'utf8')) }));
}

interface Doc {
  id: string;
  title: string;
  summary: string;
  topic: string;
  order: number;
  for: string[];
  related: string[];
  tool?: string;
  toolLabel?: string;
  updated: string;
  body: string;
}

let docsCache: Doc[] | null = null;
let daysCache: ReturnType<typeof changelogDays> | null = null;
const articleCache = new Map<string, string>();

function helpDocs(): Doc[] {
  if (docsCache) return docsCache;
  const topics = new Set(TOPICS.map((t) => t.id));
  docsCache = readDir(HELP)
    .map(({ id, raw }) => {
      const d = raw.data;
      for (const k of ['title', 'summary', 'topic', 'order', 'updated']) if (d[k] === undefined) throw new Error(`content: help/${id}.md has no ${k}`);
      if (!topics.has(String(d.topic))) throw new Error(`content: help/${id}.md has the topic "${d.topic}", which the help pages do not list (src/data/help-topics.ts)`);
      return {
        id,
        title: String(d.title),
        summary: String(d.summary),
        topic: String(d.topic),
        order: Number(d.order),
        for: Array.isArray(d.for) ? d.for.map(String) : ['all'],
        related: Array.isArray(d.related) ? d.related.map(String) : [],
        ...(d.tool ? { tool: String(d.tool) } : {}),
        ...(d.toolLabel ? { toolLabel: String(d.toolLabel) } : {}),
        updated: day(d.updated),
        body: raw.body,
      };
    })
    .sort((a, b) => a.order - b.order);
  return docsCache;
}

function changelogDays() {
  if (daysCache) return daysCache;
  daysCache = readDir(CHANGELOG, /\.draft\.md$/)
    .map(({ id, raw }) => {
      const d = raw.data;
      const entries = (Array.isArray(d.entries) ? d.entries : []).map((e: Record<string, unknown>) => {
        if (!/^\d{2}:\d{2}$/.test(String(e.time))) throw new Error(`content: changelog/${id}.md has an entry with the time "${e.time}"`);
        if (!(String(e.area) in AREA_LABEL)) throw new Error(`content: changelog/${id}.md has the area "${e.area}", which the page does not list (src/data/changelog.ts)`);
        if (!['new', 'improved', 'fixed'].includes(String(e.type))) throw new Error(`content: changelog/${id}.md has the type "${e.type}"`);
        return {
          time: String(e.time),
          area: String(e.area),
          type: String(e.type),
          text: String(e.text),
          ...(e.image ? { image: String(e.image) } : {}),
          ...(e.phone ? { phone: String(e.phone) } : {}),
          ...(e.now ? { now: true } : {}),
        };
      });
      entries.sort((a, b) => b.time.localeCompare(a.time));
      return { date: day(d.date), entries, behind: Number(d.behind) || 0 };
    })
    .filter((d) => d.entries.length || d.behind)
    .sort((a, b) => b.date.localeCompare(a.date));
  return daysCache;
}

export function contentPlugin(): Plugin {
  let processor: Awaited<ReturnType<typeof createMarkdownProcessor>> | null = null;
  return {
    name: 'favoros-content',
    // A changed file (dev server) or a new build starts from the files again.
    buildStart() {
      docsCache = null;
      daysCache = null;
      articleCache.clear();
    },
    watchChange(file) {
      if (file.includes('src/content') || file.includes('src\content')) {
        docsCache = null;
        daysCache = null;
        articleCache.clear();
      }
    },
    resolveId(id) {
      if (id === 'virtual:help-meta' || id === 'virtual:help-loaders' || id === 'virtual:changelog' || id.startsWith('virtual:help-article/')) return PREFIX + id;
      return null;
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const name = id.slice(PREFIX.length);
      if (name === 'virtual:help-meta') {
        this.addWatchFile(HELP);
        return `export default ${JSON.stringify(helpDocs().map(({ body: _b, ...rest }) => rest))};`;
      }
      if (name === 'virtual:help-loaders') {
        this.addWatchFile(HELP);
        const rows = helpDocs().map((d) => `${JSON.stringify(d.id)}: () => import(${JSON.stringify('virtual:help-article/' + d.id)})`);
        return `export default { ${rows.join(', ')} };`;
      }
      if (name === 'virtual:changelog') {
        this.addWatchFile(CHANGELOG);
        return `export default ${JSON.stringify(changelogDays())};`;
      }
      if (name.startsWith('virtual:help-article/')) {
        const slug = name.slice('virtual:help-article/'.length);
        const doc = helpDocs().find((d) => d.id === slug);
        if (!doc) throw new Error(`content: no help article ${slug}`);
        this.addWatchFile(`${HELP}/${slug}.md`);
        let code = articleCache.get(slug);
        if (!code) {
          processor ??= await createMarkdownProcessor({ syntaxHighlight: false });
          const out = await processor.render(doc.body);
          const toc = out.metadata.headings.filter((h) => h.depth === 2).map((h) => ({ slug: h.slug, text: h.text }));
          const { body: _body, ...meta } = doc;
          code = `export default ${JSON.stringify({ html: out.code, toc, meta })};`;
          articleCache.set(slug, code);
        }
        return code;
      }
      return null;
    },
  };
}
