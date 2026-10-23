// Admin password hashing.
//
// PBKDF2-SHA256 through WebCrypto. It is not the strongest choice available in general, but it
// is the strongest one the Workers runtime offers natively: bcrypt, scrypt and argon2 are not in
// WebCrypto, and pulling in a pure-JS implementation would burn CPU time against the free plan's
// per-request limit on every login.
//
// The hash is produced at deploy time by the GitHub Actions workflow and pushed as a secret, so
// the plaintext password never reaches the Worker.
//
// Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64>

const ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const encoder = new TextEncoder();

const toB64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const fromB64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const derive = async (
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    // A Uint8Array is a valid BufferSource at runtime. The cast is only needed because the web
    // project compiles this file under the DOM lib, where the two declarations differ.
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
};

/**
 * Verifies a password against a stored hash.
 *
 * The comparison is constant time. A malformed stored hash throws rather than returning false —
 * it means the deployment is misconfigured, and silently refusing every login would send an
 * admin hunting for a forgotten password that was never the problem.
 */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
    throw new Error('ADMIN_PASSWORD_HASH is not a pbkdf2 hash. Re-run the deploy workflow.');
  }

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('ADMIN_PASSWORD_HASH has a bad iteration count. Re-run the deploy workflow.');
  }

  const salt = fromB64(parts[2] as string);
  const expected = fromB64(parts[3] as string);
  const actual = await derive(password, salt, iterations);

  if (actual.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= (actual[i] as number) ^ (expected[i] as number);
  }
  return diff === 0;
};
