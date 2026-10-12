# Chat parity checklist: native Chat against the classic page

Sources: public/js/chat/chat-ui.js (screen), chat.js (REST and socket), chat-smart.js (translation, Catch me up, Turn into, voice notes, reminders), chat-brain.js (@Favor Brain answers), chat-view.js (file viewer), mention-input.js, project-card.js, task-card.js, chat-emoji.js, plus public/js/dock.js and dock-panel.js (the floating Chat on every other page).

Native Chat becomes the default in the app only when every line below is ticked by a passing step in `node app/e2e/chat.mjs` (two users, Tester and Tester Two, on the private qa-scratch-tester channel, never real staff). The classic page stays at /chat/?classic=1. The `classic` column marks lines that exist in the classic page today (the baseline the suite is first run against). The `native` column is filled as each line passes in the native build.

## Transport and data
| # | Line | classic | native |
|---|---|---|---|
| 1 | Boot: channels, users, unread counts, first channel from `?c=` or the last open one | yes | |
| 2 | One socket (/api/chat/ws), ping every 30 s, reconnect with backoff, 20 s poll fallback, resync after reconnect | yes | |
| 3 | Away and online presence on tab hide and show; dead-socket check after 10 s hidden | yes | |
| 4 | History pages (`before=`), read marker (`/read`), mark unread from a message | yes | |
| 5 | Typing indicator out and in (channel and thread) | yes | |
| 6 | Drafts kept per channel and per thread, count in the sidebar | yes | |
| 7 | Unread and mention counts to the rail (`favor-chat:unread`) and the tab title | yes | |
| 8 | Desktop notices for DMs, mentions and replies, with the Turn on prompt | yes | |

## Sidebar and navigation
| # | Line | classic | native |
|---|---|---|---|
| 9 | Channels, Direct messages, Threads, Mentions and reactions, Drafts, Activity pages | yes | |
| 10 | Jump to or search (Ctrl K switcher), full search with filters and jump to hit | yes | |
| 11 | Create channel (public or private), Browse channels, join, leave, mute, topic edit, add members | yes | |
| 12 | Open DM or group from a person picker | yes | |
| 13 | Phone: list, conversation and thread as full screens with Back; address bar keeps `?c=&t=&m=` | yes | |
| 14 | Details panel: members, pins, bookmarks (add, remove), files | yes | |

## Messages
| # | Line | classic | native |
|---|---|---|---|
| 15 | Day dividers, grouped sender runs, intro for a new channel, Latest button, new-message line | yes | |
| 16 | Send (Enter), edit, delete, reply in thread, thread panel, thread read state | yes | |
| 17 | Formatting bar: bold, italic, strike, link, lists, quote, code, code block; markdown render | yes | |
| 18 | Mentions with picker (people, channels, @Favor Brain), mention highlight | yes | |
| 19 | Partner, fund and appeal chips from text (entity cards on press) | yes | |
| 20 | Reactions: add, remove, picker, counts, who reacted | yes | |
| 21 | Pin, bookmark, copy link, Make a task, Make a request, Remind me | yes | |
| 22 | Attachments: file upload, Drive picker, clip picker, clip recorder, meeting card, project and task cards, link unfurl, image and video viewer, PDF, DOCX and XLSX viewer | yes | |
| 23 | Slash commands and the plus menu | yes | |
| 24 | Emoji picker and shortcodes | yes | |

## Smart side (chat-smart.js)
| # | Line | classic | native |
|---|---|---|---|
| 25 | Translation: language setting, translate on arrival, Show original, force per message | yes | |
| 26 | Catch me up (unread strip, summary of a channel or thread) | yes | |
| 27 | Turn into: task, reminder, Blackbaud action (review step) | yes | |
| 28 | Voice notes: record, timer, send, play | yes | |
| 29 | Entity chips and owners lookup | yes | |

## Brain and meetings
| # | Line | classic | native |
|---|---|---|---|
| 30 | @Favor Brain question in a channel, private answer, Share, Dismiss, blocks drawn by the Brain renderer | yes | |
| 31 | Start a meeting from a channel, huddle strip with timer, Join | yes | |

## Dock (every other page)
| # | Line | classic | native |
|---|---|---|---|
| 32 | Floating button with unread badge, panel with list, conversation, threads, Catch me up and translation, toasts, desktop notices | yes | |
| 33 | The dock draws the same message and composer components as Chat (one source); hides on Chat and meeting rooms | no, two code paths | |

## Suite (app/e2e/chat.mjs)
Two users on qa-scratch-tester: send both ways, typing seen, reaction seen, edit and delete seen, thread reply seen, mention, search, French message, 20-visit leak check, phone layout at 390 with no horizontal overflow. Steps still to add as the native build lands: DM, dock badge for the other user, Catch me up, Turn into reminder, voice note upload, pin, mute, leave and rejoin, @Favor Brain stub, huddle strip.
