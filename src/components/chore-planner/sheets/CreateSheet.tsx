import { useState } from 'react';
import {
  ChevronDown,
  Gift,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Repeat,
  RotateCcw,
} from 'lucide-react';
import type { PlannerMember, PlannerTask } from '../../../api/chore-planner-model';
import type { ChoresManChore, ChoresManReward } from '../../../types/choresman';
import type { Routine } from '../../../types/family';
import type { PlannerCopy } from '../copy';
import { RoutineActionsMenu } from '../../routines/RoutineActionsMenu';

export interface CreateSheetProps {
  copy: PlannerCopy;
  chores: ChoresManChore[];
  tasks: PlannerTask[];
  routines: Routine[];
  rewards: ChoresManReward[];
  members: PlannerMember[];
  onChore: () => void;
  onRoutine?: () => void;
  onReward: () => void;
  onEditChore: (task: PlannerTask) => void;
  onOpenTaskActions: (task: PlannerTask) => void;
  onUseAgain: (task: PlannerTask) => void;
  onOpenReward: (reward: ChoresManReward) => void;
  onEditRoutine: (routine: Routine) => void;
  onDeleteRoutine: (routine: Routine) => void;
}

/**
 * The header "+" asks what to create instead of assuming a chore. Rewards are
 * created here too, with the same child picker a chore uses.
 */
export function CreateSheet({
  copy: c,
  chores,
  tasks,
  routines,
  rewards,
  members,
  onChore,
  onRoutine,
  onReward,
  onEditChore,
  onOpenTaskActions,
  onUseAgain,
  onOpenReward,
  onEditRoutine,
  onDeleteRoutine,
}: CreateSheetProps) {
  const [browse, setBrowse] = useState<'chores' | 'rewards' | 'routines'>('chores');
  const choreGroups = new Map<string, ChoresManChore[]>();
  for (const chore of chores) {
    const key = chore.name.trim().toLowerCase();
    const group = choreGroups.get(key) ?? [];
    group.push(chore);
    choreGroups.set(key, group);
  }
  const rewardGroups = new Map<string, ChoresManReward[]>();
  for (const reward of rewards) {
    const key = `${reward.name.trim().toLowerCase()}::${reward.cost}`;
    const group = rewardGroups.get(key) ?? [];
    group.push(reward);
    rewardGroups.set(key, group);
  }
  const memberNames = (memberIds: Array<string | null>) =>
    Array.from(new Set(memberIds.filter((id): id is string => Boolean(id))))
      .map((id) => members.find((member) => member.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ');
  const isCompleted = (task: PlannerTask) =>
    task.statusOverride ? task.statusOverride === 'completed' : Boolean(task.completedAt);

  return (
    <>
      <h2>{c.chooseWhat}</h2>
      <div className="planner-create-actions">
        <button className="planner-destination" onClick={onChore}>
          <ListChecks />
          <strong>{c.add}</strong>
        </button>
        {onRoutine && (
          <button className="planner-destination" onClick={onRoutine}>
            <Repeat />
            <strong>{c.routineNew}</strong>
          </button>
        )}
        <button className="planner-destination" onClick={onReward}>
          <Gift />
          <strong>{c.newReward}</strong>
        </button>
      </div>

      <section className="planner-create-management">
        <h3>{c.manageExisting}</h3>
        <div className="planner-create-tabs" role="tablist" aria-label={c.manageExisting}>
          {(
            [
              ['chores', c.choresColumn, choreGroups.size],
              ['rewards', c.rewards, rewardGroups.size],
              ['routines', c.routines, routines.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={browse === key}
              className={browse === key ? 'is-active' : ''}
              onClick={() => setBrowse(key)}
            >
              {label}
              <span>{count}</span>
            </button>
          ))}
        </div>

        <div className="planner-create-list" role="tabpanel">
          {browse === 'chores' &&
            (choreGroups.size === 0 ? (
              <p className="planner-col-empty">{c.nothing}</p>
            ) : (
              Array.from(choreGroups.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, group]) => {
                  const chore = group[0];
                  const matchingTasks = tasks.filter(
                    (item) => item.name.trim().toLowerCase() === chore.name.trim().toLowerCase(),
                  );
                  const task = matchingTasks.find(isCompleted) ?? matchingTasks[0];
                  const assignedNames = Array.from(
                    new Set(
                      group
                        .flatMap((item) => item.assignedUserNames ?? [])
                        .map((name) => name.trim())
                        .filter(Boolean),
                    ),
                  ).filter((name) => name !== '*');
                  const assigned =
                    task?.audience === 'everyone'
                      ? c.everyone
                      : task?.audience === 'anyone' ||
                          task?.freeForAll ||
                          (assignedNames.length === 0 &&
                            group.some((item) => item.completionCriteria === 'shared_first'))
                        ? c.anyone
                        : assignedNames.join(', ') ||
                          memberNames(group.map(() => task?.memberId ?? null));
                  return (
                    <div className="planner-create-row" key={key}>
                      <span>
                        <strong>{chore.name}</strong>
                        <small>
                          {chore.points ?? 0} {c.pointsUnit}
                          {assigned ? ` · ${assigned}` : ''}
                        </small>
                      </span>
                      {task && (
                        <div className="planner-create-row-actions">
                          {task.inRoutine ? (
                            <button
                              type="button"
                              onClick={() => onOpenTaskActions(task)}
                              aria-label={`${c.action}: ${chore.name}`}
                              title={c.action}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                            </button>
                          ) : isCompleted(task) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onUseAgain(task)}
                                aria-label={`${c.useAgain}: ${chore.name}`}
                                title={c.useAgain}
                              >
                                <RotateCcw size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onOpenTaskActions(task)}
                                aria-label={`${c.action}: ${chore.name}`}
                                title={c.action}
                              >
                                <MoreHorizontal size={16} aria-hidden="true" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onEditChore(task)}
                              aria-label={`${c.edit}: ${chore.name}`}
                              title={c.edit}
                            >
                              <Pencil size={16} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            ))}

          {browse === 'rewards' &&
            (rewardGroups.size === 0 ? (
              <p className="planner-col-empty">{c.noRewards}</p>
            ) : (
              Array.from(rewardGroups.values())
                .sort((left, right) => left[0].name.localeCompare(right[0].name))
                .map((group) => {
                  const reward = group[0];
                  const assigned = Array.from(
                    new Set(
                      group
                        .map((item) => item.assignee?.trim())
                        .filter((name): name is string => Boolean(name)),
                    ),
                  ).join(', ');
                  return (
                    <button
                      type="button"
                      className="planner-create-row"
                      key={`${reward.name}-${reward.cost}`}
                      onClick={() => onOpenReward(reward)}
                      aria-label={`${c.edit}: ${reward.name}`}
                    >
                      <span>
                        <strong>{reward.name}</strong>
                        <small>
                          {reward.cost} {c.pointsUnit}
                          {assigned ? ` · ${assigned}` : ''}
                        </small>
                      </span>
                      <Pencil size={16} aria-hidden="true" />
                    </button>
                  );
                })
            ))}

          {browse === 'routines' &&
            (routines.length === 0 ? (
              <p className="planner-col-empty">{c.noRoutines}</p>
            ) : (
              routines.map((routine) => {
                const steps = [...routine.tasks].sort((a, b) => a.order - b.order);
                const assigned = memberNames([routine.member_id]);
                return (
                  <div className="planner-create-routine-row" key={routine.id}>
                    <details className="planner-create-routine">
                      <summary>
                        <span>
                          <strong>{routine.name}</strong>
                          <small>
                            {assigned} · {routine.time_of_day}
                            {members.find((member) => member.id === routine.member_id)?.role !==
                              'parent' && ` · ${routine.mission_points ?? 5} ${c.pointsUnit}`}
                          </small>
                        </span>
                        <span className="planner-create-step-count">{steps.length}</span>
                        <ChevronDown
                          className="planner-create-routine-chevron"
                          aria-hidden="true"
                        />
                      </summary>
                      {steps.length > 0 && (
                        <ul>
                          {steps.map((step) => (
                            <li key={step.id}>
                              <span>{step.name}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                    <RoutineActionsMenu
                      routineName={routine.name}
                      onEdit={() => onEditRoutine(routine)}
                      onDelete={() => onDeleteRoutine(routine)}
                    />
                  </div>
                );
              })
            ))}
        </div>
      </section>
    </>
  );
}
