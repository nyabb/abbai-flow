/**
 * Planner domain rules — the single implementation shared by the browser and
 * the server.
 *
 * Why this file exists: reward pursuits (saving → achieved → given) and routine
 * progress must be reduced in exactly one place. The app imports it directly;
 * `npm run build:server` compiles this file to CommonJS so `server/app.cjs` runs
 * the same code for `POST /api/planner/mutate`. A client can therefore never
 * invent a state the server would have rejected.
 */
export interface Redemption {
  id: string;
  user: string;
  reward: string;
  rewardLabel: string;
  cost: number;
  points: number;
  state: RedemptionState;
  createdAt: number;
  achievedAt?: number;
  fulfilledAt?: number;
  fulfilledBy?: string;
}

export type RedemptionState = 'saving' | 'awaiting_fulfilment' | 'fulfilled';

export interface RoutineDefinition {
  id: string;
  name: string;
  icon: string;
  taskNames: string[];
  paused?: boolean;
}

export interface MissionProgress {
  routineId: string;
  completed: string[];
  startedAt: number;
  updatedAt: number;
}

export interface PlannerMeta {
  version: number;
  routines: RoutineDefinition[];
  missions: Record<string, MissionProgress>;
}

export type PlannerTarget = 'meta' | 'redemptions';

/** One operation the UI (or the server) can apply to a planner document. */
export type PlannerOp =
  | { type: 'addPoints'; user: string; reward: string; cost: number; amount: number; at?: number }
  | { type: 'release'; id: string | null }
  | { type: 'fulfil'; id: string | null; by?: string; at?: number }
  | { type: 'startMission'; user: string; routineId: string }
  | { type: 'markStep'; user: string; routineId: string; taskName: string }
  | { type: 'clearMission'; user: string }
  | { type: 'toggleRoutinePaused'; id: string; name?: string }
  | { type: 'upsertRoutine'; name: string; icon?: string }
  | { type: 'addRoutineTask'; id: string; taskName: string }
  | { type: 'removeRoutineTask'; id: string; taskName: string }
  | { type: 'adoptLabels'; groups: Array<{ label: string; taskNames: string[] }> }
  | { type: 'replace' };

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

/** Comparison key for names: trimmed, collapsed spaces, lower-cased. */
export function normaliseName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Alias kept for the reward vocabulary. */
export const normalise = normaliseName;

/** Stable identifier for a routine name (case/space/accent insensitive). */
export function routineSlug(name: string): string {
  const slug = normaliseName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'routine';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* -------------------------------------------------------------------------- */
/* Reward redemptions                                                          */
/* -------------------------------------------------------------------------- */

export function activeRedemption(
  redemptions: Redemption[],
  user: string | null | undefined,
  reward: string | null | undefined,
): Redemption | null {
  const userKey = normaliseName(user);
  const rewardKey = normaliseName(reward);
  if (!userKey || !rewardKey) return null;
  return (
    redemptions.find(
      (item) => item.user === userKey && item.reward === rewardKey && item.state !== 'fulfilled',
    ) ?? null
  );
}

/**
 * Put points towards a reward. Clamped to what the goal still needs, so a
 * finished goal can never absorb a second allocation.
 */
export function addPoints(
  redemptions: Redemption[],
  input: { user: string; reward: string; cost: number; amount: number; at?: number },
): { redemptions: Redemption[]; redemption: Redemption | null } {
  const user = normaliseName(input.user);
  const reward = normaliseName(input.reward);
  if (!user || !reward) return { redemptions, redemption: null };

  const at = input.at ?? Date.now();
  const cost = Math.max(0, Math.round(input.cost));
  const existing = activeRedemption(redemptions, user, reward);
  if (existing && existing.state === 'awaiting_fulfilment') {
    return { redemptions, redemption: existing };
  }

  const already = existing ? existing.points : 0;
  const give = Math.max(0, Math.min(Math.round(input.amount), Math.max(0, cost - already)));
  if (give <= 0) return { redemptions, redemption: existing ?? null };

  const points = already + give;
  const state: RedemptionState = cost > 0 && points >= cost ? 'awaiting_fulfilment' : 'saving';
  const redemption: Redemption = {
    id: existing ? existing.id : newId('r'),
    user,
    reward,
    rewardLabel: input.reward.trim(),
    cost,
    points,
    state,
    createdAt: existing ? existing.createdAt : at,
    ...(state === 'awaiting_fulfilment' ? { achievedAt: at } : {}),
  };

  return {
    redemptions: existing
      ? redemptions.map((item) => (item.id === existing.id ? redemption : item))
      : [...redemptions, redemption],
    redemption,
  };
}

/** Undo a pursuit; the points return to the child's spendable balance. */
export function releaseRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
): Redemption[] {
  if (!id) return redemptions;
  return redemptions.filter((item) => item.id !== id || item.state === 'fulfilled');
}

/**
 * Parent hands the reward over. Only a goal that actually reached its cost can be
 * settled, and only once — a double tap cannot record two gifts.
 */
export function fulfilRedemption(
  redemptions: Redemption[],
  id: string | null | undefined,
  by: string | undefined,
  at: number = Date.now(),
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

export function sanitizeRedemptions(raw: unknown): Redemption[] {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.user !== 'string' || typeof item.reward !== 'string') continue;
    const id = typeof item.id === 'string' && item.id ? item.id : newId('r');
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
      user: normaliseName(item.user),
      reward: normaliseName(item.reward),
      rewardLabel:
        typeof item.rewardLabel === 'string' && item.rewardLabel ? item.rewardLabel : item.reward,
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

/* -------------------------------------------------------------------------- */
/* Routines                                                                    */
/* -------------------------------------------------------------------------- */

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

/** Create a routine, or reuse the one whose name already matches. */
export function upsertRoutine(
  meta: PlannerMeta,
  name: string,
  icon: string = '\u23F0',
): { meta: PlannerMeta; routine: RoutineDefinition; created: boolean } {
  const clean = name.trim().replace(/\s+/g, ' ');
  const existing = findRoutine(meta, clean);
  if (existing) return { meta, routine: existing, created: false };

  const routine = {
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

export function renameRoutine(meta: PlannerMeta, id: string, name: string): PlannerMeta {
  return {
    ...meta,
    routines: meta.routines.map((routine) => (routine.id === id ? { ...routine, name } : routine)),
  };
}

export function setRoutineTasks(meta: PlannerMeta, id: string, taskNames: string[]): PlannerMeta {
  const seen = new Set();
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

/** Adopt existing ChoreOps labels as routines (idempotent). */
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

/**
 * Record one finished routine step. Idempotent, and a stale mission screen from
 * another routine cannot write into this run.
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
  if (current && current.routineId !== routineId) return meta;
  const completed = current ? current.completed : [];
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
        startedAt: current ? current.startedAt : now,
        updatedAt: now,
      },
    },
  };
}

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

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

export function emptyMeta(): PlannerMeta {
  return { version: 1, routines: [], missions: {} };
}

/** Tolerant parse: a stale or partial document must never break the screen. */
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
      ? item.taskNames.filter((entry) => typeof entry === 'string' && !!entry.trim())
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
        ? value.completed.filter((name) => typeof name === 'string')
        : [];
      missions[normaliseName(user)] = {
        routineId: value.routineId,
        completed,
        startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      };
    }
  }

  return { version: 1, routines, missions };
}

/* -------------------------------------------------------------------------- */
/* Operation dispatch — used by the server and by the offline fallback          */
/* -------------------------------------------------------------------------- */

/**
 * Apply one planner operation to a document.
 *
 * Returns `{ document, changed, result }`. Unknown operations throw, so a client
 * typo can never be mistaken for a no-op.
 */
export function applyPlannerOp(
  target: PlannerTarget,
  document: unknown,
  op: PlannerOp,
): { document: unknown; changed: boolean; result: unknown } {
  if (target === 'redemptions') {
    const current = sanitizeRedemptions(document);
    switch (op.type) {
      case 'addPoints': {
        const next = addPoints(current, op);
        return {
          document: next.redemptions,
          changed: next.redemptions !== current,
          result: next.redemption,
        };
      }
      case 'release': {
        const next = releaseRedemption(current, op.id);
        return { document: next, changed: next !== current, result: null };
      }
      case 'fulfil': {
        const next = fulfilRedemption(current, op.id, op.by, op.at);
        return {
          document: next.redemptions,
          changed: next.redemptions !== current,
          result: next.redemption,
        };
      }
      case 'replace':
        return { document: current, changed: false, result: null };
      default:
        throw new Error(`Unknown redemption operation: ${op.type}`);
    }
  }

  if (target === 'meta') {
    const current = sanitizePlannerMeta(document);
    switch (op.type) {
      case 'startMission':
        return {
          document: startMission(current, op.user, op.routineId),
          changed: true,
          result: null,
        };
      case 'markStep':
        return {
          document: markMissionTaskDone(current, op.user, op.routineId, op.taskName),
          changed: true,
          result: null,
        };
      case 'clearMission':
        return { document: clearMission(current, op.user), changed: true, result: null };
      case 'toggleRoutinePaused': {
        // A routine that only exists as a ChoreOps label has no registry entry
        // yet; adopt it first so the pause is not silently dropped.
        let next = current;
        let target = findRoutine(next, op.id);
        if (!target && typeof op.name === 'string' && op.name.trim()) {
          const upserted = upsertRoutine(next, op.name);
          next = upserted.meta;
          target = upserted.routine;
        }
        if (!target) return { document: current, changed: false, result: null };
        return {
          document: toggleRoutinePaused(next, target.id),
          changed: true,
          result: target.id,
        };
      }
      case 'upsertRoutine': {
        const upserted = upsertRoutine(current, op.name, op.icon);
        return { document: upserted.meta, changed: true, result: upserted.routine };
      }
      case 'addRoutineTask':
        return {
          document: addRoutineTask(current, op.id, op.taskName),
          changed: true,
          result: null,
        };
      case 'removeRoutineTask':
        return {
          document: removeRoutineTask(current, op.id, op.taskName),
          changed: true,
          result: null,
        };
      case 'adoptLabels':
        return { document: adoptLabels(current, op.groups), changed: true, result: null };
      default:
        throw new Error(`Unknown planner operation: ${op.type}`);
    }
  }

  throw new Error(`Unknown planner target: ${target}`);
}
