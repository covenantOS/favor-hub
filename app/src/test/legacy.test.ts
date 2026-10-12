import { describe, expect, it } from 'vitest';
import { keyOf } from '@/legacy/page';
import { layoutOf } from '@/shell/meta';

describe('classic pages inside the frame', () => {
  it('keys a page by path and query, with one trailing slash', () => {
    expect(keyOf('/chat')).toBe('/chat/');
    expect(keyOf('/chat/?c=3')).toBe('/chat/?c=3');
    expect(keyOf('https://dash.favorintl.org/mail/#/INBOX')).toBe('/mail/');
  });
  it('reads the page width from the classes the layout put on main', () => {
    expect(layoutOf('h-bare')).toBe('bare');
    expect(layoutOf('h-page h-page--wide')).toBe('wide');
    expect(layoutOf('h-page h-page--full')).toBe('full');
    expect(layoutOf('h-page')).toBe('page');
  });
});
