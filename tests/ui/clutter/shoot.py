"""Shoot every hub screen for the clutter grader.

For each screen in screens.json and each device (phone 440x893 in WebKit, desktop 1440x900 in Edge)
this opens Today, clicks through the menu to the screen the way staff do, waits until the screen stops
changing, then saves shot.png, elements.json (extract.js, the ClutterBench element list) and meta.json.

  python tests/ui/clutter/shoot.py <round> [--only substr] [--device phone|desktop]

Environment:
  HUB           site to shoot, for example https://clutter.favor-hub-d4n.pages.dev (default production)
  CLUTTER_OUT   where runs are written (default Q:\\Temp\\Will\\hub-agents-2026-10-11\\clutter). The repo is
                public and these files show real pages, so this folder must stay outside the repo.
  ASSETS        a preview deployment, for example https://clutter.favor-hub-d4n.pages.dev. Pages, scripts and styles
                then come from that build while /api/ calls still go to HUB. A preview cannot read the Blackbaud
                copy, so this is how a branch is graded with the same data staff see. Reads only.
  HUB_COOKIES   saved admin session (default Q:\\Temp\\Will\\mobile\\cookies-dash.json). The script never signs in.
"""
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get('HUB', 'https://dash.favorintl.org').rstrip('/')
OUT = os.environ.get('CLUTTER_OUT', r'Q:\Temp\Will\hub-agents-2026-10-11\clutter')
ASSETS = os.environ.get('ASSETS', '').rstrip('/')
COOKIES = os.environ.get('HUB_COOKIES', r'Q:\Temp\Will\mobile\cookies-dash.json')
EXTRACT = open(os.path.join(HERE, 'extract.js'), encoding='utf-8').read()
EXTRACT_FN = EXTRACT[EXTRACT.index('function extractInPage'):]
CONF = json.load(open(os.path.join(HERE, 'screens.json'), encoding='utf-8'))
DEVICES = {'phone': (440, 893, 2), 'desktop': (1440, 900, 1)}


def arg(name, default=None):
    return sys.argv[sys.argv.index('--' + name) + 1] if '--' + name in sys.argv else default


async def settle(pg, quiet=3, limit=12000):
    """Wait until the element count and the text length hold still for three checks in a row."""
    try:
        await pg.wait_for_load_state('networkidle', timeout=8000)
    except Exception:
        pass
    last, same, waited = None, 0, 0
    while waited < limit and same < quiet:
        await pg.wait_for_timeout(350)
        waited += 350
        try:
            now = await pg.evaluate("[document.querySelectorAll('*').length, document.body.innerText.length, location.href].join('|')")
        except Exception:
            now = None
        same = same + 1 if now == last else 0
        last = now
    try:
        await pg.evaluate('document.fonts.ready')
    except Exception:
        pass
    await pg.wait_for_timeout(400)


async def click_visible(pg, selector):
    loc = pg.locator(selector).locator('visible=true')
    if await loc.count() == 0:
        return False
    try:
        await loc.first.click(timeout=4000)
    except Exception:
        return False
    return True


async def here(pg):
    return await pg.evaluate('location.pathname + location.search')


async def nav_to(pg, scr):
    """Reach a page from Today by clicking: a link on the screen, or the area in the menu and then the page tab."""
    href, area = scr['href'], scr['area']
    if await here(pg) == href:
        return 'click'
    link = f'a[href="{href}"]'
    if await click_visible(pg, f'#h-bar {link}, .h-areas {link}, .h-top {link}'):
        await settle(pg)
        if await here(pg) == href:
            return 'click'
    area_link = f'#h-bar [data-area-link="{area}"], .h-areas [data-area-link="{area}"], #h-side [data-area-link="{area}"]'
    if await here(pg) == '/':
        if not await click_visible(pg, area_link):
            await click_visible(pg, '#h-bar-more')
            await pg.wait_for_timeout(600)
            await click_visible(pg, area_link)
    await settle(pg)
    if await here(pg) != href:
        if not await click_visible(pg, f'#h-tabs-slot {link}, .h-tabs {link}, header {link}'):
            # phone: the page list sits under its area in the More sheet
            await click_visible(pg, '#h-bar-more')
            await pg.wait_for_timeout(600)
            if not await click_visible(pg, f'#h-side {link}'):
                await click_visible(pg, f'#h-side .h-area[data-area="{area}"] button')
                await pg.wait_for_timeout(400)
                await click_visible(pg, f'#h-side {link}')
        await settle(pg)
    if await here(pg) != href:
        await click_visible(pg, link)
        await settle(pg)
    if await here(pg) != href:
        await pg.goto(BASE + href, wait_until='domcontentloaded')
        await settle(pg)
        return 'goto'
    return 'click'


async def run_steps(pg, steps):
    for st in steps:
        kind, _, rest = st.partition(':')
        if kind == 'click':
            if not await click_visible(pg, rest):
                raise RuntimeError('nothing to click for ' + rest)
        elif kind == 'try':
            await click_visible(pg, rest)
        elif kind == 'wait':
            await pg.wait_for_timeout(int(rest))
        elif kind == 'press':
            await pg.keyboard.press(rest)
        elif kind == 'type':
            await pg.keyboard.type(rest, delay=20)
        elif kind == 'for':
            await pg.wait_for_selector(rest, state='visible', timeout=20000)
        await settle(pg, limit=6000)


async def one(pg, scr, device, d, rid, host, direct=False):
    w, h, scale = DEVICES[device]
    await pg.goto(BASE + '/', wait_until='domcontentloaded', timeout=60000)
    await settle(pg)
    if direct:
        # second try after a crash or a hang on the way in: open the address itself
        await pg.goto(BASE + scr['href'], wait_until='domcontentloaded', timeout=60000)
        await settle(pg)
        arrived = 'goto'
    else:
        arrived = await nav_to(pg, scr)
    steps = scr.get('steps_' + device, scr.get('steps', []))
    await run_steps(pg, steps)
    await settle(pg)
    root = scr.get('root_' + device, scr.get('root', CONF['pageRoot']))
    try:
        # a page can still be drawing after the network goes quiet; wait for the graded part to hold text
        await pg.wait_for_function('(sel) => [...document.querySelectorAll(sel)].some((r) => r.innerText && r.innerText.trim().length > 0)', arg=root, timeout=10000)
        await settle(pg, limit=4000)
    except Exception:
        pass
    await pg.screenshot(path=os.path.join(d, 'shot.png'))
    elements = await pg.evaluate(f'({EXTRACT_FN})({w}, {h}, {json.dumps(root)})')
    if not elements:
        raise RuntimeError('no elements under ' + root)
    title = await pg.evaluate("(document.querySelector('.h-top h1, .h-top__title, #h-title') || {}).textContent || document.title")
    texts = [e for e in elements if e['kind'] == 'text']
    stats = {'elements': len(elements), 'textElements': len(texts), 'words': sum(len(e['text'].split()) for e in texts)}
    meta = {'id': rid, 'screen': scr['id'], 'name': scr['name'], 'job': scr['job'], 'device': device, 'canvas': {'w': w, 'h': h},
            'url': await here(pg), 'host': host, 'assets': ASSETS, 'arrived': arrived, 'root': root, 'topBarTitle': ' '.join(title.split()), 'overlay': bool(scr.get('overlay'))}
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    json.dump({'canvas': meta['canvas'], 'stats': stats, 'elements': elements}, open(os.path.join(d, 'elements.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(rid, arrived, json.dumps(stats), flush=True)


async def shoot(p, device, screens, rnd):
    w, h, scale = DEVICES[device]
    if device == 'phone':
        dev = dict(p.devices['iPhone 15 Pro Max'])
        dev['viewport'] = {'width': w, 'height': h}
        dev['device_scale_factor'] = scale
        browser = await p.webkit.launch()
        ctx = await browser.new_context(**dev, service_workers='block')
    else:
        browser = await p.chromium.launch(channel='msedge')
        ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=scale, service_workers='block')
    cookies = json.load(open(COOKIES))
    host = BASE.split('//')[1]
    for c in cookies:
        c['domain'] = host
    await ctx.add_cookies(cookies)
    if ASSETS:
        for c in cookies:
            c['domain'] = ASSETS.split('//')[1]
        await ctx.add_cookies(cookies)

        async def from_branch(route):
            req = route.request
            path = req.url[len(BASE):]
            if req.method != 'GET' or path.startswith('/api/') or path.startswith('/c/'):
                return await route.continue_()
            try:
                # a plain request to the branch build (route.fetch would keep the production Host header)
                resp = await ctx.request.get(ASSETS + path, timeout=30000)
                headers = {k: v for k, v in resp.headers.items() if k.lower() not in ('set-cookie', 'content-encoding', 'content-length', 'transfer-encoding')}
                body = await resp.body()
                if 'text/html' in headers.get('content-type', ''):
                    # Edge prerenders menu links from the page's speculation rules, and a prerender fetches straight
                    # from HUB, past this route. Without the rules every page comes from the branch build.
                    body = re.sub(rb'<script type="speculationrules".*?</script>', b'', body, flags=re.S)
                await route.fulfill(status=resp.status, headers=headers, body=body)
            except Exception as e:
                print('  asset fell back to', BASE, path[:80], str(e)[:80], flush=True)
                await route.continue_()
        await ctx.route(BASE + '/**', from_branch)
    for scr in screens:
        if device not in scr.get('devices', ['phone', 'desktop']):
            continue
        rid = f"{scr['id']}__{device}"
        d = os.path.join(OUT, rnd, rid)
        os.makedirs(d, exist_ok=True)
        pg = await ctx.new_page()
        for attempt in (1, 2):
            if attempt == 2:
                # WebKit now and then crashes or hangs on a page; a fresh tab clears it
                try:
                    await asyncio.wait_for(pg.close(), timeout=10)
                except Exception:
                    pass
                pg = await ctx.new_page()
            try:
                await asyncio.wait_for(one(pg, scr, device, d, rid, host, direct=attempt == 2), timeout=150)
                break
            except asyncio.TimeoutError:
                print('FAIL', rid, 'timed out', flush=True)
            except Exception as e:
                print('FAIL', rid, str(e)[:200], flush=True)
        try:
            await asyncio.wait_for(pg.close(), timeout=10)
        except Exception:
            pass
    await browser.close()


async def main():
    rnd = sys.argv[1]
    only, one = arg('only'), arg('device')
    screens = [s for s in CONF['screens'] if not only or any(o in s['id'] for o in only.split(','))]
    async with async_playwright() as p:
        await asyncio.gather(*[shoot(p, dv, screens, rnd) for dv in DEVICES if not one or one == dv])


asyncio.run(main())
