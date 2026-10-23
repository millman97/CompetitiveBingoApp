// Creates a game in the local D1 database, for development and for driving the simulator.
//
// Writes a disposable game and team assignments for the plugin simulator.
//
// Usage: npm run seed:local
//        npm run seed:local -- --code SWAMP-TOAD-42 --mode CONTROL

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};

const joinCode = option('code', 'SWAMP-TOAD-42').toUpperCase();
const mode = option('mode', 'CLASSIC');
const gameId = option('id', `g_${Math.random().toString(16).slice(2, 8)}`);

const now = Date.now();
const startsAt = now - 60 * 60 * 1000;
const endsAt = now + 7 * 24 * 60 * 60 * 1000;

const winCondition = mode === 'CONTROL' ? "'MOST_AT_DEADLINE'" : 'NULL';
const backfill = mode === 'CONTROL' ? 'IGNORE' : 'COUNT';

/*
 * The accounts the simulator uses, placed on teams up front.
 *
 * Players need team assignments for their events to contribute to the board.
 */
const demoPlayers = [
  { accountHash: '-4234871239847123', displayName: 'Safespot Ted' },
  { accountHash: '-1818775870234376620', displayName: 'Rangeta Rita' },
  { accountHash: '-777000111222333', displayName: 'Mobile Morgan' },
];

const metrics = ['kc.vorkath', 'kc.zulrah', 'time.chambers_of_xeric', 'drop.*', 'collection_log.*'];

// A small board covering all three aggregate shapes, so a dev server has something to score.
const board = [
  { row: 0, col: 0, label: '3 Vorkath kills', metrics: ['kc.vorkath'], aggregate: 'SUM', target: 3 },
  { row: 0, col: 1, label: '5 Zulrah kills', metrics: ['kc.zulrah'], aggregate: 'SUM', target: 5 },
  { row: 0, col: 2, label: 'Any 2 log slots', metrics: ['collection_log.*'], aggregate: 'UNIQUE', target: 2 },
  { row: 1, col: 0, label: 'Any 3 drops', metrics: ['drop.*'], aggregate: 'SUM', target: 3 },
  { row: 1, col: 1, label: 'Fastest CoX', metrics: ['time.chambers_of_xeric'], aggregate: 'MIN_DURATION', target: null },
  { row: 1, col: 2, label: '10 kills anywhere', metrics: ['kc.vorkath', 'kc.zulrah'], aggregate: 'SUM', target: 10 },
];

const sql = `
DELETE FROM games WHERE join_code = '${joinCode}';
INSERT INTO games (id, name, join_code, mode, win_condition, state, starts_at, ends_at,
                   end_offset_ms, board_rows, board_cols, screenshots_requested, backfill_policy,
                   won_by_team_id, won_at, created_at)
VALUES ('${gameId}', 'Local Test Bingo', '${joinCode}', '${mode}', ${winCondition}, 'LIVE',
        ${startsAt}, ${endsAt}, ${endsAt - startsAt}, 2, 3, 1, '${backfill}', NULL, NULL, ${now});
${metrics
  .map(
    (metric) =>
      `INSERT INTO game_metrics (game_id, metric_id, label) VALUES ('${gameId}', '${metric}', NULL);`,
  )
  .join('\n')}
INSERT INTO teams (id, game_id, name, colour) VALUES ('t_${gameId}_a', '${gameId}', 'The Sharks', '#3b82f6');
INSERT INTO teams (id, game_id, name, colour) VALUES ('t_${gameId}_b', '${gameId}', 'The Manta Rays', '#ef4444');
${demoPlayers
  .map(
    (player, index) =>
      `INSERT INTO players (id, game_id, account_hash, display_name, team_id, removed_at, first_synced_at, last_synced_at) ` +
      `VALUES ('p_${gameId}_${index}', '${gameId}', '${player.accountHash}', '${player.displayName}', ` +
      `'t_${gameId}_${index % 2 === 0 ? 'a' : 'b'}', NULL, ${now}, ${now});`,
  )
  .join('\n')}
${board
  .map(
    (tile, index) =>
      `INSERT INTO tiles (id, game_id, row_index, col_index, label, requirement_json, target) VALUES ` +
      `('tile_${gameId}_${index}', '${gameId}', ${tile.row}, ${tile.col}, '${tile.label}', ` +
      `'${JSON.stringify({ metrics: tile.metrics, aggregate: tile.aggregate, target: tile.target })}', ` +
      `${tile.target === null ? 'NULL' : tile.target});`,
  )
  .join('\n')}
`.trim();

// Written to a file rather than passed as --command: a multi-line statement on a command line
// is fragile everywhere and outright breaks on Windows.
const sqlFile = join(mkdtempSync(join(tmpdir(), 'bingo-seed-')), 'seed.sql');
writeFileSync(sqlFile, sql, 'utf8');

execFileSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'competitive-bingo', '--local', '--file', sqlFile],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

console.log(`\nSeeded game ${gameId}`);
console.log(`Join code:  ${joinCode}`);
console.log(`Mode:       ${mode}`);
console.log(`Board:      ${board.length} tiles`);
console.log(`Players:    ${demoPlayers.length} pre-assigned to teams`);
console.log(`\nStart the server with:  npm run dev`);
console.log(`Then drive it with:     npm run simulate -- http://localhost:8787 ${joinCode}`);
