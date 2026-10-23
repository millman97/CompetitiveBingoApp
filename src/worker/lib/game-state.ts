// Game state, and the difference between what the server tracks and what the wire allows.
//
// The contract's state enum is closed: UPCOMING | LIVE | ENDED | LOCKED. Adding to it is a schema
// version bump, so SUDDEN_DEATH is an internal state only and is reported to the plugin as LIVE.
// That is not a fudge — during sudden death the game genuinely is live, and events must keep
// counting until somebody completes a line.

import type { GameState as WireGameState } from '../../generated/contract-types';

export type { GameState as WireGameState } from '../../generated/contract-types';

/** Every state the server tracks, including the one the plugin never sees. */
export type ServerGameState = WireGameState | 'SUDDEN_DEATH';

/** What the plugin is told. SUDDEN_DEATH is reported as LIVE. */
export const toWireState = (state: ServerGameState): WireGameState =>
  state === 'SUDDEN_DEATH' ? 'LIVE' : state;

/**
 * Whether events are accepted at all.
 *
 * UPCOMING and LOCKED are answered per-event with GAME_NOT_LIVE. ENDED is answered with HTTP 410
 * for the whole request, per contract section 4.6, which makes the plugin forget the game rather
 * than keep asking about it on every login.
 */
export const acceptsEvents = (state: ServerGameState): boolean =>
  state === 'LIVE' || state === 'SUDDEN_DEATH';

/**
 * Whether server receipt time falls inside the game window.
 *
 * Receipt time, never clientTime — contract section 10. clientTime comes off a machine the
 * player controls and is used for display and intra-batch ordering only.
 *
 * Sudden death is exempt. It runs past endsAt with no timeout by design, so applying the window
 * would reject every event in the finale and make the mode unwinnable. The game's endsAt is also
 * pushed forward when sudden death begins, so that the plugin's own auto-resume keeps working
 * for a player who relogs; this check is the second half of that belt and braces.
 */
export const withinWindow = (
  state: ServerGameState,
  receivedAt: number,
  startsAt: number,
  endsAt: number,
): boolean => {
  if (state === 'SUDDEN_DEATH') {
    return true;
  }
  return receivedAt >= startsAt && receivedAt <= endsAt;
};
