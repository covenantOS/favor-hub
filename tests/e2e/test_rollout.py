"""Clips for every signed-in person: who sees what, who may edit, the storage cap, blocked people. Local dev server with seeded
sessions (see tests/e2e/README in the result file): will (admin), staff1, staff2, blocked."""
import os, json, glob, sqlite3, sys, urllib.request
BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
STATE = os.environ.get('WRANGLER_STATE', r'Q:\work\favor-hub\clips-rollout\.wrangler\state\v3')
TOK = dict(will='tok-will-local', s1='tok-staff1-local', s2='tok-staff2-local', blocked='tok-blocked-local')
res = []


def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(who, method, path, data=None, headers=None):
    h = {}
    if who:
        h['Cookie'] = f'favor_hub_session={TOK[who]}'
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        x = urllib.request.urlopen(r); return x.status, x.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def db():
    f = [x for x in glob.glob(STATE + r'\d1\miniflare-D1DatabaseObject\*.sqlite') if not x.endswith('metadata.sqlite')][0]
    return sqlite3.connect(f)


def js(b):
    return json.loads(b or b'{}')


def make(who, title='t'):
    st, b = api(who, 'POST', '/api/clips', json.dumps({'mime': 'video/webm', 'title': title}).encode(), {'Content-Type': 'application/json'})
    if st != 200:
        return None, st, js(b)
    cid = js(b)['id']
    api(who, 'PUT', f'/api/clips/{cid}/part?n=1', os.urandom(5000), {'x-elapsed': '3'})
    st, _ = api(who, 'POST', f'/api/clips/{cid}/complete', b'{"durationMs":3000}', {'Content-Type': 'application/json'})
    return cid, st, None


# ---- every signed-in person can record, and the clip carries their name
a, st, _ = make('s1', 'Pat clip')
ok('a staff member can start, upload and complete a clip', a and st == 200)
row = db().execute('SELECT owner_name, owner_email FROM hub_clips WHERE id=?', (a,)).fetchone()
ok('the clip holds the presenter name from hub_users, never Agent', row == ('Pat Example', 'staff.one@favorintl.org'), str(row))

# ---- each person sees only their own list
b_, _, _ = make('s2', 'Sam clip')
l1 = js(api('s1', 'GET', '/api/clips')[1]); l2 = js(api('s2', 'GET', '/api/clips')[1])
ok('staff1 sees only their own clip', [c['id'] for c in l1['clips']] == [a], str([c['title'] for c in l1['clips']]))
ok('staff2 sees only their own clip', [c['id'] for c in l2['clips']] == [b_])
lw = js(api('will', 'GET', '/api/clips')[1])
ok('an admin sees only their own clips in the normal view', all(c['mine'] for c in lw['clips']))
st, _ = api('s1', 'GET', '/api/clips?scope=all')
ok('staff cannot open the all-clips view', st == 403, st)
la = js(api('will', 'GET', '/api/clips?scope=all')[1])
ok('the admin view lists every person clips with storage per person', {a, b_} <= {c['id'] for c in la['clips']} and len(la['people']) >= 2, str([p['email'] for p in la['people']]))
ok('the admin view hides screen text and transcripts from its rows', all('transcript' not in c for c in la['clips']))

# ---- edit rights
st, _ = api('s2', 'PATCH', f'/api/clips/{a}', json.dumps({'title': 'hijack'}).encode(), {'Content-Type': 'application/json'})
ok('another staff member cannot rename it', st == 404, st)
st, _ = api('will', 'PATCH', f'/api/clips/{a}', json.dumps({'title': 'hijack'}).encode(), {'Content-Type': 'application/json'})
ok('an admin cannot edit it either', st == 404, st)
st, _ = api('s2', 'DELETE', f'/api/clips/{a}')
ok('another staff member cannot delete it', st == 404, st)
st, _ = api('s1', 'PATCH', f'/api/clips/{a}', json.dumps({'title': 'Pat renamed'}).encode(), {'Content-Type': 'application/json'})
ok('the owner can rename it', st == 200, st)
info = js(api('s2', 'GET', f'/api/clips/{a}/info')[1])
ok('another signed-in person can watch it with the link (signed-in by default)', info.get('ok') and info['can']['edit'] is False and 'seen' not in info, str(info.get('can')))
st, _ = api(None, 'GET', f'/api/clips/{a}/info')
ok('a signed-out person cannot', st == 401, st)
st, _ = api('blocked', 'GET', '/api/clips')
ok('a blocked person gets nothing', st == 401, st)

# ---- anyone-with-link and blocked owners
api('s1', 'PATCH', f'/api/clips/{a}', json.dumps({'share': True}).encode(), {'Content-Type': 'application/json'})
st, _ = api(None, 'GET', f'/api/clips/{a}/info')
ok('anyone-with-link works for a person in good standing', st == 200, st)
c = db(); c.execute("UPDATE hub_users SET blocked=1 WHERE email='staff.one@favorintl.org'"); c.commit()
st, _ = api(None, 'GET', f'/api/clips/{a}/info')
ok('the same link stops for outsiders once its owner is blocked', st == 401, st)
st, _ = api('s2', 'GET', f'/api/clips/{a}/info')
ok('signed-in staff can still open it', st == 200, st)
c.execute("UPDATE hub_users SET blocked=0 WHERE email='staff.one@favorintl.org'"); c.commit()

# ---- storage: 80% warning, the cap
c.execute("UPDATE hub_clips SET size_bytes=? WHERE id=?", (int(8.4 * 1024 ** 3), a)); c.commit()
u = js(api('s1', 'GET', '/api/clips/usage')[1])['usage']
ok('past 80% the usage note appears with the oldest clips nobody watched', u['warn'] and not u['full'] and u['pct'] == 84 and [x['id'] for x in u['oldestUnwatched']] == [a], str(u))
c.execute("UPDATE hub_clips SET size_bytes=? WHERE id=?", (int(10.2 * 1024 ** 3), a)); c.commit()
cid, st, body = make('s1', 'one too many')
ok('at the cap a new recording is refused with a plain message', cid is None and st == 409 and 'all 10 GB' in body['message'], str(body))
cid2, st, _ = make('s2', 'Sam again')
ok('someone else under the cap can still record', cid2 and st == 200)

# ---- admin may delete someone else's clip; everything goes
st, _ = api('will', 'DELETE', f'/api/clips/{a}')
ok('an admin can delete another person clip to free space', st == 200, st)
ok('its rows are gone', db().execute('SELECT COUNT(*) FROM hub_clips WHERE id=?', (a,)).fetchone()[0] == 0)
for x in (b_, cid2):
    api('s2', 'DELETE', f'/api/clips/{x}')
print('RESULT', sum(res), 'pass', len(res) - sum(res), 'fail')
sys.exit(0 if all(res) else 1)
