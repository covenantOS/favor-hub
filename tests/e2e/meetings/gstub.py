"""Stand-in for Google's token and Calendar endpoints, for local booking tests. Records every call in gstub.log.json.
   python gstub.py 8898"""
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer
LOG = []
NOW = int(time.time())

def busy_for(email):
    # Ann is busy tomorrow 10:00-11:00 ET (15:00-16:00 UTC), Bo busy 2:00-3:30 PM ET, everyone else free. Times shift by the day the grid asks about.
    return []

class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get('Content-Length') or 0); raw = self.rfile.read(n) if n else b''
        try: return json.loads(raw or b'{}')
        except Exception: return {'raw': raw.decode()[:100]}
    def do_POST(self):
        b = self._body(); LOG.append({'m': 'POST', 'p': self.path, 'b': b}); json.dump(LOG, open('Q:/work/favor-meet-p0/out/gstub.log.json', 'w'))
        if self.path.startswith('/token'): return self._send(200, {'access_token': 'stub-token', 'expires_in': 3600})
        if self.path.startswith('/cal/freeBusy'):
            cals = {}
            from datetime import datetime, timedelta, timezone
            t0 = datetime.fromisoformat(b['timeMin'].replace('Z', '+00:00'))
            for it in b['items']:
                e = it['id']
                if e.startswith('ann@'):
                    d = t0.replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=1)
                    cals[e] = {'busy': [{'start': d.isoformat().replace('+00:00', 'Z'), 'end': (d + timedelta(hours=1)).isoformat().replace('+00:00', 'Z')}]}
                elif e.startswith('nobody@'): cals[e] = {'errors': [{'reason': 'notFound'}]}
                else: cals[e] = {'busy': []}
            return self._send(200, {'calendars': cals})
        if self.path.startswith('/hub/ask'):
            return self._send(200, {'ok': True, 'markdown': 'Fall letter gifts so far are $48,210 from 312 partners.', 'blocks': [{'type': 'tiles', 'tiles': [{'label': 'Fall letter gifts', 'value': 48210, 'format': 'money'}, {'label': 'Partners', 'value': 312, 'format': 'int'}]}, {'type': 'text', 'md': 'Gift records updated 6:00 AM today.'}]})
        if self.path.startswith('/cal/calendars/primary/events'):
            return self._send(200, {'id': 'evt-' + str(len(LOG)), 'hangoutLink': 'https://meet.google.com/abc-defg-hij'})
        self._send(404, {})
    def do_PATCH(self):
        b = self._body(); LOG.append({'m': 'PATCH', 'p': self.path, 'b': b}); json.dump(LOG, open('Q:/work/favor-meet-p0/out/gstub.log.json', 'w')); self._send(200, {})
    def do_DELETE(self):
        LOG.append({'m': 'DELETE', 'p': self.path}); json.dump(LOG, open('Q:/work/favor-meet-p0/out/gstub.log.json', 'w')); self._send(204, {})
    def log_message(self, *a): pass

HTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
