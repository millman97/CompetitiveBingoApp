import { describe, expect, it } from 'vitest';

import { boardPath, gamePath, parseRoute } from '../routes';

describe('public and organiser links', () => {
  it('opens the public event list at the instance root or Events URL', () => {
    expect(parseRoute('/')).toEqual({ kind: 'events' });
    expect(parseRoute('/events/')).toEqual({ kind: 'events' });
  });
  it('keeps old public links and the admin entry point valid', () => {
    expect(parseRoute('/g/clan-event/')).toEqual({
      kind: 'board',
      gameId: 'clan-event',
    });
    expect(parseRoute('/admin')).toEqual({ kind: 'games' });
  });

  it('restores a specific admin section from its URL', () => {
    expect(parseRoute('/admin/games/autumn/roster')).toEqual({
      kind: 'game',
      gameId: 'autumn',
      tab: 'roster',
    });
    expect(parseRoute('/admin/games/autumn')).toEqual({
      kind: 'game',
      gameId: 'autumn',
      tab: 'overview',
    });
    expect(parseRoute('/admin/new')).toEqual({ kind: 'setup' });
  });

  it('round trips IDs containing reserved characters', () => {
    const id = 'clan/with spaces?';
    expect(parseRoute(boardPath(id))).toEqual({ kind: 'board', gameId: id });
    expect(parseRoute(gamePath(id, 'flags'))).toEqual({
      kind: 'game',
      gameId: id,
      tab: 'flags',
    });
  });

  it.each([
    '/administer',
    '/admin/no-such-page',
    '/g/%E0%A4%A',
    '/admin/games/%ZZ',
    '/admin/games/a/unknown',
    '/g/a/extra',
  ])('recovers from an invalid link: %s', (url) => {
    expect(parseRoute(url)).toEqual({ kind: 'notFound' });
  });
});
