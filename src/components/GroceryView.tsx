import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  createICloudReminder,
  deleteICloudReminder,
  fetchICloudRemindersList,
  getCachedICloudRemindersList,
  getCachedICloudRemindersLists,
  loadICloudRemindersLists,
  moveICloudReminderSection,
  updateICloudReminder,
  type ICloudReminder,
  type ICloudReminderSection,
} from '../api/integration-settings';
import { useLocalTasks } from '../hooks/useLocalTasks';
import { useTranslation } from '../i18n';
import { CollapsibleRegion } from './CollapsibleRegion';
import { HeaderDate, PageHeaderActions } from './PageHeader';
import { ActivitySpinner, LoadingPlaceholder } from './LoadingPlaceholder';
import { usePersistentState } from '../hooks/usePersistentState';

interface TodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  desc?: string;
  dueDate?: string | null;
  priority?: number;
  flagged?: boolean;
  allDay?: boolean;
  sectionID?: string | null;
  sectionName?: string | null;
  source: 'icloud' | 'local';
}

interface UnifiedList {
  id: string;
  name: string;
  source: 'icloud' | 'local';
}

type GroceryTab = 'grocery' | 'tasks';
type GroceryListSelections = Record<GroceryTab, string>;

function isGroceryTab(value: unknown): value is GroceryTab {
  return value === 'grocery' || value === 'tasks';
}

function isGroceryListSelections(value: unknown): value is GroceryListSelections {
  if (!value || typeof value !== 'object') return false;
  const selections = value as Partial<GroceryListSelections>;
  return typeof selections.grocery === 'string' && typeof selections.tasks === 'string';
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

function localDateTimeValue(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function reminderItems(reminders: ICloudReminder[]): TodoItem[] {
  return reminders.filter((reminder) => !reminder.deleted).map((reminder) => ({
    uid: reminder.id,
    summary: reminder.title,
    status: reminder.completed ? 'completed' : 'needs_action',
    desc: reminder.desc,
    dueDate: reminder.due_date,
    priority: reminder.priority,
    flagged: reminder.flagged,
    allDay: reminder.all_day,
    sectionID: reminder.sectionID,
    sectionName: reminder.sectionName,
    source: 'icloud',
  }));
}

interface GroceryViewProps {
  defaultListId?: string;
  groceryListIds?: string[];
  taskListIds?: string[];
}

export function GroceryView({
  defaultListId,
  groceryListIds = [],
  taskListIds = [],
}: GroceryViewProps) {
  const { t } = useTranslation();
  const cachedListCatalog = getCachedICloudRemindersLists();
  const [icloudLists, setIcloudLists] = useState<UnifiedList[]>(() =>
    (cachedListCatalog || [])
      .filter((list) => !list.deleted && !list.isGroup)
      .map((list) => ({ id: list.key, name: list.title, source: 'icloud' as const })),
  );
  const [sections, setSections] = useState<ICloudReminderSection[]>([]);
  const [icloudItems, setIcloudItems] = useState<TodoItem[]>([]);
  const [localItems, setLocalItems] = useState<TodoItem[]>([]);
  const [tab, setTab] = usePersistentState<GroceryTab>(
    'abbai-flow-filter-grocery-tab',
    'grocery',
    isGroceryTab,
  );
  const [selectedListIds, setSelectedListIds] = usePersistentState<GroceryListSelections>(
    'abbai-flow-filter-grocery-lists',
    { grocery: defaultListId || '', tasks: '' },
    isGroceryListSelections,
  );
  const selectedListId = selectedListIds[tab];
  const setSelectedListId = useCallback(
    (listId: string) => setSelectedListIds((current) => ({ ...current, [tab]: listId })),
    [setSelectedListIds, tab],
  );
  const [loading, setLoading] = useState(cachedListCatalog == null);
  const [refreshing, setRefreshing] = useState(false);
  const [listsLoaded, setListsLoaded] = useState(cachedListCatalog != null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [newItemSectionID, setNewItemSectionID] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingItem, setEditingItem] = useState<TodoItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [editFlagged, setEditFlagged] = useState(false);
  const [editAllDay, setEditAllDay] = useState(false);
  const [completedCollapsed, setCompletedCollapsed] = usePersistentState(
    'abbai-flow-filter-grocery-completed-collapsed',
    false,
    (value): value is boolean => typeof value === 'boolean',
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRevisions = useRef<Record<string, number>>({});
  const {
    lists: localLists,
    getTasksForList,
    addTask,
    toggleTask,
    removeTask,
  } = useLocalTasks();

  const groceryKey = groceryListIds.join('|');
  const taskKey = taskListIds.join('|');

  useEffect(() => {
    let cancelled = false;
    const cachedLists = getCachedICloudRemindersLists();
    if (cachedLists) {
      setIcloudLists(cachedLists
        .filter((list) => !list.deleted && !list.isGroup)
        .map((list) => ({ id: list.key, name: list.title, source: 'icloud' as const })));
      setListsLoaded(true);
      setLoading(false);
    } else {
      setLoading(true);
    }
    loadICloudRemindersLists()
      .then((result) => {
        if (cancelled) return;
        const available = (result.lists || [])
          .filter((list) => !list.deleted && !list.isGroup)
          .map((list) => ({ id: list.key, name: list.title, source: 'icloud' as const }));
        setIcloudLists(available);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setIcloudLists([]);
        setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) {
          setListsLoaded(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groceryKey, taskKey, t]);

  const { groceryLists, taskLists } = useMemo(() => {
    const availableIds = new Set(icloudLists.map((list) => list.id));
    const configuredGroceries = groceryKey
      ? groceryKey.split('|').filter((id) => availableIds.has(id))
      : [];
    const configuredTasks = taskKey
      ? taskKey.split('|').filter((id) => availableIds.has(id))
      : [];
    if (icloudLists.length > 0) {
      const grocery = icloudLists.filter((list) =>
        configuredGroceries.length > 0
          ? configuredGroceries.includes(list.id)
          : isGroceryList(list.name),
      );
      const tasks = icloudLists.filter((list) => {
        if (grocery.some((groceryList) => groceryList.id === list.id)) return false;
        return configuredTasks.length > 0 ? configuredTasks.includes(list.id) : true;
      });
      return { groceryLists: grocery, taskLists: tasks };
    }

    const local = localLists.map((list) => ({ id: list.id, name: list.name, source: 'local' as const }));
    const groceries = local.filter((list) => list.id === 'abbai-flow-shopping' || isGroceryList(list.name));
    return { groceryLists: groceries, taskLists: local.filter((list) => !groceries.includes(list)) };
  }, [icloudLists, groceryKey, taskKey, localLists]);

  const allLists = tab === 'grocery' ? groceryLists : taskLists;
  const selectedList = allLists.find((list) => list.id === selectedListId);
  const isLocal = selectedList?.source === 'local';
  const items = isLocal ? localItems : icloudItems;
  const uncheckedItems = useMemo(() => items.filter((item) => item.status === 'needs_action'), [items]);
  const checkedItems = useMemo(() => items.filter((item) => item.status === 'completed'), [items]);

  const loadList = useCallback(async (listId: string, showRefreshIndicator = false) => {
    if (!listId) return;
    if (showRefreshIndicator) setRefreshing(true);
    const cachedList = getCachedICloudRemindersList(listId);
    if (cachedList) {
      if (typeof cachedList.revision === 'number') listRevisions.current[listId] = cachedList.revision;
      setIcloudItems(reminderItems(cachedList.reminders || []));
      setSections(cachedList.sections || []);
      setLoadError(null);
      setLoading(false);
    }
    const revision = listRevisions.current[listId];
    if (revision == null && !cachedList) setLoading(true);
    try {
      const result = await fetchICloudRemindersList(listId, revision);
      if (typeof result.revision === 'number') listRevisions.current[listId] = result.revision;
      if (result.changed === false || result.state === 'unchanged') return;
      const list = result.lists?.[0];
      if (!list) throw new Error(t('grocery.loadFailed'));
      setIcloudItems(reminderItems(list.reminders || []));
      setSections(list.sections || []);
      setLoadError(null);
    } catch (error) {
      console.warn('GroceryView: Failed to load iCloud reminders', error);
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    } finally {
      setLoading(false);
      if (showRefreshIndicator) setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    if (!selectedListId || !selectedList) {
      setIcloudItems([]);
      setLocalItems([]);
      setSections([]);
      setLoading(!listsLoaded);
      return;
    }
    if (selectedList.source === 'local') {
      setLocalItems(getTasksForList(selectedListId).map((task) => ({
        uid: task.id,
        summary: task.summary,
        status: task.status,
        source: 'local',
      })));
      setSections([]);
      setLoading(false);
      return;
    }
    void loadList(selectedListId);
  }, [selectedListId, selectedList, getTasksForList, listsLoaded, loadList]);

  useEffect(() => {
    if (!selectedListId || isLocal) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadList(selectedListId);
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') void loadList(selectedListId);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedListId, isLocal, loadList]);

  useEffect(() => {
    if (selectedListId && allLists.some((list) => list.id === selectedListId)) return;
    if (defaultListId && allLists.some((list) => list.id === defaultListId)) {
      setSelectedListId(defaultListId);
    } else if (allLists.length > 0) {
      setSelectedListId(allLists[0].id);
    } else {
      setSelectedListId('');
    }
  }, [allLists, selectedListId, defaultListId, setSelectedListId]);

  useEffect(() => setNewItemSectionID(''), [selectedListId]);

  const handleAdd = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    const title = inputValue.trim();
    if (!title || submitting || !selectedListId) return;
    setSubmitting(true);
    try {
      if (isLocal) {
        addTask(selectedListId, title);
        setLocalItems(getTasksForList(selectedListId).map((task) => ({
          uid: task.id,
          summary: task.summary,
          status: task.status,
          source: 'local',
        })));
      } else {
        const result = await createICloudReminder(selectedListId, {
          title,
          sectionID: newItemSectionID || null,
        });
        if (result.reminder) {
          if (typeof result.revision === 'number') listRevisions.current[selectedListId] = result.revision;
          setIcloudItems((current) => [...current, ...reminderItems([result.reminder!])]);
        } else {
          delete listRevisions.current[selectedListId];
          await loadList(selectedListId);
        }
      }
      setInputValue('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }, [inputValue, submitting, selectedListId, isLocal, addTask, getTasksForList, newItemSectionID, loadList, t]);

  const handleToggle = useCallback(async (item: TodoItem) => {
    if (isLocal) {
      toggleTask(item.uid);
      setLocalItems((current) => current.map((candidate) => candidate.uid === item.uid
        ? { ...candidate, status: candidate.status === 'needs_action' ? 'completed' : 'needs_action' }
        : candidate));
      return;
    }
    if (!selectedListId) return;
    const completed = item.status === 'needs_action';
    setIcloudItems((current) => current.map((candidate) => candidate.uid === item.uid
      ? { ...candidate, status: completed ? 'completed' : 'needs_action' }
      : candidate));
    try {
      const result = await updateICloudReminder(selectedListId, item.uid, { completed });
      if (typeof result.revision === 'number') listRevisions.current[selectedListId] = result.revision;
    } catch (error) {
      setIcloudItems((current) => current.map((candidate) => candidate.uid === item.uid
        ? { ...candidate, status: item.status }
        : candidate));
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    }
  }, [isLocal, toggleTask, selectedListId, t]);

  const startEditing = (item: TodoItem) => {
    if (item.source !== 'icloud') return;
    setEditingItem(item);
    setEditTitle(item.summary);
    setEditNotes(item.desc || '');
    setEditDueDate(localDateTimeValue(item.dueDate));
    setEditPriority(item.priority || 0);
    setEditFlagged(Boolean(item.flagged));
    setEditAllDay(Boolean(item.allDay));
  };

  const handleEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingItem || !selectedListId || !editTitle.trim()) return;
    setSubmitting(true);
    try {
      const patch = {
        title: editTitle.trim(),
        desc: editNotes,
        dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
        priority: editPriority,
        flagged: editFlagged,
        allDay: editAllDay,
      };
      const result = await updateICloudReminder(selectedListId, editingItem.uid, patch);
      if (typeof result.revision === 'number') listRevisions.current[selectedListId] = result.revision;
      setIcloudItems((current) => current.map((item) => item.uid === editingItem.uid
        ? {
            ...item,
            summary: patch.title,
            desc: patch.desc,
            dueDate: patch.dueDate,
            priority: patch.priority,
            flagged: patch.flagged,
            allDay: patch.allDay,
          }
        : item));
      setEditingItem(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSectionMove = async (item: TodoItem, sectionID: string) => {
    if (!selectedListId || item.source !== 'icloud') return;
    const previous = item.sectionID || '';
    setIcloudItems((current) => current.map((candidate) => candidate.uid === item.uid
      ? {
          ...candidate,
          sectionID: sectionID || null,
          sectionName: sections.find((section) => section.id === sectionID)?.name || null,
        }
      : candidate));
    try {
      const result = await moveICloudReminderSection(selectedListId, item.uid, sectionID || null);
      if (typeof result.revision === 'number') listRevisions.current[selectedListId] = result.revision;
    } catch (error) {
      setIcloudItems((current) => current.map((candidate) => candidate.uid === item.uid
        ? {
            ...candidate,
            sectionID: previous || null,
            sectionName: sections.find((section) => section.id === previous)?.name || null,
          }
        : candidate));
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    }
  };

  const handleDelete = async (item: TodoItem) => {
    if (item.source === 'local') {
      removeTask(item.uid);
      setLocalItems((current) => current.filter((candidate) => candidate.uid !== item.uid));
      return;
    }
    if (!selectedListId) return;
    try {
      const result = await deleteICloudReminder(selectedListId, item.uid);
      if (typeof result.revision === 'number') listRevisions.current[selectedListId] = result.revision;
      setIcloudItems((current) => current.filter((candidate) => candidate.uid !== item.uid));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('grocery.loadFailed'));
    }
  };

  const groupedUnchecked = useMemo(
    () => groupBySection(uncheckedItems, sections, t('grocery.otherSection')),
    [uncheckedItems, sections, t],
  );
  const groupedChecked = useMemo(
    () => groupBySection(checkedItems, sections, t('grocery.otherSection')),
    [checkedItems, sections, t],
  );

  const renderItem = (item: TodoItem, checked = false) => (
    <div key={item.uid} className="grocery-view-item-row-wrap">
      <div className="grocery-view-item-row">
        <button
          type="button"
          className={`grocery-view-item${checked ? ' grocery-view-item--checked' : ''}`}
          onClick={() => void handleToggle(item)}
        >
          <span className={`grocery-view-checkbox${checked ? ' grocery-view-checkbox--checked' : ''}`}>
            {checked && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="grocery-view-item-name">{item.summary}</span>
        </button>
        {item.source === 'icloud' && sections.length > 0 && (
          <select
            className="grocery-view-section-select"
            value={item.sectionID || ''}
            onChange={(event) => void handleSectionMove(item, event.target.value)}
            aria-label={t('grocery.moveSection')}
          >
            <option value="">{t('grocery.noSection')}</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>{section.name || section.id}</option>
            ))}
          </select>
        )}
        {item.source === 'icloud' && (
          <button
            type="button"
            className="grocery-view-delete grocery-view-edit"
            onClick={() => startEditing(item)}
            aria-label={t('grocery.editReminder')}
            title={t('grocery.editReminder')}
          >
            <ChevronRight size={18} />
          </button>
        )}
        <button
          type="button"
          className="grocery-view-delete"
          onClick={() => void handleDelete(item)}
          aria-label={t('grocery.deleteItem')}
          title={t('grocery.deleteItem')}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {editingItem?.uid === item.uid && (
        <form className="grocery-view-edit-panel" onSubmit={handleEdit}>
          <input
            className="grocery-view-input"
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            aria-label={t('grocery.itemTitle')}
            required
          />
          <textarea
            className="grocery-view-edit-notes"
            value={editNotes}
            onChange={(event) => setEditNotes(event.target.value)}
            placeholder={t('grocery.notes')}
            aria-label={t('grocery.notes')}
            rows={2}
          />
          <label className="grocery-view-edit-field">
            <span>{t('grocery.dueDate')}</span>
            <input type="datetime-local" value={editDueDate} onChange={(event) => setEditDueDate(event.target.value)} />
          </label>
          <label className="grocery-view-edit-field">
            <span>{t('grocery.priority')}</span>
            <select value={editPriority} onChange={(event) => setEditPriority(Number(event.target.value))}>
              <option value={0}>{t('grocery.priorityNone')}</option>
              <option value={1}>{t('grocery.priorityHigh')}</option>
              <option value={5}>{t('grocery.priorityMedium')}</option>
              <option value={9}>{t('grocery.priorityLow')}</option>
            </select>
          </label>
          <label className="grocery-view-edit-flag">
            <input type="checkbox" checked={editFlagged} onChange={(event) => setEditFlagged(event.target.checked)} />
            <span>{t('grocery.flagged')}</span>
          </label>
          <label className="grocery-view-edit-flag">
            <input type="checkbox" checked={editAllDay} onChange={(event) => setEditAllDay(event.target.checked)} />
            <span>{t('grocery.allDay')}</span>
          </label>
          <div className="grocery-view-edit-actions">
            <button type="button" className="settings-btn" onClick={() => setEditingItem(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="settings-btn settings-btn--primary" disabled={submitting || !editTitle.trim()}>
              {submitting ? <ActivitySpinner /> : t('grocery.saveReminder')}
            </button>
          </div>
        </form>
      )}
    </div>
  );

  return (
    <div className="grocery-view" data-grocery-view>
      <div className="grocery-view-header">
        <div className="grocery-view-hero">
          <HeaderDate />
          <h1 className="page-header-title">{t('nav.grocery')}</h1>
          <PageHeaderActions />
        </div>
        <div className="grocery-view-tabs" role="tablist" aria-label={t('grocery.tabsLabel')}>
          <button type="button" role="tab" aria-selected={tab === 'grocery'} className={`grocery-view-tab ${tab === 'grocery' ? 'is-active' : ''}`} onClick={() => setTab('grocery')}>
            {t('grocery.tab.grocery')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'tasks'} className={`grocery-view-tab ${tab === 'tasks' ? 'is-active' : ''}`} onClick={() => setTab('tasks')}>
            {t('grocery.tab.tasks')}
          </button>
        </div>
        <div className="grocery-view-selector">
          <div className="grocery-view-select-wrap">
            <select className="grocery-view-select" value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>
              {allLists.length === 0 && <option value="">{t('grocery.noListsAvailable')}</option>}
              {allLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <ChevronDown size={16} className="grocery-view-select-icon" />
          </div>
          {selectedList?.source === 'icloud' && (
            <button
              type="button"
              className="grocery-view-refresh"
              onClick={() => void loadList(selectedListId, true)}
              disabled={refreshing || loading}
              aria-label={t('chores.refresh')}
              title={t('chores.refresh')}
              aria-busy={refreshing}
            >
              <RefreshCw size={18} className={refreshing ? 'is-refreshing' : undefined} />
            </button>
          )}
        </div>
      </div>

      <form className="grocery-view-add" onSubmit={(event) => void handleAdd(event)}>
        <input
          ref={inputRef}
          type="text"
          className="grocery-view-input"
          placeholder={t('grocery.addItemPlaceholder')}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          disabled={submitting || !selectedListId}
        />
        {sections.length > 0 && !isLocal && (
          <select className="grocery-view-add-section" value={newItemSectionID} onChange={(event) => setNewItemSectionID(event.target.value)} aria-label={t('grocery.moveSection')}>
            <option value="">{t('grocery.noSection')}</option>
            {sections.map((section) => <option key={section.id} value={section.id}>{section.name || section.id}</option>)}
          </select>
        )}
        <button type="submit" className={`grocery-view-add-btn${submitting ? ' grocery-view-add-btn--loading' : ''}`} disabled={!inputValue.trim() || submitting || !selectedListId} aria-label={t('grocery.addItem')} aria-busy={submitting}>
          {submitting ? <ActivitySpinner /> : <Plus size={20} />}
        </button>
      </form>

      {loadError && !isLocal && (
        <div className="grocery-view-error" role="status">
          <span>{loadError || t('grocery.loadFailed')}</span>
          <button type="button" className="grocery-view-retry" onClick={() => selectedListId ? void loadList(selectedListId) : void loadICloudRemindersLists().then((result) => setIcloudLists((result.lists || []).filter((list) => !list.deleted && !list.isGroup).map((list) => ({ id: list.key, name: list.title, source: 'icloud' as const }))))}>
            {t('grocery.retry')}
          </button>
        </div>
      )}

      <div className="grocery-view-list">
        {loading && items.length === 0 ? (
          <LoadingPlaceholder label={t('grocery.loadingItems')} lines={4} className="loading-placeholder--list grocery-view-loading" />
        ) : items.length === 0 && !loading ? (
          <div className="grocery-view-empty">
            <div className="grocery-view-empty-icon">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <rect x="12" y="16" width="40" height="40" rx="8" stroke="var(--border)" strokeWidth="2" fill="none" />
                <path d="M24 32h16M24 40h10" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
                <circle cx="20" cy="32" r="2" fill="var(--border)" />
                <circle cx="20" cy="40" r="2" fill="var(--border)" />
              </svg>
            </div>
            <p>{t('grocery.empty')}</p>
          </div>
        ) : (
          <>
            {uncheckedItems.length > 0 && (
              <div className="grocery-view-section">
                <div className="grocery-view-section-header">{t('grocery.items', { count: uncheckedItems.length })}</div>
                {groupedUnchecked.map((group) => (
                  <div key={group.id} className="grocery-view-section-group">
                    {group.name && <div className="grocery-view-section-name">{group.name}</div>}
                    {group.items.map((item) => renderItem(item))}
                  </div>
                ))}
              </div>
            )}
            {checkedItems.length > 0 && (
              <div className="grocery-view-section">
                <button type="button" className="grocery-view-section-header grocery-view-section-header--toggle" onClick={() => setCompletedCollapsed((previous) => !previous)}>
                  {completedCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  {t('grocery.completed', { count: checkedItems.length })}
                </button>
                <CollapsibleRegion open={!completedCollapsed} className="grocery-view-completed-items">
                  {groupedChecked.map((group) => (
                    <div key={group.id} className="grocery-view-section-group">
                      {group.name && <div className="grocery-view-section-name">{group.name}</div>}
                      {group.items.map((item) => renderItem(item, true))}
                    </div>
                  ))}
                </CollapsibleRegion>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function groupBySection(items: TodoItem[], sections: ICloudReminderSection[], otherSectionName: string) {
  const groups = new Map<string, { id: string; name: string; order: number | null; items: TodoItem[] }>();
  for (const item of items) {
    const section = sections.find((candidate) => candidate.id === item.sectionID);
    const id = item.sectionID || '__none__';
    const name = section?.name || item.sectionName || '';
    const group = groups.get(id) || {
      id,
      name: name || (id === '__none__' ? '' : otherSectionName),
      order: section?.order ?? null,
      items: [],
    };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.order == null && b.order == null) return a.name.localeCompare(b.name);
    if (a.order == null) return 1;
    if (b.order == null) return -1;
    return a.order - b.order;
  });
}
