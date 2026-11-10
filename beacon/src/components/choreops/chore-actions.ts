/**
 * Pure helpers behind the chore and reward cards.
 *
 * Extracted from `ChoreOpsCards.tsx` so that file only exports components
 * (React Fast Refresh) and so the status rules can be tested without rendering.
 */
import type { CSSProperties } from 'react';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsChore } from '../../types/choreops';

const DONE_STATUS = /^(approved|completed|done)/i;

/** ChoreOps states that mean "the child is done, a parent must sign off". */
const AWAITING_REVIEW_STATUS = /(claim|review|progress|submit)/i;

/** Expose the member colour to CSS without allocating a new object per render. */
export function memberColorVars(member: FamilyMember | null): CSSProperties {
  return member ? ({ '--member-color': member.color } as CSSProperties) : ({} as CSSProperties);
}

export interface PrimaryAction {
  kind: 'claim' | 'approve';
  entityId: string;
}

/** True when the chore is finished for this user, so no action is offered. */
export function isChoreDone(status: string): boolean {
  return DONE_STATUS.test(status);
}

/**
 * Pick the single most useful action for a chore.
 *
 * ChoreOps publishes claim *and* approve buttons for every chore/user pair
 * regardless of state, so the buttons alone say nothing about what is
 * actionable. The status does: a chore waiting for review gets Approve, an
 * untouched one gets Claim. Picking approve just because the button exists
 * would have shown "Approve" to the child who still has to do the chore.
 */
export function chorePrimaryAction(chore: ChoreOpsChore): PrimaryAction | null {
  if (isChoreDone(chore.status)) return null;

  const claim = chore.actions.claim;
  const approve = chore.actions.approve;
  const awaitingReview = AWAITING_REVIEW_STATUS.test(chore.status);

  if (awaitingReview && approve) return { kind: 'approve', entityId: approve };
  if (claim) return { kind: 'claim', entityId: claim };
  if (approve) return { kind: 'approve', entityId: approve };
  return null;
}
