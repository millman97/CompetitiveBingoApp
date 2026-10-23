import type { ReactNode } from 'react';

const AppHeader = ({
  actions,
  active = 'events',
}: {
  actions?: ReactNode;
  active?: 'events' | 'admin';
}) => (
  <header className='app-header'>
    <a
      className='app-brand'
      href='/'
    >
      <span
        className='bingo-mark'
        aria-hidden='true'
      >
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} />
        ))}
      </span>
      <span>
        <strong>Competitive Bingo</strong>
      </span>
    </a>
    <nav
      className='app-navigation'
      aria-label='Main navigation'
    >
      <a
        href='/'
        aria-current={active === 'events' ? 'page' : undefined}
      >
        Events
      </a>
      <a
        href='/admin'
        aria-current={active === 'admin' ? 'page' : undefined}
      >
        Admin
      </a>
    </nav>
    {actions && <div className='app-header-actions'>{actions}</div>}
  </header>
);

export default AppHeader;
