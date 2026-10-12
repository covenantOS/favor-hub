"""One partner: the drawer and the full page."""
from fixtures import route
from atoms import PEOPLE_WORST, ORGS_WORST, PLACES_WORST, ADDRESSES_WORST, TITLES_WORST, LONG_TEXT, URL_LONG, FUNDS, EMAILS_WORST, STAFF, stamp, day, pick


def gift(i, amount, fund='Where Needed Most', comment='', soft=False, typ='Donation'):
    return {'id': str(60000 + i), 'amount': amount, 'date': day(-i * 9), 'type': typ, 'fund': fund, 'status': 'Active', 'soft': soft, 'comment': comment}


def demo():
    recent = [gift(i, [100, 250, 100, 500][i % 4]) for i in range(6)]
    return {'id': '5001', 'lookup': '14907', 'name': 'Jane Cooper', 'kind': 'Individual', 'place': 'Tampa, FL', 'deceased': False, 'inactive': False, 'addedOn': '2021-03-04',
            'contact': {'address': {'id': '1', 'lines': '12 Oak St', 'city': 'Tampa', 'state': 'FL', 'zip': '33606', 'country': 'United States', 'doNotMail': False}, 'otherAddresses': 0,
                        'emails': [{'id': '1', 'address': 'jane@example.com', 'primary': True, 'doNotEmail': False}], 'phones': [{'id': '1', 'number': '(813) 555-0100', 'type': 'Mobile', 'primary': True, 'doNotCall': False}]},
            'household': [{'id': '5002', 'name': 'Mark Cooper', 'lookup': '14908', 'relation': 'Spouse'}],
            'giving': {'total': 5200, 'count': 24, 'firstDate': '2021-03-04', 'ytd': 950, 'last12': 1200, 'years': [{'year': str(2026 - i), 'total': 900 + i * 100, 'count': 5, 'soft': 0} for i in range(5)],
                       'largest': recent[3], 'last': recent[0], 'recent': recent, 'soft': {'total': 0, 'count': 0, 'recent': []}},
            'recurring': [{'id': '1', 'amount': 100, 'status': 'Active', 'since': '2024-01-05', 'fund': 'Where Needed Most', 'lastPayment': day(-9), 'lastAmount': 100, 'payments': 20}],
            'actions': {'openCount': 2, 'open': [{'id': '9001', 'due': day(2), 'done': '', 'added': day(-5), 'type': 'Phone Call', 'category': 'Phone Call', 'summary': 'Quarterly check-in', 'description': '', 'direction': '', 'outcome': '', 'open': True, 'fundraisers': [{'fid': '101', 'name': 'Mark Ellis'}]}],
                        'recent': [{'id': '9000', 'due': day(-30), 'done': day(-30), 'added': day(-40), 'type': 'Phone Call', 'category': 'Phone Call', 'summary': 'Thanked for the fall gift', 'description': 'Glad to hear from us.', 'direction': '', 'outcome': 'Reached', 'open': False, 'fundraisers': [{'fid': '101', 'name': 'Mark Ellis'}]}]},
            'notes': [], 'assignments': [{'fid': '101', 'name': 'Mark Ellis', 'type': 'RDD', 'from': '2024-01-01', 'to': '', 'current': True}], 'iwave': {'overall': 7, 'capacityBand': '$25K to $50K', 'capacity': 30000, 'ratedOn': '2026-02-01'},
            'lastContact': None, 'opportunities': [{'id': '1', 'name': 'Fall project', 'ask': 5000, 'expected': 5000, 'funded': 0, 'deadline': day(40), 'expectedDate': '', 'purpose': 'Engagement', 'status': 'Asked'}], 'codes': ['Partner'],
            'flags': {'doNotCall': False, 'doNotEmail': False, 'doNotMail': False}, 'synced': stamp(4), 'card': {}, 'canEdit': True, 'toThank': []}


def worst(huge=False):
    amts = [1250000.00, -250.00, 25, 0.01, 12345678.9, -42.5, 100, 999999.99]
    recent = [gift(i, amts[i % 8], pick(FUNDS, i), ['', 'Donor note: ' + LONG_TEXT[:200], URL_LONG, 'Adjustment, reverses the gift of March 3'][i % 4], typ='RecurringGiftPayment' if i % 3 == 0 else ('Adjustment' if amts[i % 8] < 0 else 'Donation')) for i in range(25)]
    staff = lambda i: {'fid': str(101 + i % 7), 'name': STAFF[i % 7][1]}
    open_ = [{'id': str(9000 + i), 'due': day([-1062, 0, 1, -1, 400, -61][i % 6]), 'done': '', 'added': day(-20), 'type': 'RESERVED (Follow Up - New Gift)', 'category': ['Task/Other', 'Phone Call', 'Email', 'Meeting'][i % 4],
              'summary': [LONG_TEXT[:255], '', URL_LONG, 'Call'][i % 4], 'description': LONG_TEXT[:300], 'direction': '', 'outcome': '', 'open': True, 'fundraisers': [staff(i), staff(i + 1), staff(i + 2)] if i % 2 else []} for i in range(25)]
    done = [{'id': str(8000 + i), 'due': day(-30 - i * 20), 'done': day(-30 - i * 20), 'added': day(-400), 'type': 'Phone Call', 'category': ['Phone Call', 'Email', 'Meeting', 'Task/Other'][i % 4], 'summary': [pick(TITLES_WORST, i), '', URL_LONG][i % 3],
             'description': [LONG_TEXT, '', 'ok'][i % 3], 'direction': '', 'outcome': ['Reached', '', 'Left a voicemail and will try again after the holidays when the family is back'][i % 3], 'open': False, 'fundraisers': [staff(i)]} for i in range(12)]
    years = [{'year': str(2026 - i), 'total': [12345678.9, 0, 1250000, 25, 999999.99, 4, 123456789.01, 100][i % 8], 'count': 5, 'soft': 1250000 if i % 3 == 0 else 0} for i in range(30)]
    return {'id': '5001', 'lookup': '1284773', 'name': PEOPLE_WORST[0], 'kind': 'Individual', 'place': PLACES_WORST[0], 'deceased': True, 'inactive': True, 'addedOn': '1998-01-01',
            'contact': {'address': {'id': '1', 'lines': 'Rua Professor Doutor Abel Salazar 1234, 3.º Esq. Frente', 'city': 'São Mamede de Infesta', 'state': 'Distrito do Porto', 'zip': '4465-012', 'country': 'Portugal', 'doNotMail': True}, 'otherAddresses': 12,
                        'emails': [],
                        'phones': [{'id': str(i), 'number': ['+44 (0) 20 7946 0958 ext. 12847', '(813) 555-0100', '+351 22 555 0100'][i % 3], 'type': ['Home Phone', 'Mobile', 'Business phone, assistant answers before noon'][i % 3], 'primary': i == 0, 'doNotCall': i == 0} for i in range(8)]},
            'household': [{'id': str(5002 + i), 'name': pick(PEOPLE_WORST, i + 1) or 'J', 'lookup': '1', 'relation': ['Spouse', 'Child', 'Head of household', ''][i % 4]} for i in range(9)],
            'giving': {'total': 123456789.01, 'count': 1284 if not huge else 12847, 'firstDate': '1998-01-01', 'ytd': 12345678.9, 'last12': 12345678.9, 'years': years, 'largest': recent[4], 'last': recent[0], 'recent': recent,
                       'soft': {'total': 1250000, 'count': 10, 'recent': [gift(30 + i, 1250000.0, pick(FUNDS, i), soft=True) for i in range(10)]}},
            'recurring': [{'id': str(i), 'amount': [1250000, 25, 0.01][i % 3], 'status': ['Active', 'Terminated', 'Held'][i % 3], 'since': day(-900), 'fund': pick(FUNDS, i), 'lastPayment': day(-9) if i % 2 else '', 'lastAmount': None if i % 2 == 0 else 25, 'payments': 1284} for i in range(12)],
            'actions': {'openCount': 12847, 'open': open_, 'recent': done}, 'notes': [],
            'assignments': [{'fid': str(101 + i % 7), 'name': STAFF[i % 7][1], 'type': STAFF[i % 7][2], 'from': '2020-01-01', 'to': '' if i < 3 else '2025-06-30', 'current': i < 3} for i in range(20)],
            'iwave': {'overall': 10, 'capacityBand': '$5,000,000 to $10,000,000 (very high, verified twice)', 'capacity': 12345678.9, 'ratedOn': '2020-01-01'}, 'lastContact': None,
            'opportunities': [{'id': str(i), 'name': pick(TITLES_WORST, i), 'ask': [1250000, 0, 12345678.9][i % 3], 'expected': 1250000 if i % 2 else 0, 'funded': 12345678.9 if i % 3 == 0 else 0, 'deadline': day(40) if i % 2 else '', 'expectedDate': '',
                               'purpose': 'Grant Request', 'status': ['Application submitted, waiting on the board', '', 'Awarded - Closed', 'Abandoned'][i % 4]} for i in range(20)],
            'codes': ['Partner', 'Major partner', 'Church', 'Board member (emeritus)', 'Foundation trustee', 'Volunteer', 'Prayer team', 'customer-feedback-from-enterprise-onboarding'] * 2,
            'flags': {'doNotCall': True, 'doNotEmail': True, 'doNotMail': True}, 'synced': stamp(4), 'card': {}, 'canEdit': True,
            'toThank': [{'key': '%d:5001' % (65000 + i), 'giftId': str(65000 + i), 'cid': '5001', 'amount': amts[i % 8], 'date': day(-i), 'ageDays': [1284, 1, 0, 2][i % 4], 'fund': ['', pick(FUNDS, 1)][i % 2], 'pay': 'Card', 'left': None, 'ownerNames': [], 'soft': i % 2 == 1, 'taskIds': []} for i in range(4)]}


def one():
    p = demo()
    g = gift(0, 1)
    p.update(name='J', place='', household=[], recurring=[], opportunities=[], codes=[], iwave=None, assignments=[])
    p['contact'] = {'address': None, 'otherAddresses': 0, 'emails': [], 'phones': []}
    p['giving'] = {'total': 1, 'count': 1, 'firstDate': day(), 'ytd': 1, 'last12': 1, 'years': [{'year': day()[:4], 'total': 1, 'count': 1, 'soft': 0}], 'largest': g, 'last': g, 'recent': [g], 'soft': {'total': 0, 'count': 0, 'recent': []}}
    p['actions'] = {'openCount': 1, 'open': [p['actions']['open'][0]], 'recent': []}
    p['actions']['open'][0]['due'] = day(-1)
    p['toThank'] = [{'key': '65000:5001', 'giftId': '65000', 'cid': '5001', 'amount': 1, 'date': day(-1), 'ageDays': 1, 'fund': '', 'pay': '', 'left': None, 'ownerNames': [], 'soft': False, 'taskIds': []}] * 4
    return p


def empty():
    p = one()
    p.update(name='', toThank=[])
    p['giving'] = {'total': 0, 'count': 0, 'firstDate': '', 'ytd': 0, 'last12': 0, 'years': [], 'largest': None, 'last': None, 'recent': [], 'soft': {'total': 0, 'count': 0, 'recent': []}}
    p['actions'] = {'openCount': 0, 'open': [], 'recent': []}
    return p


@route('GET', r'^/api/work/partners/(\d+)$')
def partner(mode, m, q, state):
    p = {'demo': demo, 'worst': worst, 'one': one, 'empty': empty, 'huge': lambda: worst(True)}[mode]()
    p = dict(p, id=m.group(1))
    if mode in ('worst', 'huge') and int(m.group(1)) % 2 == 0:
        # An organization: long legal name, no household, a US address.
        p.update(name=ORGS_WORST[0], kind='Organization', household=[], deceased=False, inactive=False)
    return {'ok': True, 'partner': p}


@route('GET', r'^/api/work/partners/(\d+)/notes$')
def notes(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'rows': []}
    if mode == 'demo':
        return {'ok': True, 'rows': [{'id': 'n1', 'type': 'Note (general)', 'summary': 'Prayer: daughter starting college', 'text': 'Asked us to pray for the move in August.', 'author': 'Mark Ellis', 'date': day(-40)},
                                     {'id': 'n2', 'type': 'Note (general)', 'summary': 'Prefers email', 'text': '', 'author': 'Ruth Bell', 'date': day(-200)}]}
    if mode == 'one':
        return {'ok': True, 'rows': [{'id': 'n1', 'type': '', 'summary': '', 'text': 'k', 'author': '', 'date': day()}]}
    n = 50
    rows = [{'id': 'n%d' % i, 'type': ['Note (general)', 'Reserved Note (Bio and family background from the regional director)', ''][i % 3],
             'summary': ['Instruction: ' + LONG_TEXT[:200], 'Prayer: ' + pick(TITLES_WORST, 0), '', URL_LONG, 'Family: x', 'Giving: prefers the foundation'][i % 6],
             'text': [LONG_TEXT * 2, '', URL_LONG, 'Line one\nLine two\nLine three\nLine four\nLine five'][i % 4], 'author': [STAFF[i % 7][1], ''][i % 2], 'date': day(-i * 31), 'undo': 'u1' if i == 1 else None} for i in range(n)]
    return {'ok': True, 'rows': rows}


@route('GET', r'^/api/work/partners/(\d+)/(contact|record|codes)$')
def record_tabs(mode, m, q, state):
    return {'ok': True, 'contact': {}, 'record': {}, 'codes': []}
