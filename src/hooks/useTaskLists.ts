import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  fetchICloudRemindersList,
  loadICloudRemindersLists,
  updateICloudReminder,
  type ICloudReminder,
} from '../api/integration-settings';
import { useLocalTasks } from './useLocalTasks';

export interface TaskTodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  listId: string;
}

const GROCERY_KEYWORDS = [
  'grocer',
  'shopping',
  'costco',
  'walmart',
  'target',
  'store',
  'pantry',
  'fridge',
  'freezer',
  'inventory',
  'meal',
];

function isGroceryList(name: string): boolean {
  const lower = name.toLowerCase();
  return GROCERY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isToday(value: string | null | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function useTaskLists(
  groceryListIds: string[] = [],
  taskListIds: string[] = [],
  refreshKey = 0,
) {
  const { getTasksForList, toggleTask } = useLocalTasks();
  const [reminders, setReminders] = useState<Array<{ listKey: string; reminder: ICloudReminder }>>([]);
  const [loading, setLoading] = useState(true);

  // Depend on list contents rather than array identity; callers can pass inline defaults.
  const groceryKey = groceryListIds.join('|');
  const taskKey = taskListIds.join('|');

  useEffect(() => {
    let cancelled = false;
    let loadedOnce = false;
    const configuredGroceryIds = groceryKey ? groceryKey.split('|') : [];
    const configuredTaskIds = taskKey ? taskKey.split('|') : [];

    async function fetchTasks() {
      if (!loadedOnce) setLoading(true);
      try {
        const listResult = await loadICloudRemindersLists();
        const available = (listResult.lists || []).filter(
          (list) => !list.deleted && !list.isGroup,
        );
        const availableIds = new Set(available.map((list) => list.key));
        const groceryIds = new Set(configuredGroceryIds.filter((id) => availableIds.has(id)));
        const explicitTaskIds = configuredTaskIds.filter((id) => availableIds.has(id));
        const selected = explicitTaskIds.length > 0
          ? available.filter((list) => explicitTaskIds.includes(list.key) && !groceryIds.has(list.key))
          : available.filter((list) =>
              !groceryIds.has(list.key) &&
              !(groceryIds.size === 0 && isGroceryList(list.title)),
            );
        const snapshots = await Promise.all(
          selected.map((list) => fetchICloudRemindersList(list.key).catch(() => null)),
        );
        const items: Array<{ listKey: string; reminder: ICloudReminder }> = [];
        for (const [index, snapshot] of snapshots.entries()) {
          for (const reminder of snapshot?.lists?.[0]?.reminders || []) {
            if (!reminder.deleted) items.push({ listKey: selected[index].key, reminder });
          }
        }
        if (!cancelled) setReminders(items);
      } catch (error) {
        console.warn('Failed to fetch iCloud task lists:', error);
      } finally {
        loadedOnce = true;
        if (!cancelled) setLoading(false);
      }
    }

    void fetchTasks();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void fetchTasks();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void fetchTasks();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [groceryKey, taskKey, refreshKey]);

  const items: TaskTodoItem[] = useMemo(() => {
    const local: TaskTodoItem[] = getTasksForList('abbai-flow-todo')
      .filter((task) => task.status === 'needs_action' || isToday(task.completedAt))
      .map((task) => ({
        uid: task.id,
        summary: task.summary,
        status: task.status,
        listId: 'abbai-flow-todo',
      }));
    const fromICloud: TaskTodoItem[] = reminders
      .filter(({ reminder }) => reminder.completed
        ? isToday(reminder.completed_date)
        : true)
      .map(({ listKey, reminder }) => ({
        uid: reminder.id,
        summary: reminder.title,
        status: reminder.completed ? 'completed' : 'needs_action',
        listId: listKey,
      }));
    const seen = new Set<string>();
    return [...local, ...fromICloud].filter((item) => {
      const key = `${item.listId}:${item.uid}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [getTasksForList, reminders]);

  const toggleItem = useCallback(
    async (uid: string, currentStatus: string, listId?: string) => {
      const localItem = getTasksForList('abbai-flow-todo').find((task) => task.id === uid);
      if (localItem) {
        toggleTask(uid);
        return;
      }
      const entry = reminders.find(
        ({ listKey, reminder: item }) => item.id === uid && (listId == null || listKey === listId),
      );
      if (!entry) return;
      const { listKey, reminder } = entry;
      const completed = currentStatus === 'needs_action';
      setReminders((current) => current.map((item) =>
        item.listKey === listKey && item.reminder.id === uid
          ? { ...item, reminder: { ...item.reminder, completed } }
          : item,
      ));
      try {
        await updateICloudReminder(listKey, reminder.id, { completed });
      } catch (error) {
        console.warn('Failed to toggle iCloud reminder:', error);
        setReminders((current) => current.map((item) =>
          item.listKey === listKey && item.reminder.id === uid
            ? { ...item, reminder: { ...item.reminder, completed: reminder.completed } }
            : item,
        ));
      }
    },
    [getTasksForList, toggleTask, reminders],
  );

  return { items, toggleItem, loading };
}
