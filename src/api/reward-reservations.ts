/**
 * Points a child has set aside for a reward.
 *
 * ChoreOps only takes points off the balance when a parent approves the claim.
 * A family wants the opposite order: picking a reward is the moment the points
 * leave the child's spendable balance, so they can see what is left and change
 * their mind before anyone confirms anything in real life.
 *
 * Beacon therefore keeps a small local reservation per (ChoreOps user, reward).
 * It never invents points: the reserved amount is only subtracted from the
 * balance ChoreOps publishes, and it is dropped again as soon as the child
 * undoes the choice or a parent confirms the reward (ChoreOps then deducts the
 * same amount for real, so the visible balance does not move at that point).
 */

export interface RewardReservation {
  /** ChoreOps user name, normalised. */
  user: string;
  /** Reward name, normalised. Reward names are unique per user in ChoreOps. */
  reward: string;
  /** Points held for this reward. */
  points: number;
  /** Epoch ms, so stale allocations can be recognised. */
  at: number;
}

/**
 * The slice of a ChoreOps reward this module needs. Kept structural so the
 * pure helpers stay free of the full entity type.
 */
export interface RewardCommitment {
  name: string;
  assignee: string | null;
  cost: number;
  pendingClaims: number;
}

export const RESERVATIONS_STORAGE_KEY = 'beacon_reward_reservations';

export function normaliseKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isReservation(value: unknown): value is RewardReservation {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<RewardReservation>;
  return (
    typeof item.user === 'string' &&
    typeof item.reward === 'string' &&
    typeof item.points === 'number' &&
    Number.isFinite(item.points) &&
    item.points >= 0
  );
}

/** Read the stored allocations; an unreadable store means "nothing set aside". */
export function readRewardReservations(): RewardReservation[] {
  try {
    const raw = localStorage.getItem(RESERVATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReservation).map((item) => ({
      user: normaliseKey(item.user),
      reward: normaliseKey(item.reward),
      points: item.points,
      at: typeof item.at === 'number' ? item.at : 0,
    }));
  } catch {
    return [];
  }
}

export function writeRewardReservations(reservations: RewardReservation[]): void {
  try {
    if (reservations.length === 0) localStorage.removeItem(RESERVATIONS_STORAGE_KEY);
    else localStorage.setItem(RESERVATIONS_STORAGE_KEY, JSON.stringify(reservations));
  } catch {
    /* Storage can be unavailable (private mode); the board still works. */
  }
}

/** Set points aside for a reward, replacing any earlier allocation for it. */
export function reservePoints(
  reservations: RewardReservation[],
  input: { user: string; reward: string; points: number; at?: number },
): RewardReservation[] {
  const user = normaliseKey(input.user);
  const reward = normaliseKey(input.reward);
  if (!user || !reward) return reservations;

  const next = reservations.filter((item) => !(item.user === user && item.reward === reward));
  next.push({
    user,
    reward,
    points: Math.max(0, Math.round(input.points)),
    at: input.at ?? Date.now(),
  });
  return next;
}

/** Give the points back (child changed their mind, or the reward was settled). */
export function releasePoints(
  reservations: RewardReservation[],
  user: string | null | undefined,
  reward: string | null | undefined,
): RewardReservation[] {
  const userKey = normaliseKey(user);
  const rewardKey = normaliseKey(reward);
  if (!userKey || !rewardKey) return reservations;
  return reservations.filter((item) => !(item.user === userKey && item.reward === rewardKey));
}

/** How many points this user has set aside, ignoring ChoreOps' own claims. */
export function reservedPoints(
  reservations: RewardReservation[],
  user: string | null | undefined,
): number {
  const userKey = normaliseKey(user);
  if (!userKey) return 0;
  return reservations
    .filter((item) => item.user === userKey)
    .reduce((total, item) => total + item.points, 0);
}

/**
 * Points that are already spoken for: Beacon allocations plus claims made
 * outside Beacon (a redeem in Home Assistant also ends in a deduction when a
 * parent approves, so it must not look spendable in the meantime).
 */
export function committedPoints(
  reservations: RewardReservation[],
  rewards: RewardCommitment[],
  user: string | null | undefined,
): number {
  const userKey = normaliseKey(user);
  if (!userKey) return 0;

  let total = reservedPoints(reservations, userKey);
  for (const reward of rewards) {
    if (normaliseKey(reward.assignee) !== userKey) continue;
    if (reward.pendingClaims <= 0) continue;
    // A reservation already accounts for this reward; don't hold it twice.
    const reserved = reservations.some(
      (item) => item.user === userKey && item.reward === normaliseKey(reward.name),
    );
    if (reserved) continue;
    total += Math.max(0, reward.cost) * reward.pendingClaims;
  }
  return total;
}

/** What the child can still allocate, never below zero. */
export function spendablePoints(
  savings: number,
  reservations: RewardReservation[],
  rewards: RewardCommitment[],
  user: string | null | undefined,
): number {
  return Math.max(0, savings - committedPoints(reservations, rewards, user));
}

/** True when this user has set points aside for this reward. */
export function reservationFor(
  reservations: RewardReservation[],
  user: string | null | undefined,
  reward: string | null | undefined,
): RewardReservation | null {
  const userKey = normaliseKey(user);
  const rewardKey = normaliseKey(reward);
  if (!userKey || !rewardKey) return null;
  return reservations.find((item) => item.user === userKey && item.reward === rewardKey) ?? null;
}
