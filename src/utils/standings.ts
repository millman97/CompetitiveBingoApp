import type { BoardState } from '../model/domain/Board/BoardState';

export const standingsFor = (board: BoardState) =>
  board.teams
    .map((team) => {
      const lines = board.lines.filter(
        (line) => line.teamId === team.id
      ).length;
      const tiles = board.tiles.filter((tile) =>
        board.mode === 'CLASSIC'
          ? tile.progress.some(
              (entry) => entry.teamId === team.id && entry.complete
            )
          : tile.ownerTeamId === team.id
      ).length;
      return { team, lines, tiles };
    })
    .sort((a, b) =>
      board.mode === 'CLASSIC'
        ? b.lines + b.tiles - (a.lines + a.tiles)
        : b.lines - a.lines || b.tiles - a.tiles
    );
