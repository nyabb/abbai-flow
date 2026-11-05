import { describe, it, expect } from 'vitest';
import { chorePrimaryAction } from './ChoreOpsCards';
import type { ChoreOpsChore } from '../../types/choreops';

/**
 * ChoreOps publishes claim *and* approve buttons for every chore/user pair
 * regardless of state, so the button list cannot decide the verb. Getting this
 * wrong showed "Approve" on a chore nobody had done yet — i.e. let a child sign
 * off their own chore.
 */
function chore(overrides: Partial<ChoreOpsChore> = {}): ChoreOpsChore {
  return {
    id: 'c1',
    name: 'Afwassen',
    icon: null,
    status: 'available',
    assignee: 'Maya',
    points: null,
    canClaim: true,
    canApprove: true,
    actions: {
      claim: 'button.maya_choreops_claim_chore_afwassen',
      approve: 'button.maya_choreops_approve_chore_afwassen',
      disapprove: 'button.maya_choreops_disapprove_chore_afwassen',
    },
    ...overrides,
  };
}

describe('chorePrimaryAction', () => {
  it('offers Claim on an untouched chore, even though an approve button exists', () => {
    expect(chorePrimaryAction(chore())).toEqual({
      kind: 'claim',
      entityId: 'button.maya_choreops_claim_chore_afwassen',
    });
  });

  it.each(['pending', 'claimed', 'in_progress', 'submitted'])(
    'offers Approve while the chore is %s',
    (status) => {
      expect(chorePrimaryAction(chore({ status }))).toEqual({
        kind: 'approve',
        entityId: 'button.maya_choreops_approve_chore_afwassen',
      });
    },
  );

  it.each(['approved', 'completed', 'done'])('offers nothing once %s', (status) => {
    expect(chorePrimaryAction(chore({ status }))).toBeNull();
  });

  it('falls back to Approve when there is no claim button', () => {
    expect(chorePrimaryAction(chore({ actions: { approve: 'button.approve' } }))).toEqual({
      kind: 'approve',
      entityId: 'button.approve',
    });
  });

  it('returns null when ChoreOps exposes no action at all', () => {
    expect(chorePrimaryAction(chore({ actions: {} }))).toBeNull();
  });
});
