// The HTTP half of the simulator.
//
// Speaks the contract exactly as the plugin does, including the parts that are easy to get wrong
// in a test: the body of /events is always an array, results are matched by eventId rather than
// position, and a retry reuses the identical envelope — screenshot included, since the image
// travels inside it.
//
// The transport is injected so the same simulator drives the Worker in-process during tests and a
// real deployment over the network when checking against the plugin's dry run.

import type { EventEnvelope } from '../../src/contract/envelope';
import type { SimulatedPlayer } from './player';

export interface Transport {
  fetch(request: Request): Promise<Response>;
}

export interface GameConfigResponse {
  gameId: string;
  name: string;
  state: 'UPCOMING' | 'LIVE' | 'ENDED' | 'LOCKED';
  startsAt: number;
  endsAt: number;
  schemaVersion: number;
  minPluginVersion: string;
  trackedMetrics: string[];
  metricLabels: Record<string, string> | null;
  screenshotsRequested: boolean;
}

export interface SyncResponse {
  playerToken: string;
  gameId: string;
  teamName: string | null;
  tokenExpiresAt: number;
}

export interface EventResult {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  rejectionReason?: 'NOT_TRACKED' | 'GAME_NOT_LIVE' | 'OUT_OF_WINDOW' | 'INVALID';
}

export class SimulatedClient {
  private token: string | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly baseUrl: string,
    readonly player: SimulatedPlayer,
    private readonly pluginVersion = '0.1.0',
  ) {}

  get playerToken(): string | null {
    return this.token;
  }

  /** Lets a test simulate a client holding a stale or forged token. */
  setToken(token: string | null): void {
    this.token = token;
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private authHeaders(): Record<string, string> {
    if (this.token === null) {
      throw new Error('The simulated client has not synced, so it holds no token.');
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  fetchGame(joinCode: string): Promise<Response> {
    return this.transport.fetch(
      new Request(this.url(`/api/plugin/game?code=${encodeURIComponent(joinCode)}`)),
    );
  }

  /** The full handshake: GET the game, then POST the sync, exactly as the plugin does. */
  async sync(joinCode: string): Promise<{ game: GameConfigResponse; sync: SyncResponse }> {
    const gameResponse = await this.fetchGame(joinCode);
    if (!gameResponse.ok) {
      throw new Error(`GET /game failed: ${gameResponse.status} ${await gameResponse.text()}`);
    }
    const game = (await gameResponse.json()) as GameConfigResponse;

    const syncResponse = await this.syncRaw(joinCode);
    if (!syncResponse.ok) {
      throw new Error(`POST /sync failed: ${syncResponse.status} ${await syncResponse.text()}`);
    }
    const sync = (await syncResponse.json()) as SyncResponse;

    this.token = sync.playerToken;
    return { game, sync };
  }

  /** The sync call on its own, so a test can inspect a non-2xx rather than throw on it. */
  syncRaw(joinCode: string): Promise<Response> {
    return this.transport.fetch(
      new Request(this.url('/api/plugin/sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          joinCode,
          accountHash: this.player.accountHash,
          displayName: this.player.displayName,
          pluginVersion: this.pluginVersion,
          schemaVersion: 1,
        }),
      }),
    );
  }

  sendRaw(body: unknown): Promise<Response> {
    return this.transport.fetch(
      new Request(this.url('/api/plugin/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify(body),
      }),
    );
  }

  /** Submits a batch and returns the results keyed by eventId, as the plugin matches them. */
  async send(envelopes: EventEnvelope[]): Promise<Map<string, EventResult>> {
    const response = await this.sendRaw(envelopes);
    if (!response.ok) {
      throw new Error(`POST /events failed: ${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as { results: EventResult[] };
    return new Map(body.results.map((result) => [result.eventId, result]));
  }

  /** Submits one envelope and returns its result. */
  async sendOne(envelope: EventEnvelope): Promise<EventResult> {
    const results = await this.send([envelope]);
    const result = results.get(envelope.eventId);
    if (result === undefined) {
      throw new Error(`No result for ${envelope.eventId}; the server must return one per envelope.`);
    }
    return result;
  }

  reportReady(ready: boolean, checks: { id: string; satisfied: boolean }[]): Promise<Response> {
    return this.transport.fetch(
      new Request(this.url('/api/plugin/ready'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: JSON.stringify({ ready, checks }),
      }),
    );
  }

}
