import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTaskLists } from './useTaskLists';

const iCloudMocks = vi.hoisted(() => ({
  loadLists: vi.fn(),
  fetchList: vi.fn(),
  updateReminder: vi.fn(),
}));

vi.mock('../api/integration-settings', () => ({
  loadICloudRemindersLists: iCloudMocks.loadLists,
  fetchICloudRemindersList: iCloudMocks.fetchList,
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
  iCloudMocks.fetchList.mockReset();
  iCloudMocks.updateReminder.mockReset();
  iCloudMocks.loadLists.mockResolvedValue({ ok: true, state: 'authenticated', lists: availableLists });
  iCloudMocks.fetchList.mockImplementation(async (listKey: string) => ({
    ok: true,
    state: 'fetched',
    lists: [{
      key: listKey,
      title: listKey,
      scope: 'private',
      deleted: false,
      isGroup: false,
      count: 1,
      reminders: [reminderFor(listKey)],
    }],
  }));
});

describe('useTaskLists', () => {
  /*
   * The hook receives settings arrays that may be recreated inline on each
   * render. Fetching should depend on their contents, not object identity.
   */
  it('fetches once when the caller passes fresh arrays with the same selections', async () => {
    const { rerender } = renderHook(() => useTaskLists([], [], 0));

    await waitFor(() => expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(iCloudMocks.fetchList).toHaveBeenCalledTimes(2));
    const fetchesAfterFirstLoad = iCloudMocks.fetchList.mock.calls.length;

    rerender();
    rerender();
    rerender();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(1);
    expect(iCloudMocks.fetchList).toHaveBeenCalledTimes(fetchesAfterFirstLoad);
  });

  it('refetches when the selected iCloud task lists change', async () => {
    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useTaskLists([], ids),
      { initialProps: { ids: ['icloud-tasks-a'] } },
    );

    await waitFor(() => expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(iCloudMocks.fetchList).toHaveBeenCalledTimes(1));

    rerender({ ids: ['icloud-tasks-a', 'icloud-tasks-b'] });

    await waitFor(() => expect(iCloudMocks.loadLists).toHaveBeenCalledTimes(2));
    expect(iCloudMocks.fetchList.mock.calls.map(([key]) => key)).toEqual([
      'icloud-tasks-a',
      'icloud-tasks-a',
      'icloud-tasks-b',
    ]);
  });

  it('reads only selected task lists and excludes lists selected for groceries', async () => {
    const { result } = renderHook(() => useTaskLists(
      ['icloud-grocery'],
      ['icloud-tasks-a', 'icloud-grocery'],
    ));

    await waitFor(() => expect(iCloudMocks.fetchList).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    expect(iCloudMocks.fetchList).toHaveBeenCalledWith('icloud-tasks-a');
    expect(result.current.items.map((item) => item.listId)).toEqual(['icloud-tasks-a']);
  });

  it('uses all non-grocery lists when no task lists are selected', async () => {
    renderHook(() => useTaskLists(['icloud-grocery'], []));

    await waitFor(() => expect(iCloudMocks.fetchList).toHaveBeenCalledTimes(2));

    expect(iCloudMocks.fetchList.mock.calls.map(([key]) => key)).toEqual([
      'icloud-tasks-a',
      'icloud-tasks-b',
    ]);
  });
});
