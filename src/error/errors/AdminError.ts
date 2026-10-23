// Admin API calls.
//
// The session is an httpOnly cookie, so nothing here handles a token — the browser attaches it and
// a 401 means the session went away.

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
  }
}
