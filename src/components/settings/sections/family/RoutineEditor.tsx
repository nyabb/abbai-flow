/**
 * One member's routines: the list with edit/delete, and the routine form
 * (name, time of day, ordered tasks). The values and mutations live in
 * `FamilySection`; this file only renders them.
 */
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { I18nValue } from '../../../../i18n';
import {
  DEFAULT_ROUTINE_MISSION_POINTS,
  type FamilyMember,
  type Routine,
} from '../../../../types/family';
import { ALL_WEEKDAYS } from '../../../../api/routine-schedule';
import { MemberAvatar } from '../../../MemberAvatar';
import { Segment } from '../../controls';
import type { RoutineFormValue } from './types';

export interface RoutineEditorProps {
  member: FamilyMember;
  /** The routines of `member`, already filtered by the parent. */
  routines: Routine[];
  /** `null` while the list is showing; the draft otherwise. */
  form: RoutineFormValue | null;
  /** Id of the routine whose delete was armed, if any. */
  confirmDelete: string | null;
  t: I18nValue['t'];
  locale: string;
  weekStartsOn: 0 | 1;
  onBack: () => void;
  onStartCreate: () => void;
  onStartEdit: (routine: Routine) => void;
  onDelete: (id: string) => void;
  onChangeForm: Dispatch<SetStateAction<RoutineFormValue | null>>;
  onSave: () => void;
}

export function RoutineEditor({
  member,
  routines,
  form,
  confirmDelete,
  t,
  locale,
  weekStartsOn,
  onBack,
  onStartCreate,
  onStartEdit,
  onDelete,
  onChangeForm,
  onSave,
}: RoutineEditorProps) {
  const firstWeekday = weekStartsOn === 1 ? 1 : 0;
  const weekdayOrder = Array.from({ length: 7 }, (_, index) => (firstWeekday + index) % 7);
  const shortWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const longWeekday = new Intl.DateTimeFormat(locale, { weekday: 'long' });
  const weekdayDate = (day: number) => new Date(2023, 0, day + 1, 12);
  const routineDaysLabel = (routine: Routine) => {
    const days = routine.days_of_week?.length ? routine.days_of_week : [...ALL_WEEKDAYS];
    const selected = weekdayOrder.filter((day) => days.includes(day));
    return selected.length === 7
      ? t('settings.family.everyDay')
      : selected.map((day) => shortWeekday.format(weekdayDate(day))).join(', ');
  };

  return (
    <>
      <h2 className="settings-section-title">
        <MemberAvatar member={member} size={24} /> {member.name}{' '}
        {t('settings.family.routinesTitleSuffix')}
      </h2>
      <p className="settings-section-desc">{t('settings.family.routinesDesc')}</p>
      <div className="settings-group">
        <div style={{ padding: '12px 20px 4px' }}>
          <button
            type="button"
            className="settings-btn"
            onClick={onBack}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}
          >
            <ChevronLeft size={16} /> {t('common.back')}
          </button>
        </div>
        {form === null ? (
          <>
            <div className="settings-fm-list">
              {routines.length === 0 && (
                <div className="settings-fm-empty">{t('settings.family.routinesEmpty')}</div>
              )}
              {routines.map((routine) => (
                <div key={routine.id} className="settings-fm-card">
                  <div className="settings-fm-info">
                    <div className="settings-fm-name">{routine.name}</div>
                    <div className="settings-fm-role">
                      {routineDaysLabel(routine)} · {routine.time_of_day}
                      {member.role !== 'parent' && (
                        <>
                          {' · '}
                          {routine.mission_points ?? DEFAULT_ROUTINE_MISSION_POINTS}{' '}
                          {t('settings.family.missionPointsLabel')}
                        </>
                      )}
                      {' · '}
                      {t(
                        routine.tasks.length === 1
                          ? 'settings.family.routineTaskCountSingular'
                          : 'settings.family.routineTaskCountPlural',
                        { n: routine.tasks.length },
                      )}
                    </div>
                  </div>
                  <div className="settings-fm-actions">
                    <button
                      type="button"
                      className="settings-fm-btn"
                      onClick={() => onStartEdit(routine)}
                      aria-label={t('settings.family.editRoutine', { name: routine.name })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="settings-fm-btn settings-fm-btn--danger"
                      onClick={() => onDelete(routine.id)}
                      aria-label={t('settings.family.deleteRoutine', { name: routine.name })}
                    >
                      {confirmDelete === routine.id ? (
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#ef4444' }}>
                          {t('common.sure')}
                        </span>
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 20px 16px' }}>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => onStartCreate()}
              >
                {t('settings.family.addRoutine')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-row-label">{t('settings.family.routineNameLabel')}</div>
              <input
                type="text"
                className="settings-input"
                value={form.name}
                onChange={(e) => onChangeForm((f) => f && { ...f, name: e.target.value })}
                placeholder={t('settings.family.routineNamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-label">{t('settings.family.timeOfDayLabel')}</div>
              <Segment
                value={form.time_of_day}
                options={[
                  { value: 'morning', label: t('settings.family.morning') },
                  { value: 'afternoon', label: t('settings.family.afternoon') },
                  { value: 'evening', label: t('settings.family.evening') },
                ]}
                onChange={(v) => onChangeForm((f) => f && { ...f, time_of_day: v })}
              />
            </div>
            <div className="settings-row" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="settings-row-label">{t('settings.family.repeatOnLabel')}</div>
                <div className="settings-row-sublabel">{t('settings.family.repeatOnHint')}</div>
              </div>
              <div
                className="settings-weekday-selector"
                role="group"
                aria-label={t('settings.family.repeatOnLabel')}
              >
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
                        onChangeForm((current) => {
                          if (!current) return current;
                          const days = current.days_of_week;
                          if (days.includes(day) && days.length === 1) return current;
                          const nextDays = days.includes(day)
                            ? days.filter((item) => item !== day)
                            : [...days, day];
                          return { ...current, days_of_week: nextDays.sort((a, b) => a - b) };
                        })
                      }
                    >
                      {shortWeekday.format(date)}
                    </button>
                  );
                })}
              </div>
            </div>
            {member.role !== 'parent' && (
              <div className="settings-row">
                <div>
                  <div className="settings-row-label">
                    {t('settings.family.missionPointsLabel')}
                  </div>
                  <div className="settings-row-sublabel">
                    {t('settings.family.missionPointsHint')}
                  </div>
                </div>
                <input
                  type="number"
                  className="settings-input"
                  min="0"
                  step="0.01"
                  value={form.mission_points}
                  onChange={(event) =>
                    onChangeForm((f) =>
                      f
                        ? {
                            ...f,
                            mission_points: Math.max(0, Number(event.target.value) || 0),
                          }
                        : f,
                    )
                  }
                />
              </div>
            )}
            <div className="settings-row" style={{ alignItems: 'flex-start' }}>
              <div className="settings-row-label" style={{ paddingTop: 4 }}>
                {t('settings.family.tasksLabel')}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  flex: 1,
                  maxWidth: 340,
                }}
              >
                {form.tasks.map((task, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      className="settings-input"
                      value={task.name}
                      placeholder={t('settings.family.taskPlaceholder', { n: i + 1 })}
                      onChange={(e) =>
                        onChangeForm((f) => {
                          if (!f) return f;
                          const tasks = [...f.tasks];
                          tasks[i] = { ...tasks[i], name: e.target.value };
                          return { ...f, tasks };
                        })
                      }
                    />
                    <button
                      type="button"
                      className="settings-fm-btn"
                      disabled={i === 0}
                      aria-label={t('settings.family.moveUp')}
                      onClick={() =>
                        onChangeForm((f) => {
                          if (!f || i === 0) return f;
                          const tasks = [...f.tasks];
                          [tasks[i - 1], tasks[i]] = [tasks[i], tasks[i - 1]];
                          return { ...f, tasks };
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="settings-fm-btn"
                      disabled={i === form.tasks.length - 1}
                      aria-label={t('settings.family.moveDown')}
                      onClick={() =>
                        onChangeForm((f) => {
                          if (!f || i === f.tasks.length - 1) return f;
                          const tasks = [...f.tasks];
                          [tasks[i], tasks[i + 1]] = [tasks[i + 1], tasks[i]];
                          return { ...f, tasks };
                        })
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="settings-fm-btn settings-fm-btn--danger"
                      aria-label={t('settings.family.removeTask')}
                      onClick={() =>
                        onChangeForm((f) => {
                          if (!f) return f;
                          return { ...f, tasks: f.tasks.filter((_, j) => j !== i) };
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="settings-btn"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() =>
                    onChangeForm((f) => f && { ...f, tasks: [...f.tasks, { id: null, name: '' }] })
                  }
                >
                  {t('settings.family.addTask')}
                </button>
              </div>
            </div>
            <div style={{ padding: '12px 20px 16px', display: 'flex', gap: 8 }}>
              <button type="button" className="settings-btn settings-btn--primary" onClick={onSave}>
                {t('settings.family.saveRoutine')}
              </button>
              <button type="button" className="settings-btn" onClick={() => onChangeForm(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
