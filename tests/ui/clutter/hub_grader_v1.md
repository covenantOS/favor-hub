You are grading one working screen of FavorOS, an internal web app that about 30 staff of a nonprofit use all day on phones and desktops. Staff open a screen to do a job. A good screen shows what the person needs to do that job and to know where they are, and nothing else.

You grade clutter (what is there and should not be), missing information (what is not there and must be), and rendering defects.

The screen: {{NAME}} ({{DEVICE}}, {{W}}x{{H}} px).
The job staff do here: {{JOB}}
{{SCOPE}}

First Read the screenshot at `{{SHOT}}` and look at it. Then use the element list below: every visible element of the graded part of the screen with an id, kind, bounding box (x,y,width,height in px), font size, and text.

## Clutter: the question for every element

Does a staff member doing this job on this screen need it, or does it help them orient? Label each element:

- `blue` = keep as is. This covers:
  - the data itself: rows, names, amounts, dates, statuses, counts, messages, charts;
  - controls and their labels: buttons, tabs, filters, fields, placeholders, menus, links. A control is never clutter because it is a control;
  - the labels needed to read the data: column heads, field labels, units, one short section heading per group ("Due today", "Waiting on you");
  - one short page or panel title;
  - an empty state that says what is true in a few words ("No requests waiting");
  - a warning, error or status that states a fact the person must act on ("Blackbaud sign-in expired", "3 failed");
  - a hint that carries a fact the person cannot see elsewhere and needs for the job: a format a field requires, a limit, what a destructive button will do, who is told when they press it. Short and said once.
- `orange` = the information is worth having, but it takes more words or room than it should. The fix is to shorten or shrink it. Examples:
  - a label or button wordier than needed ("Click here to review the board" could be "Review");
  - a title or heading written as a sentence;
  - an empty state or hint that carries one needed fact inside two sentences;
  - a row label that repeats words every row already has.
- `red` = remove it. Give each red region one `type`:
  - `unneeded`: the person does the job as well without it. Eyebrow and kicker lines above a title; section numbers; decorative pills, dots and badges that carry no state; subtitles and intro paragraphs that explain what the screen is or lists what it contains; helper text that narrates the interface ("Use the tabs above to switch views", "Click a row to open it", "This page shows..."); "Beta", "New" and similar tags that tell the person nothing they act on; marketing voice ("Everything you need, in one place"); decorative shapes and illustrations.
  - `repetition`: the same information is already on the screen. A count shown twice (in a tab and again in a heading); the page title repeated in a heading right under the top bar; a legend plus the same labels on every item; the same phrase on every row; two badges on one item that say the same thing; a summary sentence restating numbers shown next to it. Keep the best single instance `blue` and mark the others red.
  - `extra_idea`: a block that serves a different task than this screen's one main job. A promo or tour card on a work list, a stats strip for another team, a second tool embedded beside the main one, a "what's new" block on a data screen.

How to decide:
- Red versus blue: the question is not "could the person survive without it" but "does it help them do the job or know where they are". Data, controls and short labels stay blue. Do not strip a screen down to bare rows, and do not mark navigation, tabs, filters or action buttons as clutter.
- Sentences are the usual suspects. A sentence that tells the person what the screen is, what they can do on it, or how the interface behaves is red `unneeded`. A sentence that states a fact about the data or a consequence of an action is blue, or orange when it is long.
- Red versus orange: orange keeps the information and trims it. Red means nothing is lost when it goes.
- A clean screen (a title, controls, data, short labels) is all blue. Do not hunt for something to mark.
- Real data is never clutter because of what it says: message text, request text, partner notes, article bodies and answers are content the person came to read. Grade the interface around them.

Calibration, from FavorOS owner's own rulings. These are binding:
- Interface copy states facts only. No commentary about the interface and no narration of it. He reads that as machine-written filler.
- Under the title "Meeting notes", the intro "Every meeting you were invited to, with its notes, action items and transcript." -> red `unneeded`. The title already says it.
- A gold dot next to a count on the same item -> red `repetition`. One badge per item.
- "Beta" next to a tool's name -> red `unneeded`.
- A helper line such as "Tap a card to see the full request." -> red `unneeded`.
- A heading "Requests" directly under a top bar that already reads "Requests" -> red `repetition`.
- A count in a tab ("Inbox 4") and the same count in the heading below it ("4 requests in the inbox") -> the second is red `repetition`.
- A column head, a field label, a filter chip, a "Mark done" button -> blue.
- "No reminders set" as an empty state -> blue. "You have no reminders yet. When you set one it will show up here so you never miss a follow-up." -> orange (keep the first four words).
- "Sends an email to the person who asked" beside a Done button -> blue: a consequence the person needs before pressing.
- Wording errors to report under `defects`, not as clutter: the word "donor" or "donors" (FavorOS says "partners"); calling thank-you receipts "thank-you letters"; an em dash in interface copy; a staff member named in interface copy.

Group elements that form one visual unit into one region (an intro paragraph and its box; a promo card and everything in it). A container (`box`) takes the label of what it contains.

List only the regions you label `orange` or `red`. Every element you leave out is counted as `blue`. In `ids` you may write a run of consecutive ids as a range, "e12-e19".

Clutter score, 0 to 10:
- 0: nothing to remove. 1-2: one or two lines could go or be shorter.
- 4-5: the work is clear, but several explaining lines, tags or repeated counts sit around it.
- 7-8: explanation, promo blocks and decoration take more room than the work.
- 9-10: the person cannot find the work on the screen.

## Missing information

Be strict: most screens are missing nothing. List something only when a staff member would be stuck or misled:
- a number with no unit or label (is "12" gifts, partners or dollars?);
- an icon-only action whose meaning is not obvious and has no label;
- a status or color with no way to tell what it means;
- a list with no way to tell what it lists.

## Defects

List rendering and wording defects separately in `defects`: text that overlaps or is cut off, an element clipped by the edge of the screen or a panel, a control hidden under a bar, a broken image, an element in the list you cannot see in the screenshot, and the wording errors named in the calibration.

## Reply

Reply with ONLY a JSON object, no prose, no code fence:

{
  "main_job": "the one job this screen is for, <= 15 words",
  "ideas": ["each distinct thing the screen tries to do or say, <= 10 words each"],
  "regions": [
    {"label": "orange|red", "type": "verbose|unneeded|repetition|extra_idea", "ids": ["e3", "e7-e9"], "name": "2-4 word name", "text": "the element's text, first 80 characters", "reason": "<= 15 words", "fix": "for orange: the shorter wording; for red: 'remove'"}
  ],
  "missing": [
    {"what": "2-6 words", "why": "<= 15 words"}
  ],
  "defects": ["<= 14 words each"],
  "clutter_score": 0,
  "completeness_score": 10,
  "summary": "one sentence: what clutters this screen and what it lacks, or 'clean and complete'"
}

`type` is `verbose` for orange and one of the three red types for red. `completeness_score`: 10 (nothing missing) to 0 (the person cannot tell what this screen is for).

Elements:

{{ELEMENTS}}
