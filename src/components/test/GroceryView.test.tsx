import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import { GroceryView } from '../GroceryView';

const mocks = vi.hoisted(() => ({
  fetchList: vi.fn(),
  loadLists: vi.fn(),
  getTasksForList: vi.fn(() => []),
  localLists: [] as Array<{ id: string; name: string }>,
  addTask: vi.fn(),
  toggleTask: vi.fn(),
  removeTask: vi.fn(),
}));

vi.mock('../../api/integration-settings', () => ({
  createICloudReminder: vi.fn(),
  deleteICloudReminder: vi.fn(),
  fetchICloudRemindersList: mocks.fetchList,
  getCachedICloudRemindersList: () => null,
  getCachedICloudRemindersLists: () => null,
  loadICloudRemindersLists: mocks.loadLists,
  moveICloudReminderSection: vi.fn(),
  updateICloudReminder: vi.fn(),
}));

vi.mock('../../hooks/useLocalTasks', () => ({
  useLocalTasks: () => ({
    lists: mocks.localLists,
    getTasksForList: mocks.getTasksForList,
    addTask: mocks.addTask,
    toggleTask: mocks.toggleTask,
    removeTask: mocks.removeTask,
  }),
}));

vi.mock('../PageHeader', () => ({
  HeaderDate: () => null,
  PageHeaderActions: () => null,
}));

const i18n = createI18n('en-US');

afterEach(() => {
  localStorage.clear();
  mocks.fetchList.mockReset();
  mocks.loadLists.mockReset();
});

describe('GroceryView task refresh', () => {
  it('checks for iCloud task changes when the user taps refresh', async () => {
    localStorage.setItem('abbai-flow-filter-grocery-tab', JSON.stringify('tasks'));
    localStorage.setItem('abbai-flow-filter-grocery-lists', JSON.stringify({
      grocery: 'grocery-list',
      tasks: 'task-list',
    }));
    mocks.loadLists.mockResolvedValue({
      ok: true,
      state: 'fetched',
      lists: [
        { key: 'grocery-list', title: 'Shopping', deleted: false, isGroup: false },
        { key: 'task-list', title: 'Tasks', deleted: false, isGroup: false },
      ],
    });
    mocks.fetchList
      .mockResolvedValueOnce({
        ok: true,
        state: 'fetched',
        changed: true,
        revision: 12,
        lists: [{ key: 'task-list', sections: [], reminders: [] }],
      })
      .mockResolvedValueOnce({
        ok: true,
        state: 'unchanged',
        changed: false,
        revision: 12,
        lists: [],
      });

    render(
      <I18nContext.Provider value={i18n}>
        <GroceryView />
      </I18nContext.Provider>,
    );

    const refreshButton = await screen.findByRole(
      'button',
      { name: 'Refresh' },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(mocks.fetchList).toHaveBeenCalledWith('task-list', undefined));

    fireEvent.click(refreshButton);

    await waitFor(() => expect(mocks.fetchList).toHaveBeenLastCalledWith('task-list', 12));
  }, 10_000);
});
