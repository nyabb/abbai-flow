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

  it('shows only task-backed sections and makes the full reminder row draggable', async () => {
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
    mocks.fetchList.mockResolvedValue({
      ok: true,
      state: 'fetched',
      changed: true,
      revision: 1,
      lists: [{
        key: 'task-list',
        sections: [
          { id: 'top', name: 'Top', order: 0 },
          { id: 'produce', name: 'Produce', order: 1 },
          { id: 'below', name: 'Below', order: 2 },
          { id: 'empty', name: 'Unused', order: 3 },
        ],
        reminders: [
          {
            id: 'milk', list_id: 'task-list', title: 'Milk', desc: '', completed: false,
            completed_date: null, due_date: null, start_date: null, priority: 0,
            flagged: false, all_day: false, deleted: false,
            sectionID: 'produce', sectionName: 'Produce', sectionOrder: 1,
          },
          {
            id: 'bread', list_id: 'task-list', title: 'Bread', desc: '', completed: false,
            completed_date: null, due_date: null, start_date: null, priority: 0,
            flagged: false, all_day: false, deleted: false,
            sectionID: null, sectionName: null, sectionOrder: null,
          },
        ],
      }],
    });

    const { container } = render(
      <I18nContext.Provider value={i18n}>
        <GroceryView />
      </I18nContext.Provider>,
    );

    await screen.findByText('Milk');
    await screen.findByText('Bread');

    const list = container.querySelector('.grocery-view-list')!;
    const sectionNames = Array.from(list.querySelectorAll('.grocery-view-section-name'))
      .map((section) => section.textContent);
    expect(sectionNames).toEqual(['Produce', 'Other']);
    expect(list.textContent).not.toContain('Top');
    expect(list.textContent).not.toContain('Below');
    expect(list.textContent).not.toContain('Unused');

    const milkRow = list.querySelector<HTMLElement>(
      '.grocery-view-item-row[aria-label^="Milk:"]',
    )!;
    expect(milkRow).toHaveAttribute('tabindex', '0');
    expect(milkRow).toHaveAttribute('aria-roledescription', 'draggable');
    expect(milkRow.querySelector('.grocery-view-drag-indicator')).not.toBeNull();
  });

});
