"""Answers for every /api/* call the hub pages make, by data mode. All invented.

Modes: demo (kind data, the sort a design gets drawn against), worst (the realistic worst case for every
value, spread across rows), empty (zero items), one (a single item, every count at exactly 1), huge
(1,000 rows where the list has no paging).

Each surface registers its routes from fx_*.py. A route is (method, regex) -> function(mode, match, query, state)
returning a dict (sent as JSON), or a (status, content type, body) tuple.
"""
import json, re

ROUTES = []


def route(method, pattern):
    def deco(fn):
        ROUTES.append((method, re.compile(pattern), fn))
        return fn
    return deco


def answer(method, path, q, mode, state):
    q = {k: v[0] for k, v in q.items()}
    for m, rx, fn in ROUTES:
        if m != method and m != '*':
            continue
        hit = rx.match(path)
        if not hit:
            continue
        res = fn(mode, hit, q, state)
        if res is None:
            continue
        if isinstance(res, tuple):
            return res
        return (200, 'application/json', json.dumps(res, ensure_ascii=False))
    if method != 'GET':
        # A write never leaves the harness. The page gets a plain yes.
        return (200, 'application/json', '{"ok":true}')
    return None


def svg(w, h, label='', fill='#c9c2b4'):
    body = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="{fill}"/><path d="M0 0L{w} {h}M{w} 0L0 {h}" stroke="#8a8478" stroke-width="{max(2, min(w, h) // 40)}"/><text x="{w // 2}" y="{h // 2}" font-size="{max(10, min(w, h) // 5)}" text-anchor="middle" fill="#222">{label}</text></svg>'
    return (200, 'image/svg+xml', body)


import fx_shell, fx_today, fx_work, fx_partner, fx_lists, fx_meet, fx_chat, fx_brain  # noqa: E402,F401
