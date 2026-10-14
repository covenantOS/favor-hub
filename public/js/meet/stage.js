// Meeting room views: what each person sees, chosen on their own screen only. Nothing here is sent to anyone else.
// Pure functions (no page access) so the tests run them in Node; room.js draws what arrange() returns.
(function (root) {
  var KEY = 'meet.view.v1';
  var MODES = ['auto', 'gallery', 'speaker', 'spotlight'];
  var DEF = { mode: 'auto', strip: 'side', side: 220, bottom: 150, hideSelf: false, float: { x: 0.68, y: 0.6, w: 0.3 } };
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  /** Saved view choices for this browser, with anything missing or out of range set back to the default. */
  function clean(v) {
    var o = Object.assign({}, DEF, v || {});
    if (MODES.indexOf(o.mode) < 0) o.mode = DEF.mode;
    if (o.strip !== 'side' && o.strip !== 'bottom') o.strip = DEF.strip;
    o.side = clamp(+o.side || DEF.side, 120, 640); o.bottom = clamp(+o.bottom || DEF.bottom, 80, 420);
    o.hideSelf = !!o.hideSelf;
    var f = o.float || {}; o.float = { w: clamp(+f.w || DEF.float.w, 0.16, 0.7), x: clamp(f.x == null ? DEF.float.x : +f.x, 0, 1), y: clamp(f.y == null ? DEF.float.y : +f.y, 0, 1) };
    return o;
  }
  function load(store) { try { return clean(JSON.parse((store || localStorage).getItem(KEY) || 'null')); } catch (e) { return clean(null); } }
  function save(v, store) { try { (store || localStorage).setItem(KEY, JSON.stringify(clean(v))); } catch (e) {} }

  /** How many faces fit in the strip beside (or under) the stage at this size, 16:9 each. */
  function stripCap(strip, size, W, H, gap) {
    // Strip tiles may be a little wider (side) or narrower (below) than 16:9; the video fills them, cropped at the edges.
    if (strip === 'bottom') return clamp(Math.floor((W + gap) / (size * 4 / 3 + gap)), 2, 10);
    return clamp(Math.floor((H + gap) / (size / 2 + gap)), 2, 8);
  }
  /** The floating window's box inside the stage: x and y are fractions of the free room, w a fraction of the width. */
  function floatBox(f, W, H, aspect) {
    var w = clamp(f.w * W, 160, W * 0.9), h = w / (aspect || 16 / 9);
    if (h > H * 0.9) { h = H * 0.9; w = h * (aspect || 16 / 9); }
    return { w: Math.round(w), h: Math.round(h), x: Math.round(clamp(f.x, 0, 1) * Math.max(0, W - w)), y: Math.round(clamp(f.y, 0, 1) * Math.max(0, H - h)) };
  }
  /** The fractions to save for a box the person dragged to (x, y, w in pixels). */
  function floatFrac(x, y, w, W, H, aspect) {
    var h = w / (aspect || 16 / 9);
    return { w: clamp(w / W, 0.16, 0.7), x: W > w ? clamp(x / (W - w), 0, 1) : 0, y: H > h ? clamp(y / (H - h), 0, 1) : 0 };
  }

  /**
   * What is on screen.
   * a.faces    people in order (the room's order(): pinned or spotlit first, host, then speech or join time), me included
   * a.content  the shared thing on the stage, or null: { key, kind: 'play' | 'share' | 'brain', p }
   * a.extra    a second shared thing (a share while a clip plays), shown first among the faces
   * a.big      pid of the person for the stage when no content is there (pin, spotlight or speaker), or ''
   * a.view     saved choices (clean())
   * a.room     this meeting only: { stage: 'normal' | 'mini' | 'hidden', swap: bool }
   * a.cap      faces that fit in the strip; a.perPage, a.page for the gallery
   * Returns { model: [{ key, kind: 'big' | 'strip' | 'tile' | 'float' | 'more', p, content, n }], spot, pages, page, float, hidden, content }
   */
  function arrange(a) {
    var v = a.view, room = a.room || { stage: 'normal', swap: false };
    var faces = a.faces.slice();
    if (v.hideSelf && faces.length > 1) faces = faces.filter(function (p) { return !p.me; });
    var content = a.content || null, extra = a.extra || null;
    var out = { model: [], spot: false, pages: 1, page: 0, float: null, hidden: null, content: content };
    var face = function (p, kind) { return { key: p.pid, p: p, kind: kind }; };
    var item = function (c, kind) { return { key: c.key, p: c.p, kind: kind, content: c.kind }; };
    var people = faces.map(function (p) { return { p: p }; });
    if (extra) people.unshift({ c: extra });
    var strip = function (list, cap) {
      if (list.length > cap) { list.slice(0, cap - 1).forEach(push); out.model.push({ key: 'more', kind: 'more', n: list.length - (cap - 1) }); }
      else list.forEach(push);
    };
    var push = function (x) { out.model.push(x.c ? item(x.c, 'strip') : face(x.p, 'strip')); };
    var gallery = function (list) {
      var pp = a.perPage || 9;
      out.pages = Math.max(1, Math.ceil(list.length / pp));
      out.page = clamp(a.page || 0, 0, out.pages - 1);
      list.slice(out.page * pp, out.page * pp + pp).forEach(function (x) { out.model.push(x.c ? item(x.c, 'tile') : face(x.p, 'tile')); });
    };
    var byPid = function (pid) { for (var i = 0; i < people.length; i++) if (people[i].p && people[i].p.pid === pid) return i; return -1; };
    var stageFace = function () {
      // The person for the stage: the pin, spotlight or speaker; or, in speaker view with nobody picked, the first face.
      var i = a.big ? byPid(a.big) : -1;
      if (i < 0 && (v.mode === 'speaker' || v.mode === 'spotlight' || room.swap) && people.length) i = people[0].c ? (people.length > 1 ? 1 : -1) : 0;
      return i;
    };
    if (content && room.stage === 'hidden') { out.hidden = content; content = null; }
    if (content && room.stage === 'mini') { out.float = item(content, 'float'); content = null; }
    if (content) {
      if (v.mode === 'gallery') { people.unshift({ c: content }); gallery(people); return out; }
      out.spot = true;
      var bi = room.swap ? stageFace() : -1;
      if (bi >= 0) {
        var bp = people.splice(bi, 1)[0];
        out.model.push(face(bp.p, 'big'));
        people.unshift({ c: content });
      } else out.model.push(item(content, 'big'));
      if (v.mode !== 'spotlight') strip(people, a.cap || 4);
      return out;
    }
    var si = stageFace();
    var pinned = a.big && si >= 0;
    if (si >= 0 && people.length > 1 && (pinned || v.mode === 'speaker' || v.mode === 'spotlight')) {
      out.spot = true;
      var sp = people.splice(si, 1)[0];
      out.model.push(sp.c ? item(sp.c, 'big') : face(sp.p, 'big'));
      if (v.mode !== 'spotlight') strip(people, a.cap || 4);
    } else gallery(people);
    if (out.float) out.model.push(out.float);
    return out;
  }

  var api = { KEY: KEY, MODES: MODES, DEF: DEF, clean: clean, load: load, save: save, stripCap: stripCap, floatBox: floatBox, floatFrac: floatFrac, arrange: arrange, clamp: clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MeetStage = api;
})(typeof window !== 'undefined' ? window : globalThis);
