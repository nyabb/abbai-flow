import {
  DBusError,
  Message,
  Variant,
  interface as dbusInterface,
  sessionBus,
  type MessageBus,
} from 'dbus-next';
import type {
  BluetoothAdapterInfo,
  BluetoothControl,
  BluetoothDeviceInfo,
  BluetoothPairingChallenge,
  BluetoothSnapshot,
} from './bluetooth-types';

type SnapshotListener = (snapshot: BluetoothSnapshot) => void;
type ChallengeKind = BluetoothPairingChallenge['kind'];

interface PlatformState {
  adapter: BluetoothAdapterInfo | null;
  scanning: boolean;
  devices: BluetoothDeviceInfo[];
}

interface BluetoothPlatform {
  connect(): Promise<void>;
  readState(): Promise<PlatformState>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  setPowered(enabled: boolean): Promise<void>;
  pair(address: string): Promise<void>;
  connectDevice(address: string): Promise<void>;
  disconnectDevice(address: string): Promise<void>;
  forget(address: string): Promise<void>;
  close(): void;
}

interface PlatformHandlers {
  onChange(): void;
  onDisconnect(error?: unknown): void;
  requestChallenge(devicePath: string, kind: ChallengeKind, service?: string): Promise<string>;
  displayValue(devicePath: string, value: string): void;
  cancelChallenge(): void;
}

type PlatformFactory = (address: string, handlers: PlatformHandlers) => BluetoothPlatform;

interface PendingChallenge {
  id: string;
  kind: ChallengeKind;
  resolve(value: string): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BluetoothManagerOptions {
  dbusAddress?: string;
  platformFactory?: PlatformFactory;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  scanDurationMs?: number;
  pollIntervalMs?: number;
}

export class BluetoothOperationError extends Error {
  constructor(
    message: string,
    readonly status = 503,
  ) {
    super(message);
    this.name = 'BluetoothOperationError';
  }
}

function emptySnapshot(configured: boolean): BluetoothSnapshot {
  return {
    configured,
    connection: configured ? 'connecting' : 'disabled',
    adapter: null,
    scanning: false,
    devices: [],
    challenge: null,
    notice: null,
    error: null,
    updatedAt: Date.now(),
  };
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unwrap(value: unknown): unknown {
  let current = value;
  while (isRecord(current) && Object.prototype.hasOwnProperty.call(current, 'value')) {
    current = current.value;
  }
  return current;
}

function property(properties: Record<string, unknown>, key: string): unknown {
  return unwrap(properties[key]);
}

function stringProperty(properties: Record<string, unknown>, key: string): string | null {
  const value = property(properties, key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanProperty(properties: Record<string, unknown>, key: string): boolean {
  return property(properties, key) === true;
}

function numberProperty(properties: Record<string, unknown>, key: string): number | null {
  const value = property(properties, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayProperty(properties: Record<string, unknown>, key: string): string[] {
  const value = property(properties, key);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function proxyMethod(proxy: unknown, name: string, ...args: unknown[]): Promise<unknown> {
  const method = isRecord(proxy) ? proxy[name] : undefined;
  if (typeof method !== 'function') throw new Error(`Bluetooth method ${name} is unavailable`);
  return Promise.resolve(Reflect.apply(method, proxy, args));
}

function safeBluetoothError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/NotReady|not powered|powered off/i.test(message))
    return 'The Bluetooth adapter is turned off';
  if (/AuthenticationRejected|Rejected|Canceled/i.test(message))
    return 'Bluetooth pairing was cancelled';
  if (/AlreadyExists/i.test(message)) return 'This Bluetooth device is already paired';
  if (/NotConnected/i.test(message)) return 'This Bluetooth device is not connected';
  if (/NotAvailable|not available|NoReply|ServiceUnknown/i.test(message)) {
    return 'The host Bluetooth service is unavailable';
  }
  return 'Bluetooth could not complete that request';
}

function deviceAddressFromPath(devicePath: string): string {
  const match = devicePath.match(/\/dev_([0-9A-Fa-f_]+)$/);
  return match ? match[1].replace(/_/g, ':').toUpperCase() : devicePath;
}

function validateAddress(address: unknown): address is string {
  return typeof address === 'string' && /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address);
}

function normalizeAddress(address: string): string {
  return address.toUpperCase();
}

class BluezPairingAgent extends dbusInterface.Interface {
  constructor(private readonly handlers: PlatformHandlers) {
    super('org.bluez.Agent1');
  }

  Release(): void {}

  RequestPinCode(devicePath: string): Promise<string> {
    return this.handlers.requestChallenge(devicePath, 'pin');
  }

  DisplayPinCode(devicePath: string, pinCode: string): void {
    this.handlers.displayValue(devicePath, pinCode);
  }

  async RequestPasskey(devicePath: string): Promise<number> {
    const passkey = await this.handlers.requestChallenge(devicePath, 'passkey');
    return Number(passkey);
  }

  DisplayPasskey(devicePath: string, passkey: number, _entered: number): void {
    this.handlers.displayValue(devicePath, String(passkey).padStart(6, '0'));
  }

  async RequestConfirmation(devicePath: string, passkey: number): Promise<void> {
    await this.handlers.requestChallenge(devicePath, 'confirm', String(passkey).padStart(6, '0'));
  }

  async RequestAuthorization(devicePath: string): Promise<void> {
    await this.handlers.requestChallenge(devicePath, 'authorize');
  }

  async AuthorizeService(devicePath: string, service: string): Promise<void> {
    await this.handlers.requestChallenge(devicePath, 'service', service);
  }

  Cancel(): void {
    this.handlers.cancelChallenge();
  }
}

BluezPairingAgent.configureMembers({
  methods: {
    Release: { inSignature: '', outSignature: '' },
    RequestPinCode: { inSignature: 'o', outSignature: 's' },
    DisplayPinCode: { inSignature: 'os', outSignature: '' },
    RequestPasskey: { inSignature: 'o', outSignature: 'u' },
    DisplayPasskey: { inSignature: 'ouq', outSignature: '' },
    RequestConfirmation: { inSignature: 'ou', outSignature: '' },
    RequestAuthorization: { inSignature: 'o', outSignature: '' },
    AuthorizeService: { inSignature: 'os', outSignature: '' },
    Cancel: { inSignature: '', outSignature: '' },
  },
});

class BluezDbusPlatform implements BluetoothPlatform {
  private bus: MessageBus | null = null;
  private adapterPath: string | null = null;
  private readonly devicePaths = new Map<string, string>();
  private agent: BluezPairingAgent | null = null;
  private agentRegistered = false;
  private disconnectHandled = false;

  constructor(
    private readonly address: string,
    private readonly handlers: PlatformHandlers,
  ) {}

  async connect(): Promise<void> {
    const bus = sessionBus({ busAddress: this.address });
    this.bus = bus;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Bluetooth D-Bus connection timed out')),
        5000,
      );
      const events = bus as unknown as {
        on(event: string, listener: (value?: unknown) => void): unknown;
        off(event: string, listener: (value?: unknown) => void): unknown;
      };
      const onConnect = () => finish();
      const onError = (error: unknown) => finish(error instanceof Error ? error : new Error());
      const finish = (error?: Error) => {
        clearTimeout(timer);
        events.off('connect', onConnect);
        events.off('error', onError);
        if (error) reject(error);
        else resolve();
      };
      events.on('connect', onConnect);
      events.on('error', onError);
    });

    bus.on('error', (error) => this.handleDisconnect(error));
    const connection = (
      bus as unknown as {
        _connection?: { on?: (event: string, listener: () => void) => unknown };
      }
    )._connection;
    if (typeof connection?.on === 'function') {
      connection.on('end', () => this.handleDisconnect(new Error('Bluetooth bus disconnected')));
    }
    bus.on('message', (message) => {
      if (
        message.sender === 'org.bluez' &&
        (message.member === 'PropertiesChanged' ||
          message.member === 'InterfacesAdded' ||
          message.member === 'InterfacesRemoved')
      ) {
        this.handlers.onChange();
      }
    });
    await this.addBluezSignalMatch();
    await this.registerAgent();
  }

  async readState(): Promise<PlatformState> {
    const bus = this.requireBus();
    const root = await bus.getProxyObject('org.bluez', '/');
    const objectManager = root.getInterface('org.freedesktop.DBus.ObjectManager');
    const objects = await proxyMethod(objectManager, 'GetManagedObjects');
    if (!isRecord(objects)) throw new Error('Bluetooth service returned an invalid device list');

    this.devicePaths.clear();
    this.adapterPath = null;
    let adapter: BluetoothAdapterInfo | null = null;
    const devices: BluetoothDeviceInfo[] = [];

    for (const [objectPath, rawInterfaces] of Object.entries(objects)) {
      if (!isRecord(rawInterfaces)) continue;
      const adapterProperties = rawInterfaces['org.bluez.Adapter1'];
      if (!this.adapterPath && isRecord(adapterProperties)) {
        this.adapterPath = objectPath;
        adapter = {
          address: stringProperty(adapterProperties, 'Address') || '',
          name:
            stringProperty(adapterProperties, 'Alias') ||
            stringProperty(adapterProperties, 'Name') ||
            'Bluetooth adapter',
          powered: booleanProperty(adapterProperties, 'Powered'),
          discovering: booleanProperty(adapterProperties, 'Discovering'),
        };
      }

      const deviceProperties = rawInterfaces['org.bluez.Device1'];
      if (!isRecord(deviceProperties)) continue;
      const address = stringProperty(deviceProperties, 'Address');
      if (!address) continue;
      const normalized = normalizeAddress(address);
      this.devicePaths.set(normalized, objectPath);
      devices.push({
        address: normalized,
        name:
          stringProperty(deviceProperties, 'Alias') ||
          stringProperty(deviceProperties, 'Name') ||
          normalized,
        paired: booleanProperty(deviceProperties, 'Paired'),
        connected: booleanProperty(deviceProperties, 'Connected'),
        trusted: booleanProperty(deviceProperties, 'Trusted'),
        icon: stringProperty(deviceProperties, 'Icon'),
        rssi: numberProperty(deviceProperties, 'RSSI'),
        uuids: stringArrayProperty(deviceProperties, 'UUIDs'),
      });
    }

    devices.sort((left, right) => {
      if (left.connected !== right.connected) return left.connected ? -1 : 1;
      if (left.paired !== right.paired) return left.paired ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    return {
      adapter,
      scanning: adapter?.discovering ?? false,
      devices,
    };
  }

  async startDiscovery(): Promise<void> {
    await proxyMethod(await this.getAdapterInterface(), 'StartDiscovery');
  }

  async stopDiscovery(): Promise<void> {
    await proxyMethod(await this.getAdapterInterface(), 'StopDiscovery');
  }

  async setPowered(enabled: boolean): Promise<void> {
    const properties = await this.getInterface(
      this.requireAdapterPath(),
      'org.freedesktop.DBus.Properties',
    );
    await proxyMethod(
      properties,
      'Set',
      'org.bluez.Adapter1',
      'Powered',
      new Variant('b', enabled),
    );
  }

  async pair(address: string): Promise<void> {
    await proxyMethod(await this.getDeviceInterface(address), 'Pair');
  }

  async connectDevice(address: string): Promise<void> {
    await proxyMethod(await this.getDeviceInterface(address), 'Connect');
  }

  async disconnectDevice(address: string): Promise<void> {
    await proxyMethod(await this.getDeviceInterface(address), 'Disconnect');
  }

  async forget(address: string): Promise<void> {
    const adapter = await this.getAdapterInterface();
    await proxyMethod(adapter, 'RemoveDevice', this.requireDevicePath(address));
  }

  close(): void {
    const bus = this.bus;
    this.bus = null;
    if (!bus) return;
    try {
      if (this.agent) bus.unexport('/com/abbaiflow/BluetoothAgent', this.agent);
      bus.disconnect();
    } catch {
      // The bus may already have dropped during reconnect/shutdown.
    }
  }

  private async addBluezSignalMatch(): Promise<void> {
    await this.requireBus().call(
      new Message({
        destination: 'org.freedesktop.DBus',
        path: '/org/freedesktop/DBus',
        interface: 'org.freedesktop.DBus',
        member: 'AddMatch',
        signature: 's',
        body: ["type='signal',sender='org.bluez'"],
      }),
    );
  }

  private async registerAgent(): Promise<void> {
    if (this.agentRegistered) return;
    const agentManager = await this.getInterface('/org/bluez', 'org.bluez.AgentManager1');
    const agent = new BluezPairingAgent(this.handlers);
    this.requireBus().export('/com/abbaiflow/BluetoothAgent', agent);
    try {
      await proxyMethod(
        agentManager,
        'RegisterAgent',
        '/com/abbaiflow/BluetoothAgent',
        'KeyboardDisplay',
      );
      await proxyMethod(agentManager, 'RequestDefaultAgent', '/com/abbaiflow/BluetoothAgent');
      this.agent = agent;
      this.agentRegistered = true;
    } catch (error) {
      this.requireBus().unexport('/com/abbaiflow/BluetoothAgent', agent);
      throw error;
    }
  }

  private async getAdapterInterface(): Promise<unknown> {
    return this.getInterface(this.requireAdapterPath(), 'org.bluez.Adapter1');
  }

  private async getDeviceInterface(address: string): Promise<unknown> {
    return this.getInterface(this.requireDevicePath(address), 'org.bluez.Device1');
  }

  private async getInterface(objectPath: string, interfaceName: string): Promise<unknown> {
    const object = await this.requireBus().getProxyObject('org.bluez', objectPath);
    return object.getInterface(interfaceName);
  }

  private requireAdapterPath(): string {
    if (!this.adapterPath) throw new BluetoothOperationError('No Bluetooth adapter is available');
    return this.adapterPath;
  }

  private requireDevicePath(address: string): string {
    const devicePath = this.devicePaths.get(normalizeAddress(address));
    if (!devicePath)
      throw new BluetoothOperationError('Device not found. Scan again and retry.', 404);
    return devicePath;
  }

  private requireBus(): MessageBus {
    if (!this.bus) throw new BluetoothOperationError('The host Bluetooth service is unavailable');
    return this.bus;
  }

  private handleDisconnect(error?: unknown): void {
    if (this.disconnectHandled || !this.bus) return;
    this.disconnectHandled = true;
    this.agentRegistered = false;
    this.adapterPath = null;
    this.devicePaths.clear();
    this.handlers.onDisconnect(error);
  }
}

export class BluetoothManager {
  private readonly configured: boolean;
  private readonly address: string;
  private readonly platformFactory: PlatformFactory;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly scanDurationMs: number;
  private readonly pollIntervalMs: number;
  private reconnectDelay: number;
  private snapshot: BluetoothSnapshot;
  private readonly listeners = new Set<SnapshotListener>();
  private platform: BluetoothPlatform | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private challenge: PendingChallenge | null = null;
  private started = false;
  private stopped = false;
  private connecting = false;

  constructor(options: BluetoothManagerOptions = {}) {
    this.address = options.dbusAddress?.trim() || '';
    this.configured = Boolean(this.address);
    this.platformFactory =
      options.platformFactory || ((address, handlers) => new BluezDbusPlatform(address, handlers));
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000;
    this.scanDurationMs = options.scanDurationMs ?? 30000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.reconnectDelay = this.reconnectBaseMs;
    this.snapshot = emptySnapshot(this.configured);
  }

  getSnapshot(): BluetoothSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot)) as BluetoothSnapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started || !this.configured) return;
    this.started = true;
    this.stopped = false;
    this.setState({ connection: 'connecting', error: null });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.reconnectTimer = null;
    this.scanTimer = null;
    this.pollTimer = null;
    this.refreshTimer = null;
    this.rejectChallenge(new Error('Bluetooth service stopped'));
    const platform = this.platform;
    this.platform = null;
    platform?.close();
    this.setState({ connection: this.configured ? 'disconnected' : 'disabled', scanning: false });
  }

  async control(control: BluetoothControl): Promise<void> {
    const platform = this.requirePlatform();
    try {
      switch (control.action) {
        case 'scan':
          await this.runPlatformOperation(platform, platform.startDiscovery(), 15000);
          if (this.scanTimer) clearTimeout(this.scanTimer);
          this.scanTimer = setTimeout(
            () => void this.stopDiscovery().catch(() => undefined),
            this.scanDurationMs,
          );
          this.setState({ scanning: true, error: null });
          break;
        case 'stop-scan':
          await this.stopDiscovery();
          break;
        case 'power':
          await this.runPlatformOperation(platform, platform.setPowered(control.enabled), 15000);
          await this.refresh();
          break;
        case 'pair':
          await this.runPlatformOperation(
            platform,
            platform.pair(normalizeAddress(control.address)),
            100000,
          );
          await this.refresh();
          break;
        case 'connect':
          await this.runPlatformOperation(
            platform,
            platform.connectDevice(normalizeAddress(control.address)),
            60000,
          );
          await this.refresh();
          break;
        case 'disconnect':
          await this.runPlatformOperation(
            platform,
            platform.disconnectDevice(normalizeAddress(control.address)),
            30000,
          );
          await this.refresh();
          break;
        case 'forget':
          await this.runPlatformOperation(
            platform,
            platform.forget(normalizeAddress(control.address)),
            30000,
          );
          await this.refresh();
          break;
        case 'pairing-response':
          this.answerChallenge(control);
          break;
      }
    } catch (error) {
      if (error instanceof BluetoothOperationError) throw error;
      throw new BluetoothOperationError(safeBluetoothError(error));
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || !this.configured) return;
    this.connecting = true;
    const platform = this.platformFactory(this.address, {
      onChange: () => this.scheduleRefresh(),
      onDisconnect: (error) => this.handleDisconnect(error),
      requestChallenge: (devicePath, kind, service) =>
        this.requestChallenge(devicePath, kind, service),
      displayValue: (devicePath, displayedValue) => this.displayValue(devicePath, displayedValue),
      cancelChallenge: () =>
        this.rejectChallenge(new DBusError('org.bluez.Error.Canceled', 'Pairing cancelled')),
    });
    this.platform = platform;
    try {
      await this.runPlatformOperation(platform, platform.connect(), 15000);
      if (this.stopped || this.platform !== platform) return;
      this.reconnectDelay = this.reconnectBaseMs;
      this.setState({ connection: 'connected', error: null });
      await this.refresh();
      if (this.platform !== platform || this.stopped) return;
      this.pollTimer = setInterval(() => void this.refresh(), this.pollIntervalMs);
    } catch {
      if (this.platform === platform) this.platform = null;
      platform.close();
      this.setState({
        connection: 'disconnected',
        error: 'The host Bluetooth service is unavailable',
      });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
      if (this.snapshot.connection === 'disconnected' && !this.stopped && !this.reconnectTimer) {
        this.scheduleReconnect();
      }
    }
  }

  private handleDisconnect(error?: unknown): void {
    if (this.stopped || !this.platform) return;
    this.platform.close();
    this.platform = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.rejectChallenge(new Error('Bluetooth connection was interrupted'));
    this.setState({
      connection: 'disconnected',
      scanning: false,
      error: safeBluetoothError(error),
      adapter: null,
      devices: [],
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setState({ connection: 'connecting', error: null });
      void this.connect();
    }, delay);
  }

  private async refresh(): Promise<void> {
    const platform = this.platform;
    if (!platform || this.stopped) return;
    try {
      const next = await this.runPlatformOperation(platform, platform.readState(), 10000);
      if (this.platform !== platform) return;
      this.setState({
        connection: 'connected',
        adapter: next.adapter,
        scanning: next.scanning,
        devices: next.devices,
        error: next.adapter ? null : 'No Bluetooth adapter is available',
      });
    } catch (error) {
      if (this.platform === platform) this.handleDisconnect(error);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
  }

  private async stopDiscovery(): Promise<void> {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
    const platform = this.platform;
    if (!platform) return;
    try {
      await this.runPlatformOperation(platform, platform.stopDiscovery(), 15000);
      this.setState({ scanning: false });
      await this.refresh();
    } catch (error) {
      throw new BluetoothOperationError(safeBluetoothError(error));
    }
  }

  private requirePlatform(): BluetoothPlatform {
    if (!this.configured) {
      throw new BluetoothOperationError(
        'Bluetooth is not enabled. Mount the host D-Bus socket and configure the Bluetooth D-Bus address.',
      );
    }
    if (this.snapshot.connection !== 'connected' || !this.platform) {
      throw new BluetoothOperationError('The host Bluetooth service is unavailable');
    }
    return this.platform;
  }

  private runPlatformOperation<T>(
    platform: BluetoothPlatform,
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        if (this.platform === platform)
          this.handleDisconnect(new Error('Bluetooth D-Bus request timed out'));
        reject(new BluetoothOperationError('Bluetooth request timed out'));
      }, timeoutMs);
    });
    return Promise.race([operation, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  private requestChallenge(
    devicePath: string,
    kind: ChallengeKind,
    service?: string,
  ): Promise<string> {
    if (this.challenge)
      return Promise.reject(
        new DBusError('org.bluez.Error.Rejected', 'Another pairing prompt is active'),
      );
    const id = randomId();
    const address = deviceAddressFromPath(devicePath);
    const device = this.snapshot.devices.find((entry) => entry.address === address);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.challenge?.id !== id) return;
        this.challenge = null;
        this.setState({ challenge: null, error: 'Bluetooth pairing timed out' });
        reject(new DBusError('org.bluez.Error.Canceled', 'Bluetooth pairing timed out'));
      }, 90000);
      this.challenge = { id, kind, resolve, reject, timer };
      this.setState({
        challenge: {
          id,
          kind,
          address,
          deviceName: device?.name || address,
          ...(kind === 'service' ? { service } : {}),
          ...(kind === 'confirm' && service ? { displayedValue: service } : {}),
        },
        error: null,
      });
    });
  }

  private displayValue(devicePath: string, displayedValue: string): void {
    const address = deviceAddressFromPath(devicePath);
    const device = this.snapshot.devices.find((entry) => entry.address === address);
    this.setState({
      notice: `${device?.name || address}: confirmation code ${displayedValue}`,
    });
  }

  private answerChallenge(
    control: Extract<BluetoothControl, { action: 'pairing-response' }>,
  ): void {
    const pending = this.challenge;
    if (!pending || pending.id !== control.challengeId) {
      throw new BluetoothOperationError('This Bluetooth pairing prompt has expired', 409);
    }
    let value = '';
    if (control.accept && pending.kind === 'pin') {
      if (!control.value || control.value.length > 16 || !/^[A-Za-z0-9]+$/.test(control.value)) {
        throw new BluetoothOperationError('Enter a PIN with 1 to 16 letters or numbers', 400);
      }
      value = control.value;
    } else if (control.accept && pending.kind === 'passkey') {
      if (!control.value || !/^\d{1,6}$/.test(control.value)) {
        throw new BluetoothOperationError('Enter a passkey containing up to 6 digits', 400);
      }
      value = String(Number(control.value));
    }
    clearTimeout(pending.timer);
    this.challenge = null;
    this.setState({
      challenge: null,
      error: control.accept ? null : 'Bluetooth pairing was declined',
    });
    if (control.accept) pending.resolve(value);
    else
      pending.reject(new DBusError('org.bluez.Error.Rejected', 'Bluetooth pairing was declined'));
  }

  private rejectChallenge(error: Error): void {
    const pending = this.challenge;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.challenge = null;
    this.setState({ challenge: null });
    pending.reject(error);
  }

  private setState(patch: Partial<BluetoothSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, updatedAt: Date.now() };
    const value = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch {
        // A stale browser stream cannot interrupt the host Bluetooth service.
      }
    }
  }
}

export function validateBluetoothControl(
  value: unknown,
): { control: BluetoothControl; error: null } | { control: null; error: string } {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return { control: null, error: 'Invalid Bluetooth request' };
  }
  const keys = Object.keys(value);
  const hasOnly = (...allowed: string[]) => keys.every((key) => allowed.includes(key));
  const addressControl = ['pair', 'connect', 'disconnect', 'forget'].includes(value.action);

  if (value.action === 'scan' || value.action === 'stop-scan') {
    return hasOnly('action')
      ? { control: { action: value.action }, error: null }
      : { control: null, error: 'Invalid Bluetooth request' };
  }
  if (value.action === 'power') {
    return hasOnly('action', 'enabled') && typeof value.enabled === 'boolean'
      ? { control: { action: 'power', enabled: value.enabled }, error: null }
      : { control: null, error: 'Invalid Bluetooth power request' };
  }
  if (addressControl) {
    if (!hasOnly('action', 'address') || !validateAddress(value.address)) {
      return { control: null, error: 'A valid Bluetooth device address is required' };
    }
    return {
      control: {
        action: value.action as 'pair' | 'connect' | 'disconnect' | 'forget',
        address: value.address,
      },
      error: null,
    };
  }
  if (value.action === 'pairing-response') {
    if (
      !hasOnly('action', 'challengeId', 'accept', 'value') ||
      typeof value.challengeId !== 'string' ||
      value.challengeId.length > 80 ||
      typeof value.accept !== 'boolean' ||
      (value.value !== undefined && typeof value.value !== 'string')
    ) {
      return { control: null, error: 'Invalid Bluetooth pairing response' };
    }
    return {
      control: {
        action: 'pairing-response',
        challengeId: value.challengeId,
        accept: value.accept,
        ...(typeof value.value === 'string' ? { value: value.value } : {}),
      },
      error: null,
    };
  }
  return { control: null, error: 'Unsupported Bluetooth action' };
}
