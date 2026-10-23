import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import apiCreateGame from '../../apis/admin/apiCreateGame';
import { AdminError } from '../../error/errors/AdminError';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import type { BoardShape } from '../../model/domain/Board/Board';
import {
  BACKFILL_OPTIONS,
  WIN_CONDITIONS,
} from '../../model/domain/Game/gameOptions';
import type { Draft } from '../../model/domain/GameDraft/GameDraft';
import { gamePath } from '../../routing/routes';
import { draftProblems, type SetupStep } from '../../utils/draftProblems';
import { asDetail } from '../../utils/gameDraft';
import { formatLocal } from '../../utils/gameTime';
import { nextTeamColour } from '../../utils/teamColour';
import BoardEditor from '../BoardEditor/BoardEditor';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import DraftDetails from '../DraftDetails/DraftDetails';
import DraftSummary from '../DraftSummary/DraftSummary';
import DraftTeamRow from '../DraftTeamRow/DraftTeamRow';
import Field from '../Field/Field';
import TeamNameInput from '../TeamNameInput/TeamNameInput';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Warning from '../Warning/Warning';

interface GameDraftEditorProps {
  draft: Draft;
  setDraft: (update: Draft | ((current: Draft) => Draft)) => void;
  clearDraft: () => void;
  storageError: string | null;
}

const STEPS = [
  { id: 'game', label: 'Event details' },
  { id: 'teams', label: 'Teams' },
  { id: 'board', label: 'Build the board' },
  { id: 'review', label: 'Review & create' },
] as const;

const GameDraftEditor = ({
  draft,
  setDraft,
  clearDraft,
  storageError,
}: GameDraftEditorProps) => {
  const [step, setStep] = useState<SetupStep>(() => {
    const query = new URLSearchParams(window.location.search).get('step');
    return STEPS.find((entry) => entry.id === query)?.id ?? 'game';
  });
  const [discarding, setDiscarding] = useState(false);
  useUnsavedChanges(storageError !== null);
  const go = (next: SetupStep) => {
    setStep(next);
    window.history.replaceState(null, '', '/admin/new?step=' + next);
    window.setTimeout(
      () => document.getElementById('setup-step-heading')?.focus(),
      0
    );
  };
  const [teamName, setTeamName] = useState('');
  const [teamColour, setTeamColour] = useState<string | null>(null);
  const suggestedColour =
    teamColour ?? nextTeamColour(draft.teams.map((team) => team.colour));
  const [tileProblems, setTileProblems] = useState<
    { row: number; col: number; problems: string[] }[]
  >([]);

  const edit = (patchDraft: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patchDraft }));

  /** Moving the start carries a relative end with it, exactly as the server does afterwards. */
  const moveStart = (startsAt: number) =>
    setDraft((current) => ({
      ...current,
      startsAt,
      endsAt:
        current.endOffsetMs === null
          ? current.endsAt
          : startsAt + current.endOffsetMs,
    }));

  const setBoard = (board: BoardShape) =>
    setDraft((current) =>
      current.boardRows === board.rows &&
      current.boardCols === board.cols &&
      current.tiles === board.tiles
        ? current
        : {
            ...current,
            boardRows: board.rows,
            boardCols: board.cols,
            tiles: board.tiles,
          }
    );

  const create = useMutation({
    mutationFn: () => apiCreateGame(draft),
    onSuccess: (created) => {
      setTileProblems([]);
      clearDraft();
      window.location.assign(gamePath(created.id));
    },
    onError: (error) => {
      setTileProblems([]);
      if (
        error instanceof AdminError &&
        typeof error.body === 'object' &&
        error.body !== null
      ) {
        const body = error.body as {
          problems?: { row: number; col: number; problems: string[] }[];
        };
        setTileProblems(body.problems ?? []);
        if (body.problems?.length) go('board');
      }
    },
  });

  const missing = draftProblems(draft);
  const index = STEPS.findIndex((entry) => entry.id === step);

  return (
    <fieldset
      disabled={create.isPending}
      className='min-w-0 space-y-3'
    >
      <a
        href='/admin'
        className='breadcrumb'
      >
        ← Your events
      </a>
      <div className='page-heading'>
        <div>
          <p className='eyebrow'>Event setup</p>
          <h1 className='page-title'>Create a bingo event</h1>
          <p className='page-description'>
            A few details, your teams, then the board. Review everything before
            players join.
          </p>
        </div>
        <p
          role='status'
          className='setup-storage'
        >
          {storageError
            ? 'Draft only kept on this page'
            : 'Draft saved on this device'}
        </p>
      </div>
      {storageError && <Warning>{storageError}</Warning>}
      <nav
        aria-label='Event setup'
        className='setup-steps panel'
      >
        {STEPS.map((entry, position) => (
          <button
            key={entry.id}
            type='button'
            onClick={() => go(entry.id)}
            aria-current={step === entry.id ? 'step' : undefined}
            className='setup-step'
            data-complete={
              entry.id !== 'review' &&
              !missing.some((problem) => problem.step === entry.id)
            }
          >
            <span className='setup-step-number'>
              {entry.id !== 'review' &&
              !missing.some((problem) => problem.step === entry.id)
                ? '✓'
                : position + 1}
            </span>
            <span>
              <strong>{entry.label}</strong>
              <small>
                {entry.id === 'game'
                  ? 'Name, mode & schedule'
                  : entry.id === 'teams'
                    ? 'At least two teams'
                    : entry.id === 'board'
                      ? 'Your event challenges'
                      : 'Ready to share?'}
              </small>
            </span>
          </button>
        ))}
      </nav>
      <div className='setup-layout'>
        <section className='setup-main'>
          <h2
            id='setup-step-heading'
            tabIndex={-1}
            className='setup-section-heading'
          >
            {STEPS[index]?.label}{' '}
            <small>
              Step {index + 1} of {STEPS.length}
            </small>
          </h2>

          {step === 'game' && (
            <DraftDetails
              draft={draft}
              onChange={edit}
              onStartChange={moveStart}
            />
          )}

          {step === 'teams' && (
            <Panel title='Teams'>
              {draft.teams.length === 0 ? (
                <Note>No teams yet. A game needs at least two.</Note>
              ) : (
                <ul className='mb-3 divide-y divide-[var(--color-bark-900)]'>
                  {draft.teams.map((team, index) => (
                    <DraftTeamRow
                      key={index}
                      team={team}
                      onChange={(next) =>
                        edit({
                          teams: draft.teams.map((entry, i) =>
                            i === index ? next : entry
                          ),
                        })
                      }
                      onRemove={() =>
                        edit({
                          teams: draft.teams.filter((_, i) => i !== index),
                        })
                      }
                    />
                  ))}
                </ul>
              )}

              <div className='team-add-row'>
                <div className='team-add-name'>
                  <Field label='New team'>
                    <TeamNameInput
                      label='New team'
                      name={teamName}
                      colour={suggestedColour}
                      onNameChange={setTeamName}
                      onColourChange={setTeamColour}
                    />
                  </Field>
                </div>
                <Button
                  disabled={teamName.trim() === ''}
                  onClick={() => {
                    edit({
                      teams: [
                        ...draft.teams,
                        {
                          name: teamName.trim(),
                          colour: suggestedColour,
                        },
                      ],
                    });
                    setTeamName('');
                    setTeamColour(null);
                  }}
                >
                  Add team
                </Button>
              </div>
            </Panel>
          )}

          {step === 'board' && (
            <BoardEditor
              gameId={null}
              detail={asDetail(draft)}
              onSaved={() => undefined}
              onChange={setBoard}
              problems={tileProblems}
            />
          )}

          {step === 'review' && (
            <Panel title='Review your event'>
              <dl className='mb-4 grid gap-3 text-sm sm:grid-cols-2'>
                <div>
                  <dt className='text-parchment-dim'>Win condition</dt>
                  <dd>
                    {draft.mode === 'CONTROL'
                      ? WIN_CONDITIONS.find(
                          (option) => option.value === draft.winCondition
                        )?.label
                      : draft.mode === 'RUSH'
                        ? 'First line wins; otherwise most claimed tiles'
                        : 'Completed tiles plus lines'}
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>Event</dt>
                  <dd>
                    {draft.name} · {draft.mode.toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>
                    Schedule (your local time)
                  </dt>
                  <dd>
                    {formatLocal(draft.startsAt)} → {formatLocal(draft.endsAt)}
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>Teams</dt>
                  <dd>
                    {draft.teams.map((team) => team.name).join(', ') ||
                      'None yet'}
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>Board</dt>
                  <dd>
                    {draft.boardRows} × {draft.boardCols} ·{' '}
                    {draft.tiles.filter((tile) => tile.label.trim()).length}{' '}
                    labelled tiles
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>Off-plugin activity</dt>
                  <dd>
                    {
                      BACKFILL_OPTIONS.find(
                        (entry) => entry.value === draft.backfillPolicy
                      )?.label
                    }
                  </dd>
                </div>
                <div>
                  <dt className='text-parchment-dim'>Typed-in events</dt>
                  <dd>
                    {draft.manualEntryAllowed
                      ? 'Allowed, with evidence for review'
                      : 'Disabled'}
                  </dd>
                </div>
              </dl>
              {create.isError && tileProblems.length === 0 ? (
                <Warning>{(create.error as Error).message}</Warning>
              ) : null}

              {missing.length === 0 ? (
                <Note>
                  Your event is ready. Create it to activate the join code and
                  share the public board with your clan.
                </Note>
              ) : (
                <div role='alert'>
                  <p className='mb-2 font-bold'>
                    Finish these before creating the event:
                  </p>
                  <ul className='list-disc space-y-2 pl-5'>
                    {missing.map((problem) => (
                      <li key={problem.message}>
                        <button
                          type='button'
                          onClick={() => go(problem.step)}
                          className='text-left text-gold underline'
                        >
                          {problem.message} →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className='mt-3'>
                <Button
                  tone='primary'
                  disabled={missing.length > 0 || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? 'Creating…' : 'Create game'}
                </Button>
              </div>
            </Panel>
          )}
          <div className='setup-actions'>
            {index > 0 ? (
              <Button onClick={() => go(STEPS[index - 1]!.id)}>← Back</Button>
            ) : (
              <a
                href='/admin'
                className='text-sm underline'
              >
                Save and leave
              </a>
            )}
            {index < STEPS.length - 1 && (
              <Button
                tone='primary'
                onClick={() => go(STEPS[index + 1]!.id)}
              >
                Continue: {STEPS[index + 1]!.label} →
              </Button>
            )}
          </div>
        </section>
        <DraftSummary
          draft={draft}
          onDiscard={() => setDiscarding(true)}
        />
      </div>
      {discarding && (
        <Confirm
          title='Discard this draft?'
          body='This removes the event details, teams and board saved in this browser.'
          confirmLabel='Discard draft'
          onCancel={() => setDiscarding(false)}
          onConfirm={() => {
            clearDraft();
            window.location.assign('/admin');
          }}
        />
      )}
    </fieldset>
  );
};

export default GameDraftEditor;
