// Regression tests for the per-game single-writer boundary.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import { replayInRoom } from '../src/worker/do/client';
import type { Env } from '../src/worker/env';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, seedGame, seedTiles, tileProgress } from './fixtures';

const BASE = 'https://bingo.test';
let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const clientFor = (gameId: string, accountHash: string, displayName: string) =>
  new SimulatedClient(
    { fetch: async (request: Request) => app.fetch(request, testEnv) },
    BASE,
    new SimulatedPlayer({ accountHash, displayName, gameId }),
  );

describe('per-game mutation serialisation', () => {
  it('repairs an already-credited event whose board settlement was lost', async () => {
    const game = await seedGame(env.DB, { mode: 'CLASSIC' });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 1 },
    ]);
    const tileId = tileIds[0]!;
    const client = clientFor(game.id, '-9101', 'Retry Repair');
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-9101', game.teams[0]!.id);

    const envelope = await client.player.kill('Vorkath');
    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: false });

    // This is the durable shape left by a failure after event credit committed but before board
    // settlement did. The immutable event and its credit remain; only the derived board is stale.
    await env.DB.prepare('DELETE FROM tile_progress WHERE game_id = ?').bind(game.id).run();

    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: true });
    expect(await tileProgress(env.DB, game.id, tileId, game.teams[0]!.id)).toMatchObject({
      score: 1,
      complete: true,
    });
  });

  it('does not lose or double-credit COUNT events when replay and ingestion race', async () => {
    const game = await seedGame(env.DB, { mode: 'CLASSIC' });
    const client = clientFor(game.id, '-9102', 'Replay Racer');
    await client.sync(game.joinCode);

    await client.sendOne(await client.player.kill('Vorkath'));
    const second = await client.player.kill('Vorkath');

    await Promise.all([replayInRoom(testEnv, game.id), client.sendOne(second)]);

    const credited = await env.DB
      .prepare(
        `SELECT SUM(c.credited) AS total
         FROM event_credit c
         WHERE c.game_id = ?`,
      )
      .bind(game.id)
      .first<{ total: number }>();
    const state = await env.DB
      .prepare(
        `SELECT last_value
         FROM metric_state
         WHERE game_id = ? AND metric_id = 'kc.vorkath'`,
      )
      .bind(game.id)
      .first<{ last_value: number }>();

    expect(credited?.total).toBe(2);
    expect(state?.last_value).toBe(2);
  });

  it('serialises concurrent COUNT batches against one baseline', async () => {
    const game = await seedGame(env.DB, { mode: 'CLASSIC' });
    const client = clientFor(game.id, '-9103', 'Concurrent Counter');
    await client.sync(game.joinCode);

    const first = await client.player.kill('Vorkath');
    const second = await client.player.kill('Vorkath');
    await Promise.all([client.sendOne(first), client.sendOne(second)]);

    const credited = await env.DB
      .prepare('SELECT SUM(credited) AS total FROM event_credit WHERE game_id = ?')
      .bind(game.id)
      .first<{ total: number }>();
    expect(credited?.total).toBe(2);
  });
});
