export type BluetoothConnection = 'disabled' | 'connecting' | 'connected' | 'disconnected';

export interface BluetoothAdapterInfo {
  address: string;
  name: string;
  powered: boolean;
  discovering: boolean;
}

export interface BluetoothDeviceInfo {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
  trusted: boolean;
  icon: string | null;
  rssi: number | null;
  uuids: string[];
}

export interface BluetoothPairingChallenge {
  id: string;
  address: string;
  deviceName: string;
  kind: 'pin' | 'passkey' | 'confirm' | 'authorize' | 'service';
  service?: string;
  displayedValue?: string;
}

export interface BluetoothSnapshot {
  configured: boolean;
  connection: BluetoothConnection;
  adapter: BluetoothAdapterInfo | null;
  scanning: boolean;
  devices: BluetoothDeviceInfo[];
  challenge: BluetoothPairingChallenge | null;
  notice: string | null;
  error: string | null;
  updatedAt: number;
}

export type BluetoothControl =
  | { action: 'scan' }
  | { action: 'stop-scan' }
  | { action: 'power'; enabled: boolean }
  | { action: 'pair' | 'connect' | 'disconnect' | 'forget'; address: string }
  | {
      action: 'pairing-response';
      challengeId: string;
      accept: boolean;
      value?: string;
    };
