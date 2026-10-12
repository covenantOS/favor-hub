"""Receipts, Foundations, Reports, Clips, Help videos, Feedback, and what the search palette asks for."""
import re
from fixtures import route, svg
from atoms import (PEOPLE_WORST, PEOPLE_KIND, ORGS_WORST, ORGS_KIND, PLACES_WORST, PLACES_KIND, TITLES_WORST, TITLES_KIND, LONG_TEXT, URL_LONG, FUNDS,
                   AMOUNTS_WORST, AMOUNTS_KIND, STAFF, EMAILS_WORST, FILES_WORST, stamp, day, pick)

NAMES_W = [x for x in PEOPLE_WORST if x] + ORGS_WORST


def n_for(mode, demo, worst, huge=1000):
    return {'demo': demo, 'worst': worst, 'empty': 0, 'one': 1, 'huge': huge}[mode]


W = lambda mode: mode in ('worst', 'huge')

# ------------------------------------------------------------------ receipts
@route('GET', r'^/api/(receipts|foundations)/me$')
def unlocked(mode, m, q, state):
    return {'ok': True, 'unlocked': True, 'name': 'Christopher Alexander Montgomery III' if W(mode) else 'Jane', 'signin': True}


def letter(mode, i, held=False):
    w = W(mode)
    nm = pick(NAMES_W, i) if w else ('Jo' if mode == 'one' else pick(PEOPLE_KIND, i))
    # Several gifts from one partner share a constituent, so one receipt carries many gift lines.
    cl = str(17000 + (0 if (w and i < 40) else i))
    if w and i < 40:
        nm = NAMES_W[0]
    key, reason = '', ''
    if held:
        key, reason = [('abroad', 'Address is in Portugal'), ('noaddr', 'No mailing address on file'), ('dnm', 'Asked for no mail'), ('dup', 'Already in the Oct 8 print file, and marked there by someone else on Friday')][i % 4]
    it = {'id': str(66000 + i), 'lookup': str(63000 + i), 'date': day(-(i % 80)), 'amount': pick(AMOUNTS_WORST, i) if w else (1 if mode == 'one' else pick(AMOUNTS_KIND, i)),
          'type': ['One-Time Gift', 'Recurring Gift Payment', 'Stock/Property (sold through the brokerage)'][i % 3] if w else 'One-Time Gift', 'segment': ['regular', 'major', 'recurring'][i % 3],
          'addressee': nm, 'sortName': nm, 'place': pick(PLACES_WORST, i) if w else pick(PLACES_KIND, i), 'fund': ', '.join(FUNDS[: 1 + i % 5]) if w else 'Where Needed Most',
          'constituentLookup': cl, 'addressKey': 'k%d' % (i % 3 if w else i), 'reason': reason, 'key': key, 'canAdd': held and i % 2 == 0}
    if w and i % 9 == 4:
        it['batch'] = {'id': 'b1', 'letterDate': day(-3)}
    return it


@route('GET', r'^/api/receipts/waiting$')
def waiting(mode, m, q, state):
    n = n_for(mode, 14, 120, 1000)
    return {'ok': True, 'asOf': stamp(2), 'days': 90, 'appealCode': 'Y26A-TY', 'letters': [letter(mode, i) for i in range(n)], 'held': [letter(mode, 500 + i, True) for i in range(n_for(mode, 3, 60, 1000))]}


@route('GET', r'^/api/receipts/batches$')
def batches(mode, m, q, state):
    n = n_for(mode, 3, 12, 60)
    w = W(mode)
    return {'ok': True, 'batches': [{'id': 'b%d' % i, 'kind': ['new', 'reprint'][i % 2], 'letterDate': day(-i * 7), 'appealCode': 'Y26A-TY', 'count': [12847, 1, 181][i % 3] if w else (1 if mode == 'one' else 181), 'gifts': [12847, 1, 188][i % 3] if w else (1 if mode == 'one' else 188),
                                     'amount': [12345678.9, 0.01, 50879.97][i % 3] if w else 50879.97, 'regular': 49, 'major': 34, 'recurring': 98, 'firstGift': day(-40), 'lastGift': day(-7), 'sourceDate': day(-30) if i % 2 else '',
                                     'marked': [12000, 1, 0, 188][i % 4] if w else (1 if mode == 'one' else 188), 'markFailed': 847 if w and i % 4 == 0 else 0, 'status': ['done', 'marking', 'open', 'failed'][i % 4] if w else 'done',
                                     'createdBy': pick(NAMES_W, i)[:60] if w else 'Jane', 'createdAt': stamp(i * 9000), 'markedBy': pick(NAMES_W, i + 1)[:60] if w else 'Jane', 'markedAt': stamp(i * 9000), 'downloadedAt': stamp(i * 9000) if i % 2 else ''} for i in range(n)]}


@route('GET', r'^/api/receipts/wording$')
def wording(mode, m, q, state):
    return {'ok': True, 'copy': {'paragraphs': ['Thank you for your gift.'], 'closing': 'With gratitude,', 'signerName': 'Ann Price', 'signerTitle': 'Executive Director', 'greeting': 'Dear', 'asks': {'regular': [], 'major': []}}, 'defaults': {}, 'fit': {'fits': True}, 'saved': None, 'history': []}


# ------------------------------------------------------------------ foundations
def foundation(mode, i):
    w = W(mode)
    return {'id': 'f%d' % i, 'name': (pick(ORGS_WORST, i)[:160] if w else ('Q' if mode == 'one' else pick(ORGS_KIND, i) + ' Foundation')), 'location': pick(PLACES_WORST, i)[:120] if w else pick(PLACES_KIND, i), 'assets': '$12,345,678,901 (2024 Form 990-PF, line 16, fair market value)'[:60] if w else '$4M',
            'status': ['open', 'dead', 'open', 'won'][i % 4] if w else 'open', 'dead_reason': LONG_TEXT[:300] if w and i % 4 == 1 else '', 'bb_lookup_id': '21046' if i % 3 == 0 else None, 'bb_name': pick(ORGS_WORST, i + 1) if i % 3 == 0 and w else None,
            'updated_at': stamp(i * 5000), 'contacts': [1284, 1, 0, 5][i % 4] if w else (1 if mode == 'one' else 5), 'last_contact': day(-i * 11) if i % 4 != 2 else None,
            'rdds': ', '.join(s[1] for s in STAFF[: 1 + i % 7]) if w else ('' if mode == 'one' else 'Mark Ellis'), 'waiting': [12847, 0, 1][i % 3] if w else 0, 'misplaced': 100 if w and i % 5 == 0 else 0}


FND_BASE = {'settings': {'posting': 'on', 'moves': 'off'}, 'people': [{'name': s[1], 'team': s[2]} for s in STAFF], 'hows': ['Call', 'Email', 'Meeting', 'Letter', 'LOI', 'Application'], 'tags': ['Scheduling', 'Stewardship', 'Thanked', 'Texted', 'Ask'],
            'outcomes': ['No answer', 'Left a message', 'Spoke', 'Declined', 'Invited to apply', 'Applied', 'Funded'], 'catch_all': {'lookup': '21046', 'name': 'Unsolicited Foundations'}}


@route('GET', r'^/api/foundations$')
def foundations(mode, m, q, state):
    n = n_for(mode, 12, 60, 1000)
    return dict(FND_BASE, ok=True, foundations=[foundation(mode, i) for i in range(n)])


def bb_org(mode, i):
    w = W(mode)
    return {'lookup_id': str(21000 + i), 'system_id': str(i), 'name': pick(ORGS_WORST, i) if w else 'Hope Foundation', 'where': pick(PLACES_WORST, i) if w else 'Dallas, TX', 'made': day(-900),
            'codes': ['Foundation', 'Church', 'Major partner', 'Grant maker (family, private, non-operating)', 'Board connection'] if w else ['Foundation'], 'held': [s[1] for s in STAFF] if w else ['Mark Ellis'],
            'gifts': 1284 if w else 3, 'gift_total': 12345678.9 if w else 15000, 'last_gift': day(-30), 'contacts': 1284 if w else 4, 'last_contact': day(-10), 'grant_actions': 100 if w else 1, 'last_grant': day(-90)}


@route('GET', r'^/api/foundations/check$')
def fnd_check(mode, m, q, state):
    n = n_for(mode, 2, 12, 12)
    pr = [dict(foundation(mode, i), last_rdd=STAFF[i % 7][1]) for i in range(n)]
    return {'ok': True, 'prospects': pr, 'blackbaud': [bb_org(mode, i) for i in range(n)], 'offline': False}


@route('GET', r'^/api/foundations/(cleanup|activity|health)$')
def fnd_misc(mode, m, q, state):
    w = W(mode)
    n = n_for(mode, 2, 20, 150)
    return {'ok': True, 'misplaced': [{'id': 'f%d' % i, 'name': pick(ORGS_WORST, i), 'bb_lookup_id': '1', 'bb_name': pick(ORGS_WORST, i + 1), 'bb_match_reason': 'name', 'bb_linked_at': stamp(900), 'contact_id': i, 'contact_date': day(-i), 'category': 'Call', 'rdd_name': STAFF[i % 7][1], 'summary': LONG_TEXT[:200], 'tags': 'Ask'} for i in range(n)] if w else [],
            'thin': [], 'offline': False, 'moves': 'off', 'log': [], 'waiting': [], 'blackbaud': 'ok', 'mirror': 'ok', 'tags': 'ok'}


@route('GET', r'^/api/foundations/([a-z0-9]+)$')
def fnd_one(mode, m, q, state):
    w = W(mode)
    f = foundation(mode if mode != 'empty' else 'demo', 0)
    f.update(id=m.group(1), phone='+44 (0) 20 7946 0958 ext. 12847' if w else '(214) 555-0100', email=EMAILS_WORST[0] if w else 'grants@example.org', website=URL_LONG[:200] if w else 'example.org', ein='12-3456789', notes=LONG_TEXT[:2000] * (2 if w else 0) or ('' if not w else ''))
    if w:
        f['name'] = 'Stiftung-Internationale-Bibelgesellschaft-Donaudampfschifffahrtsgemeinschaft-und-Rechtsschutzversicherungsgesellschaften'
        f['notes'] = (LONG_TEXT * 3)[:2000]
    n = n_for(mode, 3, 40, 300)
    contacts = [{'id': i, 'date': day(-i * 12), 'how': FND_BASE['hows'][i % 6], 'category': 'Grants Action', 'rdd': STAFF[i % 7][1] if w else 'Mark Ellis', 'summary': pick(TITLES_WORST, i) if w else 'Intro call',
                 'note': [LONG_TEXT[:4000], '', URL_LONG, 'ok'][i % 4] if w else 'Good first call.', 'outcome': FND_BASE['outcomes'][i % 7], 'tags': FND_BASE['tags'][: i % 6] if w else [], 'source': 'hub', 'bb_action_id': '2624' if i % 3 == 0 else None,
                 'bb_on': day(-i * 12) if i % 3 == 0 else None, 'bb_state': ['posted', 'waiting', 'failed'][i % 3] if w else 'posted', 'bb_tags_state': 'ok',
                 'bb_error': 'Blackbaud said: 400 Bad Request {"errors":[{"message":"constituent_id is required and must reference an active record"}]} ' + URL_LONG if w and i % 3 == 2 else None,
                 'by': pick(NAMES_W, i) if w else 'Jane', 'created_at': stamp(i * 9000)} for i in range(n)]
    return {'ok': True, 'foundation': f, 'contacts': contacts, 'log': [], 'catch_all': FND_BASE['catch_all']}


@route('GET', r'^/api/foundations/([a-z0-9]+)/blackbaud$')
def fnd_bb(mode, m, q, state):
    if mode in ('empty', 'one'):
        return {'ok': True, 'linked': None, 'suggestions': []}
    return {'ok': True, 'linked': bb_org(mode, 0), 'suggestions': [bb_org(mode, i) for i in range(1, 5)]}


# ------------------------------------------------------------------ reports
@route('GET', r'^/api/reports$')
def reports(mode, m, q, state):
    w = W(mode)
    n = n_for(mode, 8, 16, 60)
    groups = [{'id': 'daily', 'label': 'Daily and weekly'}, {'id': 'monthly', 'label': 'Monthly, quarterly and board reporting for the Executive Director' if w else 'Monthly'}]
    reps = [{'id': 'report-%d' % i, 'group': groups[i % 2]['id'], 'name': (pick(TITLES_WORST, i) or 'Untitled report') if w else ['Daily Revenue Report', 'Gift Detail', 'LYBUNT', 'Recurring gifts'][i % 4],
             'replaces': LONG_TEXT[:160] if w else 'The daily email', 'who': 'Admin desk, Partner Care, the regional directors and the board finance committee' if w and i % 2 == 0 else 'Admin desk',
             'freq': 'Daily, after 9:30 AM, and again on the first business day after month end' if w else 'Daily', 'audience': ['admin_desk'], 'kpiTie': i % 2 == 0, 'build': 'B1', 'ready': i % 5 != 4} for i in range(n)]
    return {'ok': True, 'groups': groups, 'reports': reps, 'queryMap': {'id': 'query-map', 'name': 'Blackbaud query map', 'ready': True}}


@route('GET', r'^/api/reports/([a-z0-9-]+)$')
def report_run(mode, m, q, state):
    w = W(mode)
    n = n_for(mode, 20, 60, 1000)
    cols = [{'key': 'partner', 'label': 'Partner', 'type': 'text'}, {'key': 'id', 'label': 'ID', 'type': 'id'}, {'key': 'date', 'label': 'Gift date', 'type': 'date'}, {'key': 'amount', 'label': 'Amount', 'type': 'money', 'total': True},
            {'key': 'gifts', 'label': 'Gifts', 'type': 'int', 'total': True}, {'key': 'share', 'label': 'Share', 'type': 'pct'}, {'key': 'status', 'label': 'Status', 'type': 'chip'}, {'key': 'fund', 'label': 'Fund', 'type': 'text'},
            {'key': 'address', 'label': 'Mailing address' if not w else 'Mailing address as printed on the receipt', 'type': 'text'}, {'key': 'team', 'label': 'Team', 'type': 'text'}]
    if w:
        cols += [{'key': 'x%d' % i, 'label': ['Jan', 'February revenue', 'Q1', 'Benachrichtigungseinstellungen'][i % 4], 'type': ['money', 'int', 'text'][i % 3], 'total': i % 3 == 0} for i in range(30)]
    rows = []
    for i in range(n):
        r = {'partner': (pick(NAMES_W, i) if w else ('Jo' if mode == 'one' else pick(PEOPLE_KIND, i))), 'id': str(10000 + i), 'date': [day(-i), '', '2026-13-45', None][i % 4] if w else day(-i), 'amount': pick(AMOUNTS_WORST, i) if w else pick(AMOUNTS_KIND, i),
             'gifts': [1284, 1, 0, None][i % 4] if w else 3, 'share': [1.42, -0.03, 0, None][i % 4] if w else 0.12, 'status': ['Mailed', 'Hold', 'LYBUNT', 'Lapsed', 'Waiting on the Executive Director', ''][i % 6] if w else 'Mailed',
             'fund': pick(FUNDS, i) if w else 'Where Needed Most', 'address': ('Rua Professor Doutor Abel Salazar 1234, 3.º Esq. Frente, 4465-012 São Mamede de Infesta, PORTUGAL' if i % 2 else '') if w else '12 Oak St, Tampa, FL',
             'team': STAFF[i % 7][2] if w else ['RDD', 'Partner Care'][i % 2]}
        if w:
            for j in range(30):
                r['x%d' % j] = [12345678.9, 1284, URL_LONG if (i + j) % 17 == 0 else 'ok'][j % 3]
        rows.append(r)
    tiles = [{'label': 'Raised', 'value': 1234567890.12 if w else 50879.97, 'kind': 'money', 'sub': 'Since January 1, against a goal of $999,999,999.00 set by the board in November' if w else 'This week'},
             {'label': 'Gifts from first-time partners in the Southeast region' if w else 'Gifts', 'value': 12847 if w else (1 if mode == 'one' else 188), 'kind': 'int', 'sub': ''},
             {'label': 'Refunds', 'value': -42.5 if w else 0, 'kind': 'money', 'sub': ''}, {'label': 'Status', 'value': 'Waiting on Blackbaud' if w else 'Ready', 'kind': 'text', 'sub': ''}]
    return {'ok': True, 'report': {'id': m.group(1), 'name': (TITLES_WORST[0] if w else 'Daily Revenue Report'), 'columns': cols,
                                    'filters': [{'id': 'from', 'label': 'From', 'type': 'date', 'def': day(-7)}, {'id': 'team', 'label': 'Team or regional director (pick one)', 'type': 'select', 'options': [['', 'Everyone']] + [[s[0], s[1] + ', ' + s[2]] for s in STAFF], 'def': ''}, {'id': 'q', 'label': 'Find', 'type': 'text', 'def': ''}],
                                    'values': {}, 'rows': rows, 'count': 25000 if mode == 'huge' else n, 'more': mode == 'huge', 'totals': {'amount': 1234567890.12 if w else 4000, 'gifts': 1284773 if w else 60}, 'tiles': tiles if mode != 'empty' else [],
                                    'tie': {'status': 'off' if w else 'ok', 'label': 'KPI dashboard', 'mine': 1234567890.12, 'kpi': 1234567000, 'diff': 890.12, 'kind': 'money', 'note': LONG_TEXT[:240] if w else ''},
                                    'post': (LONG_TEXT + '\n' + URL_LONG) if w else '', 'note': LONG_TEXT[:200] if w else '', 'editable': [], 'asOf': stamp(5), 'pageSize': 200}}


# ------------------------------------------------------------------ clips
def clip(mode, i):
    w = W(mode)
    return {'id': ('%032x' % (i + 1)), 'owner_name': pick(NAMES_W, i) if w else 'Jane Cooper', 'owner_team': STAFF[i % 7][2] if w else '', 'owner_email': 'x%d@example.org' % i,
            'title': ([pick(TITLES_WORST, i), FILES_WORST[1], ''][i % 3][:120] if w else ('k' if mode == 'one' else ['How to print receipts', 'Entering a batch', 'Work Center tour'][i % 3])),
            'summary': [LONG_TEXT[:1500], '', URL_LONG][i % 3] if w else 'A short walk-through.', 'status': ['ready', 'processing', 'failed', 'ready'][i % 4] if w else 'ready', 'share': i % 2, 'kind': 'screen',
            'size_bytes': [10737418240, 1023, 70226252, 0][i % 4] if w else 70226252, 'duration_ms': [9876543, 0, 999, 358048][i % 4] if w else 358048, 'has_poster': 1 if i % 3 != 2 else 0,
            'views': [1284, 1, 0][i % 3] if w else (1 if mode == 'one' else 4), 'created_at': stamp(i * 5000), 'mine': True,
            'match': {'at': 61, 'text': [LONG_TEXT, 'On screen: ' + URL_LONG][i % 2]} if w and i % 2 == 0 else None}


@route('GET', r'^/api/clips/?$')
def clips(mode, m, q, state):
    n = n_for(mode, 5, 24, 300)
    w = W(mode)
    out = {'ok': True, 'clips': [clip(mode, i) for i in range(n)], 'scope': q.get('scope', 'mine'),
           'usage': {'used': 10630044057 if w else 98497745, 'cap': 10737418240, 'maxMs': 2700000, 'pct': 99 if w else 1, 'warn': w, 'full': False, 'clips': 12847 if w else n,
                     'oldestUnwatched': [{'id': '%032x' % (i + 1), 'title': pick(TITLES_WORST, i) or 'Untitled clip', 'created_at': stamp(900000), 'size_bytes': 1073741824} for i in range(5)] if w else []}}
    if q.get('scope') == 'all':
        out['people'] = [{'email': (pick(EMAILS_WORST, 0) if i % 2 == 0 else 'a@b.co') if w else 'jane@example.org', 'name': pick(NAMES_W, i) if w else 'Jane Cooper', 'team': STAFF[i % 7][2], 'clips': 1284 if w else 3, 'bytes': 10737418240 if w and i == 0 else 98497745, 'blocked': w and i % 4 == 1} for i in range(n_for(mode, 3, 30, 100))]
        out['cap'] = 10737418240
    return out


@route('GET', r'^/api/clips/([0-9a-f]{32})/info$')
def clip_info(mode, m, q, state):
    w = W(mode)
    c = clip(mode if mode != 'empty' else 'demo', 0)
    n = n_for(mode, 4, 40, 500)
    title = TITLES_WORST[0][:120] if w else c['title']
    return {'ok': True, 'clip': {'id': m.group(1), 'title': title, 'summary': (LONG_TEXT[:1400] + ' ' + URL_LONG)[:1500] if w else c['summary'], 'status': 'ready', 'kind': 'screen', 'mime': 'video/webm', 'duration': 9876 if w else 358, 'size': 70226252, 'hasPoster': True,
                                 'share': 1, 'ownerName': PEOPLE_WORST[0] if w else 'Jane Cooper', 'createdAt': stamp(5000),
                                 'chapters': [{'at': i * 240, 'title': (pick(TITLES_WORST, i) or 'Untitled')[:90] if w else 'Step %d' % (i + 1)} for i in range(n_for(mode, 3, 10, 10))],
                                 'transcript': [{'s': i * 6, 'e': i * 6 + 5, 't': [LONG_TEXT[:600], 'ok', URL_LONG][i % 3] if w else 'Then press Print.'} for i in range(n_for(mode, 12, 200, 1000))], 'words': [], 'translations': {}, 'edits': {}, 'error': ''},
            'user': {'email': 'jane@example.org', 'name': 'Jane Cooper', 'admin': True},
            'comments': [{'id': i, 'at_seconds': i * 240 % 9000, 'author_email': 'x%d@example.org' % i, 'author_name': pick(PEOPLE_WORST, i) if w else 'Mark Ellis', 'body': [LONG_TEXT[:2000], 'ok', URL_LONG, '<b>bold</b> &amp;'][i % 4] if w else 'Helpful, thanks.', 'created_at': stamp(i * 2000)} for i in range(n)],
            'reactions': [{'id': i, 'emoji': ['👍', '❤️', '🎉', '👩🏽‍💻'][i % 4], 'at_seconds': i * 20, 'person_email': 'x%d@example.org' % i, 'person_name': pick(PEOPLE_WORST, i) if w else 'Mark Ellis', 'created_at': stamp(i * 100)} for i in range(n_for(mode, 3, 200, 500))],
            'viewers': [{'email': 'x%d@example.org' % i, 'name': pick(PEOPLE_WORST, i) if w else 'Mark Ellis', 'at': stamp(i * 3000), 'seconds': 9876 if w else 200, 'plays': [1284, 1, 2][i % 3]} for i in range(n_for(mode, 3, 40, 300))],
            'views': 1284773 if w else (1 if mode == 'one' else 4), 'can': {'edit': True, 'delete': True, 'share': True}, 'mine': True}


@route('GET', r'^/api/clips/([0-9a-f]{32})/(media|poster)$')
def clip_media(mode, m, q, state):
    i = int(m.group(1), 16)
    if 'poster' not in q and m.group(2) == 'media':
        return (404, 'text/plain', 'no video in the harness')
    if W(mode) and i % 4 == 2:
        return (404, 'text/plain', 'gone')
    if W(mode) and i % 4 == 1:
        return svg(4000, 200, 'panorama')
    if W(mode) and i % 4 == 3:
        return svg(200, 4000, 'tall')
    return svg(1280, 720, 'clip')


@route('GET', r'^/api/videos/.*\.jpg$')
def video_poster(mode, m, q, state):
    if W(mode):
        return (404, 'text/plain', 'gone')
    return svg(1280, 720, 'video')


# ------------------------------------------------------------------ feedback
@route('GET', r'^/api/feedback/(all|mine)$')
def feedback(mode, m, q, state):
    w = W(mode)
    n = n_for(mode, 4, 30, 300)
    items = [{'id': i, 'at': stamp(i * 700) if not (w and i == 5) else 'not-a-date', 'email': (pick(EMAILS_WORST, i) or 'a@b.co') if w else 'mark@example.org', 'name': pick(PEOPLE_WORST, i) if w else 'Mark Ellis', 'source': ['hub-brain', 'hub', 'help', 'an-unknown-source-key'][i % 4],
              'rating': ['wrong', 'right', 'idea', ''][i % 4], 'comment': [LONG_TEXT[:2000], '', URL_LONG, 'ok', '<img src=x onerror=alert(1)>'][i % 5] if w else 'The total looks off.', 'ref': '6w3d60', 'question': (pick(TITLES_WORST, i) + ' ' + LONG_TEXT)[:600] if w else 'Compared with last year',
              'reading': LONG_TEXT[:400] if w else 'Year over year', 'page': ['/brain/?c=c_2e3i0d1l', 'javascript:alert(1)', URL_LONG, ''][i % 4] if w else '/brain/', 'status': ['new', 'seen', 'fixed', 'not-now'][i % 4] if w else 'new',
              'reply': [None, LONG_TEXT[:2000], URL_LONG][i % 3] if w else None, 'handled_by': None, 'handled_at': stamp(i * 100) if i % 3 else None, 'has_shot': 1 if w and i % 2 else 0, 'unread': i % 2} for i in range(n)]
    return {'ok': True, 'items': items, 'counts': {'fixed': 12847, 'new': 100, 'seen': 99, 'not-now': 1} if w else {'fixed': 3, 'new': n}}


@route('GET', r'^/api/feedback/(\d+)/shot$')
def feedback_shot(mode, m, q, state):
    i = int(m.group(1))
    if i % 4 == 1:
        return (404, 'text/plain', 'Not found')
    return svg(200, 4000, 'tall') if i % 4 == 3 else svg(4000, 200, 'wide')


# ------------------------------------------------------------------ what the search palette asks
@route('POST', r'^/api/brain/drive/search$')
def drive_search(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'files': []}
    w = W(mode)
    return {'ok': True, 'files': [{'name': pick(FILES_WORST, i) if w else 'Fall plan', 'link': 'https://docs.google.com/document/d/abc%d' % i, 'type': 'Google Doc', 'owner': pick(NAMES_W, i) if w else 'Mark Ellis', 'modified': day(-i), 'folder': 'US Team Files / Development / Regional Directors / 2026 / Q4 / Year-end appeal / Drafts' if w else 'US Team Files'} for i in range(6)]}


@route('GET', r'^/api/sheets/recent$')
def sheets_recent(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'sheets': []}
    w = W(mode)
    return {'ok': True, 'sheets': [{'title': ('Favor lists ' + pick(TITLES_WORST, i)) if w else 'Favor lists ' + day(), 'url': 'https://docs.google.com/spreadsheets/d/x', 'at': stamp(i * 60), 'rows': 12847 if w else 40} for i in range(n_for(mode, 2, 5, 5))]}


@route('GET', r'^/api/requests/search$')
def request_search(mode, m, q, state):
    # The request board belongs to another lane; the palette only needs an answer.
    return {'ok': True, 'rows': [], 'results': []}
