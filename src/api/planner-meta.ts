/**
 * Beacon-owned planner metadata: routines, routine step order and mission
 * progress.
 *
 * ChoreOps has no routine entity and no ordering field on a chore (verified
 * against its service registry and entity attributes), so anything that gives
 * a routine a stable identity — or says "task 2 comes after task 1" — has to
 * live in Beacon. This module is that store: a single document persisted
 * through `beacon-store` (server authoritative in add-on mode, localStorage as
 * the offline cache and the dev-mode store).
 *
 * Everything except the four persistence helpers is pure, so the identity and
 * ordering rules can be unit tested without a browser.
 */
import { loadData, loadDataSync, saveData, type PersistenceResult } from './beacon-store';

/** Storage key (also the `/beacon-data/:key` path segment). */
export const PLANNER_META_KEY = 'beacon-planner-meta';

export const PLANNER_META_VERSION = 1;

export interface RoutineDefinition {
  /** Stable slug derived from the name when the routine is created. */
  id: string;
  name: string;
  icon: string;
  /** ChoreOps chore names, in the order the child should work through them. */
  taskNames: string[];
  /** A paused routine is hidden from missions but still listed on the board. */
  paused?: boolean;
}

export interface MissionProgress {
  routineId: string;
  /** Chore names already completed inside this run, in completion order. */
  completed: string[];
  startedAt: number;
  updatedAt: number;
}

export interface PlannerMeta {
  version: number;
  routines: RoutineDefinition[];
  /** Keyed by normalised ChoreOps user name. */
  missions: Record<string, MissionProgress>;
}

export function emptyMeta(): PlannerMeta {
  return { version: PLANNER_META_VERSION, routines: [], missions: {} };
}

/** Comparison key for names: trimmed, collapsed spaces, lower-cased. */
export function normaliseName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Stable identifier for a routine name.
 *
 * Two spellings of one routine ("Ochtendroutine" / "ochtendroutine ") must land
 * on the same id, otherwise a capitalisation difference silently creates a
 * second routine — the exact bug this store exists to prevent.
 */
export function routineSlug(name: string): string {
  const slug = normaliseName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'routine';
}

/** Find a routine by id, slug or display name (all case/space insensitive). */
export function findRoutine(
  meta: PlannerMeta,
  nameOrId: string | null | undefined,
): RoutineDefinition | null {
  const key = normaliseName(nameOrId);
  if (!key) return null;
  const slug = routineSlug(nameOrId ?? '');
  return (
    meta.routines.find(
      (routine) =>
        routine.id === (nameOrId ?? '') ||
        routine.id === slug ||
        normaliseName(routine.name) === key ||
        routineSlug(routine.name) === slug,
    ) ?? null
  );
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/**
 * Create a routine, or return the existing one when the name already exists.
 *
 * Reuse is the point: typing "ochtendroutine" when "Ochtendroutine" exists must
 * hand back the existing routine instead of creating a near-duplicate.
 */
export function upsertRoutine(
  meta: PlannerMeta,
  name: string,
  icon = '\u23F0',
): { meta: PlannerMeta; routine: RoutineDefinition; created: boolean } {
  const clean = name.trim().replace(/\s+/g, ' ');
  const existing = findRoutine(meta, clean);
  if (existing) return { meta, routine: existing, created: false };

  const routine: RoutineDefinition = {
    id: uniqueId(routineSlug(clean), new Set(meta.routines.map((item) => item.id))),
    name: clean,
    icon,
    taskNames: [],
  };
  return {
    meta: { ...meta, routines: [...meta.routines, routine] },
    routine,
    created: true,
  };
}

/** Rename a routine in place; the id (and therefore every task link) survives. */
export function renameRoutine(meta: PlannerMeta, id: string, name: string): PlannerMeta {
  return {
    ...meta,
    routines: meta.routines.map((routine) => (routine.id === id ? { ...routine, name } : routine)),
  };
}

/** Replace a routine's task list, keeping only the names that still exist. */
export function setRoutineTasks(meta: PlannerMeta, id: string, taskNames: string[]): PlannerMeta {
  const seen = new Set<string>();
  const ordered = taskNames
    .map((name) => name.trim())
    .filter((name) => {
      const key = normaliseName(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    ...meta,
    routines: meta.routines.map((routine) =>
      routine.id === id ? { ...routine, taskNames: ordered } : routine,
    ),
  };
}

/** Append a task to a routine unless it is already a member. */
export function addRoutineTask(meta: PlannerMeta, id: string, taskName: string): PlannerMeta {
  const routine = meta.routines.find((item) => item.id === id);
  if (!routine) return meta;
  if (routine.taskNames.some((name) => normaliseName(name) === normaliseName(taskName))) {
    return meta;
  }
  return setRoutineTasks(meta, id, [...routine.taskNames, taskName]);
}

export function removeRoutineTask(meta: PlannerMeta, id: string, taskName: string): PlannerMeta {
  const routine = meta.routines.find((item) => item.id === id);
  if (!routine) return meta;
  return setRoutineTasks(
    meta,
    id,
    routine.taskNames.filter((name) => normaliseName(name) !== normaliseName(taskName)),
  );
}

/** Move a task one step earlier/later in the routine's execution order. */
export function moveRoutineTask(
  meta: PlannerMeta,
  id: string,
  taskName: string,
  delta: -1 | 1,
): PlannerMeta {
  const routine = meta.routines.find((item) => item.id === id);
  if (!routine) return meta;
  const index = routine.taskNames.findIndex(
    (name) => normaliseName(name) === normaliseName(taskName),
  );
  if (index === -1) return meta;
  const next = index + delta;
  if (next < 0 || next >= routine.taskNames.length) return meta;
  const taskNames = [...routine.taskNames];
  [taskNames[index], taskNames[next]] = [taskNames[next], taskNames[index]];
  return setRoutineTasks(meta, id, taskNames);
}

export function toggleRoutinePaused(meta: PlannerMeta, id: string): PlannerMeta {
  return {
    ...meta,
    routines: meta.routines.map((routine) =>
      routine.id === id ? { ...routine, paused: !routine.paused } : routine,
    ),
  };
}

/** Chore names of a routine in execution order. */
export function routineTaskOrder(meta: PlannerMeta, id: string): string[] {
  return meta.routines.find((routine) => routine.id === id)?.taskNames ?? [];
}

/**
 * Which routine a chore belongs to.
 *
 * The registry wins (an explicit membership, orderable and rename-safe), and a
 * ChoreOps label is the fallback so chores the household already labelled keep
 * grouping before they are adopted into the registry.
 */
export function routineIdForTask(
  meta: PlannerMeta,
  taskName: string,
  labelFallback?: string | null,
): string | null {
  const key = normaliseName(taskName);
  if (key) {
    const owner = meta.routines.find((routine) =>
      routine.taskNames.some((name) => normaliseName(name) === key),
    );
    if (owner) return owner.id;
  }
  const label = (labelFallback ?? '').trim();
  if (!label) return null;
  const known = findRoutine(meta, label);
  // Unknown labels still group (legacy ChoreOps labels); `routine:slug` is the
  // synthetic id the view uses until the routine is adopted.
  return known ? known.id : `routine:${routineSlug(label)}`;
}

/**
 * Adopt existing ChoreOps labels as routines.
 *
 * Migration requirement: a household that already named routines in ChoreOps
 * must keep them. Nothing is renamed in ChoreOps and no points move; the labels
 * simply become ordered routine definitions with their current chores.
 */
export function adoptLabels(
  meta: PlannerMeta,
  groups: Array<{ label: string; taskNames: string[] }>,
): PlannerMeta {
  let next = meta;
  for (const group of groups) {
    const label = group.label.trim();
    if (!label) continue;
    const upserted = upsertRoutine(next, label);
    next = upserted.meta;
    for (const taskName of group.taskNames) {
      next = addRoutineTask(next, upserted.routine.id, taskName);
    }
  }
  return next;
}

/** Drop routine entries for chores that no longer exist in ChoreOps. */
export function pruneRoutineTasks(meta: PlannerMeta, knownChoreNames: string[]): PlannerMeta {
  const known = new Set(knownChoreNames.map((name) => normaliseName(name)));
  let changed = false;
  const routines = meta.routines.map((routine) => {
    const taskNames = routine.taskNames.filter((name) => known.has(normaliseName(name)));
    if (taskNames.length === routine.taskNames.length) return routine;
    changed = true;
    return { ...routine, taskNames };
  });
  return changed ? { ...meta, routines } : meta;
}

/** Paused routine ids carried over from the old per-device localStorage flag. */
export function importLegacyPauses(meta: PlannerMeta, ids: string[]): PlannerMeta {
  if (ids.length === 0) return meta;
  let changed = false;
  const routines = meta.routines.map((routine) => {
    if (!ids.includes(routine.id) || routine.paused) return routine;
    changed = true;
    return { ...routine, paused: true };
  });
  return changed ? { ...meta, routines } : meta;
}

/* -------------------------------------------------------------------------- */
/* Mission progress                                                            */
/* -------------------------------------------------------------------------- */

export function missionForUser(
  meta: PlannerMeta,
  userName: string | null | undefined,
): MissionProgress | null {
  const key = normaliseName(userName);
  if (!key) return null;
  return meta.missions[key] ?? null;
}

/**
 * Record one finished routine step. Idempotent: a repeated tap (or a page
 * refresh replaying the same step) cannot count twice, which is what keeps
 * "2 of 4" honest.
 */
export function markMissionTaskDone(
  meta: PlannerMeta,
  userName: string,
  routineId: string,
  taskName: string,
): PlannerMeta {
  const key = normaliseName(userName);
  if (!key) return meta;
  const now = Date.now();
  const current = meta.missions[key];
  // A stale mission screen must not write into another routine's run.
  if (current && current.routineId !== routineId) return meta;
  const completed = current?.completed ?? [];
  if (completed.some((name) => normaliseName(name) === normaliseName(taskName))) {
    return meta;
  }
  return {
    ...meta,
    missions: {
      ...meta.missions,
      [key]: {
        routineId,
        completed: [...completed, taskName],
        startedAt: current?.startedAt ?? now,
        updatedAt: now,
      },
    },
  };
}

/** Start (or restart) a run through one routine. */
export function startMission(meta: PlannerMeta, userName: string, routineId: string): PlannerMeta {
  const key = normaliseName(userName);
  if (!key) return meta;
  const current = meta.missions[key];
  if (current && current.routineId === routineId) return meta;
  const now = Date.now();
  return {
    ...meta,
    missions: {
      ...meta.missions,
      [key]: { routineId, completed: [], startedAt: now, updatedAt: now },
    },
  };
}

export function clearMission(meta: PlannerMeta, userName: string): PlannerMeta {
  const key = normaliseName(userName);
  if (!key || !meta.missions[key]) return meta;
  const missions = { ...meta.missions };
  delete missions[key];
  return { ...meta, missions };
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
    completed.some((other) => normaliseName(other) === normaliseName(name)),
  ).length;
  return { done, total: order.length };
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tolerant parse: a stale or partial document must never crash the board. */
export function sanitizePlannerMeta(raw: unknown): PlannerMeta {
  const base = emptyMeta();
  if (!isRecord(raw)) return base;

  const routines: RoutineDefinition[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.routines) ? raw.routines : []) {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name.trim()) continue;
    const name = item.name.trim();
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : routineSlug(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const taskNames = Array.isArray(item.taskNames)
      ? item.taskNames.filter((name): name is string => typeof name === 'string' && !!name.trim())
      : [];
    routines.push({
      id,
      name,
      icon: typeof item.icon === 'string' && item.icon ? item.icon : '\u23F0',
      taskNames,
      ...(item.paused === true ? { paused: true } : {}),
    });
  }

  const missions: Record<string, MissionProgress> = {};
  if (isRecord(raw.missions)) {
    for (const [user, value] of Object.entries(raw.missions)) {
      if (!isRecord(value) || typeof value.routineId !== 'string') continue;
      const completed = Array.isArray(value.completed)
        ? value.completed.filter((name): name is string => typeof name === 'string')
        : [];
      missions[normaliseName(user)] = {
        routineId: value.routineId,
        completed,
        startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      };
    }
  }

  return { version: PLANNER_META_VERSION, routines, missions };
}

/** Instant read for first paint; the async read replaces it with the server copy. */
export function loadPlannerMetaSync(): PlannerMeta {
  return sanitizePlannerMeta(loadDataSync<unknown>(PLANNER_META_KEY, null));
}

export async function loadPlannerMeta(): Promise<PlannerMeta> {
  return sanitizePlannerMeta(await loadData<unknown>(PLANNER_META_KEY, null));
}

/**
 * Persist the document. The result is returned rather than swallowed: a save
 * that only reached localStorage must be reported to the household instead of
 * looking like it was stored.
 */
export function savePlannerMeta(meta: PlannerMeta): Promise<PersistenceResult> {
  return saveData(PLANNER_META_KEY, meta);
}
