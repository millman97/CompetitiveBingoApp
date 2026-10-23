// A whole event through the real HTTP surface.
//
// The per-endpoint tests check conformance one rule at a time; this checks that the rules hold
// together when three players are actually playing.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { runFullEvent } from '../tools/simulator/scenario';
import { seedGame } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

describe('a full event', () => {
  it('ingests three players playing at once', async () => {
    const game = await seedGame(env.DB, {
      trackedMetrics: ['kc.vorkath', 'time.chambers_of_xeric', 'drop.*', 'collection_log.*'],
    });

    const report = await runFullEvent({
      transport,
      baseUrl: BASE,
      joinCode: game.joinCode,
      withScreenshots: true,
    });

    expect(report.players).toEqual(['Safespot Ted', 'Rangeta Rita', 'Mobile Morgan']);

    // One kill the board does not track. Everything else lands.
    expect(report.rejected).toEqual({ NOT_TRACKED: 1 });

    // Two of the submissions are the same fact reported twice: Ted's retried kill and Rita's
    // collection log slot seen again in a later session. Both are accepted, both are duplicates.
    expect(report.duplicates).toBe(2);
    expect(report.accepted).toBe(report.submitted - 1);

    // A distinct row per distinct fact, and nothing double-counted.
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?')
      .bind(game.id)
      .first<{ n: number }>();

    expect(stored?.n).toBe(report.accepted - report.duplicates);
  });

  it('keeps every player’s stream separate', async () => {
    const game = await seedGame(env.DB);

    await runFullEvent({ transport, baseUrl: BASE, joinCode: game.joinCode });

    const { results } = await env.DB.prepare(
      `SELECT p.display_name AS name, COUNT(*) AS n
       FROM events e JOIN players p ON p.id = e.player_id
       WHERE e.game_id = ? GROUP BY p.display_name ORDER BY p.display_name`,
    )
      .bind(game.id)
      .all<{ name: string; n: number }>();

    expect(results).toEqual([
      { name: 'Mobile Morgan', n: 2 },
      // Three observed, plus the raid time she typed in by hand.
      { name: 'Rangeta Rita', n: 4 },
      { name: 'Safespot Ted', n: 5 },
    ]);
  });

  it('collects the evidence carried inside the envelopes', async () => {
    const game = await seedGame(env.DB);

    const report = await runFullEvent({
      transport,
      baseUrl: BASE,
      joinCode: game.joinCode,
      withScreenshots: true,
    });

    expect(report.screenshotsSent).toBeGreaterThan(0);

    const { results } = await env.DB.prepare(
      'SELECT object_key FROM event_screenshots WHERE game_id = ?',
    )
      .bind(game.id)
      .all<{ object_key: string }>();

    expect(results.length).toBeGreaterThan(0);
    for (const row of results) {
      expect(await env.SCREENSHOTS.get(row.object_key)).not.toBeNull();
    }
  });

  it('records the absolute value that exposes off-plugin play', async () => {
    const game = await seedGame(env.DB);

    await runFullEvent({ transport, baseUrl: BASE, joinCode: game.joinCode });

    // Morgan reported kill 1, then played six off-plugin, then reported kill 8. The gap is
    // visible in the stored values and is what the scoring engine derives backfill from.
    const { results } = await env.DB.prepare(
      `SELECT e.value FROM events e JOIN players p ON p.id = e.player_id
       WHERE e.game_id = ? AND p.display_name = 'Mobile Morgan' AND e.metric_id = 'kc.vorkath'
       ORDER BY e.received_at`,
    )
      .bind(game.id)
      .all<{ value: number }>();

    expect(results.map((r) => r.value)).toEqual([1, 8]);
  });
});
