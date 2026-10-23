import type { ReactNode } from 'react';

const Panel = ({
  title,
  children,
  actions,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => (
  <section className={`panel ${className}`}>
    {title === undefined ? null : (
      <div className='panel-heading'>
        <h2>{title}</h2>
        {actions && <div className='panel-actions'>{actions}</div>}
      </div>
    )}
    <div className='panel-body'>{children}</div>
  </section>
);

export default Panel;
