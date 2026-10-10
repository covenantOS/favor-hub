import time, json, os, sys, subprocess, urllib.request, shutil
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
HOST = BASE.split('//')[1].split(':')[0]
COOKIE = os.environ.get('SESSION', 'tok-will-local')
SHOTS = r'Q:\work\favor-hub\clips-rollout-test\shots'
os.makedirs(SHOTS, exist_ok=True)
SPEECH = r'Q:\work\favor-hub\clips-v2-test\speech.wav'
ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen',
        f'--use-file-for-fake-audio-capture={SPEECH}', '--autoplay-policy=no-user-gesture-required']
res = []
NOISE = '''() => { document.body.style.cssText = 'margin:0;background:#000'; const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh'; document.body.append(c); const g = c.getContext('2d'); const d = g.createImageData(640, 360); setInterval(() => { const a = d.data; for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; g.putImageData(d, 0, 0); }, 80); }'''


def ok(name, cond, extra=''):
    res.append((name, bool(cond)))
    print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(method, path, data=None, headers=None):
    h = {'Cookie': f'favor_hub_session={COOKIE}'}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def probe_video(cid, name):
    """Download the saved file and count its frames and duration with ffprobe when present."""
    st, body = api('GET', f'/api/clips/{cid}/media')
    path = rf'Q:\work\favor-hub\clips-rollout-test\{name}.bin'
    open(path, 'wb').write(body)
    ff = shutil.which('ffprobe')
    if not ff:
        return None, len(body)
    out = subprocess.run([ff, '-v', 'error', '-show_entries', 'stream=codec_type,nb_read_frames,duration:format=duration', '-count_frames', '-of', 'json', path], capture_output=True, text=True).stdout
    return json.loads(out or '{}'), len(body)


with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', args=ARGS, headless=False)
    ctx = b.new_context(viewport=dict(width=1440, height=900), permissions=['microphone', 'camera'])
    ctx.add_cookies([
        dict(name='favor_hub_session', value=COOKIE, domain=HOST, path='/'),
        dict(name='hub_gc', value='1', domain=HOST, path='/'),
    ])
    dialogs = []
    def on_dialog(d):
        dialogs.append((d.type, d.message)); d.accept()
    pg = ctx.new_page()
    pg.on('dialog', on_dialog)
    ctx.on('page', lambda np_: np_.on('dialog', on_dialog))
    logs = []
    pg.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)))

    pg.goto(BASE + '/'); pg.wait_for_selector('#clip-cam:not([hidden])', timeout=20000)
    pg.evaluate("localStorage.setItem('favor.clips.debug', JSON.stringify({bps: 8000000, sliceSeconds: 15}))")
    pg.evaluate("localStorage.setItem('favor.clips.prefs', JSON.stringify({source:'screen',camOn:false,micOn:true,micId:'',systemAudio:false,size:'M'}))")

    # ---------- A. navigate across five pages, reload once, then stop
    with ctx.expect_page() as pop:
        pg.click('#clip-cam')
    rw = pop.value
    rw.on('dialog', on_dialog)
    rw.wait_for_selector('#cr-card', timeout=20000)
    ok('A: the recorder opened in its own window', rw.url.endswith('/clips/rec/'), rw.url)
    rw.click('[data-act=start]')
    rw.wait_for_selector('#cr-bar', timeout=30000)
    t0 = time.time()
    time.sleep(2)
    rid = rw.evaluate("document.querySelector('[data-t]').textContent")
    ok('A: recording started in the window', True, rid)
    noise = ctx.new_page()
    noise.goto('about:blank')
    noise.evaluate(NOISE)
    noise.bring_to_front()
    for path in ['/', '/requests/', '/work/', '/brain/', '/dashboard/']:
        pg.goto(BASE + path); time.sleep(5)
    pass
    pg.reload(); time.sleep(4)
    pg.goto(BASE + '/clips/'); time.sleep(3)
    ok('A: the camera button shows a recording dot on a fresh hub page', pg.evaluate("document.getElementById('clip-cam').classList.contains('is-rec')"))
    pg.screenshot(path=SHOTS + r'hub-recording-dot.png')
    t_mid = rw.evaluate("document.querySelector('[data-t]').textContent")
    ok('A: the timer kept running through five page changes and a reload', t_mid != rid and t_mid not in ('0:00', '0:01'), f'{rid} -> {t_mid}')
    ok('A: no leave-page prompt appeared', len(dialogs) == 0, str(dialogs))
    time.sleep(3)
    rw.screenshot(path=SHOTS + r'\rec-window-recording.png')
    last_t = rw.evaluate("document.querySelector('[data-t]').textContent")
    mm, ss = last_t.split(':'); wall = int(mm) * 60 + int(ss)
    rw.click('[data-ctl=stop]')
    rw.wait_for_selector('.cr-saved__title', timeout=120000)
    href = rw.get_attribute('.cr-saved__btns a', 'href'); cid = href.rsplit('/', 1)[1]
    st, body = api('GET', f'/api/clips/{cid}/info'); d = json.loads(body)['clip']
    ok('A: clip complete with duration close to the recording', abs(d['duration'] - wall) < 4, f"{d['duration']:.1f}s vs wall {wall:.1f}s")
    info, size = probe_video(cid, 'clipA')
    print('A probe', json.dumps(info)[:300], size)
        # play end to end in a page: no stall, ends at the end
    pg2 = ctx.new_page()
    pg2.goto(BASE + f'/c/{cid}'); pg2.wait_for_selector('video', timeout=20000)
    res_play = pg2.evaluate("""async () => {
      const v = document.querySelector('video'); v.muted = true;
      await new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, {once: true}));
      const dur = v.duration; let maxGap = 0, last = -1, lastAt = performance.now(); let stalls = 0;
      v.playbackRate = 4; v.currentTime = 0; await v.play();
      return await new Promise(res => {
        const iv = setInterval(() => {
          const now = performance.now();
          if (v.currentTime === last && !v.ended) { stalls++; maxGap = Math.max(maxGap, now - lastAt); } else { lastAt = now; }
          last = v.currentTime;
        }, 200);
        v.addEventListener('ended', () => { clearInterval(iv); res({dur, ended: true, end: v.currentTime, stalls, maxGap}); });
        setTimeout(() => { clearInterval(iv); res({dur, ended: false, end: v.currentTime, stalls, maxGap}); }, 90000);
      });
    }""")
    print('A play', res_play)
    ok('A: plays end to end at 4x with no stall', res_play['ended'] and res_play['maxGap'] < 1500, str(res_play))
    pg2.close()

    noise.close()
    # ---------- B. closing the recorder window mid-recording keeps the footage
    pg.goto(BASE + '/'); pg.wait_for_selector('#clip-cam:not([hidden])')
    pg.bring_to_front()
    pg.click('#clip-cam')
    rw2 = rw
    rw2.wait_for_selector('#cr-card', timeout=15000)
    ok('B: the camera button brought the open recorder window back to the card', True)
    noise2 = ctx.new_page(); noise2.goto('about:blank'); noise2.evaluate(NOISE); noise2.bring_to_front()
    pg.evaluate("localStorage.setItem('favor.clips.debug', JSON.stringify({bps: 40000000, sliceSeconds: 15}))")
    time.sleep(1); print('B card html:', rw2.evaluate('document.body.innerText')[:300].replace(chr(10), ' | ')); rw2.click('[data-src=camera]'); time.sleep(1.5)
    rw2.click('[data-act=start]'); rw2.wait_for_selector('#cr-bar', timeout=30000)
    time.sleep(26)
    st, body = api('GET', '/api/clips/unfinished'); un = [u for u in json.loads(body)['clips'] if u['durationMs'] > 0]
    ok('B: one clip is uploading', len(un) == 1, str(un))
    bid = un[0]['id'] if un else ''
    rw2.close()
    time.sleep(7)
    st, body = api('GET', f'/api/clips/{bid}/info'); d = json.loads(body).get('clip', {}) if st == 200 else {}
    print('B info', st, d.get('status'), d.get('duration'))
    ok('B: the clip was finished after the window closed', st == 200 and d.get('status') in ('processing', 'ready'), str(st))
    ok('B: footage so far is kept (about 25 s)', 18 < d.get('duration', 0) < 34, str(d.get('duration')))
    info, size = probe_video(bid, 'clipB')
    print('B probe', json.dumps(info)[:300], size)
    pg3 = ctx.new_page()
    pg3.goto(BASE + f'/c/{bid}'); pg3.wait_for_selector('video', timeout=20000)
    rp = pg3.evaluate("""async () => {
      const v = document.querySelector('video'); v.muted = true;
      await new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, {once: true}));
      v.playbackRate = 4; await v.play();
      return await new Promise(res => { v.addEventListener('ended', () => res({dur: v.duration, ended: true})); setTimeout(() => res({dur: v.duration, ended: false}), 60000); });
    }""")
    ok('B: the recovered clip plays to its end', rp['ended'], str(rp))
    toast = pg.evaluate("[...document.querySelectorAll('.h-toast')].map(t=>t.textContent)")
    print('B toast', toast)
    for c in (cid, bid):
        api('DELETE', f'/api/clips/{c}')
    b.close()

fails = [n for n, c in res if not c]
print('\nRESULT', len(res) - len(fails), 'pass', len(fails), 'fail', fails)
sys.exit(1 if fails else 0)
