import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  fetchICloudRemindersTaskLists,
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
  const [activeListKeys, setActiveListKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const revisions = useRef<Record<string, number>>({});
  const cachedListKeys = useRef(new Set<string>());
  const activeListKeysRef = useRef<string[]>([]);
  cachedListKeys.current = new Set(reminders.map((item) => item.listKey));
  activeListKeysRef.current = activeListKeys;

  // Depend on list contents rather than array identity; callers can pass inline defaults.
  const groceryKey = groceryListIds.join('|');
  const taskKey = taskListIds.join('|');

  useEffect(() => {
    let cancelled = false;
    let requestedListKeys: string[] = [];
    const configuredGroceryIds = groceryKey ? groceryKey.split('|') : [];
    const configuredTaskIds = taskKey ? taskKey.split('|') : [];

    async function fetchTasks(initial = false) {
      if (!requestedListKeys.length) {
        if (initial && !cancelled) {
          setActiveListKeys([]);
          setLoading(false);
        }
        return;
      }
      try {
        const result = await fetchICloudRemindersTaskLists(requestedListKeys, revisions.current);
        if (cancelled) return;
        if (result.revisions) {
          revisions.current = { ...revisions.current, ...result.revisions };
        }
        const changedLists = result.lists || [];
        if (initial || result.changed) {
          const changedKeys = new Set(changedLists.map((list) => list.key));
          setReminders((current) => [
            ...current.filter((item) => !changedKeys.has(item.listKey)),
            ...changedLists.flatMap((list) => (list.reminders || [])
              .filter((reminder) => !reminder.deleted)
              .map((reminder) => ({ listKey: list.key, reminder }))),
          ]);
        }
      } catch (error) {
        console.warn('Failed to fetch iCloud task lists:', error);
      }
    }

    async function initialize() {
      setLoading((current) => current || activeListKeysRef.current.length === 0);
      try {
        const listResult = await loadICloudRemindersLists();
        if (cancelled) return;
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
        requestedListKeys = selected.map((list) => list.key);
        setActiveListKeys(requestedListKeys);
        setLoading(requestedListKeys.some((key) => !cachedListKeys.current.has(key)));
        await fetchTasks(true);
      } catch (error) {
        console.warn('Failed to fetch iCloud task lists:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialize();
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
    const selectedKeys = new Set(activeListKeys);
    const local: TaskTodoItem[] = getTasksForList('abbai-flow-todo')
      .filter((task) => task.status === 'needs_action' || isToday(task.completedAt))
      .map((task) => ({
        uid: task.id,
        summary: task.summary,
        status: task.status,
        listId: 'abbai-flow-todo',
      }));
    const fromICloud: TaskTodoItem[] = reminders
      .filter(({ listKey }) => selectedKeys.has(listKey))
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
  }, [activeListKeys, getTasksForList, reminders]);

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
