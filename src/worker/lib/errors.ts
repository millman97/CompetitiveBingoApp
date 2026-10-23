// Error responses — contract section 7.
//
// The shape is { error, message, requiredVersion? }. `message` is rendered verbatim in the
// player's RuneLite side panel, so every string here is written for a player: what happened and
// what to do about it, with no server-side vocabulary in it.
//
// The status code carries the meaning the plugin switches on. Getting one wrong changes plugin
// behaviour — 401 makes it discard its token, 403 and 410 make it stop emitting for good.

export type ApiErrorCode =
  | 'UNKNOWN_JOIN_CODE'
  | 'VERSION_MISMATCH'
  | 'GAME_ENDED'
  | 'PLAYER_REMOVED'
  | 'TOKEN_INVALID'
  | 'MALFORMED_REQUEST'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'CONFLICT'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: ApiErrorCode;
  message: string;
  requiredVersion?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requiredVersion?: string;

  constructor(status: number, code: ApiErrorCode, message: string, requiredVersion?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requiredVersion = requiredVersion;
  }

  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.requiredVersion !== undefined) {
      body.requiredVersion = this.requiredVersion;
    }
    return body;
  }
}

// 400 — a plugin bug. The plugin logs the body at error and does not retry.
export const malformedRequest = (detail: string): ApiError =>
  new ApiError(400, 'MALFORMED_REQUEST', `The server could not read that request: ${detail}`);

// 401 — the plugin discards its token and asks the player to re-sync.
export const tokenInvalid = (): ApiError =>
  new ApiError(
    401,
    'TOKEN_INVALID',
    'Your session for this bingo game has expired. Press Sync to reconnect.',
  );

// 403 — the plugin stops emitting permanently and shows this message.
// Reserved for a player an admin has explicitly removed. A player who has synced but has no
// team yet is accepted, not refused: see spec section 3.3.
export const playerRemoved = (): ApiError =>
  new ApiError(
    403,
    'PLAYER_REMOVED',
    'You have been removed from this bingo game. Ask an organiser if you think that is a mistake.',
  );

// 404 — the sync attempt fails visibly and is never retried.
export const unknownJoinCode = (): ApiError =>
  new ApiError(
    404,
    'UNKNOWN_JOIN_CODE',
    "That join code doesn't match any game. Check it with your organiser.",
  );

// 409 — the plugin stops and shows the required version.
export const schemaMismatch = (serverSchema: number, clientSchema: number): ApiError =>
  new ApiError(
    409,
    'VERSION_MISMATCH',
    `This server speaks bingo schema ${serverSchema} and your plugin speaks ${clientSchema}. Update the Competitive Bingo plugin.`,
  );

export const pluginTooOld = (required: string): ApiError =>
  new ApiError(
    409,
    'VERSION_MISMATCH',
    `This game needs Competitive Bingo ${required} or newer. Update the plugin in the RuneLite plugin hub.`,
    required,
  );

// 410 — the plugin stops emitting and shows the final state.
export const gameEnded = (): ApiError =>
  new ApiError(410, 'GAME_ENDED', 'This bingo game has finished. Thanks for playing!');

// 429 — the plugin honours Retry-After and resumes.
export const rateLimited = (): ApiError =>
  new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a moment and try again.');
