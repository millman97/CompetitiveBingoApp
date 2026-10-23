// A whole event, driven end to end.
//
// This is the integration harness the spec asks for: multiple players, duplicates, retries,
// off-plugin backfill, an untracked metric and inline screenshot evidence, all through the real
// HTTP surface. It runs in-process against the Worker during tests and over the network against a
// deployment, so the same script that guards a build can also smoke-test a real server.
//
// Racing two teams for one tile in the same tick is supported by SimulatedPlayer.setTick, but
// the assertions that make it meaningful need the scoring engine and arrive with it.

import type { EventEnvelope } from '../../src/contract/envelope';
import { SimulatedClient, type Transport } from './client';
import { SimulatedPlayer } from './player';

export interface ScenarioOptions {
  transport: Transport;
  baseUrl: string;
  joinCode: string;
  /** Set when the game asks for screenshots, so envelopes carry an image. */
  withScreenshots?: boolean;
  /**
   * Called after each player syncs and before anybody plays.
   *
   * Exists so a test can put players on teams first, which is what makes the resulting derived
   * state the product of ingestion rather than of a later recompute.
   */
  afterJoin?: (accountHash: string) => Promise<void>;
}

export interface ScenarioReport {
  players: string[];
  submitted: number;
  accepted: number;
  duplicates: number;
  rejected: Record<string, number>;
  /** Envelopes that carried an image. The server decodes and stores them as it ingests. */
  screenshotsSent: number;
  /** Events a player typed in rather than the plugin observing. */
  manualEntries: number;
}

const ALL_CHECKS = [
  { id: 'KILL_COUNT_FILTER', satisfied: true },
  { id: 'WORLD_TYPE', satisfied: true },
  { id: 'COLLECTION_LOG_NOTIFICATION', satisfied: true },
  { id: 'LOOT_TRACKER', satisfied: true },
];

export const runFullEvent = async (options: ScenarioOptions): Promise<ScenarioReport> => {
  const { transport, baseUrl, joinCode } = options;
  const mediaType = options.withScreenshots === true ? ('image/jpeg' as const) : null;

  const report: ScenarioReport = {
    players: [],
    submitted: 0,
    accepted: 0,
    duplicates: 0,
    rejected: {},
    screenshotsSent: 0,
    manualEntries: 0,
  };

  const make = (accountHash: string, displayName: string): SimulatedClient =>
    new SimulatedClient(
      transport,
      baseUrl,
      new SimulatedPlayer({
        accountHash,
        displayName,
        // Replaced by the real gameId once the handshake completes.
        gameId: 'pending',
        screenshotMediaType: mediaType,
      }),
    );

  // The plugin fetches the game before syncing, so the gameId is known only after the handshake.
  // Rebuild each player against the real one rather than guessing it.
  const join = async (accountHash: string, displayName: string): Promise<SimulatedClient> => {
    const probe = make(accountHash, displayName);
    const gameResponse = await probe.fetchGame(joinCode);
    if (!gameResponse.ok) {
      throw new Error(`GET /game failed: ${gameResponse.status} ${await gameResponse.text()}`);
    }
    const { gameId } = (await gameResponse.json()) as { gameId: string };

    const client = new SimulatedClient(
      transport,
      baseUrl,
      new SimulatedPlayer({
        accountHash,
        displayName,
        gameId,
        screenshotMediaType: mediaType,
      }),
    );

    await client.sync(joinCode);
    await client.reportReady(true, ALL_CHECKS);
    if (options.afterJoin !== undefined) {
      await options.afterJoin(accountHash);
    }
    report.players.push(displayName);
    return client;
  };

  const submit = async (client: SimulatedClient, envelopes: EventEnvelope[]): Promise<void> => {
    const results = await client.send(envelopes);
    report.submitted += envelopes.length;

    for (const envelope of envelopes) {
      const result = results.get(envelope.eventId);
      if (result === undefined) {
        throw new Error(`No result for ${envelope.eventId}; one is required per envelope.`);
      }

      if (result.accepted) {
        report.accepted += 1;
        if (result.duplicate) {
          report.duplicates += 1;
        }
      } else {
        const reason = result.rejectionReason ?? 'UNKNOWN';
        report.rejected[reason] = (report.rejected[reason] ?? 0) + 1;
      }

      if (envelope.screenshot !== null) {
        report.screenshotsSent += 1;
      }
      if (envelope.source === 'MANUAL') {
        report.manualEntries += 1;
      }
    }
  };

  const ted = await join('-4234871239847123', 'Safespot Ted');
  const rita = await join('-1818775870234376620', 'Rangeta Rita');
  const mobile = await join('-777000111222333', 'Mobile Morgan');

  // An ordinary run of kills from two players.
  await submit(ted, [
    await ted.player.kill('Vorkath'),
    await ted.player.kill('Vorkath'),
    await ted.player.kill('Vorkath'),
  ]);

  await submit(rita, [
    await rita.player.kill('Vorkath'),
    await rita.player.drop(4151, 'Abyssal whip', 'Abyssal demon'),
  ]);

  // A retry of an identical envelope, as the plugin sends after a timeout. It must dedupe rather
  // than count twice, and it stays accepted.
  const retried = await ted.player.kill('Vorkath');
  await submit(ted, [retried]);
  await submit(ted, [retried]);

  // The mobile problem: six kills happened somewhere this plugin was not watching, so the next
  // envelope carries value 7 against a stored value of 1.
  await submit(mobile, [await mobile.player.kill('Vorkath')]);
  mobile.player.playOffPlugin('kc.vorkath', 6);
  await submit(mobile, [await mobile.player.kill('Vorkath')]);

  // A duration, where lower is better and there is no delta to derive.
  await submit(ted, [await ted.player.duration('Chambers of Xeric', 154_800, true)]);

  // A collection log slot noticed again in a later session. Its ID deliberately omits both time
  // and session, so the same slot is the same fact forever.
  const slot = await rita.player.collectionLog('Dragon pickaxe');
  await submit(rita, [slot]);
  rita.player.newSession();
  await submit(rita, [slot]);

  // A raid time only ever shown in an interface, typed in by hand. Every one of these lands in
  // the flag queue for review — the plugin vouches for the screenshot and nothing else.
  await submit(rita, [
    await rita.player.manual('time.chambers_of_xeric', 'Chambers of Xeric', '25:00', {
      value: 1_500_000,
      interpretedAs: 'duration',
    }),
  ]);

  // Something the board does not track. Rejected per-event, and harmless.
  await submit(ted, [await ted.player.kill('Kree arra')]);

  return report;
};
