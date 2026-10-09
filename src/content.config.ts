// The hub's help docs: one Markdown file per topic in src/content/help. `for` lists who the article is
// mainly for (all, admin, approver, kpi, rdd, pc, ce, grants, marketing, leader); the help pages put
// those first for each person and hide admin-only articles from everyone else.
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    topic: z.enum(['start', 'work', 'partners', 'numbers', 'ask', 'blackbaud', 'help']),
    order: z.number(),
    for: z.array(z.string()).default(['all']),
    videos: z.array(z.string()).default([]),
    related: z.array(z.string()).default([]),
    tool: z.string().optional(),
    toolLabel: z.string().optional(),
    // YAML reads 2026-10-09 as a date; keep it as the plain YYYY-MM-DD text.
    updated: z.union([z.string(), z.date()]).transform((d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))),
  }),
});

export const collections = { help };
