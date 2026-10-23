// The admin surface.
//
// One password, no user accounts, and every route here already sits behind the session check on
// the router this is mounted into.

import { Hono } from 'hono';

import type { Env } from '../env';
import {
  insertAdjustment,
  readFlagQueue,
  readRosterAdmin,
  recordAction,
} from '../db/admin';
import { findGameById, listDropValueRules, listTrackedMetrics, type Game } from '../db/games';
import { loadTiles } from '../db/tiles';
import { buildBoardState } from '../do/board-state';
import { reloadRoom, replayInRoom } from '../do/client';
import { ApiError } from '../lib/errors';
import { newFlagId, newPlayerId } from '../lib/ids';
import { checkJoinCode, uniqueJoinCode } from '../lib/join-code';
import { isValidTrackedEntry } from '../../contract/metrics';
import { readSetup } from '../lib/setup';
import { requirementProblems, type TileRequirement } from '../scoring/tiles';
import { isManagedValueMetric, managedValueRules, managedValueStatements } from '../scoring/value-tiles';

interface AdminSession {
  actor: string;
}

type AdminBindings = {
  Bindings: Env;
  Variables: { admin: AdminSession; game: Game };
};

const MODES = ['CLASSIC', 'CONTROL', 'RUSH'] as const;
const WIN_CONDITIONS = ['FIRST_LINE', 'MOST_AT_DEADLINE', 'HYBRID_SUDDEN_DEATH'] as const;
const BACKFILL = ['COUNT', 'IGNORE', 'FLAG_ONLY'] as const;

/**
 * How close to the start an organiser may still move it.
 *
 * The plugin schedules one sync at the advertised start and does not poll, so a change inside this
 * window reaches nobody who has already scheduled theirs.
 */
const START_LOCK_MS = 10_000;

/**
 * How long a game runs when the organiser has not said otherwise.
 *
 * The creation form does not ask: a duration guessed before the board exists is not a decision,
 * and the game screen has the control that makes it one. A control game is usually an evening and
 * a classic one is usually a week, so those are the numbers to be wrong in the right direction.
 */
const DEFAULT_DURATION_MS: Record<Game['mode'], number> = {
  CONTROL: 4 * 60 * 60 * 1000,
  RUSH: 4 * 60 * 60 * 1000,
  CLASSIC: 7 * 24 * 60 * 60 * 1000,
};

const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

const bad = (message: string): never => {
  throw new ApiError(400, 'MALFORMED_REQUEST', message);
};

const rulesForBoard = (tiles: { label: string; requirement: TileRequirement }[]) => {
  try { return managedValueRules(tiles); }
  catch (error) { return bad((error as Error).message); }
};

const requireGame: import('hono').MiddlewareHandler<AdminBindings> = async (c, next) => {
  const game = await findGameById(c.env.DB, c.req.param('gameId') as string);
  if (game === null) {
    throw new ApiError(404, 'NOT_FOUND', 'No such game.');
  }
  c.set('game', game);
  await next();
};

/** Rebuilds every derived number, then tells the live object its board moved underneath it. */
const rebuild = async (env: Env, gameId: string): Promise<void> => {
  await replayInRoom(env, gameId);
};

export const adminGameRoutes = new Hono<AdminBindings>()

  // ---------------------------------------------------------------------------
  // Games
  // ---------------------------------------------------------------------------

  .get('/games', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT g.id, g.name, g.join_code, g.mode, g.win_condition, g.state,
              g.starts_at, g.ends_at, g.end_offset_ms, g.board_rows, g.board_cols, g.won_by_team_id,
              (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS players,
              (SELECT COUNT(*) FROM tiles t WHERE t.game_id = g.id) AS tiles,
              (SELECT COUNT(*) FROM teams t WHERE t.game_id = g.id) AS teams,
              (SELECT COUNT(*) FROM flags f WHERE f.game_id = g.id AND f.resolved_at IS NULL) AS openFlags
       FROM games g ORDER BY g.created_at DESC`,
    ).all();

    return c.json(results);
  })

  /**
   * Creates a whole game, or nothing.
   *
   * There is no half-built game in the database, which is the only reliable way to stop players
   * joining one: a game exists exactly when it is ready to be joined. The admin panel assembles a
   * draft in the browser and posts it here once, and everything below is written in a single
   * batch — times, teams, board, and the metric list the board implies.
   *
   * Every rule here is therefore a rule about a game that is about to be advertised to plugins,
   * rather than a rule about what an organiser may type into a form.
   */
  .post('/games', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));

    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : bad('Give the game a name.');
    const mode = MODES.includes(body.mode as never) ? (body.mode as Game['mode']) : bad('Pick a mode.');
    const startsAt = Number(body.startsAt);
    if (!Number.isFinite(startsAt)) {
      bad('Say when the game starts.');
    }

    // The end is a length of time from the start, or a moment pinned to the clock. A draft
    // carries a length by default, so the two move together while the date is still being argued
    // about in Discord.
    let endOffsetMs: number | null = null;
    let endsAt: number;

    if (body.endsAt !== undefined) {
      endsAt = Number(body.endsAt);
    } else {
      endOffsetMs =
        body.durationMs === undefined ? DEFAULT_DURATION_MS[mode] : Number(body.durationMs);
      if (!Number.isFinite(endOffsetMs) || endOffsetMs <= 0 || endOffsetMs > MAX_DURATION_MS) {
        bad('A game has to run for a positive length of time.');
      }
      endsAt = startsAt + endOffsetMs;
    }

    if (!Number.isFinite(endsAt) || endsAt <= startsAt) {
      bad('The game has to end after it starts.');
    }

    // A control game is decided by a win condition; a classic game is decided by the final score.
    const winCondition =
      mode === 'CONTROL'
        ? WIN_CONDITIONS.includes(body.winCondition as never)
          ? (body.winCondition as Game['winCondition'])
          : bad('A control game needs a win condition.')
        : null;

    // Two teams, because one team competes against nobody in either mode.
    const submitted = Array.isArray(body.teams)
      ? (body.teams as { name?: unknown; colour?: unknown }[])
      : [];

    if (submitted.length < 2) {
      bad('A game needs at least two teams.');
    }

    const teams = submitted.map((team) => ({
      name:
        typeof team.name === 'string' && team.name.trim() !== ''
          ? team.name.trim()
          : bad('Every team needs a name.'),
      colour:
        typeof team.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(team.colour)
          ? team.colour
          : '#888888',
    }));

    const boardRows = Number(body.boardRows) || 5;
    const boardCols = Number(body.boardCols) || 5;
    const tiles = Array.isArray(body.tiles)
      ? (body.tiles as { row: number; col: number; label: string; requirement: TileRequirement }[])
      : [];

    // Every square, exactly once. An empty square is not a smaller board: it is a row, a column
    // and possibly a diagonal that no team can ever complete.
    const squares = new Set(tiles.map((tile) => `${tile.row},${tile.col}`));
    const inBounds = tiles.every(
      (tile) =>
        tile.row >= 0 && tile.row < boardRows && tile.col >= 0 && tile.col < boardCols,
    );

    if (tiles.length !== boardRows * boardCols || squares.size !== tiles.length || !inBounds) {
      bad('Every square on the board needs a tile.');
    }

    const problems: { row: number; col: number; problems: string[] }[] = [];
    for (const tile of tiles) {
      const found = requirementProblems(tile.requirement);
      if (typeof tile.label !== 'string' || tile.label.trim() === '') {
        found.push('It has no label.');
      }
      if (found.length > 0) {
        problems.push({ row: tile.row, col: tile.col, problems: found });
      }
    }

    if (problems.length > 0) {
      return c.json(
        {
          error: 'IMPOSSIBLE_TILES' as const,
          message: 'Some tiles could never be completed.',
          problems,
        },
        400,
      );
    }

    const valueRules = rulesForBoard(tiles);
    const id = `g_${crypto.randomUUID().slice(0, 6)}`;
    const now = Date.now();

    // An organiser may want a code that means something to the clan; otherwise one is invented.
    let joinCode: string;
    if (typeof body.joinCode === 'string' && body.joinCode.trim() !== '') {
      joinCode = body.joinCode.trim().toUpperCase();
      const problem = await checkJoinCode(c.env.DB, joinCode, null);
      if (problem === 'FORMAT') {
        bad('A join code can use letters, digits and dashes, and must be 3 to 32 characters.');
      }
      if (problem === 'TAKEN') {
        bad('Another game is already using that join code.');
      }
    } else {
      joinCode = await uniqueJoinCode(c.env.DB);
    }

    // Backfill defaults differ by mode on purpose: crediting off-plugin play is fine over a
    // week-long classic and an exploit in a live race, which both of the other two are.
    const backfillPolicy = BACKFILL.includes(body.backfillPolicy as never)
      ? (body.backfillPolicy as Game['backfillPolicy'])
      : mode === 'CLASSIC'
        ? 'COUNT'
        : 'IGNORE';

    // The game tracks whatever its board needs, worked out here rather than asked for separately.
    const metrics = [...new Set(tiles.flatMap((tile) => tile.requirement.metrics))];

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO games (id, name, join_code, mode, win_condition, state, starts_at, ends_at,
                              end_offset_ms, board_rows, board_cols, screenshots_requested,
                              backfill_policy, manual_entry_allowed, won_by_team_id, won_at,
                              created_at)
           VALUES (?, ?, ?, ?, ?, 'UPCOMING', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .bind(
          id,
          name,
          joinCode,
          mode,
          winCondition,
          startsAt,
          endsAt,
          endOffsetMs,
          boardRows,
          boardCols,
          body.screenshotsRequested === false ? 0 : 1,
          backfillPolicy,
          body.manualEntryAllowed === false ? 0 : 1,
          now,
        ),
      ...teams.map((team) =>
        c.env.DB
          .prepare('INSERT INTO teams (id, game_id, name, colour) VALUES (?, ?, ?, ?)')
          .bind(`t_${crypto.randomUUID().slice(0, 8)}`, id, team.name, team.colour),
      ),
      ...tiles.map((tile) =>
        c.env.DB
          .prepare(
            `INSERT INTO tiles (id, game_id, row_index, col_index, label, requirement_json, target)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `tile_${crypto.randomUUID().slice(0, 8)}`,
            id,
            tile.row,
            tile.col,
            tile.label.trim(),
            JSON.stringify(tile.requirement),
            tile.requirement.target,
          ),
      ),
      ...metrics.map((metricId) =>
        c.env.DB
          .prepare('INSERT INTO game_metrics (game_id, metric_id, label) VALUES (?, ?, NULL)')
          .bind(id, metricId),
      ),
      ...managedValueStatements(c.env.DB, id, valueRules),
      recordAction(
        c.env.DB,
        id,
        c.get('admin').actor,
        'CREATE_GAME',
        { name, mode, teams: teams.length, tiles: tiles.length },
        now,
      ),
    ]);

    return c.json({ id, joinCode }, 201);
  })

  .get('/games/:gameId', requireGame, async (c) => {
    const game = c.get('game');

    const teams = await c.env.DB.prepare(
      'SELECT id, name, colour FROM teams WHERE game_id = ? ORDER BY id',
    )
      .bind(game.id)
      .all();

    const tiles = await c.env.DB.prepare(
      `SELECT id, row_index, col_index, label, requirement_json
       FROM tiles WHERE game_id = ? ORDER BY row_index, col_index`,
    )
      .bind(game.id)
      .all<{ id: string; row_index: number; col_index: number; label: string; requirement_json: string }>();

    return c.json({
      game,
      setup: await readSetup(c.env.DB, game, Date.now()),
      teams: teams.results,
      trackedMetrics: await listTrackedMetrics(c.env.DB, game.id),
      dropValueRules: await listDropValueRules(c.env.DB, game.id),
      tiles: tiles.results.map((row) => ({
        id: row.id,
        row: row.row_index,
        col: row.col_index,
        label: row.label,
        requirement: JSON.parse(row.requirement_json) as TileRequirement,
      })),
    });
  })

  .patch('/games/:gameId', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));

    const startsAt = body.startsAt === undefined ? game.startsAt : Number(body.startsAt);
    if (!Number.isFinite(startsAt)) {
      bad('That is not a start time.');
    }

    // The end is either a length of time or a fixed moment, and whichever of the two arrives here
    // settles which it is from then on. A relative end follows the start — that is the whole
    // point of it: pushing a game back a day should not be refused for ending before it begins.
    let endOffsetMs = game.endOffsetMs;
    let endsAt = game.endsAt;

    if (body.durationMs !== undefined) {
      endOffsetMs = Number(body.durationMs);
      if (!Number.isFinite(endOffsetMs) || endOffsetMs <= 0 || endOffsetMs > MAX_DURATION_MS) {
        bad('A game has to run for a positive length of time.');
      }
      endsAt = startsAt + endOffsetMs;
    } else if (body.endsAt !== undefined) {
      endOffsetMs = null;
      endsAt = Number(body.endsAt);
    } else if (endOffsetMs !== null) {
      endsAt = startsAt + endOffsetMs;
    }

    if (!Number.isFinite(endsAt) || endsAt <= startsAt) {
      bad('The game has to end after it starts.');
    }

    // Moving the start once it is imminent is worse than not being able to: the plugin schedules
    // exactly one sync at the time it was given, so a change now reaches nobody and everybody
    // arrives at a moment the server no longer thinks is the start.
    if (startsAt !== game.startsAt && Date.now() >= game.startsAt - START_LOCK_MS) {
      bad(
        game.state === 'UPCOMING'
          ? 'The start time is locked — it is less than ten seconds away.'
          : 'This game has already started, so its start time cannot move.',
      );
    }

    const now = Date.now();

    let joinCode = game.joinCode;
    if (typeof body.joinCode === 'string' && body.joinCode.trim() !== '') {
      joinCode = body.joinCode.trim().toUpperCase();
      const problem = await checkJoinCode(c.env.DB, joinCode, game.id);
      if (problem === 'FORMAT') {
        bad('A join code can use letters, digits and dashes, and must be 3 to 32 characters.');
      }
      if (problem === 'TAKEN') {
        bad('Another game is already using that join code.');
      }
    }

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE games SET name = ?, join_code = ?, starts_at = ?, ends_at = ?, end_offset_ms = ?,
                            board_rows = ?, board_cols = ?,
                            screenshots_requested = ?, backfill_policy = ?, win_condition = ?,
                            manual_entry_allowed = ?
           WHERE id = ?`,
        )
        .bind(
          typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : game.name,
          joinCode,
          startsAt,
          endsAt,
          endOffsetMs,
          Number(body.boardRows) || game.boardRows,
          Number(body.boardCols) || game.boardCols,
          body.screenshotsRequested === undefined
            ? (game.screenshotsRequested ? 1 : 0)
            : body.screenshotsRequested === true
              ? 1
              : 0,
          BACKFILL.includes(body.backfillPolicy as never)
            ? (body.backfillPolicy as string)
            : game.backfillPolicy,
          WIN_CONDITIONS.includes(body.winCondition as never)
            ? (body.winCondition as string)
            : game.winCondition,
          body.manualEntryAllowed === undefined
            ? (game.manualEntryAllowed ? 1 : 0)
            : body.manualEntryAllowed === true
              ? 1
              : 0,
          game.id,
        ),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'UPDATE_GAME', body, now),
    ]);

    await rebuild(c.env, game.id);
    return c.json({ ok: true });
  })

  .post('/games/:gameId/join-code', requireGame, async (c) => {
    const game = c.get('game');
    const joinCode = await uniqueJoinCode(c.env.DB);
    const now = Date.now();

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE games SET join_code = ? WHERE id = ?').bind(joinCode, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'NEW_JOIN_CODE', { joinCode }, now),
    ]);

    return c.json({ joinCode });
  })

  /**
   * Start, lock, unlock or end.
   *
   * Ending writes the final board to D1, because the live object is evicted once a game is over
   * and a finished event still has to render.
   */
  .post('/games/:gameId/state', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ state?: unknown }>().catch(() => bad('Expected JSON.'));
    const next = body.state;
    const now = Date.now();

    if (next !== 'LIVE' && next !== 'LOCKED' && next !== 'ENDED' && next !== 'UPCOMING') {
      bad('That is not a state a game can be in.');
    }

    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare('UPDATE games SET state = ? WHERE id = ?').bind(next, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'SET_STATE', { state: next }, now),
    ];

    if (next === 'ENDED') {
      const board = await buildBoardState(c.env.DB, { ...game, state: 'ENDED' }, await loadTiles(c.env.DB, game.id));
      statements.push(
        c.env.DB
          .prepare(
            `INSERT INTO board_snapshots (game_id, snapshot_json, created_at) VALUES (?, ?, ?)
             ON CONFLICT(game_id) DO UPDATE SET snapshot_json = excluded.snapshot_json,
                                                created_at = excluded.created_at`,
          )
          .bind(game.id, JSON.stringify(board), now),
      );
    }

    await c.env.DB.batch(statements);
    await reloadRoom(c.env, game.id);

    return c.json({ ok: true, state: next });
  })

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  .post('/games/:gameId/teams', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));

    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : bad('Name the team.');
    const colour = typeof body.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.colour)
      ? body.colour
      : bad('Pick a colour.');

    const id = `t_${crypto.randomUUID().slice(0, 8)}`;

    await c.env.DB.prepare(
      'INSERT INTO teams (id, game_id, name, colour) VALUES (?, ?, ?, ?)',
    )
      .bind(id, game.id, name, colour)
      .run();

    await reloadRoom(c.env, game.id);
    return c.json({ id, name, colour }, 201);
  })

  .patch('/games/:gameId/teams/:teamId', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));

    await c.env.DB.prepare(
      'UPDATE teams SET name = COALESCE(?, name), colour = COALESCE(?, colour) WHERE id = ? AND game_id = ?',
    )
      .bind(
        typeof body.name === 'string' ? body.name.trim() : null,
        typeof body.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.colour) ? body.colour : null,
        c.req.param('teamId'),
        game.id,
      )
      .run();

    await reloadRoom(c.env, game.id);
    return c.json({ ok: true });
  })

  /**
   * Deletes a team.
   *
   * Anyone on it is returned to no team rather than removed from the game, and their events stay
   * in the log — team membership is read at scoring time, so those contributions simply stop
   * landing anywhere until an admin places them again. The replay afterwards rebuilds the board
   * without the deleted team on it.
   */
  .delete('/games/:gameId/teams/:teamId', requireGame, async (c) => {
    const game = c.get('game');
    const teamId = c.req.param('teamId');
    const now = Date.now();

    const team = await c.env.DB.prepare('SELECT name FROM teams WHERE id = ? AND game_id = ?')
      .bind(teamId, game.id)
      .first<{ name: string }>();

    if (team === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No such team.');
    }

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE players SET team_id = NULL WHERE game_id = ? AND team_id = ?').bind(game.id, teamId),
      c.env.DB.prepare('DELETE FROM tile_progress WHERE game_id = ? AND team_id = ?').bind(game.id, teamId),
      c.env.DB.prepare('UPDATE tile_ownership SET owner_team_id = NULL, contested = 0 WHERE game_id = ? AND owner_team_id = ?').bind(game.id, teamId),
      c.env.DB.prepare('DELETE FROM teams WHERE id = ? AND game_id = ?').bind(teamId, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'DELETE_TEAM', { teamId, name: team.name }, now),
    ]);

    await rebuild(c.env, game.id);
    return c.json({ ok: true });
  })

  // ---------------------------------------------------------------------------
  // The board
  // ---------------------------------------------------------------------------

  /**
   * Replaces the board.
   *
   * Every tile is validated before anything is written: it must not be possible to save a board
   * containing a tile that can never be satisfied, because that is only ever discovered by a
   * player grinding at it for a day.
   */
  .put('/games/:gameId/tiles', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ tiles?: unknown }>().catch(() => bad('Expected JSON.'));

    if (!Array.isArray(body.tiles)) {
      bad('Expected a list of tiles.');
    }

    const tiles = body.tiles as {
      row: number;
      col: number;
      label: string;
      requirement: TileRequirement;
    }[];

    const problems: { row: number; col: number; problems: string[] }[] = [];
    for (const tile of tiles) {
      const found = requirementProblems(tile.requirement);
      if (found.length > 0) {
        problems.push({ row: tile.row, col: tile.col, problems: found });
      }
    }

    if (problems.length > 0) {
      return c.json(
        { error: 'IMPOSSIBLE_TILES' as const, message: 'Some tiles could never be completed.', problems },
        400,
      );
    }

    const now = Date.now();

    // The game tracks whatever the board needs, worked out here rather than asked for separately.
    // An organiser building a board should not also have to maintain a parallel list, and the two
    // drifting apart is silent: the plugin simply never reports the metric.
    const before = (await listTrackedMetrics(c.env.DB, game.id)).map((entry) => entry.metricId);
    const after = [...new Set(tiles.flatMap((tile) => tile.requirement.metrics))];
    const added = after.filter((metric) => !before.includes(metric));
    const removed = before.filter((metric) => !after.includes(metric));
    const valueRules = rulesForBoard(tiles);
    const previousValueRules = (await listDropValueRules(c.env.DB, game.id)).filter((rule) => isManagedValueMetric(rule.metricId));
    for (const rule of valueRules) {
      const previous = previousValueRules.find((candidate) => candidate.metricId === rule.metricId);
      if (previous && (previous.minValue !== rule.minValue || previous.maxValue !== rule.maxValue || previous.valuation !== rule.valuation)) bad('Changing a value filter requires a new tracking rule. Edit the filter in the board editor before saving.');
    }

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM tiles WHERE game_id = ?').bind(game.id),
      ...tiles.map((tile) =>
        c.env.DB
          .prepare(
            `INSERT INTO tiles (id, game_id, row_index, col_index, label, requirement_json, target)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            `tile_${crypto.randomUUID().slice(0, 8)}`,
            game.id,
            tile.row,
            tile.col,
            tile.label,
            JSON.stringify(tile.requirement),
            tile.requirement.target,
          ),
      ),
      c.env.DB.prepare('DELETE FROM game_metrics WHERE game_id = ?').bind(game.id),
      ...after.map((metricId) =>
        c.env.DB
          .prepare('INSERT INTO game_metrics (game_id, metric_id, label) VALUES (?, ?, NULL)')
          .bind(game.id, metricId),
      ),
      ...managedValueStatements(c.env.DB, game.id, valueRules),
      // A new value filter gets a new metric too. Players need to sync for additions;
      // removed metrics are rejected immediately without stranding anybody.
      c.env.DB
        .prepare('UPDATE games SET metrics_changed_at = ? WHERE id = ?')
        .bind(added.length > 0 ? now : game.metricsChangedAt, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'EDIT_BOARD', { tiles: tiles.length, added, removed }, now),
    ]);

    // Tile ids changed, so tile_progress went with them. Replay puts it back.
    await rebuild(c.env, game.id);

    return c.json({ ok: true, tiles: tiles.length, added, removed });
  })

  /**
   * Sets what the game tracks.
   *
   * Editing this on a live game is the one board change with a real consequence: the plugin does
   * not poll, so a metric *added* now is observed by nobody until they next sync. The timestamp
   * recorded here is what lets the roster name exactly who has not.
   */
  .put('/games/:gameId/metrics', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ metrics?: unknown }>().catch(() => bad('Expected JSON.'));

    if (!Array.isArray(body.metrics)) {
      bad('Expected a list of metrics.');
    }

    const metrics = body.metrics as { metricId: string; label?: string | null }[];

    for (const entry of metrics) {
      if (!isValidTrackedEntry(entry.metricId)) {
        bad(`"${entry.metricId}" is not something the plugin can report.`);
      }
    }

    const before = (await listTrackedMetrics(c.env.DB, game.id)).map((entry) => entry.metricId);
    const after = metrics.map((entry) => entry.metricId);
    const added = after.filter((metric) => !before.includes(metric));
    const now = Date.now();

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM game_metrics WHERE game_id = ?').bind(game.id),
      ...metrics.map((entry) =>
        c.env.DB
          .prepare('INSERT INTO game_metrics (game_id, metric_id, label) VALUES (?, ?, ?)')
          .bind(game.id, entry.metricId, entry.label ?? null),
      ),
      // Only an addition strands anybody: a removed metric is rejected per-event with NOT_TRACKED,
      // which is harmless and immediate.
      c.env.DB
        .prepare('UPDATE games SET metrics_changed_at = ? WHERE id = ?')
        .bind(added.length > 0 ? now : game.metricsChangedAt, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'EDIT_METRICS', { added, removed: before.filter((m) => !after.includes(m)) }, now),
    ]);

    return c.json({ ok: true, added });
  })

  /**
   * What the requirement builder can offer.
   *
   * Tracked metrics, plus everything this game has actually seen, plus the two wildcards. It
   * cannot enumerate all of OSRS and does not try: the plugin's alias map is versioned with the
   * plugin and the contract is explicit that the server must not reproduce it.
   */
  .get('/games/:gameId/metric-catalogue', requireGame, async (c) => {
    const game = c.get('game');

    const observed = await c.env.DB.prepare(
      `SELECT metric_id, metric_type, COUNT(*) AS seen
       FROM events WHERE game_id = ? AND metric_type != 'MANUAL'
       GROUP BY metric_id ORDER BY seen DESC`,
    )
      .bind(game.id)
      .all<{ metric_id: string; metric_type: string; seen: number }>();

    return c.json({
      tracked: await listTrackedMetrics(c.env.DB, game.id),
      observed: observed.results,
      wildcards: ['collection_log.*', 'drop.*'],
    });
  })

  /**
   * Replaces this game's value rules.
   *
   * "Any drop worth a million" cannot be written as a metric ID, because an ID comes from an
   * item's name and says nothing about what it is worth. A rule names the metric to emit and the
   * band that earns it, and the plugin does the pricing.
   */
  .put('/games/:gameId/drop-value-rules', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ rules?: unknown }>().catch(() => bad('Expected JSON.'));

    if (!Array.isArray(body.rules)) {
      bad('Expected a list of rules.');
    }

    const rules = body.rules as {
      metricId: string;
      label?: string | null;
      minValue?: number | null;
      maxValue?: number | null;
      valuation?: string | null;
      counts?: string | null;
    }[];

    for (const rule of rules) {
      if (typeof rule.metricId !== 'string' || !/^drop\.[a-z0-9_]+$/.test(rule.metricId) || isManagedValueMetric(rule.metricId)) {
        bad(`"${String(rule.metricId)}" is not usable as a rule metric — it must be an exact id under drop.`);
      }
      // A rule that could never fire looks exactly like a player not getting the drop.
      if (
        typeof rule.minValue === 'number' &&
        typeof rule.maxValue === 'number' &&
        rule.minValue > rule.maxValue
      ) {
        bad(`${rule.metricId} has a minimum above its maximum, so it could never fire.`);
      }
    }

    const now = Date.now();

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM drop_value_rules WHERE game_id = ?').bind(game.id),
      ...[...rules, ...rulesForBoard(await loadTiles(c.env.DB, game.id))].map((rule) =>
        c.env.DB
          .prepare(
            `INSERT INTO drop_value_rules (game_id, metric_id, label, min_value, max_value, valuation, counts)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            game.id,
            rule.metricId,
            rule.label ?? null,
            rule.minValue ?? null,
            rule.maxValue ?? null,
            rule.valuation ?? null,
            rule.counts ?? null,
          ),
      ),
      c.env.DB.prepare('UPDATE games SET metrics_changed_at = ? WHERE id = ?').bind(now, game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'EDIT_VALUE_RULES', { rules: rules.length }, now),
    ]);

    await rebuild(c.env, game.id);
    return c.json({ ok: true, rules: rules.length });
  })

  // ---------------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------------

  .get('/games/:gameId/roster', requireGame, async (c) => {
    const game = c.get('game');

    return c.json({
      players: await readRosterAdmin(c.env.DB, game.id, game.metricsChangedAt),
      metricsChangedAt: game.metricsChangedAt,
    });
  })

  /**
   * Puts a player on a team, or takes them off one.
   *
   * Their whole history moves with them: team membership is read at scoring time rather than
   * stored per event, so the recompute below is only rebuilding tiles that already reflect it.
   */
  .post('/games/:gameId/players/:playerId/team', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<unknown>().catch(() => bad('Expected JSON.'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      bad('Expected an object.');
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'teamId')) {
      bad('Expected a teamId.');
    }

    const requestedTeamId = (body as { teamId: unknown }).teamId;
    if (requestedTeamId !== null && (typeof requestedTeamId !== 'string' || requestedTeamId.trim() === '')) {
      bad('Choose a team, or use null to remove the player from their team.');
    }

    const teamId = typeof requestedTeamId === 'string' ? requestedTeamId.trim() : null;
    const now = Date.now();

    const previous = await c.env.DB.prepare('SELECT team_id FROM players WHERE id = ? AND game_id = ?')
      .bind(c.req.param('playerId'), game.id)
      .first<{ team_id: string | null }>();

    if (previous === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No such player.');
    }

    if (teamId !== null) {
      const team = await c.env.DB.prepare('SELECT 1 FROM teams WHERE id = ? AND game_id = ?')
        .bind(teamId, game.id)
        .first();
      if (team === null) {
        throw new ApiError(404, 'NOT_FOUND', 'No such team.');
      }
    }

    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE players SET team_id = ? WHERE id = ? AND game_id = ?')
        .bind(teamId, c.req.param('playerId'), game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'ASSIGN_TEAM', { playerId: c.req.param('playerId'), from: previous.team_id, to: teamId }, now),
    ]);

    // Team attribution is derived from the current player row. Replaying through the room both
    // rebuilds the teams affected by this move and serialises it against live event scoring.
    await replayInRoom(c.env, game.id);

    return c.json({ ok: true });
  })

  /**
   * Sets a player's display name by hand.
   *
   * The plugin reads the name once, when a session starts, and the client often does not have it
   * yet at that moment — so a player can arrive with no name and never correct it. The account
   * hash is the identity either way; this is only so the roster and the feed are readable.
   */
  .post('/games/:gameId/players/:playerId/name', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ displayName?: unknown }>().catch(() => bad('Expected JSON.'));
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';

    if (displayName === '') {
      bad('Give the player a name.');
    }

    const now = Date.now();
    const playerId = c.req.param('playerId');

    const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ? AND game_id = ?')
      .bind(playerId, game.id)
      .first();

    if (player === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No such player.');
    }

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE players SET display_name = ? WHERE id = ? AND game_id = ?')
        .bind(displayName, playerId, game.id),
      c.env.DB
        .prepare(
          `INSERT INTO player_names (player_id, display_name, seen_at) VALUES (?, ?, ?)
           ON CONFLICT(player_id, display_name) DO UPDATE SET seen_at = excluded.seen_at`,
        )
        .bind(playerId, displayName, now),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'RENAME_PLAYER', { playerId, displayName }, now),
    ]);

    await reloadRoom(c.env, game.id);
    return c.json({ ok: true });
  })

  /**
   * Removes a player from the game, or puts them back.
   *
   * Removal stops them reporting — the plugin gets a 403 and stops — but deliberately leaves what
   * they already contributed on the board. Erasing a player's whole history automatically is the
   * largest possible version of the thing this server does not do; manual adjustment is the tool
   * for taking progress away, and it leaves a reason behind.
   */
  .post('/games/:gameId/players/:playerId/removal', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<{ removed?: unknown }>().catch(() => bad('Expected JSON.'));
    const now = Date.now();

    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE players SET removed_at = ? WHERE id = ? AND game_id = ?')
        .bind(body.removed === true ? now : null, c.req.param('playerId'), game.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, body.removed === true ? 'REMOVE_PLAYER' : 'RESTORE_PLAYER', { playerId: c.req.param('playerId') }, now),
    ]);

    return c.json({ ok: true });
  })

  // ---------------------------------------------------------------------------
  // Review
  // ---------------------------------------------------------------------------

  .get('/games/:gameId/flags', requireGame, async (c) => {
    const game = c.get('game');
    const includeResolved = c.req.query('resolved') === 'true';

    return c.json(await readFlagQueue(c.env.DB, game.id, includeResolved));
  })

  /**
   * Resolves a flag.
   *
   * A flag never moved a score by itself, so resolving one is where any movement happens — and it
   * happens as an adjustment in the event log, with a reason, exactly like a manual adjustment.
   * Dismissing changes nothing but the queue.
   */
  .post('/games/:gameId/flags/:flagId/resolve', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));
    const resolution = body.resolution;
    const now = Date.now();

    if (resolution !== 'CREDITED' && resolution !== 'DISCREDITED' && resolution !== 'DISMISSED') {
      bad('Resolve it as credited, discredited or dismissed.');
    }

    const flag = await c.env.DB.prepare(
      'SELECT id, player_id, event_id FROM flags WHERE id = ? AND game_id = ?',
    )
      .bind(c.req.param('flagId'), game.id)
      .first<{ id: string; player_id: string; event_id: string | null }>();

    if (flag === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No such flag.');
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (resolution !== 'DISMISSED' && reason === '') {
      bad('Say why. A score that moved without a reason is a score nobody can defend.');
    }

    if (resolution !== 'DISMISSED') {
      const delta = Number(body.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        bad('Say how much to credit or discredit.');
      }

      const metricId =
        typeof body.metricId === 'string' && body.metricId !== ''
          ? body.metricId
          : bad('Say which metric the adjustment is against.');

      await insertAdjustment(
        c.env.DB,
        {
          gameId: game.id,
          playerId: flag.player_id,
          metricId,
          delta: resolution === 'DISCREDITED' ? -Math.abs(delta) : Math.abs(delta),
          reason,
          actor: c.get('admin').actor,
        },
        now,
      );
    }

    await c.env.DB.batch([
      c.env.DB
        .prepare('UPDATE flags SET resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
        .bind(resolution, c.get('admin').actor, now, flag.id),
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'RESOLVE_FLAG', { flagId: flag.id, resolution, reason }, now),
    ]);

    if (resolution !== 'DISMISSED') {
      await rebuild(c.env, game.id);
    }

    return c.json({ ok: true });
  })

  /**
   * Credits or discredits a tile for a team, with a reason that is not optional.
   *
   * This is how anything the MVP metrics cannot observe gets onto a board at all, so it is not a
   * corner of the admin panel — it is a first-class way to score.
   */
  .post('/games/:gameId/adjustments', requireGame, async (c) => {
    const game = c.get('game');
    const body = await c.req.json<Record<string, unknown>>().catch(() => bad('Expected JSON.'));
    const now = Date.now();

    const playerId = typeof body.playerId === 'string' ? body.playerId : bad('Pick a player.');
    const metricId = typeof body.metricId === 'string' && body.metricId !== '' ? body.metricId : bad('Pick a metric.');
    const delta = Number(body.delta);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!Number.isFinite(delta) || delta === 0) {
      bad('An adjustment of nothing is not an adjustment.');
    }
    if (reason === '') {
      bad('Say why. A score that moved without a reason is a score nobody can defend.');
    }

    const player = await c.env.DB.prepare('SELECT id FROM players WHERE id = ? AND game_id = ?')
      .bind(playerId, game.id)
      .first();

    if (player === null) {
      throw new ApiError(404, 'NOT_FOUND', 'No such player.');
    }

    const eventId = await insertAdjustment(
      c.env.DB,
      { gameId: game.id, playerId, metricId, delta, reason, actor: c.get('admin').actor },
      now,
    );

    await rebuild(c.env, game.id);

    return c.json({ ok: true, eventId });
  })

  /** Evidence, browsable by tile, player or team, for settling a dispute. */
  .get('/games/:gameId/screenshots', requireGame, async (c) => {
    const game = c.get('game');
    const teamId = c.req.query('teamId');
    const playerId = c.req.query('playerId');
    const tileId = c.req.query('tileId');

    const clauses: string[] = ['s.game_id = ?'];
    const binds: unknown[] = [game.id];

    if (teamId !== undefined) {
      clauses.push('p.team_id = ?');
      binds.push(teamId);
    }
    if (playerId !== undefined) {
      clauses.push('p.id = ?');
      binds.push(playerId);
    }

    if (tileId !== undefined) {
      const tile = (await loadTiles(c.env.DB, game.id)).find((entry) => entry.id === tileId);
      if (tile === undefined) {
        throw new ApiError(404, 'NOT_FOUND', 'No such tile.');
      }

      const exact = tile.requirement.metrics.filter((metric) => !metric.endsWith('.*'));
      const globs = tile.requirement.metrics.filter((metric) => metric.endsWith('.*'));
      const parts: string[] = [];

      if (exact.length > 0) {
        parts.push(`e.metric_id IN (${exact.map(() => '?').join(', ')})`);
        binds.push(...exact);
      }
      for (const glob of globs) {
        parts.push('e.metric_id GLOB ?');
        binds.push(glob);
      }
      clauses.push(`(${parts.join(' OR ')})`);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT s.event_id, e.metric_id, e.received_at, p.display_name, p.team_id
       FROM event_screenshots s
       JOIN events e ON e.game_id = s.game_id AND e.event_id = s.event_id
       JOIN players p ON p.id = e.player_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY e.received_at DESC
       LIMIT 200`,
    )
      .bind(...binds)
      .all();

    return c.json(results);
  })

  /** Rebuilds every derived number from the event log. The dispute-settling button. */
  .post('/games/:gameId/replay', requireGame, async (c) => {
    const game = c.get('game');
    const result = await replayInRoom(c.env, game.id);

    await c.env.DB.batch([
      recordAction(c.env.DB, game.id, c.get('admin').actor, 'REPLAY', { ...result }, Date.now()),
    ]);

    return c.json(result);
  })

  .get('/games/:gameId/actions', requireGame, async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id, actor, action, detail_json, created_at FROM admin_actions WHERE game_id = ? ORDER BY created_at DESC LIMIT 100',
    )
      .bind(c.get('game').id)
      .all<{ id: string; actor: string; action: string; detail_json: string; created_at: number }>();

    return c.json(
      results.map((row) => ({
        id: row.id,
        actor: row.actor,
        action: row.action,
        detail: JSON.parse(row.detail_json) as Record<string, unknown>,
        at: row.created_at,
      })),
    );
  });
