// Names the mirror holds encoded twice ("SilÃ©n") reach the Work Center the way Blackbaud spells them, and nothing else changes.
// The server HTML and the board answer must carry the same text, or the React page fails to hydrate (React error 418).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import './support/resolve-ts.mjs';

const { unMojibake, publicRow } = await import('../functions/_lib/work/service.ts');

describe('unMojibake', () => {
  it('puts back UTF-8 read as Latin-1', () => {
    assert.equal(unMojibake('Peter Peter SilÃ©n'), 'Peter Peter Silén');
    assert.equal(unMojibake('FranÃ§ois'), 'François');
    assert.equal(unMojibake('Ã©glise'), 'église');
  });
  it('leaves correct text alone', () => {
    for (const s of ['Silén', 'São Paulo', '€ price', 'Plain name', 'Café Ã la mode', '']) assert.equal(unMojibake(s), s);
  });
  it('repairs the text fields of a board row and drops the server-only ones', () => {
    const row = publicRow({ id: '1', partner: 'SilÃ©n', place: 'MontrÃ©al', summary: 'Call', description: 'd', fullDescription: 'x', mod: 'm', gift: { id: 'g', amount: 1, date: '2026-10-01', fund: 'CafÃ©' } });
    assert.equal(row.partner, 'Silén');
    assert.equal(row.place, 'Montréal');
    assert.equal(row.gift.fund, 'Café');
    assert.equal('fullDescription' in row, false);
    assert.equal('mod' in row, false);
  });
});
