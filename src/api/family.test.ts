import { afterEach, describe, expect, it } from 'vitest';
import { FamilyStore } from './family';
import { localDayKey } from './date-keys';

describe('FamilyStore legacy profile cleanup', () => {
  afterEach(() => localStorage.clear());

  it('removes the retired chore account link and keeps Abbai Flow profile fields', async () => {
    const legacyMember = {
      id: 'member-1',
      name: 'Maya',
      avatar: '👧',
      color: '#3b82f6',
      role: 'parent',
      pin: '0123',
      choreops_user: 'Maya',
      choreops_state: { points: 24, dueToday: 3, claimed: 1, approved: 2, completedToday: 4 },
    };
    localStorage.setItem('abbai_flow_family_members', JSON.stringify([legacyMember]));

    const store = new FamilyStore();
    const members = await store.getMembers();
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: 'member-1',
      role: 'parent',
      pin: '0123',
    });
    expect(members[0]).not.toHaveProperty('choreops_user');
    expect(members[0]).not.toHaveProperty('choreops_state');
    expect(JSON.parse(localStorage.getItem('abbai_flow_family_members') ?? '[]')[0]).not.toHaveProperty(
      'choreops_user',
    );
  });
});

describe('FamilyStore routines', () => {
  afterEach(() => localStorage.clear());

  it('persists recurring routines and supports member filtering, edits, and removal', async () => {
    const store = new FamilyStore();
    const routine = await store.addRoutine({
      name: 'Reading',
      member_id: 'child-1',
      time_of_day: 'evening',
      days_of_week: [1, 3],
      mission_points: 4,
      tasks: [{ id: 'task-1', name: 'Read a page', order: 0 }],
    });

    expect(routine.id).toBeTruthy();
    expect(await store.getRoutinesForMember('child-1')).toEqual([routine]);
    expect(await store.getRoutinesForMember('parent-1')).toEqual([]);
    expect(await store.updateRoutine(routine.id, { days_of_week: [2, 4] })).toMatchObject({
      days_of_week: [2, 4],
    });
    expect(await store.removeRoutine(routine.id)).toBe(true);
    expect(await store.removeRoutine(routine.id)).toBe(false);
    expect(await store.getRoutines()).toEqual([]);
  });

  it('saves one completion per task per day and can undo it', async () => {
    const store = new FamilyStore();

    expect(await store.completeRoutineTask('routine-1', 'task-1', 'child-1')).toBe(true);
    expect(await store.completeRoutineTask('routine-1', 'task-1', 'child-1')).toBe(true);
    expect(await store.getRoutineTaskCompletionsToday()).toHaveLength(1);
    expect(await store.uncompleteRoutineTask('routine-1', 'task-1', 'child-1')).toBe(true);
    expect(await store.uncompleteRoutineTask('routine-1', 'task-1', 'child-1')).toBe(false);
    expect(await store.getRoutineTaskCompletionsToday()).toEqual([]);
  });

  it('reserves a mission bonus once, can release a failed award, and rejects persisted duplicates', async () => {
    const store = new FamilyStore();
    const date = localDayKey();
    const persisted = {
      routine_id: 'already-awarded',
      member_id: 'child-1',
      date,
    };
    const expired = {
      routine_id: 'expired-award',
      member_id: 'child-1',
      date: localDayKey(Date.now() - 90 * 24 * 60 * 60 * 1000),
    };
    localStorage.setItem('abbai_flow_routine_mission_awards', JSON.stringify([persisted, expired]));

    expect(await store.claimRoutineMissionBonus('already-awarded', 'child-1', date)).toBe(false);
    expect(await store.claimRoutineMissionBonus('routine-1', 'child-1', date)).toBe(true);
    expect(await store.claimRoutineMissionBonus('routine-1', 'child-1', date)).toBe(false);
    await store.releaseRoutineMissionBonus('routine-1', 'child-1', date);
    expect(await store.claimRoutineMissionBonus('routine-1', 'child-1', date)).toBe(true);
    expect(JSON.parse(localStorage.getItem('abbai_flow_routine_mission_awards') ?? '[]')).toEqual([
      persisted,
      { routine_id: 'routine-1', member_id: 'child-1', date },
    ]);
  });
});
