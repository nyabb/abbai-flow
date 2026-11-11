/**
 * Reward redemptions — the child's path from "saving" to "given".
 *
 * ChoreOps owns reward *definitions* and the deduction (`approve_reward`). It
 * does not own the progress a child makes between chores, so that lives here:
 *
 *   saving ──(points reach the cost)──▶ awaiting_fulfilment ──(parent)──▶ fulfilled
 *      ▲                                     │
 *      └──────────(child undoes)─────────────┘
 *
 * The **transition rules** live in `shared/planner-rules.mjs` so the add-on
 * server reduces them for `POST /api/planner/mutate` with the same code the
 * browser uses offline. This module re-exports them with types and adds the
 * persistence and balance helpers the UI needs.
 */
import { loadData, loadDataSync, saveData, type PersistenceResult } from './beacon-store';
import type { RewardReservation } from './reward-reservations';
import {
  normaliseName as sharedNormaliseName,
  sanitizeRedemptions as sharedSanitizeRedemptions,
  type Redemption,
} from '../../shared/planner-rules.mjs';

export {
  activeRedemption,
  addPoints,
  fulfilRedemption,
  normalise,
  releaseRedemption,
  sanitizeRedemptions,
} from '../../shared/planner-rules.mjs';

export type { Redemption, RedemptionState } from '../../shared/planner-rules.mjs';

export const REDEMPTIONS_KEY = 'beacon-reward-redemptions';

/** Everything this child is saving for or waiting on. */
export function activeRedemptions(
  redemptions: Redemption[],
  user: string | null | undefined,
): Redemption[] {
  const userKey = sharedNormaliseName(user);
  if (!userKey) return [];
  return redemptions.filter((item) => item.user === userKey && item.state !== 'fulfilled');
}

/** Handed-over rewards, newest first (the audit trail). */
export function fulfilledRedemptions(
  redemptions: Redemption[],
  user?: string | null,
): Redemption[] {
  const userKey = sharedNormaliseName(user);
  return redemptions
    .filter((item) => item.state === 'fulfilled' && (!userKey || item.user === userKey))
    .sort((left, right) => (right.fulfilledAt ?? 0) - (left.fulfilledAt ?? 0));
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
 * (`pendingClaims`), but only when Abbai Flow has no redemption for that reward —
 * otherwise the same points would be held twice.
 */
export function spendableWithRedemptions(
  savings: number,
  redemptions: Redemption[],
  rewards: Array<{ name: string; assignee: string | null; cost: number; pendingClaims: number }>,
  user: string | null | undefined,
): number {
  const userKey = sharedNormaliseName(user);
  if (!userKey) return 0;

  let committed = committedRedemptionPoints(redemptions, userKey);
  for (const reward of rewards) {
    if (sharedNormaliseName(reward.assignee) !== userKey) continue;
    if (reward.pendingClaims <= 0) continue;
    if (
      activeRedemptions(redemptions, userKey).some(
        (item) => item.reward === sharedNormaliseName(reward.name),
      )
    ) {
      continue;
    }
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
    const userKey = sharedNormaliseName(reservation.user);
    const rewardKey = sharedNormaliseName(reservation.reward);
    if (
      next.some(
        (item) => item.user === userKey && item.reward === rewardKey && item.state !== 'fulfilled',
      )
    ) {
      continue;
    }
    const cost = costs[rewardKey] ?? 0;
    const points = Math.max(0, reservation.points);
    const at = reservation.at || Date.now();
    const achieved = cost > 0 && points >= cost;
    next = [
      ...next,
      {
        id: `r-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        user: userKey,
        reward: rewardKey,
        rewardLabel: reservation.reward,
        cost,
        points,
        state: achieved ? 'awaiting_fulfilment' : 'saving',
        createdAt: at,
        ...(achieved ? { achievedAt: at } : {}),
      },
    ];
  }
  return next;
}

export function loadRedemptionsSync(): Redemption[] {
  return sharedSanitizeRedemptions(loadDataSync<unknown>(REDEMPTIONS_KEY, null));
}

export async function loadRedemptions(): Promise<Redemption[]> {
  return sharedSanitizeRedemptions(await loadData<unknown>(REDEMPTIONS_KEY, null));
}

export function saveRedemptions(redemptions: Redemption[]): Promise<PersistenceResult> {
  return saveData(REDEMPTIONS_KEY, redemptions);
}
