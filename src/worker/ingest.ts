// Per-event ingestion — contract sections 4.3, 5 and 6.
//
// One envelope in, one result out. The only automatic rejections are the four contract-defined
// rejectionReason values, all of which are structural: a metric nobody asked for, a game that is
// not running, a time outside the window, or a payload that does not parse. None of them is a
// judgement about honesty.
//
// Everything the server is merely suspicious about becomes a flag for an admin to judge. A flag
// never rejects an event and never alters a score.

import { deriveEventId } from '../contract/event-id';
import { isManual } from '../contract/envelope';
import { matchesTracked } from '../contract/metrics';
import type { EventEnvelope } from '../contract/envelope';
import { describeErrors, validateEnvelope } from '../contract/validate';

import { attachScreenshot, hasScreenshot, insertEvent } from './db/events';
import { raiseFlag, type FlagInput } from './db/flags';
import type { Game } from './db/games';
import { fillMissingName, type Player } from './db/players';
import { lastReadiness } from './db/readiness';
import { acceptsEvents, withinWindow } from './lib/game-state';
import { decodeScreenshot, objectKey } from './lib/screenshots';
import { creditEvent, type ScoringContext } from './scoring/engine';
import { fromEnvelope } from './scoring/observation';

/** The closed set from [D8]. A value outside it is treated by the plugin as INVALID. */
export type RejectionReason = 'NOT_TRACKED' | 'GAME_NOT_LIVE' | 'OUT_OF_WINDOW' | 'INVALID';

export interface EventResult {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  rejectionReason?: RejectionReason;
}

/** clientTime is unverified, so a wide gap is worth a look but never worth a rejection. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface IngestContext {
  db: D1Database;
  screenshots: R2Bucket;
  game: Game;
  player: Player;
  trackedMetrics: string[];
  receivedAt: number;
  /** Tiles and thresholds, loaded once per request rather than once per envelope. */
  scoring: ScoringContext;
  /**
   * Metrics credited during this batch, and for which team.
   *
   * Collected here and handed to the game's Durable Object once, after the batch. Recomputing
   * tiles is that object's job: ownership and win detection compare teams against each other, and
   * that comparison has to be serialised somewhere.
   */
  touched: { metricId: string; teamId: string | null }[];
  /** A stored event without credit means derivation must be rebuilt in event-log order. */
  needsReplay: boolean;
}

/**
 * Best-effort eventId for a payload that failed validation.
 *
 * The plugin matches results to submissions by eventId, so a result has to carry one even when
 * the envelope it describes is unreadable. In practice the plugin derives the ID itself and a
 * schema failure lands in some other field, so this almost always finds the real one.
 */
const eventIdOf = (data: unknown): string => {
  if (typeof data === 'object' && data !== null) {
    const id = (data as { eventId?: unknown }).eventId;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return 'unknown';
};

const reject = (eventId: string, reason: RejectionReason): EventResult => ({
  eventId,
  accepted: false,
  duplicate: false,
  rejectionReason: reason,
});

/**
 * Checks that need no derived state, run at the moment of receipt.
 *
 * The rest of the section 6 checks — monotonicity, backfill, rate and duration plausibility —
 * are decided while the observation is being credited, because they are all statements about the
 * derived increment rather than about the envelope. They come back from the scoring engine.
 */
const liveChecks = async (
  ctx: IngestContext,
  envelope: EventEnvelope,
): Promise<FlagInput[]> => {
  const flags: FlagInput[] = [];
  const base = { gameId: ctx.game.id, eventId: envelope.eventId, playerId: ctx.player.id };

  const expected = await deriveEventId(envelope);
  if (expected !== envelope.eventId) {
    // Detects clumsy tampering only — every input is client-supplied. Contract section 10.
    flags.push({
      ...base,
      kind: 'HASH_MISMATCH',
      detail: { submitted: envelope.eventId, recomputed: expected },
    });
  }

  const skew = Math.abs(envelope.clientTime - ctx.receivedAt);
  if (skew > CLOCK_SKEW_MS) {
    flags.push({
      ...base,
      kind: 'CLOCK_SKEW',
      detail: { clientTime: envelope.clientTime, receivedAt: ctx.receivedAt, skewMs: skew },
    });
  }

  /*
   * Every hand-typed event is flagged, not just a suspicious one.
   *
   * This is the one event kind whose contents a player chose — the plugin vouches for the
   * screenshot and for nothing else. Flagging all of them is not an accusation: it is the same
   * "record it, show a person, let them judge" rule the rest of this file follows, applied to the
   * category where a human look is always warranted.
   */
  if (isManual(envelope)) {
    flags.push({
      ...base,
      kind: 'MANUAL_ENTRY',
      detail: {
        metricId: envelope.metric.id,
        activity: envelope.detail.activity,
        typed: envelope.detail.input,
        interpretedAs: envelope.detail.interpretedAs,
        credited: envelope.metric.delta,
        hasScreenshot: envelope.screenshot !== null,
      },
    });
  }

  // Null means the player has never reported readiness, which is unknown rather than not ready.
  // Treating unknown as guilty would flag everyone who joined before it mattered.
  if ((await lastReadiness(ctx.db, ctx.player.id)) === false) {
    flags.push({
      ...base,
      kind: 'NOT_READY',
      detail: { metricId: envelope.metric.id },
    });
  }

  return flags;
};

/**
 * Stores the image an envelope carried, if it carried one.
 *
 * A screenshot is evidence, not data: nothing here can fail the event. An image that is too large
 * or will not decode is dropped with a log line, and the event is recorded and scored exactly as
 * it would have been — which is the same guarantee the old separate upload had, for the same
 * reason.
 *
 * A retry carries its image again, so an event whose original response was lost still delivers
 * its evidence. That is why this runs for duplicates too, gated only on not already holding one.
 */
const storeScreenshot = async (ctx: IngestContext, envelope: EventEnvelope): Promise<void> => {
  const encoded = envelope.screenshot;
  const mediaType = envelope.screenshotMediaType;

  // Non-null exactly together, per the schema.
  if (encoded === null || mediaType === null) {
    return;
  }
  if (!ctx.game.screenshotsRequested) {
    return;
  }
  if (await hasScreenshot(ctx.db, ctx.game.id, envelope.eventId)) {
    return;
  }

  const decoded = decodeScreenshot(encoded);
  if (!decoded.ok) {
    console.warn('discarded a screenshot', {
      gameId: ctx.game.id,
      eventId: envelope.eventId,
      reason: decoded.reason,
      bytes: decoded.bytes,
    });
    return;
  }

  const key = objectKey(ctx.game.id, envelope.eventId, mediaType);

  try {
    await ctx.screenshots.put(key, decoded.bytes, {
      httpMetadata: { contentType: mediaType },
    });
    await attachScreenshot(ctx.db, ctx.game.id, envelope.eventId, key, mediaType, ctx.receivedAt);
  } catch (error) {
    console.error('could not store a screenshot', {
      gameId: ctx.game.id,
      eventId: envelope.eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Processes one submitted envelope.
 *
 * A malformed envelope from one player is rejected with INVALID and logged, but never takes down
 * ingestion for anybody else — which is why this returns a result rather than throwing.
 */
export const ingestOne = async (ctx: IngestContext, raw: unknown): Promise<EventResult> => {
  const validation = validateEnvelope(raw);

  if (!validation.ok) {
    // A bug in one of the two repos. Logged in full so it can be found in the other one.
    console.error('INVALID envelope', {
      gameId: ctx.game.id,
      playerId: ctx.player.id,
      errors: describeErrors(validation.errors),
      envelope: raw,
    });
    return reject(eventIdOf(raw), 'INVALID');
  }

  const envelope = validation.envelope;

  // The token binds a game and an account. An envelope claiming a different one is either a
  // plugin bug or hand-editing; both are structural, and both are worth seeing in the log.
  if (envelope.gameId !== ctx.game.id || envelope.accountHash !== ctx.player.accountHash) {
    console.error('envelope does not match its token', {
      tokenGameId: ctx.game.id,
      envelopeGameId: envelope.gameId,
      tokenAccountHash: ctx.player.accountHash,
      envelopeAccountHash: envelope.accountHash,
      eventId: envelope.eventId,
    });
    return reject(envelope.eventId, 'INVALID');
  }

  // Game-level facts first: if the game is not running, that is more useful to the plugin than
  // being told which metric it got wrong, because it stops emitting rather than just refreshing.
  if (!acceptsEvents(ctx.game.state)) {
    return reject(envelope.eventId, 'GAME_NOT_LIVE');
  }

  if (!withinWindow(ctx.game.state, ctx.receivedAt, ctx.game.startsAt, ctx.game.endsAt)) {
    return reject(envelope.eventId, 'OUT_OF_WINDOW');
  }

  if (!matchesTracked(envelope.metric.id, ctx.trackedMetrics)) {
    return reject(envelope.eventId, 'NOT_TRACKED');
  }

  // The plugin hides the control when a game says no, but the contract is explicit that this is a
  // convenience rather than a defence: a server that does not want hand-typed events has to refuse
  // them here. INVALID is the closest of the four reasons — nothing else in the set describes it,
  // and an envelope the plugin should not have offered to send is genuinely anomalous.
  if (isManual(envelope) && !ctx.game.manualEntryAllowed) {
    console.error('manual entry on a game that does not allow it', {
      gameId: ctx.game.id,
      playerId: ctx.player.id,
      eventId: envelope.eventId,
    });
    return reject(envelope.eventId, 'INVALID');
  }

  const stored = await insertEvent(ctx.db, {
    gameId: ctx.game.id,
    eventId: envelope.eventId,
    playerId: ctx.player.id,
    envelope,
    receivedAt: ctx.receivedAt,
  });

  // Inserting the immutable event and deriving its credit are necessarily separate D1 writes.
  // If the latter failed, the plugin retries the same envelope. Treat an existing event without
  // credit as unfinished work so that retry repairs it instead of leaving it permanently inert.
  const alreadyCredited = stored
    ? false
    : (await ctx.db
        .prepare('SELECT 1 AS credited FROM event_credit WHERE game_id = ? AND event_id = ?')
        .bind(ctx.game.id, envelope.eventId)
        .first<{ credited: number }>()) !== null;

  // Flags describe the first observation of a fact. A retry of an already-recorded event is not
  // a second occurrence of anything, and must neither raise the same flag twice nor be credited
  // twice — which is the whole reason the plugin's retries are safe.
  if (stored) {
    // The plugin may have had no name when the session began; this is the other chance to learn it.
    if (ctx.player.displayName === '') {
      await fillMissingName(ctx.db, ctx.player.id, envelope.displayName, ctx.receivedAt);
    }

    const flags = await liveChecks(ctx, envelope);
    if (flags.length > 0) {
      await ctx.db.batch(flags.map((flag) => raiseFlag(ctx.db, flag, ctx.receivedAt)));
    }
  }

  if (!stored && !alreadyCredited) {
    // Re-deriving just this old event against today's metric_state can use the wrong COUNT
    // baseline if a later request succeeded in the meantime. The room replays the complete log in
    // received order after this batch, which is both safe and deterministic.
    ctx.needsReplay = true;
  } else if (stored) {
    await creditEvent(
      ctx.scoring,
      ctx.player.id,
      envelope.eventId,
      fromEnvelope(envelope, ctx.receivedAt),
      { persistFlags: true },
    );

    // A player with no team yet still has their events stored and credited; there is simply no
    // team for the progress to land on until an admin assigns one, at which point their whole
    // history is attributed retroactively.
    ctx.touched.push({ metricId: envelope.metric.id, teamId: ctx.player.teamId });
  }

  await storeScreenshot(ctx, envelope);

  // A duplicate is still accepted: it was recorded, just not now.
  return {
    eventId: envelope.eventId,
    accepted: true,
    duplicate: !stored,
  };
};
