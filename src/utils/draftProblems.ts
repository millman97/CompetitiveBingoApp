import type { Draft } from '../model/domain/GameDraft/GameDraft';
import { requirementProblems } from '../worker/scoring/tiles';
import { managedValueRules } from '../worker/scoring/value-tiles';

export type SetupStep = 'game' | 'teams' | 'board' | 'review';
export interface DraftProblem {
  step: SetupStep;
  message: string;
}

export const draftProblems = (draft: Draft): DraftProblem[] => {
  const problems: DraftProblem[] = [];
  if (!draft.name.trim())
    problems.push({ step: 'game', message: 'Give the event a name.' });
  if (
    !Number.isFinite(draft.startsAt) ||
    !Number.isFinite(draft.endsAt) ||
    draft.endsAt <= draft.startsAt
  ) {
    problems.push({
      step: 'game',
      message: 'Choose a valid start and an end after the start.',
    });
  }
  if (draft.teams.length < 2 || draft.teams.some((team) => !team.name.trim())) {
    problems.push({
      step: 'teams',
      message: 'Add at least two teams and name every team.',
    });
  }
  const validSize = [draft.boardRows, draft.boardCols].every(
    (size) => Number.isInteger(size) && size >= 1 && size <= 9
  );
  if (!validSize)
    problems.push({
      step: 'board',
      message: 'Choose between 1 and 9 rows and columns.',
    });
  const tiles = draft.tiles.filter((tile) => tile.label.trim() !== '');
  const cells = new Set(tiles.map((tile) => `${tile.row},${tile.col}`));
  if (
    validSize &&
    (tiles.length !== draft.boardRows * draft.boardCols ||
      cells.size !== tiles.length ||
      tiles.some(
        (tile) =>
          tile.row < 0 ||
          tile.row >= draft.boardRows ||
          tile.col < 0 ||
          tile.col >= draft.boardCols
      ))
  ) {
    problems.push({
      step: 'board',
      message: `Fill every square: ${tiles.length} of ${draft.boardRows * draft.boardCols} tiles have a label.`,
    });
  }
  for (const tile of tiles) {
    const reasons = requirementProblems(tile.requirement);
    if (reasons.length)
      problems.push({
        step: 'board',
        message: `Row ${tile.row + 1}, column ${tile.col + 1}: ${reasons.join(' ')}`,
      });
  }
  if (!tiles.some((tile) => requirementProblems(tile.requirement).length)) {
    try {
      managedValueRules(tiles);
    } catch (error) {
      problems.push({ step: 'board', message: (error as Error).message });
    }
  }
  return problems;
};
