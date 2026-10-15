// Which component draws which block type, and an answer drawn from its blocks with each number said once.
// To add a block type: write a component that takes BlockProps, then registerBlock('type', Component). A type with no
// component draws the markdown the Brain sends with it, so a new server type never breaks the page.
import type { ComponentType } from 'react';
import { ErrorBoundary } from '@/shell/ErrorBoundary';
import { fmt, md, nounOf, safeHref, shortTitle } from '../fmt';
import { Ic } from '../icons';
import type { Block } from '../types';
import type { BlockCtx, BlockProps } from './ctx';
import { ChartBlock, ChoiceBlock, ConfirmBlock, ConsentBlock, CoverageBlock, Html, NoteBlock, PartnerBlock, SheetBlock, SourcesBlock, StepsBlock, TeamBlock, TextBlock, TilesBlock } from './basic';
import { TableBlock } from './table';
import { FilesBlock } from './media';
import { CalendarBlock, FileListBlock, MailBlock, TasksBlock } from './typed';

const REG = new Map<string, ComponentType<BlockProps>>();
export function registerBlock(type: string, view: ComponentType<BlockProps>) {
  REG.set(type, view);
}
registerBlock('text', TextBlock);
registerBlock('tiles', TilesBlock);
registerBlock('table', TableBlock);
registerBlock('team', TeamBlock);
registerBlock('chart', ChartBlock);
registerBlock('partner', PartnerBlock);
registerBlock('coverage', CoverageBlock);
registerBlock('steps', StepsBlock);
registerBlock('confirm', ConfirmBlock);
registerBlock('note', NoteBlock);
registerBlock('choice', ChoiceBlock);
registerBlock('sheet', SheetBlock);
registerBlock('sources', SourcesBlock);
registerBlock('consent', ConsentBlock);
registerBlock('files', FilesBlock);
registerBlock('calendar', CalendarBlock);
registerBlock('mail', MailBlock);
registerBlock('filelist', FileListBlock);
registerBlock('tasks', TasksBlock);

export function BlockView({ b, ctx }: BlockProps) {
  const View = REG.get(b.type);
  if (!View) return b.md ? <Html className="blk-text" html={md(b.md)} /> : null;
  return (
    <ErrorBoundary label="This part of the answer could not draw." className="note">
      <View b={b} ctx={ctx} />
    </ErrorBoundary>
  );
}

/** An answer the check held back, handed to Claude with a friendly card (Will, 2026-10-14: "more of an encouragement"). */
function Handoff({ blocks, ctx }: { blocks: Block[]; ctx: BlockCtx }) {
  const held = blocks.find((b) => b.type === 'note' && /can.t answer this one reliably/i.test(b.title || ''));
  const src = blocks.find((b) => b.type === 'sources' && (b.items || []).some((i: { label?: string }) => /Continue in Claude/i.test(i.label || '')));
  const link = src ? ((src.items as { label?: string; href?: string }[]).find((i) => /Continue in Claude/i.test(i.label || '')) || {}).href : '';
  const m = /Here is how I read it:\s*(.*?)\s*That may not be/i.exec((held && held.body) || '');
  const read = m && m[1] && m[1].length < 110 && !/^searched/i.test(m[1]) ? m[1].replace(/\.$/, '') : '';
  return (
    <div className="blk-handoff">
      <div className="blk-handoff__ic" aria-hidden="true">
        <Ic n="spark" />
      </div>
      <div className="blk-handoff__tx">
        <b>Let's take this one to Claude</b>
        <p>I'm sharper in Claude for questions like this. Your question and what I found so far are ready to go.</p>
        {read && <p className="blk-handoff__rd">I read it as: {read}.</p>}
        <div className="blk-handoff__acts">
          {link && (
            <a className="h-btn h-btn--primary h-btn--sm" href={safeHref(link)} target="_blank" rel="noopener">
              Continue in Claude <Ic n="ext" />
            </a>
          )}
          <button type="button" className="h-btn h-btn--ghost h-btn--sm" onClick={() => ctx.engine.rephrase?.(ctx.turn.q)}>
            Rephrase
          </button>
        </div>
      </div>
    </div>
  );
}

// The figures in a sentence, years left out ("2026 so far" is a period, not a figure).
const FIG = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const figs = (t: string) => (t.match(FIG) || []).filter((x) => !/^(19|20)\d\d$/.test(x));
const val = (x: string) => Number(x.replace(/[$,%]/g, ''));

/**
 * An answer's blocks with each number said once: a lone figure tile followed by a short sentence that repeats it ("121
 * partners (households).") becomes one headline line, the figure and a short label ("121 lapsed partners in Ohio").
 * With the steps above the answer, the "How I read it" line is not said again under it.
 */
export function Answer({ blocks, ctx, steps }: { blocks: Block[]; ctx: Omit<BlockCtx, 'bi'>; steps: boolean }) {
  const all = blocks || [];
  if (all.some((b) => b.type === 'note' && /can.t answer this one reliably/i.test(b.title || ''))) return <Handoff blocks={all} ctx={{ ...ctx, bi: -1 }} />;
  // Keep each block's index in the turn (the table state and the action cards find it by that).
  let bs = all.map((b, bi) => ({ b, bi }));
  if (steps)
    bs = bs
      .map((x) => (x.b.type === 'text' && /How I read it/i.test(x.b.md || '') ? { bi: x.bi, b: { ...x.b, md: String(x.b.md).split(/\n/).filter((l) => !/^\s*_?How I read it/i.test(l)).join('\n').trim() } } : x))
      .filter((x) => !(x.b.type === 'text' && !x.b.md));
  let head = null;
  const ti = bs.findIndex(({ b }) => b.type === 'tiles' && (b.tiles || []).length === 1 && typeof b.tiles[0].value === 'number' && !b.tiles[0].delta && !b.tiles[0].trend && b.tiles[0].progress == null && !b.tiles[0].compare);
  if (ti >= 0) {
    const tile = bs[ti].b.tiles[0];
    const shown = fmt(tile.value, tile.format || 'int');
    let tok = '';
    const xi = bs.findIndex(({ b }, k) => {
      if (k <= ti || k > ti + 2 || b.type !== 'text') return false;
      const t = String(b.md || '').replace(/[*_]/g, '').replace(/\s*\([^)]*\)/g, '').trim();
      const f = figs(t);
      if (t.length >= 120 || f.length !== 1 || Math.round(val(f[0])) !== Math.round(tile.value)) return false;
      tok = f[0];
      return true;
    });
    if (xi >= 0) {
      const tb = all.find((b) => b.type === 'table' && b.title);
      const said = String(bs[xi].b.md).replace(/[*_]/g, '').replace(/\s*\([^)]*\)/g, '').trim();
      const rest = tb ? shortTitle(tb.title, nounOf(tb)).replace(/^\w/, (c) => c.toLowerCase()) : said.replace(tok, '').replace(/^[\s:,-]+/, '').replace(/[\s:,.-]+$/, '');
      head = (
        <div className="blk-head">
          <b>{shown}</b> <span>{rest || tile.label}</span>
        </div>
      );
      bs = bs.filter((_, k) => k !== xi && k !== ti);
    }
  }
  return (
    <>
      {head}
      {bs.map(({ b, bi }) => (
        <BlockView key={bi} b={b} ctx={{ ...ctx, bi }} />
      ))}
    </>
  );
}
