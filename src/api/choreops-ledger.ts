/** Read the retained ChoreOps point ledger and expose reward redemptions. */
import { callHaService } from './ha-rest';

export interface ChoreOpsRewardHistoryEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  amount: number;
  balanceAfter: number | null;
  itemName: string;
  referenceId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Normalize HA's service response envelope and keep completed reward spends. */
export function parseChoreOpsRewardHistory(value: unknown): ChoreOpsRewardHistoryEntry[] {
  if (!isRecord(value)) return [];

  const serviceResponse = isRecord(value.service_response) ? value.service_response : value;
  // Most HA services return their response directly. Accept service-keyed
  // envelopes too, so this stays compatible with both HA REST response shapes.
  const payload =
    (isRecord(serviceResponse['choreops.get_ledger']) &&
      serviceResponse['choreops.get_ledger']) ||
    (isRecord(serviceResponse.get_ledger) && serviceResponse.get_ledger) ||
    serviceResponse;
  const entries = payload.entries;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.source !== 'string' || entry.source.toLowerCase() !== 'rewards') return [];

    const amount = numberValue(entry.amount);
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : '';
    const timestampMs = Date.parse(timestamp);
    const itemName = typeof entry.item_name === 'string' ? entry.item_name.trim() : '';
    if (amount === null || amount >= 0 || !itemName || !Number.isFinite(timestampMs)) return [];

    const referenceId =
      typeof entry.reference_id === 'string' || typeof entry.reference_id === 'number'
        ? String(entry.reference_id)
        : null;
    const balanceAfter = numberValue(entry.balance_after);
    return [
      {
        id: referenceId ?? `${timestamp}:${index}`,
        timestamp,
        timestampMs,
        amount,
        balanceAfter,
        itemName,
        referenceId,
      },
    ];
  });
}

export async function fetchChoreOpsRewardHistory(
  userName: string,
): Promise<ChoreOpsRewardHistoryEntry[]> {
  const response = await callHaService(
    'choreops',
    'get_ledger',
    { user_name: userName, limit: 1000 },
    true,
  );
  return parseChoreOpsRewardHistory(response);
}
