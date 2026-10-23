import type { ReactNode } from 'react';
import Button from '../Button/Button';
import Dialog from '../Dialog/Dialog';

/** A blocking confirmation. Used where the consequence is not obvious from the button. */
const Confirm = ({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  error,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string;
}) => (
  <Dialog
    title={title}
    onClose={onCancel}
    pending={pending}
  >
    <div className='text-sm text-parchment'>{body}</div>
    {error && (
      <p
        role='alert'
        className='text-error'
      >
        {error}
      </p>
    )}
    <div className='flex justify-end gap-2'>
      <Button
        onClick={onCancel}
        disabled={pending}
      >
        Cancel
      </Button>
      <Button
        tone='danger'
        onClick={onConfirm}
        disabled={pending}
      >
        {pending ? 'Working…' : confirmLabel}
      </Button>
    </div>
  </Dialog>
);

export default Confirm;
