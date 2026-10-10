"""A real recording of the hub, then what the screen added.
Playwright drives the hub in one tab and records that tab's picture (record_video_dir). ffmpeg adds a spoken walkthrough as
the sound. The file goes in through the recorder window's "Upload a video" path, which samples frames from the file the same
way the live recorder samples the screen. The output shows the frames the model read, the title, summary and chapters
written from the words alone (before) and with the screen added (after), and a search on text that was only on screen."""
import os, json, sys, time, glob, shutil, sqlite3, subprocess, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
HOST = BASE.split('//')[1].split(':')[0]
COOKIE = os.environ.get('SESSION', 'tok-staff1-local')
SPEECH = os.environ.get('SPEECH', r'Q:\work\favor-hub\clips-v2-test\speech.wav')
STATE = os.environ.get('WRANGLER_STATE', r'Q:\work\favor-hub\clips-rollout\.wrangler\state\v3')
WORK = os.environ.get('WORK', r'Q:\work\favor-hub\clips-rollout-test\vision')
OUT = os.environ.get('OUT', r'Q:\work\favor-hub\clips-rollout-test\vision-out.json')
LIVE = not BASE.startswith('http://127')
res = []
os.makedirs(WORK, exist_ok=True)


def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(method, path, data=None, headers=None):
    h = {'User-Agent': 'Mozilla/5.0 clips-test'}
    if os.environ.get('AGENT_KEY'):
        h['Authorization'] = 'Bearer ' + os.environ['AGENT_KEY']
    else:
        h['Cookie'] = f'favor_hub_session={COOKIE}'
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        x = urllib.request.urlopen(r); return x.status, x.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def frames_of(cid):
    if LIVE:
        return None
    f = [x for x in glob.glob(STATE + r'\d1\miniflare-D1DatabaseObject\*.sqlite') if not x.endswith('metadata.sqlite')][0]
    return sqlite3.connect(f).execute('SELECT t_ms, status, app, page, step, text FROM hub_clip_frames WHERE clip_id=? ORDER BY t_ms', (cid,)).fetchall()


def auth(ctx):
    if os.environ.get('AGENT_KEY'):
        ctx.set_extra_http_headers({'Authorization': 'Bearer ' + os.environ['AGENT_KEY']})
    else:
        ctx.add_cookies([dict(name='favor_hub_session', value=COOKIE, domain=HOST, path='/'), dict(name='hub_gc', value='1', domain=HOST, path='/')])


# ---- 1. record the hub tab
vid_dir = os.path.join(WORK, 'raw')
shutil.rmtree(vid_dir, ignore_errors=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=False)
    ctx = b.new_context(viewport=dict(width=1280, height=720), record_video_dir=vid_dir, record_video_size=dict(width=1280, height=720))
    auth(ctx)
    pg = ctx.new_page()
    for path, secs in [('/', 6), ('/requests/', 9), ('/requests/new', 9), ('/help/', 8), ('/receipts/', 7)]:
        pg.goto(BASE + path); time.sleep(secs)
    pg.close(); ctx.close(); b.close()
raw = glob.glob(vid_dir + r'\*.webm')[0]
mp4 = os.path.join(WORK, 'hub-walkthrough.mp4')
if os.environ.get('SILENT'):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', mp4], check=True)
else:
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-i', SPEECH, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4], check=True)
print('recording', os.path.getsize(mp4), 'bytes')

# ---- 2. upload it from the recorder window, as a signed-in person
with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', headless=False)
    ctx = b.new_context(viewport=dict(width=1280, height=800))
    auth(ctx)
    pg = ctx.new_page()
    pg.goto(BASE + '/'); pg.wait_for_selector('#clip-cam:not([hidden])', timeout=30000)
    with ctx.expect_page() as pop:
        pg.click('#clip-cam')
    rw = pop.value
    rw.wait_for_selector('#cr-card', timeout=20000)
    with rw.expect_file_chooser() as fc:
        rw.click('[data-act=file]')
    fc.value.set_files(mp4)
    rw.wait_for_selector('.cr-saved__title', timeout=240000)
    cid = rw.get_attribute('.cr-saved__btns a', 'href').rsplit('/', 1)[1]
    b.close()
print('uploaded', cid)

time.sleep(5)
st, body = api('GET', f'/api/clips/{cid}/info'); after = json.loads(body); clip = after['clip']
fr = frames_of(cid)
if fr is not None:
    print('frames:', len(fr))
    for r in fr:
        print('  ', round(r[0] / 1000, 1), r[1], '|', r[2], '|', r[3], '|', r[4], '|', (r[5] or '')[:90].replace('\n', ' '))
    ok('frames were sampled from the recording', len(fr) >= 5, len(fr))
    ok('the vision model read them', sum(1 for r in fr if r[1] == 'done') >= 5, str([r[1] for r in fr]))
    ok('it saw the Favor hub', any('favor' in (r[2] or '').lower() for r in fr))
    ok('it saw the Request board', any('request' in ((r[3] or '') + (r[5] or '')).lower() for r in fr))
print('seen:', json.dumps(after.get('seen'))[:700])
print('FIRST RUN title:', clip['title']); print('FIRST RUN summary:', clip['summary']); print('FIRST RUN chapters:', json.dumps(clip['chapters']))
ok('chapters exist', len(clip['chapters']) >= 2)

st, b1 = api('POST', f'/api/clips/{cid}/process', json.dumps({'again': True, 'vision': False}).encode(), {'Content-Type': 'application/json'})
before = json.loads(b1)['clip']
print('BEFORE (words only) title:', before['title']); print('BEFORE summary:', before['summary']); print('BEFORE chapters:', json.dumps(before['chapters']))
st, b2 = api('POST', f'/api/clips/{cid}/process', json.dumps({'again': True}).encode(), {'Content-Type': 'application/json'})
again = json.loads(b2)['clip']
print('AFTER (words and screen) title:', again['title']); print('AFTER summary:', again['summary']); print('AFTER chapters:', json.dumps(again['chapters']))
json.dump(dict(id=cid, before=dict(title=before['title'], summary=before['summary'], chapters=before['chapters']), after=dict(title=again['title'], summary=again['summary'], chapters=again['chapters']),
               frames=[list(r[:5]) for r in (fr or [])], seen=after.get('seen')), open(OUT, 'w'), indent=1)
# search for something that was only on screen: a word from the frames' text that nobody said
if fr:
    said = ' '.join(s['t'] for s in clip['transcript']).lower()
    words = []
    for r in fr:
        for w in (r[5] or '').replace('\n', ' ').split():
            w2 = ''.join(ch for ch in w.lower() if ch.isalpha())
            if len(w2) >= 6 and w2 not in said and w2 not in words:
                words.append(w2)
    print('screen-only words:', words[:12])
    if words:
        q = words[0]
        st, body = api('GET', f'/api/clips?q={q}')
        hit = [c for c in json.loads(body)['clips'] if c['id'] == cid]
        ok(f'search finds "{q}", which was only on screen', bool(hit) and (hit[0].get('match') or {}).get('text', '').startswith('On screen'), str(hit and hit[0].get('match')))
if not os.environ.get('KEEP'):
    api('DELETE', f'/api/clips/{cid}')
print('RESULT', sum(res), 'pass', len(res) - sum(res), 'fail')
sys.exit(0 if all(res) else 1)
