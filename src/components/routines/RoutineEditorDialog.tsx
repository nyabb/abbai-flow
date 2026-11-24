import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { ALL_WEEKDAYS } from '../../api/routine-schedule';
import { useRoutines } from '../../hooks/useRoutines';
import { useTranslation } from '../../i18n';
import {
  DEFAULT_ROUTINE_MISSION_POINTS,
  type FamilyMember,
  type Routine,
} from '../../types/family';

export interface RoutineEditorRequest {
  token: number;
  /** Leave unset for a new routine so the editor can choose a family member. */
  memberId?: string;
  /** Present when editing an existing routine. */
  routine?: Routine;
}

interface RoutineForm {
  name: string;
  time_of_day: Routine['time_of_day'];
  days_of_week: number[];
  mission_points: number;
  tasks: Array<{ id: string | null; name: string }>;
}

interface RoutineEditorDialogProps {
  request: RoutineEditorRequest;
  members: FamilyMember[];
  locale: string;
  weekStartsOn: 0 | 1;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

const emptyForm = (): RoutineForm => ({
  name: '',
  time_of_day: 'morning',
  days_of_week: [...ALL_WEEKDAYS],
  mission_points: DEFAULT_ROUTINE_MISSION_POINTS,
  tasks: [{ id: null, name: '' }],
});

function formFromRoutine(routine: Routine): RoutineForm {
  return {
    name: routine.name,
    time_of_day: routine.time_of_day,
    days_of_week: routine.days_of_week?.length ? [...routine.days_of_week] : [...ALL_WEEKDAYS],
    mission_points: routine.mission_points ?? DEFAULT_ROUTINE_MISSION_POINTS,
    tasks: [...routine.tasks]
      .sort((left, right) => left.order - right.order)
      .map((task) => ({ id: task.id, name: task.name })),
  };
}

function newTaskId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RoutineEditorDialog({
  request,
  members,
  locale,
  weekStartsOn,
  onClose,
  onSaved,
}: RoutineEditorDialogProps) {
  const { t } = useTranslation();
  const routinesApi = useRoutines();
  const firstMemberId = request.memberId ?? request.routine?.member_id ?? members[0]?.id ?? '';
  const [memberId, setMemberId] = useState(firstMemberId);
  const [form, setForm] = useState<RoutineForm>(() =>
    request.routine ? formFromRoutine(request.routine) : emptyForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member = members.find((item) => item.id === memberId) ?? null;
  const canChooseMember = !request.routine && !request.memberId;
  const weekdayOrder = useMemo(() => {
    const firstWeekday = weekStartsOn === 1 ? 1 : 0;
    return Array.from({ length: 7 }, (_, index) => (firstWeekday + index) % 7);
  }, [weekStartsOn]);
  const shortWeekday = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short' }),
    [locale],
  );
  const longWeekday = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long' }), [locale]);
  const weekdayDate = (day: number) => new Date(2023, 0, day + 1, 12);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose, saving]);

  const save = async () => {
    const name = form.name.trim();
    const tasks = form.tasks
      .map((task) => ({ ...task, name: task.name.trim() }))
      .filter((task) => task.name.length > 0)
      .map((task, order) => ({ id: task.id ?? newTaskId(), name: task.name, order }));
    if (!member) {
      return;
    }
    if (!name || tasks.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    const data = {
      name,
      time_of_day: form.time_of_day,
      days_of_week: [...form.days_of_week].sort((left, right) => left - right),
      mission_points: member.role === 'parent' ? 0 : form.mission_points,
      tasks,
    };
    try {
      if (request.routine) {
        await routinesApi.updateRoutine(request.routine.id, data);
      } else {
        await routinesApi.addRoutine({ ...data, member_id: member.id });
      }
      await onSaved?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const hasName = form.name.trim().length > 0;
  const hasTask = form.tasks.some((task) => task.name.trim().length > 0);

  const title = request.routine
    ? t('settings.family.editRoutine', { name: request.routine.name })
    : t('settings.family.addRoutine');

  return (
    <div
      className="routine-editor-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <section
        className="routine-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="routine-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="routine-editor-header">
          <h2 id="routine-editor-title">{title}</h2>
          <button
            type="button"
            className="routine-editor-close"
            onClick={onClose}
            aria-label={t('common.close')}
            disabled={saving}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {canChooseMember && (
          <label className="routine-editor-field">
            <span>{t('planner.forWho')}</span>
            <select
              className="settings-input"
              value={memberId}
              aria-label={t('planner.forWho')}
              onChange={(event) => setMemberId(event.target.value)}
            >
              {members.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!canChooseMember && member && <div className="routine-editor-member">{member.name}</div>}

        <div className="routine-editor-body">
          <label className="routine-editor-field">
            <span>{t('settings.family.routineNameLabel')}</span>
            <input
              type="text"
              className="settings-input"
              value={form.name}
              autoFocus
              placeholder={t('settings.family.routineNamePlaceholder')}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <label className="routine-editor-field">
            <span>{t('settings.family.timeOfDayLabel')}</span>
            <select
              className="settings-input"
              value={form.time_of_day}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  time_of_day: event.target.value as Routine['time_of_day'],
                }))
              }
            >
              <option value="morning">{t('settings.family.morning')}</option>
              <option value="afternoon">{t('settings.family.afternoon')}</option>
              <option value="evening">{t('settings.family.evening')}</option>
            </select>
          </label>

          <fieldset className="routine-editor-field routine-editor-days">
            <legend>{t('settings.family.repeatOnLabel')}</legend>
            <small>{t('settings.family.repeatOnHint')}</small>
            <div className="settings-weekday-selector">
              {weekdayOrder.map((day) => {
                const selected = form.days_of_week.includes(day);
                const date = weekdayDate(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={`settings-weekday-btn${selected ? ' is-active' : ''}`}
                    aria-pressed={selected}
                    aria-label={longWeekday.format(date)}
                    title={longWeekday.format(date)}
                    onClick={() =>
                      setForm((current) => {
                        const days = current.days_of_week;
                        if (days.includes(day) && days.length === 1) return current;
                        const nextDays = days.includes(day)
                          ? days.filter((item) => item !== day)
                          : [...days, day];
                        return {
                          ...current,
                          days_of_week: nextDays.sort((left, right) => left - right),
                        };
                      })
                    }
                  >
                    {shortWeekday.format(date)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {member?.role !== 'parent' && (
            <label className="routine-editor-field">
              <span>{t('settings.family.missionPointsLabel')}</span>
              <small>{t('settings.family.missionPointsHint')}</small>
              <input
                type="number"
                className="settings-input"
                min="0"
                step="0.01"
                value={form.mission_points}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    mission_points: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
              />
            </label>
          )}

          <fieldset className="routine-editor-field routine-editor-tasks">
            <legend>{t('settings.family.tasksLabel')}</legend>
            {form.tasks.map((task, index) => (
              <div className="routine-editor-task" key={task.id ?? `new-${index}`}>
                <input
                  type="text"
                  className="settings-input"
                  value={task.name}
                  placeholder={t('settings.family.taskPlaceholder', { n: index + 1 })}
                  aria-label={t('settings.family.taskPlaceholder', { n: index + 1 })}
                  onChange={(event) =>
                    setForm((current) => {
                      const tasks = [...current.tasks];
                      tasks[index] = { ...tasks[index], name: event.target.value };
                      return { ...current, tasks };
                    })
                  }
                />
                <button
                  type="button"
                  className="settings-fm-btn"
                  disabled={index === 0}
                  aria-label={t('settings.family.moveUp')}
                  onClick={() =>
                    setForm((current) => {
                      if (index === 0) return current;
                      const tasks = [...current.tasks];
                      [tasks[index - 1], tasks[index]] = [tasks[index], tasks[index - 1]];
                      return { ...current, tasks };
                    })
                  }
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="settings-fm-btn"
                  disabled={index === form.tasks.length - 1}
                  aria-label={t('settings.family.moveDown')}
                  onClick={() =>
                    setForm((current) => {
                      if (index === current.tasks.length - 1) return current;
                      const tasks = [...current.tasks];
                      [tasks[index], tasks[index + 1]] = [tasks[index + 1], tasks[index]];
                      return { ...current, tasks };
                    })
                  }
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="settings-fm-btn settings-fm-btn--danger"
                  aria-label={`${t('settings.family.removeTask')}: ${task.name || index + 1}`}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      tasks: current.tasks.filter((_, taskIndex) => taskIndex !== index),
                    }))
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="settings-btn routine-editor-add-task"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  tasks: [...current.tasks, { id: null, name: '' }],
                }))
              }
            >
              <Plus size={15} aria-hidden="true" /> {t('settings.family.addTask')}
            </button>
          </fieldset>
        </div>

        {error && (
          <p className="routine-editor-error" role="alert">
            {error}
          </p>
        )}
        <footer className="routine-editor-footer">
          <button type="button" className="settings-btn" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={() => void save()}
            disabled={saving || !member || !hasName || !hasTask}
          >
            {t('settings.family.saveRoutine')}
          </button>
        </footer>
      </section>
    </div>
  );
}
