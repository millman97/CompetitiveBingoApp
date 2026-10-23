// Conformance tests for the five plugin endpoints.
//
// These are written against the contract rather than against the implementation: the plugin is
// already shipped and in players' clients, so anything here that changes is a break.

import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

import app from '../src/worker';
import type { Env } from '../src/worker/env';
import { SimulatedClient } from '../tools/simulator/client';
import { SimulatedPlayer } from '../tools/simulator/player';
import { assignTeam, removePlayer, seedGame } from './fixtures';

const BASE = 'https://bingo.test';

let testEnv: Env;

beforeAll(() => {
  testEnv = { ...env, SIGNING_KEY: 'test-signing-key' };
});

const transport = { fetch: async (request: Request) => app.fetch(request, testEnv) };

const clientFor = (gameId: string, accountHash: string, displayName: string, opts = {}) =>
  new SimulatedClient(
    transport,
    BASE,
    new SimulatedPlayer({ accountHash, displayName, gameId, ...opts }),
  );

describe('GET /api/plugin/game', () => {
  it('returns the game config block', async () => {
    const game = await seedGame(env.DB, {
      name: 'Clan Bingo #4',
      trackedMetrics: ['kc.vorkath', 'collection_log.*'],
      metricLabels: { 'kc.vorkath': 'Vorkath kills' },
    });

    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    expect(res.status).toBe(200);

    expect(await res.json()).toEqual({
      gameId: game.id,
      name: 'Clan Bingo #4',
      state: 'LIVE',
      startsAt: game.startsAt,
      endsAt: game.endsAt,
      schemaVersion: 1,
      minPluginVersion: '0.0.0',
      trackedMetrics: ['collection_log.*', 'kc.vorkath'],
      metricLabels: { 'kc.vorkath': 'Vorkath kills' },
      // Null because this game has no board to read targets off, and no value rules.
      metricTargets: null,
      dropValueRules: null,
      manualEntryAllowed: true,
      screenshotsRequested: true,
      blockedWorldTypes: ['SEASONAL', 'DEADMAN', 'BETA_WORLD', 'TOURNAMENT_WORLD', 'NOSAVE_MODE'],
      startWorld: null,
    });
  });

  it('omits metricLabels as null when none are set', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.vorkath'] });
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));

    expect(((await res.json()) as { metricLabels: unknown }).metricLabels).toBeNull();
  });

  it('accepts a join code in any case, because players type it by hand', async () => {
    const game = await seedGame(env.DB, { joinCode: 'SWAMP-TOAD-42' });
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=swamp-toad-42`));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { gameId: string }).gameId).toBe(game.id);
  });

  it('reports an internal SUDDEN_DEATH game as LIVE', async () => {
    // The contract's state enum is closed. Adding to it is a schema version bump, and during
    // sudden death the game genuinely is live.
    const game = await seedGame(env.DB, {
      state: 'SUDDEN_DEATH',
      mode: 'CONTROL',
      winCondition: 'HYBRID_SUDDEN_DEATH',
    });

    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    expect(((await res.json()) as { state: string }).state).toBe('LIVE');
  });

  it('404s an unknown join code', async () => {
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=NOPE-NOPE-11`));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('UNKNOWN_JOIN_CODE');
  });

  it('410s a finished game, so the plugin stops chasing it', async () => {
    const game = await seedGame(env.DB, { state: 'ENDED' });
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));

    expect(res.status).toBe(410);
  });

  // The plugin applies this list verbatim and has no opinion of its own, so an omitted list would
  // silently count progress earned on Leagues and deadman worlds.
  it('names the world types this server will not count', async () => {
    const game = await seedGame(env.DB);
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    const body = (await res.json()) as { blockedWorldTypes: string[] };

    expect(body.blockedWorldTypes).toContain('SEASONAL');
    expect(body.blockedWorldTypes).toContain('TOURNAMENT_WORLD');
    expect(body.blockedWorldTypes).toContain('DEADMAN');
  });

  it('400s when no code is given', async () => {
    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game`));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/plugin/sync', () => {
  it('exchanges a join code for a token', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-4234871239847123', 'Safespot Ted');

    const { sync } = await client.sync(game.joinCode);

    expect(sync.gameId).toBe(game.id);
    expect(sync.playerToken).toBeTruthy();
    expect(sync.teamName).toBeNull();
    // endsAt plus 24 hours, so a late upload still authenticates.
    expect(sync.tokenExpiresAt).toBe(game.endsAt + 24 * 60 * 60 * 1000);
  });

  // The plugin re-syncs unprompted on login and once a minute while waiting out a lobby, so most
  // calls here have no user behind them.
  it('is idempotent: no duplicate player, no lost progress', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-1111', 'Repeat Rita');

    await client.sync(game.joinCode);
    await client.sync(game.joinCode);
    await client.sync(game.joinCode);

    const { results } = await env.DB.prepare(
      'SELECT id FROM players WHERE game_id = ? AND account_hash = ?',
    )
      .bind(game.id, '-1111')
      .all();

    expect(results).toHaveLength(1);
  });

  it('keeps a large accountHash exact rather than rounding it', async () => {
    const game = await seedGame(env.DB);
    const accountHash = '1818775870234376620';
    await clientFor(game.id, accountHash, 'Big Hash Barry').sync(game.joinCode);

    const row = await env.DB.prepare(
      'SELECT account_hash FROM players WHERE game_id = ? AND display_name = ?',
    )
      .bind(game.id, 'Big Hash Barry')
      .first<{ account_hash: string }>();

    expect(row?.account_hash).toBe(accountHash);
  });

  it('records display name history for hiscores fallback', async () => {
    const game = await seedGame(env.DB);
    await clientFor(game.id, '-2222', 'Old Name').sync(game.joinCode);
    await clientFor(game.id, '-2222', 'New Name').sync(game.joinCode);

    const { results } = await env.DB.prepare(
      `SELECT display_name FROM player_names
       WHERE player_id = (SELECT id FROM players WHERE game_id = ? AND account_hash = ?)
       ORDER BY display_name`,
    )
      .bind(game.id, '-2222')
      .all<{ display_name: string }>();

    expect(results.map((r) => r.display_name)).toEqual(['New Name', 'Old Name']);
  });

  it('reports the team once an admin assigns one', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-3333', 'Assigned Alice');

    await client.sync(game.joinCode);
    await assignTeam(env.DB, game.id, '-3333', game.teams[0]!.id);

    const { sync } = await client.sync(game.joinCode);
    expect(sync.teamName).toBe('The Sharks');
  });

  it('403s only a player an admin removed', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-4444', 'Removed Rob');

    await client.sync(game.joinCode);
    await removePlayer(env.DB, game.id, '-4444');

    expect((await client.syncRaw(game.joinCode)).status).toBe(403);
  });

  it('409s a schema version it does not speak', async () => {
    const game = await seedGame(env.DB);
    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: '-1',
          displayName: 'Old Client',
          pluginVersion: '0.1.0',
          schemaVersion: 99,
        }),
      }),
    );

    expect(res.status).toBe(409);
  });

  it('409s a plugin older than the game requires, and names the version', async () => {
    const game = await seedGame(env.DB);
    const client = new SimulatedClient(
      transport,
      BASE,
      new SimulatedPlayer({ accountHash: '-5555', displayName: 'Ancient Al', gameId: game.id }),
      '0.0.1',
    );

    const res = await client.syncRaw(game.joinCode);
    // wrangler types narrows a [vars] entry to its literal value, so overriding it for a test
    // needs the widening cast.
    const strictEnv = { ...testEnv, MIN_PLUGIN_VERSION: '2.0.0' } as unknown as Env;
    const strict = await app.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: '-5556',
          displayName: 'Ancient Al',
          pluginVersion: '0.1.0',
          schemaVersion: 1,
        }),
      }),
      strictEnv,
    );

    // The shipped plugin is 0.1.0 and the default floor is 0.0.0, so this one is fine.
    expect(res.status).toBe(200);
    expect(strict.status).toBe(409);
    expect(await strict.json()).toMatchObject({ requiredVersion: '2.0.0' });
  });

  it('400s an accountHash that is not a decimal string', async () => {
    const game = await seedGame(env.DB);
    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: 1818775870234376620,
          displayName: 'Numeric Ned',
          pluginVersion: '0.1.0',
          schemaVersion: 1,
        }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /api/plugin/events', () => {
  it('accepts a tracked kill and stores it', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6001', 'Killer Kev');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    const result = await client.sendOne(envelope);

    expect(result).toMatchObject({ eventId: envelope.eventId, accepted: true, duplicate: false });

    const row = await env.DB.prepare(
      'SELECT metric_id, metric_type, value, delta, game_tick FROM events WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first();

    expect(row).toMatchObject({
      metric_id: 'kc.vorkath',
      metric_type: 'COUNT',
      value: 1,
      delta: 1,
    });
  });

  it('returns exactly one result per submitted envelope', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6002', 'Batch Bob');
    await client.sync(game.joinCode);

    const envelopes = [
      await client.player.kill('Vorkath'),
      await client.player.kill('Vorkath'),
      await client.player.drop(4151, 'Abyssal whip', 'Abyssal demon'),
    ];

    const results = await client.send(envelopes);

    expect(results.size).toBe(3);
    for (const envelope of envelopes) {
      expect(results.get(envelope.eventId)?.accepted).toBe(true);
    }
  });

  it('stores and credits a delta-only server-observed monster kill', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kill.abyssal_demon'] });
    const client = clientFor(game.id, '-6020', 'Slayer Sam');
    await client.sync(game.joinCode);

    const envelope = await client.player.observedKill(415, 'Abyssal demon', 124);
    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: false });

    const row = await env.DB.prepare(
      `SELECT e.metric_id, e.metric_type, e.value, e.delta, c.credited
       FROM events e
       JOIN event_credit c ON c.game_id = e.game_id AND c.event_id = e.event_id
       WHERE e.game_id = ? AND e.event_id = ?`,
    )
      .bind(game.id, envelope.eventId)
      .first();

    expect(row).toMatchObject({
      metric_id: 'kill.abyssal_demon',
      metric_type: 'KILL',
      value: null,
      delta: 1,
      credited: 1,
    });
  });

  it('treats a retry of the identical envelope as an accepted duplicate', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6003', 'Retry Rachel');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');

    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: false });
    // A duplicate is still accepted: it was recorded, just not now. [D9]
    expect(await client.sendOne(envelope)).toMatchObject({ accepted: true, duplicate: true });

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM events WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ n: number }>();

    expect(row?.n).toBe(1);
  });

  // [D6]: gameId is not part of the hash, so one kill reported into two games produces the same
  // ID in both. Those are two distinct facts and both must be recorded.
  it('records the same eventId separately in two concurrent games', async () => {
    const first = await seedGame(env.DB);
    const second = await seedGame(env.DB);

    const a = clientFor(first.id, '-6004', 'Two Games Tom', { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    const b = clientFor(second.id, '-6004', 'Two Games Tom', { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    await a.sync(first.joinCode);
    await b.sync(second.joinCode);

    a.player.setTick(5000);
    b.player.setTick(5000);

    const one = await a.player.kill('Vorkath');
    const two = await b.player.kill('Vorkath');

    expect(one.eventId).toBe(two.eventId);
    expect(await a.sendOne(one)).toMatchObject({ duplicate: false });
    expect(await b.sendOne(two)).toMatchObject({ duplicate: false });
  });

  it('rejects an untracked metric without failing the batch', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.zulrah'] });
    const client = clientFor(game.id, '-6005', 'Offboard Olly');
    await client.sync(game.joinCode);

    const tracked = await client.player.kill('Zulrah');
    const untracked = await client.player.kill('Vorkath');

    const results = await client.send([tracked, untracked]);

    expect(results.get(tracked.eventId)).toMatchObject({ accepted: true });
    expect(results.get(untracked.eventId)).toMatchObject({
      accepted: false,
      rejectionReason: 'NOT_TRACKED',
    });
  });

  it('still returns 200 when every event in the batch is rejected', async () => {
    const game = await seedGame(env.DB, { trackedMetrics: ['kc.zulrah'] });
    const client = clientFor(game.id, '-6006', 'All Wrong Wanda');
    await client.sync(game.joinCode);

    const response = await client.sendRaw([
      await client.player.kill('Vorkath'),
      await client.player.kill('Vorkath'),
    ]);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { accepted: boolean }[] };
    expect(body.results.every((r) => !r.accepted)).toBe(true);
  });

  it('rejects with GAME_NOT_LIVE while a game has not started', async () => {
    const now = Date.now();
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt: now + 60_000,
      endsAt: now + 3_600_000,
    });
    const client = clientFor(game.id, '-6007', 'Early Eric');
    await client.sync(game.joinCode);

    const result = await client.sendOne(await client.player.kill('Vorkath'));
    expect(result).toMatchObject({ accepted: false, rejectionReason: 'GAME_NOT_LIVE' });
  });

  it('rejects with GAME_NOT_LIVE while a board is locked', async () => {
    const game = await seedGame(env.DB, { state: 'LOCKED' });
    const client = clientFor(game.id, '-6008', 'Locked Lou');
    await client.sync(game.joinCode);

    const result = await client.sendOne(await client.player.kill('Vorkath'));
    expect(result).toMatchObject({ accepted: false, rejectionReason: 'GAME_NOT_LIVE' });
  });

  // Server receipt time, never clientTime — contract section 10.
  it('rejects with OUT_OF_WINDOW after the window closes', async () => {
    const now = Date.now();
    const game = await seedGame(env.DB, {
      state: 'LIVE',
      startsAt: now - 7_200_000,
      endsAt: now - 3_600_000,
    });
    const client = clientFor(game.id, '-6009', 'Late Larry');
    await client.sync(game.joinCode);

    const result = await client.sendOne(await client.player.kill('Vorkath'));
    expect(result).toMatchObject({ accepted: false, rejectionReason: 'OUT_OF_WINDOW' });
  });

  // Sudden death runs past endsAt with no timeout by design. Applying the window here would
  // reject every event in the finale and make the mode unwinnable.
  it('keeps accepting events past endsAt during sudden death', async () => {
    const now = Date.now();
    const game = await seedGame(env.DB, {
      state: 'SUDDEN_DEATH',
      mode: 'CONTROL',
      winCondition: 'HYBRID_SUDDEN_DEATH',
      startsAt: now - 7_200_000,
      endsAt: now - 3_600_000,
    });
    const client = clientFor(game.id, '-6010', 'Sudden Sam');
    await client.sync(game.joinCode);

    const result = await client.sendOne(await client.player.kill('Vorkath'));
    expect(result).toMatchObject({ accepted: true });
  });

  it('rejects a malformed envelope with INVALID without failing its batch', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6011', 'Broken Brenda');
    await client.sync(game.joinCode);

    const good = await client.player.kill('Vorkath');
    const bad = { ...(await client.player.kill('Vorkath')), metric: { id: 'kc.vorkath' } };

    const response = await client.sendRaw([good, bad]);
    expect(response.status).toBe(200);

    const results = new Map(
      ((await response.json()) as { results: { eventId: string; accepted: boolean; rejectionReason?: string }[] }).results.map(
        (r) => [r.eventId, r],
      ),
    );

    expect(results.get(good.eventId)?.accepted).toBe(true);
    expect(results.get(bad.eventId)).toMatchObject({
      accepted: false,
      rejectionReason: 'INVALID',
    });
  });

  it('rejects an envelope whose accountHash does not match its token', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6012', 'Honest Hana');
    await client.sync(game.joinCode);

    const envelope = { ...(await client.player.kill('Vorkath')), accountHash: '-9999' };
    const result = await client.sendOne(envelope);

    expect(result).toMatchObject({ accepted: false, rejectionReason: 'INVALID' });
  });

  it('401s an invalid token and 410s a finished game', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6013', 'Token Tina');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');

    client.setToken('nonsense.token');
    expect((await client.sendRaw([envelope])).status).toBe(401);

    const ended = await seedGame(env.DB, { state: 'LIVE' });
    const endedClient = clientFor(ended.id, '-6014', 'Finished Fran');
    await endedClient.sync(ended.joinCode);
    await env.DB.prepare("UPDATE games SET state = 'ENDED' WHERE id = ?").bind(ended.id).run();

    expect((await endedClient.sendRaw([envelope])).status).toBe(410);
  });

  it('400s a body that is not an array', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6015', 'Single Sid');
    await client.sync(game.joinCode);

    expect((await client.sendRaw(await client.player.kill('Vorkath'))).status).toBe(400);
  });

  it('400s a batch above the 50-envelope limit the plugin respects', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6016', 'Floody Fred');
    await client.sync(game.joinCode);

    const envelopes = [];
    for (let i = 0; i < 51; i++) {
      envelopes.push(await client.player.kill('Vorkath'));
    }

    expect((await client.sendRaw(envelopes)).status).toBe(400);
  });

  // Their events are recorded and credited; there is simply no team for the progress to land on
  // until an admin assigns one, at which point the whole history is attributed retroactively.
  it('records and credits an unassigned player’s events', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-6017', 'Unassigned Ursula');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    await client.sendOne(envelope);

    const player = await env.DB.prepare(
      'SELECT team_id FROM players WHERE game_id = ? AND account_hash = ?',
    )
      .bind(game.id, '-6017')
      .first<{ team_id: string | null }>();
    expect(player?.team_id).toBeNull();

    const credit = await env.DB.prepare(
      'SELECT credited FROM event_credit WHERE game_id = ? AND event_id = ?',
    )
      .bind(game.id, envelope.eventId)
      .first<{ credited: number }>();
    expect(credit?.credited).toBe(1);

    const progress = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM tile_progress WHERE game_id = ?',
    )
      .bind(game.id)
      .first<{ n: number }>();
    expect(progress?.n).toBe(0);
  });
});

describe('flags raised at ingest', () => {
  const flagsFor = async (gameId: string, kind: string) => {
    const { results } = await env.DB.prepare(
      'SELECT detail_json FROM flags WHERE game_id = ? AND kind = ?',
    )
      .bind(gameId, kind)
      .all<{ detail_json: string }>();
    return results;
  };

  it('flags a recomputed eventId that does not match', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-7001', 'Fiddler Fay');
    await client.sync(game.joinCode);

    const envelope = { ...(await client.player.kill('Vorkath')), eventId: 'f'.repeat(32) };
    const result = await client.sendOne(envelope);

    // A flag never rejects. It is a consistency check, not a security control.
    expect(result.accepted).toBe(true);
    expect(await flagsFor(game.id, 'HASH_MISMATCH')).toHaveLength(1);
  });

  it('flags a clock more than five minutes out', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-7002', 'Skewed Sue');
    await client.sync(game.joinCode);

    const envelope = await client.player.kill('Vorkath');
    const skewed = { ...envelope, clientTime: envelope.clientTime - 10 * 60 * 1000 };

    // eventId does not include clientTime, so this stays a valid ID for the observation.
    expect((await client.sendOne(skewed)).accepted).toBe(true);
    expect(await flagsFor(game.id, 'CLOCK_SKEW')).toHaveLength(1);
  });

  it('flags an event from a player whose last readiness report was false', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-7003', 'Filtered Phil');
    await client.sync(game.joinCode);

    await client.reportReady(false, [{ id: 'KILL_COUNT_FILTER', satisfied: false }]);
    expect((await client.sendOne(await client.player.kill('Vorkath'))).accepted).toBe(true);

    expect(await flagsFor(game.id, 'NOT_READY')).toHaveLength(1);
  });

  it('does not flag a player who has never reported readiness', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-7004', 'Silent Simon');
    await client.sync(game.joinCode);

    await client.sendOne(await client.player.kill('Vorkath'));

    expect(await flagsFor(game.id, 'NOT_READY')).toHaveLength(0);
  });

  it('does not re-flag a retried event', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-7005', 'Twice Tessa');
    await client.sync(game.joinCode);

    const envelope = { ...(await client.player.kill('Vorkath')), eventId: 'e'.repeat(32) };
    await client.sendOne(envelope);
    await client.sendOne(envelope);

    expect(await flagsFor(game.id, 'HASH_MISMATCH')).toHaveLength(1);
  });
});

describe('POST /api/plugin/ready', () => {
  it('stores the readiness report', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-8001', 'Ready Rita');
    await client.sync(game.joinCode);

    const res = await client.reportReady(false, [
      { id: 'KILL_COUNT_FILTER', satisfied: true },
      { id: 'WORLD_TYPE', satisfied: true },
      { id: 'COLLECTION_LOG_NOTIFICATION', satisfied: false },
      { id: 'LOOT_TRACKER', satisfied: true },
    ]);

    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT ready, checks_json FROM readiness
       WHERE player_id = (SELECT id FROM players WHERE game_id = ? AND account_hash = ?)`,
    )
      .bind(game.id, '-8001')
      .first<{ ready: number; checks_json: string }>();

    expect(row?.ready).toBe(0);
    expect(JSON.parse(row!.checks_json)).toHaveLength(4);
  });

  it('replaces the previous report rather than accumulating', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-8002', 'Fixed Fiona');
    await client.sync(game.joinCode);

    await client.reportReady(false, [{ id: 'KILL_COUNT_FILTER', satisfied: false }]);
    await client.reportReady(true, [{ id: 'KILL_COUNT_FILTER', satisfied: true }]);

    const { results } = await env.DB.prepare(
      `SELECT ready FROM readiness
       WHERE player_id = (SELECT id FROM players WHERE game_id = ? AND account_hash = ?)`,
    )
      .bind(game.id, '-8002')
      .all<{ ready: number }>();

    expect(results).toHaveLength(1);
    expect(results[0]?.ready).toBe(1);
  });

  it('400s a malformed report', async () => {
    const game = await seedGame(env.DB);
    const client = clientFor(game.id, '-8003', 'Garbled Gary');
    await client.sync(game.joinCode);

    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/ready`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${client.playerToken}`,
        },
        body: JSON.stringify({ ready: 'yes' }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

// Contract section 4.5. The plugin schedules exactly one sync at the startsAt the server named
// and does not retry on a timer. A client that arrives to find the game still UPCOMING and
// already overdue stops and shows the player an error, so this invariant is the difference
// between a lobby that starts and a lobby that silently strands everyone in it.
describe('a lobby is never advertised as overdue', () => {
  const now = () => Date.now();

  it('starts a game that has reached its advertised start time', async () => {
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt: now() - 60_000,
      endsAt: now() + 3_600_000,
    });

    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    const body = (await res.json()) as { state: string; startsAt: number };

    expect(body.state).toBe('LIVE');
    expect(await env.DB.prepare('SELECT state FROM games WHERE id = ?').bind(game.id).first()).
      toMatchObject({ state: 'LIVE' });
  });

  it('leaves a lobby alone while its start time is still ahead', async () => {
    const startsAt = now() + 3_600_000;
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt,
      endsAt: startsAt + 3_600_000,
    });

    const res = await transport.fetch(new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`));
    const body = (await res.json()) as { state: string; startsAt: number };

    expect(body.state).toBe('UPCOMING');
    expect(body.startsAt).toBeGreaterThan(now());
  });

  it('never returns UPCOMING with a startsAt in the past', async () => {
    for (const offset of [-3_600_000, -1, 0, 60_000]) {
      const game = await seedGame(env.DB, {
        state: 'UPCOMING',
        startsAt: now() + offset,
        endsAt: now() + 7_200_000,
      });

      const res = await transport.fetch(
        new Request(`${BASE}/api/plugin/game?code=${game.joinCode}`),
      );
      const body = (await res.json()) as { state: string; startsAt: number };

      if (body.state === 'UPCOMING') {
        expect(body.startsAt).toBeGreaterThan(now() - 1000);
      }
    }
  });

  it('accepts events as soon as the start time passes', async () => {
    const game = await seedGame(env.DB, {
      state: 'UPCOMING',
      startsAt: now() + 60_000,
      endsAt: now() + 3_600_000,
    });
    const client = clientFor(game.id, '-6100', 'Punctual Pete');
    await client.sync(game.joinCode);

    // Before the start time, nothing counts.
    expect(await client.sendOne(await client.player.kill('Vorkath'))).toMatchObject({
      accepted: false,
      rejectionReason: 'GAME_NOT_LIVE',
    });

    // The clock reaching the start, without waiting for it to: sleeping a few milliseconds and
    // hoping the request lands on the right side of them is a coin toss on a loaded machine.
    await env.DB.prepare('UPDATE games SET starts_at = ? WHERE id = ?')
      .bind(Date.now() - 1, game.id)
      .run();

    expect(await client.sendOne(await client.player.kill('Vorkath'))).toMatchObject({
      accepted: true,
    });
  });
});

// getLocalPlayer().getName() is null for a moment after login even though getAccountHash() is
// already valid, and the plugin sends "" rather than holding the sync back. Refusing that would
// block a player over a field the contract calls display-only and explicitly not identity.
describe('a sync with no display name yet', () => {
  it('is accepted', async () => {
    const game = await seedGame(env.DB);

    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: '-6200',
          displayName: '',
          pluginVersion: '0.1.0',
          schemaVersion: 1,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { playerToken: string }).playerToken).toBeTruthy();
  });

  it('picks the name up on the next sync, and never records an empty one', async () => {
    const game = await seedGame(env.DB);

    const sync = (displayName: string) =>
      transport.fetch(
        new Request(`${BASE}/api/plugin/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            joinCode: game.joinCode,
            accountHash: '-6201',
            displayName,
            pluginVersion: '0.1.0',
            schemaVersion: 1,
          }),
        }),
      );

    await sync('');
    await sync('Safespot Ted');
    // A later sync that has lost the name again must not wipe the one we know.
    await sync('');

    const player = await env.DB.prepare(
      'SELECT display_name FROM players WHERE game_id = ? AND account_hash = ?',
    )
      .bind(game.id, '-6201')
      .first<{ display_name: string }>();
    expect(player?.display_name).toBe('Safespot Ted');

    const { results } = await env.DB.prepare(
      `SELECT display_name FROM player_names
       WHERE player_id = (SELECT id FROM players WHERE game_id = ? AND account_hash = ?)`,
    )
      .bind(game.id, '-6201')
      .all<{ display_name: string }>();
    expect(results.map((r) => r.display_name)).toEqual(['Safespot Ted']);
  });

  it('still refuses a display name that is not a string at all', async () => {
    const game = await seedGame(env.DB);

    const res = await transport.fetch(
      new Request(`${BASE}/api/plugin/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode: game.joinCode,
          accountHash: '-6202',
          displayName: 12345,
          pluginVersion: '0.1.0',
          schemaVersion: 1,
        }),
      }),
    );

    expect(res.status).toBe(400);
  });
});
