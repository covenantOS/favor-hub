"""Invented values for the break-UI fixtures. Nothing here is a real partner, gift or staff member.

KIND values are what demo data usually looks like. WORST values are things a real record can hold:
a two-person household, a church with its legal name, an address abroad, a gift with no email on file.
"""
import datetime as dt

TODAY = dt.date.today()


def day(offset=0):
    return (TODAY + dt.timedelta(days=offset)).isoformat()


def stamp(minutes_ago=0):
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes_ago)).strftime('%Y-%m-%dT%H:%M:%S.000Z')


def at(day_offset, hour, minute=0):
    """A UTC stamp for a local Eastern wall-clock time on a day offset from today (EDT, UTC-4)."""
    d = dt.datetime.combine(TODAY + dt.timedelta(days=day_offset), dt.time(0, 0)) + dt.timedelta(hours=4 + hour, minutes=minute)
    return d.strftime('%Y-%m-%dT%H:%M:%S.000Z')


# People. Mixed on purpose: long, short, accents, suffix, particles, lowercase, emoji first, CJK, right to left, spaces.
PEOPLE_WORST = [
    'Mr. and Mrs. Christopher Alexander Montgomery III and Aleksandra Wiśniewska-Kowalczyk',
    'Jo',
    'Dr. Konstantin Oberhauser-Wettstein and Rev. María José de la Cruz y Fernández',
    'Đặng Thị Ngọc Hân',
    'J',
    'Seán O\'Brien-Ó Súilleabháin',
    'نور الهدى عبد الرحمن',
    '王秀英',
    'dana',
    '🦊 Fox',
    '  Sam   Lee ',
    'Ólafur Darri Ólafsson',
    '👩🏽‍💻 Priya',
    '<script>alert(1)</script> & Sons',
    '',
]
PEOPLE_KIND = ['Jane Cooper', 'Mark Ellis', 'Ruth Bell', 'Tom Hale', 'Ann Price', 'Paul Reed', 'Sara Lane', 'John Park', 'Lucy Grant', 'Dean Ford']

ORGS_WORST = [
    'The Evangelical Lutheran Good Samaritan Society Foundation of Greater Northwest Arkansas, Inc.',
    'First Presbyterian Church of Saint Petersburg Endowment and Missions Trust',
    'Stiftung Internationale Bibelgesellschaft Donaudampfschifffahrtsgemeinschaft e.V.',
    'Q',
    'Igreja Evangélica Assembleia de Deus Ministério Missão Apostólica da Fé em São José dos Campos',
    'National Christian Foundation Donor-Advised Fund No. 4471 (c/o the Montgomery Family Charitable Trust)',
    'ABC',
]
ORGS_KIND = ['Grace Church', 'Hope Foundation', 'Oak Hill Chapel', 'Bell Family Fund', 'Northside Church']

PLACES_WORST = [
    'São Mamede de Infesta, Matosinhos, Distrito do Porto, Portugal',
    'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch, Wales',
    '',
    'Truth or Consequences, NM',
    'Rancho Santa Margarita, CA',
    'München, Deutschland',
    'Ho, Ghana',
]
PLACES_KIND = ['Tampa, FL', 'Dallas, TX', 'Franklin, TN', 'Akron, OH', 'Mesa, AZ']

ADDRESSES_WORST = [
    'Rua Professor Doutor Abel Salazar 1234, 3.º Esq. Frente\n4465-012 São Mamede de Infesta\nPORTUGAL',
    'c/o The Montgomery Family Charitable Trust, Attn: Accounts Payable\n12800 North Dale Mabry Highway, Building 4, Suite 4471-B\nTampa, FL 33618-2816',
    'Bahnhofstraße 12a\n81925 München\nDEUTSCHLAND',
    '',
    '〒150-0002 東京都渋谷区渋谷2丁目21-1 渋谷ヒカリエ 34階',
    'PO Box 7',
]

EMAILS_WORST = [
    'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
    '',
    'a@b.co',
    'first.last+billing-notifications@example.com',
    'ops@sub.department.region.example.co.uk',
    None,
]

URL_LONG = 'https://example.com/workspaces/favor/projects/q3-launch/docs/9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c?tab=comments&filter=unresolved&highlight=9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
FILES_WORST = [
    'Q3-Board-Report-FINAL-v12-revised (2).pdf',
    'IMG_20250914_183022_HDR_portrait_edited_edited.HEIC',
    'Q3 Board Deck — FINAL (revised) v12 [approved by legal].pptx',
    'a.txt',
    'Benachrichtigungseinstellungen_Rechtsschutzversicherungsgesellschaften_2026.xlsx',
]

TITLES_WORST = [
    'Quarterly partner care review, church engagement planning, year-end appeal schedule and the 2027 budget walk-through with the regional directors (three hours, bring lunch)',
    'Sync',
    'Benachrichtigungseinstellungen',
    '',
    'Line one\nLine two',
    '<b>Board prep</b> &amp; **budget**',
    'Year-end appeal: who writes what, who signs, who mails, and who calls the forty major partners before December 15',
    '1:1',
]
TITLES_KIND = ['Staff meeting', 'Budget review', 'Partner care sync', 'Board prep', 'Prayer call', 'Planning']

LONG_TEXT = ('The partner asked that we call before sending anything by mail, because the family is abroad until spring and the '
             'house sitter does not forward letters. She also asked whether the church could give through its foundation this year, '
             'which means the gift arrives from a different name and the thank-you has to go to both. ') * 3

FUNDS = ['Where Needed Most', 'Persecuted Believers Support, Chad and the wider Sahel region (restricted, board designated 2024)', 'Bibles', 'Church Planting and Leadership Training Schools', 'Wells']

AMOUNTS_WORST = [1250000.00, 0.01, -250.00, 12345678.9, 25, 0, 999999.99, 1000, -42.5, 0.30000000000000004]
AMOUNTS_KIND = [50, 100, 250, 25, 500, 1000, 75, 40]

STAFF = [
    ('s1', 'Bartholomew Fitzgerald-Montgomery', 'Regional Development Director, Southeast and Gulf Coast'),
    ('s2', 'Jo Li', 'RDD'),
    ('s3', 'Aleksandra Wiśniewska-Kowalczyk', 'Partner Care'),
    ('s4', 'Dana Reed', 'Operations'),
    ('s5', 'Ólafur Darri Ólafsson', 'Church Engagement'),
    ('s6', 'Sam Lee', 'Grants'),
    ('s7', 'Priya Natarajan-Venkataraman', 'Marketing'),
]


def pick(seq, i):
    return seq[i % len(seq)]
