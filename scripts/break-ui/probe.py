"""Run one JS expression on a harness page and print the result.
  python scripts/break-ui/probe.py brain "document.title" [--data worst] [--dev desk]"""
import argparse, asyncio, json
from playwright.async_api import async_playwright
import harness as H


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('page'); ap.add_argument('js')
    ap.add_argument('--data', default='worst'); ap.add_argument('--dev', default='desk')
    a = ap.parse_args()
    async with async_playwright() as p:
        state = {'mode': a.data, 'badges': None}
        b, ctx = await H.new_context(p, a.dev, state)
        pg = await ctx.new_page()
        logs = []
        pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:300]) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: logs.append('pageerror: ' + str(e)[:300]))
        await pg.goto(H.page_url(a.page, a.data), wait_until='networkidle', timeout=60000)
        await pg.wait_for_timeout(H.PAGES[a.page].get('settle', 900))
        await H.run_steps(pg, H.PAGES[a.page], a.dev)
        print(json.dumps(await pg.evaluate(a.js), ensure_ascii=False, indent=1)[:6000])
        for line in logs[:20]:
            print(line)
        print('misses:', sorted(set(state.get('misses', []))))
        await ctx.close()
        await b.close()

asyncio.run(main())
