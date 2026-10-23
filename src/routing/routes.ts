export const GAME_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings & teams' },
  { id: 'board', label: 'Board' },
  { id: 'roster', label: 'Players' },
  { id: 'flags', label: 'Review flags' },
  { id: 'evidence', label: 'Screenshots' },
  { id: 'adjust', label: 'Adjust scores' },
  { id: 'log', label: 'Admin history' },
] as const;

export type GameTab = (typeof GAME_TABS)[number]['id'];

export type AppRoute =
  | { kind: 'events' }
  | { kind: 'board'; gameId: string }
  | { kind: 'games' }
  | { kind: 'login' }
  | { kind: 'setup' }
  | { kind: 'game'; gameId: string; tab: GameTab }
  | { kind: 'notFound' };

export const gamePath = (gameId: string, tab: GameTab = 'overview') =>
  `/admin/games/${encodeURIComponent(gameId)}/${tab}`;

export const boardPath = (gameId: string) => `/g/${encodeURIComponent(gameId)}`;

export const parseRoute = (pathname: string): AppRoute => {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/events') return { kind: 'events' };
  if (path === '/admin') return { kind: 'games' };
  if (path === '/admin/login') return { kind: 'login' };
  if (path === '/admin/new') return { kind: 'setup' };

  try {
    const board = /^\/g\/([^/]+)$/.exec(path);
    if (board?.[1])
      return { kind: 'board', gameId: decodeURIComponent(board[1]) };
    const game = /^\/admin\/games\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (game?.[1]) {
      const tab = GAME_TABS.find(
        (entry) => entry.id === (game[2] ?? 'overview')
      );
      if (tab)
        return {
          kind: 'game',
          gameId: decodeURIComponent(game[1]),
          tab: tab.id,
        };
    }
  } catch {
    return { kind: 'notFound' };
  }
  return { kind: 'notFound' };
};
