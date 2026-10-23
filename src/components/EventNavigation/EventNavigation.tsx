import { GAME_TABS, gamePath, type GameTab } from '../../routing/routes';

const GROUPS: { label: string; sections: GameTab[] }[] = [
  { label: 'Event', sections: ['overview', 'board', 'roster', 'settings'] },
  { label: 'Review', sections: ['flags', 'evidence', 'adjust', 'log'] },
];

const EventNavigation = ({ gameId, tab }: { gameId: string; tab: GameTab }) => (
  <nav
    className='event-navigation panel'
    aria-label='Manage event'
  >
    {GROUPS.map((group) => (
      <div
        className='event-navigation-group'
        key={group.label}
      >
        <p className='navigation-label'>{group.label}</p>
        {group.sections.map((section) => {
          const entry = GAME_TABS.find((item) => item.id === section)!;
          return (
            <a
              key={section}
              href={gamePath(gameId, section)}
              aria-current={tab === section ? 'page' : undefined}
            >
              <span
                className='navigation-marker'
                aria-hidden='true'
              >
                ›
              </span>
              {entry.label}
            </a>
          );
        })}
      </div>
    ))}
  </nav>
);

export default EventNavigation;
