import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * Regression guard for the deployed (add-on / standalone Docker) case.
 *
 * In those modes `useHomeAssistant` deliberately creates no HomeAssistantClient
 * — the server injects the HA token — so `client()` returns null. The hook used
 * to bail out on that and stay on `loading: true` forever, which showed up as an
 * empty chores screen and a missing "From Home Assistant" picker in Settings.
 * It must fall back to the REST API instead.
 */

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  connected: true,
  hasToken: vi.fn(() => true),
  getAllEntityStates: vi.fn(),
  callHaService: vi.fn(),
}));

vi.mock('./useHomeAssistant', () => ({
  useHomeAssistant: () => ({ client: mocks.client, connected: mocks.connected }),
}));

vi.mock('../api/ha-rest', () => ({
  hasToken: mocks.hasToken,
  getAllEntityStates: mocks.getAllEntityStates,
  callHaService: mocks.callHaService,
}));

const STATES = [
  {
    entity_id: 'sensor.maya_choreops_points',
    state: '42',
    attributes: { purpose: 'purpose_points', user_name: 'Maya' },
  },
  {
    entity_id: 'sensor.maya_choreops_ui_dashboard_helper',
    state: 'ok',
    attributes: {
      purpose: 'purpose_dashboard_helper',
      user_name: 'Maya',
      chores: [
        {
          eid: 'chore-1',
          name: 'Brush your teeth',
          status: 'due',
          icon: '\u{1FAA5}',
          claim_button_eid: 'button.maya_choreops_claim_brush',
        },
      ],
    },
  },
  {
    entity_id: 'person.maya',
    state: 'home',
    attributes: { friendly_name: 'Maya', entity_picture: '/api/image/serve/abc/512x512' },
  },
];

describe('useChoreOps', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.client.mockReturnValue(null);
    mocks.connected = true;
    mocks.hasToken.mockReturnValue(true);
    mocks.getAllEntityStates.mockResolvedValue([]);
    mocks.callHaService.mockResolvedValue({});
  });

  it('loads over REST when there is no WebSocket client (proxy deployment)', async () => {
    mocks.getAllEntityStates.mockResolvedValue(STATES);

    const { useChoreOps } = await import('./useChoreOps');
    const { result } = renderHook(() => useChoreOps());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mocks.getAllEntityStates).toHaveBeenCalled();
    expect(result.current.available).toBe(true);
    expect(result.current.data?.users[0]).toMatchObject({ name: 'Maya', points: 42 });
    expect(result.current.data?.chores[0]).toMatchObject({
      name: 'Brush your teeth',
      actions: { claim: 'button.maya_choreops_claim_brush' },
    });
    // HA person photos must survive normalisation, or the member picker offers
    // no photo import.
    expect(result.current.data?.people[0]).toMatchObject({
      name: 'Maya',
      picture: '/api/image/serve/abc/512x512',
    });
  });

  it('falls back to REST when the client exists but the socket never connected', async () => {
    // Dev with a blocked/unreachable WebSocket: useHomeAssistant has created a
    // client but `connected` stays false. Previously this left the hook on
    // `loading: true` forever with no transport attached.
    mocks.client.mockReturnValue({
      getStates: vi.fn(async () => []),
      subscribeStateChanges: vi.fn(),
      unsubscribe: vi.fn(),
      callService: vi.fn(),
    });
    mocks.connected = false;
    mocks.getAllEntityStates.mockResolvedValue(STATES);

    const { useChoreOps } = await import('./useChoreOps');
    const { result } = renderHook(() => useChoreOps());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.getAllEntityStates).toHaveBeenCalled();
    expect(result.current.available).toBe(true);
  });

  it('presses action buttons through the REST service call in proxy mode', async () => {
    mocks.getAllEntityStates.mockResolvedValue(STATES);

    const { useChoreOps } = await import('./useChoreOps');
    const { result } = renderHook(() => useChoreOps());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.pressButton('button.maya_choreops_claim_brush');

    expect(mocks.callHaService).toHaveBeenCalledWith('button', 'press', {
      entity_id: 'button.maya_choreops_claim_brush',
    });
  });

  it('prefers the WebSocket client when one exists, and ignores non-button actions', async () => {
    const agentClient = {
      getStates: vi.fn(async () => STATES),
      subscribeStateChanges: vi.fn(async () => 7),
      unsubscribe: vi.fn(),
      callService: vi.fn(async () => ({})),
    };
    mocks.client.mockReturnValue(agentClient);

    const { useChoreOps } = await import('./useChoreOps');
    const { result } = renderHook(() => useChoreOps());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(agentClient.getStates).toHaveBeenCalled();
    expect(mocks.getAllEntityStates).not.toHaveBeenCalled();

    await result.current.pressButton('button.maya_choreops_claim_brush');
    expect(agentClient.callService).toHaveBeenCalledWith(
      'button',
      'press',
      'button.maya_choreops_claim_brush',
    );
    expect(mocks.callHaService).not.toHaveBeenCalled();

    await expect(result.current.pressButton('sensor.not_a_button')).rejects.toThrow(
      /Not a button entity/,
    );
  });
});
