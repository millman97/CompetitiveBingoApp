const LABELS: Record<string, string> = {
  UPCOMING: 'Upcoming',
  LIVE: 'Live',
  SUDDEN_DEATH: 'Sudden death',
  LOCKED: 'Paused',
  ENDED: 'Finished',
};

const StatusBadge = ({ state }: { state: string }) => (
  <span
    className='status-badge'
    data-state={state}
  >
    {LABELS[state] ?? state}
  </span>
);

export default StatusBadge;
