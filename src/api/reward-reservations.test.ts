import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  committedPoints,
  readRewardReservations,
  releasePoints,
  reservationFor,
  reservePoints,
  reservedPoints,
  spendablePoints,
  writeRewardReservations,
} from './reward-reservations';
import type { RewardReservation } from './reward-reservations';

const REWARDS = [
  { name: 'Schermtijd', assignee: 'Zara', cost: 20, pendingClaims: 0 },
  { name: 'Filmavond', assignee: 'Zara', cost: 10, pendingClaims: 0 },
  { name: 'Ijsje', assignee: 'Nova', cost: 5, pendingClaims: 0 },
];

describe('reward reservations', () => {
  it('sets points aside per user and reward, replacing a previous choice', () => {
    let list: RewardReservation[] = [];
    list = reservePoints(list, { user: 'Zara', reward: 'Schermtijd', points: 20, at: 1 });
    expect(reservedPoints(list, 'Zara')).toBe(20);

    list = reservePoints(list, { user: 'zara ', reward: ' schermtijd', points: 25, at: 2 });
    expect(list).toHaveLength(1);
    expect(reservedPoints(list, 'ZARA')).toBe(25);
  });

  it('gives the points back when the child undoes the choice', () => {
    const list = reservePoints([], { user: 'Zara', reward: 'Schermtijd', points: 20 });
    expect(reservedPoints(list, 'Zara')).toBe(20);

    const released = releasePoints(list, 'Zara', 'Schermtijd');
    expect(released).toEqual([]);
    expect(reservedPoints(released, 'Zara')).toBe(0);
  });

  it('only counts the owner’s allocations', () => {
    let list: RewardReservation[] = [];
    list = reservePoints(list, { user: 'Zara', reward: 'Schermtijd', points: 20 });
    list = reservePoints(list, { user: 'Nova', reward: 'Ijsje', points: 5 });

    expect(reservedPoints(list, 'Zara')).toBe(20);
    expect(reservedPoints(list, 'Nova')).toBe(5);
    expect(reservationFor(list, 'Zara', 'schermtijd')?.points).toBe(20);
    expect(reservationFor(list, 'Nova', 'Schermtijd')).toBeNull();
  });

  it('subtracts allocations and outside claims from the spendable balance', () => {
    const list = reservePoints([], { user: 'Zara', reward: 'Schermtijd', points: 20 });

    // 60 points, 20 assigned → 40 left to play with.
    expect(spendablePoints(60, list, REWARDS, 'Zara')).toBe(40);

    // A redeem made in Home Assistant also ends in a deduction on approval.
    const claimed = [
      { name: 'Filmavond', assignee: 'Zara', cost: 10, pendingClaims: 1 },
      ...REWARDS,
    ];
    expect(committedPoints(list, claimed, 'Zara')).toBe(30);
    expect(spendablePoints(60, list, claimed, 'Zara')).toBe(30);
  });

  it('never reports a negative balance', () => {
    const list = reservePoints([], { user: 'Zara', reward: 'Schermtijd', points: 50 });
    expect(spendablePoints(25, list, REWARDS, 'Zara')).toBe(0);
  });
});

describe('reward reservation storage', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips allocations', () => {
    writeRewardReservations([{ user: 'zara', reward: 'schermtijd', points: 20, at: 5 }]);
    expect(readRewardReservations()).toEqual([
      { user: 'zara', reward: 'schermtijd', points: 20, at: 5 },
    ]);
  });

  it('ignores corrupt or unexpected payloads', () => {
    store.set('beacon_reward_reservations', '{not json');
    expect(readRewardReservations()).toEqual([]);

    store.set('beacon_reward_reservations', JSON.stringify([{ user: 'zara' }, null, 4]));
    expect(readRewardReservations()).toEqual([]);
  });

  it('clears the key once nothing is set aside', () => {
    writeRewardReservations([{ user: 'zara', reward: 'x', points: 1, at: 1 }]);
    writeRewardReservations([]);
    expect(store.has('beacon_reward_reservations')).toBe(false);
  });
});
