# Floating recording controls: pause, resume, change what is shared, camera off, shortcuts, stop. One clip, right length.
# Needs a local server (wrangler pages dev) with AGENT_API_KEY=testkey-clips-local, and Edge (Document Picture-in-Picture).
import time, json, os, sys, shutil, subprocess, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8812')
KEY = os.environ.get('KEY', 'testkey-clips-local')
OUT = os.environ.get('OUT', r'Q:\Temp\Will\clipctl')
os.makedirs(OUT, exist_ok=True)
ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required']
res = []
ST = "import('/js/clips/launcher.js?v=7').then(m => %s)"


def ok(name, cond, extra=''):
    res.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(method, path):
    r = urllib.request.Request(BASE + path, method=method, headers={'Authorization': 'Bearer ' + KEY})
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def probe(cid, name):
    st, body = api('GET', f'/api/clips/{cid}/media')
    path = os.path.join(OUT, name + '.bin')
    open(path, 'wb').write(body)
    out = subprocess.run([shutil.which('ffprobe'), '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out or '{}'), len(body)


NOISE = """() => { document.title = 'noise'; document.body.style.cssText = 'margin:0;background:#000'; const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh'; document.body.append(c); const g = c.getContext('2d'); let i = 0; setInterval(() => { g.fillStyle = 'hsl(' + (i++ * 9 % 360) + ',80%,50%)'; g.fillRect(0, 0, 640, 360); }, 80); }"""


def phase(rw):
    return rw.evaluate(ST % 'm._state.rs && m._state.rs.phase')


def run(p, withcam):
    b = p.chromium.launch(channel='msedge', args=ARGS, headless=False)
    ctx = b.new_context(viewport=dict(width=1440, height=900), permissions=['microphone', 'camera'], extra_http_headers={'Authorization': 'Bearer ' + KEY})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '/')
    pg.wait_for_selector('#clip-cam', state='attached', timeout=30000)
    pg.evaluate("document.getElementById('clip-cam').hidden = false")  # the local database has no nav tables
    pg.evaluate("localStorage.setItem('favor.clips.prefs', JSON.stringify({source:'screen',camOn:%s,micOn:true,micId:'',systemAudio:false,size:'M',float:true}))" % ('true' if withcam else 'false'))
    with ctx.expect_page() as pop:
        pg.click('#clip-cam')
    rw = pop.value
    rw.on('pageerror', lambda e: errs.append('rw ' + str(e)))
    rw.wait_for_selector('#cr-card', timeout=30000)
    tag = 'cam' if withcam else 'plain'
    before = set(ctx.pages)
    rw.click('[data-act=start]')
    rw.wait_for_selector('#cr-bar', timeout=30000)
    time.sleep(5)  # countdown
    new = [x for x in ctx.pages if x not in before]
    ok(f'{tag}: the floating window opened', len(new) >= 1, str([x.url for x in new]))
    w = new[0]
    w.wait_for_selector('[data-ctl=stop]', timeout=10000)
    ok(f'{tag}: floating window has the share button', w.query_selector('[data-ctl=share]').is_visible())
    ok(f'{tag}: camera button shows only with the camera on', w.query_selector('[data-ctl=cam]').is_visible() == withcam)
    noise = ctx.new_page()
    noise.goto('about:blank')
    noise.evaluate(NOISE)
    noise.bring_to_front()
    time.sleep(3)
    w.click('[data-ctl=pause]')
    time.sleep(0.6)
    ok(f'{tag}: pause from the floating window', phase(rw) == 'paused')
    time.sleep(3)
    w.click('[data-ctl=pause]')
    time.sleep(0.6)
    ok(f'{tag}: resume', phase(rw) == 'recording')
    time.sleep(2)
    n0 = rw.evaluate(ST % '(m._state.rec.state.shares || 0)')
    w.click('[data-ctl=share]')
    time.sleep(2.5)
    n1 = rw.evaluate(ST % '(m._state.rec.state.shares || 0)')
    ok(f'{tag}: change share swapped the screen', n1 == n0 + 1, f'{n0}->{n1}')
    ok(f'{tag}: still recording after the swap', phase(rw) == 'recording')
    if withcam:
        w.click('[data-ctl=cam]')
        time.sleep(0.5)
        ok(f'{tag}: camera off', rw.evaluate(ST % 'm._state.rec.camOff') is True)
        w.click('[data-ctl=cam]')
        time.sleep(0.5)
        ok(f'{tag}: camera on again', rw.evaluate(ST % 'm._state.rec.camOff') is False)
    w.bring_to_front()
    w.keyboard.press('Alt+Shift+KeyP')
    time.sleep(0.6)
    ok(f'{tag}: Alt+Shift+P pauses', phase(rw) == 'paused')
    time.sleep(2)
    w.keyboard.press('Alt+Shift+KeyP')
    time.sleep(0.6)
    ok(f'{tag}: Alt+Shift+P resumes', phase(rw) == 'recording')
    time.sleep(2)
    w.screenshot(path=os.path.join(OUT, f'pip-{tag}.png'))
    expect = 3 + 2 + 2.5 + (1.0 if withcam else 0) + 2 + 0.6 + 0.6
    w.keyboard.press('Alt+Shift+KeyS')
    rw.wait_for_selector('.cr-saved__title', timeout=120000)
    href = rw.get_attribute('.cr-saved__btns a', 'href')
    cid = href.rsplit('/', 1)[1]
    st, body = api('GET', f'/api/clips/{cid}/info')
    d = json.loads(body)['clip']
    ok(f'{tag}: clip saved with the paused time left out', abs(d['duration'] - expect) < 3.5, f"{d['duration']:.1f}s expected about {expect:.1f}s")
    info, size = probe(cid, 'clip-' + tag)
    dur = float(info.get('format', {}).get('duration', 0))
    ok(f'{tag}: one playable file, length matches', size > 0 and abs(dur - d['duration']) < 3 and any(s.get('codec_type') == 'video' for s in info.get('streams', [])), json.dumps(info)[:200])
    ok(f'{tag}: no unfinished second clip', len(json.loads(api('GET', '/api/clips/unfinished')[1])['clips']) == 0)
    ok(f'{tag}: no page errors', not errs, str(errs))
    api('DELETE', f'/api/clips/{cid}')
    b.close()


with sync_playwright() as p:
    run(p, False)
    run(p, True)
fails = [n for n, c in res if not c]
print('\nRESULT', len(res) - len(fails), 'pass', len(fails), 'fail', fails)
sys.exit(1 if fails else 0)
