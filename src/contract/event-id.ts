// Deterministic eventId derivation — contract section 6.
//
// The derivation is normative and must match the plugin byte for byte, because it is what makes
// a retry dedupe instead of double-counting. Fields are joined with `|`, integers are rendered
// in plain decimal, and the ID is the first 16 bytes of the SHA-256 as lowercase hex.
//
// The contract's worked example is pinned as a test in test/event-id.test.ts.
//
// sessionId takes part in every derivation except COLLECTION_LOG. gameTick is a per-client
// counter that repeats across sessions, so without it the same drop at the same tick on two
// different days would dedupe to one event. A collection log slot is filled once ever, so its
// ID is deliberately independent of both time and session.

import { isCollectionLog, isDrop, isKill, isManual, type EventEnvelope } from './envelope';

const SEPARATOR = '|';
const ID_BYTES = 16;

const HEX = '0123456789abcdef';

const toHex = (bytes: Uint8Array, count: number): string => {
  let out = '';
  for (let i = 0; i < count; i++) {
    const byte = bytes[i] as number;
    out += HEX[(byte >> 4) & 0xf];
    out += HEX[byte & 0xf];
  }
  return out;
};

const hash = async (...fields: string[]): Promise<string> => {
  const joined = fields.join(SEPARATOR);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined));
  return toHex(new Uint8Array(digest), ID_BYTES);
};

/**
 * Recomputes the eventId an honest plugin would have sent for this envelope.
 *
 * This detects clumsy tampering and nothing more — every input is client-supplied, so a mismatch
 * is a flag for a human to judge, never a rejection. See contract section 10.
 */
export const deriveEventId = async (envelope: EventEnvelope): Promise<string> => {
  const { accountHash, sessionId, gameTick, metric } = envelope;
  const tick = String(gameTick);

  // A hand-typed event is keyed on what was typed, whatever its metric type. Two people typing
  // the same thing in the same tick is not a thing that happens; the same person re-sending the
  // same entry is, and that has to dedupe.
  if (isManual(envelope)) {
    return hash(accountHash, sessionId, metric.id, tick, 'manual', envelope.detail.input);
  }

  // A collection log slot is filled once, ever — the same slot reported twice is the same fact
  // regardless of when, or in which session, it was noticed.
  if (isCollectionLog(envelope)) {
    return hash(accountHash, metric.id);
  }

  if (isDrop(envelope)) {
    return hash(
      accountHash,
      sessionId,
      metric.id,
      tick,
      String(envelope.detail.itemId),
      String(envelope.detail.quantity),
      String(envelope.detail.observationOrdinal),
    );
  }

  if (isKill(envelope)) {
    return hash(
      accountHash,
      sessionId,
      metric.id,
      tick,
      String(envelope.detail.npcId),
      String(envelope.detail.observationOrdinal),
    );
  }

  // COUNT and DURATION share a derivation. DURATION overloads `value` with durationMs.
  return hash(accountHash, sessionId, metric.id, tick, String(metric.value));
};
