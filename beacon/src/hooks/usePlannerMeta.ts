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
  importLegacyPauses,
  loadPlannerMeta,
  loadPlannerMetaSync,
  savePlannerMeta,
  type PlannerMeta,
} from '../api/planner-meta';
import { mutateMeta, type PlannerOp } from '../api/planner-service';

export interface UsePlannerMetaResult {
  meta: PlannerMeta;
  /** Apply a change locally and persist it (adoption, migration). */
  update: (change: (meta: PlannerMeta) => PlannerMeta) => void;
  /**
   * Apply one planner operation.
   *
   * In add-on mode the server reduces it (shared rules, serialised, idempotent)
   * and the state is replaced with what was actually stored; standalone reduces
   * the same rules locally. Returns whatever the operation produced.
   */
  runOp: (op: PlannerOp) => Promise<unknown>;
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

  const runOp = useCallback(async (op: PlannerOp) => {
    try {
      const result = await mutateMeta(op);
      setMeta(result.document);
      setPersisted(result.persisted);
      setError(result.persisted ? null : (result.error ?? 'Not stored on the server'));
      return result.result;
    } catch (err) {
      setPersisted(false);
      setError(err instanceof Error ? err.message : 'Planner write failed');
      return null;
    }
  }, []);

  return { meta, update, runOp, persisted, error };
}

