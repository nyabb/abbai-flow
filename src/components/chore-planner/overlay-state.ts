import type { ChoresManReward } from '../../types/choresman';

/**
 * The planner can show one sheet at a time. Keeping each sheet's context in
 * the same value prevents stale ids and unrelated sheets from coexisting.
 */
export type PlannerOverlayState =
  | { type: 'closed' }
  | { type: 'form'; editingId: string | null }
  | { type: 'actions'; taskId: string; fromRoutine: boolean; confirmingDelete: boolean }
  | { type: 'claim'; taskId: string }
  | { type: 'award'; taskId: string }
  | { type: 'filter' }
  | { type: 'goals'; memberId: string }
  | { type: 'reward-form'; editingReward: string | null }
  | { type: 'reward-actions'; reward: ChoresManReward }
  | { type: 'assign'; reward: ChoresManReward }
  | { type: 'reward-given'; name: string }
  | { type: 'create' };

export type PlannerOverlayEvent =
  | { type: 'close' }
  | { type: 'open-form'; editingId?: string | null }
  | { type: 'open-actions'; taskId: string; fromRoutine?: boolean }
  | { type: 'confirm-delete' }
  | { type: 'open-claim'; taskId: string }
  | { type: 'open-award'; taskId: string }
  | { type: 'open-filter' }
  | { type: 'open-goals'; memberId: string }
  | { type: 'open-reward-form'; editingReward?: string | null }
  | { type: 'open-reward-actions'; reward: ChoresManReward }
  | { type: 'open-assign'; reward: ChoresManReward }
  | { type: 'open-reward-given'; name: string }
  | { type: 'open-create' };

export const initialPlannerOverlay: PlannerOverlayState = { type: 'closed' };

/** Apply one user intent to the currently visible planner sheet. */
export function plannerOverlayReducer(
  _state: PlannerOverlayState,
  event: PlannerOverlayEvent,
): PlannerOverlayState {
  switch (event.type) {
    case 'close':
      return { type: 'closed' };
    case 'open-form':
      return { type: 'form', editingId: event.editingId ?? null };
    case 'open-actions':
      return {
        type: 'actions',
        taskId: event.taskId,
        fromRoutine: event.fromRoutine ?? false,
        confirmingDelete: false,
      };
    case 'confirm-delete':
      return _state.type === 'actions' ? { ..._state, confirmingDelete: true } : _state;
    case 'open-claim':
      return { type: 'claim', taskId: event.taskId };
    case 'open-award':
      return { type: 'award', taskId: event.taskId };
    case 'open-filter':
      return { type: 'filter' };
    case 'open-goals':
      return { type: 'goals', memberId: event.memberId };
    case 'open-reward-form':
      return { type: 'reward-form', editingReward: event.editingReward ?? null };
    case 'open-reward-actions':
      return { type: 'reward-actions', reward: event.reward };
    case 'open-assign':
      return { type: 'assign', reward: event.reward };
    case 'open-reward-given':
      return { type: 'reward-given', name: event.name };
    case 'open-create':
      return { type: 'create' };
  }
}
