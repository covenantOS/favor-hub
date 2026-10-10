"""Live transcript, captions, Favor Brain in the call (what did I miss, a question, post to chat, show on screen)."""
import asyncio, sys, json
sys.argv = [sys.argv[0], 'http://127.0.0.1:8837']
exec(open('e2e_room.py', encoding='utf8').read().split("async def main():")[0])
WAV = 'Q:/work/favor-meet-p0/speech.wav'

async def go():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='msedge', args=FAKE + ['--use-file-for-fake-audio-capture=' + WAV])
        b2 = await p.chromium.launch(channel='msedge', args=FAKE + ['--use-file-for-fake-audio-capture=Q:/work/favor-meet-p0/silence.wav'])
        hctx, host = await mk(b, 'host@favorintl.org', 'Hannah Price')
        actx, ann = await mk(b2, 'ann@favorintl.org', 'Ann Bell')
        await host.goto(BASE + '/meet/', wait_until='networkidle')
        r = await api(host, 'meetings', 'POST', {'title': 'Support Team weekly', 'rec': 'notes', 'access': 'staff'})
        mid = r['json']['meeting']['id']
        await join(host, mid, 'Hannah Price'); await join(ann, mid, 'Ann Bell')
        await ann.wait_for_timeout(50000)
        lines = await ann.evaluate("() => window.__meet.S.lines")
        check('live lines reach a participant', len(lines) >= 2, [l['text'][:40] for l in lines][:3])
        check('speaker named on lines', any(l.get('who') for l in lines), [l.get('who') for l in lines][:5])
        # captions
        await ann.click('[data-a=cc]'); await ann.wait_for_timeout(2500)
        cap = await ann.evaluate("() => { const c = document.querySelector('#rm-cap'); return c && !c.hidden ? c.innerText : null }")
        check('captions show', cap, cap)
        await ann.screenshot(path=OUT + 'live-captions-1440.png')
        # brain: what did I miss
        await ann.click('[data-a=panel][data-p=brain]'); await ann.click('[data-a=ask][data-k=missed]')
        await ann.wait_for_function("() => window.__meet.S.brainQ.length && window.__meet.S.brainQ[0].state !== 'working'", timeout=60000)
        q0 = await ann.evaluate("() => window.__meet.S.brainQ[0]")
        check('what did I miss answered', q0['state'] == 'done' and len(q0.get('markdown', '')) > 20, (q0.get('markdown') or q0.get('error') or '')[:160])
        # typed question to the Brain (stub)
        await ann.fill('#brainin', 'fall letter number'); await ann.keyboard.press('Enter')
        await ann.wait_for_function("() => window.__meet.S.brainQ.length > 1 && window.__meet.S.brainQ[1].state !== 'working'", timeout=30000)
        q1 = await ann.evaluate("() => window.__meet.S.brainQ[1]")
        check('brain question answered with blocks', q1['state'] == 'done' and len(q1.get('blocks', [])) == 2, q1.get('error'))
        await ann.screenshot(path=OUT + 'live-brain-1440.png')
        # post to chat, show on screen
        await ann.click('[data-a=brain-post][data-i="1"]'); await host.wait_for_timeout(2500)
        await host.click('[data-a=panel][data-p=chat]'); t = await host.inner_text('#rm-body')
        check('posted to chat labelled', 'Favor Brain, posted by' in t and '48,210' in t, t[:100])
        await ann.click('[data-a=brain-show][data-i="1"]'); await host.wait_for_timeout(3000)
        shown = await host.evaluate("() => !!document.querySelector('#rm-brain-tile .bc-show__b')")
        check('shown on host screen', shown)
        await host.screenshot(path=OUT + 'live-brain-show-1440.png')
        await ann.click('[data-a=brain-stop]'); await host.wait_for_timeout(2500)
        check('stop showing', not await host.evaluate("() => !!document.querySelector('#rm-brain-tile')"))
        print('errs', host.errs[:2], ann.errs[:2])
        await b.close()
    print('FAILED:', [n for n, ok in R if not ok] or 'none')
asyncio.run(go())
