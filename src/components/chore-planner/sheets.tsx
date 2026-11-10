/**
 * The remaining planner sheets: row actions, the award (goal) picker, the
 * board filter, the "who is taking this?" claim sheet, the goals list and the
 * reward create/edit sheets.
 *
 * They are presentational: every one receives the data it renders plus the
 * callbacks for its buttons, so the planner keeps all state and all ChoreOps
 * writes.
 */
import { CheckCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import type { PlannerMember, PlannerRoutine, PlannerTask } from '../../api/chore-planner-model';
import type { Redemption } from '../../api/reward-redemptions';
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
  /** A completed chore cannot be edited any more. */
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
  onGive,
  formatDate,
}: GoalsSheetProps) {
  /*
   * A reward whose full cost is set aside is "on hold": the child is no longer
   * saving for it, so it belongs under Done the way a finished chore does. It
   * stays listed so they can use it again or delete it, rather than having to
   * re-create it.
   */
  const done = rewards.filter((reward) => isDone(reward));
  const open = rewards.filter((reward) => !isDone(reward));

  return (
    <>
      <h2>
        {c.goals}
        {' \u00b7 '}
        {member.name}
      </h2>
      {rewards.length === 0 && awaiting.length === 0 && <p>{c.noRewards}</p>}
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
                    {c.markGiven}
                  </button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      {given.length > 0 && (
        <>
          <h3 className="planner-reward-group">{c.givenRewards}</h3>
          {given.map((redemption) => (
            <div className="planner-reward planner-reward--done" key={redemption.id}>
              <span aria-hidden="true">{'\u2705'}</span>
              <div className="planner-reward-copy">
                <strong>{redemption.rewardLabel}</strong>
                <small>
                  {c.rewardGiven}
                  {redemption.fulfilledAt && formatDate
                    ? ` \u00b7 ${formatDate(redemption.fulfilledAt)}`
                    : ''}
                  {redemption.fulfilledBy ? ` \u00b7 ${redemption.fulfilledBy}` : ''}
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

export interface RewardActionsSheetProps {
  copy: PlannerCopy;
  onEditCost: () => void;
  onDelete: () => void;
}

export function RewardActionsSheet({ copy: c, onEditCost, onDelete }: RewardActionsSheetProps) {
  return (
    <>
      <h2>{c.action}</h2>
      <button className="planner-destination" onClick={onEditCost}>
        <Pencil />
        <strong>{c.cost}</strong>
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
      <h2>{editingReward ? c.cost : c.newReward}</h2>
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
      {!editingReward && (
        <fieldset className="planner-field">
          <legend>{c.forWho}</legend>
          <div className="planner-member-picker">
            {members.map((member) => (
              <button
                key={member.id}
                className={rewardForm.memberIds.includes(member.id) ? 'is-selected' : ''}
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
            ))}
          </div>
        </fieldset>
      )}
      <footer className="planner-sheet-footer">
        <button className="planner-ghost" onClick={onCancel}>
          {c.cancel}
        </button>
        <button
          className="planner-primary"
          disabled={
            saving ||
            rewardForm.cost < 1 ||
            (!editingReward && (!rewardForm.name.trim() || rewardForm.memberIds.length === 0))
          }
          onClick={onSave}
        >
          {saving ? '\u2026' : c.save}
        </button>
      </footer>
    </>
  );
}
