/**
 * Reward redemption state: what each child is saving for, what is waiting for a
 * parent, and what has been given.
 *
 * Storage is `beacon-store`, i.e. the add-on server when running as an add-on
 * and localStorage in dev — so progress is shared across devices instead of
 * living on one phone. A save that never reached the server is reported.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  loadRedemptions,
  loadRedemptionsSync,
  migrateReservations,
  saveRedemptions,
  type Redemption,
} from '../api/reward-redemptions';
import { mutateRedemptions, type PlannerOp } from '../api/planner-service';
import { readRewardReservations, RESERVATIONS_STORAGE_KEY } from '../api/reward-reservations';

export interface UseRewardRedemptionsResult {
  redemptions: Redemption[];
  update: (change: (current: Redemption[]) => Redemption[]) => void;
  /**
   * Apply one reward operation. Reduced by the add-on server when there is one
   * (so allocations and fulfilments are serialised and idempotent), otherwise by
   * the same shared rules locally.
   */
  runOp: (op: PlannerOp) => Promise<unknown>;
  /** False when the last save did not reach the server. */
  persisted: boolean;
  error: string | null;
}

export function useRewardRedemptions(): UseRewardRedemptionsResult {
  const [redemptions, setRedemptions] = useState<Redemption[]>(() => {
    // Import the old localStorage reservations on first paint, so a household
    // that was already saving does not lose its progress.
    const legacy = readRewardReservations();
    const migrated = legacy.length > 0 ? migrateReservations(loadRedemptionsSync(), legacy) : null;
    return migrated ?? loadRedemptionsSync();
  });
  const [persisted, setPersisted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRedemptions().then((server) => {
      if (cancelled) return;
      setRedemptions((local) => (local.length > 0 ? local : server));
      // The legacy key has served its purpose; keep the new document only.
      try {
        localStorage.removeItem(RESERVATIONS_STORAGE_KEY);
      } catch {
        /* storage is optional */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((change: (current: Redemption[]) => Redemption[]) => {
    setRedemptions((current) => {
      const next = change(current);
      if (next === current) return current;
      void saveRedemptions(next).then((result) => {
        setPersisted(result.persisted);
        setError(result.persisted ? null : (result.error?.message ?? 'Not stored on the server'));
      });
      return next;
    });
  }, []);

  const runOp = useCallback(async (op: PlannerOp) => {
    try {
      const result = await mutateRedemptions(op);
      setRedemptions(result.document);
      setPersisted(result.persisted);
      setError(result.persisted ? null : (result.error ?? 'Not stored on the server'));
      return result.result;
    } catch (err) {
      setPersisted(false);
      setError(err instanceof Error ? err.message : 'Planner write failed');
      return null;
    }
  }, []);

  return { redemptions, update, runOp, persisted, error };
}
