"""Meetings: the day view, the notes library, and one meeting's notes page."""
from fixtures import route
from atoms import PEOPLE_WORST, PEOPLE_KIND, TITLES_WORST, TITLES_KIND, LONG_TEXT, URL_LONG, STAFF, EMAILS_WORST, FILES_WORST, stamp, day, at, pick

W = lambda mode: mode in ('worst', 'huge')
NAMES_W = [x for x in PEOPLE_WORST if x]


def meeting(i, title, start=None, end=None, status='scheduled', mode='demo', **kw):
    w = W(mode)
    inv = [{'email': 'x%d@example.org' % j, 'name': (pick(PEOPLE_WORST, j) if w else pick(PEOPLE_KIND, j)), 'team': '', 'guest': j % 3 == 0} for j in range(kw.pop('people', 3))]
    mt = {'id': '%024x' % (i + 1), 'title': title, 'agenda': LONG_TEXT[:300] if w else '', 'hostEmail': 'host%d@example.org' % (i % 5), 'hostName': (pick(PEOPLE_WORST, i) if w else 'Jane Cooper'), 'startsAt': start, 'endsAt': end, 'durationMin': 60,
          'rec': 'notes', 'access': 'staff', 'status': status, 'locked': False, 'spot': '', 'sharePolicy': 'all', 'repeat': 'none', 'backupLink': '', 'invitees': inv, 'mine': i % 2 == 0, 'recState': 'stored', 'driveFileId': 'd', 'notesStatus': 'ready',
          'summary': '', 'createdAt': stamp(9000), 'startedAt': None, 'endedAt': None, 'seriesId': '', 'inRoom': 0, 'actionCount': 0}
    mt.update(kw)
    return mt


def upcoming(mode):
    if mode == 'empty':
        return []
    if mode == 'demo':
        return [meeting(0, 'Staff meeting', at(0, 9), at(0, 10)), meeting(1, 'Budget review', at(0, 14), at(0, 15)), meeting(2, 'Partner care sync', at(1, 11), at(1, 11, 30))]
    if mode == 'one':
        return [meeting(0, '1:1', at(0, 10), at(0, 10, 30), people=0)]
    out = []
    # Eight meetings inside one hour, a three-hour block with a long title, a live room, one that crosses midnight, one before 8 AM.
    for i in range(8):
        out.append(meeting(i, pick(TITLES_WORST, i) or '', at(0, 10, i * 5), at(0, 10, 30 + i * 5), mode=mode, people=[0, 1, 30, 200, 2, 5, 0, 12][i]))
    out.append(meeting(8, TITLES_WORST[0], at(0, 13), at(0, 16), mode=mode, people=40))
    out.append(meeting(9, 'Prayer call, open room', None, None, status='live', mode=mode, inRoom=1, startedAt=stamp(75), people=0))
    out.append(meeting(10, 'Late call with the field team in East Africa and South Asia', at(0, 23, 30), at(1, 1, 30), mode=mode, people=8))
    out.append(meeting(11, 'Early', at(0, 6, 15), at(0, 6, 30), mode=mode, people=1))
    out.append(meeting(12, 'Board', at(0, 15), at(0, 15, 5), status='live', mode=mode, inRoom=12847, startedAt=stamp(3), people=3))
    if mode == 'huge':
        for i in range(13, 80):
            out.append(meeting(i, pick(TITLES_WORST, i) or 'Meeting', at(i % 7, 8 + i % 9, (i * 7) % 60), at(i % 7, 9 + i % 9, (i * 7) % 60), mode=mode, people=i % 9))
    return out


def notes_list(mode):
    if mode == 'empty':
        return []
    if mode == 'demo':
        return [meeting(20 + i, pick(TITLES_KIND, i), None, None, status='ended', startedAt=stamp(600 + i * 1500), endedAt=stamp(560 + i * 1500), summary='We agreed the fall schedule and who calls which partners.', actionCount=[3, 0, 1][i % 3]) for i in range(5)]
    if mode == 'one':
        return [meeting(20, 'k', None, None, status='ended', startedAt=stamp(70), endedAt=stamp(60), summary='', actionCount=1, people=0)]
    n = 30 if mode == 'worst' else 100
    out = []
    for i in range(n):
        out.append(meeting(20 + i, [pick(TITLES_WORST, i), 'Stiftung-Internationale-Bibelgesellschaft-Donaudampfschifffahrtsgemeinschaft-Rechtsschutzversicherung', ''][i % 3] or 'Meeting', None, None, status='ended', mode=mode,
                           startedAt=stamp(600 + i * 1500) if i % 7 != 3 else None, endedAt=stamp(420 + i * 1500) if i % 7 != 3 else None,
                           summary=[LONG_TEXT[:1600], '', URL_LONG + URL_LONG, 'Short.'][i % 4], actionCount=[40, 0, 1, 12][i % 4], notesStatus=['ready', 'pending', 'failed', 'none'][i % 4], recState=['stored', 'none'][i % 2], people=[0, 1, 200][i % 3]))
    return out


@route('GET', r'^/api/meet/meetings$')
def meetings(mode, m, q, state):
    scope = q.get('scope', 'upcoming')
    if scope == 'upcoming':
        return {'ok': True, 'meetings': upcoming(mode)}
    return {'ok': True, 'meetings': notes_list(mode)}


@route('GET', r'^/api/meet/meetings/calendar$')
def calendar(mode, m, q, state):
    if mode in ('empty', 'one'):
        return {'ok': True, 'connected': True, 'canWrite': True, 'meetings': []}
    w = W(mode)
    ms = [{'eventId': 'ev%d' % i, 'title': ((pick(TITLES_WORST, i + 3) or '(No title)') if w else 'Prayer call'), 'startsAt': at(0, 10 if w else 11, 10 + i * 10), 'endsAt': at(0, 11 if w else 12, i * 10), 'provider': ['zoom', 'meet', 'teams', 'webex', 'other'][i % 5], 'joinUrl': URL_LONG,
           'people': [{'email': 'p%d@example.org' % j, 'name': pick(PEOPLE_WORST, j) or 'caroleward'} for j in range(30 if w else 3)], 'organizer': False, 'internal': False, 'canSwitch': i % 2 == 0, 'needsConsent': False} for i in range(3 if w else 1)]
    return {'ok': True, 'connected': True, 'canWrite': True, 'meetings': ms}


@route('GET', r'^/api/meet/meetings/directory$')
def directory(mode, m, q, state):
    w = W(mode)
    ppl = [{'email': 'host%d@example.org' % i, 'name': (STAFF[i % 7][1] if w else pick(PEOPLE_KIND, i)), 'title': STAFF[i % 7][2], 'team': ['Development (RDD)', 'Partner Care and Church Engagement, Southeast and Gulf Coast region', 'Ops', ''][i % 4] if w else 'Development'} for i in range(300 if mode == 'huge' else 28)]
    return {'ok': True, 'people': ppl}


@route('GET', r'^/api/meet/meetings/actions$')
def my_actions(mode, m, q, state):
    n = {'demo': 3, 'worst': 40, 'empty': 0, 'one': 1, 'huge': 60}[mode]
    w = W(mode)
    return {'ok': True, 'actions': [{'meeting_id': '%024x' % (21 + i), 'idx': i, 'text': [LONG_TEXT[:300], 'Call', URL_LONG, pick(TITLES_WORST, i) or 'x'][i % 4] if w else 'Send the fall list', 'due': ['soon', '', 'Friday, before the board packet goes out to the committee', 'Oct 15'][i % 4] if w else 'Friday',
                                     't': [0, 4503, 10][i % 3], 'done': i % 5 == 4, 'title': (pick(TITLES_WORST, i) or 'Meeting') if w else 'Staff meeting', 'started_at': stamp(i * 3000)} for i in range(n)]}


@route('GET', r'^/api/meet/meetings/([0-9a-f]{24})/notes$')
def notes(mode, m, q, state):
    w = W(mode)
    n_act = {'demo': 4, 'worst': 40, 'empty': 0, 'one': 1, 'huge': 40}[mode]
    title = TITLES_WORST[0] if w else ('k' if mode == 'one' else 'Staff meeting')
    mt = meeting(0, title, None, None, status='ended', mode=mode, startedAt=stamp(260 if w else 65), endedAt=stamp(75 if w else 20), summary=(LONG_TEXT[:1500] + ' ' + URL_LONG)[:1600] if w else ('' if mode == 'empty' else 'We agreed the fall schedule.'))
    actions = [{'idx': i, 'text': [LONG_TEXT[:300], 'Call', URL_LONG, 'Send the report'][i % 4] if w else 'Send the fall list',
                'owner_name': ['', pick(NAMES_W, i)[:80], '', 'Jo'][i % 4] if w else ('' if mode == 'one' else 'Mark Ellis'), 'owner_email': '', 'due': ['Friday', '', '', 'Friday, before the board packet goes out to the committee'][i % 4] if w else 'Friday', 't': [0, 4503, 10][i % 3], 'done': i % 5 == 4} for i in range(n_act)]
    lines = {'demo': 20, 'worst': 300, 'empty': 0, 'one': 1, 'huge': 3000}[mode]
    return {'ok': True, 'meeting': mt,
            'notes': {'title': title, 'summary': mt['summary'], 'decisions': [{'t': [4503, 0, 61][i % 3], 'text': [LONG_TEXT[:300], URL_LONG, 'Ship it.'][i % 3] if w else 'Mail the letters Friday.'} for i in range(8 if w else (0 if mode == 'empty' else 2))], 'actions': [],
                      'chapters': [{'t': i * 600, 'title': (pick(TITLES_WORST, i) or 'Untitled')[:80] if w else 'Opening'} for i in range(10 if w else (0 if mode == 'empty' else 2))]},
            'transcript': [{'t': i * 9, 'who': pick(NAMES_W, i)[:80] if w else 'Mark Ellis', 'text': [LONG_TEXT[:600], 'ok', URL_LONG, 'Tom & Ann said <yes> to "the plan"'][i % 4] if w else 'Good morning everyone.'} for i in range(lines)],
            'files': [{'id': 'f%d' % i, 'name': pick(FILES_WORST, i)[:80] if w else 'Staff meeting.webm', 'kind': 'audio', 'src': '/api/broken/a', 'url': 'https://drive.google.com/x'} for i in range(3 if w else (0 if mode == 'empty' else 1))],
            'doc': {'id': 'd', 'url': 'https://docs.google.com/x'} if mode != 'empty' else None, 'actions': actions,
            'people': [{'email': 'x%d@example.org' % i, 'name': pick(PEOPLE_WORST, i) if w else pick(PEOPLE_KIND, i)} for i in range({'demo': 4, 'worst': 30, 'empty': 0, 'one': 1, 'huge': 200}[mode])],
            'asked': [{'t': 60, 'by': pick(NAMES_W, i)[:80], 'q': (LONG_TEXT[:200])} for i in range(20)] if w else []}


@route('GET', r'^/api/meet/meetings/([0-9a-f]{24})$')
def one(mode, m, q, state):
    return {'ok': True, 'meeting': meeting(0, TITLES_WORST[0] if W(mode) else 'Staff meeting', at(0, 10), at(0, 11), mode=mode), 'present': 0, 'people': []}


@route('POST', r'^/api/meet/meetings(/[0-9a-f]{24})?/pump$')
def pump(mode, m, q, state):
    return {'ok': True, 'done': True, 'state': 'ready', 'progress': 1}
