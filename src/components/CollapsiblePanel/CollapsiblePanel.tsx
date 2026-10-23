import { useEffect, useId, useState, type ReactNode } from 'react';

const CollapsiblePanel = ({
  title,
  icon,
  children,
  defaultOpen = true,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  // A new game phase changes the default priority; ordinary score updates keep the user's choice.
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return (
    <section className={`panel collapsible-panel ${className}`}>
      <h2 className='collapsible-heading'>
        <button
          type='button'
          className='panel-heading collapsible-toggle'
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
        >
          <span className='panel-title'>
            {icon}
            {title}
          </span>
          <span
            className='collapsible-arrow'
            aria-hidden='true'
          >
            {open ? '▾' : '▸'}
          </span>
        </button>
      </h2>
      <div
        id={contentId}
        className='collapsible-content'
        hidden={!open}
      >
        {children}
      </div>
    </section>
  );
};

export default CollapsiblePanel;
