import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import apiAddTeam from '../../apis/admin/apiAddTeam';
import apiGenerateJoinCode from '../../apis/admin/apiGenerateJoinCode';
import apiSetGameState from '../../apis/admin/apiSetGameState';
import apiUpdateGame from '../../apis/admin/apiUpdateGame';
import ErrorMessage from '../../error/ErrorMessage';
import useNow from '../../hooks/useNow';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import type { GameDetail } from '../../model/domain/Game/Game';
import { BACKFILL_OPTIONS } from '../../model/domain/Game/gameOptions';
import {
  fromLocalInput,
  START_LOCK_MS,
  toLocalInput,
} from '../../utils/gameTime';
import { nextTeamColour } from '../../utils/teamColour';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import DateTimeInput from '../DateTimeInput/DateTimeInput';
import EndTime from '../EndTime/EndTime';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';
import TeamRow from '../TeamRow/TeamRow';

const GameSettings = ({
  gameId,
  detail,
}: {
  gameId: string;
  detail: GameDetail;
}) => {
  const client = useQueryClient();
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ['admin', 'game', gameId] });

  const now = useNow();
  const [confirming, setConfirming] = useState<
    'LIVE' | 'ENDED' | 'CODE' | 'SAVE_CODE' | null
  >(null);
  const [joinCode, setJoinCode] = useState(detail.game.joinCode);
  const [startsAt, setStartsAt] = useState(toLocalInput(detail.game.startsAt));
  const [teamName, setTeamName] = useState('');
  const [teamColour, setTeamColour] = useState(() =>
    nextTeamColour(detail.teams.map((team) => team.colour))
  );

  const setState = useMutation({
    mutationFn: (state: string) => apiSetGameState(gameId, state),
    onSuccess: () => {
      setConfirming(null);
      refresh();
    },
  });

  const newCode = useMutation({
    mutationFn: () => apiGenerateJoinCode(gameId),
    onSuccess: (result) => {
      setConfirming(null);
      setJoinCode(result.joinCode);
      refresh();
    },
  });

  const saveCode = useMutation({
    mutationFn: () => apiUpdateGame(gameId, { joinCode: joinCode.trim() }),
    onSuccess: () => {
      setConfirming(null);
      refresh();
    },
  });

  const saveStart = useMutation({
    mutationFn: () =>
      apiUpdateGame(gameId, { startsAt: fromLocalInput(startsAt) }),
    onSuccess: refresh,
  });

  const addTeam = useMutation({
    mutationFn: (team: { name: string; colour: string }) =>
      apiAddTeam(gameId, team),
    onSuccess: () => {
      setTeamName('');
      setTeamColour(
        nextTeamColour([...detail.teams.map((team) => team.colour), teamColour])
      );
      refresh();
    },
  });

  const savePolicy = useMutation({
    mutationFn: (backfillPolicy: string) =>
      apiUpdateGame(gameId, { backfillPolicy }),
    onSuccess: refresh,
  });

  const saveManualEntry = useMutation({
    mutationFn: (manualEntryAllowed: boolean) =>
      apiUpdateGame(gameId, { manualEntryAllowed }),
    onSuccess: refresh,
  });

  // Mirrors the server: the plugin schedules one sync at the advertised start, so a change inside
  // this window reaches nobody who has already scheduled theirs.
  const startLocked =
    detail.game.state !== 'UPCOMING' ||
    now >= detail.game.startsAt - START_LOCK_MS;

  useUnsavedChanges(
    joinCode !== detail.game.joinCode ||
      startsAt !== toLocalInput(detail.game.startsAt)
  );
  const errors = [
    setState.error,
    newCode.error,
    saveCode.error,
    addTeam.error,
    savePolicy.error,
    saveManualEntry.error,
  ].filter((error): error is Error => error !== null);

  return (
    <div className='space-y-3'>
      {errors.map((error, index) => (
        <ErrorMessage
          key={index}
          error={error}
        />
      ))}
      {(saveCode.isSuccess ||
        savePolicy.isSuccess ||
        saveManualEntry.isSuccess ||
        saveStart.isSuccess ||
        addTeam.isSuccess) && (
        <p
          role='status'
          className='text-success'
        >
          Changes saved.
        </p>
      )}
      <Panel title='Game'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm text-parchment'>{detail.game.state}</span>

          {detail.game.state === 'UPCOMING' ? (
            <Button
              tone='primary'
              onClick={() => setConfirming('LIVE')}
              disabled={setState.isPending}
              title='Start it now, ahead of its scheduled time'
            >
              Start now
            </Button>
          ) : null}
          {detail.game.state === 'LIVE' ? (
            <Button
              onClick={() => setState.mutate('LOCKED')}
              disabled={setState.isPending}
              title='Stops scoring but does not finish the game'
            >
              Pause scoring
            </Button>
          ) : null}
          {detail.game.state === 'LOCKED' ? (
            <Button
              onClick={() => setState.mutate('LIVE')}
              disabled={setState.isPending}
            >
              Resume scoring
            </Button>
          ) : null}
          {detail.game.state !== 'ENDED' ? (
            <Button
              tone='danger'
              onClick={() => setConfirming('ENDED')}
              disabled={setState.isPending}
            >
              End event
            </Button>
          ) : null}
        </div>

        <div className='mt-3 max-w-md space-y-3'>
          <Field label='Starts'>
            <div className='flex items-start gap-2'>
              <DateTimeInput
                value={startsAt}
                onChange={setStartsAt}
                disabled={startLocked}
              />
              <Button
                disabled={
                  startLocked ||
                  saveStart.isPending ||
                  !Number.isFinite(fromLocalInput(startsAt)) ||
                  fromLocalInput(startsAt) === detail.game.startsAt
                }
                onClick={() => saveStart.mutate()}
              >
                {saveStart.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </Field>

          {saveStart.isError ? (
            <p className='text-xs text-error'>
              {(saveStart.error as Error).message}
            </p>
          ) : null}
          <Note>
            {startLocked
              ? 'The start time is fixed now. The plugin schedules one sync at the time it was given, so moving it this close would reach nobody.'
              : 'The game starts by itself at this time. It can be moved until ten seconds beforehand — after that the plugin has already scheduled its sync.'}
          </Note>

          <EndTime
            key={`${detail.game.startsAt}:${detail.game.endsAt}:${detail.game.endOffsetMs}`}
            gameId={gameId}
            detail={detail}
            onSaved={refresh}
          />

          <Field label='Join code'>
            <div className='flex gap-2'>
              <Input
                value={joinCode}
                onChange={(event) =>
                  setJoinCode(event.target.value.toUpperCase())
                }
              />
              <Button
                disabled={
                  saveCode.isPending ||
                  joinCode.trim() === '' ||
                  joinCode === detail.game.joinCode
                }
                onClick={() => setConfirming('SAVE_CODE')}
              >
                {saveCode.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button
                onClick={() => setConfirming('CODE')}
                disabled={newCode.isPending}
                title='Generate a random one'
              >
                New
              </Button>
            </div>
          </Field>

          {saveCode.isError ? (
            <p className='text-xs text-error'>
              {(saveCode.error as Error).message}
            </p>
          ) : null}
          <Note>
            Letters, digits and dashes. Players type this into the plugin, so it
            is read aloud more often than it is copied — changing it stops the
            old one working immediately.
          </Note>

          <Field label='Off-plugin activity'>
            <Select
              value={detail.game.backfillPolicy}
              disabled={savePolicy.isPending}
              onChange={(event) => savePolicy.mutate(event.target.value)}
            >
              {BACKFILL_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Note>
            When a kill count jumps further than the plugin saw, the difference
            happened somewhere it was not watching — mobile, another client, or
            the plugin switched off. Harmless over a week; an exploit in a live
            race.
          </Note>

          <Field label='Typed-in events'>
            <Select
              value={detail.game.manualEntryAllowed ? 'yes' : 'no'}
              disabled={saveManualEntry.isPending}
              onChange={(event) =>
                saveManualEntry.mutate(event.target.value === 'yes')
              }
            >
              <option value='yes'>Players may submit events by hand</option>
              <option value='no'>Only what the plugin observes</option>
            </Select>
          </Field>
          <Note>
            For the things no parser can see: a raid time only shown in an
            interface, a drop from before the game started. Each one arrives
            with a screenshot and lands in the flag queue for you to look at —
            the plugin vouches for the picture and nothing else.
          </Note>
        </div>
      </Panel>

      <Panel title='Teams'>
        {detail.teams.length === 0 ? (
          <Note>No teams yet. A control game needs at least two.</Note>
        ) : (
          <ul className='mb-3 divide-y divide-[var(--color-bark-900)]'>
            {detail.teams.map((team) => (
              <TeamRow
                key={team.id}
                gameId={gameId}
                team={team}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}

        <div className='flex flex-wrap items-end gap-2'>
          <Field label='Name'>
            <Input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
          </Field>
          <Field label='Colour'>
            <Input
              type='color'
              value={teamColour}
              onChange={(event) => setTeamColour(event.target.value)}
            />
          </Field>
          <Button
            disabled={teamName.trim() === '' || addTeam.isPending}
            onClick={() => {
              addTeam.mutate({ name: teamName.trim(), colour: teamColour });
            }}
          >
            Add team
          </Button>
        </div>
      </Panel>
      {confirming && (
        <Confirm
          title={
            confirming === 'LIVE'
              ? 'Start this event now?'
              : confirming === 'ENDED'
                ? 'End this event permanently?'
                : 'Change the join code?'
          }
          body={
            confirming === 'LIVE'
              ? 'Scoring begins immediately, before the scheduled start. Check that your players are assigned and ready first.'
              : confirming === 'ENDED'
                ? 'This finishes the competition and stops further scoring. The event cannot be resumed from the organiser panel.'
                : 'The old join code stops working immediately. Share the replacement with players who still need to sync.'
          }
          confirmLabel={
            confirming === 'LIVE'
              ? 'Start now'
              : confirming === 'ENDED'
                ? 'End event'
                : 'Change code'
          }
          pending={
            setState.isPending || newCode.isPending || saveCode.isPending
          }
          error={
            setState.error?.message ??
            newCode.error?.message ??
            saveCode.error?.message
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (confirming === 'CODE') newCode.mutate();
            else if (confirming === 'SAVE_CODE') saveCode.mutate();
            else setState.mutate(confirming);
          }}
        />
      )}
    </div>
  );
};

export default GameSettings;
