import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useDashboardTasks } from './useDashboardTasks';
import { haFetch, callHaService } from '../api/ha-rest';

vi.mock('../api/ha-rest', () => ({
  hasToken: () => true,
  haFetch: vi.fn(),
  callHaService: vi.fn(),
}));

vi.mock('./useLocalTasks', () => ({
  useLocalTasks: () => ({
    lists: [],
    tasks: [],
    getTasksForList: () => [],
  }),
}));

vi.mock('./useTaskmate', () => ({
  useTaskmate: () => ({ users: [], listByUser: {}, completions: [] }),
}));

const haFetchMock = vi.mocked(haFetch);
const callHaServiceMock = vi.mocked(callHaService);

const states = (...ids: string[]) =>
  ids.map((entity_id) => ({
    entity_id,
    state: '0',
    attributes: { friendly_name: entity_id.replace('todo.', '') },
  }));

beforeEach(() => {
  haFetchMock.mockReset();
  callHaServiceMock.mockReset();
  haFetchMock.mockResolvedValue(states('todo.tasks_a', 'todo.tasks_b', 'todo.grocery'));
  callHaServiceMock.mockResolvedValue({ service_response: {} });
});

describe('useDashboardTasks', () => {
  /*
   * Regression: the effect used to depend on the list arrays themselves. A
   * dependency array compares identity, so an inline `settings.taskListIds ?? []`
   * was a new array on every render, re-running the fetch forever -- 405 tests
   * passed while the browser was hammering /api/states.
   */
  it('fetches once even when the caller passes a fresh array on every render', async () => {
    const { rerender } = renderHook(() => useDashboardTasks(true, [], []));

    await waitFor(() => expect(haFetchMock).toHaveBeenCalled());
    const afterFirstFetch = haFetchMock.mock.calls.length;

    // Force further renders, each with brand new array literals.
    rerender();
    rerender();
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(haFetchMock.mock.calls.length).toBe(afterFirstFetch);
  });

  /* The counterpart: the guard must not be "never refetch". */
  it('refetches when the selection actually changes', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useDashboardTasks(true, [], ids),
      { initialProps: { ids: ['todo.tasks_a'] } },
    );

    await waitFor(() => expect(haFetchMock).toHaveBeenCalledTimes(1));

    rerender({ ids: ['todo.tasks_a', 'todo.tasks_b'] });

    await waitFor(() => expect(haFetchMock).toHaveBeenCalledTimes(2));
  });

  /*
   * A selection means exactly those lists: everything else is ignored, so a
   * newly added Home Assistant list cannot appear in the dashboard by accident.
   */
  it('reads only the selected task lists, minus anything chosen as grocery', async () => {
    renderHook(() => useDashboardTasks(true, ['todo.grocery'], ['todo.tasks_a']));

    await waitFor(() => expect(callHaServiceMock).toHaveBeenCalled());

    const fetched = callHaServiceMock.mock.calls.map(
      (call) => (call[2] as { entity_id: string }).entity_id,
    );
    expect(fetched).toEqual(['todo.tasks_a']);
  });

  /* With nothing selected, the old "any todo list that is not grocery" behaviour stands. */
  it('falls back to every non-grocery list when nothing is selected', async () => {
    renderHook(() => useDashboardTasks(true, ['todo.grocery'], []));

    await waitFor(() => expect(callHaServiceMock).toHaveBeenCalledTimes(2));

    const fetched = callHaServiceMock.mock.calls.map(
      (call) => (call[2] as { entity_id: string }).entity_id,
    );
    expect(fetched).toEqual(['todo.tasks_a', 'todo.tasks_b']);
  });
});
