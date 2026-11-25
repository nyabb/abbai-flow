/**
 * Abbai Flow-owned planner metadata: routines, routine step order and mission
 * progress.
 *
 * ChoresMan has no routine records or step-order field on chores (verified
 * against its service registry and entity attributes), so anything that gives
 * a routine a stable identity — or says "task 2 comes after task 1" — has to
 * live in Abbai Flow.
 *
 * The **rules** live in `planner-rules.ts` so the server bundle can run the exact
 * same code for `POST /api/planner/mutate`; this module re-exports them
 * with types and adds the bits that only make sense in the browser (persistence
 * through `abbai-flow-store`, and the queries the views need).
 */
import { loadData, loadDataSync, saveData, type PersistenceResult } from './abbai-flow-store';
import {
  normaliseName as sharedNormaliseName,
  sanitizePlannerMeta as sharedSanitizeMeta,
  type MissionProgress,
  type PlannerMeta,
} from './planner-rules';

export {
  addRoutineTask,
  clearMission,
  emptyMeta,
  findRoutine,
  importLegacyPauses,
  markMissionTaskDone,
  moveRoutineTask,
  normaliseName,
  pruneRoutineTasks,
  removeRoutineTask,
  renameRoutine,
  routineSlug,
  sanitizePlannerMeta,
  setRoutineTasks,
  startMission,
  toggleRoutinePaused,
  upsertRoutine,
} from './planner-rules';

export type { MissionProgress, PlannerMeta, RoutineDefinition } from './planner-rules';

/** Storage key (also the `/abbai-flow/data/:key` path segment). */
export const PLANNER_META_KEY = 'abbai-flow-planner-meta';

export const PLANNER_META_VERSION = 1;

/** Resolve explicit task membership without inferring routines from chore labels. */
export function routineIdForTask(meta: PlannerMeta, taskName: string): string | null {
  const key = sharedNormaliseName(taskName);
  if (!key) return null;
  const owner = meta.routines.find((routine) =>
    routine.taskNames.some((name) => sharedNormaliseName(name) === key),
  );
  return owner?.id ?? null;
}

/** Chore names of a routine in execution order. */
export function routineTaskOrder(meta: PlannerMeta, id: string): string[] {
  return meta.routines.find((routine) => routine.id === id)?.taskNames ?? [];
}

export function missionForUser(
  meta: PlannerMeta,
  userName: string | null | undefined,
): MissionProgress | null {
  const key = sharedNormaliseName(userName);
  if (!key) return null;
  return meta.missions[key] ?? null;
}

/** Position inside a routine from persisted progress ("2 of 4"). */
export function missionStep(
  meta: PlannerMeta,
  userName: string | null | undefined,
  routineId: string,
): { done: number; total: number } {
  const progress = missionForUser(meta, userName);
  const order = routineTaskOrder(meta, routineId);
  const completed = progress && progress.routineId === routineId ? progress.completed : [];
  const done = order.filter((name) =>
    completed.some((other) => sharedNormaliseName(other) === sharedNormaliseName(name)),
  ).length;
  return { done, total: order.length };
}

/** Instant read for first paint; the async read replaces it with the server copy. */
export function loadPlannerMetaSync(): PlannerMeta {
  return sharedSanitizeMeta(loadDataSync<unknown>(PLANNER_META_KEY, null));
}

export async function loadPlannerMeta(): Promise<PlannerMeta> {
  return sharedSanitizeMeta(await loadData<unknown>(PLANNER_META_KEY, null));
}

/**
 * Persist the document. The result is returned rather than swallowed: a save
 * that only reached localStorage must be reported to the household instead of
 * looking like it was stored.
 */
export function savePlannerMeta(meta: PlannerMeta): Promise<PersistenceResult> {
  return saveData(PLANNER_META_KEY, meta);
}

export type PlannerMetaDocument = PlannerMeta;
