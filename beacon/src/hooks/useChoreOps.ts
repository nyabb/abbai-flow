/**
 * ChoreOps data hook.
 *
 * Beacon runs in two shapes and they need different transports:
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
import { normalizeChoreOps, purposeOf } from '../api/choreops';
import type { ChoreOpsEntityState, ChoreOpsState } from '../types/choreops';

const REFETCH_DEBOUNCE_MS = 400;

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
    void loadViaRest();
  }, REST_POLL_MS);
  return () => clearInterval(interval);
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
        return;
      }

      await callHaService('button', 'press', { entity_id: entityId });
      // REST mode has no state_changed stream, so pull the new state ourselves.
      void loadViaRest();
    },
    [client, connected],
  );

  return useMemo(
    () => ({
      data: state.data,
      loading: state.loading,
      error: state.error,
      available: Boolean(state.data?.available),
      refresh,
      pressButton,
    }),
    [state, refresh, pressButton],
  );
}
