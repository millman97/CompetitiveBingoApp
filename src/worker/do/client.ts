// Calling the game's Durable Object from the Worker.
//
// The object is addressed by game id, so every request about one game lands on the same instance
// and is serialised against every other request about that game.

import type { Env } from '../env';
import type { EventResult } from '../ingest';
import type { IngestRequest } from './game-room';
import type { ReplayResult } from '../scoring/replay';

/** The URL scheme here is internal; the object is reached through the binding, never the network. */
const INTERNAL = 'https://game-room';

const stubFor = (env: Env, gameId: string): DurableObjectStub =>
  env.GAME_ROOM.get(env.GAME_ROOM.idFromName(gameId));

const checked = async (response: Response): Promise<Response> => {
  if (!response.ok) {
    throw new Error(`Game room request failed (${response.status}): ${await response.text()}`);
  }
  return response;
};

/** Ingests, credits and settles one batch inside the game's single-writer boundary. */
export const ingestInRoom = async (
  env: Env,
  request: IngestRequest,
): Promise<EventResult[]> => {
  const response = await checked(
    await stubFor(env, request.gameId).fetch(`${INTERNAL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
  return (await response.json<{ results: EventResult[] }>()).results;
};

/** Rebuilds derived state inside the same boundary used by live ingestion. */
export const replayInRoom = async (env: Env, gameId: string): Promise<ReplayResult> => {
  const response = await checked(
    await stubFor(env, gameId).fetch(`${INTERNAL}/replay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
    }),
  );
  return response.json<ReplayResult>();
};

/** The whole board, for a first paint or as the fallback when a socket will not open. */
export const roomSnapshot = (env: Env, gameId: string): Promise<Response> =>
  stubFor(env, gameId).fetch(`${INTERNAL}/snapshot?gameId=${encodeURIComponent(gameId)}`);

/** Upgrades a client socket onto the game's object. */
export const roomSocket = (
  env: Env,
  gameId: string,
  request: Request,
  since: string | null,
): Promise<Response> => {
  const url = new URL(`${INTERNAL}/ws`);
  url.searchParams.set('gameId', gameId);
  if (since !== null) {
    url.searchParams.set('since', since);
  }

  return stubFor(env, gameId).fetch(url, {
    headers: request.headers,
  });
};

/** Called after a replay has rewritten the derived tables the object was serving. */
export const reloadRoom = (env: Env, gameId: string): Promise<Response> =>
  stubFor(env, gameId).fetch(`${INTERNAL}/reload?gameId=${encodeURIComponent(gameId)}`);
