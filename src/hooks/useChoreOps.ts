/**
 * ChoreOps data hook.
 *
 * Abbai Flow runs in two shapes and they need different transports:
 *
 *  - Direct-token / dev: `useHomeAssistant` creates a HomeAssistantClient, so
 *    we read `get_states` over its WebSocket and subscribe to `state_changed`
 *    for a live, debounced refetch.
 *  - Add-on / standalone Docker: the browser has no token and `useHomeAssistant`
 *    deliberately creates NO client (the server injects the token), so
 *    `client()` returns null. Reading only through the client left this hook
 *    stuck on `loading` forever there — which is why the chores screen and the
 *    ChoreOps member picker came up empty in the container. That path now falls
 *    back to the REST API (proxied server-side) and polls.
 *
 * The snapshot and the subscription are shared by every caller and ref-counted
 * by mount/unmount, so a ChoreOps update causes one refetch per app rather than
 * one per consumer.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { HomeAssistantClient } from '../api/homeassistant';
import type { HAEntityRegistryEntry } from '../api/homeassistant';
import { callAbbaiAction, callHaService, getAllEntityStates, hasToken } from '../api/ha-rest';
import { useHomeAssistant } from './useHomeAssistant';
import { usesServerProxy } from '../utils/ha-env';
import {
  normalizeChoreOps,
  purposeOf,
  buildCreateChorePayload,
  buildUpdateChorePayload,
  buildCreateRewardPayload,
  buildUpdateRewardPayload,
} from '../api/choreops';
import type {
  CreateChoreInput,
  UpdateChoreInput,
  CreateRewardInput,
  UpdateRewardInput,
} from '../api/choreops';
import type { ChoreOpsEntityState, ChoreOpsState } from '../types/choreops';
import type { FamilyMember } from '../types/family';
import { callChoresman, loadChoresmanSnapshot } from '../api/choresman';
import type { ChoreProvider, ChoresmanSnapshot } from '../api/choresman';

const REFETCH_DEBOUNCE_MS = 400;

/**
 * How long a write keeps re-reading until ChoreOps publishes its new state.
 * ChoreOps updates its sensors a beat after the service call returns, and in
 * proxy/add-on mode there is no WebSocket to push that change — so the write
 * itself has to wait for it instead of leaving stale chores on the board.
 */
const WRITE_REFRESH_INTERVAL_MS = 350;
const WRITE_REFRESH_ATTEMPTS = 8;

/** REST fallback poll interval — ChoreOps changes are human-paced. */
const REST_POLL_MS = 30_000;

export interface UseChoreOpsResult {
  data: ChoreOpsState | null;
  loading: boolean;
  error: string | null;
  /** True when HA is connected and at least one ChoreOps entity was found. */
  available: boolean;
  refresh: () => void;
  /** Press a ChoreOps action button (claim/approve/disapprove). */
  pressButton: (entityId: string) => Promise<void>;
  /**
   * Claim a chore for a ChoreOps user via the integration's services.
   * Works for chores nobody is assigned to, which have no button to press.
   */
  claimChore: (choreName: string, userName: string) => Promise<void>;
  /** Create a chore in ChoreOps and refresh the board. */
  createChore: (input: Omit<CreateChoreInput, 'entryId'>) => Promise<void>;
  /** Change an existing chore (assignees, schedule, points, times). */
  updateChore: (input: Omit<UpdateChoreInput, 'entryId'>) => Promise<void>;
  /** Resolve a chore's internal ChoreOps ID from one of its status entities. */
  resolveChoreId?: (statusEntityId: string) => Promise<string | null>;
  /** Create a reward for one or more ChoreOps users. */
  createReward: (input: Omit<CreateRewardInput, 'entryId'>) => Promise<void>;
  /** Change a reward's price. */
  updateReward: (input: Omit<UpdateRewardInput, 'entryId'>) => Promise<void>;
  /** Remove a reward from ChoreOps. */
  deleteReward: (rewardName: string) => Promise<void>;
  /**
   * Confirm a reward a child set points aside for.
   *
   * Goes through `choreops.approve_reward` rather than the approve button:
   * the allocation lives in Abbai Flow, so there is no pending ChoreOps claim for
   * the button to confirm. ChoreOps deducts the cost here — once — and the
   * child's Abbai Flow allocation is released so the visible balance stays put.
   */
  approveReward: (userName: string, rewardName: string, approverName?: string) => Promise<void>;
  /** Award a positive bonus directly to a ChoreOps user. */
  adjustPoints: (userName: string, amount: number, reason: string) => Promise<void>;
  /** Delete a ChoreOps chore by name. */
  deleteChore: (choreName: string) => Promise<void>;
  /** Reset a chore to pending by setting or clearing its due date. */
  setChoreDueDate: (choreName: string, dueDate?: string | null, userName?: string) => Promise<void>;
}

const CHORESMAN_ACTION_PREFIX = 'choresman-action:';
const EMPTY_FAMILY_MEMBERS: readonly FamilyMember[] = [];

function choresmanAction(action: string, data: Record<string, unknown>): string {
  return `${CHORESMAN_ACTION_PREFIX}${encodeURIComponent(JSON.stringify({ action, data }))}`;
}

function readChoresmanAction(value: string): { action: string; data: Record<string, unknown> } | null {
  if (!value.startsWith(CHORESMAN_ACTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(CHORESMAN_ACTION_PREFIX.length)));
    if (typeof parsed?.action !== 'string' || !parsed.data || typeof parsed.data !== 'object') return null;
    return parsed as { action: string; data: Record<string, unknown> };
  } catch {
    return null;
  }
}

interface ChoreOpsSnapshot {
  data: ChoreOpsState | null;
  loading: boolean;
  error: string | null;
}

interface StateChangedPayload {
  entity_id?: unknown;
  new_state?: { entity_id?: unknown; attributes?: unknown } | null;
}

/** Extract the entity id from a `state_changed` event payload. */
function changedEntityId(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null;
  const payload = (event as { data?: StateChangedPayload }).data;
  if (!payload) return null;

  if (typeof payload.entity_id === 'string') return payload.entity_id;
  const fromState = payload.new_state?.entity_id;
  return typeof fromState === 'string' ? fromState : null;
}

function isChoreOpsEntity(event: unknown): boolean {
  const entityId = changedEntityId(event);
  if (!entityId) return false;
  if (entityId.includes('_choreops_') || entityId.endsWith('_choreops')) return true;

  // Fall back to the purpose attribute when the entity id is unexpected.
  if (typeof event !== 'object' || event === null) return false;
  const attrs = (event as { data?: StateChangedPayload }).data?.new_state?.attributes;
  return (
    typeof attrs === 'object' &&
    attrs !== null &&
    purposeOf({ entity_id: entityId, state: '', attributes: attrs as Record<string, unknown> }) !==
      null
  );
}

let snapshot: ChoreOpsSnapshot = { data: null, loading: true, error: null };
const listeners = new Set<() => void>();
let refCount = 0;
let teardown: (() => void) | null = null;
let choresmanSnapshot: ChoreOpsSnapshot = { data: null, loading: true, error: null };
const choresmanListeners = new Set<() => void>();
let choresmanRefCount = 0;
let choresmanTeardown: (() => void) | null = null;
let choresmanSyncedSignature = '';
let choresmanSyncInFlight: { signature: string; promise: Promise<void> } | null = null;

function emit(patch: Partial<ChoreOpsSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function emitChoresman(patch: Partial<ChoreOpsSnapshot>): void {
  choresmanSnapshot = { ...choresmanSnapshot, ...patch };
  for (const listener of choresmanListeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChoreOpsSnapshot {
  return snapshot;
}

function subscribeChoresman(listener: () => void): () => void {
  choresmanListeners.add(listener);
  return () => choresmanListeners.delete(listener);
}

function getChoresmanSnapshot(): ChoreOpsSnapshot {
  return choresmanSnapshot;
}

function applyStates(states: ChoreOpsEntityState[]): void {
  emit({ data: normalizeChoreOps(states), error: null, loading: false });
}

function mapChoresmanSnapshot(source: ChoresmanSnapshot): ChoreOpsState {
  const users = source.members.filter((member) => member.active !== false).map((member) => ({
    name: member.name,
    slug: String(member.id),
    points: Number(member.points) || 0,
    dueToday: 0,
    claimed: source.chore_claims.filter((claim) => claim.member_id === member.id && claim.status === 'claimed').length,
    approved: source.chore_claims.filter((claim) => claim.member_id === member.id && claim.status === 'approved').length,
    completedToday: source.chore_claims.filter((claim) => claim.member_id === member.id && claim.status === 'approved' &&
      typeof claim.approved_at === 'string' && new Date(claim.approved_at).toDateString() === new Date().toDateString()).length,
  }));
  const chores = source.chores.flatMap((chore) => {
    const assignedNames = chore.assigned_user_names.includes('*')
      ? users.map((user) => user.name)
      : chore.assigned_user_names;
    return assignedNames.flatMap((name) => {
      const user = users.find((candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!user) return [];
      const statusByMember = (chore.status_by_member || {}) as Record<string, Record<string, unknown>>;
      const dueByMember = (chore.due_date_by_member_name || {}) as Record<string, string>;
      const statusInfo = statusByMember[name];
      const rawStatus = String(statusInfo?.status || 'pending');
      const sharedFirstClaimant = String(chore.completion_criteria || '').trim().toLowerCase() === 'shared_first'
        ? Object.entries(statusByMember).find(([, info]) =>
            ['claimed', 'approved'].includes(String(info.status).toLowerCase()),
          )?.[0]
        : null;
      // ChoreOps marks other assignees as completed_by_other once one child
      // takes a shared-first chore. Choresman stores the same fact as a single
      // claim, so mirror that state here and keep siblings from seeing it as
      // free after another child has already claimed it.
      const claimedByOther = sharedFirstClaimant && sharedFirstClaimant.toLowerCase() !== name.toLowerCase();
      const status = claimedByOther
        ? 'completed_by_other'
        : ['approved', 'claimed', 'due', 'overdue'].includes(rawStatus) ? rawStatus : 'pending';
      const dueDate = dueByMember[name] || statusInfo?.due_date || chore.due_date || null;
      const parent = users.find((candidate) => source.members.find((member) => member.name === candidate.name)?.role === 'parent');
      const actionData = { chore_id: chore.id, user_name: name };
      const actions = status === 'claimed'
        ? {
            approve: choresmanAction('approve_chore', { ...actionData, approver_name: parent?.name || 'Abbai Flow' }),
            disapprove: choresmanAction('disapprove_chore', { ...actionData, approver_name: parent?.name || 'Abbai Flow' }),
          }
        : status === 'approved' || status === 'completed_by_other'
          ? {}
          : { claim: choresmanAction('claim_chore', actionData) };
      return [{
        id: `choresman:${chore.id}:${user.slug}`,
        sourceId: chore.id,
        statusEntityId: `choresman-status:${chore.id}:${user.slug}`,
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
        canClaim: Boolean(actions.claim),
        canApprove: Boolean(actions.approve),
        actions,
        showOnCalendar: chore.show_on_calendar !== false,
      }];
    });
  });
  const rewards = source.rewards.flatMap((reward) => {
    const assignedNames = reward.assigned_user_names.includes('*')
      ? users.map((user) => user.name)
      : reward.assigned_user_names;
    return assignedNames.map((name) => {
      const assignedUser = users.find(
        (candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      const claim = [...source.reward_claims].reverse().find((candidate) =>
        candidate.reward_id === reward.id && candidate.user_name === name && candidate.status === 'pending');
      const data = { reward_id: reward.id, reward_name: reward.name, user_name: name };
      const cost = Number(reward.cost) || 0;
      return {
        id: `choresman:${reward.id}:${name}`,
        name: reward.name,
        // Abbai Flow allocations happen outside Choresman. Expose the same
        // available/locked states as ChoreOps so children can fund goals.
        status: claim ? 'claimed' : (assignedUser?.points ?? 0) >= cost ? 'available' : 'locked',
        cost,
        pendingClaims: claim ? 1 : 0,
        assignee: name,
        actions: claim
          ? { approve: choresmanAction('approve_reward', { ...data, approver_name: users.find((user) => source.members.find((member) => member.name === user.name)?.role === 'parent')?.name || 'Abbai Flow' }) }
          : { claim: choresmanAction('redeem_reward', data) },
      };
    });
  });
  const pointsByUser = Object.fromEntries(users.map((user) => [user.name.trim().toLowerCase(), user.points]));
  return {
    users,
    chores,
    rewards,
    people: [],
    pointsByUser,
    pendingApprovals: source.pending_approvals,
    entryId: 'choresman-local',
    available: users.length > 0 || chores.length > 0,
  };
}

function applyChoresmanSnapshot(source: ChoresmanSnapshot): void {
  emitChoresman({ data: mapChoresmanSnapshot(source), error: null, loading: false });
}

async function syncChoresmanMembers(members: readonly FamilyMember[]): Promise<void> {
  if (members.length === 0 && choresmanSyncedSignature === '') {
    applyChoresmanSnapshot(await loadChoresmanSnapshot());
    return;
  }
  const profiles = members.map(({ id, name, role, avatar, color }) => ({ id, name, role, avatar, color }));
  const signature = JSON.stringify(profiles);
  if (signature === choresmanSyncedSignature) {
    applyChoresmanSnapshot(await loadChoresmanSnapshot());
    return;
  }
  if (choresmanSyncInFlight?.signature === signature) return choresmanSyncInFlight.promise;
  const promise = callChoresman('family.sync_members', { members: profiles })
    .then((response) => {
      choresmanSyncedSignature = signature;
      applyChoresmanSnapshot(response.snapshot);
    })
    .catch((error) => {
      emitChoresman({ error: errorMessage(error), loading: false });
      throw error;
    })
    .finally(() => {
      if (choresmanSyncInFlight?.signature === signature) choresmanSyncInFlight = null;
    });
  choresmanSyncInFlight = { signature, promise };
  return promise;
}

async function loadChoresman(members: readonly FamilyMember[] = []): Promise<void> {
  try {
    if (members.length > 0 || choresmanSyncedSignature !== '') {
      await syncChoresmanMembers(members);
      return;
    }
    applyChoresmanSnapshot(await loadChoresmanSnapshot());
  } catch (error) {
    emitChoresman({ error: errorMessage(error), loading: false });
  }
}

async function runChoresman(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  const response = await callChoresman(action, data);
  applyChoresmanSnapshot(response.snapshot);
  return response.result;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Failed to read ChoreOps entities';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Cheap identity for a ChoreOps snapshot.
 *
 * Every read normalises into a brand-new object even when nothing changed, so
 * reference equality cannot tell a real update from a no-op. This signature
 * can, and it is what lets a write stop re-reading as soon as the new state
 * lands.
 */
function signature(data: ChoreOpsState | null): string {
  if (!data) return '';
  const users = data.users.map((user) => `${user.name}:${user.points}`);
  const chores = data.chores.map(
    (chore) => `${chore.name}:${chore.status}:${chore.points}:${chore.assignee ?? ''}`,
  );
  const rewards = data.rewards.map(
    (reward) => `${reward.name}:${reward.cost}:${reward.status}:${reward.assignee ?? ''}`,
  );
  return [users.join(','), chores.join('|'), rewards.join('|')].join('#');
}

async function loadViaClient(activeClient: HomeAssistantClient): Promise<void> {
  try {
    applyStates((await activeClient.getStates()) as ChoreOpsEntityState[]);
  } catch (err) {
    emit({ error: errorMessage(err), loading: false });
  }
}

/**
 * REST read. `getAllEntityStates` swallows transport errors and yields `[]`,
 * which normalises to "no ChoreOps entities" — the panel's empty state.
 */
async function loadViaRest(): Promise<void> {
  applyStates(await getAllEntityStates());
}

/** Live transport: initial snapshot plus a debounced `state_changed` refetch. */
function startClient(activeClient: HomeAssistantClient): () => void {
  void loadViaClient(activeClient);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let subscriptionId: number | null = null;
  let cancelled = false;

  activeClient
    .subscribeStateChanges((event) => {
      if (!isChoreOpsEntity(event)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) void loadViaClient(activeClient);
      }, REFETCH_DEBOUNCE_MS);
    })
    .then((id) => {
      if (cancelled) {
        activeClient.unsubscribe(id);
        return;
      }
      subscriptionId = id;
    })
    .catch(() => {
      /* subscription is an optimisation; the snapshot still loads */
    });

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (subscriptionId !== null) activeClient.unsubscribe(subscriptionId);
  };
}

/** Proxy-mode transport: no WebSocket, so poll the REST API instead. */
function startRestPolling(): () => void {
  void loadViaRest();

  const interval = setInterval(() => {
    // A wall display that is asleep (or a tab in the background) has no reason
    // to keep hitting Home Assistant.
    if (typeof document !== 'undefined' && document.hidden) return;
    void loadViaRest();
  }, REST_POLL_MS);

  // Coming back into view should show current data immediately rather than
  // waiting out the rest of the interval.
  const onVisibilityChange = () => {
    if (!document.hidden) void loadViaRest();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return () => {
    clearInterval(interval);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

/**
 * Register a consumer of the shared snapshot. The first consumer starts the
 * transport; the last one to unmount tears it down.
 */
function acquire(start: () => () => void): () => void {
  refCount += 1;

  if (refCount === 1) {
    // Only show the loading state when there is nothing cached to render.
    emit({ loading: snapshot.data === null });
    teardown = start();
  }

  return () => {
    refCount -= 1;
    if (refCount > 0) return;
    teardown?.();
    teardown = null;
  };
}

function acquireChoresman(start: () => () => void): () => void {
  choresmanRefCount += 1;
  if (choresmanRefCount === 1) {
    emitChoresman({ loading: choresmanSnapshot.data === null });
    choresmanTeardown = start();
  }
  return () => {
    choresmanRefCount -= 1;
    if (choresmanRefCount > 0) return;
    choresmanTeardown?.();
    choresmanTeardown = null;
  };
}

function startChoresmanPolling(members: readonly FamilyMember[]): () => void {
  void loadChoresman(members);
  const interval = setInterval(() => {
    if (!document.hidden) void loadChoresman(members);
  }, REST_POLL_MS);
  const onVisibilityChange = () => {
    if (!document.hidden) void loadChoresman(members);
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    clearInterval(interval);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export function useChoreOps(provider: ChoreProvider = 'choreops', familyMembers: readonly FamilyMember[] = EMPTY_FAMILY_MEMBERS): UseChoreOpsResult {
  const { client, connected } = useHomeAssistant();
  const localMembers = provider === 'choresman' ? familyMembers : EMPTY_FAMILY_MEMBERS;
  const state = useSyncExternalStore(
    provider === 'choresman' ? subscribeChoresman : subscribe,
    provider === 'choresman' ? getChoresmanSnapshot : getSnapshot,
  );

  useEffect(() => {
    if (provider === 'choresman') return acquireChoresman(() => startChoresmanPolling(localMembers));
    const activeClient = client();
    if (activeClient && connected) {
      return acquire(() => startClient(activeClient));
    }

    // No *live* client: either a proxy deployment never creates one, or the
    // WebSocket has not connected (CORS, HA unreachable). The REST API is then
    // the only thing that can answer — and it keeps the screen from sitting on
    // "loading" forever.
    if (hasToken()) {
      return acquire(startRestPolling);
    }

    return undefined;
  }, [client, connected, provider, localMembers]);

  const refresh = useCallback(() => {
    if (provider === 'choresman') {
      emitChoresman({ loading: choresmanSnapshot.data === null });
      void loadChoresman(localMembers);
      return;
    }
    emit({ loading: snapshot.data === null });
    const activeClient = client();
    if (activeClient && connected) {
      void loadViaClient(activeClient);
      return;
    }
    void loadViaRest();
  }, [client, connected, provider, localMembers]);

  const resolveChoreId = useCallback(
    async (statusEntityId: string): Promise<string | null> => {
      if (provider === 'choresman') {
        return state.data?.chores.find((chore) => chore.statusEntityId === statusEntityId)?.sourceId ?? null;
      }
      const entryId = snapshot.data?.entryId;
      if (!entryId || !statusEntityId) return null;

      try {
        let entry: HAEntityRegistryEntry | null = null;
        const activeClient = client();
        if (activeClient && connected) {
          entry = await activeClient.getEntityRegistryEntry(statusEntityId);
        } else if (usesServerProxy()) {
          const response = (await callAbbaiAction('/abbai-flow/action/entity-registry', {
            entity_id: statusEntityId,
          })) as { entry?: HAEntityRegistryEntry | null } | null;
          entry = response?.entry ?? null;
        }

        if (!entry || entry.platform !== 'choreops') return null;
        const prefix = `${entryId}_`;
        if (!entry.unique_id.startsWith(prefix)) return null;

        // ChoreOps builds status entity unique IDs from the config entry,
        // assignee UUID, chore UUID and a sensor suffix. The final UUID is the
        // stable chore ID accepted by update_chore, including after a rename.
        const ids = entry.unique_id
          .slice(prefix.length)
          .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
        return ids && ids.length > 0 ? ids[ids.length - 1] : null;
      } catch {
        return null;
      }
    },
    [client, connected, provider, state.data],
  );

  /**
   * Pull the new ChoreOps state right after a write.
   *
   * Re-reads immediately, then keeps re-reading (briefly) until the snapshot
   * actually changes. Waiting for a single read is not enough: ChoreOps
   * publishes the new chore status/points a moment after the service call
   * returns, and with no `state_changed` stream the board would otherwise keep
   * showing the old values until the next poll or a page reload.
   */
  const reloadAfterWrite = useCallback(async (): Promise<void> => {
    if (provider === 'choresman') {
      await loadChoresman(localMembers);
      return;
    }
    const before = signature(snapshot.data);
    const activeClient = client();
    const read = activeClient && connected ? () => loadViaClient(activeClient) : loadViaRest;

    for (let attempt = 0; attempt < WRITE_REFRESH_ATTEMPTS; attempt += 1) {
      await read();
      if (signature(snapshot.data) !== before) return;
      await delay(WRITE_REFRESH_INTERVAL_MS);
    }
  }, [client, connected, provider, localMembers]);

  /**
   * Invoke a ChoreOps action by pressing its button entity.
   * ChoreOps exposes actions only as `button.*` entities, discovered from the
   * parent sensor's attributes — never hardcoded.
   */
  const pressButton = useCallback(
    async (entityId: string): Promise<void> => {
      if (provider === 'choresman') {
        const action = readChoresmanAction(entityId);
        if (!action) throw new Error('This action is not available in Choresman');
        await runChoresman(action.action, action.data);
        return;
      }
      if (!entityId.startsWith('button.')) {
        throw new Error(`Not a button entity: ${entityId}`);
      }

      const activeClient = client();
      if (activeClient && connected) {
        await activeClient.callService('button', 'press', entityId);
      } else {
        await callHaService('button', 'press', { entity_id: entityId });
      }

      // Show the result of the press straight away in both transports.
      await reloadAfterWrite();
    },
    [client, connected, provider, reloadAfterWrite],
  );

  /**
   * Claim a chore for a specific ChoreOps user.
   *
   * ChoreOps rejects a claim on a chore nobody is assigned to (`claim_chore`
   * returns HTTP 500), and an unassigned chore has no claim button either. So
   * the tapper is attached to the chore first — which is also what makes
   * ChoreOps create their per-user buttons — and the claim is retried.
   */
  const claimChore = useCallback(
    async (choreName: string, userName: string): Promise<void> => {
      if (provider === 'choresman') {
        await runChoresman('claim_chore', { chore_name: choreName, user_name: userName });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      const target = {
        ...(entryId ? { config_entry_id: entryId } : {}),
        user_name: userName,
        chore_name: choreName,
      };

      try {
        await callHaService('choreops', 'claim_chore', target);
      } catch {
        await callHaService('choreops', 'update_chore', {
          ...(entryId ? { config_entry_id: entryId } : {}),
          name: choreName,
          assignment_action: 'add',
          assigned_user_names: [userName],
        });
        await callHaService('choreops', 'claim_chore', target);
      }

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /**
   * Create a chore in ChoreOps. ChoreOps remains the source of truth: Abbai Flow
   * only sends the fields the user filled in and then re-reads its entities.
   */
  const createChore = useCallback(
    async (input: Omit<CreateChoreInput, 'entryId'>): Promise<void> => {
      if (provider === 'choresman') {
        const payload = buildCreateChorePayload({ ...input, entryId: 'choresman-local' });
        if (!payload) throw new Error('Choresman needs a name and at least one assignee');
        await runChoresman('create_chore', payload);
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildCreateChorePayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a name and at least one assignee');
      await callHaService('choreops', 'create_chore', payload);

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Create a reward for the given ChoreOps users. */
  const createReward = useCallback(
    async (input: Omit<CreateRewardInput, 'entryId'>): Promise<void> => {
      if (provider === 'choresman') {
        const payload = buildCreateRewardPayload({ ...input, entryId: 'choresman-local' });
        if (!payload) throw new Error('Choresman needs a reward name and at least one member');
        await runChoresman('create_reward', payload);
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildCreateRewardPayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a reward name and at least one user');

      await callHaService('choreops', 'create_reward', payload);

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Update a reward's cost and, when provided, its assigned users. */
  const updateReward = useCallback(
    async (input: Omit<UpdateRewardInput, 'entryId'>): Promise<void> => {
      if (provider === 'choresman') {
        const payload = buildUpdateRewardPayload({ ...input, entryId: 'choresman-local' });
        if (!payload) throw new Error('Choresman needs a reward name to update it');
        await runChoresman('update_reward', payload);
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildUpdateRewardPayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a reward name to update it');

      await callHaService('choreops', 'update_reward', payload);

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Remove a reward from ChoreOps by name. */
  const deleteReward = useCallback(
    async (rewardName: string): Promise<void> => {
      if (provider === 'choresman') {
        await runChoresman('delete_reward', { name: rewardName });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'delete_reward', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        name: rewardName,
      });

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /**
   * Confirm a reserved reward.
   *
   * `approve_reward` is the only ChoreOps entry point that both grants the
   * reward and deducts the points in one go, and its manual origin accepts a
   * reward with no pending claim — which is exactly the state a Abbai Flow
   * allocation leaves behind.
   */
  const approveReward = useCallback(
    async (userName: string, rewardName: string, approverName?: string): Promise<void> => {
      if (provider === 'choresman') {
        await runChoresman('approve_reward', {
          approver_name: approverName?.trim() || 'Abbai Flow',
          user_name: userName,
          reward_name: rewardName,
        });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'approve_reward', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        approver_name: approverName?.trim() || 'Abbai Flow',
        user_name: userName,
        reward_name: rewardName,
      });

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Credit a routine mission bonus without creating a chore approval. */
  const adjustPoints = useCallback(
    async (userName: string, amount: number, reason: string): Promise<void> => {
      if (provider === 'choresman') {
        if (!userName.trim()) throw new Error('Choresman member is required to award points');
        if (!Number.isFinite(amount) || amount <= 0) return;
        await runChoresman('manual_adjust_points', { user_name: userName, amount, reason });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      if (!userName.trim()) throw new Error('ChoreOps user is required to award points');
      if (!Number.isFinite(amount) || amount <= 0) return;
      await callHaService('choreops', 'manual_adjust_points', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        user_name: userName,
        amount,
        reason,
      });
      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Delete a ChoreOps chore by name (the id ChoreOps publishes). */
  const deleteChore = useCallback(
    async (choreName: string): Promise<void> => {
      if (provider === 'choresman') {
        await runChoresman('delete_chore', { name: choreName });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'delete_chore', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        name: choreName,
      });

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /** Set or clear a chore due date; ChoreOps resets the affected task to pending. */
  const setChoreDueDate = useCallback(
    async (choreName: string, dueDate?: string | null, userName?: string): Promise<void> => {
      if (provider === 'choresman') {
        await runChoresman('set_chore_due_date', {
          chore_name: choreName,
          due_date: dueDate ?? null,
          ...(userName ? { user_name: userName } : {}),
        });
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'set_chore_due_date', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        chore_name: choreName,
        due_date: dueDate ?? null,
        ...(userName ? { user_name: userName } : {}),
      });

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  /**
   * Change an existing ChoreOps chore and re-read its entities.
   *
   * ChoreOps refuses a schedule change without a future due date, so callers
   * must pass both — the edit form pre-fills the due date for exactly that
   * reason.
   */
  const updateChore = useCallback(
    async (input: Omit<UpdateChoreInput, 'entryId'>): Promise<void> => {
      if (provider === 'choresman') {
        const payload = buildUpdateChorePayload({ ...input, entryId: 'choresman-local' });
        if (!payload) throw new Error('Choresman needs a chore name to update it');
        await runChoresman('update_chore', payload);
        return;
      }
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildUpdateChorePayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a chore name to update it');

      await callHaService('choreops', 'update_chore', payload);

      await reloadAfterWrite();
    },
    [provider, reloadAfterWrite],
  );

  return useMemo(
    () => ({
      data: state.data,
      loading: state.loading,
      error: state.error,
      available: Boolean(state.data?.available),
      refresh,
      pressButton,
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
    }),
    [
      state,
      refresh,
      pressButton,
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
    ],
  );
}
