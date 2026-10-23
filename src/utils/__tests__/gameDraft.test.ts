import { describe, expect, it } from 'vitest';

import { draftProblems } from '../draftProblems';
import { newDraft } from '../gameDraft';
import { readDraft, writeDraft } from '../gameDraftStorage';

const readyDraft = () => ({
  ...newDraft('Clan event', 'CONTROL', 'FIRST_LINE'),
  boardRows: 1,
  boardCols: 1,
  teams: [
    { name: 'Blue', colour: '#0000ff' },
    { name: 'Red', colour: '#ff0000' },
  ],
  tiles: [
    {
      id: 'tile',
      row: 0,
      col: 0,
      label: 'Five kills',
      requirement: {
        metrics: ['kc.vorkath'],
        aggregate: 'SUM' as const,
        target: 5,
      },
    },
  ],
});

describe('recoverable game drafts', () => {
  it('round trips an incomplete draft, including an unlabelled tile', () => {
    const draft = readyDraft();
    draft.tiles[0]!.label = '';
    draft.teams = [];
    expect(readDraft(writeDraft(draft))).toEqual(draft);
  });

  it('restores a cleared date without losing the rest of the draft', () => {
    const draft = { ...readyDraft(), startsAt: Number.NaN };
    const restored = readDraft(writeDraft(draft));
    expect(restored?.name).toBe('Clan event');
    expect(restored?.startsAt).toBeNaN();
    expect(draftProblems(restored!)).toContainEqual(
      expect.objectContaining({ step: 'game' })
    );
  });

  it('distinguishes no draft from corrupt or incompatible saved data', () => {
    expect(readDraft(null)).toBeNull();
    expect(() => readDraft('{')).toThrow();
    expect(() =>
      readDraft(JSON.stringify({ version: 2, draft: readyDraft() }))
    ).toThrow();
    expect(() =>
      readDraft(
        JSON.stringify({
          version: 1,
          draft: { ...readyDraft(), tiles: [null] },
        })
      )
    ).toThrow();
  });

  it('accepts a complete event and identifies missing work by setup step', () => {
    expect(draftProblems(readyDraft())).toEqual([]);
    const incomplete = { ...readyDraft(), name: '', teams: [], tiles: [] };
    expect(draftProblems(incomplete).map((problem) => problem.step)).toEqual([
      'game',
      'teams',
      'board',
    ]);
  });

  it('catches impossible rules before submission using the server rules', () => {
    const draft = readyDraft();
    draft.tiles[0]!.requirement = {
      metrics: ['kc.vorkath'],
      aggregate: 'SUM',
      target: 0,
    };
    expect(draftProblems(draft)).toContainEqual(
      expect.objectContaining({
        step: 'board',
        message: expect.stringContaining('target'),
      })
    );
    draft.tiles[0]!.requirement = {
      metrics: ['time.gauntlet'],
      aggregate: 'SUM',
      target: 1,
    };
    expect(draftProblems(draft)).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('fastest-time'),
      })
    );
  });

  it('does not let duplicate or off-board tiles stand in for filled squares', () => {
    const draft = readyDraft();
    draft.boardCols = 2;
    draft.tiles.push({ ...draft.tiles[0]! });
    expect(draftProblems(draft)).toContainEqual(
      expect.objectContaining({ step: 'board' })
    );
    draft.tiles[1]!.col = 2;
    expect(draftProblems(draft)).toContainEqual(
      expect.objectContaining({ step: 'board' })
    );
  });
});
