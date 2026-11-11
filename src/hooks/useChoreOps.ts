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
import { callHaService, getAllEntityStates, hasToken } from '../api/ha-rest';
import { useHomeAssistant } from './useHomeAssistant';
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
  /** Delete a ChoreOps chore by name. */
  deleteChore: (choreName: string) => Promise<void>;
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

function emit(patch: Partial<ChoreOpsSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
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

function applyStates(states: ChoreOpsEntityState[]): void {
  emit({ data: normalizeChoreOps(states), error: null, loading: false });
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

export function useChoreOps(): UseChoreOpsResult {
  const { client, connected } = useHomeAssistant();
  const state = useSyncExternalStore(subscribe, getSnapshot);

  useEffect(() => {
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
  }, [client, connected]);

  const refresh = useCallback(() => {
    emit({ loading: snapshot.data === null });
    const activeClient = client();
    if (activeClient && connected) {
      void loadViaClient(activeClient);
      return;
    }
    void loadViaRest();
  }, [client, connected]);

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
    const before = signature(snapshot.data);
    const activeClient = client();
    const read = activeClient && connected ? () => loadViaClient(activeClient) : loadViaRest;

    for (let attempt = 0; attempt < WRITE_REFRESH_ATTEMPTS; attempt += 1) {
      await read();
      if (signature(snapshot.data) !== before) return;
      await delay(WRITE_REFRESH_INTERVAL_MS);
    }
  }, [client, connected]);

  /**
   * Invoke a ChoreOps action by pressing its button entity.
   * ChoreOps exposes actions only as `button.*` entities, discovered from the
   * parent sensor's attributes — never hardcoded.
   */
  const pressButton = useCallback(
    async (entityId: string): Promise<void> => {
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
    [client, connected, reloadAfterWrite],
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
    [reloadAfterWrite],
  );

  /**
   * Create a chore in ChoreOps. ChoreOps remains the source of truth: Abbai Flow
   * only sends the fields the user filled in and then re-reads its entities.
   */
  const createChore = useCallback(
    async (input: Omit<CreateChoreInput, 'entryId'>): Promise<void> => {
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildCreateChorePayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a name and at least one assignee');
      await callHaService('choreops', 'create_chore', payload);

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
  );

  /** Create a reward for the given ChoreOps users. */
  const createReward = useCallback(
    async (input: Omit<CreateRewardInput, 'entryId'>): Promise<void> => {
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildCreateRewardPayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a reward name and at least one user');

      await callHaService('choreops', 'create_reward', payload);

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
  );

  /** Delete a chore in ChoreOps by name (the id ChoreOps publishes). */
  const updateReward = useCallback(
    async (input: Omit<UpdateRewardInput, 'entryId'>): Promise<void> => {
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildUpdateRewardPayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a reward name to update it');

      await callHaService('choreops', 'update_reward', payload);

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
  );

  /** Remove a reward from ChoreOps by name. */
  const deleteReward = useCallback(
    async (rewardName: string): Promise<void> => {
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'delete_reward', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        name: rewardName,
      });

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
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
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'approve_reward', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        approver_name: approverName?.trim() || 'Abbai Flow',
        user_name: userName,
        reward_name: rewardName,
      });

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
  );

  /** Delete a ChoreOps chore by name (the id ChoreOps publishes). */
  const deleteChore = useCallback(
    async (choreName: string): Promise<void> => {
      const entryId = snapshot.data?.entryId ?? null;
      await callHaService('choreops', 'delete_chore', {
        ...(entryId ? { config_entry_id: entryId } : {}),
        name: choreName,
      });

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
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
      const entryId = snapshot.data?.entryId ?? null;
      const payload = buildUpdateChorePayload({ ...input, entryId });
      if (!payload) throw new Error('ChoreOps needs a chore name to update it');

      await callHaService('choreops', 'update_chore', payload);

      await reloadAfterWrite();
    },
    [reloadAfterWrite],
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
      createReward,
      updateReward,
      deleteReward,
      approveReward,
      deleteChore,
    }),
    [
      state,
      refresh,
      pressButton,
      claimChore,
      createChore,
      updateChore,
      createReward,
      updateReward,
      deleteReward,
      approveReward,
      deleteChore,
    ],
  );
}
