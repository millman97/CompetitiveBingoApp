// CONTROL mode through the real stack: the Worker stores events, the game's Durable Object
// settles ownership, detects lines and decides whether the game is over.

import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { findGameById } from '../src/worker/db/games';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, type SeedTile } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

/** A 3x3 CONTROL board where every tile is one kill, so lines are quick to build. */
const oneKillBoard = (): SeedTile[] => {
  const tiles: SeedTile[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      tiles.push({
        row,
        col,
        label: `${row},${col}`,
        metrics: [`kc.tile_${row}_${col}`],
        aggregate: 'SUM',
        target: 1,
      });
    }
  }
  return tiles;
};

const metricsOf = (tiles: SeedTile[]): string[] => tiles.flatMap((tile) => tile.metrics);

const setUp = async (options: {
  winCondition: 'FIRST_LINE' | 'MOST_AT_DEADLINE' | 'HYBRID_SUDDEN_DEATH';
  tiles?: SeedTile[];
  endsAt?: number;
  state?: 'LIVE' | 'SUDDEN_DEATH';
}) => {
  const tiles = options.tiles ?? oneKillBoard();

  const game = await seedGame(env.DB, {
    mode: 'CONTROL',
    winCondition: options.winCondition,
    backfillPolicy: 'IGNORE',
    state: options.state ?? 'LIVE',
    trackedMetrics: metricsOf(tiles),
    ...(options.endsAt === undefined ? {} : { endsAt: options.endsAt }),
  });

  await env.DB.prepare('UPDATE games SET board_rows = 3, board_cols = 3 WHERE id = ?')
    .bind(game.id)
    .run();

  const tileIds = await seedTiles(env.DB, game.id, tiles);

  const players: Record<string, SimulatedClient> = {};
  let index = 0;
  for (const team of [0, 1] as const) {
    const hash = `-3${options.winCondition.length}${team}${index++}${Date.now() % 10000}`;
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({
        accountHash: hash,
        displayName: team === 0 ? 'Shark' : 'Manta',
        gameId: game.id,
      }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, hash, game.teams[team]!.id);
    players[team === 0 ? 'shark' : 'manta'] = client;
  }

  return { game, tileIds, shark: players['shark']!, manta: players['manta']! };
};

/** Takes a tile by scoring the single kill it asks for. */
const take = async (client: SimulatedClient, row: number, col: number): Promise<void> => {
  await client.sendOne(await client.player.kill(`Tile ${row} ${col}`));
};

const ownerOf = async (gameId: string, tileId: string) =>
  env.DB.prepare('SELECT owner_team_id, contested FROM tile_ownership WHERE game_id = ? AND tile_id = ?')
    .bind(gameId, tileId)
    .first<{ owner_team_id: string | null; contested: number }>();

describe('tile ownership', () => {
  it('gives a tile to the team that leads it', async () => {
    const { game, tileIds, shark } = await setUp({ winCondition: 'MOST_AT_DEADLINE' });

    await take(shark, 0, 0);

    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: game.teams[0]!.id,
      contested: 0,
    });
  });

  it('contests a tile when both teams are level', async () => {
    const { game, tileIds, shark, manta } = await setUp({ winCondition: 'MOST_AT_DEADLINE' });

    await take(shark, 0, 0);
    await take(manta, 0, 0);

    expect(await ownerOf(game.id, tileIds[0]!)).toMatchObject({
      owner_team_id: null,
      contested: 1,
    });
  });

  // Ownership flips continuously as teams overtake each other. Sniping is intended: there is no
  // lockout and no stickiness.
  it('flips ownership when a team overtakes', async () => {
    const { game, tileIds, shark, manta } = await setUp({ winCondition: 'MOST_AT_DEADLINE' });
    const tile = tileIds[0]!;

    await take(shark, 0, 0);
    expect(await ownerOf(game.id, tile)).toMatchObject({ owner_team_id: game.teams[0]!.id });

    await take(manta, 0, 0);
    expect(await ownerOf(game.id, tile)).toMatchObject({ contested: 1 });

    await take(manta, 0, 0);
    expect(await ownerOf(game.id, tile)).toMatchObject({
      owner_team_id: game.teams[1]!.id,
      contested: 0,
    });
  });
});

describe('FIRST_LINE', () => {
  it('ends the game the instant a team owns a full row', async () => {
    const { game, shark } = await setUp({ winCondition: 'FIRST_LINE' });

    await take(shark, 0, 0);
    await take(shark, 0, 1);

    expect((await findGameById(env.DB, game.id))?.state).toBe('LIVE');

    await take(shark, 0, 2);

    const won = await findGameById(env.DB, game.id);
    expect(won).toMatchObject({ state: 'ENDED', wonByTeamId: game.teams[0]!.id });
    expect(won?.wonAt).toBeGreaterThan(0);
  });

  it('wins on a column and on a diagonal too', async () => {
    const column = await setUp({ winCondition: 'FIRST_LINE' });
    for (const row of [0, 1, 2]) {
      await take(column.shark, row, 1);
    }
    expect((await findGameById(env.DB, column.game.id))?.wonByTeamId).toBe(column.game.teams[0]!.id);

    const diagonal = await setUp({ winCondition: 'FIRST_LINE' });
    for (const i of [0, 1, 2]) {
      await take(diagonal.manta, i, i);
    }
    expect((await findGameById(env.DB, diagonal.game.id))?.wonByTeamId).toBe(
      diagonal.game.teams[1]!.id,
    );
  });

  // A won game is finished, so the board is locked by ending it. The plugin gets 410 on its next
  // post, which makes it stop emitting *and* forget the game rather than chase it on every login.
  it('locks the board so nothing scores afterwards', async () => {
    const { game, shark, manta } = await setUp({ winCondition: 'FIRST_LINE' });

    for (const col of [0, 1, 2]) {
      await take(shark, 0, col);
    }

    const late = await manta.sendRaw([await manta.player.kill('Tile 1 0')]);
    expect(late.status).toBe(410);

    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?')
      .bind(game.id)
      .first<{ n: number }>();
    expect(stored?.n).toBe(3);

    expect((await findGameById(env.DB, game.id))?.wonByTeamId).toBe(game.teams[0]!.id);
  });

  // The race the Durable Object exists for: two teams crossing the line in the same instant must
  // produce exactly one winner.
  it('produces exactly one winner when both teams complete a line at once', async () => {
    const { game, shark, manta } = await setUp({ winCondition: 'FIRST_LINE' });

    // Both are one tile away from a line of their own.
    await take(shark, 0, 0);
    await take(shark, 0, 1);
    await take(manta, 2, 0);
    await take(manta, 2, 1);

    // Same game tick, submitted concurrently.
    shark.player.setTick(500_000);
    manta.player.setTick(500_000);

    const [sharkEnvelope, mantaEnvelope] = await Promise.all([
      shark.player.kill('Tile 0 2'),
      manta.player.kill('Tile 2 2'),
    ]);

    await Promise.all([shark.sendOne(sharkEnvelope), manta.sendOne(mantaEnvelope)]);

    const finished = await findGameById(env.DB, game.id);

    expect(finished?.state).toBe('ENDED');
    expect(finished?.wonByTeamId).not.toBeNull();
    expect([game.teams[0]!.id, game.teams[1]!.id]).toContain(finished?.wonByTeamId);
  });

  it('records a final board snapshot when it ends', async () => {
    const { game, shark } = await setUp({ winCondition: 'FIRST_LINE' });

    for (const col of [0, 1, 2]) {
      await take(shark, 0, col);
    }

    const snapshot = await env.DB.prepare(
      'SELECT snapshot_json FROM board_snapshots WHERE game_id = ?',
    )
      .bind(game.id)
      .first<{ snapshot_json: string }>();

    expect(snapshot).not.toBeNull();

    const board = JSON.parse(snapshot!.snapshot_json) as {
      winner: { teamId: string } | null;
      lines: { teamId: string }[];
      tiles: unknown[];
    };

    expect(board.winner?.teamId).toBe(game.teams[0]!.id);
    expect(board.lines.length).toBeGreaterThan(0);
    expect(board.tiles).toHaveLength(9);
  });
});

describe('MOST_AT_DEADLINE', () => {
  const roomFor = (gameId: string) =>
    env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));

  it('settles at the deadline on most lines', async () => {
    const { game, shark, manta } = await setUp({ winCondition: 'MOST_AT_DEADLINE' });

    for (const col of [0, 1, 2]) {
      await take(shark, 0, col);
    }
    await take(manta, 2, 0);

    // Still running: only FIRST_LINE ends mid-flight.
    expect((await findGameById(env.DB, game.id))?.state).toBe('LIVE');

    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();
    await take(shark, 1, 0);
    await runDurableObjectAlarm(roomFor(game.id));

    const finished = await findGameById(env.DB, game.id);
    expect(finished).toMatchObject({ state: 'ENDED', wonByTeamId: game.teams[0]!.id });
  });

  it('ends without a winner when nobody built a line', async () => {
    const { game, shark } = await setUp({ winCondition: 'MOST_AT_DEADLINE' });

    await take(shark, 0, 0);

    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();
    await take(shark, 1, 1);
    await runDurableObjectAlarm(roomFor(game.id));

    const finished = await findGameById(env.DB, game.id);
    expect(finished?.state).toBe('ENDED');
    expect(finished?.wonByTeamId).toBeNull();
  });
});

describe('HYBRID_SUDDEN_DEATH', () => {
  const roomFor = (gameId: string) => env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));

  it('awards it at the deadline to a team already holding a line', async () => {
    const { game, shark } = await setUp({ winCondition: 'HYBRID_SUDDEN_DEATH' });

    for (const col of [0, 1, 2]) {
      await take(shark, 0, col);
    }

    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();
    await runDurableObjectAlarm(roomFor(game.id));

    expect((await findGameById(env.DB, game.id))?.wonByTeamId).toBe(game.teams[0]!.id);
  });

  it('enters sudden death when nobody holds a line, and pushes endsAt forward', async () => {
    const { game, shark } = await setUp({ winCondition: 'HYBRID_SUDDEN_DEATH' });

    await take(shark, 0, 0);

    const deadline = Date.now() - 1000;
    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?').bind(deadline, game.id).run();
    await runDurableObjectAlarm(roomFor(game.id));

    const running = await findGameById(env.DB, game.id);
    expect(running?.state).toBe('SUDDEN_DEATH');
    expect(running?.wonByTeamId).toBeNull();

    // Pushed forward so the plugin keeps auto-resuming on login through the finale.
    expect(running!.endsAt).toBeGreaterThan(Date.now());
  });

  it('keeps accepting events and ends on the first line in sudden death', async () => {
    const { game, shark, manta } = await setUp({ winCondition: 'HYBRID_SUDDEN_DEATH' });

    // Shark holds two of the top row; nobody has a line.
    await take(shark, 0, 0);
    await take(shark, 0, 1);
    await take(manta, 2, 2);

    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();
    await runDurableObjectAlarm(roomFor(game.id));

    expect((await findGameById(env.DB, game.id))?.state).toBe('SUDDEN_DEATH');

    // The board carries over: one more tile finishes the row Shark already half-owns.
    const accepted = await shark.sendOne(await shark.player.kill('Tile 0 2'));
    expect(accepted.accepted).toBe(true);

    expect(await findGameById(env.DB, game.id)).toMatchObject({
      state: 'ENDED',
      wonByTeamId: game.teams[0]!.id,
    });
  });

  // The contract's state enum is closed, so a plugin must never be told SUDDEN_DEATH.
  it('reports sudden death to the plugin as LIVE', async () => {
    const { game, shark } = await setUp({ winCondition: 'HYBRID_SUDDEN_DEATH' });

    await take(shark, 0, 0);
    await env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
      .bind(Date.now() - 1000, game.id)
      .run();
    await runDurableObjectAlarm(roomFor(game.id));

    const response = await transport.fetch(
      new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`),
    );

    expect(((await response.json()) as { state: string }).state).toBe('LIVE');
  });
});
