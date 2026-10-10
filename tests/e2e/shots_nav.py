"""Screenshots and layout checks for the Clips rollout at 1440 and 390: sidebar entry, top buttons, account menu, library, storage note, admin view, recorder window."""
import os, json, sys, glob, sqlite3, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
HOST = BASE.split('//')[1].split(':')[0]
SHOTS = os.environ.get('SHOTS', r'Q:\work\favor-hub\clips-rollout-test\shots')
STATE = os.environ.get('WRANGLER_STATE', r'Q:\work\favor-hub\clips-rollout\.wrangler\state\v3')
os.makedirs(SHOTS, exist_ok=True)
res = []


def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(tok, method, path, data=None, headers=None):
    h = {'Cookie': f'favor_hub_session={tok}'}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        x = urllib.request.urlopen(r); return x.status, x.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def make(tok, title, size, views=0):
    st, b = api(tok, 'POST', '/api/clips', json.dumps({'mime': 'video/webm', 'title': title}).encode(), {'Content-Type': 'application/json'})
    cid = json.loads(b)['id']
    api(tok, 'PUT', f'/api/clips/{cid}/part?n=1', os.urandom(5000), {'x-elapsed': '3'})
    api(tok, 'POST', f'/api/clips/{cid}/complete', b'{"durationMs":83000}', {'Content-Type': 'application/json'})
    f = [x for x in glob.glob(STATE + r'\d1\miniflare-D1DatabaseObject\*.sqlite') if not x.endswith('metadata.sqlite')][0]
    c = sqlite3.connect(f); c.execute('UPDATE hub_clips SET size_bytes=?, views=? WHERE id=?', (size, views, cid)); c.commit(); c.close()
    return cid


s1, s2, will = 'tok-staff1-local', 'tok-staff2-local', 'tok-will-local'
GB = 1024 ** 3
mine = [make(s1, 'Moving a request on the Request board', int(2.6 * GB), 3), make(s1, 'Thank-you receipts, a first look', int(2.4 * GB)), make(s1, 'Favor hub, Today and the menu', int(2.1 * GB)), make(s1, 'Old walkthrough nobody opened', int(1.5 * GB))]
other = make(s2, 'Gift entry from a phone photo', int(0.8 * GB))
ids = mine + [other]

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge')
    for who, tok in (('staff', s1), ('admin', will)):
        for w, h, tag in ((1440, 900, '1440'), (390, 844, '390')):
            ctx = b.new_context(viewport=dict(width=w, height=h))
            ctx.add_cookies([dict(name='favor_hub_session', value=tok, domain=HOST, path='/'), dict(name='hub_gc', value='1', domain=HOST, path='/')])
            pg = ctx.new_page()
            pg.goto(BASE + '/clips/')
            if who == 'staff':
                pg.wait_for_selector('.cl-card', timeout=15000); pg.wait_for_selector('#cl-usage:not([hidden])', timeout=8000)
            else:
                pg.wait_for_selector('#cl-rows:not([aria-busy])', timeout=15000)
            pg.wait_for_selector('#clip-cam:not([hidden])')
            if w >= 1000:
                ok(f'{who} 1440: Clips is in the sidebar under Work', pg.query_selector('a[data-nav-id=clips]') is not None and pg.is_visible('a[data-nav-id=clips]'))
                ok(f'{who} 1440: the camera and library buttons are in the top bar', pg.is_visible('#clip-cam') and pg.is_visible('#clip-lib'))
                pg.click('#h-acct'); pg.wait_for_selector('#h-acctmenu:not([hidden])')
                ok(f'{who} 1440: My clips is in the account menu', 'My clips' in pg.inner_text('#h-acctmenu'))
                pg.screenshot(path=f'{SHOTS}/{who}-{tag}-account-menu.png')
                pg.keyboard.press('Escape')
            else:
                ok(f'{who} 390: the camera button is visible and the page fits', pg.is_visible('#clip-cam'))
                pg.click('#h-menu'); pg.wait_for_timeout(400)
                ok(f'{who} 390: Clips is in the phone menu', pg.is_visible('a[data-nav-id=clips]'))
                pg.screenshot(path=f'{SHOTS}/{who}-{tag}-menu.png')
                pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            pg.screenshot(path=f'{SHOTS}/{who}-{tag}-library.png', full_page=True)
            over = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            ok(f'{who} {tag}: no sideways scroll on My clips', over <= 1, over)
            cards = pg.query_selector_all('.cl-card')
            ok(f'{who} {tag}: sees only own clips', len(cards) == len(mine) if who == 'staff' else True, len(cards))
            if who == 'admin':
                pg.goto(BASE + '/clips/all/'); pg.wait_for_selector('.cl-ppl'); pg.wait_for_selector('.cl-card')
                pg.screenshot(path=f'{SHOTS}/admin-{tag}-all-clips.png', full_page=True)
                ok(f'admin {tag}: the all-clips view lists other people clips', len(pg.query_selector_all('.cl-card')) >= len(ids))
                over = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
                ok(f'admin {tag}: no sideways scroll on All clips', over <= 1, over)
            ctx.close()
    # the delete question, and the recorder window with the storage note
    ctx = b.new_context(viewport=dict(width=1440, height=900))
    ctx.add_cookies([dict(name='favor_hub_session', value=s1, domain=HOST, path='/'), dict(name='hub_gc', value='1', domain=HOST, path='/')])
    pg = ctx.new_page()
    pg.goto(BASE + '/clips/'); pg.wait_for_selector('.cl-card')
    pg.click('.cl-old [data-act=delete-old]'); pg.wait_for_selector('.cl-ask'); pg.screenshot(path=f'{SHOTS}/staff-1440-delete-question.png'); pg.keyboard.press('Escape')
    ok('the delete question closes on Escape without deleting', pg.query_selector('.cl-ask') is None and len(pg.query_selector_all('.cl-card')) == len(mine))
    with ctx.expect_page() as pop:
        pg.click('#clip-cam')
    rw = pop.value
    rw.wait_for_selector('#cr-card'); rw.wait_for_selector('#cr-usage:not([hidden])', timeout=8000)
    rw.set_viewport_size(dict(width=420, height=700))
    rw.screenshot(path=f'{SHOTS}/staff-recorder-window.png')
    ok('the recorder card shows the 80% note', 'oldest' in rw.inner_text('#cr-usage'))
    ctx.close()
    b.close()
for x in ids:
    for t in (s1, s2):
        api(t, 'DELETE', f'/api/clips/{x}')
print('RESULT', sum(res), 'pass', len(res) - sum(res), 'fail')
sys.exit(0 if all(res) else 1)
