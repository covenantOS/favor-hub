# Favor Hub

Team dashboard for Favor International. Live at dash.favorintl.org. GitHub: covenantOS/favor-hub. Local: `C:\Users\Willb\Claude\favor-hub`.

## Stack

Astro 6, static output, Cloudflare Pages Functions for the request board. D1 `favor-requests` and R2 `favor-requests` on the Marketing Cloudflare account.

## Local

```
npm install
npm run dev
```

Functions and D1 do not run in `astro dev`. Use `npx wrangler pages dev dist` after a build, or hit the deployed site.

## Request board

`/requests/new` is Make a request. `/requests` is the board. Submit is open. A one-line summary is enough (one word counts). Review (sign in, drag cards, approve) uses the hub admin password. New cards email will@favorintl.org. Marking a card done emails the requester and Will, with a check and the live page URL when one is on the card.

This board is not Asana and not for marketing projects. Marketing Request still goes to the existing Asana form.

## Expense requests

`/expenses/new` replaces the GHL Pre-Travel and Expense Request doc form. Submit stores the request in D1 (`db/expenses.sql` tables), resolves the approver from `expense_settings` plus any dated `expense_approver_overrides`, and emails a private review link via Resend. The approver signs at `/expenses/review/?token=…`; approve builds a signed PDF with pdf-lib, stores it in R2, and emails the requester, the approver, and the distribution list with the PDF attached; decline emails the requester the note. `/expenses` (hub admin password) lists everything, links the PDFs, and edits the approver default, out-of-office substitutes, and the distribution list.

## Deploy

Pushes to `main` should deploy once GitHub is connected. Until then:

```
npx wrangler pages deploy dist --project-name favor-hub --branch main
```

Account: Marketing `6e975b8c8e7bea3f644c0eb722af991f`. Use will@favorintl.org global key. Unset `CLOUDFLARE_API_TOKEN` first (Windows user env points at another account).
