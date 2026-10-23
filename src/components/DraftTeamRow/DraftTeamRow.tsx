import Button from '../Button/Button';
import TeamNameInput from '../TeamNameInput/TeamNameInput';

/** A team on a game that does not exist yet, so nothing here is a request. */
const DraftTeamRow = ({
  team,
  onChange,
  onRemove,
}: {
  team: { name: string; colour: string };
  onChange: (team: { name: string; colour: string }) => void;
  onRemove: () => void;
}) => (
  <li className='team-editor-row'>
    <TeamNameInput
      name={team.name}
      colour={team.colour}
      onNameChange={(name) => onChange({ ...team, name })}
      onColourChange={(colour) => onChange({ ...team, colour })}
    />
    <Button
      tone='danger'
      onClick={onRemove}
    >
      Remove
    </Button>
  </li>
);

export default DraftTeamRow;
