// Validation flags.
//
// The rule the whole validation design turns on: a flag never rejects an event and never alters
// a score. The server records what it noticed and attaches it for a human to judge. Admins act on
// flags; the server does not.
//
// The only automatic rejections are the four contract-defined rejectionReason values, which are
// structural facts rather than judgements about honesty.

import { newFlagId } from '../lib/ids';

export type FlagKind =
  | 'MONOTONIC_DECREASE'
  | 'BACKFILL'
  | 'IMPLAUSIBLE_RATE'
  | 'CLOCK_SKEW'
  | 'HASH_MISMATCH'
  | 'NOT_READY'
  | 'IMPLAUSIBLE_DURATION'
  | 'HISCORE_DISCREPANCY'
  | 'MANUAL_ENTRY';

export interface FlagInput {
  gameId: string;
  eventId: string | null;
  playerId: string;
  kind: FlagKind;
  detail: Record<string, unknown>;
}

export const raiseFlag = (db: D1Database, input: FlagInput, now: number): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO flags (id, game_id, event_id, player_id, kind, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newFlagId(),
      input.gameId,
      input.eventId,
      input.playerId,
      input.kind,
      JSON.stringify(input.detail),
      now,
    );
