# Favor International — Hub

> Transformed hearts transform nations.

A modern, animated, editorial mission-control dashboard for the Favor International team. Fast access to BlackBaud, Paycom, Asana, GoHighLevel, the media folder, the request board, and field resources.

Built with [Astro](https://astro.build) on Cloudflare Pages. The request board uses Pages Functions, D1, and R2.

See `docs/REQUESTS.md` and `docs/AGENT.md`.

## What's inside

- **Hero ticker.** Animated KPI counts (souls saved, discipled).
- **11 tool tiles.** Every external destination the team uses, plus the website and app request board.
- **Request board** (`/requests`). Submit a website, portal, hub, or app change. Will approves. The team can see status.
- **Founder spotlight.** Carole Ward and the book.
- **Field gallery.** Photos from Northern Uganda and South Sudan.
- **RDD Reports.** Password-protected (`/rdd`) gateway to the KPI dashboard and Revenue dashboard.
- **Quick links rail.** YouTube, donate, book, website.
- **Footer.** Accountability badges, address, social.

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

That's it. Pushes to `main` deploy automatically.

## Editing tile destinations

All tile links live in [`src/components/DashboardGrid.astro`](src/components/DashboardGrid.astro). Update the `tiles` array and rebuild.

## RDD password

The gate at `/rdd` checks a SHA-256 hash. Password is stored only as a hash in `src/pages/rdd.astro`. To rotate:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('NEW_PASSWORD').digest('hex'))"
```

Replace the `HASH` constant with the output. The gate is convenience-level protection. The destinations themselves remain protected by Google's auth.

## Brand

Colors, typography, and motion are defined in [`src/styles/global.css`](src/styles/global.css). Display face: Fraunces. Body: Inter Tight. Monospace accent: JetBrains Mono.
