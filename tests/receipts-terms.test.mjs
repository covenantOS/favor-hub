// Favor's words (Will Hamilton, 2026-10-12): the printed mailing every partner who gives gets is a RECEIPT. A thank-you LETTER is the
// handwritten letter to a higher-level partner (the HQ thank-you letters, the HQTY tab of the Work Center). Staff-facing text in the
// Receipts page, its messages, its help article and the receipt tours, the Learn receipt quizzes and the Today card must never call a
// receipt a letter. Only text a person reads is checked: variable names, API fields and table columns (`letters`, `letter_date`) stay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/** A phrase that may keep the word: the HQ letters, Blackbaud values that must match, and the paper size. */
const ALLOWED = [
  /HQTY/i,
  /headquarters/i,
  /Thank You Letter/, // Blackbaud appeal category 2115
  /thank you letter donation/, // description sent to Blackbaud with the monthly reply code
  /\bLetter (paper|size)\b/, // 8.5 x 11 paper in a printing question
  /\bHQ\b/,
  /first-gift letters?/i, // Gifts > First-gift letters: the page Receipts hands acquisition first gifts to
];
const WORD = /\bletters?\b/i;

/** Every quoted string in a source file, with ${...} parts cut out and one-word keys and ids skipped. */
function stringsOf(src) {
  const out = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|\$\{(?:[^{}]|\{[^{}]*\})*\}|[^`\\])*)`/g;
  for (const m of src.matchAll(re)) {
    let s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
    s = s.replace(/\s(id|class|for|name|href|data-[\w-]+)="[^"]*"/g, '');
    if (/^[\w:.\-/]*$/.test(s.trim())) continue;
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(s)) continue; // SQL names columns, not words a person reads
    out.push(s);
  }
  return out;
}

const offenders = (strings) => strings.filter((s) => WORD.test(s) && !ALLOWED.some((a) => a.test(s)));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the checker flags a receipt called a letter and lets the HQ letters through', () => {
  assert.equal(offenders(['There are no letters to print.', 'The letter wording is too long for the page.']).length, 2);
  assert.equal(offenders(['Print the HQTY letters', 'Thank You Letter', 'Direct Mail, thank you letter donation, March 2026', 'Letter paper, actual size, one side']).length, 0);
  assert.equal(stringsOf("const a = `${n} letters for ${g} gifts`; const b = 'letters';").length, 1);
});

// Files where every string a person can read is about the receipts run.
const RECEIPT_FILES = [
  'public/js/receipts.js',
  'functions/_lib/receipts/check.ts',
  'functions/_lib/receipts/store.ts',
  'functions/_lib/receipts/rules.ts',
  'functions/api/receipts/wording.ts',
  'functions/api/receipts/batches/index.ts',
  'functions/api/receipts/batches/[id]/index.ts',
  'functions/api/receipts/batches/[id]/mark.ts',
  'functions/api/receipts/batches/[id]/pdf.ts',
];
for (const f of RECEIPT_FILES) {
  test(`no receipt is called a letter in ${f}`, () => {
    assert.deepEqual(offenders(stringsOf(stripComments(read(f)))), []);
  });
}

test('the Receipts page markup does not call a receipt a letter', () => {
  const html = read('src/pages/receipts/index.astro').replace(/\s(id|class|for|href|data-[\w-]+)="[^"]*"/g, '');
  assert.deepEqual(html.match(/[^<>\n]*\bletters?\b[^<>\n]*/gi) || [], []);
});

test('the Receipts help article keeps the HQ letter apart from the receipt', () => {
  const text = read('src/content/help/thank-you-receipts.md');
  const bad = text.split(/\r?\n/).filter((l) => WORD.test(l) && !ALLOWED.some((a) => a.test(l)));
  assert.deepEqual(bad, []);
  assert.match(text, /thank-you letter from headquarters/);
});

test('tour text about receipts never says letter outside the HQTY tours', () => {
  const bad = offenders(stringsOf(read('web/src/features/tour/data.ts')).filter((s) => /receipt/i.test(s)));
  assert.deepEqual(bad, []);
});

test('Learn quiz lines about receipts never say letter outside the paper size', () => {
  const lines = stringsOf(read('functions/_lib/learn/seed.ts')).filter((s) => /receipt|print file|Held back|Mark as thanked|uncheck/i.test(s));
  assert.ok(lines.length > 5);
  assert.deepEqual(offenders(lines), []);
});

test('Today names a print file as receipts and still reads the older log lines that said letters', () => {
  const src = read('functions/_lib/hub/today.ts');
  assert.ok(src.includes("made a print file of ${count[1] || 'the'} receipts"));
  assert.ok(src.includes('(?:receipts|letters) for'));
});

test('search keywords for the Receipts page do not include letter', () => {
  for (const f of ['src/data/areas.ts', 'src/data/palette.ts']) {
    const line = read(f).split(/\r?\n/).find((l) => l.includes("href: '/receipts/'"));
    assert.ok(line, f);
    assert.doesNotMatch(line, /\bletters?\b/i, f);
  }
});

// The web app's Receipts page (web/src/features/receipts): the quoted strings and the text between tags.
for (const f of ['Panels.tsx', 'ReceiptsPage.tsx', 'Ask.tsx', 'logic.ts']) {
  test(`no receipt is called a letter in web/src/features/receipts/${f}`, () => {
    const src = stripComments(read(`web/src/features/receipts/${f}`));
    const text = [...src.matchAll(/>\s*([^<>{}=;()\n][^<>{}]*?)\s*</g)].map((m) => m[1]);
    assert.deepEqual(offenders(stringsOf(src).concat(text)), []);
  });
}
