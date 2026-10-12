"""Work Center and Work Overview: the board, Asks, My partners, Entry, Thank-yous, Gifts to thank, letters."""
from fixtures import route
from fx_shell import me, ACCESS, counts
from atoms import (PEOPLE_WORST, PEOPLE_KIND, ORGS_WORST, ORGS_KIND, PLACES_WORST, PLACES_KIND, ADDRESSES_WORST, TITLES_WORST, LONG_TEXT, URL_LONG,
                   FUNDS, AMOUNTS_WORST, AMOUNTS_KIND, STAFF, EMAILS_WORST, stamp, day, pick)

NAMES_W = [x for x in PEOPLE_WORST if x] + ORGS_WORST
TYPES = ['Follow Up - New Gift', 'RDD Action', 'Phone Call', 'Reserved (Grant Report) quarterly narrative and financials', 'Task/Other', 'No type']


def n_for(mode, demo, worst, huge=1000):
    return {'demo': demo, 'worst': worst, 'empty': 0, 'one': 1, 'huge': huge}[mode]


def name(mode, i):
    return pick(PEOPLE_KIND + ORGS_KIND, i) if mode in ('demo',) else ('Jo' if mode == 'one' else pick(NAMES_W, i))


def place(mode, i):
    return pick(PLACES_KIND, i) if mode == 'demo' else ('' if mode == 'one' else pick(PLACES_WORST, i))


def amount(mode, i):
    return pick(AMOUNTS_KIND, i) if mode == 'demo' else (1 if mode == 'one' else pick(AMOUNTS_WORST, i))


def people(mode):
    if mode == 'demo':
        return {'101': {'n': 'Mark Ellis', 'team': 'RDD', 'active': 1, 'left': None, 'listed': 1}, '102': {'n': 'Ruth Bell', 'team': 'Partner Care', 'active': 1, 'left': None, 'listed': 1},
                '103': {'n': 'Tom Hale', 'team': 'Church Engagement', 'active': 1, 'left': None, 'listed': 1}}
    out = {}
    for i, (sid, nm, team) in enumerate(STAFF):
        out[str(101 + i)] = {'n': nm, 'team': team, 'active': 0 if i in (2, 5) else 1, 'left': day(-40) if i == 2 else None, 'listed': 1}
    return out


def fids(mode):
    return list(people(mode).keys())


ME = {'role': 'admin', 'label': 'Admin', 'fid': None, 'team': '', 'all': True, 'canDelete': True, 'canMove': True, 'canEntry': True, 'canGifts': True, 'anyTeam': True, 'fids': [], 'canPartnerEdit': True}


def board_row(mode, i):
    f = fids(mode)
    if mode == 'demo':
        return {'id': str(9000 + i), 'due': day(i % 9 - 3), 'added': day(-20 - i), 'type': pick(TYPES, i % 3), 'typeRaw': '', 'category': ['Phone Call', 'Email', 'Task/Other'][i % 3],
                'summary': ['Thank for the fall gift', 'Quarterly check-in', 'Send the annual report', 'Schedule a visit'][i % 4], 'description': '', 'cid': str(5000 + i), 'lookup': str(100 + i),
                'partner': name(mode, i), 'place': place(mode, i), 'fundraisers': [pick(f, i)], 'holders': [pick(f, i)], 'gift': {'id': str(i), 'amount': amount(mode, i), 'date': day(-5), 'fund': 'Where Needed Most'} if i % 3 == 0 else None,
                'later': None, 'group': None, 'deceased': False, 'ty': i % 3 == 0, 'ctg': False, 'priority': 'Normal', 'tags': [], 'pending': None}
    due = [-1062, 0, 1, -1, 400, -7, -61, -130, -366, 3][i % 10]
    return {'id': str(9000 + i), 'due': day(due), 'added': day(-1300 + i), 'type': pick(TYPES, i), 'typeRaw': 'RESERVED (' + pick(TYPES, i) + ')', 'category': ['Task/Other', 'Phone Call', 'Email', 'Meeting', 'Mailing'][i % 5],
            'summary': [LONG_TEXT[:255], '', URL_LONG, 'Call', 'Benachrichtigungseinstellungen', '<b>Report</b> &amp; **budget**'][i % 6],
            'description': [LONG_TEXT[:300], '', 'Report due quarter 4'][i % 3], 'cid': str(5000 + i), 'lookup': ['10542', '7', '1284773'][i % 3],
            'partner': name(mode, i), 'place': place(mode, i),
            'fundraisers': [[], [f[0]], [f[0], f[2], f[4]], ['99999'], [f[5]]][i % 5] if mode != 'one' else [f[0]],
            'holders': [f[0], f[1], f[2]] if i % 4 == 0 else [f[1]],
            'gift': {'id': str(i), 'amount': amount(mode, i), 'date': day(-i), 'fund': pick(FUNDS, i)} if i % 2 == 0 else None,
            'later': {'id': str(7000 + i), 'date': day(-2), 'summary': [LONG_TEXT[:90], '', 'Thanked by phone'][i % 3], 'category': 'Phone Call', 'by': [f[0], f[1]], 'strength': ['thanked', 'likely'][i % 2]} if i % 3 == 0 else None,
            'group': [str(9000 + i), str(9001 + i), str(9002 + i)] if i % 7 == 0 else None, 'deceased': i % 9 == 4, 'ty': i % 2 == 0, 'ctg': i % 5 == 0, 'priority': 'High' if i % 6 == 0 else 'Normal',
            'tags': [[], ['Amount of Ask: $1,250,000.00'], ['customer-feedback-from-enterprise-onboarding', 'Stewardship', 'Scheduling', 'Thanked', 'Texted', 'Major partner', 'Year-end', 'Q4', 'urgent', 'needs-review', 'design', 'frontend']][i % 3],
            'pending': {'state': 'queued', 'label': 'Reassign, goes tonight after 8:00 PM'} if i % 11 == 5 else ({'state': 'saving'} if i % 11 == 6 else None), 'reopened': i % 13 == 2}


@route('GET', r'^/api/work/board$')
def board(mode, m, q, state):
    n = n_for(mode, 24, 60, 3000)
    rows = [board_row(mode, i) for i in range(n)]
    big = mode in ('worst', 'huge')
    cnt = {'mine': 0, 'open': n, 'past': n // 2, 'ty': n // 2, 'done': 51, 'ctg': 4} if not big else {'mine': 12847, 'open': 12847, 'past': 12001, 'ty': 1284, 'done': 100, 'ctg': 99}
    f = fids(mode)
    return {'ok': True, 'synced': stamp(4), 'today': day(), 'meter': {'used': 2847 if big else 120, 'cap': 3000, 'lane': 2400, 'resets': '8:00 PM'}, 'counts': cnt,
            'facets': {'fr': [{'id': x, 'name': people(mode)[x]['n'], 'n': 5, 'live': True} for x in f], 'noOwner': 10, 'type': [{'v': t, 'n': 12847 if big else 4} for t in TYPES], 'cat': [{'v': 'Email', 'n': 8}]},
            'lanes': [], 'people': people(mode), 'me': ME, 'orphans': 0, 'total': 12847 if big else n, 'rows': rows}


@route('GET', r'^/api/work/recent$')
def recent(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'batches': []}
    n = n_for(mode, 3, 12, 60)
    out = []
    for i in range(n):
        w = mode not in ('demo', 'one')
        out.append({'id': 'b%d' % i, 'op': 'reassign', 'label': ('Reassigned 12,847 actions from ' + pick(NAMES_W, i) + ' to ' + pick(NAMES_W, i + 1)) if w and i % 2 == 0 else 'Reassigned 1 action',
                    'actor': pick(NAMES_W, i) if w else 'Mark Ellis', 'at': stamp(i * 300), 'n': 12847 if w else 1, 'posted': 12000 if w else 1, 'failed': 847 if w and i % 3 == 0 else 0, 'queued': 0, 'tonight': 0, 'calls': 2, 'planned': 4,
                    'undo_until': stamp(-600), 'undone': i % 5 == 4, 'undoing': False, 'state': ['done', 'running', 'failed', 'queued'][i % 4] if w else 'done', 'run_when': 'now',
                    'items': [{'id': str(9000 + j), 'name': name(mode, j), 'what': pick(TITLES_WORST, j) if w else 'Call', 'state': ['posted', 'failed', 'queued'][j % 3] if w else 'posted'} for j in range(12 if w else 1)]})
    return {'ok': True, 'batches': out}


@route('GET', r'^/api/work/codes$')
def codes(mode, m, q, state):
    f = fids(mode)
    return {'ok': True, 'codes': {'types': TYPES, 'statuses': ['Open', 'Completed'], 'locations': ['Residence', 'Office'], 'tagCategories': [{'name': 'Amount of Ask', 'type': 'Number'}, {'name': 'Stewardship', 'type': 'Text'}],
                                  'noteTypes': ['Note (general)'], 'oppStatuses': ['Abandoned', 'Awarded - Closed', 'Application submitted, waiting on the board'], 'oppPurposes': ['Engagement', 'Grant Request'], 'partnerNoteTypes': ['Note (general)'], 'at': stamp(900), 'source': 'blackbaud'},
            'me': {'fid': None, 'type': None, 'name': None}, 'types': {x: 'RDD Action' for x in f}, 'today': day()}


@route('GET', r'^/api/work/partner-add/options$')
def add_options(mode, m, q, state):
    return {'ok': True, 'can': True, 'titles': ['Mr.', 'Mrs.', 'Dr.'], 'suffixes': [' II', ' III'], 'phoneTypes': ['Home Phone', 'Mobile'], 'typeCodes': ['Church', 'Individual'], 'relations': ['Parent', 'Spouse'], 'contactRoles': ['Employee'],
            'holders': [{'fid': x, 'name': people(mode)[x]['n'], 'team': 'rdd'} for x in fids(mode)]}


@route('GET', r'^/api/work/views$')
def views(mode, m, q, state):
    if mode in ('worst', 'huge'):
        return {'ok': True, 'views': [{'id': 'v%d' % i, 'name': pick(TITLES_WORST, i) or 'Untitled', 'state': {}} for i in range(12)]}
    return {'ok': True, 'views': []}


@route('GET', r'^/api/work/views/default$')
def views_default(mode, m, q, state):
    return {'ok': True, 'start': {'pref': None, 'role': 'admin', 'defaultTab': 'open', 'scopes': ['mine', 'partners', 'all']}}


@route('GET', r'^/api/work/mail$')
def mail(mode, m, q, state):
    return {'ok': True, 'email': me(mode)['email'], 'name': me(mode)['name'], 'prefs': {'sections': {'gifts': True, 'due': True, 'quiet': True, 'reminders': True}, 'send_time': '7:30', 'skip_empty': True},
            'sections': [{'key': 'gifts', 'label': 'Gifts to thank'}, {'key': 'due', 'label': 'Due today and overdue'}, {'key': 'quiet', 'label': 'Quiet partners'}, {'key': 'reminders', 'label': 'Reminders'}], 'group': None, 'live': False, 'from': None, 'groupLabel': ''}


@route('GET', r'^/api/work/(settings|staff)$')
def settings(mode, m, q, state):
    return {'ok': True, 'settings': {}, 'staff': []}


@route('GET', r'^/api/work/opps$')
def opps(mode, m, q, state):
    n = n_for(mode, 8, 40, 1000)
    w = mode in ('worst', 'huge')
    rows = [{'id': str(1500 + i), 'cid': str(5000 + i), 'name': (pick(TITLES_WORST, i) or 'Untitled') if w else 'Fall proposal', 'status': ['Awarded - Closed', 'Application submitted, waiting on the board', 'Abandoned', ''][i % 4] if w else 'Awarded - Closed',
             'purpose': 'Grant Request', 'ask': amount(mode, i) if w else 5000, 'askDate': day(-30), 'expected': 12345678.9 if w and i % 3 == 0 else 0, 'expectedDate': '', 'funded': 1250000 if w and i % 2 else 0, 'fundedDate': day(-3), 'deadline': day(20) if i % 2 else '',
             'inactive': False, 'fundraisers': [], 'summary': LONG_TEXT[:200] if w else '', 'gifts': [], 'modified': stamp(900), 'added': stamp(90000)} for i in range(n)]
    return {'ok': True, 'rows': rows, 'names': {str(5000 + i): name(mode, i) for i in range(n)}}


@route('GET', r'^/api/work/entry$')
def entry(mode, m, q, state):
    f = fids(mode)
    w = mode in ('worst', 'huge')
    owners = [{'fid': x, 'name': people(mode)[x]['n'], 'type': 'RDD Action', 'tab': '', 'sub': 3, 'inBB': 1, 'wait': 12847 if w and i == 0 else (1 if mode == 'one' else 2), 'late': 1 if i % 2 else 0, 'in': 1, 'all': n_for(mode, 6, 24, 1000) if i == 0 else 0} for i, x in enumerate(f)]
    n = n_for(mode, 6, 24, 1000)
    rows, partners = [], {}
    for i in range(n):
        cid = str(5000 + i) if i % 4 != 3 else ''
        cands = [str(6000 + i), str(6001 + i), str(6002 + i)] if (w and i % 4 == 3 and i % 8 == 3) else []
        st = ['', '', 'posted', 'in_blackbaud', 'failed', 'skipped', 'posting', ''][i % 8] if w else ''
        rows.append({'id': 'e%d' % i, 'owner': f[0], 'source': ['sheet', 'paste', 'many', 'typed'][i % 4], 'date': day(-i % 9), 'wk': 'this' if i % 3 else 'last', 'name': name(mode, i), 'org': '', 'isNew': 'Y' if i % 5 == 0 else '', 'row': i + 2,
                     'how': ['email', 'phone', 'name', 'name_portfolio', 'picked'][i % 5], 'cid': cid, 'cands': cands, 'ch': ['call', '', 'email', 'meet'][i % 4] if w else 'call', 'act': 'Left a long voicemail and then sent a follow-up text and an email with the report' if w else '',
                     'sum': [LONG_TEXT[:255], '', 'Call', URL_LONG[:255]][i % 4] if w else 'Thanked for the fall gift', 'notes': [LONG_TEXT, '', 'ok'][i % 3] if w else 'Glad to hear from us',
                     'tags': [['thanked', 'texted', 'stewardship', 'scheduling'], [], ['thanked']][i % 3], 'ask': ['1250000.00', '', '25'][i % 3] if w else '', 'state': st, 'ticked': False,
                     'dup': {'added': day(-3), 'same': i % 2 == 0} if st == 'in_blackbaud' else None, 'posted': {'at': stamp(100), 'by': pick(NAMES_W, i)} if st == 'posted' else None,
                     'email': pick(EMAILS_WORST, i) or '', 'phone': '', 'emailV': '', 'phoneV': '', 'addr': ''})
        if cid:
            partners[cid] = {'n': name(mode, i), 'loc': place(mode, i), 'lk': str(100 + i), 'hold': [f[0]], 'dec': False}
        for c in cands:
            partners[c] = {'n': pick(NAMES_W, int(c)), 'loc': pick(PLACES_WORST, int(c)), 'lk': c, 'hold': [f[1]], 'dec': False}
    wk = {'sub': n, 'inBB': 1 if mode == 'one' else n // 3, 'wait': n, 'late': n // 4, 'in': n // 3, 'all': n}
    return {'ok': True, 'owners': owners if mode != 'empty' else owners[:1], 'owner': f[0], 'deadline': {'iso': stamp(-1200), 'label': 'Monday at 3:00 PM', 'from': day(-6), 'to': day()},
            'week': wk, 'bb': {'this': 1 if mode == 'one' else (12847 if w else 4), 'last': 3, 'lastByMon3': 3}, 'rows': rows, 'partners': partners}


@route('GET', r'^/api/work/hqty$')
def hqty(mode, m, q, state):
    n = n_for(mode, 8, 30, 1000)
    w = mode in ('worst', 'huge')
    rows = []
    for i in range(n):
        st = ['write', 'printed', 'signed', 'mailed', 'cannot'][i % 5] if mode != 'one' else 'write'
        rows.append({'key': str(66000 + i), 'giftId': str(66000 + i), 'cid': str(5000 + i), 'amount': [1250000.00, 5000, 12345678.9, 7500.5][i % 4] if w else (5000 if mode == 'one' else 7500), 'date': day(-i * 3), 'month': day(-i * 3)[:7], 'type': 'Donation',
                     'pay': ['Card', 'Donor-advised fund, wire through the community foundation', 'Check'][i % 3] if w else 'Check', 'fund': pick(FUNDS, i) if w else 'Where Needed Most',
                     'partner': {'name': name(mode, i), 'place': place(mode, i)}, 'through': pick(ORGS_WORST, i) if w and i % 3 == 1 else None, 'address': (pick(ADDRESSES_WORST, i).replace('\n', ', ') if w else '12 Oak St, Tampa, FL 33606'),
                     'flags': [[], ['First gift'], ['Do not mail', 'Deceased', 'Address abroad', 'No partner credited']][i % 3] if w else [], 'state': st, 'source': 'blackbaud' if i % 2 else '', 'stateDate': day(-1) if st != 'write' else '',
                     'actionId': '119186' if st == 'mailed' and i % 2 else '', 'why': 'The mailing address is abroad and the partner asked for email only until the spring' if st == 'cannot' else '',
                     'signer': 'rdd' if i % 2 else '', 'signerName': pick(NAMES_W, i) if w else 'Mark Ellis', 'signerTitle': 'Regional Development Director', 'rdd': pick(NAMES_W, i) if w else 'Mark Ellis', 'picked': False})
    stats = {'write': 12847, 'printed': 100, 'signed': 99, 'mailedMonth': 1, 'earlier': 1284, 'total': 12847, 'leftOff': 0} if w else {'write': n, 'printed': 0, 'signed': 0, 'mailedMonth': 0, 'earlier': 0, 'total': n, 'leftOff': 0}
    return {'ok': True, 'today': day(), 'synced': stamp(4), 'since': day(-280), 'rows': rows, 'stats': stats, 'whys': ['Asked not to be thanked', 'No address', 'Thanked in person', 'Other'],
            'text': {'month': day()[:7], 'body': 'Thank you for your gift.', 'saved': False, 'defaultBody': 'Thank you for your gift.'}, 'months': {},
            'signers': [{'key': 'terry', 'label': 'Bartholomew Fitzgerald-Montgomery, Executive Director' if w else 'Ann Price'}, {'key': 'rdd', 'label': 'The RDD'}]}


@route('GET', r'^/api/work/gifts$')
def gifts(mode, m, q, state):
    n = n_for(mode, 8, 30, 1000)
    w = mode in ('worst', 'huge')
    f = fids(mode)
    rows = []
    for i in range(n):
        rows.append({'key': '%d:%d' % (65000 + i, 5000 + i), 'giftId': str(65000 + i), 'cid': str(5000 + i), 'amount': amount(mode, i), 'date': day(-i % 30), 'added': stamp(i * 600), 'ageDays': [0, 1, 2, 21, 1284][i % 5] if w else (1 if mode == 'one' else i % 4),
                     'hours': [2, 30, 510][i % 3], 'type': 'RecurringGiftPayment' if i % 2 else 'Donation', 'pay': ['Monthly, card', 'Stock transfer through the brokerage (Schwab Charitable), see the comment', ''][i % 3] if w else 'Card',
                     'fund': pick(FUNDS, i) if w else 'Where Needed Most', 'comment': LONG_TEXT[:200] if w else '', 'soft': {'giverId': '77', 'giver': pick(ORGS_WORST, i)} if w and i % 3 == 0 else None,
                     'partner': {'name': name(mode, i), 'kind': 'Individual', 'place': place(mode, i), 'lifetime': [12345678.9, 26.03, 0][i % 3] if w else 1200, 'count': [1284, 1, 2][i % 3] if w else (1 if mode == 'one' else 4),
                                 'lastContact': day(-30) if i % 2 else None, 'phone': '+44 (0) 20 7946 0958 ext. 12847' if w and i % 3 == 0 else ('(813) 555-0100' if i % 3 == 1 else None), 'doNotCall': i % 7 == 3, 'deceased': False},
                     'badges': [['First gift'], ['Largest gift yet', '$1,000 and up', 'Soft credit', 'First gift'], []][i % 3] if w else (['First gift'] if i == 0 else []),
                     'owners': [f[0], f[1]] if i % 2 else [f[0]], 'team': 'pc', 'taskIds': ['1'] if i % 4 == 0 else [], 'thanked': None, 'left': {'date': day(-1), 'by': pick(NAMES_W, i)} if w and i % 5 == 1 else None,
                     'ownerNames': [people(mode)[f[0]]['n'], people(mode)[f[1]]['n']] if i % 2 else [people(mode)[f[0]]['n']]})
    stats = {'owed': 12847, 'over24': 1284, 'first': 100, 'big': 99, 'week': 1} if w else {'owed': n, 'over24': n // 2, 'first': min(n, 1), 'big': 0, 'week': n}
    return {'ok': True, 'today': day(), 'synced': stamp(4), 'days': 21, 'owner': '', 'everyone': 12847 if w else n, 'owners': [{'id': x, 'name': people(mode)[x]['n'], 'n': 12847 if w else 3} for x in f], 'rows': rows, 'stats': stats, 'shelf': [],
            'weekStart': day(-6), 'lastWorkday': day(-2)}


@route('GET', r'^/api/work/asks$')
def asks(mode, m, q, state):
    st = q.get('state', 'open')
    total = n_for(mode, 6, 30, 1000)
    w = mode in ('worst', 'huge')
    off, lim = int(q.get('offset', 0)), int(q.get('limit', 50))
    per = {'open': total, 'closing': total // 3, 'past': total // 4, 'gave': total // 5}
    if mode == 'one':
        per = {'open': 1, 'closing': 0, 'past': 0, 'gave': 0}
    f = fids(mode)
    rows = []
    for i in range(off, min(per.get(st, 0), off + lim)):
        rows.append({'id': str(125000 + i), 'cid': str(5000 + i), 'name': name(mode, i), 'place': place(mode, i), 'amount': amount(mode, i) if not (w and i == 0) else 1250000.0, 'date': day(-i), 'ageDays': [5, 1, 0, 1284][i % 4] if w else (1 if mode == 'one' else 5 + i),
                     'line': [LONG_TEXT[:160], '', URL_LONG, 'Asked at lunch'][i % 4] if w else 'Asked for the fall project', 'owners': [f[0], f[1], f[2]] if w and i % 2 else [f[0]], 'former': w and i % 5 == 2,
                     'close': {'date': day([10, -40, 400][i % 3]), 'by': pick(NAMES_W, i)} if (st != 'open' or i % 3 == 0) else None, 'state': st,
                     'gave': {'amount': 1250000.0 if w else 500, 'date': day(-2), 'giftId': '1'} if st == 'gave' else None, 'tags': 1, 'first': day(-i - 400 if w else -i), 'review': w and i % 6 == 1,
                     'ownerNames': [people(mode)[x]['n'] for x in ([f[0], f[1], f[2]] if w and i % 2 else [f[0]])]})
    big = lambda k: {'n': 12847 if w else per[k], 'total': 12345678.9 if w else per[k] * 500}
    cols = {k: big(k) for k in per}
    return {'ok': True, 'today': day(), 'synced': stamp(4), 'days': 365, 'range': '12m', 'owner': '', 'status': 'open', 'state': st, 'q': '', 'matched': per.get(st, 0), 'shown': total, 'counts': cols, 'offset': off, 'limit': lim, 'everyone': 12847 if w else total,
            'owners': [{'id': x, 'name': people(mode)[x]['n'], 'n': 12847 if w else 3} for x in f], 'rows': rows, 'stats': {'open': cols['open'], 'soon': cols['closing'], 'past': cols['past'], 'gave': cols['gave']}, 'columns': cols,
            'former': {'n': 100 if w else 0, 'total': 926834}, 'total': 1234567890.12 if w else 9000, 'review': {'n': 1 if mode == 'one' else (99 if w else 0), 'total': 60108500}}


@route('GET', r'^/api/work/portfolio$')
def portfolio(mode, m, q, state):
    n = n_for(mode, 12, 40, 1000)
    w = mode in ('worst', 'huge')
    f = fids(mode)
    rows = []
    for i in range(n):
        rows.append({'cid': str(5000 + i), 'lookup': str(80 + i), 'name': name(mode, i), 'place': place(mode, i), 'quiet': [1284, 1, None, 0, 68][i % 5] if w else (1 if mode == 'one' else 30 + i),
                     'last': {'date': day(-68), 'how': ['Visit', 'Email and a handwritten card with the annual report', 'Call'][i % 3] if w else 'Call'} if i % 5 != 2 else None,
                     'gift': {'date': day(-30), 'amount': amount(mode, i), 'soft': w and i % 4 == 1} if i % 6 != 5 else None, 'l12': [12345678.9, 0, 63020][i % 3] if w else 1200, 'p12': [0, 39000.03, 12345678.9][i % 3] if w else 900,
                     'life': [123456789.01, 104520.08, 0][i % 3] if w else 5200, 'gifts': [1284, 1, 0][i % 3] if w else (1 if mode == 'one' else 12), 'ytd': 56020, 'lastYear': 40500.02,
                     'next': {'id': '1', 'due': day(3), 'summary': [LONG_TEXT[:120], '👩🏽‍💻 Send the year-end report and call 👩🏽‍💻', 'Call'][i % 3] if w else 'Call', 'planned': i % 2 == 0} if i % 3 != 1 else None,
                     'phone': ['+44 (0) 20 7946 0958 ext. 12847', None, '(813) 555-0100'][i % 3], 'dnc': i % 7 == 3})
    held = 12847 if w else n
    return {'ok': True, 'directors': [{'fid': x, 'name': people(mode)[x]['n'], 'email': 'x@example.org', 'team': 'rdd'} for x in f], 'owner': f[0],
            'portfolio': {'fid': f[0], 'today': day(), 'held': held, 'rows': rows, 'stats': {'held': held, 'quiet90': 12001 if w else n // 2, 'gaveNoContact': 1 if mode == 'one' else 49, 'lapsed': 100 if w else 2, 'noPhone': 1284 if w else 3}}, 'at': stamp(1)}


@route('GET', r'^/api/work/cadence$')
def cadence(mode, m, q, state):
    n = n_for(mode, 6, 24, 1000)
    w = mode in ('worst', 'huge')
    f = fids(mode)
    def row(i):
        return {'cid': str(5000 + i), 'name': name(mode, i), 'kind': 'Individual', 'place': place(mode, i), 'rule': ['annual', 'monthly', 'first'][i % 3], 'ruleLabel': ['Annual partner', 'Monthly partner', 'First gift'][i % 3],
                'pattern': '$1,250,000 each August since 1998, by wire' if w else '$50 a month since 2024', 'line': LONG_TEXT[:200] if w else 'Gives each month', 'last': {'date': day(-90), 'what': 'Email and card'} if i % 2 else None,
                'due': day(-360 if w else -3), 'over': 1284 if w else 3, 'holders': [f[0]], 'holderNames': [people(mode)[f[0]]['n']], 'phone': '(309) 555-0100' if i % 2 else None,
                'steps': [{'k': 'call', 'label': 'Call', 'state': 'next', 'off': None}, {'k': 'card', 'label': 'Card', 'state': 'wait', 'off': None}], 'need': 'all', 'blocked': False}
    rows = [row(i) for i in range(n)]
    return {'ok': True, 'today': day(), 'synced': stamp(4), 'owner': '', 'me': None, 'owners': [{'id': f[0], 'name': people(mode)[f[0]]['n'], 'n': n}], 'everyone': n, 'unreachable': 198 if w else 0, 'rows': rows,
            'stats': {'due': 12847 if w else n, 'first': 32, 'repeat': 322, 'quarterly': 40, 'week': 0}, 'lists': {'friday': rows[:8], 'saturday': rows[:8], 'sunday': rows[:8]}, 'weekStart': day(-6)}


@route('GET', r'^/api/work/partners$')
def partner_search(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'rows': []}
    n = n_for(mode, 5, 10, 10)
    return {'ok': True, 'rows': [{'cid': str(5000 + i), 'name': name(mode, i), 'place': place(mode, i), 'lookup': str(100 + i), 'holders': [], 'deceased': mode != 'demo' and i % 4 == 1} for i in range(n)]}


@route('GET', r'^/api/work/(week|week-report|goals|prep).*$')
def misc(mode, m, q, state):
    return {'ok': True}


# ------------------------------------------------------------------ Work Overview
@route('GET', r'^/api/hub/home$')
def home(mode, m, q, state):
    w = mode in ('worst', 'huge')
    f = fids(mode)
    n = n_for(mode, 5, 8, 8)
    due_rows = [{'id': str(1700 + i), 'cid': str(5000 + i), 'partner': name(mode, i), 'place': place(mode, i), 'due': day(-[1062, 0, 1, 70, 130][i % 5] if w else -i), 'late': [1062, 0, 1, 70, 130][i % 5] if w else i,
                 'type': 'No type' if i % 2 else 'Phone Call', 'summary': [LONG_TEXT[:90], '', URL_LONG[:90]][i % 3] if w else 'Quarterly check-in'} for i in range(n)]
    gift_rows = [{'giftId': str(65000 + i), 'cid': str(5000 + i), 'name': name(mode, i), 'place': place(mode, i), 'amount': amount(mode, i), 'date': day(-i), 'age': [21, 0, 1, 1284][i % 4] if w else i, 'fund': pick(FUNDS, i) if w else 'Where Needed Most',
                  'phone': '(850) 555-0100', 'team': 'dir', 'tasks': 0, 'badges': ['First gift', 'Largest gift yet'] if w and i % 2 else [], 'owner': pick(NAMES_W, i) if w else 'Mark Ellis'} for i in range(min(n, 5))]
    big = 12847 if w else (1 if mode == 'one' else n)
    waiting = [{'kind': ['meeting', 'request', 'expense'][i % 3], 'title': (pick(TITLES_WORST, i) or 'Untitled')[:80] if w else 'Send the notes', 'sub': ("From " + pick(NAMES_W, i) + "'s meeting")[:40] if w else "From Monday's meeting", 'at': stamp(i * 4000) if i % 2 else '', 'href': '/meet/library/'} for i in range(n)]
    mine = [{'kind': 'request', 'title': (pick(TITLES_WORST, i) or 'Untitled')[:80] if w else 'New laptop', 'status': 'Waiting on the Executive Director' if w and i % 2 else 'Approved', 'href': '/requests/'} for i in range(min(n, 6))]
    act = [{'at': stamp(i * 500), 'app': 'Requests', 'text': [LONG_TEXT[:300], URL_LONG, 'Done: x'][i % 3] if w else 'Done: Website fix'} for i in range(n)]
    team = [{'fid': x, 'name': people(mode)[x]['n'], 'team': people(mode)[x]['team'], 'open': 12847 if w and i == 0 else 7, 'overdue': 12001 if w and i == 0 else 1, 'ty': 1284 if w else 0} for i, x in enumerate(f)]
    work = {'today': day(), 'synced': stamp(4), 'role': 'admin', 'fid': None,
            'due': {'scope': 'portfolio', 'fr': '', 'mine': 0, 'open': big, 'total': big, 'overdue': 12001 if w else n // 2, 'today': 1 if mode == 'one' else 4, 'rows': due_rows},
            'gifts': {'total': big, 'over24': 1284 if w else n // 2, 'first': 1 if mode == 'one' else 20, 'week': 1 if mode == 'one' else 95, 'rows': gift_rows},
            'week': {'kind': 'admin', 'entry': {'owners': [{'fid': x, 'name': people(mode)[x]['n'], 'wait': 12847 if w and i == 0 else 3 + i, 'late': 1284 if w and i == 1 else (1 if i % 2 else 0)} for i, x in enumerate(f)], 'wait': 1284773 if w else 12, 'late': 12847 if w else 1}, 'sending': 1 if mode == 'one' else (12847 if w else 0)},
            'team': {'people': team, 'total': len(team), 'all': {'open': big, 'overdue': 12001 if w else 3, 'ty': 1284 if w else 2}},
            'recent': [{'id': 'b%d' % i, 'label': ('Reassigned 12,847 actions from ' + pick(NAMES_W, i)) if w else 'Reassigned 1 action', 'actor': pick(NAMES_W, i) if w else 'Mark Ellis', 'at': stamp(i * 300), 'n': 1, 'posted': 1, 'failed': 847 if w and i == 0 else 0, 'queued': 0} for i in range(min(n, 4))], 'at': stamp(0)}
    if mode == 'empty':
        work['due']['rows'] = []; work['gifts']['rows'] = []; work['team'] = {'people': [], 'total': 0, 'all': {'open': 0, 'overdue': 0, 'ty': 0}}; work['recent'] = []
        work['due'].update(open=0, total=0, overdue=0, today=0); work['gifts'].update(total=0, over24=0, first=0, week=0); work['week']['entry'] = {'owners': [], 'wait': 0, 'late': 0}
    return {'ok': True, 'at': stamp(0), 'name': me(mode)['name'], 'email': me(mode)['email'], 'access': ACCESS, 'counts': counts(mode, state),
            'waiting': {'rows': waiting, 'totals': {'requests': 1 if mode == 'one' else (100 if w else 2), 'expenses': 99 if w else 0, 'meetings': 12847 if w else len(waiting)}}, 'mine': mine, 'activity': act, 'work': work}


@route('GET', r'^/api/hub/home-drill$')
def home_drill(mode, m, q, state):
    return {'ok': True, 'kind': 'actions', 'today': day(), 'rows': [], 'total': 0, 'scope': 'portfolio'}


@route('GET', r'^/api/work/(declines|giftimages|grants)$')
def new_lanes(mode, m, q, state):
    # Tabs added on main after this harness was written. They get an empty, well-formed answer until someone
    # writes a worst case for them.
    return {'ok': True, 'rows': [], 'stats': {}, 'owners': [], 'today': day(), 'synced': stamp(4)}
