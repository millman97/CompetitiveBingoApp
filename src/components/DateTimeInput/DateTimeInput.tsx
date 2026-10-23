import { useContext } from 'react';
import { CONTROL } from '../../utils/controlStyles';
import { formatLocal } from '../../utils/gameTime';
import { FieldContext } from '../Field/FieldContext';

/**
 * A date and time, in the organiser's own timezone.
 *
 * A bare `datetime-local` stretched across a panel reads as a text box, and Chrome only opens the
 * calendar when you hit the small icon at the far end of it. Clicking anywhere here opens the
 * picker, and the resolved time is spelled out beside it so there is never a question about which
 * zone was meant.
 */
const DateTimeInput = ({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) => {
  const label = useContext(FieldContext);
  const open = (event: React.MouseEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    try {
      input.showPicker();
    } catch {
      // Not every browser allows it, and the field still types normally without it.
    }
  };

  const readable = value === '' ? null : formatLocal(new Date(value).getTime());

  return (
    <div className='flex flex-col gap-1'>
      <input
        type='datetime-local'
        aria-label={label}
        value={value}
        disabled={disabled}
        onClick={open}
        onChange={(event) => onChange(event.target.value)}
        className={`${CONTROL} w-fit cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
      />
      {readable === null ? null : (
        <span className='text-[11px] text-parchment-dim'>
          {readable} · your local time
        </span>
      )}
    </div>
  );
};

export default DateTimeInput;
