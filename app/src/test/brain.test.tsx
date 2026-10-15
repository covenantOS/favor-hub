// Favor Brain in React: titles said plainly, the step summary, a figure said once, the hand-off card, unknown blocks drawn as
// their markdown, and the chat list's groups.
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { shortTitle, nounOf, md } from '@/features/brain/fmt';
import { summary } from '@/features/brain/Trace';
import { Answer, registerBlock } from '@/features/brain/blocks/registry';
import { BrainEngine } from '@/features/brain/engine';
import { ConvList } from '@/features/brain/ConvList';
import type { Turn } from '@/features/brain/types';

const ctxOf = (turn: Turn) => ({ engine: new BrainEngine('page'), turn, ti: 0, expired: false, where: 'page' as const, ask: () => {}, openTable: () => {} });

describe('Favor Brain in React', () => {
  it('says table titles as short noun phrases', () => {
    expect(shortTitle('How many lapsed (last gift over 24 months ago) partners (households) in Ohio')).toBe('Lapsed partners in Ohio');
    expect(shortTitle('Lapsed, major (a single gift of $1,000 or more', nounOf({ cols: [{ label: 'Partner' }] }))).toBe('Lapsed major partners');
  });
  it('sums the steps into one line, and a held answer is a hand-off', () => {
    expect(summary([{ id: 'read', label: 'Read your question', status: 'done', at: 0, ms: 400 }, { id: 'lookup', label: 'Looked up partners', status: 'done', at: 400, ms: 900, count: '121' }, { id: 'check', label: 'Checked the numbers', status: 'done', at: 1300, ms: 1700 }]).text).toBe('Read your question, found 121 partners, checked in 3.0 s');
    expect(summary([{ id: 'check', label: 'Held the answer back', status: 'withheld', at: 0, ms: 4000 }])).toEqual({ text: 'Handed off to Claude in 4.0 s', held: true });
  });
  it('says a figure once, as a headline', () => {
    const blocks = [
      { type: 'tiles', tiles: [{ label: 'Households', value: 121, format: 'int' }] },
      { type: 'text', md: '**121** partners (households).' },
    ];
    const turn: Turn = { q: 'q', blocks, reading: [], follow: [] };
    const html = renderToString(<Answer blocks={blocks} ctx={ctxOf(turn)} steps={false} />);
    expect(html).toContain('blk-head');
    expect(html.match(/121/g)).toHaveLength(1);
  });
  it('turns a held answer into the Claude card with Rephrase', () => {
    const blocks = [
      { type: 'note', tone: 'warn', title: "I can't answer this one reliably.", body: 'Here is how I read it: x. That may not be exactly what you asked.' },
      { type: 'sources', items: [{ label: 'Continue in Claude', href: 'https://claude.ai/new' }] },
    ];
    const html = renderToString(<Answer blocks={blocks} ctx={ctxOf({ q: 'q', blocks, reading: [], follow: [] })} steps={false} />);
    expect(html).toContain("Let&#x27;s take this one to Claude");
    expect(html).toContain('Rephrase');
    expect(html).not.toContain('reliably');
  });
  it('draws an unknown block as its markdown, and a registered one with its component', () => {
    const blocks = [{ type: 'brand_new', md: '**Hello**' }];
    expect(renderToString(<Answer blocks={blocks} ctx={ctxOf({ q: 'q', blocks, reading: [], follow: [] })} steps={false} />)).toContain('<strong>Hello</strong>');
    registerBlock('brand_new', () => <i className="made-for-test" />);
    expect(renderToString(<Answer blocks={blocks} ctx={ctxOf({ q: 'q', blocks, reading: [], follow: [] })} steps={false} />)).toContain('made-for-test');
  });
  it('escapes markdown', () => {
    expect(md('<script>x</script>')).not.toContain('<script>');
  });
  it('groups chats and folds repeats', () => {
    const now = new Date().toISOString();
    const html = renderToString(<ConvList e={new BrainEngine('page')} list={[{ id: 'c_a1', title: 'how many partners?', pinned: 0, changed_at: now, same: ['c_b2'] }, { id: 'c_c3', title: 'Pinned one', pinned: 1, changed_at: now }]} onOpen={() => {}} />);
    expect(html.indexOf('Pinned')).toBeLessThan(html.indexOf('Today'));
    expect(html).toContain('How many partners');
    expect(html).toContain('Asked 2 times');
  });
});
