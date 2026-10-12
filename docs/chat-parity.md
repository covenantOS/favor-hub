# Chat parity checklist: native Chat against the classic page

Sources: public/js/chat/chat-ui.js (screen), chat.js (REST and socket), chat-smart.js (translation, Catch me up, Turn into, voice notes, reminders), chat-brain.js (@Favor Brain answers), chat-view.js (file viewer), mention-input.js, project-card.js, task-card.js, chat-emoji.js, plus public/js/dock.js and dock-panel.js (the floating Chat on every other page).

Native Chat becomes the default in the app only when every line below is ticked by a passing step in `node app/e2e/chat.mjs` (two users, Tester and Tester Two, on the private qa-scratch-tester channel, never real staff). The classic page stays at /chat/?classic=1. The `classic` column marks lines that exist in the classic page today (the baseline the suite is first run against). The `native` column is filled as each line passes in the native build.

## Transport and data
| # | Line | classic | native |
|---|---|---|---|
| 1 | Boot: channels, users, unread counts, first channel from `?c=` or the last open one | yes | yes: channel opens for both users (?c=), phone list |
| 2 | One socket (/api/chat/ws), ping every 30 s, reconnect with backoff, 20 s poll fallback, resync after reconnect | yes | yes: socket drops and comes back |
| 3 | Away and online presence on tab hide and show; dead-socket check after 10 s hidden | yes | yes: presence away and online, ping after 10 s hidden |
| 4 | History pages (`before=`), read marker (`/read`), mark unread from a message | yes | yes: history Load earlier, mark unread; new line in the unread step |
| 5 | Typing indicator out and in (channel and thread) | yes | yes: typing is seen; typing in a thread is seen |
| 6 | Drafts kept per channel and per thread, count in the sidebar | yes | yes: drafts kept per conversation |
| 7 | Unread and mention counts to the rail (`favor-chat:unread`) and the tab title | yes | yes: unread step (row badge, rail count, tab title) |
| 8 | Desktop notices for DMs, mentions and replies, with the Turn on prompt | yes | yes: desktop notice for a direct message, Turn on prompt |

## Sidebar and navigation
| # | Line | classic | native |
|---|---|---|---|
| 9 | Channels, Direct messages, Threads, Mentions and reactions, Drafts, Activity pages | yes | yes: sidebar pages |
| 10 | Jump to or search (Ctrl K switcher), full search with filters and jump to hit | yes | yes: switcher and search with a filter |
| 11 | Create channel (public or private), Browse channels, join, leave, mute, topic edit, add members | yes | yes: channel tools; mute and unmute; leave and rejoin |
| 12 | Open DM or group from a person picker | yes | yes: DM step (person picker) |
| 13 | Phone: list, conversation and thread as full screens with Back; address bar keeps `?c=&t=&m=` | yes | yes: phone step (c= and t= in the address, thread screen, message sheet, Back) |
| 14 | Details panel: members, pins, bookmarks (add, remove), files | yes | yes: details tabs in the attachments and leave steps; pins and bookmarks step |

## Messages
| # | Line | classic | native |
|---|---|---|---|
| 15 | Day dividers, grouped sender runs, intro for a new channel, Latest button, new-message line | yes | yes: unread step (New line, Catch me up strip); Latest in the phone step |
| 16 | Send (Enter), edit, delete, reply in thread, thread panel, thread read state | yes | yes: send, edit, delete, thread reply steps |
| 17 | Formatting bar: bold, italic, strike, link, lists, quote, code, code block; markdown render | yes | yes: formatting bar and markdown |
| 18 | Mentions with picker (people, channels, @Favor Brain), mention highlight | yes | yes: unread step (mention picker, highlight); @Favor Brain steps |
| 19 | Partner, fund and appeal chips from text (entity cards on press) | yes | yes: partner and fund chips |
| 20 | Reactions: add, remove, picker, counts, who reacted | yes | yes: reactions |
| 21 | Pin, bookmark, copy link, Make a task, Make a request, Remind me | yes | yes: pins step; copy link, Make a request, Make a task; Turn into a reminder |
| 22 | Attachments: file upload, Drive picker, clip picker, clip recorder, meeting card, project and task cards, link unfurl, image and video viewer, PDF, DOCX and XLSX viewer | yes | yes: attachments step (upload, picture and PDF viewer, Drive and clip pickers, link card); meeting card in the huddle step |
| 23 | Slash commands and the plus menu | yes | yes: slash commands and the plus menu |
| 24 | Emoji picker and shortcodes | yes | yes: emoji picker (classic has no typed shortcodes either) |

## Smart side (chat-smart.js)
| # | Line | classic | native |
|---|---|---|---|
| 25 | Translation: language setting, translate on arrival, Show original, force per message | yes | yes: French message translated; language menu and Show original |
| 26 | Catch me up (unread strip, summary of a channel or thread) | yes | yes: Catch me up offer and manual Catch me up (stubbed) |
| 27 | Turn into: task, reminder, Blackbaud action (review step) | yes | yes: Turn into a reminder; Turn into lists task, request, reminder and Blackbaud action; Blackbaud review step |
| 28 | Voice notes: record, timer, send, play | yes | yes: voice note (upload and transcript stubbed) |
| 29 | Entity chips and owners lookup | yes | yes: partner and fund chips; owners read in the Blackbaud step |

## Brain and meetings
| # | Line | classic | native |
|---|---|---|---|
| 30 | @Favor Brain question in a channel, private answer, Share, Dismiss, blocks drawn by the Brain renderer | yes | yes: @Favor Brain private answer, renderer tiles, Dismiss, Share (stubbed) |
| 31 | Start a meeting from a channel, huddle strip with timer, Join | yes | yes: huddle strip with timer, Join opens the pre-join sheet (stubbed) |

## Dock (every other page)
| # | Line | classic | native |
|---|---|---|---|
| 32 | Floating button with unread badge, panel with list, conversation, threads, Catch me up and translation, toasts, desktop notices | yes | yes: dock step (badge, toast, list, conversation, reply, Catch me up, Threads) |
| 33 | The dock draws the same message and composer components as Chat (one source); hides on Chat and meeting rooms | no, two code paths | yes: dock step checks #dock-chat draws the Chat message list (DockChat.tsx uses ConvList, ThreadBody, Composer) |

## Suite (app/e2e/chat.mjs)
Two users on qa-scratch-tester, 40 steps, every model call stubbed in the browser (translation, Catch me up, voice-note transcription, Favor Brain), no meeting started. Run against a preview alias, which carries the socket and the ChatRoom Durable Object (`wrangler pages dev` binds the favor-chat Worker's class and a local D1, so the test users and the shared room are not there):

    npx wrangler pages deploy dist --project-name favor-hub --branch native-chat
    CHAT_HOST=https://native-chat.favor-hub-d4n.pages.dev NATIVE=1 node app/e2e/chat.mjs

2026-10-12: native Chat passed all steps on 5 runs in a row. Every line above is native = yes, so native Chat is the Chat page inside the app; the classic page stays at /chat/?classic=1, and inside the frame at ?legacy=1.
