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

// The changelog: one file per day in src/content/changelog (YYYY-MM-DD.md, frontmatter only). Entries newest first,
// written for staff. `behind` counts internal-only commits that day. scripts/changelog-draft.mjs drafts a new day.
export const CHANGE_AREAS = ['today', 'partners', 'work-center', 'requests', 'projects', 'expenses', 'receipts', 'gifts', 'statements', 'evaluations', 'learn', 'onboarding', 'foundations', 'meetings', 'clips', 'chat', 'mail', 'brain', 'reporting', 'lists', 'admin', 'help', 'phone', 'everywhere'] as const;
const changelog = defineCollection({
  loader: glob({ pattern: ['**/*.md', '!**/*.draft.md'], base: './src/content/changelog' }),
  schema: z.object({
    date: z.union([z.string(), z.date()]).transform((d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))),
    entries: z
      .array(
        z.object({
          time: z.string().regex(/^\d{2}:\d{2}$/),
          area: z.enum(CHANGE_AREAS),
          type: z.enum(['new', 'improved', 'fixed']),
          text: z.string().min(8),
          /** A picture under public/changelog/ (WebP). `now: true` marks a current screenshot of an older change. */
          image: z.string().optional(),
          phone: z.string().optional(),
          now: z.boolean().optional(),
        }),
      )
      .default([]),
    behind: z.number().int().min(0).default(0),
  }),
});

export const collections = { help, changelog };
