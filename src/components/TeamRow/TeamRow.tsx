import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import apiDeleteTeam from '../../apis/admin/apiDeleteTeam';
import apiUpdateTeam from '../../apis/admin/apiUpdateTeam';
import ErrorMessage from '../../error/ErrorMessage';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import TeamNameInput from '../TeamNameInput/TeamNameInput';

const TeamRow = ({
  gameId,
  team,
  onChanged,
}: {
  gameId: string;
  team: { id: string; name: string; colour: string };
  onChanged: () => void;
}) => {
  const [name, setName] = useState(team.name);
  const [colour, setColour] = useState(team.colour);
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiUpdateTeam(gameId, team.id, { name: name.trim(), colour }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => apiDeleteTeam(gameId, team.id),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
  });

  const dirty = name.trim() !== team.name || colour !== team.colour;

  useUnsavedChanges(dirty);

  return (
    <li className='team-editor-row'>
      <TeamNameInput
        name={name}
        colour={colour}
        onNameChange={setName}
        onColourChange={setColour}
      />
      <Button
        disabled={!dirty || save.isPending || name.trim() === ''}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button
        tone='danger'
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>

      {save.isError && <ErrorMessage error={save.error} />}
      {confirming ? (
        <Confirm
          title={`Delete ${team.name}?`}
          body={
            <div className='space-y-2'>
              <p>
                Anyone on this team goes back to having no team. They stay in
                the game, and nothing they reported is deleted.
              </p>
              <p className='text-xs text-parchment-dim'>
                Their contributions stop counting towards anything until you put
                them on another team, at which point their whole history follows
                them.
              </p>
            </div>
          }
          confirmLabel='Delete the team'
          pending={remove.isPending}
          error={remove.error?.message}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </li>
  );
};

export default TeamRow;
