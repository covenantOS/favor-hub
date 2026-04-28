# Favor International — Hub

> Transformed hearts transform nations.

A modern, animated, editorial mission-control dashboard for the Favor International team — fast access to BlackBaud, Paycom, Asana, GoHighLevel, the media folder, and field resources.

Built with [Astro](https://astro.build), zero JS framework runtime, deployed on Cloudflare Pages.

## What's inside

- **Hero ticker** — animated KPI counts (souls saved, discipled)
- **10 tool tiles** — every external destination the team uses, one click away
- **Founder spotlight** — Carole Ward + the book
- **Field gallery** — photos from Northern Uganda & South Sudan
- **RDD Reports** — password-protected (`/rdd`) gateway to the KPI dashboard and Revenue dashboard
- **Quick links rail** — YouTube, donate, book, website
- **Footer** — accountability badges, address, social

## Local development

```bash
npm install
npm run dev          # localhost:4321
npm run build        # production build → dist/
npm run preview      # preview the prod build
```

## Deploy (Cloudflare Pages)

1. Connect this GitHub repo to Cloudflare Pages.
2. Build command: `npm run build`
3. Build output: `dist`
4. Node version: 20+

That's it — pushes to `main` deploy automatically.

## Editing tile destinations

All tile links live in [`src/components/DashboardGrid.astro`](src/components/DashboardGrid.astro). Update the `tiles` array and rebuild.

## RDD password

The gate at `/rdd` checks a SHA-256 hash. Password is stored only as a hash in `src/pages/rdd.astro`. To rotate:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('NEW_PASSWORD').digest('hex'))"
```

Replace the `HASH` constant with the output. Note: the gate is convenience-level protection — the destinations themselves remain protected by Google's auth.

## Brand

Colors, typography, and motion are defined in [`src/styles/global.css`](src/styles/global.css). Display face: Fraunces. Body: Inter Tight. Monospace accent: JetBrains Mono.
