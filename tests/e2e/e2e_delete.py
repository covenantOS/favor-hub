"""Delete a clip as a signed-in person, from the library and from the watch page, and confirm R2, D1 and comments are gone.
Runs against a local dev server (BASE) with a seeded session (SESSION). Needs the local D1 file for row checks (D1_SQLITE)."""
import os, json, sys, glob, sqlite3, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
HOST = BASE.split('//')[1].split(':')[0]
COOKIE = os.environ.get('SESSION', 'tok-will-local')
STATE = os.environ.get('WRANGLER_STATE', r'Q:\work\favor-hub\clips-rollout\.wrangler\state\v3')
res = []


def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(method, path, data=None, headers=None, cookie=COOKIE):
    h = {'Cookie': f'favor_hub_session={cookie}'}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r); return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def d1_count(sql, args=()):
    for f in glob.glob(STATE + r'\d1\miniflare-D1DatabaseObject\*.sqlite'):
        try:
            c = sqlite3.connect(f)
            n = c.execute(sql, args).fetchone()[0]
            c.close()
            return n
        except Exception:
            continue
    return None


def r2_keys(cid):
    st, body = api('GET', f'/api/clips/{cid}/media')
    return st


def make_clip(title):
    st, body = api('POST', '/api/clips', json.dumps({'mime': 'video/webm', 'kind': 'screen', 'title': title}).encode(), {'Content-Type': 'application/json'})
    cid = json.loads(body)['id']
    api('PUT', f'/api/clips/{cid}/part?n=1', os.urandom(6000), {'x-elapsed': '4'})
    api('PUT', f'/api/clips/{cid}/audio?n=0&start=0', os.urandom(3000), {'content-type': 'audio/webm'})
    api('PUT', f'/api/clips/{cid}/poster', b'\xff\xd8\xff\xe0' + os.urandom(500), {'content-type': 'image/jpeg'})
    st, _ = api('POST', f'/api/clips/{cid}/complete', json.dumps({'durationMs': 4000}).encode(), {'Content-Type': 'application/json'})
    assert st == 200, st
    api('POST', f'/api/clips/{cid}/comments', json.dumps({'at': 1, 'text': 'a note'}).encode(), {'Content-Type': 'application/json'})
    api('POST', f'/api/clips/{cid}/reactions', json.dumps({'emoji': '👍', 'at': 1}).encode(), {'Content-Type': 'application/json'})
    api('POST', f'/api/clips/{cid}/views', json.dumps({'seconds': 2}).encode(), {'Content-Type': 'application/json'})
    return cid


def leftovers(cid):
    return dict(
        clip=d1_count('SELECT COUNT(*) FROM hub_clips WHERE id=?', (cid,)),
        comments=d1_count('SELECT COUNT(*) FROM hub_clip_comments WHERE clip_id=?', (cid,)),
        reactions=d1_count('SELECT COUNT(*) FROM hub_clip_reactions WHERE clip_id=?', (cid,)),
        views=d1_count('SELECT COUNT(*) FROM hub_clip_views WHERE clip_id=?', (cid,)),
        media=api('GET', f'/api/clips/{cid}/media')[0],
        poster=api('GET', f'/api/clips/{cid}/media?poster=1')[0],
        info=api('GET', f'/api/clips/{cid}/info')[0],
    )


with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    ctx = b.new_context(viewport=dict(width=1440, height=900))
    ctx.add_cookies([dict(name='favor_hub_session', value=COOKIE, domain=HOST, path='/'), dict(name='hub_gc', value='1', domain=HOST, path='/')])
    pg = ctx.new_page()
    dialogs = []
    pg.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))  # a browser that suppresses dialogs answers no
    errs = []
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)

    # ---- from the library
    a = make_clip('Delete me from the library')
    before = leftovers(a)
    ok('library clip exists with comment and reaction rows', before['clip'] == 1 and before['comments'] == 1 and before['reactions'] == 1, str(before))
    pg.goto(BASE + '/clips/'); pg.wait_for_selector(f'.cl-card[data-id="{a}"]')
    pg.click(f'.cl-card[data-id="{a}"] [data-act=delete]')
    pg.wait_for_selector('.cl-ask'); pg.screenshot(path=os.environ.get('SHOTS', 'Q:/work/favor-hub/clips-rollout-test/shots') + '/delete-ask-1440.png'); pg.click('.cl-ask [data-ok]')
    pg.wait_for_selector(f'.cl-card[data-id="{a}"]', state='detached', timeout=8000)
    ok('library: the question is in the page and no native dialog was used', len(dialogs) == 0, str(dialogs))
    after = leftovers(a)
    ok('library: D1 rows, comments, reactions, views and R2 files are all gone', after == dict(clip=0, comments=0, reactions=0, views=0, media=404, poster=404, info=404), str(after))
    pg.reload(); pg.wait_for_selector('#cl-rows')
    ok('library: the card stays gone after a reload', pg.query_selector(f'.cl-card[data-id="{a}"]') is None)

    # ---- from the watch page
    c = make_clip('Delete me from the watch page')
    pg.goto(BASE + f'/c/{c}'); pg.wait_for_selector('#cw-more')
    pg.click('#cw-more'); pg.click('[data-m=delete]'); pg.wait_for_selector('.cl-ask'); pg.click('.cl-ask [data-ok]')
    pg.wait_for_url('**/clips/', timeout=8000)
    after = leftovers(c)
    ok('watch page: sent back to the library and everything is gone', after == dict(clip=0, comments=0, reactions=0, views=0, media=404, poster=404, info=404), str(after))
    ok('no console errors', not [e for e in errs if '503' not in e and 'favicon' not in e], str(errs[:3]))
    b.close()

print('RESULT', sum(res), 'pass', len(res) - sum(res), 'fail')
sys.exit(0 if all(res) else 1)
