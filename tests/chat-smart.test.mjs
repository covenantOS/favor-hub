// Chat's smarter side with a stand-in database and a fake Workers AI: reading language, translation (kept per message and
// language, original untouched, mentions and links kept), Catch me up, reminders from a message, voice note transcripts, partner
// and fund chips, and the thread the Favor Brain reads. Invented people only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './support/resolve-ts.mjs';
import { ADMIN, ADMIN2, call, world } from './support/chat-world.mjs';

const GEN = 'ch_general';
const sql = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function smartWorld() {
  const w = world();
  w.d1.exec(sql('db/chat-smart.sql'));
  w.d1.exec(sql('db/work-reminders.sql'));
  w.d1.exec(`CREATE TABLE act_batches (id TEXT PRIMARY KEY, state TEXT)`);
  const calls = [];
  w.ai = {
    async run(model, input) {
      calls.push({ model, input });
      if (model.includes('m2m100')) return { translated_text: `[${input.target_lang}] ${input.text}` };
      if (model.includes('whisper')) return { text: 'Please call Naomi back on Thursday.', transcription_info: { language: 'en' } };
      const sys = String(input.messages?.[0]?.content || '');
      if (sys.includes('catch-up')) return { response: '{"headline":"Bo and Ada settled the banquet date.","points":[{"text":"Bo proposed the 14th.","ids":[%IDS%]},{"text":"Ada agreed.","ids":[]},{"text":"A room hold is needed by Friday.","ids":[]}],"for_you":[{"text":"Ada asked you to call the venue.","ids":[]}]}'.replace('%IDS%', String(calls.ids || 1)) };
      return { response: 'ok' };
    },
  };
  w.calls = calls;
  return w;
}
const post = (w, user, body, extra) => call(w, user, 'POST', `channels/${GEN}/messages`, body, { env: { AI: w.ai }, ...extra });
const withAi = (w) => ({ env: { AI: w.ai } });

test('detectLang tells Arabic, French, Spanish, Portuguese, Swahili and English apart, and says null when unsure', async () => {
  const { detectLang } = await import('../functions/_lib/chat/translate.ts');
  assert.equal(detectLang('مرحبا، هل يمكنك إرسال التقرير اليوم؟'), 'ar');
  assert.equal(detectLang('Bonjour, pouvez-vous envoyer le rapport pour la réunion de jeudi ?'), 'fr');
  assert.equal(detectLang('Hola, puedes enviar el informe para la reunión de mañana?'), 'es');
  assert.equal(detectLang('Olá, você pode enviar o relatório para a reunião de amanhã?'), 'pt');
  assert.equal(detectLang('Habari, tafadhali tuma ripoti kwa mkutano wetu'), 'sw');
  assert.equal(detectLang('Can you send the report for the meeting on Thursday?'), 'en');
  assert.equal(detectLang('hmm'), null);
  assert.equal(detectLang('https://example.org/x'), null);
});

test('pieces keeps mentions, partner chips, links and code exactly as written', async () => {
  const { pieces, translateText } = await import('../functions/_lib/chat/translate.ts');
  const text = 'Thanks <@bo@favorintl.org>, see <~p:123|Ruth Test> at https://x.test/a?b=1 and `code here` today.\nSecond line';
  const kept = pieces(text).filter((p) => !p.say).map((p) => p.s);
  assert.ok(kept.includes('<@bo@favorintl.org>') && kept.includes('<~p:123|Ruth Test>') && kept.includes('https://x.test/a?b=1') && kept.includes('`code here`'));
  assert.equal(pieces(text).map((p) => p.s).join(''), text, 'nothing is lost or reordered');
  const ai = { run: async (_m, i) => ({ translated_text: i.text.toUpperCase() }) };
  const out = await translateText(ai, text, 'en', 'fr');
  assert.ok(out.includes('<@bo@favorintl.org>') && out.includes('https://x.test/a?b=1') && out.includes('<~p:123|Ruth Test>'));
  assert.ok(out.includes('THANKS ') && out.includes('SECOND LINE'));
});

test('a model that errors falls through to the larger model, and a model that both fail returns null', async () => {
  const { translateRun } = await import('../functions/_lib/chat/translate.ts');
  const seen = [];
  const ai = { run: async (m) => { seen.push(m); if (m.includes('m2m')) throw new Error('down'); return { response: 'Bonjour' }; } };
  assert.equal(await translateRun(ai, 'Hello', 'en', 'fr'), 'Bonjour');
  assert.equal(seen.length, 2);
  assert.equal(await translateRun({ run: async () => { throw new Error('x'); } }, 'Hello', 'en', 'fr'), null);
});

test('each person picks a language, and only a listed one is accepted', async () => {
  const w = smartWorld();
  assert.equal((await call(w, ADMIN, 'GET', 'prefs')).data.lang, '');
  assert.equal((await call(w, ADMIN, 'POST', 'prefs', { lang: 'xx' })).status, 400);
  assert.equal((await call(w, ADMIN, 'POST', 'prefs', { lang: 'fr' })).data.lang, 'fr');
  assert.equal((await call(w, ADMIN, 'GET', 'prefs')).data.lang, 'fr');
  assert.equal((await call(w, ADMIN2, 'GET', 'prefs')).data.lang, '', 'another person is unchanged');
  const boot = (await call(w, ADMIN, 'GET', 'boot')).data;
  assert.equal(boot.lang, 'fr');
  assert.ok(boot.langs.some((l) => l.code === 'ar'));
  assert.equal((await call(w, ADMIN, 'POST', 'prefs', { lang: '' })).data.lang, '');
});

test('translating a message keeps the original, caches per message and language, and translates an edit again', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const sent = (await post(w, ADMIN, { body: 'Can you send the report for the meeting on Thursday, <@bo@favorintl.org>?' })).data.message;
  assert.equal(sent.body.startsWith('Can you send'), true);
  await call(w, ADMIN2, 'POST', 'prefs', { lang: 'fr' });
  const first = await call(w, ADMIN2, 'POST', 'translate', { ids: [sent.id] }, withAi(w));
  assert.equal(first.status, 200);
  const item = first.data.items[sent.id];
  assert.equal(item.src, 'en');
  assert.ok(item.text.includes('[fr] Can you send'), 'translated by the model');
  assert.ok(item.text.includes('<@bo@favorintl.org>'), 'the mention is kept');
  const used = w.calls.filter((c) => c.model.includes('m2m')).length;
  const again = await call(w, ADMIN2, 'POST', 'translate', { ids: [sent.id] }, withAi(w));
  assert.deepEqual(again.data.items[sent.id], item);
  assert.equal(w.calls.filter((c) => c.model.includes('m2m')).length, used, 'the second read comes from the kept copy');
  // The stored message is untouched.
  const hist = (await call(w, ADMIN2, 'GET', `channels/${GEN}/messages`)).data.messages.find((m) => m.id === sent.id);
  assert.equal(hist.body, sent.body);
  // An edit translates again.
  await call(w, ADMIN, 'PATCH', `messages/${sent.id}`, { body: 'Please send the budget before Friday.' });
  const edited = await call(w, ADMIN2, 'POST', 'translate', { ids: [sent.id] }, withAi(w));
  assert.ok(edited.data.items[sent.id].text.includes('budget'));
  // A message already in the reader's language needs nothing.
  const fr = (await post(w, ADMIN, { body: 'Bonjour, pouvez-vous envoyer le rapport pour la réunion de jeudi ?' })).data.message;
  const same = await call(w, ADMIN2, 'POST', 'translate', { ids: [fr.id] }, withAi(w));
  assert.equal(same.data.items[fr.id].same, true);
  assert.equal(same.data.items[fr.id].text, undefined);
});

test('translation never reads a message the person cannot see', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const priv = (await call(w, ADMIN, 'POST', 'channels', { name: 'Care Team', private: true })).data.channel.id;
  const m = (await call(w, ADMIN, 'POST', `channels/${priv}/messages`, { body: 'Please send the report for the meeting on Thursday.' })).data.message;
  const r = await call(w, ADMIN2, 'POST', 'translate', { ids: [m.id], lang: 'fr' }, withAi(w));
  assert.deepEqual(r.data.items, {});
  assert.equal(w.calls.length, 0);
});

test('Catch me up summarizes the messages after a point, for that person only, and cites real messages', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const ids = [];
  for (const t of ['Banquet date: how about the 14th?', 'The 14th works for me.', 'We need a room hold by Friday.', 'Ada, can you call the venue?']) ids.push((await post(w, ADMIN2, { body: t })).data.message.id);
  w.calls.ids = ids[0];
  const r = await call(w, ADMIN, 'POST', `channels/${GEN}/catchup`, { from: 0 }, withAi(w));
  assert.equal(r.status, 200);
  assert.equal(r.data.count, 4);
  assert.equal(r.data.people, 1);
  assert.ok(r.data.headline.includes('banquet'));
  assert.deepEqual(r.data.points[0].ids, [ids[0]]);
  assert.equal(r.data.for_you.length, 1);
  const quiet = await call(w, ADMIN, 'POST', `channels/${GEN}/catchup`, { from: ids[3] }, withAi(w));
  assert.equal(quiet.data.empty, true, 'nothing new to summarize');
  assert.equal((await call(w, ADMIN, 'POST', 'channels/ch_missing/catchup', { from: 0 }, withAi(w))).status, 404);
});

test('a message becomes a reminder in the list the bell reads, and the sender gets no notice', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const m = (await post(w, ADMIN2, { body: 'Please send the report for the meeting on Thursday.' })).data.message;
  const r = await call(w, ADMIN, 'POST', `messages/${m.id}/remind`, { when: { code: 'tomorrow' } });
  assert.equal(r.status, 200);
  const row = w.d1.db.prepare('SELECT owner, kind, title, note, state FROM act_reminders').get();
  assert.equal(row.owner, ADMIN.email);
  assert.equal(row.kind, 'message');
  assert.ok(row.title.startsWith('Chat: Please send the report'));
  assert.equal(row.note, 'Bo Builder in #general');
  assert.equal((await call(w, ADMIN, 'POST', `messages/${m.id}/remind`, { when: {} })).status, 400);
  assert.equal((await call(w, ADMIN, 'POST', 'messages/99999/remind', { when: { code: 'hour' } })).status, 404);
});

test('a voice note is transcribed after it posts, shows working first, and translates', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const up = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: new Uint8Array([1, 2, 3, 4]), headers: { 'Content-Type': 'audio/webm', 'X-File-Name': 'voice.webm' } });
  const msg = (await post(w, ADMIN, { body: '', attachments: [{ type: 'file', id: up.data.id, voice: true, secs: 7 }] })).data.message;
  assert.equal(msg.attachments[0].voice, true);
  assert.equal(msg.attachments[0].secs, 7);
  const t = (await call(w, ADMIN2, 'GET', `threads/${msg.id}`)).data.root;
  assert.equal(t.attachments[0].transcript_status, 'ready');
  assert.equal(t.attachments[0].transcript, 'Please call Naomi back on Thursday.');
  assert.ok(w.calls.some((c) => c.model.includes('whisper')));
  const edit = w.events.filter((e) => e.event.type === 'edit' && e.event.message.id === msg.id);
  assert.ok(edit.length >= 1, 'the card is pushed again with its words');
  await call(w, ADMIN2, 'POST', 'prefs', { lang: 'fr' });
  const tr = await call(w, ADMIN2, 'POST', 'translate', { ids: [msg.id] }, withAi(w));
  assert.ok(tr.data.items[msg.id].voice[up.data.id].text.startsWith('[fr] Please call Naomi'));
  // A non-audio file is never treated as a voice note.
  const img = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: new Uint8Array([137, 80]), headers: { 'Content-Type': 'image/png', 'X-File-Name': 'a.png' } });
  const m2 = (await post(w, ADMIN, { body: 'pic', attachments: [{ type: 'file', id: img.data.id, voice: true }] })).data.message;
  assert.equal(m2.attachments[0].voice, undefined);
});

test('a failed transcript is marked failed and the message still stands', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  const up = await call(w, ADMIN, 'POST', 'upload', undefined, { raw: new Uint8Array([1, 2, 3]), headers: { 'Content-Type': 'audio/webm', 'X-File-Name': 'v.webm' } });
  w.ai.run = async () => { throw new Error('model down'); };
  const msg = (await post(w, ADMIN, { body: '', attachments: [{ type: 'file', id: up.data.id, voice: true }] })).data.message;
  const t = (await call(w, ADMIN, 'GET', `threads/${msg.id}`)).data.root;
  assert.equal(t.attachments[0].transcript_status, 'failed');
});

test('partner and fund chips are plain text tokens the bell and the Brain read as names', async () => {
  const { plainLine, parseMentions, brainQuestion } = await import('../functions/_lib/chat/text.ts');
  assert.equal(plainLine('Ask <~p:555|Ruth Test> about <~f:77|Chad Water Fund>', () => 'x'), 'Ask Ruth Test about Chad Water Fund');
  assert.equal(brainQuestion('<@brain> how much has <~p:555|Ruth Test> given?'), 'how much has Ruth Test given?');
  assert.deepEqual(parseMentions('<~p:555|Ruth Test>').people, []);
});

test('the partner list and the owners list answer only people with Work Center access', async () => {
  const w = smartWorld();
  const none = await call(w, ADMIN, 'GET', 'entities?q=Ruth');
  assert.equal(none.status, 200);
  assert.deepEqual(none.data.items, []);
  assert.deepEqual((await call(w, ADMIN, 'GET', 'owners')).data.owners, []);
});

test('the Favor Brain reads the thread it is asked in', async () => {
  const w = smartWorld();
  await call(w, ADMIN, 'GET', 'boot');
  await call(w, ADMIN2, 'GET', 'boot');
  const root = (await post(w, ADMIN2, { body: 'We raised the banquet goal to 50 tables.' })).data.message;
  await post(w, ADMIN, { body: 'That is a big jump from last year.', thread_id: root.id });
  const asks = [];
  const fetcher = async (url, init) => {
    asks.push(JSON.parse(init.body));
    return Response.json({ ok: true, blocks: [{ type: 'text', md: 'Summary.' }], follow: [] });
  };
  const r = await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '<@brain> summarize this', thread_id: root.id }, { fetcher });
  assert.equal(r.status, 200);
  assert.equal(asks.length, 1);
  assert.ok(asks[0].question.includes('banquet goal to 50 tables'), 'the thread is in what the Brain reads');
  assert.ok(asks[0].question.includes('Question from Ada Admin: summarize this'));
  // A plain top-level question with no pointing word gets no chat context.
  asks.length = 0;
  await call(w, ADMIN, 'POST', `channels/${GEN}/messages`, { body: '<@brain> how many gifts came in today?' }, { fetcher });
  assert.equal(asks[0].question, 'how many gifts came in today?');
});
