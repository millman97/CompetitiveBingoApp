// Live updates.
//
// The board is pushed, not polled. What goes over the socket is board state — tile progress,
// ownership, lines, the end of the game — and never raw events: the activity feed is a paginated
// HTTP read, because a log and a board change at very different rates.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import type { ServerMessage } from '../src/worker/do/game-room';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a socket and collects everything the server sends down it. */
const listen = async (gameId: string, since?: number) => {
  const url = new URL(`${BASE}/api/board/${gameId}/socket`);
  if (since !== undefined) {
    url.searchParams.set('since', String(since));
  }

  const response = await app.fetch(
    new Request(url, { headers: { Upgrade: 'websocket' } }),
    testEnv,
  );

  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const messages: ServerMessage[] = [];

  // The listener goes on before accept(): anything the server sent during the upgrade is
  // buffered and dispatched the moment the socket is accepted, so attaching afterwards misses it.
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(event.data as string) as ServerMessage);
  });
  socket.accept();

  await pause(50);
  return { socket, messages };
};

const setUp = async () => {
  const game = await seedGame(env.DB, {
    mode: 'CONTROL',
    winCondition: 'MOST_AT_DEADLINE',
    trackedMetrics: ['kc.vorkath', 'kc.zulrah'],
  });

  const tileIds = await seedTiles(env.DB, game.id, [
    { row: 0, col: 0, label: 'Vorkath', metrics: ['kc.vorkath'], aggregate: 'SUM', target: 2 },
    { row: 0, col: 1, label: 'Zulrah', metrics: ['kc.zulrah'], aggregate: 'SUM', target: 2 },
  ]);

  const hash = `-40${Date.now() % 100000}`;
  const client = new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({ accountHash: hash, displayName: 'Watcher', gameId: game.id }),
  );
  await client.sync(game.joinCode);
  await assignTeam(env.DB, game.id, hash, game.teams[0]!.id);

  return { game, tileIds, client };
};

describe('connecting', () => {
  it('sends the whole board on a first connection', async () => {
    const { game } = await setUp();
    const { messages } = await listen(game.id);

    expect(messages).toHaveLength(1);
    const first = messages[0]!;
    expect(first.type).toBe('snapshot');

    if (first.type !== 'snapshot') {
      throw new Error('expected a snapshot');
    }

    expect(first.board.gameId).toBe(game.id);
    expect(first.board.mode).toBe('CONTROL');
    expect(first.board.tiles).toHaveLength(2);
    expect(first.board.teams).toHaveLength(2);
    expect(first.board.rows).toBe(5);
  });

  it('404s a game that does not exist', async () => {
    const response = await app.fetch(
      new Request(`${BASE}/api/board/g_nope/socket`, { headers: { Upgrade: 'websocket' } }),
      testEnv,
    );

    expect(response.status).toBe(404);
  });

  // A client that cannot open a socket reads this instead. Polling is deliberately not the
  // primary path, but a cached snapshot is a better fallback than a blank page.
  it('serves the same board over plain HTTP', async () => {
    const { game } = await setUp();
    const response = await transport.fetch(new Request(`${BASE}/api/board/${game.id}`));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: number; board: { tiles: unknown[] } };
    expect(body.board.tiles).toHaveLength(2);
  });
});

describe('patches', () => {
  it('pushes a patch when a tile changes', async () => {
    const { game, client } = await setUp();
    const { messages } = await listen(game.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    await pause(100);

    const patches = messages.filter((message) => message.type === 'patch');
    expect(patches.length).toBeGreaterThan(0);

    const changes = patches.flatMap((patch) =>
      patch.type === 'patch' ? patch.changes : [],
    );
    const tileChange = changes.find((change) => change.kind === 'TILE');

    expect(tileChange).toBeDefined();
    if (tileChange?.kind === 'TILE') {
      expect(tileChange.tile.progress[0]).toMatchObject({ score: 1, complete: false });
      expect(tileChange.tile.ownerTeamId).toBe(game.teams[0]!.id);
    }
  });

  it('says nothing when an event changes no tile', async () => {
    const { game, client } = await setUp();
    const { messages } = await listen(game.id);
    const before = messages.length;

    // Tracked by the game but on no tile of the board.
    await env.DB.prepare("INSERT INTO game_metrics (game_id, metric_id, label) VALUES (?, 'kc.hydra', NULL)")
      .bind(game.id)
      .run();
    await client.sendOne(await client.player.kill('Hydra'));
    await pause(100);

    expect(messages).toHaveLength(before);
  });

  it('reports the end of a game', async () => {
    const { game, client } = await setUp();
    const { messages } = await listen(game.id);

    await env.DB.prepare("UPDATE games SET state = 'LIVE', ends_at = ? WHERE id = ?")
      .bind(Date.now() - 1000, game.id)
      .run();
    await client.sendOne(await client.player.kill('Vorkath'));
    await pause(100);

    const room = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(game.id));
    const { runDurableObjectAlarm } = await import('cloudflare:test');
    await runDurableObjectAlarm(room);
    await pause(1200);

    const changes = messages.flatMap((message) =>
      message.type === 'patch' ? message.changes : [],
    );

    expect(changes.some((change) => change.kind === 'GAME' && change.state === 'ENDED')).toBe(true);
  });
});

describe('reconnecting', () => {
  // On reconnect a client names where it got to and receives a diff, not the whole board.
  it('sends only what a returning client missed', async () => {
    const { game, client } = await setUp();

    const first = await listen(game.id);
    const snapshot = first.messages[0]!;
    if (snapshot.type !== 'snapshot') {
      throw new Error('expected a snapshot');
    }

    await client.sendOne(await client.player.kill('Vorkath'));
    await pause(1200);
    await client.sendOne(await client.player.kill('Zulrah'));
    await pause(1200);

    const versions = first.messages
      .filter((message) => message.type === 'patch')
      .map((message) => message.version);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    // Reconnect claiming to have seen everything up to the first patch.
    const resumed = await listen(game.id, versions[0]);

    expect(resumed.messages.every((message) => message.type === 'patch')).toBe(true);
    expect(resumed.messages.map((message) => message.version)).toEqual(versions.slice(1));
  });

  it('falls back to the whole board when a client is too far behind', async () => {
    const { game } = await setUp();

    // A version this object has never issued: it cannot know what that client is missing.
    const { messages } = await listen(game.id, 999);

    expect(messages[0]?.type).toBe('snapshot');
  });
});

describe('broadcast batching', () => {
  // Capped at one per second. Nothing is dropped: patches are versioned and appended before they
  // are sent, so a deferred flush catches up on everything past the version it last sent.
  it('coalesces a burst into one send without losing changes', async () => {
    const { game, client } = await setUp();
    const { messages } = await listen(game.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Vorkath'));
    await client.sendOne(await client.player.kill('Zulrah'));

    await pause(1500);

    const patches = messages.filter((message) => message.type === 'patch');
    const changes = patches.flatMap((patch) => (patch.type === 'patch' ? patch.changes : []));
    const tiles = changes.filter((change) => change.kind === 'TILE');

    // Every change arrives, and the Vorkath tile shows the final total rather than a stale one.
    expect(tiles.length).toBeGreaterThanOrEqual(2);

    const vorkath = tiles
      .filter((change) => change.kind === 'TILE' && change.tile.label === 'Vorkath')
      .pop();

    if (vorkath?.kind === 'TILE') {
      expect(vorkath.tile.progress[0]).toMatchObject({ score: 2, complete: true });
    }
  });
});
