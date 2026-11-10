/**
 * Planner metadata hook: routines, step order and mission progress.
 *
 * Hydrates synchronously from the local cache so the board never flashes empty,
 * then replaces it with the server copy (authoritative in add-on mode). Every
 * write goes through `savePlannerMeta`, and a save that only reached
 * localStorage is surfaced instead of being reported as stored.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  emptyMeta,
  importLegacyPauses,
  loadPlannerMeta,
  loadPlannerMetaSync,
  savePlannerMeta,
  type PlannerMeta,
} from '../api/planner-meta';

export interface UsePlannerMetaResult {
  meta: PlannerMeta;
  /** Apply a change and persist it. No-op changes are not written. */
  update: (change: (meta: PlannerMeta) => PlannerMeta) => void;
  /** False when the last save did not reach the server. */
  persisted: boolean;
  /** Human-readable reason for a failed save, if any. */
  error: string | null;
}

export function usePlannerMeta(legacyPausedIds: string[] = []): UsePlannerMetaResult {
  const [meta, setMeta] = useState<PlannerMeta>(() => loadPlannerMetaSync());
  const [persisted, setPersisted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPlannerMeta().then((server) => {
      if (cancelled) return;
      setMeta((local) => {
        const base = local.routines.length > 0 ? local : server;
        // One-way migration: the old per-device pause flag becomes routine state.
        const merged = importLegacyPauses(base, legacyPausedIds);
        if (merged !== base) void savePlannerMeta(merged);
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const update = useCallback((change: (meta: PlannerMeta) => PlannerMeta) => {
    setMeta((current) => {
      const next = change(current);
      if (next === current) return current;
      void savePlannerMeta(next).then((result) => {
        setPersisted(result.persisted);
        setError(result.persisted ? null : (result.error?.message ?? 'Not stored on the server'));
      });
      return next;
    });
  }, []);

  return { meta, update, persisted, error };
}

export { emptyMeta };
