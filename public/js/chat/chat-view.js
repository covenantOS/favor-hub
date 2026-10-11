/* Favor Chat file viewer. Pictures, PDFs, Word and Excel files and Drive files shared in a conversation open here, on top of the
   chat, and close back to the same place (X, Escape, Back, a tap outside a picture, a swipe down on a picture). Card pictures for
   PDFs, Word and Excel files are drawn here too, once, when the card scrolls into view.
   PDFs are drawn with pdf.js, Word files with mammoth, Excel files with SheetJS; each is fetched the first time it is needed. */
(function () {
  'use strict';
  var LIB = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs',
    docx: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
    xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  };
  var ICON = {
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    dl: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
    prev: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[n] + '</svg>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ------------------------------------------------------------------ libraries, loaded once */
  var libs = {};
  function script(src, global) {
    if (!libs[src]) libs[src] = new Promise(function (ok, no) {
      if (window[global]) return ok(window[global]);
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { window[global] ? ok(window[global]) : no(new Error('load')); };
      s.onerror = function () { delete libs[src]; no(new Error('load')); };
      document.head.appendChild(s);
    });
    return libs[src];
  }
  function pdfLib() {
    if (!libs.pdfjs) libs.pdfjs = import(LIB.pdf).then(function (m) { m.GlobalWorkerOptions.workerSrc = LIB.pdfWorker; return m; }, function (e) { delete libs.pdfjs; throw e; });
    return libs.pdfjs;
  }
  var bytes = {};
  function fetchBytes(url) {
    if (!bytes[url]) bytes[url] = fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) { var e = new Error('status ' + r.status); e.status = r.status; throw e; }
      var type = (r.headers.get('X-File-Kind') || r.headers.get('Content-Type') || '').split(';')[0];
      return r.arrayBuffer().then(function (b) { return { buf: b, type: type }; });
    }).catch(function (e) { delete bytes[url]; throw e; });
    return bytes[url];
  }
  function kindOfType(type, name) {
    var t = (type || '') + ' ' + (name || '');
    if (/pdf/i.test(t)) return 'pdf';
    if (/wordprocessingml|\.docx\b/i.test(t)) return 'docx';
    if (/spreadsheetml|\.xlsx\b|text\/csv|\.csv\b/i.test(t)) return 'xlsx';
    return '';
  }

  /* ------------------------------------------------------------------ card pictures */
  // Drawn once per file and kept for the session, so a redraw of the message shows the same picture straight away.
  var thumbs = {};
  var thumbJobs = {};
  function thumbFor(key) { return thumbs[key] || ''; }
  function makeThumb(key, url, kind) {
    if (thumbJobs[key]) return thumbJobs[key];
    thumbJobs[key] = fetchBytes(url).then(function (f) {
      var k = kindOfType(f.type, '') || kind;
      if (k === 'pdf') return pdfLib().then(function (lib) { return lib.getDocument({ data: f.buf.slice(0) }).promise; }).then(function (doc) { return doc.getPage(1); }).then(function (pg) {
        var vp1 = pg.getViewport({ scale: 1 }), scale = 360 / vp1.width, vp = pg.getViewport({ scale: scale });
        var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(Math.min(vp.height, vp.width * 0.75));
        var c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height);
        return pg.render({ canvasContext: c2, viewport: vp }).promise.then(function () { return '<img src="' + cv.toDataURL('image/jpeg', 0.82) + '" alt="" />'; });
      });
      if (k === 'docx') return script(LIB.docx, 'mammoth').then(function (m) { return m.extractRawText({ arrayBuffer: f.buf.slice(0) }); }).then(function (r) {
        var lines = String(r.value || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 9);
        return '<span class="ch-page">' + lines.map(function (l, i) { return '<span' + (i === 0 ? ' class="ch-page__h"' : '') + '>' + esc(l.slice(0, 90)) + '</span>'; }).join('') + '</span>';
      });
      if (k === 'xlsx') return script(LIB.xlsx, 'XLSX').then(function (X) {
        var wb = X.read(new Uint8Array(f.buf), { type: 'array', sheetRows: 8 });
        var rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false }).slice(0, 7);
        return '<span class="ch-grid"><table>' + rows.map(function (r, i) { return '<tr>' + [0, 1, 2, 3].map(function (c) { var v = r[c] == null ? '' : r[c]; return (i ? '<td>' : '<th>') + esc(String(v).slice(0, 18)) + (i ? '</td>' : '</th>'); }).join('') + '</tr>'; }).join('') + '</table></span>';
      });
      return '';
    }).then(function (h) { thumbs[key] = h; return h; }, function () { thumbs[key] = ''; return ''; });
    return thumbJobs[key];
  }
  var io = null;
  function watchThumbs(root) {
    if (!('IntersectionObserver' in window)) return;
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target; io.unobserve(el);
        var key = el.getAttribute('data-thumb'), url = el.getAttribute('data-src'), kind = el.getAttribute('data-k');
        var go = function () {
          makeThumb(key, url, kind).then(function (h) {
            document.querySelectorAll('[data-thumb="' + key + '"]').forEach(function (t) { if (h) { t.innerHTML = h; t.classList.add('is-drawn'); } t.removeAttribute('data-src'); });
          });
        };
        (window.requestIdleCallback || function (f) { return setTimeout(f, 60); })(go);
      });
    }, { rootMargin: '200px 0px' });
    root.querySelectorAll('[data-thumb][data-src]').forEach(function (el) { if (!el._io) { el._io = 1; io.observe(el); } });
  }

  /* ------------------------------------------------------------------ the sheet */
  var cur = null;
  function sheet(item, bodyHtml, cls) {
    close(true);
    var el = document.createElement('div');
    el.className = 'ch-view ' + (cls || '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', item.name || 'File');
    var acts = '';
    if (item.external) acts += '<a class="ch-view__b" href="' + esc(item.external) + '" target="_blank" rel="noopener" aria-label="' + esc(item.externalLabel || 'Open in a new tab') + '" title="' + esc(item.externalLabel || 'Open in a new tab') + '">' + ic('ext') + '<span>' + esc(item.externalShort || 'Open') + '</span></a>';
    if (item.download) acts += '<a class="ch-view__b" href="' + esc(item.download) + '" download aria-label="Download" title="Download">' + ic('dl') + '<span>Download</span></a>';
    el.innerHTML = '<div class="ch-view__bar"><button type="button" class="ch-view__b ch-view__x" data-v="close" aria-label="Close">' + ic('x') + '</button><div class="ch-view__t"><b>' + esc(item.name || 'File') + '</b>' + (item.sub ? '<small>' + esc(item.sub) + '</small>' : '') + '</div><div class="ch-view__acts">' + acts + '</div></div><div class="ch-view__body">' + bodyHtml + '</div>';
    document.body.appendChild(el);
    document.body.classList.add('ch-viewing');
    cur = { el: el, item: item, cleanup: [] };
    el.addEventListener('click', function (e) { if (e.target.closest('[data-v="close"]')) close(); });
    requestAnimationFrame(function () { el.classList.add('is-in'); var x = el.querySelector('.ch-view__x'); if (x && !matchMedia('(pointer: coarse)').matches) x.focus({ preventScroll: true }); });
    if (window.FavorChatView.onOpen) window.FavorChatView.onOpen();
    return el;
  }
  function close(quiet) {
    if (!cur) return false;
    var c = cur; cur = null;
    c.cleanup.forEach(function (f) { try { f(); } catch (e) { /* gone */ } });
    c.el.querySelectorAll('video,audio').forEach(function (m) { try { m.pause(); } catch (e) { /* none */ } });
    document.body.classList.remove('ch-viewing');
    document.dispatchEvent(new CustomEvent('favor-chat:view-closed'));
    if (quiet) { c.el.remove(); return true; }
    c.el.classList.remove('is-in'); c.el.classList.add('is-out');
    setTimeout(function () { c.el.remove(); }, 180);
    if (window.FavorChatView.onClose) window.FavorChatView.onClose();
    return true;
  }
  document.addEventListener('keydown', function (e) {
    if (!cur) return;
    // Escape puts away a small menu inside the sheet first (a table's filter values), then the sheet.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (window.BrainBlocks && window.BrainBlocks.closePop && window.BrainBlocks.closePop(true)) return; if (document.documentElement.classList.contains('rt-sheet-open')) return; close(); }
    else if (cur.key) cur.key(e);
  }, true);

  function failHtml(item, msg) {
    return '<div class="ch-view__fail"><p>' + esc(msg || 'This file cannot be shown here.') + '</p>' + (item.external ? '<a class="ch-btn ch-btn--primary" href="' + esc(item.external) + '" target="_blank" rel="noopener">' + esc(item.externalLabel || 'Open in a new tab') + '</a>' : '') + (item.download ? '<a class="ch-btn" href="' + esc(item.download) + '" download>Download</a>' : '') + '</div>';
  }
  var LOADING = '<div class="ch-view__load"><i></i></div>';

  /* ------------------------------------------------------------------ pictures: swipe, pinch, double tap */
  function images(list, index) {
    var item = list[index];
    var el = sheet(item, '<div class="ch-lb"><div class="ch-lb__track">' + list.map(function (x, i) { return '<div class="ch-lb__slide"><img src="' + esc(x.url) + '" alt="' + esc(x.name || '') + '" draggable="false"' + (Math.abs(i - index) > 1 ? ' loading="lazy"' : '') + ' /></div>'; }).join('') + '</div>' +
      (list.length > 1 ? '<button type="button" class="ch-lb__nav ch-lb__nav--p" data-lb="-1" aria-label="Previous picture">' + ic('prev') + '</button><button type="button" class="ch-lb__nav ch-lb__nav--n" data-lb="1" aria-label="Next picture">' + ic('next') + '</button><div class="ch-lb__n" aria-live="polite"></div>' : '') + '</div>', 'ch-view--dark');
    var lb = el.querySelector('.ch-lb'), track = el.querySelector('.ch-lb__track');
    var i = index, s = 1, tx = 0, ty = 0, pts = {}, g = null, lastTap = 0;
    var img = function () { return track.children[i].querySelector('img'); };
    var place = function (anim) {
      track.style.transition = anim ? 'transform .26s cubic-bezier(.2,.8,.2,1)' : 'none';
      track.style.transform = 'translate3d(' + (-i * 100) + '%,0,0)';
    };
    var zoom = function (anim) { var im = img(); im.style.transition = anim ? 'transform .2s ease' : 'none'; im.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + s + ')'; };
    var label = function () {
      var n = el.querySelector('.ch-lb__n'); if (n) n.textContent = (i + 1) + ' of ' + list.length;
      var t = el.querySelector('.ch-view__t b'); if (t) t.textContent = list[i].name || 'Picture';
      var d = el.querySelector('.ch-view__acts a[download]'); if (d) d.href = list[i].download || list[i].url;
      var p = el.querySelector('[data-lb="-1"]'), q = el.querySelector('[data-lb="1"]'); if (p) p.disabled = i === 0; if (q) q.disabled = i === list.length - 1;
    };
    var go = function (to) { var j = Math.max(0, Math.min(list.length - 1, to)); if (j !== i) { s = 1; tx = 0; ty = 0; zoom(false); } i = j; place(true); label(); };
    var clamp = function () {
      if (s <= 1) { s = 1; tx = 0; ty = 0; return; }
      var r = lb.getBoundingClientRect(), im = img(), w = im.offsetWidth * s, h = im.offsetHeight * s;
      var mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
      tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
    };
    place(false); label();
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-lb]'); if (b) go(i + Number(b.dataset.lb)); else if (e.target === lb || e.target.classList.contains('ch-lb__slide')) { if (!g || !g.moved) close(); } });
    cur.key = function (e) { if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1); };
    lb.addEventListener('wheel', function (e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); s = Math.max(1, Math.min(5, s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); clamp(); zoom(false); }, { passive: false });
    var dist = function () { var k = Object.keys(pts); if (k.length < 2) return 0; var a = pts[k[0]], b = pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); };
    var mid = function () { var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    lb.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { lb.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      var n = Object.keys(pts).length;
      if (n === 2) g = { pinch: true, d0: dist(), s0: s, m0: mid(), tx0: tx, ty0: ty, moved: true };
      else if (n === 1) g = { x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, t0: Date.now(), moved: false, axis: '' };
    });
    lb.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId] || !g) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (g.pinch && Object.keys(pts).length >= 2) {
        var m = mid(), r = lb.getBoundingClientRect(), cx = g.m0.x - r.left - r.width / 2, cy = g.m0.y - r.top - r.height / 2;
        var ns = Math.max(1, Math.min(5, g.s0 * dist() / (g.d0 || 1)));
        tx = g.tx0 + (cx - g.tx0) * (1 - ns / g.s0) + (m.x - g.m0.x); ty = g.ty0 + (cy - g.ty0) * (1 - ns / g.s0) + (m.y - g.m0.y); s = ns; zoom(false); return;
      }
      var dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.moved && Math.hypot(dx, dy) > 8) { g.moved = true; g.axis = s > 1 ? 'pan' : Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; }
      if (!g.moved) return;
      if (g.axis === 'pan') { tx = g.tx0 + dx; ty = g.ty0 + dy; clamp(); zoom(false); }
      else if (g.axis === 'x') { var edge = (i === 0 && dx > 0) || (i === list.length - 1 && dx < 0) ? 0.35 : 1; track.style.transition = 'none'; track.style.transform = 'translate3d(calc(' + (-i * 100) + '% + ' + dx * edge + 'px),0,0)'; }
      else if (g.axis === 'y' && dy > 0) { img().style.transition = 'none'; img().style.transform = 'translate3d(0,' + dy + 'px,0) scale(' + Math.max(0.8, 1 - dy / 1200) + ')'; el.style.setProperty('--fade', String(Math.max(0.2, 1 - dy / 500))); }
    });
    var up = function (e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      if (!g) return;
      if (g.pinch) { if (Object.keys(pts).length < 2) { clamp(); zoom(true); g = Object.keys(pts).length ? { x0: pts[Object.keys(pts)[0]].x, y0: pts[Object.keys(pts)[0]].y, tx0: tx, ty0: ty, moved: true, axis: s > 1 ? 'pan' : 'none' } : null; } return; }
      var dx = e.clientX - g.x0, dy = e.clientY - g.y0, fast = Date.now() - g.t0 < 300;
      if (!g.moved) {
        var now = Date.now();
        if (now - lastTap < 300) { var r = lb.getBoundingClientRect(); if (s > 1) { s = 1; tx = 0; ty = 0; } else { s = 2.5; tx = -(e.clientX - r.left - r.width / 2) * 1.5; ty = -(e.clientY - r.top - r.height / 2) * 1.5; clamp(); } zoom(true); lastTap = 0; }
        else lastTap = now;
      } else if (g.axis === 'x') { if (dx < -60 || (fast && dx < -20)) go(i + 1); else if (dx > 60 || (fast && dx > 20)) go(i - 1); else place(true); }
      else if (g.axis === 'y') { if (dy > 110 || (fast && dy > 40)) { close(); return; } el.style.removeProperty('--fade'); s = 1; tx = 0; ty = 0; zoom(true); }
      setTimeout(function () { g = null; }, 0);
    };
    lb.addEventListener('pointerup', up); lb.addEventListener('pointercancel', up);
  }

  /* ------------------------------------------------------------------ PDF pages */
  function pdfInto(box, data, item) {
    return pdfLib().then(function (lib) { return lib.getDocument({ data: data }).promise; }).then(function (doc) {
      var z = 1, base = 0, pages = [];
      box.innerHTML = '<div class="ch-pdf"><div class="ch-pdf__pages"></div></div><div class="ch-pdf__zoom"><button type="button" data-z="-1" aria-label="Smaller">' + ic('minus') + '</button><span>' + doc.numPages + (doc.numPages === 1 ? ' page' : ' pages') + '</span><button type="button" data-z="1" aria-label="Larger">' + ic('plus') + '</button></div>';
      var scroller = box.querySelector('.ch-pdf'), wrap = box.querySelector('.ch-pdf__pages');
      base = Math.min(900, scroller.clientWidth - 24);
      var obs = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) draw(e.target); }); }, { root: scroller, rootMargin: '600px 0px' });
      var draw = function (holder) {
        var n = Number(holder.dataset.p), want = Math.round(base * z);
        if (holder._w === want || holder._busy) return;
        holder._busy = true;
        doc.getPage(n).then(function (pg) {
          var v1 = pg.getViewport({ scale: 1 }), dpr = Math.min(2, window.devicePixelRatio || 1), sc = want / v1.width;
          var vp = pg.getViewport({ scale: sc * dpr });
          var cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(function () { holder.innerHTML = ''; holder.appendChild(cv); holder._w = want; });
        }).catch(function () {}).then(function () { holder._busy = false; if (holder._w !== Math.round(base * z)) draw(holder); });
      };
      var sizes = [];
      var layout = function () { pages.forEach(function (h, k) { h.style.width = Math.round(base * z) + 'px'; h.style.height = Math.round(base * z * sizes[k]) + 'px'; }); };
      var chain = Promise.resolve();
      for (var n = 1; n <= doc.numPages; n++) (function (n) {
        chain = chain.then(function () { return n === 1 || n > 1 ? doc.getPage(n) : null; }).then(function (pg) {
          var v = pg.getViewport({ scale: 1 }); sizes[n - 1] = v.height / v.width;
          var h = document.createElement('div'); h.className = 'ch-pdf__p'; h.dataset.p = n; wrap.appendChild(h); pages.push(h);
          h.style.width = Math.round(base * z) + 'px'; h.style.height = Math.round(base * z * sizes[n - 1]) + 'px'; obs.observe(h);
        });
      })(n);
      var setZ = function (nz, cx, cy) {
        nz = Math.max(0.6, Math.min(4, nz)); if (nz === z) return;
        var r = scroller.getBoundingClientRect(), px = (cx == null ? r.width / 2 : cx - r.left), py = (cy == null ? r.height / 2 : cy - r.top);
        var fx = (scroller.scrollLeft + px) / scroller.scrollWidth, fy = (scroller.scrollTop + py) / scroller.scrollHeight;
        z = nz; layout();
        scroller.scrollLeft = fx * scroller.scrollWidth - px; scroller.scrollTop = fy * scroller.scrollHeight - py;
        clearTimeout(scroller._t); scroller._t = setTimeout(function () { pages.forEach(function (h) { var b = h.getBoundingClientRect(); if (b.bottom > -600 && b.top < innerHeight + 600) draw(h); }); }, 160);
      };
      box.addEventListener('click', function (e) { var b = e.target.closest('[data-z]'); if (b) setZ(z * (b.dataset.z === '1' ? 1.25 : 0.8)); });
      scroller.addEventListener('wheel', function (e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setZ(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX, e.clientY); }, { passive: false });
      // Two fingers zoom the pages; one finger scrolls them as usual.
      var tp = null;
      scroller.addEventListener('touchstart', function (e) { if (e.touches.length === 2) { var a = e.touches[0], b = e.touches[1]; tp = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: z }; } }, { passive: true });
      scroller.addEventListener('touchmove', function (e) { if (tp && e.touches.length === 2) { e.preventDefault(); var a = e.touches[0], b = e.touches[1]; var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); setZ(tp.z * d / tp.d, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2); } }, { passive: false });
      scroller.addEventListener('touchend', function (e) { if (e.touches.length < 2) tp = null; }, { passive: true });
      cur && cur.cleanup.push(function () { obs.disconnect(); try { doc.destroy(); } catch (e) { /* gone */ } });
      return chain;
    });
  }
  function docxInto(box, data) {
    return script(LIB.docx, 'mammoth').then(function (m) { return m.convertToHtml({ arrayBuffer: data }); }).then(function (r) {
      var safe = document.createElement('div'); safe.innerHTML = r.value;
      safe.querySelectorAll('script,iframe,object,embed,link,style').forEach(function (x) { x.remove(); });
      safe.querySelectorAll('*').forEach(function (x) { Array.prototype.slice.call(x.attributes).forEach(function (a) { if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) x.removeAttribute(a.name); }); });
      safe.querySelectorAll('a[href]').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });
      box.innerHTML = '<div class="ch-paper"><div class="ch-paper__in"></div></div>';
      box.querySelector('.ch-paper__in').appendChild(safe);
    });
  }
  function xlsxInto(box, data) {
    return script(LIB.xlsx, 'XLSX').then(function (X) {
      var wb = X.read(new Uint8Array(data), { type: 'array', sheetRows: 1000 });
      var show = function (k) {
        var rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[k]], { header: 1, blankrows: false, raw: false }).slice(0, 1000);
        var cols = rows.reduce(function (n, r) { return Math.max(n, r.length); }, 0);
        cols = Math.min(cols, 40);
        var letter = function (c) { var s = ''; c++; while (c) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
        box.querySelector('.ch-sheet__grid').innerHTML = '<table><thead><tr><th></th>' + Array.from({ length: cols }, function (_, c) { return '<th>' + letter(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r, i) { return '<tr><th>' + (i + 1) + '</th>' + Array.from({ length: cols }, function (_, c) { return '<td>' + esc(r[c] == null ? '' : r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
        box.querySelectorAll('[data-sh]').forEach(function (b) { b.classList.toggle('is-on', Number(b.dataset.sh) === k); });
      };
      box.innerHTML = '<div class="ch-sheet"><div class="ch-sheet__grid"></div>' + (wb.SheetNames.length > 1 ? '<div class="ch-sheet__tabs">' + wb.SheetNames.map(function (n, k) { return '<button type="button" data-sh="' + k + '">' + esc(n) + '</button>'; }).join('') + '</div>' : '') + '</div>';
      box.addEventListener('click', function (e) { var b = e.target.closest('[data-sh]'); if (b) show(Number(b.dataset.sh)); });
      show(0);
    });
  }

  /* ------------------------------------------------------------------ open */
  function open(item, list) {
    if (item.kind === 'image') return images(list && list.length ? list : [item], Math.max(0, (list || []).indexOf(item)));
    var el = sheet(item, LOADING, 'ch-view--doc');
    var box = el.querySelector('.ch-view__body');
    var mine = cur;
    fetchBytes(item.url).then(function (f) {
      if (cur !== mine) return;
      var k = kindOfType(f.type, item.name) || item.kind;
      if (k === 'pdf') return pdfInto(box, f.buf.slice(0), item);
      if (k === 'docx') return docxInto(box, f.buf.slice(0));
      if (k === 'xlsx') return xlsxInto(box, f.buf.slice(0));
      throw new Error('kind');
    }).catch(function (e) {
      if (cur !== mine) return;
      // Drive will not hand over some files (a download limit, a file only its owner can download); its picture of page 1 still shows.
      if (item.page && !(e && e.status === 404)) {
        box.innerHTML = '<div class="ch-paper"><div class="ch-view__page"><img src="' + esc(item.page) + '" alt="Page 1 of ' + esc(item.name) + '" /></div><div class="ch-view__more"><span>Page 1</span>' + (item.external ? '<a class="ch-btn ch-btn--primary" href="' + esc(item.external) + '" target="_blank" rel="noopener">' + esc(item.externalLabel || 'Open') + '</a>' : '') + '</div></div>';
        var im = box.querySelector('.ch-view__page img'); im.onerror = function () { box.innerHTML = failHtml(item); };
        return;
      }
      if (item.embed && !(e && e.status === 404)) { box.innerHTML = '<iframe class="ch-view__frame" src="' + esc(item.embed) + '" title="' + esc(item.name) + '" allow="autoplay"></iframe>'; return; }
      box.innerHTML = failHtml(item, e && e.status === 404 ? 'This file is gone.' : 'This file cannot be shown here.');
    });
  }

  // sheet(item, html, cls) opens the same sheet with any content (a large table, a request); it closes like a file does.
  window.FavorChatView = { open: open, sheet: sheet, close: close, isOpen: function () { return !!cur; }, thumb: thumbFor, watch: watchThumbs, onOpen: null, onClose: null };
})();
