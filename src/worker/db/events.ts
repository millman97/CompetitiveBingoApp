// The append-only event record.
//
// Nothing here updates or deletes an events row, and there is no code path that can: the table
// holds only what a plugin reported and when the server received it. Team attribution, credited
// progress and screenshot evidence all live in derived or side tables, precisely so that this one
// never has to be rewritten.
//
// Deduplication is scoped to (gameId, eventId), never eventId alone [D6]: gameId is not part of
// the hash, so one player reporting one kill into two concurrent games produces the same ID in
// both, and those are two distinct facts.

import type { EventEnvelope } from '../../contract/envelope';

export interface StoredEventInput {
  gameId: string;
  eventId: string;
  playerId: string;
  envelope: EventEnvelope;
  receivedAt: number;
}

/**
 * Records an event, or reports that it was already held.
 *
 * The INSERT carries its own dedupe via the primary key, so two concurrent requests carrying the
 * same retry cannot both win. `changes` tells us which happened without a prior SELECT, so there
 * is no window between the two for a duplicate to slip through.
 *
 * @returns true when this call stored the event, false when it was already present
 */
export const insertEvent = async (db: D1Database, input: StoredEventInput): Promise<boolean> => {
  const { envelope } = input;

  const result = await db
    .prepare(
      `INSERT INTO events (
         game_id, event_id, player_id, metric_id, metric_type, source,
         value, delta, first_observation, detail_json,
         session_id, client_time, received_at,
         game_tick, world, world_types
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (game_id, event_id) DO NOTHING`,
    )
    .bind(
      input.gameId,
      input.eventId,
      input.playerId,
      envelope.metric.id,
      envelope.metric.type,
      envelope.source,
      envelope.metric.value,
      envelope.metric.delta,
      envelope.metric.firstObservation ? 1 : 0,
      JSON.stringify(envelope.detail),
      envelope.sessionId,
      envelope.clientTime,
      input.receivedAt,
      envelope.gameTick,
      envelope.world,
      JSON.stringify(envelope.worldTypes),
    )
    .run();

  return result.meta.changes > 0;
};

/** Whether an image is already held for this event, so a duplicate is not re-offered an upload. */
export const hasScreenshot = async (
  db: D1Database,
  gameId: string,
  eventId: string,
): Promise<boolean> => {
  const row = await db
    .prepare('SELECT 1 AS held FROM event_screenshots WHERE game_id = ? AND event_id = ?')
    .bind(gameId, eventId)
    .first<{ held: number }>();

  return row !== null;
};

/**
 * Records an uploaded image against its event.
 *
 * A side table rather than a column on the event, because an upload is a separate, later and
 * failure-prone act: the event is a fact the plugin reported, the screenshot is evidence that may
 * or may not arrive afterwards, and neither should be able to rewrite the other.
 */
export const attachScreenshot = async (
  db: D1Database,
  gameId: string,
  eventId: string,
  objectKey: string,
  mediaType: string,
  now: number,
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO event_screenshots (game_id, event_id, object_key, media_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(game_id, event_id) DO UPDATE SET
         object_key = excluded.object_key,
         media_type = excluded.media_type,
         uploaded_at = excluded.uploaded_at`,
    )
    .bind(gameId, eventId, objectKey, mediaType, now)
    .run();
};
