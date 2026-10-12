"""Chat: channel list, members, messages, reactions, files, threads, search."""
from fixtures import route, svg
from atoms import PEOPLE_WORST, PEOPLE_KIND, TITLES_WORST, LONG_TEXT, URL_LONG, STAFF, EMAILS_WORST, FILES_WORST, stamp, pick

W = lambda mode: mode in ('worst', 'huge')
EMOJI = ['👍', '❤️', '🎉', '🙏', '😂', '👀', '✅', '🔥', '👏', '💯', '😮', '😢', '🙌', '🤔', '👌', '🚀', '⭐', '☕', '📌', '🎯']


def users(mode):
    if not W(mode):
        ppl = {('u%d@example.org' % i): {'id': 'u%d@example.org' % i, 'name': pick(PEOPLE_KIND, i), 'picture': '', 'title': '', 'presence': ['online', 'away', 'off'][i % 3]} for i in range(1 if mode == 'one' else 8)}
    else:
        ppl = {}
        for i in range(30 if mode == 'worst' else 300):
            nm = pick(PEOPLE_WORST, i)
            ppl['u%d@example.org' % i] = {'id': 'u%d@example.org' % i, 'name': nm if nm != '' else '', 'picture': ['', '/api/broken/avatar-%d.jpg' % i, '/api/chat/file/pano'][i % 3] if i % 5 == 1 or i % 5 == 2 else '', 'title': '', 'presence': ['online', 'away', 'off'][i % 3]}
    return ppl


def channels(mode):
    us = list(users(mode).keys())
    if mode == 'empty':
        return [{'id': 'ch_general', 'kind': 'public', 'name': 'general', 'topic': '', 'created_by': us[0], 'created_at': stamp(90000), 'last_at': stamp(900), 'muted': False, 'last_read': 0, 'unread': 0, 'mentions': 0, 'members': us[:1], 'joined': True}]
    if mode == 'one':
        return [{'id': 'ch_general', 'kind': 'public', 'name': 'a', 'topic': '', 'created_by': us[0], 'created_at': stamp(90000), 'last_at': stamp(9), 'muted': False, 'last_read': 0, 'unread': 1, 'mentions': 1, 'members': us[:1], 'joined': True}]
    if mode == 'demo':
        return [{'id': 'ch_' + n, 'kind': k, 'name': n, 'topic': t, 'created_by': us[0], 'created_at': stamp(90000), 'last_at': stamp(30 * (i + 1)), 'muted': False, 'last_read': 0, 'unread': 1 if i == 1 else 0, 'mentions': 1 if i == 1 else 0, 'members': us[:5], 'joined': True}
                for i, (n, k, t) in enumerate([('general', 'public', 'Company-wide'), ('development', 'public', 'RDD team'), ('receipts', 'private', ''), ('Mark Ellis', 'dm', ''), ('Ruth, Tom', 'group', '')])]
    out = []
    n = 60 if mode == 'worst' else 300
    for i in range(n):
        kind = ['public', 'private', 'dm', 'group', 'public'][i % 5]
        nm = {'public': ['year-end-appeal-planning-and-major-partner', 'a', 'benachrichtigungseinstellungen-rechtsschutz', 'general'][i % 4], 'private': 'board-finance-committee-confidential-2026',
              'dm': pick(PEOPLE_WORST, i), 'group': ', '.join((pick(PEOPLE_WORST, i + j) or 'J').split(' ')[0] for j in range(8))}[kind]
        out.append({'id': 'ch_general' if i == 0 else 'ch_%d' % i, 'kind': 'public' if i == 0 else kind, 'name': 'general' if i == 0 else nm, 'topic': [LONG_TEXT[:200], '', URL_LONG][i % 3], 'created_by': us[i % len(us)], 'created_at': stamp(90000), 'last_at': stamp(i * 13),
                    'muted': i % 6 == 4, 'last_read': 0, 'unread': [0, 12847, 1, 100][i % 4], 'mentions': [0, 12847, 1, 100, 99][i % 5], 'members': us if i % 2 == 0 else us[: 1 + i % 9], 'joined': True})
    return out


def msg(i, user, body, mode='worst', **kw):
    mt = {'id': 1000 + i, 'channel_id': 'ch_general', 'thread_id': None, 'user_id': user, 'body': body, 'created_at': stamp(4000 - i * 7), 'edited_at': None, 'deleted': False, 'reactions': [], 'attachments': [], 'brain': None, 'reply_count': 0, 'last_reply_at': None, 'reply_users': [], 'visible_to': None}
    mt.update(kw)
    return mt


def file_att(i, name, mime, size, **kw):
    return dict({'type': 'file', 'id': 'f%d' % i, 'name': name, 'mime': mime, 'size': size, 'url': '/api/chat/file/f%d' % i}, **kw)


CODE = '```\nSELECT c.lookup_id, c.name, SUM(g.amount) AS lifetime FROM gifts g JOIN constituents c ON c.id = g.constituent_id WHERE g.date >= \'2026-01-01\' AND g.amount > 1000000 GROUP BY c.lookup_id, c.name HAVING SUM(g.amount) > 1250000.00 ORDER BY lifetime DESC LIMIT 1000;\n```'


def messages(mode, cid='ch_general'):
    us = list(users(mode).keys())
    if mode == 'empty':
        return []
    if mode == 'one':
        return [msg(0, us[0], 'k', mode, reply_count=1, last_reply_at=stamp(1), reply_users=[us[0]], reactions=[{'emoji': '👍', 'users': [us[0]]}])]
    if mode == 'demo':
        return [msg(i, us[i % 4], ['Morning all.', 'The fall list is ready for review.', 'Thanks, looking now.', 'Can we move the 2:00 to 2:30?', 'Yes, works for me.'][i % 5], mode,
                    reactions=[{'emoji': '👍', 'users': us[:2]}] if i == 1 else [], reply_count=2 if i == 3 else 0, last_reply_at=stamp(20) if i == 3 else None, reply_users=us[:2] if i == 3 else []) for i in range(8)]
    out = []
    u = lambda i: us[i % len(us)]
    out.append(msg(0, u(0), 'See ' + URL_LONG + ' and write to ' + EMAILS_WORST[0] + ' or ops@sub.department.region.example.co.uk before Friday (https://en.wikipedia.org/wiki/Favor_(disambiguation)).'))
    out.append(msg(1, u(1), CODE + '\nand inline `SELECT_ALL_THE_THINGS_FROM_A_VERY_LONG_TABLE_NAME_WITHOUT_ANY_SPACES_AT_ALL_IN_IT_whatsoever_really` here'))
    out.append(msg(2, u(2), (LONG_TEXT * 5)[:4000]))
    out.append(msg(3, u(3), 'Reactions', reactions=[{'emoji': e, 'users': [u(j + k) for j in range(10 + (1274 if k == 0 else 0) if k < 1 else 10)]} for k, e in enumerate(EMOJI)]))
    out.append(msg(4, u(4), 'Files', attachments=[file_att(1, FILES_WORST[0], 'application/pdf', 26214400), file_att(2, FILES_WORST[1], 'image/heic', 0), file_att(3, FILES_WORST[2], 'application/vnd.ms-powerpoint', 1048576),
                                                  file_att(4, 'pano.png', 'image/png', 1023, w=4000, h=200), file_att(5, 'tall.png', 'image/png', 99, w=200, h=4000), file_att(6, '', 'application/octet-stream', 5)]))
    out.append(msg(5, u(5), 'Thread', reply_count=300, last_reply_at=stamp(2), reply_users=[u(1), u(2), u(3)]))
    out.append(msg(6, u(6), '', attachments=[{'type': 'link', 'url': URL_LONG, 'host': 'example.com', 'title': '', 'desc': LONG_TEXT[:220]},
                                             {'type': 'clip', 'id': '%032x' % 1, 'title': TITLES_WORST[0][:120], 'summary': LONG_TEXT[:400], 'duration': 9876, 'by': PEOPLE_WORST[0], 'when': 'Oct 9', 'thumb': '/api/clips/%032x/poster' % 2, 'url': '/c/%032x' % 1},
                                             {'type': 'meeting', 'id': '%024x' % 1, 'title': TITLES_WORST[0], 'status': 'live', 'count': 1, 'url': '/meet/room/?m=1', 'notes': False, 'notes_url': '', 'duration': 0},
                                             {'type': 'meeting', 'id': '%024x' % 2, 'title': 'Sync', 'status': 'ended', 'count': 12847, 'url': '', 'notes': True, 'notes_url': '/meet/notes/?m=2', 'duration': 12847},
                                             {'type': 'drive', 'name': FILES_WORST[4], 'kind': 'sheet', 'path': 'US Team Files / Development / Regional Directors / 2026 / Q4 / Year-end appeal / Drafts / ' + PEOPLE_WORST[0], 'indexed': 'Oct 9', 'url': 'https://docs.google.com/x'}]))
    out.append(msg(7, 'u9999@example.org', 'From someone who left the directory', edited_at=stamp(1)))
    out.append(msg(8, u(8), 'deleted', deleted=True))
    out.append(msg(9, 'brain', 'Here is the list.', brain={'blocks': [{'type': 'text', 'md': 'Top partners **this year**:\n\n| Partner | Lifetime | City |\n|---|---|---|\n| ' + PEOPLE_WORST[0] + ' | $12,345,678.90 | ' + 'São Mamede de Infesta' + ' |\n| Jo | $1 | |'}], 'follow': ['Compared with last year & the year before <b>', LONG_TEXT[:160]]}))
    out.append(msg(10, u(10), '<@' + u(1) + '> <@all> <#ch_5> **bold** _em_ <script>alert(1)</script> &amp; 👩🏽‍💻'))
    out.append(msg(11, u(13), 'Benachrichtigungseinstellungen' * 12))
    n = 60 if mode == 'worst' else 1000
    for i in range(12, n):
        out.append(msg(i, u(i), ['ok', 'Thanks', LONG_TEXT[:300], 'See you at 3'][i % 4], reactions=[{'emoji': '👍', 'users': [u(i)]}] if i % 9 == 0 else []))
    return out


@route('GET', r'^/api/chat/boot$')
def boot(mode, m, q, state):
    us = users(mode)
    me_id = list(us.keys())[0]
    return {'ok': True, 'me': us[me_id], 'users': us, 'channels': channels(mode), 'mode': 'admins', 'live': False}


@route('GET', r'^/api/chat/channels/browse$')
def browse(mode, m, q, state):
    return {'ok': True, 'channels': [{'id': c['id'], 'name': c['name'], 'topic': c['topic'], 'member_count': [12847, 1, 0][i % 3] if W(mode) else 5} for i, c in enumerate(channels(mode)) if c['kind'] == 'public']}


@route('GET', r'^/api/chat/channels/([^/]+)/messages$')
def chan_messages(mode, m, q, state):
    ms = messages(mode, m.group(1))
    for x in ms:
        x['channel_id'] = m.group(1)
    if q.get('before'):
        return {'ok': True, 'messages': [], 'more': False}
    return {'ok': True, 'messages': ms[-200:] if mode != 'huge' else ms, 'more': False}


@route('GET', r'^/api/chat/channels/([^/]+)/huddle$')
def huddle(mode, m, q, state):
    if W(mode) and m.group(1) == 'ch_general':
        return {'ok': True, 'huddle': {'id': '%024x' % 9, 'title': TITLES_WORST[0], 'startedAt': 1, 'people': [{'email': 'u%d@example.org' % i, 'name': pick(PEOPLE_WORST, i)} for i in range(30)], 'live': True}}
    return {'ok': True, 'huddle': None}


@route('GET', r'^/api/chat/threads/(\d+)$')
def thread(mode, m, q, state):
    us = list(users(mode).keys())
    root = msg(5, us[0], 'Thread', mode, reply_count=300, last_reply_at=stamp(2), reply_users=us[:3])
    n = {'demo': 2, 'worst': 300, 'empty': 0, 'one': 1, 'huge': 500}[mode]
    reps = [msg(2000 + i, us[i % len(us)], ['ok', URL_LONG, LONG_TEXT[:800], CODE][i % 4] if W(mode) else 'Sounds good.', mode, thread_id=int(m.group(1))) for i in range(n)]
    return {'ok': True, 'root': root, 'replies': reps}


@route('GET', r'^/api/chat/search$')
def search(mode, m, q, state):
    if mode == 'empty':
        return {'ok': True, 'results': []}
    ms = messages(mode)[:20]
    for i, x in enumerate(ms):
        x['channel_name'] = ['year-end-appeal-planning-and-major-partner', 'a', PEOPLE_WORST[0]][i % 3] if W(mode) else 'general'
    return {'ok': True, 'results': ms}


@route('GET', r'^/api/chat/(clips|drive)$')
def pickers(mode, m, q, state):
    return {'ok': True, 'clips': [], 'files': []}


@route('GET', r'^/api/chat/file/(.+)$')
def chat_file(mode, m, q, state):
    k = m.group(1)
    if k in ('f4', 'pano'):
        return svg(4000, 200, 'panorama')
    if k == 'f5':
        return svg(200, 4000, 'tall')
    return (404, 'text/plain', 'gone')


@route('GET', r'^/api/chat/drive-file/.*$')
def drive_thumb(mode, m, q, state):
    return (404, 'text/plain', 'gone')
