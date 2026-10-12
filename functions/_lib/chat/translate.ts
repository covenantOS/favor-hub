// Translation for Favor Chat. Pure text rules (which language a message is in, which parts are never translated) and the model
// calls, with the AI binding passed in so tests can stand in for it. Nothing here reads a database.
//   m2m100 does the translating; the larger text model steps in when it errors.
//   Mentions, channel links, partner chips, web addresses and code stay exactly as written: only the words between them go to the model.

export const TRANSLATE_MODEL = '@cf/meta/m2m100-1.2b';
export const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface Lang {
  code: string;
  name: string;
  native: string;
}

/** The languages a person can read Chat in. */
export const LANGS: Lang[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'lg', name: 'Luganda', native: 'Luganda' },
];
const BY_CODE = new Map(LANGS.map((l) => [l.code, l]));
export const langOk = (code: unknown): code is string => typeof code === 'string' && BY_CODE.has(code);
export const langName = (code: string): string => BY_CODE.get(code)?.name || code;

const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'is', 'are', 'to', 'of', 'you', 'for', 'that', 'this', 'with', 'have', 'will', 'can', 'not', 'it', 'we', 'on', 'be', 'thanks', 'please', 'hello', 'ok', 'okay'],
  fr: ['le', 'la', 'les', 'des', 'et', 'est', 'sont', 'une', 'un', 'pour', 'que', 'vous', 'nous', 'avec', 'pas', 'dans', 'bonjour', 'merci', 'je', 'ce', 'cette', 'sur', 'au', 'du', 'oui', 'non', 'ça', 'à', 'ai', 'avons', 'peut', 'être'],
  es: ['el', 'la', 'los', 'las', 'y', 'es', 'son', 'una', 'un', 'para', 'que', 'con', 'no', 'en', 'hola', 'gracias', 'por', 'se', 'del', 'está', 'tengo', 'puede', 'sí'],
  pt: ['o', 'os', 'as', 'e', 'é', 'são', 'uma', 'um', 'para', 'que', 'com', 'não', 'em', 'olá', 'obrigado', 'obrigada', 'por', 'se', 'do', 'da', 'está', 'tenho', 'pode', 'sim'],
  sw: ['na', 'ya', 'wa', 'kwa', 'ni', 'katika', 'hii', 'huo', 'sana', 'asante', 'habari', 'karibu', 'sijui', 'tafadhali', 'pia', 'lakini', 'kama', 'yetu', 'wetu', 'tutaweza', 'nimeona'],
};

/** The language a short message is written in: Arabic by its letters, the others by common words. Null when it cannot tell. */
export function detectLang(text: string): string | null {
  const t = String(text || '').replace(/<[@#~][^>]*>/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ');
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 2) return null;
  const arabic = (t.match(/[؀-ۿݐ-ݿ]/g) || []).length;
  if (arabic / letters.length > 0.3) return 'ar';
  const words = t.toLowerCase().match(/[\p{L}']+/gu) || [];
  const score: Record<string, number> = {};
  for (const code of Object.keys(STOP)) {
    const set = new Set(STOP[code]);
    score[code] = words.filter((w) => set.has(w)).length;
  }
  // Accented letters tip French, Spanish and Portuguese apart from English.
  if (/[éèêàçùôîâœ]/i.test(t)) score.fr += 1;
  if (/[ñ¿¡]/i.test(t)) score.es += 2;
  if (/[ãõ]/i.test(t)) score.pt += 2;
  const ranked = Object.keys(score).sort((a, b) => score[b] - score[a]);
  const best = ranked[0];
  if (score[best] < 1) return words.length >= 4 ? 'en' : null;
  if (score[best] === score[ranked[1]] && best !== 'en') return null;
  return best;
}

export interface Piece {
  /** True: words to translate. False: kept as written. */
  say: boolean;
  s: string;
}

// Mentions, channel links, entity chips, web addresses, fenced and inline code.
const KEEP = /```[\s\S]*?```|`[^`\n]+`|<[@#~][^>\n]*>|https?:\/\/[^\s<>"')\]]+/g;

/** Splits a message into the parts the model translates (one line of words at a time) and the parts kept as they are. */
export function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  const push = (s: string, keep: boolean) => {
    if (!s) return;
    if (keep) return void out.push({ say: false, s });
    for (const part of s.split(/(\n+)/)) {
      if (!part) continue;
      out.push({ say: /\p{L}/u.test(part) && !/^\n+$/.test(part), s: part });
    }
  };
  let last = 0;
  for (const m of text.matchAll(KEEP)) {
    push(text.slice(last, m.index), false);
    push(m[0], true);
    last = (m.index || 0) + m[0].length;
  }
  push(text.slice(last), false);
  return out;
}

export interface Ai {
  run(model: string, input: unknown): Promise<unknown>;
}

const MAX_PIECES = 14;

/** One run of words, through m2m100, then the larger model when that fails. Returns null when neither answers. */
export async function translateRun(ai: Ai, text: string, from: string, to: string): Promise<string | null> {
  const lead = text.match(/^\s*/)![0];
  const tail = text.match(/\s*$/)![0];
  const core = text.trim();
  if (!core) return text;
  try {
    const r = (await ai.run(TRANSLATE_MODEL, { text: core, source_lang: from, target_lang: to })) as { translated_text?: string } | null;
    const out = String(r?.translated_text || '').trim();
    if (out) return lead + out + tail;
  } catch (err) {
    console.warn('[chat] translate m2m', err);
  }
  try {
    const r = (await ai.run(FALLBACK_MODEL, {
      messages: [
        { role: 'system', content: `Translate the user's message from ${langName(from)} to ${langName(to)}. Reply with the translation only, no notes and no quotation marks.` },
        { role: 'user', content: core },
      ],
      max_tokens: 700,
    })) as { response?: string } | null;
    const out = String(r?.response || '').trim();
    if (out) return lead + out + tail;
  } catch (err) {
    console.warn('[chat] translate fallback', err);
  }
  return null;
}

/** A whole message translated, keeping mentions, links and code. Null when any part could not be translated. */
export async function translateText(ai: Ai, text: string, from: string, to: string): Promise<string | null> {
  if (from === to) return text;
  const parts = pieces(text);
  const todo = parts.filter((p) => p.say);
  if (!todo.length || todo.length > MAX_PIECES) return todo.length ? null : text;
  const done = await Promise.all(todo.map((p) => translateRun(ai, p.s, from, to)));
  if (done.some((d) => d == null)) return null;
  let i = 0;
  return parts.map((p) => (p.say ? done[i++] : p.s)).join('');
}

/** A short stable key for the text that was translated, so an edit is translated again. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ':' + s.length;
}
