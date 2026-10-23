import { useCallback, useEffect, useRef } from 'react';

import GameDraftEditor from '../../components/GameDraftEditor/GameDraftEditor';
import Loading from '../../components/Loading/Loading';
import type { Draft } from '../../model/domain/GameDraft/GameDraft';
import useGameDraftStore from '../../stores/useGameDraftStore';
import { newDraft } from '../../utils/gameDraft';

const GameSetupScreen = () => {
  const { draft, setDraft, clearDraft, storageError } = useGameDraftStore();
  const initialised = useRef(false);
  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;
    if (!draft) setDraft(newDraft('', 'CONTROL', 'FIRST_LINE'));
  }, [draft, setDraft]);
  const updateDraft = useCallback(
    (update: Draft | ((current: Draft) => Draft)) => {
      setDraft((current) =>
        current === null
          ? null
          : typeof update === 'function'
            ? update(current)
            : update
      );
    },
    [setDraft]
  );

  if (!draft) {
    return <Loading message='Preparing your event…' />;
  }

  return (
    <GameDraftEditor
      draft={draft}
      setDraft={updateDraft}
      clearDraft={clearDraft}
      storageError={storageError}
    />
  );
};

export default GameSetupScreen;
