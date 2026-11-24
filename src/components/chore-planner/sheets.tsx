/**
 * Presentational task and filter sheets. Reward sheets and the household
 * create browser live in adjacent modules to keep each file focused.
 */
import { CheckCheck, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { PlannerMember, PlannerTask } from '../../api/chore-planner-model';
import type { ChoreOpsReward } from '../../types/choreops';
import type { I18nValue } from '../../i18n';
import { MemberAvatar } from '../MemberAvatar';
import type { PlannerCopy } from './copy';

/** What is set aside for a reward and what the goal still needs. */
export interface RewardState {
  saved: number;
  allocated: number;
  remaining: number;
  done: boolean;
  canAdd: boolean;
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
  onUseAgain?: () => void;
}

export function ActionsSheet({
  completed,
  copy: c,
  confirmingDelete,
  onApprove,
  onEdit,
  onDelete,
  onUseAgain,
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
      {onUseAgain && (
        <button className="planner-destination" onClick={onUseAgain}>
          <RotateCcw />
          <strong>{c.useAgain}</strong>
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
  rewards: ChoreOpsReward[];
  rewardState: (reward: ChoreOpsReward) => RewardState;
  onAssign: (reward: ChoreOpsReward) => void;
  onNewGoal: () => void;
}

/** The reference app asks where earned points should go after ticking a chore. */
export function AwardSheet({
  task,
  copy: c,
  t,
  rewards,
  rewardState,
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
  hiddenMemberIds: string[];
  copy: PlannerCopy;
  onToggleMember: (memberId: string) => void;
  onClose: () => void;
}

export function FilterSheet({
  members,
  hiddenMemberIds,
  copy: c,
  onToggleMember,
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

export { CreateSheet } from './sheets/CreateSheet';
export type { CreateSheetProps } from './sheets/CreateSheet';
export {
  AssignPointsSheet,
  GoalsSheet,
  RewardActionsSheet,
  RewardFormSheet,
  RewardGivenSheet,
} from './sheets/RewardSheets';
export type {
  AssignPointsSheetProps,
  GoalsSheetProps,
  RewardActionsSheetProps,
  RewardFormSheetProps,
  RewardFormValue,
  RewardGivenSheetProps,
} from './sheets/RewardSheets';
