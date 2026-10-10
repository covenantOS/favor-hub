import os, json, hashlib, urllib.request, sys
BASE = os.environ.get('BASE', 'http://127.0.0.1:8811')
COOKIE = os.environ.get('SESSION', 'tok-will-local')
PART = 8 * 1024 * 1024
res = []


def ok(name, cond, extra=''):
    res.append(bool(cond)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)


def api(method, path, data=None, headers=None):
    h = {'Cookie': f'favor_hub_session={COOKIE}'}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r); return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(label, total_bytes, parts_stored, tail_cuts, expect_len):
    data = os.urandom(total_bytes)
    st, body = api('POST', '/api/clips', json.dumps({'mime': 'video/webm', 'kind': 'screen'}).encode(), {'Content-Type': 'application/json'})
    cid = json.loads(body)['id']
    for n in range(1, parts_stored + 1):
        st, _ = api('PUT', f'/api/clips/{cid}/part?n={n}', data[(n - 1) * PART:n * PART], {'x-elapsed': str(n * 8)})
        assert st == 200, st
    for off, end in tail_cuts:
        st, _ = api('PUT', f'/api/clips/{cid}/tail?off={off}', data[off:end], {'x-elapsed': '30'})
        assert st == 200, st
    st, body = api('POST', f'/api/clips/{cid}/complete', json.dumps({'durationMs': 30000, 'recover': False}).encode(), {'Content-Type': 'application/json'})
    ok(f'{label}: complete answered', st == 200, f'{st} {body[:80]}')
    st, media = api('GET', f'/api/clips/{cid}/media')
    ok(f'{label}: length is {expect_len}', len(media) == expect_len, f'{len(media)}')
    ok(f'{label}: bytes match the original', media == data[:expect_len])
    api('DELETE', f'/api/clips/{cid}')


MB = 1024 * 1024
# two whole parts stored, then tail pieces that cover part 3's bytes only partly; overlap with the stored parts is trimmed
run('parts 1-2 plus a tail that overlaps part 2', 2 * PART + 3 * MB, 2, [(2 * PART - MB, 2 * PART + MB), (2 * PART + MB, 2 * PART + 3 * MB)], 2 * PART + 3 * MB)
# no whole part yet: the tail alone makes the clip
run('tail only', 5 * MB, 0, [(0, 2 * MB), (2 * MB, 5 * MB)], 5 * MB)
# part 3 was cut but never arrived: the tail holds its bytes and a fourth of them, so 3 whole parts' worth is rebuilt
run('part lost in flight, tail covers it', 3 * PART + 2 * MB, 2, [(2 * PART, 2 * PART + 3 * MB), (2 * PART + 3 * MB, 2 * PART + 6 * MB), (2 * PART + 6 * MB, 3 * PART + 2 * MB)], 3 * PART + 2 * MB)
# a gap in the tail: stop at the last whole stretch
run('gap in the tail', 2 * PART + 4 * MB, 1, [(PART, PART + 2 * MB), (PART + 3 * MB, PART + 4 * MB)], PART + 2 * MB)
print('RESULT', sum(res), 'pass', len(res) - sum(res), 'fail')
sys.exit(0 if all(res) else 1)
