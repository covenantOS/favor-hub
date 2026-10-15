---
title: Admin overview and settings
summary: For FavorOS admins. Check that the jobs behind FavorOS ran, and change FavorOS's settings with a record of every change.
topic: help
order: 9
for: [admin]
related: [work-center, meetings, clips]
tool: /admin/
toolLabel: Open Admin
updated: 2026-10-12
---

Admin opens on the Overview. It is for FavorOS admins only. The row under the title has Overview, People and roles, Settings, Blackbaud users, Appeal codes, Adoption, Tours and Audit log.

## Read the health strip

The strip has one tile for each job: the Blackbaud copy, the morning jobs, the overnight sender, notification emails, the Drive library job, the SKY calls today, iWave credits, Workers AI, the unsubscribe write-back, scheduled jobs and the smoke check. Each tile shows when the job last ran and one of four states.

- **OK** means it ran when it should.
- **Late** means the last run is older than it should be, or a meter is above 80 percent.
- **Failed** means the job reported an error, or the last run is more than a day past due.
- **No answer** means FavorOS could not read that job's record.

The morning jobs tile lists assignments, gift phase, record review and credit with their own times. The scheduled jobs tile lists each job with its last run, such as meeting reminders, Chat email, the morning email, gift entry photos and the Asana sync. The smoke check tile shows the timing of the database, the menu and Favor Brain. The SKY tile shows the upkeep route's calls against its daily cap. Press **Check again** to read everything again. The strip refreshes every two minutes while the page is open.

## Change a setting

Open **Settings**, then a tab: Work Center, Meetings, Favor Brain, Clips, Reports, Expenses, AI use, Chat, Projects, Gifts, Receipts, Giving statements or Feedback triage. Each setting shows what it is now, where it lives and who last saved it. Change the value, press **Save**, and the row shows the new value and who saved it. A setting that has a saved answer over a default shows **Use the default** or **Use the Pages value** to put the original back.

- **People and roles** lists everyone who signs in with their role and team. **Make admin**, **Make staff**, **Block** and **Unblock** are one press each, and a block ends that person's open sessions. **Edit** changes a person's details, **Act as** previews FavorOS as that person, and **Add a person** adds someone. You cannot block or demote your own account. The same page sets which other Google Workspace domains may ask for access, whether approved field staff can use Favor Brain, and the Favor Brain access rules. Each rule gives one Brain package to everyone, a role, a team, team leads or one person. **Remove** takes a rule away.
- **Work Center** (a Settings tab) holds the Blackbaud call caps, who can open it, where each role starts and the morning email start date for each team.
- **Meetings** holds who can use them, guests, the number of people in one meeting, the recording folder and the reminder lead time.
- **Favor Brain** holds the connect prompt and automatic chat titles. **Clips** holds storage for each person, the longest recording, the sharing default and who can record.
- **Reports** sets which roles see each report. **Expenses** holds the approvers, substitutes, who can open the log and the mileage rate. **Receipts** holds the days a gift can wait for a receipt and the morning email line.

## AI use

**AI use** shows the model units Favor's account used today, the last 7 days and today's use by feature. Cloudflare gives 10,000 units a day free and bills $0.011 for each 1,000 above that. FavorOS stops itself at 8,000 a day, and Chat translation, Mail sorting and Favor Brain's question reading keep the last units of the day. A feature that reaches its share answers from its rules until the next day starts at 8 PM Eastern (7 PM in winter): Chat shows the original message, Mail leaves the conversation in its rule category, and gift entry keeps the photo for a person to type. Cloudflare's own count is read every 10 minutes, and past 9,000 every call stops for the day.

- **Favor Brain query writer** and **Gift entry check reading** stay off until Will approves the spend.
- **Extra AI units for testing this month** is 0. A number above 0 lets runs marked as tests go past the daily cap until that many units are used this month.

## Blackbaud users

**Blackbaud users** lists everyone with a Blackbaud login: name, email, Active or Inactive, Raiser's Edge NXT access (Admin or User) and any other product they can open. Active, Inactive and All narrow the list, and the box finds a name or an email. The desktop reads Blackbaud's own users page each weekday morning after the other jobs, and **As of** shows when; it turns amber after 36 hours. The list has no sign-in date.

**Add user** takes a first name, last name, email and an access choice: Normal user (Fundraising, Analysis and Marketing View Only, with the Query and View Only Everything groups), Solution admin, or a set of roles and database view groups you pick. **Change access** and **Deactivate** sit on each active row. Blackbaud has no way for FavorOS to change a user directly, so each press saves a request and the desktop runs it in Blackbaud. The **Requests** list shows each one as Waiting for the desktop, Running on the desktop, Checked, not applied, Done or Failed, with the result line, and **Cancel** takes back a request the desktop has not started. The list refreshes while a request is open. A request for someone who already has one open is refused, and you cannot deactivate or change your own login. Every request writes a row to the Audit log under Blackbaud users.

## Appeal codes

**Appeal codes** builds a code from Favor's scheme: a letter for the kind, the two-digit year, a month character (1 to 9 for January to September, then A, B and C), a dash and a suffix. Pick the kind and the date. A newsletter takes EMW and the week of the send day. The page shows the code and description, and says if Blackbaud already has the code. **Create in Blackbaud** makes the appeal and writes a row to the Audit log. Tick **Also create the online -WS code** for a letter, and both appeals are created.

The giving form takes the link `?src=` with the newsletter code, or the letter code without its suffix, with no website change. Other kinds need a src key on the website. The page says so after the appeal is created. Blackbaud has no route to delete an appeal, so a wrong code is set inactive in Blackbaud.

**Funds and campaigns waiting** keeps a list for the two things the Blackbaud connection cannot create yet. Add the code and description, and mark the request created after someone makes it in Blackbaud.

## Adoption

**Adoption** shows how many staff have an account and have signed in, how many were active in the last 7 and 30 days, and active people each week. The table lists each person with their team, first sign-in, last active time, active days in 30, top areas, Favor Brain questions, feedback given, tasks made, meetings joined, Work Center actions and gift entries. Find a person by name or narrow by team.

## Tours

**Tours** shows how many staff finished the tour of FavorOS and, for each release, how many of the people it was shown to finished it. The table has a column for the tour and each release, and when each person was last in FavorOS. **Send again** on a row opens the tour for that person once more. **Send to the team** sits beside each release. Find a person by name, narrow by team, or show Everyone, Not finished, Finished everything or Not shown yet.

## Read the audit log

Press **Audit log**. Each row shows when a setting changed, who changed it, and the value before and after. Pick an area to narrow the list, or type a name or a setting. **Show more** loads older rows.

Every change made in Admin is a row in this log. A setting that changes what FavorOS sends to Blackbaud asks you to confirm and shows the current value first.
