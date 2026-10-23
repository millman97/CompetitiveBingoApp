import type { GameMode } from '../../model/domain/Game/Game';
import {
  BACKFILL_OPTIONS,
  MODE_HELP,
  WIN_CONDITIONS,
} from '../../model/domain/Game/gameOptions';
import type { Draft } from '../../model/domain/GameDraft/GameDraft';
import { fromLocalInput, toLocalInput } from '../../utils/gameTime';
import DateTimeInput from '../DateTimeInput/DateTimeInput';
import EndPicker from '../EndPicker/EndPicker';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';

const DraftDetails = ({
  draft,
  onChange,
  onStartChange,
}: {
  draft: Draft;
  onChange: (update: Partial<Draft>) => void;
  onStartChange: (startsAt: number) => void;
}) => (
  <Panel title='Event details'>
    <div className='details-grid'>
      <div className='details-column'>
        <Field label='Event name'>
          <Input
            autoFocus
            value={draft.name}
            placeholder='e.g. Autumn Clan Bingo'
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <Field label='Game mode'>
          <Select
            value={draft.mode}
            onChange={(event) =>
              onChange({ mode: event.target.value as GameMode })
            }
          >
            <option value='CONTROL'>
              Control — compete for tile ownership
            </option>
            <option value='RUSH'>Rush — first to finish claims the tile</option>
            <option value='CLASSIC'>
              Classic — each team completes the board
            </option>
          </Select>
        </Field>
        <Note>{MODE_HELP[draft.mode]}</Note>
        {draft.mode === 'CONTROL' && (
          <Field label='Win condition'>
            <Select
              value={draft.winCondition}
              onChange={(event) =>
                onChange({ winCondition: event.target.value })
              }
            >
              {WIN_CONDITIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className='details-column details-divider'>
        <Field label='Starts (your local time)'>
          <DateTimeInput
            value={toLocalInput(draft.startsAt)}
            onChange={(value) => onStartChange(fromLocalInput(value))}
          />
        </Field>
        <Note>
          The event starts automatically at this time after you create it.
        </Note>
        <EndPicker
          startsAt={draft.startsAt}
          endOffsetMs={draft.endOffsetMs}
          endsAt={draft.endsAt}
          onChange={onChange}
        />
      </div>
    </div>
    <details className='advanced-options'>
      <summary>Joining and scoring options</summary>
      <div className='advanced-options-content'>
        <Field label='Custom join code (optional)'>
          <Input
            value={draft.joinCode}
            placeholder='Generated if left blank'
            onChange={(event) =>
              onChange({ joinCode: event.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label='Off-plugin activity'>
          <Select
            value={draft.backfillPolicy}
            onChange={(event) =>
              onChange({ backfillPolicy: event.target.value })
            }
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
        <Field label='Manual submissions'>
          <Select
            value={draft.manualEntryAllowed ? 'yes' : 'no'}
            onChange={(event) =>
              onChange({ manualEntryAllowed: event.target.value === 'yes' })
            }
          >
            <option value='yes'>Allow, with evidence for review</option>
            <option value='no'>Plugin observations only</option>
          </Select>
        </Field>
      </div>
    </details>
  </Panel>
);

export default DraftDetails;
