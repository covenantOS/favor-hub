"""Today: the Needs you cards, your requests, recent activity, the year against goal, and Your day."""
from fixtures import route
from fx_shell import me, ACCESS, counts
from atoms import PEOPLE_WORST, PEOPLE_KIND, ORGS_WORST, TITLES_WORST, LONG_TEXT, URL_LONG, FILES_WORST, EMAILS_WORST, stamp, day, at, pick


def card(i, n, what, note, warn=False, amount=None, label=None, cta=None):
    ids = ['requests', 'expenses', 'receipts', 'brain', 'meetings', 'feedback', 'foundations']
    labels = ['Requests', 'Expenses', 'Thank-you receipts', 'Favor Brain', 'Meetings', 'Feedback', 'Foundations']
    c = {'id': ids[i % 7], 'label': label or labels[i % 7], 'n': n, 'what': what, 'note': note, 'warn': warn, 'href': '/help/', 'cta': cta or 'Open'}
    if amount is not None:
        c['amount'] = amount
    return c


@route('GET', r'^/api/hub/today$')
def today(mode, m, q, state):
    base = {'ok': True, 'user': me(mode), 'access': ACCESS}
    if mode == 'empty':
        return dict(base, cards=[], mine=[], activity=[])
    if mode == 'demo':
        return dict(base, cards=[card(0, 3, 'new requests to review', 'Oldest 2 days'), card(1, 2, 'expense reports to approve', '', amount=418.2), card(2, 12, 'gifts to thank', 'Since Monday')],
                    mine=[{'title': 'New laptop', 'status': 'Approved', 'href': '/requests/'}, {'title': 'Fix the giving form', 'status': 'In progress', 'href': '/requests/'}],
                    activity=[{'at': stamp(30 + i * 400), 'app': ['Requests', 'Receipts', 'Meetings', 'Expenses'][i % 4], 'text': ['Done: Website fix', 'Printed 40 thank-you letters', 'Notes ready: Staff meeting', 'Approved: Travel'][i % 4]} for i in range(6)])
    if mode == 'one':
        return dict(base, cards=[card(0, 1, 'new requests to review', '1 past due', warn=True, amount=1)], mine=[{'title': 'J', 'status': 'Done', 'href': '/requests/'}],
                    activity=[{'at': stamp(0), 'app': 'Requests', 'text': 'Done: x'}])
    n = 7 if mode == 'worst' else 7
    cards = [
        card(0, 12847, 'requests in the inbox waiting for someone to approve, estimate, assign or decline before the end of the quarter', 'Oldest has been waiting 1,284 days, past due', warn=True),
        card(1, 100, 'expense reports', 'Past due', amount=12345678.9),
        card(2, 1, 'gifts', '', amount=-250),
        card(3, 0, 'Benachrichtigungseinstellungen', URL_LONG, label='Favor Brain access requests and connector approvals'),
        card(4, 99, 'meetings live now', 'Invitation expired 12 days ago'),
        card(5, 1000000, 'notes', '<b>new</b> &amp; unread', warn=True, amount=0.30000000000000004),
        card(6, 8, 'foundations with a contact waiting to post', 'overdue'),
    ]
    mine = [{'title': pick(TITLES_WORST, i), 'status': ['In progress', 'Approved', 'Declined', 'Waiting on the Executive Director to approve the estimate', 'Done'][i % 5], 'href': '/requests/'} for i in range(8 if mode == 'worst' else 300)]
    act = [{'at': stamp(i * 173), 'app': ['Requests', 'Receipts', 'Meetings', 'Expenses', 'Brain', 'Foundations', 'Unknown app'][i % 7],
            'text': ['Done: ' + pick(TITLES_WORST, 0), URL_LONG, 'Posted 1 contact for ' + pick(ORGS_WORST, i), 'x', LONG_TEXT[:500], '<img src=x onerror=alert(1)>', 'Uploaded ' + pick(FILES_WORST, i)][i % 7]}
           for i in range(40 if mode == 'worst' else 1000)]
    return dict(base, cards=cards[:n], mine=mine, activity=act)


@route('GET', r'^/api/hub/kpi$')
def kpi(mode, m, q, state):
    if mode == 'demo':
        s = {'asOf': day(), 'lastUpdated': stamp(20), 'raised': 9536717.72, 'goal': 13000000, 'raisedLastYear': 7101148.88,
             'teams': [{'key': 'rdd', 'name': 'RDD team', 'amount': 4276571.2, 'goal': 4852055, 'measure': 'raised'}, {'key': 'pc', 'name': 'Partner Care', 'amount': 1510000, 'goal': 2000000, 'measure': 'raised'},
                       {'key': 'ce', 'name': 'Church Engagement', 'amount': 910000, 'goal': 1200000, 'measure': 'raised'}, {'key': 'gr', 'name': 'Grants', 'amount': 800000, 'goal': 1500000, 'measure': 'awarded'}]}
    elif mode == 'empty':
        s = {'asOf': day(), 'lastUpdated': stamp(20), 'raised': 0, 'goal': 0, 'raisedLastYear': 0, 'teams': []}
    elif mode == 'one':
        s = {'asOf': day(), 'lastUpdated': stamp(0), 'raised': 1, 'goal': 1, 'raisedLastYear': 1, 'teams': [{'key': 'rdd', 'name': 'R', 'amount': 1, 'goal': 1, 'measure': 'raised'}]}
    else:
        s = {'asOf': day(), 'lastUpdated': stamp(20), 'raised': 1234567890.12, 'goal': 999999999, 'raisedLastYear': 1284.5,
             'teams': [{'key': 'rdd', 'name': 'Regional Development Directors, Southeast and Gulf Coast', 'amount': 123456789.01, 'goal': 100000000, 'measure': 'raised'},
                       {'key': 'pc', 'name': 'PC', 'amount': 0, 'goal': 0, 'measure': 'raised'},
                       {'key': 'ce', 'name': 'Church Engagement', 'amount': -42.5, 'goal': 1200000, 'measure': 'raised'},
                       {'key': 'gr', 'name': 'Grants and Foundations', 'amount': 999999.99, 'goal': 700000, 'measure': 'awarded'},
                       {'key': 'mk', 'name': 'Benachrichtigungseinstellungen', 'amount': None, 'goal': None, 'measure': 'raised'}]}
    return {'ok': True, 'summary': s}


@route('GET', r'^/api/hub/day$')
def hub_day(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'blackbaud': {'linked': True, 'actions': [], 'total': 0, 'overdue': 0}, 'google': {'connected': True, 'events': [], 'mail': [], 'files': [], 'partners': {}}}
    if mode == 'demo':
        acts = [{'id': str(700 + i), 'due': day(i - 1), 'type': 'Phone Call', 'category': 'Phone Call', 'summary': ['Thank for the fall gift', 'Quarterly check-in', 'Send the report'][i % 3], 'cid': str(5000 + i), 'partner': pick(PEOPLE_KIND, i)} for i in range(4)]
        ev = [{'title': 'Staff meeting', 'start': at(0, 9), 'end': at(0, 10), 'provider': 'favor', 'meet': '/meet/', 'link': '/meet/', 'people': []},
              {'title': 'Budget review', 'start': at(0, 14), 'end': at(0, 15), 'provider': 'zoom', 'link': 'https://example.com/z', 'people': []}]
        mail = [{'from': pick(PEOPLE_KIND, i), 'fromEmail': 'p%d@example.com' % i, 'subject': ['Re: fall visit', 'Thank you', 'Question about my receipt'][i % 3], 'link': 'https://example.com/m', 'date': stamp(40 * i + 5)} for i in range(3)]
        return {'ok': True, 'blackbaud': {'linked': True, 'actions': acts, 'total': 4, 'overdue': 1},
                'google': {'connected': True, 'events': ev, 'mail': mail, 'files': [{'name': 'Fall plan', 'by': 'Mark Ellis', 'modified': stamp(200), 'link': 'https://example.com/f'}], 'partners': {}}}
    if mode == 'one':
        return {'ok': True, 'blackbaud': {'linked': True, 'actions': [{'id': '700', 'due': day(-1), 'type': 'Call', 'category': 'Call', 'summary': '', 'cid': '5000', 'partner': 'Jo'}], 'total': 2, 'overdue': 1},
                'google': {'connected': True, 'events': [{'title': '1:1', 'start': stamp(10), 'end': stamp(-50), 'provider': 'favor', 'meet': '/meet/', 'people': []}],
                           'mail': [{'from': 'J', 'fromEmail': 'a@b.co', 'subject': '', 'link': 'https://example.com/m', 'date': stamp(1)}], 'files': [{'name': 'a.txt', 'by': 'J', 'modified': stamp(0), 'link': 'https://example.com'}], 'partners': {}}}
    n = 12 if mode == 'worst' else 1000
    acts = [{'id': str(700 + i), 'due': day([-1062, 0, 1, -1, 400][i % 5]), 'type': 'Follow Up - New Gift', 'category': 'Task/Other',
             'summary': [LONG_TEXT[:260], '', URL_LONG, 'Call', 'Benachrichtigungseinstellungen'][i % 5], 'cid': str(5000 + i), 'partner': pick(PEOPLE_WORST + ORGS_WORST, i)} for i in range(n)]
    partners = {pick(EMAILS_WORST, 0): {'name': pick(PEOPLE_WORST, 0)}, 'a@b.co': {'name': 'Jo'}}
    ev = []
    for i in range(8):
        ev.append({'title': pick(TITLES_WORST, i), 'start': stamp(20) if i == 1 else at(0, 9, i * 5), 'end': stamp(-180) if i == 1 else at(0, 12, i), 'allDay': i == 4,
                   'provider': ['favor', 'zoom', 'meet', 'teams', 'webex', 'other'][i % 6], 'meet': '/meet/', 'link': 'https://example.com/z',
                   'people': [pick(EMAILS_WORST, 0), 'a@b.co'] if i % 2 == 0 else []})
    mail = [{'from': pick(PEOPLE_WORST, i) or pick(EMAILS_WORST, 0), 'fromEmail': [pick(EMAILS_WORST, 0), 'a@b.co', 'x@example.com'][i % 3], 'subject': [pick(TITLES_WORST, 0), '', URL_LONG, 'Re: Re: Fwd: RE: ' + pick(FILES_WORST, 0)][i % 4],
             'link': 'https://example.com/m', 'date': stamp(i * 700) if i % 5 else None} for i in range(12)]
    files = [{'name': pick(FILES_WORST, i), 'by': pick(PEOPLE_WORST, i), 'modified': stamp(i * 3000), 'link': 'https://example.com/f'} for i in range(6)]
    return {'ok': True, 'blackbaud': {'linked': True, 'actions': acts, 'total': 12847, 'overdue': 1284},
            'google': {'connected': True, 'events': ev, 'mail': mail, 'files': files, 'partners': partners}}
