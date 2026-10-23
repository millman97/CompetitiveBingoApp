import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import apiUpdateGame from '../../apis/admin/apiUpdateGame';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import type { GameDetail } from '../../model/domain/Game/Game';
import Button from '../Button/Button';
import type { EndSpec } from '../EndPicker/EndPicker';
import EndPicker from '../EndPicker/EndPicker';

/** The same control on a game that exists, where changing it is a request. */
const EndTime = ({
  gameId,
  detail,
  onSaved,
}: {
  gameId: string;
  detail: GameDetail;
  onSaved: () => void;
}) => {
  const [spec, setSpec] = useState<EndSpec>({
    endOffsetMs: detail.game.endOffsetMs,
    endsAt: detail.game.endsAt,
  });

  const save = useMutation({
    mutationFn: () =>
      apiUpdateGame(
        gameId,
        spec.endOffsetMs === null
          ? { endsAt: spec.endsAt }
          : { durationMs: spec.endOffsetMs }
      ),
    onSuccess: onSaved,
  });

  const valid =
    Number.isFinite(spec.endsAt) && spec.endsAt > detail.game.startsAt;
  const dirty =
    spec.endOffsetMs !== detail.game.endOffsetMs ||
    spec.endsAt !== detail.game.endsAt;
  useUnsavedChanges(dirty);

  return (
    <>
      <EndPicker
        startsAt={detail.game.startsAt}
        endOffsetMs={spec.endOffsetMs}
        endsAt={spec.endsAt}
        onChange={setSpec}
        action={
          <Button
            disabled={!dirty || !valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      {save.isError ? (
        <p className='text-xs text-error'>{(save.error as Error).message}</p>
      ) : null}
    </>
  );
};

export default EndTime;
