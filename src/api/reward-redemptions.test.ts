import { describe, it, expect } from 'vitest';
import {
  activeRedemption,
  activeRedemptions,
  addPoints,
  committedRedemptionPoints,
  fulfilRedemption,
  fulfilledRedemptions,
  migrateReservations,
  releaseRedemption,
  sanitizeRedemptions,
  spendableWithRedemptions,
} from './reward-redemptions';

const CINEMA = { user: 'Zara', reward: 'Cinema', cost: 100 };

describe('saving towards a reward', () => {
  it('starts a pursuit with the first allocation', () => {
    const { redemptions, redemption } = addPoints([], { ...CINEMA, amount: 40 });
    expect(redemption?.state).toBe('saving');
    expect(redemption?.points).toBe(40);
    expect(redemptions).toHaveLength(1);
  });

  it('accumulates across several allocations', () => {
    let list = addPoints([], { ...CINEMA, amount: 30 }).redemptions;
    list = addPoints(list, { ...CINEMA, amount: 30 }).redemptions;
    expect(activeRedemption(list, 'Zara', 'Cinema')?.points).toBe(60);
    expect(activeRedemption(list, 'zara', 'cinema')?.state).toBe('saving');
  });

  it('never absorbs more than the cost, so points cannot be deducted twice', () => {
    let list = addPoints([], { ...CINEMA, amount: 90 }).redemptions;
    list = addPoints(list, { ...CINEMA, amount: 90 }).redemptions;
    expect(activeRedemption(list, 'Zara', 'Cinema')?.points).toBe(100);
  });

  it('marks the goal achieved exactly when the cost is covered', () => {
    let list = addPoints([], { ...CINEMA, amount: 99 }).redemptions;
    expect(activeRedemption(list, 'Zara', 'Cinema')?.state).toBe('saving');

    list = addPoints(list, { ...CINEMA, amount: 1 }).redemptions;
    const redemption = activeRedemption(list, 'Zara', 'Cinema');
    expect(redemption?.state).toBe('awaiting_fulfilment');
    expect(redemption?.achievedAt).toBeTypeOf('number');
  });

  it('refuses further allocations once the goal is achieved', () => {
    let list = addPoints([], { ...CINEMA, amount: 100 }).redemptions;
    const before = activeRedemption(list, 'Zara', 'Cinema')?.points;
    list = addPoints(list, { ...CINEMA, amount: 50 }).redemptions;
    expect(activeRedemption(list, 'Zara', 'Cinema')?.points).toBe(before);
  });

  it('gives the points back when the child changes their mind', () => {
    const { redemptions } = addPoints([], { ...CINEMA, amount: 40 });
    expect(releaseRedemption(redemptions, redemptions[0].id)).toEqual([]);
  });
});

describe('parent fulfilment', () => {
  const achieved = addPoints([], { ...CINEMA, amount: 100 }).redemptions;

  it('records who handed it over and when', () => {
    const { redemption } = fulfilRedemption(achieved, achieved[0].id, 'Papa', 1234);
    expect(redemption?.state).toBe('fulfilled');
    expect(redemption?.fulfilledBy).toBe('Papa');
    expect(redemption?.fulfilledAt).toBe(1234);
  });

  it('cannot be given twice', () => {
    const once = fulfilRedemption(achieved, achieved[0].id, 'Papa').redemptions;
    const twice = fulfilRedemption(once, achieved[0].id, 'Papa');
    expect(twice.redemption).toBeNull();
    expect(fulfilledRedemptions(twice.redemptions)).toHaveLength(1);
  });

  it('leaves a goal that is still saving alone', () => {
    const saving = addPoints([], { ...CINEMA, amount: 40 }).redemptions;
    expect(fulfilRedemption(saving, saving[0].id, 'Papa').redemption).toBeNull();
  });

  it('removes the given reward from the active goals but keeps the history', () => {
    const given = fulfilRedemption(achieved, achieved[0].id, 'Papa').redemptions;
    expect(activeRedemptions(given, 'Zara')).toHaveLength(0);
    expect(fulfilledRedemptions(given, 'Zara')).toHaveLength(1);
  });

  it('lets the same reward be pursued again after it was given', () => {
    const given = fulfilRedemption(achieved, achieved[0].id, 'Papa').redemptions;
    const again = addPoints(given, { ...CINEMA, amount: 20 }).redemptions;

    expect(activeRedemption(again, 'Zara', 'Cinema')?.state).toBe('saving');
    expect(activeRedemption(again, 'Zara', 'Cinema')?.points).toBe(20);
    expect(fulfilledRedemptions(again, 'Zara')).toHaveLength(1);
    expect(again).toHaveLength(2);
  });

  it('keeps a released pursuit out of the history', () => {
    const given = fulfilRedemption(achieved, achieved[0].id, 'Papa').redemptions;
    expect(releaseRedemption(given, given[0].id)).toHaveLength(1);
  });
});

describe('spendable balance', () => {
  it('holds points that are promised to a goal', () => {
    const list = addPoints([], { ...CINEMA, amount: 40 }).redemptions;
    expect(spendableWithRedemptions(100, list, [], 'Zara')).toBe(60);
    expect(committedRedemptionPoints(list, 'Zara')).toBe(40);
  });

  it('counts a Home Assistant claim when Beacon has no goal for it', () => {
    const rewards = [{ name: 'Snoep', assignee: 'Zara', cost: 10, pendingClaims: 1 }];
    expect(spendableWithRedemptions(30, [], rewards, 'Zara')).toBe(20);
  });

  it('does not hold the same reward twice', () => {
    const list = addPoints([], { user: 'Zara', reward: 'Snoep', cost: 10, amount: 10 }).redemptions;
    const rewards = [{ name: 'Snoep', assignee: 'Zara', cost: 10, pendingClaims: 1 }];
    expect(spendableWithRedemptions(30, list, rewards, 'Zara')).toBe(20);
  });

  it('frees the points again once the reward is given', () => {
    const achieved = addPoints([], { ...CINEMA, amount: 100 }).redemptions;
    const given = fulfilRedemption(achieved, achieved[0].id, 'Papa').redemptions;
    expect(spendableWithRedemptions(100, given, [], 'Zara')).toBe(100);
  });
});

describe('migration and parsing', () => {
  it('imports old reservations without marking anything fulfilled', () => {
    const imported = migrateReservations(
      [],
      [
        { user: 'zara', reward: 'cinema', points: 40, at: 10 },
        { user: 'zara', reward: 'snoep', points: 10, at: 20 },
      ],
      { snoep: 10 },
    );

    expect(imported).toHaveLength(2);
    expect(imported[0].state).toBe('saving');
    expect(imported[1].state).toBe('awaiting_fulfilment');
    expect(fulfilledRedemptions(imported)).toHaveLength(0);
  });

  it('does not duplicate a reservation that already exists', () => {
    const once = migrateReservations([], [{ user: 'zara', reward: 'cinema', points: 40, at: 1 }]);
    const twice = migrateReservations(once, [{ user: 'Zara', reward: 'Cinema', points: 40, at: 1 }]);
    expect(twice).toHaveLength(1);
  });

  it('survives junk', () => {
    expect(sanitizeRedemptions(null)).toEqual([]);
    expect(sanitizeRedemptions([{ user: 'zara' }])).toEqual([]);
    expect(
      sanitizeRedemptions([{ user: 'Zara', reward: 'Cinema', cost: 100, points: 140 }])[0].points,
    ).toBe(100);
  });
});
