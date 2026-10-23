// The normalised shape scoring works on.
//
// Ingestion converts an envelope into one of these; replay converts a stored row into one. Both
// then go through exactly the same derivation, which is what makes the replay guarantee real
// rather than aspirational — there is no second implementation to drift.

import type { EventEnvelope } from '../../contract/envelope';

/**
 * MANUAL is a synthetic type for an admin credit or discredit. It never appears on the wire, and
 * exists so that an adjustment is a row in the event log rather than a number poked into a score
 * — which is what keeps replay correct after an admin intervenes.
 */
export type ObservationType = EventEnvelope['metric']['type'] | 'MANUAL';

/**
 * Whether a parser saw this, or a player typed it.
 *
 * Not to be confused with the MANUAL *metric type* above, which is an admin adjustment. The two
 * are genuinely different: an adjustment is an organiser's decision recorded in the log, while a
 * MANUAL source is a player asserting something the plugin could not see. They happen to be
 * credited the same way, and they are reviewed very differently.
 */
export type EventSource = 'OBSERVED' | 'MANUAL';

export interface Observation {
  metricId: string;
  type: ObservationType;
  source: EventSource;
  value: number | null;
  delta: number | null;
  firstObservation: boolean;
  /** Server receipt time. The only clock trusted for anything that decides an outcome. */
  receivedAt: number;
}

export const fromEnvelope = (envelope: EventEnvelope, receivedAt: number): Observation => ({
  metricId: envelope.metric.id,
  type: envelope.metric.type,
  source: envelope.source,
  value: envelope.metric.value,
  delta: envelope.metric.delta,
  firstObservation: envelope.metric.firstObservation,
  receivedAt,
});

export interface EventRow {
  metric_id: string;
  metric_type: ObservationType;
  source: string;
  value: number | null;
  delta: number | null;
  first_observation: number;
  received_at: number;
}

export const fromRow = (row: EventRow): Observation => ({
  metricId: row.metric_id,
  type: row.metric_type,
  source: row.source === 'MANUAL' ? 'MANUAL' : 'OBSERVED',
  value: row.value,
  delta: row.delta,
  firstObservation: row.first_observation === 1,
  receivedAt: row.received_at,
});
