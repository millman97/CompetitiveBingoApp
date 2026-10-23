// Schema validation for inbound plugin payloads.
//
// The validators are precompiled from the vendored schemas at build time. Validation is total:
// nothing reaches the ingestion path without passing the same schema the plugin was written
// against.

import { validateEventEnvelope, type ValidationError } from '../generated/validators.js';
import type { EventEnvelope } from './envelope';

export type { ValidationError } from '../generated/validators.js';

export type ValidationResult =
  | { ok: true; envelope: EventEnvelope }
  | { ok: false; errors: ValidationError[] };

/**
 * Validates one event envelope against contract/event.schema.json.
 *
 * A failure is answered per-event with INVALID and logged at error with the full envelope — it
 * means one of the two repos has a bug. It never fails the batch it arrived in, because one
 * malformed envelope from one player must not stop ingestion for everybody else.
 */
export const validateEnvelope = (data: unknown): ValidationResult => {
  if (validateEventEnvelope(data)) {
    return { ok: true, envelope: data as EventEnvelope };
  }
  return { ok: false, errors: validateEventEnvelope.errors ?? [] };
};

/** Renders validation errors into one line suitable for a log. */
export const describeErrors = (errors: readonly ValidationError[]): string =>
  errors
    .map((e) => `${e.instancePath || '/'} ${e.message ?? e.keyword}`)
    .join('; ');
