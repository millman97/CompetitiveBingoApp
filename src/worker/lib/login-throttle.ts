// Login throttling.
//
// There is one password, no user accounts, and a publicly reachable URL. This is the only thing
// between a clan's bingo board and someone running a word list against it, so it is not
// optional.
//
// State lives in D1 rather than in memory: a Worker isolate is discarded between requests, so an
// in-memory counter would reset roughly as fast as an attacker could trigger it.

const MAX_FAILURES = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRow {
  failures: number;
  first_failed: number;
  locked_until: number | null;
}

/**
 * Identifies the caller for throttling. Cloudflare sets CF-Connecting-IP itself and it cannot be
 * spoofed by a client header, so it is safe to key on here.
 */
export const clientKey = (request: Request): string =>
  request.headers.get('CF-Connecting-IP') ?? 'unknown';

/** Milliseconds remaining on a lockout, or 0 if the caller may attempt a login. */
export const lockoutRemaining = async (
  db: D1Database,
  key: string,
  now: number = Date.now(),
): Promise<number> => {
  const row = await db
    .prepare('SELECT failures, first_failed, locked_until FROM login_attempts WHERE client_key = ?')
    .bind(key)
    .first<AttemptRow>();

  if (row === null || row.locked_until === null) {
    return 0;
  }
  return row.locked_until > now ? row.locked_until - now : 0;
};

export const recordFailure = async (
  db: D1Database,
  key: string,
  now: number = Date.now(),
): Promise<void> => {
  const row = await db
    .prepare('SELECT failures, first_failed, locked_until FROM login_attempts WHERE client_key = ?')
    .bind(key)
    .first<AttemptRow>();

  // A previous lockout that has expired starts a fresh count rather than leaving the caller one
  // attempt away from being locked out again forever.
  const stale = row !== null && row.locked_until !== null && row.locked_until <= now;
  const failures = row === null || stale ? 1 : row.failures + 1;
  const firstFailed = row === null || stale ? now : row.first_failed;
  const lockedUntil = failures >= MAX_FAILURES ? now + LOCKOUT_MS : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (client_key, failures, first_failed, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_key) DO UPDATE SET
         failures = excluded.failures,
         first_failed = excluded.first_failed,
         locked_until = excluded.locked_until`,
    )
    .bind(key, failures, firstFailed, lockedUntil)
    .run();
};

export const clearFailures = async (db: D1Database, key: string): Promise<void> => {
  await db.prepare('DELETE FROM login_attempts WHERE client_key = ?').bind(key).run();
};
