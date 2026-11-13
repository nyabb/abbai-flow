/** Read completed ChoreOps status transitions retained by Home Assistant. */
import { haFetch } from './ha-rest';

export interface ChoreOpsChoreHistoryEntity {
  entityId: string;
  choreName: string;
  points: number | null;
}

export interface ChoreOpsChoreHistoryEntry {
  id: string;
  entityId: string;
  choreName: string;
  completedAt: string;
  completedAtMs: number;
  points: number | null;
}

interface HistoryState {
  entity_id?: unknown;
  state?: unknown;
  last_changed?: unknown;
  attributes?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isCompletedState(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const state = value.trim().toLowerCase();
  if (state === 'completed_by_other') return false;
  return /^(approved|completed|done)(?:$|_)/.test(state);
}

/** Convert HA's grouped state-history response into per-chore completions. */
export function parseChoreOpsChoreHistory(
  value: unknown,
  entities: ChoreOpsChoreHistoryEntity[],
): ChoreOpsChoreHistoryEntry[] {
  if (!Array.isArray(value) || entities.length === 0) return [];

  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const groups = value.flatMap((group) => (Array.isArray(group) ? group : [group]));
  const history: ChoreOpsChoreHistoryEntry[] = [];

  for (const raw of groups) {
    if (!isRecord(raw)) continue;
    const state = raw as HistoryState;
    const entityId = typeof state.entity_id === 'string' ? state.entity_id : '';
    const entity = entityById.get(entityId);
    if (!entity || !isCompletedState(state.state)) continue;

    const completedAt = typeof state.last_changed === 'string' ? state.last_changed : '';
    const completedAtMs = Date.parse(completedAt);
    if (!Number.isFinite(completedAtMs)) continue;

    const attributes = isRecord(state.attributes) ? state.attributes : {};
    const choreName =
      (typeof attributes.chore_name === 'string' && attributes.chore_name.trim()) ||
      entity.choreName;
    history.push({
      id: `${entityId}:${completedAt}`,
      entityId,
      choreName,
      completedAt,
      completedAtMs,
      points: numeric(attributes.default_points) ?? entity.points,
    });
  }

  return history.sort((left, right) => right.completedAtMs - left.completedAtMs);
}

/** Fetch all recorded transitions for the selected child's chore status sensors. */
export async function fetchChoreOpsChoreHistory(
  entities: ChoreOpsChoreHistoryEntity[],
): Promise<ChoreOpsChoreHistoryEntry[]> {
  if (entities.length === 0) return [];

  const query = new URLSearchParams({
    filter_entity_id: entities.map((entity) => entity.entityId).join(','),
    end_time: new Date().toISOString(),
  });
  const history = await haFetch(
    `/api/history/period/${encodeURIComponent(new Date(0).toISOString())}?${query.toString()}`,
  );
  return parseChoreOpsChoreHistory(history, entities);
}
