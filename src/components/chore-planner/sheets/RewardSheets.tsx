import { useEffect, useState } from 'react';
import { Plus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { PlannerMember } from '../../../api/chore-planner-model';
import type { Redemption } from '../../../api/reward-redemptions';
import type { ChoresManRewardHistoryEntry } from '../../../api/choresman-history';
import type { ChoresManReward } from '../../../types/choresman';
import { MemberAvatar } from '../../MemberAvatar';
import { ActivitySpinner } from '../../LoadingPlaceholder';
import type { PlannerCopy } from '../copy';
import { usePersistentState } from '../../../hooks/usePersistentState';

type HistoryRange = 'twoDays' | 'week' | 'all';

function isHistoryRange(value: unknown): value is HistoryRange {
  return value === 'twoDays' || value === 'week' || value === 'all';
}

export interface GoalsSheetProps {
  member: PlannerMember;
  rewards: ChoresManReward[];
  copy: PlannerCopy;
  renderRewardRow: (reward: ChoresManReward) => React.ReactNode;
  onNewGoal: (memberId: string) => void;
  /** True once the full cost is set aside, so the reward moves under Done. */
  isDone: (reward: ChoresManReward) => boolean;
  /** Rewards this child has reached and that are waiting for a parent. */
  awaiting?: Redemption[];
  /** Rewards already handed over (newest first). */
  given?: Redemption[];
  /** Reward spends from ChoresMan's retained point ledger. */
  ledgerHistory?: ChoresManRewardHistoryEntry[];
  /** Show only historical rewards, without repeating the current goal list. */
  historyOnly?: boolean;
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
  historyOnly = false,
  onGive,
  formatDate,
}: GoalsSheetProps) {
  const [historyRange, setHistoryRange] = usePersistentState(
    'abbai-flow-filter-goal-history-range',
    'all',
    isHistoryRange,
  );
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
      id: `choresman:${entry.id}`,
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
        {historyOnly ? c.rewardHistory : c.goals}
        {' \u00b7 '}
        {member.name}
      </h2>
      {!historyOnly && rewards.length === 0 && awaiting.length === 0 && history.length === 0 && (
        <p>{c.noRewards}</p>
      )}
      {!historyOnly && open.map((reward) => renderRewardRow(reward))}
      {!historyOnly && done.length > 0 && <h3 className="planner-reward-group">{c.done}</h3>}
      {!historyOnly && done.map((reward) => renderRewardRow(reward))}
      {/* Goal achieved is not the same as handed over: this is the parent's
          queue, and the only place a reward can be marked as given. */}
      {!historyOnly && awaiting.length > 0 && (
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
                setHistoryRange(event.currentTarget.value as HistoryRange)
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
      {historyOnly && history.length === 0 && (
        <p className="planner-history-empty">{c.historyEmpty}</p>
      )}
      {!historyOnly && (
        <button className="planner-ghost planner-reward-new" onClick={() => onNewGoal(member.id)}>
          <Plus />
          {c.setGoal}
        </button>
      )}
    </>
  );
}

export interface AssignPointsSheetProps {
  reward: ChoresManReward;
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
  /** Remove the reward definition from ChoresMan. */
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
