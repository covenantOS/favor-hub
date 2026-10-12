# Mail parity: native app against public/js/mail/mail.js

Checked against the classic page on 2026-10-12. The classic page stays reachable at /mail/?classic=1. The native page is app/src/features/mail/, tested by `node app/e2e/mail.mjs` (32 real actions as the FavorOS Tester on the server-side sample mailbox).

| Classic feature | Native | Tested |
|---|---|---|
| Mailboxes column, All mailboxes, per-mailbox counts, From picker, manage and remove | yes | opens (no extra mailboxes for the tester) |
| Labels, system labels, user labels with color, unread counts, rail badge | yes | list, new label |
| Views under Inbox (Needs you, Partners, Staff, People, Receipts, Newsletters, Notifications, Calendar, categories, Waiting on reply, Not logged) with counts | yes | Needs you |
| Virtualized list, read-ahead (idle batches, hover, neighbors), device copy in IndexedDB, 90 s tab copy | yes | open timing |
| Filter (unread, starred, files, partner), sort (newest, oldest, important), search with Gmail words, `?` to ask | yes | filter, search |
| Select (circle, shift range), bulk archive, delete, read, unread, star, label, snooze, move to category | yes | range archive |
| Archive, delete, star, read, unread, move to Inbox, labels, snooze (presets, picker, until they reply, until next gift) with Undo and Z | yes | each |
| Reader: collapsed and expanded messages, sandboxed frame, quoted text fold, files with kind chips and viewer, partner chip, draft edit and discard, headers-only mode | yes | open |
| This morning briefing, partner email nudge, archive-unread-newsletters card | yes | briefing |
| Assist: summary, Waiting on you, partner card, sender profile, gift mention, You promised, Ask about this email, Find a time, Ask Favor Brain, suggested replies | yes | assist, ask, find a time |
| Partner timeline, Log as an action (quick and form) | yes | none (tester has no Blackbaud link) |
| Entity hover cards (appeal, Lookup ID, fund) and detail sheet | yes | none (no appeal codes in the sample bodies) |
| Reply, reply all, forward, new message, From, Cc and Bcc, contacts suggestions, files, Drive link, clip link, Drive photos, templates, formatting, drafts autosave, discard | yes | reply, draft, templates, pickers |
| Writing check and Send anyway (5 s count, Fix it, setting) | yes | warns, Fix it |
| Undo send (15 s hold on the server, Undo restores the draft, sent on leaving) | yes | undo, real send |
| Send later with reminder, Scheduled list, cancel | yes | schedule and cancel |
| More menu: Make a task, Send to Chat, Open partner, Log, Unsubscribe, Find a time, Assign, Mention, Make a request, Ask Favor Brain, Open in Gmail | yes | task, chat, hand-offs open |
| Assigned list | yes | opens |
| Categories in your words (add, remove) | yes | add and remove |
| Gmail keys (j k o u e # s x z U I r a f c / b l ?) | yes | j e z |
| Phone: list, thread and compose as full screens, Back, tab bar offset | yes | list, thread, back |
| Allow Mail and Allow changes sheets, read-only mode | yes | not reachable for the tester |
| Icon tooltips with the key (hub tooltip layer) | title attributes only | no |

Known server issue found on the way: a message sent from the sample mailbox shows raw MIME as its snippet in Sent (functions/_lib/mail/sample.ts keeps the raw body). The release of a held send failed for the test users until route.ts used the sample fetcher; fixed.
