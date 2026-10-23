// The board as the plugin's pop-out draws it — contract section 4.5.
//
// This is a document, not a model. Every string in it is shown verbatim: the plugin composes no
// wording, computes no progress and decides nothing about what any of it means. So all the
// judgement lives here, which is what lets a mode the plugin has never heard of be a different
// arrangement of the same three section kinds.
//
// The endpoint is authenticated, so this knows which team is looking. A player wants to see how
// their own team is doing first, and being able to say that is the main thing this has over the
// public board.

import type { BoardState } from './board-state';

export type CellState = 'COMPLETE' | 'IN_PROGRESS' | 'CONTESTED' | 'LOCKED' | 'EMPTY';

export interface PluginCell {
  row: number;
  col: number;
  title: string;
  lines: string[] | null;
  state: CellState | null;
  accent: string | null;
  tooltip: string | null;
}

export interface PluginSection {
  kind: 'GRID' | 'LIST' | 'TEXT';
  title: string | null;
  rows?: number | null;
  cols?: number | null;
  cells?: PluginCell[] | null;
  body?: string | null;
}

export interface PluginBoard {
  title: string;
  subtitle: string | null;
  capturedAt: number;
  sections: PluginSection[];
}

const WIN_CONDITION_WORDS: Record<string, string> = {
  FIRST_LINE: 'first line wins',
  MOST_AT_DEADLINE: 'most lines at the deadline',
  HYBRID_SUDDEN_DEATH: 'sudden death',
};

const duration = (ms: number): string =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;

/**
 * Builds the document for one viewer.
 *
 * @param viewerTeamId the team the player asking is on, or null if an admin has not placed them
 */
export const toPluginBoard = (
  board: BoardState,
  viewerTeamId: string | null,
  now: number,
): PluginBoard => {
  const teams = new Map(board.teams.map((team) => [team.id, team]));
  const control = board.mode !== 'CLASSIC';

  const subtitle = [
    control ? 'Control' : 'Classic',
    control && board.winCondition !== null ? WIN_CONDITION_WORDS[board.winCondition] : null,
    board.state === 'SUDDEN_DEATH' ? 'sudden death' : null,
  ]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(' · ');

  const cells: PluginCell[] = board.tiles.map((tile) => {
    const mine = tile.progress.find((entry) => entry.teamId === viewerTeamId);
    const owner = tile.ownerTeamId === null ? undefined : teams.get(tile.ownerTeamId);

    const lines: string[] = [];

    // The viewer's own team first — that is the number they came to look at.
    if (mine !== undefined) {
      if (tile.aggregate === 'MIN_DURATION' && mine.bestDurationMs !== null) {
        lines.push(duration(mine.bestDurationMs));
      } else if (tile.aggregate === 'MAX_VALUE') {
        lines.push(`${mine.score.toLocaleString('en-GB')} gp`);
      } else if (tile.target !== null) {
        lines.push(`${mine.score} / ${tile.target}`);
      } else {
        lines.push(String(mine.score));
      }
    }

    if (control) {
      lines.push(tile.contested ? 'Contested' : (owner?.name ?? 'Unclaimed'));
    } else if (mine?.complete === true) {
      lines.push('Done');
    }

    let state: CellState;
    if (tile.contested) {
      state = 'CONTESTED';
    } else if (control) {
      state = owner === undefined ? 'EMPTY' : 'COMPLETE';
    } else if (mine?.complete === true) {
      state = 'COMPLETE';
    } else if ((mine?.score ?? 0) > 0) {
      state = 'IN_PROGRESS';
    } else {
      state = 'EMPTY';
    }

    // A locked or finished board is not something a player can still act on, and saying so is
    // more useful than showing a tile that looks live.
    if (board.state === 'ENDED' || board.state === 'LOCKED') {
      state = state === 'COMPLETE' ? 'COMPLETE' : 'LOCKED';
    }

    return {
      row: tile.row,
      col: tile.col,
      title: tile.label,
      lines: lines.length > 0 ? lines : null,
      state,
      accent: owner?.colour ?? null,
      tooltip:
        tile.progress.length === 0
          ? null
          : tile.progress
              .map((entry) => `${teams.get(entry.teamId)?.name ?? 'team'}: ${entry.score}${tile.aggregate === 'MAX_VALUE' ? ' gp' : ''}`)
              .join(', '),
    };
  });

  const standings: PluginCell[] = board.teams.map((team, index) => {
    const lines = board.lines.filter((line) => line.teamId === team.id).length;
    const held = control
      ? board.tiles.filter((tile) => tile.ownerTeamId === team.id).length
      : board.tiles.filter((tile) =>
          tile.progress.some((entry) => entry.teamId === team.id && entry.complete),
        ).length;

    return {
      row: index,
      col: 0,
      title: team.name,
      lines: [`${lines} lines · ${held} tiles`],
      state: team.id === viewerTeamId ? 'IN_PROGRESS' : null,
      accent: team.colour,
      tooltip: team.id === viewerTeamId ? 'Your team' : null,
    };
  });

  const sections: PluginSection[] = [
    {
      kind: 'GRID',
      title: 'Board',
      rows: board.rows,
      cols: board.cols,
      cells,
    },
    { kind: 'LIST', title: 'Teams', cells: standings },
  ];

  if (board.winner !== null) {
    sections.push({
      kind: 'TEXT',
      title: 'Result',
      body: `${teams.get(board.winner.teamId)?.name ?? 'A team'} won.`,
    });
  } else if (board.state === 'ENDED') {
    sections.push({
      kind: 'TEXT',
      title: 'Result',
      body: 'Finished — no team completed a line.',
    });
  }

  return {
    title: board.name,
    subtitle: subtitle === '' ? null : subtitle,
    capturedAt: now,
    sections,
  };
};
