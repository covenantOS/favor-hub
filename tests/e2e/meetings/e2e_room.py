"""Meetings e2e on the local hub: three people join one room, host controls, chat, spotlight, mute, remove,
recording with a takeover. Run with the local hub on 8837 and testkey on 8899."""
import asyncio, json, sys, time, urllib.request
sys.path.insert(0, 'Q:/work/favor-hub/signin-test')
sys.argv = [sys.argv[0], 'http://127.0.0.1:8837']
import shots, testkey
from playwright.async_api import async_playwright

BASE = 'http://127.0.0.1:8837'
OUT = 'Q:/work/favor-meet-p0/out/'
FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
R = []
def check(name, ok, extra=''):
    R.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name, extra)

async def mk(browser, email, name, vw=1440, vh=900):
    tok = shots.session_for(email, name)
    ctx = await browser.new_context(viewport={'width': vw, 'height': vh}, permissions=['camera', 'microphone'])
    await ctx.add_cookies([{'name': 'favor_hub_session', 'value': tok, 'url': BASE}, {'name': 'hub_gc', 'value': '1', 'url': BASE}])
    await ctx.add_init_script("localStorage.setItem('favor.hub.welcome.v1','1')")
    page = await ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.errs = errs
    return ctx, page

async def api(page, path, method='GET', body=None):
    return await page.evaluate("""async ([p, m, b]) => { const r = await fetch('/api/meet/' + p, {method: m, headers: b ? {'content-type': 'application/json'} : {}, body: b ? JSON.stringify(b) : undefined}); return {status: r.status, json: await r.json().catch(() => ({}))}; }""", [path, method, body])

async def join(page, mid, name):
    await page.goto(f'{BASE}/meet/room/?m={mid}', wait_until='domcontentloaded')
    await page.wait_for_selector('#lb-join', timeout=20000)
    await page.fill('#lb-name', name)
    await page.wait_for_timeout(1200)
    await page.click('#lb-join')
    await page.wait_for_selector('#rm-grid', timeout=30000)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='msedge', args=FAKE)
        hctx, host = await mk(b, 'host@favorintl.org', 'Hannah Price')
        actx, ann = await mk(b, 'ann@favorintl.org', 'Ann Bell')
        bctx, bo = await mk(b, 'bo@favorintl.org', 'Bo Reed')
        await host.goto(BASE + '/meet/', wait_until='networkidle')
        r = await api(host, 'meetings', 'POST', {'title': 'Support Team weekly', 'rec': 'video', 'access': 'staff'})
        mid = r['json']['meeting']['id']
        await join(host, mid, 'Hannah Price')
        await join(ann, mid, 'Ann Bell')
        await join(bo, mid, 'Bo Reed')
        await host.wait_for_timeout(8000)
        for pg, nm in ((host, 'host'), (ann, 'ann'), (bo, 'bo')):
            n = await pg.evaluate("() => document.querySelectorAll('#rm-grid .mt-tile').length")
            check(f'{nm} sees 3 tiles', n == 3, n)
        # remote video flowing on ann
        flowing = await ann.evaluate("() => [...document.querySelectorAll('#rm-grid .mt-tile video')].filter(v => v.videoWidth > 0 && v.srcObject).length")
        check('ann gets video for tiles', flowing >= 3, flowing)
        subs = await ann.evaluate("() => window.__meet.rtc.subs.size")
        check('ann has 4 subscriptions (2 video 2 audio)', subs == 4, subs)
        await host.screenshot(path=OUT + 'room-3-host-1440.png')
        # chat
        await ann.click('[data-a=panel][data-p=chat]')
        await ann.fill('#chatin', 'Morning all')
        await ann.keyboard.press('Enter')
        await host.wait_for_timeout(2500)
        await host.click('[data-a=panel][data-p=chat]')
        txt = await host.inner_text('#rm-body')
        check('host receives chat', 'Morning all' in txt, txt[:60])
        # hand raise
        await bo.click('[data-a=hand]')
        await host.wait_for_timeout(2500)
        await host.click('[data-a=panel][data-p=people]')
        txt = await host.inner_text('#rm-body')
        check('host sees raised hand', 'hand raised' in txt)
        # spotlight for everyone via host menu
        ids = await host.evaluate("() => [...document.querySelectorAll('[data-a=pmenu]')].map(b => b.dataset.pid)")
        annpid = await ann.evaluate("() => window.__meet.S.me.pid")
        bopid = await bo.evaluate("() => window.__meet.S.me.pid")
        await host.click(f'[data-a=pmenu][data-pid="{annpid}"]')
        await host.click(f'.menu [data-c=spot]')
        await host.wait_for_timeout(2500)
        big = await bo.evaluate("() => document.querySelector('#rm-grid .mt-tile.is-big .nt')?.textContent")
        check('spotlight shows on bo', big and 'Ann' in big, big)
        await bo.screenshot(path=OUT + 'room-spot-bo-1440.png')
        # mute ann by host
        await host.click(f'[data-a=pmenu][data-pid="{annpid}"]')
        await host.click(f'.menu [data-c=mute]')
        await ann.wait_for_timeout(2500)
        mic = await ann.evaluate("() => window.__meet.S.mic")
        check('host mute works', mic is False, mic)
        # mute all, lock
        await host.click('[data-c=muteall]')
        await bo.wait_for_timeout(2500)
        check('mute all hits bo', (await bo.evaluate("() => window.__meet.S.mic")) is False)
        await host.click('[data-c=lock]')
        await host.wait_for_timeout(1500)
        # third person cannot join when locked
        cctx, cy = await mk(b, 'will@favorintl.org', 'Will Hamilton')
        await cy.goto(f'{BASE}/meet/room/?m={mid}', wait_until='domcontentloaded')
        await cy.wait_for_selector('#lb-join'); await cy.click('#lb-join'); await cy.wait_for_timeout(3000)
        t = await cy.inner_text('#meet-root')
        check('locked room refuses join', 'locked' in t.lower() or 'cannot join' in t.lower(), t[:80])
        await host.click('[data-c=unlock]')
        # recording started by host automatically
        await host.wait_for_timeout(6000)
        rec = await host.evaluate("() => window.__meet.S.recording")
        check('recording active', rec and rec.get('active'), rec)
        # remove bo
        await host.click(f'[data-a=pmenu][data-pid="{bopid}"]')
        host.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await host.click('.menu [data-c=remove]')
        await bo.wait_for_timeout(3500)
        t = await bo.inner_text('#meet-root')
        check('bo removed', 'removed' in t.lower(), t[:80])
        # host drops, ann takes over recording
        await hctx.close()
        await ann.wait_for_timeout(9000)
        st = await ann.evaluate("() => window.__meet.S.recording")
        check('ann took over recording', st and st.get('owner') == annpid and st.get('epoch', 1) >= 2, st)
        await ann.wait_for_timeout(8000)
        ch = await ctx_req(actx, mid, annpid)
        print('chunks', ch)
        print('errs', {n: pg.errs[:2] for n, pg in (('host', host), ('ann', ann), ('bo', bo))})
        await b.close()
    fails = [n for n, ok in R if not ok]
    print('FAILED:', fails or 'none')

async def ctx_req(ctx, mid, pid):
    pg = ctx.pages[0]
    return await pg.evaluate("""async ([mid, pid]) => { const r = await fetch(`/api/meet/meetings/${mid}/rec/status?pid=${pid}`); return await r.json(); }""", [mid, pid])

asyncio.run(main())
