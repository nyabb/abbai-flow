import { loadChoresManSnapshot } from './choresman';

export interface ChoresManRewardHistoryEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  amount: number;
  balanceAfter: number | null;
  itemName: string;
  referenceId: string | null;
}

export interface ChoresManChoreHistoryEntry {
  id: string;
  choreId: string;
  choreName: string;
  completedAt: string;
  completedAtMs: number;
  points: number | null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseChoresManRewardHistory(
  entries: Array<Record<string, unknown>>,
): ChoresManRewardHistoryEntry[] {
  return entries.flatMap((entry, index) => {
    const source = stringValue(entry.source).toLocaleLowerCase();
    const amount = numberValue(entry.amount);
    const timestamp = stringValue(entry.timestamp);
    const timestampMs = Date.parse(timestamp);
    const itemName = stringValue(entry.item_name);
    if (!['reward', 'rewards'].includes(source) || amount === null || amount >= 0 || !itemName || !Number.isFinite(timestampMs)) {
      return [];
    }
    const referenceId = entry.reference_id == null ? null : String(entry.reference_id);
    return [{
      id: referenceId ?? `${timestamp}:${index}`,
      timestamp,
      timestampMs,
      amount,
      balanceAfter: numberValue(entry.balance_after),
      itemName,
      referenceId,
    }];
  }).sort((left, right) => right.timestampMs - left.timestampMs);
}

export async function fetchChoresManRewardHistory(
  userName: string,
): Promise<ChoresManRewardHistoryEntry[]> {
  const snapshot = await loadChoresManSnapshot();
  const member = snapshot.members.find(
    (candidate) => candidate.name.trim().toLocaleLowerCase() === userName.trim().toLocaleLowerCase(),
  );
  if (!member) return [];
  return parseChoresManRewardHistory(
    snapshot.ledger.filter((entry) => entry.member_id === member.id),
  );
}

export function parseChoresManChoreHistory(
  claims: Array<Record<string, unknown>>,
): ChoresManChoreHistoryEntry[] {
  return claims.flatMap((claim) => {
    if (claim.status !== 'approved') return [];
    const completedAt = stringValue(claim.approved_at);
    const completedAtMs = Date.parse(completedAt);
    const choreId = stringValue(claim.chore_id);
    const choreName = stringValue(claim.chore_name);
    if (!choreId || !choreName || !Number.isFinite(completedAtMs)) return [];
    return [{
      id: stringValue(claim.id) || `${choreId}:${completedAt}`,
      choreId,
      choreName,
      completedAt,
      completedAtMs,
      points: numberValue(claim.points_awarded),
    }];
  }).sort((left, right) => right.completedAtMs - left.completedAtMs);
}

export async function fetchChoresManChoreHistory(
  userName: string,
): Promise<ChoresManChoreHistoryEntry[]> {
  const snapshot = await loadChoresManSnapshot();
  const member = snapshot.members.find(
    (candidate) => candidate.name.trim().toLocaleLowerCase() === userName.trim().toLocaleLowerCase(),
  );
  if (!member) return [];
  return parseChoresManChoreHistory(
    snapshot.chore_claims.filter((claim) => claim.member_id === member.id),
  );
}
