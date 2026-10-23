import type { Draft } from '../../model/domain/GameDraft/GameDraft';
import { formatLocal } from '../../utils/gameTime';
import Panel from '../Panel/Panel';

const DraftSummary = ({
  draft,
  onDiscard,
}: {
  draft: Draft;
  onDiscard: () => void;
}) => {
  const filled = draft.tiles.filter((tile) => tile.label.trim() !== '').length;
  return (
    <aside className='setup-summary'>
      <Panel title='Your event'>
        <dl>
          <div>
            <dt>Name</dt>
            <dd>{draft.name || 'Not named yet'}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>
              {draft.mode === 'CLASSIC'
                ? 'Classic'
                : draft.mode === 'RUSH'
                  ? 'Rush'
                  : 'Control'}
            </dd>
          </div>
          <div>
            <dt>Starts · local time</dt>
            <dd>{formatLocal(draft.startsAt) ?? 'Choose a start time'}</dd>
          </div>
          <div>
            <dt>Teams</dt>
            <dd>{draft.teams.length} of at least 2</dd>
          </div>
          <div>
            <dt>Board</dt>
            <dd>
              {filled} of {draft.boardRows * draft.boardCols} tiles filled
            </dd>
          </div>
        </dl>
        <p className='mt-5 border-t border-[var(--color-bark-500)] pt-4 text-xs text-parchment-dim'>
          Players can join once you review and create the event.
        </p>
        <button
          type='button'
          className='setup-discard'
          onClick={onDiscard}
        >
          Discard this draft
        </button>
      </Panel>
    </aside>
  );
};

export default DraftSummary;
