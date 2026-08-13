# Request board (agents)

favor-hub owns the software-request board at `/requests`.

Will approves cards. Agents only work **approved** cards. Do not invent work off Slack, WhatsApp, or email when the board has an approved item.

## Pull the queue

```
GET https://dash.favorintl.org/api/agent/queue
Authorization: Bearer $AGENT_API_KEY
```

Markdown: add `?format=md`.

Key lives at `C:\Users\Willb\.claude\secrets\favor-hub-agent-key.txt`.

## Claim, note, complete

```
PATCH https://dash.favorintl.org/api/agent/{id}
Authorization: Bearer $AGENT_API_KEY
{ "action": "claim" | "complete" | "note", "note": "optional" }
```

`claim` moves approved -> in_progress. `complete` moves to done. Always leave a note of what shipped (commit hash, URL).

## Repos

| surface | repo | branch | local path |
|---|---|---|---|
| website | Favor-International/favor-astro | main | `C:\Users\Willb\Claude\favor-astro` |
| portal | Favor-International/favor-portal | feature/blackbaud-giving-history | `C:\Users\Willb\Claude\favor-portal` |
| dashboard | covenantOS/favor-hub | main | `C:\Users\Willb\Claude\favor-hub` |
| app | Favor-International/favor-marketing | main | `C:\Users\Willb\Claude\favor-marketing` |

Portal production is **not** `main`. Do not deploy portal `main`.

## Scope

In: website, portal, dashboard, and app **changes**. Out: reports, Blackbaud data pulls, marketing projects (those still go to Asana).
