import type { TileRequirement } from '../../model/domain/Game/Game';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Select from '../Select/Select';
import { changeValueSettings } from '../../utils/valueTiles';

const ValueTileFields = ({
  requirement,
  onChange,
}: {
  requirement: TileRequirement;
  onChange: (requirement: TileRequirement) => void;
}) => {
  const settings = requirement.dropValue!;
  const update = (patch: Partial<typeof settings>) =>
    onChange(changeValueSettings(requirement, patch));
  return (
    <div className='sm:col-span-2 space-y-3'>
      <div className='grid gap-3 sm:grid-cols-3'>
        <Field label='Minimum stack value (gp)'>
          <Input
            type='number'
            min={0}
            step={1}
            placeholder='No minimum'
            value={settings.minValue ?? ''}
            onChange={(event) =>
              update({
                minValue:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label='Maximum stack value (optional)'>
          <Input
            type='number'
            min={0}
            step={1}
            placeholder='No maximum'
            value={settings.maxValue ?? ''}
            onChange={(event) =>
              update({
                maxValue:
                  event.target.value === '' ? null : Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label='Price source'>
          <Select
            value={settings.valuation}
            onChange={(event) =>
              update({
                valuation: event.target.value as typeof settings.valuation,
              })
            }
          >
            <option value='GRAND_EXCHANGE'>Grand Exchange</option>
            <option value='HIGH_ALCHEMY'>High alchemy</option>
          </Select>
        </Field>
      </div>
      <Note>
        {requirement.aggregate === 'MAX_VALUE'
          ? 'Scores the team’s highest single loot stack in gp.'
          : 'Counts one per qualifying loot stack. The limits apply to the total stack value, including both bounds.'}{' '}
        Prices come from the player’s RuneLite client; a stack needs a recorded
        positive price to count.
      </Note>
    </div>
  );
};

export default ValueTileFields;
