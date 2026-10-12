/* Invented mail for /mail/?mock=1: the same calls mail.js makes, answered from memory, so the screens can be drawn, filmed and
   tested without touching anyone's mailbox. Every name, address and message here is made up. */
(function () {
  'use strict';
  var ME = { name: 'Sam Rivers', email: 'sam@favorintl.org' };
  var now = Date.now();
  var ago = function (h) { return new Date(now - h * 36e5).toISOString(); };
  var P = function (name, email) { return { name: name, email: email }; };
  var people = [P('Maya Okafor', 'maya.okafor@example.org'), P('Tom Whitfield', 'tom@whitfieldfamily.example'), P('Grace Lin', 'grace@favorintl.org'), P('Riverbend Church', 'office@riverbend.example'), P('Daniel Ortiz', 'dortiz@example.com'), P('Hope Foundation Grants', 'grants@hopefoundation.example'), P('Priya Nair', 'priya@favorintl.org'), P('Blue Heron Printing', 'orders@blueheron.example'), P('Calendar', 'calendar@example.com'), P('Lena Brooks', 'lena.brooks@example.net')];
  var svg = function (label, color) { return 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="' + color + '"/><circle cx="700" cy="160" r="70" fill="#f7ecd2"/><path d="M0 460 240 300l180 120 160-90 320 200v70H0z" fill="#2b4d24" opacity=".55"/><text x="40" y="80" font-family="Georgia,serif" font-size="44" fill="#fff">' + label + '</text></svg>'); };
  var pdf = (function () {
    var objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    var stream = 'BT /F1 22 Tf 72 700 Td (Spring trip itinerary) Tj 0 -34 Td /F1 13 Tf (Day 1: arrive and settle in) Tj 0 -22 Td (Day 2: village visits) Tj 0 -22 Td (Day 3: partner dinner) Tj ET';
    objs[3] = '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
    var out = '%PDF-1.4\n', offs = [];
    objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var x = out.length;
    out += 'xref\n0 6\n0000000000 65535 f \n' + offs.map(function (n) { return ('0000000000' + n).slice(-10) + ' 00000 n \n'; }).join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
    return 'data:application/pdf;base64,' + btoa(out);
  })();
  var files = { f1: { id: 'f1', name: 'Spring trip itinerary.pdf', mime: 'application/pdf', size: 184320, url: pdf }, f2: { id: 'f2', name: 'Village well.jpg', mime: 'image/jpeg', size: 734003, url: svg('Village well', '#2f6f9f') }, f3: { id: 'f3', name: 'School roof.jpg', mime: 'image/jpeg', size: 652100, url: svg('School roof', '#b4532f') } };
  var n = 0;
  var msg = function (tid, from, to, hoursAgo, html, o) {
    o = o || {};
    return { id: 'm' + (++n), threadId: tid, labelIds: (o.labels || ['INBOX']).slice(), date: ago(hoursAgo), from: from, to: to, cc: o.cc || [], bcc: [], replyTo: [], subject: o.subject || '', snippet: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140), html: html, text: '', attachments: (o.files || []).map(function (k) { return Object.assign({ inline: false, cid: '' }, files[k]); }), messageId: '<m' + n + '@mock>', references: '', unread: !!o.unread, starred: !!o.starred, draft: !!o.draft };
  };
  var threads = [];
  var T = function (subject, msgs, o) {
    o = o || {};
    var id = 't' + (threads.length + 1001);
    var list = msgs.map(function (m) { var x = msg(id, m[0], m[1], m[2], m[3], Object.assign({ subject: subject, labels: o.labels }, m[4] || {})); if (x.unread) x.labelIds.push('UNREAD'); if (x.starred) x.labelIds.push('STARRED'); if (x.draft) x.labelIds = ['DRAFT']; return x; });
    threads.push({ id: id, subject: subject, messages: list, snoozed: '' });
  };
  var q = function (who, text) { return '<div class="gmail_quote"><div>On Thu, ' + who + ' wrote:</div><blockquote class="gmail_quote">' + text + '</blockquote></div>'; };
  T('Visiting in March', [
    [people[0], [ME], 30, '<p>Hi Sam,</p><p>Our family would love to visit the school in March. Is the second week still open?</p><p>Maya</p>'],
    [ME, [people[0]], 26, '<p>Hi Maya, yes, the second week is open. I will send the itinerary.</p>' + q('Maya Okafor', 'Our family would love to visit the school in March.'), { labels: ['SENT'] }],
    [people[0], [ME], 1.2, '<p>Wonderful. Here are two photos from our last visit, and the draft itinerary we talked about.</p><p>Could you confirm the dates by Friday?</p><p>Maya</p>' + q('Sam Rivers', 'Yes, the second week is open. I will send the itinerary.'), { unread: true, files: ['f1', 'f2', 'f3'] }]
  ]);
  T('Thank you for the update letter', [[people[1], [ME], 3, '<p>Sam, the update letter arrived yesterday. We read it at dinner and the kids had questions about the new well.</p><p>We would like to help with the next one. What does one cost?</p><p>Tom</p>', { unread: true }]]);
  T('Sunday missions moment', [
    [people[3], [ME, people[2]], 6, '<p>Good morning. We have five minutes for a missions moment on the 19th. Could someone from Favor share?</p><p>Riverbend Church office</p>', { unread: true, cc: [people[6]] }]
  ]);
  T('Grant report due November 1', [[people[5], [ME], 9, '<p>This is a reminder that the interim report for the education grant is due November 1. Please upload it in the portal.</p>', { starred: true }]]);
  T('Lunch Thursday?', [[people[2], [ME], 12, '<p>Are you free Thursday at noon? I want to go over the newsletter plan.</p>'], [ME, [people[2]], 11, '<p>Thursday works.</p>', { labels: ['SENT'] }], [people[2], [ME], 10.5, '<p>Great, see you then.</p>']]);
  T('Proof ready: fall mailer', [[people[7], [ME], 20, '<table width="600" cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;border:1px solid #ddd"><tr><td style="background:#235578;color:#fff;padding:18px 24px;font-size:20px">Blue Heron Printing</td></tr><tr><td style="padding:24px"><p>Your proof for the fall mailer is ready to review.</p><p><a href="https://example.com/proof" style="background:#235578;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Review the proof</a></p><p style="color:#777;font-size:12px">Order 20418, 2,400 pieces, 6 x 9 postcard.</p></td></tr></table>']]);
  T('Receipt question', [[people[4], [ME], 27, '<p>Hello, I gave in September and have not seen a receipt. Could you check?</p><p>Daniel</p>']]);
  T('Invitation: Team prayer, Monday 9:00 AM', [[people[8], [ME], 31, '<p>Team prayer, Monday 9:00 AM, conference room.</p>']]);
  T('Photos from the banquet', [[people[9], [ME], 50, '<p>Sam, what a night. A few photos attached.</p>', { files: ['f2'] }]]);
  T('Re: Matching gift form', [[people[1], [ME], 75, '<p>Signed and attached. Thanks for sending it.</p>', { files: ['f1'] }]]);
  T('Newsletter draft for review', [[people[6], [ME], 98, '<p>Draft is in the shared folder. Edits by Wednesday, please.</p>']]);
  T('Welcome packet address', [[people[9], [ME], 120, '<p>We moved in August. New address is 14 Larkspur Lane.</p>']]);
  for (var i = 0; i < 14; i++) T(['Volunteer schedule', 'Prayer request', 'Board packet', 'Trip deposit', 'Sponsor a student', 'Chapel visit', 'Year-end letter'][i % 7] + ' ' + (i + 1), [[people[(i * 3) % people.length], [ME], 140 + i * 9, '<p>Following up on this. Let me know what you think.</p>']]);
  T('Coffee next week', [[ME, [people[0]], 2, '<p>Maya, would Tuesday morning work for coffee?</p>', { draft: true }]], { labels: ['DRAFT'] });
  T('Itinerary sent', [[ME, [people[1]], 40, '<p>Tom, the itinerary is attached.</p>', { files: ['f1'] }]], { labels: ['SENT'] });

  var labels = [{ id: 'Label_1', name: 'Partners', type: 'user', color: '#3d7a35' }, { id: 'Label_2', name: 'Trips', type: 'user', color: '#2f6f9f' }, { id: 'Label_3', name: 'Receipts to check', type: 'user', color: '#a87410' }];
  threads[0].messages.forEach(function (m) { m.labelIds.push('Label_1', 'Label_2'); });
  threads[6].messages.forEach(function (m) { m.labelIds.push('Label_3'); });
  var partners = { 'maya.okafor@example.org': { id: '27202', name: 'Maya and Chidi Okafor' }, 'tom@whitfieldfamily.example': { id: '27202', name: 'Tom Whitfield' }, 'dortiz@example.com': { id: '27202', name: 'Daniel Ortiz' } };
  var level = { read: true, write: true, contacts: true, headers: true };
  var m = /[?&]level=(headers|read)\b/.exec(location.search);
  if (m) { level.write = false; level.contacts = false; if (m[1] === 'headers') level.read = false; }

  var has = function (t, l) { return t.messages.some(function (x) { return x.labelIds.indexOf(l) >= 0; }); };
  var row = function (t) {
    var real = t.messages.filter(function (x) { return !x.draft; });
    var last = real[real.length - 1] || t.messages[t.messages.length - 1];
    var ppl = [];
    real.forEach(function (x) { if (!ppl.some(function (p) { return p.email === x.from.email; })) ppl.push(x.from.email === ME.email ? { name: 'me', email: ME.email } : x.from); });
    if (ppl.length === 1 && ppl[0].email === ME.email && t.messages[0].to[0]) ppl = [{ name: 'To: ' + t.messages[0].to[0].name, email: t.messages[0].to[0].email }];
    var all = {}; t.messages.forEach(function (x) { x.labelIds.forEach(function (l) { all[l] = 1; }); });
    return { id: t.id, historyId: '1', subject: t.subject, snippet: last.snippet, date: last.date, people: ppl, from: last.from, count: real.length, unread: has(t, 'UNREAD'), starred: has(t, 'STARRED'), important: false, files: t.messages.some(function (x) { return x.attachments.length; }), draft: has(t, 'DRAFT'), labelIds: Object.keys(all), snoozed: t.snoozed || undefined };
  };
  var wait = function (v, ms) { return new Promise(function (ok) { setTimeout(function () { ok(JSON.parse(JSON.stringify(v))); }, ms == null ? 120 : ms); }); };
  var deny = function (need) { var e = new Error('Allow FavorOS first.'); e.code = 'mail_scope'; e.need = need; e.status = 403; return Promise.reject(e); };
  var find = function (id) { return threads.filter(function (t) { return t.id === id; })[0]; };
  var inLabel = function (t, label) {
    if (label === 'ALL') return !has(t, 'TRASH') && !has(t, 'SPAM');
    if (label === 'SNOOZED') return !!t.snoozed;
    if (label === 'TRASH') return has(t, 'TRASH');
    return has(t, label) && !has(t, 'TRASH');
  };
  var boxOfT = function (t) { var n = Number(String(t.id).slice(1)) % 5; return n === 0 ? 'accounting@favorintl.org' : n === 3 ? 'admin@favorintl.org' : ''; };
  var override = {};
  var cls = function (t) {
    var real = t.messages.filter(function (x) { return !x.draft; }), last = real[real.length - 1] || t.messages[0];
    var e = last.from.email, pm = partners[e], cat = 'people';
    if (override[e]) cat = override[e];
    else if (/^(Invitation|Accepted)/i.test(t.subject)) cat = 'calendar';
    else if (pm) cat = 'partners';
    else if (/favorintl\.org$/.test(e)) cat = 'staff';
    else if (/receipt|invoice|gift/i.test(t.subject)) cat = 'receipts';
    else if (/news|digest|mailer/i.test(e + t.subject)) cat = 'newsletters';
    var ask = e !== ME.email && /\?/.test(last.snippet) && ['partners', 'staff', 'people'].indexOf(cat) >= 0;
    return { cat: cat, ask: ask, partner: pm ? { id: pm.id, name: pm.name } : null };
  };
  var sortNew = function (a, b) { return String(row(b).date).localeCompare(String(row(a).date)); };

  window.FavorMailMock = function (real) {
    return Object.assign({}, real, {
      state: function () { return wait({ ok: true, connected: true, email: ME.email, name: ME.name, level: level, write: true, signature: level.read ? '<div>Sam Rivers<br>Favor International</div>' : '', mailboxes: [{ email: 'accounting@favorintl.org', name: 'Accounting', color: '#a8741a' }, { email: 'admin@favorintl.org', name: 'Admin', color: '#7a4aa8' }] }, 40); },
      boxes: function () { return wait({ ok: true, boxes: [{ email: ME.email, name: ME.name, color: '', primary: true, unread: 3 }, { email: 'accounting@favorintl.org', name: 'Accounting', color: '#a8741a', unread: 2 }, { email: 'admin@favorintl.org', name: 'Admin', color: '#7a4aa8', unread: 0 }] }, 60); },
      from: function () { return wait({ ok: true, from: [{ mailbox: ME.email, email: ME.email, name: ME.name, default: true }, { mailbox: 'accounting@favorintl.org', email: 'accounting@favorintl.org', name: 'Favor Accounting', default: true }, { mailbox: 'admin@favorintl.org', email: 'admin@favorintl.org', name: 'Favor Admin', default: true }] }, 60); },
      removeBox: function () { return wait({ ok: true }, 100); },
      labels: function () {
        var count = function (l) { return threads.filter(function (t) { return inLabel(t, l) && has(t, 'UNREAD'); }).length; };
        var sys = [['INBOX', 'Inbox'], ['STARRED', 'Starred'], ['SNOOZED', 'Snoozed'], ['IMPORTANT', 'Important'], ['SENT', 'Sent'], ['DRAFT', 'Drafts'], ['ALL', 'All mail'], ['SPAM', 'Spam'], ['TRASH', 'Trash']].map(function (x) { return { id: x[0], name: x[1], type: 'system', unread: x[0] === 'INBOX' ? count('INBOX') : 0, total: x[0] === 'DRAFT' ? threads.filter(function (t) { return inLabel(t, 'DRAFT'); }).length : 0 }; });
        return wait({ ok: true, labels: sys.concat(labels.map(function (l) { return Object.assign({ unread: count(l.id), total: threads.filter(function (t) { return inLabel(t, l.id); }).length }, l); })) }, 60);
      },
      threads: function (label, query, page, o) {
        o = o || {};
        if (query && !level.read) return deny('read');
        var list = threads.filter(function (t) { return inLabel(t, query ? 'ALL' : label); });
        var fl = o.flags || [];
        if (o.mb != null) list = list.filter(function (t) { return boxOfT(t) === (o.mb === ME.email ? '' : o.mb); });
        if (query) {
          var words = query.toLowerCase();
          var from = (words.match(/from:(\S+)/) || [])[1], att = /has:attachment/.test(words), unread = /is:unread/.test(words);
          var text = words.replace(/\b(from|to|subject|has|is|in|before|after|label):\S+/g, '').trim();
          list = list.filter(function (t) { var r = row(t); var hay = (t.subject + ' ' + t.messages.map(function (x) { return x.snippet + ' ' + x.from.name + ' ' + x.from.email; }).join(' ')).toLowerCase(); return (!text || hay.indexOf(text) >= 0) && (!from || hay.indexOf(from) >= 0) && (!att || r.files) && (!unread || r.unread); });
        }
        if (fl.indexOf('unread') >= 0) list = list.filter(function (t) { return has(t, 'UNREAD'); });
        if (fl.indexOf('starred') >= 0) list = list.filter(function (t) { return has(t, 'STARRED'); });
        if (fl.indexOf('files') >= 0) list = list.filter(function (t) { return row(t).files; });
        var smart = !query && label === 'INBOX' && (o.view || fl.indexOf('partner') >= 0);
        var mk = function (t) { var r = row(t), c = cls(t); return Object.assign(r, { cat: c.cat, ask: c.ask }, c.partner ? { partner: c.partner } : {}); };
        if (smart) {
          var v = o.view || '';
          var rows = list.map(mk);
          if (v === 'waiting') rows = threads.filter(function (t) { return has(t, 'SENT') && !has(t, 'TRASH'); }).map(function (t) { return Object.assign(row(t), { waitDays: 4 }); });
          else if (v === 'needs') rows = rows.filter(function (r) { return r.ask; });
          else if (v.indexOf('cat:') === 0) rows = rows.filter(function (r) { return r.cat === v.slice(4); });
          if (fl.indexOf('partner') >= 0) rows = rows.filter(function (r) { return r.partner; });
          var old = o.sort === 'old' || (!o.sort && (v === 'needs' || v === 'waiting'));
          rows.sort(function (x, y) { return old ? String(x.date).localeCompare(String(y.date)) : String(y.date).localeCompare(String(x.date)); });
          return wait({ ok: true, threads: rows, next: '', estimate: rows.length, scanned: list.length, pending: 0, level: level }, 220);
        }
        list.sort(sortNew);
        if (o.sort === 'old') list.reverse();
        var start = Number(page) || 0;
        return wait({ ok: true, threads: list.slice(start, start + 20).map(label === 'INBOX' ? mk : row), next: list.length > start + 20 ? String(start + 20) : '', estimate: list.length, level: level }, 160);
      },
      overview: function () {
        var inbox = threads.filter(function (t) { return inLabel(t, 'INBOX'); });
        var counts = {}, marks = {}, needs = 0, unread = 0;
        ['partners', 'staff', 'receipts', 'newsletters', 'notifications', 'calendar', 'people'].forEach(function (c) { counts[c] = { n: 0, unread: 0 }; });
        inbox.forEach(function (t) { var c = cls(t); counts[c.cat].n++; if (has(t, 'UNREAD')) { counts[c.cat].unread++; unread++; } if (c.ask) needs++; marks[t.id] = { cat: c.cat, ask: c.ask }; });
        var quiet = inbox.filter(function (t) { var c = cls(t); return (c.cat === 'newsletters' || c.cat === 'notifications') && has(t, 'UNREAD'); });
        return wait({ ok: true, counts: counts, needs: needs, unread: unread, waiting: 2, marks: marks, cleanup: { total: quiet.length, senders: quiet.length ? [{ email: 'news@example.org', name: 'Weekly Digest', n: quiet.length }] : [], ids: quiet.map(function (t) { return t.id; }) }, scanned: inbox.length, pending: 0 }, 200);
      },
      assist: function (id) {
        var t = find(id); if (!t) return wait({ ok: true, summary: '', replies: [], ask: false });
        var real = t.messages.filter(function (x) { return !x.draft; }), last = real[real.length - 1];
        var fromMe = last.from.email === ME.email;
        var first = String(last.from.name || '').split(' ')[0] || 'there';
        return wait({ ok: true, ask: cls(t).ask, summary: real.length >= 3 ? 'Maya asks to confirm the March dates by Friday and sent photos and a draft itinerary.' : '', replies: fromMe ? [] : ['Hi ' + first + ',\n\nYes, that works for me. I will confirm by Friday.', 'Hi ' + first + ',\n\nNot yet. Let me check with the team and come back to you early next week.', 'Hi ' + first + ',\n\nWhich dates are you weighing? I want to give you a clear answer.'], partner: null }, 700);
      },
      partner: function (id) { return wait({ ok: true, partner: { id: id, name: 'Maya and Chidi Okafor', lookup: '8841', total: 4300, count: 12, firstDate: '2019-03-02', ytd: 600, last: { amount: 100, date: '2026-10-02', fund: 'General' }, holders: [{ name: 'Grace Lin', type: 'Partner Care' }], lastContact: { date: '2026-09-12', category: 'Phone call' }, openActions: 1, doNotEmail: false } }, 300); },
      bulk: function (b) {
        if (!level.write) return deny('write');
        (b.ids || []).forEach(function (id) {
          var t = find(id); if (!t) return;
          var ms = t.messages;
          var set = function (add, rem) { ms.forEach(function (x) { x.labelIds = x.labelIds.filter(function (l) { return rem.indexOf(l) < 0; }); add.forEach(function (l) { if (x.labelIds.indexOf(l) < 0) x.labelIds.push(l); }); x.unread = x.labelIds.indexOf('UNREAD') >= 0; x.starred = x.labelIds.indexOf('STARRED') >= 0; }); };
          if (b.action === 'archive') set([], ['INBOX']); else if (b.action === 'inbox') set(['INBOX'], []); else if (b.action === 'read') set([], ['UNREAD']); else if (b.action === 'unread') set(['UNREAD'], []);
          else if (b.action === 'star') set(['STARRED'], []); else if (b.action === 'unstar') set([], ['STARRED']); else if (b.action === 'label') set(b.add || [], b.remove || []);
          else if (b.action === 'snooze') { set([], ['INBOX']); t.snoozed = b.until; } else if (b.action === 'trash') ms.forEach(function (x) { x._was = x.labelIds.slice(); x.labelIds = ['TRASH']; }); else if (b.action === 'untrash') ms.forEach(function (x) { x.labelIds = x._was || ['INBOX']; });
        });
        var un = threads.filter(function (t) { return inLabel(t, 'INBOX') && has(t, 'UNREAD') && cls(t).cat !== 'newsletters'; }).length;
        return wait({ ok: true, done: (b.ids || []).length, failed: 0, unread: un, all: un }, 200);
      },
      moveCat: function (senders, cat) { senders.forEach(function (e) { override[e] = cat; }); return wait({ ok: true, moved: senders.length }, 150); },
      thread: function (id) {
        var t = find(id);
        if (!t) { var e = new Error('That message is gone from Gmail.'); e.status = 404; return Promise.reject(e); }
        var drafts = {}; t.messages.forEach(function (x) { if (x.draft) drafts[x.id] = 'd-' + x.id; });
        var mine = {}; t.messages.forEach(function (x) { [x.from].concat(x.to, x.cc).forEach(function (a) { if (partners[a.email]) mine[a.email] = partners[a.email]; }); });
        if (!level.read) return wait({ ok: true, headersOnly: true, thread: { id: t.id, subject: t.subject, messages: t.messages.map(function (x) { return Object.assign({}, x, { html: '', attachments: [] }); }) }, partners: mine, drafts: {} }, 140);
        return wait({ ok: true, thread: t, partners: mine, drafts: drafts }, 180);
      },
      modify: function (id, add, remove) {
        if (!level.write) return deny('write');
        var t = find(id); if (!t) return wait({ ok: true });
        t.messages.forEach(function (x) { x.labelIds = x.labelIds.filter(function (l) { return (remove || []).indexOf(l) < 0; }); (add || []).forEach(function (l) { if (x.labelIds.indexOf(l) < 0) x.labelIds.push(l); }); x.unread = x.labelIds.indexOf('UNREAD') >= 0; x.starred = x.labelIds.indexOf('STARRED') >= 0; });
        if ((add || []).indexOf('INBOX') >= 0) t.snoozed = '';
        return wait({ ok: true }, 90);
      },
      trash: function (id) { if (!level.write) return deny('write'); var t = find(id); if (t) t.messages.forEach(function (x) { x._was = x.labelIds.slice(); x.labelIds = ['TRASH']; x.unread = false; }); return wait({ ok: true }, 90); },
      untrash: function (id) { if (!level.write) return deny('write'); var t = find(id); if (t) t.messages.forEach(function (x) { x.labelIds = x._was || ['INBOX']; }); return wait({ ok: true }, 90); },
      snooze: function (id, until) { if (!level.write) return deny('write'); var t = find(id); if (t) { t.snoozed = until; t.messages.forEach(function (x) { x.labelIds = x.labelIds.filter(function (l) { return l !== 'INBOX'; }); }); } return wait({ ok: true, until: until }, 90); },
      unsnooze: function (id) { var t = find(id); if (t) { t.snoozed = ''; t.messages.forEach(function (x) { if (x.labelIds.indexOf('INBOX') < 0) x.labelIds.push('INBOX'); }); } return wait({ ok: true }, 90); },
      newLabel: function (name) { if (!level.write) return deny('write'); var l = { id: 'Label_' + (labels.length + 1), name: name, type: 'user', color: '' }; labels.push(l); return wait({ ok: true, label: Object.assign({ unread: 0, total: 0 }, l) }, 90); },
      send: function (b) {
        if (!level.write) return deny('write');
        var t = b.threadId && find(b.threadId);
        var mm = msg(t ? t.id : 't' + (threads.length + 1001), ME, b.to, 0, b.html, { subject: b.subject, cc: b.cc, labels: ['SENT'] });
        if (t) t.messages = t.messages.filter(function (x) { return !x.draft; }).concat([mm]);
        else threads.push({ id: mm.threadId, subject: b.subject, messages: [mm], snoozed: '' });
        return wait({ ok: true, id: mm.id, threadId: mm.threadId }, 300);
      },
      saveDraft: function (b) { if (!level.write) return deny('write'); return wait({ ok: true, draftId: b.draftId || 'd-new', messageId: 'mx', threadId: b.threadId || '' }, 200); },
      dropDraft: function (id) { threads.forEach(function (t) { t.messages = t.messages.filter(function (x) { return 'd-' + x.id !== id; }); }); threads = threads.filter(function (t) { return t.messages.length; }); return wait({ ok: true }, 90); },
      contacts: function (query) {
        var s = String(query || '').toLowerCase();
        var staff = [P('Grace Lin', 'grace@favorintl.org'), P('Priya Nair', 'priya@favorintl.org'), P('Marcus Hale', 'marcus@favorintl.org'), P('Ruth Adeyemi', 'ruth@favorintl.org')].map(function (p) { return Object.assign({ kind: 'staff', title: 'Partner Care', picture: '' }, p); });
        var others = people.filter(function (p) { return !/favorintl/.test(p.email); }).map(function (p) { return Object.assign({ kind: 'contact', title: '', picture: '' }, p); });
        return wait({ ok: true, google: true, people: staff.concat(others).filter(function (p) { return !s || (p.name + ' ' + p.email).toLowerCase().indexOf(s) >= 0; }).slice(0, 10) }, 80);
      },
      drive: function (query) { return wait({ ok: true, files: [{ name: 'Spring trip itinerary', kind: 'doc', path: 'US Team Files / Trips', url: 'https://docs.google.com/document/d/mock-itinerary/edit' }, { name: 'Partner update letter, October', kind: 'doc', path: 'US Team Files / Letters', url: 'https://docs.google.com/document/d/mock-letter/edit' }].filter(function (f) { return f.name.toLowerCase().indexOf(String(query).toLowerCase().slice(0, 3)) >= 0 || query.length > 1; }) }, 200); },
      clips: function () { return wait({ ok: true, clips: [{ id: 'c1', title: 'How to read your giving statement', duration: '2:14', when: '2026-10-08', url: location.origin + '/clips/c1' }, { id: 'c2', title: 'Tour of the new school building', duration: '4:02', when: '2026-10-02', url: location.origin + '/clips/c2' }] }, 200); },
      owners: function () { return wait({ ok: true, owners: [{ fid: '1', name: 'Sam Rivers' }, { fid: '2', name: 'Grace Lin' }], mine: '1' }, 120); },
      task: function (b) { return wait({ ok: true, task: { id: 'x', code: '', title: b.title } }, 200); },
      chatBoot: function () { return wait({ ok: true, users: { 'grace@favorintl.org': { name: 'Grace Lin' }, 'priya@favorintl.org': { name: 'Priya Nair' } }, channels: [{ id: 'c1', kind: 'public', name: 'general', last_at: '3' }, { id: 'c2', kind: 'public', name: 'partner-care', last_at: '2' }, { id: 'c3', kind: 'dm', name: '', members: [ME.email, 'grace@favorintl.org'], last_at: '1' }] }, 200); },
      chatSend: function () { return wait({ ok: true, message: {} }, 200); },
      logAction: function () { return wait({ ok: true, created: 1, dups: 0 }, 300); },
      fileUrl: function (mid, f) { return f.url || ''; }
    });
  };
})();
