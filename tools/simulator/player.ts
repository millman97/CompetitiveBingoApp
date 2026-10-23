// A simulated RuneLite client.
//
// This is the primary integration harness for the server: it emits contract-valid envelopes with
// correctly derived event IDs, so a test can drive a whole event — multiple players, races for
// the same tile in the same tick, backfill, duplicates and retries — without a game client.
//
// It deliberately models the *plugin's* view of the world rather than the server's. It holds its
// own baselines, reports absolute values it believes, and can be told to play "off plugin" so
// that the next envelope carries a gap the server has to notice.

import { deriveEventId } from '../../src/contract/event-id';
import type {
  CollectionLogEnvelope,
  CountEnvelope,
  DropEnvelope,
  DurationEnvelope,
  EventEnvelope,
  KillEnvelope,
  ManualEnvelope,
} from '../../src/contract/envelope';

/**
 * Metric ID normalisation, contract section 3.1.
 *
 * Mirrored here because a realistic client derives IDs from what the game said. The server never
 * does this — it only ever sees canonical IDs.
 */
export const normaliseMetricId = (family: string, raw: string): string =>
  `${family}.${raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}`;

/** A real, if very small, JPEG. Enough for the server to decode and store. */
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';

/** Extras a drop can carry: client prices, and the rule that fired on it. */
export interface DropOptions {
  metricId?: string;
  geValue?: number | null;
  haValue?: number | null;
  ruleValue?: number | null;
}

export interface SimulatedPlayerOptions {
  accountHash: string;
  displayName: string;
  gameId: string;
  /** Fixed so tests are deterministic; a real client mints one per session. */
  sessionId?: string;
  world?: number;
  worldTypes?: string[];
  /** When set, every envelope carries a small base64 image of this type. */
  screenshotMediaType?: 'image/jpeg' | 'image/webp' | 'image/png' | null;
}

export class SimulatedPlayer {
  readonly accountHash: string;
  readonly displayName: string;
  readonly gameId: string;

  private sessionId: string;
  private tick = 1000;
  private readonly world: number;
  private readonly worldTypes: string[];
  private readonly mediaType: 'image/jpeg' | 'image/webp' | 'image/png' | null;
  private readonly image: string | null;

  /** What the game would say the count is, including anything earned off-plugin. */
  private readonly trueCounts = new Map<string, number>();
  /** Metrics this session has already reported at least once. */
  private readonly seen = new Set<string>();
  /** Per-tick ordinal for delta-only observations whose other ID fields may be identical. */
  private observationTick = -1;
  private observationOrdinal = 0;

  constructor(options: SimulatedPlayerOptions) {
    this.accountHash = options.accountHash;
    this.displayName = options.displayName;
    this.gameId = options.gameId;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.world = options.world ?? 302;
    this.worldTypes = options.worldTypes ?? ['MEMBERS'];
    this.mediaType = options.screenshotMediaType ?? null;
    this.image = this.mediaType === null ? null : TINY_JPEG;
  }

  /**
   * Starts a fresh session, as a login or an account switch does.
   *
   * Baselines reset and firstObservation becomes true again, which is exactly the situation where
   * a gap against the server's stored value is unexplained rather than a dropped event.
   */
  newSession(): void {
    this.sessionId = crypto.randomUUID();
    this.seen.clear();
  }

  /** Advances the tick counter the way time passing would. */
  advance(ticks = 1): void {
    this.tick += ticks;
  }

  /** Pins the tick, so two players can be made to act in the very same tick. */
  setTick(tick: number): void {
    this.tick = tick;
  }

  /**
   * Kills something off-plugin — on mobile, on another client, or with the plugin switched off.
   *
   * Nothing is emitted. The count still moves, so the next kill reported through the plugin
   * carries an absolute value with a gap in front of it.
   */
  playOffPlugin(metricId: string, kills: number): void {
    this.trueCounts.set(metricId, (this.trueCounts.get(metricId) ?? 0) + kills);
  }

  /** Sets the count as though the account arrived with history already on it. */
  seedCount(metricId: string, count: number): void {
    this.trueCounts.set(metricId, count);
  }

  private common() {
    return {
      schemaVersion: 1 as const,
      source: 'OBSERVED' as const,
      gameId: this.gameId,
      accountHash: this.accountHash,
      displayName: this.displayName,
      sessionId: this.sessionId,
      clientTime: Date.now(),
      gameTick: this.tick,
      world: this.world,
      worldTypes: this.worldTypes,
      // The image travels inside the envelope. There is no separate upload.
      screenshot: this.image,
      screenshotMediaType: this.mediaType,
    };
  }

  private firstObservation(metricId: string): boolean {
    const first = !this.seen.has(metricId);
    this.seen.add(metricId);
    return first;
  }

  private nextObservationOrdinal(): number {
    if (this.observationTick !== this.tick) {
      this.observationTick = this.tick;
      this.observationOrdinal = 0;
    }
    return this.observationOrdinal++;
  }

  /** One kill count message. delta is always 1 — one message is one kill. */
  async kill(activity: string): Promise<CountEnvelope> {
    const id = normaliseMetricId('kc', activity);
    const value = (this.trueCounts.get(id) ?? 0) + 1;
    this.trueCounts.set(id, value);
    this.advance();

    const envelope = {
      ...this.common(),
      eventId: '',
      metric: {
        id,
        type: 'COUNT' as const,
        value,
        delta: 1,
        firstObservation: this.firstObservation(id),
      },
      detail: {
        activity,
        rawMessage: `Your ${activity} kill count is: ${value}.`,
      },
    } satisfies Omit<CountEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  async drop(
    itemId: number,
    itemName: string,
    source: string,
    quantity = 1,
    options: DropOptions = {},
  ): Promise<DropEnvelope> {
    // A value rule emits its own metric ID rather than the item's, which is how "any drop worth a
    // million" becomes a metric at all.
    const id = options.metricId ?? normaliseMetricId('drop', itemName);
    this.advance();

    const envelope = {
      ...this.common(),
      eventId: '',
      metric: {
        id,
        type: 'DROP' as const,
        value: null,
        delta: quantity,
        firstObservation: this.firstObservation(id),
      },
      detail: {
        itemId,
        itemName,
        quantity,
        source,
        sourceType: 'NPC' as const,
        killCount: this.trueCounts.get(normaliseMetricId('kc', source)) ?? null,
        // Prices come from the running client, so they are null on a game that asks for none.
        geValue: options.geValue ?? null,
        haValue: options.haValue ?? null,
        // Non-null exactly on an event a dropValueRules entry produced.
        ruleValue: options.ruleValue ?? null,
        observationOrdinal: this.nextObservationOrdinal(),
      },
    } satisfies Omit<DropEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  /** One server-attributed NPC loot occurrence used as a delta-only monster kill. */
  async observedKill(
    npcId: number,
    npcName: string,
    combatLevel: number | null = null,
  ): Promise<KillEnvelope> {
    const id = normaliseMetricId('kill', npcName);
    this.advance();

    const envelope = {
      ...this.common(),
      eventId: '',
      metric: {
        id,
        type: 'KILL' as const,
        value: null,
        delta: 1,
        firstObservation: this.firstObservation(id),
      },
      detail: {
        npcId,
        npcName,
        combatLevel,
        signal: 'SERVER_NPC_LOOT' as const,
        observationOrdinal: this.nextObservationOrdinal(),
      },
    } satisfies Omit<KillEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  async duration(activity: string, durationMs: number, isPersonalBest = false): Promise<DurationEnvelope> {
    const id = normaliseMetricId('time', activity);
    this.advance();

    const envelope = {
      ...this.common(),
      eventId: '',
      metric: {
        id,
        type: 'DURATION' as const,
        value: durationMs,
        delta: null,
        firstObservation: this.firstObservation(id),
      },
      detail: {
        activity,
        variant: null,
        durationMs,
        isPersonalBest,
        personalBestMs: isPersonalBest ? durationMs : null,
        rawMessage: `Challenge duration: ${Math.floor(durationMs / 60000)}:${String(
          Math.floor((durationMs % 60000) / 1000),
        ).padStart(2, '0')}.`,
      },
    } satisfies Omit<DurationEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  async collectionLog(itemName: string): Promise<CollectionLogEnvelope> {
    const id = normaliseMetricId('collection_log', itemName);
    this.advance();

    const envelope = {
      ...this.common(),
      eventId: '',
      metric: {
        id,
        type: 'COLLECTION_LOG' as const,
        value: null,
        delta: 1,
        firstObservation: this.firstObservation(id),
      },
      // Usually null: the game only supplies these while the log interface is open [D12].
      detail: { itemName, completed: null, totalPossible: null },
    } satisfies Omit<CollectionLogEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  /**
   * An event the player typed in by hand.
   *
   * The metric type follows from the ID's namespace, and `value` may legitimately be null when
   * nothing numeric could be read out of what was typed — which is the whole point of the
   * feature, so the harness has to be able to produce it.
   */
  async manual(
    metricId: string,
    activity: string,
    input: string,
    reading: {
      value?: number | null;
      delta?: number | null;
      interpretedAs?: 'count' | 'quantity' | 'duration' | null;
    } = {},
  ): Promise<ManualEnvelope> {
    const type = metricId.startsWith('kc.')
      ? ('COUNT' as const)
      : metricId.startsWith('time.')
        ? ('DURATION' as const)
        : metricId.startsWith('collection_log.')
          ? ('COLLECTION_LOG' as const)
          : ('DROP' as const);

    this.advance();

    const envelope = {
      ...this.common(),
      source: 'MANUAL' as const,
      eventId: '',
      metric: {
        id: metricId,
        type,
        value: reading.value ?? null,
        delta: reading.delta ?? (type === 'DURATION' ? null : 1),
        firstObservation: this.firstObservation(metricId),
      },
      detail: { activity, input, interpretedAs: reading.interpretedAs ?? null },
    } satisfies Omit<ManualEnvelope, 'eventId'> & { eventId: string };

    return this.sign(envelope);
  }

  private async sign<T extends EventEnvelope>(envelope: T): Promise<T> {
    return { ...envelope, eventId: await deriveEventId(envelope) };
  }
}
