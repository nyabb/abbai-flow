/**
 * Reward redemptions — the child's path from "saving" to "given".
 *
 * ChoreOps owns reward *definitions* (name, cost, who may redeem) and the actual
 * deduction (`choreops.approve_reward`). It does not own the progress a child
 * makes towards a reward between chores: that has to survive a page refresh and
 * be visible on every device, so it lives here.
 *
 * One redemption is one pursuit of one reward by one child:
 *
 *   saving ──(points reach the cost)──▶ awaiting_fulfilment ──(parent)──▶ fulfilled
 *      ▲                                     │
 *      └──────────(child undoes)─────────────┘
 *
 * Key rules encoded below:
 *  - a redemption never exceeds the reward cost, so points cannot be deducted
 *    twice for one goal;
 *  - only `awaiting_fulfilment` redemptions can be handed over, and only once;
 *  - a fulfilled redemption is history — the same reward definition can be
 *    pursued again, which is why the definition is never deleted.
 */
import { loadData, loadDataSync, saveData, type PersistenceResult } from './beacon-store';
import type { RewardReservation } from './reward-reservations';

export const REDEMPTIONS_KEY = 'beacon-reward-redemptions';

export type RedemptionState = 'saving' | 'awaiting_fulfilment' | 'fulfilled';

export interface Redemption {
  /** Stable id, never a (user, reward) pair: the pair repeats over time. */
  id: string;
  /** ChoreOps user name, normalised. */
  user: string;
  /** Reward definition name, normalised. */
  reward: string;
  /** Reward name as the parent typed it, for display. */
  rewardLabel: string;
  /** What the reward costs, captured when the pursuit started. */
  cost: number;
  /** Points put towards it so far. */
  points: number;
  state: RedemptionState;
  createdAt: number;
  achievedAt?: number;
  fulfilledAt?: number;
  /** Parent who handed the reward over. */
  fulfilledBy?: string;
}

export function normalise(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function newId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The reward this child is currently pursuing, if any. */
export function activeRedemption(
  redemptions: Redemption[],
  user: string | null | undefined,
  reward: string | null | undefined,
): Redemption | null {
  const userKey = normalise(user);
  const rewardKey = normalise(reward);
  if (!userKey || !rewardKey) return null;
  return (
    redemptions.find(
      (item) =>
        item.user === userKey && item.reward === rewardKey && item.state !== 'fulfilled',
    ) ?? null
  );
}

/** Everything this child is saving for or waiting on. */
export function activeRedemptions(
  redemptions: Redemption[],
  user: string | null | undefined,
): Redemption[] {
  const userKey = normalise(user);
  if (!userKey) return [];
  return redemptions.filter((item) => item.user === userKey && item.state !== 'fulfilled');
}

/** Handed-over rewards, newest first (the audit trail). */
export function fulfilledRedemptions(
  redemptions: Redemption[],
  user?: string | null,
): Redemption[] {
  const userKey = normalise(user);
  return redemptions
    .filter((item) => item.state === 'fulfilled' && (!userKey || item.user === userKey))
    .sort((left, right) => (right.fulfilledAt ?? 0) - (left.fulfilledAt ?? 0));
}

/**
 * Put points towards a reward.
 *
 * The amount is clamped to what the goal still needs, so a full goal can never
 * absorb a second allocation, and reaching the cost flips the state to
 * `awaiting_fulfilment` exactly once.
 */
export function addPoints(
  redemptions: Redemption[],
  input: {
    user: string;
    reward: string;
    cost: number;
    amount: number;
    at?: number;
  },
): { redemptions: Redemption[]; redemption: Redemption | null } {
  const user = normalise(input.user);
  const reward = normalise(input.reward);
  if (!user || !reward) return { redemptions, redemption: null };

  const at = input.at ?? Date.now();
  const cost = Math.max(0, Math.round(input.cost));
  const existing = activeRedemption(redemptions, user, reward);
  if (existing?.state === 'awaiting_fulfilment') {
    return { redemptions, redemption: existing };
  }

  const already = existing?.points ?? 0;
  const give = Math.max(0, Math.min(Math.round(input.amount), Math.max(0, cost - already)));
  if (give <= 0) return { redemptions, redemption: existing };

  const points = already + give;
  const state: RedemptionState = cost > 0 && points >= cost ? 'awaiting_fulfilment' : 'saving';
  const redemption: Redemption = {
    id: existing?.id ?? newId(),
    user,
    reward,
    rewardLabel: input.reward.trim(),
    cost,
    points,
    state,
    createdAt: existing?.createdAt ?? at,
    ...(state === 'awaiting_fulfilment' ? { achievedAt: at } : {}),
  };

  return {
    redemptions: existing
      ? redemptions.map((item) => (item.id === existing.id ? redemption : item))
      : [...redemptions, redemption],
    redemption,
  };
}

/** Undo a pursuit: the points go back into the child's spendable balance. */
export function releaseRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
): Redemption[] {
  if (!id) return redemptions;
  return redemptions.filter((item) => item.id !== id || item.state === 'fulfilled');
}

/**
 * Parent hands the reward over.
 *
 * Returns the updated list plus the redemption that was settled, so the caller
 * can name it in a toast. A redemption that is still saving, or already
 * fulfilled, is left untouched — a double tap cannot record two gifts.
 */
export function fulfilRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
  by: string | undefined,
  at = Date.now(),
): { redemptions: Redemption[]; redemption: Redemption | null } {
  if (!id) return { redemptions, redemption: null };
  const target = redemptions.find((item) => item.id === id);
  if (!target || target.state !== 'awaiting_fulfilment') {
    return { redemptions, redemption: null };
  }
  const redemption: Redemption = {
    ...target,
    state: 'fulfilled',
    fulfilledAt: at,
    ...(by ? { fulfilledBy: by } : {}),
  };
  return {
    redemptions: redemptions.map((item) => (item.id === id ? redemption : item)),
    redemption,
  };
}

/** Points already spoken for by this child's pursuits. */
export function committedRedemptionPoints(
  redemptions: Redemption[],
  user: string | null | undefined,
): number {
  return activeRedemptions(redemptions, user).reduce((total, item) => total + item.points, 0);
}

/**
 * What the child can still allocate: their ChoreOps balance minus everything
 * already promised to a reward. Claims made in Home Assistant count too
 * (`pendingClaims`), but only when Beacon has no redemption for that reward —
 * otherwise the same points would be held twice.
 */
export function spendableWithRedemptions(
  savings: number,
  redemptions: Redemption[],
  rewards: Array<{ name: string; assignee: string | null; cost: number; pendingClaims: number }>,
  user: string | null | undefined,
): number {
  const userKey = normalise(user);
  if (!userKey) return 0;

  let committed = committedRedemptionPoints(redemptions, userKey);
  for (const reward of rewards) {
    if (normalise(reward.assignee) !== userKey) continue;
    if (reward.pendingClaims <= 0) continue;
    if (activeRedemption(redemptions, userKey, reward.name)) continue;
    committed += Math.max(0, reward.cost) * reward.pendingClaims;
  }
  return Math.max(0, savings - committed);
}

/**
 * One-time import of the old localStorage reservations, so a household that was
 * already saving keeps its progress. Anything already at its cost becomes
 * `awaiting_fulfilment`; nothing is ever marked fulfilled by a migration.
 */
export function migrateReservations(
  redemptions: Redemption[],
  reservations: RewardReservation[],
  costs: Record<string, number> = {},
): Redemption[] {
  let next = redemptions;
  for (const reservation of reservations) {
    if (activeRedemption(next, reservation.user, reservation.reward)) continue;
    const cost = costs[normalise(reservation.reward)] ?? 0;
    const points = Math.max(0, reservation.points);
    const at = reservation.at || Date.now();
    next = [
      ...next,
      {
        id: newId(),
        user: normalise(reservation.user),
        reward: normalise(reservation.reward),
        rewardLabel: reservation.reward,
        cost,
        points,
        state: cost > 0 && points >= cost ? 'awaiting_fulfilment' : 'saving',
        createdAt: at,
        ...(cost > 0 && points >= cost ? { achievedAt: at } : {}),
      },
    ];
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tolerant parse: a stale document must never break the rewards sheet. */
export function sanitizeRedemptions(raw: unknown): Redemption[] {
  if (!Array.isArray(raw)) return [];
  const out: Redemption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.user !== 'string' || typeof item.reward !== 'string') continue;
    const id = typeof item.id === 'string' && item.id ? item.id : newId();
    if (seen.has(id)) continue;
    seen.add(id);
    const cost = typeof item.cost === 'number' && item.cost >= 0 ? item.cost : 0;
    const points = typeof item.points === 'number' && item.points >= 0 ? item.points : 0;
    const state: RedemptionState =
      item.state === 'fulfilled'
        ? 'fulfilled'
        : item.state === 'awaiting_fulfilment' || (cost > 0 && points >= cost)
          ? 'awaiting_fulfilment'
          : 'saving';
    out.push({
      id,
      user: normalise(item.user),
      reward: normalise(item.reward),
      rewardLabel:
        typeof item.rewardLabel === 'string' && item.rewardLabel
          ? item.rewardLabel
          : item.reward,
      cost,
      points: Math.min(points, cost || points),
      state,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
      ...(typeof item.achievedAt === 'number' ? { achievedAt: item.achievedAt } : {}),
      ...(typeof item.fulfilledAt === 'number' ? { fulfilledAt: item.fulfilledAt } : {}),
      ...(typeof item.fulfilledBy === 'string' ? { fulfilledBy: item.fulfilledBy } : {}),
    });
  }
  return out;
}

export function loadRedemptionsSync(): Redemption[] {
  return sanitizeRedemptions(loadDataSync<unknown>(REDEMPTIONS_KEY, null));
}

export async function loadRedemptions(): Promise<Redemption[]> {
  return sanitizeRedemptions(await loadData<unknown>(REDEMPTIONS_KEY, null));
}

export function saveRedemptions(redemptions: Redemption[]): Promise<PersistenceResult> {
  return saveData(REDEMPTIONS_KEY, redemptions);
}
