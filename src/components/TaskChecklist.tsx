import { useMemo, useState } from 'react';
import { ListTodo } from 'lucide-react';
import type { Chore, FamilyMember } from '../types/family';
import { hapticMedium, hapticSuccess } from '../hooks/useHaptics';
import { useTranslation } from '../i18n';
import { MemberAvatar } from './MemberAvatar';

interface TaskChecklistProps {
  chores: Chore[];
  completedIds: Set<string>;
  waitingIds?: Set<string>;
  onToggle: (choreId: string) => void;
  members?: FamilyMember[];
  groupByAssignee?: boolean;
}

interface ChoreGroup {
  id: string;
  member: FamilyMember | null;
  chores: Chore[];
}

export function TaskChecklist({
  chores,
  completedIds,
  waitingIds = new Set(),
  onToggle,
  members = [],
  groupByAssignee = false,
}: TaskChecklistProps) {
  const { t } = useTranslation();
  const [animatingId, setAnimatingId] = useState<string | null>(null);

  const groups = useMemo<ChoreGroup[]>(() => {
    if (!groupByAssignee) return [{ id: 'all', member: null, chores }];

    const assignedGroups: ChoreGroup[] = members
      .map((member) => ({
        id: member.id,
        member,
        chores: chores.filter((chore) => chore.assigned_to?.includes(member.id)),
      }))
      .filter((group) => group.chores.length > 0);
    const ungrouped = chores.filter(
      (chore) => !chore.assigned_to?.some((id) => members.some((member) => member.id === id)),
    );
    if (ungrouped.length > 0) {
      assignedGroups.push({ id: 'household', member: null, chores: ungrouped });
    }
    return assignedGroups;
  }, [chores, groupByAssignee, members]);

  const incompleteCount = chores.filter((chore) => !completedIds.has(chore.id)).length;

  const handleToggle = (choreId: string) => {
    if (completedIds.has(choreId)) return;
    setAnimatingId(choreId);
    setTimeout(() => setAnimatingId(null), 400);
    hapticMedium();
    if (incompleteCount === 1) hapticSuccess();
    onToggle(choreId);
  };

  if (chores.length === 0) {
    return <div className="task-checklist-empty">{t('taskChecklist.empty')}</div>;
  }

  return (
    <div className={`task-checklist${groupByAssignee ? ' task-checklist--grouped' : ''}`}>
      {incompleteCount === 0 && (
        <div className="task-checklist-done">{t('taskChecklist.allDone')}</div>
      )}
      {groups.map((group) => {
        const groupDone = group.chores.filter((chore) => completedIds.has(chore.id)).length;
        return (
          <section className="task-checklist-group" key={group.id}>
            {groupByAssignee && (
              <div className="task-checklist-person">
                {group.member ? (
                  <span
                    className="task-checklist-person-avatar"
                    style={{
                      backgroundColor: `${group.member.color}22`,
                      color: group.member.color,
                    }}
                  >
                    <MemberAvatar member={group.member} size={28} />
                  </span>
                ) : (
                  <span className="task-checklist-person-avatar task-checklist-person-avatar--home">
                    <ListTodo size={16} aria-hidden="true" />
                  </span>
                )}
                <strong>{group.member?.name ?? t('calendarSidebar.household')}</strong>
                <span
                  className="task-checklist-progress"
                  aria-label={`${groupDone}/${group.chores.length}`}
                >
                  {groupDone}/{group.chores.length}
                </span>
              </div>
            )}
            <div className="task-checklist-items">
              {group.chores.map((chore) => {
                const done = completedIds.has(chore.id);
                const waiting = waitingIds.has(chore.id);
                const className = [
                  'task-checklist-row',
                  done ? 'task-checklist-row--done' : '',
                  waiting ? 'task-checklist-row--waiting' : '',
                  animatingId === chore.id ? 'task-checklist-row--completing' : '',
                ].filter(Boolean).join(' ');
                const contents = (
                  <>
                    <span className="task-checklist-icon" aria-hidden="true">
                      {chore.icon || <ListTodo size={17} />}
                    </span>
                    <span className="task-checklist-copy">
                      <span className="task-checklist-name" title={chore.name}>
                        {chore.name}
                      </span>
                      <span
                        className={`task-checklist-status${
                          done
                            ? ' task-checklist-status--done'
                            : waiting
                              ? ' task-checklist-status--waiting'
                              : ''
                        }`}
                      >
                        {done
                          ? t('taskChecklist.done')
                          : waiting
                            ? t('planner.awaitingApproval')
                            : t('taskChecklist.markDone')}
                      </span>
                    </span>
                  </>
                );

                return done || waiting ? (
                  <div
                    className={className}
                    key={chore.id}
                    role="group"
                    aria-label={`${chore.name}: ${
                      done ? t('taskChecklist.done') : t('planner.awaitingApproval')
                    }`}
                  >
                    {contents}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={className}
                    key={chore.id}
                    onClick={() => handleToggle(chore.id)}
                    aria-label={t('taskChecklist.complete', { name: chore.name })}
                  >
                    {contents}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
