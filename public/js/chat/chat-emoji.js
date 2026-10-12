/* Favor Chat emoji picker: search by word, nine groups, the ones used most often first, and a skin tone that is remembered.
   chat-ui.js opens it for a reaction and for the message box. FavorChatEmoji.html() draws the panel; bind() wires one. */
(function () {
  'use strict';
  // Each group: a name, then "emoji words words" entries split by "|". The words are what the search box matches.
  var GROUPS = [
    ['Smileys', '😀 grin happy smile|😃 smiley happy joy|😄 smile happy laugh|😁 beaming grin|😆 laughing haha|😅 sweat smile relief phew|🤣 rofl rolling laughing|😂 joy tears laughing|🙂 slight smile|🙃 upside down|😉 wink|😊 blush smile warm|😇 halo angel innocent|🥰 hearts love adore|😍 heart eyes love|🤩 star struck wow|😘 kiss love|😋 yum tasty|😛 tongue|😜 wink tongue joke|🤪 zany silly|🤗 hug hugging|🤭 oops giggle|🤫 shush quiet|🤔 thinking hmm|🤐 zipper quiet|🤨 raised eyebrow doubt|😐 neutral|😑 expressionless|😶 no mouth speechless|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace awkward|😌 relieved calm|😔 pensive sad|😪 sleepy|😴 sleeping zzz|😷 mask sick|🤒 fever sick|🤕 hurt bandage|🤢 nauseated sick|🥵 hot|🥶 cold freezing|🥴 woozy|😵 dizzy|🤯 mind blown exploding|🤠 cowboy|🥳 party celebrate|😎 cool sunglasses|🤓 nerd glasses|🧐 monocle inspect|😕 confused|😟 worried|🙁 frown|😮 wow surprised open mouth|😯 hushed|😲 astonished shock|😳 flushed embarrassed|🥺 pleading please|😢 cry sad tear|😭 sobbing crying|😱 scream fear|😖 confounded|😣 persevere|😞 disappointed|😓 downcast sweat|😩 weary tired|😫 tired exhausted|🥱 yawn bored|😤 huff triumph|😡 angry mad|😠 angry|🤬 cursing|😈 devil smile|💀 skull dead|🤡 clown|👻 ghost|👽 alien|🤖 robot|💩 poop'],
    ['People', '👍 thumbs up yes like approve +1|👎 thumbs down no dislike -1|👏 clap applause bravo|🙌 raised hands praise hooray|🙏 pray thanks please folded hands|🤝 handshake deal agree|👋 wave hello bye hi|🤚 raised back hand|✋ hand stop high five|🖐 hand fingers|👌 ok perfect|🤌 pinched|✌ peace victory|🤞 fingers crossed hope luck|🤟 love you|🤘 rock|🤙 call me shaka|👈 point left|👉 point right|👆 point up|👇 point down|☝ index up one|✊ fist power|👊 fist bump punch|🤛 left fist|🤜 right fist|💪 muscle strong flex|✍ writing|🤲 palms up prayer|👐 open hands|🫶 heart hands love|🫡 salute yes sir|🤷 shrug dunno|🤦 facepalm|🙋 raising hand me question|🙆 ok gesture|🙅 no gesture|🙇 bow thanks sorry|💁 info|🧑‍💻 technologist developer laptop|👀 eyes looking watching|👁 eye|🧠 brain smart|🫀 heart organ|👂 ear listen|👃 nose|👄 mouth lips|🦷 tooth|👶 baby|🧒 child|👦 boy|👧 girl|🧑 person|👨 man|👩 woman|🧓 older person|👴 old man|👵 old woman|👨‍👩‍👧 family|👪 family|🧑‍🤝‍🧑 people together|👥 people group|🗣 speaking|🚶 walking|🏃 running|💃 dancing|🕺 dancing man|🧎 kneeling prayer'],
    ['Nature', '🐶 dog|🐱 cat|🐭 mouse|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 see no evil|🙉 hear no evil|🙊 speak no evil|🐔 chicken|🐧 penguin|🐦 bird|🕊 dove peace spirit|🦅 eagle|🦉 owl|🐴 horse|🦄 unicorn|🐝 bee|🦋 butterfly|🐢 turtle slow|🐍 snake|🐙 octopus|🐠 fish|🐬 dolphin|🐳 whale|🦈 shark|🐘 elephant|🦒 giraffe|🐑 sheep lamb|🐐 goat|🐪 camel|🌱 seedling grow sprout|🌿 herb leaf|🍀 clover luck|🌳 tree|🌴 palm tree|🌵 cactus|🌾 wheat harvest grain|🌷 tulip flower|🌹 rose flower|🌻 sunflower|🌸 blossom flower|💐 bouquet flowers|🍂 fallen leaves autumn|🍁 maple leaf fall|☀ sun sunny|🌤 sun cloud|⛅ partly cloudy|☁ cloud|🌧 rain|⛈ storm thunder|🌩 lightning|❄ snow cold|🌈 rainbow|🌊 wave ocean water|💧 drop water|🔥 fire hot lit|⭐ star|🌟 glowing star|✨ sparkles new shiny|⚡ lightning fast zap|🌙 moon night|🌍 earth globe africa world|🌎 earth americas world|🌏 earth asia world|🪐 planet'],
    ['Food', '🍎 apple|🍊 orange|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍑 peach|🍍 pineapple|🥭 mango|🥑 avocado|🍅 tomato|🥕 carrot|🌽 corn|🥔 potato|🥦 broccoli|🧄 garlic|🧅 onion|🍞 bread|🥐 croissant|🥯 bagel|🧀 cheese|🥚 egg|🥓 bacon|🥞 pancakes|🍔 burger|🍟 fries|🍕 pizza|🌭 hot dog|🥪 sandwich|🌮 taco|🌯 burrito|🥗 salad|🍝 pasta|🍜 noodles ramen|🍲 stew soup|🍛 curry rice|🍣 sushi|🍚 rice|🍗 chicken leg|🥩 steak|🍤 shrimp|🍰 cake slice|🎂 birthday cake|🧁 cupcake|🍩 donut|🍪 cookie|🍫 chocolate|🍬 candy|🍦 ice cream|🍿 popcorn|🥜 peanuts|☕ coffee|🍵 tea|🥤 drink cup|🧃 juice|🥛 milk|💧 water|🍽 plate dinner|🥄 spoon|🍴 fork knife'],
    ['Activities', '🎉 party tada celebrate congrats|🎊 confetti celebrate|🎈 balloon|🎁 gift present|🏆 trophy win award|🥇 gold medal first|🥈 silver medal second|🥉 bronze medal third|🏅 medal|🎯 target bullseye goal|⚽ soccer football|🏀 basketball|🏈 football|⚾ baseball|🎾 tennis|🏐 volleyball|⛳ golf|🏓 ping pong|🎳 bowling|🥊 boxing|🏋 weights gym|🚴 cycling bike|🏊 swimming|🧗 climbing|🎣 fishing|🎮 video game|🎲 dice game|🧩 puzzle piece|♟ chess|🎨 art paint palette|🎭 theater|🎬 clapper film video|🎤 microphone sing|🎧 headphones music|🎵 music note|🎶 music notes|🎹 piano keys|🎸 guitar|🥁 drum|🎺 trumpet|🎻 violin|📸 camera photo|🎥 movie camera video|🎟 ticket|🎪 tent event|🕯 candle|🙌 worship praise'],
    ['Travel', '✈ airplane flight travel|🛫 takeoff departure|🛬 landing arrival|🚗 car|🚕 taxi|🚌 bus|🚐 van|🚚 truck delivery|🚲 bike|🛵 scooter|🏍 motorcycle|🚆 train|🚇 metro subway|🚢 ship|⛵ sailboat|🚀 rocket launch ship|🚁 helicopter|⛽ fuel gas|🗺 map|🧭 compass|📍 pin location|🏠 house home|🏡 home garden|🏢 office building|🏥 hospital|🏫 school|⛪ church|🕌 mosque|🏛 building|🏗 construction|🏕 camping|🏖 beach|🏔 mountain|⛰ mountain|🌋 volcano|🏜 desert|🌅 sunrise|🌄 sunrise mountains|🌇 sunset|🌃 night city|🌉 bridge night|🗽 statue liberty|🎡 ferris wheel|⏰ alarm clock|⏳ hourglass waiting|⌛ hourglass done|🕐 one clock|📅 calendar date|🗓 calendar|🧳 luggage trip'],
    ['Objects', '💡 idea light bulb|🔦 flashlight|📱 phone mobile|💻 laptop computer|🖥 desktop computer|⌨ keyboard|🖱 mouse|🖨 printer|📷 camera|📹 video camera|📺 tv|📞 telephone call|☎ phone|🔋 battery|🔌 plug|💾 save disk|📀 dvd|📡 satellite|🔍 search magnifier|🔎 search|🔒 lock locked|🔓 unlock|🔑 key|🗝 old key|🔨 hammer|🛠 tools fix|🔧 wrench fix|⚙ gear settings|🧰 toolbox|🧲 magnet|📦 package box|📫 mailbox|✉ envelope mail email|📧 email|📨 incoming mail|📝 memo note write|📄 page document|📃 page|📑 tabs bookmark|📊 bar chart|📈 chart up growth|📉 chart down|📋 clipboard|📌 pin pushpin|📎 paperclip attach|🖇 paperclips|✂ scissors cut|📁 folder|📂 open folder|🗂 dividers|🗃 file box|🗑 trash delete|📚 books|📖 open book bible read|📕 book|🔖 bookmark|🏷 label tag|💰 money bag|💵 dollar cash|💳 credit card|🧾 receipt|🎓 graduation cap|👑 crown|💍 ring|👓 glasses|👔 tie|🎒 backpack|☂ umbrella|🧴 lotion|🩺 stethoscope|💊 pill medicine|🧪 test tube|🧬 dna|🔔 bell notify|🔕 bell off mute|📣 megaphone announce|📢 loudspeaker announce|🛎 bell service|⚓ anchor|🪙 coin|🧱 brick|🪜 ladder|🚪 door'],
    ['Symbols', '❤ heart love red|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|🤎 brown heart|💔 broken heart|❣ heart exclamation|💕 two hearts|💖 sparkling heart|💗 growing heart|💯 hundred perfect|✅ check done yes|☑ checked box|✔ check mark|❌ cross no wrong x|❎ cross box|➕ plus add|➖ minus|➗ divide|✖ multiply|❓ question|❔ question white|❗ exclamation important|‼ double exclamation|⚠ warning caution|🚫 prohibited no|⛔ no entry stop|🛑 stop sign|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🟥 red square|🟩 green square|🟦 blue square|⬆ up arrow|⬇ down arrow|⬅ left arrow|➡ right arrow|↗ up right|↘ down right|↩ return back|🔁 repeat loop|🔄 refresh sync|🔃 reload|⏩ fast forward|⏪ rewind|▶ play|⏸ pause|⏹ stop|🆕 new|🆗 ok|🆒 cool|🆓 free|🔝 top|🔜 soon|💤 zzz sleep|💬 speech bubble comment|💭 thought bubble|🗯 angry bubble|♻ recycle|✝ cross faith|☮ peace|♾ infinity|™ trademark|©️ copyright|#️⃣ hash number|🏁 finish flag|🚩 red flag|🏳 white flag|🇺🇸 flag usa united states america|🇺🇬 flag uganda|🇰🇪 flag kenya|🇸🇸 flag south sudan|🇨🇩 flag congo|🇷🇼 flag rwanda|🇹🇿 flag tanzania|🇪🇹 flag ethiopia|🇬🇧 flag uk britain|🇨🇦 flag canada'],
  ];
  // Emoji that take a skin tone: the tone character goes right after the first character.
  var TONED = '👍👎👏🙌🙏🤝👋🤚✋🖐👌🤌✌🤞🤟🤘🤙👈👉👆👇☝✊👊🤛🤜💪✍🤲👐🫶🫡🤷🤦🙋🙆🙅🙇💁👂👃👶🧒👦👧🧑👨👩🧓👴👵🚶🏃💃🕺🧎🏋🚴🏊🧗';
  var TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
  var TONE_NAMES = ['Default', 'Light', 'Medium light', 'Medium', 'Medium dark', 'Dark'];
  var QUICK = ['👍', '❤️', '🙏', '🎉', '😂', '👀', '✅', '🔥', '🙌', '💯', '🤔', '😮'];
  var KEY_TONE = 'favor.chat.emoji.tone', KEY_USED = 'favor.chat.emoji.used';

  var ALL = [];
  var VS16 = String.fromCharCode(0xfe0f), PICTURE = new RegExp('^[' + String.fromCharCode(92) + 'p{Emoji_Presentation}]', 'u');
  GROUPS.forEach(function (g) {
    g[1].split('|').forEach(function (x) {
      var sp = x.indexOf(' '), e = x.slice(0, sp);
      // A character that draws as plain text by default (a heart, a sun, a hand) gets the mark that asks for the picture.
      if (Array.from(e).length === 1 && !PICTURE.test(e)) e += VS16;
      ALL.push({ e: e, w: x.slice(sp + 1), g: g[0] });
    });
  });
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function tone() { var t = Number(read(KEY_TONE, 0)); return t >= 0 && t < 6 ? t : 0; }
  function first(e) { return Array.from(e)[0]; }
  function toned(e, t) {
    if (!t) return e;
    var chars = Array.from(e), base = chars[0];
    if (TONED.indexOf(base) < 0 || chars.length > 2) return e;
    // A variation mark after the base goes; the tone takes its place.
    return base + TONES[t];
  }
  function used() {
    var u = read(KEY_USED, {});
    return Object.keys(u).sort(function (a, b) { return u[b] - u[a]; }).slice(0, 18);
  }
  function remember(e) {
    var u = read(KEY_USED, {});
    u[e] = (u[e] || 0) + 1;
    var keys = Object.keys(u);
    if (keys.length > 60) keys.sort(function (a, b) { return u[a] - u[b]; }).slice(0, keys.length - 60).forEach(function (k) { delete u[k]; });
    write(KEY_USED, u);
  }
  function btn(e, label) { return '<button type="button" class="ch-emo__e" data-e="' + esc(e) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + e + '</button>'; }
  function gridHtml(q) {
    var t = tone();
    q = String(q || '').trim().toLowerCase();
    if (q) {
      var words = q.split(/\s+/);
      var hits = ALL.filter(function (x) { return words.every(function (w) { return x.w.indexOf(w) >= 0; }); });
      // A word that starts an emoji's first name comes before one that only appears in it.
      hits.sort(function (a, b) { return (a.w.indexOf(words[0]) === 0 ? 0 : 1) - (b.w.indexOf(words[0]) === 0 ? 0 : 1); });
      return hits.length ? '<div class="ch-emo__grid">' + hits.slice(0, 96).map(function (x) { return btn(toned(x.e, t), x.w.split(' ')[0]); }).join('') + '</div>' : '<p class="ch-emo__none">No emoji matches “' + esc(q) + '”</p>';
    }
    var u = used();
    var top = u.length ? u : QUICK;
    var h = '<h4 data-g="top">' + (u.length ? 'Used most' : 'Quick picks') + '</h4><div class="ch-emo__grid">' + top.map(function (e) { return btn(e, 'emoji'); }).join('') + '</div>';
    GROUPS.forEach(function (g) {
      h += '<h4 data-g="' + g[0] + '">' + g[0] + '</h4><div class="ch-emo__grid">' + ALL.filter(function (x) { return x.g === g[0]; }).map(function (x) { return btn(toned(x.e, t), x.w.split(' ')[0]); }).join('') + '</div>';
    });
    return h;
  }
  function toneHtml() {
    var t = tone();
    return '<button type="button" class="ch-emo__tone" data-tone-open aria-haspopup="true" aria-label="Skin tone: ' + TONE_NAMES[t] + '" title="Skin tone">' + toned('✋', t) + '</button>';
  }
  /** The panel: search box, skin tone, group tabs, and the grid. */
  function html() {
    return '<div class="ch-emo" role="dialog" aria-label="Emoji"><div class="ch-emo__top"><label class="ch-emo__find"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" data-emo-q placeholder="Search emoji" aria-label="Search emoji" autocomplete="off" /></label>' + toneHtml() + '</div>' +
      '<div class="ch-emo__tones" data-tones hidden>' + TONES.map(function (_, i) { return '<button type="button" data-tone="' + i + '" aria-label="' + TONE_NAMES[i] + '" title="' + TONE_NAMES[i] + '">' + toned('✋', i) + '</button>'; }).join('') + '</div>' +
      '<div class="ch-emo__tabs" role="tablist">' + [['top', '🕘', 'Used most']].concat(GROUPS.map(function (g) { return [g[0], first(g[1]), g[0]]; })).map(function (x) { return '<button type="button" role="tab" data-emo-tab="' + x[0] + '" aria-label="' + x[2] + '" title="' + x[2] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="ch-emo__body" data-emo-body tabindex="-1">' + gridHtml('') + '</div></div>';
  }
  /** Wires a panel that is on the page. onPick(emoji) runs for each emoji pressed. */
  function bind(el, onPick, opts) {
    var q = el.querySelector('[data-emo-q]'), body = el.querySelector('[data-emo-body]'), tones = el.querySelector('[data-tones]');
    var redraw = function () { body.innerHTML = gridHtml(q.value); body.scrollTop = 0; el.querySelector('.ch-emo__tabs').hidden = !!q.value.trim(); };
    q.addEventListener('input', redraw);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); var f = body.querySelector('.ch-emo__e'); if (f) f.click(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); var g = body.querySelector('.ch-emo__e'); if (g) g.focus(); }
    });
    // Arrow keys walk the grid, a row at a time up and down.
    body.addEventListener('keydown', function (e) {
      if (!/^Arrow/.test(e.key)) return;
      var all = Array.prototype.slice.call(body.querySelectorAll('.ch-emo__e')), i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var cols = Math.max(1, Math.round(body.clientWidth / (all[0].offsetWidth || 36)));
      var j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : i - cols;
      if (j < 0) { q.focus(); return; }
      if (all[j]) all[j].focus();
    });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-e]');
      if (b) { remember(b.dataset.e); onPick(b.dataset.e, e); return; }
      if (e.target.closest('[data-tone-open]')) { tones.hidden = !tones.hidden; return; }
      var t = e.target.closest('[data-tone]');
      if (t) {
        write(KEY_TONE, Number(t.dataset.tone)); tones.hidden = true;
        var old = el.querySelector('[data-tone-open]'); if (old) old.outerHTML = toneHtml();
        redraw(); return;
      }
      var tab = e.target.closest('[data-emo-tab]');
      if (tab) { var h = body.querySelector('h4[data-g="' + tab.dataset.emoTab + '"]'); if (h) body.scrollTop = h.offsetTop - body.offsetTop; }
    });
    if (!(opts && opts.noFocus)) setTimeout(function () { try { q.focus({ preventScroll: true }); } catch (e) { /* gone */ } }, 0);
  }
  window.FavorChatEmoji = { html: html, bind: bind, quick: QUICK, toned: function (e) { return toned(e, tone()); }, remember: remember, all: ALL };
})();
