import asyncio, sys, json
sys.argv = [sys.argv[0], 'http://127.0.0.1:8837']
exec(open('e2e_room.py', encoding='utf8').read().split("async def main():")[0])
PROBE = """() => { const out = []; const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push('sideways ' + document.documentElement.scrollWidth + ' > ' + vw);
  for (const el of document.querySelectorAll('main *, .rm *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 2 && getComputedStyle(el).position !== 'fixed' && !el.closest('.fb, .tr, .rm-ctl, table, .menu')) { out.push('past right: ' + el.tagName + '.' + el.className.toString().slice(0, 40) + ' ' + Math.round(r.right)); if (out.length > 6) break; } }
  const t = []; for (const el of document.querySelectorAll('main h2, main h4, main b, main button, main .h-btn')) { if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow === 'visible' && el.clientWidth) t.push(el.textContent.trim().slice(0, 30)); if (t.length > 4) break; }
  if (t.length) out.push('text past box: ' + t.join(' | '));
  return out; }"""
async def go():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='msedge', args=FAKE)
        for vw, vh, tag in ((1440, 900, 'd'), (390, 844, 'm')):
            hctx, host = await mk(b, 'host@favorintl.org', 'Hannah Price', vw, vh)
            await host.goto(BASE + '/meet/', wait_until='networkidle')
            r = await api(host, 'meetings', 'POST', {'title': 'QA meeting', 'rec': 'notes', 'access': 'staff'}); mid = r['json']['meeting']['id']
            pages = [('home', '/meet/'), ('book', '/meet/book/'), ('library', '/meet/library/'), ('lobby', f'/meet/room/?m={mid}')]
            for name, path in pages:
                await host.goto(BASE + path, wait_until='networkidle'); await host.wait_for_timeout(1500)
                issues = await host.evaluate(PROBE)
                await host.screenshot(path=OUT + f'qa-{name}-{tag}.png', full_page=True)
                print(tag, name, issues or 'clean')
            await join(host, mid, 'Hannah Price'); await host.wait_for_timeout(3000)
            for panel in ('chat', 'people', 'brain'):
                sel = f'#rm-side [data-p={panel}]'
                await host.click(sel if await host.locator(sel).count() and await host.locator('#rm-side').is_visible() else f'#rm-ctl [data-p={panel}]'); await host.wait_for_timeout(500)
                issues = await host.evaluate(PROBE); await host.screenshot(path=OUT + f'qa-room-{panel}-{tag}.png')
                print(tag, 'room', panel, issues or 'clean')
            await hctx.close()
        await b.close()
asyncio.run(go())
