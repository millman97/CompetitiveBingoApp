import { useId, useMemo, useState } from 'react';
import type { MetricFamily } from '../../model/domain/Metric/metricCatalogue';
import {
  CATALOGUE_FOR,
  FAMILIES,
  familyOf,
  labelFor,
  slugify,
} from '../../model/domain/Metric/metricCatalogue';
import type { Option } from '../../model/domain/Metric/MetricOption';
import {
  VALUE_SCORING_OPTIONS,
  type TileMetricCategory,
  type ValueAggregate,
} from '../../model/domain/Metric/TileMetricCategory';
import { isManagedValueMetric } from '../../worker/scoring/value-tiles';
import Input from '../Input/Input';
import Note from '../Note/Note';

/** What the free-text box is asking for, per family. */
const TYPE_IN: Record<MetricFamily, { placeholder: string; help: string }> = {
  COUNTS: {
    placeholder: 'or type a boss or activity name',
    help: 'The name exactly as the game says it in its count message. A name that does not match is not an error — the tile simply never scores.',
  },
  MONSTERS: {
    placeholder: 'or type any monster name',
    help: 'Use the NPC name RuneLite shows. These are server-observed kills while the plugin is running, not an official cumulative KC, so there is no offline or mobile backfill.',
  },
  SPEED: {
    placeholder: 'or type an activity name',
    help: 'The name exactly as the game says it when it reports the time — for a boss that only says "Fight duration", that is the name in its kill-count message. Not every activity reports a time at all, and one that does not leaves the tile unscoreable.',
  },
  DROPS: {
    placeholder: 'or type an item name',
    help: 'The item name exactly as the game spells it. A name that does not match is not an error — the tile simply never scores.',
  },
  LOG: {
    placeholder: '',
    help: '',
  },
};

const CATEGORIES: { id: TileMetricCategory; label: string }[] = [
  ...FAMILIES,
  { id: 'VALUE', label: 'Drop value' },
];

const MetricPicker = ({
  observed,
  chosen,
  initialCategory,
  valueAggregate,
  onValueAggregate,
  onAdd,
  onRemove,
}: {
  /** Metrics this game has actually seen, which are exact by construction. */
  observed: Option[];
  chosen: string[];
  initialCategory: TileMetricCategory;
  valueAggregate?: ValueAggregate;
  onValueAggregate: (aggregate: ValueAggregate) => void;
  onAdd: (metricId: string) => void;
  onRemove: (metricId: string) => void;
}) => {
  const [family, setFamily] = useState(initialCategory);
  const [filter, setFilter] = useState('');
  const valueChoiceName = useId();

  const prefix = FAMILIES.find((entry) => entry.id === family)?.prefix ?? '';

  /** This family's catalogue, with anything the game has observed promoted to the top. */
  const options = useMemo<Option[]>(() => {
    if (family === 'VALUE') return [];
    const seen = new Set<string>();
    const result: Option[] = [];

    for (const entry of observed) {
      if (
        familyOf(entry.metricId) === family &&
        !isManagedValueMetric(entry.metricId)
      ) {
        seen.add(entry.metricId);
        result.push(entry);
      }
    }

    for (const entry of CATALOGUE_FOR[family]) {
      if (!seen.has(entry.metricId)) {
        result.push(entry);
      }
    }

    return result;
  }, [observed, family]);

  // Not truncated. A list that stops at forty looks like the catalogue ends there, and the whole
  // point of scrolling one is to find the thing you could not name.
  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const available = options.filter(
      (option) => !chosen.includes(option.metricId)
    );

    if (needle === '') {
      return available;
    }

    return available.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.metricId.toLowerCase().includes(needle)
    );
  }, [options, chosen, filter]);

  // Anything the catalogue does not know can still be named, but by name rather than by id: the
  // id is derived the same way the plugin derives it, and shown, so what is being asked for is
  // visible before it is committed to.
  const typed = filter.trim();
  const typedId = typed === '' ? '' : `${prefix}${slugify(typed)}`;
  const canAddTyped =
    family !== 'VALUE' &&
    family !== 'LOG' &&
    typed !== '' &&
    slugify(typed) !== '' &&
    !chosen.includes(typedId) &&
    !isManagedValueMetric(typedId) &&
    !options.some((option) => option.metricId === typedId);

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-1'>
        {valueAggregate ? (
          <span className='text-xs text-parchment'>
            {
              VALUE_SCORING_OPTIONS.find(
                (option) => option.value === valueAggregate
              )?.label
            }
          </span>
        ) : chosen.length === 0 ? (
          <span className='text-xs text-parchment-dim'>
            Nothing picked yet.
          </span>
        ) : (
          chosen.map((metricId) => (
            <button
              key={metricId}
              type='button'
              onClick={() => onRemove(metricId)}
              title={`${metricId} — click to remove`}
              className='bevel rounded-[2px] bg-[var(--color-bark-500)] px-1.5 py-0.5 text-[11px] text-parchment hover:brightness-125'
            >
              {labelFor(metricId)} ✕
            </button>
          ))
        )}
      </div>

      <div className='flex flex-wrap gap-1'>
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type='button'
            aria-pressed={family === entry.id}
            onClick={() => {
              setFamily(entry.id);
              setFilter('');
            }}
            className='bevel rounded-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-wide hover:brightness-125'
            style={{
              background:
                family === entry.id
                  ? 'var(--color-gold-dim)'
                  : 'var(--color-bark-600)',
              color:
                family === entry.id
                  ? 'var(--color-bark-900)'
                  : 'var(--color-parchment)',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {family === 'VALUE' ? (
        <fieldset className='bevel-inset space-y-2 p-2'>
          <legend className='sr-only'>Drop value metric</legend>
          {VALUE_SCORING_OPTIONS.map((option) => (
            <label
              key={option.value}
              className='flex cursor-pointer items-start gap-2 text-sm'
            >
              <input
                type='radio'
                name={valueChoiceName}
                value={option.value}
                checked={valueAggregate === option.value}
                onChange={() => onValueAggregate(option.value)}
                className='mt-1 accent-[var(--color-gold)]'
              />
              <span>
                <span className='block text-parchment'>{option.label}</span>
                <span className='block text-xs text-parchment-dim'>
                  {option.help}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : family === 'LOG' ? (
        <Note>
          How many is the tile&rsquo;s target. Scoring it as “different things”
          counts distinct slots, so a target of 3 asks for three new entries in
          the log — any three.
        </Note>
      ) : (
        <Input
          value={filter}
          placeholder={`Search, ${TYPE_IN[family].placeholder}`}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}

      {family !== 'VALUE' && (
        <div className='scroll-y bevel-inset max-h-44 rounded-[3px] p-1'>
          {matches.length === 0 && !canAddTyped ? (
            <p className='p-1 text-[11px] text-parchment-dim'>
              Nothing matches.
            </p>
          ) : (
            <ul>
              {canAddTyped ? (
                <li>
                  <button
                    type='button'
                    onClick={() => {
                      onAdd(typedId);
                      setFilter('');
                    }}
                    className='w-full rounded-[2px] px-1.5 py-1 text-left text-xs text-gold hover:bg-[var(--color-bark-600)]'
                  >
                    Use “{typed}” — <code>{typedId}</code>
                  </button>
                </li>
              ) : null}

              {matches.map((option) => (
                <li key={option.metricId}>
                  <button
                    type='button'
                    onClick={() => {
                      onAdd(option.metricId);
                      setFilter('');
                    }}
                    className='flex w-full items-baseline justify-between gap-2 rounded-[2px] px-1.5 py-1 text-left text-xs hover:bg-[var(--color-bark-600)]'
                  >
                    <span className='truncate text-parchment'>
                      {option.label}
                    </span>
                    <span className='shrink-0 text-[10px] text-parchment-dim'>
                      {option.group}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {family !== 'VALUE' && canAddTyped ? (
        <Note>{TYPE_IN[family].help}</Note>
      ) : null}
    </div>
  );
};

export default MetricPicker;
