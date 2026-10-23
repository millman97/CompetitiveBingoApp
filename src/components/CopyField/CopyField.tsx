import { useState } from 'react';

import Button from '../Button/Button';
import Field from '../Field/Field';
import Input from '../Input/Input';

const CopyField = ({ label, value }: { label: string; value: string }) => {
  const [message, setMessage] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage('Copied.');
    } catch {
      setMessage(
        'Copy is unavailable here. Select the text and copy it manually.'
      );
    }
  };

  return (
    <div className='space-y-1'>
      <Field label={label}>
        <div className='copy-control'>
          <Input
            value={value}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            onClick={() => void copy()}
            aria-label={`Copy ${label.toLowerCase()}`}
          >
            Copy
          </Button>
        </div>
      </Field>
      <div className='flex flex-wrap items-center gap-3'>
        <p
          role='status'
          className='copy-feedback'
        >
          {message}
        </p>
      </div>
    </div>
  );
};

export default CopyField;
