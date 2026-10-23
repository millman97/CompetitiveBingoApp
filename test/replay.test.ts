// Replay.
//
// For a given event log, replaying from scratch must produce the identical board. This is the
// guarantee everything else leans on: it is what settles a dispute, and what lets a scoring bug be
// fixed mid-event without anybody re-reporting anything.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { replayGame } from '../src/worker/scoring/replay';
import { runFullEvent } from '../tools/simulator/scenario';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import {
  assignTeam,
  derivedSnapshot,
  seedGame,
  seedTiles,
  tileProgress,
  type SeedTile,
} from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const BOARD: SeedTile[] = [
  { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
  { row: 0, col: 1, metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 1 },
  { row: 1, col: 0, metrics: ['drop.*'], aggregate: 'SUM', target: 1 },
  {
    row: 1,
    col: 1,
    metrics: ['time.chambers_of_xeric'],
    aggregate: 'MIN_DURATION',
    target: null,
  },
];

/**
 * Runs a whole event with players already on teams.
 *
 * Assigning before anybody plays matters: it means the derived state left behind is what
 * ingestion produced incrementally, event by event, rather than what a later recompute produced.
 * Comparing that against a from-scratch replay is the actual guarantee.
 */
const playAnEvent = async () => {
  const game = await seedGame(env.DB);
  await seedTiles(env.DB, game.id, BOARD);

  let joined = 0;
  await runFullEvent({
    transport,
    baseUrl: BASE,
    joinCode: game.joinCode,
    afterJoin: async (accountHash) => {
      // Alternating teams, so the board is scored for more than one of them.
      await assignTeam(env.DB, game.id, accountHash, game.teams[joined % 2]!.id);
      joined += 1;
    },
  });

  return game;
};

describe('replaying a whole event', () => {
  // The guarantee, stated plainly: what ingestion built up one event at a time and what a replay
  // computes from nothing must be the same board.
  it('reproduces exactly what ingestion produced', async () => {
    const game = await playAnEvent();

    const fromIngestion = await derivedSnapshot(env.DB, game.id);
    expect(fromIngestion.credit?.length ?? 0).toBeGreaterThan(0);
    expect(fromIngestion.progress?.length ?? 0).toBeGreaterThan(0);

    await replayGame(env.DB, game.id);

    expect(await derivedSnapshot(env.DB, game.id)).toEqual(fromIngestion);
  });

  it('rebuilds everything after the derived tables are thrown away', async () => {
    const game = await playAnEvent();
    const before = await derivedSnapshot(env.DB, game.id);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM event_credit WHERE game_id = ?').bind(game.id),
      env.DB.prepare('DELETE FROM metric_state WHERE game_id = ?').bind(game.id),
      env.DB.prepare('DELETE FROM tile_progress WHERE game_id = ?').bind(game.id),
    ]);

    const result = await replayGame(env.DB, game.id);

    expect(result.events).toBeGreaterThan(0);
    expect(await derivedSnapshot(env.DB, game.id)).toEqual(before);
  });

  it('is stable over repeated runs', async () => {
    const game = await playAnEvent();

    await replayGame(env.DB, game.id);
    const first = await derivedSnapshot(env.DB, game.id);
    await replayGame(env.DB, game.id);
    await replayGame(env.DB, game.id);

    expect(await derivedSnapshot(env.DB, game.id)).toEqual(first);
  });
});

describe('ordering', () => {
  // Every envelope in one batch is stamped with the same receipt time. A COUNT is differenced
  // against the last value seen, so replaying 1, 2, 3 in any other order derives a decrease and
  // credits nothing. This is the case that makes the rowid tiebreak load-bearing.
  it('replays a batch that shares one receipt time in the order it arrived', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
    ]);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-20001', displayName: 'Batched', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-20001', game.teams[0]!.id);

    await client.send([
      await client.player.kill('Vorkath'),
      await client.player.kill('Vorkath'),
      await client.player.kill('Vorkath'),
    ]);

    const times = await env.DB.prepare(
      'SELECT COUNT(DISTINCT received_at) AS n FROM events WHERE game_id = ?',
    )
      .bind(game.id)
      .first<{ n: number }>();
    expect(times?.n).toBe(1);

    const before = await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id);
    expect(before).toMatchObject({ score: 3, complete: true });

    await replayGame(env.DB, game.id);

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, game.teams[0]!.id)).toEqual(before);
  });
});

describe('what replay is for', () => {
  // Fixing a scoring mistake mid-event: change the rule, replay, board is correct. Nobody
  // re-reports anything.
  it('applies a corrected tile requirement to history', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 10 },
    ]);
    const sharks = game.teams[0]!.id;

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-20002', displayName: 'Grinder', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-20002', sharks);

    for (let i = 0; i < 3; i++) {
      await client.sendOne(await client.player.kill('Vorkath'));
    }

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, sharks)).toMatchObject({
      complete: false,
    });

    // The organiser meant 3, not 10.
    await env.DB.prepare('UPDATE tiles SET requirement_json = ?, target = 3 WHERE id = ?')
      .bind(JSON.stringify({ metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 }), tileIds[0]!)
      .run();

    await replayGame(env.DB, game.id);

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, sharks)).toMatchObject({
      score: 3,
      complete: true,
    });
  });

  // An adjustment is a row in the event log rather than a number poked into a score, which is
  // exactly what keeps replay correct after an admin intervenes.
  it('carries an admin adjustment through a replay', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const tileIds = await seedTiles(env.DB, game.id, [
      { row: 0, col: 0, metrics: ['kc.vorkath'], aggregate: 'SUM', target: 5 },
    ]);
    const sharks = game.teams[0]!.id;

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-20003', displayName: 'Credited', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-20003', sharks);
    await client.sendOne(await client.player.kill('Vorkath'));

    const player = await env.DB.prepare(
      'SELECT id FROM players WHERE game_id = ? AND account_hash = ?',
    )
      .bind(game.id, '-20003')
      .first<{ id: string }>();

    // A synthetic MANUAL row, as the admin panel will write.
    await env.DB.prepare(
      `INSERT INTO events (game_id, event_id, player_id, metric_id, metric_type, value, delta,
                           first_observation, detail_json, session_id, client_time, received_at,
                           game_tick, world, world_types)
       VALUES (?, ?, ?, 'kc.vorkath', 'MANUAL', NULL, 4, 0, ?, NULL, NULL, ?, NULL, NULL, NULL)`,
    )
      .bind(
        game.id,
        'manual0000000000000000000000adj1',
        player!.id,
        JSON.stringify({ reason: 'Reported by two clanmates, screenshots checked' }),
        Date.now(),
      )
      .run();

    await replayGame(env.DB, game.id);

    expect(await tileProgress(env.DB, game.id, tileIds[0]!, sharks)).toMatchObject({
      score: 5,
      complete: true,
    });
  });

  // A replay recomputes scores; it does not re-observe facts. An admin's flag resolutions must
  // survive it untouched.
  it('leaves flags exactly as they were', async () => {
    const game = await seedGame(env.DB, { backfillPolicy: 'FLAG_ONLY' });
    await seedTiles(env.DB, game.id, BOARD);

    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-20004', displayName: 'Flagged', gameId: game.id }),
    );
    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-20004', game.teams[0]!.id);

    await client.sendOne(await client.player.kill('Vorkath'));
    client.player.playOffPlugin('kc.vorkath', 6);
    await client.sendOne(await client.player.kill('Vorkath'));

    const flagsBefore = await env.DB.prepare(
      'SELECT id, kind, detail_json FROM flags WHERE game_id = ? ORDER BY id',
    )
      .bind(game.id)
      .all();

    expect(flagsBefore.results).toHaveLength(1);
    expect(flagsBefore.results[0]).toMatchObject({ kind: 'BACKFILL' });

    // Resolve it, as an admin would.
    await env.DB.prepare(
      "UPDATE flags SET resolution = 'DISMISSED', resolved_by = 'admin', resolved_at = ? WHERE game_id = ?",
    )
      .bind(Date.now(), game.id)
      .run();

    await replayGame(env.DB, game.id);
    await replayGame(env.DB, game.id);

    const flagsAfter = await env.DB.prepare(
      'SELECT id, kind, detail_json, resolution FROM flags WHERE game_id = ? ORDER BY id',
    )
      .bind(game.id)
      .all<{ id: string; kind: string; resolution: string }>();

    expect(flagsAfter.results).toHaveLength(1);
    expect(flagsAfter.results[0]?.resolution).toBe('DISMISSED');
  });
});
