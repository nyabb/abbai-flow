import { useMemo } from 'react';
import { format, parseISO, isSameDay, startOfDay } from 'date-fns';
import { CalendarEvent } from '../types';
import { Chore, FamilyMember } from '../types/family';
import { TaskChecklist } from './TaskChecklist';
import type { TaskTodoItem } from '../hooks/useTaskLists';
import { useTranslation } from '../i18n';
import { LoadingPlaceholder } from './LoadingPlaceholder';

interface CalendarSidebarProps {
  events: CalendarEvent[];
  chores: Chore[];
  completedChoreIds: Set<string>;
  onToggleChore: (choreId: string) => void;
  todoItems: TaskTodoItem[];
  eventsLoading?: boolean;
  tasksLoading?: boolean;
  onToggleTodo?: (uid: string, currentStatus: string, listId?: string) => void;
  members?: FamilyMember[];
}

export function CalendarSidebar({
  events,
  chores,
  completedChoreIds,
  onToggleChore,
  todoItems,
  eventsLoading = false,
  tasksLoading = false,
  onToggleTodo,
  members = [],
}: CalendarSidebarProps) {
  const { t, dateLocale } = useTranslation();
  const today = startOfDay(new Date());

  const todayEvents = useMemo(() => {
    return events
      .filter((e) => isSameDay(startOfDay(parseISO(e.start)), today))
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events, today]);

  const pendingTodos = todoItems.filter((t) => t.status === 'needs_action');

  return (
    <aside className="calendar-sidebar">
      {/* Today's Schedule */}
      <section className="cal-sidebar-section">
        <h3 className="cal-sidebar-heading">{t('calendarSidebar.today')}</h3>
        {todayEvents.length === 0 ? (
          eventsLoading ? (
            <LoadingPlaceholder
              label={t('app.connecting')}
              lines={2}
              className="loading-placeholder--compact"
            />
          ) : (
            <p className="cal-sidebar-empty">{t('calendarSidebar.nothingScheduled')}</p>
          )
        ) : (
          <ul className="cal-sidebar-events">
            {todayEvents.map((event) => (
              <li key={event.id} className="cal-sidebar-event">
                <span
                  className="cal-sidebar-event-dot"
                  style={{ background: event.color || 'var(--accent)' }}
                />
                <div className="cal-sidebar-event-info">
                  <span className="cal-sidebar-event-title">{event.title}</span>
                  {event.start.includes('T') && (
                    <span className="cal-sidebar-event-time">
                      {format(parseISO(event.start), 'h:mm a', { locale: dateLocale })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Today's Tasks */}
      <section className="cal-sidebar-section">
        <h3 className="cal-sidebar-heading">{t('calendarSidebar.tasks')}</h3>
        {pendingTodos.length > 0 && onToggleTodo ? (
          <ul className="cal-sidebar-todos">
            {pendingTodos.slice(0, 8).map((item) => (
              <li key={item.uid} className="cal-sidebar-todo">
                <button
                  type="button"
                  className="cal-sidebar-todo-check"
                  onClick={() => onToggleTodo(item.uid, item.status, item.listId)}
                  aria-label={t('calendarSidebar.completeItem', { name: item.summary })}
                >
                  <span className="task-checkbox-box" />
                </button>
                <span className="cal-sidebar-todo-label">{item.summary}</span>
              </li>
            ))}
          </ul>
        ) : tasksLoading ? (
          <LoadingPlaceholder
            label={t('app.connecting')}
            lines={3}
            className="loading-placeholder--compact"
          />
        ) : (
          <p className="cal-sidebar-empty">{t('calendarSidebar.allClear')}</p>
        )}
      </section>

      {/* Today's Chores */}
      {chores.length > 0 && (
        <section className="cal-sidebar-section">
          <h3 className="cal-sidebar-heading">{t('nav.chores')}</h3>
          <TaskChecklist
            chores={chores}
            completedIds={completedChoreIds}
            onToggle={onToggleChore}
            members={members}
          />
        </section>
      )}
    </aside>
  );
}
