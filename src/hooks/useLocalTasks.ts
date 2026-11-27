import { useState, useCallback, useEffect } from 'react';
import { loadData, loadDataSync, saveData } from '../api/abbai-flow-store';

/**
 * Built-in local task/todo list synced via abbai-flow-store.
 * Server is source of truth in server-backed mode; localStorage is offline cache.
 */

export interface LocalTask {
  id: string;
  summary: string;
  status: 'needs_action' | 'completed';
  listId: string;
  createdAt: string;
  completedAt?: string;
}

export interface LocalTaskList {
  id: string;
  name: string;
}

const STORAGE_KEY = 'abbai-flow-local-tasks';
const LISTS_KEY = 'abbai-flow-local-task-lists';

// Default built-in lists
const DEFAULT_LISTS: LocalTaskList[] = [
  { id: 'abbai-flow-todo', name: 'To-Do' },
  { id: 'abbai-flow-shopping', name: 'Shopping List' },
];

export function useLocalTasks() {
  // Initialize with localStorage data immediately
  const [lists, setLists] = useState<LocalTaskList[]>(() =>
    loadDataSync<LocalTaskList[]>(LISTS_KEY, DEFAULT_LISTS),
  );
  const [tasks, setTasks] = useState<LocalTask[]>(() => loadDataSync<LocalTask[]>(STORAGE_KEY, []));

  /** Re-fetch tasks and lists from server. */
  const refresh = useCallback(async () => {
    const [serverLists, serverTasks] = await Promise.all([
      loadData<LocalTaskList[]>(LISTS_KEY, DEFAULT_LISTS),
      loadData<LocalTask[]>(STORAGE_KEY, []),
    ]);
    setLists(serverLists);
    setTasks(serverTasks);
  }, []);

  // Fetch from server on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when the app becomes visible to refresh stale tasks.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  // Persist on change
  useEffect(() => {
    saveData(LISTS_KEY, lists);
  }, [lists]);
  useEffect(() => {
    saveData(STORAGE_KEY, tasks);
  }, [tasks]);

  const getTasksForList = useCallback(
    (listId: string) => {
      return tasks.filter((t) => t.listId === listId);
    },
    [tasks],
  );

  const addTask = useCallback((listId: string, summary: string) => {
    const task: LocalTask = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      summary,
      status: 'needs_action',
      listId,
      createdAt: new Date().toISOString(),
    };
    setTasks((prev) => [...prev, task]);
    return task;
  }, []);

  const toggleTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? t.status === 'needs_action'
            ? { ...t, status: 'completed', completedAt: new Date().toISOString() }
            : { ...t, status: 'needs_action', completedAt: undefined }
          : t,
      ),
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const addList = useCallback((name: string) => {
    const list: LocalTaskList = {
      id: `abbai-flow-${Date.now()}`,
      name,
    };
    setLists((prev) => [...prev, list]);
    return list;
  }, []);

  const removeList = useCallback((listId: string) => {
    setLists((prev) => prev.filter((l) => l.id !== listId));
    setTasks((prev) => prev.filter((t) => t.listId !== listId));
  }, []);

  return {
    lists,
    tasks,
    getTasksForList,
    addTask,
    toggleTask,
    removeTask,
    addList,
    removeList,
    refresh,
  };
}
