import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import apiSaveDropValueRules from '../../apis/admin/apiSaveDropValueRules';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import type { DropValueRule, GameDetail } from '../../model/domain/Game/Game';
import { metricIdFor } from '../../utils/metricIdFor';
import { isManagedValueMetric } from '../../worker/scoring/value-tiles';
import Button from '../Button/Button';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';
import Warning from '../Warning/Warning';

export interface ValueRulesProps {
  gameId: string;
  detail: GameDetail;
  onSaved: () => void;
}

const blank = (): DropValueRule => ({
  metricId: '',
  label: null,
  minValue: null,
  maxValue: null,
  valuation: 'GRAND_EXCHANGE',
  counts: 'ITEMS',
});

const coins = (value: number | null): string =>
  value === null ? '' : String(value);

/** 1000000 reads as 1m at a glance; an organiser thinks in millions, not digits. */
const short = (value: number): string => {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return String(value);
};

/** The band in words, because "worth any or more" is not a sentence. */
const band = (min: number | null, max: number | null): string => {
  if (min === null && max === null) {
    return 'Fires on any drop the client can price';
  }
  if (max === null) {
    return `Fires on a stack worth ${short(min as number)} or more`;
  }
  if (min === null) {
    return `Fires on a stack worth up to ${short(max)}`;
  }
  return `Fires on a stack worth ${short(min)} to ${short(max)}`;
};

const ValueRules = ({ gameId, detail, onSaved }: ValueRulesProps) => {
  const client = useQueryClient();
  const customRules = detail.dropValueRules.filter(
    (rule) => !isManagedValueMetric(rule.metricId)
  );
  const [rules, setRules] = useState<DropValueRule[]>(customRules);

  const [savedRules, setSavedRules] = useState(() =>
    JSON.stringify(customRules)
  );
  const dirty = JSON.stringify(rules) !== savedRules;
  useUnsavedChanges(dirty);

  const submittedRules = useRef('');
  const save = useMutation({
    onMutate: () => {
      submittedRules.current = JSON.stringify(rules);
    },
    mutationFn: () => apiSaveDropValueRules(gameId, { rules }),
    onSuccess: () => {
      setSavedRules(submittedRules.current);
      void client.invalidateQueries({ queryKey: ['admin', 'game', gameId] });
      onSaved();
    },
  });

  const update = (index: number, patch: Partial<DropValueRule>): void => {
    setRules((current) =>
      current.map((rule, at) => (at === index ? { ...rule, ...patch } : rule))
    );
  };

  const usedOnBoard = new Set(
    detail.tiles.flatMap((tile) => tile.requirement.metrics)
  );
  const orphaned = rules.filter(
    (rule) => rule.metricId !== '' && !usedOnBoard.has(rule.metricId)
  );
  const unnamed = rules.some((rule) => rule.metricId === '');

  return (
    <Panel
      title='Advanced drop-value rules'
      actions={
        <div className='flex gap-2 normal-case'>
          <Button onClick={() => setRules((current) => [...current, blank()])}>
            Add rule
          </Button>
          <Button
            tone='primary'
            onClick={() => save.mutate()}
            disabled={save.isPending || unnamed || !dirty}
            title={unnamed ? 'Every rule needs a name' : undefined}
          >
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      }
    >
      <Note>
        Set up “Drops above a value” and “Most valuable drop” directly in the
        Board editor. Their tracking rules are saved with the tiles. These
        additional rules support custom item-count or cumulative-value goals.
      </Note>

      {save.isSuccess && !dirty && (
        <p
          role='status'
          className='text-success'
        >
          Rules saved.
        </p>
      )}
      {save.isError ? (
        <div className='mt-2'>
          <Warning>{(save.error as Error).message}</Warning>
        </div>
      ) : null}

      {orphaned.length > 0 ? (
        <div className='mt-2'>
          <Warning>
            <p className='font-bold'>Some rules are on no tile.</p>
            <p className='mt-1 text-xs'>
              {orphaned.map((rule) => rule.metricId).join(', ')} will be
              reported and recorded, but nothing on the board scores them.
            </p>
          </Warning>
        </div>
      ) : null}

      {rules.length === 0 ? (
        <p className='mt-3 text-sm text-parchment-dim'>
          No additional custom value rules.
        </p>
      ) : (
        <ul className='mt-3 space-y-3'>
          {rules.map((rule, index) => (
            <li
              key={index}
              className='bevel-inset rounded-[3px] p-2'
            >
              <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                <div className='sm:col-span-2'>
                  <Field label='Call it'>
                    <Input
                      value={rule.label ?? ''}
                      placeholder='Drops worth 1m or more'
                      onChange={(event) => {
                        const label = event.target.value;
                        update(index, {
                          label: label === '' ? null : label,
                          metricId: metricIdFor(label),
                        });
                      }}
                    />
                  </Field>
                  <p className='mt-0.5 text-[11px] text-parchment-dim'>
                    {rule.metricId === '' ? (
                      'Give it a name and a metric id is made from it.'
                    ) : (
                      <>
                        Tiles use{' '}
                        <code className='text-parchment'>{rule.metricId}</code>
                      </>
                    )}
                  </p>
                </div>

                <Field label='Priced by'>
                  <Select
                    value={rule.valuation ?? 'GRAND_EXCHANGE'}
                    onChange={(event) =>
                      update(index, {
                        valuation: event.target
                          .value as DropValueRule['valuation'],
                      })
                    }
                  >
                    <option value='GRAND_EXCHANGE'>Grand Exchange</option>
                    <option value='HIGH_ALCHEMY'>High alchemy</option>
                  </Select>
                </Field>

                <Field label='Worth at least (coins)'>
                  <Input
                    type='number'
                    min={0}
                    value={coins(rule.minValue)}
                    placeholder='no minimum'
                    onChange={(event) =>
                      update(index, {
                        minValue:
                          event.target.value === ''
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>

                <Field label='Worth at most (coins)'>
                  <Input
                    type='number'
                    min={0}
                    value={coins(rule.maxValue)}
                    placeholder='no maximum'
                    onChange={(event) =>
                      update(index, {
                        maxValue:
                          event.target.value === ''
                            ? null
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>

                <Field label='Each match counts'>
                  <Select
                    value={rule.counts ?? 'ITEMS'}
                    onChange={(event) =>
                      update(index, {
                        counts: event.target.value as DropValueRule['counts'],
                      })
                    }
                  >
                    <option value='ITEMS'>the number of items</option>
                    <option value='VALUE'>the coin value of the stack</option>
                  </Select>
                </Field>
              </div>

              <div className='mt-2 flex items-center justify-between gap-2'>
                <span className='text-[11px] text-parchment-dim'>
                  {band(rule.minValue, rule.maxValue)}, counting{' '}
                  {rule.counts === 'VALUE' ? 'its value' : 'its items'}.
                </span>

                <Button
                  tone='danger'
                  onClick={() =>
                    setRules((current) =>
                      current.filter((_, at) => at !== index)
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export default ValueRules;
