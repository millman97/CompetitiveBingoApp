import Input from '../Input/Input';

const TeamNameInput = ({
  name,
  colour,
  onNameChange,
  onColourChange,
  label = 'Team',
}: {
  name: string;
  colour: string;
  onNameChange: (name: string) => void;
  onColourChange: (colour: string) => void;
  label?: string;
}) => (
  <div className='team-name-control'>
    <label className='team-colour-target'>
      <input
        type='color'
        value={colour}
        onChange={(event) => onColourChange(event.target.value)}
        className='team-colour-swatch'
        aria-label={`${label} colour`}
      />
    </label>
    <Input
      value={name}
      onChange={(event) => onNameChange(event.target.value)}
      aria-label={`${label} name`}
    />
  </div>
);

export default TeamNameInput;
