import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const Dialog = ({
  title,
  children,
  onClose,
  pending = false,
  dismissible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  dismissible?: boolean;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement)
        previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      aria-label={title}
      aria-busy={pending}
      className='panel modal-panel max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto p-0 text-parchment'
      onCancel={(event) => {
        event.preventDefault();
        if (!pending && dismissible) onClose();
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          !pending &&
          dismissible &&
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          onClose();
      }}
    >
      <div className='panel-heading flex items-center justify-between gap-3'>
        <h2 className='min-w-0 break-words'>{title}</h2>
        {dismissible && (
          <button
            type='button'
            className='min-h-11 min-w-11 text-lg'
            aria-label='Close dialog'
            onClick={onClose}
            disabled={pending}
          >
            ×
          </button>
        )}
      </div>
      <div className='space-y-4 p-4'>{children}</div>
    </dialog>,
    document.body
  );
};

export default Dialog;
