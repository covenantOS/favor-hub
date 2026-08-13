# Favor Dash

Team dashboard for Favor International. Live at dash.favorintl.org. GitHub: covenantOS/favor-dash. Local: `C:\Users\Willb\Claude\favor-dash`.

## Stack

Astro 6, static output, Cloudflare Pages Functions for the request board. D1 `favor-requests` and R2 `favor-requests` on the Marketing Cloudflare account.

## Local

```
npm install
npm run dev
```

Functions and D1 do not run in `astro dev`. Use `npx wrangler pages dev dist` after a build, or hit the deployed site.

## Request board

`/requests` is the software-change board. Submit is open to the team. Review (approve / decline / move) uses the hub admin password. Agents pull approved work from `/api/agent/queue`. See `docs/AGENT.md`.

This board is not Asana and not for marketing projects. Marketing Request still goes to the existing Asana form.

## Deploy

Pushes to `main` should deploy once GitHub is connected. Until then:

```
npx wrangler pages deploy dist --project-name favor-hub --branch main
```

Account: Marketing `6e975b8c8e7bea3f644c0eb722af991f`. Use will@favorintl.org global key. Unset `CLOUDFLARE_API_TOKEN` first (Windows user env points at another account).
