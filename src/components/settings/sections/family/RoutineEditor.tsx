/** The member's routine list. Editing and creation use the shared dialog. */
import { ChevronLeft } from 'lucide-react';
import type { I18nValue } from '../../../../i18n';
import type { FamilyMember, Routine } from '../../../../types/family';
import { MemberAvatar } from '../../../MemberAvatar';
import { RoutineActionsMenu } from '../../../routines/RoutineActionsMenu';

export interface RoutineEditorProps {
  member: FamilyMember;
  routines: Routine[];
  t: I18nValue['t'];
  locale: string;
  weekStartsOn: 0 | 1;
  onBack: () => void;
  onStartCreate: () => void;
  onStartEdit: (routine: Routine) => void;
  onDelete: (id: string) => void;
}

export function RoutineEditor({
  member,
  routines,
  t,
  locale,
  weekStartsOn,
  onBack,
  onStartCreate,
  onStartEdit,
  onDelete,
}: RoutineEditorProps) {
  const firstWeekday = weekStartsOn === 1 ? 1 : 0;
  const weekdayOrder = Array.from({ length: 7 }, (_, index) => (firstWeekday + index) % 7);
  const shortWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const weekdayDate = (day: number) => new Date(2023, 0, day + 1, 12);
  const routineDaysLabel = (routine: Routine) => {
    const days = routine.days_of_week?.length ? routine.days_of_week : [0, 1, 2, 3, 4, 5, 6];
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
                      {routine.mission_points ?? 5} {t('settings.family.missionPointsLabel')}
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
              <RoutineActionsMenu
                routineName={routine.name}
                onEdit={() => onStartEdit(routine)}
                onDelete={() => onDelete(routine.id)}
              />
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 20px 16px' }}>
          <button
            type="button"
            className="settings-btn settings-btn--primary"
            onClick={onStartCreate}
          >
            {t('settings.family.addRoutine')}
          </button>
        </div>
      </div>
    </>
  );
}
