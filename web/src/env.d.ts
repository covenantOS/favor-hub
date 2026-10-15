declare const __BUILD__: string;
declare const __HUB_BUILD__: string;
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}

// Built from src/content by vite-content.ts (the same Markdown files the Astro help pages read).
declare module 'virtual:help-meta' {
  export interface HelpDoc {
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
  }
  const docs: HelpDoc[];
  export default docs;
}
declare module 'virtual:help-loaders' {
  const loaders: Record<string, () => Promise<{ default: { html: string; toc: Array<{ slug: string; text: string }>; meta: import('virtual:help-meta').HelpDoc } }>>;
  export default loaders;
}
declare module 'virtual:changelog' {
  export interface ChangeEntry {
    time: string;
    area: string;
    type: string;
    text: string;
    image?: string;
    phone?: string;
    now?: boolean;
  }
  export interface ChangeDay {
    date: string;
    entries: ChangeEntry[];
    behind: number;
  }
  const days: ChangeDay[];
  export default days;
}
