import { afterEach, describe, expect, it, vi } from 'vitest';
import { DBusError } from 'dbus-next';
import {
  BluetoothManager,
  validateBluetoothControl,
  type BluetoothManagerOptions,
} from './bluetooth-manager';
import type { BluetoothAdapterInfo, BluetoothDeviceInfo } from './bluetooth-types';

const ADDRESS = 'AA:BB:CC:DD:EE:FF';
const ADAPTER: BluetoothAdapterInfo = {
  address: '11:22:33:44:55:66',
  name: 'Abbai Bluetooth',
  powered: true,
  discovering: false,
};
const DEVICE: BluetoothDeviceInfo = {
  address: ADDRESS,
  name: 'Kitchen speaker',
  paired: false,
  connected: false,
  trusted: false,
  icon: 'audio-speaker',
  rssi: -51,
  uuids: [],
};

const managers: BluetoothManager[] = [];
afterEach(() => {
  managers.splice(0).forEach((manager) => manager.stop());
  vi.restoreAllMocks();
});

function createManager(
  customize?: (platform: Record<string, unknown>) => void,
  options: Partial<BluetoothManagerOptions> = {},
) {
  let currentHandlers: Parameters<NonNullable<BluetoothManagerOptions['platformFactory']>>[1];
  let state = { adapter: ADAPTER, scanning: false, devices: [DEVICE] };
  const controls = {
    startDiscovery: vi.fn(async () => {
      state = { ...state, scanning: true };
    }),
    stopDiscovery: vi.fn(async () => {
      state = { ...state, scanning: false };
    }),
    setPowered: vi.fn(async () => undefined),
    pair: vi.fn(async () => undefined),
    connectDevice: vi.fn(async () => undefined),
    disconnectDevice: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
  };
  const factory: NonNullable<BluetoothManagerOptions['platformFactory']> = (_address, handlers) => {
    currentHandlers = handlers;
    const platform = {
      connect: vi.fn(async () => undefined),
      readState: vi.fn(async () => state),
      ...controls,
      close: vi.fn(),
    };
    customize?.(platform);
    return platform;
  };
  const manager = new BluetoothManager({
    dbusAddress: 'unix:path=/fake/system_bus_socket',
    platformFactory: factory,
    reconnectBaseMs: 10,
    reconnectMaxMs: 20,
    pollIntervalMs: 10000,
    ...options,
  });
  managers.push(manager);
  return {
    manager,
    controls,
    get handlers() {
      return currentHandlers;
    },
    setState(next: typeof state) {
      state = next;
      currentHandlers?.onChange();
    },
  };
}

describe('BluetoothManager', () => {
  it('stays disabled and does not connect unless a D-Bus address is configured', () => {
    const manager = new BluetoothManager();
    managers.push(manager);
    manager.start();
    expect(manager.getSnapshot()).toMatchObject({
      configured: false,
      connection: 'disabled',
      adapter: null,
    });
  });

  it('connects once and maintains adapter, discovery and nearby device state', async () => {
    const { manager, setState } = createManager();
    manager.start();
    await vi.waitFor(() => expect(manager.getSnapshot().connection).toBe('connected'));
    expect(manager.getSnapshot()).toMatchObject({
      adapter: ADAPTER,
      devices: [DEVICE],
      scanning: false,
    });

    setState({ adapter: ADAPTER, scanning: true, devices: [{ ...DEVICE, paired: true }] });
    await vi.waitFor(() =>
      expect(manager.getSnapshot()).toMatchObject({
        scanning: true,
        devices: [{ address: ADDRESS, paired: true }],
      }),
    );
  });

  it('automatically stops an active scan after the configured window', async () => {
    const { manager, controls } = createManager(undefined, { scanDurationMs: 25 });
    manager.start();
    await vi.waitFor(() => expect(manager.getSnapshot().connection).toBe('connected'));
    await manager.control({ action: 'scan' });
    expect(manager.getSnapshot().scanning).toBe(true);
    await vi.waitFor(() => expect(controls.stopDiscovery).toHaveBeenCalledOnce());
    expect(manager.getSnapshot().scanning).toBe(false);
  });

  it('keeps a pairing confirmation pending until the user responds', async () => {
    const test = createManager((platform) => {
      platform.pair = async () => {
        await test.handlers.requestChallenge(
          '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF',
          'confirm',
          '123456',
        );
      };
    });
    test.manager.start();
    await vi.waitFor(() => expect(test.manager.getSnapshot().connection).toBe('connected'));
    const pairing = test.manager.control({ action: 'pair', address: ADDRESS });
    await vi.waitFor(() =>
      expect(test.manager.getSnapshot().challenge).toMatchObject({
        kind: 'confirm',
        address: ADDRESS,
        deviceName: DEVICE.name,
        displayedValue: '123456',
      }),
    );
    const challengeId = test.manager.getSnapshot().challenge?.id;
    expect(challengeId).toBeTruthy();
    await test.manager.control({
      action: 'pairing-response',
      challengeId: challengeId!,
      accept: true,
    });
    await expect(pairing).resolves.toBeUndefined();
    expect(test.manager.getSnapshot().challenge).toBeNull();
  });

  it('reconnects with backoff after the BlueZ connection drops', async () => {
    let connections = 0;
    const test = createManager((platform) => {
      platform.connect = async () => {
        connections += 1;
        if (connections === 1) throw new Error('socket closed');
      };
    });
    test.manager.start();
    await vi.waitFor(() => expect(test.manager.getSnapshot().connection).toBe('connected'));
    expect(connections).toBe(2);
    expect(test.manager.getSnapshot().error).toBeNull();
  });

  it('reports an unavailable speaker audio profile without writing Bluetooth logs', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const test = createManager((platform) => {
      platform.connectDevice = vi
        .fn()
        .mockRejectedValue(
          new DBusError('org.bluez.Error.Failed', 'br-connection-profile-unavailable'),
        );
    });
    test.manager.start();
    await vi.waitFor(() => expect(test.manager.getSnapshot().connection).toBe('connected'));

    await expect(test.manager.control({ action: 'connect', address: ADDRESS })).rejects.toThrow(
      'The speaker Bluetooth audio profile is unavailable on the Raspberry Pi',
    );

    expect(warning).not.toHaveBeenCalled();
  });

  it('rejects malformed device addresses and extra control fields', () => {
    expect(
      validateBluetoothControl({ action: 'pair', address: 'not-an-address' }).error,
    ).toBeTruthy();
    expect(validateBluetoothControl({ action: 'scan', address: ADDRESS }).error).toBeTruthy();
    expect(validateBluetoothControl({ action: 'power', enabled: 'yes' }).error).toBeTruthy();
  });
});
