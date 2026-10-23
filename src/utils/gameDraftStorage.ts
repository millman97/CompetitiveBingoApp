import type { Draft } from '../model/domain/GameDraft/GameDraft';
import { isValueAggregate } from '../worker/scoring/value-tiles';

export const DRAFT_STORAGE_KEY = 'competitive-bingo.game-draft.v1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isValueSettings = (value: unknown) =>
  isRecord(value) &&
  [value.minValue, value.maxValue].every(
    (bound) =>
      bound === null || (typeof bound === 'number' && Number.isFinite(bound))
  ) &&
  ['GRAND_EXCHANGE', 'HIGH_ALCHEMY'].includes(String(value.valuation));

export const readDraft = (raw: string | null): Draft | null => {
  if (raw === null) return null;
  const saved: unknown = JSON.parse(raw);
  if (!isRecord(saved) || saved.version !== 1 || !isRecord(saved.draft))
    throw new Error('Unrecognised saved draft.');
  const draft = saved.draft;
  if (
    ['name', 'winCondition', 'joinCode', 'backfillPolicy'].some(
      (key) => typeof draft[key] !== 'string'
    ) ||
    ['startsAt', 'endsAt'].some(
      (key) =>
        draft[key] !== null &&
        (typeof draft[key] !== 'number' || !Number.isFinite(draft[key]))
    ) ||
    ['boardRows', 'boardCols'].some(
      (key) => typeof draft[key] !== 'number' || !Number.isFinite(draft[key])
    ) ||
    !['CLASSIC', 'CONTROL', 'RUSH'].includes(String(draft.mode)) ||
    typeof draft.manualEntryAllowed !== 'boolean' ||
    !(
      draft.endOffsetMs === null ||
      (typeof draft.endOffsetMs === 'number' &&
        Number.isFinite(draft.endOffsetMs))
    ) ||
    !Array.isArray(draft.teams) ||
    !draft.teams.every(
      (team) =>
        isRecord(team) &&
        typeof team.name === 'string' &&
        typeof team.colour === 'string'
    ) ||
    !Array.isArray(draft.tiles) ||
    !draft.tiles.every(
      (tile) =>
        isRecord(tile) &&
        typeof tile.id === 'string' &&
        typeof tile.label === 'string' &&
        Number.isInteger(tile.row) &&
        Number.isInteger(tile.col) &&
        isRecord(tile.requirement) &&
        Array.isArray(tile.requirement.metrics) &&
        tile.requirement.metrics.every(
          (metric) => typeof metric === 'string'
        ) &&
        ['SUM', 'UNIQUE', 'MIN_DURATION', 'COUNT_DROPS', 'MAX_VALUE'].includes(
          String(tile.requirement.aggregate)
        ) &&
        (!isValueAggregate(String(tile.requirement.aggregate)) ||
          isValueSettings(tile.requirement.dropValue)) &&
        (tile.requirement.target === null ||
          (typeof tile.requirement.target === 'number' &&
            Number.isFinite(tile.requirement.target)))
    )
  )
    throw new Error('The saved draft could not be read.');
  return {
    ...draft,
    startsAt: draft.startsAt === null ? Number.NaN : draft.startsAt,
    endsAt: draft.endsAt === null ? Number.NaN : draft.endsAt,
  } as unknown as Draft;
};

export const writeDraft = (draft: Draft) =>
  JSON.stringify({ version: 1, draft });
