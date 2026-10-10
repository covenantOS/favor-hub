import asyncio, sys, json
sys.argv = [sys.argv[0], 'http://127.0.0.1:8837']
exec(open('e2e_room.py', encoding='utf8').read().split("async def main():")[0])

async def go():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='msedge', args=FAKE)
        hctx, host = await mk(b, 'host@favorintl.org', 'Hannah Price')
        await host.goto(BASE + '/meet/', wait_until='networkidle')
        r = await api(host, 'meetings', 'POST', {'title': 'Foundation call', 'rec': 'video', 'access': 'invited'})
        mid = r['json']['meeting']['id']
        gl = await api(host, f'meetings/{mid}/guestlink', 'POST', {})
        check('host gets a guest link', gl['status'] == 200 and '/meet/g/' in gl['json'].get('url', ''), gl['json'])
        url = gl['json']['url']
        await join(host, mid, 'Hannah Price')
        # guest with no session at all
        gctx = await b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
        guest = await gctx.new_page(); errs = []; guest.on('pageerror', lambda e: errs.append(str(e)[:200]))
        # bad key
        bad = await guest.goto(url.replace('&k=', '&k=00'), wait_until='domcontentloaded'); await guest.wait_for_timeout(2500)
        t = await guest.inner_text('#meet-root'); check('wrong key refused', 'does not work' in t or 'not available' in t, t[:80])
        await guest.goto(url, wait_until='domcontentloaded'); await guest.wait_for_selector('#lb-join', timeout=20000)
        await guest.screenshot(path=OUT + 'guest-lobby-1440.png')
        # must name and accept the recording notice
        await guest.click('#lb-join'); await guest.wait_for_timeout(500)
        check('guest still in lobby without a name', await guest.locator('#lb-join').count() == 1)
        await guest.fill('#lb-name', 'Dana Whitfield'); await guest.check('#lb-consent'); await guest.wait_for_timeout(800)
        await guest.click('#lb-join'); await guest.wait_for_timeout(3000)
        t = await guest.inner_text('#meet-root'); check('guest waits for the host', 'Waiting for the host' in t, t[:80])
        await guest.screenshot(path=OUT + 'guest-waiting-1440.png')
        # host sees the waiting guest and lets them in
        await host.click('[data-a=panel][data-p=people]'); await host.wait_for_timeout(2500)
        txt = await host.inner_text('#rm-body'); check('host sees waiting guest', 'Waiting to join' in txt and 'Dana' in txt, txt[:100])
        # while waiting the guest cannot use the SFU
        gtoken = await guest.evaluate("() => sessionStorage.getItem('meet.gtoken.' + new URLSearchParams(location.search).get('m'))")
        gpid = await guest.evaluate("() => sessionStorage.getItem('meet.pid.' + new URLSearchParams(location.search).get('m'))")
        r = await guest.evaluate("""async ([mid, tok, pid]) => { const r = await fetch(`/api/meet-guest/meetings/${mid}/sfu/tracks/new`, {method: 'POST', headers: {'content-type': 'application/json', 'X-Guest-Token': tok}, body: JSON.stringify({pid, tracks: []})}); return r.status; }""", [mid, gtoken, gpid])
        check('waiting guest blocked from the SFU', r == 403, r)
        await host.click('[data-c=letin]'); await guest.wait_for_selector('#rm-grid', timeout=30000); await guest.wait_for_timeout(8000)
        tiles = await guest.evaluate("() => document.querySelectorAll('#rm-grid .mt-tile').length")
        check('guest in the room with 2 tiles', tiles == 2, tiles)
        flow = await guest.evaluate("() => [...document.querySelectorAll('#rm-grid .mt-tile video')].filter(v => v.videoWidth > 0).length")
        check('guest receives video', flow >= 1, flow)
        await guest.screenshot(path=OUT + 'guest-room-1440.png')
        ctl = await guest.inner_text('#rm-ctl')
        check('guest has no Favor Brain, record or captions', 'Favor Brain' not in ctl and 'Record' not in ctl and 'Captions' not in ctl, ctl.replace('\n', ' '))
        # staff-only endpoints refuse the guest token
        for path in ['meetings', f'meetings/{mid}', f'meetings/{mid}/brain', f'meetings/{mid}/notes', f'meetings/{mid}/rec/status?pid={gpid}']:
            st = await guest.evaluate("""async ([p, tok]) => (await fetch('/api/meet-guest/' + p, {headers: {'X-Guest-Token': tok}})).status""", [path, gtoken])
            check(f'guest door refuses {path.split("?")[0]}', st == 404, st)
        st = await guest.evaluate("""async ([p, tok]) => (await fetch('/api/meet/' + p, {headers: {'X-Guest-Token': tok}})).status""", ['meetings', gtoken])
        check('staff door refuses a guest', st in (401, 302), st)
        # a Brain post to chat is hidden from the guest
        await host.click('[data-a=panel][data-p=chat]')
        await host.evaluate("async ([mid, pid]) => { await fetch(`/api/meet/meetings/${mid}/event`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({pid, kind: 'chat', body: {text: 'secret partner total $9,999', ai: true}})}); }", [mid, await host.evaluate("() => window.__meet.S.me.pid")])
        await host.evaluate("async ([mid, pid]) => { await fetch(`/api/meet/meetings/${mid}/event`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({pid, kind: 'chat', body: {text: 'hello everyone'}})}); }", [mid, await host.evaluate("() => window.__meet.S.me.pid")])
        await guest.click('[data-a=panel][data-p=chat]'); await guest.wait_for_timeout(3000)
        gt = await guest.inner_text('#rm-body')
        check('guest sees plain chat, not the Brain post', 'hello everyone' in gt and '9,999' not in gt, gt[:100])
        # host removes the guest
        host.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await host.click('[data-a=panel][data-p=people]'); await host.wait_for_timeout(1000)
        await host.click('[data-a=pmenu]'); await host.click('.menu [data-c=remove]'); await guest.wait_for_timeout(3500)
        gt = await guest.inner_text('#meet-root'); check('guest removed', 'removed' in gt.lower(), gt[:80])
        # rate limit
        codes = []
        for i in range(15):
            codes.append(await guest.evaluate("""async ([mid]) => (await fetch(`/api/meet-guest/meetings/${mid}/join`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({k: 'bad', name: 'X Y'})})).status""", [mid]))
        check('join attempts rate limited', 429 in codes, codes)
        print('errs', errs[:2], host.errs[:2])
        await b.close()
    print('FAILED:', [n for n, ok in R if not ok] or 'none')
asyncio.run(go())
