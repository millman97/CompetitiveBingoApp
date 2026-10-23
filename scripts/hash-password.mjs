// Hashes the admin password for storage as a secret.
//
// Used by setup and the deploy workflow, which upload the hash with the Worker, so the
// plaintext password never reaches the Worker or the D1 database.
//
// Usage: node scripts/hash-password.mjs "the password"
//        ADMIN_PASSWORD="the password" node scripts/hash-password.mjs
//
// The format and parameters must stay in step with src/worker/lib/password.ts, which is what
// verifies these at login. test/password.test.ts pins a hash produced by this script against
// that verifier, so the two cannot drift apart silently.

import { webcrypto as crypto } from 'node:crypto';

// Cloudflare's production WebCrypto caps each PBKDF2 operation at 100,000 iterations.
const ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

const toB64 = (bytes) => Buffer.from(bytes).toString('base64');

export const hashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    KEY_BITS,
  );
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
};

// Only run as a CLI when invoked directly, so the function stays importable.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('hash-password.mjs')) {
  const password = process.argv[2] ?? process.env.ADMIN_PASSWORD;

  if (password === undefined || password === '') {
    console.error('No password given. Pass it as an argument or set ADMIN_PASSWORD.');
    process.exit(1);
  }

  if (password.length < 12) {
    console.error(
      `That password is ${password.length} characters. Use at least 12 — this is the only credential protecting the admin panel.`,
    );
    process.exit(1);
  }

  process.stdout.write(await hashPassword(password));
}
