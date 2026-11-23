import { useState } from 'react';
import { ChevronDown, Clock3, Gift, ListChecks, Pencil } from 'lucide-react';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../../api/chore-planner-model';
import type { ChoreOpsChore, ChoreOpsReward } from '../../../types/choreops';
import type { PlannerCopy } from '../copy';

export interface CreateSheetProps {
  copy: PlannerCopy;
  chores: ChoreOpsChore[];
  tasks: PlannerTask[];
  routines: Array<Pick<PlannerRoutine, 'id' | 'name' | 'taskNames' | 'memberIds' | 'fallback'>>;
  rewards: ChoreOpsReward[];
  members: PlannerMember[];
  onChore: () => void;
  onRoutine: () => void;
  onReward: () => void;
  onEditChore: (task: PlannerTask) => void;
  onOpenReward: (reward: ChoreOpsReward) => void;
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
  onOpenReward,
}: CreateSheetProps) {
  const [browse, setBrowse] = useState<'chores' | 'rewards' | 'routines'>('chores');
  const choreGroups = new Map<string, ChoreOpsChore[]>();
  for (const chore of chores) {
    const key = chore.name.trim().toLowerCase();
    const group = choreGroups.get(key) ?? [];
    group.push(chore);
    choreGroups.set(key, group);
  }
  const rewardGroups = new Map<string, ChoreOpsReward[]>();
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

  return (
    <>
      <h2>{c.chooseWhat}</h2>
      <div className="planner-create-actions">
        <button className="planner-destination" onClick={onChore}>
          <ListChecks />
          <strong>{c.add}</strong>
        </button>
        <button className="planner-destination" onClick={onRoutine}>
          <Clock3 />
          <strong>{c.routineNew}</strong>
        </button>
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
              {label}<span>{count}</span>
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
                  const task = tasks.find(
                    (item) => item.name.trim().toLowerCase() === chore.name.trim().toLowerCase(),
                  );
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
                const steps = routine.taskNames ?? [];
                const assigned = memberNames(routine.memberIds);
                return (
                  <details className="planner-create-routine" key={routine.id}>
                    <summary>
                      <span>
                        <strong>{routine.fallback ? c.otherDaily : routine.name}</strong>
                        {assigned && <small>{assigned}</small>}
                      </span>
                      <span className="planner-create-step-count">{steps.length}</span>
                      <ChevronDown className="planner-create-routine-chevron" aria-hidden="true" />
                    </summary>
                    {steps.length > 0 && (
                      <ul>
                        {steps.map((name) => {
                          const task = tasks.find(
                            (item) =>
                              item.routineId === routine.id &&
                              item.name.trim().toLowerCase() === name.trim().toLowerCase(),
                          );
                          return (
                            <li key={name}>
                              {task ? (
                                <button
                                  type="button"
                                  className="planner-create-routine-step"
                                  onClick={() => onEditChore(task)}
                                  aria-label={`${c.edit}: ${name}`}
                                >
                                  <span>{name}</span>
                                  <Pencil size={14} aria-hidden="true" />
                                </button>
                              ) : (
                                <span>{name}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </details>
                );
              })
            ))}
        </div>
      </section>
    </>
  );
}
