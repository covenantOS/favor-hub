/* The phone app's client logic, with no screens in it: the screens (today a thin start page, later the React app) call this.
   One file, no build step, and the pure parts run under Node so the tests can reach them.
     lowData      Data saver: 'auto' follows the phone's own Data Saver and a slow connection, 'on' and 'off' are the person's choice.
     compress     Pictures shrink before they upload (smaller still in low-data mode).
     voice        A voice note is recorded in the browser at a low bit rate and sent as a file.
     outbox       Messages written without a connection wait here and are sent, once each, when the connection returns.
     push         Turn web push notices on and off for this device.
   Everything talks to the same /api routes FavorOS uses. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FavorPhone = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ------------------------------------------------------------------ low data */
  var LOWDATA_KEY = 'favor.lowdata';

  function connectionIsSlow(conn) {
    if (!conn) return false;
    if (conn.saveData) return true;
    return /^(slow-2g|2g|3g)$/.test(String(conn.effectiveType || ''));
  }

  /** 'auto' | 'on' | 'off' as the person set it. */
  function lowDataSetting(storage) {
    var v = null;
    try { v = (storage || root.localStorage).getItem(LOWDATA_KEY); } catch (e) { v = null; }
    return v === 'on' || v === 'off' ? v : 'auto';
  }

  function setLowData(mode, storage) {
    try { (storage || root.localStorage).setItem(LOWDATA_KEY, mode === 'on' || mode === 'off' ? mode : 'auto'); } catch (e) { /* private mode */ }
  }

  /** True when this phone should save data now. */
  function isLowData(storage, conn) {
    var s = lowDataSetting(storage);
    if (s !== 'auto') return s === 'on';
    return connectionIsSlow(conn === undefined ? (root.navigator && (root.navigator.connection || root.navigator.mozConnection)) : conn);
  }

  /* ------------------------------------------------------------------ pictures */
  var PICTURE = { normal: { max: 1920, quality: 0.8 }, low: { max: 1024, quality: 0.6 } };

  /** The size a picture is drawn at: the long side at most `max`, never enlarged, whole pixels. */
  function fitSize(w, h, max) {
    if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
    var scale = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
  }

  /** True for a file worth shrinking: a photo format a canvas can redraw (not a GIF or SVG, which would lose their motion or lines). */
  function shouldCompress(file, low) {
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '')) return false;
    return low || file.size > 300 * 1024;
  }

  /** Redraws a picture smaller and returns a Blob; keeps the original when the result is not smaller or the browser cannot draw it. */
  function compress(file, low) {
    if (!shouldCompress(file, low) || !root.document) return Promise.resolve(file);
    var prof = low ? PICTURE.low : PICTURE.normal;
    return new Promise(function (resolve) {
      var url = root.URL.createObjectURL(file);
      var img = new root.Image();
      img.onload = function () {
        root.URL.revokeObjectURL(url);
        var size = fitSize(img.naturalWidth, img.naturalHeight, prof.max);
        var canvas = root.document.createElement('canvas');
        canvas.width = size.w; canvas.height = size.h;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.w, size.h);
        ctx.drawImage(img, 0, 0, size.w, size.h);
        canvas.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) { resolve(file); return; }
          blob.name = (file.name || 'picture').replace(/\.[^.]+$/, '') + '.jpg';
          resolve(blob);
        }, 'image/jpeg', prof.quality);
      };
      img.onerror = function () { root.URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------------ voice notes */
  /** The best audio format this browser records, smallest first. Safari records MP4, the others Opus in WebM. */
  function voiceMime(MR) {
    MR = MR || root.MediaRecorder;
    if (!MR || !MR.isTypeSupported) return '';
    var list = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
    for (var i = 0; i < list.length; i++) if (MR.isTypeSupported(list[i])) return list[i];
    return '';
  }

  /** Starts recording. Resolves to { stop() -> Promise<Blob>, cancel() }. Voice at 16 or 24 kbit/s is about 120 to 180 KB a minute. */
  function startVoice(low) {
    var mime = voiceMime();
    if (!root.navigator || !root.navigator.mediaDevices || !mime) return Promise.reject(new Error('This phone cannot record a voice note here.'));
    return root.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, echoCancellation: true } }).then(function (stream) {
      var rec = new root.MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: low ? 16000 : 24000 });
      var chunks = [];
      var started = Date.now();
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var release = function () { stream.getTracks().forEach(function (t) { t.stop(); }); };
      rec.start(1000);
      return {
        mime: mime,
        seconds: function () { return Math.round((Date.now() - started) / 1000); },
        stop: function () {
          return new Promise(function (resolve) {
            rec.onstop = function () { release(); resolve(new root.Blob(chunks, { type: mime.split(';')[0] })); };
            rec.stop();
          });
        },
        cancel: function () { rec.onstop = release; try { rec.stop(); } catch (e) { release(); } }
      };
    });
  }

  /* ------------------------------------------------------------------ offline queue */
  function newId() {
    var a = new Uint8Array(12);
    (root.crypto || require('node:crypto').webcrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  /** An outbox in the browser's IndexedDB. `store` can be any object with put(item), all(), remove(id); tests pass a memory one. */
  function idbStore() {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var open = root.indexedDB.open('favor-phone', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('outbox', { keyPath: 'id' }); };
        open.onsuccess = function () { resolve(open.result); };
        open.onerror = function () { reject(open.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var t = d.transaction('outbox', mode), r = fn(t.objectStore('outbox'));
          t.oncomplete = function () { resolve(r && r.result); };
          t.onerror = function () { reject(t.error); };
        });
      });
    }
    return {
      put: function (item) { return tx('readwrite', function (s) { return s.put(item); }); },
      remove: function (id) { return tx('readwrite', function (s) { return s.delete(id); }); },
      all: function () { return tx('readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return a.created - b.created; }); }); }
    };
  }

  /**
   * The send queue. `queue(item)` stores a message { channel, thread_id, body, files:[{ blob, name, type }] } and tries to send it.
   * `flush()` sends every waiting message, oldest first, one at a time, so a conversation keeps its order. A connection failure
   * keeps the message and stops; a refusal from the server (4xx) marks it failed so it cannot block the ones behind it. Each message
   * carries its own id in X-Client-Id, so a message whose answer was lost in transit is not posted twice.
   * `transport` is { upload(blob, name, type) -> Promise<attachment>, send(channel, payload, clientId) -> Promise<message> }.
   */
  function createOutbox(store, transport, onChange) {
    var running = null;
    var changed = function () { if (onChange) onChange(); };
    function isNetwork(err) { return !err || err.status === undefined || err.status === 0 || err.status >= 500 || err.status === 429; }

    function sendOne(item) {
      var uploaded = item.uploaded || [];
      var files = item.files || [];
      var step = Promise.resolve();
      files.forEach(function (f, i) {
        step = step.then(function () {
          if (uploaded[i]) return;
          return transport.upload(f.blob, f.name, f.type).then(function (att) { uploaded[i] = att; item.uploaded = uploaded; return store.put(item); });
        });
      });
      return step.then(function () {
        var payload = { body: item.body || '', attachments: uploaded.filter(Boolean) };
        if (item.thread_id) payload.thread_id = item.thread_id;
        return transport.send(item.channel, payload, item.id);
      });
    }

    function flush() {
      if (running) return running;
      // Two tabs, or a page and the service worker's wake-up, share one queue: only one of them sends at a time.
      var locks = root.navigator && root.navigator.locks;
      var turn = function (job) { return locks && locks.request ? locks.request('favor-outbox', job) : job(); };
      running = turn(function () { return store.all(); }).then(function (list) {
        var out = { sent: [], failed: [], waiting: 0 };
        var chain = Promise.resolve(true);
        list.forEach(function (item) {
          chain = chain.then(function (go) {
            if (!go) { out.waiting += 1; return false; }
            if (item.failed) return true;
            return sendOne(item).then(function (msg) {
              out.sent.push({ id: item.id, message: msg });
              return store.remove(item.id).then(function () { return true; });
            }).catch(function (err) {
              if (isNetwork(err)) { out.waiting += 1; return false; }
              item.failed = String((err && err.message) || 'The server refused this message.');
              out.failed.push({ id: item.id, error: item.failed });
              return store.put(item).then(function () { return true; });
            });
          });
        });
        return chain.then(function () { return out; });
      }).then(function (out) { running = null; changed(); return out; }, function (err) { running = null; throw err; });
      return running;
    }

    return {
      queue: function (item) {
        var rec = { id: newId(), channel: item.channel, thread_id: item.thread_id || null, body: item.body || '', files: item.files || [], created: Date.now() };
        return store.put(rec).then(function () { changed(); return flush().then(function () { return rec.id; }); });
      },
      flush: flush,
      list: function () { return store.all(); },
      discard: function (id) { return store.remove(id).then(changed); }
    };
  }

  /** The transport the pages use: the hub's own chat routes. */
  function chatTransport(base) {
    base = base || '/api/chat';
    function check(res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (!res.ok || d.ok === false) { var e = new Error(d.message || 'That did not work.'); e.status = res.status; throw e; }
        return d;
      });
    }
    return {
      upload: function (blob, name, type) {
        return root.fetch(base + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type || blob.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name || blob.name || 'file'), 'X-Hub-Request': '1' }, body: blob }).then(check).then(function (d) {
          return { type: 'file', id: d.id, name: d.name, mime: d.mime, size: d.size, url: d.url };
        });
      },
      send: function (channel, payload, clientId) {
        return root.fetch(base + '/channels/' + encodeURIComponent(channel) + '/messages', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1', 'X-Client-Id': clientId }, body: JSON.stringify(payload) }).then(check).then(function (d) { return d.message; });
      }
    };
  }

  /* ------------------------------------------------------------------ notifications */
  function urlBase64ToBytes(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    var bin = root.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** What a person needs to know before turning notices on: unsupported, needs the Home Screen app (iPhone), blocked, off or on. */
  function pushState() {
    var nav = root.navigator || {};
    var ios = /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    var standalone = (root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true;
    if (ios && !standalone) return Promise.resolve('needs-home-screen');
    if (!('serviceWorker' in nav) || !root.PushManager || !root.Notification) return Promise.resolve('unsupported');
    if (root.Notification.permission === 'denied') return Promise.resolve('blocked');
    return nav.serviceWorker.getRegistration('/').then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).then(function (sub) { return sub && root.Notification.permission === 'granted' ? 'on' : 'off'; });
  }

  function registerWorker() {
    if (!root.navigator || !('serviceWorker' in root.navigator)) return Promise.resolve(null);
    return root.navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function () { return root.navigator.serviceWorker.ready; }).catch(function () { return null; });
  }

  function enablePush() {
    return registerWorker().then(function (reg) {
      if (!reg) throw new Error('This browser cannot show notifications.');
      return root.Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Notifications are blocked. Turn them on for FavorOS in the phone settings.');
        return root.fetch('/api/push/key', { credentials: 'same-origin' }).then(function (r) { return r.json(); });
      }).then(function (k) {
        if (!k.ok || !k.key) throw new Error(k.message || 'Notifications are not set up yet.');
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(k.key) });
      }).then(function (sub) {
        return root.fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify(sub.toJSON()) }).then(function (r) {
          if (!r.ok) throw new Error('FavorOS could not save the notification setting. Try again.');
        });
      });
    });
  }

  function disablePush() {
    return root.navigator.serviceWorker.getRegistration('/').then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; }).then(function (sub) {
      if (!sub) return;
      var endpoint = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return root.fetch('/api/push/unsubscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Hub-Request': '1' }, body: JSON.stringify({ endpoint: endpoint }) });
      });
    });
  }

  function sendTestPush() {
    return root.fetch('/api/push/test', { method: 'POST', credentials: 'same-origin', headers: { 'X-Hub-Request': '1' } }).then(function (r) { return r.json(); });
  }

  return {
    lowDataSetting: lowDataSetting, setLowData: setLowData, isLowData: isLowData, connectionIsSlow: connectionIsSlow,
    fitSize: fitSize, shouldCompress: shouldCompress, compress: compress, PICTURE: PICTURE,
    voiceMime: voiceMime, startVoice: startVoice,
    createOutbox: createOutbox, idbStore: idbStore, chatTransport: chatTransport,
    pushState: pushState, registerWorker: registerWorker, enablePush: enablePush, disablePush: disablePush, sendTestPush: sendTestPush
  };
});
