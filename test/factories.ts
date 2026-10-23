// Envelope factories for tests.
//
// These build contract-valid envelopes, and every test that needs one goes through here so that
// a schema change breaks the factory once rather than thirty tests individually.

import type {
  CollectionLogEnvelope,
  CountEnvelope,
  DropEnvelope,
  DurationEnvelope,
  KillEnvelope,
} from '../src/contract/envelope';

export const ACCOUNT_HASH = '-4234871239847123';
export const SESSION_ID = '6b1f0c2e-3a44-4d8b-9f10-27c5e8a1b3d4';

const common = {
  schemaVersion: 1 as const,
  source: 'OBSERVED' as const,
  gameId: 'g_7f3a91',
  accountHash: ACCOUNT_HASH,
  displayName: 'Safespot Ted',
  sessionId: SESSION_ID,
  clientTime: 1755950400000,
  gameTick: 123456,
  world: 302,
  worldTypes: ['MEMBERS'],
  screenshot: null,
  screenshotMediaType: null,
};

export const countEnvelope = (over: Partial<CountEnvelope> = {}): CountEnvelope => ({
  ...common,
  eventId: '0'.repeat(32),
  metric: { id: 'kc.vorkath', type: 'COUNT', value: 342, delta: 1, firstObservation: false },
  detail: { activity: 'Vorkath', rawMessage: 'Your Vorkath kill count is: 342.' },
  ...over,
});

export const dropEnvelope = (over: Partial<DropEnvelope> = {}): DropEnvelope => ({
  ...common,
  eventId: '0'.repeat(32),
  metric: { id: 'drop.abyssal_whip', type: 'DROP', value: null, delta: 1, firstObservation: false },
  detail: {
    itemId: 4151,
    itemName: 'Abyssal whip',
    quantity: 1,
    source: 'Abyssal demon',
    sourceType: 'NPC',
    killCount: 342,
    geValue: null,
    haValue: null,
    ruleValue: null,
    observationOrdinal: 0,
  },
  ...over,
});

export const observedKillEnvelope = (over: Partial<KillEnvelope> = {}): KillEnvelope => ({
  ...common,
  eventId: '0'.repeat(32),
  metric: { id: 'kill.abyssal_demon', type: 'KILL', value: null, delta: 1, firstObservation: false },
  detail: {
    npcId: 415,
    npcName: 'Abyssal demon',
    combatLevel: 124,
    signal: 'SERVER_NPC_LOOT',
    observationOrdinal: 0,
  },
  ...over,
});

export const durationEnvelope = (over: Partial<DurationEnvelope> = {}): DurationEnvelope => ({
  ...common,
  eventId: '0'.repeat(32),
  metric: {
    id: 'time.chambers_of_xeric',
    type: 'DURATION',
    value: 154800,
    delta: null,
    firstObservation: false,
  },
  detail: {
    activity: 'Chambers of Xeric',
    variant: null,
    durationMs: 154800,
    isPersonalBest: true,
    personalBestMs: 154800,
    rawMessage: 'Challenge duration: 2:34.',
  },
  ...over,
});

export const collectionLogEnvelope = (
  over: Partial<CollectionLogEnvelope> = {},
): CollectionLogEnvelope => ({
  ...common,
  eventId: '0'.repeat(32),
  metric: {
    id: 'collection_log.dragon_pickaxe',
    type: 'COLLECTION_LOG',
    value: null,
    delta: 1,
    firstObservation: false,
  },
  detail: { itemName: 'Dragon pickaxe', completed: null, totalPossible: null },
  ...over,
});
