// One Durable Object per game.
//
// It exists to be the game's single writer. COUNT derivation, replay, tile ownership and win
// detection are all order-dependent or compare teams against each other. "Two clients advance the
// same counter" and "two teams capture the same tile" each need one deterministic answer, which
// only exists when ingestion and replay share this serialization boundary.
//
// It is also where the WebSockets live, because fan-out has to happen somewhere that knows the
// board just changed.
//
// **Hibernation is not an optimisation here.** A Durable Object held permanently active costs
// roughly 10,800 GB-s per day against a 13,000 GB-s daily free allowance, so one non-hibernating
// object nearly exhausts the account on its own. Every socket is accepted through
// `acceptWebSocket`, and all long-lived state lives in storage rather than in instance fields, so
// the runtime can evict this object between events and bring it back on the next one.

import { DurableObject } from 'cloudflare:workers';

import type { Env } from '../env';
import { findGameById, listDropValueRules, listTrackedMetrics, type Game } from '../db/games';
import { findPlayer } from '../db/players';
import { loadTiles, listTeamIds, type Tile } from '../db/tiles';
import { ingestOne, type EventResult } from '../ingest';
import { loadCompletedCells, loadOwnedCells, resolveTileOwnership } from '../scoring/control';
import { recomputeTile, tileTracks, type ScoringContext } from '../scoring/engine';
import { replayGame, scoringContextFor } from '../scoring/replay';
import { evaluateDeadline, evaluateLive, evaluateRush, type Outcome } from '../scoring/win';
import { buildBoardState, type BoardState } from './board-state';

/** Broadcasts are batched to at most one per second. */
const BROADCAST_INTERVAL_MS = 1000;

/** How many patches to keep so a reconnecting client can be caught up rather than resent the board. */
const PATCH_HISTORY = 200;

/**
 * How far endsAt is pushed when a game enters sudden death.
 *
 * Sudden death has no timeout by design, but the plugin stops auto-resuming on login once endsAt
 * has passed — so leaving it in the past would silently strand anybody who relogs during the
 * finale, which is precisely when it matters. The alarm below extends it again while the game is
 * still running.
 */
const SUDDEN_DEATH_EXTENSION_MS = 24 * 60 * 60 * 1000;

interface ApplyRequest {
  gameId: string;
  /** The metric and team of each event just stored, so only affected tiles are recomputed. */
  touched: { metricId: string; teamId: string | null }[];
  /** Rebuild every tile/team pair, used to recover a batch whose earlier settlement failed. */
  reconcileAll?: boolean;
}

export interface IngestRequest {
  gameId: string;
  accountHash: string;
  envelopes: unknown[];
}

export type BoardChange =
  | { kind: 'TILE'; tile: BoardState['tiles'][number] }
  | { kind: 'LINES'; lines: BoardState['lines'] }
  | { kind: 'GAME'; state: BoardState['state']; endsAt: number; winner: BoardState['winner'] };

export type ServerMessage =
  | { type: 'snapshot'; version: number; board: BoardState }
  | { type: 'patch'; version: number; changes: BoardChange[] };

interface Patch {
  version: number;
  changes: BoardChange[];
}

export class GameRoom extends DurableObject<Env> {
  /**
   * D1 calls are external awaits, so a plain JavaScript "single threaded" assumption is not a
   * sufficient lock: another request may be delivered while one is suspended. Keep all mutations
   * on an explicit promise chain. Hibernation cannot split concurrent calls across instances;
   * once no call is running there is no in-memory lock state left to lose.
   */
  private mutationTail: Promise<void> = Promise.resolve();

  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(work, work);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/ws':
        return this.serialise(() => this.upgrade(request, url));
      case '/ingest':
        return this.serialise(async () => this.ingest(await request.json<IngestRequest>()));
      case '/replay':
        return this.serialise(async () => this.replay(await request.json<{ gameId: string }>()));
      case '/snapshot':
        return this.serialise(() => this.snapshot(url.searchParams.get('gameId')));
      case '/reload':
        // Called after a replay has rewritten the derived tables underneath us.
        return this.serialise(() => this.reload(url.searchParams.get('gameId')));
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  // ---------------------------------------------------------------------------
  // Sockets
  // ---------------------------------------------------------------------------

  private async upgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const gameId = url.searchParams.get('gameId');
    if (gameId === null) {
      return new Response('No game', { status: 400 });
    }
    await this.ctx.storage.put('gameId', gameId);
    await this.ensureAlarm();

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable: not server.accept(). The runtime may evict this object while the socket stays
    // open, and deliver the next message by waking it.
    this.ctx.acceptWebSocket(server);

    // A client may name where it got to, so a reconnect costs a diff rather than a whole board.
    // Absent is not zero: `Number(null)` is 0, and treating a first connection as "already up to
    // date at version 0" is how a client ends up staring at an empty board.
    const raw = url.searchParams.get('since');
    const since = raw === null ? null : Number(raw);
    await this.catchUp(server, since !== null && Number.isInteger(since) ? since : null);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      return;
    }

    let parsed: { type?: unknown; since?: unknown };
    try {
      parsed = JSON.parse(message) as { type?: unknown; since?: unknown };
    } catch {
      return;
    }

    if (parsed.type === 'hello') {
      await this.serialise(() =>
        this.catchUp(ws, typeof parsed.since === 'number' ? parsed.since : null),
      );
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // Nothing to clean up: no per-socket state is held outside the socket itself, which is what
    // makes hibernation safe.
    ws.close(1000);
  }

  override async webSocketError(): Promise<void> {
    // A broken socket is dropped by the runtime; there is nothing useful to do about it here.
  }

  /**
   * Brings one socket up to date.
   *
   * A client that names a version still in the patch log gets the diff. Anything older — or a
   * first connection — gets the whole board, because guessing at what it missed would be worse
   * than sending a few kilobytes.
   */
  private async catchUp(ws: WebSocket, since: number | null): Promise<void> {
    const version = (await this.ctx.storage.get<number>('version')) ?? 0;

    if (since !== null && since <= version) {
      const patches = (await this.ctx.storage.get<Patch[]>('patches')) ?? [];
      const missed = patches.filter((patch) => patch.version > since);

      if (since === version || missed.length > 0) {
        for (const patch of missed) {
          ws.send(JSON.stringify({ type: 'patch', ...patch } satisfies ServerMessage));
        }
        return;
      }
    }

    const board = await this.loadBoard();
    if (board !== null) {
      ws.send(JSON.stringify({ type: 'snapshot', version, board } satisfies ServerMessage));
    }
  }

  // ---------------------------------------------------------------------------
  // Applying events
  // ---------------------------------------------------------------------------

  private async ingest(request: IngestRequest): Promise<Response> {
    const loaded = await this.load(request.gameId);
    const player = await findPlayer(this.env.DB, request.gameId, request.accountHash);
    if (loaded === null || player === null || player.removedAt !== null) {
      return new Response('Game or player no longer exists', { status: 409 });
    }

    const [tracked, rules] = await Promise.all([
      listTrackedMetrics(this.env.DB, request.gameId),
      listDropValueRules(this.env.DB, request.gameId),
    ]);
    const ctx = {
      db: this.env.DB,
      screenshots: this.env.SCREENSHOTS,
      game: loaded.game,
      player,
      trackedMetrics: [
        ...new Set([...tracked.map((entry) => entry.metricId), ...rules.map((rule) => rule.metricId)]),
      ],
      // Stamp receipt inside the single-writer boundary. If two Worker requests race on their way
      // here, this keeps live derivation order identical to replay's received_at/rowid order.
      receivedAt: Date.now(),
      scoring: loaded.ctx,
      touched: [],
      needsReplay: false,
    };

    const results: EventResult[] = [];
    for (const envelope of request.envelopes) {
      results.push(await ingestOne(ctx, envelope));
    }

    if (ctx.needsReplay) {
      await replayGame(this.env.DB, request.gameId);
    }

    // Any accepted duplicate makes this a recovery opportunity. If a prior request committed its
    // event credit but failed during settlement, the identical retry rebuilds the whole board
    // instead of becoming a no-op forever. Ordinary all-new batches keep the cheaper touched set.
    await this.apply({
      gameId: request.gameId,
      touched: ctx.touched,
      reconcileAll: ctx.needsReplay || results.some((result) => result.accepted && result.duplicate),
    });
    return Response.json({ results });
  }

  private async replay(request: { gameId: string }): Promise<Response> {
    await this.ctx.storage.put('gameId', request.gameId);
    const result = await replayGame(this.env.DB, request.gameId);
    await this.reload(request.gameId);
    return Response.json(result);
  }

  /**
   * Recomputes everything one batch of events could have changed, and decides whether the game is
   * over.
   *
   * Runs to completion before the next call starts, which is the entire point of putting it here.
   */
  private async apply(request: ApplyRequest): Promise<Response> {
    await this.ctx.storage.put('gameId', request.gameId);

    const loaded = await this.load(request.gameId);
    if (loaded === null) {
      return Response.json({ applied: false, reason: 'no-such-game' });
    }

    const { game, ctx, tiles, teamIds } = loaded;

    // A won game is finished. Late events cannot unseat a winner, which is what makes two teams
    // completing a line in the same instant produce exactly one of them.
    if (game.wonByTeamId !== null) {
      if (request.reconcileAll) {
        // Settlement may have committed the winning state and then failed while publishing it.
        // A duplicate retry cannot settle again, but it can give every socket an authoritative
        // snapshot so the final tile, line and winner are not permanently invisible.
        await this.reload(game.id);
        return Response.json({ applied: true, changed: true, reason: 'already-won-reloaded' });
      }
      return Response.json({ applied: false, reason: 'already-won' });
    }

    const now = Date.now();
    const changes: BoardChange[] = [];
    const touchedTiles = new Set<string>();

    if (request.reconcileAll) {
      for (const teamId of teamIds) {
        for (const tile of tiles) {
          await recomputeTile(ctx, tile, teamId);
          touchedTiles.add(tile.id);
        }
      }
    }

    if (!request.reconcileAll) {
      for (const { metricId, teamId } of request.touched) {
        if (teamId === null) {
          // An unassigned player's progress has nowhere to land yet.
          continue;
        }
        for (const tile of tiles.filter((candidate) => tileTracks(candidate, metricId))) {
          await recomputeTile(ctx, tile, teamId);
          touchedTiles.add(tile.id);
        }
      }
    }

    let ownershipMoved = false;
    if (game.mode !== 'CLASSIC') {
      for (const tile of tiles.filter((candidate) => touchedTiles.has(candidate.id))) {
        const change = await resolveTileOwnership(ctx, tile, teamIds, now);
        ownershipMoved ||= change.changed;
      }
    }

    if (touchedTiles.size === 0) {
      return Response.json({ applied: true, changed: false });
    }

    const outcome = await this.evaluate(game, ctx, tiles);
    const settled = await this.settle(game, ctx, tiles, outcome, now);

    const board = await buildBoardState(this.env.DB, settled ?? game, tiles);

    for (const tile of board.tiles.filter((candidate) => touchedTiles.has(candidate.tileId))) {
      changes.push({ kind: 'TILE', tile });
    }
    if (ownershipMoved || game.mode === 'CLASSIC') {
      changes.push({ kind: 'LINES', lines: board.lines });
    }
    if (settled !== null) {
      changes.push({
        kind: 'GAME',
        state: board.state,
        endsAt: board.endsAt,
        winner: board.winner,
      });
    }

    await this.publish(changes);
    await this.ensureAlarm();

    return Response.json({ applied: true, changed: true, outcome: outcome.kind });
  }

  /** Decides whether the board, as it now stands, ends the game. */
  private async evaluate(game: Game, ctx: ScoringContext, tiles: Tile[]): Promise<Outcome> {
    if (game.mode === 'CLASSIC') {
      return { kind: 'CONTINUE' };
    }

    const owned = await loadOwnedCells(this.env.DB, game.id, tiles);

    if (game.mode === 'RUSH') {
      // A RUSH board with every tile claimed is over: nothing anybody does can move it, and
      // leaving it running to its deadline only makes people wait for a result already decided.
      const claimed = [...owned.values()].reduce((total, cells) => total + cells.length, 0);

      return evaluateRush(
        { rows: game.boardRows, cols: game.boardCols },
        owned,
        claimed >= tiles.length,
      );
    }

    if (game.winCondition === null) {
      return { kind: 'CONTINUE' };
    }

    return evaluateLive(
      game.winCondition,
      { rows: game.boardRows, cols: game.boardCols },
      owned,
      game.state === 'SUDDEN_DEATH',
    );
  }

  /**
   * Writes an outcome down, if there is one.
   *
   * @returns the updated game when something changed, or null when play continues
   */
  private async settle(
    game: Game,
    ctx: ScoringContext,
    tiles: Tile[],
    outcome: Outcome,
    now: number,
  ): Promise<Game | null> {
    if (outcome.kind === 'CONTINUE') {
      return null;
    }

    if (outcome.kind === 'SUDDEN_DEATH') {
      // The board carries over and ownership keeps flipping; only the ending rule changes.
      const endsAt = now + SUDDEN_DEATH_EXTENSION_MS;
      await this.env.DB.prepare("UPDATE games SET state = 'SUDDEN_DEATH', ends_at = ? WHERE id = ?")
        .bind(endsAt, game.id)
        .run();
      return { ...game, state: 'SUDDEN_DEATH', endsAt };
    }

    const winner = outcome.kind === 'WIN' ? outcome.teamId : null;

    await this.env.DB.prepare(
      "UPDATE games SET state = 'ENDED', won_by_team_id = ?, won_at = ? WHERE id = ?",
    )
      .bind(winner, winner === null ? null : now, game.id)
      .run();

    const ended: Game = {
      ...game,
      state: 'ENDED',
      wonByTeamId: winner,
      wonAt: winner === null ? null : now,
    };

    // The live object will be evicted once the game is over, so the final board is written down
    // where a finished event can still be rendered from.
    const board = await buildBoardState(this.env.DB, ended, tiles);
    await this.env.DB.prepare(
      `INSERT INTO board_snapshots (game_id, snapshot_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(game_id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
                                          created_at = excluded.created_at`,
    )
      .bind(game.id, JSON.stringify(board), now)
      .run();

    return ended;
  }

  // ---------------------------------------------------------------------------
  // Deadline
  // ---------------------------------------------------------------------------

  override async alarm(): Promise<void> {
    await this.serialise(() => this.runAlarm());
  }

  private async runAlarm(): Promise<void> {
    const now = Date.now();

    const flushAt = (await this.ctx.storage.get<number>('flushAt')) ?? null;
    if (flushAt !== null && flushAt <= now) {
      await this.ctx.storage.delete('flushAt');
      await this.flush();
    }

    const gameId = await this.ctx.storage.get<string>('gameId');
    if (gameId !== undefined) {
      const loaded = await this.load(gameId);
      if (loaded !== null && loaded.game.endsAt <= now) {
        await this.handleDeadline(loaded.game, loaded.ctx, loaded.tiles, now);
      }
    }

    await this.ensureAlarm();
  }

  /**
   * What happens when the clock runs out.
   *
   * MOST_AT_DEADLINE settles here. HYBRID_SUDDEN_DEATH either awards it to a team already holding
   * a line or carries the board into sudden death, which has no timeout of its own — so the only
   * thing the deadline does from then on is push endsAt along so the plugin keeps resuming.
   */
  private async handleDeadline(
    game: Game,
    ctx: ScoringContext,
    tiles: Tile[],
    now: number,
  ): Promise<void> {
    if (game.state === 'ENDED' || game.wonByTeamId !== null) {
      return;
    }

    if (game.state === 'SUDDEN_DEATH') {
      const endsAt = now + SUDDEN_DEATH_EXTENSION_MS;
      await this.env.DB.prepare('UPDATE games SET ends_at = ? WHERE id = ?')
        .bind(endsAt, game.id)
        .run();
      await this.publish([
        { kind: 'GAME', state: 'SUDDEN_DEATH', endsAt, winner: null },
      ]);
      return;
    }

    const held =
      game.mode === 'CLASSIC'
        ? await loadCompletedCells(this.env.DB, game.id, tiles)
        : await loadOwnedCells(this.env.DB, game.id, tiles);

    const shape = { rows: game.boardRows, cols: game.boardCols };

    const outcome: Outcome =
      game.mode === 'RUSH'
        ? evaluateRush(shape, held, true)
        : game.mode === 'CONTROL' && game.winCondition !== null
          ? evaluateDeadline(game.winCondition, shape, held)
          : { kind: 'ENDED_NO_WINNER' };

    const settled = await this.settle(game, ctx, tiles, outcome, now);
    if (settled === null) {
      return;
    }

    const board = await buildBoardState(this.env.DB, settled, tiles);
    await this.publish([
      { kind: 'GAME', state: board.state, endsAt: board.endsAt, winner: board.winner },
      { kind: 'LINES', lines: board.lines },
    ]);
  }

  /**
   * Keeps one alarm pointed at whichever comes first: a deferred broadcast, or the deadline.
   *
   * A Durable Object has exactly one alarm, so both purposes share it.
   */
  private async ensureAlarm(): Promise<void> {
    const gameId = await this.ctx.storage.get<string>('gameId');
    const flushAt = (await this.ctx.storage.get<number>('flushAt')) ?? null;

    let deadlineAt: number | null = null;
    if (gameId !== undefined) {
      const game = await findGameById(this.env.DB, gameId);
      if (game !== null && game.state !== 'ENDED') {
        deadlineAt = game.endsAt;
      }
    }

    const candidates = [flushAt, deadlineAt].filter((value): value is number => value !== null);
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const next = Math.min(...candidates);
    const current = await this.ctx.storage.getAlarm();
    if (current !== next) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  // ---------------------------------------------------------------------------
  // Broadcasting
  // ---------------------------------------------------------------------------

  /**
   * Records a change and gets it to the clients.
   *
   * Every change is versioned and appended before anything is sent, so a rate-limited broadcast
   * delays delivery without losing anything: the flush simply sends everything past the version it
   * last sent.
   */
  private async publish(changes: BoardChange[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }

    const version = ((await this.ctx.storage.get<number>('version')) ?? 0) + 1;
    const patches = (await this.ctx.storage.get<Patch[]>('patches')) ?? [];

    patches.push({ version, changes });

    await this.ctx.storage.put({
      version,
      patches: patches.slice(-PATCH_HISTORY),
    });

    const last = (await this.ctx.storage.get<number>('lastBroadcastAt')) ?? 0;
    const now = Date.now();

    if (now - last >= BROADCAST_INTERVAL_MS) {
      await this.flush();
      return;
    }

    // Too soon. Leave it in the log and wake up to send it.
    await this.ctx.storage.put('flushAt', last + BROADCAST_INTERVAL_MS);
    await this.ensureAlarm();
  }

  /** Sends every patch the connected clients have not had yet. */
  private async flush(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    const version = (await this.ctx.storage.get<number>('version')) ?? 0;
    const sent = (await this.ctx.storage.get<number>('sentVersion')) ?? 0;

    await this.ctx.storage.put({ lastBroadcastAt: Date.now(), sentVersion: version });

    if (sockets.length === 0 || sent >= version) {
      return;
    }

    const patches = (await this.ctx.storage.get<Patch[]>('patches')) ?? [];
    const pending = patches.filter((patch) => patch.version > sent);

    for (const patch of pending) {
      const message = JSON.stringify({ type: 'patch', ...patch } satisfies ServerMessage);
      for (const socket of sockets) {
        try {
          socket.send(message);
        } catch {
          // A socket that has gone away is the runtime's problem, not ours.
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  private async load(
    gameId: string,
  ): Promise<{ game: Game; ctx: ScoringContext; tiles: Tile[]; teamIds: string[] } | null> {
    const game = await findGameById(this.env.DB, gameId);
    if (game === null) {
      return null;
    }

    const ctx = await scoringContextFor(this.env.DB, game);

    return {
      game,
      ctx,
      tiles: ctx.tiles,
      teamIds: await listTeamIds(this.env.DB, gameId),
    };
  }

  private async loadBoard(): Promise<BoardState | null> {
    const gameId = await this.ctx.storage.get<string>('gameId');
    if (gameId === undefined) {
      return null;
    }

    const game = await findGameById(this.env.DB, gameId);
    if (game === null) {
      return null;
    }

    return buildBoardState(this.env.DB, game, await loadTiles(this.env.DB, gameId));
  }

  private async snapshot(gameId: string | null): Promise<Response> {
    if (gameId !== null) {
      await this.ctx.storage.put('gameId', gameId);
    }

    const board = await this.loadBoard();
    if (board === null) {
      return new Response('No such game', { status: 404 });
    }

    const version = (await this.ctx.storage.get<number>('version')) ?? 0;
    return Response.json({ version, board });
  }

  /**
   * Drops the patch history and tells every client to take a fresh board.
   *
   * A replay rewrites the derived tables underneath this object, so the versions clients hold no
   * longer describe anything real.
   */
  private async reload(gameId: string | null): Promise<Response> {
    if (gameId !== null) {
      await this.ctx.storage.put('gameId', gameId);
    }

    await this.ctx.storage.delete('patches');

    const board = await this.loadBoard();
    if (board === null) {
      return new Response('No such game', { status: 404 });
    }

    const version = ((await this.ctx.storage.get<number>('version')) ?? 0) + 1;
    await this.ctx.storage.put({ version, sentVersion: version });

    const message = JSON.stringify({ type: 'snapshot', version, board } satisfies ServerMessage);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Ignore: the runtime cleans up dead sockets.
      }
    }

    await this.ensureAlarm();
    return Response.json({ reloaded: true, version });
  }
}
