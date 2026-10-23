import useBoardEditor from '../../hooks/useBoardEditor';
import type { BoardEditorProps } from '../../model/domain/Board/Board';
import type { Aggregate } from '../../model/domain/Game/Game';
import { labelFor } from '../../model/domain/Metric/metricCatalogue';
import { TILE_SCORING_OPTIONS } from '../../model/domain/Metric/TileMetricCategory';
import { isFilled } from '../../utils/boardEditor';
import {
  addTileMetric,
  categoryForTile,
  scoringForTile,
} from '../../utils/tileEditing';
import Button from '../Button/Button';
import Confirm from '../Confirm/Confirm';
import Field from '../Field/Field';
import Input from '../Input/Input';
import MetricPicker from '../MetricPicker/MetricPicker';
import Note from '../Note/Note';
import Panel from '../Panel/Panel';
import Select from '../Select/Select';
import TextArea from '../TextArea/TextArea';
import TileArtwork from '../TileArtwork/TileArtwork';
import Warning from '../Warning/Warning';
import ValueTileFields from '../ValueTileFields/ValueTileFields';
import { changeTileAggregate, valueFilterLabel } from '../../utils/valueTiles';
import { isValueAggregate } from '../../worker/scoring/value-tiles';

const BoardEditor = ({
  gameId,
  detail,
  onSaved,
  onChange,
  problems: given,
}: BoardEditorProps) => {
  const {
    rows,
    setRows,
    cols,
    setCols,
    tiles,
    setTiles,
    selected,
    setSelected,
    dragging,
    setDragging,
    confirmLiveEdit,
    setConfirmLiveEdit,
    clearing,
    setClearing,
    resizing,
    setResizing,
    importing,
    setImporting,
    moving,
    setMoving,
    dirty,
    resize,
    applyImport,
    transfer,
    setTransfer,
    problems,
    observed,
    at,
    update,
    save,
    attemptSave,
    swap,
    shuffle,
    randomFill,
    exportJson,
    importJson,
    current,
    problemFor,
  } = useBoardEditor({ gameId, detail, onSaved, onChange, problems: given });

  return (
    <div className='space-y-3'>
      {save.isError && problems.length === 0 ? (
        <Warning>{(save.error as Error).message}</Warning>
      ) : null}

      {problems.length > 0 ? (
        <Warning>
          <p className='font-bold'>
            {gameId === null
              ? 'Some tiles could never be completed.'
              : 'Some tiles could never be completed, so nothing was saved.'}
          </p>
          <ul className='mt-1 list-disc pl-5 text-xs'>
            {problems.map((entry) => (
              <li key={`${entry.row},${entry.col}`}>
                Row {entry.row + 1}, column {entry.col + 1}:{' '}
                {entry.problems.join(' ')}
              </li>
            ))}
          </ul>
        </Warning>
      ) : null}

      {save.isSuccess && !dirty && (
        <p
          role='status'
          className='text-success'
        >
          Board saved.
        </p>
      )}
      {gameId !== null && dirty && (
        <p
          role='status'
          className='text-gold'
        >
          You have unsaved board changes.
        </p>
      )}
      <Panel
        title='Board'
        actions={
          <div className='flex flex-wrap items-center gap-2 normal-case'>
            <Button
              onClick={randomFill}
              title='Put a different boss on every empty square, at 5 kills each'
            >
              Fill empty tiles
            </Button>
            <Button
              onClick={shuffle}
              title='Rearrange the tiles at random'
            >
              Shuffle
            </Button>
            <Button
              tone='danger'
              onClick={() => setClearing(true)}
              disabled={tiles.filter(isFilled).length === 0}
              title='Empty every square'
            >
              Clear board
            </Button>
            {gameId === null ? null : (
              <Button
                tone='primary'
                onClick={attemptSave}
                disabled={save.isPending}
              >
                {save.isPending ? 'Saving…' : 'Save board'}
              </Button>
            )}
          </div>
        }
      >
        <div className='mb-3 flex flex-wrap items-end gap-3'>
          <Field label='Rows'>
            <Input
              type='number'
              min={1}
              max={9}
              value={rows}
              disabled={gameId !== null}
              onChange={(event) =>
                resize({ rows: Number(event.target.value), cols })
              }
            />
          </Field>
          <Field label='Columns'>
            <Input
              type='number'
              min={1}
              max={9}
              value={cols}
              disabled={gameId !== null}
              onChange={(event) =>
                resize({ rows, cols: Number(event.target.value) })
              }
            />
          </Field>
          <Note>
            Lines run along rows and columns, and along both diagonals only when
            the board is square. Select a tile and use Move tile to swap it with
            another square. Dragging also works.{' '}
            {gameId !== null ? 'The board size is fixed after creation.' : ''}
          </Note>
        </div>

        <div
          role='region'
          aria-label='Edit bingo board'
          tabIndex={0}
          className='overflow-x-auto pb-2'
        >
          <div
            className='grid gap-1.5'
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              minWidth: cols * 128,
            }}
          >
            {Array.from({ length: rows }).flatMap((_, row) =>
              Array.from({ length: cols }).map((__, col) => {
                const tile = at(row, col);
                const broken = problemFor(row, col);
                const isSelected =
                  selected?.row === row && selected.col === col;

                return (
                  <div
                    key={`${row},${col}`}
                    draggable={isFilled(tile)}
                    onDragStart={() => setDragging({ row, col })}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragging !== null) {
                        swap(dragging, { row, col });
                      }
                      setDragging(null);
                    }}
                  >
                    <button
                      type='button'
                      onClick={() => {
                        if (moving) {
                          swap(moving, { row, col });
                          setMoving(null);
                        } else setSelected({ row, col });
                      }}
                      aria-label={
                        'Row ' +
                        (row + 1) +
                        ', column ' +
                        (col + 1) +
                        ': ' +
                        (tile.label || 'empty') +
                        (moving ? ', move tile here' : '')
                      }
                      aria-pressed={isSelected}
                      className='bevel editor-tile w-full cursor-grab text-left text-sm hover:brightness-125 active:cursor-grabbing'
                      style={{
                        background:
                          broken !== undefined
                            ? 'rgba(143,47,47,0.4)'
                            : isFilled(tile)
                              ? 'var(--color-bark-600)'
                              : 'var(--color-bark-800)',
                        opacity:
                          dragging?.row === row && dragging.col === col
                            ? 0.4
                            : 1,
                      }}
                    >
                      <span className='editor-tile-content'>
                        {isFilled(tile) && (
                          <TileArtwork
                            metrics={tile.requirement.metrics}
                            aggregate={tile.requirement.aggregate}
                            valueBased={tile.requirement.metrics.some(
                              (metric) =>
                                detail.dropValueRules.some(
                                  (rule) => rule.metricId === metric
                                )
                            )}
                          />
                        )}
                        <span className='text-parchment'>
                          {isFilled(tile) ? (
                            tile.label
                          ) : (
                            <span className='text-parchment-dim'>
                              + Add challenge
                            </span>
                          )}
                        </span>
                      </span>
                      {isValueAggregate(tile.requirement.aggregate) ? (
                        <span className='block text-xs text-parchment-dim'>
                          <span className='block'>
                            {tile.requirement.aggregate === 'MAX_VALUE'
                              ? 'Most valuable drop'
                              : `Target: ${tile.requirement.target ?? 1} qualifying ${(tile.requirement.target ?? 1) === 1 ? 'stack' : 'stacks'}`}
                          </span>
                          {tile.requirement.dropValue && (
                            <span className='block'>
                              {valueFilterLabel(tile.requirement.dropValue)} ·{' '}
                              {tile.requirement.dropValue.valuation ===
                              'HIGH_ALCHEMY'
                                ? 'High alchemy'
                                : 'Grand Exchange'}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className='block truncate text-xs text-parchment-dim'>
                          {tile.requirement.metrics.map(labelFor).join(', ')}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Panel>

      {moving && (
        <p
          role='status'
          className='text-gold'
        >
          Choose a destination square to move or swap the tile.{' '}
          <button
            type='button'
            className='underline'
            onClick={() => setMoving(null)}
          >
            Cancel move
          </button>
        </p>
      )}
      {current === null ? null : (
        <Panel
          title={`Tile — row ${current.row + 1}, column ${current.col + 1}`}
        >
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='sm:col-span-2'>
              <Field label='Label'>
                <Input
                  value={current.label}
                  placeholder='e.g. 5 Vorkath kills'
                  onChange={(event) =>
                    update({ ...current, label: event.target.value })
                  }
                />
              </Field>
            </div>

            <div className='sm:col-span-2'>
              <Field label='Metrics'>
                <MetricPicker
                  key={`${current.id}:${current.row},${current.col}`}
                  observed={observed}
                  chosen={current.requirement.metrics}
                  initialCategory={categoryForTile(current.requirement)}
                  valueAggregate={
                    isValueAggregate(current.requirement.aggregate)
                      ? current.requirement.aggregate
                      : undefined
                  }
                  onValueAggregate={(aggregate) =>
                    update(changeTileAggregate(current, aggregate))
                  }
                  onAdd={(metricId) => update(addTileMetric(current, metricId))}
                  onRemove={(metricId) =>
                    update({
                      ...current,
                      requirement: {
                        ...current.requirement,
                        metrics: current.requirement.metrics.filter(
                          (entry) => entry !== metricId
                        ),
                      },
                    })
                  }
                />
              </Field>

              <Note>
                Choosing a metric from another category replaces the current
                selection.
              </Note>
            </div>

            <Field label='How it is scored'>
              <Select
                value={current.requirement.aggregate}
                onChange={(event) => {
                  const aggregate = event.target.value as Aggregate;
                  update(changeTileAggregate(current, aggregate));
                }}
              >
                {TILE_SCORING_OPTIONS.filter((option) =>
                  scoringForTile(current.requirement).includes(option.value)
                ).map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            {current.requirement.aggregate === 'MIN_DURATION' ? (
              <Note>
                The fastest run wins this tile. Ties go to whoever got there
                first.
              </Note>
            ) : current.requirement.aggregate === 'MAX_VALUE' ? (
              <Note>
                {detail.game.mode === 'RUSH'
                  ? 'In Rush, the first qualifying drop claims this tile permanently.'
                  : detail.game.mode === 'CLASSIC'
                    ? 'Each team completes this tile after its first qualifying drop. Its highest stack remains displayed as its record.'
                    : 'The highest single stack value holds this tile. Equal values leave it contested.'}
              </Note>
            ) : (
              <Field
                label={
                  current.requirement.aggregate === 'COUNT_DROPS'
                    ? 'Qualifying drop stacks'
                    : 'Target'
                }
              >
                <Input
                  type='number'
                  min={1}
                  value={current.requirement.target ?? 1}
                  onChange={(event) =>
                    update({
                      ...current,
                      requirement: {
                        ...current.requirement,
                        target: Number(event.target.value),
                      },
                    })
                  }
                />
              </Field>
            )}

            <div className='sm:col-span-2'>
              <Note>
                {
                  TILE_SCORING_OPTIONS.find(
                    (option) => option.value === current.requirement.aggregate
                  )?.help
                }
              </Note>
            </div>

            {isValueAggregate(current.requirement.aggregate) && (
              <ValueTileFields
                requirement={current.requirement}
                onChange={(requirement) => update({ ...current, requirement })}
              />
            )}
          </div>

          <div className='mt-3 flex flex-wrap gap-3'>
            <Button onClick={() => setMoving(selected)}>Move tile</Button>
            <Button
              tone='danger'
              onClick={() => {
                setTiles((all) =>
                  all.filter(
                    (tile) =>
                      !(tile.row === current.row && tile.col === current.col)
                  )
                );
                setSelected(null);
              }}
            >
              Clear tile
            </Button>
          </div>
        </Panel>
      )}

      <Panel title='Import and export'>
        <Note>
          A whole board as JSON — quicker than the menus for setting one up, and
          a way to reuse last event&rsquo;s board. Export writes it here; import
          replaces the grid above, and nothing is written{' '}
          {gameId === null
            ? 'until the game is created'
            : 'until you press Save board'}
          .
        </Note>

        <div className='mt-2 space-y-2'>
          <TextArea
            rows={6}
            value={transfer}
            spellCheck={false}
            placeholder='Paste a board here, or press Export'
            onChange={(event) => setTransfer(event.target.value)}
          />
          <div className='flex gap-2'>
            <Button onClick={exportJson}>Export</Button>
            <Button
              onClick={importJson}
              disabled={transfer.trim() === ''}
            >
              Import
            </Button>
          </div>
        </div>
      </Panel>

      {resizing && (
        <Confirm
          title='Remove tiles outside the new board?'
          body='Making the board smaller removes tiles outside its new edges. The other tiles are kept.'
          confirmLabel='Resize board'
          onCancel={() => setResizing(null)}
          onConfirm={() => {
            setRows(resizing.rows);
            setCols(resizing.cols);
            setTiles((current) =>
              current.filter(
                (tile) => tile.row < resizing.rows && tile.col < resizing.cols
              )
            );
            setSelected(null);
            setResizing(null);
          }}
        />
      )}
      {importing && (
        <Confirm
          title='Replace this board?'
          body='Importing replaces the current tiles. Export the current board first if you want to keep a copy.'
          confirmLabel='Replace board'
          onCancel={() => setImporting(null)}
          onConfirm={() => applyImport(importing)}
        />
      )}
      {clearing ? (
        <Confirm
          title='Clear the board?'
          body={
            <div className='space-y-2'>
              <p>
                Every tile is removed from the grid. Nothing is written{' '}
                {gameId === null
                  ? 'until the game is created'
                  : 'until you press Save board'}
                .
              </p>
              {gameId === null ? null : (
                <p className='text-xs text-parchment-dim'>
                  Scores are not deleted — they are recomputed from the event
                  log against whatever board you save, so putting the tiles back
                  restores them.
                </p>
              )}
            </div>
          }
          confirmLabel='Clear it'
          onConfirm={() => {
            setTiles([]);
            setSelected(null);
            setClearing(false);
          }}
          onCancel={() => setClearing(false)}
        />
      ) : null}

      {confirmLiveEdit === null ? null : (
        <Confirm
          title='Players need to sync after this change'
          body={
            <div className='space-y-2'>
              <p>
                Players must press Sync in RuneLite to use the updated tracking
                and value filters. Changing a value filter starts new tracking
                for that tile; its previous filter’s scores remain in the event
                history.
              </p>
              <p className='text-xs text-parchment-dim'>
                The roster will show which players still need to sync.
              </p>
            </div>
          }
          confirmLabel='Save it and warn the roster'
          pending={save.isPending}
          error={save.error?.message}
          onConfirm={() => save.mutate()}
          onCancel={() => setConfirmLiveEdit(null)}
        />
      )}
    </div>
  );
};

export default BoardEditor;
