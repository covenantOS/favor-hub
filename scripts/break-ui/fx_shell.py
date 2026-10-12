"""The calls every hub page makes: who is signed in, menu counts, the bell, the upcoming-meeting strip."""
from fixtures import route
from atoms import PEOPLE_WORST, TITLES_WORST, LONG_TEXT, URL_LONG, stamp, at, pick

ME_KIND = {'email': 'jane@example.org', 'name': 'Jane Cooper', 'picture': '', 'role': 'admin', 'via': 'google', 'kpi': True}
ME_WORST = {'email': 'bartholomew.fitzgerald@northwind-industries-holdings.example.com', 'name': 'Christopher Alexander Montgomery III', 'picture': '/api/broken/avatar-404.jpg', 'role': 'admin', 'via': 'google', 'kpi': True}
ACCESS = {'admin': True, 'kpi': True, 'approver': True, 'expenseLog': True, 'workCenter': True, 'clips': True, 'meetings': True, 'clipsRecord': True, 'chat': True}


def me(mode):
    return ME_WORST if mode in ('worst', 'huge') else ME_KIND


def counts(mode, state):
    keys = ['inbox', 'expensesWaiting', 'receiptsLeft', 'brainRequests', 'feedback', 'workOpen', 'meetingsNow', 'chatMentions']
    b = state.get('badges')
    if b is not None and str(b).lstrip('-').isdigit():
        return {k: int(b) for k in keys}
    if mode == 'empty':
        return {k: 0 for k in keys}
    if mode == 'one':
        return {k: 1 for k in keys}
    if mode in ('worst', 'huge'):
        return {'inbox': 100, 'expensesWaiting': 99, 'receiptsLeft': 12847, 'brainRequests': 1, 'feedback': 1284, 'workOpen': 12847, 'meetingsNow': 8, 'chatMentions': 100}
    return {'inbox': 3, 'expensesWaiting': 0, 'receiptsLeft': 12, 'brainRequests': 0, 'feedback': 2, 'workOpen': 24, 'meetingsNow': 0, 'chatMentions': 1}


@route('GET', r'^/api/work/gate$')
def gate(mode, m, q, state):
    return {'ok': True, 'open': True, 'admin': True, 'reason': 'open', 'release': 'support', 'name': me(mode)['name']}


@route('GET', r'^/api/hub/nav$')
def nav(mode, m, q, state):
    return {'ok': True, 'user': me(mode), 'access': ACCESS, 'counts': counts(mode, state), 'kpiTeams': ['rdd', 'pc', 'church', 'grants', 'marketing']}


@route('GET', r'^/api/hub/copy-time$')
def copy_time(mode, m, q, state):
    return {'ok': True, 'synced': stamp(4)}


@route('GET', r'^/api/work/reminders$')
def reminders(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'rows': [], 'count': 0, 'now': 0}
    if mode == 'demo':
        rows = [{'id': 'r1', 'kind': 'task', 'ref_id': '9001', 'cid': '5001', 'title': 'Call Jane Cooper', 'note': 'About the fall gift', 'at': stamp(-60), 'bucket': 'today'},
                {'id': 'r2', 'kind': 'task', 'ref_id': '9002', 'cid': '5002', 'title': 'Thank Mark Ellis', 'note': '', 'at': stamp(-1500), 'bucket': 'tomorrow'}]
        return {'ok': True, 'rows': rows, 'count': 2, 'now': 0}
    if mode == 'one':
        return {'ok': True, 'rows': [{'id': 'r1', 'kind': 'task', 'ref_id': '9001', 'cid': '5001', 'title': 'Call Jo', 'note': '', 'at': stamp(0), 'bucket': 'now'}], 'count': 1, 'now': 1}
    n = 40 if mode == 'worst' else 300
    rows = []
    for i in range(n):
        rows.append({'id': f'r{i}', 'kind': 'task' if i % 3 else 'note', 'ref_id': str(9000 + i), 'cid': str(5000 + i) if i % 4 else '',
                     'title': ('Call ' + pick(PEOPLE_WORST, i)) if i % 5 else pick(TITLES_WORST, 0),
                     'note': [LONG_TEXT[:300], '', URL_LONG, 'Before 3'][i % 4], 'at': stamp(-(i * 517) + 30), 'bucket': ['now', 'today', 'tomorrow', 'later'][i % 4]})
    return {'ok': True, 'rows': rows, 'count': 12847 if mode == 'worst' else n, 'now': 7}


@route('GET', r'^/api/chat/inbox$')
def chat_inbox(mode, m, q, state):
    if mode in ('empty',):
        return {'ok': True, 'count': 0, 'items': []}
    mk = lambda i, kind, who, body, ch, ck: {'id': 100 + i, 'channel_id': 'ch_' + str(i), 'channel_name': ch, 'channel_kind': ck, 'thread_id': 7 if kind == 'reply' else None, 'from': 'x%d@example.org' % i, 'from_name': who, 'body': body, 'kind': kind, 'at': stamp(i * 9)}
    if mode == 'demo':
        return {'ok': True, 'count': 1, 'items': [mk(1, 'mention', 'Mark Ellis', 'Can you look at the fall list?', 'general', 'public')]}
    if mode == 'one':
        return {'ok': True, 'count': 1, 'items': [mk(1, 'dm', '', 'k', '', 'dm')]}
    items = [mk(i, ['mention', 'dm', 'reply'][i % 3], pick(PEOPLE_WORST, i), [URL_LONG, LONG_TEXT[:400], 'ok', '<@brain> ' + 'x' * 0 + 'see `SELECT * FROM gifts WHERE amount > 1000000`'][i % 4],
                'year-end-appeal-planning-and-major-partner-calls-2026-q4' if i % 2 else 'a', ['public', 'private', 'dm'][i % 3]) for i in range(20)]
    return {'ok': True, 'count': 12847 if mode == 'worst' else 1000, 'items': items}


@route('GET', r'^/api/clips/unfinished$')
def clips_unfinished(mode, m, q, state):
    if mode in ('empty', 'demo'):
        return {'ok': True, 'clips': []}
    return {'ok': True, 'clips': [{'id': 'c' * 32, 'updatedAt': stamp(600), 'durationMs': 9876543 if mode != 'one' else 1000, 'parts': 1, 'tail': 0}]}


@route('GET', r'^/api/broken/.*$')
def broken(mode, m, q, state):
    return (404, 'text/plain', 'not found')


@route('GET', r'^/api/hub/prefs.*$')
def hub_prefs(mode, m, q, state):
    return {'ok': True, 'prefs': {}}
