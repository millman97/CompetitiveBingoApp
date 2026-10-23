import { useSyncExternalStore } from 'react';

import type { Draft } from '../model/domain/GameDraft/GameDraft';
import {
  DRAFT_STORAGE_KEY,
  readDraft,
  writeDraft,
} from '../utils/gameDraftStorage';

interface DraftState {
  draft: Draft | null;
  storageError: string | null;
}

const load = (): DraftState => {
  try {
    return {
      draft: readDraft(localStorage.getItem(DRAFT_STORAGE_KEY)),
      storageError: null,
    };
  } catch {
    return {
      draft: null,
      storageError:
        'A saved draft could not be restored. Browser storage may be unavailable or the saved data may be invalid.',
    };
  }
};

let state = load();
const listeners = new Set<() => void>();

const setDraft = (
  update: Draft | null | ((current: Draft | null) => Draft | null)
) => {
  const draft = typeof update === 'function' ? update(state.draft) : update;
  let storageError: string | null = null;
  try {
    if (draft === null) localStorage.removeItem(DRAFT_STORAGE_KEY);
    else localStorage.setItem(DRAFT_STORAGE_KEY, writeDraft(draft));
  } catch {
    storageError =
      'This browser cannot save your draft. Keep this page open and export the board as a backup before leaving.';
  }
  state = { draft, storageError };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const useGameDraftStore = () => ({
  ...useSyncExternalStore(subscribe, () => state),
  setDraft,
  clearDraft: () => setDraft(null),
});

export default useGameDraftStore;
