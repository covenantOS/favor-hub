"""Recording to Drive and notes: the host speaks (a wav through the fake microphone), two people record and one leaves, the room
empties, the pump saves the recording to Drive and makes notes. Local hub on 8837 with the real SFU, real Drive and real Workers AI."""
import asyncio, sys, json, time
sys.argv = [sys.argv[0], 'http://127.0.0.1:8837']
exec(open('e2e_room.py', encoding='utf8').read().split("async def main():")[0])
WAV = 'Q:/work/favor-meet-p0/speech.wav'

async def go():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='msedge', args=FAKE + ['--use-file-for-fake-audio-capture=' + WAV])
        hctx, host = await mk(b, 'host@favorintl.org', 'Caleb Reed')
        actx, ann = await mk(b, 'ann@favorintl.org', 'Marcus Bell')
        await host.goto(BASE + '/meet/', wait_until='networkidle')
        r = await api(host, 'meetings', 'POST', {'title': 'Support Team weekly', 'rec': 'video', 'access': 'staff'})
        mid = r['json']['meeting']['id']
        await join(host, mid, 'Caleb Reed'); await join(ann, mid, 'Marcus Bell')
        await host.wait_for_timeout(55000)
        rec = await host.evaluate("() => window.__meet.S.recording")
        check('recording active', rec and rec.get('active'), rec)
        # everyone leaves
        await ann.click('[data-a=leave]'); await host.wait_for_timeout(1500)
        await host.click('[data-a=leave]')
        t0 = time.time()
        for i in range(120):
            await host.wait_for_timeout(3000)
            m = await api(host, f'meetings/{mid}/notes')
            mm = m['json']['meeting']
            if mm['notesStatus'] == 'ready' or (mm['notesStatus'] == 'none' and mm['recState'] == 'stored'): break
        print('waited', round(time.time() - t0), 's', mm['recState'], mm['notesStatus'])
        check('recording stored in Drive', mm['recState'] == 'stored', mm['recState'])
        check('files listed', len(m['json']['files']) >= 1, m['json']['files'])
        print(json.dumps(m['json']['notes'], indent=1)[:1500]); print('SUMMARY:', mm['summary']); print('TITLE:', mm['title'])
        print('TRANSCRIPT:', [l['text'] for l in m['json']['transcript']][:6])
        check('notes ready', mm['notesStatus'] == 'ready', mm['notesStatus'])
        acts = m['json'].get('actions', [])
        print('ACTIONS', [(a['text'][:40], a['owner_name'], a['owner_email']) for a in acts])
        check('action items stored with owners', len(acts) >= 1 and any(a['owner_email'] for a in acts), acts[:1])
        td = await api(host, 'meetings/actions')
        check('my action items listed', len(td['json']['actions']) >= 1, td['json'])
        tdp = await host.evaluate("async () => (await (await fetch('/api/hub/today')).json()).cards.map(c => c.id + ':' + c.n)")
        check('Today card for meetings', any(x.startswith('meetings') for x in tdp), tdp)
        r2 = await api(host, f"meetings/{mid}/action", 'POST', {'idx': acts[0]['idx'], 'done': True})
        check('item ticked', r2['status'] == 200, r2['json'])
        await host.goto(f'{BASE}/meet/notes/?m={mid}', wait_until='networkidle'); await host.wait_for_timeout(1500)
        await host.screenshot(path=OUT + 'notes-1440.png', full_page=True)
        await b.close()
    print('FAILED:', [n for n, ok in R if not ok] or 'none')
asyncio.run(go())
