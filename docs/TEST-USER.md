# The FavorOS Tester

A hub account for agents and scripts: tester@favorintl.org, name "FavorOS Tester". No Google account sits behind it. Use it for every live check instead of the admin password cookie or Will's own session.

## Sign in from a script

`POST /api/admin/test-session` with `Authorization: Bearer <agent key>` (the key is the first line of `~/.claude/secrets/favor-hub-agent-key.txt`). The reply sets a normal session cookie and returns it as `cookie`. Without the key the route answers 403. Each use, allowed or refused, is a row in `hub_auth_log` (`test_session`, `test_session_refused`).

## What it can do

- Admin and HR. Work Center scope is every fundraiser (admins see all). Chat, Projects, Learn, Meetings, Clips, Reporting and Brain open as for any admin.
- Mail draws the built-in sample mailbox in the browser (`/js/mail/mail-mock.js`), switched on by the `hub_tester` cookie. The mail API answers 403 `test_user` for it, so no Gmail is ever read.
- Chat: it joins only a private `qa-scratch-tester` channel (Will's own qa-scratch is his alone). It sees only itself in the directory and can post only where no real person is a member.

## What it cannot do

Writes under `/api/work`, `/api/gift-entry`, `/api/foundations`, `/api/statements`, `/api/receipts`, `/api/expenses`, `/api/requests`, `/api/mail`, `/api/meet` invites, guest links and reminders (a start-now meeting alone works), `/api/push`, `/api/onboarding` and `/api/mobile` answer 403 `test_user` ("This is the FavorOS test user. It cannot write to Blackbaud, send email or notify staff."). Paths ending in a read step (preview, plan, check, suggest, autofill, draft, prep, trip, ask and similar) pass so a flow can reach its review screen. The block lives in `functions/_middleware.ts` through `testerWriteBlocked` in `functions/_lib/testuser.ts`.

## Left out for real staff

The tester is missing from Admin People, the Chat directory, the Meetings directory, tour adoption counts, project due-date notices and notice recipients. Add `notTesterSql()` to any new query over `hub_users`.

## Playwright

```python
import requests
key = open(r'C:\Users\Willb\.claude\secrets\favor-hub-agent-key.txt').readline().strip()
r = requests.post('https://dash.favorintl.org/api/admin/test-session', headers={'Authorization': 'Bearer ' + key})
tok = r.json()['cookie']
ctx.add_cookies([
  {'name': 'favor_hub_session', 'value': tok, 'domain': 'dash.favorintl.org', 'path': '/', 'secure': True, 'httpOnly': True},
  {'name': 'hub_gc', 'value': '1', 'domain': 'dash.favorintl.org', 'path': '/', 'secure': True},
  {'name': 'hub_tester', 'value': '1', 'domain': 'dash.favorintl.org', 'path': '/', 'secure': True},
])
```
