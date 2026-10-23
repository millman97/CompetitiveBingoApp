// The event envelope, narrowed to a discriminated union.
//
// Every field shape here comes from src/generated/contract-types.ts. Nothing in this file
// re-declares a property that a schema already defines — it only composes generated pieces into
// the union TypeScript needs in order to narrow `detail` by `metric.type`. The schema expresses
// that relationship with allOf/if/then, which no TypeScript generator turns into a union.

import type {
  CollectionLogDetail,
  CompetitiveBingoEventEnvelope,
  CountDetail,
  DropDetail,
  DurationDetail,
  KillDetail,
  ManualDetail,
  Metric,
} from '../generated/contract-types';

export type {
  CollectionLogDetail,
  CountDetail,
  DropDetail,
  DurationDetail,
  KillDetail,
  ManualDetail,
  Metric,
} from '../generated/contract-types';

/**
 * Strips the `[k: string]: unknown` index signature the type generator emits for a schema whose
 * root is an intersection. Without this, `Omit` collapses every named property back into the
 * index signature and the union below narrows nothing.
 */
type RemoveIndex<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

type EnvelopeFields = RemoveIndex<CompetitiveBingoEventEnvelope>;

export type MetricType = Metric['type'];

/**
 * One observed envelope shape: the common fields, with `metric.type` pinned and `detail` matched.
 *
 * `source` is pinned to OBSERVED here, because a hand-typed event carries manualDetail whatever
 * its metric type says — which is exactly what the union below has to express.
 */
type Envelope<T extends MetricType, D> = Omit<EnvelopeFields, 'metric' | 'detail' | 'source'> & {
  source: 'OBSERVED';
  metric: Omit<Metric, 'type'> & { type: T };
  detail: D;
};

export type CountEnvelope = Envelope<'COUNT', CountDetail>;
export type KillEnvelope = Envelope<'KILL', KillDetail>;
export type DropEnvelope = Envelope<'DROP', DropDetail>;
export type DurationEnvelope = Envelope<'DURATION', DurationDetail>;
export type CollectionLogEnvelope = Envelope<'COLLECTION_LOG', CollectionLogDetail>;

/**
 * An event the player typed in themselves.
 *
 * The metric type still follows from the metric ID's namespace, but the detail is always
 * manualDetail and `metric.value` may be null where an observed event of that type never is —
 * refusing an input nothing could be read out of would take away the only route for exactly the
 * cases manual entry exists to cover.
 */
export type ManualEnvelope = Omit<EnvelopeFields, 'detail' | 'source'> & {
  source: 'MANUAL';
  detail: ManualDetail;
};

export type EventEnvelope =
  | CountEnvelope
  | KillEnvelope
  | DropEnvelope
  | DurationEnvelope
  | CollectionLogEnvelope
  | ManualEnvelope;

export const isManual = (e: EventEnvelope): e is ManualEnvelope => e.source === 'MANUAL';

export const isCount = (e: EventEnvelope): e is CountEnvelope =>
  !isManual(e) && e.metric.type === 'COUNT';
export const isKill = (e: EventEnvelope): e is KillEnvelope =>
  !isManual(e) && e.metric.type === 'KILL';
export const isDrop = (e: EventEnvelope): e is DropEnvelope =>
  !isManual(e) && e.metric.type === 'DROP';
export const isDuration = (e: EventEnvelope): e is DurationEnvelope =>
  !isManual(e) && e.metric.type === 'DURATION';
export const isCollectionLog = (e: EventEnvelope): e is CollectionLogEnvelope =>
  !isManual(e) && e.metric.type === 'COLLECTION_LOG';
