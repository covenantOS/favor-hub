"""Generate db/seed.sql for the Favor request board."""
from pathlib import Path

NOW = "2026-08-13T17:00:00.000Z"
DONE_AT = "2026-08-07T20:00:00.000Z"

done = [
    ("seed-learn-tab", "Add the Learn tab and video library", "website", "Carole Ward",
     "People keep asking for teaching resources. Add a Learn section with videos, prayer materials, books, and YouTube content organized by Carole's named topics.",
     "2026-08-04T16:00:00.000Z"),
    ("seed-go-vision-trips", "Reframe Go: no casual vision trips", "website", "Carole Ward",
     "Vision-trip language should come off. Go should be serious involvement: invited partners or people who raise about $20,000 for a specific project.",
     "2026-08-04T16:10:00.000Z"),
    ("seed-tagline-comma", "Tagline has no comma", "website", "Stephanie Maier",
     "Transformed Hearts Transform Nations is one statement. No comma.",
     "2026-08-04T16:20:00.000Z"),
    ("seed-trustbridge", "International giving through TrustBridge with a USD bypass", "website", "Carole Ward",
     "Non-US visitors to the donate form should go to TrustBridge, with a visible way back to USD giving.",
     "2026-08-04T16:30:00.000Z"),
    ("seed-in-the-field", "Say in the field, not on the trail", "website", "Terry",
     "Replace keep a missionary on the trail with keep a missionary in the field, including the portal and gift emails.",
     "2026-08-04T16:40:00.000Z"),
    ("seed-prayer-guide-title", "National Prayer Guide and house of prayer verse", "website", "Carole Ward",
     "Use the full wording My house shall be called a house of prayer for all nations. Title should read National Prayer Guide. Darken prayer-page text for contrast.",
     "2026-08-04T16:50:00.000Z"),
    ("seed-leadership-qualities", "Leadership qualities: servant leadership, desire to serve nations", "website", "Terry",
     "Add servant leadership. Remove native. Use Desire to serve nations. Include Terry's 20-years sentence.",
     "2026-08-04T17:00:00.000Z"),
    ("seed-team-national-first", "Team page leads with national leaders", "website", "Stephanie Maier",
     "African / national leadership should sit above the U.S. roster. Move accountability higher on the page.",
     "2026-08-04T17:10:00.000Z"),
    ("seed-map-pale-green", "Map countries fill pale green", "website", "Carole Ward",
     "Map colors need to match existing Favor maps. Pale green for countries so mission-station markers read.",
     "2026-08-04T17:20:00.000Z"),
    ("seed-giving-levels", "Giving levels are a contribution toward an outcome", "website", "Carole Ward",
     "Wording around $50 and $1,000 must not imply that a small gift fully supports a missionary. Pick the partnership that God is calling you to.",
     "2026-08-04T17:30:00.000Z"),
    ("seed-mailing-address", "Public surfaces use the Valrico mailing address only", "website", "Michael",
     "HR: Riverview office address stays off the website. Only 3433 Lithia Pinecrest Rd. #356, Valrico, FL 33596.",
     "2026-08-07T15:00:00.000Z"),
]

inbox = [
    ("seed-org-vs-individual", "Giving form: organization vs individual", "website", "Daniel Casella",
     "The giving form has no way to identify the giver as an organization rather than an individual. A church or business putting the org name in can create an Individual constituent in Blackbaud. Need a check so Organization records are created when that is what they are.",
     "https://favorintl.org/give/donate/", "2026-08-05T19:13:00.000Z"),
    ("seed-default-appeal", "Set a default appeal code on website gifts", "website", "Daniel Casella",
     "Default fund is set, which is good. Website giving also needs a default appeal code so gifts land in the right appeal in RE NXT.",
     "https://favorintl.org/give/donate/", "2026-08-05T19:13:00.000Z"),
    ("seed-decarolize-photos", "More indigenous-leader photos, fewer Carole photos", "website", "Terry",
     "The new site is Carole-heavy, even more than the last one. Almost every page has her picture, which fights the indigenous-leaders message. Replace some with photos like Gabrielle preaching to the cattle camp and other national leaders. Carole asked Terry to post this. History honored, forward looking.",
     "https://favorintl.org/", "2026-08-05T11:53:00.000Z"),
    ("seed-green-dots", "Map green dots: mission stations", "website", "Terry",
     "Green dots represent mission stations. Uganda: Kotido, Yumbe (2). South Sudan: Kapoeta, Yambio, Rumbek, Aweil, Malakal (5). Sudan: Khartoum. Chad: Moundou, Abeche (Carole can confirm). No blue dots in Uganda.",
     "https://favorintl.org/", "2026-08-07T14:42:00.000Z"),
    ("seed-blue-dots", "Map blue dots: Congo, Cameroon, Niger, Nigeria only", "website", "Terry",
     "No blue dots in Kenya or Uganda. Two blue dots in Congo (top right and lower left). One in Cameroon, one in Niger, one in Nigeria.",
     "https://favorintl.org/", "2026-08-08T05:40:00.000Z"),
    ("seed-q2-impact-report", "2025 Q2 impact report missing", "website", "Terry",
     "2025 Q2 impact report is missing on the impact report page.",
     "https://favorintl.org/impact/", "2026-08-08T05:40:00.000Z"),
    ("seed-french-billboard", "Change the French billboard photo on Mission", "website", "Terry",
     "Under Mission, change the picture of posters in French on the billboard, the one beside our mission. It is not immediately clear what is happening.",
     "https://favorintl.org/about/mission-vision/", "2026-08-08T05:40:00.000Z"),
    ("seed-leaders-photo-comma", "National leaders line: drop the comma, photo of leaders not children", "website", "Terry",
     "National leaders, on the front lines: remove the comma. The picture should be of leaders, not children.",
     "https://favorintl.org/", "2026-08-08T05:40:00.000Z"),
    ("seed-give-local", "Give hub should cover US giving, not only international", "website", "Terry",
     "On the Give main page it only talks about international giving. What about local / US giving?",
     "https://favorintl.org/give/", "2026-08-08T05:40:00.000Z"),
    ("seed-bible-based", "Bible-based missionary movement, not non-denominational", "website", "Terry",
     "Where it says A non-denominational missionary movement, use A Bible-based missionary movement. Carole agreed. Do not use denominational yet.",
     None, "2026-08-08T05:40:00.000Z"),
    ("seed-pbs-motorcycle-video", "Add the motorcycle PBS video to Learn", "website", "Terry",
     "Put the motorcycle video up. It explains PBS clearly, Terry gets asked for it constantly, and she has sent it in many directions. Learn page thumbnails were later praised, but this specific video still belongs there.",
     "https://favorintl.org/learn/", "2026-08-08T05:42:00.000Z"),
    ("seed-who-plans-travel", "Who plans travel: Adaliah and Terry, not US staff", "website", "Terry",
     "Under Who Plans the Travel for short term trips, it is Adaliah and Terry who plan the trips fully, not US staff. US staff only plan trips that are for staff.",
     None, "2026-08-09T08:37:00.000Z"),
    ("seed-restricted-nations", "Public copy: restricted nations, not named high-risk countries", "website", "Terry",
     "Somalia, Burkina Faso, Nigeria, Libya and similar should be called restricted nations in public posts and site copy. Prayer points for partners are not always for public consumption. Protect people like John who work in restricted Muslim areas. Do not post his picture.",
     None, "2026-08-05T05:10:00.000Z"),
    ("seed-hero-video-faces", "Hero video: faces, not the backs of heads", "website", "Carole Ward",
     "The opening video has several shots showing the backs of people's heads. Replace or revise those sections to show faces and personal connection. Left as a human edit after the 8/7 meeting ship.",
     "https://favorintl.org/", "2026-08-04T16:00:00.000Z"),
    ("seed-handwriting-font", "Replace the hard-to-read quote font with Carole's handwriting or a clearer face", "website", "Carole Ward",
     "The handwritten-style font on quotes was hard to read. Keep the idea. Use a clearer font, ideally based on Carole's handwriting. Caveat already replaced Biro; this is the custom handwriting follow-up.",
     None, "2026-08-04T16:00:00.000Z"),
    ("seed-us-team-photo", "Add a US team group photograph", "website", "Stephanie Maier",
     "Obtain or improve a group photograph of the U.S. team. Left for humans after the 8/7 meeting.",
     "https://favorintl.org/about/team/", "2026-08-04T16:00:00.000Z"),
    ("seed-village-testimony", "Add Carole's village testimony video to Learn", "website", "Carole Ward",
     "Carole's full testimony filmed in a village should be on the site. People regularly request it. The living-room testimony was the one to locate.",
     "https://favorintl.org/learn/", "2026-08-04T16:00:00.000Z"),
    ("seed-6rs-graphic", "Add the 6Rs graphic", "website", "Carole Ward",
     "Final approved title, description, and image for the 6Rs still need to land. Stewardship principle should be explained with the graphic.",
     None, "2026-08-04T16:00:00.000Z"),
    ("seed-financial-percentages", "Update program vs administrative percentages after Jared", "website", "Carole Ward",
     "Site still reflects 2024 figures. Jared should review final financial figures and budget presentation before they go to the auditor. Do not invent a percentage.",
     "https://favorintl.org/about/accountability/", "2026-08-04T16:00:00.000Z"),
    ("seed-matching-landing", "Matching-gift landing for qualifying foundation and DAF gifts", "website", "Carole Ward",
     "The match applies only to qualifying new foundation or donor-advised-fund gifts. Do not promote it to every homepage visitor. A dedicated landing page, not a pop-up. Important before December 31.",
     None, "2026-08-04T16:00:00.000Z"),
    ("seed-jennifer-amount-retest", "Jennifer Morris: retest recurring amount change", "portal", "Jennifer Morris",
     "Magic link and terminated-schedule bugs are fixed. The amount PATCH has never been exercised against live Blackbaud. Jennifer retests. Worker observability is on.",
     "https://my.favorintl.org/giving", "2026-08-10T12:00:00.000Z"),
    ("seed-seo-topic-pages", "SEO topic pages from Carole and Terry keyword lists", "website", "Carole Ward",
     "Keywords to build pages around: Sahel desert, 10/40 window, trauma healing, human trafficking, Great Commission, war zones, indigenous leaders, terrorist areas, UPG, prayer movement, discipleship, famine, starvation, tribal conflict, nomadic people groups, church planting, rural education, women empowerment, Bible translation, conditions in Karamoja. Coordinate grant-related terms with Joe.",
     None, "2026-08-04T15:23:00.000Z"),
    ("seed-speaking-itinerary", "Decide whether to publish a speaking itinerary", "website", "Carole Ward",
     "People ask for Carole and Terry's US speaking itinerary. Some denominations may react badly to seeing Favor at certain churches. Needs an explicit yes/no before anything is published.",
     None, "2026-08-04T16:00:00.000Z"),
    ("seed-interactive-map-360", "Interactive map with stories, video, and 360 content", "website", "Carole Ward",
     "Future: select a location on the map, see photos, videos, and a 360 walkthrough of a mission center or PBS. Jared is expected to capture updated 360 content. Not a first-pass item.",
     "https://favorintl.org/", "2026-08-04T16:00:00.000Z"),
]

def esc(s):
    return s.replace("'", "''")

lines = ["-- Seeded from Website comments thus far.docx plus the 8/4 meeting notes."]
for i, (rid, title, surface, who, body, created) in enumerate(done):
    lines.append(
        f"INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, page_url, sort_order, approved_at, started_at, completed_at, declined_reason, created_at, updated_at) VALUES ('{rid}', '{esc(title)}', '{esc(body)}', '{surface}', 'done', '{esc(who)}', NULL, 'seed', NULL, {i}, '{DONE_AT}', '{DONE_AT}', '{DONE_AT}', NULL, '{created}', '{DONE_AT}');"
    )
    lines.append(
        f"INSERT INTO events (id, request_id, kind, actor, payload, created_at) VALUES ('evt-{rid}', '{rid}', 'status', 'Will', '{{\"from\":\"inbox\",\"to\":\"done\"}}', '{DONE_AT}');"
    )
for i, row in enumerate(inbox):
    rid, title, surface, who, body, url, created = row
    url_sql = "NULL" if not url else f"'{esc(url)}'"
    lines.append(
        f"INSERT INTO requests (id, title, body, surface, status, submitter_name, submitter_email, source, page_url, sort_order, approved_at, started_at, completed_at, declined_reason, created_at, updated_at) VALUES ('{rid}', '{esc(title)}', '{esc(body)}', '{surface}', 'inbox', '{esc(who)}', NULL, 'seed', {url_sql}, {i}, NULL, NULL, NULL, NULL, '{created}', '{NOW}');"
    )
    lines.append(
        f"INSERT INTO events (id, request_id, kind, actor, payload, created_at) VALUES ('evt-{rid}', '{rid}', 'created', '{esc(who)}', '{{\"surface\":\"{surface}\"}}', '{created}');"
    )
Path(r"C:\Users\Willb\Claude\favor\site\db\seed.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("done", len(done), "inbox", len(inbox), "bytes", Path(r"C:\Users\Willb\Claude\favor\site\db\seed.sql").stat().st_size)
