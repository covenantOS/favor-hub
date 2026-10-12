import { describe, expect, it } from 'vitest';
import { MIGRATED_ROUTES, normalizeRoute, parseRoutes, routeServed } from '@shared/app2';

describe('which routes the app serves', () => {
  it('normalizes trailing slashes and queries', () => {
    expect(normalizeRoute('/')).toBe('/');
    expect(normalizeRoute('/chat')).toBe('/chat/');
    expect(normalizeRoute('/chat/?c=1#x')).toBe('/chat/');
  });
  it('an empty setting serves nothing, * serves every migrated route', () => {
    expect(parseRoutes('')).toEqual([]);
    expect(parseRoutes(null)).toEqual([]);
    expect(parseRoutes('*')).toEqual(MIGRATED_ROUTES.map(normalizeRoute));
  });
  it('drops routes the app has not built', () => {
    expect(parseRoutes('/, /nope/')).toEqual(['/']);
    expect(parseRoutes('/chat/')).toEqual(['/chat/']);
    expect(parseRoutes('/nope/')).toEqual([]);
  });
  it('/ matches only itself; other routes own what is under them', () => {
    expect(routeServed('/', ['/'])).toBe(true);
    expect(routeServed('/work/', ['/'])).toBe(false);
    expect(routeServed('/meet/room/', ['/meet/'])).toBe(false);
    expect(routeServed('/meet/', ['/meet/'])).toBe(true);
    expect(routeServed('/chat/general', ['/chat/'])).toBe(true);
    expect(routeServed('/chatter/', ['/chat/'])).toBe(false);
    expect(routeServed('/', [])).toBe(false);
  });
});
