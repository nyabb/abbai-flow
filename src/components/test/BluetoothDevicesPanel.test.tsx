import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BluetoothSnapshot } from '../../api/bluetooth-types';
import { createI18n, I18nContext } from '../../i18n';
import { BluetoothDevicesPanel } from '../BluetoothDevicesPanel';

const EN = createI18n('en-US');
const adapter = {
  address: '11:22:33:44:55:66',
  name: 'Abbai Bluetooth',
  powered: true,
  discovering: false,
};
const device = {
  address: 'AA:BB:CC:DD:EE:FF',
  name: 'Kitchen speaker',
  paired: false,
  connected: false,
  trusted: false,
  icon: 'audio-speaker',
  rssi: -51,
  uuids: [],
};

function state(overrides: Partial<BluetoothSnapshot> = {}): BluetoothSnapshot {
  return {
    configured: true,
    connection: 'connected',
    adapter,
    scanning: false,
    devices: [],
    challenge: null,
    notice: null,
    error: null,
    updatedAt: 1,
    ...overrides,
  };
}

function renderPanel(snapshot: BluetoothSnapshot, onControl = vi.fn(async () => ({ ok: true }))) {
  render(
    <I18nContext.Provider value={EN}>
      <BluetoothDevicesPanel snapshot={snapshot} loading={false} onControl={onControl} />
    </I18nContext.Provider>,
  );
  return onControl;
}

describe('BluetoothDevicesPanel', () => {
  it('shows a connecting state while the initial server request is pending', () => {
    render(
      <I18nContext.Provider value={EN}>
        <BluetoothDevicesPanel
          snapshot={state({ configured: false, connection: 'connecting' })}
          loading
          onControl={vi.fn()}
        />
      </I18nContext.Provider>,
    );
    expect(document.querySelector('.bluetooth-status')).toHaveTextContent('Connecting...');
    expect(screen.queryByText(/system D-Bus socket/i)).not.toBeInTheDocument();
  });

  it('explains the optional host socket setup when Bluetooth has not been configured', () => {
    renderPanel(state({ configured: false, connection: 'disabled' }));
    expect(screen.getByRole('heading', { name: 'Bluetooth devices' })).toBeInTheDocument();
    expect(screen.getByText(/system D-Bus socket/i)).toBeInTheDocument();
    expect(screen.getByText(/ABBAI_FLOW_BLUETOOTH_DBUS_ADDRESS/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan for devices' })).not.toBeInTheDocument();
  });

  it('scans and pairs a nearby unpaired device', async () => {
    const onControl = renderPanel(state({ devices: [device] }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan for devices' }));
    await waitFor(() => expect(onControl).toHaveBeenCalledWith({ action: 'scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    await waitFor(() =>
      expect(onControl).toHaveBeenCalledWith({ action: 'pair', address: device.address }),
    );
  });

  it('offers connect for paired devices and disconnect for active devices', () => {
    const paired = { ...device, paired: true };
    const { rerender } = render(
      <I18nContext.Provider value={EN}>
        <BluetoothDevicesPanel
          snapshot={state({ devices: [paired] })}
          loading={false}
          onControl={vi.fn()}
        />
      </I18nContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    rerender(
      <I18nContext.Provider value={EN}>
        <BluetoothDevicesPanel
          snapshot={state({ devices: [{ ...paired, connected: true }] })}
          loading={false}
          onControl={vi.fn()}
        />
      </I18nContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Disconnect Kitchen speaker' })).toBeInTheDocument();
  });

  it('requires explicit confirmation for a BlueZ pairing challenge', async () => {
    const onControl = renderPanel(
      state({
        challenge: {
          id: 'challenge-1',
          address: device.address,
          deviceName: device.name,
          kind: 'confirm',
          displayedValue: '123456',
        },
      }),
    );
    expect(screen.getByText(/123456/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(onControl).toHaveBeenCalledWith({
        action: 'pairing-response',
        challengeId: 'challenge-1',
        accept: true,
      }),
    );
  });

  it('shows the unavailable state without offering device actions when disconnected', () => {
    renderPanel(state({ connection: 'disconnected', adapter: null, error: 'Bluetooth offline' }));
    expect(document.querySelector('.bluetooth-status')).toHaveTextContent('Bluetooth unavailable');
    expect(screen.getByText('Bluetooth offline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scan for devices' })).not.toBeInTheDocument();
  });
});
