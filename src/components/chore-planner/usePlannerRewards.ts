import { useState, type Dispatch, type SetStateAction } from 'react';
import { activeRedemption } from '../../api/reward-redemptions';
import type { Redemption } from '../../api/reward-redemptions';
import type { ChoreOpsReward } from '../../types/choreops';
import type { UseChoreOpsResult } from '../../hooks/useChoreOps';
import type { UseRewardRedemptionsResult } from '../../hooks/useRewardRedemptions';
import type { PlannerMember } from '../../api/chore-planner-model';
import { normaliseName } from '../../api/planner-meta';
import { toastWith } from './form';
import type { PlannerCopy } from './copy';
import type { PlannerOverlayEvent } from './overlay-state';

interface UsePlannerRewardsOptions {
  choreOps: UseChoreOpsResult;
  rewardsState: UseRewardRedemptionsResult;
  rewards: ChoreOpsReward[];
  redemptions: Redemption[];
  members: PlannerMember[];
  userNameByMemberId: Map<string, string>;
  selectedTodayMember: PlannerMember | null;
  spendableFor: (member: PlannerMember | null | undefined) => number;
  editingReward: string | null;
  givenRewardName: string | null;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setCelebration: (value: 'chore' | 'goal') => void;
  requestPin: (title: string, description: string, run: (approverName?: string) => void) => void;
  dispatchOverlay: Dispatch<PlannerOverlayEvent>;
  showToast: (message: string, kind?: 'success' | 'error', details?: string) => void;
  showError: (error: unknown) => void;
  copy: PlannerCopy;
}

/** Reward assignment, redemption and payout behavior. */
export function usePlannerRewards({
  choreOps,
  rewardsState,
  rewards,
  redemptions,
  members,
  userNameByMemberId,
  selectedTodayMember,
  spendableFor,
  editingReward,
  givenRewardName,
  saving,
  setSaving,
  setCelebration,
  requestPin,
  dispatchOverlay,
  showToast,
  showError,
  copy: c,
}: UsePlannerRewardsOptions) {
  const [rewardForm, setRewardForm] = useState({ name: '', cost: 10, memberIds: [] as string[] });
  const givenReward = givenRewardName ? { name: givenRewardName } : null;
  const memberByName = (name: string | null) =>
    members.find(
      (member) => member.name.trim().toLowerCase() === (name ?? '').trim().toLowerCase(),
    ) ?? null;
  /** The rewards ChoreOps assigns to one planner member (via its ChoreOps user). */
  const rewardsForMember = (memberId: string | null): ChoreOpsReward[] => {
    const userName = memberId ? userNameByMemberId.get(memberId) : null;
    if (!userName) return [];
    const key = userName.trim().toLowerCase();
    return rewards.filter((reward) => (reward.assignee ?? '').trim().toLowerCase() === key);
  };
  /** All planner member IDs currently assigned to a reward definition. */
  const memberIdsForReward = (name: string): string[] => {
    const assignedNames = new Set(
      rewards
        .filter((reward) => normaliseName(reward.name) === normaliseName(name))
        .map((reward) => normaliseName(reward.assignee))
        .filter(Boolean),
    );
    return Array.from(userNameByMemberId.entries())
      .filter(([, userName]) => assignedNames.has(normaliseName(userName)))
      .map(([memberId]) => memberId);
  };
  const startRewardForm = (memberId?: string) => {
    setRewardForm({ name: '', cost: 10, memberIds: memberId ? [memberId] : [] });
    dispatchOverlay({ type: 'open-reward-form' });
  };

  /**
   * Create or update a reward in ChoreOps for the chosen children.
   *
   * ChoreOps publishes one reward entity per user, so `assigned_user_names` is
   * what makes the reward belong to that child — different kids can have
   * different rewards with different costs.
   */
  const saveReward = async () => {
    if (saving) return;

    const userNames = rewardForm.memberIds
      .map((id) => userNameByMemberId.get(id))
      .filter((name): name is string => Boolean(name));
    if (userNames.length === 0) return;

    if (editingReward) {
      const update = async () => {
        try {
          setSaving(true);
          await choreOps.updateReward({
            name: editingReward,
            cost: rewardForm.cost,
            assignedUserNames: userNames,
          });
          dispatchOverlay({ type: 'close' });
          showToast(`${c.savedToast} \u00b7 ${editingReward}`);
        } catch (err) {
          showError(err);
        } finally {
          setSaving(false);
        }
      };
      requestPin(c.edit, editingReward, () => void update());
      return;
    }

    if (!rewardForm.name.trim() || userNames.length === 0) return;

    const create = async () => {
      try {
        setSaving(true);
        await choreOps.createReward({
          name: rewardForm.name.trim(),
          cost: rewardForm.cost,
          assignedUserNames: userNames,
        });
        dispatchOverlay({ type: 'close' });
        showToast(`${c.savedToast} \u00b7 ${rewardForm.name.trim()}`);
      } catch (err) {
        showError(err);
      } finally {
        setSaving(false);
      }
    };
    requestPin(c.newReward, rewardForm.name.trim(), () => void create());
  };

  /**
   * Delete a reward from ChoreOps.
   *
   * `skipPin` is only used by the post-payout prompt: the parent has already
   * unlocked the payout in this very flow, so asking for the PIN twice would be
   * noise rather than a second decision.
   */
  const removeReward = async (reward: Pick<ChoreOpsReward, 'name'>, skipPin = false) => {
    const remove = async () => {
      try {
        setSaving(true);
        await choreOps.deleteReward(reward.name);
        dispatchOverlay({ type: 'close' });
        showToast(toastWith(c.removedToast, reward.name));
      } catch (err) {
        showError(err);
      } finally {
        setSaving(false);
      }
    };
    /*
     * Deleting a reward removes the definition for every child it is assigned
     * to, and a goal that was already reached is waiting to be handed over.
     * Both are parent decisions, so this is always PIN-gated — it used to be
     * free for a fully funded goal, which let a child delete a reward they were
     * about to receive.
     */
    if (skipPin) {
      await remove();
      return;
    }
    requestPin(c.remove, reward.name, () => void remove());
  };

  /**
   * Ask how many points go towards this reward.
   *
   * The allocation is explicit: a child can fund several goals side by side
   * (5 here, 3 there) and leave the rest in the savings pot. The old button
   * silently took as much as the goal still needed.
   */
  const openAssign = (reward: ChoreOpsReward) => {
    if (!rewardState(reward).canAdd) return;
    dispatchOverlay({ type: 'open-assign', reward });
  };

  /**
   * Put points aside for a reward.
   *
   * Approval-free and Abbai Flow-only: the balance drops the moment the child
   * allocates, and nothing is written to ChoreOps, so they can still change
   * their mind. The amount is chosen explicitly by the child; points accumulate
   * towards the cost instead of being reserved in one go -- that is what makes
   * "on hold" (partway) and "reached the goal" (fully covered) two different
   * states.
   */
  const assignReward = async (reward: ChoreOpsReward, amount: number) => {
    const userName =
      reward.assignee ??
      (selectedTodayMember ? userNameByMemberId.get(selectedTodayMember.id) : null);
    if (!userName) {
      showToast(c.assignToClaim, 'error');
      return;
    }

    const owner = memberByName(userName);
    const already = activeRedemption(redemptions, userName, reward.name)?.points ?? 0;
    const stillNeeded = Math.max(0, reward.cost - already);
    // Never invent points: the explicit amount is still capped by what the
    // child can spend and by what the goal still needs.
    const give = Math.min(Math.round(amount), stillNeeded, owner ? spendableFor(owner) : 0);
    if (give <= 0) return;

    setSaving(true);
    try {
      const result = await rewardsState.runOp({
        type: 'addPoints',
        user: userName,
        reward: reward.name,
        cost: reward.cost,
        amount: give,
      });
      if (
        result &&
        typeof result === 'object' &&
        'state' in result &&
        result.state === 'awaiting_fulfilment' &&
        already < reward.cost
      ) {
        setCelebration('goal');
      }
      showToast(toastWith(c.assignedToast, reward.name));
      dispatchOverlay({ type: 'close' });
    } finally {
      setSaving(false);
    }
  };

  /** Give the points back -- the child changed their mind, or wants it again. */
  const undoRewardChoice = (reward: ChoreOpsReward) => {
    const pursuit = activeRedemption(redemptions, reward.assignee, reward.name);
    if (pursuit) {
      void rewardsState.runOp({ type: 'release', id: pursuit.id });
    }
    showToast(toastWith(c.undoneToast, reward.name));
  };

  /**
   * Parent hands a reached reward over.
   *
   * ChoreOps deducts the cost through `approve_reward` and Abbai Flow records who
   * gave what and when. A child can never reach this: it is behind the PIN, and
   * the redemption only exists once the goal is actually achieved.
   */
  const giveReward = (redemption: Redemption) => {
    const member = memberByName(redemption.user);
    const userName = member ? userNameByMemberId.get(member.id) : null;
    if (!userName) {
      showToast(c.assignToClaim, 'error');
      return;
    }
    requestPin(c.approvePayout, redemption.rewardLabel, (approverName) => {
      void (async () => {
        try {
          setSaving(true);
          await choreOps.approveReward(userName, redemption.rewardLabel, approverName);
          await rewardsState.runOp({
            type: 'fulfil',
            id: redemption.id,
            by: approverName,
          });
          showToast(toastWith(c.rewardGiven, redemption.rewardLabel));
          setCelebration('goal');
          /*
           * The goal is met and handed over. Ask the parent what happens to the
           * definition: save for it again from zero, or remove it altogether.
           */
          const definition =
            rewards.find(
              (item) =>
                normaliseName(item.name) === normaliseName(redemption.reward) &&
                normaliseName(item.assignee) === normaliseName(redemption.user),
            ) ?? null;
          dispatchOverlay({
            type: 'open-reward-given',
            name: definition?.name ?? redemption.rewardLabel,
          });
        } catch (err) {
          showError(err);
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  /** Payout done: keep the goal and put it back at 0 allocations. */
  const reuseGivenReward = () => {
    if (!givenReward) return;
    const name = givenReward.name;
    dispatchOverlay({ type: 'close' });
    showToast(toastWith(c.rewardReset, name));
  };

  /** Payout done: delete the definition; the payout PIN already covered this. */
  const deleteGivenReward = () => {
    if (!givenReward) return;
    void removeReward(givenReward, true);
  };

  /**
   * Reward card state shared by the child screen and the rewards sheet:
   * how much is set aside, what is still missing, and whether the goal is met.
   *
   * `done` means *the goal is achieved* — not that the child has the reward.
   * The reward is still waiting for a parent at that point.
   */
  const rewardState = (reward: ChoreOpsReward) => {
    const owner = memberByName(reward.assignee);
    const pursuit = activeRedemption(redemptions, reward.assignee, reward.name);
    const saved = owner ? spendableFor(owner) : 0;
    const allocated = pursuit?.points ?? 0;
    const remaining = Math.max(0, reward.cost - allocated);
    const status = reward.status.toLowerCase();
    // ChoreOps marks rewards `locked` when the balance is below the full
    // cost. Abbai Flow supports smaller allocations, so the child can still
    // save toward a locked reward while they have points.
    const canSave = status === 'available' || status === 'locked';
    return {
      owner,
      pursuit,
      saved,
      allocated,
      remaining,
      /** Reached the cost: waiting for a parent to hand it over. */
      done: pursuit?.state === 'awaiting_fulfilment',
      available: status === 'available',
      pending: reward.pendingClaims > 0,
      canAdd: canSave && saved > 0 && remaining > 0,
    };
  };


  return {
    rewardForm,
    setRewardForm,
    memberByName,
    rewardsForMember,
    memberIdsForReward,
    startRewardForm,
    saveReward,
    removeReward,
    openAssign,
    assignReward,
    undoRewardChoice,
    giveReward,
    reuseGivenReward,
    deleteGivenReward,
    rewardState,
  };
}
