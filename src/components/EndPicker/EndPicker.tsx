import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Unit } from '../../utils/gameTime';
import {
  formatLocal,
  fromLocalInput,
  splitDuration,
  toLocalInput,
  UNITS,
} from '../../utils/gameTime';
import DateTimeInput from '../DateTimeInput/DateTimeInput';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Select from '../Select/Select';

export interface EndSpec {
  /** Null pins the end to a wall-clock time; a number makes it follow the start. */
  endOffsetMs: number | null;
  endsAt: number;
}

/**
 * When the game ends: a length of time from the start, or a moment on the clock.
 *
 * Relative is the default and the one that behaves. An end pinned to Saturday evening refuses
 * every attempt to push the game back a day, because the moment the start crosses it the game
 * would end before it began; a four-hour game moves as a whole.
 */
const EndPicker = ({
  startsAt,
  endOffsetMs,
  endsAt,
  onChange,
  action,
}: EndSpec & {
  startsAt: number;
  onChange: (next: EndSpec) => void;
  /** A save button, for the screens where this is a request rather than an edit. */
  action?: ReactNode;
}) => {
  const initial = splitDuration(
    endOffsetMs ?? Math.max(UNITS.minutes, endsAt - startsAt)
  );

  const [relative, setRelative] = useState(endOffsetMs !== null);
  const [amount, setAmount] = useState(initial.amount);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [pinned, setPinned] = useState(toLocalInput(endsAt));

  const emit = (next: {
    relative: boolean;
    amount: number;
    unit: Unit;
    pinned: string;
  }) =>
    onChange(
      next.relative
        ? {
            endOffsetMs: next.amount * UNITS[next.unit],
            endsAt: startsAt + next.amount * UNITS[next.unit],
          }
        : { endOffsetMs: null, endsAt: fromLocalInput(next.pinned) }
    );

  const current = { relative, amount, unit, pinned };

  return (
    <>
      <Field label='Ends'>
        <div className='flex flex-wrap items-start gap-2'>
          <Select
            value={relative ? 'RELATIVE' : 'ABSOLUTE'}
            aria-label='How the event ends'
            onChange={(event) => {
              const next = event.target.value === 'RELATIVE';
              setRelative(next);
              emit({ ...current, relative: next });
            }}
          >
            <option value='RELATIVE'>After running for</option>
            <option value='ABSOLUTE'>At a fixed time</option>
          </Select>

          {relative ? (
            <div className='flex flex-col gap-1'>
              <div className='flex gap-2'>
                <Input
                  type='number'
                  min={1}
                  value={amount}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setAmount(next);
                    emit({ ...current, amount: next });
                  }}
                  className='w-20'
                  aria-label='How long the game runs for'
                />
                <Select
                  value={unit}
                  aria-label='Duration unit'
                  onChange={(event) => {
                    const next = event.target.value as Unit;
                    setUnit(next);
                    emit({ ...current, unit: next });
                  }}
                >
                  <option value='minutes'>minutes</option>
                  <option value='hours'>hours</option>
                  <option value='days'>days</option>
                </Select>
              </div>
              <span className='text-[11px] text-parchment-dim'>
                {formatLocal(startsAt + amount * UNITS[unit])} · your local time
              </span>
            </div>
          ) : (
            <DateTimeInput
              value={pinned}
              onChange={(value) => {
                setPinned(value);
                emit({ ...current, pinned: value });
              }}
            />
          )}

          {action}
        </div>
      </Field>

      <Note>
        {relative
          ? 'The end follows the start, so moving the game keeps its length.'
          : 'The end stays where it is. Moving the start past it will be refused, so pick a length instead if you are still deciding when to run this.'}
      </Note>
    </>
  );
};

export default EndPicker;
