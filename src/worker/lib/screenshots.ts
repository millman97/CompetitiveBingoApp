// Screenshots.
//
// Contract section 5.3: the image travels inside the event envelope as base64, and the plugin
// never uploads to any other destination. There is no presigned URL, no upload endpoint and no
// object-store credential anywhere in the system — the bytes arrive with the fact they belong to,
// and this module decodes them into R2.
//
// A screenshot is evidence, not data. Nothing here can fail an event: a frame that is too large,
// or that will not decode, is dropped with a log line while the event it came with is recorded
// and scored exactly as it would have been.

/**
 * The largest image this server will store, after decoding.
 *
 * The plugin downscales to 1280px and targets 200KB, so this is roughly five times what an honest
 * client sends. The contract asks servers to enforce their own ceiling rather than trust the
 * client, and the batch is separately capped at 2 MB.
 */
export const MAX_SCREENSHOT_BYTES = 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

export const objectKey = (gameId: string, eventId: string, mediaType: string): string =>
  `${gameId}/${eventId}.${EXTENSIONS[mediaType] ?? 'bin'}`;

export type DecodeFailure = 'MALFORMED' | 'TOO_LARGE';

export type DecodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: DecodeFailure; bytes: number };

/**
 * Decodes the base64 payload, refusing anything implausible.
 *
 * The length is checked before decoding as well as after, so a client cannot make the Worker
 * allocate a large buffer just by claiming to have one.
 */
export const decodeScreenshot = (encoded: string): DecodeResult => {
  // 4 base64 characters carry 3 bytes, so this bounds the decoded size without decoding.
  const approximate = Math.floor((encoded.length * 3) / 4);
  if (approximate > MAX_SCREENSHOT_BYTES) {
    return { ok: false, reason: 'TOO_LARGE', bytes: approximate };
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return { ok: false, reason: 'MALFORMED', bytes: encoded.length };
  }

  if (binary.length > MAX_SCREENSHOT_BYTES) {
    return { ok: false, reason: 'TOO_LARGE', bytes: binary.length };
  }
  if (binary.length === 0) {
    return { ok: false, reason: 'MALFORMED', bytes: 0 };
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return { ok: true, bytes };
};
