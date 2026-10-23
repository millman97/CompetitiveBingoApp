import type { QueryClient } from '@tanstack/react-query';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import apiFetchSnapshot from '../apis/board/apiFetchSnapshot';
import type { BoardState, Snapshot } from '../model/domain/Board/BoardState';

/** Mirrors the Durable Object's outbound message union. */
export type BoardChange =
  | { kind: 'TILE'; tile: BoardState['tiles'][number] }
  | { kind: 'LINES'; lines: BoardState['lines'] }
  | {
      kind: 'GAME';
      state: BoardState['state'];
      endsAt: number;
      winner: BoardState['winner'];
    };

export type ServerMessage =
  | { type: 'snapshot'; version: number; board: BoardState }
  | { type: 'patch'; version: number; changes: BoardChange[] };

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline';

export const boardKey = (gameId: string) => ['board', gameId] as const;

/** One bounded recovery sequence. A visible/online transition may start a fresh sequence. */
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000];

/** Null means this recovery sequence is exhausted and must stop opening sockets. */
export const socketRetryDelay = (attempt: number): number | null =>
  RETRY_MS[attempt] ?? null;

/** Only used once the socket has given up entirely; background tabs do not run this timer. */
export const FALLBACK_POLL_MS = 60000;

export const applyChange = (
  board: BoardState,
  change: BoardChange
): BoardState => {
  switch (change.kind) {
    case 'TILE':
      return {
        ...board,
        tiles: board.tiles.map((tile) =>
          tile.tileId === change.tile.tileId ? change.tile : tile
        ),
      };

    case 'LINES':
      return { ...board, lines: change.lines };

    case 'GAME':
      return {
        ...board,
        state: change.state,
        endsAt: change.endsAt,
        winner: change.winner,
      };
  }
};

export const applyPatch = (
  client: QueryClient,
  gameId: string,
  version: number,
  changes: BoardChange[]
): void => {
  client.setQueryData<Snapshot>(boardKey(gameId), (current) => {
    if (current === undefined) {
      return current;
    }

    return {
      version,
      board: changes.reduce(applyChange, current.board),
    };
  });
};

export interface LiveBoard {
  retry: () => void;
  board: BoardState | undefined;
  connection: Connection;
  error: Error | null;
  isLoading: boolean;
  /** Tiles that changed in the last moment, so the board can pulse them once. */
  recentlyChanged: Set<string>;
}

export const useLiveBoard = (gameId: string): LiveBoard => {
  const client = useQueryClient();
  const [connection, setConnection] = useState<Connection>('connecting');
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(
    new Set()
  );

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  const query = useQuery({
    queryKey: boardKey(gameId),
    queryFn: () => apiFetchSnapshot(gameId),
    // The socket keeps this fresh. Refetching on window focus would fight it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: connection === 'offline' ? FALLBACK_POLL_MS : false,
  });

  const markChanged = useCallback((tileIds: string[]) => {
    if (tileIds.length === 0) {
      return;
    }
    setRecentlyChanged(new Set(tileIds));
    window.setTimeout(() => setRecentlyChanged(new Set()), 1000);
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current) {
      return;
    }

    const existing = socketRef.current;
    if (
      existing !== null &&
      (existing.readyState === WebSocket.CONNECTING ||
        existing.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = null;

    // Resume from where this client got to, so a reconnect costs a diff rather than a board.
    const seen = client.getQueryData<Snapshot>(boardKey(gameId))?.version;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL(
      `${protocol}//${window.location.host}/api/board/${encodeURIComponent(gameId)}/socket`
    );
    if (seen !== undefined) {
      url.searchParams.set('since', String(seen));
    }

    const socket = new WebSocket(url.toString());
    socketRef.current = socket;

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) {
        socket.close();
        return;
      }
      attemptRef.current = 0;
      setConnection('live');
    });

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) {
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (message.type === 'snapshot') {
        client.setQueryData<Snapshot>(boardKey(gameId), {
          version: message.version,
          board: message.board,
        });
        return;
      }

      applyPatch(client, gameId, message.version, message.changes);
      markChanged(
        message.changes
          .filter(
            (change): change is Extract<BoardChange, { kind: 'TILE' }> =>
              change.kind === 'TILE'
          )
          .map((change) => change.tile.tileId)
      );
    });

    const retry = () => {
      if (closedRef.current || socketRef.current !== socket) {
        return;
      }

      socketRef.current = null;

      const attempt = attemptRef.current;
      const wait = socketRetryDelay(attempt);
      if (wait === null) {
        setConnection('offline');
        return;
      }

      attemptRef.current = attempt + 1;
      setConnection('reconnecting');
      timerRef.current = window.setTimeout(connect, wait);
    };

    socket.addEventListener('close', retry);
    socket.addEventListener('error', () => socket.close());
  }, [client, gameId, markChanged]);

  useEffect(() => {
    closedRef.current = false;
    connect();

    const retryWhenUseful = () => {
      const current = socketRef.current;
      if (
        closedRef.current ||
        (current !== null &&
          (current.readyState === WebSocket.CONNECTING ||
            current.readyState === WebSocket.OPEN))
      ) {
        return;
      }

      attemptRef.current = 0;
      setConnection('reconnecting');
      connect();
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        retryWhenUseful();
      }
    };

    window.addEventListener('online', retryWhenUseful);
    document.addEventListener('visibilitychange', retryWhenVisible);

    return () => {
      closedRef.current = true;
      window.removeEventListener('online', retryWhenUseful);
      document.removeEventListener('visibilitychange', retryWhenVisible);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      socketRef.current?.close();
    };
  }, [connect]);

  return {
    retry: () => {
      attemptRef.current = 0;
      socketRef.current?.close();
      socketRef.current = null;
      setConnection('reconnecting');
      void query.refetch();
      connect();
    },
    board: query.data?.board,
    connection,
    error: query.error,
    isLoading: query.isLoading,
    recentlyChanged,
  };
};

export default useLiveBoard;
