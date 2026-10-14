# The FavorOS test users (Tester and Tester Two)

Two hub accounts for agents and scripts: tester@favorintl.org ("FavorOS Tester") and tester2@favorintl.org ("FavorOS Tester Two"), so features that need two people (Chat translation and DMs, mentions, the dock badge, Turn into task, voice notes, an evaluation with a supervisor, a first week with a supervisor, meeting prep) can be tested between them. No Google account sits behind it. Use it for every live check instead of the admin password cookie or Will's own session.

## Sign in from a script

`POST /api/admin/test-session` (add `?who=two` for Tester Two) with `Authorization: Bearer <agent key>` (the key is the first line of `~/.claude/secrets/favor-hub-agent-key.txt`). The reply sets a normal session cookie and returns it as `cookie`. Without the key the route answers 403. Each use, allowed or refused, is a row in `hub_auth_log` (`test_session`, `test_session_refused`).

## What it can do

- Admin and HR. Work Center scope is every fundraiser (admins see all). Chat, Projects, Learn, Meetings, Clips, Reporting and Brain open as for any admin.
- Mail runs for real against a stored sample mailbox on the server (`functions/_lib/mail/sample.ts`, table `hub_sample_mail`, one mailbox per tester). Every Mail route works: list, search, open, labels, archive, trash, snooze, drafts, send (into the sample Sent folder), partner cards, Ask, Find a time. A change survives the next request. Thread smp013 ("October newsletter story order") is between the two testers, so Move to Chat shows on it; testers qualify only with each other. Gmail is never called. Seeding resets the mailbox.
- Chat: both join a private `qa-scratch-tester` channel (Will's own qa-scratch is his alone). They see only each other in the directory, can DM each other, and can post only where no real person is a member.

## Sample data

`POST /api/admin/test-seed` (agent key, safe to repeat) sets up: the reporting line (Tester reports to Tester Two, Tester Two to Tester), an open evaluation term with Tester as employee and Tester Two as supervisor, a first week for Tester Two (an onboarding run starting today, supervised by Tester), two upcoming meetings between them (tomorrow and the day after, for the prep sheet) and fresh sample mailboxes. The term and the run are hidden from the admin lists of real staff.

## What it cannot do

Writes under `/api/work`, `/api/gift-entry`, `/api/foundations`, `/api/statements`, `/api/receipts`, `/api/expenses`, `/api/requests`, `/api/meet` invites, guest links and reminders (a start-now meeting alone works), `/api/push`, `/api/onboarding` and `/api/mobile` answer 403 `test_user` ("This is the FavorOS test user. It cannot write to Blackbaud, send email or notify staff."). Paths ending in a read step (preview, plan, check, suggest, autofill, draft, prep, trip, ask and similar) pass so a flow can reach its review screen. The block lives in `functions/_middleware.ts` through `testerWriteBlocked` in `functions/_lib/testuser.ts`.

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
