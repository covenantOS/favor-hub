"""Favor Brain: the chat list and one conversation whose answers carry every block type."""
from fixtures import route
from atoms import PEOPLE_WORST, PEOPLE_KIND, ORGS_WORST, PLACES_WORST, TITLES_WORST, LONG_TEXT, URL_LONG, STAFF, FILES_WORST, AMOUNTS_WORST, stamp, day, pick

W = lambda mode: mode in ('worst', 'huge')
NAMES_W = [x for x in PEOPLE_WORST if x] + ORGS_WORST


def table(mode, rows_n, cols_n=6, preview=8):
    w = W(mode)
    cols = [{'key': 'name', 'label': 'Partner', 'type': 'name'}, {'key': 'life', 'label': 'Lifetime', 'type': 'money'}, {'key': 'gifts', 'label': 'Gifts', 'type': 'int'}, {'key': 'pct', 'label': 'Change', 'type': 'pct'},
            {'key': 'score', 'label': 'iWave', 'type': 'score'}, {'key': 'band', 'label': 'Capacity', 'type': 'band'}, {'key': 'last', 'label': 'Last gift', 'type': 'date'}, {'key': 'note', 'label': 'Note', 'type': 'text'}][:max(2, min(cols_n, 8))]
    for j in range(max(0, cols_n - 8)):
        cols.append({'key': 'x%d' % j, 'label': ['Jan', 'February revenue, net of refunds', 'Q1', 'Benachrichtigungseinstellungen'][j % 4], 'type': ['money', 'int', 'text'][j % 3]})
    rows = []
    for i in range(rows_n):
        r = {'name': pick(NAMES_W, i) if w else pick(PEOPLE_KIND, i), 'lookup_id': str(100 + i), 'place': pick(PLACES_WORST, i) if w else 'Tampa, FL', 'life': pick(AMOUNTS_WORST, i) if w else 1200 + i, 'gifts': [1284, 1, 0, None][i % 4] if w else 4,
             'pct': [142, -3, 12.3456, None][i % 4] if w else 12, 'score': [10, None, 3][i % 3], 'band': ['$5,000,000 to $10,000,000 (very high)', None, '$1K'][i % 3] if w else '$25K to $50K', 'last': [day(-i), None, 'not-a-date'][i % 3] if w else day(-i),
             'note': [LONG_TEXT[:200], '', URL_LONG][i % 3] if w else 'Monthly'}
        for j in range(max(0, cols_n - 8)):
            r['x%d' % j] = [12345678.9, 1284, 'ok'][j % 3]
        rows.append(r)
    return {'type': 'table', 'title': (TITLES_WORST[0] if w else 'Top partners this year'), 'rows': rows, 'cols': cols, 'chips': [{'key': 'place', 'label': 'City'}, {'key': 'band', 'label': 'Capacity'}], 'sort': {'key': 'life', 'dir': 'desc'}, 'preview': preview,
            'count': 12847 if w else rows_n, 'more': w, 'token': 'tok1', 'csv': 'x', 'noun': 'partners', 'note': LONG_TEXT[:200] if w else '', 'sheet_title': 'Top partners'}


def partner_card(mode):
    w = W(mode)
    return {'type': 'partner', 'name': PEOPLE_WORST[0] if w else 'Jane Cooper', 'place': PLACES_WORST[0] if w else 'Tampa, FL', 'kind': 'Individual', 'tags': ['Major partner', 'Board member (emeritus)', 'customer-feedback-from-enterprise-onboarding', 'Church', 'Monthly', 'Prayer team'] if w else ['Monthly'],
            'holder': {'name': STAFF[0][1] + ', ' + STAFF[0][2] if w else 'Mark Ellis'},
            'stats': {'lifetime': 123456789.01 if w else 5200, 'since': '1998' if w else '2021', 'last_gift': {'amount': 1250000.0 if w else 100, 'date': day(-9)}, 'largest': {'amount': 12345678.9 if w else 500, 'date': day(-900)},
                      'last_contact': {'kind': 'Email and a handwritten card with the annual report' if w else 'Call', 'date': day(-30), 'by': STAFF[2][1] if w else 'Mark Ellis'}},
            'years': [{'y': 2026 - i, 'amount': [12345678.9, 0, 1250000, 25][i % 4] if w else 900 + i * 100} for i in range(30 if w else 5)], 'lookup': '14907',
            'iwave': {'fresh': False, 'scored_at': day(-900), 'band': {'label': '$5,000,000 to $10,000,000 (very high, verified twice)' if w else '$25K to $50K'}, 'estimate': {'value': 12345678.9 if w else 30000},
                      'meters': [{'label': ['Capacity', 'Affinity to faith-based international causes', 'Propensity'][i % 3] if w else ['Capacity', 'Affinity', 'Propensity'][i], 'value': [10, None, 3][i % 3] if w else 7, 'max': 10, 'why': 'Not rated yet: no recent screening on file for this household' if w and i == 1 else '', 'date': day(-900)} for i in range(3)]},
            'actions': [{'label': 'Open the partner page', 'href': '/work/partner/5001'}, {'label': 'Refresh the iWave rating for this household' if w else 'Refresh iWave', 'ask': 'refresh'}, {'label': 'Make a sheet', 'sheet': 'x'}]}


def tiles(mode):
    w = W(mode)
    if not w:
        return {'type': 'tiles', 'tiles': [{'label': 'Raised this year', 'value': 9536717.72, 'format': 'money_short', 'delta': {'dir': 'up', 'pct': 34}, 'compare': 'vs. last year', 'trend': [3, 4, 6, 5, 8]}, {'label': 'Partners', 'value': 4210, 'format': 'int'}, {'label': 'Goal', 'value': 73, 'format': 'pct', 'progress': 73}]}
    return {'type': 'tiles', 'tiles': [{'label': 'Raised so far this year across every team and fund', 'value': 12345678.9, 'format': 'money', 'delta': {'dir': 'up', 'pct': 96112620.1234}, 'compare': 'compared with the same day last year, before the year-end appeal', 'trend': [0, 0, 12345678, 1, 5]},
                                       {'label': 'Partners', 'value': 1284773, 'format': 'int', 'delta': {'dir': 'down', 'pct': 12.3456}}, {'label': 'Goal', 'value': 142, 'format': 'pct', 'progress': 142},
                                       {'label': 'Refunds', 'value': -42.5, 'format': 'money'}, {'label': 'Benachrichtigungseinstellungen', 'value': 'Waiting on Blackbaud to answer', 'format': 'text'}, {'label': 'Zero', 'value': 0, 'format': 'money_short'},
                                       {'label': 'Largest', 'value': 1234567890.12, 'format': 'money'}, {'label': 'None', 'value': None, 'format': 'int'}]}


def blocks(mode, k=0):
    w = W(mode)
    if mode == 'one':
        return [{'type': 'text', 'md': 'k'}, table(mode, 1, 3)]
    sets = [
        [{'type': 'text', 'md': ('**12,345,678** partners. See ' + URL_LONG + ' and\n\n| Partner | Lifetime | City | Note |\n|---|---|---|---|\n| ' + PEOPLE_WORST[0] + ' | $12,345,678.90 | São Mamede de Infesta | ' + LONG_TEXT[:120] + ' |\n| Jo | $1 | | |\n\n- one\n- ' + LONG_TEXT[:200]) if w else 'Here are the **top partners** this year.'},
         tiles(mode), table(mode, 1000 if mode == 'huge' else (40 if w else 8), 40 if w else 6)],
        [partner_card(mode),
         {'type': 'team', 'team': 'Regional Development Directors, Southeast and Gulf Coast' if w else 'RDD team', 'year': 2026, 'total': 1234567890.12 if w else 4276571.2, 'goal': 999999999 if w else 4852055, 'link': '[Open the dashboard](/dashboard/)', 'compare': {'value': 1284.5 if w else 3900000, 'this_value': 1, 'label': 'this day last year'},
          'quarters': [{'q': i + 1, 'a': [123456789.01, 0, None, 12][i] if w else 1000000 + i, 'b': 12345678.9 if w else 900000, 'goal': 100000000 if w else 1200000} for i in range(4)], 'months': [{'m': i + 1, 'a': [12345678.9, 0, 5][i % 3] if w else 300000 + i * 1000, 'b': 250000, 'partial': i == 9} for i in range(12)]},
         {'type': 'chart', 'title': TITLES_WORST[0] if w else 'Giving by month', 'kind': 'bar', 'x': ['2024-%02d' % (i % 12 + 1) for i in range(36 if w else 12)], 'series': [{'label': 'This year, all teams and funds' if w else 'This year', 'values': [[1234567890.12, 0, None, 5][i % 4] if w else 100000 + i * 5000 for i in range(36 if w else 12)]}, {'label': 'Last year', 'values': [90000 + i * 100 for i in range(36 if w else 12)]}], 'y_format': 'money_short', 'note': LONG_TEXT[:200] if w else ''}],
        [{'type': 'coverage', 'title': 'Who has an iWave rating', 'total': 12847 if w else 400, 'segments': [{'label': 'Rated', 'n': 12000 if w else 300, 'tone': 'a', 'note': ''}, {'label': 'Not rated yet & "waiting"', 'n': 1, 'tone': 'b', 'note': LONG_TEXT[:120] if w else ''}, {'label': 'Never', 'n': 846 if w else 99, 'tone': 'muted'}]},
         {'type': 'steps', 'title': 'Enter a check batch', 'steps': [{'md': ('Open **Batch entry** at ' + URL_LONG) if w else 'Open **Batch entry**.', 'hint': LONG_TEXT[:160] if w else ''}, {'md': 'Press Save.', 'hint': ''}], 'source': {'manual': 'Operations Manual, Blackbaud guides for the admin desk' if w else 'Operations Manual', 'section': 'Gift Batch', 'href': '/help/'}, 'video': {'href': '/help/videos/'}},
         {'type': 'confirm', 'id': 'c1', 'kind': 'iwave_refresh', 'status': 'ready', 'title': ('Refresh iWave for ' + PEOPLE_WORST[0]) if w else 'Refresh iWave for Jane Cooper', 'sub': LONG_TEXT[:200] if w else 'Uses one credit.',
          'facts': [{'label': 'Credits left', 'value': 12847 if w else 40, 'sub': 'of 15,000'}, {'label': 'Last rated', 'value': 'Never, and the last attempt failed on October 3' if w else 'Feb 1', 'sub': ''}, {'label': 'Reference', 'value': '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f' if w else 'ok'}], 'notes': [{'icon': 'info', 'text': LONG_TEXT[:160]}] if w else [],
          'progress': {'done': 1, 'total': 12847}, 'actions': [{'id': 'go', 'label': 'Refresh the rating for this household now' if w else 'Refresh', 'tone': 'primary', 'enabled': True}, {'id': 'no', 'label': 'Not now', 'enabled': True}], 'who': ''},
         {'type': 'note', 'title': 'Benachrichtigungseinstellungen' if w else 'Access', 'body': LONG_TEXT[:300] if w else 'You have what you need.', 'tone': 'lock', 'access': 'giving', 'asks': ['Ask for giving access', LONG_TEXT[:120]] if w else []},
         {'type': 'sheet', 'title': ('Favor lists ' + TITLES_WORST[0]) if w else 'Top partners', 'rows': 12847 if w else 40, 'private': True, 'url': 'https://docs.google.com/x'},
         {'type': 'choice', 'q': 'Which one?', 'opts': [{'label': pick(NAMES_W, i) if w else pick(PEOPLE_KIND, i), 'sub': pick(PLACES_WORST, i) if w else 'Tampa, FL', 'ask': 'x'} for i in range(8 if w else 3)], 'other': True},
         {'type': 'files', 'title': 'In the shared drive', 'files': [{'kind': 'sheet', 'kind_label': 'Google Sheet, matched by picture description' if w else 'Sheet', 'title': pick(FILES_WORST, i) if w else 'Fall plan', 'owner': pick(NAMES_W, i) if w else 'Mark Ellis', 'modified': day(-i), 'indexed': day(-i),
                                                                      'folder': 'US Team Files / Development / Regional Directors / 2026 / Q4 / Year-end appeal / Drafts' if w else 'US Team Files', 'link': 'https://docs.google.com/x', 'hint': '',
                                                                      'passages': [{'text': LONG_TEXT[:300] if w else 'Fall schedule', 'loc': 'p. 12847', 'sheet': 'Benachrichtigungseinstellungen', 'cell': {'value': '12345678.9', 'header': 'Lifetime giving, all years', 'ref': 'AZ12847'}}]} for i in range(5 if w else 1)], 'more': []},
         {'type': 'sources', 'items': [{'label': ('Operations Manual, ' + TITLES_WORST[0]) if w else 'Operations Manual', 'href': '/help/'}, {'label': 'KPI', 'href': '/dashboard/'}]}],
    ]
    return sets[k % 3]


def turn(mode, n):
    w = W(mode)
    return {'n': n, 'question': [(LONG_TEXT[:600] + ' ' + URL_LONG) if w else 'Who are the top partners this year?', 'k', 'Benachrichtigungseinstellungen' * 6 if w else 'And by team?'][n % 3], 'at': stamp(60 - n), 'ref': 'r%d' % n,
            'answer': {'asked_as': 'x', 'intent': 'list', 'outcome': 'ok', 'blocks': blocks(mode, n),
                       'reading': [{'label': 'Year', 'value': '2026', 'key': 'year', 'options': ['2025', '2026']}, {'label': 'Team', 'value': 'Regional Development Directors, Southeast and Gulf Coast' if w else 'Everyone', 'key': 'team'}], 'reading_text': '',
                       'follow': ['Compared with last year', LONG_TEXT[:160] if w else 'By team', 'Only first gifts'], 'lists': [{'token': 'tok1'}]}}


@route('GET', r'^/api/brain/history$')
def history(mode, m, q, state):
    n = {'demo': 5, 'worst': 40, 'empty': 0, 'one': 1, 'huge': 200}[mode]
    w = W(mode)
    return {'ok': True, 'threads': [{'id': 'c_%04d' % i, 'title': ((pick(TITLES_WORST, i) or '')[:80] if w else ['Top partners this year', 'Receipts left', 'Fall list'][i % 3]), 'pinned': 1 if i < (3 if w else 0) else 0, 'made_at': stamp(i * 3000), 'changed_at': stamp(i * 3000 if i % 4 else i * 300000), 'pending': 1 if w and i == 4 else 0} for i in range(n)]}


@route('GET', r'^/api/brain/thread/([a-z0-9_]+)$')
def thread(mode, m, q, state):
    n = {'demo': 2, 'worst': 3, 'empty': 0, 'one': 1, 'huge': 3}[mode]
    return {'ok': True, 'thread': {'id': m.group(1), 'title': TITLES_WORST[0][:80] if W(mode) else 'Top partners this year', 'pinned': 0, 'made_at': stamp(90), 'changed_at': stamp(1)}, 'turns': [turn(mode, i) for i in range(n)]}


@route('GET', r'^/api/brain/me$')
def brain_me(mode, m, q, state):
    return {'ok': True, 'email': 'jane@example.org', 'role': 'Leadership', 'admin': True, 'packages': [{'key': 'basics', 'label': 'Basics', 'covers': 'x', 'has': True, 'until': None, 'requestable': False}], 'requests': [], 'recent': [], 'calls': 12847, 'feedback': [], 'connected_since': stamp(9000)}


@route('GET', r'^/api/brain/prefs$')
def prefs(mode, m, q, state):
    return {'ok': True, 'seen': ['connect_seen'], 'prompt': False}


@route('GET', r'^/api/brain/connector$')
def connector(mode, m, q, state):
    return {'ok': True, 'connected': True}


@route('POST', r'^/api/brain/ask$')
def ask(mode, m, q, state):
    t = turn(mode if mode != 'empty' else 'demo', 0)
    return dict(t['answer'], ok=True, ref='r0', conv='c_0000', turn=1)


@route('POST', r'^/api/brain/list/read$')
def list_read(mode, m, q, state):
    n = 1000 if W(mode) else 8
    return {'ok': True, 'lists': [{'rows': table(mode, n, 40 if W(mode) else 6)['rows'], 'more': False}]}
