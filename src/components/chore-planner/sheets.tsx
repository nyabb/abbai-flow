/**
 * Planner sheets for creating and browsing household items, row actions, the
 * award picker, board filter, claim sheet, goals list, and reward forms.
 *
 * They are presentational: every one receives the data it renders plus the
 * callbacks for its buttons, so the planner keeps all state and all ChoreOps
 * writes.
 */
import { useEffect, useState } from 'react';
import {
  CheckCheck,
  Clock3,
  Gift,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import type { Redemption } from '../../api/reward-redemptions';
import type { ChoreOpsRewardHistoryEntry } from '../../api/choreops-ledger';
import type { ChoreOpsChore, ChoreOpsReward } from '../../types/choreops';
import type { I18nValue } from '../../i18n';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';
import { ActivitySpinner } from '../LoadingPlaceholder';

/** What is set aside for a reward and what the goal still needs. */
export interface RewardState {
  saved: number;
  allocated: number;
  remaining: number;
  done: boolean;
  canAdd: boolean;
}

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
                              <span>{name}</span>
                              {task && (
                                <button
                                  type="button"
                                  onClick={() => onEditChore(task)}
                                  aria-label={`${c.edit}: ${name}`}
                                >
                                  <Pencil size={14} aria-hidden="true" />
                                </button>
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

export interface ActionsSheetProps {
  /** A completed standalone chore cannot be edited any more. */
  completed: boolean;
  copy: PlannerCopy;
  /** True once the delete button shows its "sure?" label. */
  confirmingDelete: boolean;
  /**
   * Parent-only sign-off, shown while the chore waits for approval. The caller
   * gates it behind the parent PIN; a child never gets this handler.
   */
  onApprove?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ActionsSheet({
  completed,
  copy: c,
  confirmingDelete,
  onApprove,
  onEdit,
  onDelete,
}: ActionsSheetProps) {
  return (
    <>
      <h2>{c.action}</h2>
      {onApprove && (
        <button className="planner-destination" onClick={onApprove}>
          <CheckCheck />
          <strong>{c.approveCompletion}</strong>
        </button>
      )}
      {!completed && (
        <button className="planner-destination" onClick={onEdit}>
          <Pencil />
          <strong>{c.edit}</strong>
        </button>
      )}
      <button className="planner-destination planner-danger" onClick={onDelete}>
        <Trash2 />
        <strong>{confirmingDelete ? c.sure : c.remove}</strong>
      </button>
    </>
  );
}

export interface AwardSheetProps {
  task: PlannerTask;
  copy: PlannerCopy;
  t: I18nValue['t'];
  /** What the child can still spend on goals. */
  spendable: number;
  rewards: ChoreOpsReward[];
  rewardState: (reward: ChoreOpsReward) => RewardState;
  onClose: () => void;
  onAssign: (reward: ChoreOpsReward) => void;
  onNewGoal: () => void;
}

/** The reference app asks where earned points should go after ticking a chore. */
export function AwardSheet({
  task,
  copy: c,
  t,
  spendable,
  rewards,
  rewardState,
  onClose,
  onAssign,
  onNewGoal,
}: AwardSheetProps) {
  return (
    <>
      <h2>{c.awardTitle}</h2>
      <p className="planner-hint">
        {task.name}
        {task.points > 0 && ` \u00b7 ${'\u{1F3C6}'} ${task.points}`}
      </p>
      <div className="planner-goal-list">
        <button type="button" className="planner-goal" onClick={onClose}>
          <span className="planner-goal-icon" aria-hidden="true">
            {'\u{1F3E6}'}
          </span>
          <span className="planner-goal-copy">
            <strong>{c.savingsPot}</strong>
            <small>
              {c.pot} \u00b7 {spendable}
            </small>
          </span>
        </button>
        {rewards.map((reward) => {
          const { canAdd, remaining } = rewardState(reward);
          return (
            <button
              type="button"
              className="planner-goal"
              key={reward.id}
              disabled={!canAdd}
              onClick={() => onAssign(reward)}
            >
              <span className="planner-goal-icon" aria-hidden="true">
                {'\u{1F381}'}
              </span>
              <span className="planner-goal-copy">
                <strong>{reward.name}</strong>
                <small>
                  {canAdd ? c.assign : t('planner.stillNeeded', { points: String(remaining) })}
                </small>
              </span>
            </button>
          );
        })}
        <button type="button" className="planner-goal planner-goal--new" onClick={onNewGoal}>
          <span className="planner-goal-icon" aria-hidden="true">
            +
          </span>
          <span className="planner-goal-copy">
            <strong>{c.setGoal}</strong>
          </span>
        </button>
      </div>
    </>
  );
}

export interface FilterSheetProps {
  members: PlannerMember[];
  routines: PlannerRoutine[];
  hiddenMemberIds: string[];
  pausedRoutineIds: string[];
  copy: PlannerCopy;
  onToggleMember: (memberId: string) => void;
  onToggleRoutine: (routineId: string) => void;
  onClose: () => void;
}

export function FilterSheet({
  members,
  routines,
  hiddenMemberIds,
  pausedRoutineIds,
  copy: c,
  onToggleMember,
  onToggleRoutine,
  onClose,
}: FilterSheetProps) {
  return (
    <>
      <h2>{c.filterTitle}</h2>
      <div className="planner-member-picker">
        {members.map((member) => {
          const hidden = hiddenMemberIds.includes(member.id);
          return (
            <button
              type="button"
              key={member.id}
              className={hidden ? '' : 'is-selected'}
              aria-pressed={!hidden}
              onClick={() => onToggleMember(member.id)}
            >
              <MemberAvatar member={member} />
              {member.name}
            </button>
          );
        })}
      </div>
      {routines.length > 0 && (
        <>
          <h2>{c.pausedRoutines}</h2>
          <div className="planner-goal-list">
            {routines.map((routine) => {
              const paused = pausedRoutineIds.includes(routine.id);
              return (
                <button
                  type="button"
                  className="planner-goal"
                  key={routine.id}
                  onClick={() => onToggleRoutine(routine.id)}
                >
                  <span className="planner-goal-icon" aria-hidden="true">
                    {routine.icon}
                  </span>
                  <span className="planner-goal-copy">
                    <strong>{routine.fallback ? c.otherDaily : routine.name}</strong>
                    <small>{paused ? c.paused : c.active}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onClose}>
          {c.cancel}
        </button>
      </footer>
    </>
  );
}

export interface ClaimSheetProps {
  task: PlannerTask;
  /** One row per child that can take this chore. */
  options: PlannerTask[];
  memberFor: (memberId: string | null) => PlannerMember | null;
  copy: PlannerCopy;
  onClaim: (option: PlannerTask) => void;
  onClose: () => void;
}

/** ChoreOps publishes one row per user for a first-come-first-served chore. */
export function ClaimSheet({
  task,
  options,
  memberFor,
  copy: c,
  onClaim,
  onClose,
}: ClaimSheetProps) {
  return (
    <>
      <h2>{task.name}</h2>
      <p className="planner-hint">{c.claimWho}</p>
      <div className="planner-member-picker planner-member-picker--claim">
        {options.map((option) => {
          const member = memberFor(option.memberId);
          if (!member) return null;
          return (
            <button key={option.memberId} type="button" onClick={() => onClaim(option)}>
              <MemberAvatar member={member} />
              {member.name}
            </button>
          );
        })}
      </div>
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onClose}>
          {c.cancel}
        </button>
      </footer>
    </>
  );
}

export interface GoalsSheetProps {
  member: PlannerMember;
  rewards: ChoreOpsReward[];
  copy: PlannerCopy;
  renderRewardRow: (reward: ChoreOpsReward) => React.ReactNode;
  onNewGoal: (memberId: string) => void;
  /** True once the full cost is set aside, so the reward moves under Done. */
  isDone: (reward: ChoreOpsReward) => boolean;
  /** Rewards this child has reached and that are waiting for a parent. */
  awaiting?: Redemption[];
  /** Rewards already handed over (newest first). */
  given?: Redemption[];
  /** Reward spends from ChoreOps' retained point ledger. */
  ledgerHistory?: ChoreOpsRewardHistoryEntry[];
  /** Parent-only action, gated by the PIN in the caller. */
  onGive?: (id: string) => void;
  formatDate?: (value: number) => string;
}

export function GoalsSheet({
  member,
  rewards,
  copy: c,
  renderRewardRow,
  onNewGoal,
  isDone,
  awaiting = [],
  given = [],
  ledgerHistory = [],
  onGive,
  formatDate,
}: GoalsSheetProps) {
  const [historyRange, setHistoryRange] = useState<'twoDays' | 'week' | 'all'>('all');
  /*
   * A reward whose full cost is set aside is "on hold": the child is no longer
   * saving for it, so it belongs under Done the way a finished chore does. It
   * stays listed so they can use it again or delete it, rather than having to
   * re-create it.
   */
  const done = rewards.filter((reward) => isDone(reward));
  const open = rewards.filter((reward) => !isDone(reward));
  const ledgerOnly = ledgerHistory.filter(
    (entry) =>
      !given.some((redemption) => {
        if (!redemption.fulfilledAt) return false;
        const sameReward =
          redemption.rewardLabel.trim().toLocaleLowerCase() === entry.itemName.toLocaleLowerCase();
        return sameReward && Math.abs(redemption.fulfilledAt - entry.timestampMs) < 15 * 60_000;
      }),
  );
  const history = [
    ...given.map((redemption) => ({
      id: `abbai:${redemption.id}`,
      rewardLabel: redemption.rewardLabel,
      at: redemption.fulfilledAt ?? 0,
      fulfilledBy: redemption.fulfilledBy,
      points: null as number | null,
    })),
    ...ledgerOnly.map((entry) => ({
      id: `choreops:${entry.id}`,
      rewardLabel: entry.itemName,
      at: entry.timestampMs,
      fulfilledBy: null,
      points: Math.abs(entry.amount),
    })),
  ].sort((left, right) => right.at - left.at);
  const rangeStart =
    historyRange === 'twoDays'
      ? Date.now() - 2 * 24 * 60 * 60 * 1000
      : historyRange === 'week'
        ? Date.now() - 7 * 24 * 60 * 60 * 1000
        : null;
  const visibleHistory =
    rangeStart === null ? history : history.filter((item) => item.at >= rangeStart);

  return (
    <>
      <h2>
        {c.goals}
        {' \u00b7 '}
        {member.name}
      </h2>
      {rewards.length === 0 && awaiting.length === 0 && history.length === 0 && (
        <p>{c.noRewards}</p>
      )}
      {open.map((reward) => renderRewardRow(reward))}
      {done.length > 0 && <h3 className="planner-reward-group">{c.done}</h3>}
      {done.map((reward) => renderRewardRow(reward))}
      {/* Goal achieved is not the same as handed over: this is the parent's
          queue, and the only place a reward can be marked as given. */}
      {awaiting.length > 0 && (
        <>
          <h3 className="planner-reward-group">{c.rewardsToGive}</h3>
          {awaiting.map((redemption) => (
            <div className="planner-reward planner-reward--done" key={redemption.id}>
              <span aria-hidden="true">{'\u{1F381}'}</span>
              <div className="planner-reward-copy">
                <strong>{redemption.rewardLabel}</strong>
                <small>
                  {`${redemption.points} / ${redemption.cost} ${c.pointsUnit}`}
                  {` \u00b7 ${c.waitingForReward}`}
                </small>
              </div>
              {onGive && (
                <div className="planner-reward-actions">
                  <button
                    className="planner-primary planner-reward-action"
                    onClick={() => onGive(redemption.id)}
                  >
                    {c.approvePayout}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {history.length > 0 && (
        <>
          <h3 className="planner-reward-group">{c.givenRewards}</h3>
          <label className="planner-history-filter">
            <span>{c.historyRange}</span>
            <select
              value={historyRange}
              onChange={(event) =>
                setHistoryRange(event.currentTarget.value as 'twoDays' | 'week' | 'all')
              }
            >
              <option value="twoDays">{c.historyLastTwoDays}</option>
              <option value="week">{c.historyLastWeek}</option>
              <option value="all">{c.historyAllTime}</option>
            </select>
          </label>
          {visibleHistory.length === 0 && <p className="planner-history-empty">{c.historyEmpty}</p>}
          {visibleHistory.map((item) => (
            <div className="planner-reward planner-reward--done" key={item.id}>
              <span aria-hidden="true">{'\u2705'}</span>
              <div className="planner-reward-copy">
                <strong>{item.rewardLabel}</strong>
                <small>
                  {c.rewardGiven}
                  {item.at && formatDate
                    ? ` \u00b7 ${formatDate(item.at)}`
                    : ''}
                  {item.fulfilledBy ? ` \u00b7 ${item.fulfilledBy}` : ''}
                  {item.points !== null ? ` \u00b7 ${item.points} ${c.pointsUnit}` : ''}
                </small>
              </div>
            </div>
          ))}
        </>
      )}
      <button className="planner-ghost planner-reward-new" onClick={() => onNewGoal(member.id)}>
        <Plus />
        {c.setGoal}
      </button>
    </>
  );
}

export interface AssignPointsSheetProps {
  reward: ChoreOpsReward;
  /** Points already set aside for this reward. */
  allocated: number;
  /** What the child can still spend right now. */
  spendable: number;
  saving: boolean;
  copy: PlannerCopy;
  onCancel: () => void;
  onAssign: (amount: number) => void;
}

/**
 * Explicit amount picker.
 *
 * The child chooses how much of the balance goes to this reward, so several
 * goals can be funded side by side while the rest stays in the savings pot.
 * It replaced "take as much as the goal still needs", which made a 5 + 3 split
 * impossible unless the costs happened to match.
 */
export function AssignPointsSheet({
  reward,
  allocated,
  spendable,
  saving,
  copy: c,
  onCancel,
  onAssign,
}: AssignPointsSheetProps) {
  const max = Math.max(0, Math.min(reward.cost - allocated, spendable));
  const [amount, setAmount] = useState(max);
  useEffect(() => setAmount(max), [max]);
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= max;

  return (
    <>
      <h2>{c.assignPoints}</h2>
      <p className="planner-hint">
        {reward.name}
        {` \u00b7 ${allocated} / ${reward.cost} ${c.pointsUnit}`}
      </p>
      <p className="planner-hint">
        {c.pot}
        {` \u00b7 ${spendable}`}
      </p>
      <label className="planner-field">
        {c.points}
        <input
          autoFocus
          type="number"
          min={1}
          max={max}
          step={1}
          value={Number.isFinite(amount) ? amount : ''}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
      </label>
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onCancel}>
          {c.cancel}
        </button>
        <button
          className="planner-primary"
          aria-busy={saving}
          disabled={!valid || saving}
          onClick={() => onAssign(Math.round(amount))}
        >
          {saving && <ActivitySpinner className="activity-spinner--small" />}
          {c.assign}
        </button>
      </footer>
    </>
  );
}

export interface RewardGivenSheetProps {
  rewardName: string;
  copy: PlannerCopy;
  /** Keep the goal and put it back at 0 allocations. */
  onReuse: () => void;
  /** Remove the reward definition from ChoreOps. */
  onDelete: () => void;
}

/**
 * The question asked right after a parent approved a payout: the goal is met,
 * so the reward can either be saved for again from zero or deleted.
 */
export function RewardGivenSheet({
  rewardName,
  copy: c,
  onReuse,
  onDelete,
}: RewardGivenSheetProps) {
  return (
    <>
      <h2>{c.rewardGiven}</h2>
      <p className="planner-hint">{rewardName}</p>
      <p>{c.chooseWhat}</p>
      <button className="planner-destination" onClick={onReuse}>
        <RotateCcw />
        <strong>{c.useAgain}</strong>
      </button>
      <button className="planner-destination planner-danger" onClick={onDelete}>
        <Trash2 />
        <strong>{c.remove}</strong>
      </button>
    </>
  );
}

export interface RewardActionsSheetProps {
  copy: PlannerCopy;
  onEdit: () => void;
  onDelete: () => void;
}

export function RewardActionsSheet({ copy: c, onEdit, onDelete }: RewardActionsSheetProps) {
  return (
    <>
      <h2>{c.action}</h2>
      <button className="planner-destination" onClick={onEdit}>
        <Pencil />
        <strong>{c.edit}</strong>
      </button>
      <button className="planner-destination planner-danger" onClick={onDelete}>
        <Trash2 />
        <strong>{c.remove}</strong>
      </button>
    </>
  );
}

export interface RewardFormValue {
  name: string;
  cost: number;
  memberIds: string[];
}

export interface RewardFormSheetProps {
  rewardForm: RewardFormValue;
  setRewardForm: React.Dispatch<React.SetStateAction<RewardFormValue>>;
  /** Name of the reward being edited; `null` creates a new one. */
  editingReward: string | null;
  members: PlannerMember[];
  saving: boolean;
  copy: PlannerCopy;
  onCancel: () => void;
  onSave: () => void;
}

export function RewardFormSheet({
  rewardForm,
  setRewardForm,
  editingReward,
  members,
  saving,
  copy: c,
  onCancel,
  onSave,
}: RewardFormSheetProps) {
  return (
    <>
      <h2>{editingReward ? c.edit : c.newReward}</h2>
      <label className="planner-field">
        {c.name}
        <input
          autoFocus
          value={rewardForm.name}
          disabled={Boolean(editingReward)}
          onChange={(event) => setRewardForm((value) => ({ ...value, name: event.target.value }))}
        />
        {editingReward && <small className="planner-hint">{c.renameLocked}</small>}
      </label>
      <label className="planner-field">
        {c.cost}
        <input
          type="number"
          min="1"
          max="9999"
          value={rewardForm.cost}
          onChange={(event) =>
            setRewardForm((value) => ({ ...value, cost: Number(event.target.value) }))
          }
        />
      </label>
      <fieldset className="planner-field">
        <legend>{c.forWho}</legend>
        <div className="planner-member-picker">
          {members.map((member) => {
            const selected = rewardForm.memberIds.includes(member.id);
            return (
              <button
                key={member.id}
                type="button"
                className={selected ? 'is-selected' : ''}
                aria-pressed={selected}
                onClick={() =>
                  setRewardForm((value) => ({
                    ...value,
                    memberIds: value.memberIds.includes(member.id)
                      ? value.memberIds.filter((id) => id !== member.id)
                      : [...value.memberIds, member.id],
                  }))
                }
              >
                <MemberAvatar member={member} />
                {member.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onCancel}>
          {c.cancel}
        </button>
        <button
          className="planner-primary"
          aria-busy={saving}
          disabled={
            saving ||
            rewardForm.cost < 1 ||
            rewardForm.memberIds.length === 0 ||
            (!editingReward && !rewardForm.name.trim())
          }
          onClick={onSave}
        >
          {saving && <ActivitySpinner className="activity-spinner--small" />}
          {c.save}
        </button>
      </footer>
    </>
  );
}
