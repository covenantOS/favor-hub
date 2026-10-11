"""Break-UI harness for the hub. Dev only: nothing here ships in the site build.

Opens a hub page in Playwright and answers every /api/* call the page makes with an invented fixture
(fixtures.py), so the page renders Demo data, the Worst case, Empty, One, or 1,000 rows without a
row of that data existing in D1 or Blackbaud. Writes never reach the server: every non-GET call gets
a canned reply.

  python scripts/break-ui/harness.py list
  python scripts/break-ui/harness.py shot work-asks --data worst --dev phone
  python scripts/break-ui/harness.py sweep --out Q:/Temp/Will/break-ui-shots
  python scripts/break-ui/harness.py open chat --data worst          (headed, with the toggle)

The page reads nothing from this harness. The switch is the ?data= value in the address bar, which
the harness reads when it answers a call: demo, worst, empty, one, huge. In `open` mode a small
segmented control at the bottom of the window flips it and reloads. ?badges=N sets every menu count.

BASE picks the site: the local dev server by default (npx astro dev --port 4471), or a preview
deploy (HUB=https://break-ui.favor-hub-d4n.pages.dev) with the saved admin cookie.
"""
import argparse, asyncio, json, os, re, sys, time

if os.path.isdir('Q:/work/pw-browsers'):
    os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', 'Q:/work/pw-browsers')
from urllib.parse import urlparse, parse_qs, urlencode
from playwright.async_api import async_playwright

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fixtures as FX  # noqa: E402
from pages import PAGES  # noqa: E402

BASE = os.environ.get('HUB', 'http://127.0.0.1:4471').rstrip('/')
COOKIES = os.environ.get('HUB_COOKIES', r'Q:\Temp\Will\mobile\cookies-dash.json')
# Stylesheets of the clip watch shell, kept in step with functions/c/[id].ts.
CLIP_CSS = '<link rel="stylesheet" href="/js/clips/watch.css?v=3"><link rel="stylesheet" href="/js/clips/crit-watch.css?v=1"><link rel="stylesheet" href="/js/clips/launcher.css?v=5">'
MODES = ['demo', 'worst', 'empty', 'one', 'huge']
LABELS = {'demo': 'Demo data', 'worst': 'Worst case', 'empty': 'Empty', 'one': 'One', 'huge': '1,000 rows'}

BROWSERS = {}

DEVICES = {
    # name: (engine, context options)
    'phone': ('webkit', {'device': 'iPhone 15 Pro Max', 'viewport': {'width': 440, 'height': 893}}),
    'phone-edge': ('msedge', {'viewport': {'width': 440, 'height': 893}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2,
                              'user_agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}),
    'w320': ('msedge', {'viewport': {'width': 320, 'height': 640}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2}),
    'ipad': ('webkit', {'viewport': {'width': 820, 'height': 1180}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2}),
    'ipad-land': ('webkit', {'viewport': {'width': 1180, 'height': 820}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2}),
    'desk': ('msedge', {'viewport': {'width': 1440, 'height': 900}}),
    'wide': ('msedge', {'viewport': {'width': 2560, 'height': 1300}}),
    # Browser zoom at 200% on a 1440 window is a 720 px layout at twice the pixels.
    'zoom': ('msedge', {'viewport': {'width': 720, 'height': 450}, 'device_scale_factor': 2}),
}

TOGGLE_JS = r"""
(() => {
  const MODES = %s, LABELS = %s;
  const add = () => {
    if (document.getElementById('bui-toggle') || !document.body) return;
    const cur = new URLSearchParams(location.search).get('data') || window.__buiMode || 'demo';
    const bar = document.createElement('div');
    bar.id = 'bui-toggle';
    bar.style.cssText = 'position:fixed;left:50%%;bottom:12px;transform:translateX(-50%%);z-index:2147483647;display:flex;gap:2px;padding:3px;border-radius:9px;background:#e4e4e7;font:500 12px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.25)';
    MODES.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = LABELS[m];
      b.style.cssText = 'all:unset;cursor:pointer;padding:6px 10px;border-radius:7px;color:#27272a;white-space:nowrap;' + (m === cur ? 'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2)' : '');
      b.onclick = () => { const u = new URL(location.href); u.searchParams.set('data', m); location.href = u.toString(); };
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  };
  document.addEventListener('DOMContentLoaded', add); setInterval(add, 800);
})();
"""

# What the eye would catch in a screenshot, measured: sideways page scroll, boxes past the viewport edge,
# text spilling out of its own box, clipped text, wrapped badges, squashed avatars, raw undefined or NaN,
# and a count of exactly one with a plural noun.
AUDIT_JS = r"""
(() => {
  const vw = document.documentElement.clientWidth, out = { vw, chars: (document.body.innerText || '').trim().length, docScroll: document.documentElement.scrollWidth, off: [], spill: [], clip: [], ellip: [], wrap: [], squash: [], raw: [], plural: [], tiny: [] };
  const path = (el) => { const p = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) p.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); return p.join(' > '); };
  const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const scrollerX = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1) return e; if (/(hidden|clip)/.test(s.overflowX) && e.getBoundingClientRect().right <= vw + 1) return e; } return null; };
  const own = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const seen = new Set(); const push = (k, el, extra) => { const p = path(el); const key = k + p; if (seen.has(key)) return; seen.add(key); if (out[k].length < 25) out[k].push(Object.assign({ el: p, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70) }, extra || {})); };
  const skip = (el) => el.closest('#bui-toggle, script, style, noscript, [hidden], [aria-hidden="true"], .sr-only, .visually-hidden');
  document.querySelectorAll('body *').forEach((el) => {
    if (skip(el) || !vis(el)) return;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (s.position === 'fixed' && (r.right <= 0 || r.left >= vw)) return;
    if ((r.right > vw + 1.5 || r.left < -1.5) && r.width < vw * 3 && !scrollerX(el)) push('off', el, { left: Math.round(r.left), right: Math.round(r.right) });
    const t = own(el);
    if (t) {
      const clipX = /(hidden|clip)/.test(s.overflowX), clipY = /(hidden|clip)/.test(s.overflowY);
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && s.display !== 'inline') {
        if (clipX && s.textOverflow === 'ellipsis') { if (!el.title && !el.closest('[title]') && !el.getAttribute('aria-label')) push('ellip', el); }
        else if (clipX) push('clip', el, { sw: el.scrollWidth, cw: el.clientWidth });
        else if (!/(auto|scroll)/.test(s.overflowX)) push('spill', el, { sw: el.scrollWidth, cw: el.clientWidth });
      }
      if (clipY && !/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 3 && !s.webkitLineClamp.match(/\d/) && s.textOverflow !== 'ellipsis') push('clip', el, { sh: el.scrollHeight, ch: el.clientHeight });
      if (/\b(undefined|NaN|Invalid Date)\b|\[object Object\]|(^|[\s$])null($|\s)/.test(t)) push('raw', el);
      if (/(^|[^\d.,:/$-])1 (?!of\b|in\b|to\b|on\b|at\b|or\b|and\b|more\b|is\b|was\b)[a-z-]{3,}s\b(?!')/.test(t) && !/1 (days? ago|hours|minutes|seconds)?$/.test('')) push('plural', el);
      const fs = parseFloat(s.fontSize); if (fs && fs < 11) push('tiny', el, { px: fs });
    }
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(badge|chip|pill|tag|count|status|state|__n\b|lozenge|flag)/i.test(cls) && t && !/\n/.test(t)) {
      const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.3;
      if (r.height > lh * 1.9 + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) && t.length < 60) push('wrap', el, { h: Math.round(r.height) });
    }
    if (/(avatar|\bav\b|__av\b|-av\b|initial|__face|__dot\b)/i.test(cls) || (el.tagName === 'IMG' && /avatar|face|picture/i.test(cls + ' ' + (el.parentElement && el.parentElement.className)))) {
      if (r.width > 8 && r.height > 8 && Math.abs(r.width - r.height) > 2 && Math.max(r.width, r.height) < 120) push('squash', el, { w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  return out;
})()
"""


def mode_of(url, state):
    q = parse_qs(urlparse(url).query)
    if q.get('data') and q['data'][0] in MODES:
        state['mode'] = q['data'][0]
    if q.get('badges'):
        state['badges'] = q['badges'][0]
    return state['mode']


async def new_context(p, dev, state, headed=False):
    engine, opts = DEVICES[dev]
    opts = dict(opts)
    if 'device' in opts:
        d = dict(p.devices[opts.pop('device')]); d.update(opts); opts = d
    # One browser per engine for the whole run; every view still gets a fresh context.
    key = (engine, headed)
    if key not in BROWSERS:
        BROWSERS[key] = await (p.webkit.launch(headless=not headed) if engine == 'webkit' else p.chromium.launch(channel='msedge', headless=not headed))
    b = BROWSERS[key]
    ctx = await b.new_context(service_workers='block', **opts)
    host = urlparse(BASE).hostname
    if host not in ('127.0.0.1', 'localhost') and os.path.exists(COOKIES):
        cookies = json.load(open(COOKIES))
        for c in cookies:
            c['domain'] = host; c.pop('sameSite', None) if c.get('sameSite') not in ('Strict', 'Lax', 'None') else None
        await ctx.add_cookies(cookies)
    misses = state.setdefault('misses', [])

    async def handle(route):
        req = route.request
        u = urlparse(req.url)
        if not u.path.startswith('/api/'):
            return await route.continue_()
        try:
            page_url = req.frame.page.url
        except Exception:
            page_url = ''
        mode = mode_of(page_url, state) if page_url and page_url != 'about:blank' else state['mode']
        try:
            res = FX.answer(req.method, u.path, parse_qs(u.query), mode, state)
        except Exception as e:  # a fixture bug must show up in the report, never hang the page
            misses.append('FIXTURE ERROR ' + u.path + ' ' + repr(e)[:160])
            res = None
        if res is None:
            misses.append(req.method + ' ' + u.path + ('?' + u.query if u.query else ''))
            return await route.fulfill(status=404, content_type='application/json', body='{"ok":false,"message":"No fixture"}')
        status, ctype, body = res
        await route.fulfill(status=status, content_type=ctype, body=body)

    await ctx.route(re.compile(r'.*/api/.*'), handle)

    # Two pages are drawn by Pages Functions, which the local dev server does not run. The harness hands the
    # browser the same shell: the partner page for any id, and the clip watch page (functions/c/[id].ts).
    async def partner_doc(route):
        if route.request.resource_type != 'document':
            return await route.continue_()
        res = await ctx.request.get(BASE + '/work/partner/')
        await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=await res.text())

    async def clip_doc(route):
        if route.request.resource_type != 'document':
            return await route.continue_()
        cid = urlparse(route.request.url).path.rstrip('/').split('/')[-1]
        html = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clip - Favor Hub</title>'
                '<link rel="icon" type="image/png" href="/images/favor-icon.png">' + CLIP_CSS +
                '</head><body><div class="cw"><header class="cw-top"><a href="https://www.favorintl.org"><img src="/images/favor-logo-color.png" alt="Favor International"></a>'
                '<span class="cw-top__r" id="cw-topr"><a class="cw-hub" href="/clips/">My clips</a><a class="cw-hub" href="/">Favor Hub</a></span></header>'
                '<main class="cw-main" id="cw-main" data-id="' + cid + '"><div class="cw-loading" id="cw-loading" role="status"><i></i>Loading the clip</div></main>'
                '<footer class="cw-foot">Favor International</footer></div><script type="module" src="/js/clips/watch.js?v=3"></script></body></html>')
        await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)

    if host in ('127.0.0.1', 'localhost'):
        await ctx.route(re.compile(r'.*/work/partner/\d+/?(\?.*)?$'), partner_doc)
    await ctx.route(re.compile(r'.*/c/[0-9a-f]{32}/?(\?.*)?$'), clip_doc)
    # Live chat sockets and event streams never leave the machine.
    try:
        await ctx.route_web_socket(re.compile(r'.*'), lambda ws: None)
    except Exception:
        pass
    await ctx.add_init_script('window.__buiMode = %s;' % json.dumps(state['mode']))
    if headed:
        await ctx.add_init_script(TOGGLE_JS % (json.dumps(MODES), json.dumps(LABELS)))
    return b, ctx


def page_url(name, mode, extra=None):
    spec = PAGES[name]
    path = spec['path']
    sep = '&' if '?' in path else '?'
    q = {'data': mode}
    if extra:
        q.update(extra)
    return BASE + path + sep + urlencode(q)


async def run_steps(pg, spec, dev):
    """Steps are (kind, value) pairs: click a selector, wait for one, run JS, press a key, or pause."""
    for step in spec.get('steps', []):
        kind, val = step[0], step[1]
        only = step[2] if len(step) > 2 else None
        if only and dev not in only:
            continue
        try:
            if kind == 'click':
                await pg.locator(val).first.click(timeout=6000)
            elif kind == 'wait':
                await pg.wait_for_selector(val, timeout=8000)
            elif kind == 'js':
                await pg.evaluate(val)
            elif kind == 'press':
                await pg.keyboard.press(val)
            elif kind == 'type':
                await pg.keyboard.type(val)
            elif kind == 'sleep':
                await pg.wait_for_timeout(val)
        except Exception as e:  # a step that cannot run is itself a finding
            print('   step failed:', kind, str(val)[:60], '|', str(e).split('\n')[0][:120])
        await pg.wait_for_timeout(250)


async def shoot(p, name, mode, dev, out, extra=None, full=True, arrive=False, tag=''):
    state = {'mode': mode, 'badges': None}
    b, ctx = await new_context(p, dev, state)
    pg = await ctx.new_page()
    errs, dialogs = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.on('dialog', lambda d: (dialogs.append(d.message), asyncio.ensure_future(d.dismiss())))
    spec = PAGES[name]
    url = page_url(name, mode, extra)
    if arrive:
        # Arrive by tapping from another page, the way staff do, so the page-swap path is the one under test.
        start = spec.get('from', '/help/')
        await pg.goto(BASE + start + ('&' if '?' in start else '?') + 'data=' + mode, wait_until='networkidle', timeout=60000)
        await pg.wait_for_timeout(600)
        target = urlparse(url)
        ok = await pg.evaluate("""(href) => { const a = Array.from(document.querySelectorAll('a[href]')).find((x) => { try { return new URL(x.href).pathname === href; } catch (e) { return false; } }); if (!a) return false; a.click(); return true; }""", target.path)
        if not ok:
            await pg.goto(url, wait_until='networkidle', timeout=60000)
        else:
            await pg.wait_for_timeout(1800)
    else:
        try:
            await pg.goto(url, wait_until='networkidle', timeout=60000)
        except Exception as e:
            print('   goto:', str(e).split('\n')[0][:140])
    await pg.wait_for_timeout(spec.get('settle', 900))
    await run_steps(pg, spec, dev)
    await pg.wait_for_timeout(500)
    audit = await pg.evaluate(AUDIT_JS)
    os.makedirs(out, exist_ok=True)
    fn = os.path.join(out, f"{tag}{name}-{mode}-{dev}{'-tap' if arrive else ''}.png")
    shot_err = ''
    for attempt in range(4):
        try:
            data = await pg.screenshot(full_page=full and spec.get('full', True) and attempt == 0, animations='disabled', timeout=20000)
            if data:
                open(fn, 'wb').write(data)
                break
        except Exception as e:  # WebKit now and then fails a capture; shoot again, viewport only
            shot_err = str(e).splitlines()[0][:120]
        await pg.wait_for_timeout(500)
    else:
        print('   no screenshot:', shot_err)
    await ctx.close()
    audit.update({'page': name, 'mode': mode, 'dev': dev, 'shot': fn, 'errors': errs, 'dialogs': dialogs, 'misses': sorted(set(state.get('misses', [])))})
    return audit


def brief(a):
    keys = ['off', 'spill', 'clip', 'wrap', 'squash', 'raw', 'plural']
    bits = [f"{k}={len(a[k])}" for k in keys if a[k]]
    over = a['docScroll'] - a['vw']
    if over > 1:
        bits.insert(0, f"PAGE SCROLLS SIDEWAYS +{over}px")
    if a.get('chars', 999) < 40:
        bits.insert(0, 'BLANK PAGE')
    if a['errors']:
        bits.append(f"jsErrors={len(a['errors'])}")
    if a['dialogs']:
        bits.append('DIALOG FIRED')
    if a['misses']:
        bits.append(f"noFixture={len(a['misses'])}")
    return ', '.join(bits) or 'clean'


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['list', 'shot', 'sweep', 'open'])
    ap.add_argument('pages', nargs='*')
    ap.add_argument('--data', default=None, help='demo, worst, empty, one, huge; comma separated. shot: worst. sweep: all five.')
    ap.add_argument('--dev', default='phone')
    ap.add_argument('--out', default=os.environ.get('BUI_OUT', r'Q:\Temp\Will\hub-agents-2026-10-11\break-ui\shots'))
    ap.add_argument('--tag', default='')
    ap.add_argument('--badges', default=None)
    ap.add_argument('--tap', action='store_true', help='arrive by tapping a link on another page')
    ap.add_argument('--verbose', '-v', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'list':
        for k, v in PAGES.items():
            print(f"{k:22} {v['path']:34} {v.get('about', '')}")
        return
    extra = {'badges': a.badges} if a.badges is not None else None
    async with async_playwright() as p:
        if a.cmd == 'open':
            a.data = a.data or 'worst'
            state = {'mode': a.data, 'badges': a.badges}
            b, ctx = await new_context(p, a.dev, state, headed=True)
            pg = await ctx.new_page()
            await pg.goto(page_url(a.pages[0], a.data, extra))
            await run_steps(pg, PAGES[a.pages[0]], a.dev)
            print('Toggle is at the bottom of the window. Close the browser to end.')
            await pg.wait_for_event('close', timeout=0)
            return
        names = a.pages or list(PAGES)
        modes = a.data.split(',') if a.data else (['worst'] if a.cmd == 'shot' else MODES)
        devs = a.dev.split(',') if (a.cmd == 'shot' or a.dev != 'phone') else ['phone', 'phone-edge', 'w320', 'ipad', 'desk', 'wide', 'zoom']
        report = []
        for name in names:
            for mode in modes:
                for dev in devs:
                    r = await shoot(p, name, mode, dev, a.out, extra, arrive=a.tap, tag=a.tag)
                    report.append(r)
                    print(f"{name:20} {mode:6} {dev:10} {brief(r)}")
                    if a.verbose:
                        for k in ['off', 'spill', 'clip', 'wrap', 'squash', 'raw', 'plural', 'errors', 'misses', 'dialogs']:
                            for item in r[k][:12]:
                                print('     ', k, json.dumps(item, ensure_ascii=False)[:230])
        json.dump(report, open(os.path.join(a.out, f"{a.tag}report-{int(time.time())}.json"), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        bad = [r for r in report if brief(r) != 'clean']
        print(f"\n{len(report)} views, {len(bad)} with findings. Screenshots in {a.out}")


if __name__ == '__main__':
    asyncio.run(main())
