import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Routine } from '../types/family';
import { useRoutines } from './useRoutines';

const store = vi.hoisted(() => ({
  getRoutines: vi.fn(async () => [] as Routine[]),
  getRoutinesForMember: vi.fn(async () => [] as Routine[]),
  getRoutineTaskCompletionsToday: vi.fn(async () => []),
  addRoutine: vi.fn(async () => {}),
  updateRoutine: vi.fn(async () => {}),
  removeRoutine: vi.fn(async () => {}),
  completeRoutineTask: vi.fn(async () => true),
  uncompleteRoutineTask: vi.fn(async () => true),
}));

vi.mock('../api/family', () => ({
  FamilyStore: class {
    getRoutines = store.getRoutines;
    getRoutinesForMember = store.getRoutinesForMember;
    getRoutineTaskCompletionsToday = store.getRoutineTaskCompletionsToday;
    addRoutine = store.addRoutine;
    updateRoutine = store.updateRoutine;
    removeRoutine = store.removeRoutine;
    completeRoutineTask = store.completeRoutineTask;
    uncompleteRoutineTask = store.uncompleteRoutineTask;
  },
}));

const routine: Routine = {
  id: 'routine-1',
  name: 'Morning routine',
  member_id: 'child-1',
  time_of_day: 'morning',
  tasks: [{ id: 'task-1', name: 'Get dressed', order: 0 }],
};

describe('useRoutines timeline completion guard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 0, 1, 8, 0));
    store.getRoutines.mockResolvedValue([routine]);
    store.getRoutinesForMember.mockResolvedValue([routine]);
    store.getRoutineTaskCompletionsToday.mockResolvedValue([]);
    store.completeRoutineTask.mockClear();
    store.uncompleteRoutineTask.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists a routine task during its scheduled time block', async () => {
    const { result } = renderHook(() => useRoutines());
    await waitFor(() => expect(result.current.routines).toEqual([routine]));

    let saved = false;
    await act(async () => {
      saved = await result.current.toggleTask(routine, 'task-1');
    });

    expect(saved).toBe(true);
    expect(store.completeRoutineTask).toHaveBeenCalledWith('routine-1', 'task-1', 'child-1');
  });

  it('does not persist a routine task outside its scheduled time block', async () => {
    vi.setSystemTime(new Date(2024, 0, 1, 20, 0));
    const { result } = renderHook(() => useRoutines());
    await waitFor(() => expect(result.current.routines).toEqual([routine]));

    let saved = true;
    await act(async () => {
      saved = await result.current.toggleTask(routine, 'task-1');
    });

    expect(saved).toBe(false);
    expect(store.completeRoutineTask).not.toHaveBeenCalled();
    expect(store.uncompleteRoutineTask).not.toHaveBeenCalled();
  });
});
