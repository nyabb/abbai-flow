/** Shared client state and actions for the local ChoresMan store. */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { callChoresMan, loadChoresManSnapshot } from '../api/choresman';
import type { ChoresManSnapshot } from '../api/choresman';
import {
  buildCreateChorePayload,
  buildCreateRewardPayload,
  buildUpdateChorePayload,
  buildUpdateRewardPayload,
  type CreateChoreInput,
  type CreateRewardInput,
  type UpdateChoreInput,
  type UpdateRewardInput,
} from '../api/chore-model';
import type { FamilyMember } from '../types/family';
import type { ChoresManChore, ChoresManReward, ChoresManState } from '../types/choresman';

const REFRESH_INTERVAL_MS = 30_000;
const ACTION_PREFIX = 'choresman-action:';
const EMPTY_MEMBERS: readonly FamilyMember[] = [];

interface SnapshotState {
  data: ChoresManState | null;
  loading: boolean;
  error: string | null;
}

let state: SnapshotState = { data: null, loading: true, error: null };
const listeners = new Set<() => void>();
let mountCount = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let currentMembers: readonly FamilyMember[] = EMPTY_MEMBERS;
let syncedMembersSignature = '';
let syncInFlight: { signature: string; promise: Promise<void> } | null = null;
let loadInFlight: Promise<void> | null = null;

function emit(patch: Partial<SnapshotState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SnapshotState {
  return state;
}

function actionId(action: string, data: Record<string, unknown>): string {
  return `${ACTION_PREFIX}${encodeURIComponent(JSON.stringify({ action, data }))}`;
}

function parseAction(value: string): { action: string; data: Record<string, unknown> } | null {
  if (!value.startsWith(ACTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(ACTION_PREFIX.length)));
    if (typeof parsed?.action !== 'string' || !parsed.data || typeof parsed.data !== 'object') {
      return null;
    }
    return parsed as { action: string; data: Record<string, unknown> };
  } catch {
    return null;
  }
}

function mapSnapshot(source: ChoresManSnapshot): ChoresManState {
  const activeMembers = source.members.filter((member) => member.active !== false);
  const users = activeMembers.map((member) => {
    const claims = source.chore_claims.filter((claim) => claim.member_id === member.id);
    return {
      name: member.name,
      slug: String(member.id),
      points: Number(member.points) || 0,
      dueToday: 0,
      claimed: claims.filter((claim) => claim.status === 'claimed').length,
      approved: claims.filter((claim) => claim.status === 'approved').length,
      completedToday: claims.filter(
        (claim) =>
          claim.status === 'approved' &&
          typeof claim.approved_at === 'string' &&
          new Date(claim.approved_at).toDateString() === new Date().toDateString(),
      ).length,
    };
  });

  const chores: ChoresManChore[] = source.chores.flatMap((chore) => {
    const assignedNames = chore.assigned_user_names.includes('*')
      ? users.map((user) => user.name)
      : chore.assigned_user_names;
    return assignedNames.flatMap((name) => {
      const user = users.find(
        (candidate) => candidate.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
      );
      if (!user) return [];

      const statusByMember = (chore.status_by_member || {}) as Record<string, Record<string, unknown>>;
      const dueByMember = (chore.due_date_by_member_name || {}) as Record<string, string>;
      const statusInfo = statusByMember[name];
      const rawStatus = String(statusInfo?.status || 'pending');
      const sharedFirstClaimant = String(chore.completion_criteria || '').trim().toLowerCase() === 'shared_first'
        ? Object.entries(statusByMember).find(([, info]) =>
            ['in_progress', 'claimed', 'approved'].includes(String(info.status).toLowerCase()),
          )?.[0]
        : null;
      const claimedByOther = sharedFirstClaimant && sharedFirstClaimant.toLocaleLowerCase() !== name.toLocaleLowerCase();
      const status = claimedByOther
        ? 'completed_by_other'
        : ['approved', 'claimed', 'in_progress', 'due', 'overdue'].includes(rawStatus) ? rawStatus : 'pending';
      const dueDate = dueByMember[name] || statusInfo?.due_date || chore.due_date || null;
      const parent = activeMembers.find((member) => member.role === 'parent');
      const actionData = { chore_id: chore.id, user_name: name };
      const actions = status === 'claimed'
        ? {
            approve: actionId('approve_chore', { ...actionData, approver_name: parent?.name || 'Abbai Flow' }),
            disapprove: actionId('disapprove_chore', { ...actionData, approver_name: parent?.name || 'Abbai Flow' }),
          }
        : status === 'approved' || status === 'completed_by_other'
          ? {}
          : status === 'in_progress'
            ? { claim: actionId('claim_chore', actionData) }
            : String(chore.completion_criteria || '').trim().toLowerCase() === 'shared_first'
              ? { take: actionId('take_chore', actionData) }
              : { claim: actionId('claim_chore', actionData) };

      return [{
        id: `choresman:${chore.id}:${user.slug}`,
        sourceId: chore.id,
        plannerRowId: `choresman-row:${chore.id}:${user.slug}`,
        name: chore.name,
        icon: typeof chore.icon === 'string' ? chore.icon : null,
        status,
        assignee: name,
        points: Number(chore.points) || 0,
        dueDate: typeof dueDate === 'string' ? dueDate : null,
        description: typeof chore.description === 'string' ? chore.description : null,
        frequency: typeof chore.frequency === 'string' ? chore.frequency : null,
        applicableDays: Array.isArray(chore.applicable_days) ? chore.applicable_days as string[] : [],
        labels: Array.isArray(chore.labels) ? chore.labels as string[] : [],
        customInterval: typeof chore.custom_interval === 'number' ? chore.custom_interval : null,
        customIntervalUnit: typeof chore.custom_interval_unit === 'string' ? chore.custom_interval_unit : null,
        approvalReset: typeof chore.approval_reset_type === 'string' ? chore.approval_reset_type : null,
        pendingClaims: typeof chore.pending_claims === 'string' ? chore.pending_claims : null,
        overdueHandling: typeof chore.overdue_handling === 'string' ? chore.overdue_handling : null,
        claimLockUntilWindow: chore.chore_claim_lock_until_window === true,
        notificationChannel: typeof chore.notification_channel === 'string' ? chore.notification_channel : null,
        notificationImportance: typeof chore.notification_importance === 'string' ? chore.notification_importance : null,
        notificationPriority: typeof chore.notification_priority === 'string' ? chore.notification_priority : null,
        notificationTtl: typeof chore.notification_ttl === 'number' ? chore.notification_ttl : null,
        lastCompleted: typeof statusInfo?.last_completed === 'string' ? statusInfo.last_completed : null,
        windowOffset: typeof chore.due_window_offset === 'string' ? chore.due_window_offset : null,
        autoApprove: chore.auto_approve === true,
        assignedUserNames: assignedNames,
        completionCriteria: typeof chore.completion_criteria === 'string' ? chore.completion_criteria : null,
        canClaim: Boolean(actions.take || actions.claim),
        canApprove: Boolean(actions.approve),
        actions,
        showOnCalendar: chore.show_on_calendar !== false,
      }];
    });
  });

  const rewards: ChoresManReward[] = source.rewards.flatMap((reward) => {
    const assignedNames = reward.assigned_user_names.includes('*')
      ? users.map((user) => user.name)
      : reward.assigned_user_names;
    return assignedNames.map((name) => {
      const assignedUser = users.find(
        (candidate) => candidate.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
      );
      const claim = [...source.reward_claims].reverse().find(
        (candidate) => candidate.reward_id === reward.id && candidate.user_name === name && candidate.status === 'pending',
      );
      const actionData = { reward_id: reward.id, reward_name: reward.name, user_name: name };
      const cost = Number(reward.cost) || 0;
      const approvalPending = reward.approved === false;
      return {
        id: `choresman:${reward.id}:${name}`,
        name: reward.name,
        status: approvalPending ? 'pending_approval' : claim ? 'claimed' : (assignedUser?.points ?? 0) >= cost ? 'available' : 'locked',
        cost,
        pendingClaims: claim ? 1 : 0,
        approvalPending,
        assignee: name,
        actions: approvalPending
          ? { approve: actionId('approve_reward_definition', { reward_id: reward.id, approver_name: activeMembers.find((member) => member.role === 'parent')?.name || 'Abbai Flow' }) }
          : claim
          ? { approve: actionId('approve_reward', { ...actionData, approver_name: activeMembers.find((member) => member.role === 'parent')?.name || 'Abbai Flow' }) }
          : { claim: actionId('redeem_reward', actionData) },
      };
    });
  });

  const pointsByUser = Object.fromEntries(users.map((user) => [user.name.trim().toLocaleLowerCase(), user.points]));
  return {
    users,
    chores,
    rewards,
    pointsByUser,
    pendingApprovals: source.pending_approvals,
    available: users.length > 0 || chores.length > 0,
  };
}

function applySnapshot(source: ChoresManSnapshot): void {
  emit({ data: mapSnapshot(source), error: null, loading: false });
}

export async function resetAllChoresManData(): Promise<void> {
  const response = await callChoresMan('reset_all_data', { confirm_destructive: true });
  applySnapshot(response.snapshot);
}

function profilesFor(members: readonly FamilyMember[]) {
  return members.map(({ id, name, role, avatar, color }) => ({ id, name, role, avatar, color }));
}

async function syncMembers(members: readonly FamilyMember[]): Promise<void> {
  const profiles = profilesFor(members);
  const signature = JSON.stringify(profiles);
  if (signature === syncedMembersSignature) {
    applySnapshot(await loadChoresManSnapshot());
    return;
  }
  if (syncInFlight?.signature === signature) return syncInFlight.promise;

  const promise = callChoresMan('family.sync_members', { members: profiles })
    .then((response) => {
      syncedMembersSignature = signature;
      applySnapshot(response.snapshot);
    })
    .catch((error) => {
      emit({ error: error instanceof Error ? error.message : 'Could not sync family members with ChoresMan', loading: false });
      throw error;
    })
    .finally(() => {
      if (syncInFlight?.signature === signature) syncInFlight = null;
    });
  syncInFlight = { signature, promise };
  return promise;
}

async function load(members: readonly FamilyMember[] = EMPTY_MEMBERS): Promise<void> {
  if (loadInFlight) return loadInFlight;
  const promise = (async () => {
    try {
      if (members.length > 0 || syncedMembersSignature !== '') {
        await syncMembers(members);
      } else {
        applySnapshot(await loadChoresManSnapshot());
      }
    } catch (error) {
      emit({ error: error instanceof Error ? error.message : 'Could not load ChoresMan data', loading: false });
    }
  })();
  loadInFlight = promise;
  try {
    await promise;
  } finally {
    if (loadInFlight === promise) loadInFlight = null;
  }
}

async function runAction(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  const response = await callChoresMan(action, data);
  applySnapshot(response.snapshot);
  return response.result;
}

function startPolling(): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) void load(currentMembers);
  }, REFRESH_INTERVAL_MS);
}

function stopPolling(): void {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

export interface UseChoresManResult {
  data: ChoresManState | null;
  loading: boolean;
  error: string | null;
  available: boolean;
  refresh: () => void;
  runActionId: (actionId: string) => Promise<void>;
  claimChore: (choreName: string, userName: string) => Promise<void>;
  createChore: (input: CreateChoreInput) => Promise<void>;
  updateChore: (input: UpdateChoreInput) => Promise<void>;
  resolveChoreId: (plannerRowId: string) => Promise<string | null>;
  createReward: (input: CreateRewardInput) => Promise<void>;
  updateReward: (input: UpdateRewardInput) => Promise<void>;
  deleteReward: (rewardName: string) => Promise<void>;
  approveReward: (userName: string, rewardName: string, approverName?: string) => Promise<void>;
  adjustPoints: (userName: string, amount: number, reason: string) => Promise<void>;
  deleteChore: (choreName: string) => Promise<void>;
  setChoreDueDate: (choreName: string, dueDate?: string | null, userName?: string) => Promise<void>;
}

export function useChoresMan(familyMembers: readonly FamilyMember[] = EMPTY_MEMBERS): UseChoresManResult {
  const signature = useMemo(() => JSON.stringify(profilesFor(familyMembers)), [familyMembers]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    currentMembers = familyMembers;
    mountCount += 1;
    if (mountCount === 1) startPolling();
    void load(familyMembers);
    return () => {
      mountCount -= 1;
      if (mountCount === 0) stopPolling();
    };
  }, [signature, familyMembers]);

  const refresh = useCallback(() => {
    emit({ loading: state.data === null });
    void load(currentMembers);
  }, []);

  const resolveChoreId = useCallback(async (plannerRowId: string) => {
    return snapshot.data?.chores.find((chore) => chore.plannerRowId === plannerRowId)?.sourceId ?? null;
  }, [snapshot.data]);

  const runActionId = useCallback(async (value: string) => {
    const action = parseAction(value);
    if (!action) throw new Error('This ChoresMan action is not available');
    await runAction(action.action, action.data);
  }, []);

  const claimChore = useCallback(async (choreName: string, userName: string) => {
    await runAction('claim_chore', { chore_name: choreName, user_name: userName });
  }, []);

  const createChore = useCallback(async (input: CreateChoreInput) => {
    const payload = buildCreateChorePayload(input);
    if (!payload) throw new Error('ChoresMan needs a name and at least one assignee');
    await runAction('create_chore', payload);
  }, []);

  const updateChore = useCallback(async (input: UpdateChoreInput) => {
    const payload = buildUpdateChorePayload(input);
    if (!payload) throw new Error('ChoresMan needs a chore name to update it');
    await runAction('update_chore', payload);
  }, []);

  const createReward = useCallback(async (input: CreateRewardInput) => {
    const payload = buildCreateRewardPayload(input);
    if (!payload) throw new Error('ChoresMan needs a reward name and at least one member');
    await runAction('create_reward', payload);
  }, []);

  const updateReward = useCallback(async (input: UpdateRewardInput) => {
    const payload = buildUpdateRewardPayload(input);
    if (!payload) throw new Error('ChoresMan needs a reward name to update it');
    await runAction('update_reward', payload);
  }, []);

  const deleteReward = useCallback(async (rewardName: string) => {
    await runAction('delete_reward', { name: rewardName });
  }, []);

  const approveReward = useCallback(async (userName: string, rewardName: string, approverName?: string) => {
    await runAction('approve_reward', {
      approver_name: approverName?.trim() || 'Abbai Flow',
      user_name: userName,
      reward_name: rewardName,
    });
  }, []);

  const adjustPoints = useCallback(async (userName: string, amount: number, reason: string) => {
    if (!userName.trim()) throw new Error('ChoresMan member is required to award points');
    if (!Number.isFinite(amount) || amount <= 0) return;
    await runAction('manual_adjust_points', { user_name: userName, amount, reason });
  }, []);

  const deleteChore = useCallback(async (choreName: string) => {
    await runAction('delete_chore', { name: choreName });
  }, []);

  const setChoreDueDate = useCallback(async (choreName: string, dueDate?: string | null, userName?: string) => {
    await runAction('set_chore_due_date', {
      chore_name: choreName,
      due_date: dueDate ?? null,
      ...(userName ? { user_name: userName } : {}),
    });
  }, []);

  return useMemo(() => ({
    data: snapshot.data,
    loading: snapshot.loading,
    error: snapshot.error,
    available: Boolean(snapshot.data?.available),
    refresh,
    runActionId,
    claimChore,
    createChore,
    updateChore,
    resolveChoreId,
    createReward,
    updateReward,
    deleteReward,
    approveReward,
    adjustPoints,
    deleteChore,
    setChoreDueDate,
  }), [
    snapshot,
    refresh,
    runActionId,
    claimChore,
    createChore,
    updateChore,
    resolveChoreId,
    createReward,
    updateReward,
    deleteReward,
    approveReward,
    adjustPoints,
    deleteChore,
    setChoreDueDate,
  ]);
}
