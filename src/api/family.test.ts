import { afterEach, describe, expect, it } from 'vitest';
import { FamilyStore } from './family';
import type { ChoreOpsUser } from '../types/choreops';
import type { FamilyMember } from '../types/family';

const choreOpsUser: ChoreOpsUser = {
  name: 'Maya',
  slug: 'maya',
  points: 24,
  dueToday: 3,
  claimed: 1,
  approved: 2,
  completedToday: 4,
};

describe('FamilyStore.syncChoreOpsMembers', () => {
  afterEach(() => localStorage.clear());

  it('merges ChoreOps state into the linked profile and preserves Abbai Flow fields', async () => {
    const linkedMember: FamilyMember = {
      id: 'member-1',
      name: 'Maya',
      avatar: '👧',
      color: '#3b82f6',
      role: 'parent',
      pin: '0123',
      choreops_user: 'Maya',
    };
    localStorage.setItem('beacon_family_members', JSON.stringify([linkedMember]));

    const store = new FamilyStore();
    expect(await store.syncChoreOpsMembers([choreOpsUser])).toBe(true);
    expect(await store.syncChoreOpsMembers([choreOpsUser])).toBe(false);

    const members = JSON.parse(
      localStorage.getItem('beacon_family_members') ?? '[]',
    ) as FamilyMember[];
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: 'member-1',
      role: 'parent',
      pin: '0123',
      choreops_user: 'Maya',
      choreops_state: {
        points: 24,
        dueToday: 3,
        claimed: 1,
        approved: 2,
        completedToday: 4,
      },
    });
  });

  it('does not create Abbai Flow members for unlinked ChoreOps users', async () => {
    const store = new FamilyStore();

    expect(await store.syncChoreOpsMembers([choreOpsUser])).toBe(false);
    expect(localStorage.getItem('beacon_family_members')).toBeNull();
  });
});
