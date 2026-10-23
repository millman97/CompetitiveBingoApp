// HMAC-signed opaque tokens.
//
// Two things are signed with the same key and told apart by an unforgeable `purpose` field:
// player bearer tokens and admin session cookies. Without the purpose, a player token would
// verify as an admin session, which is the classic way this pattern goes wrong.
//
// Every token is stateless — there is no session table. Verification is signature plus expiry,
// so a token cannot be revoked before it expires. That is acceptable here because removal is
// enforced on the player row at request time, not by invalidating the token.

export type TokenPurpose = 'player' | 'admin';

interface Envelope<T> {
  p: TokenPurpose;
  e: number;
  d: T;
}

const encoder = new TextEncoder();

const b64urlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

/**
 * Signs a payload into an opaque token.
 *
 * @param expiresAt epoch milliseconds after which verification fails
 */
export const signToken = async <T>(
  secret: string,
  purpose: TokenPurpose,
  data: T,
  expiresAt: number,
): Promise<string> => {
  const envelope: Envelope<T> = { p: purpose, e: expiresAt, d: data };
  const body = b64urlEncode(encoder.encode(JSON.stringify(envelope)));
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(signature))}`;
};

/**
 * Verifies a token and returns its payload, or null if it is forged, expired, malformed, or was
 * issued for a different purpose.
 *
 * Signature checking goes through crypto.subtle.verify, which compares in constant time.
 */
export const verifyToken = async <T>(
  secret: string,
  purpose: TokenPurpose,
  token: string,
  now: number = Date.now(),
): Promise<T | null> => {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return null;
  }

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = b64urlDecode(signature);
  } catch {
    return null;
  }

  const key = await importKey(secret);
  // Cast for the same reason as in password.ts: DOM and Workers declare BufferSource differently.
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes as BufferSource,
    encoder.encode(body),
  );
  if (!valid) {
    return null;
  }

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Envelope<T>;
  } catch {
    return null;
  }

  if (envelope.p !== purpose || typeof envelope.e !== 'number' || envelope.e <= now) {
    return null;
  }

  return envelope.d;
};

/** Payload of a player bearer token. accountHash stays a string, everywhere, always. */
export interface PlayerTokenData {
  gameId: string;
  accountHash: string;
}
