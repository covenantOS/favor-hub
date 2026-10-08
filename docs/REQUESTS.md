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

`/expenses/new` replaces the GHL Pre-Travel and Expense Request doc form. Submit stores the request in D1 (`db/expenses.sql` tables), resolves the approver from `expense_settings` plus any dated `expense_approver_overrides`, and emails a private review link via Resend. The approver signs at `/expenses/review/?token=…`; approve builds a signed PDF with pdf-lib, stores it in R2, and emails the requester, the approver, and the distribution list with the PDF attached; decline emails the requester the note. `/expenses` (admin code) lists everything, links the PDFs, and edits the approver default, out-of-office substitutes, and the distribution list. The admin code starts at 1234 and Stephanie changes it in the log's Login code section (`expense_admin_settings` holds the SHA-256 hash). The footer Admin login link on every hub page points to `/expenses`.

## Foundation prospects

`/foundations/` replaces logging cold foundation outreach on the "Unsolicited Foundations" record in Blackbaud. Staff unlock it with the shared code (4000, or `FOUNDATIONS_CODE` when set) and put their name in "Entered by", which travels with every change.

- One search covers the prospect list (D1 `fnd_foundations`) and every organization in Blackbaud. Blackbaud reads come from the RE NXT mirror through the sync worker's read-only `/d1/query` (`MIRROR_API_KEY`).
- Logging a contact saves it in `fnd_contacts` and posts it to Blackbaud in the same request, through favorintl.org's `/api/blackbaud/ops` route (`BLACKBAUD_SETUP_KEY`). It goes on the foundation's own record when the prospect is tied to one, and on Unsolicited Foundations (constituent ID 21046) when it is not.
- "Whose contact" lists the RDDs and the grant writers (`PEOPLE` in `functions/_lib/foundations/blackbaud.ts`). An RDD's contact posts as an RDD Action and a grant writer's as a Grants Action. The `rdd_name` and `rdd_id` columns hold either.
- A contact that cannot post (Blackbaud at its daily limit, the route down) stays "waiting" and is retried each time the list opens. Tags wait until the ops route gains a rule for action custom fields.
- A contact logged here can be removed here, which deletes its action in Blackbaud. Contacts brought in from Blackbaud are never deleted from this page.
- Dead ends stay on the list with a reason and send nothing to Blackbaud.
- `fnd_log` records every change and every Blackbaud call. The board password switches posting off and on.

Schema: `db/foundations.sql`. The first load came from the 160 contacts on Unsolicited Foundations on 2026-10-05; that seed holds real notes and is kept out of the repository.

## Deploy

Pushes to `main` should deploy once GitHub is connected. Until then:

```
npx wrangler pages deploy dist --project-name favor-hub --branch main
```

Account: Marketing `6e975b8c8e7bea3f644c0eb722af991f`. Use will@favorintl.org global key. Unset `CLOUDFLARE_API_TOKEN` first (Windows user env points at another account).
