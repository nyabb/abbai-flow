import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTaskLists } from './useTaskLists';

const iCloudMocks = vi.hoisted(() => ({
  loadLists: vi.fn(),
  fetchTaskLists: vi.fn(),
  updateReminder: vi.fn(),
}));

vi.mock('../api/integration-settings', () => ({
  loadICloudRemindersLists: iCloudMocks.loadLists,
  fetchICloudRemindersTaskLists: iCloudMocks.fetchTaskLists,
  getCachedICloudRemindersLists: () => null,
  getCachedICloudRemindersTaskLists: () => ({ lists: [], revisions: {} }),
  updateICloudReminder: iCloudMocks.updateReminder,
}));

vi.mock('./useLocalTasks', () => ({
  useLocalTasks: () => ({
    getTasksForList: () => [],
    toggleTask: vi.fn(),
  }),
}));

const availableLists = [
  { key: 'icloud-grocery', title: 'Groceries', deleted: false, isGroup: false },
  { key: 'icloud-tasks-a', title: 'Tasks A', deleted: false, isGroup: false },
  { key: 'icloud-tasks-b', title: 'Tasks B', deleted: false, isGroup: false },
];

const reminderFor = (listKey: string) => ({
  id: `Reminder/${listKey}`,
  list_id: `List/${listKey}`,
  title: `Reminder from ${listKey}`,
  desc: '',
  completed: false,
  completed_date: null,
  due_date: null,
  start_date: null,
  priority: 0,
  flagged: false,
  all_day: false,
  deleted: false,
});

beforeEach(() => {
  iCloudMocks.loadLists.mockReset();
  iCloudMocks.fetchTaskLists.mockReset();
  iCloudMocks.updateReminder.mockReset();
  iCloudMocks.loadLists.mockResolvedValue({ ok: true, state: 'authenticated', lists: availableLists });
  iCloudMocks.fetchTaskLists.mockImplementation(async (listKeys: string[]) => ({
    ok: true,
    state: 'fetched',
    changed: true,
    revisions: Object.fromEntries(listKeys.map((key) => [key, 1])),
    lists: listKeys.map((listKey) => ({
      key: listKey,
      title: listKey,
      scope: 'private',
      deleted: false,
      isGroup: false,
      count: 1,
      reminders: [reminderFor(listKey)],
    })),
  }));
});

describe('useTaskLists', () => {
  it('fetches selected lists in one request when the caller rerenders with fresh arrays', async () => {
    const { rerender } = renderHook(() => useTaskLists([], [], 0));

    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(1));
    const fetchesAfterFirstLoad = iCloudMocks.fetchTaskLists.mock.calls.length;

    rerender();
    rerender();
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(1);
    expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(fetchesAfterFirstLoad);
    expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledWith(
      ['icloud-tasks-a', 'icloud-tasks-b'],
      {},
    );
  });

  it('refreshes the batch when selected task lists change', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useTaskLists([], ids),
      { initialProps: { ids: ['icloud-tasks-a'] } },
    );

    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(1));
    rerender({ ids: ['icloud-tasks-a', 'icloud-tasks-b'] });

    await waitFor(() => expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(2));
    expect(iCloudMocks.fetchTaskLists.mock.calls.map(([keys]) => keys)).toEqual([
      ['icloud-tasks-a'],
      ['icloud-tasks-a', 'icloud-tasks-b'],
    ]);
  });

  it('reads only selected task lists and excludes lists selected for groceries', async () => {
    const { result } = renderHook(() => useTaskLists(
      ['icloud-grocery'],
      ['icloud-tasks-a', 'icloud-grocery'],
    ));

    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledWith(['icloud-tasks-a'], {});
    expect(result.current.items.map((item) => item.listId)).toEqual(['icloud-tasks-a']);
  });

  it('uses all non-grocery lists when no task lists are selected', async () => {
    renderHook(() => useTaskLists(['icloud-grocery'], []));

    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(1));
    expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledWith(
      ['icloud-tasks-a', 'icloud-tasks-b'],
      {},
    );
  });

  it('keeps existing task rows when the server reports no changes', async () => {
    iCloudMocks.fetchTaskLists.mockResolvedValue({
      ok: true,
      state: 'fetched',
      changed: true,
      revisions: { 'icloud-tasks-a': 1 },
      lists: [{ key: 'icloud-tasks-a', reminders: [reminderFor('icloud-tasks-a')] }],
    });
    const { result } = renderHook(() => useTaskLists([], ['icloud-tasks-a']));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    iCloudMocks.fetchTaskLists.mockResolvedValue({
      ok: true,
      state: 'unchanged',
      changed: false,
      revisions: { 'icloud-tasks-a': 1 },
      lists: [],
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(2));
    expect(iCloudMocks.fetchTaskLists).toHaveBeenLastCalledWith(
      ['icloud-tasks-a'],
      { 'icloud-tasks-a': 1 },
    );
    expect(result.current.items).toHaveLength(1);
  });

  it('keeps the cached task snapshot and revision when a refresh finds no server changes', async () => {
    iCloudMocks.fetchTaskLists
      .mockResolvedValueOnce({
        ok: true,
        state: 'fetched',
        changed: true,
        revisions: { 'icloud-tasks-a': 42 },
        lists: [{ key: 'icloud-tasks-a', reminders: [reminderFor('icloud-tasks-a')] }],
      })
      .mockResolvedValueOnce({
        ok: true,
        state: 'unchanged',
        changed: false,
        revisions: { 'icloud-tasks-a': 42 },
        lists: [],
      });

    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) => useTaskLists([], ['icloud-tasks-a'], refreshKey),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ refreshKey: 1 });
    await waitFor(() => expect(iCloudMocks.fetchTaskLists).toHaveBeenCalledTimes(2));

    expect(iCloudMocks.fetchTaskLists).toHaveBeenLastCalledWith(
      ['icloud-tasks-a'],
      { 'icloud-tasks-a': 42 },
    );
    expect(result.current.items).toHaveLength(1);
  });
});
