# Favor Hub

Team dashboard at dash.favorintl.org. Repo: covenantOS/favor-hub.

Website is favor-astro. Portal is favor-portal. This repo is the hub.

When Will points you at the board, read `docs/AGENT.md` and pull approved cards from `/api/agent/queue`. Do not start inbox cards. Approve is Will's job.

Every deploy adds a changelog entry with a picture: run `node scripts/changelog-draft.mjs --shots` after the deploy, rewrite the draft for staff, rename it to `<day>.md`. Rules in the header of that script and in the vault START HERE hub handoff note.
