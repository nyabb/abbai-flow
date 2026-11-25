/** ChoresMan model helpers shared by the planner and its editor. */
export * from './chore-model/members';
export * from './chore-model/payloads';

import type { ChoresManChore } from '../types/choresman';

/** Whether a shared-first chore is currently available to the whole family. */
export function isChoreOpenToAnyone(
  chore: Pick<ChoresManChore, 'completionCriteria' | 'assignedUserNames'>,
): boolean {
  if ((chore.completionCriteria ?? '').trim().toLocaleLowerCase() !== 'shared_first') return false;
  const assigned = new Set(
    (chore.assignedUserNames ?? []).map((name) => name.trim().toLocaleLowerCase()).filter(Boolean),
  );
  return assigned.size > 1;
}
